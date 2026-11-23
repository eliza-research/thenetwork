import { expect, test } from "vitest";
import { BASELINES as FRIENDS_BASELINES } from "../src/apps/friends/baselines.ts";
import { boroughRatio, officialGates as friendsGates } from "../src/apps/friends/gates.ts";
import { friendsMetrics } from "../src/apps/friends/metrics.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";
import { keywordMatcher, keywordMatcherN } from "../src/apps/peon/baselines.ts";
import { officialGates as peonGates } from "../src/apps/peon/gates.ts";
import { peonMetrics, poolImpact } from "../src/apps/peon/metrics.ts";
import { runPeonWorld } from "../src/apps/peon/world.ts";
import { slopMetrics } from "../src/apps/slop/metrics.ts";
import { extraOf, gates3, runArm } from "../src/apps/slop/packEval.ts";
import { runSlopWorld } from "../src/apps/slop/world.ts";

test("Friends reports a borough ratio only with a qualifying cohort and positive overall value", () => {
  const world = { seed: 5, weeks: 4 };
  const small = friendsMetrics(runFriendsWorld({ ...world, n: 20, matcher: FRIENDS_BASELINES.random }));
  const empty = friendsMetrics(runFriendsWorld({ ...world, n: 400, matcher: { name: "no introductions", propose: () => [] } }));
  const observed = friendsMetrics(runFriendsWorld({ ...world, n: 400, matcher: FRIENDS_BASELINES.random }));
  expect(Object.values(small.v14ByBorough).every(cohort => cohort.n < 30)).toBe(true);
  expect(Object.values(empty.v14ByBorough).some(cohort => cohort.n >= 30)).toBe(true);
  expect(empty.v14).toBe(0);
  for (const metrics of [small, empty]) {
    expect(friendsGates([metrics], [observed], [observed]).find(gate => gate.id === "borough30")?.pass).toBe(false);
    expect(boroughRatio([metrics], 30)).toMatchObject({ min: NaN, worstSeed: NaN });
  }
  const observedRatio = boroughRatio([observed], 30);
  expect(observedRatio.min).toBeGreaterThan(0);
  expect(observedRatio.worstSeed).toBe(observedRatio.min);
  expect(boroughRatio([empty, observed], 30).worstSeed).toBe(observedRatio.min);
});

test("Peon reports automated impact only when comparable assessed groups have selection evidence", async () => {
  const world = { seed: 13, weeks: 2, perCity: 250, jobsPerCity: 30 };
  const unassessed = peonMetrics(await runPeonWorld({
    ...world, matcher: { name: "no assessments", blindReview: false, propose: () => [] },
  }));
  const tooSmall = peonMetrics(await runPeonWorld({ ...world, perCity: 10, matcher: keywordMatcher }));
  const unselected = peonMetrics(await runPeonWorld({ ...world, matcher: keywordMatcherN(0) }));
  const observed = peonMetrics(await runPeonWorld({ ...world, matcher: keywordMatcher }));
  expect(tooSmall.probesDelivered).toBeGreaterThan(0);
  expect(unselected.impact.rates["offered|assessed"]).toHaveProperty("sex");
  expect(unselected.probesDelivered).toBe(0);
  for (const metrics of [unassessed, tooSmall, unselected]) {
    expect(metrics.impact.minAutomated).toBeNaN();
    expect(poolImpact([metrics.impact]).minAutomated).toBeNaN();
    expect(peonGates([metrics], [observed]).find(gate => gate.id === "impact_ratio")?.pass).toBe(false);
  }
  const pooled = poolImpact([observed.impact]);
  expect(pooled.minAutomated).toBeGreaterThan(0);
  expect(pooled.minAutomated).toBeCloseTo(observed.impact.minAutomated);
  const mixed = peonGates([unassessed, observed], [observed]).find(gate => gate.id === "impact_ratio");
  expect(mixed?.value).toContain(`worst seed ${observed.impact.minAutomated.toFixed(2)}`);
  // An artificial screen leaves one comparable group with zero offers but selects from another.
  const screened = peonMetrics(await runPeonWorld({
    ...world,
    matcher: ({ oracle }) => ({
      ...keywordMatcher,
      async propose(ctx) {
        const intros = await keywordMatcher.propose(ctx);
        return intros.filter(intro => oracle.sealed(intro.cand)?.sex === "f");
      },
    }),
  }));
  expect(screened.impact.ratio["offered|assessed"]?.sex).toBe(0);
  expect(poolImpact([screened.impact]).minAutomated).toBe(0);
  expect(peonGates([screened], [observed]).find(gate => gate.id === "impact_ratio")?.pass).toBe(false);
});

test("Slop reports harm reductions only when the random arm has harm to reduce", async () => {
  const seed = 13;
  const result = runSlopWorld({ seed, weeks: 4, perCity: 300, matcher: { name: "no introductions", propose: () => [] } });
  const metrics = slopMetrics(result);
  const empty = { arm: result.matcher, seeds: [seed], metrics: [metrics], extra: [extraOf(result, metrics)] };
  const random = await runArm("random", [seed], 4, 300);
  const reductions = (candidate: typeof empty, baseline: typeof empty) =>
    gates3(candidate, baseline).filter(gate => gate.name.includes("cut")).map(({ value, pass }) => ({ value, pass }));
  const unavailable = Array.from({ length: 4 }, () => ({ value: NaN, pass: false }));
  expect(reductions(empty, empty)).toEqual(unavailable);
  expect(reductions(random, empty)).toEqual(unavailable);
  expect(reductions(empty, random)).toEqual(Array.from({ length: 4 }, () => ({ value: 1, pass: true })));
  expect(reductions(random, random)).toEqual(Array.from({ length: 4 }, () => ({ value: 0, pass: false })));
});
