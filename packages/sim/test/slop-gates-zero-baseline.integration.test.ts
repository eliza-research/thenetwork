// The second-date gates fail closed when the random arm measures no second
// dates — the same defect family as #759 (V14 friends gate). With no
// measured baseline the ratio is Infinity and the gate passed vacuously;
// a gate that can pass with an unmeasured baseline cannot prove an effect.
// This test pins the fix in packages/sim/src/apps/slop/packEval.ts, where
// gates() and gates3() guard the four second-date pass conditions with
// sdrR > 0 / secR > 0. It does not touch packEval.ts.
//
// Size: the --quick size from scripts/sim/slop.ts (seed 13, 2 weeks, 150
// per city). The previous version ran the packEval defaults (seeds 1-4,
// 4 weeks, 300 per city) and took 190-612 s per test against the
// integration project's 120 s timeout (vitest.config.ts). Every
// precondition below is a value the reviewer's probe measured on current
// develop at this size:
//
//   - slop arm: second-date rate ~3.5% (rate ratio 0.93x vs a normal
//     random arm), ~0.5 second dates per seed (ratio 0.50x). Both
//     second-date gates fail against a normal random arm on develop
//     today; neither arm reaches the 20% floor (17.1% on seeds 1-4).
//   - normal random arm: second-date rate 0.038, 1 second date per seed.
//   - no-op random arm: 0 second dates by construction.
//
// What each test proves, and which guard it kills:
//   1. Zero baseline, real slop arm: the per-seed gate is the
//      mutant-sensitive one — on develop it passes vacuously (value
//      Infinity), at head it fails. Removing the secR > 0 guard from
//      either gates() or gates3() makes this test fail. The rate gate
//      also fails at head, but it already failed on develop at this size
//      because the slop rate is under the 20% floor, so it cannot show
//      the rate guard on its own.
//   2. Control, normal random arm: both gates fail on develop today
//      (0.93x and 0.50x at this size; 1.73x and 1.68x on the pinned
//      seeds, scripts/sim/slop.ts:67-71) and are tracked, not blocking,
//      so the control asserts fail — not pass — and proves the guards
//      change nothing for a measured baseline.
//   3. Zero baseline, high-rate arm: no measured arm reaches the 20%
//      floor, so the rate guard cannot be exercised by a real arm. This
//      case takes the real slop arm's metrics and sets its second-date
//      rate to 30% — the only field the rate gate reads that changes —
//      so on develop the rate gate passes vacuously (Infinity >= 2.5x
//      and 30% >= 20%) and at head it fails. Removing the sdrR > 0 guard
//      from either gates() or gates3() makes this test fail. No extra
//      world is run here.
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

// --quick size (scripts/sim/slop.ts): one seed, 2 weeks, 150 per city.
const SEEDS = [13];
const WEEKS = 2;
const PER_CITY = 150;

// The world-running tests set their own timeout, as in
// friends-v14-na.integration.test.ts: a quick world is small, but CI hosts
// vary and the integration project's default is 120 s.
const WORLD_TIMEOUT_MS = 300_000;

// Second-date rate at which the rate gate's 20% floor is cleared. No
// measured arm reaches it on current develop (see the header), so the
// high-rate case below sets it explicitly.
const HIGH_SECOND_DATE_RATE = 0.3;

// A matcher that never proposes anything: the world still runs, but no dates
// — and so no second dates — can ever happen. Per world.ts, a SlopMatcher is
// { name, propose(ctx) }, and propose returns { proposals: [] }.
const noopMatcher: SlopMatcher = {
  name: "noop",
  propose: () => ({ proposals: [] }),
};

// The degenerate random arm, built the way the friends-v14-zero test
// builds its degenerate arm: a real world, a no-op matcher, real metrics.
const runNoopRandomArm = async (): Promise<ArmResult> => {
  const metrics: SlopMetrics[] = [];
  const extra: Extra[] = [];
  for (const seed of SEEDS) {
    const res = await runSlopWorldAsync({
      seed,
      perCity: PER_CITY,
      weeks: WEEKS,
      matcher: noopMatcher,
    });
    const m = slopMetrics(res);
    metrics.push(m);
    extra.push(extraOf(res, m));
  }
  return { arm: "random", seeds: SEEDS, metrics, extra };
};

// The arms are run once and shared between the tests: three quick worlds in
// total (slop, no-op random, normal random).
let slopArm: ArmResult | undefined;
let zeroRandomArm: ArmResult | undefined;
let normalRandomArm: ArmResult | undefined;
const getSlopArm = async (): Promise<ArmResult> => {
  slopArm ??= await runArm("slop", SEEDS, WEEKS, PER_CITY);
  return slopArm;
};
const getZeroRandomArm = async (): Promise<ArmResult> => {
  zeroRandomArm ??= await runNoopRandomArm();
  return zeroRandomArm;
};
const getNormalRandomArm = async (): Promise<ArmResult> => {
  normalRandomArm ??= await runArm("random", SEEDS, WEEKS, PER_CITY);
  return normalRandomArm;
};

// gates() names the rate gate "Second-date rate vs random"; gates3() names
// it "Second-date rate vs random (and >= 20%)". The per-seed gate has the
// same name in both.
const secondDateGates = (gs: Gate[]) => {
  const rate = gs.find((g) =>
    g.name.startsWith("Second-date rate vs random"),
  );
  const perSeed = gs.find(
    (g) => g.name === "Second dates per seed vs random",
  );
  expect(rate).toBeDefined();
  expect(perSeed).toBeDefined();
  return { rate: rate!, perSeed: perSeed! };
};

test("second-date gates fail on a zero random baseline", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();

  // Preconditions, all true on current develop at the quick size (see the
  // header): the degenerate arm measures no second dates, and the real slop
  // arm does measure some — so the ratios below are Infinity for a real
  // reason, not because both arms are empty.
  expect(random.metrics.every((m) => m.secondDateRate === 0)).toBe(true);
  expect(mean(random.metrics.map((m) => m.secondDateRate * m.dates))).toBe(0);
  const sdr = mean(slop.metrics.map((m) => m.secondDateRate));
  const sec = mean(slop.metrics.map((m) => m.secondDateRate * m.dates));
  expect(sdr).toBeGreaterThan(0);
  expect(sec).toBeGreaterThan(0);
  // No sdr >= 0.2 precondition here: the real slop arm is ~3.5% at this
  // size (17.1% on seeds 1-4), below the rate gate's 20% floor. The rate
  // guard is exercised by the high-rate case below instead.

  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    // Both ratios are Infinity over the unmeasured baseline; both gates
    // must fail. On develop the per-seed gate passed here (vacuous pass);
    // the rate gate failed only because of the 20% floor.
    expect(rate.value).toBe(Infinity);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBe(Infinity);
    expect(perSeed.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("second-date gates unchanged against a normal random arm", async () => {
  const slop = await getSlopArm();
  const random = await getNormalRandomArm();

  // Preconditions: the normal random arm measures second dates (rate 0.038,
  // 1 second date per seed at the quick size), so the ratios are finite.
  const sdrR = mean(random.metrics.map((m) => m.secondDateRate));
  const secR = mean(random.metrics.map((m) => m.secondDateRate * m.dates));
  expect(sdrR).toBeGreaterThan(0);
  expect(secR).toBeGreaterThan(0);

  // Both gates fail on develop today (0.93x and 0.50x at this size; 1.73x
  // and 1.68x on the pinned seeds, scripts/sim/slop.ts:67-71) and are
  // tracked, not blocking. The guards must not change a measured run, so
  // the control asserts the same fail — not a pass.
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    expect(rate.value).toBeLessThan(2.5);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBeLessThan(2);
    expect(perSeed.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("rate gate fails on a zero baseline above the 20% floor", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();

  // No measured arm reaches the 20% floor (see the header), so build the
  // high-rate arm from the real slop arm: same seeds, dates and extra,
  // only secondDateRate set to 30%. This is the arm on which the sdrR > 0
  // guard is the only thing standing between a vacuous pass and a fail.
  const highRate: ArmResult = {
    ...slop,
    metrics: slop.metrics.map((m) => ({
      ...m,
      secondDateRate: HIGH_SECOND_DATE_RATE,
    })),
  };
  const sdr = mean(highRate.metrics.map((m) => m.secondDateRate));
  const sec = mean(highRate.metrics.map((m) => m.secondDateRate * m.dates));
  expect(sdr).toBeGreaterThanOrEqual(0.2);
  expect(sec).toBeGreaterThan(0);
  expect(random.metrics.every((m) => m.secondDateRate === 0)).toBe(true);

  for (const gs of [gates(highRate, random), gates3(highRate, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    // On develop both gates pass here (Infinity >= 2.5x with 30% >= 20%,
    // Infinity >= 2x); at head both fail on the unmeasured baseline.
    expect(rate.value).toBe(Infinity);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBe(Infinity);
    expect(perSeed.pass).toBe(false);
  }
});
