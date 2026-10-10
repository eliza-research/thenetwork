// Real PostgreSQL + signed site router + platform account/session owners; Cloud HTTP authority is a controlled fixture.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi, parseCookies } from "../src/api.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import type {PeopleStore} from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";
import { handle as routerHandle } from "../../../deploy/router.ts";

const HOST: Record<AppId, string> = {ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104"};
describe.skipIf(!pgAvailable)("Cloud phone handoff (PostgreSQL)", () => {
  let url: string, store: PeopleStore;
  beforeAll(async () => {url = await migratedDb("cloud_auth"); store = new PgPeopleStore(url);}, 120_000);
  afterAll(async () => {await (store as PgPeopleStore)?.close(); if (url) await dropDb(url);});
  test("local Cloud handoff binds state, PKCE, app and live delegated identity; legacy apps retain OTP", async () => {
    const phone = "+12125550161";
    let now = Date.UTC(2026, 9, 9, 15);
    let authorityLive = true, exchangeCount = 0, validations = 0, otpSends = 0, validationStatus = 200;
    let challenge = "";
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
      return Response.json({userId: "cloud-user-fixture", organizationId: "cloud-org-fixture", e164: phone, expiresAt: sourceExpiresAt, stewardUserId: "steward-fixture", issuedAt: proofIssuedAt});
    }) as typeof fetch;
    const proxySecret = "local-proxy-fixture";
    const options = {store, proxySecret, now: () => now, cloudAuthFetch: transport, env: {
      PLATFORM_ENV: "dev", NETWORK_CLOUD_AUTH_ENABLED: "true", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
      NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: "http://127.0.0.1:5102", NETWORK_CLOUD_AUTH_SERVER_TOKEN: "local-server-fixture".repeat(2),
    }, minStartMs: 0, otp: {name: "local-fixture", send: async () => {otpSends++; return {code: "123456"};}}};
    const api = createPublicApi(options);
    for (const change of [
      {NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud.eliza.app"},
      {NETWORK_CLOUD_AUTH_API_ORIGIN: "https://evil.example"},
      {NETWORK_CLOUD_AUTH_SITE_ORIGIN: "https://slop.date"},
      {NETWORK_CLOUD_AUTH_SITE_ORIGIN: "http://127.0.0.1:59999"},
    ]) expect(() => createPublicApi({...options, env: {...options.env, ...change}})).toThrow();
    // The real dev router signs the canonical domain while the browser Origin stays loopback.
    const call = async (app: AppId, method: string, path: string, body?: unknown, cookie?: string) => routerHandle(new Request(`http://${HOST[app]}${path}`, {
      method, headers: {origin: app === "slop" ? "http://127.0.0.1:5102" : `http://${HOST[app]}`, ...(body ? {"content-type": "application/json"} : {}), ...(cookie ? {cookie} : {})}, ...(body ? {body: JSON.stringify(body)} : {}),
    }), {ASSETS: {fetch: async () => new Response(null, {status: 404})}, BACKEND_ORIGIN: "http://127.0.0.1:8790", APP_ID: app, SITE_HOST: APPS[app].domain, PLATFORM_PROXY_SECRET: proxySecret},
    (async (url, init) => (await api.fetch(new Request(String(url), init)))!) as typeof fetch, () => now);
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
    code = `enso_${"c".repeat(64)}`;
    const validCallback = callback.replace(`enso_${"a".repeat(64)}`, code);
    const signedIn = await call("slop", "GET", validCallback, undefined, pending);
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe("/join");
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
    // A fresh Cloud proof may sign in normally, but still does not assert a phone step-up.
    authorityLive = true;
    proofIssuedAt = Math.floor(now/1000);
    sourceExpiresAt = now+3*24*3_600_000;
    code = `enso_${"b".repeat(64)}`;
    const freshStart = await call("slop", "POST", "/api/auth/cloud/start", {returnPath: "/settings"});
    const freshPending = freshStart.headers.get("set-cookie")!.split(";")[0]!;
    const freshAuthorize = new URL((await freshStart.json()).url);
    challenge = freshAuthorize.searchParams.get("challenge")!;
    const freshCallback = `/api/auth/cloud/callback?code=${code}&state=${freshAuthorize.searchParams.get("state")}`;
    const freshLogin = await call("slop", "GET", freshCallback, undefined, freshPending);
    expect(freshLogin.status).toBe(303);
    expect(freshLogin.headers.get("location")).toBe("/settings");
    let freshCookie = freshLogin.headers.getSetCookie().filter(value => !value.startsWith("cloud_pending_")).map(value => value.split(";")[0]).join("; ");
    expect((await call("slop", "GET", "/api/me", undefined, freshCookie)).status).toBe(200);
    expect((await call("slop", "POST", "/api/me/delete", {scope: "all"}, freshCookie)).status).toBe(403);
    // The source proof is checked against the original cookie, then rotated and resealed together.
    now += 25*3_600_000;
    const rotated = await call("slop", "GET", "/api/me", undefined, freshCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.headers.getSetCookie()).toHaveLength(2);
    freshCookie = rotated.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const rotatedToken = parseCookies(freshCookie).get("sid_slop")!;
    const rotatedSession = (await api.sessions.authenticate("slop", rotatedToken))!.session;
    expect(rotatedSession.expiresAt).toBe(sourceExpiresAt);
    expect(rotatedSession.startedAt).toBe(proofIssuedAt*1000);
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

});
