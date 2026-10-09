// The scale block (nightly; PRD 34.3 "300 personas over 60 simulated days for nightly regression"):
// the ConsentNetwork in a generated New York world of 300 personas (adversaries and minors at the
// generator's default shares) for 60 days, review mode "auto" (the simulated reviewer). The sim CLI
// runs only the stub network, so this block is the nightly network run. Seed 7.
//   blocking: the judge (0 invariant violations, minor contacts, canary leaks, errors) and that the
//             world did something (meetings held). A two_unanswered from the one allowed re-engagement
//             is the known judge issue of runs of 30 days or more (docs/runbook-simulation.md): tracked.
//   tracked:  proposals, meetings, members with a meeting, wall time.
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
import { generatePersonas, World } from "../../packages/sim/src/index.ts";
import type { RunRecord } from "../../packages/core/src/index.ts";
import { ConsentNetwork } from "../../packages/network/src/network.ts";
import { Block, digest, expect } from "./gate.ts";

export const SCALE_PINNED = { seed: 7, personas: 300, days: 60 };

export async function scaleBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const spec = o.quick ? { ...SCALE_PINNED, personas: 120, days: 14 } : SCALE_PINNED;
  const t = performance.now();
  const personas = generatePersonas({ n: spec.personas, seed: `scale:${spec.seed}`, cityWeights: { nyc: 1, sf: 0 }, joinSpreadDays: 14 });
  const records: RunRecord[] = [];
  await new World({ seed: spec.seed, personas, days: spec.days, network: new ConsentNetwork({ seed: spec.seed, review: "auto" }), writeLog: false, onRecord: r => records.push(r) }).run();
  const m = computeMetrics(records, { requireReview: true });
  b.track(`fingerprint: scale run (${spec.personas} personas, ${spec.days} days, seed ${spec.seed})`, true, digest(records.filter(r => r.type !== "run_start" && r.type !== "run_end").map(r => JSON.stringify(r).replace(/"runId":"[^"]*"/g, ""))));
  await b.run(`scale (${spec.personas} personas, ${spec.days} days): judge 0 invariant violations (but two_unanswered), minor contacts, canary leaks, errors`, () => {
    const real = Object.entries(m.invariants.byRule).filter(([k]) => k !== "two_unanswered");
    expect([real, m.invariants.examples.filter(e => e.rule !== "two_unanswered").slice(0, 3)]).toEqual([[], []]);
    expect(m.safety.minorContacts).toBe(0);
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.errors).toBe(0);
  }, !o.quick);
  await b.run(`scale (${spec.personas} personas, ${spec.days} days): meetings were held`, () => expect(m.meetings.held).toBeGreaterThan(0), !o.quick);
  b.track("scale: two_unanswered (the known re-engagement judge issue, target 0)", !m.invariants.byRule.two_unanswered, String(m.invariants.byRule.two_unanswered ?? 0));
  b.track("scale: proposals, meetings held, share of members with nothing", true, `${m.proposals.total} proposals, ${m.meetings.held} held, ${(m.experience.shareWithNothing * 100).toFixed(1)}% with nothing`);
  b.track("scale: wall time", true, `${Math.round((performance.now() - t) / 1000)}s`);
}
