import { expect, test } from "vitest";
import { BASELINES as FRIENDS_BASELINES } from "../src/apps/friends/baselines.ts";
import { friendsMetrics, v14Of } from "../src/apps/friends/metrics.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";

test("V14 reports 0, not NaN, when no member or no day can count", () => {
  expect(v14Of([], new Map(), 28)).toBe(0);
  expect(v14Of(["a"], new Map(), 7)).toBe(0);
  expect(v14Of(["a"], new Map([["a", [20]]]), 28)).toBeCloseTo(0.6, 10);
});

test("a one-week Friends run reports V14 as 0 for the run and every borough", () => {
  const metrics = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 1, n: 400, matcher: FRIENDS_BASELINES.random }));
  expect(metrics.v14).toBe(0);
  expect(metrics.v14Arranged).toBe(0);
  expect(Object.values(metrics.v14ByBorough).every((cohort) => cohort.v14 === 0)).toBe(true);
});
