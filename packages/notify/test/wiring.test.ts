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

  test("an assistant whose links went unused twice is pointed at again once the member uses it", async () => {
    const { clock, now, notifier, sink, r } = await setup({ channel: "imessage", explicit: "claude" });
    await notifier.setActive(r.personId, "claude", true);
    const send = async (subject: string) => {
      await notifier.add(req(r.personId, subject), now());
      const { sent } = await notifier.dispatch(now(), sink);
      expect(sent).toHaveLength(1);
      return sent[0]!;
    };
    // Two Claude links nobody tapped: each closes as ignored after the outcome window, so Claude drops out.
    for (const subject of ["u1", "u2"]) {
      expect((await send(subject)).delivery).toMatchObject({ mode: "deeplink", assistant: "claude" });
      clock.advance(notifier.cfg.outcomeWindowMs + 60_000);
      await notifier.sweep(now());
    }
    expect((await send("u3")).delivery).toMatchObject({ mode: "thread", reason: "explicit_link_unused" });
    // The member opens Claude and asks for their updates there (get_updates through the grant).
    clock.advance(60_000);
    await notifier.readUpdates(r.personId, "claude", now());
    // Claude is in use again: the next update points there.
    const next = await send("u4");
    expect(next.delivery).toMatchObject({ mode: "deeplink", assistant: "claude" });
    expect(next.text).toContain("https://claude.ai/new?q=");
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
