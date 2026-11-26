// The public API's defences, on the memory store and on Postgres: parallel joins (PLAT-15), the lowest
// age as a property (PLAT-02), malformed cookies (PLAT-21), the canonical opt-in wording (PLAT-24),
// the body cap and the production host map (PLAT-27), CSRF and Origin checks, one SMS for parallel
// starts and the daily cap (PLAT-20, platform-26), and the same answer for known and unknown phones.
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
    onJoin: async ({ app, age, membership }) => { await sleep(5); joined.push({ app: app.id, age, member: membership.memberId }); },
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
        await c.api.accounts.leave(APPS[app], { e164: phone, personId: (await c.api.accounts.personFor(phone))?.id ?? null });
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
    const joinWith = (consent: { sms: boolean; wording?: unknown; version?: unknown }) =>
      c.call("peon", "POST", "/api/join", { firstName: "Ana", age: 30, consent }, { cookie });
    const approved = APPS.peon.consent;
    const bad = await joinWith({ sms: true, wording: "I agree to nothing in particular" });
    expect(bad.body).toEqual({ ok: false, error: "consent_wording" });
    const otherApp = await joinWith({ sms: true, wording: APPS.slop.consent.text, version: approved.version });
    expect(otherApp.body.error).toBe("consent_wording");
    for (const submitted of [
      { sms: true, wording: "   ", version: approved.version },
      { sms: true, wording: approved.text, version: null },
    ]) {
      expect((await joinWith(submitted)).body).toEqual({ ok: false, error: "invalid" });
    }
    expect(await store.findPhone(phone)).toBeUndefined();
    expect(await store.ageFloorRecord(c.api.accounts.phoneHash(phone))).toBeUndefined();
    expect(await store.consentEvents(phone, "peon")).toEqual([]);
    const ok = await joinWith({ sms: true, wording: `  ${approved.text.replace(/ /g, "\n ")} ` });
    expect(ok.status).toBe(200);
    expect((await joinWith({ sms: true, wording: approved.text, version: approved.version })).status).toBe(200);
    expect((await store.consentEvents(phone, "peon")).map(e => [e.wording, e.wordingVersion])).toEqual([[approved.text, approved.version]]);
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

  test("platform-3 a number not seen for 12 months (a possible new owner) logs in: no membership shown, export and delete answer 403 review, the old data stays", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await c.login("slop", phone);
    expect((await c.call("slop", "POST", "/api/join", { firstName: "Old", age: 31, consent: { sms: true, wording: APPS.slop.consent.text } }, { cookie })).status).toBe(200);
    const person = (await c.api.accounts.personFor(phone))!;
    // 13 months later someone with the number logs in again.
    c.clock.t += 395 * 24 * 3_600_000;
    const fresh = await c.login("slop", phone);
    expect(await c.api.accounts.held(phone)).toBe(true);
    const me = await c.call("slop", "GET", "/api/me", undefined, { cookie: fresh });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ membership: null, canJoin: false, reason: "review" });
    expect(me.text).not.toContain("Old");
    expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie: fresh })).body).toMatchObject({ ok: false, error: "review" });
    for (const scope of ["app", "all"]) expect((await c.call("slop", "POST", "/api/me/delete", { scope }, { cookie: fresh })).status).toBe(403);
    expect((await c.call("slop", "POST", "/api/join", { firstName: "New", age: 25, consent: { sms: true, wording: APPS.slop.consent.text } }, { cookie: fresh })).body).toMatchObject({ ok: false, error: "review" });
    expect((await store.memberships(person.id)).filter(m => m.state !== "removed").length).toBe(1);
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

  test("AE-1 a start that the phone limit refuses is counted in no bucket, so the address limit stays free for other numbers", async () => {
    const c = make(store), phone = newPhone(), ip = { "x-real-ip": "198.18.7.1" };
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) { statuses.push((await c.call("slop", "POST", "/api/auth/otp/start", { phone }, ip)).status); c.clock.t += 31_000; }
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429, 429, 429, 429, 429]);
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone: newPhone() }, ip)).status).toBe(200);
  });

  test("AE-2 a banned number gets the same answers and limits as any number at code start, and no code", async () => {
    const c = make(store), banned = newPhone(), plain = newPhone();
    await store.ban({ id: `ban_otp_${process.pid}_${seq}`, scope: "phone", personId: null, phoneHash: c.api.accounts.phoneHash(banned), reason: "test", reportId: null, bannedBy: "staff", at: c.clock.t });
    const starts = async (phone: string, ip: string) => {
      const out: Array<[number, string]> = [];
      for (let i = 0; i < 4; i++) { const r = await c.call("slop", "POST", "/api/auth/otp/start", { phone }, { "x-real-ip": ip }); out.push([r.status, r.text]); c.clock.t += 31_000; }
      return out;
    };
    const before = c.sends();
    const seenBanned = await starts(banned, "198.18.8.1");
    expect(c.sends()).toBe(before);
    const seenPlain = await starts(plain, "198.18.8.2");
    expect(c.sends()).toBe(before + 3);
    expect(seenBanned).toEqual(seenPlain);
    expect(seenBanned.map(([status]) => status)).toEqual([200, 200, 200, 429]);
  });

  test("banned number gets no SMS, verify fails, and pre-ban session export returns review", async () => {
    const c = make(store);
    const ban = (phone: string) => store.ban({ id: `ban_sec_${phone}`, scope: "phone", personId: null, phoneHash: c.api.accounts.phoneHash(phone), reason: "sim", reportId: null, bannedBy: "staff:1", at: c.clock.t });
    const banned = newPhone(), late = newPhone();
    await ban(banned);
    const beforeSends = c.sends();
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone: banned })).status).toBe(200);
    expect(c.sends()).toBe(beforeSends);
    const cookie = await c.login("friends", late);
    await ban(late);
    const exp = await c.call("friends", "GET", "/api/me/export", undefined, { cookie });
    expect([exp.status, exp.body.error]).toEqual([401, "unauthorized"]);
  });
});

describe("production host map", () => {
  test("outside dev, localhost names are no app, and cookies are __Host- and Secure", async () => {
    const api = createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "production" }, hashKey: "h".repeat(40), sessionSecret: "s".repeat(40), turnstile: { verify: async () => true }, otp: { name: "f", send: async () => ({ code: "123456" }) }, minStartMs: 0, minVerifyMs: 0, log: () => {} });
    expect((await api.fetch(new Request("http://localhost:5102/api/app", { headers: { host: "localhost:5102" } })))!.status).toBe(404);
    expect(await (await api.fetch(new Request("https://slop.date/api/app", { headers: { host: "slop.date" } })))!.json()).toMatchObject({ id: "slop" });
  });

  test("an Origin with the site's host on plain http is refused outside loopback dev", async () => {
    const hostMap = { "slop.date": "slop" as const };
    const prod = createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "production" }, hostMap, hashKey: "k".repeat(40), sessionSecret: "s".repeat(40), minStartMs: 0, log: () => {}, turnstile: { verify: async () => true }, otp: { name: "fake", send: async () => ({ code: "123456" }) } });
    const start = (origin: string) => prod.fetch(new Request("https://slop.date/api/auth/otp/start", { method: "POST", headers: { host: "slop.date", "content-type": "application/json", origin }, body: JSON.stringify({ phone: "+12125559901" }) }));
    expect((await start("http://slop.date"))!.status).toBe(403);
    expect((await start("https://slop.date"))!.status).toBe(200);
  });
});

test("the join flow sends no code and opens no cloud sign-in during mode discovery, then uses text codes on otp or a 404, and the cloud sign-in on cloud", async () => {
  const machine = await import("../../core/src/generated/browserJoin.ts");
  const { readAuthLookup, startCloud, startCode } = await import("../../ui/src/api/join.ts");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const realFetch = globalThis.fetch;
  const send = (page: import("../../core/src/generated/browserJoin.ts").JoinPage, event: import("../../core/src/generated/browserJoin.ts").Event) => {
    expect([event.type, machine.enabled(page, event)]).toEqual([event.type, true]);
    return machine.step(page, event);
  };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://peon.biz/join" } } });
    for (const mode of ["otp", "404", "cloud"] as const) {
      const requests: { path: string; body: unknown }[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = String(input);
        requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (path === "/api/auth/mode") return mode === "404" ? Response.json({ ok: false, error: "not_found" }, { status: 404 }) : Response.json({ mode });
        if (path === "/api/auth/otp/start") return Response.json({ ok: true });
        if (path === "/api/auth/cloud/start") return Response.json({ url: "https://cloud-staging.eliza.app/network/sign-in" });
        return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }) as typeof fetch;
      let page = send(machine.initial, { type: "openPage", viaAgent: false, fragmentName: false });
      page = send(page, { type: "loaded", view: { result: "SignedOut", account: 0, reason: "NoBlock" }, appUnreachable: false, inviteOnly: false });
      expect(machine.phoneFormWaiting(page)).toBe(true);
      expect(machine.enabled(page, { type: "submitPhone", phoneValid: true })).toBe(false);
      expect(machine.enabled(page, { type: "continueWithPhone" })).toBe(false);
      expect(machine.canReadAuthMode(page)).toBe(true);
      const lookup = await readAuthLookup();
      expect(lookup).toBe(mode === "cloud" ? "ModeCloud" : mode === "otp" ? "ModeOtp" : "LookupFailed");
      expect(requests.map((r) => r.path)).toEqual(["/api/auth/mode"]);
      page = send(page, { type: "readAuthMode", lookup, checkOn: false });
      expect(machine.phoneFormWaiting(page)).toBe(false);
      if (mode === "cloud") {
        expect([machine.showsCloudButton(page), machine.enabled(page, { type: "submitPhone", phoneValid: true })]).toEqual([true, false]);
        page = send(page, { type: "continueWithPhone" });
        expect(machine.canAnswerCloudStart(page)).toBe(true);
        const answer = await startCloud("/join");
        expect(answer).toEqual({ ok: true, url: "https://cloud-staging.eliza.app/network/sign-in" });
        expect(requests.at(-1)).toEqual({ path: "/api/auth/cloud/start", body: { returnPath: "/join" } });
        expect(send(page, { type: "answerCloudStart", opened: true }).screen).toBe("LeftForCloud");
      } else {
        expect([machine.showsNumberForm(page), machine.enabled(page, { type: "continueWithPhone" })]).toEqual([true, false]);
        page = send(page, { type: "submitPhone", phoneValid: true });
        expect(machine.canAnswerCodeStart(page)).toBe(true);
        expect(await startCode("+12125550101")).toEqual({ result: "CodeSent" });
        expect(requests.at(-1)).toEqual({ path: "/api/auth/otp/start", body: { phone: "+12125550101" } });
        expect(send(page, { type: "answerCodeStart", started: "CodeSent" }).screen).toBe("Code");
      }
      expect(requests.filter((r) => r.path !== "/api/auth/mode")).toHaveLength(1);
    }
  } finally {
    globalThis.fetch = realFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
  }
});
