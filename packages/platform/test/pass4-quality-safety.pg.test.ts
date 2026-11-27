import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SimClock } from "../../core/src/clock.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { Member } from "../../core/src/types.ts";
import { loadSnapshot } from "../../network/service/snapshot.ts";
import { NetworkService } from "../../network/service/service.ts";
import { Accounts } from "../src/accounts.ts";
import { APPS } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { PHOTO_CONSENT, PgPhotoStore, PhotoService, photoSha256Hex, type PhotoStorage, type PhotoType } from "../src/photos.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const T0 = Date.UTC(2026, 9, 10, 15);
const HASH_KEY = "pass4-pg-test-hash-key";

type SnapshotMember = Member & { accountStatus?: string };
const statusOf = (members: readonly Member[], id: string): string | undefined =>
  (members.find(m => m.id === id) as SnapshotMember | undefined)?.accountStatus;

function jpegWithExif(tag = "GPS 40.7128N 74.0060W"): Uint8Array {
  const exif = new TextEncoder().encode(`Exif\0\0${tag}`);
  const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
  const dqt = [0xff, 0xdb, 0, 4, 0, 0];
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...app1, ...dqt, ...sos, 0xff, 0xd9]);
}

class MemoryPhotoStorage implements PhotoStorage {
  readonly kind = "local" as const;
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array, _t: PhotoType) { this.objects.set(key, bytes); }
  async get(key: string) { return this.objects.get(key); }
  async delete(key: string) { this.objects.delete(key); }
}

describe.skipIf(!pgAvailable)("Pass 4 quality, safety quarantine, reliability & banned media (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let people: PgPeopleStore;

  beforeAll(async () => {
    url = await migratedDb("pass4_quality_safety");
    sql = new SQL({ url, max: 4 });
    people = new PgPeopleStore(url);
  }, T);

  afterAll(async () => {
    await people?.close();
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("migration 0102 tables, constraints, and observatory role isolation", async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'platform'
        and table_name in ('person_safety_quarantine', 'person_boundary_signals', 'member_reliability', 'banned_media_hashes')
      order by table_name`;
    expect(tables.map(t => t.table_name)).toEqual([
      "banned_media_hashes",
      "member_reliability",
      "person_boundary_signals",
      "person_safety_quarantine",
    ]);

    const roles = await sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname in ('network_observatory', 'network_observatory_rw')`;
    for (const { rolname } of roles) {
      for (const tbl of tables.map(t => t.table_name)) {
        const [priv] = await sql<{ ok: boolean }[]>`select has_table_privilege(${rolname}, ${`platform.${tbl}`}, 'SELECT') as ok`;
        expect(priv.ok).toBe(false);
      }
    }

    await expect(sql`
      insert into platform.person_boundary_signals (subject_person_id, subject_phone_hash, reporter_hash, app_id, kind, created_at)
      values (null, 'h_bad', 'r_bad', 'slop', 'not_a_kind', ${T0})
    `).rejects.toThrow();
  }, T);

  test("SD-074 cross-app quarantine propagates to loadSnapshot across apps and clears cleanly", async () => {
    const clock = new SimClock(T0);
    const svc = new NetworkService({
      url, clock, env: { PLATFORM_ENV: "dev" },
      networks: [{ id: "slop:nyc" }, { id: "friends:nyc" }, { id: "peon:nyc" }],
      notify: false, log: () => {},
      publicApi: { otp: { name: "fake", send: async () => ({ code: "123456" }) } },
    });
    try {
      await svc.start();
      const phone = "+12125550401";
      const jSlop = await svc.accounts.join(APPS.slop, { e164: phone, personId: null }, { firstName: "Jordan", age: 30, consent: { sms: true, version: APPS.slop.consent.version } });
      expect(jSlop.ok).toBe(true);
      const personId = (await svc.accounts.personFor(phone))!.id;
      const jFriends = await svc.accounts.join(APPS.friends, { e164: phone, personId }, { firstName: "Jordan", age: 30, consent: { sms: true, version: APPS.friends.consent.version } });
      const jPeon = await svc.accounts.join(APPS.peon, { e164: phone, personId }, { firstName: "Jordan", age: 30, consent: { sms: true, version: APPS.peon.consent.version } });
      expect([jFriends.ok, jPeon.ok]).toEqual([true, true]);

      const mFriends = (await svc.people.getMembership(personId, "friends"))!.memberId;
      const mPeon = (await svc.people.getMembership(personId, "peon"))!.memberId;

      await svc.accounts.recordSafetyQuarantine(personId, "auto_report_hold", "slop", "rep-sd074", clock.now());

      const snapFriends = await loadSnapshot(sql, clock.now(), { app: "friends" });
      const snapPeon = await loadSnapshot(sql, clock.now(), { app: "peon" });
      expect(statusOf(snapFriends.members, mFriends)).toBe("restricted");
      expect(statusOf(snapPeon.members, mPeon)).toBe("restricted");

      await svc.accounts.clearSafetyQuarantine(personId, clock.now() + 1000);
      const snapCleared = await loadSnapshot(sql, clock.now() + 1000, { app: "friends" });
      expect(statusOf(snapCleared.members, mFriends)).toBe("active");
    } finally {
      await svc.close();
    }
  }, T);

  test("deleteAll preserves quarantine, boundary signals, and reliability; rejoin re-links and projects into loadSnapshot", async () => {
    const clock = new SimClock(T0 + 10_000);
    const svc = new NetworkService({
      url, clock, env: { PLATFORM_ENV: "dev" },
      networks: [{ id: "slop:nyc" }, { id: "friends:nyc" }],
      notify: false, log: () => {},
      publicApi: { otp: { name: "fake", send: async () => ({ code: "123456" }) } },
    });
    try {
      await svc.start();
      const phone = "+12125550402";
      const j1 = await svc.accounts.join(APPS.slop, { e164: phone, personId: null }, { firstName: "Casey", age: 31, consent: { sms: true, version: APPS.slop.consent.version } });
      expect(j1.ok).toBe(true);
      const oldPersonId = (await svc.accounts.personFor(phone))!.id;
      const pHash = svc.accounts.phoneHash(phone);

      await svc.accounts.recordSafetyQuarantine(oldPersonId, "safety_hold", "slop", "hold-1", clock.now());
      await svc.accounts.recordBoundarySignal({ subjectPersonId: oldPersonId, subjectPhoneHash: pHash, reporterHash: "rep_a", appId: "slop", kind: "post_meet_block", at: clock.now() });
      await svc.accounts.recordBoundarySignal({ subjectPersonId: oldPersonId, subjectPhoneHash: pHash, reporterHash: "rep_b", appId: "friends", kind: "checkin_concern", at: clock.now() });
      await svc.accounts.recordBoundarySignal({ subjectPersonId: oldPersonId, subjectPhoneHash: pHash, reporterHash: "rep_c", appId: "friends", kind: "self_promotion", at: clock.now() });
      await svc.accounts.upsertMemberReliability({
        personId: oldPersonId, phoneHash: pHash, strikes: 5, lateCancels4h: 1, lateCancels24h: 1,
        rescheduleChurn: 1, cleanStreak: 0, resolved90d: 4, completed90d: 1, provisionalNoShow: true, at: clock.now(),
      });

      const deleted = await svc.accounts.deleteAll({ e164: phone, personId: oldPersonId });
      expect(deleted).toBe(true);

      const [qRow] = await sql`select active, reason from platform.person_safety_quarantine where person_id = ${oldPersonId}`;
      expect(qRow).toEqual({ active: true, reason: "safety_hold" });
      const sigRows = await svc.accounts.boundarySignalsForPhone(pHash, 0);
      expect(sigRows.length).toBe(3);
      const relAfterDelete = await svc.accounts.getMemberReliability(oldPersonId, pHash);
      expect(relAfterDelete?.strikes).toBe(5);

      clock.advance(60_000);
      const j2 = await svc.accounts.join(APPS.friends, { e164: phone, personId: null }, { firstName: "Casey", age: 31, consent: { sms: true, version: APPS.friends.consent.version } });
      expect(j2.ok).toBe(true);
      const newPersonId = (await svc.accounts.personFor(phone))!.id;
      const newMemberId = (await svc.people.getMembership(newPersonId, "friends"))!.memberId;

      const relinkedSigs = await svc.accounts.boundarySignalsForPhone(pHash, 0);
      expect(relinkedSigs.every(s => s.subjectPersonId === newPersonId)).toBe(true);
      const relinkedRel = await svc.accounts.getMemberReliability(newPersonId, pHash);
      expect(relinkedRel?.personId).toBe(newPersonId);
      expect(relinkedRel?.strikes).toBe(5);

      const snap = await loadSnapshot(sql, clock.now(), { app: "friends" });
      expect(statusOf(snap.members, newMemberId)).toBe("restricted");
      expect(snap.vampireByMember?.[newMemberId]?.distinctSelfPromoReports90d).toBe(1);
      expect(snap.reliability?.[newMemberId]).toMatchObject({
        strikes: 5,
        lateCancels4h: 1,
        lateCancels24h: 1,
        rescheduleChurn: 1,
        provisionalNoShow: true,
      });
    } finally {
      await svc.close();
    }
  }, T);

  test("startNumberChange blocks active quarantine, staff_safety_holds, and report_safety_carryovers until cleared", async () => {
    const now = T0 + 20_000;
    const accounts = new Accounts(people, { hashKey: HASH_KEY, now: () => now, apps: id => APPS[id], sql });
    const phone = "+12125550403";
    const target = "+12125550404";
    const joined = await accounts.join(APPS.slop, { e164: phone, personId: null }, { firstName: "Morgan", age: 30, consent: { sms: true, version: APPS.slop.consent.version } });
    expect(joined.ok).toBe(true);
    const personId = (await accounts.personFor(phone))!.id;

    await accounts.recordSafetyQuarantine(personId, "test_quarantine", "slop", "q1", now);
    expect(await accounts.startNumberChange(APPS.slop, { e164: phone, personId }, target, true, async () => true)).toEqual({ ok: false, error: "review" });
    await accounts.clearSafetyQuarantine(personId, now + 100);

    await sql`insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at, released_apps)
      values (${personId}::uuid, 'slop', '00000000-0000-4000-8000-000000000001'::uuid, ${new Date(now)}, '{}'::text[])`;
    expect(await accounts.startNumberChange(APPS.slop, { e164: phone, personId }, target, true, async () => true)).toEqual({ ok: false, error: "review" });
    await sql`delete from platform.staff_safety_holds where person_id = ${personId}::uuid`;

    await sql`insert into platform.report_safety_carryovers (app_id, origin_runtime_id, report_id, person_id)
      values ('slop', 'slop:nyc', 'rep-nc-1', ${personId}::uuid)`;
    expect(await accounts.startNumberChange(APPS.slop, { e164: phone, personId }, target, true, async () => true)).toEqual({ ok: false, error: "review" });
    await sql`delete from platform.report_safety_carryovers where person_id = ${personId}::uuid`;

    const okStart = await accounts.startNumberChange(APPS.slop, { e164: phone, personId }, target, true, async () => true);
    expect(okStart.ok).toBe(true);
  }, T);

  test("banned photo SHA-256 refuses re-upload by a second adult even with altered EXIF", async () => {
    const now = T0 + 30_000;
    const accounts = new Accounts(people, { hashKey: HASH_KEY, now: () => now, apps: id => APPS[id], sql });
    const phoneA = "+12125550405";
    const phoneB = "+12125550406";
    expect((await accounts.join(APPS.slop, { e164: phoneA, personId: null }, { firstName: "Alex", age: 31, consent: { sms: true, version: APPS.slop.consent.version } })).ok).toBe(true);
    expect((await accounts.join(APPS.slop, { e164: phoneB, personId: null }, { firstName: "Blair", age: 29, consent: { sms: true, version: APPS.slop.consent.version } })).ok).toBe(true);
    const personA = (await accounts.personFor(phoneA))!.id;
    const personB = (await accounts.personFor(phoneB))!.id;
    const mA = (await people.getMembership(personA, "slop"))!;
    const mB = (await people.getMembership(personB, "slop"))!;
    await people.putMembership({ ...mA, profile: { ...mA.profile, photoConsent: PHOTO_CONSENT.version } });
    await people.putMembership({ ...mB, profile: { ...mB.profile, photoConsent: PHOTO_CONSENT.version } });

    const storage = new MemoryPhotoStorage();
    const meta = new PgPhotoStore(sql);
    const photos = new PhotoService({
      people, meta, storage, signingKey: "pass4-photo-key", now: () => now, eligible: async () => true,
    });

    const imgOriginal = jpegWithExif("GPS 40.7128N 74.0060W");
    const imgDifferentExif = jpegWithExif("GPS 34.0522N 118.2437W");
    expect(photoSha256Hex(imgOriginal)).not.toBe(photoSha256Hex(imgDifferentExif));

    const upA = await photos.upload(personA, "slop", imgOriginal, PHOTO_CONSENT.version);
    expect(upA.ok).toBe(true);
    expect(await photos.banMediaForPerson(personA)).toBe(1);

    const [hashRow] = await sql`select sha256_hex, person_id from platform.banned_media_hashes where person_id = ${personA}`;
    expect(hashRow?.sha256_hex).toBeTruthy();

    expect(await photos.upload(personB, "slop", imgOriginal, PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "banned" });
    expect(await photos.upload(personB, "slop", imgDifferentExif, PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "banned" });
  }, T);

  test("member_reliability persistence and VoIP phoneLineType projection into loadSnapshot", async () => {
    const clock = new SimClock(T0 + 40_000);
    const svc = new NetworkService({
      url, clock, env: { PLATFORM_ENV: "dev" },
      networks: [{ id: "friends:nyc" }],
      notify: false, log: () => {},
      publicApi: { otp: { name: "fake", send: async () => ({ code: "123456" }) } },
    });
    try {
      await svc.start();
      const phone = "+12125550407";
      const j = await svc.accounts.join(APPS.friends, { e164: phone, personId: null }, {
        firstName: "VoipUser", age: 28, phoneLineType: "voip",
        consent: { sms: true, version: APPS.friends.consent.version },
      });
      expect(j.ok).toBe(true);
      const personId = (await svc.accounts.personFor(phone))!.id;
      const memberId = (await svc.people.getMembership(personId, "friends"))!.memberId;

      await svc.accounts.upsertMemberReliability({
        personId, phoneHash: svc.accounts.phoneHash(phone), strikes: 4, lateCancels4h: 2,
        lateCancels24h: 0, rescheduleChurn: 1, cleanStreak: 1, resolved90d: 3, completed90d: 1,
        provisionalNoShow: false, at: clock.now(),
      });

      const snap = await loadSnapshot(sql, clock.now(), { app: "friends" });
      expect(snap.qualityByMember?.[memberId]?.voipOrPumping).toBe(true);
      expect(snap.reliability?.[memberId]).toMatchObject({
        strikes: 4,
        lateCancels4h: 2,
        rescheduleChurn: 1,
        completedSinceLastNoShow: 1,
      });
    } finally {
      await svc.close();
    }
  }, T);
});
