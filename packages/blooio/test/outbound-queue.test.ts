// The outbound queue's durable state (PRD 32.2; audit network-service-12, network-service-M5): the in-memory
// and Postgres stores behave the same; a restart keeps counters, line safety and parked records; receipts
// after a restart update the stored row; pruning; a safety event with no line holds the line. No real sends:
// the provider is a fake that records what it was given.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, SimClock } from "../../core/src/clock.ts";
import { ConsentLedger } from "../src/ledger.ts";
import { ANY_LINE, InMemoryQueueStore, OutboundQueue, type QueueOptions, type QueueStore } from "../src/outbound-queue.ts";
import { PgQueueStore } from "../src/pg-queue-store.ts";
import type { ChannelAdapter, SendReceipt, SendRequest } from "../src/types.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { migrate } from "../../observatory/db/migrate.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";

const LINE = "+12125550100";
const A = "+12125550142", B = "+12125550143", C = "+12125550144";
// Noon in New York: outside quiet hours.
const NOON = Date.UTC(2026, 9, 8, 16);

class FakeProvider implements ChannelAdapter {
  readonly kind = "blooio" as const;
  readonly sent: SendRequest[] = [];
  #n = 0;
  async send(req: SendRequest): Promise<SendReceipt> { this.sent.push(req); return { providerMessageId: `p_${++this.#n}`, status: "queued" }; }
}

function queue(store: QueueStore, clock: SimClock, provider = new FakeProvider(), o: Partial<QueueOptions> = {}) {
  const q = new OutboundQueue({ clock, adapters: { blooio: provider }, consent: new ConsentLedger(clock), requireConsentForProactive: false, defaultFrom: { blooio: LINE }, store,
    // As the service does: counters key on a hash, never the number.
    addressKey: a => `k${Bun.hash(a).toString(16)}`, ...o });
  return { q, provider };
}
const note = (q: OutboundQueue, key: string, to: string, text = `hello ${key}`, kind: "transactional" | "reply" | "proactive" = "transactional") =>
  q.enqueue({ idempotencyKey: key, channel: "blooio", to, text, kind, city: "nyc" });

// ------------------------------------------------------------------ Postgres: a database of its own

const DB = "network_test_messaging";
const USER = process.env.USER ?? "postgres";
const ADMIN = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
let sql: SQL | undefined;

beforeAll(async () => {
  if (!pgAvailable) return;
  await devPgUp();
  const admin = new SQL({ url: ADMIN, max: 1 });
  try {
    await admin.unsafe("set lock_timeout = '5s'");
    await admin.unsafe(`drop database if exists ${DB} with (force)`);
    await admin.unsafe(`create database ${DB}`);
  } finally { await admin.close(); }
  await migrate(URL_, { lockTimeout: "5s" });
  sql = new SQL({ url: URL_, max: 4 });
}, 120_000);

afterAll(async () => {
  await sql?.close();
  if (!pgAvailable) return;
  const admin = new SQL({ url: ADMIN, max: 1 });
  try { await admin.unsafe(`drop database if exists ${DB} with (force)`); } catch { /* best effort */ } finally { await admin.close(); }
});

const stores: { name: string; make: () => Promise<QueueStore>; skip?: boolean }[] = [
  { name: "in memory", make: async () => new InMemoryQueueStore() },
  {
    name: "Postgres", skip: !pgAvailable,
    make: async () => {
      await sql!`truncate network.outbound_queue, network.outbound_sends, network.outbound_contacts, network.outbound_inbound, network.line_safety`;
      await sql!`delete from network.events where type = 'queue_alert'`;
      return new PgQueueStore(sql!, { mode: "live" });
    },
  },
];

for (const s of stores) {
  describe.skipIf(!!s.skip)(`queue store: ${s.name}`, () => {
    test("a restart keeps the unanswered counters, the new-conversation count, line safety and parked records", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q } = queue(store, clock);
      await q.start();
      note(q, "a1", A); await q.drain();
      note(q, "a2", A); await q.drain();
      note(q, "a3", A); await q.drain();
      // PRD 41.4: an interruption goes only while at most one is unanswered.
      expect([q.get("a1")!.status, q.get("a2")!.status, q.get("a3")!.status]).toEqual(["accepted", "accepted", "held_awaiting_reply"]);
      // A message with a phone number in it is parked for leak review (contact pattern), never sent.
      note(q, "b1", B, "call me at 212-555-0199"); await q.drain();
      expect(q.get("b1")!.status).toBe("parked_leak_review");
      q.setLineSafety(LINE, "pause_new");
      await q.flush();
      expect(q.newChats(LINE)).toBe(1);

      // Restart on the same store.
      const again = queue(store, clock);
      await again.q.start();
      const r = again.q;
      expect(r.contactState("blooio", A)?.unanswered).toBe(2);
      expect(r.newChats(LINE)).toBe(1);
      expect(r.lineSafety(LINE)).toBe("pause_new");
      expect(r.leakReviewQueue().map(x => [x.idempotencyKey, x.text])).toEqual([["b1", "call me at 212-555-0199"]]);
      expect(r.get("a3")!.status).toBe("held_awaiting_reply");
      // A new conversation is held by the line's pause_new after the restart too.
      note(r, "c1", C); await r.drain();
      expect(r.get("c1")!.status).toBe("retry_scheduled");
      // The person writes back: the held message goes, with its text, on the restarted queue.
      expect(r.onRecipientEngaged("blooio", A)).toBe(1);
      await r.drain();
      expect(r.get("a3")!.status).toBe("accepted");
      expect(again.provider.sent.map(x => x.text)).toEqual(["hello a3"]);
      // The reviewer releases the parked one; every other check still runs.
      expect(r.resolveLeakReview("b1", "approve", "staff@x")).toBe(true);
      await r.drain();
      expect(r.get("b1")!.status).toBe("retry_scheduled"); // B is a new conversation and the line is pause_new
      const third = queue(store, clock);
      await third.q.start();
      expect(third.q.get("b1")!.leakReviewApproved).toBe(true);
      expect(third.q.leakReviewQueue()).toEqual([]);
    });

    test("receipts after a restart update the stored row; a final row keeps no text or address", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q } = queue(store, clock);
      await q.start();
      note(q, "k1", A, "see you at 7"); await q.drain();
      const pid = q.get("k1")!.providerMessageId!;
      const r = queue(store, clock).q;
      await r.start();
      clock.advance(60_000);
      expect(r.applyStatus({ kind: "status", channel: "blooio", providerMessageId: pid, status: "delivered", at: clock.now() })?.status).toBe("delivered");
      await r.flush();
      const t = queue(store, clock).q;
      await t.start();
      const rec = t.get("k1")!;
      expect(rec.status).toBe("delivered");
      expect(rec.deliveredAt).toBe(clock.now());
      expect([rec.text, rec.to]).toEqual(["", ""]);
      if (store instanceof PgQueueStore) {
        const [row] = await sql!`select text, address, address_key, provider_message_id, attempts, delivered_at from network.outbound_queue where idempotency_key = 'k1'`;
        expect([row.text, row.address, row.provider_message_id, row.attempts]).toEqual([null, null, pid, 1]);
        expect(row.address_key).not.toContain("555");
      }
      // A replay with the same payload after the restart is the same record; a different text is a conflict.
      expect(t.enqueue({ idempotencyKey: "k1", channel: "blooio", to: A, text: "see you at 7", kind: "transactional", city: "nyc" }).deduped).toBe(true);
      expect(() => t.enqueue({ idempotencyKey: "k1", channel: "blooio", to: A, text: "see you at 8", kind: "transactional", city: "nyc" })).toThrow(/different payload/);
    });

    test("final records older than 30 days are pruned; waiting and parked ones stay", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q } = queue(store, clock);
      await q.start();
      note(q, "old", A); await q.drain();
      note(q, "held", A); await q.drain();
      note(q, "held2", A); await q.drain();
      note(q, "leak", B, "my number is 212-555-0199"); await q.drain();
      expect([q.get("held2")!.status, q.get("leak")!.status]).toEqual(["held_awaiting_reply", "parked_leak_review"]);
      clock.advance(31 * DAY);
      expect(await q.prune()).toBeGreaterThanOrEqual(2);
      expect(q.get("old")).toBeUndefined();
      expect(q.get("held2")?.status).toBe("held_awaiting_reply");
      const r = queue(store, clock).q;
      await r.start();
      expect([...r.records.keys()].sort()).toEqual(["held2", "leak"]);
    });

    test("a safety event with no line holds the configured line, and without one every line (fail closed)", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q, provider } = queue(store, clock);
      await q.start();
      expect(q.setLineSafety(undefined, "reply_only")).toBe(LINE);
      await q.flush();
      note(q, "x1", A); await q.drain();
      expect(q.get("x1")!.status).toBe("retry_scheduled");
      expect(provider.sent).toEqual([]);
      const r = queue(store, clock).q;
      await r.start();
      expect(r.lineSafety(LINE)).toBe("reply_only");
      // No default line: the action is stored for every line.
      const bare = new OutboundQueue({ clock, adapters: { blooio: new FakeProvider() }, consent: new ConsentLedger(clock), requireConsentForProactive: false, store: new InMemoryQueueStore() });
      expect(bare.setLineSafety("", "review")).toBe(ANY_LINE);
      bare.enqueue({ idempotencyKey: "y1", channel: "blooio", to: A, from: "+12125550199", text: "hi", kind: "transactional", city: "nyc" });
      await bare.drain();
      expect(bare.get("y1")!.status).toBe("retry_scheduled");
      expect(bare.lineSafety("+12125550199")).toBe("review");
    });

    test("replies are exempt from the interruption limit but not from Blooio's three; one re-engagement after 30 days", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q } = queue(store, clock);
      await q.start();
      q.onRecipientEngaged("blooio", A);
      for (const k of ["r1", "r2", "r3", "r4"]) note(q, k, A, `reply ${k}`, "reply");
      await q.drain();
      expect(["r1", "r2", "r3", "r4"].map(k => q.get(k)!.status)).toEqual(["accepted", "accepted", "accepted", "held_awaiting_reply"]);
      note(q, "i1", A); await q.drain();
      expect(q.get("i1")!.status).toBe("held_awaiting_reply");
      clock.advance(29 * DAY);
      note(q, "i2", A); await q.drain();
      expect(q.get("i2")!.status).toBe("held_awaiting_reply");
      clock.advance(2 * DAY);
      note(q, "i3", A); await q.drain();
      expect(q.get("i3")!.status).toBe("accepted");
      const r = queue(store, clock).q;
      await r.start();
      expect(r.contactState("blooio", A)?.reengagementUsed).toBe(true);
      clock.advance(31 * DAY);
      note(r, "i4", A); await r.drain();
      expect(r.get("i4")!.status).toBe("held_awaiting_reply");
    });

    test("the reply window survives a restart", async () => {
      const store = await s.make();
      const clock = new SimClock(NOON);
      const { q } = queue(store, clock);
      await q.start();
      q.onRecipientEngaged("blooio", A);
      await q.flush();
      const r = queue(store, clock).q;
      await r.start();
      note(r, "w1", A, "welcome", "reply"); await r.drain();
      expect(r.get("w1")!.status).toBe("accepted");
      clock.advance(2 * HOUR);
      note(r, "w2", A, "late", "reply"); await r.drain();
      expect(r.get("w2")!.status).toBe("suppressed_ineligible");
    });
  });
}

describe.skipIf(!pgAvailable)("Postgres alerts", () => {
  test("an alert is a queue_alert row in network.events with kind, line, address_hash and detail", async () => {
    const store = new PgQueueStore(sql!, { mode: "dry_run" });
    await store.alert({ kind: "line_safety", line: LINE, addressHash: null, detail: { action: "review" }, at: NOON });
    await store.alert({ kind: "leak_blocked", line: LINE, addressHash: "abc", app: "slop", detail: { key: "k" }, at: NOON });
    const rows = await sql!`select app_id, type, actor_type, payload from network.events where type = 'queue_alert' order by id`;
    const payload = (r: any) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);
    expect(rows.map((r: any) => [r.app_id, r.actor_type, payload(r).kind, payload(r).line, payload(r).address_hash, payload(r).detail.dry_run])).toEqual([
      ["ntwrk", "agent", "line_safety", LINE, null, true],
      ["slop", "agent", "leak_blocked", LINE, "abc", true],
    ]);
  });

  test("dry-run state is kept apart from live state", async () => {
    await sql!`truncate network.outbound_queue, network.outbound_sends, network.outbound_contacts, network.outbound_inbound, network.line_safety`;
    const clock = new SimClock(NOON);
    const dry = queue(new PgQueueStore(sql!, { mode: "dry_run" }), clock).q;
    await dry.start();
    note(dry, "d1", A); await dry.drain();
    const live = queue(new PgQueueStore(sql!, { mode: "live" }), clock).q;
    await live.start();
    expect(live.get("d1")).toBeUndefined();
    expect(live.newChats(LINE)).toBe(0);
    expect(live.contactState("blooio", A)).toBeUndefined();
  });
});
