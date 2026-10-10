// Integration: the persisted outbound queue (platform.outbound) on its own database on the local dev
// cluster (:54339), with a recording "sim" provider. Skipped without Postgres.
//  - Two queue workers (two connection pools, two instance names) drain one line at the same time:
//    every row reaches the provider once, with its own key "tn:<id>".
//  - A worker that stopped mid-send: recover() hands the row back and it goes again with the same key.
//  - The leak guard reads the new text together with the recent thread to the same address (core-14).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { SimClock } from "../../core/src/clock.ts";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { OutboundQueue, type AppChecks, type QueueOptions } from "../src/outbound-queue.ts";
import { ChannelSendError, type ChannelAdapter, type SendRequest } from "../src/types.ts";

const user = process.env.USER ?? "postgres";
const db = `blooio_queue_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const LINE = "+12125550100";
const NY = "America/New_York";
// 12:00 in New York: outside quiet hours.
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));

let admin: SQL, a: SQL, b: SQL;

/** A provider that records every call and takes a little while (so two workers overlap). */
function recorder() {
  const calls: SendRequest[] = [];
  const provider: ChannelAdapter = {
    kind: "sim",
    async send(req) {
      calls.push(req);
      await Bun.sleep(5);
      return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim" };
    },
  };
  return { calls, provider };
}

const checks = (extra: Partial<AppChecks> = {}): AppChecks => ({ live: () => true, ...extra });
const queue = (sql: SQL, provider: ChannelAdapter, o: Partial<QueueOptions> = {}) =>
  new OutboundQueue({ sql, clock, provider, line: LINE, app: "friends", checks: checks(), newChatsPerLinePerDay: 1000, perLinePerDay: 1000, ...o });

describe.skipIf(!pgAvailable)("outbound queue on Postgres", () => {
  beforeAll(async () => {
    await devPgUp();
    admin = new SQL({ url: `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    a = new SQL({ url, max: 2 });
    b = new SQL({ url, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await admin?.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin?.close();
  });

  test("two workers on one database: each row is sent once", async () => {
    const { calls, provider } = recorder();
    const w1 = queue(a, provider, { instance: "worker-1" });
    const w2 = queue(b, provider, { instance: "worker-2" });
    const ids = Array.from({ length: 12 }, (_, i) => `two-workers-${i}`);
    await w1.enqueue(a, ids.map((id, i) => ({ id, to: `+1212555${String(2000 + i)}`, kind: "transactional" as const, text: `Your plan update number ${i}.`, timeZone: NY })));
    await Promise.all([w1.drain(), w2.drain(), w1.drain(), w2.drain()]);
    const keys = calls.map(c => c.idempotencyKey).sort();
    expect(keys).toEqual(ids.map(id => `tn:${id}`).sort());
    const rows = await a`select id, status, attempts from platform.outbound where id = any(${a.array(ids, "TEXT")}) order by id`;
    for (const r of rows as any[]) expect([r.status, r.attempts]).toEqual(["sent", 1]);
    // Drained again by either worker: nothing more reaches the provider.
    await Promise.all([w1.drain(), w2.drain()]);
    expect(calls.length).toBe(ids.length);
  });

  test("a worker that stopped mid-send: the other worker's next drain recovers the row (no restart needed) and sends it with the same key", async () => {
    const { calls, provider } = recorder();
    const w1 = queue(a, provider, { instance: "worker-1" });
    const w2 = queue(b, provider, { instance: "worker-2" });
    await w1.enqueue(a, [{ id: "lease-1", to: "+12125553001", kind: "transactional", text: "Your reminder is ready.", timeZone: NY }]);
    // worker-1 claimed the row and is still inside its lease: another worker never sends it.
    await a`update platform.outbound set status = 'sending', attempts = 1, lease_owner = 'worker-1', lease_until = ${new Date(clock.now() + 60_000)} where id = 'lease-1'`;
    await w2.drain();
    expect(calls.length).toBe(0);
    // worker-1 stopped and its lease ran out: worker-2 keeps draining and takes the row back (it used to wait for a runtime restart).
    await a`update platform.outbound set lease_until = ${new Date(clock.now() - 1)} where id = 'lease-1'`;
    await w2.drain();
    await w1.drain();
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:lease-1"]);
    expect(await w2.statusOf("lease-1")).toBe("sent");
  });

  test("unknown acceptance: an authoritative 'never admitted' sends again with the same key; a row nothing resolves ends failed_unknown after its TTL, and both are counted while they wait", async () => {
    const { WAITING } = await import("../src/outbound-queue.ts");
    expect(WAITING).toContain("unknown_acceptance");
    const calls: SendRequest[] = [];
    let receipt: "not_found" | "unknown" = "not_found";
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) { calls.push(req); return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim" }; },
      async receipt() { throw new ChannelSendError("lookup", "unknown", receipt === "not_found" ? 404 : 503, receipt === "not_found" ? "not_found" : undefined); },
    };
    const alerts: string[] = [];
    const q = queue(a, provider, { onAlert: (id, why) => alerts.push(`${id}:${why}`) });
    await q.enqueue(a, [
      { id: "unk-1", to: "+12125556001", kind: "reply", text: "Here is the plan.", timeZone: NY },
      { id: "unk-2", to: "+12125556002", kind: "compliance", text: "You're unsubscribed.", timeZone: NY },
    ]);
    // Both stranded: the worker stopped before (or during) the provider call.
    await a`update platform.outbound set status = 'unknown_acceptance', in_doubt = true where id in ('unk-1', 'unk-2')`;
    await a`insert into platform.line_conversations (line, address, last_inbound_at) values (${LINE}, '+12125556001', ${new Date(clock.now())}) on conflict (line, address) do update set last_inbound_at = excluded.last_inbound_at`;
    await q.drain();
    expect(calls.map(c => c.idempotencyKey).sort()).toEqual(["tn:unk-1", "tn:unk-2"]);
    expect([await q.statusOf("unk-1"), await q.statusOf("unk-2")]).toEqual(["sent", "sent"]);
    // A row whose lookups stay ambiguous: held (never resent blindly), then failed_unknown with an alert after 6 hours.
    receipt = "unknown";
    await q.enqueue(a, [{ id: "unk-3", to: "+12125556003", kind: "compliance", text: "You're unsubscribed from slop.", timeZone: NY }]);
    await a`update platform.outbound set status = 'unknown_acceptance', in_doubt = true where id = 'unk-3'`;
    await q.drain();
    expect(await q.statusOf("unk-3")).toBe("unknown_acceptance");
    clock.advance(7 * 60 * 60_000);
    await q.drain();
    expect(await q.statusOf("unk-3")).toBe("failed_unknown");
    expect(alerts).toContain("unk-3:unknown_acceptance_expired");
    expect(calls.length).toBe(2);
  });

  test("the leak guard reads the recent thread to the same address", async () => {
    const { calls, provider } = recorder();
    const leaks = { forbidden: ["secret orchid garden party"] };
    const q = queue(a, provider, { checks: checks({ leaks: () => leaks }) });
    const to = "+12125554001";
    await q.enqueue(a, [{ id: "thread-1", to, kind: "transactional", text: "We talked about the secret orchid", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("thread-1")).toBe("sent");
    // On its own the second text is clean; with the first one it completes another member's private value.
    await q.enqueue(a, [{ id: "thread-2", to, kind: "transactional", text: "garden party this weekend", timeZone: NY }]);
    await q.drain();
    const [r] = await a`select status, note from platform.outbound where id = 'thread-2'`;
    expect(r.status).toBe("parked_leak_review");
    expect(String(r.note)).toContain("thread:");
    // The same text to another address (no such thread) goes.
    await q.enqueue(a, [{ id: "thread-3", to: "+12125554002", kind: "transactional", text: "garden party this weekend", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("thread-3")).toBe("sent");
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:thread-1", "tn:thread-3"]);
    // Staff review: the parked text is listed with its labels; a release sends it (every other check still runs), a drop ends it.
    const parked = await q.parkedLeaks();
    expect(parked.map(p => p.id)).toEqual(["thread-2"]);
    expect(parked[0]!.reasons.length).toBeGreaterThan(0);
    expect(await q.decideLeak("thread-1", "release", "safety@example.org")).toBeUndefined();
    expect(await q.decideLeak("thread-2", "release", "safety@example.org")).toMatchObject({ status: "pending" });
    await q.drain();
    expect(await q.statusOf("thread-2")).toBe("sent");
    await q.enqueue(a, [{ id: "thread-4", to, kind: "transactional", text: "secret orchid garden party", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("thread-4")).toBe("parked_leak_review");
    expect(await q.decideLeak("thread-4", "drop", "safety@example.org")).toMatchObject({ status: "dropped_leak_review" });
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:thread-1", "tn:thread-3", "tn:thread-2"]);
  });

  test("replies another transport delivers (signed turns) get the leak guard and join the thread it reads", async () => {
    const { calls, provider } = recorder();
    const leaks = { forbidden: ["violet lantern supper club"] };
    const q = queue(a, provider, { checks: checks({ leaks: () => leaks }) });
    const to = "+12125557001";
    // A collected reply with a canary-shaped or private value fails on its own.
    expect((await q.collectedLeaks(a, { id: "col-0", memberId: "m1", to, kind: "reply", text: "she loves the violet lantern supper club" })).length).toBeGreaterThan(0);
    // A clean one is recorded as collected; once Cloud reports acceptance it is part of the thread.
    expect(await q.collectedLeaks(a, { id: "col-1", memberId: "m1", to, kind: "reply", text: "We spoke about the violet lantern" })).toEqual([]);
    await a.begin(tx => q.recordCollected(tx, [{ id: "col-1", memberId: "m1", to, kind: "reply", text: "We spoke about the violet lantern" }]));
    await a.begin(tx => q.collectedReceipt(tx, ["col-1"], "accepted", clock.now()));
    expect(await q.statusOf("col-1")).toBe("sent");
    // A later queued text that completes the value across the two messages is parked (core-14).
    await q.enqueue(a, [{ id: "col-2", to, kind: "transactional", text: "supper club on friday", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("col-2")).toBe("parked_leak_review");
    // The collected row itself never reaches the provider.
    expect(calls.length).toBe(0);
  });
});
