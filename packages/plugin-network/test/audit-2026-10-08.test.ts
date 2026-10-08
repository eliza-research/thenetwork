/**
 * Regression tests for the 2026-10-08 adversarial audit (plugin-prototypes-1, 2, 3, 4, 6, 7, 11, M2;
 * judge-evals-7). Each test failed before its fix.
 */
import type {
  HandlerOptions,
  IAgentRuntime,
  Memory,
  ResponseHandlerFieldHandleContext,
  ResponseHandlerResult,
  State,
  UUID,
} from "@elizaos/core";
import { createMockRuntime } from "@elizaos/testing";
import { describe, expect, it } from "bun:test";
import {
  authorizeSetState,
  createNetworkActionFieldEvaluator,
  createNetworkEdgePlugin,
  detectNetworkSignals,
  evidenceOk,
  InMemoryNetworkStore,
  type NetworkActionProposal,
  type NetworkMemberContext,
  type NetworkTurnAuthority,
  resolveWindow,
} from "../src/index.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const ada = (memberId = "mem_ada"): NetworkMemberContext => ({
  memberId, firstName: "Ada", city: "San Francisco", state: "open", stateUntil: null, facets: [], activeItems: [],
});

function ctx(text: string, value: NetworkActionProposal, id: string | null = "msg-1"): ResponseHandlerFieldHandleContext<NetworkActionProposal> {
  return {
    runtime: {} as IAgentRuntime,
    message: { ...(id ? { id: id as UUID } : {}), content: { text } } as Memory,
    state: {} as State,
    senderRole: "USER",
    turnSignal: new AbortController().signal,
    value,
    parsed: {} as ResponseHandlerResult,
  };
}

const proposal = (state: string, evidence: string, until: string | null = null): NetworkActionProposal =>
  ({ action: "SET_STATE", state, from: null, until, evidence });

describe("planner SET_STATE runs authz; structured mode has no planner SET_STATE (plugin-prototypes-1)", () => {
  it("structured routing registers no SET_STATE action", () => {
    const plugin = createNetworkEdgePlugin({ store: new InMemoryNetworkStore([ada()]), authority: { memberId: "mem_ada" }, routing: "structured" });
    expect(plugin.actions).toEqual([]);
  });

  it("the planner action refuses a state the member did not ask for, and past dates", async () => {
    const store = new InMemoryNetworkStore([ada()], () => NOW);
    const plugin = createNetworkEdgePlugin({ store, authority: { memberId: "mem_ada" }, now: () => NOW });
    const msg = (id: string, text: string) => ({ id: id as UUID, content: { text } }) as Memory;
    const hi = await plugin.actions![0].handler(createMockRuntime(), msg("p1", "hi"), undefined, { parameters: { state: "paused" } } as HandlerOptions);
    expect(hi.success).toBe(false);
    const past = await plugin.actions![0].handler(createMockRuntime(), msg("p2", "pause my intros"), undefined, {
      parameters: { state: "paused", until: "2025-01-01" },
    } as HandlerOptions);
    expect(past.success).toBe(false);
    expect(store.events).toHaveLength(0);
  });
});

describe("evidence must support the proposed state (plugin-prototypes-2)", () => {
  it("'hi' does not authorize paused, and a negated cue does not either", () => {
    expect(authorizeSetState({ state: "paused", until: null, evidence: "hi" }, "hi", NOW)).toEqual({ allowed: false, reason: "evidence does not support state" });
    expect(authorizeSetState({ state: "paused", until: null, evidence: "don't pause my intros" }, "don't pause my intros", NOW))
      .toEqual({ allowed: false, reason: "evidence does not support state" });
    expect(authorizeSetState({ state: "busy", until: null, evidence: "not busy anymore" }, "I'm not busy anymore", NOW))
      .toEqual({ allowed: false, reason: "evidence does not support state" });
    expect(authorizeSetState({ state: "paused", until: null, evidence: "please don't message me" }, "please don't message me", NOW))
      .toMatchObject({ allowed: true, state: "paused" });
  });
});

describe("dates resolve on the member's local day (plugin-prototypes-3)", () => {
  it("7pm in California on Oct 7 is still Oct 7: 'till the 8th' is tomorrow, not next month", () => {
    const evening = new Date("2026-10-08T02:00:00.000Z");
    const text = "in austin till the 8th";
    expect(authorizeSetState({ state: "traveling", until: null, evidence: text }, text, evening, { timeZone: "America/Los_Angeles" }))
      .toMatchObject({ allowed: true, until: "2026-10-08T00:00:00.000Z" });
  });
});

describe("idempotency keys are scoped by member and app (plugin-prototypes-4, judge-evals-7)", () => {
  it("the same message id from two members (or two apps) writes two events, never a replay", async () => {
    const store = new InMemoryNetworkStore([ada("mem_ada"), ada("mem_eve")], () => NOW);
    const run = (authority: NetworkTurnAuthority) =>
      createNetworkActionFieldEvaluator({ store, authority, now: () => NOW }).handle!(ctx("pause my intros", proposal("paused", "pause my intros")));
    await run({ memberId: "mem_ada", app: "ntwrk.love" });
    await run({ memberId: "mem_eve", app: "ntwrk.love" });
    expect((await store.getMemberContext("mem_eve"))?.state).toBe("paused");
    expect(store.events.map((e) => e.memberId)).toEqual(["mem_ada", "mem_eve"]);
  });

  it("the store refuses a reused key with a different payload", async () => {
    const store = new InMemoryNetworkStore([ada()], () => NOW);
    await store.setState({ memberId: "mem_ada", state: "paused", until: null, note: null, idempotencyKey: "k" });
    await expect(store.setState({ memberId: "mem_ada", state: "open", until: null, note: null, idempotencyKey: "k" })).rejects.toThrow("different payload");
  });
});

describe("quoted, reported and forwarded text is not the member's own (plugin-prototypes-6)", () => {
  it("single quotes, 'X said', and forwarded blocks", () => {
    expect(evidenceOk("pause all your intros", "my friend said 'pause all your intros' lol").ok).toBe(false);
    expect(evidenceOk("pause everything", "my boss said pause everything, but no").ok).toBe(false);
    expect(evidenceOk("pause my intros", "fyi\n---------- Forwarded message ---------\nFrom: Sam\npause my intros").ok).toBe(false);
    expect(evidenceOk("pause my intros", "I'm slammed, don't wait, pause my intros").ok).toBe(true);
  });
});

describe("'may' is not always May (plugin-prototypes-7)", () => {
  it("'I may be away until friday' keeps friday; 'until I may feel better' is no date", () => {
    const text = "I may be away until friday";
    expect(authorizeSetState({ state: "traveling", until: null, evidence: "away until friday" }, text, NOW))
      .toMatchObject({ allowed: true, until: "2026-10-09T00:00:00.000Z" });
    expect(resolveWindow("pause until I may feel better", NOW)).toEqual({ from: null, until: null });
    expect(resolveWindow("pause until may", NOW).until).toBe("2027-05-01T00:00:00.000Z");
  });
});

describe("structured route without a message id fails closed (plugin-prototypes-M2)", () => {
  it("returns a non-applied direct reply instead of falling through to the planner", async () => {
    const store = new InMemoryNetworkStore([ada()], () => NOW);
    const effect = await createNetworkActionFieldEvaluator({ store, authority: { memberId: "mem_ada" }, now: () => NOW })
      .handle!(ctx("pause my intros", proposal("paused", "pause my intros"), null));
    const result = {} as ResponseHandlerResult;
    effect?.mutateResult?.(result);
    expect(effect?.preempt?.mode).toBe("direct-reply");
    expect(result.replyEffectStatus).toBe("non_applied");
    expect(store.events).toHaveLength(0);
  });
});

describe("the decision layer reads today per call; the member context shows from (plugin-prototypes-11)", () => {
  it("description follows the clock; MEMBER_CONTEXT renders stateFrom", async () => {
    let now = NOW;
    const evaluator = createNetworkActionFieldEvaluator({ store: new InMemoryNetworkStore([ada()]), authority: { memberId: "mem_ada" }, now: () => now });
    expect(evaluator.description).toContain("Today is 2026-10-06");
    now = new Date("2026-10-09T12:00:00.000Z");
    expect(evaluator.description).toContain("Today is 2026-10-09");
    const store = new InMemoryNetworkStore([{ ...ada(), state: "traveling", stateFrom: "2026-10-12T00:00:00.000Z", stateUntil: "2026-10-15T00:00:00.000Z" }]);
    const plugin = createNetworkEdgePlugin({ store, authority: { memberId: "mem_ada" } });
    const r = await plugin.providers![0].get(createMockRuntime(), { content: { text: "hi" } } as Memory, {} as State);
    expect(r.text).toContain("State: traveling from 2026-10-12T00:00:00.000Z until 2026-10-15T00:00:00.000Z");
  });
});

describe("signals come from the member's own, non-negated words (plugin-prototypes-8)", () => {
  it("quoted opt-outs and negated safety words are not signals", () => {
    expect(detectNetworkSignals('my friend said "unsubscribe" lol')).toEqual([]);
    expect(detectNetworkSignals("he wasn't creepy at all, it was fun")).toEqual([]);
    expect(detectNetworkSignals("please don't remove me")).toEqual([]);
    expect(detectNetworkSignals("he made me uncomfortable").map((s) => s.kind)).toEqual(["safety_concern"]);
  });
});
