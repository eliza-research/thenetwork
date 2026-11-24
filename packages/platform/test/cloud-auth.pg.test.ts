// Real PostgreSQL + signed site router + platform account/session owners; Cloud HTTP authority is a controlled fixture.
// spec/cloudSignIn.md, "A completed callback passed each issuance check"
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi, parseCookies } from "../src/api.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import type {PeopleStore} from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";
import { handle as routerHandle } from "../../../deploy/router.ts";
import { NETWORK_LOGIN_PATH, networkTarget } from "../../core/src/svc/network-delegation.ts";
import { networkDelegationService, networkDelegationServiceRequest, type NetworkBridgeRow } from "../../mcp/test/fixtures/cloud-authorization-producer.ts";

const HOST: Record<AppId, string> = {ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104"};
describe.skipIf(!pgAvailable)("Cloud phone handoff (PostgreSQL)", () => {
  let url: string, store: PeopleStore;
  beforeAll(async () => {url = await migratedDb("cloud_auth"); store = new PgPeopleStore(url);}, 120_000);
  afterAll(async () => {await (store as PgPeopleStore)?.close(); if (url) await dropDb(url);});
  test("signed Cloud handoff returns only to the same-app Home Help page", async () => {
    const phone = "+12125550163";
    const secret = "local-signed-cloud-provider-fixture".repeat(2);
    const proxySecret = "local-signed-cloud-proxy-fixture";
    const target = networkTarget("ntwrk");
    const other = networkTarget("friends");
    let now = Date.UTC(2026, 10, 20, 17);
    const issuedAt = Math.floor(now / 1000) - 11 * 60;
    let calls = 0;
    let unavailable = false;
    const rows = new Map<string, NetworkBridgeRow>();
    const produce = networkDelegationService({ secret, now: () => now,
      verifyBearer: async token => token === "verified-fixture"
        ? { userId: "home-help-steward", issuedAt, expiration: Math.floor(now / 1000) + 3600 } : null,
      primaryOwner: async () => ({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222",
        stewardUserId: "home-help-steward", e164: phone, agentId: "personal:33333333-3333-4333-8333-333333333333", expiresAt: now + 3_600_000 }),
      blockedByLogout: async () => false,
      insert: async row => rows.set(row.code_hash, row),
      claim: async hash => { const row = rows.get(hash); rows.delete(hash); return row; },
    });
    const transport: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const raw = await request.text();
      expect(await networkDelegationServiceRequest(request, secret, raw, now)).toBe(true);
      expect(request.headers.get("origin")).toBe(target.origin);
      expect(new URL(request.url).origin).toBe("https://api.eliza.app");
      calls++;
      if (unavailable) throw new DOMException("Local transport timeout", "TimeoutError");
      const body = JSON.parse(raw);
      expect(body.target).toEqual(target);
      if (new URL(request.url).pathname === `${NETWORK_LOGIN_PATH}/exchange`) {
        expect(Object.keys(body).sort()).toEqual(["code", "codeVerifier", "target"]);
        const answer = await produce.exchange(body.target, body.code, body.codeVerifier);
        return Response.json(answer ?? { ok: false }, { status: answer ? 200 : 403 });
      }
      expect(Object.keys(body).sort()).toEqual(["proof", "target"]);
      const identity = await produce.validate(body.target, body.proof);
      return Response.json(identity ? { ok: true, identity } : { ok: false }, { status: identity ? 200 : 403 });
    };
    const api = createPublicApi({ store, proxySecret, now: () => now, hashKey: secret, sessionSecret: secret,
      env: { PLATFORM_ENV: "production", NETWORK_CLOUD_AUTH_ENABLED: "true", NETWORK_CLOUD_AUTH_MODE: "production-v1",
        NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud.eliza.app", NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api.eliza.app", SERVICE_TURN_SECRET: secret },
      cloudAuthFetch: transport, cloudValidationTtlMs: 0, turnstile: { verify: async () => false },
      otp: { name: "local-fixture", send: async () => { throw new Error("Cloud handoff sends no OTP"); } },
    });
    const call = (origin: string, path: string, body?: object, cookie?: string) => {
      const site = new URL(origin);
      const app = site.origin === target.origin ? "ntwrk" : "friends";
      return routerHandle(new Request(`${site.origin}${path}`, {
        method: body ? "POST" : "GET",
        headers: { ...(body ? { origin: site.origin, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }), { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, BACKEND_ORIGIN: "http://127.0.0.1:8790",
        APP_ID: app, SITE_HOST: site.host, PLATFORM_PROXY_SECRET: proxySecret,
      }, (async (input, init) => (await api.fetch(new Request(input, init)))!) as typeof fetch, () => now);
    };
    const person = await api.accounts.createPerson(phone, "inbound_message", 30);
    const membership = { app: "ntwrk" as const, personId: person.id, memberId: "existing_home_help_cloud", state: "active" as const,
      review: null, firstName: "Existing Member", profile: {}, joinedAt: now, leftAt: null };
    await store.putMembership(membership);

    const begin = async (wrongVerifier = false) => {
      const start = await call(target.origin, "/api/auth/cloud/start", { returnPath: "/home-help" });
      expect(start.status).toBe(200);
      const authorize = new URL((await start.json()).url);
      expect(authorize.origin + authorize.pathname).toBe("https://cloud.eliza.app/network/sign-in");
      expect([...authorize.searchParams.keys()].sort()).toEqual(["app", "challenge", "realm", "state"]);
      expect(authorize.searchParams.get("app")).toBe(target.app);
      expect(authorize.searchParams.get("realm")).toBe(target.realm);
      const state = authorize.searchParams.get("state")!;
      const challenge = wrongVerifier ? "0".repeat(64) : authorize.searchParams.get("challenge")!;
      const minted = await produce.mint("verified-fixture", target, challenge, state);
      const callback = new URL(minted!.url);
      expect(callback.origin + callback.pathname).toBe(target.callback);
      expect([...callback.searchParams.keys()].sort()).toEqual(["code", "state"]);
      return { path: callback.pathname + callback.search, pending: start.headers.getSetCookie()[0]!.split(";")[0]!, state };
    };
    const failed = (response: Response, error: string) => {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/home-help?error=${error}`);
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Secure-cloud_pending=;.*Max-Age=0/)]);
    };

    const success = await begin();
    expect((await call(other.origin, success.path, undefined, success.pending)).status).toBe(400);
    expect((await call(target.origin, success.path)).status).toBe(400);
    expect((await call(target.origin, success.path, undefined, success.pending + "tampered")).status).toBe(400);
    failed(await call(target.origin, success.path.replace(success.state, "wrong"), undefined, success.pending), "sign_in_expired");
    expect(calls).toBe(0);
    const completed = await call(target.origin, success.path + "&returnPath=https://evil.example/", undefined, success.pending);
    expect(completed.status).toBe(303);
    expect(completed.headers.get("location")).toBe("/home-help");
    expect(completed.headers.get("referrer-policy")).toBe("no-referrer");
    const cookies = completed.headers.getSetCookie().map(value => value.split(";")[0]!).filter(value => value.startsWith("__Host-")).join("; ");
    const token = parseCookies(cookies).get("__Host-sid")!;
    const session = (await api.sessions.authenticate("ntwrk", token))!.session;
    expect(session.startedAt).toBe(issuedAt * 1000);
    expect(session.personId).toBe(person.id);
    expect(api.sessions.fresh(session)).toBe(false);
    expect((await call(target.origin, "/api/me", undefined, cookies)).status).toBe(200);
    expect((await call(other.origin, "/api/me", undefined, cookies)).status).toBe(401);
    expect((await call(target.origin, "/api/me/phone/start", { phone: "+12125550164" }, cookies)).status).toBe(409);
    expect((await call(target.origin, "/api/me/phone/confirm", { code: "123456" }, cookies)).status).toBe(409);
    expect(await store.memberships(person.id)).toEqual([membership]);

    for (const returnPath of ["/home-help#hh_canary-1", "/home-help?address=Canary", "//evil.example/home-help", "/phone", "/oauth/cloud-return?rid=aaaaaaaaaaaaaaaaaaaaaa"]) {
      expect((await call(target.origin, "/api/auth/cloud/start", { returnPath })).status).toBe(400);
    }
    expect((await call(other.origin, "/api/auth/cloud/start", { returnPath: "/home-help" })).status).toBe(400);
    expect((await call(target.origin, "/api/auth/cloud/start", { returnPath: "/home-help", app: "friends" })).status).toBe(400);

    failed(await call(target.origin, success.path, undefined, success.pending), "sign_in_refused");
    const wrongVerifier = await begin(true);
    failed(await call(target.origin, wrongVerifier.path, undefined, wrongVerifier.pending), "sign_in_refused");
    const held = await begin();
    await store.setPhoneHold(phone, "recycled_number", now);
    failed(await call(target.origin, held.path, undefined, held.pending), "sign_in_refused");
    await store.setPhoneHold(phone, null, now);
    const timeout = await begin();
    unavailable = true;
    failed(await call(target.origin, timeout.path, undefined, timeout.pending), "sign_in_unavailable");
    unavailable = false;
    const expired = await begin();
    now += 300_000;
    const beforeExpired = calls;
    failed(await call(target.origin, expired.path, undefined, expired.pending), "sign_in_expired");
    expect(calls).toBe(beforeExpired);
    expect(await store.memberships(person.id)).toEqual([membership]);
  });
  test("local Cloud handoff binds state, PKCE, app and live delegated identity; legacy apps retain OTP", async () => {
    const phone = "+12125550161";
    let now = Date.UTC(2026, 9, 9, 15);
    let authorityLive = true, exchangeCount = 0, validations = 0, otpSends = 0, validationStatus = 200;
    let challenge = "";
    let identityResponse: "present" | "absent" | "expired" = "present";
    let code = `enso_${"a".repeat(64)}`;
    let proofIssuedAt = Math.floor(now/1000)-11*60, sourceExpiresAt = now+60_000;
    const consumed = new Set<string>();
    // Transport fixture checks this boundary only; real Cloud phone/SSO ownership is tested separately on Postgres.
    const transport = (async (request: RequestInfo | URL) => {
      const req = request as Request, body = await req.json() as Record<string, unknown>;
      expect(req.headers.get("origin")).toBe("http://127.0.0.1:5102");
      if (new URL(req.url).pathname.endsWith("network-validate")) {
        validations++;
        expect(req.headers.get("authorization")).toBe(`Bearer ${"local-server-fixture".repeat(2)}`);
        return Response.json({ok: authorityLive}, {status: authorityLive ? validationStatus : 403});
      }
      expect(req.headers.get("authorization")).toBe(`Bearer ${"local-server-fixture".repeat(2)}`);
      exchangeCount++;
      const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.codeVerifier)))).toString("hex");
      if (body.code !== code || consumed.has(code)) return Response.json({ok: false}, {status: 401});
      consumed.add(code);
      if (hash !== challenge) return Response.json({ok: false}, {status: 401});
      if (identityResponse === "absent") return Response.json(null);
      const expiresAt = identityResponse === "expired" ? now : sourceExpiresAt;
      return Response.json({userId: "cloud-user-fixture", organizationId: "cloud-org-fixture", e164: phone, expiresAt, stewardUserId: "steward-fixture", issuedAt: proofIssuedAt});
    }) as typeof fetch;
    const proxySecret = "local-proxy-fixture";
    // Validation caching is off here so each request reaches the transport fixture.
    const options = {store, proxySecret, now: () => now, cloudAuthFetch: transport, cloudValidationTtlMs: 0, env: {
      PLATFORM_ENV: "dev", NETWORK_CLOUD_AUTH_MODE: "staging-local", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
      NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: "http://127.0.0.1:5102", NETWORK_CLOUD_AUTH_SERVER_TOKEN: "local-server-fixture".repeat(2),
    }, minStartMs: 0, otp: {name: "local-fixture", send: async () => {otpSends++; return {code: "123456"};}}};
    const api = createPublicApi(options);
    for (const change of [
      {NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud.eliza.app"},
      {NETWORK_CLOUD_AUTH_API_ORIGIN: "https://evil.example"},
      {NETWORK_CLOUD_AUTH_SITE_ORIGIN: "https://slop.date"},
      {NETWORK_CLOUD_AUTH_SITE_ORIGIN: "http://127.0.0.1:59999"},
    ]) expect(() => createPublicApi({...options, env: {...options.env, ...change}})).toThrow();
    const {NETWORK_CLOUD_AUTH_MODE: _mode, ...withoutMode} = options.env;
    expect(() => createPublicApi({...options, env: withoutMode})).toThrow("NETWORK_CLOUD_AUTH_MODE");
    // The real dev router signs the canonical domain while the browser Origin stays loopback.
    const call = async (app: AppId, method: string, path: string, body?: unknown, cookie?: string, boundary = api) => routerHandle(new Request(`http://${HOST[app]}${path}`, {
      method, headers: {origin: app === "slop" ? "http://127.0.0.1:5102" : `http://${HOST[app]}`, ...(body ? {"content-type": "application/json"} : {}), ...(cookie ? {cookie} : {})}, ...(body ? {body: JSON.stringify(body)} : {}),
    }), {ASSETS: {fetch: async () => new Response(null, {status: 404})}, BACKEND_ORIGIN: "http://127.0.0.1:8790", APP_ID: app, SITE_HOST: APPS[app].domain, PLATFORM_PROXY_SECRET: proxySecret},
    (async (url, init) => (await boundary.fetch(new Request(String(url), init)))!) as typeof fetch, () => now);
    expect(await (await call("friends", "GET", "/api/auth/mode")).json()).toEqual({mode: "otp"});
    expect((await call("friends", "POST", "/api/auth/otp/start", {phone})).status).toBe(200);
    expect(await (await call("slop", "GET", "/api/auth/mode")).json()).toEqual({mode: "cloud"});
    expect((await call("slop", "POST", "/api/auth/otp/start", {phone})).status).toBe(409);
    expect((await call("slop", "POST", "/api/auth/cloud/start", {returnPath: "https://evil.example/join"})).status).toBe(400);
    expect((await call("slop", "POST", "/api/auth/cloud/start", {returnPath: "/join", app: "friends"})).status).toBe(400);
    expect(otpSends).toBe(1);
    const person = await api.accounts.createPerson(phone, "inbound_message", 25);
    const oldSession = await api.sessions.create("slop", phone, person.id);
    expect((await call("slop", "GET", "/api/me", undefined, `sid_slop=${oldSession.token}`)).status).toBe(401);
    const start = await call("slop", "POST", "/api/auth/cloud/start", {returnPath: "/join", phone: "+12125550999"});
    const pending = start.headers.get("set-cookie")!.split(";")[0]!;
    expect(start.headers.get("set-cookie")).toContain("HttpOnly");
    const authorize = new URL((await start.json()).url);
    expect(authorize.origin).toBe("https://cloud-staging.eliza.app");
    expect(authorize.pathname).toBe("/network/sign-in");
    expect(authorize.searchParams.get("networkSite")).toBe("http://127.0.0.1:5102");
    expect(authorize.href).not.toContain(phone);
    challenge = authorize.searchParams.get("challenge")!;
    const state = authorize.searchParams.get("state")!;
    const callback = `/api/auth/cloud/callback?code=${code}&state=${state}`;
    expect((await call("slop", "GET", callback)).status).toBe(400);
    expect((await call("slop", "GET", callback.replace(state, "bad"), undefined, pending)).status).toBe(400);
    expect((await call("slop", "GET", callback.replace("enso_", "esso_"), undefined, pending)).status).toBe(400);
    expect((await call("slop", "GET", callback, undefined, pending+"tampered")).status).toBe(400);
    expect((await call("friends", "GET", callback, undefined, pending)).status).toBe(404);
    expect(exchangeCount).toBe(0);
    const correctChallenge = challenge;
    challenge = "0".repeat(64);
    expect((await call("slop", "GET", callback, undefined, pending)).status).toBe(403);
    challenge = correctChallenge;
    expect((await call("slop", "GET", callback, undefined, pending)).status).toBe(403);
    const previous = await api.sessions.create("slop", phone, person.id);
    const callbackCookies = `${pending}; sid_slop=${previous.token}`;
    for (const [mode, key, expected] of [["absent", "d", 503], ["expired", "e", 403]] as const) {
      identityResponse = mode;
      code = `enso_${key.repeat(64)}`;
      const refused = await call("slop", "GET", `/api/auth/cloud/callback?code=${code}&state=${state}`, undefined, callbackCookies);
      expect(refused.status).toBe(expected);
      expect(refused.headers.getSetCookie()).toEqual([expect.stringMatching(/^cloud_pending_slop=;.*Max-Age=0/)]);
      expect(await api.sessions.authenticate("slop", previous.token)).toBeDefined();
    }
    identityResponse = "present";
    const priorIssueTime = proofIssuedAt;
    for (const [key, issuedAt] of [["f", 0], ["9", Math.floor(now / 1000) + 31]] as const) {
      proofIssuedAt = issuedAt;
      code = `enso_${key.repeat(64)}`;
      const refused = await call("slop", "GET", `/api/auth/cloud/callback?code=${code}&state=${state}`, undefined, callbackCookies);
      expect(refused.status).toBe(403);
      expect(refused.headers.getSetCookie()).toEqual([expect.stringMatching(/^cloud_pending_slop=;.*Max-Age=0/)]);
      expect(await api.sessions.authenticate("slop", previous.token)).toBeDefined();
    }
    proofIssuedAt = priorIssueTime;
    code = `enso_${"c".repeat(64)}`;
    const validCallback = `/api/auth/cloud/callback?code=${code}&state=${state}`;
    const signedIn = await call("slop", "GET", validCallback, undefined, callbackCookies);
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe("/join");
    expect(await api.sessions.authenticate("slop", previous.token)).toBeUndefined();
    const cookies = signedIn.headers.getSetCookie();
    const sessionCookie = cookies.find(value => value.startsWith("sid_slop="))!;
    expect(sessionCookie).toContain("Max-Age=60");
    const cookie = cookies.filter(value => !value.startsWith("cloud_pending_")).map(value => value.split(";")[0]).join("; ");
    expect((await call("slop", "GET", "/api/me", undefined, cookie)).status).toBe(200);
    expect(validations).toBe(1);
    for (let read = 0; read < 15; read++) expect((await call("slop", "GET", "/api/me", undefined, cookie)).status).toBe(200);
    const token = sessionCookie.split(";")[0]!.split("=")[1]!;
    expect((await api.sessions.authenticate("slop", token))!.session.startedAt).toBe(proofIssuedAt*1000);
    for (const transient of [429, 503, 403]) {
      validationStatus = transient;
      expect((await call("slop", "GET", "/api/me", undefined, cookie)).status).toBe(503);
      expect(await api.sessions.authenticate("slop", token)).not.toBeUndefined();
    }
    validationStatus = 200;
    expect((await call("slop", "GET", "/api/me", undefined, cookie)).status).toBe(200);
    // An old Cloud login remains old; a new handoff cannot refresh destructive authority.
    const destructive = await call("slop", "POST", "/api/me/delete", {scope: "all"}, cookie);
    expect(destructive.status).toBe(403);
    expect((await destructive.json()).error).toBe("reauth");
    expect((await api.accounts.personFor(phone))!.id).toBe(person.id);
    expect(await store.memberships(person.id)).toEqual([]);
    expect((await call("slop", "GET", validCallback, undefined, pending)).status).toBe(403);
    authorityLive = false;
    expect((await call("slop", "GET", "/api/me", undefined, cookie)).status).toBe(401);
    expect(validations).toBeGreaterThan(10);
    // A fresh Cloud proof signs in normally; within STEP_UP_MS it is the step-up for delete-all (not exercised
    // here, so the rest of the scenario keeps its data).
    authorityLive = true;
    const freshStartedAt = now;
    proofIssuedAt = Math.floor(now/1000) + 30;
    const freshStart = await call("slop", "POST", "/api/auth/cloud/start", {returnPath: "/join"});
    const freshPending = freshStart.headers.get("set-cookie")!.split(";")[0]!;
    const freshAuthorize = new URL((await freshStart.json()).url);
    challenge = freshAuthorize.searchParams.get("challenge")!;
    sourceExpiresAt = now+2*3_600_000;
    code = `enso_${"7".repeat(64)}`;
    const tooLong = await call("slop", "GET", `/api/auth/cloud/callback?code=${code}&state=${freshAuthorize.searchParams.get("state")}`, undefined, freshPending);
    expect(tooLong.status).toBe(403);
    expect(tooLong.headers.getSetCookie()).toEqual([expect.stringMatching(/^cloud_pending_slop=;.*Max-Age=0/)]);
    sourceExpiresAt = now+3_600_000;
    code = `enso_${"b".repeat(64)}`;
    const freshCallback = `/api/auth/cloud/callback?code=${code}&state=${freshAuthorize.searchParams.get("state")}`;
    const freshLogin = await call("slop", "GET", freshCallback, undefined, freshPending);
    expect(freshLogin.status).toBe(303);
    expect(freshLogin.headers.get("location")).toBe("/join");
    const freshCookie = freshLogin.headers.getSetCookie().filter(value => !value.startsWith("cloud_pending_")).map(value => value.split(";")[0]).join("; ");
    expect((await call("slop", "GET", "/api/me", undefined, freshCookie)).status).toBe(200);
    // spec/cloudAuthority.md, "Only a positive live Cloud response updates the cache"
    const cachedApi = createPublicApi({ ...options, cloudValidationTtlMs: 60_000 });
    const validateFresh = () => call("slop", "GET", "/api/me", undefined, freshCookie, cachedApi);
    const checksBefore = validations;
    expect((await validateFresh()).status).toBe(200);
    expect((await validateFresh()).status).toBe(200);
    expect(validations).toBe(checksBefore + 1);
    now += 60_000;
    expect((await validateFresh()).status).toBe(200);
    expect(validations).toBe(checksBefore + 2);
    now += 11*60_000;
    expect((await call("slop", "GET", "/api/me", undefined, freshCookie)).status).toBe(200);
    const freshSession = (await api.sessions.authenticate("slop", parseCookies(freshCookie).get("sid_slop")!, false))!.session;
    expect(freshSession.expiresAt).toBe(sourceExpiresAt);
    expect(freshSession.startedAt).toBe(freshStartedAt);
    expect((await call("slop", "GET", "/api/me", undefined, freshCookie)).status).toBe(200);
    expect((await call("friends", "GET", "/api/me", undefined, freshCookie)).status).toBe(401);
    expect((await call("slop", "POST", "/api/me/delete", {scope: "all"}, freshCookie)).status).toBe(403);
    // Authentication alone grants no membership; the existing invite/profile/consent owner still joins.
    expect(await store.memberships(person.id)).toEqual([]);
    await api.accounts.invite(APPS.slop, phone);
    const joined = await call("slop", "POST", "/api/join", {firstName: "Same Phone", age: 25, consent: {sms: true, wording: APPS.slop.consent.text}}, freshCookie);
    expect(joined.status).toBe(200);
    expect((await api.accounts.personFor(phone))!.id).toBe(person.id);
    expect((await store.memberships(person.id)).map(member => member.app)).toEqual(["slop"]);
    expect((await store.consentEvents(phone, "slop")).filter(event => event.state === "opted_in")).toHaveLength(1);
    now = sourceExpiresAt;
    expect((await call("slop", "GET", "/api/me", undefined, freshCookie)).status).toBe(401);
    // Removing the feature configuration cannot turn a delegated Cloud session into an ordinary OTP session.
    const disabled = createPublicApi({store, env: {PLATFORM_ENV: "dev"}, otp: {name: "disabled-fixture", send: async () => ({code: "123456"})}});
    expect((await disabled.fetch(new Request("http://localhost:5102/api/me", {headers: {host: "localhost:5102", cookie: freshCookie}})))!.status).toBe(401);
  });

  function cloudFixture(o: { phone: string; now: number; name: string; refused: () => boolean; app?: "ntwrk" | "slop" }) {
    const host = o.app === "ntwrk" ? "127.0.0.1:5101" : "127.0.0.1:5102";
    let challenge = "";
    const transport = (async (request: RequestInfo | URL) => {
      const req = request as Request;
      if (new URL(req.url).pathname.endsWith("network-validate")) return Response.json({ok: true});
      const body = await req.json() as {codeVerifier: string};
      const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.codeVerifier)))).toString("hex");
      if (o.refused() || hash !== challenge) return Response.json({ok: false}, {status: 401});
      return Response.json({userId: `cloud-user-${o.name}`, organizationId: "cloud-org-fixture", stewardUserId: "steward-fixture", e164: o.phone,
        issuedAt: Math.floor(o.now/1000), expiresAt: o.now+60_000});
    }) as typeof fetch;
    const api = createPublicApi({store, now: () => o.now, cloudAuthFetch: transport, cloudValidationTtlMs: 0, minStartMs: 0, log: () => {}, env: {
      PLATFORM_ENV: "dev", NETWORK_CLOUD_AUTH_MODE: "staging-local", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
      NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: `http://${host}`, NETWORK_CLOUD_AUTH_SERVER_TOKEN: `${o.name}-fixture`.repeat(2),
    }, otp: {name: `${o.name}-fixture`, send: async () => ({code: "123456"})}});
    const call = async (method: string, path: string, body?: unknown, cookie?: string) => (await api.fetch(new Request(`http://${host}${path}`, {
      method, headers: {host, ...(body ? {"content-type": "application/json"} : {}), ...(cookie ? {cookie} : {})}, ...(body ? {body: JSON.stringify(body)} : {}),
    })))!;
    return { call, expectChallenge: (value: string) => { challenge = value; } };
  }

  test("the private home-help page signs in through Cloud and the callback returns to it", async () => {
    const { call, expectChallenge } = cloudFixture({ phone: "+12125550162", now: Date.UTC(2026, 9, 10, 15), name: "home-help", refused: () => false, app: "ntwrk" });
    expect((await call("POST", "/api/auth/cloud/start", {returnPath: "/settings"})).status).toBe(400);
    const start = await call("POST", "/api/auth/cloud/start", {returnPath: "/home-help"});
    expect(start.status).toBe(200);
    const pending = start.headers.get("set-cookie")!.split(";")[0]!;
    const authorize = new URL((await start.json()).url);
    expectChallenge(authorize.searchParams.get("challenge")!);
    const back = await call("GET", `/api/auth/cloud/callback?code=enso_${"1".repeat(64)}&state=${authorize.searchParams.get("state")}`, undefined, pending);
    expect({status: back.status, location: back.headers.get("location")}).toEqual({status: 303, location: "/home-help"});
    const cookie = back.headers.getSetCookie().filter(value => !value.startsWith("cloud_pending_")).map(value => value.split(";")[0]).join("; ");
    expect(await (await call("GET", "/api/me", undefined, cookie)).json()).toMatchObject({app: "ntwrk", membership: null});
  });

});
