// Integration: the Notifier wired to the Postgres outbound queue (packages/blooio outbound-queue.ts,
// platform.outbound) on a recording "sim" provider, on a database of its own on the local dev cluster
// (:54339). Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { SimClock } from "../../core/src/clock.ts";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { OutboundQueue } from "../../blooio/src/outbound-queue.ts";
import type { ChannelAdapter, SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { Notifier, queuePolicy, queueSink, threadHooks, type Recipient } from "../src/index.ts";
import type { SchedulerConfig } from "../src/scheduler.ts";

import { PgNotifyStore } from "../src/pg-store.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";

const user = process.env.USER ?? "postgres";
const db = `notify_wiring_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const NY = "America/New_York";
let admin: SQL, sql: SQL;
let n = 0;

/** One person, a Notifier, and the queue with an adapter that records what it would have sent. */
async function setup(prefs: Recipient["prefs"] = { channel: "imessage" }, cfg: Partial<SchedulerConfig> = {}) {
  // 12:00 in New York: outside quiet hours. Each setup has its own person and number.
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const now = () => clock.now();
  const to = `+121255501${String(++n).padStart(2, "0")}`;
  const sent: SendRequest[] = [];
  const provider: ChannelAdapter = {
    kind: "sim",
    async send(req) { sent.push(req); return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim" }; },
  };
  const store = new PgNotifyStore(sql);
  const people = new PgPeopleStore(sql);
  const person = await people.createPerson({ id: randomUUID(), e164: to, method: "inbound_message", at: now(), lowestAge: 28 });
  await people.putMembership({ app: "friends", personId: person.id, memberId: `friends_${n}`, state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: now(), leftAt: null });
  const r: Recipient = { personId: person.id, to, timeZone: NY, prefs, proactiveAllowed: true };
  const notifier = new Notifier(store, { get: id => (id === r.personId ? r : undefined) }, { isQuiet: () => false, ...cfg });
  const queue = new OutboundQueue({
    sql, clock, provider, line: "+12125550100", app: "friends",
    checks: { live: () => true, recipient: queuePolicy(notifier, clock) },
    leakAllow: Object.values(APPS).flatMap(a => [`https://${a.domain}`, a.domain]),
  });
  return { clock, now, store, notifier, queue, sink: queueSink(queue), sent, r };
}

const req = (personId: string, subjectId: string, summary = "Dinner at 7 is confirmed.") =>
  ({ personId, app: "friends", eventType: "plan", subjectId, urgency: "requested" as const, summary });

describe.skipIf(!pgAvailable)("notify + the Postgres outbound queue", () => {
  beforeAll(async () => {
    await devPgUp();
    admin = new SQL({ url: `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin?.close();
  });

  test("a delivery goes through the queue once, keyed by its delivery id", async () => {
    const { now, notifier, queue, sink, sent: calls, r } = await setup();
    await notifier.add(req(r.personId, "pl1"), now());
    const { sent } = await notifier.dispatch(now(), sink);
    await notifier.dispatch(now(), sink);
    await queue.drain();
    await queue.drain();
    expect(sent.length).toBe(1);
    expect(calls.map(c => c.idempotencyKey)).toEqual([`tn:${sent[0]!.deliveryId}`]);
    expect(await queue.statusOf(sent[0]!.deliveryId)).toBe("sent");
  });

  test("seen on another surface while waiting in the queue: suppressed", async () => {
    const { now, store, notifier, queue, sink, sent: calls, r } = await setup();
    const it = (await notifier.add(req(r.personId, "pl2", "Dinner moved to 8."), now())).item;
    const { sent } = await notifier.dispatch(now(), sink);
    await store.markSeen(r.personId, "claude", now(), [it.id]);
    await queue.drain();
    const [row] = await sql`select status, note from platform.outbound where id = ${sent[0]!.deliveryId}`;
    expect([row.status, row.note]).toEqual(["suppressed_ineligible", "notification_obsolete"]);
    expect(calls.length).toBe(0);
  });


  // PRD 32.9 / 1240: the weekly cap counts messages sent; "just before sending, items are re-checked and the
  // message is cancelled if they were already seen elsewhere". A cancelled text was never sent.
  test("a text cancelled at send time (seen in an assistant first) spends no weekly-cap slot and is not an ignored outcome", async () => {
    const HOUR = 3600_000;
    const { clock, now, store, notifier, queue, sink, sent: calls, r } = await setup({ channel: "imessage" }, { weeklyCap: 1, digestDelayMs: 10 * 60_000 });
    // Normal items wait for the digest (10 minutes here); 12:00 to 13:00 in New York, outside quiet hours.
    await notifier.add({ ...req(r.personId, "cap-a", "A new run club starts Tuesday."), urgency: "normal" }, now());
    clock.advance(15 * 60_000);
    const first = await notifier.dispatch(now(), sink);
    expect(first.sent).toHaveLength(1);
    // The member asks their assistant for updates before the queue sends the text.
    expect((await notifier.readUpdates(r.personId, "claude", now())).map(i => i.subjectId)).toEqual(["cap-a"]);
    await queue.drain();
    expect(calls).toHaveLength(0);
    expect(await queue.statusOf(first.sent[0]!.deliveryId)).toBe("suppressed_ineligible");
    // A new normal item: the cap of one was never used, so it goes. Before the fix: held "weekly_cap".
    clock.advance(15 * 60_000);
    await notifier.add({ ...req(r.personId, "cap-b", "Saturday's hike has two spots left."), urgency: "normal" }, now());
    clock.advance(15 * 60_000);
    const second = await notifier.dispatch(now(), sink);
    expect(second.holds).toEqual([]);
    expect(second.sent.map(p => p.itemIds.length)).toEqual([1]);
    await queue.drain();
    expect(calls).toHaveLength(1);
    // Past the outcome window: the cancelled text is no ignored outcome for the surface it would have used.
    clock.advance(80 * HOUR);
    await notifier.sweep(now());
    expect((await store.signals(r.personId)).reduce((n, s) => n + (s.ignored ?? 0), 0)).toBe(1);
  });

  test.each(["expired", "mixed", "erased", "left_app"] as const)("queued notification with %s content is suppressed", async mode => {
    const { clock, now, notifier, queue, sink, sent: calls, r } = await setup();
    await notifier.add({ ...req(r.personId, `exp-${mode}`), expiresAt: now() + 60_000 }, now());
    if (mode === "mixed") await notifier.add(req(r.personId, "still-live", "Another update."), now());
    if (mode === "left_app") {
      await new PgPeopleStore(sql).putMembership({ app: "slop", personId: r.personId, memberId: `slop_${n}`, state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: now(), leftAt: null });
      await notifier.add({ ...req(r.personId, "other-app", "Another update."), app: "slop" }, now());
    }
    const { sent } = await notifier.dispatch(now(), sink);
    expect(sent).toHaveLength(1);
    if (mode === "erased") await new PgPeopleStore(sql).deleteAll(r.personId, r.to, "synthetic-deletion-hash", now());
    else if (mode === "left_app") await new PgPeopleStore(sql).forgetMembership(r.personId, "friends", now());
    else clock.advance(60_000);
    await queue.drain();
    expect(calls).toHaveLength(0);
    expect(await queue.statusOf(sent[0]!.deliveryId)).toBe("suppressed_ineligible");
  });

  test("thread hooks: readUpdates clears the inbox; an inbound message counts as acting", async () => {
    const { now, store, notifier, sink, r } = await setup();
    await notifier.add(req(r.personId, "m1", "You have a new match."), now());
    await notifier.dispatch(now(), sink);
    await notifier.add({ ...req(r.personId, "m2", "Another one."), urgency: "normal" }, now());
    const t = threadHooks(notifier, now);
    // Everything unseen, including an item already texted: "updates" is the member asking to see it all.
    expect(await t.readUpdates(r.personId)).toEqual({ items: [{ summary: "You have a new match." }, { summary: "Another one." }] });
    expect((await store.unseen(r.personId, now())).length).toBe(0);
    await t.inbound(r.personId, "imessage");
    expect((await store.signals(r.personId)).find(s => s.surface === "imessage")).toMatchObject({ acted: 1 });
  });
});
