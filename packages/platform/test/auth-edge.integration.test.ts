// The auth edge machines (quint/auth_edge.qnt) through the real public API on Postgres: the web OTP
// challenge, the web session and the rate buckets of a code send. Each case is a trace from the model
// findings (docs/research/quint-findings/auth_edge.md) that failed before its fix.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import type { OtpLimits } from "../src/otp.ts";
import { APPS, type AppId } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { NETWORK_FRESH_PERSON_SITES, networkTarget } from "../../core/src/svc/network-delegation.ts";
import { networkDelegationService, networkDelegationServiceRequest } from "../../mcp/test/fixtures/cloud-authorization-producer.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
let seq = 0;
const newPhone = () => { seq++; return `+1646555${String(1000 + seq)}`; };

function make(store: PgPeopleStore, otpLimits?: Partial<OtpLimits>) {
  const clock = { t: Date.UTC(2026, 10, 7, 15) };
  const codes = new Map<string, string>();
  const sent: string[] = [];
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev" }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {},
    ipOf: req => req.headers.get("x-real-ip") ?? "198.51.100.10",
    otpLimits,
    otp: { name: "fake", send: async e164 => { sent.push(e164); const code = String(100000 + sent.length * 7919 % 900000); codes.set(e164, code); return { code }; } },
  });
  const call = async (app: AppId, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = (await api.fetch(new Request(`http://${HOST[app]}${path}`, {
      method, headers: { host: HOST[app], ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })))!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (app: AppId, phone: string) => {
    expect((await call(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    const v = await call(app, "POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) });
    expect(v.status).toBe(200);
    clock.t += 31_000;
    return v.cookie!;
  };
  return { api, clock, call, codes, sent, login };
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });

describe.skipIf(!pgAvailable)("auth edge (Postgres)", () => {
  let store: PgPeopleStore;
  beforeAll(async () => { const u = await migratedDb("authedge"); urls.push(u); store = new PgPeopleStore(u); }, 120_000);
  afterAll(async () => { await store?.close(); });

  test("SD-380 a code request refused by a later limit is not counted in the earlier limits", async () => {
    // otp.ts:4-5: a refused request is not counted. Two code requests a hour from this IP.
    const c = make(store, { perIpPerHour: 2 }), a = newPhone(), b = newPhone(), ip = { "x-real-ip": "198.51.100.77" };
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone: a }, ip)).status).toBe(200);
    // Again for the same number after 1 s: refused by the 30 s gap of the number (after the IP limit is checked).
    c.clock.t += 1_000;
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone: a }, ip)).status).toBe(429);
    // One request from this IP was accepted, so a second number still gets its code.
    c.clock.t += 1_000;
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone: b }, ip)).status).toBe(200);
    expect(c.sent).toEqual([a, b]);
  });

  test("SD-013 a banned number gets no code and no session from web OTP", async () => {
    const c = make(store), phone = newPhone();
    const ban = () => store.ban({ id: `ban_ae_${process.pid}_${phone}`, scope: "phone", personId: null, phoneHash: c.api.accounts.phoneHash(phone), reason: "test", reportId: null, bannedBy: "staff", at: c.clock.t });
    // A code sent before the ban: the ban lands, then the code is entered. No session.
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect(c.sent).toEqual([phone]);
    await ban();
    const late = await c.call("slop", "POST", "/api/auth/otp/verify", { phone, code: c.codes.get(phone) });
    expect(late.status).toBe(400);
    expect(late.cookie).toBeUndefined();
    // A new start for the banned number: the same answer as for any number, and no SMS goes out.
    c.clock.t += 31_000;
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect(c.sent).toEqual([phone]);
  });

  // The old holder of a number logged in on the web before the number had a person: the session row is
  // (number, no person). The carrier gives the number to a new holder, who joins. The old cookie must not
  // act for the new holder's person (accounts.ts: own data only; the age policy: an age comes from the person).
  const joinBody = (age: number) => ({ firstName: "Ana", age, consent: { sms: true, wording: APPS.slop.consent.text } });

  test("SD-054 a session from before a text join does not act for the person the join made", async () => {
    const c = make(store), phone = newPhone();
    const old = await c.login("slop", phone);
    // The new holder joins by text: the service makes the person with accounts.createPerson (service.ts join path).
    const person = await c.api.accounts.createPerson(phone, "inbound_message", 30);
    await store.putMembership({ app: "slop", personId: person.id, memberId: `slop_ae_${seq}`, state: "active", review: null, firstName: "Alice", profile: {}, joinedAt: c.clock.t, leftAt: null });
    await c.api.accounts.recordConsent({ e164: phone, app: "slop", state: "opted_in", source: "inbound_message", at: c.clock.t });
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie: old })).status).toBe(401);
    expect((await c.call("slop", "POST", "/api/join", joinBody(15), { cookie: old })).status).toBe(401);
    expect((await c.call("slop", "POST", "/api/me/delete", { scope: "app" }, { cookie: old })).status).toBe(401);
    expect((await store.getPerson(person.id))!.lowestAge).toBe(30);
    expect((await store.getMembership(person.id, "slop"))!.state).toBe("active");
    // The new holder's own login works.
    const own = await c.login("slop", phone);
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie: own })).body.membership.firstName).toBe("Alice");
  });

  test("SD-054 a web join binds only the joining session, not an earlier holder's session", async () => {
    const c = make(store), phone = newPhone();
    const old = await c.login("slop", phone);
    const own = await c.login("slop", phone);
    expect((await c.call("slop", "POST", "/api/join", joinBody(30), { cookie: own })).status).toBe(200);
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie: old })).status).toBe(401);
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie: own })).body.membership.firstName).toBe("Ana");
  });

  test("SD-491 an under-13 web join keeps no session with the number", async () => {
    // AGENTS.md age policy: under 13 is declined kindly with nothing stored (only the keyed age floor).
    const c = make(store), phone = newPhone();
    const own = await c.login("slop", phone);
    const other = await c.login("slop", phone);
    const refused = await c.call("slop", "POST", "/api/join", joinBody(10), { cookie: own });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("under_age");
    expect(refused.cookie).toBe(`${own.split("=")[0]}=`);
    const rows = await store.sql`select count(*)::int as n from platform.sessions where e164 = ${phone}`;
    expect(rows[0].n).toBe(0);
    expect((await c.call("slop", "GET", "/api/me", undefined, { cookie: own })).status).toBe(401);
    expect((await c.call("slop", "GET", "/api/me", undefined, { cookie: other })).status).toBe(401);
    expect(await c.api.accounts.personFor(phone)).toBeUndefined();
  });

  // The Cloud sign-in on the production delegation path (own-pages realm), with the qualified Cloud producer
  // fixture on its own clock. api.ts allows 30 s of Cloud clock lead (CLOUD_CLOCK_SKEW_MS).
  async function cloudSignIn(leadMs: number) {
    const ours = { t: Date.UTC(2026, 10, 7, 16) }, cloudNow = () => ours.t + leadMs;
    const phone = newPhone(), secret = "synthetic-existing-network-authority-".repeat(2), rows = new Map<string, any>();
    const producer = networkDelegationService({
      secret, now: cloudNow,
      verifyBearer: async v => v === "verified-fixture" ? { userId: "fixture-steward", issuedAt: Math.floor(cloudNow() / 1000), expiration: Math.floor(cloudNow() / 1000) + 3600 } : null,
      primaryOwner: async () => ({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", stewardUserId: "fixture-steward", e164: phone, agentId: "personal:33333333-3333-4333-8333-333333333333", expiresAt: cloudNow() + 3600_000 }),
      blockedByLogout: async () => false, insert: async r => { rows.set(r.code_hash, r); }, claim: async k => { const r = rows.get(k); rows.delete(k); return r; },
    });
    const transport = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init), raw = await req.text(), b = JSON.parse(raw);
      expect(await networkDelegationServiceRequest(req, secret, raw, cloudNow())).toBe(true);
      const result = req.url.endsWith("/exchange") ? await producer.exchange(b.target, b.code, b.codeVerifier) : await producer.validate(b.target, b.proof);
      return req.url.endsWith("/exchange") ? Response.json(result ?? { ok: false }, { status: result ? 200 : 403 }) : Response.json(result ? { ok: true, identity: result } : { ok: false }, { status: result ? 200 : 403 });
    }, { preconnect() {} }) as typeof fetch;
    const env = { PLATFORM_ENV: "staging", STAGING_SITE_ORIGINS: JSON.stringify(NETWORK_FRESH_PERSON_SITES), NETWORK_CLOUD_AUTH_ENABLED: "true", NETWORK_CLOUD_AUTH_MODE: "own-pages-fresh-person-v1",
      NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud.eliza.app", NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api.eliza.app", SERVICE_TURN_SECRET: secret };
    const api = createPublicApi({ store, now: () => ours.t, hashKey: "synthetic-hash-key", sessionSecret: "synthetic-session-key", env, cloudAuthFetch: transport, cloudValidationTtlMs: 0, log: () => {},
      otp: { name: "unused", send: async () => { throw new Error("no OTP in Cloud mode"); } }, turnstile: { verify: async () => true } });
    const origin = NETWORK_FRESH_PERSON_SITES.slop, jar = new Map<string, string>();
    const request = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = (await api.fetch(new Request(origin + path, { ...init, headers })))!;
      for (const c of res.headers.getSetCookie()) { const pair = c.split(";")[0]!, i = pair.indexOf("="); if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1)); else jar.delete(pair.slice(0, i)); }
      return res;
    };
    const start = await request("/api/auth/cloud/start", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ returnPath: "/join" }) });
    expect(start.status).toBe(200);
    const login = new URL(((await start.json()) as { url: string }).url);
    const minted = await producer.mint("verified-fixture", networkTarget("slop", "fresh-person-20261015"), login.searchParams.get("challenge")!, login.searchParams.get("state")!);
    expect(minted).toBeDefined();
    const u = new URL(minted!.url);
    const callback = await request(u.pathname + u.search);
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { api, ours, request, callback, cookie, origin };
  }

  test("SD-181 a Cloud clock 5 s ahead still signs in on the production delegation path", async () => {
    const level = await cloudSignIn(0);
    expect(level.callback.status).toBe(303);
    const ahead = await cloudSignIn(5_000);
    expect(ahead.callback.status).toBe(303);
    // The next page load validates the stored proof, still inside the 5 s lead.
    expect((await ahead.request("/api/me")).status).toBe(200);
    // The MCP grant authority made from this sign-in is valid inside the lead too (api.ts validateCloudGrant).
    const resource = `${ahead.origin}/mcp`;
    const authority = await ahead.api.cloudGrantAuthority("slop", new Request(ahead.origin, { headers: { cookie: ahead.cookie() } }), resource);
    expect(authority && typeof authority === "object").toBe(true);
    const cloudAuthority = authority as Exclude<typeof authority, "unavailable" | undefined>;
    expect(await ahead.api.validateCloudGrant({ app: "slop", resource, phoneKey: cloudAuthority.phoneKey, personId: null, cloudAuthority })).toBe("valid");
    // A lead past the 30 s allowance is still refused.
    expect((await cloudSignIn(31_000)).callback.status).toBe(403);
  });
});
