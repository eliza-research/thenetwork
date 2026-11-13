// GENERATED from spec/datingRadius.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny



/** Story: Find a date within both travel limits / A meeting market must be available to both members (spec/datingRadius.md:9) */
//@ pure
export function sharedDatingMarket(inFirst: boolean, inSecond: boolean, listed: boolean): boolean {
  return inFirst && inSecond && listed;
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md:18) */
//@ pure
export function withinMutualRadius(miles: number, margin: number, firstLimit: number, secondLimit: number): boolean {
  return miles + margin <= firstLimit && miles + margin <= secondLimit;
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md:18) */
//@ pure
export function lawRadiusMutual(miles: number, margin: number, firstLimit: number, secondLimit: number): boolean {
  //@ ensures \result === true
  return !withinMutualRadius(miles, margin, firstLimit, secondLimit) || (miles + margin <= firstLimit && miles + margin <= secondLimit);
}

/** Story: Find a date within both travel limits / The distance and margin must fit both members' limits (spec/datingRadius.md:18) */
//@ pure
export function lawPairDecisionSymmetric(miles: number, margin: number, firstLimit: number, secondLimit: number): boolean {
  //@ ensures \result === true
  return withinMutualRadius(miles, margin, firstLimit, secondLimit) === withinMutualRadius(miles, margin, secondLimit, firstLimit);
}
