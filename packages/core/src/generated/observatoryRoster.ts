// GENERATED from spec/observatoryRoster.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: F35 — Inspect a member's experience as staff / A held meeting needs two attendees (spec/observatoryRoster.md) */
export const heldMeetingMinimum: number = 2;

/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function replacementRosterMode(recordedRoster: boolean, outgoingSeat: boolean, incomingAlreadyListed: boolean): string {
  return recordedRoster ? "recorded" : (outgoingSeat ? "substitute" : (incomingAlreadyListed ? "retain" : "append"));
}

/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function lawReplacementPrefersRecorded(outgoingSeat: boolean, incomingAlreadyListed: boolean): boolean {
  //@ ensures \result === true
  return replacementRosterMode(true, outgoingSeat, incomingAlreadyListed) === "recorded";
}

/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function lawLegacyBackfillAddsOnce(incomingAlreadyListed: boolean): boolean {
  //@ ensures \result === true
  return replacementRosterMode(false, false, incomingAlreadyListed) === (incomingAlreadyListed ? "retain" : "append");
}

/** Story: F35 — Inspect a member's experience as staff / A probe closure keeps the final alternate evidence (spec/observatoryRoster.md) */
//@ pure
export function closedProbeUpdate(terminal: boolean, recordedAlternates: boolean): boolean {
  return !terminal || recordedAlternates;
}

/** Story: F35 — Inspect a member's experience as staff / A probe closure keeps the final alternate evidence (spec/observatoryRoster.md) */
//@ pure
export function lawClosedReplayWithoutRosterKeepsTerminal(terminal: boolean): boolean {
  //@ ensures \result === true
  return closedProbeUpdate(terminal, false) === !terminal;
}

/** Story: F35 — Inspect a member's experience as staff / A held meeting needs two attendees (spec/observatoryRoster.md) */
//@ pure
export function observatoryMeetingHeld(attendees: number): boolean {
  return attendees >= heldMeetingMinimum;
}

/** Story: F35 — Inspect a member's experience as staff / A held meeting needs two attendees (spec/observatoryRoster.md) */
//@ pure
export function lawOneAttendeeIsNotAHeldMeeting(attendees: number): boolean {
  //@ ensures \result === true
  return !(attendees <= 1) || !observatoryMeetingHeld(attendees);
}

/** Story: F35 — Inspect a member's experience as staff / Reviewed offers contribute to a member's proposal activity after approval (spec/observatoryRoster.md) */
//@ pure
export function observatoryProposalCounts(reviewed: boolean, approved: boolean, invalidated: boolean, published: boolean): boolean {
  return !reviewed || (approved && (!invalidated || published));
}

/** Story: F35 — Inspect a member's experience as staff / Reviewed offers contribute to a member's proposal activity after approval (spec/observatoryRoster.md) */
//@ pure
export function lawPendingReviewCannotAddProposal(approved: boolean, invalidated: boolean, published: boolean): boolean {
  //@ ensures \result === true
  return !(!approved) || !observatoryProposalCounts(true, approved, invalidated, published);
}

/** Story: F35 — Inspect a member's experience as staff / A due cancelled booking remains in completion (spec/observatoryRoster.md) */
//@ pure
export function observatoryCompletionBooking(bookingStage: string, hasStart: boolean, start: number, now: number): boolean {
  return hasStart && start <= now && (bookingStage === "SCHEDULED" || bookingStage === "COMPLETED" || bookingStage === "FEEDBACK_COLLECTED" || bookingStage === "ABANDONED" || bookingStage === "CANCELLED");
}

/** Story: F35 — Inspect a member's experience as staff / A due cancelled booking remains in completion (spec/observatoryRoster.md) */
//@ pure
export function lawFutureBookingCannotCountForCompletion(bookingStage: string, hasStart: boolean, start: number, now: number): boolean {
  //@ ensures \result === true
  return !(start > now) || !observatoryCompletionBooking(bookingStage, hasStart, start, now);
}
