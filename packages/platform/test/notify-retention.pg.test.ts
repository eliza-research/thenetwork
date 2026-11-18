// Canonical account erasure and Notify retention on real PostgreSQL; synthetic records only.
import { setTimeout as sleep } from "node:timers/promises";
import {afterAll, beforeAll, describe, expect, test} from "vitest";
import {DAY} from "../../core/src/clock.ts";
import {Accounts} from "../src/accounts.ts";
import {APPS} from "../src/apps.ts";
import {PgPeopleStore} from "../src/pg-store.ts";
import {MemoryPeopleStore} from "../src/store.ts";
import {PgNotifyStore} from "../../notify/src/pg-store.ts";
import {dropDb, migratedDb, pgAvailable} from "./pg.ts";

describe.skipIf(!pgAvailable)("canonical Notify erasure (PostgreSQL)", () => {
  let url: string, people: PgPeopleStore, notify: PgNotifyStore, accounts: Accounts;
  const now = Date.UTC(2026, 9, 9, 15), phone = "+12125550171";
  beforeAll(async () => {
    url = await migratedDb("notify_retention"); people = new PgPeopleStore(url); notify = new PgNotifyStore(people.sql);
    accounts = new Accounts(people, {hashKey: "synthetic-retention-fixture", now: () => now, apps: id => APPS[id]});
  }, 120_000);
  afterAll(async () => {await people?.close(); if (url) await dropDb(url);});

  // spec/platformRetention.md, "Retain the STOP hint count for its full window"
  test("rate cleanup retains each counter at its cutoff and removes older counters", async () => {
    const stopHintCutoff = now - 30 * DAY;
    const counters = [
      { bucket: "ordinary:keep", lastAt: now, retained: true },
      { bucket: "ordinary:expire", lastAt: now - 1, retained: false },
      { bucket: "stop_hint:keep", lastAt: stopHintCutoff, retained: true },
      { bucket: "stop_hint:expire", lastAt: stopHintCutoff - 1, retained: false },
    ];
    for (const store of [people, new MemoryPeopleStore()]) {
      for (const { bucket, lastAt } of counters) await store.hit(bucket, DAY, lastAt);
      await store.purge(now);
      for (const { bucket, lastAt, retained } of counters) {
        expect((await store.hit(bucket, DAY, lastAt)).count).toBe(retained ? 2 : 1);
      }
    }
  });

  test("app leave preserves other apps and STOP; full erasure waits for admitted writes and fences late references", async () => {
    const person = await accounts.createPerson(phone, "inbound_message", 28);
    const other = await accounts.createPerson("+12125550172", "inbound_message", 29);
    for (const app of ["slop", "friends"] as const) await people.putMembership({app, personId: person.id, memberId: `${app}_fixture`, state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: now, leftAt: null});
    await people.putMembership({app: "friends", personId: other.id, memberId: "other_fixture", state: "active", review: null, firstName: "Other", profile: {}, joinedAt: now, leftAt: null});
    const add = async (personId: string, app: string, subjectId: string) => (await notify.addItem({personId, app, eventType: "fixture", subjectId, urgency: "normal", summary: `${subjectId} private fixture`}, now)).item;
    const a = await add(person.id, "slop", "app-a"), b = await add(person.id, "friends", "app-b"), outsider = await add(other.id, "friends", "other-person");
    await notify.recordDelivery({deliveryId: "mixed", personId: person.id, itemIds: [a.id, b.id], target: "chatgpt", countsTowardCap: true, sentAt: now});
    await notify.insertToken({token: "T-ABCDEF", personId: person.id, itemIds: [a.id, b.id], issuedAt: now, expiresAt: now + 86400000});
    await notify.setActive(person.id, "chatgpt", true);
    await notify.setActive(other.id, "web", true);
    const signals = await notify.signals(person.id), otherSignals = await notify.signals(other.id);
    await expect(Promise.resolve(people.sql`select notify.forget_data(${person.id}, null)`)).rejects.toThrow("Notify full erasure requires canonical deletion");
    await expect(people.sql.begin(async tx => {await tx`select set_config('app.app_id', 'slop', true)`; await tx`select notify.forget_data(${person.id}, 'slop')`;})).rejects.toThrow("Notify app erasure requires canonical removal");
    await expect(people.sql.begin(async tx => {
      await tx.unsafe("set local role platform_service");
      await tx`select set_config('app.app_id', 'slop', true)`;
      await tx`select notify.forget_data(${person.id}, 'slop')`;
    })).rejects.toThrow("Notify app erasure requires canonical removal");
    await people.sql.begin(async tx => {
      await tx.unsafe("set local role network_service");
      await tx`select set_config('app.app_id', 'friends', true)`;
      await tx`insert into notify.inbox_items (dedupe_key, person_id, app_id, event_type, subject_id, urgency, summary, created_at)
        values ('service-role-live', ${person.id}, 'friends', 'fixture', 'service-role', 'normal', 'SERVICE_ROLE_FIXTURE', ${new Date(now)})`;
    });
    await people.putMembership({app: "ntwrk", personId: person.id, memberId: "pending_fixture", state: "invited", review: null, firstName: "Pending", profile: {}, joinedAt: null, leftAt: null});
    const pending = await add(person.id, "ntwrk", "pending");
    await accounts.leave(APPS.ntwrk, {e164: phone, personId: person.id});
    expect(await notify.getItems([pending.id])).toEqual([]);
    expect(await notify.signals(person.id)).toEqual(signals);
    await accounts.stop(APPS.slop, {e164: phone, personId: person.id});
    const stopBefore = await people.consentEvents(phone, "friends");
    await people.suppress(accounts.phoneHash(phone), "existing-fixture-suppression", now);
    await accounts.leave(APPS.slop, {e164: phone, personId: person.id});
    expect((await notify.getItems([a.id, b.id])).map(item => item.id)).toEqual([b.id]);
    expect((await notify.getDelivery("mixed"))!.itemIds).toEqual([b.id]);
    expect((await notify.getToken("T-ABCDEF"))!.itemIds).toEqual([b.id]);
    expect(await notify.signals(person.id)).toEqual(signals);
    expect(await people.consentEvents(phone, "friends")).toEqual(stopBefore);
    expect(await accounts.optedIn("friends", phone)).toBe(false);
    expect(await people.isSuppressed(accounts.phoneHash(phone))).toBe(true);
    await expect(add(person.id, "slop", "late-erased-app")).rejects.toThrow("Notify membership is unavailable");
    expect(await notify.recordDelivery({deliveryId: "late-a", personId: person.id, itemIds: [a.id], target: "chatgpt", countsTowardCap: false, sentAt: now})).toBe(false);
    expect(await notify.insertToken({token: "T-GHIJKL", personId: person.id, itemIds: [a.id], issuedAt: now, expiresAt: now + 1000})).toBe(false);
    expect((await notify.getItems([outsider.id])).map(item => item.id)).toEqual([outsider.id]);
    expect(await notify.signals(other.id)).toEqual(otherSignals);

    // The actual insert trigger holds the canonical person fence until its transaction commits.
    let entered!: () => void, resume!: () => void;
    const admitted = new Promise<void>(resolve => {entered = resolve;}), release = new Promise<void>(resolve => {resume = resolve;});
    const writing = people.sql.begin(async tx => {
      await tx`insert into notify.inbox_items (dedupe_key, person_id, app_id, event_type, subject_id, urgency, summary, created_at)
        values ('admitted-before-delete', ${person.id}, 'friends', 'fixture', 'admitted', 'normal', 'PRIVATE_ADMITTED_FIXTURE', ${new Date(now)})`;
      entered(); await release;
    });
    await admitted;
    let erased = false;
    const deleting = people.deleteAll(person.id, phone, accounts.phoneHash(phone), now).then(() => {erased = true;});
    await sleep(20);
    expect(erased).toBe(false);
    resume(); await writing; await deleting;
    for (const table of ["inbox_items", "deliveries", "task_tokens", "surface_signals"]) {
      expect((await people.sql.unsafe(`select count(*)::int as n from notify.${table} where person_id = $1`, [person.id]))[0].n).toBe(0);
    }
    await expect(add(person.id, "friends", "late-deleted-person")).rejects.toThrow("Notify membership is unavailable");
    await notify.setActive(person.id, "chatgpt", true);
    expect(await notify.signals(person.id)).toEqual([]);
    expect(await notify.getItems([outsider.id])).toHaveLength(1);
    expect(await notify.signals(other.id)).toEqual(otherSignals);
    expect(await people.isSuppressed(accounts.phoneHash(phone))).toBe(true);
  });
  // spec/accountPrivacy.md, "The service completes each operation in its own scope"
  test("app leave and whole-account erasure remove scoped receipts and incoming photo relay records", async () => {
    const receiverPhone = "+12125550177";
    const receiver = await accounts.createPerson(receiverPhone, "inbound_message", 28);
    const sender = await accounts.createPerson("+12125550178", "inbound_message", 30);
    const received = new Date(now);
    const memberships = [
      { app: "slop", personId: receiver.id, memberId: "erase_relay_receiver" },
      { app: "friends", personId: receiver.id, memberId: "erase_receipt_receiver" },
      { app: "slop", personId: sender.id, memberId: "erase_relay_sender" },
    ] as const;
    for (const membership of memberships) {
      await people.putMembership({ ...membership, state: "active", review: null, firstName: "Fixture", profile: {}, joinedAt: now, leftAt: null });
      await people.sql`insert into network.members(id,app_id,person_id,home_city,age)
        values(${membership.memberId},${membership.app},${membership.personId},'nyc',30)`;
      await people.sql`insert into platform.profile_suggestion_connection_receipts(request_nonce,request_hash,event_id,operation,app_id,person_id,member_id,user_id,organization_id,chat_id,connection_id,revoked_at)
        values(gen_random_uuid(),${"a".repeat(64)},'fixture','disconnect',${membership.app},${membership.personId},${membership.memberId},'user-fixture','org-fixture','chat-fixture','connection-fixture',${received})`;
    }
    const photo = "erasure_relay_photo";
    await people.sql`insert into platform.photos(id,person_id,app_id,storage_key,content_type,bytes,sha256,consent_version,created_at)
      values(${photo},${sender.id},'slop','fixture/erasure-photo','image/jpeg',100,${"b".repeat(64)},'fixture',${received})`;
    await people.sql`insert into platform.photo_relay_items
      (id,app_id,sender_person_id,recipient_person_id,photo_id,thread_id,sender_member_id,recipient_member_id,content_sha256,
       content_type,content_bytes,consent_id,consented_at,expires_at,policy_version,policy_notice,notice,state)
      values(${`pri_${"c".repeat(32)}`},'slop',${sender.id},${receiver.id},${photo},'fixture-thread',
        ${memberships[2].memberId},${memberships[0].memberId},${"b".repeat(64)},'image/jpeg',100,'fixture-consent',${received},
        ${new Date(now + 60_000)},'fixture','fixture','fixture','pending')`;

    const receipts = () => people.sql`select app_id,person_id from platform.profile_suggestion_connection_receipts order by app_id,person_id`;
    const incoming = () => people.sql`select id from platform.photo_relay_items where recipient_person_id=${receiver.id}`;
    const who = { e164: receiverPhone, personId: receiver.id };
    await accounts.leave(APPS.friends, who);
    expect(await receipts()).toEqual(expect.arrayContaining([
      { app_id: "slop", person_id: receiver.id }, { app_id: "slop", person_id: sender.id },
    ]));
    expect(await receipts()).toHaveLength(2);
    expect(await incoming()).toHaveLength(1);

    await accounts.deleteAll(who);
    expect(await receipts()).toEqual([{ app_id: "slop", person_id: sender.id }]);
    expect(await incoming()).toHaveLength(0);
    expect(await people.sql`select id from platform.photos where id=${photo}`).toEqual([{ id: photo }]);
  });

  // spec/accountPrivacy.md, "Erasure follows the authorized person across a number change"
  test("in-flight erasure follows the verified person and preserves a new owner of the original number", async () => {
    const oldPhone = "+12125550176", movedPhone = "+12125550177", app = APPS.friends;
    const holder = await accounts.join(app, { e164: oldPhone, personId: null }, {
      firstName: "Original", age: 27, consent: { sms: true, wording: app.consent.text },
    });
    if (!holder.ok) throw new Error(`Fixture join refused: ${holder.error}`);
    const original = { e164: oldPhone, personId: holder.membership.personId };
    expect(await accounts.startNumberChange(app, original, movedPhone, true, async () => true)).toEqual({ ok: true });

    let entered!: () => void, resume!: () => void;
    const forgetting = new Promise<void>(resolve => { entered = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    const erasing = new Accounts(people, { hashKey: "synthetic-retention-fixture", now: () => now, apps: id => APPS[id],
      hooks: { onForget: async () => { entered(); await release; } },
    });
    const pending = erasing.deleteAll(original);
    try {
      await forgetting;
      expect(await accounts.confirmNumberChange(original, async () => true)).toEqual({ ok: true, e164: movedPhone, personId: original.personId });
      const joined = await accounts.join(app, { e164: oldPhone, personId: null }, {
        firstName: "Current", age: 32, consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Replacement fixture join refused: ${joined.error}`);
      if (joined.membership.personId === original.personId) throw new Error("The fixture did not reassign the original number");
      resume();
      await pending;

      expect(await people.findPhone(oldPhone)).toMatchObject({ personId: joined.membership.personId });
      expect(await accounts.optedIn(app.id, oldPhone)).toBe(true);
      expect(await people.isSuppressed(accounts.phoneHash(oldPhone))).toBe(false);
      expect(await people.ageFloor(accounts.phoneHash(oldPhone))).toBe(32);
      expect(await people.getPerson(original.personId)).toMatchObject({ deletedAt: now });
      expect(await people.memberships(original.personId)).toEqual([]);
      expect(await people.findPhone(movedPhone)).toBeUndefined();
      expect(await people.consentEvents(movedPhone, app.id)).toEqual([]);
      expect(await people.isSuppressed(accounts.phoneHash(movedPhone))).toBe(true);
      expect(await people.ageFloor(accounts.phoneHash(movedPhone))).toBe(27);
      // The old identity cannot authorize a second erasure after the move and reassignment.
      expect(await accounts.deleteAll(original)).toBe(false);
      expect(await accounts.optedIn(app.id, oldPhone)).toBe(true);
    } finally {
      resume();
      await pending;
    }
  });

});
