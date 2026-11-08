// The judge block: regression gates for the simulator's judge (packages/sim/src/judge/metrics.ts) on
// small hand-written run logs. Each gate gives the judge a log where the system under test did a wrong
// thing, and the judge must see it (docs/research/state-machines/sim.md). No world run, no model call.
import { DAY, type MemberId, type RunRecord } from "../../packages/core/src/index.ts";
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
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
}
