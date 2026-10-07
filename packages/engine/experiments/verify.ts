// Checks that the experiment harness reproduces the engine and the simulator CLI exactly.
//   bun packages/engine/experiments/verify.ts
import { runEngine } from "../src/engine.ts";
import { loadSnapshot } from "../../../scripts/synthetic/load.ts";
import { runSim, tracedEngine } from "./lib.ts";
import { selectX } from "./select.ts";
import { selectProposals } from "../src/policy.ts";
import { Rng } from "../src/rng.ts";

const snap = await loadSnapshot();
const a = await runEngine(snap, { seed: 1 });
const b = tracedEngine(snap as any, { seed: 1 });
const ids = (ps: { id: string }[]) => ps.map(p => p.id).join(",");
console.log("synthetic: runEngine", a.proposals.length, "traced", b.proposals.length, "identical:", ids(a.proposals) === ids(b.proposals) && JSON.stringify(a.proposals) === JSON.stringify(b.proposals));

// selectX with no levers == selectProposals
const s1 = selectProposals(b.world, b.scored, new Rng(7), {});
const s2 = selectX(b.world, b.scored, new Rng(7), {}, {});
console.log("selectX == selectProposals:", s1.selected.map(s => s.s.c.key).join() === s2.selected.map(s => s.s.c.key).join());

for (const seed of [1, 2, 3]) {
  const r = await runSim({ seed, keepTraces: false });
  const m = r.metrics.proposals;
  console.log(`sim seed ${seed}: proposals=${m.total} precision=${m.precision} recall=${m.recallPairs} worthwhile=${r.metrics.experience.worthwhileRate} zero=${r.metrics.fairness.zeroProposalShare}`);
}
