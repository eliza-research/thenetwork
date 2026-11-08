// Small score steps, proved with LemmaScript over ideal reals (no NaN, no rounding). Import-free.
// Quality arithmetic, not safety: bounds that the rest of the engine relies on. The harmonic mean and
// the calibrator are the shipping functions, moved here unchanged except for `realZero` (below).

/** Smaller of two numbers. */
export function fmin(a: number, b: number): number {
  //@ verify
  //@ type a real
  //@ type b real
  //@ type \result real
  //@ ensures \result <= a && \result <= b
  //@ ensures \result === a || \result === b
  return a < b ? a : b;
}

/** Larger of two numbers. */
export function fmax(a: number, b: number): number {
  //@ verify
  //@ type a real
  //@ type b real
  //@ type \result real
  //@ ensures \result >= a && \result >= b
  //@ ensures \result === a || \result === b
  return a > b ? a : b;
}

/** Beta-smoothed acceptance estimate: always a probability. */
export function acceptanceEstimate(yes: number, n: number, prior: number, strength: number): number {
  //@ verify
  //@ type yes real
  //@ type n real
  //@ type prior real
  //@ type strength real
  //@ type \result real
  //@ requires 0.0 <= yes && yes <= n && strength > 0.0 && 0.0 <= prior && prior <= 1.0
  //@ ensures 0.0 <= \result && \result <= 1.0
  return (yes + prior * strength) / (n + strength);
}

/** One step of the exposure debt: never above twice the cap. `floor` is 0 at the call site. */
export function debtStep(prior: number, rel: number, got: number, cap: number, floor: number): number {
  //@ verify
  //@ type prior real
  //@ type rel real
  //@ type got real
  //@ type cap real
  //@ type floor real
  //@ type \result real
  //@ requires floor <= cap * 2.0
  //@ ensures floor <= \result && \result <= cap * 2.0
  return fmin(cap * 2, fmax(floor, prior + rel - got));
}

/** Net value of a configuration. */
export function netValueOf(pos: number, neg: number, norm: number, confidence: number): number {
  //@ verify
  //@ type pos real
  //@ type neg real
  //@ type norm real
  //@ type confidence real
  //@ type \result real
  //@ requires norm > 0.0
  return ((pos - neg) / norm) * confidence;
}

/**
 * 0 as a real. LemmaScript types a bare `0` as an integer, and a real-typed branch cannot return one;
 * 0.5 - 0.5 is exactly +0, so callers return the same number as before.
 */
export function realZero(): number {
  //@ verify
  //@ type \result real
  //@ ensures \result === 0.0
  return 0.5 - 0.5;
}

/**
 * Harmonic mean: punishes lopsided matches (reciprocal recommendation, RECON). 0 for an empty list or
 * when any value is at or below 0; positive when all are positive. The sum runs left to right from 0,
 * as the reduce it replaces did, so the result is the same number.
 */
export function harmonic(xs: number[]): number {
  //@ verify
  //@ type xs real[]
  //@ type \result real
  //@ ensures \result >= 0.0
  //@ ensures xs.length > 0 && forall(i: nat, i < xs.length ==> xs[i] > 0.0) ==> \result > 0.0
  //@ ensures exists(i: nat, i < xs.length && xs[i] <= 0.0) ==> \result === 0.0
  if (xs.length === 0) return realZero();
  let inv = realZero();
  let i = 0;
  while (i < xs.length) {
    //@ type i nat
    //@ type inv real
    //@ invariant i <= xs.length
    //@ invariant forall(j: nat, j < i ==> xs[j] > 0.0)
    //@ invariant i > 0 ==> inv > 0.0
    //@ invariant i === 0 ==> inv === 0.0
    //@ decreases xs.length - i
    const x = xs[i]!;
    if (x <= 0) return realZero();
    inv = inv + 1 / x;
    i = i + 1;
  }
  return xs.length / inv;
}

/**
 * Piecewise-linear calibrator (attention.ts knotCalibrator): `knots` are (score, P(worthwhile)); linear
 * in between, flat outside. When every knot value is a probability, so is the result.
 */
export function interpolate(knots: [number, number][], x: number): number {
  //@ verify
  //@ type knots real[][]
  //@ type x real
  //@ type \result real
  //@ requires forall(i: nat, i < knots.length ==> knots[i].length === 2)
  //@ ensures knots.length > 0 && forall(i: nat, i < knots.length ==> 0.0 <= knots[i][1] && knots[i][1] <= 1.0) ==> 0.0 <= \result && \result <= 1.0
  if (!knots.length) return x;
  if (x <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i++) {
    //@ invariant 1 <= i && i <= knots.length
    //@ invariant x > knots[i - 1][0]
    const [x1, y1] = knots[i]!, [x0, y0] = knots[i - 1]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return knots[knots.length - 1]![1];
}
