// GENERATED from spec/capitalLevers.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Use my past contributions without changing who can match with me / Effort uses four tiers (spec/capitalLevers.md:9) */
export type EffortBand = "Baseline" | "First" | "Second" | "Highest";
/** Story: Use my past contributions without changing who can match with me / Earned organizing reach reserves the extra slots for low exposure (spec/capitalLevers.md:41) */
export interface ReachAllowance { max: number; reservedForLowExposure: number }


/** Story: Use my past contributions without changing who can match with me / Effort uses four tiers (spec/capitalLevers.md:9) */
//@ pure
export function capitalEffortBand(balance: number, firstThreshold: number, secondThreshold: number, highestThreshold: number): EffortBand {
  return balance >= highestThreshold ? "Highest" : (balance >= secondThreshold ? "Second" : (balance >= firstThreshold ? "First" : "Baseline"));
}

/** Story: Use my past contributions without changing who can match with me / Vouch capacity stays within its configured limits (spec/capitalLevers.md:23) */
//@ pure
export function vouchCapacityFromCounts(good: number, lost: number, base: number, perGood: number, perLost: number, maxBonus: number, maximum: number): number {
  const earned: number = good * perGood;
  const bonus: number = earned < maxBonus ? earned : maxBonus;
  const total: number = base + bonus - lost * perLost;
  const capped: number = total < maximum ? total : maximum;
  return capped > 0 ? capped : 0;
}

/** Story: Use my past contributions without changing who can match with me / Vouch capacity stays within its configured limits (spec/capitalLevers.md:23) */
//@ pure
export function lawVouchCapacityIsBounded(good: number, lost: number, base: number, perGood: number, perLost: number, maxBonus: number, maximum: number): boolean {
  //@ ensures \result === true
  return !(maximum >= 0) || (vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) >= 0 && vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) <= maximum);
}

/** Story: Use my past contributions without changing who can match with me / Earned organizing reach reserves the extra slots for low exposure (spec/capitalLevers.md:41) */
//@ pure
export function reachFromBands(bands: number, base: number, perBand: number, maximum: number): ReachAllowance {
  const reach: number = base + bands * perBand;
  const capped: number = reach < maximum ? reach : maximum;
  return { max: capped, reservedForLowExposure: capped > base ? capped - base : 0 };
}
