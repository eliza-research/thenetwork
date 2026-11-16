// GENERATED from spec/capitalLevers.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my past contributions without changing who can match with me / Effort uses four tiers (spec/capitalLevers.md) */
export type EffortBand = "Baseline" | "First" | "Second" | "Highest";
/** Story: Use my past contributions without changing who can match with me / Earned organizing reach reserves the extra slots for low exposure (spec/capitalLevers.md) */
export interface ReachAllowance { max: number; reservedForLowExposure: number }


/** Story: Use my past contributions without changing who can match with me / Effort uses four tiers (spec/capitalLevers.md) */
//@ pure
export function capitalEffortBand(balance: number, firstThreshold: number, secondThreshold: number, highestThreshold: number): EffortBand {
  return balance >= highestThreshold ? "Highest" : (balance >= secondThreshold ? "Second" : (balance >= firstThreshold ? "First" : "Baseline"));
}

/** Story: Use my past contributions without changing who can match with me / Vouch capacity stays within its configured limits (spec/capitalLevers.md) */
//@ pure
export function vouchCapacityFromCounts(good: number, lost: number, base: number, perGood: number, perLost: number, maxBonus: number, maximum: number): number {
  const local_0 = exact_capitalLevers(good * perGood);
  const local_1 = local_0 < maxBonus ? local_0 : maxBonus;
  const local_2 = exact_capitalLevers(exact_capitalLevers(base + local_1) - exact_capitalLevers(lost * perLost));
  const local_3 = local_2 < maximum ? local_2 : maximum;
  return local_3 > 0 ? local_3 : 0;
}

/** Story: Use my past contributions without changing who can match with me / Vouch capacity stays within its configured limits (spec/capitalLevers.md) */
//@ pure
export function lawVouchCapacityIsBounded(good: number, lost: number, base: number, perGood: number, perLost: number, maxBonus: number, maximum: number): boolean {
  //@ ensures \result === true
  return !(maximum >= 0) || (vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) >= 0 && vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) <= maximum);
}

/** Story: Use my past contributions without changing who can match with me / Earned organizing reach reserves the extra slots for low exposure (spec/capitalLevers.md) */
//@ pure
export function reachFromBands(bands: number, base: number, perBand: number, maximum: number): ReachAllowance {
  const local_4 = exact_capitalLevers(base + exact_capitalLevers(bands * perBand));
  const local_5 = local_4 < maximum ? local_4 : maximum;
  return { max: local_5, reservedForLowExposure: local_5 > base ? exact_capitalLevers(local_5 - base) : 0 };
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_capitalLevers(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
