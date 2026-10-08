/**
 * Fixes from the 2026-10-07 live routing eval (prototypes/poc-eliza-fit/routing-eval.jsonl):
 * busy over-read as paused, future-tense model replies after an executed change,
 * and an event written for a no-op state change.
 */
import type {
  IAgentRuntime,
  Memory,
  ResponseHandlerFieldHandleContext,
  ResponseHandlerResult,
  State,
  UUID,
} from "@elizaos/core";
import { describe, expect, it } from "bun:test";
import {
  authorizeSetState,
  checkDates,
  confirmationFor,
  createNetworkActionFieldEvaluator,
  InMemoryNetworkStore,
  type NetworkActionProposal,
  resolveBusyVsPaused,
  resolveWindow,
} from "../src/index.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const store = (state: "open" | "busy" | "paused" = "open", stateUntil: string | null = null) =>
  new InMemoryNetworkStore([
    { memberId: "mem_ada", firstName: "Ada", city: "San Francisco", state, stateUntil, facets: [], activeItems: [] },
  ]);

describe("busy vs paused", () => {
  it("downgrades a proposed pause to busy for every busy message the model mislabeled", () => {
    for (const text of [
      "super busy this week, hold off on new intros",
      "can you go easy on the intros for a bit, swamped",
      "slammed with a launch until friday, fewer messages pls",
      "work is crazy rn, only ping me if it's really good",
    ]) expect(resolveBusyVsPaused("paused", text)).toBe("busy");
  });

  it("keeps an explicit pause, even with busy words", () => {
    for (const text of [
      "pause my network intros until oct 20, work is insane",
      "can you put everything on hold for two weeks",
      "taking a break from the network until december",
      "swamped, please don't message me until monday",
    ]) expect(resolveBusyVsPaused("paused", text)).toBe("paused");
  });

  it("ignores busy words inside quoted third-party text", () => {
    expect(resolveBusyVsPaused("paused", 'pause everything. my boss said "you\'re too busy"')).toBe("paused");
  });

  it("never changes other states", () => {
    expect(resolveBusyVsPaused("open", "super busy")).toBe("open");
    expect(resolveBusyVsPaused("traveling", "swamped in NYC")).toBe("traveling");
  });

  it("is applied by authorizeSetState", () => {
    const text = "super busy this week, hold off on new intros";
    expect(authorizeSetState({ state: "paused", until: "2026-10-11", evidence: "hold off on new intros" }, text, NOW))
      .toEqual({ allowed: true, state: "busy", from: null, until: "2026-10-11T00:00:00.000Z" });
  });
});

describe("confirmation from what executed", () => {
  it("is past tense and states the executed change", () => {
    const base = { unchanged: false, until: "2026-10-20T00:00:00.000Z" };
    expect(confirmationFor({ ...base, current: "paused" })).toBe("Done: your Network intros are paused until Oct 20.");
    expect(confirmationFor({ ...base, current: "busy" })).toBe("Done: you're marked busy until Oct 20. I'll only send standout intros.");
    expect(confirmationFor({ ...base, current: "traveling" })).toContain("Done: you're marked as traveling until Oct 20.");
    expect(confirmationFor({ unchanged: false, until: null, current: "open" })).toBe("Done: you're open to intros again.");
    for (const s of ["paused", "busy", "traveling", "open"] as const)
      expect(confirmationFor({ ...base, current: s })).not.toMatch(/\bI'll (pause|mark|set|turn|resume)/);
  });

  it("says nothing changed for a no-op", () => {
    expect(confirmationFor({ unchanged: true, until: null, current: "open" })).toBe("You're already open to intros, so nothing to change.");
  });

  it("the field evaluator replaces the model's reply with it", async () => {
    const s = store();
    const evaluator = createNetworkActionFieldEvaluator({ store: s, authority: { memberId: "mem_ada" }, now: () => NOW });
    const text = "super busy this week, hold off on new intros";
    const value: NetworkActionProposal = { action: "SET_STATE", state: "paused", from: null, until: "2026-10-11", evidence: "hold off on new intros" };
    const ctx = {
      runtime: {} as IAgentRuntime, message: { id: "msg-1" as UUID, content: { text } } as Memory, state: {} as State,
      senderRole: "USER", turnSignal: new AbortController().signal, value,
      parsed: { replyText: "Got it—I’ll pause new intros for this week." } as ResponseHandlerResult,
    } as ResponseHandlerFieldHandleContext<NetworkActionProposal>;
    const effect = await evaluator.handle!(ctx);
    const result = { replyText: "Got it—I’ll pause new intros for this week." } as ResponseHandlerResult;
    effect?.mutateResult?.(result);
    expect(result.replyText).toBe("Done: you're marked busy until Oct 11. I'll only send standout intros.");
    expect(result.replyEffectStatus).toBe("applied");
    expect((await s.getMemberContext("mem_ada"))?.state).toBe("busy");
  });
});

describe("no-op state change", () => {
  it("writes no event when the member is already in that state", async () => {
    const s = store("open");
    const exec = await s.setState({ memberId: "mem_ada", state: "open", until: null, note: null, idempotencyKey: "k1" });
    expect(exec.unchanged).toBe(true);
    expect(exec.eventId).toBeNull();
    expect(s.events).toHaveLength(0);
  });

  it("still writes when only the end date changes", async () => {
    const s = store("paused", "2026-10-20T00:00:00.000Z");
    const exec = await s.setState({ memberId: "mem_ada", state: "paused", until: "2026-10-27T00:00:00.000Z", note: null, idempotencyKey: "k2" });
    expect(exec.unchanged).toBe(false);
    expect(s.events).toHaveLength(1);
  });

  it("the 'my friend said pause … keep them coming' eval case is a no-op for an open member", async () => {
    const s = store("open");
    const evaluator = createNetworkActionFieldEvaluator({ store: s, authority: { memberId: "mem_ada" }, now: () => NOW });
    const text = "my friend said 'pause all your intros' but I'm good, keep them coming";
    const ctx = {
      runtime: {} as IAgentRuntime, message: { id: "msg-2" as UUID, content: { text } } as Memory, state: {} as State,
      senderRole: "USER", turnSignal: new AbortController().signal,
      value: { action: "SET_STATE", state: "open", from: null, until: null, evidence: "keep them coming" },
      parsed: { replyText: "Got it—I’ll keep them coming." } as ResponseHandlerResult,
    } as ResponseHandlerFieldHandleContext<NetworkActionProposal>;
    const effect = await evaluator.handle!(ctx);
    const result = {} as ResponseHandlerResult;
    effect?.mutateResult?.(result);
    expect(s.events).toHaveLength(0);
    expect(result.replyText).toBe("You're already open to intros, so nothing to change.");
    expect(result.replyEffectStatus).toBe("non_applied");
  });
});

describe("presence windows (future travel)", () => {
  const text = "I'll be in London from next monday until the 15th";
  it("authorizes a future window and keeps from < until", () => {
    expect(authorizeSetState({ state: "traveling", from: "2026-10-12", until: "2026-10-15", evidence: "in London from next monday until the 15th" }, text, NOW))
      .toEqual({ allowed: true, state: "traveling", from: "2026-10-12T00:00:00.000Z", until: "2026-10-15T00:00:00.000Z" });
    // With no dates in the member's words, a backwards model window is refused...
    expect(authorizeSetState({ state: "traveling", from: "2026-10-16", until: "2026-10-15", evidence: "in London" }, "I'll be in London for a bit", NOW))
      .toEqual({ allowed: false, reason: "until is not after from" });
    // ...and when the member stated dates, those replace the model's.
    expect(authorizeSetState({ state: "traveling", from: "2026-10-16", until: "2026-10-15", evidence: "in London" }, text, NOW))
      .toMatchObject({ allowed: true, from: "2026-10-12T00:00:00.000Z", until: "2026-10-15T00:00:00.000Z" });
    expect(authorizeSetState({ state: "traveling", from: "2026-09-01", until: null, evidence: "in London" }, text, NOW))
      .toEqual({ allowed: false, reason: "from is in the past" });
  });

  it("treats a window starting today as now", () => {
    const d = authorizeSetState({ state: "traveling", from: "2026-10-06", until: "2026-10-09", evidence: "in London" }, "in London till the 9th", NOW);
    expect(d).toMatchObject({ allowed: true, from: null });
  });

  it("stores the window, confirms it, and treats a repeat as a no-op", async () => {
    const s = store();
    const evaluator = createNetworkActionFieldEvaluator({ store: s, authority: { memberId: "mem_ada" }, now: () => NOW });
    const value: NetworkActionProposal = { action: "SET_STATE", state: "traveling", from: "2026-10-12", until: "2026-10-15", evidence: "in London from next monday until the 15th" };
    const ctx = (id: string) => ({
      runtime: {} as IAgentRuntime, message: { id: id as UUID, content: { text } } as Memory, state: {} as State,
      senderRole: "USER", turnSignal: new AbortController().signal, value, parsed: {} as ResponseHandlerResult,
    }) as ResponseHandlerFieldHandleContext<NetworkActionProposal>;
    const result = {} as ResponseHandlerResult;
    (await evaluator.handle!(ctx("msg-w1")))?.mutateResult?.(result);
    expect(result.replyText).toBe("Done: you're marked as traveling from Oct 12 until Oct 15. Intros are on hold while you're away.");
    expect(await s.getMemberContext("mem_ada")).toMatchObject({ state: "traveling", stateFrom: "2026-10-12T00:00:00.000Z", stateUntil: "2026-10-15T00:00:00.000Z" });
    const again = {} as ResponseHandlerResult;
    (await evaluator.handle!(ctx("msg-w2")))?.mutateResult?.(again);
    expect(again.replyEffectStatus).toBe("non_applied");
    expect(s.events).toHaveLength(1);
  });
});

describe("date guards", () => {
  const ok = (state: "paused" | "busy" | "traveling", from: string | null, until: string | null, text: string) =>
    checkDates(state, from ? `${from}T00:00:00.000Z` : null, until ? `${until}T00:00:00.000Z` : null, text);

  it("refuses an indefinite state when the member gave an end", () => {
    for (const text of [
      "stop the intros until after new years", "in austin till the 25th", "taking a break from the network until december",
      "can you put everything on hold for two weeks", "headed to lisbon, back on the 12th", "busy through next tuesday",
      "out of town for work all next week", "super busy this week, hold off on new intros",
    ]) expect(ok("paused", null, null, text)).toEqual({ ok: false, reason: "missing until" });
  });

  it("allows an open-ended state when the member gave no end", () => {
    expect(ok("paused", null, null, "please pause my intros")).toEqual({ ok: true });
    expect(ok("busy", null, null, "work is crazy rn, only ping me if it's really good")).toEqual({ ok: true });
  });

  it("accepts dates that match the member's day numbers and months", () => {
    expect(ok("traveling", null, "2026-10-25", "in austin till the 25th")).toEqual({ ok: true });
    expect(ok("traveling", "2026-10-12", "2026-10-15", "I'll be in London from next monday until the 15th")).toEqual({ ok: true });
    expect(ok("paused", null, "2026-12-01", "taking a break from the network until december")).toEqual({ ok: true });
    expect(ok("paused", null, "2027-01-01", "taking a break from the network until december")).toEqual({ ok: true });
    expect(ok("paused", null, "2026-10-20", "pause my network intros until oct 20, work is insane")).toEqual({ ok: true });
  });

  it("refuses dates that contradict the member's words", () => {
    expect(ok("traveling", null, "2026-10-26", "in austin till the 25th")).toEqual({ ok: false, reason: "date mismatch" });
    expect(ok("paused", null, "2026-11-01", "taking a break from the network until december")).toEqual({ ok: false, reason: "date mismatch" });
    expect(ok("paused", null, "2026-11-20", "pause my network intros until oct 20")).toEqual({ ok: false, reason: "date mismatch" });
  });

  it("ignores dates inside quoted third-party text", () => {
    expect(ok("paused", null, null, 'pause my intros. my boss said "you\'re out until the 30th"')).toEqual({ ok: true });
  });

  it("the agent asks a specific question instead of writing an indefinite pause", async () => {
    const s = store();
    const evaluator = createNetworkActionFieldEvaluator({ store: s, authority: { memberId: "mem_ada" }, now: () => NOW });
    const text = "stop the intros until things calm down";
    const ctx = {
      runtime: {} as IAgentRuntime, message: { id: "msg-ny" as UUID, content: { text } } as Memory, state: {} as State,
      senderRole: "USER", turnSignal: new AbortController().signal,
      value: { action: "SET_STATE", state: "paused", from: null, until: null, evidence: "stop the intros" },
      parsed: {} as ResponseHandlerResult,
    } as ResponseHandlerFieldHandleContext<NetworkActionProposal>;
    const result = {} as ResponseHandlerResult;
    (await evaluator.handle!(ctx))?.mutateResult?.(result);
    expect(result.replyText).toBe('Until when should I pause intros? A date works, like "until Oct 20".');
    expect(result.replyEffectStatus).toBe("non_applied");
    expect(s.events).toHaveLength(0);
  });
});

describe("stated dates are resolved in code", () => {
  const NOW2 = new Date("2026-10-07T15:00:00.000Z"); // a Wednesday
  const cases: Array<[string, string | null, string, string]> = [
    ["pause my network intros until oct 20, work is insane", null, "2026-10-20", "paused"],
    ["can you put everything on hold for two weeks", null, "2026-10-21", "paused"],
    ["taking a break from the network until december", null, "2026-12-01", "paused"],
    ["stop the intros until after new years", null, "2027-01-02", "paused"],
    ["in austin till the 25th", null, "2026-10-25", "traveling"],
    ["I'll be in London from next monday until the 15th", "2026-10-12", "2026-10-15", "traveling"],
    ["out of town for work all next week", "2026-10-12", "2026-10-18", "traveling"],
    ["slammed with a launch until friday, fewer messages pls", null, "2026-10-09", "busy"],
    ["super busy this week, hold off on new intros", null, "2026-10-11", "busy"],
    ["heading to Lisbon for a couple weeks, back on the 12th", null, "2026-10-12", "traveling"],
    ["busy through next tuesday", null, "2026-10-13", "busy"],
    ["I'm traveling to New York until November 3", null, "2026-11-03", "traveling"],
    ["on vacation thru 11/2", null, "2026-11-02", "traveling"],
  ];
  it("resolves every eval phrasing, regardless of what the model proposed", () => {
    for (const [text, from, until, state] of cases) {
      const w = resolveWindow(text, NOW2);
      expect({ text, from: w.from?.slice(0, 10) ?? null, until: w.until?.slice(0, 10) ?? null }).toEqual({ text, from, until });
      // A model proposal with no dates still commits the stated window.
      const d = authorizeSetState({ state, from: null, until: null, evidence: text }, text, NOW2);
      expect(d).toMatchObject({ allowed: true, until: `${until}T00:00:00.000Z` });
    }
  });
  it("finds no dates where none were stated", () => {
    for (const text of ["pls dont send me anyone for a while, need some me time", "work is crazy rn, only ping me if it's really good", "I'm back, open to intros again"])
      expect(resolveWindow(text, NOW2)).toEqual({ from: null, until: null });
  });
});
