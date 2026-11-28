// The "Dates per member-month vs random" gate divides by the random arm's
// measurement. When the random arm measures no dates the denominator is 0,
// the ratio is Infinity, and the gate passes vacuously — the same
// zero-baseline hole as the second-date gates fixed in #796 and the friends
// gate in #759. This file pins the fix: a denominator > 0 guard on the pass
// condition in gates() and gates3() (packages/sim/src/apps/slop/packEval.ts).
// Confirmed by reviewer hermesagent270-commits (PR #796, Finding 2,
// non-blocking): value Infinity, pass true in both gates() and gates3() at
// quick size.
//
// Size: --quick size (scripts/sim/slop.ts): one seed, 2 weeks, 150 per
// city. The packEval defaults (seeds 1-4, 4 weeks, 300 per city) are too
// slow for the integration project's 120 s timeout (vitest.config.ts) — the
// #796 test's previous version at that size took 190-612 s per test — so
// the quick size is used here as in
// slop-gates-zero-baseline.integration.test.ts (#796). Every precondition
// below is a value the reviewer's probe measured on current develop at
// this size:
// - no-op random arm: 0 dates by construction, so datesPerMemberMonth is 0
//   (metrics.ts guards the division: div(0, ...) is 0).
// - slop arm: datesPerMemberMonth > 0 (the probe: the gate's value is
//   Infinity against the zero baseline, so the numerator is > 0).
// - normal random arm: measures dates (second-date rate 0.038, 1 second
//   date per seed — a second date is a date), so datesPerMemberMonth > 0.
//
// What each test proves:
// 1. Zero baseline, real slop arm: the gate is mutant-sensitive with the
//    real slop arm alone — unlike the second-date rate gate it has no 20%
//    floor to clear, so no synthetic high-rate arm is needed. On develop it
//    passes vacuously (value Infinity); at head it fails. Removing the
//    `M(m => m.datesPerMemberMonth, random) > 0` guard from either gates()
//    or gates3() makes this test fail.
// 2. Control, normal random arm: the guard must not change a measured run.
//    The quick-size ratio is not pinned (one seed is noise; the gate is
//    tracked — failing — on pinned seeds 13-16 (scripts/sim/slop.ts:5,11-13),
//    so the control asserts the gate's value is finite and its pass follows
//    the ratio, not a specific pass/fail.
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
// A matcher that never proposes anything: no proposals, no dates, no second
// dates — a random arm with a zero baseline by construction.
const noopMatcher: SlopMatcher = {
  name: "noop",
  propose: () => ({ proposals: [] }),
};
// A random arm that measures nothing: the degenerate baseline a ratio gate
// must not pass vacuously. The real random baseline ("random" in
// baselines.ts) proposes, so it cannot stand in for this.
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
// The arms are run once and shared between the tests: the worlds are
// deterministic for a fixed seed, and re-running them per test would
// multiply the slowest part of the suite.
let slopArm: ArmResult | undefined;
let zeroRandomArm: ArmResult | undefined;
let normalRandomArm: ArmResult | undefined;
const getSlopArm = async (): Promise<ArmResult> =>
  (slopArm ??= await runArm("slop", SEEDS, WEEKS, PER_CITY));
const getZeroRandomArm = async (): Promise<ArmResult> =>
  (zeroRandomArm ??= await runNoopRandomArm());
const getNormalRandomArm = async (): Promise<ArmResult> =>
  (normalRandomArm ??= await runArm("random", SEEDS, WEEKS, PER_CITY));

// gates() and gates3() both name the gate "Dates per member-month vs
// random".
const datesGate = (gs: Gate[]): Gate => {
  const dates = gs.find((g) =>
    g.name === "Dates per member-month vs random",
  );
  expect(dates).toBeDefined();
  return dates!;
};

test("dates-per-member-month fails on a zero random baseline", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();
  // Preconditions: the zero arm measures no dates at all, so its
  // dates-per-member-month is 0; the slop arm measures some, so the ratio
  // is Infinity rather than 0/0.
  expect(random.metrics.every((m) => m.dates === 0)).toBe(true);
  expect(
    random.metrics.every((m) => m.datesPerMemberMonth === 0),
  ).toBe(true);
  expect(
    mean(slop.metrics.map((m) => m.datesPerMemberMonth)),
  ).toBeGreaterThan(0);
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const dates = datesGate(gs);
    expect(dates.value).toBe(Infinity);
    expect(dates.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("dates-per-member-month unchanged on a normal random arm", async () => {
  const slop = await getSlopArm();
  const random = await getNormalRandomArm();
  // Preconditions: both arms measure dates, so the denominator is > 0 and
  // the ratio is finite.
  expect(
    mean(slop.metrics.map((m) => m.datesPerMemberMonth)),
  ).toBeGreaterThan(0);
  expect(
    mean(random.metrics.map((m) => m.datesPerMemberMonth)),
  ).toBeGreaterThan(0);
  // The quick-size ratio is not pinned (one seed is noise; the gate is
  // tracked — failing — on pinned seeds 13-16,
  // scripts/sim/slop.ts:5,11-13), so the control asserts the guard is a
  // no-op on a measured run: the value is finite and pass follows the
  // ratio, rather than a specific pass/fail.
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const dates = datesGate(gs);
    expect(dates.value).toBeGreaterThan(0);
    expect(Number.isFinite(dates.value)).toBe(true);
    expect(dates.pass).toBe(dates.value >= 0.9);
  }
}, WORLD_TIMEOUT_MS);
