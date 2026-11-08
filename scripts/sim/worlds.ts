// The worlds block: regression gates for the per-app worlds' own flow rules (slop-world-flow in
// docs/research/state-machines/sim.md). Each gate runs one small world on a
// pinned seed and checks one rule the world applies at each step. No model call.
import { canBeMatched, type MemberId } from "../../packages/core/src/index.ts";
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
}
