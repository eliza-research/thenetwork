// GENERATED from spec/bookedGroupReplacement.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Get a fresh invitation after an underfilled booking closes / An accepted withdrawal can start recovery after the old booking closes (spec/bookedGroupReplacement.md) */
export interface RecoverySource { ownWithdrawal: boolean; future: boolean; originalOrdinaryPlan: boolean; approved: boolean; acceptedAndTold: boolean; remainingBooked: number; quorum: number }

/** Story: Get a fresh invitation after an underfilled booking closes / An accepted withdrawal can start recovery after the old booking closes (spec/bookedGroupReplacement.md) */
export const eligibleSource: RecoverySource = { ownWithdrawal: true, future: true, originalOrdinaryPlan: true, approved: true, acceptedAndTold: true, remainingBooked: 2, quorum: 3 };

/** Story: Get a fresh invitation after an underfilled booking closes / An accepted withdrawal can start recovery after the old booking closes (spec/bookedGroupReplacement.md) */
//@ pure
export function canTryGroupReplacement(source: RecoverySource): boolean {
  return source.ownWithdrawal && source.future && source.originalOrdinaryPlan && source.approved && source.acceptedAndTold && source.remainingBooked === 2 && source.quorum === 3;
}

/** Story: Get a fresh invitation after an underfilled booking closes / An accepted withdrawal can start recovery after the old booking closes (spec/bookedGroupReplacement.md) */
//@ pure
export function lawRecoveryRequiresAPreStartWithdrawal(source: RecoverySource): boolean {
  //@ ensures \result === true
  return !canTryGroupReplacement(source) || (source.ownWithdrawal && source.future && source.acceptedAndTold);
}

/** Story: Get a fresh invitation after an underfilled booking closes / A replacement uses a current reviewed alternate and a viable slot (spec/bookedGroupReplacement.md) */
//@ pure
export function mayOfferReviewedAlternate(reviewed: boolean, onCurrentBench: boolean, onCurrentAlternates: boolean, previouslyInvolved: boolean): boolean {
  return reviewed && onCurrentBench && onCurrentAlternates && !previouslyInvolved;
}

/** Story: Get a fresh invitation after an underfilled booking closes / A replacement uses a current reviewed alternate and a viable slot (spec/bookedGroupReplacement.md) */
//@ pure
export function viableReplacementSlot(start: number, originalStart: number, earliestStart: number, latestStart: number, currentVenueAndRoster: boolean): boolean {
  return start >= originalStart && start >= earliestStart && start <= latestStart && currentVenueAndRoster;
}

/** Story: Get a fresh invitation after an underfilled booking closes / A replacement uses a current reviewed alternate and a viable slot (spec/bookedGroupReplacement.md) */
//@ pure
export function lawAnEarlierSlotCannotReplaceTheBooking(start: number, originalStart: number, earliestStart: number, latestStart: number, currentVenueAndRoster: boolean): boolean {
  //@ ensures \result === true
  return !viableReplacementSlot(start, originalStart, earliestStart, latestStart, currentVenueAndRoster) || start >= originalStart;
}

/** Story: Get a fresh invitation after an underfilled booking closes / The next plan needs fresh review and all three separate acceptances (spec/bookedGroupReplacement.md) */
//@ pure
export function recoveryPlanCanProceed(sourceClosed: boolean, currentRosterAndSlot: boolean, beforeDeadline: boolean): boolean {
  return sourceClosed && currentRosterAndSlot && beforeDeadline;
}

/** Story: Get a fresh invitation after an underfilled booking closes / The next plan needs fresh review and all three separate acceptances (spec/bookedGroupReplacement.md) */
//@ pure
export function replacementAnswerAllowed(ownAnswer: boolean, probeDelivered: boolean, answerAt: number, sentAt: number): boolean {
  return ownAnswer && probeDelivered && answerAt >= sentAt;
}

/** Story: Get a fresh invitation after an underfilled booking closes / The next plan needs fresh review and all three separate acceptances (spec/bookedGroupReplacement.md) */
//@ pure
export function bookReplacementPlan(approved: boolean, freshAcceptances: number, seated: number): boolean {
  return approved && freshAcceptances === 3 && seated === 3;
}

/** Story: Get a fresh invitation after an underfilled booking closes / The next plan needs fresh review and all three separate acceptances (spec/bookedGroupReplacement.md) */
//@ pure
export function lawAnswerNeedsItsDeliveredReplacement(ownAnswer: boolean, answerAt: number, sentAt: number): boolean {
  //@ ensures \result === true
  return !replacementAnswerAllowed(ownAnswer, false, answerAt, sentAt);
}

/** Story: Get a fresh invitation after an underfilled booking closes / The next plan needs fresh review and all three separate acceptances (spec/bookedGroupReplacement.md) */
//@ pure
export function lawReplacementNeedsFreshReviewAndQuorum(approved: boolean, freshAcceptances: number, seated: number): boolean {
  //@ ensures \result === true
  return !bookReplacementPlan(approved, freshAcceptances, seated) || (approved && freshAcceptances === 3 && seated === 3);
}
