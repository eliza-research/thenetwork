// Integration: the persisted outbound queue (platform.outbound) on its own database on the local dev
// cluster (:54339), with a recording "sim" provider. Skipped without Postgres.
//  - Two queue workers (two connection pools, two instance names) drain one line at the same time:
//    every row reaches the provider once, with its own key "tn:<id>".
//  - A worker that stopped mid-send: recover() hands the row back and it goes again with the same key.
//  - The leak guard reads the new text together with the recent thread to the same address (core-14).
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { SimClock } from "../../core/src/clock.ts";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { OutboundQueue, type AppChecks, type QueueOptions } from "../src/outbound-queue.ts";
import { ChannelSendError, type ChannelAdapter, type SendRequest, type StatusUpdate } from "../src/types.ts";

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
      await sleep(5);
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

  test("the member's saved local quiet window defers logistics while replies and compliance pass", async () => {
    // spec/outboundAdmission.md, "Replies, quiet hours and unanswered messages limit when a send can go out"
    const local = new SimClock(Date.UTC(2026, 9, 9, 13)); // 06:00 in San Francisco, 09:00 in the queue's zone.
    const { calls, provider } = recorder();
    const q = queue(a, provider, { clock: local });
    const memberId = "quiet-home-city", to = "+12125553212";
    await a`insert into network.members (id,app_id,home_city,prefs) values (${memberId},'friends','sf',${{ quietHours: [5, 8] }}::jsonb)`;
    await q.inbound(to);
    await q.enqueue(a, [
      { id: "quiet-home-logistics", memberId, to, kind: "transactional", text: "Your meeting reminder.", timeZone: NY },
      { id: "quiet-home-reply", memberId, to, kind: "reply", text: "Here is your requested update.", timeZone: NY },
      { id: "quiet-home-confirmation", memberId, to, kind: "compliance", text: "Your settings are saved.", timeZone: NY },
    ]);
    await q.drain();
    expect(calls.map(call => call.idempotencyKey).sort()).toEqual(["tn:quiet-home-confirmation", "tn:quiet-home-reply"]);
    const [row] = await a`select status,attempts,next_attempt_at from platform.outbound where id='quiet-home-logistics'`;
    expect([row.status, row.attempts, new Date(row.next_attempt_at).getTime()]).toEqual(["deferred_quiet_hours", 0, Date.UTC(2026, 9, 9, 15)]);
    local.set(Date.UTC(2026, 9, 9, 15));
    await q.drain();
    expect(calls.at(-1)?.idempotencyKey).toBe("tn:quiet-home-logistics");
  });

  test("the locked claim defers a newly quiet member and releases the reserved cap", async () => {
    // spec/outboundAdmission.md, "Replies, quiet hours and unanswered messages limit when a send can go out"
    const local = new SimClock(Date.UTC(2026, 9, 9, 11)); // 07:00 in New York, when the default window is quiet.
    const { calls, provider } = recorder();
    const memberId = "quiet-late-change";
    let takes = 0;
    const refunds: string[] = [];
    const claims: string[] = [];
    const q = queue(a, provider, { clock: local, checks: checks({
      capTake: async () => {
        if (++takes === 1) await b`update network.members set prefs=${{ quietHours: [6, 8] }}::jsonb where app_id='friends' and id=${memberId}`;
        return true;
      },
      capRelease: async row => { refunds.push(row.id); },
      claimed: async row => { claims.push(row.id); },
    }) });
    await a`insert into network.members (id,app_id,home_city,prefs) values (${memberId},'friends','nyc',${{ quietHours: [0, 0] }}::jsonb)`;
    await q.enqueue(a, [{ id: "quiet-claim-probe", memberId, to: "+12125553213", kind: "proactive", text: "Would you like to meet?", timeZone: NY }]);
    await q.drain();
    const [row] = await a`select status,attempts,person_cap,lease_until,next_attempt_at from platform.outbound where id='quiet-claim-probe'`;
    expect([row.status, row.attempts, row.person_cap, row.lease_until, new Date(row.next_attempt_at).getTime()])
      .toEqual(["deferred_quiet_hours", 0, false, null, Date.UTC(2026, 9, 9, 12)]);
    expect(calls).toEqual([]);
    expect(claims).toEqual([]);
    expect(refunds).toEqual(["quiet-claim-probe"]);
    local.set(Date.UTC(2026, 9, 9, 12));
    await q.drain();
    expect(takes).toBe(2);
    expect(claims).toEqual(["quiet-claim-probe"]);
    expect(calls.map(call => call.idempotencyKey)).toEqual(["tn:quiet-claim-probe"]);
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

  test("concurrent provider updates retain the latest delivery status", async () => {
    const { provider } = recorder();
    const q1 = queue(a, provider), q2 = queue(b, provider);
    await q1.enqueue(a, [{ id: "receipt-order", to: "+12125556709", kind: "transactional", text: "Here is your update.", timeZone: NY }]);
    await q1.drain();
    expect(await q1.statusOf("receipt-order")).toBe("sent");
    const receipt = (status: StatusUpdate["status"]): StatusUpdate =>
      ({ kind: "status", channel: "sim", providerMessageId: "sim:tn:receipt-order", status, at: clock.now() });
    // spec/outboundReceipt.md, "A provider receipt advances through acceptance, send, delivery, and read"
    await Promise.all([q1.applyStatus(receipt("read")), q2.applyStatus(receipt("delivered"))]);
    expect(await q1.statusOf("receipt-order")).toBe("read");
    expect(await q1.applyStatus(receipt("failed"))).toBeUndefined();
    expect(await q2.applyStatus(receipt("sent"))).toBeUndefined();
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

  // spec/outboundReceipt.md, "An uncertain send waits for a receipt instead of sending again"
  test.each(["unusable provider reply", "failed acceptance write"])("%s holds the original key for lookup", async failure => {
    const id = failure === "unusable provider reply" ? "unusable-provider-reply" : "failed-acceptance-write";
    const sends: string[] = [], lookups: string[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        sends.push(req.idempotencyKey);
        return { providerMessageId: failure === "unusable provider reply" ? "" : "sim:" + id, status: "sent" };
      },
      async receipt(req) {
        lookups.push(req.idempotencyKey);
        return { providerMessageId: "sim:" + id, status: "sent" };
      },
    };
    const worker = queue(a, provider, { clock: new SimClock(Date.UTC(2026, 9, 12, 16)) });
    await worker.enqueue(a, [{ id, to: "+12125556125", kind: "compliance", text: "You're unsubscribed.", timeZone: NY }]);
    if (failure === "failed acceptance write") {
      await a`alter table platform.outbound add constraint fixture_reject_provider_acceptance
        check (id <> 'failed-acceptance-write' or status <> 'sent')`;
    }
    try {
      expect(await worker.drain()).toContainEqual(expect.objectContaining({ id, status: "unknown_acceptance" }));
      const [held] = await a`select status, attempts, sent_at, body from platform.outbound where id = ${id}`;
      expect(held).toEqual({ status: "unknown_acceptance", attempts: 1, sent_at: null, body: "You're unsubscribed." });
    } finally {
      if (failure === "failed acceptance write") await a`alter table platform.outbound drop constraint fixture_reject_provider_acceptance`;
    }
    expect(await worker.drain()).toContainEqual(expect.objectContaining({ id, status: "sent" }));
    expect(sends).toEqual(["tn:" + id]);
    expect(lookups).toEqual(sends);
  });

  test("when neither acceptance nor its hold can be stored, the lease survives until lookup recovery", async () => {
    const id = "send-outcome-write-unavailable";
    const now = new SimClock(Date.UTC(2026, 9, 12, 16));
    const sends: string[] = [], lookups: string[] = [], alerts: string[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) { sends.push(req.idempotencyKey); return { providerMessageId: "sim:" + id, status: "sent" }; },
      async receipt(req) { lookups.push(req.idempotencyKey); return { providerMessageId: "sim:" + id, status: "sent" }; },
    };
    const worker = queue(a, provider, { clock: now, leaseMs: 1000, onAlert: (key, reason) => alerts.push(`${key}:${reason}`) });
    await worker.enqueue(a, [{ id, to: "+12125556126", kind: "compliance", text: "You're unsubscribed.", timeZone: NY }]);
    await a`alter table platform.outbound add constraint fixture_reject_provider_outcome
      check (id <> 'send-outcome-write-unavailable' or status not in ('sent', 'unknown_acceptance'))`;
    try {
      expect(await worker.drain()).toEqual([]);
      const [held] = await a`select status, attempts, body, lease_until from platform.outbound where id = ${id}`;
      expect(held).toEqual({ status: "sending", attempts: 1, body: "You're unsubscribed.", lease_until: new Date(now.now() + 1000) });
      expect(alerts).toContain(`${id}:claimed_outcome_write_failed`);
    } finally {
      await a`alter table platform.outbound drop constraint fixture_reject_provider_outcome`;
    }
    now.advance(1001);
    expect(await worker.drain()).toContainEqual(expect.objectContaining({ id, status: "sent" }));
    expect(sends).toEqual(["tn:" + id]);
    expect(lookups).toEqual(sends);
  });

  test("unknown acceptance: the TTL runs from when acceptance became unknown, not from enqueue, so a text that waited out quiet hours still gets its receipt lookup", async () => {
    // 23:00 in New York: a transactional text waits for quiet hours to end (09:00, ten hours later).
    const night = new SimClock(Date.UTC(2026, 9, 11, 3));
    const calls: SendRequest[] = [];
    let mode: "timeout" | "ok" = "timeout";
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        calls.push(req);
        if (mode === "timeout") throw new ChannelSendError("provider timed out", "unknown");
        return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim" };
      },
      async receipt() { throw new ChannelSendError("lookup", "unknown", 404, "not_found"); },
    };
    const alerts: string[] = [];
    const q = queue(a, provider, { clock: night, onAlert: (id, why) => alerts.push(`${id}:${why}`) });
    await q.enqueue(a, [{ id: "unk-quiet", to: "+12125556010", kind: "transactional", text: "Your plan is at 7 tonight.", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("unk-quiet")).toBe("deferred_quiet_hours");
    night.advance(10 * 60 * 60_000 + 60_000);
    await q.drain();
    expect(await q.statusOf("unk-quiet")).toBe("unknown_acceptance");
    // One minute later the lookup says the provider never admitted it: it goes again with the same key.
    mode = "ok";
    night.advance(60_000);
    await q.drain();
    expect(alerts).not.toContain("unk-quiet:unknown_acceptance_expired");
    expect(await q.statusOf("unk-quiet")).toBe("sent");
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:unk-quiet", "tn:unk-quiet"]);
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

  // spec/outboundReceipt.md, "A send that may have reached the person keeps its person-cap slot"
  test("SD-090: a proactive send whose acceptance expires unknown keeps its person-cap slot", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const refunds: string[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send() { throw new ChannelSendError("provider timed out", "unknown"); },
      async receipt() { throw new ChannelSendError("lookup", "unknown", 503); },
    };
    const q = queue(a, provider, { clock: now, checks: checks({ capTake: async () => true, capRelease: async row => { refunds.push(row.id); } }) });
    await q.enqueue(a, [{ id: "sd090-probe", to: "+12125558090", kind: "proactive", text: "Would you like to meet Sam?", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("sd090-probe")).toBe("unknown_acceptance");
    now.advance(7 * 60 * 60_000);
    expect(await q.drain()).toContainEqual(expect.objectContaining({ id: "sd090-probe", status: "failed_unknown" }));
    expect(refunds).toEqual([]);
  });

  // spec/outboundAdmission.md, "A check that cannot answer delays the row and never sends it"
  test.each(["stale check", "claim transaction"])("SD-299 / SD-117: an error in the %s delays the row; the next drain sends it with the same key", async where => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const id = where === "stale check" ? "sd299-digest" : "sd117-reminder";
    const { calls, provider } = recorder();
    let fails = 1;
    const fail = () => { if (fails-- > 0) throw new Error("canceling statement due to lock timeout"); };
    const q = queue(a, provider, { clock: now, checks: checks(where === "stale check"
      ? { stale: () => { fail(); return false; } } : { lockAdmission: async () => { fail(); } }) });
    await q.enqueue(a, [{ id, to: "+12125558299", kind: "transactional", text: "Your weekly digest is ready.", timeZone: NY }]);
    expect(await q.drain()).toContainEqual(expect.objectContaining({ id, status: "retry_scheduled" }));
    expect(calls).toEqual([]);
    const [row] = await a`select attempts, next_attempt_at from platform.outbound where id = ${id}`;
    expect([row.attempts, new Date(row.next_attempt_at).getTime()]).toEqual([1, now.now() + 30_000]);
    now.advance(30_000);
    await q.drain();
    expect(await q.statusOf(id)).toBe("sent");
    expect(calls.map(c => c.idempotencyKey)).toEqual([`tn:${id}`]);
  });

  // spec/outboundAdmission.md, "A row does not wait for an answer that the person already gave"
  test("SD-147: a conversation-limit answer while the person writes back leaves the row due, not held", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const to = "+12125558147";
    let q!: OutboundQueue;
    let limited = true;
    const calls: string[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        calls.push(req.idempotencyKey);
        if (!limited) return { providerMessageId: `sim:${req.idempotencyKey}:${calls.length}`, status: "sent" };
        limited = false;
        now.advance(1000);
        // The person writes while the provider call runs: the release finds no held row yet.
        expect(await q.inbound(to)).toBe(0);
        throw new ChannelSendError("conversation limit", "await_recipient", 429, "conversation_limit");
      },
    };
    q = queue(a, provider, { clock: now });
    await q.enqueue(a, [{ id: "sd147-reminder", to, kind: "transactional", text: "Your plan starts at 7.", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("sd147-reminder")).toBe("pending");
    await q.drain();
    expect(await q.statusOf("sd147-reminder")).toBe("sent");
  });

  // spec/outboundAdmission.md, "Replies, quiet hours and unanswered messages limit when a send can go out"
  test("SD-148: a gateway reply counts in the unanswered streak when its turn receipt accepts it", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const { calls, provider } = recorder();
    const q = queue(a, provider, { clock: now });
    const to = "+12125558100";
    const reply = (id: string) => ({ id, memberId: "sd148-member", to, kind: "reply" as const, text: "Here is what I found." });
    await a.begin(tx => q.recordCollected(tx, [reply("sd148-accepted"), reply("sd148-unknown")]));
    await a.begin(tx => q.collectedReceipt(tx, ["sd148-accepted"], "accepted", now.now()));
    await a.begin(tx => q.collectedReceipt(tx, ["sd148-unknown"], "unknown", now.now()));
    const [conv] = await a`select unanswered, last_outbound_at from platform.line_conversations where line = ${LINE} and address = ${to}`;
    expect([conv?.unanswered, conv && new Date(conv.last_outbound_at).getTime()]).toEqual([1, now.now()]);
    expect([await q.statusOf("sd148-accepted"), await q.statusOf("sd148-unknown")]).toEqual(["sent", "send_unknown"]);
    expect(calls).toEqual([]);
  });

  // spec/outboundAdmission.md, "A current row needs a delivering line and the recipient's eligibility"
  test("Q-outbound_queue-1: a STOP that commits during the checks stops a direct text to a non-member", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const { calls, provider } = recorder();
    let stopped = false;
    const q = queue(a, provider, { clock: now, checks: checks({
      optedOut: () => stopped,
      leaks: () => { stopped = true; return {}; },
    }) });
    await q.enqueue(a, [{ id: "q1-invite", to: "+12125558001", kind: "transactional", text: "You are invited to The Network.", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("q1-invite")).toBe("refused_opted_out");
    expect(calls).toEqual([]);
  });

  // spec/outboundReceipt.md, "An acceptance records a send time only for a send that went out"
  test("SD-337 / SD-091: a failed acceptance gets no send time; a receipt owner's accepted text to a non-member keeps no address or text", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 13, 16));
    const blooio: ChannelAdapter = { kind: "sim", async send(req) { return { providerMessageId: `sim:${req.idempotencyKey}`, status: "failed" }; } };
    const cloud: ChannelAdapter = {
      kind: "sim",
      async send(req) { return { providerMessageId: `cloud:${req.idempotencyKey}`, status: "queued" }; },
      async receipt(req) { return { providerMessageId: `cloud:${req.idempotencyKey}`, status: "queued" }; },
    };
    const failed = queue(a, blooio, { clock: now });
    await failed.enqueue(a, [{ id: "sd337-failed", to: "+12125558337", kind: "transactional", text: "Your plan update.", timeZone: NY }]);
    await failed.drain();
    const [f] = await a`select status, sent_at from platform.outbound where id = 'sd337-failed'`;
    expect([f.status, f.sent_at]).toEqual(["failed", null]);
    const owner = queue(a, cloud, { clock: now });
    await owner.enqueue(a, [{ id: "sd091-invite", to: "+12125558091", kind: "transactional", text: "You are invited to The Network.", timeZone: NY }]);
    await owner.drain();
    const [c] = await a`select status, ended_at, to_address, body, sent_at from platform.outbound where id = 'sd091-invite'`;
    expect([c.status, c.ended_at === null, c.to_address, c.body, c.sent_at === null]).toEqual(["accepted", false, null, null, false]);
  });

  test("SD-100: a gateway reply whose turn receipt never comes, or comes as unknown, ends failed_unknown after the receipt deadline, and a late accepted receipt still records it as sent", async () => {
    const now = new SimClock(Date.UTC(2026, 9, 14, 16));
    const { calls, provider } = recorder();
    const alerts: string[] = [];
    const q = queue(a, provider, { clock: now, onAlert: (id, alert) => { alerts.push(`${id}:${alert}`); } });
    const to = "+12125558100";
    const answeredTo = "+12125558101";
    const reply = (id: string) => ({ id, memberId: "sd100-member", to, kind: "reply" as const, text: "Here is the plan for Saturday." });
    const collectedAt = now.now();
    await a.begin(tx => q.recordCollected(tx, [reply("sd100-collected"), reply("sd100-unknown"),
      { ...reply("sd100-answered"), memberId: "sd100-answered-member", to: answeredTo }]));
    await a.begin(tx => q.collectedReceipt(tx, ["sd100-unknown"], "unknown", now.now()));
    now.advance(5 * 60 * 60_000);
    await q.drain();
    expect([await q.statusOf("sd100-collected"), await q.statusOf("sd100-unknown")]).toEqual(["collected", "send_unknown"]);
    now.advance(2 * 60 * 60_000);
    const changes = await q.drain();
    expect(changes).toContainEqual(expect.objectContaining({ id: "sd100-collected", memberId: "sd100-member", status: "failed_unknown" }));
    expect(changes).toContainEqual(expect.objectContaining({ id: "sd100-unknown", memberId: "sd100-member", status: "failed_unknown" }));
    const rows = await a`select id, status, ended_at, body from platform.outbound where id in ('sd100-collected', 'sd100-unknown') order by id`;
    expect(rows.map((r: any) => [r.id, r.status, r.ended_at !== null, r.body])).toEqual([
      ["sd100-collected", "failed_unknown", true, "Here is the plan for Saturday."],
      ["sd100-unknown", "failed_unknown", true, "Here is the plan for Saturday."],
    ]);
    expect(alerts).toEqual(expect.arrayContaining(["sd100-collected:gateway_receipt_expired", "sd100-unknown:gateway_receipt_expired"]));
    await a.begin(tx => q.collectedReceipt(tx, ["sd100-unknown"], "unknown", now.now()));
    expect(await q.statusOf("sd100-unknown")).toBe("failed_unknown");
    await a.begin(tx => q.collectedReceipt(tx, ["sd100-collected"], "accepted", now.now()));
    const [late] = await a`select status, sent_at, ended_at from platform.outbound where id = 'sd100-collected'`;
    expect([late.status, late.sent_at?.getTime(), late.ended_at !== null]).toEqual(["sent", collectedAt, true]);
    const [conversation] = await a`select unanswered from platform.line_conversations where line = ${q.line} and address = ${to}`;
    expect(conversation?.unanswered).toBe(1);
    expect(await q.statusOf("sd100-answered")).toBe("failed_unknown");
    await q.inbound(answeredTo);
    await a.begin(tx => q.collectedReceipt(tx, ["sd100-answered"], "accepted", now.now()));
    const [answered] = await a`select status, sent_at from platform.outbound where id = 'sd100-answered'`;
    expect([answered.status, answered.sent_at?.getTime()]).toEqual(["sent", collectedAt]);
    const [answeredConversation] = await a`select unanswered, last_outbound_at from platform.line_conversations
      where line = ${q.line} and address = ${answeredTo}`;
    expect([answeredConversation?.unanswered, answeredConversation?.last_outbound_at?.getTime()]).toEqual([0, collectedAt]);
    expect(calls).toEqual([]);
  });
});
