// Small score steps, proved with LemmaScript over ideal reals (no NaN, no rounding). Import-free.
// Quality arithmetic, not safety: bounds that the rest of the engine relies on.

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
