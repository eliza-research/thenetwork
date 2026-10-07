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
  confirmationFor,
  createNetworkActionFieldEvaluator,
  InMemoryNetworkStore,
  type NetworkActionProposal,
  resolveBusyVsPaused,
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
    expect(authorizeSetState({ state: "paused", until: null, evidence: "hold off on new intros" }, text, NOW))
      .toEqual({ allowed: true, state: "busy", until: null });
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
    const value: NetworkActionProposal = { action: "SET_STATE", state: "paused", until: null, evidence: "hold off on new intros" };
    const ctx = {
      runtime: {} as IAgentRuntime, message: { id: "msg-1" as UUID, content: { text } } as Memory, state: {} as State,
      senderRole: "USER", turnSignal: new AbortController().signal, value,
      parsed: { replyText: "Got it—I’ll pause new intros for this week." } as ResponseHandlerResult,
    } as ResponseHandlerFieldHandleContext<NetworkActionProposal>;
    const effect = await evaluator.handle!(ctx);
    const result = { replyText: "Got it—I’ll pause new intros for this week." } as ResponseHandlerResult;
    effect?.mutateResult?.(result);
    expect(result.replyText).toBe("Done: you're marked busy. I'll only send standout intros.");
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
      value: { action: "SET_STATE", state: "open", until: null, evidence: "keep them coming" },
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
