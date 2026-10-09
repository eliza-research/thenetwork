// The public API end to end through createPublicApi().fetch, with a fake OTP provider (nothing is
// sent) and a test clock. Every case runs on the memory store and on Postgres (PgPeopleStore).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APPS, type AppId, type AppInfo } from "../src/apps.ts";
import { createPublicApi, type PublicApi, type PublicApiOptions } from "../src/api.ts";
import { detectKeyword, keywordEvent, lastEvents, resolveConsent, stopScope } from "../src/consent.ts";
import type { OtpProvider } from "../src/otp.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { MemoryPeopleStore, type PeopleStore } from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOSTS: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
/** What a site sends next to the ticked box: the app's own opt-in text (GET /api/app returns it). */
const consentOf = (app: AppId) => ({ sms: true, wording: APPS[app].consent.text });

/** Records each code it "sends". Nothing leaves the process. */
class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) {
    this.sent++;
    const code = String(100000 + Math.floor(this.sent * 7919) % 900000);
    this.codes.set(e164, code);
    return { code };
  }
}

interface Ctx { ip: string; api: PublicApi; store: PeopleStore; otp: FakeOtp; clock: { t: number }; forgotten: string[]; joined: string[]; ages: number[] }

let phoneSeq = 0, ipSeq = 0;
/** A fresh fictional number per call (555-01xx is reserved for fiction). */
const newPhone = () => { phoneSeq++; return `+1${String(212 + Math.floor(phoneSeq / 100))}55501${String(phoneSeq % 100).padStart(2, "0")}`; };

function make(store: PeopleStore, extra: Partial<PublicApiOptions> = {}): Ctx {
  const clock = { t: Date.UTC(2026, 9, 8, 15) };
  const otp = new FakeOtp();
  const forgotten: string[] = [], joined: string[] = [], ages: number[] = [];
  const api = createPublicApi({
    // x-real-ip stands for the client IP a signed site router passes (proxy.ts); the proxy tests check the real rule.
    store, otp, now: () => clock.t, env: { PLATFORM_ENV: "dev" }, ipOf: req => req.headers.get("x-real-ip") ?? "unknown", minStartMs: 40, minVerifyMs: 0, log: () => {},
    onJoin: ({ membership, age }) => { joined.push(membership.memberId); ages.push(age); },
    onForget: ({ memberId }) => { forgotten.push(memberId); },
    onExport: ({ memberId }) => ({ memberId, facets: [] }),
    ...extra,
  });
  return { ip: `198.51.100.${++ipSeq}`, api, store, otp, clock, forgotten, joined, ages };
}

async function call(c: Ctx, app: AppId, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  const res = (await c.api.fetch(new Request(`http://${HOSTS[app]}${path}`, {
    method, headers: { host: HOSTS[app], "x-real-ip": c.ip, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })))!;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text, setCookie: res.headers.get("set-cookie") ?? "" };
}

/** OTP login on one app's site. Returns the cookie header to send back. */
async function login(c: Ctx, app: AppId, phone: string): Promise<string> {
  expect((await call(c, app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
  const v = await call(c, app, "POST", "/api/auth/otp/verify", { phone, code: c.otp.codes.get(phone) });
  expect(v.status).toBe(200);
  c.clock.t += 31_000; // past the 30 s gap between sends to a number
  return v.setCookie.split(";")[0]!;
}

const join = (c: Ctx, app: AppId, cookie: string, age: number, firstName = "Ana") =>
  call(c, app, "POST", "/api/join", { firstName, age, neighborhood: "Astoria", interests: ["climbing"], consent: consentOf(app) }, cookie);

const stores: { name: string; make: () => Promise<PeopleStore>; skip: boolean }[] = [
  { name: "memory", make: async () => new MemoryPeopleStore(), skip: false },
  { name: "postgres", make: async () => { const url = await migratedDb("api"); pgUrls.push(url); return new PgPeopleStore(url); }, skip: !pgAvailable },
];
const pgUrls: string[] = [];
afterAll(async () => { for (const u of pgUrls) await dropDb(u); });

for (const s of stores) describe.skipIf(s.skip)(`public API (${s.name} store)`, () => {
  let store: PeopleStore;
  beforeAll(async () => { store = await s.make(); }, 120_000);
  afterAll(async () => { await (store as PgPeopleStore).close?.(); });

  test("OTP login, /api/me, join, logout; the session belongs to one app", async () => {
    const c = make(store), phone = newPhone();
    expect((await call(c, "slop", "GET", "/api/me")).status).toBe(401);
    const cookie = await login(c, "slop", phone);
    expect(cookie).toStartWith("sid_slop=");
    const me = await call(c, "slop", "GET", "/api/me", undefined, cookie);
    expect(me.body).toEqual({ app: "slop", phoneMasked: `+1 •••-•••-${phone.slice(-4)}`, membership: null, canJoin: true });
    const j = await join(c, "slop", cookie, 29);
    expect(j.status).toBe(200);
    expect(j.body.membership).toMatchObject({ state: "active", firstName: "Ana" });
    expect(c.joined.length).toBe(1);
    expect((await call(c, "slop", "GET", "/api/me", undefined, cookie)).body).toMatchObject({ membership: { state: "active" }, canJoin: false });
    // The dev ports share cookies: a slop session is not a peon session.
    expect((await call(c, "peon", "GET", "/api/me", undefined, cookie.replace("sid_slop", "sid_peon"))).status).toBe(401);
    expect((await call(c, "slop", "POST", "/api/auth/logout", {}, cookie)).status).toBe(200);
    expect((await call(c, "slop", "GET", "/api/me", undefined, cookie)).status).toBe(401);
  });

  test("otp/start: the same status and body for a known and an unknown phone, and at least the minimum time", async () => {
    const c = make(store), known = newPhone(), unknown = newPhone();
    await join(c, "friends", await login(c, "friends", known), 30);
    const time = async (phone: string) => { const t0 = performance.now(); const r = await call(c, "friends", "POST", "/api/auth/otp/start", { phone }); return { r, ms: performance.now() - t0 }; };
    const a = await time(known), b = await time(unknown);
    expect([a.r.status, a.r.text]).toEqual([b.r.status, b.r.text]);
    expect(a.r.body).toEqual({ ok: true });
    expect(Math.min(a.ms, b.ms)).toBeGreaterThanOrEqual(38);
    // A non-+1 number is refused as input, the same for everyone.
    expect((await call(c, "friends", "POST", "/api/auth/otp/start", { phone: "+44 20 7946 0958" })).body).toEqual({ ok: false, error: "invalid_phone" });
  });

  test("rate limits: 3 sends per number per hour, 30 s between sends, 10 per IP per hour", async () => {
    const c = make(store), phone = newPhone();
    const start = (p: string, ip = "203.0.113.9") => call(c, "peon", "POST", "/api/auth/otp/start", { phone: p }, undefined, { "x-real-ip": ip });
    c.clock.t = Date.UTC(2026, 9, 8, 16, 0, 1); // the start of an hour window
    expect((await start(phone)).status).toBe(200);
    const fast = await start(phone);
    expect(fast.status).toBe(429);
    expect(fast.body).toEqual({ ok: false, error: "rate_limited" });
    c.clock.t += 31_000; // the refused try was not counted (platform-12): send 2 of 3
    expect((await start(phone)).status).toBe(200);
    c.clock.t += 31_000;
    expect((await start(phone)).status).toBe(200);
    c.clock.t += 31_000;
    expect((await start(phone)).status).toBe(429); // 4th in the hour
    c.clock.t = Date.UTC(2026, 9, 8, 17, 0, 1);
    expect((await start(phone)).status).toBe(200);
    // Per IP: 10 sends an hour from one address, whatever the numbers.
    const ip = "203.0.113.77";
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await start(newPhone(), ip)).status);
    expect(codes).toEqual([...Array(10).fill(200), 429]);
  });

  test("verify: 5 wrong codes use the challenge up; a code expires after 10 minutes; a code works once", async () => {
    const c = make(store), phone = newPhone();
    await call(c, "friends", "POST", "/api/auth/otp/start", { phone });
    const right = c.otp.codes.get(phone)!, wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await call(c, "friends", "POST", "/api/auth/otp/verify", { phone, code: wrong })).body).toEqual({ ok: false, error: "invalid_code" });
    expect((await call(c, "friends", "POST", "/api/auth/otp/verify", { phone, code: right })).status).toBe(400);

    c.clock.t += 31_000;
    await call(c, "friends", "POST", "/api/auth/otp/start", { phone });
    c.clock.t += 10 * 60_000 + 1;
    expect((await call(c, "friends", "POST", "/api/auth/otp/verify", { phone, code: c.otp.codes.get(phone) })).status).toBe(400);

    await call(c, "friends", "POST", "/api/auth/otp/start", { phone });
    const code = c.otp.codes.get(phone);
    expect((await call(c, "friends", "POST", "/api/auth/otp/verify", { phone, code })).status).toBe(200);
    expect((await call(c, "friends", "POST", "/api/auth/otp/verify", { phone, code })).status).toBe(400);
  });

  test("an under-age join stores nothing for that app (a new phone: no person, no phone, no consent)", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await login(c, "slop", phone);
    const r = await join(c, "slop", cookie, 12);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("under_age");
    expect(await store.findPhone(phone)).toBeUndefined();
    expect(await store.lastConsent(phone, "slop")).toEqual({});
    expect(c.joined.length).toBe(0);
  });

  test("age is person-level: 15 on ntwrk (invited), then 25 on slop joins as 15 (a minor: never matched)", async () => {
    const c = make(store), phone = newPhone();
    const ntwrk = await login(c, "ntwrk", phone);
    expect((await join(c, "ntwrk", ntwrk, 15)).body.error).toBe("invite_only");
    const inv = await c.api.accounts.invite(APPS.ntwrk, phone);
    expect((await call(c, "ntwrk", "GET", "/api/me", undefined, ntwrk)).body).toMatchObject({ membership: { state: "invited" }, canJoin: true });
    expect((await join(c, "ntwrk", ntwrk, 15)).status).toBe(200);
    // The join keeps the invited member id (an invite may already name it).
    expect(c.joined.at(-1)).toBe(inv!.memberId);
    const slop = await login(c, "slop", phone);
    // /api/me shows no age from another app (the age is checked at the join only).
    expect((await call(c, "slop", "GET", "/api/me", undefined, slop)).body).toEqual({ app: "slop", phoneMasked: expect.any(String), membership: null, canJoin: true });
    const r = await join(c, "slop", slop, 25);
    expect(r.status).toBe(200);
    // The network member gets the person's lowest age, not the age typed on this site.
    expect(c.ages.at(-1)).toBe(15);
    const person = await c.api.accounts.personFor(phone);
    expect((await store.memberships(person!.id)).map(m => `${m.app}:${m.state}`).sort()).toEqual(["ntwrk:active", "slop:active"]);
    expect(person!.lowestAge).toBe(15);
  });

  test("a second app finds the same person; export holds only that app; leave one app keeps the other", async () => {
    const c = make(store), phone = newPhone();
    await join(c, "friends", await login(c, "friends", phone), 31, "Ben");
    const slop = await login(c, "slop", phone);
    await join(c, "slop", slop, 31, "Benji");
    const person = await c.api.accounts.personFor(phone);
    const ms = await store.memberships(person!.id);
    expect(ms.map(m => m.app).sort()).toEqual(["friends", "slop"]);
    const friendsMember = ms.find(m => m.app === "friends")!.memberId;

    const ex = await call(c, "slop", "GET", "/api/me/export", undefined, slop);
    expect(ex.status).toBe(200);
    expect(ex.body.app).toBe("slop");
    expect(ex.body.membership.firstName).toBe("Benji");
    expect(ex.text).not.toContain("friends.help");
    expect(ex.text).not.toContain("Ben\"");
    expect(ex.text).not.toContain(friendsMember);
    expect(ex.body.consent.map((e: any) => e.state)).toEqual(["opted_in"]);

    // Share needs both memberships; the grant names only base-profile fields. The answer is the same
    // whether or not the person uses the other app (it must not list their apps).
    expect((await call(c, "slop", "POST", "/api/me/share", { fromApp: "friends", fields: ["orientation"] }, slop)).status).toBe(200);
    const notMember = await call(c, "slop", "POST", "/api/me/share", { fromApp: "peon", fields: ["first_name"] }, slop);
    expect([notMember.status, notMember.body]).toEqual([200, { ok: true }]);
    expect(await store.shareGrants(person!.id)).toEqual([]);
    expect((await call(c, "slop", "POST", "/api/me/share", { fromApp: "friends", fields: ["first_name", "city"] }, slop)).status).toBe(200);
    expect((await store.shareGrants(person!.id)).map(g => `${g.fromApp}>${g.toApp}:${g.fields.join(",")}`)).toEqual(["friends>slop:first_name,city"]);

    expect((await call(c, "slop", "POST", "/api/me/delete", { scope: "app" }, slop)).status).toBe(200);
    expect(c.forgotten.length).toBe(1);
    const after = await store.memberships(person!.id);
    expect(after.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:active", "slop:removed"]);
    expect(after.find(m => m.app === "slop")!.firstName).toBeNull();
    expect((await store.shareGrants(person!.id))[0]!.revokedAt).not.toBeNull();
    expect(await c.api.accounts.optedIn("slop", phone)).toBe(false);
    expect(await c.api.accounts.optedIn("friends", phone)).toBe(true);
  });

  test("delete all: every membership forgotten, phone and sessions gone, a tombstone and the suppression hash stay", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await login(c, "friends", phone);
    await join(c, "friends", cookie, 40);
    await join(c, "peon", await login(c, "peon", phone), 40);
    const person = await c.api.accounts.personFor(phone);
    const r = await call(c, "friends", "POST", "/api/me/delete", { scope: "all" }, cookie);
    expect(r.status).toBe(200);
    expect(r.setCookie).toContain("Max-Age=0");
    expect(c.forgotten.length).toBe(2);
    expect(await store.findPhone(phone)).toBeUndefined();
    expect(await store.memberships(person!.id)).toEqual([]);
    const tomb = await store.getPerson(person!.id);
    expect(tomb!.deletedAt).not.toBeNull();
    expect(tomb!.lowestAge).toBeNull();
    expect(await store.isSuppressed(c.api.accounts.phoneHash(phone))).toBe(true);
    expect(await store.lastConsent(phone, "friends")).toEqual({});
    expect((await call(c, "friends", "GET", "/api/me", undefined, cookie)).status).toBe(401);
    // The suppression hash is read: a staff invite to a number that deleted everything is refused.
    expect(await c.api.accounts.invite(APPS.ntwrk, phone)).toBeUndefined();
    // A fresh join (a new opt-in by the person) lifts it.
    await join(c, "peon", await login(c, "peon", phone), 40);
    expect(await store.isSuppressed(c.api.accounts.phoneHash(phone))).toBe(false);
  });

  test("PLAT-01 the under-age refusal is sticky: refused at 12, a retry at 25 is refused in the same and in a new session (web)", async () => {
    // Before the fix an under-age refusal stored nothing, so the same session joined at once by saying 25.
    const c = make(store), phone = newPhone();
    const cookie = await login(c, "slop", phone);
    expect((await join(c, "slop", cookie, 12)).body.error).toBe("under_age");
    expect((await join(c, "slop", cookie, 25)).body.error).toBe("under_age");
    expect((await join(c, "peon", await login(c, "peon", phone), 30)).body.error).toBe("under_age");
    expect(await store.findPhone(phone)).toBeUndefined(); // still nothing stored for the app: only the age floor
    expect(await store.ageFloor(c.api.accounts.phoneHash(phone))).toBe(12);
  });

  test("PLAT-03 delete everything keeps the age floor and the blocks: 15, deleted, back at 25 is still 15; a block still holds", async () => {
    const c = make(store), phone = newPhone(), other = newPhone();
    await c.api.accounts.invite(APPS.ntwrk, phone);
    const n = await login(c, "ntwrk", phone);
    expect((await join(c, "ntwrk", n, 15)).status).toBe(200);
    await join(c, "friends", await login(c, "friends", other), 30, "Bo");
    const me = (await c.api.accounts.personFor(phone))!, bo = (await c.api.accounts.personFor(other))!;
    await store.block(bo.id, me.id, "friends", c.clock.t);
    const fresh = await login(c, "ntwrk", phone);
    expect((await call(c, "ntwrk", "POST", "/api/me/delete", { scope: "all" }, fresh)).status).toBe(200);
    const s2 = await login(c, "slop", phone);
    expect((await join(c, "slop", s2, 25)).status).toBe(200);
    expect(c.ages.at(-1)).toBe(15);
    const back = (await c.api.accounts.personFor(phone))!;
    expect(back.id).toBe(me.id); // the same person again, so blocks against them hold
    expect(back.lowestAge).toBe(15);
    expect(await store.isBlocked(bo.id, back.id)).toBe(true);
  });

  test("a recycled number: after 12 months unseen, a login is put on hold and cannot see or change the old owner's account", async () => {
    const c = make(store), phone = newPhone();
    const old = await login(c, "friends", phone);
    await call(c, "friends", "POST", "/api/join", { firstName: "Olivia", age: 34, about: "private bio", consent: consentOf("friends") }, old);
    c.clock.t += 400 * 24 * 3_600_000;
    const cookie = await login(c, "friends", phone);
    const me = await call(c, "friends", "GET", "/api/me", undefined, cookie);
    expect(me.body).toEqual({ app: "friends", phoneMasked: expect.any(String), membership: null, canJoin: false, reason: "review" });
    expect(me.text).not.toContain("Olivia");
    for (const [m, path, b] of [["GET", "/api/me/export", undefined], ["POST", "/api/me/delete", { scope: "all" }], ["POST", "/api/me/delete", { scope: "app" }]] as const) {
      const r = await call(c, "friends", m, path, b, cookie);
      expect([path, r.status, r.body.error]).toEqual([path, 403, "review"]);
      expect(r.text).not.toContain("private bio");
    }
    expect((await join(c, "slop", await login(c, "slop", phone), 30)).body.error).toBe("review");
    expect((await c.api.accounts.heldPhones()).map(h => h.e164)).toContain(phone);
    // Staff decide: a new owner. The old account is forgotten and the number starts clean.
    const oldId = (await store.findPhone(phone))!.personId;
    expect(await c.api.accounts.clearHold(phone, "new_owner")).toBe(true);
    expect(c.forgotten.length).toBe(1);
    const fresh = await login(c, "friends", phone);
    expect((await call(c, "friends", "GET", "/api/me", undefined, fresh)).body).toMatchObject({ membership: null, canJoin: true });
    expect((await join(c, "friends", fresh, 30, "Nia")).status).toBe(200);
    // The new owner is a new person: the old owner's tombstone (and its blocks) is never revived for them.
    expect((await c.api.accounts.personFor(phone))!.id).not.toBe(oldId);
  });

  test("an active member's login moves last-seen on, so a later join is not held", async () => {
    const c = make(store), phone = newPhone();
    await join(c, "friends", await login(c, "friends", phone), 30);
    for (let i = 0; i < 3; i++) { c.clock.t += 200 * 24 * 3_600_000; await login(c, "friends", phone); }
    const r = await join(c, "peon", await login(c, "peon", phone), 30);
    expect([r.status, r.body.membership?.state]).toEqual([200, "active"]);
  });

  test("a global web STOP from an app the person has no membership on still pauses their other apps", async () => {
    const stopped: string[] = [];
    const c = make(store, { env: { PLATFORM_ENV: "dev", PLATFORM_STOP_SCOPE: "global" }, onStop: ({ personId, memberId, scope }) => { stopped.push(`${personId}:${memberId ?? "-"}:${scope}`); } });
    const phone = newPhone();
    await join(c, "peon", await login(c, "peon", phone), 30);
    const person = await c.api.accounts.personFor(phone);
    expect((await call(c, "slop", "POST", "/api/me/stop", {}, await login(c, "slop", phone))).status).toBe(200);
    expect(stopped).toEqual([`${person!.id}:-:global`]);
    expect(await c.api.accounts.optedIn("peon", phone)).toBe(false);
  });

  test("OTP: one number gets 3 codes an hour across every app; a spoofed IP header picks no bucket without a trusted proxy", async () => {
    const c = make(store), phone = newPhone();
    c.clock.t = Date.UTC(2026, 9, 9, 10, 0, 1);
    const codes: number[] = [];
    for (const app of ["slop", "peon", "friends", "ntwrk"] as AppId[]) { codes.push((await call(c, app, "POST", "/api/auth/otp/start", { phone })).status); c.clock.t += 31_000; }
    expect(codes).toEqual([200, 200, 200, 429]);
    // No trusted header configured: X-Forwarded-For and CF-Connecting-IP are the client's own words.
    const open = make(store, { ipOf: undefined, env: { PLATFORM_ENV: "dev" } });
    open.clock.t = Date.UTC(2026, 9, 9, 12, 0, 1);
    const spoofed: number[] = [];
    for (let i = 0; i < 12; i++) spoofed.push((await open.api.fetch(new Request(`http://${HOSTS.slop}/api/auth/otp/start`, {
      method: "POST", headers: { host: HOSTS.slop, "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}`, "cf-connecting-ip": `10.1.0.${i}` },
      body: JSON.stringify({ phone: newPhone() }),
    }), { requestIP: () => ({ address: "192.0.2.50" }) }))!.status);
    expect(spoofed).toEqual([...Array(10).fill(200), 429, 429]);
  });

  test("OTP: a global hourly budget, and code checks are limited per number across apps", async () => {
    const logs: string[] = [];
    const c = make(store, { otpLimits: { globalPerHour: 2 }, log: s => logs.push(s) });
    c.clock.t = Date.UTC(2026, 9, 10, 9, 0, 1);
    const st = async () => (await call(c, "slop", "POST", "/api/auth/otp/start", { phone: newPhone() }, undefined, { "x-real-ip": `198.18.0.${++ipSeq % 250}` })).status;
    expect([await st(), await st(), await st()]).toEqual([200, 200, 429]);
    expect(logs.some(l => l.includes("ALERT"))).toBe(true);
    const d = make(store), phone = newPhone();
    d.clock.t = Date.UTC(2026, 9, 10, 11, 0, 1);
    const results: number[] = [];
    for (const app of ["slop", "peon", "friends"] as AppId[]) {
      await call(d, app, "POST", "/api/auth/otp/start", { phone }); d.clock.t += 31_000;
      for (let i = 0; i < 4; i++) results.push((await call(d, app, "POST", "/api/auth/otp/verify", { phone, code: "999999" })).status);
    }
    // 12 wrong tries: the 11th and 12th are refused before any check. Then even the right code is refused this hour.
    expect(results.every(r => r === 400)).toBe(true);
    expect((await call(d, "friends", "POST", "/api/auth/otp/verify", { phone, code: d.otp.codes.get(phone) })).status).toBe(400);
    d.clock.t += 3_600_000;
    await call(d, "friends", "POST", "/api/auth/otp/start", { phone });
    expect((await call(d, "friends", "POST", "/api/auth/otp/verify", { phone, code: d.otp.codes.get(phone) })).status).toBe(200);
  });

  test("a rotated session keeps working for a short grace time (requests in flight are not logged out)", async () => {
    const c = make(store), phone = newPhone();
    const cookie = await login(c, "slop", phone);
    c.clock.t += 25 * 3_600_000;
    const a = await call(c, "slop", "GET", "/api/me", undefined, cookie);
    expect(a.status).toBe(200);
    expect(a.setCookie).toContain("sid_slop=");
    expect((await call(c, "slop", "GET", "/api/me", undefined, cookie)).status).toBe(200); // in flight with the old cookie
    c.clock.t += 61_000;
    expect((await call(c, "slop", "GET", "/api/me", undefined, cookie)).status).toBe(401);
    expect((await call(c, "slop", "GET", "/api/me", undefined, a.setCookie.split(";")[0])).status).toBe(200);
  });

  test("PLAT-12 STOP on the web stops every app by default (PRD 40.3); only PLATFORM_STOP_SCOPE=app keeps it to one app; leave is one app", async () => {
    for (const env of [{ PLATFORM_ENV: "dev" }, { PLATFORM_ENV: "dev", PLATFORM_STOP_SCOPE: "app" }] as Record<string, string>[]) {
      const c = make(store, { env }), phone = newPhone();
      const b = await login(c, "friends", phone);
      await join(c, "friends", b, 33);
      await join(c, "peon", await login(c, "peon", phone), 33);
      expect((await call(c, "friends", "POST", "/api/me/stop", {}, b)).status).toBe(200);
      expect(await c.api.accounts.optedIn("friends", phone)).toBe(false);
      expect(await c.api.accounts.optedIn("peon", phone)).toBe(env.PLATFORM_STOP_SCOPE === "app");
      // The default STOP records one event for every app (app null).
      if (!env.PLATFORM_STOP_SCOPE) expect((await store.lastConsent(phone, "slop")).global).toMatchObject({ app: null, state: "opted_out" });
    }
    // The leave button: that app only.
    const c = make(store), phone = newPhone();
    const f = await login(c, "friends", phone);
    await join(c, "friends", f, 33);
    await join(c, "peon", await login(c, "peon", phone), 33);
    expect((await call(c, "friends", "POST", "/api/me/delete", { scope: "app" }, f)).status).toBe(200);
    expect([await c.api.accounts.optedIn("friends", phone), await c.api.accounts.optedIn("peon", phone)]).toEqual([false, true]);
  });

  test("the app comes from the Host; a different explicit app, an unknown host and a cross-site Origin are refused", async () => {
    const c = make(store);
    expect((await call(c, "peon", "GET", "/api/app")).body).toEqual({
      id: "peon", name: "peon", domain: "peon.biz", joinMode: "open", minJoinAge: 13, minMatchAge: 18, keywords: ["peon", "peon.biz", "www.peon.biz"],
      poweredBy: "All of these apps are powered by The Network.", consent: APPS.peon.consent,
    });
    expect((await call(c, "peon", "GET", "/api/app?app=slop")).body).toEqual({ ok: false, error: "app_mismatch" });
    expect((await call(c, "peon", "POST", "/api/auth/otp/start", { app: "slop", phone: newPhone() })).status).toBe(400);
    const res = await c.api.fetch(new Request("http://evil.example/api/app", { headers: { host: "evil.example" } }));
    expect(res!.status).toBe(404);
    expect((await call(c, "peon", "POST", "/api/auth/otp/start", { phone: newPhone() }, undefined, { origin: "http://localhost:5102" })).status).toBe(403);
    expect(await c.api.fetch(new Request("http://localhost:5103/index.html"))).toBeUndefined();
  });
});

describe("consent ledger", () => {
  const app = (id: AppId): AppInfo => APPS[id];
  const ev = (a: AppId | null, state: "opted_in" | "opted_out", at: number) => ({ e164: "+12125550199", app: a, state, source: "t", at });
  test("STOP stops one app; STOP ALL stops every app until START on that app's line", () => {
    const events = [ev("slop", "opted_in", 1), ev("peon", "opted_in", 2), ev("slop", "opted_out", 3)];
    expect(resolveConsent(lastEvents(events, "+12125550199", "slop"))).toBe("opted_out");
    expect(resolveConsent(lastEvents(events, "+12125550199", "peon"))).toBe("opted_in");
    events.push(ev(null, "opted_out", 4));
    expect(resolveConsent(lastEvents(events, "+12125550199", "peon"))).toBe("opted_out");
    expect(resolveConsent(lastEvents(events, "+12125550199", "friends"))).toBe("opted_out");
    events.push(ev("peon", "opted_in", 5));
    expect(resolveConsent(lastEvents(events, "+12125550199", "peon"))).toBe("opted_in");
    expect(resolveConsent(lastEvents(events, "+12125550199", "slop"))).toBe("opted_out");
    // The STOP reply says every app stopped; no STOP text says another app is "not affected" (PLAT-12).
    for (const a of Object.values(APPS)) { expect(a.brand.stop).toContain("any app on this number"); expect(a.brand.stop + a.brand.help).not.toContain("not affected"); }
    expect(app("slop").id).toBe("slop");
  });
  test("keywords on a line: STOP is this app (or every app with the global switch), STOP ALL is every app, START is this app", () => {
    const p = "+12125550199";
    expect(keywordEvent(detectKeyword("Stop!")!, p, APPS.slop, 1, { scope: "app" }).event).toMatchObject({ app: "slop", state: "opted_out" });
    expect(keywordEvent(detectKeyword("stop")!, p, APPS.slop, 1, { scope: "global" }).event).toMatchObject({ app: null, state: "opted_out" });
    expect(keywordEvent(detectKeyword("STOP ALL")!, p, APPS.peon, 1, { scope: "app" }).event).toMatchObject({ app: null, state: "opted_out" });
    expect(keywordEvent(detectKeyword(" start ")!, p, APPS.peon, 1).event).toMatchObject({ app: "peon", state: "opted_in" });
    expect(keywordEvent("help", p, APPS.friends, 1).event).toBeUndefined();
    // Without a scope setting, STOP is every app (the shared line).
    expect(keywordEvent("stop", p, APPS.slop, 1, { scope: stopScope({}) }).event).toMatchObject({ app: null });
    expect(detectKeyword("stop by later")).toBeUndefined();
  });
});
