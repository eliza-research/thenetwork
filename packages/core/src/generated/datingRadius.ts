// GENERATED from spec/datingRadius.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Find a date within both travel limits / Both members' current dating limits apply until reveal (spec/datingRadius.md) */
export interface CurrentSlopPair { adults: boolean; optedIn: boolean; safetyClear: boolean; complete: boolean; seeksMutually: boolean; agesFit: boolean; dealbreakersClear: boolean; radiusFits: boolean }


/** Story: Find a date within both travel limits / A meeting market must be available to both members (spec/datingRadius.md) */
//@ pure
export function sharedDatingMarket(inFirst: boolean, inSecond: boolean, listed: boolean): boolean {
  return inFirst && inSecond && listed;
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md) */
//@ pure
export function withinAdjustedRadius(adjustedMiles: number, firstLimit: number, secondLimit: number): boolean {
  return adjustedMiles <= firstLimit && adjustedMiles <= secondLimit;
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md) */
//@ pure
export function lawRadiusMutual(adjustedMiles: number, firstLimit: number, secondLimit: number): boolean {
  //@ ensures \result === true
  return !withinAdjustedRadius(adjustedMiles, firstLimit, secondLimit) || (adjustedMiles <= firstLimit && adjustedMiles <= secondLimit);
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md) */
//@ pure
export function lawPairDecisionSymmetric(adjustedMiles: number, firstLimit: number, secondLimit: number): boolean {
  //@ ensures \result === true
  return withinAdjustedRadius(adjustedMiles, firstLimit, secondLimit) === withinAdjustedRadius(adjustedMiles, secondLimit, firstLimit);
}

/** Story: Find a date within both travel limits / Both members' current dating limits apply until reveal (spec/datingRadius.md) */
//@ pure
export function slopPairConstraintsCurrent(pair: CurrentSlopPair): boolean {
  return pair.adults && pair.optedIn && pair.safetyClear && pair.complete && pair.seeksMutually && pair.agesFit && pair.dealbreakersClear && pair.radiusFits;
}

/** Story: Find a date within both travel limits / Both members' current dating limits apply until reveal (spec/datingRadius.md) */
//@ pure
export function slopPairContactAllowed(approved: boolean, pairCurrent: boolean, reveal: boolean, bothConsented: boolean): boolean {
  return approved && pairCurrent && (!reveal || bothConsented);
}

/** Story: Find a date within both travel limits / Both members' current dating limits apply until reveal (spec/datingRadius.md) */
//@ pure
export function lawSlopPairRevealNeedsCurrentConsent(approved: boolean, pairCurrent: boolean, bothConsented: boolean): boolean {
  //@ ensures \result === true
  return !slopPairContactAllowed(approved, pairCurrent, true, bothConsented) || (approved && pairCurrent && bothConsented);
}
