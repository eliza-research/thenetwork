import { expect, test } from "bun:test";
import { SimClock } from "../src/clock.ts";

test("SimClock rejects non-finite times (core-22): NaN used to poison every later timestamp", () => {
  const c = new SimClock(1000);
  for (const bad of [NaN, Infinity, -Infinity]) {
    expect(() => c.advance(bad)).toThrow("finite");
    expect(() => c.set(bad)).toThrow("finite");
    expect(() => new SimClock(bad)).toThrow("finite");
  }
  expect(c.now()).toBe(1000);
  c.advance(5);
  c.set(2000);
  expect(c.now()).toBe(2000);
  expect(() => c.advance(-1)).toThrow("backwards");
});
