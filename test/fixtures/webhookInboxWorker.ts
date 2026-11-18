import type { Event, WebhookTurn } from "../../packages/core/src/generated/webhookInbox.ts";
import { SimClock } from "../../packages/core/src/clock.ts";
import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { InboundMessage } from "../../packages/blooio/src/types.ts";
import { Inbox } from "../../packages/network/service/inbox.ts";
import { withConformanceDatabases } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

// Each key is one handling attempt of one received row, for its own sender on its own database: Inbox.drain, the
// tick, drains every sender it finds. `startWebhook` makes the row the event describes: the row (STOP or not) is
// received through Inbox.receive, fails as many times as the event counts through Inbox.drain, and the next drain
// selects it with the handler held open, so `RunningWebhook` is the shell waiting on the handler. A STOP row arrives
// after an ordinary row that is still pending, so its completion has a row to cancel. An ordinary row that failed five
// times is dropped and no drain selects it again; that start is refused. A negative count cannot come from the inbox, so
// the worker writes it on the stored row and the drain must refuse to start the attempt. Completion is held by a
// transaction that locks the row, so `CompleteWebhook` and `CancelEarlier` are a completion write that waits on the
// lock; a failed completion write is that statement cancelled. The attempt count is read back from the row.

const LANES = 2;
const START = Date.UTC(2026, 9, 9, 16);
const EARLIER = "what are you up to this week";

type Held = { resolve(outcome: string): void; reject(error: Error): void };
type Lock = { pid: number; release(): void; done: Promise<unknown> };
type Lane = {
  sql: SQL;
  inbox: Inbox;
  clock: SimClock;
  from: string;
  serial: number;
  stop?: boolean;
  targetId?: string;
  failures: number;
  held?: Held;
  arrived?: () => void;
  attempt?: Promise<unknown>;
  lock?: Lock;
  writer?: number;
};

await withConformanceDatabases("webhook_inbox_conformance", LANES, async databases => {
  const lanes = new Map<string, Lane>();
  let senders = 0;

  function laneFor(key: string): Lane {
    const existing = lanes.get(key);
    if (existing) return existing;
    const sql = databases[lanes.size];
    if (!sql) throw new Error(`The worker has ${LANES} databases; ${key} needs another`);
    const clock = new SimClock(START);
    const lane = { sql, clock, from: `+1212555${String(2000 + ++senders).padStart(4, "0")}`, serial: 0, failures: 0 } as Lane;
    lane.inbox = new Inbox({
      sql, clock, log: () => {}, senderKey: sender => `key:${sender}`,
      handle: async (ev: InboundMessage) => {
        if (ev.messageId !== lane.targetId || lane.failures > 0) {
          if (ev.messageId === lane.targetId) lane.failures--;
          throw new Error("conformance handler failure");
        }
        return new Promise<string>((resolve, reject) => { lane.held = { resolve, reject }; lane.arrived?.(); });
      },
    });
    lanes.set(key, lane);
    return lane;
  }

  function message(lane: Lane, text: string): InboundMessage {
    lane.clock.advance(1000);
    return {
      kind: "message", channel: "sim", messageId: `${lane.from}-${++lane.serial}`, from: lane.from, to: "+12125550100",
      chatId: lane.from, isGroup: false, text, mediaUrls: [], transport: "imessage", receivedAt: lane.clock.now(),
    };
  }

  /** Run `work` until the handler holds the target row open or the work ends; true when the row is held. */
  async function untilHeld(lane: Lane, work: () => Promise<unknown>): Promise<boolean> {
    const arrived = new Promise<true>(resolve => { lane.arrived = () => resolve(true); });
    lane.attempt = work();
    const held = await Promise.race([arrived, lane.attempt.then(() => false, () => false)]);
    lane.arrived = undefined;
    return held;
  }

  /** Receive the row, fail it `prior` times, and hold its next attempt in the handler; false when no attempt starts. */
  async function start(lane: Lane, stop: boolean, prior: number): Promise<boolean> {
    lane.stop = stop;
    if (stop && await lane.inbox.receive(message(lane, EARLIER)) !== "retry_later") throw new Error("The earlier row was not left pending");
    const target = message(lane, stop ? "STOP" : "Any plans for Saturday?");
    lane.targetId = target.messageId;
    if (prior === 0) {
      lane.failures = 0;
      return untilHeld(lane, () => lane.inbox.receive(target));
    }
    lane.failures = Math.max(prior, 1);
    const first = await lane.inbox.receive(target);
    if (first !== "retry_later") throw new Error(`A failed row answered ${first}`);
    if (prior < 0) await lane.sql`update platform.inbound set attempts = ${prior} where id = ${rowId(lane)}`;
    for (let n = 1; n < prior; n++) await lane.inbox.drain();
    lane.failures = 0;
    return untilHeld(lane, () => lane.inbox.drain());
  }

  /** A start the drain refused leaves no attempt: remove the lane's rows so the key is queued again. */
  async function forget(lane: Lane) {
    await lane.attempt?.catch(() => {});
    lane.attempt = undefined;
    lane.targetId = undefined;
    lane.stop = undefined;
    await lane.sql`delete from platform.inbound where id like ${`msg:sim:${lane.from}-%`}`;
  }

  /** Lock the row, let the handler answer, and wait until the completion write waits on the lock. */
  async function holdCompletion(lane: Lane) {
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    let locked!: (pid: number) => void;
    const pid = new Promise<number>(resolve => { locked = resolve; });
    const done = lane.sql.begin(async tx => {
      const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid from platform.inbound where id = ${rowId(lane)} for update`;
      if (!row) throw new Error("The target row is missing");
      locked(row.pid);
      await released;
    });
    lane.lock = { pid: await pid, release, done };
    lane.held!.resolve("handled");
    lane.held = undefined;
    for (let tries = 0; tries < 500; tries++) {
      const [waiting] = await lane.sql<{ pid: number }[]>`select pid from pg_stat_activity
        where ${lane.lock.pid}::int = any(pg_blocking_pids(pid)) limit 1`;
      if (waiting) { lane.writer = waiting.pid; return; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The completion write never waited on the row");
  }

  async function finish(lane: Lane) {
    const lock = lane.lock!;
    lane.lock = undefined;
    lane.writer = undefined;
    lock.release();
    await lock.done;
    await lane.attempt;
  }

  const rowId = (lane: Lane) => `msg:sim:${lane.targetId}`;

  async function turnOf(lane: Lane): Promise<WebhookTurn> {
    if (lane.targetId === undefined) return { phase: "WebhookQueued", attempts: 0, stopCommand: false };
    const rows = await lane.sql<{ id: string; status: string; outcome: string | null; attempts: number }[]>`
      select id, status, outcome, attempts from platform.inbound where id like ${`msg:sim:${lane.from}-%`} order by received_at`;
    const target = rows.find(row => row.id === rowId(lane));
    const earlier = rows.find(row => row.id !== rowId(lane));
    if (!target) throw new Error("The target row is missing");
    const turn = (phase: WebhookTurn["phase"]): WebhookTurn => ({ phase, attempts: target.attempts, stopCommand: lane.stop === true });
    if (lane.held) return turn("RunningWebhook");
    if (lane.writer !== undefined) return turn(lane.stop ? "CancelEarlier" : "CompleteWebhook");
    switch (target.status) {
      case "done":
        if (target.outcome !== "handled") throw new Error(`The handled row stored ${target.outcome}`);
        if (earlier && (earlier.status !== "done" || earlier.outcome !== "cancelled_by_stop")) throw new Error("A completed STOP left the earlier row pending");
        return turn("WebhookDone");
      case "pending":
        if (earlier && earlier.status !== "pending") throw new Error("A failed STOP changed the earlier row");
        return turn("RetryWebhook");
      case "failed":
        return turn("DropWebhook");
      default: throw new Error(`The target row has status ${target.status}`);
    }
  }

  async function reset() {
    for (const lane of lanes.values()) {
      lane.held?.reject(new Error("journey reset"));
      lane.held = undefined;
      if (lane.lock) await finish(lane).catch(() => {});
      await lane.attempt?.catch(() => {});
      await lane.sql`delete from platform.inbound`;
    }
    lanes.clear();
    return null;
  }

  await serveJourney<Event>({
    reset,
    async dispatch(key, event) {
      const lane = laneFor(key);
      const { phase } = await turnOf(lane);
      switch (event.type) {
        case "startWebhook":
          if (phase !== "WebhookQueued") return "refused";
          if (await start(lane, event.stopCommand, event.attempts)) return "accepted";
          await forget(lane);
          return "refused";
        case "recordHandled":
          if (phase !== "RunningWebhook") return "refused";
          await holdCompletion(lane);
          return "accepted";
        case "recordCompletion":
          if (phase !== "CompleteWebhook" && phase !== "CancelEarlier") return "refused";
          await finish(lane);
          return "accepted";
        case "recordFailure": {
          if (phase === "RunningWebhook") {
            const held = lane.held!;
            lane.held = undefined;
            held.reject(new Error("conformance handler failure"));
            await lane.attempt;
            return "accepted";
          }
          if (phase !== "CompleteWebhook" && phase !== "CancelEarlier") return "refused";
          await lane.sql`select pg_cancel_backend(${lane.writer!}::int)`;
          await finish(lane);
          return "accepted";
        }
      }
    },
    async observe(key): Promise<WebhookTurn> {
      return turnOf(laneFor(key));
    },
    observeOutput: () => null,
  });
  await reset();
}, 12);
