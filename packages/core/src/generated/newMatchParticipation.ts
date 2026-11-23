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

/** Story: Match only where I have agreed to take part / Keep the seat's role when another member takes it (spec/newMatchParticipation.md) */
//@ pure
export function replacementCanTakeRole(receiving: boolean, contributes: boolean): boolean {
  return !(receiving && contributes);
}

/** Story: Match only where I have agreed to take part / Keep the seat's role when another member takes it (spec/newMatchParticipation.md) */
//@ pure
export function lawReceivingReplacementCannotContribute(contributes: boolean): boolean {
  //@ ensures \result === true
  return replacementCanTakeRole(true, contributes) === !contributes;
}

/** Story: Match only where I have agreed to take part / A refused draft does not consume a matching slot (spec/newMatchParticipation.md) */
//@ pure
export function draftUsesMatchingSlot(created: boolean, closed: boolean): boolean {
  return created && !closed;
}

/** Story: Match only where I have agreed to take part / A refused draft does not consume a matching slot (spec/newMatchParticipation.md) */
//@ pure
export function reviewDraftWasUnsent(closedFromReview: boolean, contacted: boolean): boolean {
  return closedFromReview && !contacted;
}

/** Story: Match only where I have agreed to take part / A refused draft does not consume a matching slot (spec/newMatchParticipation.md) */
//@ pure
export function lawOpenReviewKeepsItsDuplicateLock(contacted: boolean): boolean {
  //@ ensures \result === true
  return !reviewDraftWasUnsent(false, contacted);
}

/** Story: Match only where I have agreed to take part / A refused draft does not consume a matching slot (spec/newMatchParticipation.md) */
//@ pure
export function lawClosedDraftLeavesMatchingSlot(created: boolean): boolean {
  //@ ensures \result === true
  return !draftUsesMatchingSlot(created, true);
}
