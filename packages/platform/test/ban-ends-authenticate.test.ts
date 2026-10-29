// A staff ban must refuse every live web session (docs/go-live-handoff.md): authenticate returns
// undefined and /api/me + /api/me/export answer 401. Complements #172 (eager revoke at ban time) and
// #163 (refuse new OTP). This file owns the SessionService choke point only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import { keyedHash } from "../src/phone.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { MemoryPeopleStore, type PeopleStore } from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
let seq = 0;
const newPhone = () => { seq++; return `+1${String(312 + Math.floor(seq / 100))}55501${String(seq % 100).padStart(2, "0")}`; };

function make(store: PeopleStore) {
  const clock = { t: Date.UTC(2026, 9, 9, 15) };
  const codes = new Map<string, string>();
  let sends = 0;
  const hashKey = "dev-only-platform-hash-key";
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: hashKey }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {},
    ipOf: req => req.headers.get("x-real-ip") ?? "198.51.100.200",
    otp: { name: "fake", send: async e164 => { sends++; const code = String(100000 + ((sends * 7919) % 900000)); codes.set(e164, code); return { code }; } },
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
  return { api, clock, call, login, hashKey };
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });
const stores = [
  { name: "memory", skip: false, make: async (): Promise<PeopleStore> => new MemoryPeopleStore() },
  { name: "postgres", skip: !pgAvailable, make: async (): Promise<PeopleStore> => { const u = await migratedDb("banauth"); urls.push(u); return new PgPeopleStore(u); } },
];

for (const s of stores) describe.skipIf(s.skip)(`ban ends authenticate (${s.name})`, () => {
  let store: PeopleStore;
  beforeAll(async () => { store = await s.make(); }, 120_000);
  afterAll(async () => { await (store as PgPeopleStore).close?.(); });

  test("after a person ban, authenticate refuses and /api/me + export answer 401", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await c.login("slop", phone);
    expect((await c.call("slop", "POST", "/api/join", { firstName: "Ana", age: 30, consent: { sms: true, wording: APPS.slop.consent.text } }, { cookie })).status).toBe(200);
    expect((await c.call("slop", "GET", "/api/me", undefined, { cookie })).status).toBe(200);
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie })).status).toBe(200);

    const person = (await c.api.accounts.personFor(phone))!;
    const phoneHash = keyedHash(c.hashKey, `phone:${phone}`);
    await store.ban({ id: `ban_${phone}`, scope: "person", personId: person.id, phoneHash, reason: "abuse", reportId: null, bannedBy: "staff", at: c.clock.t });

    const token = cookie.split("=")[1]!;
    expect(await c.api.sessions.authenticate("slop", token)).toBeUndefined();
    // Lazy revoke: a second look is still refused.
    expect(await c.api.sessions.authenticate("slop", token)).toBeUndefined();
    expect((await c.call("slop", "GET", "/api/me", undefined, { cookie })).status).toBe(401);
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie })).status).toBe(401);
  });

  test("a phone-scope ban on the session's number also refuses authenticate", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await c.login("friends", phone);
    // Login alone may not create a person yet; a phone-scope ban keys only the hash.
    const phoneHash = keyedHash(c.hashKey, `phone:${phone}`);
    await store.ban({ id: `ban_phone_${phone}`, scope: "phone", personId: null, phoneHash, reason: "spam", reportId: null, bannedBy: "staff", at: c.clock.t });
    const token = cookie.split("=")[1]!;
    expect(await c.api.sessions.authenticate("friends", token)).toBeUndefined();
    expect((await c.call("friends", "GET", "/api/me", undefined, { cookie })).status).toBe(401);
  });
});
