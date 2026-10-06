import { describe, expect, test } from "bun:test";
import { auc, brier, classification, cohensKappa, confusion, mae, mcnemar, percentile, wilson } from "../src/metrics.ts";

describe("metrics", () => {
  test("confusion and classification", () => {
    const pred = [true, true, false, false, true];
    const gold = [true, false, false, true, true];
    expect(confusion(pred, gold)).toEqual({ tp: 2, fp: 1, tn: 1, fn: 1 });
    const c = classification(pred, gold);
    expect(c.accuracy).toBeCloseTo(3 / 5);
    expect(c.precision).toBeCloseTo(2 / 3);
    expect(c.recall).toBeCloseTo(2 / 3);
    expect(c.f1).toBeCloseTo(2 / 3);
    expect(classification([false, false], [false, false]).f1).toBe(0);
  });
  test("AUC: perfect, inverted, ties, and the Mann-Whitney definition", () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [true, true, false, false])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [true, true, false, false])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [true, false, true, false])).toBe(0.5);
    // pos {0.8,0.4}, neg {0.6,0.2}: pairs (0.8>0.6, 0.8>0.2, 0.4<0.6, 0.4>0.2) => 3/4
    expect(auc([0.8, 0.4, 0.6, 0.2], [true, true, false, false])).toBeCloseTo(0.75);
    expect(Number.isNaN(auc([0.1, 0.2], [true, true]))).toBe(true);
  });
  test("Brier and MAE", () => {
    expect(brier([1, 0], [true, false])).toBe(0);
    expect(brier([0.5, 0.5], [true, false])).toBeCloseTo(0.25);
    expect(brier([0.8], [false])).toBeCloseTo(0.64);
    expect(mae([0.2, 0.6], [0.4, 0.6])).toBeCloseTo(0.1);
  });
  test("Cohen's kappa", () => {
    expect(cohensKappa([true, false, true, false], [true, false, true, false])).toBe(1);
    // Classic 2x2: a=20 yes/yes, b=5 yes/no, c=10 no/yes, d=15 no/no -> kappa = 0.4
    const A: boolean[] = [], B: boolean[] = [];
    const add = (n: number, x: boolean, y: boolean) => { for (let i = 0; i < n; i++) { A.push(x); B.push(y); } };
    add(20, true, true); add(5, true, false); add(10, false, true); add(15, false, false);
    expect(cohensKappa(A, B)).toBeCloseTo(0.4);
    expect(cohensKappa([true, true], [true, true])).toBe(1);
  });
  test("percentile (nearest rank)", () => {
    const xs = [5, 1, 4, 2, 3];
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 95)).toBe(5);
    expect(percentile(xs, 0)).toBe(1);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
  test("Wilson interval and McNemar", () => {
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
    expect(mcnemar(0, 0)).toBe(1);
    expect(mcnemar(5, 5)).toBe(1);
    expect(mcnemar(10, 0)).toBeCloseTo(2 / 1024);
  });
});
