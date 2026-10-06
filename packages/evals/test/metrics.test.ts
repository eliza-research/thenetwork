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

// Reference values below were computed independently (closed forms / scipy / R conventions).
describe("metrics against known reference values", () => {
  test("F1 equals the harmonic mean and 2TP/(2TP+FP+FN)", () => {
    // 6 TP, 2 FP, 3 FN, 9 TN
    const pred = [...Array(6).fill(true), ...Array(2).fill(true), ...Array(3).fill(false), ...Array(9).fill(false)];
    const gold = [...Array(6).fill(true), ...Array(2).fill(false), ...Array(3).fill(true), ...Array(9).fill(false)];
    const c = classification(pred, gold);
    expect(c.precision).toBeCloseTo(0.75);
    expect(c.recall).toBeCloseTo(2 / 3);
    expect(c.f1).toBeCloseTo((2 * 6) / (2 * 6 + 2 + 3)); // 12/17 = 0.70588
    expect(c.accuracy).toBeCloseTo(15 / 20);
  });
  test("AUC equals the brute-force pairwise probability (ties = 1/2) on random data", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let rep = 0; rep < 20; rep++) {
      const n = 30 + rep;
      const scores = Array.from({ length: n }, () => Math.round(rnd() * 10) / 10); // many ties
      const gold = Array.from({ length: n }, () => rnd() < 0.4);
      if (!gold.some(Boolean) || gold.every(Boolean)) continue;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (!gold[i] || gold[j]) continue;
        den++; num += scores[i]! > scores[j]! ? 1 : scores[i] === scores[j] ? 0.5 : 0;
      }
      expect(auc(scores, gold)).toBeCloseTo(num / den, 10);
    }
    // sklearn.metrics.roc_auc_score([0,0,1,1],[0.1,0.4,0.35,0.8]) = 0.75
    expect(auc([0.1, 0.4, 0.35, 0.8], [false, false, true, true])).toBeCloseTo(0.75);
  });
  test("Cohen's kappa: textbook examples", () => {
    const build = (a: number, b: number, c: number, d: number) => {
      const A: boolean[] = [], B: boolean[] = [];
      const add = (k: number, x: boolean, y: boolean) => { for (let i = 0; i < k; i++) { A.push(x); B.push(y); } };
      add(a, true, true); add(b, true, false); add(c, false, true); add(d, false, false);
      return [A, B] as const;
    };
    // Wikipedia example: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no -> po=0.7, pe=0.5, kappa=0.4
    expect(cohensKappa(...build(20, 5, 10, 15))).toBeCloseTo(0.4);
    // Wikipedia second example: 45/15/25/15 -> kappa = 0.1304
    expect(cohensKappa(...build(45, 15, 25, 15))).toBeCloseTo(0.1304, 4);
    // Perfect disagreement on a balanced set -> -1
    expect(cohensKappa([true, false, true, false], [false, true, false, true])).toBeCloseTo(-1);
    // Symmetric in its arguments
    const [A, B] = build(7, 3, 11, 9);
    expect(cohensKappa(A, B)).toBeCloseTo(cohensKappa(B, A));
  });
  test("exact McNemar matches the binomial tail (scipy.stats.binomtest, two-sided)", () => {
    // binomtest(3, 15, 0.5).pvalue = 0.03515625
    expect(mcnemar(3, 12)).toBeCloseTo(0.03515625, 10);
    expect(mcnemar(12, 3)).toBeCloseTo(0.03515625, 10);
    // binomtest(1, 6, 0.5).pvalue = 0.21875
    expect(mcnemar(1, 5)).toBeCloseTo(0.21875, 10);
    // binomtest(7, 20, 0.5).pvalue = 0.263176...
    expect(mcnemar(7, 13)).toBeCloseTo(0.26317596, 7);
    // Stays finite and sensible far beyond 2^1024.
    const big = mcnemar(1000, 1000);
    expect(big).toBe(1);
    const skew = mcnemar(400, 700);
    expect(Number.isFinite(skew)).toBe(true);
    expect(skew).toBeGreaterThan(0);
    expect(skew).toBeLessThan(1e-15);
  });
  test("Wilson interval reference values", () => {
    // statsmodels proportion_confint(0, 10, method="wilson") = (0, 0.2775)
    const [lo0, hi0] = wilson(0, 10);
    expect(lo0).toBeCloseTo(0, 6);
    expect(hi0).toBeCloseTo(0.2775, 4);
    // proportion_confint(81, 263, method="wilson") = (0.2553, 0.3662)
    const [lo, hi] = wilson(81, 263);
    expect(lo).toBeCloseTo(0.2553, 3);
    expect(hi).toBeCloseTo(0.3662, 3);
  });
});
