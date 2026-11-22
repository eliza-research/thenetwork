// GENERATED from spec/newMatchParticipation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Match only where I have agreed to take part / Recheck the member and category before a new contact (spec/newMatchParticipation.md) */
//@ pure
export function newMatchParticipationAllowed(paused: boolean, activeAccount: boolean): boolean {
  return !paused && activeAccount;
}

/** Story: Match only where I have agreed to take part / Recheck the member and category before a new contact (spec/newMatchParticipation.md) */
//@ pure
export function newMatchCategoryAllowed(categoryEnabled: boolean, romance: boolean, romanceOptIn: boolean): boolean {
  return categoryEnabled && (!romance || romanceOptIn);
}

/** Story: Match only where I have agreed to take part / Recheck the member and category before a new contact (spec/newMatchParticipation.md) */
//@ pure
export function lawPausedMatchingStopsNewContact(activeAccount: boolean): boolean {
  //@ ensures \result === true
  return !newMatchParticipationAllowed(true, activeAccount);
}

/** Story: Match only where I have agreed to take part / Recheck the member and category before a new contact (spec/newMatchParticipation.md) */
//@ pure
export function lawNewRomanceNeedsSeparateOptIn(categoryEnabled: boolean): boolean {
  //@ ensures \result === true
  return !newMatchCategoryAllowed(categoryEnabled, true, false);
}
