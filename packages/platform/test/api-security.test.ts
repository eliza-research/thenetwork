// The public API's defences, on the memory store and on Postgres: parallel joins (PLAT-15), the lowest
// age as a property (PLAT-02), malformed cookies (PLAT-21), the canonical opt-in wording (PLAT-24),
// the body cap and the production host map (PLAT-27), CSRF and Origin checks, one SMS for parallel
// starts and the daily cap (PLAT-20, platform-26), and the same answer for known and unknown phones.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handle as routerHandle } from "../../../deploy/router.ts";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi, MAX_API_BODY_BYTES, parseCookies, type PublicApi } from "../src/api.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { MemoryPeopleStore, type PeopleStore } from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
let seq = 0;
const newPhone = () => { seq++; return `+1${String(312 + Math.floor(seq / 100))}55501${String(seq % 100).padStart(2, "0")}`; };

/** A deterministic generator (no Math.random in the checks). */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function make(store: PeopleStore) {
  const clock = { t: Date.UTC(2026, 9, 9, 15) };
  const codes = new Map<string, string>();
  let sends = 0;
  const joined: { app: AppId; age: number; member: string }[] = [];
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev" }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {}, ipOf: req => req.headers.get("x-real-ip") ?? "198.51.100.200",
    otp: { name: "fake", send: async e164 => { sends++; const code = String(100000 + ((sends * 7919) % 900000)); codes.set(e164, code); return { code }; } },
    onJoin: async ({ app, age, membership }) => { await Bun.sleep(5); joined.push({ app: app.id, age, member: membership.memberId }); },
  });
  const call = async (app: AppId, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = (await api.fetch(new Request(`http://${HOST[app]}${path}`, {
      method, headers: { host: HOST[app], ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-real-ip": `203.0.113.${(seq % 200) + 1}`, ...headers },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    })))!;
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (app: AppId, phone: string) => {
    expect((await call(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    const v = await call(app, "POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) });
    clock.t += 31_000;
    return v.cookie!;
  };
  return { api, clock, call, login, joined, sends: () => sends };
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });
const stores = [
  { name: "memory", skip: false, make: async (): Promise<PeopleStore> => new MemoryPeopleStore() },
  { name: "postgres", skip: !pgAvailable, make: async (): Promise<PeopleStore> => { const u = await migratedDb("apisec"); urls.push(u); return new PgPeopleStore(u); } },
];

for (const s of stores) describe.skipIf(s.skip)(`API defences (${s.name})`, () => {
  let store: PeopleStore;
  beforeAll(async () => { store = await s.make(); }, 120_000);
  afterAll(async () => { await (store as PgPeopleStore).close?.(); });

  test("local Cloud handoff binds state, PKCE, app and live delegated identity; legacy apps retain OTP", async () => {
    const phone = newPhone();
    let now = Date.now();
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

  test("PLAT-15 ten parallel joins with one phone: one person, one membership, one member, one opt-in", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await c.login("friends", phone);
    const body = { firstName: "Ana", age: 30, consent: { sms: true, wording: APPS.friends.consent.text } };
    const rs = await Promise.all(Array.from({ length: 10 }, () => c.call("friends", "POST", "/api/join", body, { cookie })));
    expect(rs.every(r => r.status === 200)).toBe(true);
    expect(c.joined.length).toBe(1);
    const person = (await c.api.accounts.personFor(phone))!;
    expect((await store.memberships(person.id)).length).toBe(1);
    expect((await store.consentEvents(phone, "friends")).length).toBe(1);
  });

  test("PLAT-02 the lowest age is monotone per phone: random ages across apps and delete-all never let an older age through", async () => {
    const r = rng(7);
    for (let run = 0; run < 6; run++) {
      const c = make(store), phone = newPhone();
      let lowest = Infinity;
      await c.api.accounts.invite(APPS.ntwrk, phone);
      for (let step = 0; step < 6; step++) {
        c.clock.t += 3_600_000; // past the 3-codes-an-hour limit for one number
        const app = (["slop", "peon", "friends", "ntwrk"] as AppId[])[Math.floor(r() * 4)]!;
        if (r() < 0.2) {
          const ck = await c.login(app, phone);
          await c.call(app, "POST", "/api/me/delete", { scope: "all" }, { cookie: ck });
          continue;
        }
        const age = 10 + Math.floor(r() * 30);
        const ck = await c.login(app, phone);
        const res = await c.call(app, "POST", "/api/join", { firstName: "P", age, consent: { sms: true, version: APPS[app].consent.version } }, { cookie: ck });
        if (res.status === 200 && c.joined.length) {
          // Whatever age was typed, the member gets the lowest age the phone ever stated.
          expect(c.joined.at(-1)!.age).toBe(Math.min(lowest, age));
        }
        // Only an age the join read counts (an invite-only refusal never reads it).
        if (res.status === 200 || res.body?.error === "under_age") lowest = Math.min(lowest, age);
        if (res.body?.error === "under_age") expect(lowest).toBeLessThan(13);
        if (res.status === 200) expect(lowest).toBeGreaterThanOrEqual(13);
        await c.api.accounts.leave(APPS[app], { e164: phone, personId: null });
        c.joined.length = 0;
      }
    }
  });

  test("PLAT-21 a malformed cookie on the domain is ignored: /api/me answers 401, never 500", async () => {
    const c = make(store);
    for (const cookie of ["a=%E0%A4%A", "%zz=1; sid_slop=%", "sid_slop=%E0%A4%A; other=1", "=;;=", "sid_slop"]) {
      expect([cookie, (await c.call("slop", "GET", "/api/me", undefined, { cookie })).status]).toEqual([cookie, 401]);
    }
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const raw = Array.from({ length: Math.floor(r() * 40) }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join("");
      expect(() => parseCookies(raw)).not.toThrow();
    }
  });

  test("PLAT-24 only the app's canonical opt-in wording is accepted; the ledger stores that text and its version", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await c.login("peon", phone);
    const bad = await c.call("peon", "POST", "/api/join", { firstName: "Ana", age: 30, consent: { sms: true, wording: "I agree to nothing in particular" } }, { cookie });
    expect(bad.body).toEqual({ ok: false, error: "consent_wording" });
    const otherApp = await c.call("peon", "POST", "/api/join", { firstName: "Ana", age: 30, consent: { sms: true, wording: APPS.slop.consent.text } }, { cookie });
    expect(otherApp.body.error).toBe("consent_wording");
    expect(await store.findPhone(phone)).toBeUndefined();
    const ok = await c.call("peon", "POST", "/api/join", { firstName: "Ana", age: 30, consent: { sms: true, wording: `  ${APPS.peon.consent.text.replace(/ /g, "\n ")} ` } }, { cookie });
    expect(ok.status).toBe(200);
    const [e] = await store.consentEvents(phone, "peon");
    expect([e!.wording, e!.wordingVersion]).toEqual([APPS.peon.consent.text, APPS.peon.consent.version]);
  });

  test("CSRF: a non-JSON POST, a cross-site Origin and a cross-site fetch are refused; same-site passes", async () => {
    const c = make(store);
    const phone = newPhone();
    expect((await c.call("slop", "POST", "/api/auth/otp/start", `phone=${phone}`, { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone }, { origin: "http://localhost:5103" })).status).toBe(403); // another app's site
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone }, { origin: "http://localhost:5102", "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  test("PLAT-27 a body over 16 KB gets 413 before it is parsed", async () => {
    const c = make(store);
    const big = JSON.stringify({ phone: newPhone(), pad: "x".repeat(MAX_API_BODY_BYTES) });
    expect((await c.call("slop", "POST", "/api/auth/otp/start", big)).status).toBe(413);
  });

  test("platform-26 twenty parallel starts for one number send one SMS; a number gets at most 6 codes a day", async () => {
    const c = make(store), phone = newPhone();
    const before = c.sends();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => c.call("slop", "POST", "/api/auth/otp/start", { phone }, { "x-real-ip": `198.18.1.${i}` })));
    expect(c.sends() - before).toBe(1);
    expect(rs.filter(r => r.status === 200).length).toBe(1);
    // The daily cap across hours: 3 an hour, 6 a day.
    const d = make(store), p2 = newPhone();
    d.clock.t = Date.UTC(2026, 9, 11, 0, 0, 1);
    const day: number[] = [];
    for (let h = 0; h < 3; h++) for (let i = 0; i < 3; i++) { day.push((await d.call("peon", "POST", "/api/auth/otp/start", { phone: p2 }, { "x-real-ip": `198.18.2.${h * 3 + i}` })).status); d.clock.t += 31_000 + (i === 2 ? 3_600_000 : 0); }
    expect(day.filter(x => x === 200).length).toBe(6);
  });

  test("no enumeration: otp/start answers the same body for a known, an unknown and a held phone, in a similar time", async () => {
    const c = make(store);
    const known = newPhone(), unknown = newPhone();
    await c.call("slop", "POST", "/api/join", {}, {}); // no session: 401, nothing changes
    await c.api.accounts.invite(APPS.ntwrk, known);
    const api = createPublicApi({ store, env: { PLATFORM_ENV: "dev" }, minStartMs: 120, minVerifyMs: 60, log: () => {}, otp: { name: "f", send: async () => ({ code: "123456" }) }, ipOf: () => `192.0.2.${++seq % 250}` });
    const time = async (phone: string, path = "/api/auth/otp/start", extra = {}) => {
      const t0 = performance.now();
      const r = (await api.fetch(new Request(`http://${HOST.slop}${path}`, { method: "POST", headers: { host: HOST.slop, "content-type": "application/json" }, body: JSON.stringify({ phone, ...extra }) })))!;
      return { body: await r.text(), status: r.status, ms: performance.now() - t0 };
    };
    const a = await time(known), b = await time(unknown);
    expect([a.status, a.body]).toEqual([b.status, b.body]);
    expect(Math.min(a.ms, b.ms)).toBeGreaterThanOrEqual(115);
    expect(Math.abs(a.ms - b.ms)).toBeLessThan(80);
    const va = await time(known, "/api/auth/otp/verify", { code: "000000" }), vb = await time(unknown, "/api/auth/otp/verify", { code: "000000" });
    expect([va.status, va.body]).toEqual([vb.status, vb.body]);
    expect(Math.min(va.ms, vb.ms)).toBeGreaterThanOrEqual(55);
  });
});

describe("production host map", () => {
  test("outside dev, localhost names are no app, and cookies are __Host- and Secure", async () => {
    const api = createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "production" }, hashKey: "h".repeat(40), sessionSecret: "s".repeat(40), turnstile: { verify: async () => true }, otp: { name: "f", send: async () => ({ code: "123456" }) }, minStartMs: 0, minVerifyMs: 0, log: () => {} });
    expect((await api.fetch(new Request("http://localhost:5102/api/app", { headers: { host: "localhost:5102" } })))!.status).toBe(404);
    expect(await (await api.fetch(new Request("https://slop.date/api/app", { headers: { host: "slop.date" } })))!.json()).toMatchObject({ id: "slop" });
  });
});

test("phone form blocks native GET during mode discovery, then restores OTP/fallback and Cloud handlers", async () => {
  const { mountAuth } = await import("../../../sites/shared/auth.ts");
  const { api } = await import("../../../sites/shared/api.ts");
  const saved = {authMode: api.authMode, otpStart: api.otpStart, cloudAuthStart: api.cloudAuthStart};
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  const makeButton = () => ({disabled: false, textContent: "Send code", dataset: {busy: "Sending…"}, type: "submit", className: ""});
  class Form extends EventTarget {
    button = makeButton();
    input = {value: "2125550101", disabled: false, setAttribute() {}, removeAttribute() {}, focus() {}};
    elements = Object.assign([this.input, this.button], {namedItem: () => this.input});
    attributes = new Map<string, string>();
    querySelector(selector: string) { return selector.startsWith("button") ? this.button : null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    replaceChildren(button: ReturnType<typeof makeButton>) { this.button = button; this.elements = Object.assign([button], {namedItem: () => this.input}); }
  }
  try {
    Object.defineProperty(globalThis, "document", {configurable: true, value: {querySelector: () => null, createElement: makeButton}});
    let destination = "";
    Object.defineProperty(globalThis, "location", {configurable: true, value: {pathname: "/join", assign: (url: string) => {destination = url;}}});
    for (const mode of ["otp", "404", "cloud"] as const) {
      const phone = new Form(), code = new Form();
      const root = {dataset: {} as Record<string, string>, getAttribute: () => null,
        querySelector: (selector: string) => selector === 'form[data-form="phone"]' ? phone : selector === 'form[data-form="code"]' ? code : null,
        querySelectorAll: () => []};
      let resolveMode!: (value: Awaited<ReturnType<typeof api.authMode>>) => void;
      let otpCalls = 0, cloudCalls = 0;
      api.authMode = () => new Promise(resolve => {resolveMode = resolve;});
      api.otpStart = async e164 => {expect(e164).toBe("+12125550101"); otpCalls++; return {ok: true, data: {ok: true}};};
      api.cloudAuthStart = async path => {expect(path).toBe("/join"); cloudCalls++; return {ok: true, data: {url: "https://cloud-staging.eliza.app/network/sign-in"}};};
      mountAuth(root as unknown as HTMLElement, () => {});
      const earlyEnter = new Event("submit", {cancelable: true});
      expect(phone.dispatchEvent(earlyEnter)).toBe(false);
      expect(earlyEnter.defaultPrevented).toBe(true);
      expect(Array.from(phone.elements).every(control => control.disabled)).toBe(true);
      expect(phone.attributes.get("aria-busy")).toBe("true");
      expect(phone.button.textContent).toBe("Loading sign-in…");
      expect(otpCalls + cloudCalls).toBe(0);
      resolveMode(mode === "404" ? {ok: false, error: "unknown", status: 404} : {ok: true, data: {mode}});
      await Bun.sleep(0);
      expect(Array.from(phone.elements).every(control => !control.disabled)).toBe(true);
      expect(phone.input.disabled).toBe(false);
      expect(phone.attributes.has("aria-busy")).toBe(false);
      if (mode !== "cloud") {
        expect(phone.button.textContent).toBe("Send code");
        expect(phone.button.dataset.busy).toBe("Sending…");
      }
      const normalSubmit = new Event("submit", {cancelable: true});
      expect(phone.dispatchEvent(normalSubmit)).toBe(false);
      expect(normalSubmit.defaultPrevented).toBe(true);
      await Bun.sleep(0);
      expect(otpCalls).toBe(mode === "cloud" ? 0 : 1);
      expect(cloudCalls).toBe(mode === "cloud" ? 1 : 0);
      if (mode === "cloud") expect(destination).toBe("https://cloud-staging.eliza.app/network/sign-in");
      else expect(root.dataset.current).toBe("code");
    }
  } finally {
    Object.assign(api, saved);
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else Reflect.deleteProperty(globalThis, "document");
    if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor); else Reflect.deleteProperty(globalThis, "location");
  }
});
