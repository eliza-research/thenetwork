// A member changes their own phone number (PRD F25; accounts.ts startNumberChange / confirmNumberChange,
// POST /api/me/phone/start and /api/me/phone/confirm) on Postgres: a fresh login on the current number,
// a code to the new one (a fake OTP provider: no Twilio call), then the move with the rules of the staff
// tool. The new number is checked only after the code proves the person holds it; a banned or held number
// never moves; the consent history, the age floor and the OAuth-style keyed hash move with the person;
// the old number's sessions end; messages waiting for the old number are ended unsent; the change row
// keeps only keyed hashes (the audit record).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { PgOAuthStore } from "../../mcp/src/pg-store.ts";
import { NetworkService } from "../../network/service/service.ts";
import { APPS } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const MIN = 60_000;
const host = "localhost:5102"; // slop.date in dev
const jsonH = { "content-type": "application/json" };

describe.skipIf(!pgAvailable)("member number change (Postgres)", () => {
  let url: string, store: PgPeopleStore, oauth: PgOAuthStore, sql: SQL;
  beforeAll(async () => {
    url = await migratedDb("number_change");
    store = new PgPeopleStore(url);
    sql = new SQL({ url, max: 2 });
    oauth = new PgOAuthStore(sql);
    await oauth.migrate();
  }, T);
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

  // spec/phoneChange.md, "A challenge needs a send slot and a persisted request"
  test("the fourth daily change request sends no code and keeps the third request pending", async () => {
    const t = setup();
    const oldNumber = "+12125550268";
    const targets = ["+12125550269", "+12125550270", "+12125550271"];
    const browser = t.browser();
    await browser.login(oldNumber);
    expect((await t.join(browser)).status).toBe(200);
    for (const phone of targets) {
      expect(await browser.call("POST", "/api/me/phone/start", { phone })).toEqual({ status: 200, body: { ok: true } });
    }
    expect(await browser.call("POST", "/api/me/phone/start", { phone: "+12125550272" })).toEqual({
      status: 429, body: { ok: false, error: "rate_limited" },
    });
    expect(t.sends).toEqual([oldNumber, ...targets]);
    const owner = await store.findPhone(oldNumber);
    if (!owner) throw new Error("The member is missing");
    expect(await store.pendingPhoneChange(owner.personId)).toMatchObject({ newE164: targets[2] });
  }, T);

  // spec/phoneChange.md, "A live pending request needs a valid code"
  test("a clock rollback leaves the new code available until its request starts", async () => {
    const t = setup();
    const [oldNumber, newNumber] = ["+12125550273", "+12125550274"];
    const browser = t.browser();
    await browser.login(oldNumber);
    expect((await t.join(browser)).status).toBe(200);
    t.tick(MIN);
    expect((await browser.call("POST", "/api/me/phone/start", { phone: newNumber })).status).toBe(200);
    const input = { code: t.codes.get(newNumber) };
    t.tick(-1);
    expect(await browser.call("POST", "/api/me/phone/confirm", input)).toEqual({
      status: 409, body: { ok: false, error: "no_pending_change" },
    });
    t.tick(1);
    expect((await browser.call("POST", "/api/me/phone/confirm", input)).status).toBe(200);
  }, T);

  // spec/phoneChange.md, "The verified request can move only when both numbers allow it"
  test("a provider verification that finishes after the pending move expires leaves the number unchanged", async () => {
    const t = setup();
    const [oldNumber, newNumber] = ["+12125550263", "+12125550264"];
    const browser = t.browser();
    await browser.login(oldNumber);
    expect((await t.join(browser)).status).toBe(200);
    expect((await browser.call("POST", "/api/me/phone/start", { phone: newNumber })).status).toBe(200);
    const original = await store.findPhone(oldNumber);
    if (!original) throw new Error("The moving account is missing");
    const result = await t.api.accounts.confirmNumberChange({ e164: oldNumber, personId: original.personId }, async (app, phone) => {
      expect(phone).toBe(newNumber);
      const code = t.codes.get(phone);
      if (!code) throw new Error("The fixture OTP was not sent");
      const verified = await t.api.otp.verify(app, phone, code, "203.0.113.250");
      expect(verified).toBe(true);
      t.tick(16 * MIN);
      return verified;
    });
    expect(result).toEqual({ ok: false, error: "no_pending_change" });
    expect(await store.findPhone(oldNumber)).toEqual(original);
    expect(await store.findPhone(newNumber)).toBeUndefined();
  }, T);

  // spec/phoneChange.md, "Reporting a move requires both the new code and current move authority"
  test("a released number cannot route to the former member through an old channel alias", async () => {
    const t = setup();
    const [oldNumber, newNumber, legacyNumber] = ["+12125550265", "+12125550266", "+12125550267"];
    const secret = "synthetic-number-change-leave-secret";
    const browser = t.browser();
    await browser.login(oldNumber);
    expect((await t.join(browser)).status).toBe(200);
    const owner = await store.findPhone(oldNumber);
    const member = owner && await store.getMembership(owner.personId, "slop");
    if (!owner || !member) throw new Error("The moving member is missing");
    const legacyMember = "slop_number_move_legacy";
    await sql`insert into network.members (id,app_id,home_city,age,person_id)
      values (${member.memberId},'slop','nyc',31,${owner.personId}::uuid),(${legacyMember},'slop','nyc',31,null)`;
    await sql`insert into network.channel_identities (member_id,app_id,channel,address,is_primary)
      values (${member.memberId},'slop','sms',${oldNumber},true),(${legacyMember},'slop','sms',${legacyNumber},true)`;
    const service = new NetworkService({ url, clock: { now: t.now }, networks: [{ id: "slop:nyc", matchingEnabled: false }],
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret }, photoStorage: null, log: () => {} });
    try {
      await service.start();
      const runtime = service.runtimeFor("slop")!;
      await runtime.identities();
      expect(await service.memberApps(oldNumber)).toMatchObject([{ memberId: member.memberId }]);
      expect(runtime.memberOf(oldNumber)).toBe(member.memberId);
      const oldOwnerLeaveAt = t.now();
      expect((await browser.call("POST", "/api/me/phone/start", { phone: newNumber })).status).toBe(200);
      expect((await browser.call("POST", "/api/me/phone/confirm", { code: t.codes.get(newNumber) })).status).toBe(200);
      await runtime.identities();
      expect(await service.memberApps(oldNumber)).toEqual([]);
      expect(runtime.memberOf(oldNumber)).toBeUndefined();
      expect(await service.memberApps(newNumber)).toMatchObject([{ memberId: member.memberId }]);
      expect(runtime.memberOf(newNumber)).toBe(member.memberId);
      expect(runtime.addressOf(member.memberId)).toBe(newNumber);
      expect(await service.memberApps(legacyNumber)).toMatchObject([{ memberId: legacyMember }]);
      expect(runtime.memberOf(legacyNumber)).toBe(legacyMember);

      t.tick(31_000);
      const successor = t.browser();
      await successor.login(oldNumber);
      expect((await t.join(successor)).status).toBe(200);
      const nextOwner = await store.findPhone(oldNumber);
      const nextMember = nextOwner && await store.getMembership(nextOwner.personId, "slop");
      if (!nextOwner || !nextMember) throw new Error("The released number did not receive a separate account");
      expect(nextOwner.personId).not.toBe(owner.personId);
      await sql`insert into network.members (id,app_id,home_city,age,person_id) values (${nextMember.memberId},'slop','nyc',31,${nextOwner.personId}::uuid)`;
      await sql`insert into network.channel_identities (member_id,app_id,channel,address) values (${legacyMember},'slop','imessage',${oldNumber})`;
      await runtime.identities();
      expect((await service.memberApps(oldNumber)).map(route => route.memberId)).toEqual([nextMember.memberId]);
      expect(runtime.memberOf(oldNumber)).toBe(nextMember.memberId);

      const signedLeave = async (messageId: string, at: number) => {
        const input: TurnRequest = { app: "slop", channel: "blooio", messageId, from: oldNumber, to: null,
          transport: "imessage", text: "leave slop", receivedAt: at };
        const body = JSON.stringify(input);
        const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(t.now() / 1000) });
        const response = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }));
        expect(response.status).toBe(200);
        return response.json();
      };
      const delayed = await signedLeave("former-owner-leave", oldOwnerLeaveAt);
      expect(delayed.consent).toBeUndefined();
      expect(await store.getMembership(nextOwner.personId, "slop")).toMatchObject({ state: "active" });
      expect(await service.accounts.optedIn("slop", oldNumber)).toBe(true);
      expect(await service.accounts.leave(APPS.slop, { e164: oldNumber, personId: owner.personId })).toBe(false);
      expect(await store.getMembership(nextOwner.personId, "slop")).toMatchObject({ state: "active" });

      // Retry after the Network record was erased and the platform membership write did not finish.
      await sql`delete from network.members where app_id='slop' and id=${nextMember.memberId}`;
      await runtime.identities();
      expect(runtime.memberOf(oldNumber)).toBeUndefined();
      const fresh = await signedLeave("current-owner-leave", t.now());
      expect(fresh).toMatchObject({ consent: { state: "opted_out", scope: "app", app: "slop", at: t.now() } });
      expect(await store.getMembership(nextOwner.personId, "slop")).toMatchObject({ state: "removed" });
      expect(await service.accounts.optedIn("slop", newNumber)).toBe(true);
      expect(await store.getMembership(owner.personId, "slop")).toMatchObject({ state: "active" });
    } finally { await service.close(); }
  }, T);

  // spec/phoneChange.md, "The verified request can move only when both numbers allow it"
  test("only a live native grant bound to the moving person carries its draft and tokens to the new number", async () => {
    const t = setup();
    const [oldNumber, newNumber] = ["+12125550261", "+12125550262"];
    const browser = t.browser();
    await browser.login(oldNumber);
    expect((await t.join(browser)).status).toBe(200);
    const personId = (await store.findPhone(oldNumber))!.personId;
    const oldKey = t.api.accounts.phoneHash(oldNumber), newKey = t.api.accounts.phoneHash(newNumber);
    const at = new Date(t.now()), expires = new Date(t.now() + 60 * MIN);
    const local = "grant_phone_move_native", cloud = "grant_cloud_phone_move", unbound = "grant_phone_move_unbound";
    const retired = "grant_phone_move_retired";
    const client = "client_phone_move";
    const resource = "https://friends.help/mcp";
    await sql`insert into oauth.clients (id,redirect_uris,auth_method,app_id,surface,kind,created_at)
      values (${client},${["https://assistant.example/callback"]},'none','friends','full','dcr',${at})`;
    const authority = { version: 1, phoneKey: oldKey };
    const rows = [
      { id: local, person: personId, authority: null, revoked: null },
      { id: cloud, person: personId, authority, revoked: null },
      { id: unbound, person: null, authority: null, revoked: null },
      { id: retired, person: personId, authority: null, revoked: at },
    ];
    for (const row of rows) {
      await sql`insert into oauth.grants (id,client_id,app_id,phone_key,person_id,scopes,resource,created_at,expires_at,revoked_at,cloud_authority)
        values (${row.id},${client},'friends',${oldKey},${row.person},${["profile:write"]},${resource},${at},${expires},${row.revoked},${row.authority}::jsonb)`;
      await sql`insert into oauth.signup_drafts (grant_id,app_id,phone_key,fields,expires_at)
        values (${row.id},'friends',${oldKey},${{ firstName: "Ana" }}::jsonb,${expires})`;
      await sql`insert into oauth.tokens (hash,kind,grant_id,client_id,app_id,resource,scopes,created_at,expires_at,revoked_at)
        values (${`${row.id}-token`},'access',${row.id},${client},'friends',${resource},${["profile:write"]},${at},${expires},${row.revoked})`;
    }
    expect((await browser.call("POST", "/api/me/phone/start", { phone: newNumber })).status).toBe(200);
    expect(await browser.call("POST", "/api/me/phone/confirm", { code: t.codes.get(newNumber) })).toMatchObject({ status: 200, body: { ok: true } });

    expect(await store.findPhone(oldNumber)).toBeUndefined();
    expect(await store.findPhone(newNumber)).toMatchObject({ personId });
    expect(await oauth.getGrant(local)).toMatchObject({ phoneKey: newKey, personId, revokedAt: null });
    expect(await oauth.getGrant(cloud)).toMatchObject({ phoneKey: oldKey, personId, cloudAuthority: authority, revokedAt: t.now() });
    expect(await oauth.getGrant(unbound)).toMatchObject({ phoneKey: oldKey, personId: null, revokedAt: t.now() });
    expect(await oauth.getGrant(retired)).toMatchObject({ phoneKey: oldKey, personId, revokedAt: at.getTime() });
    expect(await oauth.claimSignupDraft(newKey, "friends", personId, t.now())).toEqual({ firstName: "Ana" });
    expect(await oauth.claimSignupDraft(oldKey, "friends", personId, t.now())).toBeUndefined();
    expect(await oauth.getToken(`${local}-token`)).toMatchObject({ revokedAt: null });
    for (const id of [cloud, unbound]) expect(await oauth.getToken(`${id}-token`)).toMatchObject({ revokedAt: t.now() });
    const ended = [cloud, unbound].sort();
    expect((await sql`select grant_id from oauth.audit where kind='consent_revoked' order by grant_id`).map(row => row.grant_id)).toEqual(ended);
    expect(await sql`select grant_id from oauth.signup_drafts where grant_id in ${sql(ended)}`).toEqual([]);
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
    // The ban also ends the session that was issued before it.
    // spec/webSession.md, "Only a live token on the requested app can authenticate"
    expect(await d.call("POST", "/api/me/phone/start", { phone: E })).toMatchObject({ status: 401, body: { error: "unauthorized" } });
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
