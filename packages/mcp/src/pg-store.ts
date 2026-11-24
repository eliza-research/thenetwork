// OAuthStore on Postgres (the oauth schema, db/oauth.sql). migrate() applies the schema; it only
// creates what is missing, so it is safe to run at every start.
import { fileAt } from "../../core/src/runtime/files.ts";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { removalFormMayRevoke } from "../../core/src/generated/connectedAssistants.ts";
import { signupDraftCanPrepare, signupDraftExpired, signupDraftGrantAllowed, signupDraftUnique } from "../../core/src/generated/mcpSignupDraft.ts";
import { signupPrefillAllowed, useSignupPrefill as markSignupPrefillUsed } from "../../core/src/generated/authorizationPages.ts";
import { decideProfileClaim, type ProfileClaim } from "../../core/src/generated/mcpProfileSubmission.ts";
import { parseState as parseHandoff } from "../../core/src/generated/agentPhoneHandoff.ts";
import type { McpAppId } from "./apps.ts";
import { CLIENT_UNUSED_MS, GRANT_KEEP_MS, checkCodeExchange, checkRefreshRotation, samePendingAuthPage, type AssistantGrantCandidate, type AuditRow, type AuthCode, type AuthRequest, type AuthRequestPage, type CodeExchange, type ConsentGrantWrites, type Grant, BrowserGrantRemoval, type OAuthClient, type OAuthStore, type ProfileSubmissionGrant, type RefreshRotation, type SignupDraft, type Token } from "./store.ts";

export const OAUTH_SQL = join(import.meta.dirname, "..", "db", "oauth.sql");

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
  ...storedHandoff(r.id, r.handoff),
});
class StoredHandoffInvalid extends Error {
  constructor(readonly requestId: string) {
    super(`Stored signup handoff of authorization request ${requestId} does not parse`);
    this.name = "StoredHandoffInvalid";
  }
}
const storedHandoff = (requestId: string, v: unknown): Pick<AuthRequest, "handoff"> => {
  if (v === null || v === undefined) return {};
  const handoff = parseHandoff(v);
  if (!handoff) throw new StoredHandoffInvalid(requestId);
  return { handoff };
};
const grant = (r: Row): Grant => ({
  id: r.id, clientId: r.client_id, app: r.app_id, phoneKey: r.phone_key, personId: r.person_id ?? null, scopes: arr(r.scopes) as Grant["scopes"],
  resource: r.resource, createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, revokedAt: ms(r.revoked_at), ...(r.cloud_authority ? {cloudAuthority:r.cloud_authority} : {}),
});
const code = (r: Row): AuthCode => ({
  hash: r.hash, grantId: r.grant_id, clientId: r.client_id, redirectUri: r.redirect_uri, codeChallenge: r.code_challenge, resource: r.resource,
  scopes: arr(r.scopes) as AuthCode["scopes"], createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, usedAt: ms(r.used_at),
});
const token = (r: Row): Token => ({
  hash: r.hash, kind: r.kind, grantId: r.grant_id, clientId: r.client_id, app: r.app_id, resource: r.resource, scopes: arr(r.scopes) as Token["scopes"],
  createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, revokedAt: ms(r.revoked_at), rotatedAt: ms(r.rotated_at),
});

const insertGrant = (sql: SQL, g: Grant) => sql`insert into oauth.grants (id, client_id, app_id, phone_key, person_id, scopes, resource, created_at, expires_at, revoked_at, cloud_authority)
      values (${g.id}, ${g.clientId}, ${g.app}, ${g.phoneKey}, ${g.personId}, ${sql.array(g.scopes, "TEXT")}, ${g.resource}, ${ts(g.createdAt)}, ${ts(g.expiresAt)}, ${ts(g.revokedAt)}, ${g.cloudAuthority ?? null}::jsonb)`;

const insertCode = (sql: SQL, c: AuthCode) => sql`insert into oauth.codes (hash, grant_id, client_id, redirect_uri, code_challenge, resource, scopes, created_at, expires_at, used_at)
      values (${c.hash}, ${c.grantId}, ${c.clientId}, ${c.redirectUri}, ${c.codeChallenge}, ${c.resource}, ${sql.array(c.scopes, "TEXT")}, ${ts(c.createdAt)}, ${ts(c.expiresAt)}, ${ts(c.usedAt)})`;

const insertAudit = (sql: SQL, a: AuditRow) => sql`insert into oauth.audit (at, kind, client_id, grant_id, app_id, detail) values (${ts(a.at)}, ${a.kind}, ${a.clientId}, ${a.grantId}, ${a.app}, ${a.detail})`;
const insertToken = (sql: SQL, t: Token) => sql`insert into oauth.tokens (hash, kind, grant_id, client_id, app_id, resource, scopes, created_at, expires_at, revoked_at, rotated_at)
  values (${t.hash}, ${t.kind}, ${t.grantId}, ${t.clientId}, ${t.app}, ${t.resource}, ${sql.array(t.scopes, "TEXT")}, ${ts(t.createdAt)}, ${ts(t.expiresAt)}, ${ts(t.revokedAt)}, ${ts(t.rotatedAt)})`;

const expiredCodeExchange = new Error("OAuth code exchange expired during transaction");
const expiredRefreshRotation = new Error("OAuth refresh expired during transaction");

type CheckBrowserOwner = (tx: SQL, owner: BrowserGrantRemoval) => Promise<boolean>;

export class PgOAuthStore implements OAuthStore {
  readonly sql: SQL;
  private readonly owned: boolean;
  constructor(db: string | SQL, private readonly checkBrowserOwner?: CheckBrowserOwner) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }
  async migrate() { await this.sql.unsafe(await fileAt(OAUTH_SQL).text()); }
  async close() { if (this.owned) await this.sql.close(); }

  async claimProfileSubmission(g: ProfileSubmissionGrant, fingerprint: string, at: number): Promise<ProfileClaim> {
    const started = performance.now();
    return this.sql.begin(async tx => {
      const [current] = await tx<{ expires_at: Date; revoked_at: Date | null }[]>`select expires_at,revoked_at from oauth.grants
        where id=${g.id} and app_id=${g.app} and phone_key=${g.phoneKey} and person_id is not distinct from ${g.personId}
          and 'profile:write'=any(scopes) for share`;
      const live = !!current && current.revoked_at === null && current.expires_at.getTime() > at + Math.ceil(performance.now() - started);
      if (decideProfileClaim(live, false, false) === "ProfileClaimRefused") return "ProfileClaimRefused";
      const [won] = await tx`insert into oauth.profile_submissions (grant_id,fingerprint) values (${g.id},${fingerprint})
        on conflict (grant_id,fingerprint) do nothing returning grant_id`;
      if (won) return "ProfileClaimStart";
      const [saved] = await tx<{ accepted: boolean }[]>`select accepted from oauth.profile_submissions where grant_id=${g.id} and fingerprint=${fingerprint}`;
      return decideProfileClaim(true, true, saved?.accepted === true);
    });
  }

  async finishProfileSubmission(grantId: string, fingerprint: string, accepted: boolean): Promise<boolean> {
    const rows = accepted
      ? await this.sql`update oauth.profile_submissions set accepted=true where grant_id=${grantId} and fingerprint=${fingerprint} and not accepted returning grant_id`
      : await this.sql`delete from oauth.profile_submissions where grant_id=${grantId} and fingerprint=${fingerprint} and not accepted returning grant_id`;
    return rows.length === 1;
  }

  async putSignupDraft(d: SignupDraft, at: number) {
    return this.sql.begin(async tx => {
      const [g] = await tx<{ app_id: string; phone_key: string; expires_at: Date; revoked_at: Date | null; scopes: unknown; signup_draft_prepared: boolean }[]>`
        select app_id, phone_key, expires_at, revoked_at, scopes, signup_draft_prepared from oauth.grants where id=${d.grantId} for update`;
      if (!g || !signupDraftGrantAllowed(g.app_id === d.app && g.phone_key === d.phoneKey, ms(g.expires_at)! > at, g.revoked_at === null, arr(g.scopes).includes("profile:write"))
        || signupDraftExpired(d.expiresAt, at) || !signupDraftCanPrepare(g.signup_draft_prepared)) return false;
      const rows = await tx`insert into oauth.signup_drafts (grant_id, app_id, phone_key, fields, expires_at)
        values (${d.grantId}, ${d.app}, ${d.phoneKey}, ${d.fields}::jsonb, ${ts(d.expiresAt)}) on conflict (grant_id) do nothing returning grant_id`;
      if (!signupDraftUnique(rows.length)) return false;
      await tx`update oauth.grants set signup_draft_prepared=true where id=${d.grantId}`;
      return true;
    });
  }

  async claimSignupDraft(phoneKey: string, app: import("./apps.ts").McpAppId, personId: string | null, at: number) {
    const started = performance.now();
    try { return await this.sql.begin(async tx => {
      // Lock grants in the same order as revocation before taking draft rows.
      const grants = await tx`select g.id from oauth.grants g join oauth.signup_drafts d on d.grant_id=g.id
        where d.phone_key=${phoneKey} and d.app_id=${app} and d.expires_at>${new Date(at)}
        and g.app_id=${app} and g.phone_key=${phoneKey} and g.person_id is not distinct from ${personId}
        and g.revoked_at is null and g.expires_at>${new Date(at)} and 'profile:write'=any(g.scopes) order by g.id for update of g`;
      if (!signupDraftUnique(grants.length)) return undefined;
      const liveAt = at + Math.ceil(performance.now() - started);
      const rows = await tx`select d.grant_id,d.fields from oauth.signup_drafts d join oauth.grants g on g.id=d.grant_id
        where d.grant_id=${grants[0].id} and d.expires_at>${new Date(liveAt)}
        and g.app_id=${app} and g.phone_key=${phoneKey} and g.person_id is not distinct from ${personId}
        and g.revoked_at is null and g.expires_at>${new Date(liveAt)} and 'profile:write'=any(g.scopes) for update of d`;
      if (!signupDraftUnique(rows.length)) return undefined;
      return rows[0].fields as import("./store.ts").SignupDraftFields;
    }); } catch { throw new Error("Signup draft storage unavailable"); }
  }

  async useSignupPrefill(ask: import("./store.ts").SignupPrefillAsk, at: number) {
    try { return await this.sql.begin(async tx => {
      const grants = (await tx`select g.* from oauth.grants g
        join oauth.signup_drafts d on d.grant_id=g.id
        where d.phone_key=${ask.phoneKey} and d.app_id=${ask.app} and g.client_id=${ask.clientId}
        order by g.id for update of g`).map(grant);
      const drafts = await tx`select d.grant_id,d.app_id,d.phone_key,d.fields,d.expires_at from oauth.signup_drafts d
        join oauth.grants g on g.id=d.grant_id
        where d.phone_key=${ask.phoneKey} and d.app_id=${ask.app} and g.client_id=${ask.clientId} for update of d`;
      const request = { client: ask.clientId, app: ask.app, phone: ask.phoneKey, asOf: at, ageAllowed: ask.ageAllowed };
      const usable = drafts.filter(d => {
        const g = grants.find(x => x.id === d.grant_id);
        return !!g && signupDraftGrantAllowed(g.personId === ask.personId && g.app === d.app_id && g.phoneKey === d.phone_key, g.expiresAt > at, g.revokedAt === null, g.scopes.includes("profile:write"))
          && signupPrefillAllowed({ client: g.clientId, app: d.app_id, phone: d.phone_key, used: false, expiresAt: ms(d.expires_at)! }, request);
      });
      if (!signupDraftUnique(usable.length)) return undefined;
      const d = usable[0]!, g = grants.find(x => x.id === d.grant_id)!;
      if (!markSignupPrefillUsed({ client: g.clientId, app: d.app_id, phone: d.phone_key, used: false, expiresAt: ms(d.expires_at)! }, request).used) return undefined;
      const used = await tx`delete from oauth.signup_drafts where grant_id=${d.grant_id} returning fields`;
      return signupDraftUnique(used.length) ? used[0].fields as import("./store.ts").SignupDraftFields : undefined;
    }); } catch { throw new Error("Signup draft storage unavailable"); }
  }

  async deleteSignupDrafts(phoneKey: string, app: McpAppId) {
    await this.sql`delete from oauth.signup_drafts where phone_key=${phoneKey} and app_id=${app}`;
  }

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
    await this.sql`insert into oauth.auth_requests (id, browser_hash, client_id, app_id, redirect_uri, state, code_challenge, scopes, resource, e164, person_id, step, handoff, created_at, expires_at)
      values (${q.id}, ${q.browserHash}, ${q.clientId}, ${q.app}, ${q.redirectUri}, ${q.state}, ${q.codeChallenge}, ${this.sql.array(q.scopes, "TEXT")}, ${q.resource}, ${q.e164}, ${q.personId}, ${q.step}, ${q.handoff ?? null}::jsonb, ${ts(q.createdAt)}, ${ts(q.expiresAt)})`;
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
  async advanceAuthRequest(previous: AuthRequest, next: AuthRequestPage, now: () => number) {
    return this.sql.begin(async tx => {
      const [pending] = await tx`select * from oauth.auth_requests where id=${previous.id} for update`;
      if (!pending || !samePendingAuthPage(request(pending), previous, now())) return false;
      await tx`update oauth.auth_requests set e164=${next.e164}, person_id=${next.personId}, step=${next.step}, handoff=${next.handoff ?? null}::jsonb where id=${previous.id}`;
      return true;
    });
  }
  async commitConsentGrant(id: string, at: number, confirm: (approval: AuthRequest) => Promise<boolean>, writes: ConsentGrantWrites) {
    return this.sql.begin(async tx => {
      const [pending] = await tx`select * from oauth.auth_requests
        where id = ${id} and step in ('consent', 'enrolled') and e164 is not null and expires_at > ${ts(at)} for update`;
      if (!pending || !await confirm(request(pending))) return false;

      await tx`delete from oauth.auth_requests where id = ${id}`;
      await insertGrant(tx, writes.grant);
      await insertCode(tx, writes.code);
      for (const row of writes.audit) await insertAudit(tx, row);
      return true;
    });
  }
  async deleteAuthRequest(id: string) { await this.sql`delete from oauth.auth_requests where id = ${id}`; }

  async putGrant(g: Grant) { await insertGrant(this.sql, g); }
  async getGrant(id: string) {
    const [r] = await this.sql`select * from oauth.grants where id = ${id}`;
    return r ? grant(r) : undefined;
  }
  async grantsFor(phoneKey: string, app: McpAppId, at: number) {
    return (await this.sql`select * from oauth.grants where phone_key = ${phoneKey} and app_id = ${app} and revoked_at is null and expires_at > ${ts(at)} order by created_at`).map(grant);
  }
  assistantGrants(personId: string, at: number, app?: McpAppId) {
    return this.readAssistantGrants(this.sql, personId, at, app);
  }
  /** Keep the matching approvals and their client surfaces stable through the provider claim. */
  async assistantGrantsForClaim(tx: SQL, personId: string, phoneKey: string, app: McpAppId, at: number): Promise<AssistantGrantCandidate[]> {
    const rows = await tx<{ approval: Row; client: Row }[]>`select to_jsonb(g) as approval, to_jsonb(c) as client
      from oauth.grants g join oauth.clients c on c.id=g.client_id
      where g.person_id=${personId} and g.phone_key=${phoneKey} and g.app_id=${app}
        and g.revoked_at is null and g.expires_at>${ts(at)} and 'membership:read'=any(g.scopes)
      order by g.id for share of g,c`;
    return rows.map(row => ({ grant: grant(row.approval), client: client(row.client) }));
  }
  private async readAssistantGrants(sql: SQL, personId: string, at: number, app?: McpAppId): Promise<AssistantGrantCandidate[]> {
    const rows = await sql<{ approval: Row; client: Row }[]>`select to_jsonb(g) as approval, to_jsonb(c) as client
      from oauth.grants g join oauth.clients c on c.id=g.client_id
      where g.person_id=${personId} and g.revoked_at is null and g.expires_at>${ts(at)}
        and (${app ?? null}::text is null or g.app_id=${app ?? null})`;
    return rows.map(row => ({ grant: grant(row.approval), client: client(row.client) }));
  }
  async projectAssistantGrants(personId: string, now: () => number, publish: (candidates: AssistantGrantCandidate[]) => Promise<void>) {
    await this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`oauth:assistant-projection:${personId}`}, 0))`;
      // The signal write may use the notify connection. Keep later projections behind this lock until it finishes.
      await publish(await this.readAssistantGrants(tx, personId, now()));
    });
  }
  async revokeGrant(id: string, at: number, owner?: BrowserGrantRemoval) {
    try {
      return await this.sql.begin(async tx => {
        if (owner) {
          const [selected] = await tx`select revoked_at,expires_at from oauth.grants where id=${id}
            and app_id=${owner.app} and phone_key=${owner.phoneKey} and person_id is not distinct from ${owner.personId}
            for update`;
          if (!selected || (this.checkBrowserOwner && !await this.checkBrowserOwner(tx, owner))) return false;
          at = owner.now();
          const ownedLive = selected.revoked_at === null && ms(selected.expires_at)! > at;
          if (!removalFormMayRevoke(ownedLive, true, at, owner.confirmationEndsAt)) return false;
        }
        const rows = await tx`update oauth.grants set revoked_at = ${ts(at)} where id = ${id} and revoked_at is null returning id`;
        await tx`update oauth.tokens set revoked_at = ${ts(at)} where grant_id = ${id} and revoked_at is null`;
        await tx`delete from oauth.profile_submissions where grant_id=${id}`;
        return rows.length > 0;
      });
    } catch (error) {
      if (owner && (error as { code?: string })?.code === "55P03") return false;
      throw error;
    }
  }

  async putCode(c: AuthCode) { await insertCode(this.sql, c); }
  async getCode(hash: string) {
    const rows=await this.sql`select * from oauth.codes where hash=${hash}`;
    return rows[0]?code(rows[0]):undefined;
  }
  async commitCodeExchange(exchange: CodeExchange) {
    try {
      return await this.sql.begin(async tx => {
        // Grant first, in the same order as refresh and revocation.
        const [grantRow] = await tx`select * from oauth.grants where id=${exchange.grant.id} for update`;
        const [codeRow] = await tx`select * from oauth.codes where hash=${exchange.code.hash} for update`;
        const approval = grantRow ? grant(grantRow) : undefined;
        const credential = codeRow ? code(codeRow) : undefined;
        const at = exchange.now();
        const result = checkCodeExchange(exchange, credential, approval, at);
        if (result !== "CodePairCommitted") return result;
        await tx`update oauth.codes set used_at=${ts(at)} where hash=${exchange.code.hash}`;
        for (const token of exchange.tokens) await insertToken(tx, token);
        await insertAudit(tx, { ...exchange.audit, at });
        if (checkCodeExchange(exchange, credential, approval, exchange.now()) !== "CodePairCommitted") throw expiredCodeExchange;
        return result;
      });
    } catch (error) {
      if (error === expiredCodeExchange) return "CodeNotCommitted" as const;
      throw error;
    }
  }

  async putToken(t: Token) {
    await insertToken(this.sql, t);
  }
  async getToken(hash: string) {
    const [r] = await this.sql`select * from oauth.tokens where hash = ${hash}`;
    return r ? token(r) : undefined;
  }
  async revokeToken(hash: string, at: number) {
    await this.sql`update oauth.tokens set revoked_at = ${ts(at)} where hash = ${hash} and revoked_at is null`;
  }
  async rotateRefresh(rotation: RefreshRotation) {
    try {
      return await this.sql.begin(async tx => {
        const [grantRow] = await tx`select * from oauth.grants where id=${rotation.grant.id} for update`;
        const [refreshRow] = await tx`select * from oauth.tokens where hash=${rotation.refresh.hash} for update`;
        const approval = grantRow ? grant(grantRow) : undefined;
        const credential = refreshRow ? token(refreshRow) : undefined;
        const at = rotation.now();
        const result = checkRefreshRotation(rotation, credential, approval, at);
        if (result !== "RefreshPairCommitted") return result;
        await tx`update oauth.tokens set rotated_at=${ts(at)} where hash=${rotation.refresh.hash}`;
        for (const next of rotation.tokens) await insertToken(tx, next);
        await insertAudit(tx, { ...rotation.audit, at });
        if (checkRefreshRotation(rotation, credential, approval, rotation.now()) !== "RefreshPairCommitted") throw expiredRefreshRotation;
        return result;
      });
    } catch (error) {
      if (error === expiredRefreshRotation) return "RefreshNotCommitted" as const;
      throw error;
    }
  }

  async audit(a: AuditRow) { await insertAudit(this.sql, a); }
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
    await this.sql`delete from oauth.signup_drafts where expires_at <= ${t}`;
    await this.sql`delete from oauth.profile_submissions s using oauth.grants g where s.grant_id=g.id and (g.revoked_at is not null or g.expires_at<=${t})`;
    await this.sql`delete from oauth.auth_requests where expires_at <= ${t}`;
    await this.sql`delete from oauth.codes where expires_at <= ${t}`;
    await this.sql`delete from oauth.tokens where expires_at <= ${t}`;
    await this.sql`delete from oauth.rate_limits where window_start + make_interval(secs => window_ms / 1000.0) <= ${t}`;
    // Codes and tokens of a deleted grant go with it (on delete cascade).
    await this.sql`delete from oauth.grants where least(coalesce(revoked_at, expires_at), expires_at) <= ${ts(at - GRANT_KEEP_MS)}`;
    await this.sql`delete from oauth.clients c where c.created_at <= ${ts(at - CLIENT_UNUSED_MS)} and not exists (select 1 from oauth.grants g where g.client_id = c.id)`;
  }

  async forgetPhone(phoneKey: string, e164: string, app?: McpAppId) {
    return this.sql.begin(async tx => {
      // Wait for a locked approval before scanning grants, including any grant it just committed.
      if (app) await tx`delete from oauth.auth_requests where e164 = ${e164} and app_id = ${app}`;
      else await tx`delete from oauth.auth_requests where e164 = ${e164}`;
      const rows = app
        ? await tx`delete from oauth.grants where phone_key = ${phoneKey} and app_id = ${app} returning id`
        : await tx`delete from oauth.grants where phone_key = ${phoneKey} returning id`;
      return rows.length;
    });
  }

  async forgetPerson(personId: string, app?: McpAppId) {
    return this.sql.begin(async tx => {
      // Wait for any locked approval of this person before deleting the grants it might issue.
      if (app) await tx`delete from oauth.auth_requests where person_id = ${personId} and app_id = ${app}`;
      else await tx`delete from oauth.auth_requests where person_id = ${personId}`;
      await tx`delete from oauth.signup_drafts d using oauth.grants g where g.person_id = ${personId} and d.phone_key = g.phone_key
        and (${app ?? null}::text is null or d.app_id = ${app ?? null})`;
      const rows = app
        ? await tx`delete from oauth.grants where person_id = ${personId} and app_id = ${app} returning *`
        : await tx`delete from oauth.grants where person_id = ${personId} returning *`;
      return rows.map(grant);
    });
  }
}
