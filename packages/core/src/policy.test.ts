import { expect, test } from "bun:test";
import { ADULT_AGE, canBeMatched, canJoin, isMinor, MIN_MEMBER_AGE } from "./index.ts";

test("age policy: 13 to join, 18 to be matched, unknown fails closed", () => {
  expect(MIN_MEMBER_AGE).toBe(13);
  expect(ADULT_AGE).toBe(18);
  expect([12, 13, 17, 18].map(canJoin)).toEqual([false, true, true, true]);
  expect([12, 13, 17, 18].map(isMinor)).toEqual([true, true, true, false]);
  expect([12, 13, 17, 18, 40].map(canBeMatched)).toEqual([false, false, false, true, true]);
  for (const bad of [undefined, null, NaN, -1, "20", Infinity]) {
    expect(canJoin(bad)).toBe(false);
    expect(isMinor(bad)).toBe(true);
    expect(canBeMatched(bad)).toBe(false);
  }
});
