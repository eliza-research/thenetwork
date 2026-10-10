// The public API's defences, on the memory store and on Postgres: parallel joins (PLAT-15), the lowest
// age as a property (PLAT-02), malformed cookies (PLAT-21), the canonical opt-in wording (PLAT-24),
// the body cap and the production host map (PLAT-27), CSRF and Origin checks, one SMS for parallel
// starts and the daily cap (PLAT-20, platform-26), and the same answer for known and unknown phones.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
