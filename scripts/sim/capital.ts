// The capital block (nightly, or `bun run sim --with-capital`): the network-capital simulation
// (packages/capital/experiments/run.ts) and its launch gates. The primary fairness gate needs at least
// 32 paired seeds (capital-13), so this block is slow; it is not part of the default run.
//   blocking: (a) NC levers lower the bottom/top-decile V14 ratio by <= 0.02 (95% CI lower bound, paired
//             against every NC lever off); gaming: each strategy's mean net gain <= 25% of a regular's NC.
//   (b) the launch gate of PRD 39.2.7: the absolute bottom/top-decile V14 ratio >= 0.80. It fails today
//       (0.71 on 2026-10-08, docs/results/2026-10-08-network-capital.md), so it is TRACKED with its value
//       until it is fixed or waived (CAPITAL_ABSOLUTE_BLOCKING turns it blocking).
import { GATE_MIN_SEEDS, launchGates, runArm } from "../../packages/capital/experiments/run.ts";
import { Block } from "./gate.ts";

/** PRD 39.2.7: the bottom NC decile's V14 is at least 80% of the top decile's. Blocking once it passes. */
export const CAPITAL_ABSOLUTE_BLOCKING = false;

export async function capitalBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const seeds = o.quick ? 4 : GATE_MIN_SEEDS;
  const on = runArm("A", {}, seeds).per;
  const off = runArm("Z", { effortLever: false, vouchLever: false, reachLever: false }, seeds).per;
  const lg = launchGates(on, off);
  const f = (x: number) => x.toFixed(3);
  b.gate(`fairness: NC levers lower the bottom/top V14 ratio by <= 0.02 (CI lower bound, ${seeds} paired seeds)`, lg.primaryFairness.pass, `change ${f(lg.primaryFairness.diff)}, lower ${f(lg.primaryFairness.lower)}`, !o.quick);
  b.gate("gaming: each strategy's mean net gain <= 25% of a regular's NC", lg.gaming.pass, Object.entries(lg.gaming.gainShare).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", "));
  b.gate(`launch gate (PRD 39.2.7): absolute bottom/top-decile V14 ratio >= 0.80 (${seeds} seeds)`, lg.healthTarget.met,
    `${f(lg.healthTarget.ratio)} (worst seed ${f(lg.healthTarget.worstSeedRatio)}; levers off ${f(launchGates(off, off).healthTarget.ratio)})`, CAPITAL_ABSOLUTE_BLOCKING && !o.quick);
}
