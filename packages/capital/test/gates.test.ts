import { describe, expect, test } from "bun:test";
import { attributable, launchGates, GATE_MIN_SEEDS, type Metrics } from "../experiments/run.ts";

/** Paired seeds where the levers change the V14 ratio by `diffs[i]`. */
const arms = (diffs: number[]) => {
  const m = (r: number) => ({ v14Ratio: r, v14Top: 0.6, v14Bottom: 0.6 * r, gaming: {}, partBottom: 1, partTop: 1 }) as unknown as Metrics;
  return { on: diffs.map(d => m(0.7 + d)), off: diffs.map(() => m(0.7)) };
};

describe("fairness gate (capital-13)", () => {
  test("a mean inside the bound with a wide CI fails", () => {
    const diffs = Array.from({ length: 32 }, (_, i) => (i % 2 ? 0.12 : -0.146)); // mean -0.013, se ~0.024
    const { on, off } = arms(diffs);
    const a = attributable(on, off);
    expect(a.diff).toBeGreaterThan(-0.02);
    expect(a.lower).toBeLessThan(-0.02);
    expect(a.ok).toBe(false);
    expect(launchGates(on, off).pass).toBe(false);
  });

  test("fewer than 32 seeds fail, however good the numbers", () => {
    const { on, off } = arms([0.01, 0.011]);
    expect(attributable(on, off).ok).toBe(false);
  });

  test("a tight CI above the bound with 32 seeds passes", () => {
    const { on, off } = arms(Array.from({ length: GATE_MIN_SEEDS }, (_, i) => -0.005 + (i % 2 ? 0.002 : -0.002)));
    expect(attributable(on, off).ok).toBe(true);
  });
});
