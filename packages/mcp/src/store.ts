// OAuth state behind one interface with two implementations: MemoryOAuthStore (tests, local dev)
// and PgOAuthStore (pg-store.ts, the oauth schema in db/oauth.sql). Times are epoch milliseconds.
// Tokens and codes are stored only as sha256 hashes (they are 32 random bytes, so a plain hash is
// enough). A client secret is stored the same way. The phone number of a grant stays on the server,
// as platform.sessions keeps it; no tool and no response carries it.
import { isDeepStrictEqual } from "node:util";
import { removalFormMayRevoke } from "../../core/src/generated/connectedAssistants.ts";
import { decideProfileClaim, type ProfileClaim } from "../../core/src/generated/mcpProfileSubmission.ts";
import { signupDraftExpired, signupDraftGrantAllowed, signupDraftUnique } from "../../core/src/generated/mcpSignupDraft.ts";
import { requestIsLive } from "../../core/src/generated/oauthGrantIssuance.ts";
import { defaultScopes, scopeName, scopeOfferedOn, scopes as connectorScopes } from "../../core/src/generated/authorizationPages.ts";
import { codeExchangeMayCommit, type CodeExchangeResult, refreshStoredAuthorityCurrent, type RefreshRotationResult } from "../../core/src/generated/oauthTokenLifecycle.ts";
import type { PhoneHandoff } from "../../core/src/generated/agentPhoneHandoff.ts";
import type { CloudGrantAuthority } from "../../core/src/svc/network-delegation.ts";
import type { McpAppId, Surface } from "./apps.ts";

export type Scope = "apps:read" | "membership:read" | "profile:write" | "profile:read" | "photos:use";
export const DEFAULT_SCOPES = defaultScopes.map(scope => scopeName(scope) as Scope);
export const SCOPES = connectorScopes.map(scope => scopeName(scope) as Scope);
export const scopesOn = (app: McpAppId): Scope[] => connectorScopes.filter(scope => scopeOfferedOn(scope, app === "slop")).map(scope => scopeName(scope) as Scope);
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

export interface AuthRequest {
  id: string;
  browserHash: string;
  clientId: string;
  app: McpAppId;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: Scope[];
  resource: string;
  e164: string | null;
  personId: string | null;
  step: "phone" | "code" | "consent" | "enrolling" | "enrolled";
  handoff?: PhoneHandoff;
  createdAt: number;
  expiresAt: number;
}

export type AuthRequestPage = Pick<AuthRequest, "e164" | "personId" | "step" | "handoff">;

export function samePendingAuthPage(observed: AuthRequest, expected: AuthRequest, at: number): boolean {
  return observed.id === expected.id && observed.browserHash === expected.browserHash
    && observed.expiresAt === expected.expiresAt && requestIsLive(at, observed.expiresAt)
    && observed.step === expected.step && observed.e164 === expected.e164 && observed.personId === expected.personId;
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

/** Require this live owner at the revocation write. */
export interface BrowserGrantRemoval extends Pick<Grant, "app" | "personId" | "phoneKey"> {
  e164: string;
  sessionHash: string;
  confirmationEndsAt: number;
  now: () => number;
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

interface TokenPairWrite {
  grant: Grant;
  tokens: readonly [Token, Token];
  audit: Omit<AuditRow, "at">;
  now: () => number;
}

export interface CodeExchange extends TokenPairWrite { code: AuthCode }
export interface RefreshRotation extends TokenPairWrite { refresh: Token }

function grantStillMatches(saved: Grant | undefined, expected: Grant): boolean {
  return !!saved && saved.revokedAt === null && (!saved.id.startsWith("grant_cloud_") || !!saved.cloudAuthority)
    && isDeepStrictEqual(saved, expected);
}

function preparedTokensLive(write: TokenPairWrite, at: number): boolean {
  return write.tokens.every(token => token.expiresAt > at && token.expiresAt <= write.grant.expiresAt);
}

/** Recheck the exact authorized rows under the store's write boundary. */
export function checkCodeExchange(exchange: CodeExchange, code: AuthCode | undefined, grant: Grant | undefined, at: number): CodeExchangeResult {
  const exactCode = !!code && isDeepStrictEqual({ ...code, usedAt: null }, { ...exchange.code, usedAt: null });
  if (exactCode && code.usedAt !== null) return "CodeAlreadyUsed";
  if (!codeExchangeMayCommit(grantStillMatches(grant, exchange.grant), exactCode, code?.usedAt === null, at, grant?.expiresAt ?? 0, code?.expiresAt ?? 0)) return "CodeNotCommitted";
  return preparedTokensLive(exchange, at) ? "CodePairCommitted" : "CodeNotCommitted";
}

export function checkRefreshRotation(rotation: RefreshRotation, refresh: Token | undefined, grant: Grant | undefined, at: number): RefreshRotationResult {
  if (!refresh) return "RefreshNotCommitted";
  const authorizedGrant = rotation.grant;
  const exactRefresh = refresh.kind === "refresh" && refresh.revokedAt === null && refresh.grantId === authorizedGrant.id
    && refresh.clientId === authorizedGrant.clientId && refresh.app === authorizedGrant.app && refresh.resource === authorizedGrant.resource
    && isDeepStrictEqual({ ...refresh, rotatedAt: null }, { ...rotation.refresh, rotatedAt: null });
  if (!refreshStoredAuthorityCurrent(grantStillMatches(grant, authorizedGrant), exactRefresh, at, grant?.expiresAt ?? 0, refresh.expiresAt)) return "RefreshNotCommitted";
  if (refresh.rotatedAt !== null) return "RefreshAlreadyUsed";
  return preparedTokensLive(rotation, at) ? "RefreshPairCommitted" : "RefreshNotCommitted";
}

export interface SignupDraftFields { firstName: string; homeCity?: "nyc" | "sf" }
export interface SignupDraft { grantId: string; app: McpAppId; phoneKey: string; fields: SignupDraftFields; expiresAt: number }

export type ProfileSubmissionGrant = Pick<Grant, "id" | "app" | "phoneKey" | "personId">;

export type AssistantGrantCandidate = { grant: Grant; client: OAuthClient };

export interface OAuthStore {
  putSignupDraft(d: SignupDraft, at: number): Promise<boolean>;
  deleteSignupDrafts(phoneKey: string, app: McpAppId): Promise<void>;
  /** Atomically admit the first intake for the fingerprint under this live grant. */
  claimProfileSubmission(grant: ProfileSubmissionGrant, fingerprint: string, at: number): Promise<ProfileClaim>;
  /** Store observed acceptance, or release a claim only after intake explicitly refused it. */
  finishProfileSubmission(grantId: string, fingerprint: string, accepted: boolean): Promise<boolean>;

  putClient(c: OAuthClient): Promise<void>;
  getClient(id: string): Promise<OAuthClient | undefined>;

  putAuthRequest(r: AuthRequest): Promise<void>;
  getAuthRequest(id: string): Promise<AuthRequest | undefined>;
  updateAuthRequest(id: string, patch: Partial<Pick<AuthRequest, "e164" | "personId" | "step">>): Promise<void>;
  /** Move exactly the still-live page that started this operation. */
  advanceAuthRequest(previous: AuthRequest, next: AuthRequestPage, now: () => number): Promise<boolean>;
  /** Check the current approval, then consume it and persist the grant, code and audit together.
   * False leaves no issuance. The callback must inspect the approval only. */
  commitConsentGrant(id: string, at: number, confirm: (approval: AuthRequest) => Promise<boolean>, writes: ConsentGrantWrites): Promise<boolean>;
  deleteAuthRequest(id: string): Promise<void>;

  putGrant(g: Grant): Promise<void>;
  getGrant(id: string): Promise<Grant | undefined>;
  /** The live grants of a phone in one app (the person's consent page). */
  grantsFor(phoneKey: string, app: McpAppId, at: number): Promise<Grant[]>;
  /** Live grants and clients for the person's assistant, optionally limited to one app. */
  assistantGrants(personId: string, at: number, app?: McpAppId): Promise<AssistantGrantCandidate[]>;
  /** Read the person's live grants and publish one assistant signal while holding the same projection lock. */
  projectAssistantGrants(personId: string, now: () => number, publish: (candidates: AssistantGrantCandidate[]) => Promise<void>): Promise<void>;
  /** Revoke the grant and every token of it. False if it was not live. */
  revokeGrant(id: string, at: number, owner?: BrowserGrantRemoval): Promise<boolean>;

  putCode(c: AuthCode): Promise<void>;
  /** Read without consuming; transient authority outages must leave a code retryable. */
  getCode(hash: string): Promise<AuthCode | undefined>;
  /** Consume the checked code and write the complete token pair and audit in one commit. */
  commitCodeExchange(exchange: CodeExchange): Promise<CodeExchangeResult>;

  putToken(t: Token): Promise<void>;
  getToken(hash: string): Promise<Token | undefined>;
  revokeToken(hash: string, at: number): Promise<void>;
  /** Atomically rotate a live refresh token, persist its pair and audit, or report an exact live reuse. */
  rotateRefresh(rotation: RefreshRotation): Promise<RefreshRotationResult>;

  audit(row: AuditRow): Promise<void>;
  auditRows(limit?: number): Promise<AuditRow[]>;

  /** Count one hit in a fixed window. Returns the count with this hit. */
  hit(bucket: string, windowMs: number, at: number): Promise<number>;
  /**
   * Delete everything that names a phone (its grants of one app or of every app, with their codes and
   * tokens, and its sign-in requests): the person left the app or deleted everything. Returns the grants deleted.
   */
  forgetPhone(phoneKey: string, e164: string, app?: McpAppId): Promise<number>;
  /** Delete one person's bound approvals and grants, with no effect on other phone owners. */
  forgetPerson(personId: string, app?: McpAppId): Promise<Grant[]>;
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
  private readonly profileSubmissions = new Map<string, Map<string, boolean>>();
  private readonly assistantProjections = new Map<string, Promise<void>>();
  readonly clients = new Map<string, OAuthClient>();
  readonly requests = new Map<string, AuthRequest>();
  readonly grants = new Map<string, Grant>();
  readonly codes = new Map<string, AuthCode>();
  readonly tokens = new Map<string, Token>();
  readonly rows: AuditRow[] = [];
  readonly windows = new Map<string, { start: number; count: number; windowMs: number }>();

  async putSignupDraft(d: SignupDraft, at: number) {
    const g = this.grants.get(d.grantId);
    if (!g || !signupDraftGrantAllowed(g.app === d.app && g.phoneKey === d.phoneKey, g.expiresAt > at, g.revokedAt === null, g.scopes.includes("profile:write"))
      || signupDraftExpired(d.expiresAt, at) || this.signupDrafts.has(g.id)) return false;
    this.signupDrafts.set(g.id, structuredClone(d));
    return true;
  }
  async deleteSignupDrafts(phoneKey: string, app: McpAppId) {
    for (const [id, d] of this.signupDrafts) if (d.phoneKey === phoneKey && d.app === app) this.signupDrafts.delete(id);
  }

  async claimProfileSubmission(grant: ProfileSubmissionGrant, fingerprint: string, at: number): Promise<ProfileClaim> {
    const current = this.grants.get(grant.id);
    const live = !!current && current.revokedAt === null && current.expiresAt > at && current.scopes.includes("profile:write") &&
      current.app === grant.app && current.phoneKey === grant.phoneKey && current.personId === grant.personId;
    const claims = this.profileSubmissions.get(grant.id);
    const prior = claims?.get(fingerprint);
    const decision = decideProfileClaim(live, prior !== undefined, prior === true);
    if (decision === "ProfileClaimStart") {
      const entries = claims ?? new Map<string, boolean>();
      entries.set(fingerprint, false);
      this.profileSubmissions.set(grant.id, entries);
    }
    return decision;
  }

  async finishProfileSubmission(grantId: string, fingerprint: string, accepted: boolean): Promise<boolean> {
    const claims = this.profileSubmissions.get(grantId);
    if (!claims || claims.get(fingerprint) !== false) return false;
    if (accepted) claims.set(fingerprint, true);
    else claims.delete(fingerprint);
    return true;
  }


  async putClient(c: OAuthClient) { this.clients.set(c.id, structuredClone(c)); }
  async getClient(id: string) { return copy(this.clients.get(id)); }

  async putAuthRequest(r: AuthRequest) { this.requests.set(r.id, structuredClone(r)); }
  async getAuthRequest(id: string) { return copy(this.requests.get(id)); }
  async updateAuthRequest(id: string, patch: Partial<Pick<AuthRequest, "e164" | "personId" | "step">>) {
    const r = this.requests.get(id);
    if (r) this.requests.set(id, { ...r, ...patch });
  }
  async advanceAuthRequest(previous: AuthRequest, next: AuthRequestPage, now: () => number) {
    const saved = this.requests.get(previous.id);
    if (!saved || !samePendingAuthPage(saved, previous, now())) return false;
    const { handoff: _replaced, ...kept } = saved;
    this.requests.set(previous.id, { ...kept, e164: next.e164, personId: next.personId, step: next.step, ...(next.handoff ? { handoff: next.handoff } : {}) });
    return true;
  }
  async commitConsentGrant(id: string, at: number, confirm: (approval: AuthRequest) => Promise<boolean>, writes: ConsentGrantWrites) {
    const pending = this.requests.get(id);
    if (!pending || (pending.step !== "consent" && pending.step !== "enrolled") || !pending.e164 || pending.expiresAt <= at) return false;
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
  async assistantGrants(personId: string, at: number, app?: McpAppId) {
    const candidates: AssistantGrantCandidate[] = [];
    for (const grant of this.grants.values()) {
      if (grant.personId !== personId || (app !== undefined && grant.app !== app) || grant.revokedAt !== null || grant.expiresAt <= at) continue;
      const client = this.clients.get(grant.clientId);
      if (client) candidates.push({ grant: structuredClone(grant), client: structuredClone(client) });
    }
    return candidates;
  }
  async projectAssistantGrants(personId: string, now: () => number, publish: (candidates: AssistantGrantCandidate[]) => Promise<void>) {
    const project = (this.assistantProjections.get(personId) ?? Promise.resolve()).then(async () => {
      await publish(await this.assistantGrants(personId, now()));
    });
    const settled = project.catch(() => {});
    this.assistantProjections.set(personId, settled);
    try { await project; } finally {
      if (this.assistantProjections.get(personId) === settled) this.assistantProjections.delete(personId);
    }
  }
  async revokeGrant(id: string, at: number, owner?: BrowserGrantRemoval) {
    const g = this.grants.get(id);
    if (owner) {
      at = owner.now();
      const ownedLive = !!g && g.revokedAt === null && g.expiresAt > at
        && g.app === owner.app && g.phoneKey === owner.phoneKey && g.personId === owner.personId;
      if (!removalFormMayRevoke(ownedLive, true, at, owner.confirmationEndsAt)) return false;
    }
    for (const t of this.tokens.values()) if (t.grantId === id && t.revokedAt === null) t.revokedAt = at;
    if (!g || g.revokedAt !== null) return false;
    g.revokedAt = at;
    this.profileSubmissions.delete(id);
    return true;
  }

  async putCode(c: AuthCode) { this.codes.set(c.hash, structuredClone(c)); }
  async getCode(hash: string) { return copy(this.codes.get(hash)); }
  async commitCodeExchange(exchange: CodeExchange) {
    const code = this.codes.get(exchange.code.hash);
    const grant = this.grants.get(exchange.grant.id);
    const at = exchange.now();
    const result = checkCodeExchange(exchange, code, grant, at);
    if (result !== "CodePairCommitted" || !code) return result;
    this.recordTokenPair(exchange, at);
    code.usedAt = at;
    return result;
  }

  private recordTokenPair(write: TokenPairWrite, at: number) {
    const prepared = structuredClone({ tokens: write.tokens, audit: { ...write.audit, at } });
    if (prepared.tokens[0].hash === prepared.tokens[1].hash || prepared.tokens.some(token => this.tokens.has(token.hash))) throw new Error("OAuth token already exists");
    for (const token of prepared.tokens) this.tokens.set(token.hash, token);
    this.rows.push(prepared.audit);
  }

  async putToken(t: Token) { this.tokens.set(t.hash, structuredClone(t)); }
  async getToken(hash: string) { return copy(this.tokens.get(hash)); }
  async revokeToken(hash: string, at: number) { const t = this.tokens.get(hash); if (t && t.revokedAt === null) t.revokedAt = at; }
  async rotateRefresh(rotation: RefreshRotation) {
    const refresh = this.tokens.get(rotation.refresh.hash);
    const grant = this.grants.get(rotation.grant.id);
    const at = rotation.now();
    const result = checkRefreshRotation(rotation, refresh, grant, at);
    if (result !== "RefreshPairCommitted" || !refresh) return result;
    this.recordTokenPair(rotation, at);
    refresh.rotatedAt = at;
    return result;
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
    for (const [k, d] of this.signupDrafts) if (signupDraftExpired(d.expiresAt, at)) this.signupDrafts.delete(k);
    for (const [k, r] of this.requests) if (r.expiresAt <= at) this.requests.delete(k);
    for (const [k, c] of this.codes) if (c.expiresAt <= at) this.codes.delete(k);
    for (const [k, t] of this.tokens) if (t.expiresAt <= at) this.tokens.delete(k);
    for (const [k, w] of this.windows) if (w.start + w.windowMs <= at) this.windows.delete(k);
    for (const [id, g] of this.grants) if (g.revokedAt !== null || g.expiresAt <= at) this.profileSubmissions.delete(id);
    for (const [k, g] of this.grants) if (Math.min(g.revokedAt ?? Infinity, g.expiresAt) <= at - GRANT_KEEP_MS) this.dropGrant(k);
    const used = new Set([...this.grants.values()].map(g => g.clientId));
    for (const [k, c] of this.clients) if (!used.has(k) && c.createdAt <= at - CLIENT_UNUSED_MS) this.clients.delete(k);
  }

  async forgetPhone(phoneKey: string, e164: string, app?: McpAppId) {
    let n = 0;
    for (const [k, d] of this.signupDrafts) if (d.phoneKey === phoneKey && (!app || d.app === app)) this.signupDrafts.delete(k);
    for (const [k, g] of this.grants) if (g.phoneKey === phoneKey && (!app || g.app === app)) { this.dropGrant(k); n++; }
    for (const [k, r] of this.requests) if (r.e164 === e164 && (!app || r.app === app)) this.requests.delete(k);
    return n;
  }

  async forgetPerson(personId: string, app?: McpAppId) {
    for (const [id, request] of this.requests)
      if (request.personId === personId && (!app || request.app === app)) this.requests.delete(id);
    const grants = [...this.grants.values()].filter(grant => grant.personId === personId && (!app || grant.app === app));
    const phones = new Set(grants.map(grant => grant.phoneKey));
    for (const [k, d] of this.signupDrafts) if (phones.has(d.phoneKey) && (!app || d.app === app)) this.signupDrafts.delete(k);
    for (const grant of grants) this.dropGrant(grant.id);
    return grants.map(grant => structuredClone(grant));
  }

  private dropGrant(id: string) {
    this.grants.delete(id);
    this.signupDrafts.delete(id);
    this.profileSubmissions.delete(id);
    for (const [k, c] of this.codes) if (c.grantId === id) this.codes.delete(k);
    for (const [k, t] of this.tokens) if (t.grantId === id) this.tokens.delete(k);
  }
}
