// Real PostgreSQL tests covering QSM state machine & migration 0072 fixes ported into packages/platform.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { Accounts } from "../src/accounts.ts";
import { createPublicApi } from "../src/api.ts";
import { APPS } from "../src/apps.ts";
import { keywordEvent } from "../src/consent.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { LocalDiskPhotoStorage, PgPhotoStore, PHOTO_CONSENT, PHOTO_MAX_PER_PERSON, PHOTO_PENDING_MS, PhotoService } from "../src/photos.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

let seq = 0;
const newPhone = () => `+1646556${String(1000 + ++seq)}`;

describe.skipIf(!pgAvailable)("QSM platform & DB fixes (Postgres)", () => {
  let url: string, store: PgPeopleStore, sql: SQL;
  const clock = { t: Date.UTC(2026, 10, 8, 12) };
  const dirs: string[] = [];

  beforeAll(async () => {
    url = await migratedDb("qsm_platform");
    store = new PgPeopleStore(url);
    sql = new SQL({ url, max: 4 });
  }, 120_000);

  afterAll(async () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    await store?.close();
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("0072 schema additions accept compliance slots, age 0, safety outbound, ops last_failed_at, turn_id, and capital seq", async () => {
    // SD-002 + SD-496: compliance and non-compliance processing rows coexist for same sender_hash; lease_at exists.
    await sql`insert into platform.inbound (id, sender_hash, status, compliance, lease_at, received_at, arrived_at)
      values ('in_002_a', 'sh_002', 'processing', false, now(), now(), now()), ('in_002_b', 'sh_002', 'processing', true, now(), now(), now())`;
    await expect(sql`insert into platform.inbound (id, sender_hash, status, compliance, received_at, arrived_at)
      values ('in_002_c', 'sh_002', 'processing', true, now(), now())`).rejects.toThrow();

    // SD-383: age 0 allowed on age_floor and pending_texts.
    await store.noteAgeFloor("ph_age_zero", 0, clock.t);
    expect(await store.ageFloor("ph_age_zero")).toBe(0);
    await store.putPending({ phoneHash: "ph_age_zero", kind: "join", app: "slop", name: "Zed", age: 0, at: clock.t });
    expect((await store.getPending("ph_age_zero", "join"))?.age).toBe(0);

    // SD-276: eliza_notices.turn_id column exists.
    await sql`insert into platform.eliza_notices (phone_hash, sent_at, turn_id) values ('notice_turn_1', now(), 'in_002_a')`;

    // SD-475 + outbound.network_id: 'safety' kind and network_id accepted.
    await sql`insert into platform.outbound (id, app_id, network_id, line, to_address, kind, body, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at)
      values ('out_safety_1', 'slop', 'slop:sf', '+18005550000', '+16465560001', 'safety', 'Notice', 'fp_1', 'America/New_York', 'pending', now(), now(), now())`;

    // SD-235: ops_alerts.last_failed_at column exists.
    await sql`insert into network.ops_alerts (key, level, count, text, open, first_at, last_at, last_failed_at)
      values ('alert_qsm_1', 'warn', 1, 'msg', true, now(), now(), now())`;

    // SD-153: capital_events.seq preserves insertion order.
    const t0 = new Date(clock.t);
    const seqs = await sql.begin(async tx => {
      await tx`select set_config('app.app_id', 'slop', true)`;
      await tx`insert into network.capital_events (app_id, id, type, member_id, t, event)
        values ('slop', 'cap_1', 'help_given', 'm_1', ${t0}, '{}'::jsonb), ('slop', 'cap_2', 'help_confirmed', 'm_1', ${t0}, '{}'::jsonb)`;
      return tx<{ id: string; seq: string }[]>`select id, seq from network.capital_events where id in ('cap_1', 'cap_2') order by seq`;
    });
    expect(seqs.map(r => r.id)).toEqual(["cap_1", "cap_2"]);
  });

  test("SD-014 & Q-join_age-3: under-13 decline deletes pending join and forgets existing memberships with join_declined", async () => {
    const phone = newPhone();
    const forgotten: string[] = [];
    const accounts = new Accounts(store, {
      hashKey: "qsm-key", now: () => clock.t, apps: id => APPS[id],
      hooks: { onForget: ctx => { forgotten.push(`${ctx.app.id}:${ctx.memberId}`); } },
    });
    const person = await accounts.createPerson(phone, "inbound_message", 25);
    await store.putMembership({ app: "friends", personId: person.id, memberId: "fr_014", state: "active", review: null, firstName: "Pat", profile: {}, joinedAt: clock.t, leftAt: null });
    await accounts.recordConsent({ e164: phone, app: "friends", state: "opted_in", source: "web_form", wording: APPS.friends.consent.text, wordingVersion: APPS.friends.consent.version, at: clock.t });
    await store.putPending({ phoneHash: accounts.phoneHash(phone), kind: "join", app: "slop", name: "Pat", age: 25, at: clock.t });

    const r = await accounts.join(APPS.slop, { e164: phone, personId: person.id }, { firstName: "Pat", age: 12, consent: { sms: true, wording: APPS.slop.consent.text } });
    expect(r).toEqual({ ok: false, error: "under_age" });
    expect(forgotten).toEqual(["friends:fr_014"]);
    expect((await store.getMembership(person.id, "friends"))?.state).toBe("removed");
    expect(await store.getPending(accounts.phoneHash(phone), "join")).toBeUndefined();
    const events = await store.consentEvents(phone, "friends");
    expect(events.at(-1)).toMatchObject({ state: "opted_out", source: "join_declined" });
  });

  test("SD-015: join hook failure runs onForget and re-suppresses a previously deleted number", async () => {
    const phone = newPhone();
    const forgotten: string[] = [];
    let shouldFail = true;
    const accounts = new Accounts(store, {
      hashKey: "qsm-key", now: () => clock.t, apps: id => APPS[id],
      hooks: {
        onJoin: () => { if (shouldFail) throw new Error("welcome failed"); },
        onForget: ctx => { forgotten.push(ctx.memberId); },
      },
    });
    const hash = accounts.phoneHash(phone);
    await store.suppress(hash, "deleted", clock.t - 1000);
    await expect(accounts.join(APPS.slop, { e164: phone, personId: null }, { firstName: "Rio", age: 26, consent: { sms: true, wording: APPS.slop.consent.text } }))
      .rejects.toThrow("welcome failed");
    expect(forgotten).toHaveLength(1);
    expect(await store.isSuppressed(hash)).toBe(true);
    shouldFail = false;
  });

  test("SD-051, SD-381 & SD-092: clearHold same_owner touches last_seen_at atomically; new_owner preserves post-hold STOP; deleteAll clears line_conversations", async () => {
    const accounts = new Accounts(store, { hashKey: "qsm-key", now: () => clock.t, apps: id => APPS[id] });
    // SD-381 same_owner
    const samePhone = newPhone();
    const p1 = await accounts.createPerson(samePhone, "otp_sms", 29);
    expect(p1.id).toBeTruthy();
    await store.setPhoneHold(samePhone, "recycled_number", clock.t - 100_000);
    clock.t += 50_000;
    expect(await accounts.clearHold(samePhone, "same_owner")).toBe(true);
    const afterSame = await store.findPhone(samePhone);
    expect(afterSame?.hold).toBeNull();
    expect(afterSame?.lastSeenAt).toBe(clock.t);

    // SD-092: line_conversations cleared on normal deleteAll
    await sql`insert into platform.line_conversations (line, address, unanswered, last_inbound_at)
      values ('+18005550000', ${samePhone}, 1, now())`;
    expect(await accounts.deleteAll({ e164: samePhone, personId: p1.id })).toBe(true);
    expect(await sql`select 1 from platform.line_conversations where address = ${samePhone}`).toHaveLength(0);

    // SD-051: new_owner keeps new holder's STOP after old owner's last_seen_at
    const newOwnerPhone = newPhone();
    await accounts.createPerson(newOwnerPhone, "otp_sms", 31);
    await accounts.recordConsent({ e164: newOwnerPhone, app: "slop", state: "opted_in", source: "web_form", at: clock.t });
    await store.setPhoneHold(newOwnerPhone, "recycled_number", clock.t + 10);
    clock.t += 1000;
    await accounts.recordConsent({ e164: newOwnerPhone, app: null, state: "opted_out", source: "keyword:stop", namedApp: "slop", at: clock.t });
    clock.t += 1000;
    expect(await accounts.clearHold(newOwnerPhone, "new_owner")).toBe(true);
    expect(await accounts.optedIn("slop", newOwnerPhone)).toBe(false);
    expect(await store.consentEvents(newOwnerPhone, "slop")).toHaveLength(0);
  });

  test("SD-379, SD-055 & SD-318: movePhone moves eliza_notices by noticeHash; racing stop follows person with namedApp", async () => {
    const accounts = new Accounts(store, { hashKey: "qsm-key", now: () => clock.t, apps: id => APPS[id] });
    const oldPhone = newPhone(), movedPhone = newPhone();
    const person = await accounts.createPerson(oldPhone, "otp_sms", 30);
    await accounts.recordConsent({ e164: oldPhone, app: "friends", state: "opted_in", source: "web_form", at: clock.t });

    // Seed Eliza notice using Accounts.noticeHash
    await sql`insert into platform.eliza_notices (phone_hash, sent_at) values (${accounts.noticeHash(oldPhone)}, ${new Date(clock.t)})`;
    clock.t += 1000;
    expect(await accounts.startNumberChange(APPS.friends, { e164: oldPhone, personId: person.id }, movedPhone, async () => true)).toEqual({ ok: true });

    // Global STOP keyword produces namedApp (SD-318) and races movePhone via addConsent(e, personId) (SD-055)
    const { event } = keywordEvent("stop", oldPhone, APPS.friends, clock.t + 500, { scope: "global", ref: "msg_race_stop" });
    expect(event?.namedApp).toBe("friends");

    // Simulate movePhone committing right before addConsent writes
    expect(await accounts.confirmNumberChange({ e164: oldPhone, personId: person.id }, async () => true)).toEqual({ ok: true, e164: movedPhone, personId: person.id });
    expect(await sql`select phone_hash from platform.eliza_notices where phone_hash in (${accounts.noticeHash(oldPhone)}, ${accounts.noticeHash(movedPhone)})`)
      .toEqual([{ phone_hash: accounts.noticeHash(movedPhone) }]);

    await accounts.recordConsent(event!, person.id);
    expect(await accounts.optedIn("friends", movedPhone)).toBe(false);
    const last = await store.lastConsent(movedPhone, "friends");
    expect(last.global?.namedApp).toBe("friends");
  });

  test("SD-089: createPublicApi forwards onEraseAccount on /api/me/delete", async () => {
    const erased: string[] = [];
    const codes = new Map<string, string>();
    const phone = newPhone();
    const api = createPublicApi({
      store, env: { PLATFORM_ENV: "dev" }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {},
      otp: { name: "fake", send: async e164 => { const code = "123456"; codes.set(e164, code); return { code }; } },
      onEraseAccount: personId => { erased.push(personId); },
    });
    const call = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const res = (await api.fetch(new Request(`http://localhost:5102${path}`, {
        method,
        headers: { host: "localhost:5102", ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })))!;
      return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] };
    };
    expect((await call("POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    const v = await call("POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) });
    expect((await call("POST", "/api/join", { firstName: "Ada", age: 29, consent: { sms: true, wording: APPS.slop.consent.text } }, v.cookie)).status).toBe(200);
    const p = await api.accounts.personFor(phone);
    expect((await call("POST", "/api/me/delete", { scope: "all" }, v.cookie)).status).toBe(200);
    expect(erased).toEqual([p!.id]);
  });

  test("SD-052, SD-372, SD-176: photo upload locks person & enforces max slots; hidden row precedes bytes and sweep() cleans interrupted ops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qsm-photos-"));
    dirs.push(dir);
    const disk = new LocalDiskPhotoStorage(dir);
    const accounts = new Accounts(store, { hashKey: "qsm-key", now: () => clock.t, apps: id => APPS[id] });
    const phone = newPhone();
    const person = await accounts.createPerson(phone, "otp_sms", 28);
    let allowEligible = true;
    let revokeOnPut = false;
    let failDelete = false;
    const removed: string[] = [];
    let failPut = false;
    const svc = new PhotoService({
      people: store, meta: new PgPhotoStore(sql),
      storage: {
        kind: "local",
        put: async (key, bytes) => {
          await disk.put(key, bytes);
          if (revokeOnPut) allowEligible = false;
          if (failPut) throw new Error("put interrupted");
        },
        get: key => disk.get(key),
        delete: async key => {
          if (failDelete) throw new Error("delete interrupted");
          await disk.delete(key);
        },
      },
      signingKey: "k", now: () => clock.t,
      eligible: async () => allowEligible,
      onRemoved: async (_p, _a, id) => { removed.push(id); },
    });

    // Valid minimal 1x1 PNG bytes
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
      0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    // Interrupted upload leaves hidden row + bytes -> sweep removes both after PHOTO_PENDING_MS.
    failPut = true;
    await expect(svc.upload(person.id, "slop", png, PHOTO_CONSENT.version)).rejects.toThrow("put interrupted");
    expect(await svc.list(person.id, "slop")).toHaveLength(0);
    clock.t += PHOTO_PENDING_MS + 1000;
    expect(await svc.sweep()).toBe(1);
    expect(readdirSync(dir)).toHaveLength(0);
    failPut = false;

    // Upload PHOTO_MAX_PER_PERSON - 1, then run 3 parallel uploads -> only 1 succeeds and orphan files are cleaned.
    for (let i = 0; i < PHOTO_MAX_PER_PERSON - 1; i++) {
      expect((await svc.upload(person.id, "slop", png, PHOTO_CONSENT.version)).ok).toBe(true);
    }
    const parallel = await Promise.all([1, 2, 3].map(() => svc.upload(person.id, "slop", png, PHOTO_CONSENT.version)));
    expect(parallel.filter(r => r.ok)).toHaveLength(1);
    expect(parallel.filter(r => !r.ok)).toHaveLength(2);
    expect(await svc.list(person.id, "slop")).toHaveLength(PHOTO_MAX_PER_PERSON);
    expect(readdirSync(dir)).toHaveLength(PHOTO_MAX_PER_PERSON);

    // Interrupted deletion: hides row and clears rating first; sweep removes leftover bytes + hidden row.
    const live = await svc.list(person.id, "slop");
    failDelete = true;
    await expect(svc.remove(person.id, "slop", live[0]!.id)).rejects.toThrow("delete interrupted");
    expect(await svc.list(person.id, "slop")).toHaveLength(PHOTO_MAX_PER_PERSON - 1);
    expect(removed).toContain(live[0]!.id);
    failDelete = false;
    clock.t += PHOTO_PENDING_MS + 1000;
    expect(await svc.sweep()).toBe(1);

    // Racing eligibility drop while bytes are stored: show() re-checks under person lock and cleans up bytes & row.
    expect(await svc.deleteFor(person.id, "slop")).toBe(PHOTO_MAX_PER_PERSON - 1);
    revokeOnPut = true;
    expect(await svc.upload(person.id, "slop", png, PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "not_verified" });
    expect(await sql`select count(*)::int as n from platform.photos where person_id = ${person.id}`).toEqual([{ n: 0 }]);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
