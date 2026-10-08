import { expect, test } from "bun:test";
import { ADULT_AGE, canBeMatched, canJoin, effectiveAge, isMinor, MIN_MEMBER_AGE } from "./index.ts";

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

test("implausible ages are unknown and fail closed; effectiveAge takes the lowest valid age (core-5)", () => {
  for (const bad of [121, 150, 1e9]) {
    expect(canJoin(bad)).toBe(false);
    expect(canBeMatched(bad)).toBe(false);
  }
  expect(effectiveAge(25, 15)).toBe(15);
  expect(effectiveAge(25, undefined, NaN, 150)).toBe(25);
  expect(effectiveAge(undefined, NaN)).toBeUndefined();
  expect(canBeMatched(effectiveAge(30, 16))).toBe(false);
});
