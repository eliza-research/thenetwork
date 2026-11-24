import { expect, test } from "vitest";
import { lorenz } from "../src/policy.ts";

test("equal exposure follows every point of the equality diagonal, including small cohorts", () => {
  const diagonal = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  expect(lorenz([3])).toEqual(diagonal);
  expect(lorenz([3, 3])).toEqual(diagonal);
  expect(lorenz([2, 2, 2])).toEqual(diagonal);
});

test("unequal exposure interpolates the sorted curve without changing endpoints or rounding", () => {
  expect(lorenz([4, 0], 4)).toEqual([0, 0, 0.5, 1]);
  expect(lorenz([3, 1], 3)).toEqual([0.1667, 0.5, 1]);
  expect(lorenz([1, 2, 3], 3)).toEqual([0.1667, 0.5, 1]);
  expect(lorenz([0, 0], 4)).toEqual([0, 0, 0, 0]);
  expect(lorenz([], 3)).toEqual([0, 0, 0]);
});
