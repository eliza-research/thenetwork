// GENERATED from spec/monthlyGatheringRsvp.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
export const gatheringNewcomerMs: number = 604800000;
/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
export const gatheringIsolationMs: number = 2592000000;

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpWindow(approved: boolean, sameRevision: boolean, isWithdrawal: boolean, approvedAt: number, startAt: number, endAt: number, receivedAt: number, handledAt: number): boolean {
  return approved && sameRevision && 0 < approvedAt && approvedAt <= receivedAt && receivedAt <= handledAt && handledAt < (isWithdrawal ? endAt : startAt);
}

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpAttendanceAllowed(currentOwner: boolean, adult: boolean, localMember: boolean, activeParticipant: boolean): boolean {
  return currentOwner && adult && localMember && activeParticipant;
}

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpNeedsListingCheck(publishedListing: boolean, withdrawing: boolean, beforeStart: boolean): boolean {
  return publishedListing && !withdrawing && beforeStart;
}

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringRequiresApproval(sameRevision: boolean, isWithdrawal: boolean, approvedAt: number, startAt: number, endAt: number, receivedAt: number, handledAt: number): boolean {
  //@ ensures \result === true
  return !gatheringRsvpWindow(false, sameRevision, isWithdrawal, approvedAt, startAt, endAt, receivedAt, handledAt);
}

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringMinorCannotAttend(currentOwner: boolean, localMember: boolean, activeParticipant: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRsvpAttendanceAllowed(currentOwner, false, localMember, activeParticipant);
}

/** Story: Choose how to attend the monthly gathering / Only the exact approved gathering accepts a fresh RSVP (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringWithdrawalDoesNotDependOnListing(publishedListing: boolean, beforeStart: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRsvpNeedsListingCheck(publishedListing, true, beforeStart);
}

/** Story: Choose how to attend the monthly gathering / Each member owns one RSVP and withdrawal wins a tie (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpReplaces(saved: boolean, sameTurn: boolean, storedAt: number, newAt: number, withdrawing: boolean, reserved: boolean): boolean {
  return !saved || (!sameTurn && (newAt > storedAt || (newAt === storedAt && withdrawing && reserved)));
}

/** Story: Choose how to attend the monthly gathering / Each member owns one RSVP and withdrawal wins a tie (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpHasSeat(alreadyReserved: boolean, reservedCount: number, capacity: number): boolean {
  return alreadyReserved || (0 <= reservedCount && reservedCount < capacity);
}

/** Story: Choose how to attend the monthly gathering / Each member owns one RSVP and withdrawal wins a tie (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringCannotReplayRsvp(storedAt: number, newAt: number, withdrawing: boolean, reserved: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRsvpReplaces(true, true, storedAt, newAt, withdrawing, reserved);
}

/** Story: Choose how to attend the monthly gathering / Each member owns one RSVP and withdrawal wins a tie (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringCapacityDoesNotOverbook(reservedCount: number, capacity: number): boolean {
  //@ ensures \result === true
  return !gatheringRsvpHasSeat(false, reservedCount, capacity) || reservedCount < capacity;
}

/** Story: Choose how to attend the monthly gathering / The private roster uses current eligibility and separate grouping consent (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpRosterAllowed(approved: boolean, sameRevision: boolean, approvedAt: number, endsAt: number, now: number): boolean {
  return approved && sameRevision && 0 < approvedAt && approvedAt <= now && now < endsAt;
}

/** Story: Choose how to attend the monthly gathering / The private roster uses current eligibility and separate grouping consent (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringRsvpGroupingAllowed(attending: boolean, groupingConsent: boolean, currentlyEligible: boolean): boolean {
  return attending && groupingConsent && currentlyEligible;
}

/** Story: Choose how to attend the monthly gathering / The private roster uses current eligibility and separate grouping consent (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringAttendanceIsNotGroupingConsent(attending: boolean, currentlyEligible: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRsvpGroupingAllowed(attending, false, currentlyEligible);
}

/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringPriorityNewcomer(joinedAt: number, now: number): boolean {
  return 0 <= joinedAt && joinedAt <= now && exact_monthlyGatheringRsvp(now - joinedAt) <= gatheringNewcomerMs;
}

/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringPriorityIsolated(joinedAt: number, lastParticipationAt: number, hasUpcoming: boolean, now: number): boolean {
  return 0 <= joinedAt && exact_monthlyGatheringRsvp(now - joinedAt) > gatheringNewcomerMs && !hasUpcoming && (lastParticipationAt < 0 || exact_monthlyGatheringRsvp(now - lastParticipationAt) > gatheringIsolationMs);
}

/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
//@ pure
export function gatheringInvitationPriority(eligible: boolean, newcomer: boolean, isolated: boolean, pendingSecondEncounter: boolean): number {
  return eligible ? exact_monthlyGatheringRsvp(exact_monthlyGatheringRsvp((newcomer ? 1 : 0) + (isolated ? 1 : 0)) + (pendingSecondEncounter ? 1 : 0)) : -1;
}

/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringNewcomerIsNotIsolated(joinedAt: number, lastParticipationAt: number, hasUpcoming: boolean, now: number): boolean {
  //@ ensures \result === true
  return !gatheringPriorityNewcomer(joinedAt, now) || !gatheringPriorityIsolated(joinedAt, lastParticipationAt, hasUpcoming, now);
}

/** Story: Choose how to attend the monthly gathering / Priority suggests whom staff should consider first (spec/monthlyGatheringRsvp.md) */
//@ pure
export function lawGatheringPriorityRequiresEligibility(newcomer: boolean, isolated: boolean, pendingSecondEncounter: boolean): boolean {
  //@ ensures \result === true
  return gatheringInvitationPriority(false, newcomer, isolated, pendingSecondEncounter) < 0;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_monthlyGatheringRsvp(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
