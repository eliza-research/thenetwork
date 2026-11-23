import { createHash, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { allowedByRole, globalGrants, mayOpenCrossApp, scopedGrants } from "../../core/src/generated/staffPermissions.ts";
import { staffSecondFactorShown, tokensAccepted } from "../../core/src/generated/staffSignIn.ts";
import { APP_IDS, isAppId, type AppId } from "./apps.ts";
import { STAFF_ROLES, type AuditEntry, type Mode, type RoleGrant, type StaffRole, type StaffUser } from "./types.ts";

export const REPO = resolve(import.meta.dirname, "../../..");

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

export function parseTokenGrants(spec: string | undefined, o: { explicitApp?: boolean; minLength?: number; variable?: string } = {}): Map<string, RoleGrant[]> {
  const out = new Map<string, RoleGrant[]>();
  const variable = o.variable ?? "OBSERVATORY_TOKENS";
  const short = (tok: string) => { if (o.minLength && tok.length < o.minLength) throw new Error(`${variable}: a token is shorter than ${o.minLength} characters (use a random token, for example openssl rand -base64 32)`); return tok; };
  for (const part of (spec ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
    const i = part.indexOf(":"), j = part.lastIndexOf(":");
    const bad = () => new Error(`${variable}: bad entry "${part.slice(0, Math.max(i, 0))}:..." (use role@app:token or token:role@app; role one of ${STAFF_ROLES.join(", ")})`);
    if (i < 1 || j >= part.length - 1) throw bad();
    const left = part.slice(0, i).trim(), right = part.slice(j + 1).trim();
    if (o.explicitApp && ((isGrant(left) && !left.includes("@")) || (isGrant(right) && !right.includes("@") && !isGrant(left)))) {
      throw new Error(`${variable}: "${isGrant(left) ? left : right}" names no app; in production write role@app or role@*`);
    }
    if (isGrant(left) && part.slice(i + 1).trim()) addGrant(out, short(part.slice(i + 1).trim()), parseGrant(left, variable));
    else if (isGrant(right) && part.slice(0, j).trim()) addGrant(out, short(part.slice(0, j).trim()), parseGrant(right, variable));
    else if (left.includes("@")) parseGrant(left, variable);
    else if (right.includes("@")) parseGrant(right, variable);
    else throw bad();
  }
  return out;
}

export function parseTokens(spec: string | undefined): Map<string, Set<StaffRole>> {
  const out = new Map<string, Set<StaffRole>>();
  for (const [tok, grants] of parseTokenGrants(spec)) {
    const scoped = grants.find(g => g.app !== "*");
    if (scoped) throw new Error(`OBSERVATORY_TOKENS: "${scoped.role}@${scoped.app}" is for one app; this reader takes roles for every app only`);
    out.set(tok, new Set(grants.map(g => g.role)));
  }
  return out;
}

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

export function staffUser(id: string, grants: RoleGrant[], via: StaffUser["via"]): StaffUser {
  const sorted = [...grants].sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.app.localeCompare(b.app));
  return { id, roles: STAFF_ROLES.filter(r => grants.some(g => g.role === r)), grants: sorted, via };
}

export interface StaffRoleSource { grants(email: string): RoleGrant[] }

export interface StaffAuthOptions {
  tokens: Map<string, RoleGrant[] | Set<StaffRole>>;
  trustCfAccess: boolean;
  roles: Map<string, RoleGrant[]>;
  access?: AccessVerifier;
  stored?: StaffRoleSource;
}

export function ssoGrants(email: string, o: Pick<StaffAuthOptions, "roles" | "stored">): RoleGrant[] {
  const grants = [...(o.roles.get(email) ?? [])];
  for (const g of o.stored?.grants(email) ?? []) if (!grants.some(x => x.role === g.role && x.app === g.app)) grants.push(g);
  return grants;
}

export type AuthResult = { user: StaffUser } | { status: 401 | 403; error: string };

const ACCESS_HEADERS = ["cf-access-jwt-assertion", "cf-access-authenticated-user-email"];

export async function authenticateStaff(req: Request, o: StaffAuthOptions): Promise<AuthResult> {
  if (tokensAccepted(o.trustCfAccess)) return authenticate(req, o);
  if (!ACCESS_HEADERS.some(h => req.headers.has(h))) return { status: 401, error: "sign in through Cloudflare Access (staff tokens are off when single sign-on is on)" };
  const jwt = req.headers.get("cf-access-jwt-assertion")?.trim();
  if (!jwt) return { status: 401, error: "missing Cloudflare Access assertion" };
  if (!o.access) return { status: 401, error: "Cloudflare Access is not configured (OBSERVATORY_CF_ACCESS_TEAM, OBSERVATORY_CF_ACCESS_AUD)" };
  const v = await o.access.verify(jwt);
  if ("error" in v) return { status: 401, error: `Cloudflare Access token refused: ${v.error}` };
  const header = req.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (header && header !== v.email) return { status: 401, error: "Cloudflare Access email does not match the token" };
  const grants = ssoGrants(v.email, o);
  if (!grants.length) return { status: 403, error: "no staff role for this account" };
  return { user: { ...staffUser(v.email, grants, "sso"), expiresAt: v.exp, secondFactor: v.secondFactor } };
}

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

export function rolesFor(u: StaffUser, app: AppId, mode: Mode): Set<StaffRole> {
  return new Set(scopedGrants(grantsOf(u), app, mode === "real").map(g => g.role as StaffRole));
}

const grantsOf = (u: StaffUser): RoleGrant[] => u.grants ?? u.roles.map(role => ({ role, app: "*" }));
export const globalRolesFor = (u: StaffUser): StaffRole[] => globalGrants(grantsOf(u)).map(g => g.role as StaffRole);

export function allowed(u: StaffUser, need: readonly StaffRole[], app?: AppId, mode: Mode = "game"): boolean {
  return allowedByRole(app ? [...rolesFor(u, app, mode)] : globalRolesFor(u), [...need]);
}
export const hasEverywhere = (u: StaffUser, role: StaffRole) => globalRolesFor(u).includes(role);
export const canCrossApp = (u: StaffUser) => mayOpenCrossApp(globalRolesFor(u));
export const appsFor = (u: StaffUser, mode: Mode): AppId[] => APP_IDS.filter(a => rolesFor(u, a, mode).size > 0);

export class PgStaffRoles implements StaffRoleSource {
  private byEmail = new Map<string, RoleGrant[]>();
  private timer?: ReturnType<typeof setInterval>;
  private warned = false;
  private skipped = new Set<string>();
  constructor(private sql: SQL, private everyMs = 60_000) {}
  async start() { await this.load(); this.timer = setInterval(() => { this.load(); }, this.everyMs); }
  async load() {
    try {
      const rows = await this.sql`select email, role, app_id from platform.staff_roles`;
      const next = new Map<string, RoleGrant[]>();
      for (const r of rows as { email: string; role: string; app_id: string | null }[]) {
        try { addGrant(next, r.email.trim().toLowerCase(), parseGrant(`${r.role}@${r.app_id ?? "*"}`, "platform.staff_roles")); } catch (e) {
          const key = `${r.email}|${r.role}|${r.app_id ?? "*"}`;
          if (!this.skipped.has(key)) { this.skipped.add(key); console.warn(`Observatory: platform.staff_roles row skipped (email ${r.email}, role ${r.role}, app ${r.app_id ?? "*"}): ${(e as Error).message}`); }
        }
      }
      this.byEmail = next;
    } catch (e) {
      this.byEmail.clear();
      if (!this.warned) { this.warned = true; console.warn(`Observatory: platform.staff_roles not read (${(e as Error).message}); OBSERVATORY_ROLES only`); }
    }
  }
  grants(email: string) { return this.byEmail.get(email) ?? []; }
  stop() { if (this.timer) clearInterval(this.timer); }
}

export interface AccessConfig {
  team: string;
  aud: string;
  certsUrl?: string;
  cacheMs?: number;
  timeoutMs?: number;
  staleMs?: number;
  fetch?: (url: string) => Promise<Response>;
  now?: () => number;
}
const ACCESS_SKEW_MS = 60_000;
const ACCESS_REFETCH_MS = 30_000;

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

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

  private async key(kid: string): Promise<CryptoKey | undefined> {
    const age = this.now() - this.fetchedAt;
    if (age > (this.c.cacheMs ?? 3_600_000) || (!this.keys.has(kid) && age > ACCESS_REFETCH_MS)) {
      this.loading ??= this.load().finally(() => { this.loading = undefined; });
      try { await this.loading; } catch (e) {
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

  async verify(token: string): Promise<{ email: string; exp: number; secondFactor: boolean } | { error: string }> {
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
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return { error: "no email in the token" };
    const methods = new Set((Array.isArray(claims.amr) ? claims.amr : []).filter((m): m is string => typeof m === "string").map(m => m.trim().toLowerCase()).filter(m => m.length > 0));
    return { email: claims.email.trim().toLowerCase(), exp, secondFactor: staffSecondFactorShown(methods.has("mfa"), methods.size) };
  }
}

export interface AuditSink {
  readonly kind: "file" | "postgres";
  write(e: AuditEntry): Promise<void>;
  list(q?: { limit?: number; actor?: string; targetType?: string; targetId?: string; actions?: string[]; apps?: string[] }): Promise<AuditEntry[]>;
  close(force?: boolean): Promise<void>;
}

export class FileAudit implements AuditSink {
  readonly kind = "file" as const;
  readonly file: string;
  private ready?: Promise<unknown>;
  private chain: Promise<void> = Promise.resolve();
  private warnedLines = new Set<number>();
  constructor(dir = process.env.OBSERVATORY_AUDIT_DIR ?? join(REPO, "runs", "audit")) { this.file = join(dir, "audit.jsonl"); this.ready = mkdir(dir, { recursive: true }); }
  private warnLine(line: number, why: string) {
    if (this.warnedLines.has(line)) return;
    this.warnedLines.add(line);
    console.warn(`Observatory: audit file ${this.file} line ${line} skipped (${why})`);
  }
  write(e: AuditEntry): Promise<void> {
    const next = this.chain.then(async () => { await this.ready; await appendFile(this.file, JSON.stringify(e) + "\n"); });
    this.chain = next.catch(() => {});
    return next;
  }
  async list(q: Parameters<AuditSink["list"]>[0] = {}): Promise<AuditEntry[]> {
    await this.chain;
    const text = await readFile(this.file, "utf8").catch((e: { code?: string }) => { if (e.code === "ENOENT") return ""; throw e; });
    const rows: AuditEntry[] = [];
    text.split("\n").forEach((l, i) => {
      if (!l.trim()) return;
      let e: AuditEntry | undefined;
      try { e = JSON.parse(l) as AuditEntry; } catch (err) { this.warnLine(i + 1, (err as Error).message); return; }
      if (e && typeof e === "object" && typeof e.action === "string") rows.push({ ...e, id: i + 1 });
      else this.warnLine(i + 1, "not an audit row");
    });
    return rows.filter(e => match(e, q)).reverse().slice(0, q.limit ?? 200);
  }
  async close() { await this.chain; }
}

function match(e: AuditEntry, q: Parameters<AuditSink["list"]>[0] = {}) {
  return (!q.actor || e.actor === q.actor) && (!q.targetType || e.targetType === q.targetType) && (!q.targetId || e.targetId === q.targetId) && (!q.actions || q.actions.includes(e.action))
    && (!q.apps || (!!e.app && q.apps.includes(e.app)));
}

export class PgAudit implements AuditSink {
  readonly kind = "postgres" as const;
  private sql: SQL;
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
  async close(force = false) { await this.sql.end(force ? { timeout: 0 } : undefined); }
}

export function createAudit(o: { url?: string; dir?: string } = {}): AuditSink {
  const url = o.url ?? process.env.OBSERVATORY_AUDIT_DATABASE_URL;
  return url ? new PgAudit(url) : new FileAudit(o.dir);
}
