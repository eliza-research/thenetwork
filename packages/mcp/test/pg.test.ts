// OAuth on Postgres: a unique database on the dev cluster or an explicitly owned
// loopback fixture, dropped afterwards. The refresh regression uses real HTTP.
import { admin as adminSql } from "../../platform/test/pg.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { APPS, createPublicApi, PgPeopleStore } from "@thenetwork/platform";
import { migrate } from "../../observatory/db/migrate.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { createMcpHandler } from "../src/handler.ts";
import { platformHooks } from "../src/hooks.ts";
import { sha256hex } from "../src/util.ts";
import { addMember, call, connect, origin, PHONE_A, register, setup, tokenRequest } from "./harness.ts";

const USER = process.env.USER ?? "postgres";
// An admitted Linux fixture may provide its already-running, isolated loopback PG.
// Never start/reset that cluster or accept a remote/service database here.
const EXPLICIT_PG = process.env.MCP_TEST_PG_URL;
const ADMIN_URL = EXPLICIT_PG ?? `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const admin = (q: string) => adminSql(q, ADMIN_URL);
const parsedAdmin = new URL(ADMIN_URL);
if (!["postgres:", "postgresql:"].includes(parsedAdmin.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsedAdmin.hostname) || parsedAdmin.pathname !== "/postgres") throw new Error("MCP_TEST_PG_URL must name an owned loopback postgres admin database");
if (process.env.REQUIRE_PG === "1" && !EXPLICIT_PG && !pgAvailable) throw new Error("OAuth integration requires PostgreSQL");
const DB = `mcp_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${DB}`;

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
    const pending: import("../src/store.ts").AuthRequest = {
      id: `approval_${randomUUID()}`, browserHash: sha256hex("browser-cookie"),
      clientId: client.body.client_id, app: "peon", redirectUri: "https://client.example/callback",
      state: "state", codeChallenge: sha256hex("challenge"), scopes: ["membership:read"],
      resource: "https://peon.biz/mcp", e164: PHONE_A, personId: null,
      step: "consent", createdAt: at, expiresAt: at + 60_000,
    };
    const other = new PgOAuthStore(testUrl.toString());
    try {
      await store.putAuthRequest(pending);
      const results = await Promise.all([store, other].map(s => s.takeConsentRequest(pending.id, at)));
      expect(results.filter(Boolean)).toEqual([pending]);
      expect(await store.getAuthRequest(pending.id)).toBeUndefined();
      for (const patch of [{ step: "code" as const }, { e164: null }, { expiresAt: at }]) {
        const refused = { ...pending, ...patch, id: `approval_${randomUUID()}` };
        await store.putAuthRequest(refused);
        expect(await other.takeConsentRequest(refused.id, at)).toBeUndefined();
        expect(await store.getAuthRequest(refused.id)).toEqual(refused);
      }
    } finally { await other.close(); }
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
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash("+12125550199"), "friends", null, env.clock.t)).toBeUndefined();
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "ntwrk", null, env.clock.t)).toBeUndefined();
      const pair = await Promise.all([store, restarted].map(s => s.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, env.clock.t)));
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
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, env.clock.t)).toBeUndefined();
      expect((await store.sql`select fields from oauth.signup_drafts where grant_id=${pending.id}`)[0].fields).toEqual({});
      const fresh = await connect(env, "friends.help", PHONE_A);
      await call(env, "https://friends.help/mcp", "prepare_signup", { firstName: "Tess" }, { token: fresh.token.access_token });
      expect(await restarted.claimSignupDraft(env.accounts.phoneHash(PHONE_A), "friends", null, env.clock.t)).toEqual({ firstName: "Tess" });
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

  test("a code is taken once under a race; rate windows count and reset", async () => {
    const env = setup({ store });
    const c = await connect(env, "slop.date", PHONE_A);
    const g = (await store.grantsFor(env.accounts.phoneHash(PHONE_A), "slop", env.clock.t))[0]!;
    await store.putCode({ hash: "race", grantId: g.id, clientId: c.client.client_id, redirectUri: "https://client.example/callback", codeChallenge: "x".repeat(43), resource: "https://slop.date/mcp", scopes: ["apps:read"], createdAt: env.clock.t, expiresAt: env.clock.t + 60_000, usedAt: null });
    const taken = await Promise.all([1, 2, 3, 4].map(() => store.takeCode("race", env.clock.t)));
    expect(taken.filter(t => t!.usedAt === null)).toHaveLength(1);
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
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) { return (await handler.fetch(req)) ?? new Response("not found", { status: 404 }); } });
      env.fetch = async req => {
        const original = new URL(req.url);
        const headers = new Headers(req.headers);
        headers.set("host", original.host);
        return fetch(new URL(original.pathname + original.search, server.url), { method: req.method, headers, redirect: "manual", ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: await req.arrayBuffer() }) });
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
          server.stop(true);
          await restarted?.close();
        }
      }
    });
  }
});
