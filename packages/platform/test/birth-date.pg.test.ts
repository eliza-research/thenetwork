import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileAt } from "../../core/src/runtime/files.ts";
import { Accounts, parseJoin } from "../src/accounts.ts";
import { APPS } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { PgPhotoStore, PhotoService } from "../src/photos.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const dayOf = (key: number, hour = 12, minute = 0) => Date.UTC(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100, hour, minute);

describe.skipIf(!pgAvailable)("birth dates and age readings (PostgreSQL)", () => {
  const app = APPS.friends;
  const consent = { sms: true, wording: app.consent.text } as const;
  let url: string, store: PgPeopleStore, now = dayOf(20261122), seq = 0;
  const phone = () => `+1212555${String(3000 + seq++).padStart(4, "0")}`;
  const accounts = () => new Accounts(store, { hashKey: "synthetic-birth-fixture", now: () => now, apps: id => APPS[id] });
  const body = (fields: Record<string, unknown>) => parseJoin({ firstName: "Sam", consent, ...fields });
  const joinWith = async (a: Accounts, e164: string, fields: Record<string, unknown>) => {
    const input = body(fields);
    if (!input) throw new Error("fixture body did not parse");
    return a.join(app, { e164, personId: null }, input);
  };
  const personRow = async (e164: string) => (await store.sql`select p.* from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${e164}`)[0];

  beforeAll(async () => { url = await migratedDb("birth_date"); store = new PgPeopleStore(url); }, 120_000);
  afterAll(async () => { await store?.close(); if (url) await dropDb(url); });

  test("siteEnrollment: the 13th birthday is the join edge; under 13 stores no person and no birth date", async () => {
    now = dayOf(20261122);
    const a = accounts();
    const young = phone(), edge = phone();
    expect(await joinWith(a, young, { birthdate: "2013-11-23" })).toEqual({ ok: false, error: "under_age" });
    expect(await store.findPhone(young)).toBeUndefined();
    expect(await store.sql`select 1 from platform.people where phone_hash = ${a.phoneHash(young)}`).toEqual([]);
    const floor = await store.ageFloorRecord(a.phoneHash(young));
    expect(floor?.age).toBe(12);
    expect(floor && floor.readings!.upper - floor.readings!.lower).toBe(10000);
    const joined = await joinWith(a, edge, { birthdate: "2013-11-22" });
    expect(joined.ok).toBe(true);
    expect((await personRow(edge)).birth_date).toBe(20131122);
    expect(await a.lowestAge(edge, await a.personFor(edge))).toBe(13);
  });

  test("siteEnrollment: a date that is not real, a future date and a date before 1900 are invalid_birthdate; both fields or neither are invalid", async () => {
    now = dayOf(20261122);
    const a = accounts();
    for (const birthdate of ["2010-02-30", "2010-13-01", "2026-11-23", "1899-12-31"]) {
      const e164 = phone();
      expect([birthdate, await joinWith(a, e164, { birthdate })]).toEqual([birthdate, { ok: false, error: "invalid_birthdate" }]);
      expect([birthdate, await store.ageFloorRecord(a.phoneHash(e164))]).toEqual([birthdate, undefined]);
    }
    expect(body({ birthdate: "2010-03-15", age: 16 })).toBeUndefined();
    expect(body({})).toBeUndefined();
    expect(body({ birthdate: "3/15/2010" })).toBeUndefined();
    expect(body({ birthdate: 20100315 })).toBeUndefined();
  });

  test("memberAge: a 29 February birth date reads 17 on 28 February and 18 on 1 March", async () => {
    now = dayOf(20260228);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { birthdate: "2008-02-29" })).ok).toBe(true);
    const person = await a.personFor(e164);
    expect(await a.lowestAge(e164, person)).toBe(17);
    expect((await a.ageRecord(e164, person)).birthExact).toBe(true);
    now = dayOf(20260301);
    expect(await a.lowestAge(e164, person)).toBe(18);
  });

  test("memberAge: a lower typed age after a birth date wins, makes a conflict and bars the phone from the teen pool", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { birthdate: "2010-03-15" })).ok).toBe(true);
    const person = await a.personFor(e164);
    expect(await a.ageRecord(e164, person)).toMatchObject({ age: 16, birthExact: true, ageConflict: false, teenBarred: false });
    await a.recordAge(e164, person, 15);
    expect(await a.lowestAge(e164, person)).toBe(15);
    expect(await a.ageRecord(e164, person)).toMatchObject({ age: 15, birthExact: false, ageConflict: true, teenBarred: true });
    expect((await store.sql`select reason from platform.teen_pool_bars where phone_hash = ${a.phoneHash(e164)}`)[0]?.reason).toBe("conflict");
    const adult = phone();
    expect((await joinWith(a, adult, { age: 30 })).ok).toBe(true);
    await a.recordAge(adult, await a.personFor(adult), 25);
    expect(await a.ageRecord(adult, await a.personFor(adult))).toMatchObject({ age: 25, ageConflict: true, teenBarred: false });
  });

  test("memberAge: a legacy minor of 15 who types an adult birth date stays 15 and in conflict", async () => {
    const a = accounts(), e164 = phone(), id = randomUUID();
    await store.sql`insert into platform.people (id, lowest_age, created_at, phone_hash) values (${id}::uuid, 15, ${new Date(dayOf(20260101))}, ${a.phoneHash(e164)})`;
    await store.sql`insert into platform.phone_identities (e164, person_id, verified_at, method) values (${e164}, ${id}::uuid, ${new Date(dayOf(20260101))}, 'otp_sms')`;
    const migration = await fileAt(new URL("../../observatory/db/migrations/0081_person_birth_readings.sql", import.meta.url)).text();
    await store.sql.unsafe(migration.match(/update platform\.people[\s\S]*?;/)![0]);
    const [legacy] = await store.sql`select birth_lower, birth_upper, birth_youngest, birth_first_exact from platform.people where id = ${id}::uuid`;
    expect(legacy!.birth_lower).toBe(20100101);
    expect(legacy!.birth_youngest).toBe(legacy!.birth_upper);
    expect(legacy!.birth_first_exact).toBe(false);
    now = dayOf(legacy!.birth_upper + 150000);
    const person = await a.personFor(e164);
    expect(await a.lowestAge(e164, person)).toBe(15);
    await a.recordBirthDate(e164, person, 19900101);
    expect(await a.lowestAge(e164, person)).toBe(15);
    expect(await a.ageRecord(e164, person)).toMatchObject({ age: 15, ageConflict: true, birthExact: false, teenBarred: true });
  });

  test("memberAge: a phone floor of 12 refuses a later adult birth date and stores no birth date", async () => {
    now = dayOf(20260601);
    const a = accounts(), e164 = phone();
    expect(await joinWith(a, e164, { age: 12 })).toEqual({ ok: false, error: "under_age" });
    now = dayOf(20261122);
    expect(await joinWith(a, e164, { birthdate: "1990-01-01" })).toEqual({ ok: false, error: "under_age" });
    expect(await store.findPhone(e164)).toBeUndefined();
    expect(await a.lowestAge(e164)).toBe(12);
  });

  test("accountPrivacy: delete everything keeps a coarse floor and the bar, drops the birth date and the teen pool hold and pair rows; a person on the floored phone gets the floor readings", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone(), hash = a.phoneHash(e164);
    expect((await joinWith(a, e164, { birthdate: "2010-03-15" })).ok).toBe(true);
    const person = (await a.personFor(e164))!;
    expect((await a.teenAgeFacts(person.id)).firstReadingExact).toBe(true);
    await a.barTeenPool(e164, "report", now);
    await store.sql`insert into platform.teen_pool_holds (phone_hash, app_id, at) values (${hash}, 'friends', ${new Date(now)})`;
    await store.sql`insert into platform.teen_pair_avoid (phone_hash_a, phone_hash_b, at) values (least(${hash}, 'pair-other-hash'), greatest(${hash}, 'pair-other-hash'), ${new Date(now)})`;
    await store.sql`insert into platform.teen_pair_avoid (phone_hash_a, phone_hash_b, at) values ('pair-kept-a', 'pair-kept-b', ${new Date(now)})`;
    expect(await a.deleteAll({ e164, personId: person.id })).toBe(true);
    const [gone] = await store.sql`select birth_date, birth_lower, birth_upper, birth_youngest, birth_first_exact, deleted_at from platform.people where id = ${person.id}::uuid`;
    expect(gone).toMatchObject({ birth_date: null, birth_lower: null, birth_upper: null, birth_youngest: null, birth_first_exact: null });
    expect(gone!.deleted_at).not.toBeNull();
    expect(await store.sql`select 1 from platform.teen_pool_holds where phone_hash = ${hash}`).toEqual([]);
    expect(await store.sql`select 1 from platform.teen_pair_avoid where phone_hash_a = ${hash} or phone_hash_b = ${hash}`).toEqual([]);
    expect(await store.sql`select phone_hash_a, phone_hash_b from platform.teen_pair_avoid where phone_hash_a = 'pair-kept-a'`).toEqual([{ phone_hash_a: "pair-kept-a", phone_hash_b: "pair-kept-b" }]);
    expect((await store.sql`select reason from platform.teen_pool_bars where phone_hash = ${hash}`)[0]?.reason).toBe("report");
    const floor = (await store.ageFloorRecord(hash))!;
    expect(floor.age).toBe(16);
    expect(floor.readings!.upper - floor.readings!.lower).toBe(10000);
    expect(floor.readings!.upper).not.toBe(20100315);
    const back = await store.createPerson({ id: randomUUID(), e164, method: "staff", at: now, lowestAge: null, phoneHash: hash });
    expect(back.id).toBe(person.id);
    expect(back.birth).toEqual({ readings: floor.readings, birthDate: null, firstExact: false });
    expect(await a.lowestAge(e164, back)).toBe(16);
    expect((await a.teenAgeFacts(back.id)).firstReadingExact).toBe(false);
  });

  test("siteEnrollment: a new person with a new id on a phone floored by an under-13 decline gets the floor readings", async () => {
    now = dayOf(20260601);
    const a = accounts(), e164 = phone(), hash = a.phoneHash(e164);
    expect(await joinWith(a, e164, { birthdate: "2014-01-01" })).toEqual({ ok: false, error: "under_age" });
    const floor = (await store.ageFloorRecord(hash))!;
    expect(floor).toMatchObject({ age: 12, firstExact: false });
    const id = randomUUID();
    const created = await store.createPerson({ id, e164, method: "staff", at: now, lowestAge: null, phoneHash: hash });
    expect(created.id).toBe(id);
    expect(created.birth).toEqual({ readings: floor.readings, birthDate: null, firstExact: false });
    expect(await a.lowestAge(e164, created)).toBe(12);
  });

  test("siteEnrollment: a phone that stated 12 and later joins with a birth date reads firstReadingExact false", async () => {
    now = dayOf(20250601);
    const a = accounts(), e164 = phone();
    expect(await joinWith(a, e164, { age: 12 })).toEqual({ ok: false, error: "under_age" });
    now = dayOf(20261122);
    const joined = await joinWith(a, e164, { birthdate: "2013-06-01" });
    expect(joined.ok).toBe(true);
    const person = (await a.personFor(e164))!;
    expect((await personRow(e164)).birth_date).toBe(20130601);
    expect(await a.lowestAge(e164, person)).toBe(13);
    expect((await a.teenAgeFacts(person.id)).firstReadingExact).toBe(false);
    const fresh = phone();
    expect((await joinWith(a, fresh, { birthdate: "2013-06-01" })).ok).toBe(true);
    expect((await a.teenAgeFacts((await a.personFor(fresh))!.id)).firstReadingExact).toBe(true);
  });

  test("phoneChange: an exact-date teen who changes number after a birthday keeps the birth date, the birthday rise and no bar", async () => {
    now = dayOf(20260310);
    const a = accounts(), oldNumber = phone(), newNumber = phone();
    const joined = await joinWith(a, oldNumber, { birthdate: "2010-03-15" });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    const owner = { e164: oldNumber, personId: joined.membership.personId };
    expect(await a.lowestAge(oldNumber, await a.personFor(oldNumber))).toBe(15);
    now = dayOf(20260320);
    expect(await a.startNumberChange(app, owner, newNumber, true, async () => ({ ok: true }))).toEqual({ ok: true });
    expect(await a.confirmNumberChange(owner, async () => true)).toEqual({ ok: true, e164: newNumber, personId: owner.personId });
    const moved = await a.personFor(newNumber);
    expect(moved?.id).toBe(owner.personId);
    expect(await a.ageRecord(newNumber, moved)).toMatchObject({ age: 16, birthKey: 20100315, birthExact: true, ageConflict: false, teenBarred: false });
    expect(await store.sql`select 1 from platform.teen_pool_bars where phone_hash = ${a.phoneHash(newNumber)}`).toEqual([]);
    expect((await a.teenAgeFacts(owner.personId)).firstReadingExact).toBe(true);
    now = dayOf(20270315);
    expect(await a.lowestAge(newNumber, moved)).toBe(17);
  });

  test("phoneChange: a teen's cross-app avoid edges move to the new number and no row keeps the old number", async () => {
    now = dayOf(20261122);
    const a = accounts(), oldNumber = phone(), newNumber = phone();
    const joined = await joinWith(a, oldNumber, { birthdate: "2010-03-15" });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    const owner = { e164: oldNumber, personId: joined.membership.personId };
    const oldHash = a.phoneHash(oldNumber), newHash = a.phoneHash(newNumber);
    const edge = (x: string, y: string) => store.sql`insert into platform.teen_pair_avoid (phone_hash_a, phone_hash_b, at)
      values (least(${x}::text, ${y}::text), greatest(${x}::text, ${y}::text), ${new Date(now)})`;
    const has = async (x: string, y: string) => (await store.sql`select 1 from platform.teen_pair_avoid
      where phone_hash_a = least(${x}::text, ${y}::text) and phone_hash_b = greatest(${x}::text, ${y}::text)`).length === 1;
    for (const other of ["avoid-declined-on-friends", "avoid-reported-on-ntwrk", "avoid-already-new"]) await edge(oldHash, other);
    await edge(newHash, "avoid-already-new");
    await edge("avoid-other-a", "avoid-other-b");
    expect(await a.startNumberChange(app, owner, newNumber, true, async () => ({ ok: true }))).toEqual({ ok: true });
    expect(await a.confirmNumberChange(owner, async () => true)).toEqual({ ok: true, e164: newNumber, personId: owner.personId });
    for (const other of ["avoid-declined-on-friends", "avoid-reported-on-ntwrk", "avoid-already-new"]) {
      expect([other, await has(newHash, other)]).toEqual([other, true]);
      expect([other, await has(oldHash, other)]).toEqual([other, false]);
    }
    expect(await store.sql`select 1 from platform.teen_pair_avoid where phone_hash_a = ${oldHash} or phone_hash_b = ${oldHash}`).toEqual([]);
    expect(await store.sql`select 1 from platform.teen_pair_avoid where phone_hash_a = ${newHash} or phone_hash_b = ${newHash}`).toHaveLength(3);
    expect(await has("avoid-other-a", "avoid-other-b")).toBe(true);
  });

  test("runtimeUnit: a birth date recorded through accounts on a transaction handle commits with that transaction", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { age: 16 })).ok).toBe(true);
    const person = await a.personFor(e164);
    await store.sql.begin(async tx => {
      const inUnit = new Accounts(new PgPeopleStore(tx), { hashKey: "synthetic-birth-fixture", now: () => now, apps: id => APPS[id] });
      await inUnit.recordBirthDate(e164, person, 20100315);
    });
    expect((await personRow(e164)).birth_date).toBe(20100315);
    expect(await a.ageRecord(e164, await a.personFor(e164))).toMatchObject({ age: 16, birthExact: true, ageConflict: false });
  });

  test("the 0082 matching-age view carries the birth readings, the floor readings and the bar, and no confirmation", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { birthdate: "2010-03-15" })).ok).toBe(true);
    const person = (await a.personFor(e164))!;
    const memberId = `friends_birth_${process.pid}_${seq}`;
    await store.sql`insert into network.members (id, app_id, name, home_city, account_status, person_id) values (${memberId}, 'friends', 'Sam', 'nyc', 'active', ${person.id}::uuid)`;
    const view = async () => (await store.sql`select * from platform.matching_ages where app_id = 'friends' and member_id = ${memberId}`)[0]!;
    const before = await view();
    expect(before).toMatchObject({ birth_date: 20100315, birth_lower: 20100314, birth_upper: 20100315, teen_pool_barred: false });
    expect(Object.keys(before)).not.toContain("teen_confirmed_birth");
    expect(before.floor_birth_upper - before.floor_birth_lower).toBe(10000);
    await a.barTeenPool(e164, "older_than_stated", now);
    expect(await view()).toMatchObject({ teen_pool_barred: true });
    const typed = phone();
    expect((await joinWith(a, typed, { age: 16 })).ok).toBe(true);
    expect((await a.teenAgeFacts((await a.personFor(typed))!.id)).firstReadingExact).toBe(false);
  });

  test("friendIntroAge: an exact-date 16 with no signal reads the teen facts with no confirmation row and no staff step", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { birthdate: "2010-03-15" })).ok).toBe(true);
    const person = (await a.personFor(e164))!;
    expect(await a.ageRecord(e164, person)).toEqual({ age: 16, maxAge: 16, birthKey: 20100315, birthExact: true, ageConflict: false, teenBarred: false });
    expect((await a.teenAgeFacts(person.id)).firstReadingExact).toBe(true);
    expect((await store.sql`select to_regclass('platform.teen_age_confirmations') as t`)[0]!.t).toBeNull();
    const memberId = `friends_ready_${process.pid}_${seq}`;
    await store.sql`insert into network.members (id, app_id, name, home_city, account_status, person_id) values (${memberId}, 'friends', 'Sam', 'nyc', 'active', ${person.id}::uuid)`;
    const [row] = await store.sql`select minor_signal_at, birth_date, teen_pool_barred from platform.matching_ages where app_id = 'friends' and member_id = ${memberId}`;
    expect(row).toEqual({ minor_signal_at: null, birth_date: 20100315, teen_pool_barred: false });
  });

  test("photoPolicy: photos refuse a 17-year-old and accept them from the 18th birthday by Clock", async () => {
    now = dayOf(20261122);
    const a = accounts(), e164 = phone();
    expect((await joinWith(a, e164, { birthdate: "2008-11-23" })).ok).toBe(true);
    const personId = (await a.personFor(e164))!.id;
    const photos = new PhotoService({ people: store, meta: new PgPhotoStore(store.sql), signingKey: "fixture-only", now: () => now, eligible: async () => true });
    expect(await photos.adult(personId, "slop")).toBe("adults_only");
    now = dayOf(20261123, 11, 59);
    expect(await photos.adult(personId, "slop")).toBe("adults_only");
    now = dayOf(20261123, 12, 0);
    expect(await photos.adult(personId, "slop")).toBeUndefined();
  });
});
