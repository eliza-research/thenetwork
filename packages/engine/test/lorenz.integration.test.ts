// Exposure fairness (PRD spec/product/source/prd.md:1900, ME-012) through the real engine:
// a small cohort's Lorenz curve interpolates between members instead of rounding to
// whole member counts.
import { expect, test } from "vitest";
import { runEngine } from "../src/engine.ts";
import { randomWorld } from "../src/testkit.ts";

test("a 12-member run reports the interpolated Lorenz curve, not the rounded one", async () => {
  const result = await runEngine(randomWorld({ seed: 1, members: 12, minors: false }), { seed: 1 });
  expect(result.runLog.fairness.eligibleMembers).toBe(12);
  expect(result.runLog.fairness.membersWithProposal).toBe(6);
  expect(result.runLog.fairness.lorenz).toEqual([0, 0, 0, 0, 0, 0.12, 0.24, 0.42, 0.66, 1]);
});

test("a run with no proposals reports a flat zero Lorenz curve", async () => {
  const result = await runEngine(randomWorld({ seed: 42, members: 12, minors: false }), { seed: 42 });
  expect(result.proposals).toHaveLength(0);
  expect(result.runLog.fairness.lorenz).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
