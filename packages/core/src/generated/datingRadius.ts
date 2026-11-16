// GENERATED from spec/datingRadius.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



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
