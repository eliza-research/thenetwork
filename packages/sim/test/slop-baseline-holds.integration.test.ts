import { expect, test } from "bun:test";
import { BASELINES } from "../src/apps/slop/baselines.ts";
import { worldOptions } from "../src/apps/slop/packEval.ts";
import { runSlopWorld, type MatcherContext } from "../src/apps/slop/world.ts";

test("Slop baselines block active relay holds and resume matching after review clears them", () => {
  let activeObservations = 0, activeProposals = 0;
  const clearedProposals = { random: 0, greedy: 0, oracle: 0 };
  const boundaryProposals = { random: 0, greedy: 0, oracle: 0 };
  for (const arm of ["random", "greedy", "oracle"] as const) for (const review of [undefined, 10, 3, 7]) {
    runSlopWorld({ seed: 16, perCity: 120, weeks: 8, ...worldOptions({ relay: true, review }), matcher(w) {
      const native = BASELINES[arm](w);
      return { ...native, propose(ctx: MatcherContext) {
        const { now, safetyHolds } = ctx.snapshot;
        const active = new Set(safetyHolds.filter(h => h.from <= now && (h.to === undefined || h.to > now)).map(h => h.memberId));
        const cleared = new Set(safetyHolds.filter(h => h.to !== undefined && h.to <= now && !active.has(h.memberId)).map(h => h.memberId));
        activeObservations += active.size;
        const proposals = native.propose(ctx);
        if (!Array.isArray(proposals)) throw new Error("Expected the native synchronous baseline proposals");
        for (const p of proposals) {
          if (active.has(p.first) || active.has(p.partner)) activeProposals++;
          if (review === 3 && (cleared.has(p.first) || cleared.has(p.partner))) clearedProposals[arm]++;
          if (review === 7 && safetyHolds.some(h => h.to === now && cleared.has(h.memberId) && (h.memberId === p.first || h.memberId === p.partner))) boundaryProposals[arm]++;
        }
        return proposals;
      } };
    } });
  }
  expect(activeObservations).toBeGreaterThan(0);
  expect(activeProposals).toBe(0);
  for (const arm of ["random", "greedy", "oracle"] as const) {
    expect(clearedProposals[arm]).toBeGreaterThan(0);
    expect(boundaryProposals[arm]).toBeGreaterThan(0);
  }
});
