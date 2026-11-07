// The amounts of the ledger and the lever clamps as pure functions, proved with LemmaScript. This file
// imports nothing. Reals model the numbers: rounding (ledger.ts round) and NaN are outside the proof, and
// capitalConfigProblems checks the config ranges the proofs require.

/** A credit after anti-gaming: never above its base, and it fits the room left in the period (or is 0). */
export function creditAmount(base: number, pairMult: number, catMult: number, periodCap: number, inPeriod: number): number {
  //@ verify
  //@ type base real
  //@ type pairMult real
  //@ type catMult real
  //@ type periodCap real
  //@ type inPeriod real
  //@ type \result real
  //@ requires base > 0.0 && 0.0 < pairMult && pairMult <= 1.0 && 0.0 < catMult && catMult <= 1.0
  //@ ensures \result >= 0.0
  //@ ensures \result <= base
  //@ ensures inPeriod + \result <= periodCap || \result === 0.0
  const want = base * pairMult * catMult, left = periodCap - inPeriod;
  if (left <= 0) return 0 * base;
  return want < left ? want : left;
}

/** The category multiplier, in (0, 1]. */
export function catMultOf(nCat: number, softN: number): number {
  //@ verify
  //@ type softN real
  //@ type \result real
  //@ requires nCat >= 0 && softN > 0.0
  //@ ensures 0.0 < \result && \result <= 1.0
  return 1 / (1 + nCat / softN);
}

/** The effort tier from three rising thresholds. Below the first it is 0, the floor. */
export function tierOf(balance: number, a: number, b: number, c: number): number {
  //@ verify
  //@ type balance real
  //@ type a real
  //@ type b real
  //@ type c real
  //@ requires a < b && b < c
  //@ ensures 0 <= \result && \result <= 3
  //@ ensures balance < a ==> \result === 0
  //@ ensures balance >= c ==> \result === 3
  return balance >= c ? 3 : balance >= b ? 2 : balance >= a ? 1 : 0;
}

export interface VouchCfg { base: number; perGood: number; maxBonus: number; perLost: number; max: number; }

/** Invites per period: at most the configured max, never below 0, whatever the history. */
export function capacity(v: VouchCfg, good: number, lost: number): number {
  //@ verify
  //@ requires v.base >= 0 && v.perGood >= 0 && v.maxBonus >= 0 && v.perLost >= 0 && v.max >= 0 && good >= 0 && lost >= 0
  //@ ensures 0 <= \result && \result <= v.max
  return Math.max(0, Math.min(v.max, v.base + Math.min(v.maxBonus, good * v.perGood) - lost * v.perLost));
}

export interface ReachCfg { base: number; perSessions: number; step: number; max: number; }
export interface Reach { max: number; reservedForLowExposure: number; }

/** Organizing reach: at most the configured max; every slot above the base is reserved for low exposure. */
export function reachOf(r: ReachCfg, sessions: number): Reach {
  //@ verify
  //@ requires r.perSessions > 0 && r.step >= 0 && r.base >= 0 && r.max >= r.base && sessions >= 0
  //@ ensures \result.max <= r.max
  //@ ensures \result.reservedForLowExposure >= 0
  //@ ensures \result.max >= r.base ==> \result.reservedForLowExposure === \result.max - r.base
  const max = Math.min(r.max, r.base + Math.floor(sessions / r.perSessions) * r.step);
  return { max, reservedForLowExposure: Math.max(0, max - r.base) };
}
