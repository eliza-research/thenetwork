import { expect, test } from "bun:test";
import { ARMS } from "../src/apps/peon/arms.ts";
import { peonMetrics } from "../src/apps/peon/metrics.ts";
import { runPeonWorld } from "../src/apps/peon/world.ts";

test("Peon records applications lost to closed roles during interviews and offer decisions", async () => {
  let interviews = 0, decisions = 0;
  const failures: string[] = [];
  for (const arm of ["pack", "keyword", "oracle"]) for (const seed of [13, 14, 15, 16]) {
    const rounds: { openings: Map<string, number>; hired: Set<string> }[] = [];
    const r = await runPeonWorld({ seed, perCity: 100, jobsPerCity: 20, weeks: 8, matcher: w => {
      const original = ARMS[arm]!.matcher;
      const matcher = typeof original === "function" ? original(w) : original;
      return { ...matcher, propose(ctx) {
        rounds[ctx.week] = { openings: new Map(w.state.openings), hired: new Set(w.state.hired) };
        return matcher.propose(ctx);
      } };
    } });
    let lost = 0;
    for (const f of r.flows) {
      const iw = f.interviewWeek;
      if (iw === undefined) continue;
      const before = rounds[iw], after = rounds[iw + 1];
      const fills = r.hires.filter(h => h.job === f.job && h.week === iw).length;
      const interviewLost = f.withdrawn && before && before.openings.get(f.job)! - fills <= 0
        && !r.hires.some(h => h.cand === f.cand && h.week <= iw);
      const decisionLost = f.interviewed && f.passed && f.offered === false && after?.openings.get(f.job) === 0 && !after.hired.has(f.cand);
      if (!interviewLost && !decisionLost) continue;
      if (interviewLost) interviews++;
      if (decisionLost) decisions++;
      lost++;
      if (!f.roleClosed || f.rec?.outcome !== "cancelled" || f.rec.declinedBy?.length)
        failures.push(`${arm}/${seed}/${f.key}: missing closure or false rejection`);
    }
    const queueLost = r.flows.filter(f => f.roleClosed && f.interviewWeek === undefined).length;
    if (peonMetrics(r).lostToClosedRole !== queueLost + lost) failures.push(`${arm}/${seed}: incorrect lost-to-closure count`);
  }
  expect({ interviews: interviews > 0, decisions: decisions > 0, failures }).toEqual({ interviews: true, decisions: true, failures: [] });
}, 30_000);
