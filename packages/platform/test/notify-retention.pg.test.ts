// Canonical account erasure and Notify retention on real PostgreSQL; synthetic records only.
import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {Accounts} from "../src/accounts.ts";
import {APPS} from "../src/apps.ts";
import {PgPeopleStore} from "../src/pg-store.ts";
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
    await Bun.sleep(20);
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
});
