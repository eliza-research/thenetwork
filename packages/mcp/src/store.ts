// OAuth state behind one interface with two implementations: MemoryOAuthStore (tests, local dev)
// and PgOAuthStore (pg-store.ts, the oauth schema in db/oauth.sql). Times are epoch milliseconds.
// Tokens and codes are stored only as sha256 hashes (they are 32 random bytes, so a plain hash is
// enough). A client secret is stored the same way. The phone number of a grant stays on the server,
// as platform.sessions keeps it; no tool and no response carries it.
import { signupDraftExpired, signupDraftGrantAllowed, signupDraftRowReadable, signupDraftUnique } from "../../core/src/generated/mcpSignupDraft.ts";
import type { CloudGrantAuthority } from "../../core/src/svc/network-delegation.ts";
import type { McpAppId, Surface } from "./apps.ts";

export type Scope = "apps:read" | "membership:read" | "profile:write";
export const SCOPES: readonly Scope[] = ["apps:read", "membership:read", "profile:write"];
export type ClientAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export interface OAuthClient {
  id: string;
  secretHash: string | null;
  name: string | null;
  redirectUris: string[];
  authMethod: ClientAuthMethod;
  /** The app of the site the client registered on. Every grant and token of the client is for this app only. */
  app: McpAppId;
  surface: Surface;
  kind: "dcr" | "cimd";
  createdAt: number;
}

/** One authorization request while the person signs in and decides. Deleted when it ends. */
export interface AuthRequest {
  id: string;
  /** sha256 of the browser cookie that binds the request to one browser (login CSRF). */
  browserHash: string;
  clientId: string;
  app: McpAppId;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: Scope[];
  resource: string;
  /** Set by the person on our page (never by the client). */
  e164: string | null;
  personId: string | null;
  step: "phone" | "code" | "consent";
  createdAt: number;
  expiresAt: number;
}

/** A consent record: the person approved this client for these scopes in this app. Revocable. */
export interface Grant {
  /** Server-owned sealed Cloud delegation. NULL is valid only for genuine legacy phone grants. */
  cloudAuthority?: CloudGrantAuthority | null;
  id: string;
  clientId: string;
  app: McpAppId;
  /** The platform's keyed hash of the number (PlatformHooks.phoneKey), never the number itself. */
  phoneKey: string;
  /** The person at consent time, if the phone had one. A later different person means a new owner: the grant is dead. */
  personId: string | null;
  scopes: Scope[];
  resource: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AuthCode {
  hash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: Scope[];
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface Token {
  hash: string;
  kind: "access" | "refresh";
  grantId: string;
  clientId: string;
  app: McpAppId;
  resource: string;
  scopes: Scope[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  /** Refresh tokens: when it was exchanged for a new pair (rotation). A second use is a replay. */
  rotatedAt: number | null;
}

export type AuditKind =
  | "client_registered" | "consent_granted" | "consent_denied" | "consent_revoked"
  | "code_issued" | "code_replay" | "token_issued" | "token_refreshed" | "token_revoked" | "refresh_replay";

/** One audit row. Never a token, a code, a secret or a phone number. */
export interface AuditRow { at: number; kind: AuditKind; clientId: string | null; grantId: string | null; app: McpAppId | null; detail: string | null }

export interface ConsentGrantWrites {
  grant: Grant;
  code: AuthCode;
  audit: readonly [AuditRow, AuditRow];
}

/** Approved editable Join fields only. No phone, age, consent or dating preferences. */
export interface SignupDraftFields { firstName: string; homeCity?: "nyc" | "sf" }
export interface SignupDraft { grantId: string; app: McpAppId; phoneKey: string; fields: SignupDraftFields; expiresAt: number; consumedAt: number | null }

export interface OAuthStore {
  /** One draft per grant; no overwrite/replay. Grant liveness and scope checked atomically. */
  putSignupDraft(d: SignupDraft, at: number): Promise<boolean>;
  /** Recoverable read for the verified phone/app until deliberate discard or expiry. */
  claimSignupDraft(phoneKey: string, app: McpAppId, personId: string | null, at: number): Promise<SignupDraftFields | undefined>;
  discardSignupDrafts(phoneKey: string, app: McpAppId, at: number): Promise<void>;

  putClient(c: OAuthClient): Promise<void>;
  getClient(id: string): Promise<OAuthClient | undefined>;

  putAuthRequest(r: AuthRequest): Promise<void>;
  getAuthRequest(id: string): Promise<AuthRequest | undefined>;
  updateAuthRequest(id: string, patch: Partial<Pick<AuthRequest, "e164" | "personId" | "step">>): Promise<void>;
  /** Check the current approval, then consume it and persist the grant, code and audit together.
   * False leaves no issuance. The callback must inspect the approval only. */
  commitConsentGrant(id: string, at: number, confirm: (approval: AuthRequest) => Promise<boolean>, writes: ConsentGrantWrites): Promise<boolean>;
  deleteAuthRequest(id: string): Promise<void>;

  putGrant(g: Grant): Promise<void>;
  getGrant(id: string): Promise<Grant | undefined>;
  /** The live grants of a phone in one app (the person's consent page). */
  grantsFor(phoneKey: string, app: McpAppId, at: number): Promise<Grant[]>;
  /** Revoke the grant and every token of it. False if it was not live. */
  revokeGrant(id: string, at: number): Promise<boolean>;

  putCode(c: AuthCode): Promise<void>;
  /** Read without consuming; transient authority outages must leave a code retryable. */
  getCode(hash: string): Promise<AuthCode | undefined>;
  /** Mark the code used and return it as it was before (usedAt shows an earlier use: a replay). */
  takeCode(hash: string, at: number): Promise<AuthCode | undefined>;

  putToken(t: Token): Promise<void>;
  getToken(hash: string): Promise<Token | undefined>;
  revokeToken(hash: string, at: number): Promise<void>;
  /** Atomically rotate a live refresh token, persist its pair and success audit.
   * False on replay/revocation (one winner under a race); errors leave everything unchanged. */
  rotateRefresh(hash: string, at: number, pair: readonly [Token, Token], audit: AuditRow): Promise<boolean>;

  audit(row: AuditRow): Promise<void>;
  auditRows(limit?: number): Promise<AuditRow[]>;

  /** Count one hit in a fixed window. Returns the count with this hit. */
  hit(bucket: string, windowMs: number, at: number): Promise<number>;
  /**
   * Delete everything that names a phone (its grants of one app or of every app, with their codes and
   * tokens, and its sign-in requests): the person left the app or deleted everything. Returns the grants deleted.
   */
  forgetPhone(phoneKey: string, e164: string, app?: McpAppId): Promise<number>;
  /**
   * Delete expired requests, codes, tokens and rate-limit windows; grants revoked or expired more than
   * GRANT_KEEP_MS ago; and registered clients older than CLIENT_UNUSED_MS that never got a grant.
   */
  sweep(at: number): Promise<void>;
}

/** A revoked or expired grant is kept this long (the person's consent page shows it), then deleted. */
export const GRANT_KEEP_MS = 30 * 86_400_000;
/** A dynamically registered client that never got a grant is deleted after this long. */
export const CLIENT_UNUSED_MS = 86_400_000;

const copy = <T extends object>(v: T | undefined): T | undefined => (v ? structuredClone(v) : undefined);

export class MemoryOAuthStore implements OAuthStore {
  readonly signupDrafts = new Map<string, SignupDraft>();
  readonly clients = new Map<string, OAuthClient>();
  readonly requests = new Map<string, AuthRequest>();
  readonly grants = new Map<string, Grant>();
  readonly codes = new Map<string, AuthCode>();
  readonly tokens = new Map<string, Token>();
  readonly rows: AuditRow[] = [];
  readonly windows = new Map<string, { start: number; count: number; windowMs: number }>();

  async putSignupDraft(d: SignupDraft, at: number) {
    const g = this.grants.get(d.grantId);
    if (!g || !signupDraftGrantAllowed(g.app === d.app && g.phoneKey === d.phoneKey, !(g.expiresAt <= at), g.revokedAt === null, g.scopes.includes("profile:write"))
      || this.signupDrafts.has(g.id)) return false;
    this.signupDrafts.set(g.id, structuredClone(d)); return true;
  }
  async claimSignupDraft(phoneKey: string, app: McpAppId, personId: string | null, at: number) {
    const drafts = [...this.signupDrafts.values()].filter(d => {
      if (!signupDraftRowReadable(d.phoneKey === phoneKey && d.app === app, d.consumedAt === null, d.expiresAt, at)) return false;
      const g = this.grants.get(d.grantId);
      return !!g && signupDraftGrantAllowed(g.personId === personId && g.app === app && g.phoneKey === phoneKey,
        g.expiresAt > at, g.revokedAt === null, g.scopes.includes("profile:write"));
    });
    if (!signupDraftUnique(drafts.length)) return undefined;
    return structuredClone(drafts[0].fields);
  }
  async discardSignupDrafts(phoneKey: string, app: McpAppId, at: number) {
    for (const d of this.signupDrafts.values()) if (d.phoneKey === phoneKey && d.app === app) { d.fields = { firstName: "" }; d.consumedAt = at; }
  }


  async putClient(c: OAuthClient) { this.clients.set(c.id, structuredClone(c)); }
  async getClient(id: string) { return copy(this.clients.get(id)); }

  async putAuthRequest(r: AuthRequest) { this.requests.set(r.id, structuredClone(r)); }
  async getAuthRequest(id: string) { return copy(this.requests.get(id)); }
  async updateAuthRequest(id: string, patch: Partial<Pick<AuthRequest, "e164" | "personId" | "step">>) {
    const r = this.requests.get(id);
    if (r) this.requests.set(id, { ...r, ...patch });
  }
  async commitConsentGrant(id: string, at: number, confirm: (approval: AuthRequest) => Promise<boolean>, writes: ConsentGrantWrites) {
    const pending = this.requests.get(id);
    if (!pending || pending.step !== "consent" || !pending.e164 || pending.expiresAt <= at) return false;
    if (!await confirm(structuredClone(pending)) || this.requests.get(id) !== pending) return false;

    const prepared = structuredClone(writes);
    this.requireNewGrant(prepared.grant);
    if (this.codes.has(prepared.code.hash)) throw new Error("Authorization code already exists");
    this.requests.delete(id);
    this.grants.set(prepared.grant.id, prepared.grant);
    this.codes.set(prepared.code.hash, prepared.code);
    this.rows.push(...prepared.audit);
    return true;
  }
  async deleteAuthRequest(id: string) { this.requests.delete(id); }

  private requireNewGrant(grant: Grant) {
    if (grant.id.startsWith("grant_cloud_") && grant.cloudAuthority?.version !== 1) throw new Error("Cloud grant authority required");
    if (this.grants.has(grant.id)) throw new Error("Grant already exists");
  }
  async putGrant(g: Grant) {
    this.requireNewGrant(g);
    this.grants.set(g.id, structuredClone(g));
  }
  async getGrant(id: string) { return copy(this.grants.get(id)); }
  async grantsFor(phoneKey: string, app: McpAppId, at: number) {
    return [...this.grants.values()].filter(g => g.phoneKey === phoneKey && g.app === app && g.revokedAt === null && g.expiresAt > at).map(g => structuredClone(g));
  }
  async revokeGrant(id: string, at: number) {
    const g = this.grants.get(id);
    for (const t of this.tokens.values()) if (t.grantId === id && t.revokedAt === null) t.revokedAt = at;
    if (!g || g.revokedAt !== null) return false;
    g.revokedAt = at;
    const draft = this.signupDrafts.get(id); if (draft) draft.fields = { firstName: "" };
    return true;
  }

  async putCode(c: AuthCode) { this.codes.set(c.hash, structuredClone(c)); }
  async getCode(hash: string) { return copy(this.codes.get(hash)); }
  async takeCode(hash: string, at: number) {
    const c = this.codes.get(hash);
    if (!c) return undefined;
    const before = structuredClone(c);
    if (c.usedAt === null) c.usedAt = at;
    return before;
  }

  async putToken(t: Token) { this.tokens.set(t.hash, structuredClone(t)); }
  async getToken(hash: string) { return copy(this.tokens.get(hash)); }
  async revokeToken(hash: string, at: number) { const t = this.tokens.get(hash); if (t && t.revokedAt === null) t.revokedAt = at; }
  async rotateRefresh(hash: string, at: number, pair: readonly [Token, Token], audit: AuditRow) {
    const t = this.tokens.get(hash);
    if (!t || t.kind !== "refresh" || t.rotatedAt !== null || t.revokedAt !== null) return false;
    const prepared = structuredClone({ pair, audit });
    t.rotatedAt = at;
    for (const token of prepared.pair) this.tokens.set(token.hash, token);
    this.rows.push(prepared.audit);
    return true;
  }

  async audit(row: AuditRow) { this.rows.push({ ...row }); }
  async auditRows(limit = 1000) { return this.rows.slice(-limit).map(r => ({ ...r })); }

  async hit(bucket: string, windowMs: number, at: number) {
    const start = at - (at % windowMs);
    const cur = this.windows.get(bucket);
    if (!cur || cur.start !== start) { this.windows.set(bucket, { start, count: 1, windowMs }); return 1; }
    return ++cur.count;
  }

  async sweep(at: number) {
    for (const d of this.signupDrafts.values()) if (signupDraftExpired(d.expiresAt, at)) d.fields = { firstName: "" };
    for (const [k, r] of this.requests) if (r.expiresAt <= at) this.requests.delete(k);
    for (const [k, c] of this.codes) if (c.expiresAt <= at) this.codes.delete(k);
    for (const [k, t] of this.tokens) if (t.expiresAt <= at) this.tokens.delete(k);
    for (const [k, w] of this.windows) if (w.start + w.windowMs <= at) this.windows.delete(k);
    for (const [k, g] of this.grants) if (Math.min(g.revokedAt ?? Infinity, g.expiresAt) <= at - GRANT_KEEP_MS) this.dropGrant(k);
    const used = new Set([...this.grants.values()].map(g => g.clientId));
    for (const [k, c] of this.clients) if (!used.has(k) && c.createdAt <= at - CLIENT_UNUSED_MS) this.clients.delete(k);
  }

  async forgetPhone(phoneKey: string, e164: string, app?: McpAppId) {
    let n = 0;
    for (const [k, g] of this.grants) if (g.phoneKey === phoneKey && (!app || g.app === app)) { this.dropGrant(k); n++; }
    for (const [k, r] of this.requests) if (r.e164 === e164 && (!app || r.app === app)) this.requests.delete(k);
    return n;
  }

  private dropGrant(id: string) {
    this.grants.delete(id);
    this.signupDrafts.delete(id);
    for (const [k, c] of this.codes) if (c.grantId === id) this.codes.delete(k);
    for (const [k, t] of this.tokens) if (t.grantId === id) this.tokens.delete(k);
  }
}
