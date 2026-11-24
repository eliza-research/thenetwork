// OAuth on Postgres: a unique database on the dev cluster or an explicitly owned
// loopback fixture, dropped afterwards. The refresh regression uses real HTTP.
import { fetchWithHost } from "../../core/src/runtime/fetch.ts";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { randomUUID } from "node:crypto";
import { APPS, createPublicApi, PgPeopleStore } from "@thenetwork/platform";
import { migrate } from "../../db/migrate.ts";
import { DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { pgAvailable } from "../../../apps/observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import type { AuthRequest, ConsentGrantWrites } from "../src/store.ts";
import { createMcpHandler } from "../src/handler.ts";
import { platformHooks } from "../src/hooks.ts";
import { sha256hex } from "../src/util.ts";
import { addMember, browserFlow, call, CHALLENGE, connect, origin, PHONE_A, register, setup, tokenRequest, VERIFIER } from "./harness.ts";

const USER = process.env.USER ?? "postgres";
// An admitted Linux fixture may provide its already-running, isolated loopback PG.
// Never start/reset that cluster or accept a remote/service database here.
const EXPLICIT_PG = process.env.MCP_TEST_PG_URL;
const ADMIN_URL = EXPLICIT_PG ?? `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const parsedAdmin = new URL(ADMIN_URL);
if (!["postgres:", "postgresql:"].includes(parsedAdmin.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsedAdmin.hostname) || parsedAdmin.pathname !== "/postgres") throw new Error("MCP_TEST_PG_URL must name an owned loopback postgres admin database");
if (process.env.REQUIRE_PG === "1" && !EXPLICIT_PG && !pgAvailable) throw new Error("OAuth integration requires PostgreSQL");
const DB = `mcp_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${DB}`;
const admin = async (q: string) => {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
};

describe.skipIf(!EXPLICIT_PG && !pgAvailable)("PgOAuthStore", () => {
  let store: PgOAuthStore;
  beforeAll(async () => {
    if (!EXPLICIT_PG) await devPgUp();
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(testUrl.toString());
    await store.migrate();
    await store.migrate(); // repeatable
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("client approval is consumed once across connections and refuses unverified or expired requests", async () => {
    const env = setup({ store });
    const client = await register(env, "peon.biz");
    const at = env.clock.t;
    const pending: AuthRequest = {
      id: `approval_${randomUUID()}`, browserHash: sha256hex("browser-cookie"),
      clientId: client.body.client_id, app: "peon", redirectUri: "https://client.example/callback",
      state: "state", codeChallenge: sha256hex("challenge"), scopes: ["membership:read"],
      resource: "https://peon.biz/mcp", e164: PHONE_A, personId: null,
      step: "consent", createdAt: at, expiresAt: at + 60_000,
    };
    const grantId = `grant_${randomUUID()}`;
    const { clientId, app, scopes, resource } = pending;
    const audit = { at, clientId, grantId, app, detail: null };
    const writes: ConsentGrantWrites = {
      grant: { id: grantId, clientId, app, phoneKey: env.accounts.phoneHash(PHONE_A), personId: null, scopes, resource, createdAt: at, expiresAt: at + 60_000, revokedAt: null },
      code: { hash: sha256hex(grantId), grantId, clientId, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, resource, scopes, createdAt: at, expiresAt: at + 60_000, usedAt: null },
      audit: [{ ...audit, kind: "consent_granted" }, { ...audit, kind: "code_issued" }],
    };
    const other = new PgOAuthStore(testUrl.toString());
    try {
      await store.putAuthRequest(pending);
      const results = await Promise.all([store, other].map(s => s.commitConsentGrant(pending.id, at, async request => {
        expect(request).toEqual(pending);
        return true;
      }, writes)));
      expect(results.sort()).toEqual([false, true]);
      expect(await store.getAuthRequest(pending.id)).toBeUndefined();
      for (const patch of [{ step: "code" as const }, { e164: null }, { expiresAt: at }]) {
        const refused = { ...pending, ...patch, id: `approval_${randomUUID()}` };
        await store.putAuthRequest(refused);
        expect(await other.commitConsentGrant(refused.id, at, async () => true, writes)).toBe(false);
        expect(await store.getAuthRequest(refused.id)).toEqual(refused);
      }

      // spec/connectedAssistants.md, "A confirmed removal shows its result"
      // The browser clock can reach the deadline while the revocation waits for the row lock.
      const owner = {
        app, phoneKey: writes.grant.phoneKey, personId: null, e164: PHONE_A, sessionHash: "fixture-session",
        confirmationEndsAt: at + 1_000, now: () => env.clock.t,
      };
      let unlock!: () => void;
      const releaseGrant = new Promise<void>(resolve => { unlock = resolve; });
      let grantLocked!: () => void;
      const locked = new Promise<void>(resolve => { grantLocked = resolve; });
      const lock = other.sql.begin(async tx => {
        await tx`select id from oauth.grants where id=${grantId} for update`;
        grantLocked();
        await releaseGrant;
      });
      await locked;
      const staleRemoval = store.revokeGrant(grantId, at, owner);
      env.clock.t = owner.confirmationEndsAt;
      unlock();
      await lock;
      expect(await staleRemoval).toBe(false);
      expect(await store.getGrant(grantId)).toMatchObject({ revokedAt: null });
      env.clock.t = at;

      // Hold an approved request lock while app erasure starts on a separate connection.
      const second = { ...pending, id: `approval_${randomUUID()}` };
      const secondId = `grant_${randomUUID()}`;
      await store.putAuthRequest(second);
      let markAcquired!: () => void, releaseLock!: () => void;
      const acquired = new Promise<void>(resolve => { markAcquired = resolve; });
      const released = new Promise<void>(resolve => { releaseLock = resolve; });
      const issuing = store.commitConsentGrant(second.id, at, async () => {
        markAcquired();
        await released;
        return true;
      }, {
        grant: { ...writes.grant, id: secondId },
        code: { ...writes.code, grantId: secondId, hash: sha256hex(secondId) },
        audit: [{ ...writes.audit[0], grantId: secondId }, { ...writes.audit[1], grantId: secondId }],
      });
      await Promise.race([acquired, issuing]);
      const erasing = other.forgetPhone(writes.grant.phoneKey, PHONE_A, app);
      try {
        await vi.waitFor(async () => {
          const [row] = await store.sql<{ blocked: boolean }[]>`select exists (
            select 1 from pg_stat_activity where datname = current_database()
              and wait_event_type = 'Lock' and query like 'delete from oauth.auth_requests where e164%'
          ) as blocked`;
          expect(row?.blocked).toBe(true);
        });
      } finally {
        releaseLock();
        await Promise.all([issuing, erasing]);
      }
      expect(await issuing).toBe(true);
      expect(await erasing).toBe(2);
      expect(await store.getAuthRequest(second.id)).toBeUndefined();
      expect(await store.getGrant(secondId)).toBeUndefined();
      expect(await store.getCode(sha256hex(secondId))).toBeUndefined();
    } finally { await other.close(); }
  });

  // spec/oauthGrantIssuance.md, "A successful response follows one atomic commit"
  test("consent issuance over HTTP rolls back when the final audit fails", async () => {
    const env = setup({ store });
    const domain = "peon.biz";
    const personId = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const session = await env.sessions.create("peon", PHONE_A, personId);
    const server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: env.handler.fetch });
    env.fetch = async req => {
      const original = new URL(req.url);
      const headers = new Headers(req.headers);
      headers.set("host", original.host);
      return fetchWithHost(new URL(original.pathname + original.search, server.url), {
        method: req.method, headers, redirect: "manual",
        ...(req.method === "GET" ? {} : { body: await req.arrayBuffer() }),
      });
    };
    try {
      const client = await register(env, domain);
      const redirectUri = "https://client.example/callback";
      const query = new URLSearchParams({
        response_type: "code", client_id: client.body.client_id, redirect_uri: redirectUri,
        code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "membership:read",
      });
      const start = await env.fetch(new Request(`${origin(domain)}/oauth/authorize?${query}`, { headers: { cookie: `sid_peon=${session.token}` } }));
      const rid = /name="rid" value="([^"]+)"/.exec(await start.text())?.[1];
      const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1];
      const pending = rid && await store.getAuthRequest(rid);
      const approve = () => env.fetch(new Request(`${origin(domain)}/oauth/authorize/consent`, {
        method: "POST", headers: {
          cookie: `${browser}; sid_peon=${session.token}`, origin: origin(domain), "content-type": "application/x-www-form-urlencoded",
        }, body: new URLSearchParams({ rid: rid ?? "", decision: "approve" }),
      }));
      const grants = () => store.sql`select id from oauth.grants where client_id = ${client.body.client_id}`;
      const codes = () => store.sql`select hash from oauth.codes where client_id = ${client.body.client_id}`;
      const audit = () => store.sql`select kind from oauth.audit where client_id = ${client.body.client_id} order by id`;
      expect(pending).toMatchObject({ step: "consent", personId });
      await store.sql`alter table oauth.audit add constraint fixture_issuance_audit
        check (kind <> 'code_issued') not valid`;
      try {
        const failed = await approve();
        expect(failed.headers.has("location")).toBe(false);
        expect(await store.getAuthRequest(rid!)).toEqual(pending);
        expect(await grants()).toEqual([]);
        expect(await codes()).toEqual([]);
        expect(await audit()).toEqual([{ kind: "client_registered" }]);
        expect(failed.status).toBe(503);
      } finally {
        await store.sql`alter table oauth.audit drop constraint fixture_issuance_audit`;
      }
      const retries = await Promise.all([approve(), approve()]);
      expect(retries.map(response => response.status).sort()).toEqual([303, 400]);
      expect(await store.getAuthRequest(rid!)).toBeUndefined();
      expect(await grants()).toHaveLength(1);
      expect(await codes()).toHaveLength(1);
      expect(await audit()).toEqual([{ kind: "client_registered" }, { kind: "consent_granted" }, { kind: "code_issued" }]);
      const code = new URL(retries.find(response => response.status === 303)!.headers.get("location")!).searchParams.get("code")!;
      const token = await tokenRequest(env, domain, {
        grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: redirectUri, code_verifier: VERIFIER,
      });
      expect(token.res.status).toBe(200);
    } finally { await server.stop(true); }
  });

  test("authenticated pre-Join draft persists for retries, discards once and rejects wrong app/phone and revoked grants", async () => {
    const env = setup({ store });
    const c = await connect(env, "friends.help", PHONE_A);
    const prepared = await call(env, "https://friends.help/mcp", "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token: c.token.access_token });
    expect(prepared.body!.result.structuredContent.prepared).toBe(true);
    expect(await env.accounts.personFor(PHONE_A)).toBeUndefined();
    expect((await store.sql`select jsonb_typeof(fields) as kind from oauth.signup_drafts where phone_key=${env.accounts.phoneHash(PHONE_A)}`)[0].kind).toBe("object");
    const session=await env.sessions.create("friends",PHONE_A,null);
    const response=await env.fetch(new Request("https://friends.help/oauth/signup-draft",{method:"POST",headers:{cookie:`sid_friends=${session.token}`,origin:"https://friends.help","content-type":"application/json"},body:"{}"}));
    expect(await response.json()).toMatchObject({draft:{firstName:"Ari",homeCity:"sf"},signupView:expect.any(String)});
    const restarted = new PgOAuthStore(testUrl.toString());
    try {
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash("+12125550199"), "friends", null, () => env.clock.t)).toBeUndefined();
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "ntwrk", null, () => env.clock.t)).toBeUndefined();
      const pair = await Promise.all([store, restarted].map(s => s.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, () => env.clock.t)));
      expect(pair).toEqual([{ firstName: "Ari", homeCity: "sf" }, { firstName: "Ari", homeCity: "sf" }]);
      await store.discardSignupDrafts(env.accounts.phoneHash(PHONE_A), "friends", env.clock.t);
      const grants = await store.grantsFor(env.accounts.phoneHash(PHONE_A), "friends", env.clock.t);
      expect(await store.putSignupDraft({ grantId: grants[0].id, app: "friends", phoneKey: grants[0].phoneKey, fields: { firstName: "Replay" }, expiresAt: env.clock.t + 60_000, consumedAt: null }, env.clock.t)).toBe(false);
      const rows = await store.sql`select fields,consumed_at from oauth.signup_drafts where grant_id=${grants[0].id}`;
      expect(rows[0].fields).toEqual({}); expect(rows[0].consumed_at).not.toBeNull();
      const next = await connect(env, "friends.help", PHONE_A);
      await call(env, "https://friends.help/mcp", "prepare_signup", { firstName: "Rae" }, { token: next.token.access_token });
      const all = await store.grantsFor(env.accounts.phoneHash(PHONE_A), "friends", env.clock.t);
      const pending = all.find((g: import("../src/store.ts").Grant) => g.clientId === next.client.client_id)!;
      await store.revokeGrant(pending.id, env.clock.t);
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, () => env.clock.t)).toBeUndefined();
      expect((await store.sql`select fields from oauth.signup_drafts where grant_id=${pending.id}`)[0].fields).toEqual({});
      const fresh = await connect(env, "friends.help", PHONE_A);
      await call(env, "https://friends.help/mcp", "prepare_signup", { firstName: "Tess" }, { token: fresh.token.access_token });
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, () => env.clock.t)).toEqual({ firstName: "Tess" });
    } finally { await restarted.close(); }
  });

  test("canonical phone age scrubs drafts immediately and serializes both write orders across PG store instances", async () => {
    await migrate(testUrl.toString(), { lockTimeout: "5s" });
    const people = new PgPeopleStore(testUrl.toString()), writer = new PgPeopleStore(testUrl.toString());
    const e = setup({ store });
    const api = (p: PgPeopleStore) => createPublicApi({ store:p, otp:e.provider, hashKey:"test-hash-key", sessionSecret:"test-session-secret", now:()=>e.clock.t, env:{PLATFORM_ENV:"dev"}, minStartMs:0, minVerifyMs:0 });
    const web=api(people), other=api(writer);
    const handler = (p: PgPeopleStore, a: ReturnType<typeof api>) => createMcpHandler({ store, now:()=>e.clock.t, minOtpStartMs:0, platform:platformHooks({store:p,accounts:a.accounts,otp:a.otp,sessions:a.sessions,app:id=>APPS[id],cookieName:id=>`sid_${id}`}) });
    const h=handler(people,web); handler(writer,other); // another normal backend, same keyed-phone advisory guard
    const env={...e,fetch:async(req:Request)=>(await h.fetch(req))!};
    const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
    const blocked=async()=>{
      for(let i=0;i<100;i++) {
        const rows=await people.sql`select 1 from pg_locks where database=(select oid from pg_database where datname=current_database()) and locktype='advisory' and not granted`;
        if(rows.length) return;
        await new Promise(r=>setTimeout(r,5));
      }
      throw new Error("Expected a real waiting phone-age advisory lock");
    };
    const put=store.putSignupDraft.bind(store),discard=store.discardSignupDrafts.bind(store);
    const phone="+12125550174", key=web.accounts.phoneHash(phone);
    try {
      const c=await connect(env,"friends.help",phone),entered=deferred(),release=deferred();
      store.putSignupDraft=async(d,at)=>{entered.resolve();await release.promise;return put(d,at);};
      const prepare=call(env,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
      await entered.promise;
      const lower=other.accounts.recordAge(phone,undefined,12);
      try { await blocked(); expect(await people.ageFloor(key)).toBeUndefined(); }
      finally { release.resolve(); }
      expect((await prepare).body!.result.structuredContent.prepared).toBe(true);await lower;
      expect((await store.sql`select fields from oauth.signup_drafts where phone_key=${key}`)[0].fields).toEqual({});
      expect(await web.accounts.personFor(phone)).toBeUndefined();expect(await people.consentEvents(phone,"friends")).toHaveLength(0);
      store.putSignupDraft=put;
      // Older age on another app never raises the canonical floor or permits a new approved draft.
      const n=await connect(env,"ntwrk.party",phone);
      expect((await call(env,"https://ntwrk.party/mcp","prepare_signup",{firstName:"Rae"},{token:n.token.access_token})).body!.result.isError).toBe(true);
      await other.accounts.recordAge(phone,undefined,29);expect(await people.ageFloor(key)).toBe(12);
      const sid=await web.sessions.create("friends",phone,null);
      expect(await(await h.fetch(new Request("https://friends.help/oauth/signup-draft",{method:"POST",headers:{cookie:`sid_friends=${sid.token}`,origin:"https://friends.help"},body:"{}"})))!.json()).toMatchObject({draft:null});
      // Opposite order: lowering holds the shared guard while cleanup waits on real storage I/O.
      const second="+12125550175",next=await connect(env,"friends.help",second),cleaning=deferred(),finish=deferred();
      store.discardSignupDrafts=async(...args)=>{cleaning.resolve();await finish.promise;return discard(...args);};
      const before=other.accounts.recordAge(second,undefined,12);await cleaning.promise;
      const pending=call(env,"https://friends.help/mcp","prepare_signup",{firstName:"Tess"},{token:next.token.access_token});
      try { await blocked(); } finally { finish.resolve(); }
      await before;expect((await pending).body!.result.isError).toBe(true);
      expect((await store.sql`select fields from oauth.signup_drafts where phone_key=${web.accounts.phoneHash(second)}`).length).toBe(0);
    } finally { store.putSignupDraft=put;store.discardSignupDrafts=discard;await people.close();await writer.close(); }
  },120_000);

  test("full flow, refresh rotation and replay, with hashes only at rest", async () => {
    const env = setup({ store });
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, "peon.biz", PHONE_A);
    expect(c.tokenRes.status).toBe(200);
    const url = `${origin("peon.biz")}/mcp`;
    expect((await call(env, url, "check_status", {}, { token: c.token.access_token })).body!.result.structuredContent.status).toBe("active");
    const r1 = await tokenRequest(env, "peon.biz", { grant_type: "refresh_token", refresh_token: c.token.refresh_token, client_id: c.client.client_id });
    expect(r1.res.status).toBe(200);
    expect((await tokenRequest(env, "peon.biz", { grant_type: "refresh_token", refresh_token: c.token.refresh_token, client_id: c.client.client_id })).body.error).toBe("invalid_grant");
    expect((await call(env, url, "check_status", {}, { token: r1.body.access_token })).res.status).toBe(401);
    const dump = JSON.stringify(await store.sql`select * from oauth.tokens`) + JSON.stringify(await store.sql`select * from oauth.codes`) + JSON.stringify(await store.sql`select * from oauth.audit`);
    for (const secret of [c.token.access_token, c.token.refresh_token, r1.body.access_token, c.code]) expect(dump).not.toContain(secret);
    expect(dump).not.toContain("5550142");
    expect((await store.auditRows()).map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(["client_registered", "consent_granted", "token_issued", "token_refreshed", "refresh_replay"]));
  });

  test("an authorization code cannot issue tokens after its grant is revoked in flight", async () => {
    const env = setup({ store });
    const domain = "peon.biz";
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const client = await register(env, domain);
    const flow = await browserFlow(env, domain, client.body.client_id, PHONE_A);
    const exchangeCode = new URL(flow.location!).searchParams.get("code")!;
    const pending = await store.getCode(sha256hex(exchangeCode));
    if (!pending) throw new Error("missing authorization code");
    const getGrant = store.getGrant.bind(store);
    let revokedInFlight = false;
    store.getGrant = async id => {
      const observed = await getGrant(id);
      if (!revokedInFlight && id === pending.grantId) revokedInFlight = await store.revokeGrant(id, env.clock.t);
      return observed;
    };
    try {
      const exchanged = await tokenRequest(env, domain, { grant_type: "authorization_code", code: exchangeCode,
        redirect_uri: "https://client.example/callback", client_id: client.body.client_id, code_verifier: VERIFIER });
      expect(revokedInFlight).toBe(true);
      expect(exchanged.res.status).toBe(400);
      expect(exchanged.body).toEqual({error: "invalid_grant"});
    } finally {
      store.getGrant = getGrant;
    }
    expect(await store.getCode(pending.hash)).toMatchObject({usedAt: null});
    expect(await store.sql`select 1 from oauth.tokens where grant_id=${pending.grantId}`).toHaveLength(0);
    expect(await store.sql`select 1 from oauth.audit where grant_id=${pending.grantId} and kind='token_issued'`).toHaveLength(0);
  });

  test("an issuance audit failure rolls back the code exchange and both tokens", async () => {
    const env = setup({ store });
    const domain = "peon.biz";
    const client = await register(env, domain);
    const flow = await browserFlow(env, domain, client.body.client_id, PHONE_A);
    const exchangeCode = new URL(flow.location!).searchParams.get("code")!;
    const pending = (await store.getCode(sha256hex(exchangeCode)))!;
    const exchange = () => tokenRequest(env, domain, { grant_type: "authorization_code", code: exchangeCode,
      redirect_uri: "https://client.example/callback", client_id: client.body.client_id, code_verifier: VERIFIER });
    await store.sql.unsafe(`create function oauth.test_code_audit_fault() returns trigger language plpgsql as $$
      begin
        if NEW.kind = 'token_issued' then raise exception 'synthetic code issuance audit failure'; end if;
        return NEW;
      end $$;
      create trigger test_code_audit_fault before insert on oauth.audit for each row execute function oauth.test_code_audit_fault();`);
    try {
      expect((await exchange()).res.status).toBe(500);
      expect(await store.getCode(pending.hash)).toMatchObject({usedAt: null});
      expect(await store.sql`select 1 from oauth.tokens where grant_id=${pending.grantId}`).toHaveLength(0);
      expect(await store.sql`select 1 from oauth.audit where grant_id=${pending.grantId} and kind='token_issued'`).toHaveLength(0);
    } finally {
      await store.sql.unsafe("drop trigger test_code_audit_fault on oauth.audit; drop function oauth.test_code_audit_fault()");
    }
    expect((await exchange()).res.status).toBe(200);
    expect(await store.sql`select 1 from oauth.tokens where grant_id=${pending.grantId}`).toHaveLength(2);
  });

  test("an expired refresh credential leaves its still-live grant unchanged", async () => {
    const env = setup({ store });
    const domain = "peon.biz";
    const c = await connect(env, domain, PHONE_A);
    const refresh = await store.getToken(sha256hex(c.token.refresh_token));
    if (!refresh) throw new Error("missing authorized refresh token");
    const grant = await store.getGrant(refresh.grantId);
    if (!grant) throw new Error("missing refresh grant");
    const deadline = env.clock.t + 1000;
    expect(grant.expiresAt).toBeGreaterThan(deadline);
    const expired = { ...refresh, hash: sha256hex("expired refresh fixture"), expiresAt: deadline };
    await store.putToken(expired);
    const result = await store.rotateRefresh({
      refresh: expired, grant, now: () => deadline,
      tokens: [
        { ...refresh, hash: sha256hex("replacement access fixture"), kind: "access" },
        { ...refresh, hash: sha256hex("replacement refresh fixture") },
      ],
      audit: { kind: "token_refreshed", clientId: grant.clientId, grantId: grant.id, app: grant.app, detail: null },
    });
    expect(result).toBe("RefreshNotCommitted");
    expect(await store.getToken(expired.hash)).toMatchObject({ rotatedAt: null, revokedAt: null });
    expect(await store.getGrant(grant.id)).toEqual(grant);
    expect(await store.sql`select 1 from oauth.tokens where grant_id=${grant.id}`).toHaveLength(3);
    expect(await store.sql`select 1 from oauth.audit where grant_id=${grant.id} and kind in ('token_refreshed','refresh_replay')`).toHaveLength(0);
  });

  test("a person ban ends issued access and refresh tokens and unused authorization codes; another person keeps access", async () => {
    await migrate(testUrl.toString(), { lockTimeout: "5s" });
    const people = new PgPeopleStore(testUrl.toString()), harness = setup({ store });
    const web = createPublicApi({ store: people, otp: harness.provider, hashKey: "test-hash-key", sessionSecret: "test-session-secret",
      now: () => harness.clock.t, env: { PLATFORM_ENV: "dev" }, minStartMs: 0, minVerifyMs: 0 });
    const oauth = createMcpHandler({ store, now: () => harness.clock.t, minOtpStartMs: 0,
      platform: platformHooks({ store: people, accounts: web.accounts, otp: web.otp, sessions: web.sessions, app: id => APPS[id], cookieName: id => `sid_${id}` }) });
    const env = { ...harness, fetch: async (req: Request) => (await oauth.fetch(req))! };
    const phone = "+12125550183", otherPhone = "+12125550184";
    try {
      const person = await web.accounts.createPerson(phone, "otp_sms", 32);
      const issued = await connect(env, "friends.help", phone);
      const other = await connect(env, "friends.help", otherPhone);
      const client = await register(env, "peon.biz");
      const approval = await browserFlow(env, "peon.biz", client.body.client_id, phone);
      const code = new URL(approval.location!).searchParams.get("code")!;
      expect(issued.tokenRes.status).toBe(200);
      expect((await call(env, "https://friends.help/mcp", "check_status", {}, { token: issued.token.access_token })).res.status).toBe(200);
      await people.ban({ id: randomUUID(), scope: "person", personId: person.id, phoneHash: null,
        reason: "staff safety decision", reportId: null, bannedBy: "safety", at: env.clock.t });
      // spec/oauthTokenLifecycle.md, "The request needs current grant authority and must stay within its consent"
      expect((await call(env, "https://friends.help/mcp", "check_status", {}, { token: issued.token.access_token })).res.status).toBe(401);
      const refresh = await tokenRequest(env, "friends.help", { grant_type: "refresh_token",
        refresh_token: issued.token.refresh_token, client_id: issued.client.client_id });
      expect(refresh.body.error).toBe("invalid_grant");
      const exchange = await tokenRequest(env, "peon.biz", { grant_type: "authorization_code",
        code, code_verifier: VERIFIER, client_id: client.body.client_id, redirect_uri: "https://client.example/callback" });
      expect(exchange.body.error).toBe("invalid_grant");
      expect((await call(env, "https://friends.help/mcp", "check_status", {}, { token: other.token.access_token })).res.status).toBe(200);
    } finally { await people.close(); }
  }, 120_000);

  // spec/connectorTools.md, "Check status shows only the person's own status in this one app"
  test("connector status and profile admission honor a committed STOP before membership projection", async () => {
    await migrate(testUrl.toString(), { lockTimeout: "5s" });
    const people = new PgPeopleStore(testUrl.toString()), harness = setup({ store });
    const now = () => harness.clock.t;
    const web = createPublicApi({ store: people, otp: harness.provider, hashKey: "test-hash-key", sessionSecret: "test-session-secret",
      now, env: { PLATFORM_ENV: "dev" }, minStartMs: 0, minVerifyMs: 0 });
    const submitted: string[] = [];
    const oauth = createMcpHandler({ store, now, minOtpStartMs: 0, log: () => {}, platform: platformHooks({
      store: people, accounts: web.accounts, otp: web.otp, sessions: web.sessions, app: id => APPS[id], cookieName: id => `sid_${id}`,
      async submitProfile(_personId, app) { submitted.push(app); return "accepted"; },
    }) });
    const peer = { requestIP: () => ({ address: "192.0.2.191" }) };
    const env = { ...harness, fetch: async (req: Request) => (await oauth.fetch(req, peer))! };
    const phone = "+12125550191";
    try {
      const person = await web.accounts.createPerson(phone, "otp_sms", 32);
      await people.putMembership({ app: "friends", personId: person.id, memberId: `friends_${person.id}`, state: "onboarding",
        review: null, firstName: "Rae", profile: {}, joinedAt: now(), leftAt: null });
      await people.putMembership({ app: "peon", personId: person.id, memberId: `peon_${person.id}`, state: "active",
        review: null, firstName: "Rae", profile: {}, joinedAt: now(), leftAt: null });
      const scope = "membership:read profile:write";
      const friends = await connect(env, "friends.help", phone, { scope });
      harness.clock.t += 60_000;
      const peon = await connect(env, "peon.biz", phone, { scope });
      expect([friends.tokenRes.status, peon.tokenRes.status]).toEqual([200, 200]);
      const friendsTool = (tool: "check_status" | "submit_profile", args = {}) =>
        call(env, "https://friends.help/mcp", tool, args, { token: friends.token.access_token });
      const peonTool = (tool: "check_status" | "submit_profile", args = {}) =>
        call(env, "https://peon.biz/mcp", tool, args, { token: peon.token.access_token });
      expect((await friendsTool("check_status")).body?.result.structuredContent).toMatchObject({ app: "friends", status: "onboarding" });
      expect((await peonTool("check_status")).body?.result.structuredContent).toMatchObject({ app: "peon", status: "active" });

      // Exercise the exact carrier ledger commit before any app membership projection finishes.
      await web.accounts.stop(APPS.friends, { e164: phone, personId: person.id }, "keyword:stop");
      expect((await people.getMembership(person.id, "friends"))?.state).toBe("onboarding");
      expect((await people.getMembership(person.id, "peon"))?.state).toBe("active");
      expect((await friendsTool("check_status")).body?.result.structuredContent)
        .toMatchObject({ app: "friends", status: "stopped", next_step: expect.stringContaining("text START") });
      const profile = { about: "I would like a hiking group." };
      expect((await friendsTool("submit_profile", profile)).body?.result.structuredContent)
        .toMatchObject({ app: "friends", submitted: false, status: "stopped" });
      expect((await peonTool("submit_profile", profile)).body?.result.structuredContent)
        .toMatchObject({ app: "peon", submitted: false, status: "stopped" });
      expect(submitted).toEqual([]);

      harness.clock.t += 1000;
      await web.accounts.recordConsent({ e164: phone, app: "peon", state: "opted_in", source: "keyword:start", at: now() });
      expect((await peonTool("check_status")).body?.result.structuredContent).toMatchObject({ app: "peon", status: "active" });
      expect((await peonTool("submit_profile", profile)).body?.result.structuredContent).toMatchObject({ app: "peon", submitted: true });
      expect((await friendsTool("check_status")).body?.result.structuredContent).toMatchObject({ app: "friends", status: "stopped" });
      expect(submitted).toEqual(["peon"]);

      const originalClaim = store.claimProfileSubmission.bind(store);
      const claim = vi.spyOn(store, "claimProfileSubmission").mockImplementationOnce(async (...args) => {
        const result = await originalClaim(...args);
        expect(result).toBe("ProfileClaimStart");
        harness.clock.t += 1000;
        await web.accounts.stop(APPS.peon, { e164: phone, personId: person.id }, "keyword:stop");
        return result;
      });
      try {
        expect((await peonTool("submit_profile", { about: "I am learning ceramics." })).body?.result.structuredContent)
          .toMatchObject({ app: "peon", submitted: false, status: "stopped" });
        expect(submitted).toEqual(["peon"]);
      } finally { claim.mockRestore(); }
    } finally { await people.close(); }
  }, 120_000);

  test("the first member tool request after phone reassignment ends a limited grant and its refresh token", async () => {
    // spec/connectorTools.md, "A grant that no longer belongs to the phone's person ends the connection"
    await migrate(testUrl.toString(), { lockTimeout: "5s" });
    const people = new PgPeopleStore(testUrl.toString());
    const harness = setup({ store });
    const web = createPublicApi({ store: people, otp: harness.provider, hashKey: "test-hash-key", sessionSecret: "test-session-secret",
      now: () => harness.clock.t, env: { PLATFORM_ENV: "dev" }, minStartMs: 0, minVerifyMs: 0 });
    const platform = platformHooks({ store: people, accounts: web.accounts, otp: web.otp, sessions: web.sessions, app: id => APPS[id], cookieName: id => `sid_${id}` });
    const handler = createMcpHandler({ store, platform, now: () => harness.clock.t, minOtpStartMs: 0 });
    const server = await serveHttp({ hostname: "127.0.0.1", port: 0,
      async fetch(req) { return (await handler.fetch(req)) ?? new Response("not found", { status: 404 }); } });
    const env = { ...harness, fetch: async (req: Request) => {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      headers.set("host", url.host);
      return fetchWithHost(new URL(url.pathname + url.search, server.url), { method: req.method, headers, redirect: "manual",
        ...(req.method === "GET" ? {} : { body: await req.arrayBuffer() }) });
    } };
    const host = "friends.help", phone = "+12125550187";
    try {
      const original = await web.accounts.createPerson(phone, "otp_sms", 36);
      const issued = await connect(env, host, phone, { scope: "apps:read membership:read" });
      expect(issued.tokenRes.status).toBe(200);
      const oldAccess = await store.getToken(sha256hex(issued.token.access_token));
      if (!oldAccess) throw new Error("missing issued access token");
      const callOld = (tool: "prepare_signup" | "check_status", args: Record<string, unknown>) =>
        call(env, `https://${host}/mcp`, tool, args, { token: issued.token.access_token });
      expect((await callOld("prepare_signup", { firstName: "Ari" })).res.status).toBe(403);

      await people.setPhoneHold(phone, "recycled_number", env.clock.t);
      expect(await web.accounts.clearHold(phone, "new_owner")).toBe(true);
      const current = await web.accounts.createPerson(phone, "otp_sms", 29);
      expect(current.id).not.toBe(original.id);
      const refused = await callOld("prepare_signup", { firstName: "Ari" });
      expect(refused.res.status).toBe(401);
      expect(refused.res.headers.get("www-authenticate")).toContain('error="invalid_token"');
      expect(await store.getGrant(oldAccess.grantId)).toMatchObject({ revokedAt: env.clock.t });
      const refresh = await tokenRequest(env, host, { grant_type: "refresh_token", refresh_token: issued.token.refresh_token, client_id: issued.client.client_id });
      expect(refresh.body).toMatchObject({ error: "invalid_grant" });
      expect(await store.getToken(sha256hex(issued.token.refresh_token))).toMatchObject({ revokedAt: env.clock.t });

      env.clock.t += 60_000;
      const reconnected = await connect(env, host, phone, { scope: "apps:read membership:read" });
      expect(reconnected.tokenRes.status).toBe(200);
      const currentAccess = await store.getToken(sha256hex(reconnected.token.access_token));
      if (!currentAccess) throw new Error("missing replacement access token");
      const currentStatus = () => call(env, `https://${host}/mcp`, "check_status", {}, { token: reconnected.token.access_token });
      expect((await currentStatus()).res.status).toBe(200);
      await people.setPhoneHold(phone, "recycled_number", env.clock.t);
      expect((await currentStatus()).res.status).toBe(401);
      expect(await store.getGrant(currentAccess.grantId)).toMatchObject({ revokedAt: null });
      expect(await web.accounts.clearHold(phone, "same_owner")).toBe(true);
      expect((await currentStatus()).res.status).toBe(200);
      expect((await call(env, `https://${host}/mcp`, "app_info", { app: "friends" })).res.status).toBe(200);
    } finally {
      await server.stop(true);
      await people.close();
    }
  }, 120_000);

  test("erasure removes OAuth grants and pending approvals for the verified person across phone bindings", async () => {
    // spec/accountPrivacy.md, "The service completes each operation in its own scope"
    const env = setup({ store });
    const previousNumber = "+12125550188", currentNumber = "+12125550189";
    const oldOwner = await addMember(env, currentNumber, [{ app: "friends", state: "active" }, { app: "peon", state: "active" }]);
    const newOwner = await addMember(env, previousNumber, [{ app: "friends", state: "active" }]);
    const oldFriends = await connect(env, "friends.help", currentNumber);
    env.clock.t += 60_000;
    const oldPeon = await connect(env, "peon.biz", currentNumber);
    const newFriends = await connect(env, "friends.help", previousNumber);
    for (const connection of [oldFriends, oldPeon, newFriends]) expect(connection.tokenRes.status).toBe(200);
    const getAccess = (connection: typeof oldFriends) => store.getToken(sha256hex(connection.token.access_token));
    const oldGrant = await store.getGrant((await getAccess(oldFriends))!.grantId);
    const previousGrantId = `older_${randomUUID()}`;
    if (!oldGrant) throw new Error("missing old owner's grant");
    await store.putGrant({ ...oldGrant, id: previousGrantId, phoneKey: env.accounts.phoneHash(previousNumber) });

    const pending: AuthRequest = { id: `pending_${randomUUID()}`, browserHash: sha256hex("browser-cookie"), clientId: oldFriends.client.client_id,
      app: "friends", redirectUri: "https://client.example/callback", state: null, codeChallenge: CHALLENGE,
      scopes: ["membership:read"], resource: "https://friends.help/mcp", step: "consent", e164: currentNumber,
      personId: oldOwner, createdAt: env.clock.t, expiresAt: env.clock.t + 60_000 };
    const newPending = { ...pending, id: `pending_${randomUUID()}`, clientId: newFriends.client.client_id, e164: previousNumber, personId: newOwner };
    await store.putAuthRequest(pending);
    await store.putAuthRequest(newPending);

    expect(await env.handler.forgetPerson(oldOwner, "friends")).toBe(2);
    expect(await store.getGrant(previousGrantId)).toBeUndefined();
    expect(await getAccess(oldFriends)).toBeUndefined();
    expect(await store.getToken(sha256hex(oldFriends.token.refresh_token))).toBeUndefined();
    expect(await store.getAuthRequest(pending.id)).toBeUndefined();
    expect(await store.getAuthRequest(newPending.id)).toEqual(newPending);
    const canCheck = (host: string, connection: typeof oldFriends) => call(env, `https://${host}/mcp`, "check_status", {}, { token: connection.token.access_token });
    expect((await canCheck("friends.help", newFriends)).res.status).toBe(200);
    expect((await canCheck("peon.biz", oldPeon)).res.status).toBe(200);

    expect(await env.handler.forgetPerson(oldOwner)).toBe(1);
    expect(await getAccess(oldPeon)).toBeUndefined();
    expect((await canCheck("friends.help", newFriends)).res.status).toBe(200);
  });

  test("a code commits one token pair under a race; rate windows count and reset", async () => {
    const env = setup({ store });
    const domain = "slop.date";
    const client = await register(env, domain);
    const flow = await browserFlow(env, domain, client.body.client_id, PHONE_A);
    const exchangeCode = new URL(flow.location!).searchParams.get("code")!;
    const pending = (await store.getCode(sha256hex(exchangeCode)))!;
    const exchange = () => tokenRequest(env, domain, { grant_type: "authorization_code", code: exchangeCode,
      redirect_uri: "https://client.example/callback", client_id: client.body.client_id, code_verifier: VERIFIER });
    const responses = await Promise.all(Array.from({length: 4}, exchange));
    expect(responses.map(response => response.res.status).sort()).toEqual([200, 400, 400, 400]);
    expect(await store.sql`select 1 from oauth.tokens where grant_id=${pending.grantId}`).toHaveLength(2);
    expect(await store.sql`select 1 from oauth.tokens where grant_id=${pending.grantId} and revoked_at is null`).toHaveLength(0);
    expect(await store.sql`select 1 from oauth.audit where grant_id=${pending.grantId} and kind='token_issued'`).toHaveLength(1);
    const t0 = 3_600_000 * 1000;
    expect(await store.hit("b", 60_000, t0)).toBe(1);
    expect(await store.hit("b", 60_000, t0 + 1)).toBe(2);
    expect(await store.hit("b", 60_000, t0 + 60_000)).toBe(1);
    await store.sweep(env.clock.t + 365 * 24 * 3_600_000);
    expect((await store.sql`select count(*)::int as n from oauth.tokens`)[0].n).toBe(0);
  });

  for (const fault of ["access", "refresh", "audit"] as const) {
    test(`atomic refresh over HTTP rolls back a failed ${fault} mint after restart`, async () => {
      const env = setup({ store });
      const personId = await addMember(env, PHONE_A, [{ app: "ntwrk", state: "invited" }]);
      const platform = platformHooks({ store: env.people, otp: env.otp, accounts: env.accounts, sessions: env.sessions, app: id => APPS[id], cookieName: id => `sid_${id}` });
      let handler = env.handler;
      let restarted: PgOAuthStore | undefined;
      const server = await serveHttp({ hostname: "127.0.0.1", port: 0, async fetch(req) { return (await handler.fetch(req)) ?? new Response("not found", { status: 404 }); } });
      env.fetch = async req => {
        const original = new URL(req.url);
        const headers = new Headers(req.headers);
        headers.set("host", original.host);
        return fetchWithHost(new URL(original.pathname + original.search, server.url), { method: req.method, headers, redirect: "manual", ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: await req.arrayBuffer() }) });
      };
      try {
        const redirectUri = "https://chatgpt.com/connector_platform/oauth_redirect";
        const resource = "https://ntwrk.party/mcp/openai";
        const c = await connect(env, "ntwrk.party", PHONE_A, { redirectUri, resource, scope: "membership:read profile:write", register: { redirect_uris: [redirectUri] } });
        expect(c.tokenRes.status).toBe(200);
        const oldHash = sha256hex(c.token.refresh_token);
        const old = (await store.getToken(oldHash))!;
        const grant = (await store.getGrant(old.grantId))!;
        expect(grant).toMatchObject({ app: "ntwrk", personId, resource, revokedAt: null });
        env.clock.t += 15 * 60_000 + 1;
        expect((await call(env, resource, "check_status", { app: "ntwrk" }, { token: c.token.access_token })).res.status).toBe(401);

        // Reconstruct both handler and store against the same real database, retaining
        // the existing platform identity/consent. No new login or OTP is performed.
        restarted = new PgOAuthStore(testUrl.toString());
        handler = createMcpHandler({ platform, store: restarted, now: () => env.clock.t, minOtpStartMs: 0, log: line => env.logs.push(line) });
        expect(await restarted.getGrant(grant.id)).toEqual(grant);
        const before = await store.sql`select * from oauth.tokens where grant_id = ${grant.id} order by hash`;
        const beforeAudit = await store.sql`select * from oauth.audit where grant_id = ${grant.id} order by id`;
        await store.sql`create table oauth.test_refresh_fault (grant_id text primary key, step text not null)`;
        await store.sql`insert into oauth.test_refresh_fault values (${grant.id}, ${fault})`;
        await store.sql.unsafe(`create function oauth.test_refresh_fault() returns trigger language plpgsql as $$
          begin
            if exists (select 1 from oauth.test_refresh_fault where grant_id = NEW.grant_id
              and step = case when TG_TABLE_NAME = 'audit' then 'audit' else NEW.kind end) then
              raise exception 'synthetic refresh mint failure';
            end if;
            return NEW;
          end $$;
          create trigger test_refresh_fault before insert on oauth.tokens for each row execute function oauth.test_refresh_fault();
          create trigger test_refresh_fault before insert on oauth.audit for each row execute function oauth.test_refresh_fault();`);
        const refresh = () => tokenRequest(env, "ntwrk.party", { grant_type: "refresh_token", refresh_token: c.token.refresh_token, client_id: c.client.client_id, resource });
        expect((await refresh()).res.status).toBe(500);
        // The real transaction must leave the old token, grant, replacement rows and
        // success audit unchanged even when the second insert or audit failed.
        expect(await store.sql`select * from oauth.tokens where grant_id = ${grant.id} order by hash`).toEqual(before);
        expect(await store.sql`select * from oauth.audit where grant_id = ${grant.id} order by id`).toEqual(beforeAudit);
        expect(await store.getGrant(grant.id)).toEqual(grant);
        expect((await store.getToken(oldHash))!.rotatedAt).toBeNull();
        await store.sql`delete from oauth.test_refresh_fault`;
        const retry = await refresh();
        expect(retry.res.status).toBe(200);
        expect(retry.body).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "membership:read profile:write" });
        const replacement = (await store.getToken(sha256hex(retry.body.refresh_token)))!;
        expect(replacement).toMatchObject({ grantId: grant.id, clientId: c.client.client_id, app: "ntwrk", resource, scopes: ["membership:read", "profile:write"] });
        expect((await call(env, resource, "check_status", { app: "ntwrk" }, { token: retry.body.access_token })).body!.result.structuredContent.status).toBe("invited");
        expect((await refresh()).body.error).toBe("invalid_grant");
        expect((await call(env, resource, "check_status", { app: "ntwrk" }, { token: retry.body.access_token })).res.status).toBe(401);
        expect((await tokenRequest(env, "ntwrk.party", { grant_type: "refresh_token", refresh_token: retry.body.refresh_token, client_id: c.client.client_id, resource })).body.error).toBe("invalid_grant");
        expect(env.provider.sent).toHaveLength(1);
        for (const secret of [c.token.access_token, c.token.refresh_token, retry.body.access_token, retry.body.refresh_token, c.code]) expect(env.logs.join("\n")).not.toContain(secret);
      } finally {
        try {
          await store.sql.unsafe(`drop trigger if exists test_refresh_fault on oauth.tokens;
            drop trigger if exists test_refresh_fault on oauth.audit;
            drop function if exists oauth.test_refresh_fault();
            drop table if exists oauth.test_refresh_fault;`);
        } finally {
          await server.stop(true);
          await restarted?.close();
        }
      }
    });
  }
});
