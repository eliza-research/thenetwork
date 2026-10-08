// The shared leak guard (packages/core/src/guard.ts) runs in OutboundQueue dispatch before every send.
import { describe, expect, test } from "bun:test";
import type { ForbiddenProvider, LeakCheckMessage } from "../src/outbound-queue.ts";
import { world } from "./helpers.ts";

const ALICE = "+15551110001";
const BOB = "+15551110002";
const LA = "America/Los_Angeles";
const SAM_FACT = "is going through a divorce and doesn't want anyone to know yet";

/** A Network-like provider: Sam's private fact is forbidden for everyone except Sam (BOB here). */
const provider = (calls: [string, LeakCheckMessage][] = []): ForbiddenProvider => (to, msg) => {
  calls.push([to, msg]);
  return to === BOB ? { canaries: ["XE-4029-THISTLE"] } : { forbidden: [SAM_FACT], facts: [SAM_FACT], privateVocab: ["chemotherapy"], canaries: ["XE-4029-THISTLE"] };
};

const send = async (w: ReturnType<typeof world>, text: string, o: { to?: string; kind?: "reply" | "transactional" | "compliance"; key?: string } = {}) => {
  if ((o.kind ?? "reply") === "reply") w.queue.onRecipientEngaged("sim", o.to ?? ALICE); // a reply answers an inbound
  const { record } = w.queue.enqueue({ idempotencyKey: o.key ?? "k", channel: "sim", to: o.to ?? ALICE, text, kind: o.kind ?? "reply", timeZone: LA });
  await w.queue.drain();
  return record;
};

describe("leak guard in dispatch", () => {
  test("a clean message is sent, and the provider sees the normalized recipient and the message", async () => {
    const calls: [string, LeakCheckMessage][] = [];
    const w = world({ forbiddenProvider: provider(calls) });
    const r = await send(w, "Sam is around Saturday for a climb. Want an intro?", { to: "+1 (555) 111-0001" });
    expect(r.status).toBe("sent");
    expect(w.bus.sendCalls).toBe(1);
    expect(calls).toEqual([[ALICE, { idempotencyKey: "k", text: "Sam is around Saturday for a climb. Want an intro?", kind: "reply", channel: "sim", briefId: undefined }]]);
  });

  test.each([
    ["exact private fact", "FYI Sam is going through a divorce and doesn't want anyone to know yet"],
    ["fragment", "heads up: going through a divorce"],
    ["leetspeak + reorder", "sam's d1vorce: n0body is supposed to know yet"],
    ["private vocabulary", "She's off this month for chemotherapy."],
    ["canary", "ref xe 4029 thistle"],
    ["phone", "Text Sam at (212) 555-0102"],
    ["email", "write to sam.lee@example.com"],
  ])("%s blocks the send and parks it for review", async (_label, text) => {
    const w = world({ forbiddenProvider: provider() });
    const r = await send(w, text);
    expect(r.status).toBe("parked_leak_review");
    expect(w.bus.sendCalls).toBe(0);
    expect(w.alerts).toEqual(["k:leak_blocked"]);
    expect(w.queue.leakReviewQueue()).toEqual([r]);
    // The reason is logged hashed: neither the message nor the matched value is in the history or alerts.
    const logged = JSON.stringify([r.history, r.leakReasons, w.alerts]);
    for (const word of ["divorce", "d1vorce", "chemotherapy", "thistle", "555", "sam.lee", "Sam"]) expect(logged).not.toContain(word);
    expect(r.leakReasons!.every((x) => /^(forbidden|private_vocab|canary):[0-9a-f]{8}$|^contact:[a-z_]+$/.test(x))).toBe(true);
  });

  test("the recipient's own fact (excluded by the provider) is not a leak to them", async () => {
    const w = world({ forbiddenProvider: provider() });
    const r = await send(w, "Thinking of you while you're going through a divorce. No rush on anything.", { to: BOB });
    expect(r.status).toBe("sent");
  });

  test("a parked message is never retried by drain; review can drop or approve it", async () => {
    const w = world({ forbiddenProvider: provider() });
    const a = await send(w, "she is going through a divorce", { key: "a" });
    const b = await send(w, "going through a divorce, keep it quiet", { key: "b" });
    w.clock.advance(HOURS(0.5)); // inside the reply window (a reply older than that is not sent)
    await w.queue.drain();
    expect([a.status, b.status]).toEqual(["parked_leak_review", "parked_leak_review"]);
    expect(w.queue.resolveLeakReview("a", "drop", "ops@network")).toBe(true);
    expect(a.status).toBe("dropped_after_review");
    expect(w.queue.resolveLeakReview("b", "approve")).toBe(true);
    await w.queue.drain();
    expect(b.status).toBe("sent");
    expect(w.bus.sendCalls).toBe(1);
    expect(w.queue.resolveLeakReview("b", "approve")).toBe(false); // not parked any more
    expect(w.queue.leakReviewQueue()).toEqual([]);
  });

  test("the check runs at dispatch with the current lists (a fact added while a message waits still blocks it)", async () => {
    const forbidden: string[] = [];
    const w = world({ forbiddenProvider: () => ({ forbidden }) });
    w.clock.set(Date.UTC(2026, 9, 6, 6)); // 23:00 PDT: quiet hours defer the transactional message
    const r = await send(w, "Reminder: Sam is going through a divorce, be gentle", { kind: "transactional" });
    expect(r.status).toBe("deferred_quiet_hours");
    forbidden.push(SAM_FACT);
    w.clock.set(r.nextAttemptAt);
    await w.queue.drain();
    expect(r.status).toBe("parked_leak_review");
  });

  test("a provider that throws fails closed", async () => {
    const w = world({ forbiddenProvider: () => { throw new Error("member store down"); } });
    const r = await send(w, "hi");
    expect(r.status).toBe("parked_leak_review");
    expect(r.leakReasons).toEqual(["leak_check_error"]);
    expect(JSON.stringify(r.history)).not.toContain("member store");
  });

  test("async providers are awaited", async () => {
    const w = world({ forbiddenProvider: async () => ({ forbidden: [SAM_FACT] }) });
    expect((await send(w, "Sam is going through a divorce", { key: "x" })).status).toBe("parked_leak_review");
    expect((await send(w, "See you Saturday!", { key: "y" })).status).toBe("sent");
  });
});

describe("default guard (no provider)", () => {
  test.each([
    ["phone", "call me at 415 555 0102"],
    ["spelled email", "it's sam at example dot com"],
    ["url", "sign up at bit.ly/xyz"],
    ["handle", "follow @samlee_nyc"],
    ["seeded canary", "note CANARY_MAYA_PRIVATE_recently divorced"],
    ["sim canary token", "ref QX-4821-ORCHID"],
  ])("%s is still blocked", async (_label, text) => {
    const w = world();
    const r = await send(w, text);
    expect(r.status).toBe("parked_leak_review");
    expect(w.bus.sendCalls).toBe(0);
  });

  test("ordinary messages pass", async () => {
    const w = world();
    for (const [i, text] of [
      "Hi! I'm the Network's agent (an AI). What would you like more of in your life right now?",
      "You're set with Sam: Thursday 7 PM at Pier 25 (Tribeca). I'll send a reminder that day.",
      "Thanks Remy! I'd suggest Monday 7 PM at St. Mary's Park (Mott Haven). Want me to set it up?",
    ].entries()) expect((await send(w, text, { key: `m${i}`, to: `+1555111000${i}` })).status).toBe("sent");
  });

  test("compliance copy may carry the Network's own contact details; leakAllow covers other fixed copy", async () => {
    const w = world({ leakAllow: ["Questions? help@ntwrk.love"] });
    expect((await send(w, "The Network: help at help@ntwrk.love. Reply STOP to opt out.", { kind: "compliance", key: "c" })).status).toBe("sent");
    expect((await send(w, "See you Saturday. Questions? help@ntwrk.love", { key: "r", to: BOB })).status).toBe("sent");
    // But a canary is blocked even in compliance copy.
    expect((await send(w, "Reply STOP to opt out. QX-4821-ORCHID", { kind: "compliance", key: "c2", to: "+15551110003" })).status).toBe("parked_leak_review");
  });
});

function HOURS(n: number) { return n * 3_600_000; }
