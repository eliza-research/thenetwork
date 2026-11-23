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
import { BlooioAdapter } from "../src/adapters/blooio-adapter.ts";
import { BlooioClient } from "../src/blooio/client.ts";
import { parseBlooioWebhook } from "../src/blooio/webhook.ts";
import { OutboundQueue, recipientWindowHasher, type AppChecks, type QueueOptions } from "../src/outbound-queue.ts";
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
  new OutboundQueue({ sql, clock, provider, line: LINE, app: "friends", checks: checks(), newChatsPerLinePerDay: 1000, perLinePerDay: 1000,
    recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"), ...o });

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

  test("a Los Angeles queue row follows its market's quiet hours without a saved zone", async () => {
    const local = new SimClock(Date.UTC(2026, 9, 9, 13));
    const { calls, provider } = recorder();
    const q = queue(a, provider, { clock: local });
    const id = "quiet-los-angeles";
    await q.enqueue(a, [{ id, to: "+12125553218", kind: "transactional", text: "Your meeting reminder.", city: "la" }]);
    await q.drain();
    expect(calls).toHaveLength(0);
    expect(await q.statusOf(id)).toBe("deferred_quiet_hours");

    local.set(Date.UTC(2026, 9, 9, 16));
    await q.drain();
    expect(calls.map(call => call.idempotencyKey)).toEqual([`tn:${id}`]);
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

  test("the recipient cap survives erasure of a delivered nonmember payload", async () => {
    // spec/outboundAdmission.md, "Apply line controls and sending caps before checking the text"
    // spec/outboundReceipt.md, "A terminal receipt preserves the recipient cap after payload erasure"
    const local = new SimClock(clock.now());
    const line = "+12125550528";
    const calls: string[] = [];
    const provider = new BlooioAdapter(new BlooioClient({ apiKey: "synthetic-queue-test", fetch: async (_request, init) => {
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      calls.push(key);
      const status = key === "tn:recipient-terminal-acceptance" ? "delivered" : "sent";
      return Response.json({ data: { id: `local:${key}`, status, protocol: "imessage" } }, { status: 201 });
    } }), line);
    const q = queue(a, provider, { clock: local, line, perRecipientPerHour: 1 });
    const first = "recipient-window-first", next = "recipient-window-next";
    const payload = { to: "+12125553224", kind: "transactional", text: "Your invitation is ready.", timeZone: NY } as const;
    await q.enqueue(a, [{ id: first, ...payload }]);
    await q.drain();
    expect(await q.statusOf(first)).toBe("sent");

    await q.enqueue(a, [{ id: next, ...payload, text: "Your invitation is still available." }]);
    await q.drain();
    const status = async (id: string) => (await a`select status,attempts from platform.outbound where id=${id}`)[0];
    expect(await status(next)).toEqual({ status: "retry_scheduled", attempts: 0 });
    expect(calls).toEqual([`tn:${first}`]);

    const receipt = (id: string, state: "delivered" | "read" | "failed") => {
      const event = parseBlooioWebhook(JSON.stringify({ id: `${id}-${state}`, type: `message.${state}`,
        created_at: local.now(), data: { message_id: `local:tn:${id}`, protocol: "imessage" },
      }), local.now());
      if (event.kind !== "status") throw new Error("The native receipt did not parse");
      return event;
    };
    const acceptance = new Date(local.now());
    const peer = queue(b, provider, { clock: local, line, perRecipientPerHour: 1 });
    await Promise.all([q.applyStatus(receipt(first, "delivered")), peer.applyStatus(receipt(first, "read"))]);
    expect(await q.statusOf(first)).toBe("read");
    const [terminal] = await a`select member_id,to_address,body,sent_at from platform.outbound where id=${first}`;
    expect(terminal).toEqual({ member_id: null, to_address: null, body: null, sent_at: acceptance });

    local.advance(5 * 60_000);
    await Promise.all([q.drain(), peer.drain()]);
    expect({ next: await status(next), calls }).toEqual({ next: { status: "retry_scheduled", attempts: 0 }, calls: [`tn:${first}`] });
    const window = (id: string) => a`select recipient_key,sent_at from platform.outbound_recipient_window where outbound_id=${id}`;
    const key = recipientWindowHasher("synthetic-recipient-window");
    expect(await window(first)).toEqual([{ recipient_key: key(line, payload.to), sent_at: acceptance }]);

    const acceptedAsDelivered = { ...payload, to: "+12125553225" };
    await q.enqueue(a, [{ id: "recipient-terminal-acceptance", ...acceptedAsDelivered }]);
    await q.drain();
    expect(await q.statusOf("recipient-terminal-acceptance")).toBe("delivered");
    expect(await window("recipient-terminal-acceptance")).toEqual([{
      recipient_key: key(line, acceptedAsDelivered.to), sent_at: new Date(local.now()),
    }]);

    const failedPayload = { ...payload, to: "+12125553226" };
    const failed = "recipient-definitive-failure", afterFailure = "recipient-after-definitive-failure";
    await q.enqueue(a, [{ id: failed, ...failedPayload }]);
    await q.drain();
    expect(await q.applyStatus(receipt(failed, "failed"))).toMatchObject({ status: "failed" });
    expect(await window(failed)).toEqual([]);
    await q.enqueue(a, [{ id: afterFailure, ...failedPayload }]);
    await q.drain();
    expect(await status(afterFailure)).toEqual({ status: "sent", attempts: 1 });

    local.advance(55 * 60_000);
    await q.purge();
    expect(await window(first)).toEqual([]);
    await q.drain();
    expect(await status(next)).toEqual({ status: "sent", attempts: 1 });

    const ordinary = "recipient-ordinary-at-cap", compliance = "recipient-compliance-at-cap";
    await q.enqueue(a, [{ id: ordinary, ...payload }, { id: compliance, ...payload, kind: "compliance", text: "You're unsubscribed." }]);
    await q.drain();
    expect(await status(ordinary)).toEqual({ status: "retry_scheduled", attempts: 0 });
    expect(await status(compliance)).toEqual({ status: "sent", attempts: 1 });
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

  test("malformed approved_photos parks only that row while applyStatus and decideLeak still operate", async () => {
    const { calls, provider } = recorder();
    const alerts: string[] = [];
    const q = queue(a, provider, { onAlert: (id, r) => alerts.push(`${id}:${r}`) });
    await q.enqueue(a, [
      { id: "bad-photos-send", to: "+12125558001", kind: "transactional", text: "Row one", timeZone: NY },
      { id: "good-after-bad", to: "+12125558002", kind: "transactional", text: "Row two", timeZone: NY },
    ]);
    await a`update platform.outbound set approved_photos = '[{"bad":true}]'::jsonb where id = 'bad-photos-send'`;
    const now = new Date(clock.now());
    await a`insert into platform.outbound (id,app_id,line,to_address,kind,body,media_urls,fingerprint,time_zone,status,provider_message_id,approved_photos,next_attempt_at,created_at,updated_at) values
      ('bad-photos-receipt','friends',${LINE},'+12125558003','transactional','Delivered ok',${a.array([], "TEXT")},'fp-bad-1',${NY},'sent','sim:tn:bad-photos-receipt','[{"bad":true}]'::jsonb,${now},${now},${now}),
      ('bad-photos-leak','friends',${LINE},'+12125558004','transactional','Leak drop',${a.array([], "TEXT")},'fp-bad-2',${NY},'parked_leak_review',null,'[{"bad":true}]'::jsonb,${now},${now},${now})`;

    await q.drain();
    expect(await q.statusOf("bad-photos-send")).toBe("parked_error");
    expect(await q.statusOf("good-after-bad")).toBe("sent");
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:good-after-bad"]);
    expect(alerts).toContain("bad-photos-send:dispatch_error");

    expect(await q.applyStatus({ kind: "status", channel: "sim", providerMessageId: "sim:tn:bad-photos-receipt", status: "delivered", at: clock.now() }))
      .toMatchObject({ id: "bad-photos-receipt", status: "delivered" });
    expect(await q.decideLeak("bad-photos-leak", "drop", "staff@example.org"))
      .toMatchObject({ id: "bad-photos-leak", status: "dropped_leak_review" });
  });

  test("stale hook fail-closed retries with backoff until maxAttempts, then parks or recovers", async () => {
    const local = new SimClock(clock.now());
    const { calls, provider } = recorder();
    let throwStale = true, capTakes = 0;
    const alerts: string[] = [];
    const q = queue(a, provider, {
      clock: local,
      maxAttempts: 2,
      baseBackoffMs: 1_000,
      onAlert: (id, r) => alerts.push(`${id}:${r}`),
      checks: checks({
        stale: () => { if (throwStale) throw new Error("stale db down"); return false; },
        capTake: async () => { capTakes++; return true; },
      }),
    });
    await a`insert into network.members (id,app_id,account_status,home_city) values ('m-stale','friends','active','nyc') on conflict (app_id,id) do nothing`;
    await q.enqueue(a, [{ id: "stale-fail-1", memberId: "m-stale", to: "+12125558010", kind: "proactive", text: "Hello?", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("stale-fail-1")).toBe("retry_scheduled");
    expect(calls.length).toBe(0);
    expect(capTakes).toBe(0);

    local.advance(2_000);
    await q.drain();
    expect(await q.statusOf("stale-fail-1")).toBe("parked_error");
    expect(calls.length).toBe(0);
    expect(capTakes).toBe(0);
    expect(alerts.filter(x => x === "stale-fail-1:dispatch_error").length).toBe(2);

    await q.enqueue(a, [{ id: "stale-recover-1", memberId: "m-stale", to: "+12125558011", kind: "proactive", text: "Recovered!", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("stale-recover-1")).toBe("retry_scheduled");
    local.advance(2_000);
    throwStale = false;
    await q.drain();
    expect(await q.statusOf("stale-recover-1")).toBe("sent");
    expect(capTakes).toBe(1);
  });

  test("failed_unknown preserves person_cap while expired releases it", async () => {
    const local = new SimClock(clock.now());
    const released: string[] = [];
    let failMode: "unknown" | "retryable" = "unknown";
    const alerts: string[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send() { throw new ChannelSendError("ambiguous or temp", failMode); },
    };
    const q = queue(a, provider, {
      clock: local,
      unknownTtlMs: 10_000,
      ttlProactiveMs: 5_000,
      baseBackoffMs: 10_000,
      onAlert: (id, r) => alerts.push(`${id}:${r}`),
      checks: checks({
        capTake: async () => true,
        capRelease: async row => { released.push(row.id); },
      }),
    });

    await a`insert into network.members (id,app_id,account_status,home_city) values ('m-cap','friends','active','nyc') on conflict (app_id,id) do nothing`;
    await q.enqueue(a, [{ id: "unknown-keep-cap", memberId: "m-cap", to: "+12125558020", kind: "proactive", text: "Uncertain?", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("unknown-keep-cap")).toBe("unknown_acceptance");

    failMode = "retryable";
    await q.enqueue(a, [{ id: "expired-rel-cap", memberId: "m-cap", to: "+12125558021", kind: "proactive", text: "Expiring?", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("expired-rel-cap")).toBe("retry_scheduled");

    local.advance(11_000);
    await q.drain();
    expect(await q.statusOf("unknown-keep-cap")).toBe("failed_unknown");
    expect(await q.statusOf("expired-rel-cap")).toBe("expired");
    expect(alerts).toContain("unknown-keep-cap:unknown_acceptance_expired");
    expect(released).toEqual(["expired-rel-cap"]);
  });

  test("external dropped_forgotten during in-flight send or stale failure is never overwritten", async () => {
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        const id = req.idempotencyKey.replace(/^tn:/, "");
        await a`update platform.outbound set status = 'dropped_forgotten', to_address = null, body = null, ended_at = now() where id = ${id}`;
        throw new ChannelSendError("after erase", id === "forget-unknown" ? "unknown" : "retryable");
      },
    };
    const q = queue(a, provider);
    await q.enqueue(a, [
      { id: "forget-unknown", to: "+12125558025", kind: "transactional", text: "Forget one", timeZone: NY },
      { id: "forget-retryable", to: "+12125558026", kind: "transactional", text: "Forget two", timeZone: NY },
    ]);
    await q.drain();
    const rows = await a`select id, status, to_address, body from platform.outbound where id in ('forget-unknown', 'forget-retryable') order by id`;
    for (const r of rows as any[]) expect([r.status, r.to_address, r.body]).toEqual(["dropped_forgotten", null, null]);

    const qStale = queue(a, recorder().provider, {
      checks: checks({
        stale: async row => {
          if (row.id !== "forget-stale") return false;
          await a`update platform.outbound set status = 'dropped_forgotten', to_address = null, body = null, ended_at = now() where id = ${row.id}`;
          throw new Error("gone during stale");
        },
      }),
    });
    await qStale.enqueue(a, [{ id: "forget-stale", to: "+12125558027", kind: "transactional", text: "Forget three", timeZone: NY }]);
    await qStale.drain();
    const [staleRow] = await a`select status, attempts, to_address, body from platform.outbound where id = 'forget-stale'`;
    expect([staleRow.status, staleRow.attempts, staleRow.to_address, staleRow.body]).toEqual(["dropped_forgotten", 0, null, null]);
  });

  test("failed acceptance receipt leaves sent_at null and preserves perRecipientPerHour quota", async () => {
    let returnFailed = true;
    const calls: SendRequest[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        calls.push(req);
        return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: returnFailed ? "failed" : "sent", transport: "sim" };
      },
    };
    const q = queue(a, provider, { perRecipientPerHour: 1 });
    await q.enqueue(a, [{ id: "accept-fail-1", to: "+12125558030", kind: "transactional", text: "First try", timeZone: NY }]);
    await q.drain();
    const [first] = await a`select status, sent_at, to_address from platform.outbound where id = 'accept-fail-1'`;
    expect([first.status, first.sent_at, first.to_address]).toEqual(["failed", null, null]);

    returnFailed = false;
    await q.enqueue(a, [{ id: "accept-fail-2", to: "+12125558030", kind: "transactional", text: "Second try", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("accept-fail-2")).toBe("sent");
    expect(calls.length).toBe(2);
  });

  test("non-member direct message rechecks optedOut inside admission", async () => {
    let opted = false;
    const { calls, provider } = recorder();
    const q = queue(a, provider, {
      checks: checks({
        leaks: () => { opted = true; return {}; },
        optedOut: () => opted,
      }),
    });
    await q.enqueue(a, [{ id: "nonmem-optout", to: "+12125558040", kind: "transactional", text: "Direct hello", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("nonmem-optout")).toBe("refused_opted_out");
    expect(calls.length).toBe(0);
  });

  test("inbound during provider await_recipient leaves row pending instead of held", async () => {
    let first = true;
    let qRef!: OutboundQueue;
    const calls: SendRequest[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) {
        calls.push(req);
        if (first) {
          first = false;
          await qRef.inbound(req.to);
          throw new ChannelSendError("conversation limit", "await_recipient");
        }
        return { providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim" };
      },
    };
    const q = queue(a, provider);
    qRef = q;
    await q.enqueue(a, [{ id: "await-inbound-race", to: "+12125558050", kind: "proactive", text: "Checking in", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("await-inbound-race")).toBe("pending");
    await q.drain();
    expect(await q.statusOf("await-inbound-race")).toBe("sent");
    expect(calls.length).toBe(2);
  });

  test("accepted collectedReceipt increments unanswered count toward maxUnanswered", async () => {
    const { calls, provider } = recorder();
    const q = queue(a, provider, { maxUnanswered: 2 });
    const to = "+12125558060";
    await a.begin(tx => q.recordCollected(tx, [
      { id: "col-streak-1", memberId: "m-cs", to, kind: "reply", text: "First reply" },
      { id: "col-streak-2", memberId: "m-cs", to, kind: "reply", text: "Second reply" },
    ]));
    await a.begin(tx => q.collectedReceipt(tx, ["col-streak-1", "col-streak-2"], "accepted", clock.now()));
    const [conv] = await a`select unanswered from platform.line_conversations where line = ${LINE} and address = ${to}`;
    expect(Number(conv.unanswered)).toBe(2);

    await q.enqueue(a, [{ id: "col-streak-held", memberId: "m-cs", to, kind: "proactive", text: "Third outbound", timeZone: NY }]);
    await q.drain();
    expect(await q.statusOf("col-streak-held")).toBe("held_awaiting_reply");
    expect(calls.length).toBe(0);
  });

  test("collected and send_unknown rows expire to failed_unknown after unknownTtlMs", async () => {
    const local = new SimClock(clock.now());
    const alerts: string[] = [];
    const q = queue(a, recorder().provider, { clock: local, unknownTtlMs: 10_000, onAlert: (id, r) => alerts.push(`${id}:${r}`) });
    await a.begin(tx => q.recordCollected(tx, [
      { id: "col-ttl-1", memberId: "m-ct", to: "+12125558065", kind: "reply", text: "Pending collected" },
      { id: "col-ttl-2", memberId: "m-ct", to: "+12125558066", kind: "reply", text: "Unknown collected" },
    ]));
    await a.begin(tx => q.collectedReceipt(tx, ["col-ttl-2"], "unknown", local.now()));
    expect(await q.statusOf("col-ttl-2")).toBe("send_unknown");

    local.advance(11_000);
    await q.drain();
    expect(await q.statusOf("col-ttl-1")).toBe("failed_unknown");
    expect(await q.statusOf("col-ttl-2")).toBe("failed_unknown");
    expect(alerts).toContain("col-ttl-1:collected_receipt_expired");
    expect(alerts).toContain("col-ttl-2:collected_receipt_expired");
  });

  test("enqueue with leakReasons parks immediately and emits leak_blocked without draining", async () => {
    const alerts: string[] = [];
    const { calls, provider } = recorder();
    const q = queue(a, provider, { onAlert: (id, r) => alerts.push(`${id}:${r}`) });
    await q.enqueue(a, [{
      id: "preparked-leak", to: "+12125558070", kind: "transactional", text: "Clean surface text", timeZone: NY,
      leakReasons: ["canary:x", "private:y"],
    }]);
    const [row] = await a`select status, note, ended_at from platform.outbound where id = 'preparked-leak'`;
    expect([row.status, row.note]).toEqual(["parked_leak_review", "leak: canary:x,private:y"]);
    expect(row.ended_at).not.toBeNull();
    expect(alerts).toEqual(["preparked-leak:leak_blocked"]);
    await q.drain();
    expect(calls.length).toBe(0);
  });

  test("lockAdmission returning false defers without changing row until lockAdmission succeeds", async () => {
    let allow = false;
    const { calls, provider } = recorder();
    const q = queue(a, provider, { checks: checks({ lockAdmission: async () => allow }) });
    await q.enqueue(a, [{ id: "stale-view-1", to: "+12125558080", kind: "transactional", text: "Wait for fresh view", timeZone: NY }]);
    expect(await q.drain()).toEqual([]);
    expect(await q.statusOf("stale-view-1")).toBe("pending");
    expect(calls.length).toBe(0);

    allow = true;
    await q.drain();
    expect(await q.statusOf("stale-view-1")).toBe("sent");
    expect(calls.length).toBe(1);
  });

  test("multi-city network_id isolation and legacy null-network backfill (requires 0072)", async ctx => {
    if (!(await schemaHas0072(a))) return void ctx.skip();
    const { calls, provider } = recorder();
    const nyc = queue(a, provider, { app: "friends", network: "friends:nyc" });
    const sf = queue(a, provider, { app: "friends", network: "friends:sf" });
    await nyc.enqueue(a, [
      { id: "net-nyc-1", to: "+12125558090", kind: "transactional", text: "NYC notice", timeZone: NY },
      { id: "net-legacy-null", to: "+12125558091", kind: "transactional", text: "Legacy notice", timeZone: NY },
    ]);
    await sf.enqueue(a, [{ id: "net-sf-1", to: "+12125558092", kind: "transactional", text: "SF notice", timeZone: NY }]);
    await a`update platform.outbound set network_id = null where id = 'net-legacy-null'`;

    await sf.drain();
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:net-sf-1"]);
    const [backfilled] = await a`select status, network_id from platform.outbound where id = 'net-legacy-null'`;
    expect([backfilled.status, backfilled.network_id]).toEqual(["pending", "friends:nyc"]);

    await nyc.drain();
    expect(calls.map(c => c.idempotencyKey).sort()).toEqual(["tn:net-legacy-null", "tn:net-nyc-1", "tn:net-sf-1"]);
  });

  test("safety outbound kind bypasses quiet hours, streak and line caps while consent, line safety, recipient cap and leak guard hold (requires 0072)", async ctx => {
    if (!(await schemaHas0072(a))) return void ctx.skip();
    const quietLocal = new SimClock(Date.UTC(2026, 9, 9, 7)); // 03:00 in NY (quiet)
    const { calls, provider } = recorder();
    const memberId = "safety-member-1", to = "+12125558100";
    await a`insert into network.members (id,app_id,account_status,home_city,prefs) values (${memberId},'friends','paused','nyc',${{ quietHours: [0, 8] }}::jsonb)`;
    await a`insert into platform.line_conversations (line,address,unanswered) values (${LINE},${to},5)`;

    const qBypass = queue(a, provider, {
      clock: quietLocal,
      maxUnanswered: 1,
      perLinePerDay: 0,
      newChatsPerLinePerDay: 0,
      perRecipientPerHour: 2,
    });
    await qBypass.enqueue(a, [
      { id: "safety-pass-1", memberId, to, kind: "safety", text: "Account notice from safety.", timeZone: "Not/A_Zone" },
    ]);
    await qBypass.drain();
    expect(await qBypass.statusOf("safety-pass-1")).toBe("sent");
    expect(calls.map(c => c.idempotencyKey)).toEqual(["tn:safety-pass-1"]);

    // Line safety pauses "safety" notices; clearing restores line.
    await qBypass.enqueue(a, [{ id: "safety-pause-check", memberId, to, kind: "safety", text: "Second notice.", timeZone: NY }]);
    await qBypass.setLineSafety("pause", "safety.state_changed");
    try {
      await qBypass.drain();
      expect(await qBypass.statusOf("safety-pause-check")).toBe("retry_scheduled");
    } finally {
      await qBypass.setLineSafety(undefined);
    }

    // Opt-out and leak guard still stop "safety" notices.
    const qGuards = queue(a, provider, {
      clock: quietLocal,
      perRecipientPerHour: 1,
      checks: checks({
        optedOut: row => row.id === "safety-optout",
        leaks: () => ({ forbidden: ["secret club"] }),
      }),
    });
    await qGuards.enqueue(a, [
      { id: "safety-optout", memberId, to: "+12125558101", kind: "safety", text: "Notice.", timeZone: NY },
      { id: "safety-leak", memberId, to: "+12125558102", kind: "safety", text: "About secret club.", timeZone: NY },
      { id: "safety-rcap", memberId, to, kind: "safety", text: "Hits hourly cap.", timeZone: NY },
    ]);
    await qGuards.drain();
    expect(await qGuards.statusOf("safety-optout")).toBe("refused_opted_out");
    expect(await qGuards.statusOf("safety-leak")).toBe("parked_leak_review");
    expect(await qGuards.statusOf("safety-rcap")).toBe("retry_scheduled");
  });
});

async function schemaHas0072(sql: SQL): Promise<boolean> {
  const [col] = await sql`select 1 from information_schema.columns
    where table_schema = 'platform' and table_name = 'outbound' and column_name = 'network_id'`;
  const [chk] = await sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c
    join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'platform' and t.relname = 'outbound' and c.conname = 'outbound_kind_check'`;
  return Boolean(col) && typeof chk?.def === "string" && chk.def.includes("'safety'");
}
