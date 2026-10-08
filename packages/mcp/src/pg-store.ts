// OAuthStore on Postgres (the oauth schema, db/oauth.sql). migrate() applies the schema; it only
// creates what is missing, so it is safe to run at every start.
import { join } from "node:path";
import { SQL } from "bun";
import type { McpAppId } from "./apps.ts";
import { CLIENT_UNUSED_MS, GRANT_KEEP_MS, type AuditRow, type AuthCode, type AuthRequest, type Grant, type OAuthClient, type OAuthStore, type Token } from "./store.ts";

export const OAUTH_SQL = join(import.meta.dir, "..", "db", "oauth.sql");

type Row = Record<string, any>;
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());
const ts = (v: number | null | undefined) => (v === null || v === undefined ? null : new Date(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.replace(/^\{|\}$/g, "").split(",").filter(Boolean).map(s => s.replace(/^"|"$/g, "")) : []);

const client = (r: Row): OAuthClient => ({
  id: r.id, secretHash: r.secret_hash ?? null, name: r.name ?? null, redirectUris: arr(r.redirect_uris), authMethod: r.auth_method,
  app: r.app_id, surface: r.surface, kind: r.kind, createdAt: ms(r.created_at)!,
});
const request = (r: Row): AuthRequest => ({
  id: r.id, browserHash: r.browser_hash, clientId: r.client_id, app: r.app_id, redirectUri: r.redirect_uri, state: r.state ?? null,
  codeChallenge: r.code_challenge, scopes: arr(r.scopes) as AuthRequest["scopes"], resource: r.resource, e164: r.e164 ?? null,
  personId: r.person_id ?? null, step: r.step, createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!,
});
const grant = (r: Row): Grant => ({
  id: r.id, clientId: r.client_id, app: r.app_id, phoneKey: r.phone_key, personId: r.person_id ?? null, scopes: arr(r.scopes) as Grant["scopes"],
  resource: r.resource, createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, revokedAt: ms(r.revoked_at),
});
const code = (r: Row): AuthCode => ({
  hash: r.hash, grantId: r.grant_id, clientId: r.client_id, redirectUri: r.redirect_uri, codeChallenge: r.code_challenge, resource: r.resource,
  scopes: arr(r.scopes) as AuthCode["scopes"], createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, usedAt: ms(r.used_at),
});
const token = (r: Row): Token => ({
  hash: r.hash, kind: r.kind, grantId: r.grant_id, clientId: r.client_id, app: r.app_id, resource: r.resource, scopes: arr(r.scopes) as Token["scopes"],
  createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, revokedAt: ms(r.revoked_at), rotatedAt: ms(r.rotated_at),
});

export class PgOAuthStore implements OAuthStore {
  readonly sql: SQL;
  private readonly owned: boolean;
  constructor(db: string | SQL) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }
  async migrate() { await this.sql.unsafe(await Bun.file(OAUTH_SQL).text()); }
  async close() { if (this.owned) await this.sql.close(); }

  async putClient(c: OAuthClient) {
    await this.sql`insert into oauth.clients (id, secret_hash, name, redirect_uris, auth_method, app_id, surface, kind, created_at)
      values (${c.id}, ${c.secretHash}, ${c.name}, ${this.sql.array(c.redirectUris, "TEXT")}, ${c.authMethod}, ${c.app}, ${c.surface}, ${c.kind}, ${ts(c.createdAt)})
      on conflict (id) do update set name = excluded.name, redirect_uris = excluded.redirect_uris, surface = excluded.surface, created_at = excluded.created_at`;
  }
  async getClient(id: string) {
    const [r] = await this.sql`select * from oauth.clients where id = ${id}`;
    return r ? client(r) : undefined;
  }

  async putAuthRequest(q: AuthRequest) {
    await this.sql`insert into oauth.auth_requests (id, browser_hash, client_id, app_id, redirect_uri, state, code_challenge, scopes, resource, e164, person_id, step, created_at, expires_at)
      values (${q.id}, ${q.browserHash}, ${q.clientId}, ${q.app}, ${q.redirectUri}, ${q.state}, ${q.codeChallenge}, ${this.sql.array(q.scopes, "TEXT")}, ${q.resource}, ${q.e164}, ${q.personId}, ${q.step}, ${ts(q.createdAt)}, ${ts(q.expiresAt)})`;
  }
  async getAuthRequest(id: string) {
    const [r] = await this.sql`select * from oauth.auth_requests where id = ${id}`;
    return r ? request(r) : undefined;
  }
  async updateAuthRequest(id: string, patch: Partial<Pick<AuthRequest, "e164" | "personId" | "step">>) {
    const cur = await this.getAuthRequest(id);
    if (!cur) return;
    const n = { ...cur, ...patch };
    await this.sql`update oauth.auth_requests set e164 = ${n.e164}, person_id = ${n.personId}, step = ${n.step} where id = ${id}`;
  }
  async deleteAuthRequest(id: string) { await this.sql`delete from oauth.auth_requests where id = ${id}`; }

  async putGrant(g: Grant) {
    await this.sql`insert into oauth.grants (id, client_id, app_id, phone_key, person_id, scopes, resource, created_at, expires_at, revoked_at)
      values (${g.id}, ${g.clientId}, ${g.app}, ${g.phoneKey}, ${g.personId}, ${this.sql.array(g.scopes, "TEXT")}, ${g.resource}, ${ts(g.createdAt)}, ${ts(g.expiresAt)}, ${ts(g.revokedAt)})`;
  }
  async getGrant(id: string) {
    const [r] = await this.sql`select * from oauth.grants where id = ${id}`;
    return r ? grant(r) : undefined;
  }
  async grantsFor(phoneKey: string, app: McpAppId, at: number) {
    return (await this.sql`select * from oauth.grants where phone_key = ${phoneKey} and app_id = ${app} and revoked_at is null and expires_at > ${ts(at)} order by created_at`).map(grant);
  }
  async revokeGrant(id: string, at: number) {
    return this.sql.begin(async tx => {
      await tx`update oauth.tokens set revoked_at = ${ts(at)} where grant_id = ${id} and revoked_at is null`;
      const r = await tx`update oauth.grants set revoked_at = ${ts(at)} where id = ${id} and revoked_at is null returning id`;
      return r.length > 0;
    });
  }

  async putCode(c: AuthCode) {
    await this.sql`insert into oauth.codes (hash, grant_id, client_id, redirect_uri, code_challenge, resource, scopes, created_at, expires_at, used_at)
      values (${c.hash}, ${c.grantId}, ${c.clientId}, ${c.redirectUri}, ${c.codeChallenge}, ${c.resource}, ${this.sql.array(c.scopes, "TEXT")}, ${ts(c.createdAt)}, ${ts(c.expiresAt)}, ${ts(c.usedAt)})`;
  }
  async takeCode(hash: string, at: number) {
    // One statement: the first caller gets used_at = null back, every later caller sees the earlier use.
    const [r] = await this.sql`with prev as (select * from oauth.codes where hash = ${hash} for update)
      update oauth.codes c set used_at = coalesce(c.used_at, ${ts(at)}) from prev where c.hash = prev.hash
      returning prev.*`;
    return r ? code(r) : undefined;
  }

  async putToken(t: Token) {
    await this.sql`insert into oauth.tokens (hash, kind, grant_id, client_id, app_id, resource, scopes, created_at, expires_at, revoked_at, rotated_at)
      values (${t.hash}, ${t.kind}, ${t.grantId}, ${t.clientId}, ${t.app}, ${t.resource}, ${this.sql.array(t.scopes, "TEXT")}, ${ts(t.createdAt)}, ${ts(t.expiresAt)}, ${ts(t.revokedAt)}, ${ts(t.rotatedAt)})`;
  }
  async getToken(hash: string) {
    const [r] = await this.sql`select * from oauth.tokens where hash = ${hash}`;
    return r ? token(r) : undefined;
  }
  async revokeToken(hash: string, at: number) {
    await this.sql`update oauth.tokens set revoked_at = ${ts(at)} where hash = ${hash} and revoked_at is null`;
  }
  async rotateRefresh(hash: string, at: number) {
    const r = await this.sql`update oauth.tokens set rotated_at = ${ts(at)} where hash = ${hash} and kind = 'refresh' and rotated_at is null and revoked_at is null returning hash`;
    return r.length > 0;
  }

  async audit(a: AuditRow) {
    await this.sql`insert into oauth.audit (at, kind, client_id, grant_id, app_id, detail) values (${ts(a.at)}, ${a.kind}, ${a.clientId}, ${a.grantId}, ${a.app}, ${a.detail})`;
  }
  async auditRows(limit = 1000) {
    const rows = await this.sql`select * from (select * from oauth.audit order by id desc limit ${limit}) x order by id`;
    return rows.map((r: Row): AuditRow => ({ at: ms(r.at)!, kind: r.kind, clientId: r.client_id ?? null, grantId: r.grant_id ?? null, app: r.app_id ?? null, detail: r.detail ?? null }));
  }

  async hit(bucket: string, windowMs: number, at: number) {
    const start = ts(at - (at % windowMs));
    const [r] = await this.sql`insert into oauth.rate_limits (bucket, window_start, window_ms, count) values (${bucket}, ${start}, ${windowMs}, 1)
      on conflict (bucket) do update set
        count = case when oauth.rate_limits.window_start = excluded.window_start then oauth.rate_limits.count + 1 else 1 end,
        window_start = excluded.window_start, window_ms = excluded.window_ms
      returning count`;
    return Number(r!.count);
  }

  async sweep(at: number) {
    const t = ts(at);
    await this.sql`delete from oauth.auth_requests where expires_at <= ${t}`;
    await this.sql`delete from oauth.codes where expires_at <= ${t}`;
    await this.sql`delete from oauth.tokens where expires_at <= ${t}`;
    await this.sql`delete from oauth.rate_limits where window_start + make_interval(secs => window_ms / 1000.0) <= ${t}`;
    // Codes and tokens of a deleted grant go with it (on delete cascade).
    await this.sql`delete from oauth.grants where least(coalesce(revoked_at, expires_at), expires_at) <= ${ts(at - GRANT_KEEP_MS)}`;
    await this.sql`delete from oauth.clients c where c.created_at <= ${ts(at - CLIENT_UNUSED_MS)} and not exists (select 1 from oauth.grants g where g.client_id = c.id)`;
  }

  async forgetPhone(phoneKey: string, e164: string, app?: McpAppId) {
    const rows = app
      ? await this.sql`delete from oauth.grants where phone_key = ${phoneKey} and app_id = ${app} returning id`
      : await this.sql`delete from oauth.grants where phone_key = ${phoneKey} returning id`;
    if (app) await this.sql`delete from oauth.auth_requests where e164 = ${e164} and app_id = ${app}`;
    else await this.sql`delete from oauth.auth_requests where e164 = ${e164}`;
    return rows.length;
  }
}
