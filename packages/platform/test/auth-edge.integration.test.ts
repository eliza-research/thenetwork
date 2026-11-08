// The auth edge machines (quint/auth_edge.qnt) through the real public API on Postgres: the web OTP
// challenge, the web session and the rate buckets of a code send. Each case is a trace from the model
// findings (docs/research/quint-findings/auth_edge.md) that failed before its fix.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import { APPS, type AppId } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
let seq = 0;
const newPhone = () => { seq++; return `+1646555${String(1000 + seq)}`; };

function make(store: PgPeopleStore, opts: { globalPerHour?: number } = {}) {
  const clock = { t: Date.UTC(2026, 10, 7, 15) };
  const codes = new Map<string, string>();
  const sent: string[] = [];
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev" }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {},
    ipOf: req => req.headers.get("x-real-ip") ?? "198.51.100.10",
    otpLimits: opts.globalPerHour !== undefined ? { globalPerHour: opts.globalPerHour } : undefined,
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
});
