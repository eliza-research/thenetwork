import { expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { PgNotifyStore } from "../../notify/src/pg-store.ts";
import { Accounts } from "../../platform/src/accounts.ts";
import { APPS } from "../../platform/src/apps.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { Notifier } from "../../notify/src/scheduler.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";

// spec/notificationAcknowledgement.md, "A delivered text can appear only once and its opportunity must still be current"
test.skipIf(!pgAvailable)("SD-151: a Network text whose delivery write fails is never left pending for the scheduler", async () => {
  const url = await migratedDb("network_notify_recorded_text");
  const sql = new SQL(url);
  const store = new PgNotifyStore(url);
  const people = new PgPeopleStore(url);
  const notifier = new Notifier(store, { get: () => undefined });
  const now = Date.UTC(2026, 10, 18, 16);
  const accounts = new Accounts(people, { hashKey: "synthetic-sd151-fixture", now: () => now, apps: id => APPS[id] });
  const person = await accounts.createPerson("+12125550151", "inbound_message", 30);
  await people.putMembership({ app: "friends", personId: person.id, memberId: "friends_sd151", state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: now, leftAt: null });
  const input = { personId: person.id, app: "friends", eventType: "reminder", subjectId: "walk-sd151", urgency: "normal" as const, summary: "The walk is tomorrow." };
  const delivery = { deliveryId: "net:walk-sd151", channel: "imessage" as const, countsTowardCap: true, sentAt: now };
  try {
    // The delivery insert fails after the item insert (a lost connection or a lock timeout in production).
    await sql.unsafe(`create function notify.sd151_fail() returns trigger language plpgsql as $$
      begin if new.delivery_id = 'net:walk-sd151' then raise exception 'delivery write failed'; end if; return new; end $$`);
    await sql.unsafe(`create trigger sd151_fail before insert on notify.deliveries for each row execute function notify.sd151_fail()`);
    await expect(notifier.recordSent(input, delivery)).rejects.toThrow("delivery write failed");
    // The scheduler must not see the text as a pending item: it went out already.
    expect(await store.peopleWithPending(now + 1)).not.toContain(person.id);

    await sql.unsafe(`drop trigger sd151_fail on notify.deliveries`);
    const r = await notifier.recordSent(input, delivery);
    expect(r.item.notifiedAt).toBeUndefined();
    const [row] = await sql`select notified_at, delivery_id from notify.inbox_items where person_id = ${person.id}`;
    expect([new Date(row.notified_at).getTime(), row.delivery_id]).toEqual([now, "net:walk-sd151"]);
    expect(await store.peopleWithPending(now + 1)).not.toContain(person.id);
  } finally {
    await store.close();
    await people.close();
    await sql.close();
    await dropDb(url);
  }
});
