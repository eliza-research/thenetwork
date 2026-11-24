import { describe, expect, test } from "vitest";
import { DAY, HOUR, type MemberId, type RunRecord } from "@thenetwork/core";
import { computeMetrics } from "../src/judge/metrics.ts";
import { StubNetwork, evaluateExpectations, runScenario, type NetworkUnderTest, type Scenario, type ScenarioPersonaSpec } from "../src/index.ts";
import { join } from "node:path";
import { fileAt } from "../../core/src/runtime/files.ts";

const T0 = Date.UTC(2026, 9, 9, 16);
const persona = (id: MemberId, name = `Pat ${id}`, age = 30): RunRecord => ({
  t: T0, type: "persona",
  persona: { id, name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: age, claimedAge: age, quietHours: [0, 0], romanceOptIn: false, state: "open" },
});
const base = (): RunRecord[] => [
  { t: T0, type: "run_start", runId: "judge-gate", seed: 0, config: {}, start: T0 },
  persona("a", "Ana Lindqvist"), persona("b", "Ben Okafor"),
  { t: T0, type: "join", memberId: "a" }, { t: T0, type: "join", memberId: "b" },
];
let seq = 0;
const out = (t: number, to: MemberId, meta: Record<string, unknown>, body = "A quick note about Thursday. Reply STOP to pause."): RunRecord =>
  ({ t, type: "message", msg: { id: `m${++seq}`, ts: t, direction: "outbound", memberId: to, body, status: "delivered", meta: { proactive: true, ...meta } } });

describe("simulator judge and scenario regressions", () => {
  test("person_cap: a fourth proactive message in 24 hours is a violation; spread over days is not", () => {
    const within = computeMetrics([persona("a"), ...[0, 1, 2, 3].map(i => out(T0 + i * HOUR, "a", {}))], {});
    expect(within.invariants.byRule.person_cap).toBe(1);
    const spread = computeMetrics([persona("a"), ...[0, 1, 2, 3].map(i => out(T0 + i * 9 * HOUR, "a", {}))], {});
    expect(spread.invariants.byRule.person_cap ?? 0).toBe(0);
  });

  test("minor_reported and age_resolved: minor signals stay permanent; age_unknown clears on adult age_resolved", () => {
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    const contact = (id: string, ts: number): RunRecord => ({ t: ts, type: "proposal", source: "network", proposal: { id: "p1", participants: [id, "b"], type: "intro" } as never, oracle: {} as never });
    const reported = computeMetrics([persona("a"), persona("b"), log(T0, "minor_reported", { memberId: "a", by: "b" }), contact("a", T0 + DAY)], {});
    expect(reported.safety.minorContacts).toBeGreaterThan(0);

    const resolved = (flag: string, minor: boolean) => computeMetrics([
      ...base(), log(T0, flag, { memberId: "a" }),
      log(T0 + 1, "age_resolved", { memberId: "a", minor }),
      log(T0 + 2, "review_decision", { oppId: "o1", decision: "approve", reviewer: "r" }),
      log(T0 + 3, "probe_started", { oppId: "o1", proposal: { id: "o1", participants: ["a", "b"], alternates: [] } }),
      log(T0 + 4, "probe_sent", { oppId: "o1", memberId: "a" }),
    ], { requireReview: true }).safety.minorContacts;
    expect(resolved("age_unknown", false)).toBe(0);
    expect(resolved("age_unknown", true)).toBe(2);
    expect(resolved("minor_signal", false)).toBe(2);
  });

  test("SD-188 and SD-190: ignored proposals are not consent and planId probes to minors count", () => {
    const run = (intent: string) => {
      const ask = out(T0 + DAY, "a", { type: "proposal", proposalId: "p1" }, "Want to grab a coffee this week? Reply STOP to pause.");
      const dec: RunRecord = { t: T0 + DAY, type: "decision", memberId: "a", messageId: (ask as { msg: { id: string } }).msg.id, messageType: "proposal", intent, decision: "accept", proposalId: "p1", delayMs: 0 };
      const nudges = [2, 3, 4, 5, 6].map(d => out(T0 + d * DAY, "a", { type: "reminder", proposalId: "p1" }));
      return computeMetrics([...base(), ask, dec, ...nudges]).invariants.byRule;
    };
    expect(run("ignore").two_unanswered ?? 0).toBeGreaterThan(0);
    expect(run("accept").two_unanswered ?? 0).toBe(0);

    const planProbe: RunRecord[] = [...base(), persona("k", "Kai Moreno", 16), { t: T0, type: "join", memberId: "k" },
      out(T0 + DAY, "k", { type: "plan_probe", plan: { planId: "plan-1", activity: "bouldering" } }, "Up for bouldering Thursday evening with 3 others? Reply STOP to pause.")];
    expect(computeMetrics(planProbe).safety.minorContacts).toBe(1);
  });

  test("SD-193, SD-194, and mistyped metric path: block_intent, cancelled meetings, and missing paths fail closed", async () => {
    const adult = (ref: string, name: string, hour: number): ScenarioPersonaSpec => ({
      ref, name, age: 31, city: "sf", homeArea: "Noe Valley", interests: ["hiking", "coffee", "board_games"], desires: ["new_friends"],
      capacity: 0.95, responsiveness: { latencyMedianMin: 10, ignoreProb: 0 }, join: { day: 0, hour },
    });
    const s = {
      name: "ignored-block", description: "Ana blocks Ben before the Network proposes anyone.", seed: 71, days: 6, stub: { introRate: 1 },
      personas: [adult("ana", "Ana Lindqvist", 9), adult("ben", "Ben Okafor", 10)],
      actions: [{ at: { day: 0, hour: 12 }, do: "block", persona: "ana", other: "ben" }], expectations: [],
    } as Scenario;
    const deaf = (): NetworkUnderTest => {
      const stub = new StubNetwork({ seed: 71, introRate: 1 });
      return { name: "stub-ignores-blocks", init: c => stub.init(c), tick: t => stub.tick(t), submitProposal: p => stub.submitProposal(p),
        onInbound: m => (/^\s*block\b/i.test(m.body) ? undefined : stub.onInbound(m)) };
    };
    const ignored = await runScenario(s, { network: deaf });
    expect(ignored.world.records.some(r => r.type === "proposal" && r.source === "network")).toBe(true);
    expect(ignored.world.metrics.invariants.byRule.blocked_pair_proposed ?? 0).toBeGreaterThan(0);

    const kept = await runScenario(s, { network: () => new StubNetwork({ seed: 71, introRate: 1 }) });
    expect(kept.world.records.some(r => r.type === "block")).toBe(true);
    expect(kept.world.metrics.invariants.byRule.blocked_pair_proposed ?? 0).toBe(0);

    const blockAfter = await fileAt(join(import.meta.dirname, "../scenarios/block-after-schedule.json")).json() as Scenario;
    const res = await runScenario(blockAfter, { network: sc => new StubNetwork({ seed: blockAfter.seed, ...sc.stub }) });
    expect(res.results.every(r => r.status === "pass")).toBe(true);
    expect(res.world.metrics.meetings.held).toBe(0);

    const typo = evaluateExpectations(
      { ...blockAfter, expectations: [{ check: "metric", path: "meetings.nonexistent", op: "==", value: 0 }] },
      res.world,
      "stub",
    );
    expect(typo[0]?.status).toBe("fail");
  });

  test("fairness: a judge-flagged minor is not counted as an adult with zero proposals", () => {
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    const contact = (id: string, ts: number): RunRecord => ({ t: ts, type: "proposal", source: "network", proposal: { id: "p1", participants: [id], type: "intro" } as never, oracle: {} as never });
    const run = computeMetrics([
      ...base(),
      log(T0, "minor_signal", { memberId: "b" }),
      contact("a", T0 + DAY),
    ], {});
    expect(run.fairness.zeroProposalShare).toBe(0);
    // The flagged member is still not a declared minor: run.minors counts
    // declared minors only, and must stay 0 here.
    expect(run.run.minors).toBe(0);
  });
});
