// GENERATED from spec/currentPairRestrictions.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: A blocked or avoided pair stays apart / Use current app and saved pair restrictions throughout the flow (spec/currentPairRestrictions.md) */
//@ pure
export function currentPairAllowed(blocked: boolean, avoided: boolean): boolean {
  return !(blocked || avoided);
}

/** Story: A blocked or avoided pair stays apart / Use current app and saved pair restrictions throughout the flow (spec/currentPairRestrictions.md) */
//@ pure
export function welcomePairMayRank(compatible: boolean, sharesTime: boolean): boolean {
  return compatible && sharesTime;
}

/** Story: A blocked or avoided pair stays apart / Use current app and saved pair restrictions throughout the flow (spec/currentPairRestrictions.md) */
//@ pure
export function lawRestrictedPairCannotProceed(blocked: boolean, avoided: boolean): boolean {
  //@ ensures \result === true
  return !(blocked || avoided) || !currentPairAllowed(blocked, avoided);
}

/** Story: A blocked or avoided pair stays apart / Use current app and saved pair restrictions throughout the flow (spec/currentPairRestrictions.md) */
//@ pure
export function lawWelcomeRankingRequiresCommonTime(compatible: boolean): boolean {
  //@ ensures \result === true
  return !welcomePairMayRank(compatible, false);
}
