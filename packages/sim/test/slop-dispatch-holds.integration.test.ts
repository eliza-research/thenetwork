import { expect, test } from "bun:test";
import { BASELINES } from "../src/apps/slop/baselines.ts";
import { worldOptions } from "../src/apps/slop/packEval.ts";
import { runSlopWorld, type SlopProposal } from "../src/apps/slop/world.ts";

test("Slop dispatch stops later probes after a native flow places either member on hold", () => {
  for (const relay of [undefined, true, { engine: true }] as const) {
    let probes = 0, heldProbes = 0;
    const selected = new Map<string, SlopProposal>();
    const r = runSlopWorld({ seed: 7, perCity: 120, weeks: 8, ...worldOptions(relay === undefined ? {} : { relay, review: 3 }), matcher(w) {
      const native = BASELINES.greedy(w), answer = w.behavior.answerProbe.bind(w.behavior);
      w.behavior.answerProbe = (id, key, ctx, options) => {
        const p = selected.get(key);
        if (!p) throw new Error("Unknown native proposal");
        probes++;
        if (w.state.safetyHolds.some(h => h.from <= w.state.now && (h.to === undefined || h.to > w.state.now) && (h.memberId === p.first || h.memberId === p.partner))) heldProbes++;
        return answer(id, key, ctx, options);
      };
      return { ...native, propose(ctx) {
        const proposals = native.propose(ctx);
        if (!Array.isArray(proposals)) throw new Error("Expected native synchronous proposals");
        proposals.forEach((p, i) => selected.set(`w${ctx.week}:${i}:${p.first}:${p.partner}`, p));
        return proposals;
      } };
    } });
    expect(probes).toBeGreaterThan(0);
    expect(r.world.state.safetyHolds.length).toBeGreaterThan(0);
    expect(heldProbes).toBe(0);
  }
});
