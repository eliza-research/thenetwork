// Integration: the Notifier's delivery record on Postgres (PgNotifyStore, db/schema.sql), on a
// database of its own on the local dev cluster (:54339). It checks that an inbox item is texted at
// most once: a Network text recorded with recordSent is never texted again by dispatch, and two
// scheduler replicas that overlap never put one item in two texts. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { Notifier, type OutboundSink, type Recipient } from "../src/index.ts";
import { PgNotifyStore } from "../src/pg-store.ts";
import type { DeliveryRecord } from "../src/store.ts";

const user = process.env.USER ?? "postgres";
const db = `notify_delivery_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const NOW = Date.UTC(2026, 9, 9, 16);
let admin: SQL, sql: SQL;
let n = 0;

/** A person with a friends membership (the inbox insert fence needs one), and their recipient. */
async function person(): Promise<Recipient> {
  const to = `+121255501${String(50 + ++n).padStart(2, "0")}`;
  const p = await new PgPeopleStore(sql).createPerson({ id: randomUUID(), e164: to, method: "inbound_message", at: NOW, lowestAge: 30 });
  await new PgPeopleStore(sql).putMembership({ app: "friends", personId: p.id, memberId: `friends_d${n}`, state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: NOW, leftAt: null });
  return { personId: p.id, to, timeZone: "America/New_York", prefs: { channel: "imessage" }, proactiveAllowed: true };
}
const notifier = (store: PgNotifyStore, r: Recipient) => new Notifier(store, { get: id => (id === r.personId ? r : undefined) }, { isQuiet: () => false });
/** A sink that records the item ids of every text it is given. */
function recordingSink(texts: string[][], plans: () => Map<string, string[]>): OutboundSink {
  return { enqueue: x => { texts.push(plans().get(x.idempotencyKey) ?? [x.idempotencyKey]); } };
}
const item = (personId: string, subjectId: string, urgency: "requested" | "normal" = "requested") =>
  ({ personId, app: "friends", eventType: "plan", subjectId, urgency, summary: `Update ${subjectId}.` });

describe.skipIf(!pgAvailable)("notify deliveries on Postgres", () => {
  beforeAll(async () => {
    await devPgUp();
    admin = new SQL({ url: `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 4 });
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin?.close();
  });

  test("SD-151 a Network text whose record fails half way is never texted again by the scheduler", async () => {
    const r = await person();
    // The process stops after the item is stored and before its delivery is recorded (the first try only).
    let stops = 1;
    class Stopping extends PgNotifyStore {
      override async recordDelivery(d: DeliveryRecord) {
        if (stops-- > 0) throw new Error("the process stopped");
        return super.recordDelivery(d);
      }
    }
    const ntf = notifier(new Stopping(sql), r);
    const sent = item(r.personId, "opp_sent", "normal");
    const d = { deliveryId: "net:msg_1", channel: "imessage" as const, countsTowardCap: true, sentAt: NOW };
    await ntf.recordSent(sent, d).catch(() => undefined);
    // The scheduler's tick runs before the projection repair.
    const texts: string[][] = [];
    const { sent: out } = await ntf.dispatch(NOW + 5 * 3600_000, recordingSink(texts, () => new Map()));
    expect(out).toEqual([]);
    expect(texts).toEqual([]);
    // The projection repair records it once, as delivered by the Network.
    await ntf.recordSent(sent, d);
    const rows = await sql`select i.notified_at is not null as notified, i.delivery_id from notify.inbox_items i where i.person_id = ${r.personId}`;
    expect(rows.map((x: any) => [x.notified, x.delivery_id])).toEqual([[true, "net:msg_1"]]);
  });

  test("SD-150 two scheduler replicas that overlap never put one item in two texts", async () => {
    const r = await person();
    const shared = new PgNotifyStore(sql);
    await shared.addItem(item(r.personId, "a"), NOW);
    // Both replicas re-read their items before either records (a rollout overlap): a barrier holds each recordDelivery until both arrive.
    let arrived = 0, release!: () => void;
    const both = new Promise<void>(res => { release = res; });
    let second: Promise<unknown> | undefined;
    const texts: string[][] = [];
    const planned = new Map<string, string[]>();
    class Replica extends PgNotifyStore {
      constructor(private onReread?: () => Promise<void>) { super(url); }
      override async getItems(ids: string[]) {
        const hook = this.onReread;
        if (hook) { this.onReread = undefined; await hook(); }
        return super.getItems(ids);
      }
      override async recordDelivery(d: DeliveryRecord) {
        planned.set(d.deliveryId, d.itemIds);
        if (++arrived === 2) release();
        await both;
        return super.recordDelivery(d);
      }
    }
    const r2 = new Replica();
    // Replica 1 planned {a}; then item b arrives and replica 2 plans {a, b}.
    const r1 = new Replica(async () => {
      await shared.addItem(item(r.personId, "b"), NOW);
      second = notifier(r2, r).dispatch(NOW, recordingSink(texts, () => planned));
    });
    try {
      await notifier(r1, r).dispatch(NOW, recordingSink(texts, () => planned));
      await second;
    } finally { await r1.close(); await r2.close(); }
    const ids = texts.flat();
    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const rows = await sql`select count(*)::int as n from notify.deliveries where person_id = ${r.personId}`;
    expect(rows[0].n).toBe(texts.length);
  });
});
