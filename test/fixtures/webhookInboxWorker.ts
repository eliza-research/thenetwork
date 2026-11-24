import { type Event, type WebhookTurn, webhookAttemptLimit } from "../../packages/core/src/generated/webhookInbox.ts";
import { SimClock } from "../../packages/core/src/clock.ts";
import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { InboundMessage } from "../../packages/blooio/src/types.ts";
import { Inbox, isStopText } from "../../packages/network/service/inbox.ts";
import { holdInboundRowUntilWaited, type InboundRowHold, withConformanceDatabases } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

const LANES = 2;
const START = Date.UTC(2026, 9, 9, 16);
const EARLIER = "what are you up to this week";

type Held = { resolve(outcome: string): void; reject(error: Error): void };
type Lane = {
  sql: SQL;
  inbox: Inbox;
  clock: SimClock;
  from: string;
  serial: number;
  stop?: boolean;
  storedStop?: boolean;
  targetId?: string;
  failures: number;
  held?: Held;
  arrived?: () => void;
  attempt?: Promise<unknown>;
  lock?: InboundRowHold;
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
    const lane: Lane = {
      sql, clock, from: `+1212555${String(2000 + ++senders).padStart(4, "0")}`, serial: 0, failures: 0,
      inbox: new Inbox({
        sql, clock, log: () => {}, senderKey: sender => `key:${sender}`,
        handle: async (ev: InboundMessage) => {
          if (ev.messageId !== lane.targetId || lane.failures > 0) {
            if (ev.messageId === lane.targetId) lane.failures--;
            throw new Error("conformance handler failure");
          }
          return new Promise<string>((resolve, reject) => { lane.held = { resolve, reject }; lane.arrived?.(); });
        },
      }),
    };
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

  async function untilHeld(lane: Lane, work: () => Promise<unknown>): Promise<boolean> {
    const arrived = new Promise<true>(resolve => { lane.arrived = () => resolve(true); });
    const attempt = work();
    lane.attempt = attempt;
    const held = await Promise.race([arrived, attempt.then(() => false)]);
    lane.arrived = undefined;
    return held;
  }

  async function start(lane: Lane, stop: boolean, prior: number): Promise<boolean> {
    lane.stop = stop;
    if (stop && await lane.inbox.receive(message(lane, EARLIER)) !== "retry_later") throw new Error("The earlier row was not left pending");
    const target = message(lane, stop ? "STOP" : "Any plans for Saturday?");
    lane.targetId = target.messageId;
    if (prior === 0) {
      lane.failures = 0;
      return untilHeld(lane, () => lane.inbox.receive(target));
    }
    if (prior < 0) throw new Error(`The inbox never stores a negative attempt count; the event asked for ${prior}`);
    lane.failures = prior;
    const first = await lane.inbox.receive(target);
    if (first !== "retry_later") throw new Error(`A failed row answered ${first}`);
    for (let n = 1; n < prior; n++) await lane.inbox.drain();
    lane.failures = 0;
    return untilHeld(lane, () => lane.inbox.drain());
  }

  async function forget(lane: Lane) {
    await lane.attempt;
    const [row] = await lane.sql<{ status: string; attempts: number }[]>`select status, attempts from platform.inbound where id = ${rowId(lane)}`;
    if (!row) throw new Error("The refused row is missing");
    if (lane.stop) throw new Error(`The drain refused to start a STOP row with ${row.attempts} attempts`);
    if (row.status !== "failed" || row.attempts < webhookAttemptLimit) throw new Error(`The drain refused a row that is ${row.status} with ${row.attempts} attempts`);
    lane.attempt = undefined;
    lane.targetId = undefined;
    lane.stop = undefined;
    lane.storedStop = undefined;
    await lane.sql`delete from platform.inbound where id like ${`msg:sim:${lane.from}-%`}`;
  }

  async function holdCompletion(lane: Lane) {
    const held = lane.held!;
    lane.lock = await holdInboundRowUntilWaited(lane.sql, rowId(lane), () => {
      lane.held = undefined;
      held.resolve("handled");
    });
  }

  async function finish(lane: Lane) {
    const lock = lane.lock!;
    lane.lock = undefined;
    await lock.release();
    await lane.attempt;
  }

  const rowId = (lane: Lane) => `msg:sim:${lane.targetId}`;

  async function turnOf(lane: Lane): Promise<WebhookTurn> {
    if (lane.targetId === undefined) return { phase: "WebhookQueued", attempts: 0, stopCommand: false };
    const rows = await lane.sql<{ id: string; status: string; outcome: string | null; attempts: number; text: string | null }[]>`
      select id, status, outcome, attempts, event->'ev'->>'text' as text from platform.inbound
      where id like ${`msg:sim:${lane.from}-%`} order by received_at`;
    const target = rows.find(row => row.id === rowId(lane));
    const earlier = rows.find(row => row.id !== rowId(lane));
    if (!target) throw new Error("The target row is missing");
    if (target.text !== null) lane.storedStop = isStopText(target.text);
    const stopCommand = lane.storedStop;
    if (stopCommand === undefined) throw new Error("The target row never stored its text");
    const turn = (phase: WebhookTurn["phase"]): WebhookTurn => ({ phase, attempts: target.attempts, stopCommand });
    if (lane.held) return turn("RunningWebhook");
    if (lane.lock !== undefined) return turn(stopCommand ? "CancelEarlier" : "CompleteWebhook");
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
    const failures: unknown[] = [];
    for (const lane of lanes.values()) {
      lane.held?.reject(new Error("journey reset"));
      lane.held = undefined;
      const settled = lane.lock ? finish(lane) : lane.attempt;
      await settled?.catch(error => failures.push(error));
      await lane.sql`delete from platform.inbound`;
    }
    lanes.clear();
    if (failures.length > 0) throw new AggregateError(failures, "An inbox attempt failed during the journey");
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
          await lane.sql`select pg_cancel_backend(${lane.lock!.waiter}::int)`;
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
