// Integration: the Notifier wired to the Postgres outbound queue (packages/blooio outbound-queue.ts,
// platform.outbound) on a recording "sim" provider, on a database of its own on the local dev cluster
// (:54339). Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { SimClock } from "../../core/src/clock.ts";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../db/dev-pg.ts";
import { pgAvailable } from "../../../apps/observatory/test/pg.ts";
import { OutboundQueue, recipientWindowHasher } from "../../blooio/src/outbound-queue.ts";
import type { ChannelAdapter, SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { Notifier, queuePolicy, queueSink, threadHooks, type Recipient } from "../src/index.ts";
import { deliveryIdFor } from "../src/scheduler.ts";

import { PgNotifyStore } from "../src/pg-store.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";

const user = process.env.USER ?? "postgres";
const db = `notify_wiring_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const NY = "America/New_York";
let admin: SQL, sql: SQL;
let n = 0;

/** One person, a Notifier, and the queue with an adapter that records what it would have sent. */
async function setup(prefs: Recipient["prefs"] = { channel: "imessage" }) {
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
  const notifier = new Notifier(store, { get: id => (id === r.personId ? r : undefined) }, { isQuiet: () => false });
  const queue = new OutboundQueue({
    recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"),
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

  test("the weekly cap holds proactive updates and still sends the requested items", async () => {
    const { now, store, queue, sink, sent: calls, r } = await setup();
    const notifier = new Notifier(store, { get: id => id === r.personId ? r : undefined }, {
      isQuiet: () => false, weeklyCap: 1, urgentDelayMs: 0,
    });
    await notifier.recordSent(req(r.personId, "previous-cap-delivery"), {
      deliveryId: "fixture-previous-cap-delivery", channel: "imessage", countsTowardCap: true, sentAt: now(),
    });
    const { item: proactive } = await notifier.add({
      ...req(r.personId, "proactive-at-cap", "New gathering ideas are available."), urgency: "urgent",
    }, now());
    const capped = await notifier.dispatch(now(), sink);
    expect(capped.sent).toEqual([]);
    expect(capped.holds).toEqual([expect.objectContaining({ personId: r.personId, reason: "weekly_cap" })]);

    const summary = "Dinner at seven is confirmed.";
    const { item: requested } = await notifier.add(req(r.personId, "requested-at-cap", summary), now());
    const mixed = await notifier.dispatch(now(), sink);
    expect(mixed.sent).toEqual([expect.objectContaining({ itemIds: [requested.id], countsTowardCap: false })]);
    expect(await store.capSendsSince(r.personId, now())).toEqual([now()]);
    expect((await store.getItems([proactive.id]))[0]?.notifiedAt).toBeUndefined();
    await queue.drain();
    expect(calls.map(call => call.text)).toEqual([summary]);
    await store.markSeen(r.personId, "imessage", now(), [proactive.id]);
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

  // spec/notificationDispatch.md, "Re-read the planned items before recording a digest"
  test("a recipient removed after planning leaves no delivery record or queue entry", async () => {
    const { now, store, queue, sink, sent: calls, r } = await setup();
    let lookups = 0;
    const notifier = new Notifier(store, { get: () => ++lookups === 1 ? r : undefined }, { isQuiet: () => false });
    const { item } = await notifier.add(req(r.personId, "removed-recipient"), now());
    const id = deliveryIdFor(r.personId, [item.id]);

    expect(await notifier.dispatch(now(), sink)).toEqual({ sent: [], cancelled: [id], holds: [] });
    await queue.drain();
    expect(await store.getDelivery(id)).toBeUndefined();
    expect(await queue.statusOf(id)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  // spec/notificationDispatch.md, "Re-read the planned items before recording a digest"
  test("a prepared link is rebuilt into one thread update when the app grant ends before enqueue", async () => {
    const { now, store, notifier, queue, sink, sent: calls, r } = await setup({ channel: "imessage", explicit: "claude" });
    let checked = 0;
    notifier.setAssistantUpdatesLookup(async (personId, app) => personId === r.personId && app === "friends" && ++checked === 1 ? ["claude"] : []);
    await notifier.setActive(r.personId, "claude", true);
    const summary = "Dinner at seven is confirmed.";
    const { item } = await notifier.add(req(r.personId, "grant-ended", summary), now());
    const result = await notifier.dispatch(now(), sink);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]).toMatchObject({ delivery: { mode: "thread" }, text: summary, itemIds: [item.id] });
    expect(result.sent[0]?.token).toBeUndefined();
    expect(await store.getDelivery(deliveryIdFor(r.personId, [item.id]))).toMatchObject({ target: "imessage", itemIds: [item.id] });
    await queue.drain();
    expect(calls.map(call => call.text)).toEqual([summary]);
  });

  // spec/notificationDispatch.md, "The sink receives only a recorded digest"
  test("overlapping digests cannot both claim the same item", async () => {
    const { now, notifier, r, store } = await setup();
    const items = await Promise.all(["first", "shared", "last"].map(async name => (await notifier.add(req(r.personId, name), now())).item.id));
    const itemSets = [items.slice(0, 2), items.slice(1)];
    const ids = itemSets.map(set => deliveryIdFor(r.personId, set));
    const recorded = await Promise.all(itemSets.map((itemIds, index) => store.recordDelivery({
      deliveryId: ids[index]!, personId: r.personId, itemIds, target: "imessage", countsTowardCap: true, sentAt: now(),
    })));

    expect(recorded.filter(Boolean)).toHaveLength(1);
    const [first, shared, last] = await store.getItems(items);
    expect(shared?.deliveryId).toBe(ids[recorded[0] ? 0 : 1]);
    expect(recorded[0] ? last?.notifiedAt : first?.notifiedAt).toBeUndefined();
    expect(await store.getDelivery(ids[recorded[0] ? 1 : 0]!)).toBeUndefined();
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

  test.each(["imessage", "sms"] as const)("an assistant whose links went unused twice is pointed at again after use (%s)", async channel => {
    // spec/notificationDelivery.md, "An assistant link records its selected surface"
    const { clock, now, notifier, store, sink, r } = await setup({ channel, explicit: "claude" });
    notifier.setAssistantUpdatesLookup(async (personId, app) => personId === r.personId && app === "friends" ? ["chatgpt", "claude"] : []);
    await notifier.setActive(r.personId, "chatgpt", true);
    await notifier.setActive(r.personId, "claude", true);
    const linked = channel === "imessage" ? { mode: "deeplink", assistant: "claude" }
      : { mode: "button_page", assistants: ["claude", "chatgpt"] };
    const send = async (subject: string) => {
      await notifier.add(req(r.personId, subject), now());
      const { sent } = await notifier.dispatch(now(), sink);
      expect(sent).toHaveLength(1);
      return sent[0]!;
    };
    // Two Claude links nobody tapped: each closes as ignored after the outcome window, so Claude drops out.
    for (const subject of ["u1", "u2"]) {
      const update = await send(subject);
      expect(update.delivery).toMatchObject(linked);
      clock.advance(notifier.cfg.outcomeWindowMs + 60_000);
      await notifier.sweep(now());
      expect(await store.getDelivery(update.deliveryId)).toMatchObject({ target: "claude", outcome: "ignored" });
    }
    const signals = await store.signals(r.personId);
    expect(signals.find(signal => signal.surface === "claude")).toMatchObject({ ignored: 2, ignoredStreak: 2 });
    expect(signals.find(signal => signal.surface === channel)?.ignored ?? 0).toBe(0);
    expect(signals.find(signal => signal.surface === "chatgpt")?.ignored ?? 0).toBe(0);
    expect((await send("u3")).delivery).toMatchObject({ mode: "thread", reason: "explicit_link_unused" });
    // The member opens Claude and asks for their updates there (get_updates through the grant).
    clock.advance(60_000);
    await notifier.readUpdates(r.personId, "claude", now());
    // Claude is in use again: the next update points there.
    const next = await send("u4");
    expect(next.delivery).toMatchObject(linked);
    if (channel === "imessage") expect(next.text).toContain("https://claude.ai/new?q=");
  });

  test.each(["acted", "ignored"] as const)("a failed signal write leaves the %s delivery open for retry", async outcome => {
    // spec/notificationAcknowledgement.md, "Count a delivery action only when the store closes a pending delivery"
    const { clock, now, store, notifier, r } = await setup();
    const deliveryId = "fixture-surface-write-" + outcome;
    await notifier.recordSent(req(r.personId, outcome), { deliveryId, channel: "imessage", countsTowardCap: false, sentAt: now() });
    if (outcome === "ignored") clock.advance(notifier.cfg.outcomeWindowMs + 1);
    const apply = () => outcome === "acted" ? notifier.threadReply(r.personId, "imessage", now()) : notifier.sweep(now());

    await sql`create function notify.fixture_reject_surface_count() returns trigger language plpgsql as $$
      begin
        if new.acted > coalesce(old.acted, 0) or new.ignored > coalesce(old.ignored, 0) then
          raise exception 'fixture surface count unavailable';
        end if;
        return new;
      end;
    $$`;
    await sql`create trigger fixture_reject_surface_count before insert or update on notify.surface_signals
      for each row execute function notify.fixture_reject_surface_count()`;
    try {
      await expect(apply()).rejects.toThrow("fixture surface count unavailable");
      expect((await store.getDelivery(deliveryId))?.outcome).toBeUndefined();
      expect((await store.signals(r.personId)).every(signal => signal.acted === 0 && signal.ignored === 0)).toBe(true);
    } finally {
      await sql`drop trigger fixture_reject_surface_count on notify.surface_signals`;
      await sql`drop function notify.fixture_reject_surface_count()`;
    }

    await Promise.all([apply(), apply()]);
    expect((await store.getDelivery(deliveryId))?.outcome).toBe(outcome);
    expect((await store.signals(r.personId)).find(signal => signal.surface === "imessage")).toMatchObject({
      acted: outcome === "acted" ? 1 : 0,
      ignored: outcome === "ignored" ? 1 : 0,
      ignoredStreak: outcome === "ignored" ? 1 : 0,
    });
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
