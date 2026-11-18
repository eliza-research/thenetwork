import type { DigestFlow, DigestPhase, Event } from "../../packages/core/src/generated/notificationDispatch.ts";
import { DAY, HOUR } from "../../packages/core/src/clock.ts";
import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { PgNotifyStore } from "../../packages/notify/src/pg-store.ts";
import { Accounts } from "../../packages/platform/src/accounts.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { PgPeopleStore } from "../../packages/platform/src/pg-store.ts";
import { deliveryIdFor, Notifier, type OutboundSink, type Recipient, type SendPlan } from "../../packages/notify/src/scheduler.ts";
import type { NotifyStore } from "../../packages/notify/src/store.ts";
import { withConformanceDatabase } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

// Each key is one person's digest on the Notifier (packages/notify/src/scheduler.ts) over the real Postgres inbox. A
// flow starts with its first event, which says which of the two it is:
//  - rereadItems: the person gets as many due items as the plan names, Notifier.dispatch plans them, and its re-read
//    of the items waits. The event then happens to the inbox for real: items the person saw, a recipient that is gone,
//    a new phone number. The rebuild (its read of the person's surface signals), the delivery record and the enqueue
//    each wait too, so `RebuildingDigest`, `ReusingDigest` and `EnqueueingDigest` are the effect the shell waits on.
//    A record that fails is an item the person saw after the re-read.
//  - readQueuedDigest: two items go out in a recorded digest (or a digest recorded under another id), and
//    Notifier.stillNeeded waits on its read of the items. The revalidation event erases an item, lets one expire, or
//    marks the rest seen first.

const START = Date.UTC(2026, 9, 9, 16);

type Gate = "items" | "signals" | "record" | "enqueue";
type Flow = {
  personId: string;
  recipient?: Recipient;
  itemIds: string[];
  store: NotifyStore;
  notifier: Notifier;
  armed: Set<Gate>;
  waiting?: { gate: Gate; release(): void };
  arrived?: () => void;
  rebuilt: boolean;
  enqueued: number;
  deliveryId?: string;
  run?: Promise<unknown>;
  result?: { kind: "dispatch"; sent: SendPlan[]; cancelled: string[] } | { kind: "revalidate"; needed: boolean };
};

await withConformanceDatabase("notification_dispatch_conformance", async sql => {
  const base = new PgNotifyStore(sql as SQL);
  // The inbox admits items only for a live person (packages/notify/db/retention.sql).
  const accounts = new Accounts(new PgPeopleStore(sql as SQL), { hashKey: "conformance-notify", now: () => START, apps: id => APPS[id] });
  const flows = new Map<string, Flow>();
  let people = 0;

  function gate(flow: Flow, name: Gate): Promise<void> {
    if (!flow.armed.delete(name)) return Promise.resolve();
    return new Promise<void>(release => { flow.waiting = { gate: name, release }; flow.arrived?.(); });
  }

  /** Let the shell run until it waits on its next effect or ends. */
  async function progress(flow: Flow, work?: () => Promise<unknown>) {
    const arrived = new Promise<void>(resolve => { flow.arrived = resolve; });
    if (work) flow.run = work();
    else {
      const waiting = flow.waiting!;
      flow.waiting = undefined;
      waiting.release();
    }
    await Promise.race([arrived, flow.run!]);
    flow.arrived = undefined;
  }

  function flowFor(key: string): Flow {
    const existing = flows.get(key);
    if (existing) return existing;
    const flow = { personId: "", itemIds: [], armed: new Set(), rebuilt: false, enqueued: 0 } as Flow;
    flow.store = new Proxy(base, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        const gated: Partial<Record<PropertyKey, Gate>> = { getItems: "items", signals: "signals", recordDelivery: "record" };
        const name = gated[property];
        if (!name) return value.bind(target);
        return async (...args: unknown[]) => {
          // The plan's own build reads the signals too; only an armed read is the dispatch's rebuild.
          if (name === "signals" && flow.armed.has("signals")) flow.rebuilt = true;
          await gate(flow, name);
          return value.apply(target, args);
        };
      },
    });
    flow.notifier = new Notifier(flow.store, { get: personId => personId === flow.personId ? flow.recipient : undefined }, { isQuiet: () => false });
    flows.set(key, flow);
    return flow;
  }

  async function addItems(flow: Flow, count: number) {
    flow.personId = (await accounts.createPerson(`+1646555${String(3000 + ++people).padStart(4, "0")}`, "inbound_message", 30)).id;
    for (let n = 0; n < count; n++) {
      const { item } = await flow.notifier.add({
        personId: flow.personId, app: "friends", eventType: "plan_confirmed", subjectId: `plan-${n}`, urgency: "normal",
        summary: `Your Saturday plan ${n + 1} is confirmed.`,
      }, START - DAY);
      flow.itemIds.push(item.id);
    }
  }

  const sink = (flow: Flow): OutboundSink => ({
    enqueue: async () => { await gate(flow, "enqueue"); flow.enqueued++; },
  });

  async function startDispatch(flow: Flow, event: Extract<Event, { type: "rereadItems" }>): Promise<"accepted" | "refused"> {
    // A plan names at least one item, and the re-read keeps some of them. The shell never forms other counts.
    if (event.plannedCount < 1 || event.remainingCount < 0 || event.remainingCount > event.plannedCount) return "refused";
    await addItems(flow, event.plannedCount);
    flow.recipient = { personId: flow.personId, to: "+12125553001", timeZone: "America/New_York", prefs: { channel: "sms" }, proactiveAllowed: true };
    flow.armed = new Set(["items"]);
    await progress(flow, () => flow.notifier.dispatch(START, sink(flow)).then(result => { flow.result = { kind: "dispatch", ...result }; }));
    if (flow.waiting?.gate !== "items") throw new Error("The dispatch did not re-read the planned items");
    const seen = flow.itemIds.slice(event.remainingCount);
    if (seen.length) await flow.store.markSeen(flow.personId, "imessage", START, seen);
    if (!event.recipientAvailable) flow.recipient = undefined;
    else if (event.destinationChanged) flow.recipient = { ...flow.recipient, to: "+12125553002" };
    // The plan's own build read the signals; only the dispatch's rebuild, record and enqueue wait from here.
    // The plan's build already set `rebuilt`; only a signals read after the re-read is the dispatch's rebuild.
    flow.rebuilt = false;
    flow.armed = new Set(["signals", "record", "enqueue"]);
    await progress(flow);
    return "accepted";
  }

  async function startRevalidation(flow: Flow, event: Extract<Event, { type: "readQueuedDigest" }>) {
    await addItems(flow, 2);
    const id = deliveryIdFor(flow.personId, flow.itemIds);
    flow.deliveryId = event.sameDigest ? id : `ntf_conformance_${flow.personId}`;
    const recorded = await base.recordDelivery({
      deliveryId: flow.deliveryId, personId: flow.personId, itemIds: flow.itemIds, target: "sms", countsTowardCap: true, sentAt: START - HOUR,
    });
    if (!recorded) throw new Error("The queued digest was not recorded");
    flow.armed = new Set(["items"]);
    await progress(flow, () => flow.notifier.stillNeeded(flow.deliveryId!, START).then(needed => { flow.result = { kind: "revalidate", needed }; }));
  }

  /** The inbox shows item ids as "inb_<row id>" (packages/notify/src/pg-store.ts). */
  function rowId(itemId: string): string {
    const match = /^inb_(\d+)$/.exec(itemId);
    if (!match) throw new Error(`Unexpected inbox item id ${itemId}`);
    return match[1]!;
  }

  async function revalidate(flow: Flow, event: Extract<Event, { type: "revalidateQueuedItems" }>) {
    const [first, second] = flow.itemIds;
    if (!event.allPresent) await sql`delete from notify.inbox_items where id = ${rowId(second!)}::bigint`;
    if (event.anyExpired) await sql`update notify.inbox_items set expires_at = ${new Date(START - 1)} where id = ${rowId(first!)}::bigint`;
    if (!event.anyUnseen) await flow.store.markSeen(flow.personId, "imessage", START);
    await progress(flow);
  }

  async function phaseOf(flow: Flow): Promise<DigestPhase> {
    if (!flow.run) return "DigestStarting";
    switch (flow.waiting?.gate) {
      case "items": return flow.deliveryId === undefined ? "DigestStarting" : "ReadingQueuedItems";
      case "signals": return "RebuildingDigest";
      case "record": return flow.rebuilt ? "RebuildingDigest" : "ReusingDigest";
      case "enqueue": {
        const [row] = await sql`select 1 from notify.deliveries where person_id = ${flow.personId}`;
        if (!row) throw new Error("The digest is enqueued before it is recorded");
        return "EnqueueingDigest";
      }
    }
    await flow.run;
    const result = flow.result!;
    if (result.kind === "revalidate") return result.needed ? "QueuedDigestNeeded" : "QueuedDigestObsolete";
    const recorded = await sql`select delivery_id from notify.deliveries where person_id = ${flow.personId}`;
    if (result.sent.length === 1 && result.cancelled.length === 0) {
      if (flow.enqueued !== 1 || recorded.length !== 1 || recorded[0]!.delivery_id !== result.sent[0]!.deliveryId) throw new Error("A queued digest is not recorded and enqueued once");
      return "DigestQueued";
    }
    if (result.sent.length === 0 && result.cancelled.length === 1) {
      if (flow.enqueued !== 0 || recorded.length !== 0) throw new Error("A cancelled digest was recorded or enqueued");
      return "DigestCancelled";
    }
    throw new Error(`The dispatch for one person returned ${JSON.stringify({ sent: result.sent.length, cancelled: result.cancelled })}`);
  }

  async function reset() {
    for (const flow of flows.values()) {
      flow.armed.clear();
      while (flow.waiting) await progress(flow);
      await flow.run?.catch(() => {});
    }
    flows.clear();
    await sql`delete from notify.deliveries`;
    await sql`delete from notify.inbox_items`;
    return null;
  }

  await serveJourney<Event>({
    reset,
    async dispatch(key, event) {
      const flow = flowFor(key);
      const phase = await phaseOf(flow);
      switch (event.type) {
        case "rereadItems":
          if (phase !== "DigestStarting") return "refused";
          return startDispatch(flow, event);
        case "recordDigest":
          if (phase !== "ReusingDigest" && phase !== "RebuildingDigest") return "refused";
          if (flow.waiting?.gate === "signals") await progress(flow);
          if (flow.waiting?.gate !== "record") throw new Error("The rebuilt digest was not recorded");
          if (!event.recorded) await flow.store.markSeen(flow.personId, "imessage", START);
          await progress(flow);
          return "accepted";
        case "enqueueDigest":
          if (phase !== "EnqueueingDigest") return "refused";
          await progress(flow);
          return "accepted";
        case "readQueuedDigest":
          if (phase !== "DigestStarting") return "refused";
          await startRevalidation(flow, event);
          return "accepted";
        case "revalidateQueuedItems":
          if (phase !== "ReadingQueuedItems") return "refused";
          await revalidate(flow, event);
          return "accepted";
      }
    },
    async observe(key): Promise<DigestFlow> {
      return { phase: await phaseOf(flowFor(key)) };
    },
    observeOutput: () => null,
  });
  await reset();
}, 8);
