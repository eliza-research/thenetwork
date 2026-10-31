// Reproduces a median-computation defect in slopMetrics (packages/sim/src/apps/slop/metrics.ts).
// timeToFirstDate.medianDays took the upper-middle element of an even-length sorted array instead
// of averaging the two middle elements, unlike the median() used in peon, friends and judge metrics.
import { describe, expect, it } from "bun:test";
import { createSlopWorld, type FlowRecord } from "../src/apps/slop/world.ts";
import { isSafe } from "../src/apps/slop/oracle.ts";
import { slopMetrics } from "../src/apps/slop/metrics.ts";

describe("slopMetrics timeToFirstDate.medianDays", () => {
  it("averages the two middle first-date days for an even-sized cohort", () => {
    const world = createSlopWorld({ seed: 1, perCity: 20, weeks: 4 });
    const real = world.personas.filter(isSafe);
    expect(real.length).toBeGreaterThanOrEqual(4);
    const [r0, r1, r2, r3] = real;

    const date = (key: string, a: string, b: string, day: number): FlowRecord => ({
      key, week: 1, first: a, partner: b, city: "nyc", activity: "coffee", options: [],
      stage: "date", firstYes: true, partnerYes: true, mutualYes: true, revealed: true,
      filterViolation: false,
      outcome: { ea: 0.5, eb: 0.5, quality: 0.5, good: false, wantsSecondA: false, wantsSecondB: false, bothWantSecond: false },
      good: false, secondDate: false, harms: [], declaredMinor: false, day,
    });

    // Four real members get a first date; their first-date days sort to [10, 10, 30, 30].
    const flows: FlowRecord[] = [
      date("k1", r0!.id, r1!.id, 10),
      date("k2", r2!.id, r3!.id, 30),
    ];

    const m = slopMetrics({ world, flows, matcher: "test" });
    // True median of [10, 10, 30, 30] is (10 + 30) / 2 = 20, not the upper-middle element 30.
    expect(m.timeToFirstDate.medianDays).toBe(20);
  });
});
