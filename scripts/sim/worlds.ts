// The worlds block: regression gates for the per-app worlds' own flow rules (slop-world-flow and
// peon-application-flow in docs/research/state-machines/sim.md). Each gate runs one small world on a
// pinned seed and checks one rule the world applies at each step. No model call.
import { canBeMatched, type MemberId } from "../../packages/core/src/index.ts";
import { keywordMatcher } from "../../packages/sim/src/apps/peon/baselines.ts";
import { REALISM_V2, runPeonWorld } from "../../packages/sim/src/apps/peon/world.ts";
import { runSlopWorld } from "../../packages/sim/src/apps/slop/world.ts";
import { Block, expect } from "./gate.ts";

export async function worldsBlock(b: Block): Promise<void> {
  // SD-404 (sim S-27): resolveWeek checked `paused` only, so a member under an active safety hold (one placed
  // earlier in the same round, after the matcher's snapshot) still got a probe. Production checks holds at send time.
  await b.run("slop world: a member under an active safety hold gets no probe", () => {
    let held: MemberId | undefined, other: MemberId | undefined;
    const r = runSlopWorld({
      seed: 13, perCity: 40, cities: ["nyc"], weeks: 1, minorShare: 0,
      matcher: w => {
        const adults = w.personas.filter(p => canBeMatched(p.stated.claimedAge) && !p.hidden.adversary);
        held = adults[0]!.id; other = adults[1]!.id;
        // The matcher does not look at holds: the world must refuse the probe on its own.
        w.state.safetyHolds.push({ memberId: held, from: w.state.now, reason: "reported: harassment" });
        return { name: "hold-blind", propose: () => [
          { first: held!, partner: other!, city: "nyc", activity: "coffee", options: [0, 1] },
          { first: other!, partner: held!, city: "nyc", activity: "walk", options: [0, 1] },
        ] };
      },
    });
    expect(r.flows.length).toBe(2);
    for (const f of r.flows) {
      expect(f.stage).toBe("dropped_policy");
      expect(f.firstYes).toBe(undefined);
    }
  });
  // SD-406 (sim S-29): `exited` guarded only new probes. Review, interview, offer and hire checked `hired` only,
  // so a candidate who had left the search was still invited, interviewed, offered a job and hired.
  await b.run("peon world: a candidate who left the search gets no interview, offer or hire", async () => {
    const exitedBy = new Map<number, Set<MemberId>>();
    const r = await runPeonWorld({
      seed: 13, perCity: 400, jobsPerCity: 80, weeks: 8, realism: REALISM_V2,
      matcher: w => ({ ...keywordMatcher, propose: ctx => { exitedBy.set(ctx.week, new Set(w.state.exited)); return keywordMatcher.propose(ctx); } }),
    });
    const gone = (week: number | undefined, id: MemberId) => week !== undefined && !!exitedBy.get(week)?.has(id);
    const steps = r.flows.filter(f => (f.employerYes && gone(f.reviewWeek, f.cand)) || (f.interviewed && gone(f.interviewWeek, f.cand))
      || (f.offered && gone(f.interviewWeek! + 1, f.cand))).length + r.hires.filter(h => gone(h.week, h.cand)).length;
    expect(r.world.state.exited.size).toBeGreaterThan(0);
    expect(r.hires.length).toBeGreaterThan(0);
    expect(steps).toBe(0);
  });
}
