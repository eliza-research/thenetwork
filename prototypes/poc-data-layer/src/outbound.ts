// Fix 6: outbound sends are keyed by outbound_messages.idempotency_key (UNIQUE NOT NULL). A send job that crashes at
// any point and is retried produces one row and one provider send call.
import type { Backend, Db } from "./db";
import { simEnqueueJob, simInsertOutbound } from "./sim";
import { CLAIM, COMPLETE, REAP } from "./suite";

/** Mock provider with Blooio-like semantics: sends honour an Idempotency-Key; lookup by key is a read. */
export class MockProvider {
  sendCalls = 0; lookupCalls = 0; replays = 0;
  readonly delivered = new Map<string, { id: string; to: string; body: string }>();
  async send(m: { idempotencyKey: string; to: string; body: string }) {
    this.sendCalls++;
    const prior = this.delivered.get(m.idempotencyKey);
    if (prior) { this.replays++; return { id: prior.id, replayed: true }; }
    const id = `pm_${this.delivered.size + 1}`;
    this.delivered.set(m.idempotencyKey, { id, to: m.to, body: m.body });
    return { id, replayed: false };
  }
  async lookup(idempotencyKey: string) { this.lookupCalls++; return this.delivered.get(idempotencyKey)?.id ?? null; }
}

export type CrashPoint = "after-row" | "after-sending-mark" | "after-provider" | "after-sent-mark";
export class Crash extends Error { constructor(public at: CrashPoint) { super(`crash ${at}`); } }

export interface SendPayload { idempotency_key: string; member_id: string; channel: string; to: string; body: string }

/** Producer side: enqueue a send job. The job's own idempotency key derives from the message key. */
export const enqueueSend = (db: Db, m: SendPayload) =>
  simEnqueueJob(db, { type: "send_message", payload: m, idempotencyKey: `send:${m.idempotency_key}`, memberIds: [m.member_id] });

/**
 * Job handler. Steps (each commits on its own):
 *  1. INSERT the outbound row ON CONFLICT (idempotency_key) DO NOTHING      -> at most one row per key
 *  2. lock the row; if 'sent' we are done; remember whether a previous attempt got as far as 'sending'; mark 'sending'
 *  3. if a previous attempt was 'sending', it may have reached the provider: look the key up there first
 *  4. otherwise send with the same key as the provider Idempotency-Key, then mark 'sent'
 */
export async function handleSend(db: Db, p: SendPayload, provider: MockProvider, crashAt?: CrashPoint) {
  await simInsertOutbound(db, { memberId: p.member_id, channel: p.channel, to: p.to, body: p.body, idempotencyKey: p.idempotency_key });
  if (crashAt === "after-row") throw new Crash(crashAt);
  const prior = await db.tx(async (t) => {
    const [row] = await t.q<{ status: string }>("SELECT status FROM network.outbound_messages WHERE idempotency_key = $1 FOR UPDATE", [p.idempotency_key]);
    if (row!.status === "sent") return "sent";
    await t.q("UPDATE network.outbound_messages SET status = 'sending', send_attempts = send_attempts + 1 WHERE idempotency_key = $1", [p.idempotency_key]);
    return row!.status;
  });
  if (prior === "sent") return "already-sent";
  if (crashAt === "after-sending-mark") throw new Crash(crashAt);
  let providerId = prior === "sending" ? await provider.lookup(p.idempotency_key) : null;
  const outcome = providerId ? "reconciled" : "sent";
  if (!providerId) {
    providerId = (await provider.send({ idempotencyKey: p.idempotency_key, to: p.to, body: p.body })).id;
    if (crashAt === "after-provider") throw new Crash(crashAt);
  }
  await db.q(`UPDATE network.outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = now()
               WHERE idempotency_key = $1`, [p.idempotency_key, providerId]);
  if (crashAt === "after-sent-mark") throw new Crash(crashAt);
  return outcome;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CRASH_POINTS: CrashPoint[] = ["after-row", "after-sending-mark", "after-provider", "after-sent-mark"];

/** Workers drain send_message jobs with leases; a crash drops the connection without completing the job. */
export async function runSendWorkers(b: Backend, provider: MockProvider, o: { workers: number; leaseMs: number; crashRate: number; seed: number;
  crash?: (jobId: number, attempt: number) => CrashPoint | undefined }) {
  const s = { executions: 0, crashes: {} as Record<string, number>, completed: 0, fenced: 0, outcomes: {} as Record<string, number> };
  let seed = o.seed;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  await Promise.all(Array.from({ length: o.workers }, async (_, w) => {
    const name = `s${w}`;
    let db = await b.connect();
    for (;;) {
      const claimed = await db.q<{ id: number; token: string }>(CLAIM, [name, 1, o.leaseMs]);
      if (!claimed.length) {
        await db.q(REAP);
        const [{ n }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.jobs WHERE status <> 'done' AND type = 'send_message'");
        if (!n) break;
        await sleep(10);
        continue;
      }
      const j = claimed[0]!;
      const [{ payload, attempts }] = await db.q<{ payload: SendPayload; attempts: number }>("SELECT payload, attempts FROM network.jobs WHERE id = $1", [j.id]);
      s.executions++;
      const crashAt = o.crash ? o.crash(j.id, attempts) : rand() < o.crashRate ? CRASH_POINTS[Math.floor(rand() * 4)] : undefined;
      try {
        const outcome = await handleSend(db, payload, provider, crashAt);
        s.outcomes[outcome] = (s.outcomes[outcome] ?? 0) + 1;
      } catch (e) {
        if (!(e instanceof Crash)) throw e;
        s.crashes[e.at] = (s.crashes[e.at] ?? 0) + 1;
        if (b.concurrent) { await db.close(); db = await b.connect(); }
        continue; // job stays 'running' until its lease expires and the reaper returns it
      }
      (await db.q(COMPLETE, [j.id, j.token, name])).length ? s.completed++ : s.fenced++;
    }
    if (b.concurrent) await db.close();
  }));
  return s;
}
