// The judge block: regression gates for the simulator's judge (packages/sim/src/judge/metrics.ts) on
// small hand-written run logs. Each gate gives the judge a log where the system under test did a wrong
// thing, and the judge must see it (docs/research/state-machines/sim.md). No world run, no model call.
import { DAY, type MemberId, type RunRecord } from "../../packages/core/src/index.ts";
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
import { runScenario, StubNetwork, type NetworkUnderTest, type Scenario, type ScenarioPersonaSpec } from "../../packages/sim/src/index.ts";
import { Block, expect } from "./gate.ts";

/** A fixed start time. */
const T0 = 1_791_903_600_000;

const persona = (id: MemberId, name: string, age = 30): RunRecord => ({
  t: T0, type: "persona",
  persona: { id, name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: age, claimedAge: age, quietHours: [0, 0], romanceOptIn: false },
});

/** Two adults (Ana, Ben) who joined at T0. */
function base(): RunRecord[] {
  return [
    { t: T0, type: "run_start", runId: "judge-gate", seed: 0, config: {}, start: T0 },
    persona("a", "Ana Lindqvist"), persona("b", "Ben Okafor"),
    { t: T0, type: "join", memberId: "a" }, { t: T0, type: "join", memberId: "b" },
  ];
}

let seq = 0;
const out = (t: number, to: MemberId, meta: Record<string, unknown>, body = "A quick note about Thursday. Reply STOP to pause."): RunRecord =>
  ({ t, type: "message", msg: { id: `m${++seq}`, ts: t, direction: "outbound", memberId: to, body, status: "delivered", meta: { proactive: true, ...meta } } });

/** Five more proactive nudges to `to` about opportunity `opp`, one a day from day 2. */
const nudges = (to: MemberId, opp: string): RunRecord[] =>
  [2, 3, 4, 5, 6].map(d => out(T0 + d * DAY, to, { type: "reminder", proposalId: opp }));

export async function judgeBlock(b: Block): Promise<void> {
  // SD-188 (sim S-01): the persona drew "ignore" and sent nothing. Its decision record still says
  // decision "accept". An unsent accept is not consent, so the nudges after it stay proactive.
  await b.run("judge: an ignored proposal (intent ignore, decision accept) is not consent", () => {
    const run = (intent: string) => {
      const ask = out(T0 + DAY, "a", { type: "proposal", proposalId: "p1" }, "Want to grab a coffee this week? Reply STOP to pause.");
      const dec: RunRecord = { t: T0 + DAY, type: "decision", memberId: "a", messageId: (ask as { msg: { id: string } }).msg.id, messageType: "proposal", intent, decision: "accept", proposalId: "p1", delayMs: 0 };
      return computeMetrics([...base(), ask, dec, ...nudges("a", "p1")]).invariants.byRule;
    };
    expect(run("ignore").two_unanswered ?? 0).toBeGreaterThan(0);
    // Control: a sent accept exempts the logistics of that opportunity.
    expect(run("accept").two_unanswered ?? 0).toBe(0);
  });
  // SD-190 (sim S-13): a plan probe carries meta.plan.planId (core PlanMeta). The judge read plan.id, so a
  // plan probe was about no opportunity, and a plan probe to a declared minor was not a minor contact.
  await b.run("judge: a plan probe to a declared minor is a minor contact", () => {
    const recs: RunRecord[] = [...base(), persona("k", "Kai Moreno", 16), { t: T0, type: "join", memberId: "k" },
      out(T0 + DAY, "k", { type: "plan_probe", plan: { planId: "plan-1", activity: "bouldering" } }, "Up for bouldering Thursday evening with 3 others? Reply STOP to pause.")];
    expect(computeMetrics(recs).safety.minorContacts).toBe(1);
  });
  // SD-193 (sim S-05): the judge knew a block only from the Network's own record (ctx.recordBlock). A Network
  // that did not read "block Ben Okafor" left no record, so it could propose the pair again with no violation.
  await b.run("judge: a Network that ignores a member's block is blamed when it proposes the pair", async () => {
    const adult = (ref: string, name: string, hour: number): ScenarioPersonaSpec => ({
      ref, name, age: 31, city: "sf", homeArea: "Noe Valley", interests: ["hiking", "coffee", "board_games"], desires: ["new_friends"],
      capacity: 0.95, responsiveness: { latencyMedianMin: 10, ignoreProb: 0 }, join: { day: 0, hour },
    });
    const s = {
      name: "ignored-block", description: "Ana blocks Ben before the Network proposes anyone.", seed: 71, days: 6, stub: { introRate: 1 },
      personas: [adult("ana", "Ana Lindqvist", 9), adult("ben", "Ben Okafor", 10)],
      actions: [{ at: { day: 0, hour: 12 }, do: "block", persona: "ana", other: "ben" }], expectations: [],
    } as Scenario;
    // The push stub with its block parser turned off: it never hears the block.
    const deaf = (): NetworkUnderTest => {
      const stub = new StubNetwork({ seed: 71, introRate: 1 });
      return { name: "stub-ignores-blocks", init: c => stub.init(c), tick: t => stub.tick(t), submitProposal: p => stub.submitProposal(p),
        onInbound: m => (/^\s*block\b/i.test(m.body) ? undefined : stub.onInbound(m)) };
    };
    const ignored = await runScenario(s, { network: deaf });
    expect(ignored.world.records.some(r => r.type === "proposal" && r.source === "network")).toBe(true);
    expect(ignored.world.metrics.invariants.byRule.blocked_pair_proposed ?? 0).toBeGreaterThan(0);
    // Control: the stub that reads the block keeps the pair apart.
    const kept = await runScenario(s, { network: () => new StubNetwork({ seed: 71, introRate: 1 }) });
    expect(kept.world.records.some(r => r.type === "block")).toBe(true);
    expect(kept.world.metrics.invariants.byRule.blocked_pair_proposed ?? 0).toBe(0);
  });
  // SD-399 (sim S-22, S-23): ConsentNetwork logs age_resolved as { memberId, minor } with no age. The judge read d.age,
  // so an adult who gave an age after age_unknown stayed a minor. A minor_signal is never cleared (the lowest age wins).
  await b.run("judge: an age_unknown flag clears on an adult age_resolved; a minor_signal never clears", () => {
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    const probe = (who: MemberId): RunRecord => log(T0 + DAY, "probe_sent", { memberId: who });
    const resolved = (flag: string) => computeMetrics([...base(), log(T0, flag, { memberId: "a" }),
      log(T0 + 1, "age_resolved", { memberId: "a", minor: false }), probe("a")]).safety.minorContacts;
    expect(resolved("age_unknown")).toBe(0);
    expect(resolved("minor_signal")).toBe(1);
    // Control: an age_unknown that stays unresolved keeps the member a minor.
    expect(computeMetrics([...base(), log(T0, "age_unknown", { memberId: "a" }), probe("a")]).safety.minorContacts).toBe(1);
  });
}
