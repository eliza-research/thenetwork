// Notifier wired to the real outbound queue (prototypes/messaging-blooio) on the simulated channel.
import { describe, expect, test } from "bun:test";
import { world } from "../../../prototypes/messaging-blooio/tests/helpers.ts";
import { MemoryNotifyStore, Notifier, connectorInbox, queuePolicy, queueSink, threadHooks, type Recipient } from "../src/index.ts";

const ALICE = "+15550100001";
const NY = "America/New_York";

function setup(prefs: Recipient["prefs"] = { channel: "imessage" }) {
  let notifier!: Notifier;
  const w = world({ recipientPolicy: queuePolicy<{ briefId?: string }>({ stillNeeded: id => notifier.stillNeeded(id) }) });
  const now = () => w.clock.now();
  const store = new MemoryNotifyStore();
  const r: Recipient = { personId: "p1", to: ALICE, timeZone: NY, prefs, proactiveAllowed: true };
  notifier = new Notifier(store, { get: id => (id === "p1" ? r : undefined) }, { isQuiet: () => false });
  w.queue.onRecipientEngaged("sim", ALICE);
  const sink = queueSink(w.queue, () => "sim" as const);
  return { w, now, store, notifier, sink };
}

const req = (subjectId: string, summary = "Dinner at 7 is confirmed.") =>
  ({ personId: "p1", app: "friends", eventType: "plan", subjectId, urgency: "requested" as const, summary });

describe("notify + outbound queue", () => {
  test("a delivery goes through the queue once, keyed by its delivery id", async () => {
    const { w, now, notifier, sink } = setup();
    await notifier.add(req("pl1"), now());
    const { sent } = await notifier.dispatch(now(), sink);
    await notifier.dispatch(now(), sink);
    await w.queue.drain();
    const recs = [...w.queue.records.values()];
    expect(recs.length).toBe(1);
    expect(recs[0]!.idempotencyKey).toBe(sent[0]!.deliveryId);
    expect(recs[0]!.status).toBe("sent");
  });

  test("seen on another surface while waiting in the queue: suppressed", async () => {
    const { w, now, store, notifier, sink } = setup();
    const it = (await notifier.add(req("pl2", "Dinner moved to 8."), now())).item;
    await notifier.dispatch(now(), sink);
    await store.markSeen("p1", "claude", now(), [it.id]);
    await w.queue.drain();
    const rec = [...w.queue.records.values()][0]!;
    expect(rec.status).toBe("suppressed_ineligible");
    expect(rec.history.at(-1)?.note).toBe("seen_elsewhere");
  });

  test("thread hooks: readUpdates clears the inbox; an inbound message counts as acting", async () => {
    const { now, store, notifier, sink } = setup();
    await notifier.add(req("m1", "You have a new match."), now());
    await notifier.dispatch(now(), sink);
    await notifier.add({ ...req("m2", "Another one."), urgency: "normal" }, now());
    const t = threadHooks(notifier, now);
    // Everything unseen, including an item already texted: "updates" is the member asking to see it all.
    expect(await t.readUpdates("p1")).toEqual({ items: [{ summary: "You have a new match." }, { summary: "Another one." }] });
    expect((await store.unseen("p1", now())).length).toBe(0);
    await t.inbound("p1", "imessage");
    expect((await store.signals("p1")).find(s => s.surface === "imessage")).toMatchObject({ acted: 1 });
  });

  test("connector bridge: token resolves to subjects for the owner only; shown marks seen", async () => {
    const { now, store, notifier, sink } = setup({ channel: "imessage", explicit: "chatgpt" });
    await notifier.setActive("p1", "chatgpt", true);
    await notifier.add({ ...req("op_9", "New intro."), app: "ntwrk" }, now());
    const token = (await notifier.dispatch(now(), sink)).sent[0]!.token!;
    const bridge = connectorInbox(notifier, now);
    expect(await bridge.redeem("p2", "chatgpt", token)).toBeNull();
    expect(await bridge.redeem("p1", "chatgpt", token)).toEqual(["op_9"]);
    await bridge.shown("p1", "chatgpt", ["op_9"]);
    expect((await store.unseen("p1", now())).length).toBe(0);
  });
});
