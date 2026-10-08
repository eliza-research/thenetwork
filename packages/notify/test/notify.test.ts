import { describe, expect, test } from "bun:test";
import {
  MemoryInbox, MemorySignals, Notifier, TaskTokens, assertSendableUrl, assistantLink, buttonPageButtons,
  composeText, findToken, resolveDelivery, updatePrompt, type Recipient, type SurfaceSignal,
} from "../src/index.ts";

const H = 3600_000;
// 2026-10-08 16:00 UTC = 12:00 in New York: outside quiet hours.
const NOON_NY = Date.UTC(2026, 9, 8, 16, 0);
const NIGHT_NY = Date.UTC(2026, 9, 9, 3, 0); // 23:00 New York

function seqRand() {
  let n = 0;
  return (max: number) => n++ % max;
}

function setup(rec: Partial<Recipient> = {}) {
  const inbox = new MemoryInbox();
  const tokens = new TaskTokens(seqRand());
  const signals = new MemorySignals();
  const r: Recipient = {
    personId: "p1", to: "+12125550101", timeZone: "America/New_York",
    prefs: { channel: "imessage" }, proactiveAllowed: true, ...rec,
  };
  const dir = { get: (id: string) => (id === r.personId ? r : undefined) };
  const notifier = new Notifier(inbox, tokens, signals, dir);
  const sent: any[] = [];
  const sink = { enqueue: (x: any) => sent.push(x) };
  return { inbox, tokens, signals, notifier, sent, sink, r };
}

const item = (over: Partial<Parameters<MemoryInbox["add"]>[0]> = {}) => ({
  personId: "p1", app: "friends", eventType: "plan_proposed", subjectId: "plan_1",
  urgency: "normal" as const, summary: "Dev is free Thursday. Tacos at 7?", ...over,
});

describe("inbox", () => {
  test("dedupes on person, app, event type and subject", () => {
    const inbox = new MemoryInbox();
    const a = inbox.add(item(), 0);
    const b = inbox.add(item({ summary: "different words" }), 5);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(inbox.add(item({ app: "slop" }), 5).created).toBe(true);
  });

  test("seen on one surface is seen everywhere; expired items drop out", () => {
    const inbox = new MemoryInbox();
    const a = inbox.add(item(), 0).item;
    inbox.add(item({ subjectId: "plan_2", expiresAt: 10 }), 0);
    expect(inbox.unseen("p1", 5).length).toBe(2);
    expect(inbox.unseen("p1", 10).length).toBe(1);
    inbox.markSeen("p1", "claude", 20, [a.id]);
    expect(inbox.unseen("p1", 20).length).toBe(0);
    expect(inbox.get(a.id)!.seenOn).toBe("claude");
  });
});

describe("task tokens", () => {
  test("format, extraction, and owner binding", () => {
    const t = new TaskTokens();
    const tok = t.issue("p1", ["inb_1"], 0);
    expect(tok.token).toMatch(/^T-[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(findToken(`please show ${tok.token.toLowerCase()} now`)).toBe(tok.token);
    expect(t.redeem(tok.token, "p2", "chatgpt", 1)).toEqual({ ok: false });
    expect(t.redeem("T-ZZZZZZ", "p1", "chatgpt", 1)).toEqual({ ok: false });
    expect(t.redeem(tok.token, "p1", "chatgpt", 1)).toEqual({ ok: true, itemIds: ["inb_1"], firstUse: true });
    expect(t.redeem(tok.token, "p1", "claude", 2)).toEqual({ ok: true, itemIds: ["inb_1"], firstUse: false });
    expect(t.get(tok.token)!.redeemedOn).toBe("chatgpt");
  });

  test("expire after 7 days", () => {
    const t = new TaskTokens();
    const tok = t.issue("p1", ["inb_1"], 0);
    expect(t.redeem(tok.token, "p1", "web", 7 * 24 * H).ok).toBe(false);
  });
});

describe("links", () => {
  const tok = "T-7F3K9Q";
  test("prompt carries only the token and fits the limits", () => {
    const p = updatePrompt(tok);
    expect(p).toBe("Ask The Network for update T-7F3K9Q");
    expect(() => updatePrompt("Maya wants to meet")).toThrow();
    for (const a of ["chatgpt", "claude", "grok"] as const) {
      const url = assistantLink(a, p);
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
    const b = buttonPageButtons(tok, ["claude", "chatgpt"], "+12125550100");
    expect(b.map(x => x.label)).toEqual(["Open in Claude", "Open in ChatGPT", "Reply by text"]);
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
    const fresh = sig({ surface: "claude" });
    expect(resolveDelivery({ channel: "imessage" }, [fresh], NOON_NY).reason).toBe("no_clear_leader");
  });
});

describe("compose", () => {
  test("thread lists at most three summaries", () => {
    const inbox = new MemoryInbox();
    const items = [1, 2, 3, 4].map(n => inbox.add(item({ subjectId: `s${n}`, summary: `Update ${n}` }), n).item);
    expect(composeText(items, { mode: "thread", reason: "" })).toBe('Update 1\nUpdate 2\nUpdate 3\n+1 more. Reply "updates" to see them.');
  });

  test("link messages never include the summary", () => {
    const inbox = new MemoryInbox();
    const i = inbox.add(item({ app: "slop", summary: "Sam (29) wants a date Friday" }), 0).item;
    const text = composeText([i], { mode: "deeplink", assistant: "chatgpt", reason: "" }, "T-7F3K9Q");
    expect(text).not.toContain("Sam");
    expect(text).not.toContain("slop");
    expect(text).toContain("https://chatgpt.com/?prompt=Ask%20The%20Network%20for%20update%20T-7F3K9Q");
  });
});

describe("scheduler", () => {
  test("normal items wait for the digest; urgent after the delay; one message for everything", () => {
    const { inbox, notifier, sent, sink } = setup();
    inbox.add(item(), NOON_NY);
    expect(notifier.dispatch(NOON_NY + H, sink).holds[0]).toMatchObject({ reason: "not_due" });
    inbox.add(item({ app: "slop", eventType: "match", subjectId: "m1", urgency: "urgent", summary: "You have a new match." }), NOON_NY + H);
    const r = notifier.dispatch(NOON_NY + H + 6 * 60_000, sink);
    expect(r.sent.length).toBe(1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toBe("Dev is free Thursday. Tacos at 7?\nYou have a new match.");
    expect(sent[0].kind).toBe("proactive");
    expect(sent[0].idempotencyKey).toBe(sent[0].briefId);
    expect(notifier.dispatch(NOON_NY + 2 * H, sink).sent.length).toBe(0);
  });

  test("quiet hours hold; requested items are due at once and skip the cap", () => {
    const { inbox, notifier, sink, sent } = setup();
    inbox.add(item({ urgency: "requested", subjectId: "rem1", summary: "Reminder: dinner at 7." }), NIGHT_NY);
    expect(notifier.dispatch(NIGHT_NY, sink).holds[0]!.reason).toBe("quiet_hours");
    notifier.dispatch(NOON_NY + 24 * H, sink);
    expect(sent[0].kind).toBe("transactional");
  });

  test("weekly cap of two proactive messages", () => {
    const { inbox, notifier, sink, sent } = setup();
    for (let d = 0; d < 3; d++) {
      const t = NOON_NY + d * 24 * H;
      inbox.add(item({ subjectId: `u${d}`, urgency: "urgent", summary: `Urgent ${d}` }), t);
      notifier.dispatch(t + H, sink);
    }
    expect(sent.length).toBe(2);
    const r = notifier.dispatch(NOON_NY + 3 * 24 * H, sink);
    expect(r.holds[0]).toMatchObject({ reason: "weekly_cap", until: NOON_NY + H + 7 * 24 * H });
    inbox.add(item({ subjectId: "rem", urgency: "requested", summary: "Reminder" }), NOON_NY + 3 * 24 * H);
    notifier.dispatch(NOON_NY + 3 * 24 * H + 1, sink);
    expect(sent.length).toBe(3);
    expect(sent[2].text).toBe("Reminder");
  });

  test("seen elsewhere before sending: cancelled; seen after enqueue: stillNeeded false", () => {
    const { inbox, notifier, sink, sent } = setup();
    const a = inbox.add(item({ urgency: "urgent" }), NOON_NY).item;
    inbox.markSeen("p1", "claude", NOON_NY + 60_000);
    expect(notifier.dispatch(NOON_NY + H, sink).sent.length).toBe(0);
    expect(sent.length).toBe(0);
    const b = inbox.add(item({ subjectId: "plan_9", urgency: "urgent" }), NOON_NY + H).item;
    const r = notifier.dispatch(NOON_NY + 2 * H, sink);
    expect(notifier.stillNeeded(r.sent[0]!.deliveryId)).toBe(true);
    inbox.markSeen("p1", "chatgpt", NOON_NY + 3 * H, [b.id]);
    expect(notifier.stillNeeded(r.sent[0]!.deliveryId)).toBe(false);
    expect(a.seenOn).toBe("claude");
  });

  test("proactive off: only requested items go out", () => {
    const { inbox, notifier, sink, sent } = setup({ proactiveAllowed: false });
    inbox.add(item({ urgency: "urgent" }), NOON_NY);
    expect(notifier.dispatch(NOON_NY + H, sink).holds[0]!.reason).toBe("proactive_off");
    inbox.add(item({ subjectId: "r", urgency: "requested", summary: "Your code reminder" }), NOON_NY + H);
    notifier.dispatch(NOON_NY + H, sink);
    expect(sent.map(s => s.text)).toEqual(["Your code reminder"]);
  });

  test("assistant preference: deeplink with token; redeeming it marks seen and counts as acted", () => {
    const { inbox, notifier, signals, sink, sent } = setup({ prefs: { channel: "imessage", explicit: "chatgpt" } });
    signals.setActive("p1", "chatgpt", true);
    inbox.add(item({ urgency: "urgent" }), NOON_NY);
    const r = notifier.dispatch(NOON_NY + H, sink);
    const token = r.sent[0]!.token!;
    expect(sent[0].text).toContain(encodeURIComponent(token));
    expect(notifier.readUpdates("p2", "chatgpt", NOON_NY + 2 * H, undefined, token)).toEqual([]);
    const got = notifier.readUpdates("p1", "chatgpt", NOON_NY + 2 * H, undefined, token);
    expect(got.length).toBe(1);
    expect(inbox.unseen("p1", NOON_NY + 2 * H).length).toBe(0);
    expect(signals.list("p1").find(s => s.surface === "chatgpt")!.acted).toBe(1);
  });

  test("unused links twice fall back to the thread", () => {
    const { inbox, notifier, signals, sink, sent } = setup({ prefs: { channel: "imessage", explicit: "claude" } });
    signals.setActive("p1", "claude", true);
    for (let d = 0; d < 2; d++) {
      const t = NOON_NY + d * 4 * 24 * H;
      inbox.add(item({ subjectId: `x${d}`, urgency: "urgent" }), t);
      notifier.dispatch(t + H, sink);
      signals.sweep(t + 4 * 24 * H);
    }
    expect(sent[0].text).toContain("claude.ai");
    inbox.add(item({ subjectId: "x9", urgency: "urgent", summary: "Plain update" }), NOON_NY + 9 * 24 * H);
    notifier.dispatch(NOON_NY + 9 * 24 * H + H, sink);
    expect(sent.at(-1).text).toBe("Plain update");
  });
});
