// Staff access (admin-console 4): who is calling, with which roles, and the audit log.
//  - Roles are per app (platform plan 5.1): "role@app" or "role@*" (every app); "role" alone is
//    "role@*". Roles: admin, reviewer, safety, analyst, engineer (simulated worlds only) and
//    cross_app_safety (the cross-app person view; "@*" only).
//  - Static tokens: OBSERVATORY_TOKENS="admin:<tok>,reviewer@slop:<tok>,<tok>:safety@peon" (role@app:token
//    or token:role@app; a token listed twice holds both grants). OBSERVATORY_TOKEN is an admin@* token.
//    A token is sent only as "Authorization: Bearer <token>", never in a URL (it would stay in the
//    history, in logs and in Referer headers), and the server refuses tokens shorter than 32
//    characters. With SSO on, tokens are refused: every person signs in as themselves.
//  - SSO: OBSERVATORY_TRUST_CF_ACCESS=1 takes the staff email from Cloudflare Access, and maps emails
//    to roles with OBSERVATORY_ROLES="email:role@app,..." and, in real mode, platform.staff_roles. The email is trusted only from a verified
//    Cf-Access-Jwt-Assertion: RS256 against the team's keys (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs,
//    cached), audience OBSERVATORY_CF_ACCESS_AUD, issuer, expiry and issue time (AccessVerifier).
//    Without a team and an audience the server refuses to start; a token that fails a check gets 401.
//  - Audit: every PII reveal, staff read of a member, timeline or opportunity, and staff action is
//    written before the data is returned. A JSONL file under runs/audit/ by default, or the
//    append-only table network.staff_audit through OBSERVATORY_AUDIT_DATABASE_URL (a separate,
//    writable login: the real-mode data connection stays read-only).
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { APP_IDS, isAppId, type AppId } from "./apps.ts";
import { STAFF_ROLES, type AuditEntry, type Mode, type RoleGrant, type StaffRole, type StaffUser } from "./types.ts";

export const REPO = resolve(import.meta.dir, "../../..");

/**
 * "role[@app]": a role for one app or for every app ("@*"; no "@" is "@*", the format before the four
 * apps). cross_app_safety exists only for every app. Unknown roles and apps are an error: a typo must
 * not grant nothing silently.
 */
export function parseGrant(spec: string, where: string): RoleGrant {
  const at = spec.indexOf("@");
  const role = (at < 0 ? spec : spec.slice(0, at)).trim() as StaffRole, app = at < 0 ? "*" : spec.slice(at + 1).trim().toLowerCase();
  if (!STAFF_ROLES.includes(role)) throw new Error(`${where}: unknown role "${role}" (one of ${STAFF_ROLES.join(", ")})`);
  if (app !== "*" && !isAppId(app)) throw new Error(`${where}: unknown app "${app}" (one of ${APP_IDS.join(", ")} or *)`);
  if (role === "cross_app_safety" && app !== "*") throw new Error(`${where}: cross_app_safety is for every app: use cross_app_safety@*`);
  return { role, app };
}
const isGrant = (x: string) => { try { parseGrant(x, ""); return true; } catch { return false; } };
const addGrant = <K>(out: Map<K, RoleGrant[]>, k: K, g: RoleGrant) => {
  const list = out.get(k) ?? [];
  if (!list.some(x => x.role === g.role && x.app === g.app)) list.push(g);
  out.set(k, list);
};

/**
 * OBSERVATORY_TOKENS -> token -> grants. Each entry is "role[@app]:token" (the old "role:token" is
 * "role@*:token") or "token:role[@app]". A token listed twice holds both grants.
 */
export function parseTokenGrants(spec: string | undefined, o: { explicitApp?: boolean; minLength?: number } = {}): Map<string, RoleGrant[]> {
  const out = new Map<string, RoleGrant[]>();
  const short = (tok: string) => { if (o.minLength && tok.length < o.minLength) throw new Error(`OBSERVATORY_TOKENS: a token is shorter than ${o.minLength} characters (use a random token, for example openssl rand -base64 32)`); return tok; };
  for (const part of (spec ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
    const i = part.indexOf(":"), j = part.lastIndexOf(":");
    const bad = () => new Error(`OBSERVATORY_TOKENS: bad entry "${part.slice(0, Math.max(i, 0))}:..." (use role@app:token or token:role@app; role one of ${STAFF_ROLES.join(", ")})`);
    if (i < 1 || j >= part.length - 1) throw bad();
    const left = part.slice(0, i).trim(), right = part.slice(j + 1).trim();
    // In production an entry must name its app ("reviewer@slop" or "reviewer@*"): an old "reviewer:<t>"
    // entry would quietly give the role on every app, dating and hiring data included.
    if (o.explicitApp && ((isGrant(left) && !left.includes("@")) || (isGrant(right) && !right.includes("@") && !isGrant(left)))) {
      throw new Error(`OBSERVATORY_TOKENS: "${isGrant(left) ? left : right}" names no app; in production write role@app or role@*`);
    }
    if (isGrant(left) && part.slice(i + 1).trim()) addGrant(out, short(part.slice(i + 1).trim()), parseGrant(left, "OBSERVATORY_TOKENS"));
    else if (isGrant(right) && part.slice(0, j).trim()) addGrant(out, short(part.slice(0, j).trim()), parseGrant(right, "OBSERVATORY_TOKENS"));
    // A role with an app that is wrong ("reviewer@tinder"): say what is wrong with it.
    else if (left.includes("@")) parseGrant(left, "OBSERVATORY_TOKENS");
    else if (right.includes("@")) parseGrant(right, "OBSERVATORY_TOKENS");
    else throw bad();
  }
  return out;
}

/**
 * The format before the four apps: token -> roles, every role for every app. The Network service
 * (NETWORK_SERVICE_TOKENS) still reads it. An app-scoped entry is refused here: it would grant the
 * role for every app.
 */
export function parseTokens(spec: string | undefined): Map<string, Set<StaffRole>> {
  const out = new Map<string, Set<StaffRole>>();
  for (const [tok, grants] of parseTokenGrants(spec)) {
    const scoped = grants.find(g => g.app !== "*");
    if (scoped) throw new Error(`OBSERVATORY_TOKENS: "${scoped.role}@${scoped.app}" is for one app; this reader takes roles for every app only`);
    out.set(tok, new Set(grants.map(g => g.role)));
  }
  return out;
}

/** OBSERVATORY_ROLES "email:role[@app],..." -> lowercased email -> grants. */
export function parseRoles(spec: string | undefined): Map<string, RoleGrant[]> {
  const out = new Map<string, RoleGrant[]>();
  for (const part of (spec ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
    const i = part.lastIndexOf(":");
    const email = part.slice(0, i).trim().toLowerCase();
    if (i < 1 || !email.includes("@")) throw new Error(`OBSERVATORY_ROLES: bad entry "${part}" (use email:role@app)`);
    addGrant(out, email, parseGrant(part.slice(i + 1), "OBSERVATORY_ROLES"));
  }
  return out;
}

const tokenId = (role: string, tok: string) => `token:${role}#${createHash("sha256").update(tok).digest("hex").slice(0, 8)}`;

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A staff user from grants: `roles` lists every role held (for display), in STAFF_ROLES order. */
export function staffUser(id: string, grants: RoleGrant[], via: StaffUser["via"]): StaffUser {
  const sorted = [...grants].sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.app.localeCompare(b.app));
  return { id, roles: STAFF_ROLES.filter(r => grants.some(g => g.role === r)), grants: sorted, via };
}

/** Staff roles stored in platform.staff_roles (real mode), read again every minute. */
export interface StaffRoleSource { grants(email: string): RoleGrant[] }

export interface StaffAuthOptions {
  /** Token -> grants (or, the format before the four apps, roles for every app). */
  tokens: Map<string, RoleGrant[] | Set<StaffRole>>;
  /** Take the staff email from Cloudflare Access (SSO). Only authenticateStaff() with an AccessVerifier accepts it. */
  trustCfAccess: boolean;
  roles: Map<string, RoleGrant[]>;
  /** Verifies the Access JWT. Without it, an SSO request is refused. */
  access?: AccessVerifier;
  /** platform.staff_roles, added to OBSERVATORY_ROLES for SSO users. */
  stored?: StaffRoleSource;
}

/** An SSO user's grants now: OBSERVATORY_ROLES and platform.staff_roles (re-read every minute). */
export function ssoGrants(email: string, o: Pick<StaffAuthOptions, "roles" | "stored">): RoleGrant[] {
  const grants = [...(o.roles.get(email) ?? [])];
  for (const g of o.stored?.grants(email) ?? []) if (!grants.some(x => x.role === g.role && x.app === g.app)) grants.push(g);
  return grants;
}

export type AuthResult = { user: StaffUser } | { status: 401 | 403; error: string };

const ACCESS_HEADERS = ["cf-access-jwt-assertion", "cf-access-authenticated-user-email"];

/**
 * Who is calling: Cloudflare Access when trusted (the JWT is verified first), else a bearer token
 * (Authorization header only). With SSO on, a token is refused: each person signs in as themselves.
 */
export async function authenticateStaff(req: Request, o: StaffAuthOptions): Promise<AuthResult> {
  if (o.trustCfAccess && !ACCESS_HEADERS.some(h => req.headers.has(h))) return { status: 401, error: "sign in through Cloudflare Access (staff tokens are off when single sign-on is on)" };
  if (o.trustCfAccess) {
    const jwt = req.headers.get("cf-access-jwt-assertion")?.trim();
    // Cloudflare Access sends the assertion with every request it lets through; the email header alone proves nothing.
    if (!jwt) return { status: 401, error: "missing Cloudflare Access assertion" };
    if (!o.access) return { status: 401, error: "Cloudflare Access is not configured (OBSERVATORY_CF_ACCESS_TEAM, OBSERVATORY_CF_ACCESS_AUD)" };
    const v = await o.access.verify(jwt);
    if ("error" in v) return { status: 401, error: `Cloudflare Access token refused: ${v.error}` };
    const header = req.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
    if (header && header !== v.email) return { status: 401, error: "Cloudflare Access email does not match the token" };
    const grants = ssoGrants(v.email, o);
    if (!grants.length) return { status: 403, error: "no staff role for this account" };
    return { user: { ...staffUser(v.email, grants, "sso"), expiresAt: v.exp, issuedAt: v.iat } };
  }
  return authenticate(req, o);
}

/** A bearer token in the Authorization header (role tokens only; Cloudflare Access goes through authenticateStaff). Never ?token=. */
export function authenticate(req: Request, o: Pick<StaffAuthOptions, "tokens"> & Partial<StaffAuthOptions>): AuthResult {
  const auth = req.headers.get("authorization");
  const given = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (given) for (const [tok, held] of o.tokens) {
    if (!sameToken(given, tok)) continue;
    const grants = held instanceof Set ? [...held].map(role => ({ role, app: "*" })) : held;
    const u = staffUser("", grants, "token");
    return { user: { ...u, id: tokenId(u.roles.join("+"), tok) } };
  }
  return { status: 401, error: "missing or wrong token" };
}

/**
 * The roles this user holds for one app: grants for that app and for every app. In real mode the
 * engineer role gives nothing (simulated worlds only). cross_app_safety is never a per-app role.
 */
export function rolesFor(u: StaffUser, app: AppId, mode: Mode): Set<StaffRole> {
  const out = new Set<StaffRole>();
  for (const g of u.grants ?? u.roles.map(role => ({ role, app: "*" }))) {
    if (g.app !== "*" && g.app !== app) continue;
    if (g.role === "cross_app_safety" || (g.role === "engineer" && mode === "real")) continue;
    out.add(g.role);
  }
  return out;
}

/**
 * Admin for the app (admin@app or admin@*) passes every check for it; anyone else needs one of the
 * listed roles for that app. Without an app: the role for every app ("@*").
 */
export function allowed(u: StaffUser, need: readonly StaffRole[], app?: AppId, mode: Mode = "game"): boolean {
  if (!app) return hasEverywhere(u, "admin") || need.some(r => hasEverywhere(u, r));
  const r = rolesFor(u, app, mode);
  return r.has("admin") || need.some(x => r.has(x));
}
/** The role for every app ("role@*"). */
export const hasEverywhere = (u: StaffUser, role: StaffRole) => (u.grants ?? u.roles.map(r => ({ role: r, app: "*" }))).some(g => g.role === role && g.app === "*");
/** The cross-app person view: cross_app_safety@* or admin@*. Never a reviewer. */
export const canCrossApp = (u: StaffUser) => hasEverywhere(u, "admin") || hasEverywhere(u, "cross_app_safety");
/** Apps where this user holds any role in this mode. */
export const appsFor = (u: StaffUser, mode: Mode): AppId[] => APP_IDS.filter(a => rolesFor(u, a, mode).size > 0);

/**
 * platform.staff_roles (real mode): loaded at start and every minute through the given connection. A
 * failed load keeps the last good list (and logs once); a database without the table gives none.
 */
export class PgStaffRoles implements StaffRoleSource {
  private byEmail = new Map<string, RoleGrant[]>();
  private timer?: ReturnType<typeof setInterval>;
  private warned = false;
  constructor(private sql: SQL, private everyMs = 60_000) {}
  async start() { await this.load(); this.timer = setInterval(() => { this.load(); }, this.everyMs); }
  async load() {
    try {
      const rows = await this.sql`select email, role, app_id from platform.staff_roles`;
      const next = new Map<string, RoleGrant[]>();
      for (const r of rows as { email: string; role: string; app_id: string | null }[]) {
        try { addGrant(next, r.email.trim().toLowerCase(), parseGrant(`${r.role}@${r.app_id ?? "*"}`, "platform.staff_roles")); } catch { /* a row the console does not know: no grant */ }
      }
      this.byEmail = next;
    } catch (e) {
      if (!this.warned) { this.warned = true; console.warn(`Observatory: platform.staff_roles not read (${(e as Error).message}); OBSERVATORY_ROLES only`); }
    }
  }
  grants(email: string) { return this.byEmail.get(email) ?? []; }
  stop() { if (this.timer) clearInterval(this.timer); }
}

// ---------------------------------------------------------------- Cloudflare Access JWT
export interface AccessConfig {
  /** The Access team: "<team>" or "<team>.cloudflareaccess.com" (OBSERVATORY_CF_ACCESS_TEAM). */
  team: string;
  /** The Access application's audience tag (OBSERVATORY_CF_ACCESS_AUD). */
  aud: string;
  /** Where the signing keys are. Default: https://<team>.cloudflareaccess.com/cdn-cgi/access/certs. */
  certsUrl?: string;
  /** How long fetched keys are used before they are fetched again (default 1 hour). */
  cacheMs?: number;
  /** A certs request that takes longer fails (default 5 s). */
  timeoutMs?: number;
  /** When a refetch fails, keys this old are still used (default 24 hours after they were fetched): Cloudflare keeps old keys valid for days. */
  staleMs?: number;
  /** Tests: the certs request and the clock. */
  fetch?: (url: string) => Promise<Response>;
  now?: () => number;
}
/** Clock difference allowed on exp, nbf and iat. */
const ACCESS_SKEW_MS = 60_000;
/** An unknown key id fetches the certs again at most this often (Cloudflare rotates its keys). */
const ACCESS_REFETCH_MS = 30_000;

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Verifies a Cloudflare Access application token (Cf-Access-Jwt-Assertion): RS256 with a key from the
 * team's certs endpoint (cached), the audience, the issuer, exp, nbf and iat. Returns the email it carries.
 */
export class AccessVerifier {
  readonly issuer: string;
  readonly certsUrl: string;
  private keys = new Map<string, CryptoKey>();
  private fetchedAt = -Infinity;
  private loading?: Promise<void>;
  constructor(private c: AccessConfig) {
    const host = c.team.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (!host || !c.aud.trim()) throw new Error("Cloudflare Access needs a team (OBSERVATORY_CF_ACCESS_TEAM) and an audience (OBSERVATORY_CF_ACCESS_AUD)");
    const domain = host.includes(".") ? host : `${host}.cloudflareaccess.com`;
    this.issuer = `https://${domain}`;
    this.certsUrl = c.certsUrl ?? `${this.issuer}/cdn-cgi/access/certs`;
  }

  private now() { return this.c.now?.() ?? Date.now(); }

  /** The signing key with this id: from the cache, else the certs are fetched again (at most every 30 s for an unknown id). */
  private async key(kid: string): Promise<CryptoKey | undefined> {
    const age = this.now() - this.fetchedAt;
    if (age > (this.c.cacheMs ?? 3_600_000) || (!this.keys.has(kid) && age > ACCESS_REFETCH_MS)) {
      this.loading ??= this.load().finally(() => { this.loading = undefined; });
      try { await this.loading; } catch (e) {
        // A failed refetch keeps the last good keys for a while (stale grace), so a Cloudflare blip does not sign everyone out.
        if (!this.keys.size || age > (this.c.cacheMs ?? 3_600_000) + (this.c.staleMs ?? 86_400_000)) throw e;
        if (!this.staleWarned) { this.staleWarned = true; console.warn(`Observatory: Access certs refetch failed (${(e as Error).message}); using the keys fetched ${Math.round(age / 60_000)} min ago`); }
      }
    }
    return this.keys.get(kid);
  }
  private staleWarned = false;

  private async load() {
    const ms = this.c.timeoutMs ?? 5_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      (this.c.fetch ?? ((u: string) => fetch(u, { signal: AbortSignal.timeout(ms) })))(this.certsUrl),
      new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`certs request timed out after ${ms} ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
    if (!r.ok) throw new Error(`certs request failed: HTTP ${r.status}`);
    const body = await r.json() as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] };
    const keys = new Map<string, CryptoKey>();
    for (const k of body.keys ?? []) {
      if (!k.kid || k.kty !== "RSA" || (k.alg && k.alg !== "RS256")) continue;
      keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: k.kty, n: k.n, e: k.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    this.keys = keys;
    this.fetchedAt = this.now();
    this.staleWarned = false;
  }

  async verify(token: string): Promise<{ email: string; exp: number; iat: number } | { error: string }> {
    const parts = token.split(".");
    if (parts.length !== 3) return { error: "malformed token" };
    let header: { alg?: string; kid?: string }, claims: Record<string, unknown>;
    try { header = JSON.parse(b64url(parts[0]!).toString("utf8")); claims = JSON.parse(b64url(parts[1]!).toString("utf8")); } catch { return { error: "malformed token" }; }
    if (header.alg !== "RS256" || typeof header.kid !== "string") return { error: "not an RS256 token with a key id" };
    let key: CryptoKey | undefined;
    try { key = await this.key(header.kid); } catch (e) { return { error: `signing keys unavailable (${(e as Error).message})` }; }
    if (!key) return { error: "unknown signing key" };
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return { error: "bad signature" };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.c.aud.trim())) return { error: "wrong audience" };
    if (claims.iss !== this.issuer) return { error: "wrong issuer" };
    const now = this.now(), sec = (k: string) => (typeof claims[k] === "number" ? (claims[k] as number) * 1000 : undefined);
    const exp = sec("exp"), iat = sec("iat"), nbf = sec("nbf");
    if (exp === undefined || now >= exp + ACCESS_SKEW_MS) return { error: "expired" };
    if (iat === undefined || iat > now + ACCESS_SKEW_MS) return { error: "issued in the future" };
    if (nbf !== undefined && nbf > now + ACCESS_SKEW_MS) return { error: "not valid yet" };
    // A service token (no email) is not a person: staff sign in as themselves (runbook-real 7.3).
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return { error: "no email in the token" };
    return { email: claims.email.trim().toLowerCase(), exp, iat };
  }
}

// ---------------------------------------------------------------- audit
export interface AuditSink {
  readonly kind: "file" | "postgres";
  write(e: AuditEntry): Promise<void>;
  /** Newest first. */
  /** `apps`: only rows about these apps (rows with no app are left out too). */
  list(q?: { limit?: number; actor?: string; targetType?: string; targetId?: string; actions?: string[]; apps?: string[] }): Promise<AuditEntry[]>;
  close(): Promise<void>;
}

/** Append-only JSONL file (runs/audit/audit.jsonl by default). */
export class FileAudit implements AuditSink {
  readonly kind = "file" as const;
  readonly file: string;
  private ready?: Promise<unknown>;
  private chain: Promise<void> = Promise.resolve();
  constructor(dir = process.env.OBSERVATORY_AUDIT_DIR ?? join(REPO, "runs", "audit")) { this.file = join(dir, "audit.jsonl"); this.ready = mkdir(dir, { recursive: true }); }
  write(e: AuditEntry): Promise<void> {
    // One append at a time, in order.
    const next = this.chain.then(async () => { await this.ready; await appendFile(this.file, JSON.stringify(e) + "\n"); });
    this.chain = next.catch(() => {});
    return next;
  }
  async list(q: Parameters<AuditSink["list"]>[0] = {}): Promise<AuditEntry[]> {
    await this.chain;
    const text = await readFile(this.file, "utf8").catch(() => "");
    // One bad line (a crash in the middle of a write, a hand edit) must not hide the rest of the log.
    const rows: AuditEntry[] = [];
    text.split("\n").forEach((l, i) => {
      if (!l.trim()) return;
      try { const e = JSON.parse(l) as AuditEntry; if (e && typeof e === "object" && typeof e.action === "string") rows.push({ ...e, id: i + 1 }); } catch { /* skipped: not a row */ }
    });
    return rows.filter(e => match(e, q)).reverse().slice(0, q.limit ?? 200);
  }
  async close() { await this.chain; }
}

function match(e: AuditEntry, q: Parameters<AuditSink["list"]>[0] = {}) {
  return (!q.actor || e.actor === q.actor) && (!q.targetType || e.targetType === q.targetType) && (!q.targetId || e.targetId === q.targetId) && (!q.actions || q.actions.includes(e.action))
    && (!q.apps || (!!e.app && q.apps.includes(e.app)));
}

/** network.staff_audit through a separate writable login (packages/observatory/db/schema.sql). */
export class PgAudit implements AuditSink {
  readonly kind = "postgres" as const;
  private sql: SQL;
  /** network.staff_audit has app_id (migration 0005). Without it the app goes in detail.app. */
  private hasApp?: Promise<boolean>;
  constructor(url: string) { this.sql = new SQL({ url, max: 2, idleTimeout: 30, connection: { application_name: "network-observatory-audit", statement_timeout: "10000" } }); }
  private appColumn() {
    this.hasApp ??= this.sql`select 1 from information_schema.columns where table_schema = 'network' and table_name = 'staff_audit' and column_name = 'app_id'`
      .then(r => r.length > 0, () => { this.hasApp = undefined; return false; });
    return this.hasApp;
  }
  async write(e: AuditEntry) {
    const roles = `{${e.roles.join(",")}}`;
    if (await this.appColumn()) {
      await this.sql`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, reason, mode, ok, detail, app_id)
        values (${new Date(e.at)}, ${e.actor}, ${roles}::text[], ${e.action}, ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.reason ?? null}, ${e.mode ?? null}, ${e.ok}, ${e.detail ?? {}}::jsonb, ${e.app ?? null})`;
      return;
    }
    const detail = e.app ? { ...e.detail, app: e.app } : e.detail ?? {};
    await this.sql`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, reason, mode, ok, detail)
      values (${new Date(e.at)}, ${e.actor}, ${roles}::text[], ${e.action}, ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.reason ?? null}, ${e.mode ?? null}, ${e.ok}, ${detail}::jsonb)`;
  }
  async list(q: Parameters<AuditSink["list"]>[0] = {}): Promise<AuditEntry[]> {
    const apps = q.apps ? `{${q.apps.join(",")}}` : null;
    // The app column, or detail.app on a table from before migration 0005.
    const rows = await this.sql`select * from (select id, at, actor, roles, action, target_type, target_id, reason, mode, ok, detail,
        coalesce(to_jsonb(a)->>'app_id', detail->>'app') as app from network.staff_audit a) x
      where (${apps}::text[] is null or app = any(${apps}::text[]))
        and (${q.actor ?? null}::text is null or actor = ${q.actor ?? null})
        and (${q.targetType ?? null}::text is null or target_type = ${q.targetType ?? null})
        and (${q.targetId ?? null}::text is null or target_id = ${q.targetId ?? null})
        and (${q.actions ? `{${q.actions.join(",")}}` : null}::text[] is null or action = any(${q.actions ? `{${q.actions.join(",")}}` : null}::text[]))
      order by id desc limit ${q.limit ?? 200}`;
    return (rows as any[]).map(r => ({
      id: Number(r.id), at: new Date(r.at).getTime(), actor: r.actor, roles: r.roles ?? [], action: r.action,
      ...(r.target_type ? { targetType: r.target_type } : {}), ...(r.target_id ? { targetId: r.target_id } : {}), ...(r.reason ? { reason: r.reason } : {}),
      ...(r.mode ? { mode: r.mode } : {}), ...(r.app ? { app: r.app } : {}), ok: r.ok, ...(r.detail && Object.keys(r.detail).length ? { detail: r.detail } : {}),
    }));
  }
  async close() { await this.sql.close(); }
}

/** The audit sink: Postgres (network.staff_audit) when a URL is given, else a local JSONL file. `production`: Postgres or nothing (a file on one machine is not an audit log). */
export function createAudit(o: { url?: string; dir?: string; production?: boolean } = {}): AuditSink {
  const url = o.url ?? process.env.OBSERVATORY_AUDIT_DATABASE_URL;
  if (!url && o.production) throw new Error("in production the console's audit log must be Postgres: set OBSERVATORY_AUDIT_DATABASE_URL");
  return url ? new PgAudit(url) : new FileAudit(o.dir);
}
