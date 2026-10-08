import { describe, expect, test } from "bun:test";
import {
  MemoryNotifyStore, Notifier, assertSendableUrl, assistantLink, buttonPageButtons, composeText, findToken,
  newToken, resolveDelivery, updatePrompt, type InboxItem, type Recipient, type SurfaceSignal,
} from "../src/index.ts";

const H = 3600_000;
const D = 24 * H;
// 2026-10-08 16:00 UTC = 12:00 in New York: outside quiet hours.
const NOON_NY = Date.UTC(2026, 9, 8, 16, 0);
const NIGHT_NY = Date.UTC(2026, 9, 9, 3, 0); // 23:00 New York

function setup(rec: Partial<Recipient> = {}) {
  const store = new MemoryNotifyStore();
  const r: Recipient = {
    personId: "p1", to: "+12125550101", timeZone: "America/New_York",
    prefs: { channel: "imessage" }, proactiveAllowed: true, ...rec,
  };
  const notifier = new Notifier(store, { get: (id: string) => (id === r.personId ? r : undefined) });
  const sent: any[] = [];
  const sink = { enqueue: (x: any) => sent.push(x) };
  return { store, notifier, sent, sink, r };
}

const item = (over: Partial<Parameters<Notifier["add"]>[0]> = {}) => ({
  personId: "p1", app: "friends", eventType: "plan_proposed", subjectId: "plan_1",
  urgency: "normal" as const, summary: "Dev is free Thursday. Tacos at 7?", ...over,
});

describe("task tokens", () => {
  test("format and extraction", () => {
    const tok = newToken();
    expect(tok).toMatch(/^T-[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(findToken(`please show ${tok.toLowerCase()} now`)).toBe(tok);
    expect(findToken("nothing here")).toBeUndefined();
  });
});

describe("links", () => {
  const tok = "T-7F3K9Q";
  test("prompt carries only the token and fits the limits", () => {
    expect(updatePrompt(tok)).toBe("Ask The Network for update T-7F3K9Q");
    expect(() => updatePrompt("Maya wants to meet")).toThrow();
    for (const a of ["chatgpt", "claude", "grok"] as const) {
      const url = assistantLink(a, updatePrompt(tok));
      expect(assertSendableUrl(url)).toBe(url);
    }
  });
  test("fill-only parameters", () => {
    expect(assistantLink("chatgpt", "x")).toBe("https://chatgpt.com/?prompt=x");
    expect(assistantLink("claude", "x")).toBe("https://claude.ai/new?q=x");
    expect(assistantLink("grok", "x")).toBe("https://grok.com/?q=x");
  });
  test("rejects shorteners, other hosts, http and long URLs", () => {
    expect(() => assertSendableUrl("https://bit.ly/abc")).toThrow(/shortener/);
    expect(() => assertSendableUrl("https://evil.example/t/x")).toThrow(/host/);
    expect(() => assertSendableUrl("http://ntwrk.love/t/x")).toThrow(/https/);
    expect(() => assertSendableUrl("https://ntwrk.love/" + "a".repeat(200))).toThrow(/longer/);
  });
  test("button page has a button per assistant and a reply option", () => {
    expect(buttonPageButtons(tok, ["claude", "chatgpt"], "+12125550100").map(x => x.label)).toEqual(["Open in Claude", "Open in ChatGPT", "Reply by text"]);
  });
});

describe("resolveDelivery", () => {
  const sig = (over: Partial<SurfaceSignal> & { surface: SurfaceSignal["surface"] }): SurfaceSignal =>
    ({ active: true, acted: 0, ignored: 0, ignoredStreak: 0, ...over });
  test("no assistants: thread", () => {
    expect(resolveDelivery({ channel: "imessage" }, [], NOON_NY).mode).toBe("thread");
  });
  test("explicit assistant on iMessage: deeplink; on SMS: button page", () => {
    const s = [sig({ surface: "claude" })];
    expect(resolveDelivery({ channel: "imessage", explicit: "claude" }, s, NOON_NY)).toMatchObject({ mode: "deeplink", assistant: "claude" });
    expect(resolveDelivery({ channel: "sms", explicit: "claude" }, s, NOON_NY)).toMatchObject({ mode: "button_page", assistants: ["claude"] });
  });
  test("explicit but not connected, or links unused twice: thread", () => {
    expect(resolveDelivery({ channel: "imessage", explicit: "chatgpt" }, [], NOON_NY).reason).toBe("explicit_not_connected");
    expect(resolveDelivery({ channel: "imessage", explicit: "chatgpt" }, [sig({ surface: "chatgpt", ignoredStreak: 2 })], NOON_NY).reason).toBe("explicit_link_unused");
  });
  test("score needs a clear leader over the thread and other assistants", () => {
    const acted = sig({ surface: "chatgpt", acted: 2, lastUsedAt: NOON_NY - H });
    expect(resolveDelivery({ channel: "imessage" }, [acted], NOON_NY)).toMatchObject({ mode: "deeplink", assistant: "chatgpt" });
    const thread = sig({ surface: "imessage", acted: 3, lastUsedAt: NOON_NY - H });
    expect(resolveDelivery({ channel: "imessage" }, [acted, thread], NOON_NY).mode).toBe("thread");
    expect(resolveDelivery({ channel: "imessage" }, [sig({ surface: "claude" })], NOON_NY).reason).toBe("no_clear_leader");
  });
});

describe("compose", () => {
  const mk = (n: number, over: Partial<InboxItem> = {}): InboxItem =>
    ({ ...item({ subjectId: `s${n}`, summary: `Update ${n}` }), id: `inb_${n}`, dedupeKey: `k${n}`, createdAt: n, ...over });
  test("thread lists at most three summaries", () => {
    expect(composeText([1, 2, 3, 4].map(n => mk(n)), { mode: "thread", reason: "" })).toBe('Update 1\nUpdate 2\nUpdate 3\n+1 more. Reply "updates" to see them.');
  });
  test("link messages never include the summary or the app", () => {
    const text = composeText([mk(1, { app: "slop", summary: "Sam (29) wants a date Friday" })], { mode: "deeplink", assistant: "chatgpt", reason: "" }, "T-7F3K9Q");
    expect(text).not.toContain("Sam");
    expect(text).not.toContain("slop");
    expect(text).toContain("https://chatgpt.com/?prompt=Ask%20The%20Network%20for%20update%20T-7F3K9Q");
  });
});

describe("scheduler", () => {
  test("rejects an empty summary", () => {
    const { notifier } = setup();
    expect(() => notifier.add(item({ summary: "  " }), NOON_NY)).toThrow();
  });

  test("normal items wait for the digest; urgent after the delay; one message for everything", async () => {
    const { notifier, sent, sink } = setup();
    await notifier.add(item(), NOON_NY);
    expect((await notifier.dispatch(NOON_NY + H, sink)).holds[0]).toMatchObject({ reason: "not_due" });
    await notifier.add(item({ app: "slop", eventType: "match", subjectId: "m1", urgency: "urgent", summary: "You have a new match." }), NOON_NY + H);
    const r = await notifier.dispatch(NOON_NY + H + 6 * 60_000, sink);
    expect(r.sent.length).toBe(1);
    expect(sent[0].text).toBe("Dev is free Thursday. Tacos at 7?\nYou have a new match.");
    expect(sent[0].kind).toBe("proactive");
    expect(sent[0].idempotencyKey).toBe(sent[0].briefId);
    expect((await notifier.dispatch(NOON_NY + 2 * H, sink)).sent.length).toBe(0);
  });

  test("quiet hours hold; requested items are due at once and don't count toward the cap", async () => {
    const { notifier, sink, sent } = setup();
    await notifier.add(item({ urgency: "requested", subjectId: "rem1", summary: "Reminder: dinner at 7." }), NIGHT_NY);
    expect((await notifier.dispatch(NIGHT_NY, sink)).holds[0]!.reason).toBe("quiet_hours");
    await notifier.dispatch(NOON_NY + D, sink);
    expect(sent[0].kind).toBe("transactional");
  });

  test("weekly cap of two proactive messages; requested items still go", async () => {
    const { notifier, sink, sent } = setup();
    for (let d = 0; d < 3; d++) {
      const t = NOON_NY + d * D;
      await notifier.add(item({ subjectId: `u${d}`, urgency: "urgent", summary: `Urgent ${d}` }), t);
      await notifier.dispatch(t + H, sink);
    }
    expect(sent.length).toBe(2);
    const r = await notifier.dispatch(NOON_NY + 3 * D, sink);
    expect(r.holds[0]).toMatchObject({ reason: "weekly_cap", until: NOON_NY + H + 7 * D });
    await notifier.add(item({ subjectId: "rem", urgency: "requested", summary: "Reminder" }), NOON_NY + 3 * D);
    await notifier.dispatch(NOON_NY + 3 * D + 1, sink);
    expect(sent.length).toBe(3);
    expect(sent[2].text).toBe("Reminder");
  });

  test("seen elsewhere before sending: cancelled; seen after enqueue: stillNeeded false", async () => {
    const { store, notifier, sink, sent } = setup();
    await notifier.add(item({ urgency: "urgent" }), NOON_NY);
    await store.markSeen("p1", "claude", NOON_NY + 60_000);
    expect((await notifier.dispatch(NOON_NY + H, sink)).sent.length).toBe(0);
    expect(sent.length).toBe(0);
    const b = (await notifier.add(item({ subjectId: "plan_9", urgency: "urgent" }), NOON_NY + H)).item;
    const r = await notifier.dispatch(NOON_NY + 2 * H, sink);
    expect(await notifier.stillNeeded(r.sent[0]!.deliveryId)).toBe(true);
    await store.markSeen("p1", "chatgpt", NOON_NY + 3 * H, [b.id]);
    expect(await notifier.stillNeeded(r.sent[0]!.deliveryId)).toBe(false);
  });

  test("proactive off: only requested items go out", async () => {
    const { notifier, sink, sent } = setup({ proactiveAllowed: false });
    await notifier.add(item({ urgency: "urgent" }), NOON_NY);
    expect((await notifier.dispatch(NOON_NY + H, sink)).holds[0]!.reason).toBe("proactive_off");
    await notifier.add(item({ subjectId: "r", urgency: "requested", summary: "Your reminder" }), NOON_NY + H);
    await notifier.dispatch(NOON_NY + H, sink);
    expect(sent.map(s => s.text)).toEqual(["Your reminder"]);
  });

  test("assistant preference: deeplink with token; redeeming it marks seen and counts as acted", async () => {
    const { store, notifier, sink, sent } = setup({ prefs: { channel: "imessage", explicit: "chatgpt" } });
    await notifier.setActive("p1", "chatgpt", true);
    await notifier.add(item({ urgency: "urgent" }), NOON_NY);
    const token = (await notifier.dispatch(NOON_NY + H, sink)).sent[0]!.token!;
    expect(sent[0].text).toContain(encodeURIComponent(token));
    expect(await notifier.readUpdates("p2", "chatgpt", NOON_NY + 2 * H, token)).toEqual([]);
    expect((await notifier.readUpdates("p1", "chatgpt", NOON_NY + 2 * H, token)).length).toBe(1);
    expect((await store.unseen("p1", NOON_NY + 2 * H)).length).toBe(0);
    expect((await store.signals("p1")).find(s => s.surface === "chatgpt")!.acted).toBe(1);
    expect((await store.getToken(token))!.redeemedOn).toBe("chatgpt");
  });

  test("expired tokens show nothing", async () => {
    const { notifier, sink } = setup({ prefs: { channel: "imessage", explicit: "claude" } });
    await notifier.setActive("p1", "claude", true);
    await notifier.add(item({ urgency: "requested" }), NOON_NY);
    const token = (await notifier.dispatch(NOON_NY, sink)).sent[0]!.token!;
    expect(await notifier.readUpdates("p1", "claude", NOON_NY + 7 * D, token)).toEqual([]);
  });

  test("links unused twice fall back to the thread", async () => {
    const { notifier, sink, sent } = setup({ prefs: { channel: "imessage", explicit: "claude" } });
    await notifier.setActive("p1", "claude", true);
    for (let d = 0; d < 2; d++) {
      const t = NOON_NY + d * 4 * D;
      await notifier.add(item({ subjectId: `x${d}`, urgency: "urgent" }), t);
      await notifier.dispatch(t + H, sink);
      await notifier.sweep(t + 4 * D);
    }
    expect(sent[0].text).toContain("claude.ai");
    await notifier.add(item({ subjectId: "x9", urgency: "urgent", summary: "Plain update" }), NOON_NY + 9 * D);
    await notifier.dispatch(NOON_NY + 9 * D + H, sink);
    expect(sent.at(-1).text).toBe("Plain update");
  });

  test("a thread reply counts as acting on pending deliveries", async () => {
    const { store, notifier, sink } = setup();
    await notifier.add(item({ urgency: "requested" }), NOON_NY);
    await notifier.dispatch(NOON_NY, sink);
    await notifier.threadReply("p1", "imessage", NOON_NY + H);
    expect((await store.signals("p1")).find(s => s.surface === "imessage")).toMatchObject({ acted: 1, lastUsedAt: NOON_NY + H });
    await notifier.sweep(NOON_NY + 10 * D);
    expect((await store.signals("p1")).find(s => s.surface === "imessage")!.ignored).toBe(0);
  });
});
