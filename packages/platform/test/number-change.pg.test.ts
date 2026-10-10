// A member changes their own phone number (PRD F25; accounts.ts startNumberChange / confirmNumberChange,
// POST /api/me/phone/start and /api/me/phone/confirm) on Postgres: a fresh login on the current number,
// a code to the new one (a fake OTP provider: no Twilio call), then the move with the rules of the staff
// tool. The new number is checked only after the code proves the person holds it; a banned or held number
// never moves; the consent history, the age floor and the OAuth-style keyed hash move with the person;
// the old number's sessions end; messages waiting for the old number are ended unsent; the change row
// keeps only keyed hashes (the audit record).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { APPS } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const MIN = 60_000;
const host = "localhost:5102"; // slop.date in dev
const jsonH = { "content-type": "application/json" };

describe.skipIf(!pgAvailable)("member number change (Postgres)", () => {
  let url: string, store: PgPeopleStore, sql: SQL;
  beforeAll(async () => { url = await migratedDb("number_change"); store = new PgPeopleStore(url); sql = new SQL({ url, max: 2 }); }, T);
  afterAll(async () => { await store?.close(); await sql?.close(); if (url) await dropDb(url); });

  let tests = 0;
  function setup() {
    // Each test its own client IP: the OTP limits per IP are stored in this one database.
    const ip = `203.0.113.${++tests}`;
    let now = Date.UTC(2026, 9, 9, 15);
    const codes = new Map<string, string>();
    const sends: string[] = [];
    const lowered: { personId: string; age: number }[] = [];
    let n = 0;
    const api = createPublicApi({
      store, env: { PLATFORM_ENV: "dev" }, now: () => now, ipOf: () => ip, minStartMs: 0, minVerifyMs: 0, log: () => {},
      otp: { name: "fake", send: async e164 => { const code = String(100000 + ++n); codes.set(e164, code); sends.push(e164); return { code }; } },
      onAgeLowered: ctx => { lowered.push(ctx); },
    });
    const changed: string[] = [];
    api.accounts.onPhoneChanged(ctx => { changed.push(ctx.personId); });
    /** One browser: its own cookie jar. */
    const browser = () => {
      let cookie = "";
      const call = async (method: string, path: string, body?: unknown) => {
        const res = (await api.fetch(new Request(`http://${host}${path}`, { method, headers: { host, ...(cookie ? { cookie } : {}), ...(body ? jsonH : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })))!;
        const c = res.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]!;
        return { status: res.status, body: await res.json().catch(() => null) as any };
      };
      const login = async (phone: string) => {
        expect((await call("POST", "/api/auth/otp/start", { phone })).status).toBe(200);
        expect((await call("POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) })).status).toBe(200);
      };
      return { call, login, get cookie() { return cookie; }, set cookie(v: string) { cookie = v; } };
    };
    const join = (b: ReturnType<typeof browser>, age = 31) => b.call("POST", "/api/join", { firstName: "Ana", age, consent: { sms: true, version: APPS.slop.consent.version } });
    return { api, codes, sends, lowered, changed, browser, join, tick: (ms: number) => { now += ms; }, now: () => now };
  }

  test("a member moves to a new number: memberships, consent and the keyed hash follow; old sessions end; the change row keeps hashes only", async () => {
    const t = setup();
    const [A, B] = ["+12125550181", "+12125550182"];
    const b = t.browser();
    await b.login(A);
    expect((await t.join(b)).status).toBe(200);
    const personId = (await store.findPhone(A))!.personId;
    const hashA = t.api.accounts.phoneHash(A), hashB = t.api.accounts.phoneHash(B);
    // A second browser logged in on the old number (it must end with the move).
    const other = t.browser(); t.tick(31_000); await other.login(A);
    // A message still waiting for the old number.
    const at = new Date(t.now());
    await sql`insert into platform.outbound (id, app_id, member_id, line, to_address, kind, body, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at)
      values (${`nc_${process.pid}`}, 'slop', ${"slop_m"}, '+12125550100', ${A}, 'proactive', 'a probe', 'fp', 'America/New_York', 'deferred_quiet_hours', ${at}, ${at}, ${at})`;

    expect((await b.call("POST", "/api/me/phone/start", { phone: A })).body).toEqual({ ok: false, error: "same_number" });
    expect(await b.call("POST", "/api/me/phone/start", { phone: B })).toEqual({ status: 200, body: { ok: true } });
    expect(t.sends.at(-1)).toBe(B);
    expect((await b.call("POST", "/api/me/phone/confirm", { code: "000000" })).body).toEqual({ ok: false, error: "invalid_code" });
    const ok = await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) });
    expect(ok).toEqual({ status: 200, body: { ok: true, phoneMasked: "+1 •••-•••-0182" } });

    // This browser has a session on the new number; the other one (old number) is logged out.
    const me = await b.call("GET", "/api/me");
    expect(me.body).toMatchObject({ phoneMasked: "+1 •••-•••-0182", membership: { state: "active", firstName: "Ana" }, smsOptedIn: true });
    expect((await other.call("GET", "/api/me")).status).toBe(401);
    expect(await store.findPhone(A)).toBeUndefined();
    expect((await store.findPhone(B))!.personId).toBe(personId);
    expect((await store.consentEvents(A, "slop")).length).toBe(0);
    expect((await store.consentEvents(B, "slop")).map((e: { state: string }) => e.state)).toEqual(["opted_in"]);
    expect((await store.findPhoneByHash(hashB))?.e164).toBe(B);
    expect(await store.findPhoneByHash(hashA)).toBeUndefined();
    expect(t.changed).toEqual([personId]);
    // The waiting message never goes to the old number.
    const [row] = await sql`select status, to_address, note from platform.outbound where id = ${`nc_${process.pid}`}`;
    expect(row).toEqual({ status: "suppressed_ineligible", to_address: null, note: "number changed" });
    // The audit record: who asked and when, keyed hashes only, never a number.
    const rows = await sql`select requested_by, new_e164, old_hash, new_hash, confirmed_at from platform.phone_changes where person_id = ${personId}::uuid`;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ requested_by: "member", new_e164: null, old_hash: hashA, new_hash: hashB });
    expect(rows[0].confirmed_at).not.toBeNull();
    expect(JSON.stringify(rows)).not.toContain("+1");
    // The code works once.
    expect((await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).status).toBe(409);
  }, T);

  test("a login older than 10 minutes cannot start a change; a change not confirmed in 15 minutes is gone", async () => {
    const t = setup();
    const [A, B] = ["+12125550183", "+12125550184"];
    const b = t.browser();
    await b.login(A); await t.join(b);
    t.tick(11 * MIN);
    expect(await b.call("POST", "/api/me/phone/start", { phone: B })).toMatchObject({ status: 403, body: { error: "reauth" } });
    expect(t.sends.filter(x => x === B)).toEqual([]);
    await b.login(A);
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    t.tick(16 * MIN);
    expect(await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).toMatchObject({ status: 409, body: { error: "no_pending_change" } });
    expect((await store.findPhone(A))).toBeDefined();
  }, T);

  test("a number that belongs to someone is refused only after its code is proved; nothing moves", async () => {
    const t = setup();
    const [A, C] = ["+12125550185", "+12125550186"];
    const owner = t.browser(); await owner.login(C); await t.join(owner);
    const b = t.browser(); await b.login(A); await t.join(b);
    // Past the OTP resend interval for C (the owner's own login code just went to it).
    t.tick(2 * MIN);
    // Step 1 answers the same as for an unknown number (no enumeration).
    expect(await b.call("POST", "/api/me/phone/start", { phone: C })).toEqual({ status: 200, body: { ok: true } });
    expect(await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(C) })).toMatchObject({ status: 409, body: { error: "number_in_use" } });
    expect((await store.findPhone(A))!.personId).not.toBe((await store.findPhone(C))!.personId);
    expect((await b.call("GET", "/api/me")).status).toBe(200);
  }, T);

  test("a banned person, a banned new number or a number on hold never moves", async () => {
    const t = setup();
    const [A, B, D, E] = ["+12125550187", "+12125550188", "+12125550189", "+12125550190"];
    const b = t.browser(); await b.login(A); await t.join(b);
    // A banned new number: refused after the code, with the review answer.
    await store.ban({ id: `ban_nc_${process.pid}_1`, scope: "phone", personId: null, phoneHash: t.api.accounts.phoneHash(B), reason: "test", reportId: null, bannedBy: "staff", at: t.now() });
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    expect(await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).toMatchObject({ status: 403, body: { error: "review" } });
    expect(await store.findPhone(B)).toBeUndefined();
    // A banned person cannot start (a new number would escape a ban by phone).
    const d = t.browser(); await d.login(D); await t.join(d);
    await store.ban({ id: `ban_nc_${process.pid}_2`, scope: "person", personId: (await store.findPhone(D))!.personId, phoneHash: null, reason: "test", reportId: null, bannedBy: "staff", at: t.now() });
    t.tick(31_000);
    expect(await d.call("POST", "/api/me/phone/start", { phone: E })).toMatchObject({ status: 403, body: { error: "review" } });
    // A number on hold (it may have a new owner) cannot move either.
    const e = t.browser(); t.tick(31_000); await e.login(E); await t.join(e);
    await store.setPhoneHold(E, "recycled_number", t.now());
    expect(await e.call("POST", "/api/me/phone/start", { phone: "+12125550191" })).toMatchObject({ status: 403, body: { error: "review" } });
  }, T);

  test("the lowest age either number ever stated becomes the person's (a minor is never matched anywhere)", async () => {
    const t = setup();
    const [A, B] = ["+12125550192", "+12125550193"];
    // Someone once stated 15 from the new number (the phone's age floor).
    await store.noteAgeFloor(t.api.accounts.phoneHash(B), 15, t.now());
    const b = t.browser(); await b.login(A); await t.join(b, 29);
    const personId = (await store.findPhone(A))!.personId;
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    expect((await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).status).toBe(200);
    expect((await store.getPerson(personId))!.lowestAge).toBe(15);
    expect(t.lowered).toContainEqual({ personId, age: 15 });
    expect(await store.ageFloor(t.api.accounts.phoneHash(B))).toBe(15);
    expect(await store.ageFloor(t.api.accounts.phoneHash(A))).toBeUndefined();
  }, T);
});
