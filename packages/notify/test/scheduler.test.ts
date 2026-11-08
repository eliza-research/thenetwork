// The Notifier on the in-memory store (no Postgres, so it runs without pg_ctl). It covers where an
// unanswered button page lands the "ignored" streak (the primary assistant, not the push channel),
// and the no-penalty cases: a page whose items were read on the target itself, or whose message the
// outbound queue would have dropped before send (erased or expired items), must not add to the
// target's ignored streak.
import { describe, expect, test } from "bun:test";
import { MemoryNotifyStore } from "../src/store.ts";
import { Notifier, type Recipient } from "../src/scheduler.ts";
import type { InboxItemInput } from "../src/types.ts";

const T0 = Date.UTC(2026, 9, 9, 16); // 12:00 in New York: outside quiet hours.
const NY = "America/New_York";

/** One SMS member who chose Claude, so every digest is a Claude button page. */
function setup(prefs: Recipient["prefs"] = { channel: "sms", explicit: "claude" }) {
  const store = new MemoryNotifyStore();
  const r: Recipient = { personId: "p1", to: "+12125550101", timeZone: NY, prefs, proactiveAllowed: true };
  const notifier = new Notifier(store, { get: id => (id === r.personId ? r : undefined) }, { isQuiet: () => false });
  const sent: Array<{ idempotencyKey: string; text: string }> = [];
  const sink = { enqueue: (x: { idempotencyKey: string; text: string }) => void sent.push(x) };
  return { store, notifier, r, sink, sent };
}

// "requested" is due at once, so one dispatch sends the digest (a "normal" item waits for its digest window).
const req = (subjectId: string, extra: Partial<InboxItemInput> = {}): InboxItemInput =>
  ({ personId: "p1", app: "friends", eventType: "plan", subjectId, urgency: "requested", summary: "A new update.", ...extra });

const pastWindow = (notifier: Notifier) => T0 + notifier.cfg.outcomeWindowMs + 60_000;

describe("Notifier.dispatch button page target", () => {
  test("an SMS member's Claude digest is a button page aimed at Claude, recorded as the target", async () => {
    const { store, notifier, r, sink } = setup();
    await notifier.setActive(r.personId, "claude", true);
    await notifier.add(req("b1"), T0);
    const { sent } = await notifier.dispatch(T0, sink);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.delivery).toMatchObject({ mode: "button_page", assistants: ["claude"] });
    // The ignored streak must be able to land on Claude, not on the "sms" channel.
    expect((await store.getDelivery(sent[0]!.deliveryId))!.target).toBe("claude");
  });
});

describe("Notifier.sweep ignored streak", () => {
  test("a page nobody answered adds to the target's ignored streak", async () => {
    const { store, notifier, r, sink } = setup();
    await notifier.setActive(r.personId, "claude", true);
    await notifier.add(req("b1"), T0);
    await notifier.dispatch(T0, sink);
    await notifier.sweep(pastWindow(notifier));
    const claude = (await store.signals(r.personId)).find(s => s.surface === "claude");
    expect(claude).toMatchObject({ ignored: 1, ignoredStreak: 1 });
  });

  test("items read on the target itself (readUpdates in Claude, no token) do not count as ignored", async () => {
    const { store, notifier, r, sink } = setup();
    await notifier.setActive(r.personId, "claude", true);
    const it = (await notifier.add(req("b1"), T0)).item;
    await notifier.dispatch(T0, sink);
    // The member opened Claude and read the update there; the queued SMS is now obsolete.
    await notifier.readUpdates(r.personId, "claude", T0 + 1000);
    expect((await store.getItems([it.id]))[0]).toMatchObject({ seenOn: "claude" });
    await notifier.sweep(pastWindow(notifier));
    const claude = (await store.signals(r.personId)).find(s => s.surface === "claude");
    expect(claude?.ignored ?? 0).toBe(0);
    expect(claude?.ignoredStreak ?? 0).toBe(0);
  });

  test("items seen on another surface (the queue would suppress the send) do not count as ignored", async () => {
    const { store, notifier, r, sink } = setup();
    await notifier.setActive(r.personId, "claude", true);
    const it = (await notifier.add(req("b1"), T0)).item;
    await notifier.dispatch(T0, sink);
    // Seen in the thread before the queue sent: queuePolicy drops it as notification_obsolete.
    await store.markSeen(r.personId, "sms", T0 + 1000, [it.id]);
    await notifier.sweep(pastWindow(notifier));
    const claude = (await store.signals(r.personId)).find(s => s.surface === "claude");
    expect(claude?.ignoredStreak ?? 0).toBe(0);
  });

  test("a page whose only item expired before send does not count as ignored", async () => {
    const { store, notifier, r, sink } = setup();
    await notifier.setActive(r.personId, "claude", true);
    await notifier.add(req("b1", { expiresAt: T0 + 60_000 }), T0);
    await notifier.dispatch(T0, sink);
    // The window passes; the item has long expired, so the queue never sent the page.
    await notifier.sweep(pastWindow(notifier));
    const claude = (await store.signals(r.personId)).find(s => s.surface === "claude");
    expect(claude?.ignoredStreak ?? 0).toBe(0);
  });
});
