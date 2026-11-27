// Same defect family as #759 (V14 friends gate): the slop pack's second-date
// gates compare the slop arm against the random arm as a ratio (">=2x random").
// When the random arm records zero second dates across all seeds, the ratio
// is Infinity and the gate passes with no measured baseline at all. The gates
// must fail instead: an unmeasured baseline cannot prove an effect.
import { expect, test } from "vitest";
import {
  extraOf,
  gates,
  gates3,
  mean,
  runArm,
  type ArmResult,
  type Extra,
  type Gate,
} from "../src/apps/slop/packEval.ts";
import { slopMetrics, type SlopMetrics } from "../src/apps/slop/metrics.ts";
import { runSlopWorldAsync, type SlopMatcher } from "../src/apps/slop/world.ts";

// Pinned to the pack's own defaults (packEval.ts main: seeds 1-4, weeks 4,
// perCity 300), so the slop arm is the real pack on its real world.
const SEEDS = [1, 2, 3, 4];
const WEEKS = 4;
const PER_CITY = 300;

// A matcher that never proposes anything: the world still runs, but no dates
// — and so no second dates — can ever happen. Per world.ts, a SlopMatcher is
// { name, propose(ctx) }, and propose returns { proposals: [] }.
const noopMatcher: SlopMatcher = {
  name: "noop",
  propose: () => ({ proposals: [] }),
};

// The degenerate random arm, built the way runArm builds an arm: one world
// per seed, metrics + extra per seed.
async function runNoopRandomArm(): Promise<ArmResult> {
  const metrics: SlopMetrics[] = [];
  const extra: Extra[] = [];
  for (const seed of SEEDS) {
    const res = await runSlopWorldAsync({ seed, perCity: PER_CITY, weeks: WEEKS, matcher: noopMatcher });
    const m = slopMetrics(res);
    metrics.push(m);
    extra.push(extraOf(res, m));
  }
  return { arm: "random", seeds: SEEDS, metrics, extra };
}

// gates() and gates3() name the rate gate slightly differently; the per-seed
// gate has the same name in both.
function secondDateGates(gs: Gate[]): { rate: Gate; perSeed: Gate } {
  const rate = gs.find((x) => x.name.startsWith("Second-date rate vs random"));
  const perSeed = gs.find((x) => x.name === "Second dates per seed vs random");
  if (!rate || !perSeed) throw new Error("missing second-date gate");
  return { rate, perSeed };
}

let cachedSlop: ArmResult | undefined;
async function getSlopArm(): Promise<ArmResult> {
  cachedSlop ??= await runArm("slop", SEEDS, WEEKS, PER_CITY);
  return cachedSlop;
}

test("slop second-date gates fail when the random arm records no second dates", async () => {
  const slop = await getSlopArm();
  const randomZero = await runNoopRandomArm();

  // The degenerate baseline really is degenerate: zero second dates on
  // every seed, so sdrR = secR = 0.
  expect(randomZero.metrics.every((m) => m.secondDateRate === 0)).toBe(true);
  expect(mean(randomZero.metrics.map((m) => m.secondDateRate * m.dates))).toBe(0);

  // ... and the slop arm really does have second dates (sdr >= 0.2, sec > 0),
  // so before the fix these gates passed with value Infinity.
  const sdr = mean(slop.metrics.map((m) => m.secondDateRate));
  const sec = mean(slop.metrics.map((m) => m.secondDateRate * m.dates));
  expect(sec).toBeGreaterThan(0);
  expect(sdr).toBeGreaterThanOrEqual(0.2);

  for (const gs of [gates(slop, randomZero), gates3(slop, randomZero)]) {
    const { rate, perSeed } = secondDateGates(gs);
    // The ratio against an unmeasured baseline is Infinity — and it must
    // not pass.
    expect(rate.value).toBe(Infinity);
    expect(perSeed.value).toBe(Infinity);
    expect(rate.pass).toBe(false);
    expect(perSeed.pass).toBe(false);
  }
});

test("slop second-date gates still pass against a normal random arm", async () => {
  const slop = await getSlopArm();
  const random = await runArm("random", SEEDS, WEEKS, PER_CITY);

  // The control baseline really measured second dates.
  const sdrR = mean(random.metrics.map((m) => m.secondDateRate));
  const secR = mean(random.metrics.map((m) => m.secondDateRate * m.dates));
  expect(sdrR).toBeGreaterThan(0);
  expect(secR).toBeGreaterThan(0);

  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    expect(rate.pass).toBe(true);
    expect(perSeed.pass).toBe(true);
  }
});
