// GENERATED from spec/meetingReschedule.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
export type RescheduleDecision = "RejectVote" | "KeepOriginal" | "AwaitParticipants" | "CommitNewTime";

/** Story: Change the time only when everyone agrees / A request selects one future booking and one viable slot (spec/meetingReschedule.md) */
export const rescheduleDraftLifetimeMs: number = exact_meetingReschedule(24 * 3600000);

/** Story: Change the time only when everyone agrees / A request selects one future booking and one viable slot (spec/meetingReschedule.md) */
//@ pure
export function rescheduleDraftCurrent(bookingCurrent: boolean, exactOriginal: boolean, exactRoster: boolean, exactRevision: boolean, viableSlot: boolean, now: number, expiresAt: number): boolean {
  return bookingCurrent && exactOriginal && exactRoster && exactRevision && viableSlot && now < expiresAt;
}

/** Story: Change the time only when everyone agrees / A request selects one future booking and one viable slot (spec/meetingReschedule.md) */
//@ pure
export function rescheduleTimeEligible(now: number, originalAt: number, proposedAt: number, minimumLead: number, viable: boolean): boolean {
  return originalAt > now && proposedAt !== originalAt && minimumLead > 0 && exact_meetingReschedule(proposedAt - now) >= minimumLead && viable;
}

/** Story: Change the time only when everyone agrees / A request selects one future booking and one viable slot (spec/meetingReschedule.md) */
//@ pure
export function rescheduleDeadline(now: number, originalAt: number, proposedAt: number, minimumLead: number): number {
  const local_0 = exact_meetingReschedule(now + rescheduleDraftLifetimeMs);
  const local_1 = exact_meetingReschedule(proposedAt - minimumLead);
  const local_2 = originalAt < local_1 ? originalAt : local_1;
  return local_2 < local_0 ? local_2 : local_0;
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function rescheduleAnswerAfterReceipt(exactReceipt: boolean, acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  return exactReceipt && 0 <= acceptedAt && acceptedAt <= receivedAt && receivedAt <= handledAt;
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function lawStagedRescheduleOfferCannotAuthorizeAnswer(acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  //@ ensures \result === true
  return !rescheduleAnswerAfterReceipt(false, acceptedAt, receivedAt, handledAt);
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function lawEarlyRescheduleAnswerCannotCommit(acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  //@ ensures \result === true
  return !(receivedAt < acceptedAt) || !rescheduleAnswerAfterReceipt(true, acceptedAt, receivedAt, handledAt);
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function rescheduleVote(ownAnswer: boolean, currentOffer: boolean, exactRecipientOffer: boolean, repeated: boolean, accepted: boolean, yesAfter: number, rosterSize: number): RescheduleDecision {
  return !ownAnswer || !currentOffer || !exactRecipientOffer || repeated ? "RejectVote" : (!accepted ? "KeepOriginal" : (rosterSize >= 2 && yesAfter === rosterSize ? "CommitNewTime" : "AwaitParticipants"));
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function lawRescheduleNeedsEveryParticipant(ownAnswer: boolean, currentOffer: boolean, exactRecipientOffer: boolean, repeated: boolean, accepted: boolean, yesAfter: number, rosterSize: number): boolean {
  //@ ensures \result === true
  return !(rescheduleVote(ownAnswer, currentOffer, exactRecipientOffer, repeated, accepted, yesAfter, rosterSize) === "CommitNewTime") || (ownAnswer && currentOffer && exactRecipientOffer && !repeated && accepted && rosterSize >= 2 && yesAfter === rosterSize);
}

/** Story: Change the time only when everyone agrees / Only independent answers to the current offer can change the booking (spec/meetingReschedule.md) */
//@ pure
export function lawExpiredRescheduleCannotCommit(ownAnswer: boolean, exactRecipientOffer: boolean, repeated: boolean, accepted: boolean, yesAfter: number, rosterSize: number): boolean {
  //@ ensures \result === true
  return rescheduleVote(ownAnswer, false, exactRecipientOffer, repeated, accepted, yesAfter, rosterSize) !== "CommitNewTime";
}

/** Story: Change the time only when everyone agrees / The original booking notice belongs to the original confirmed seat (spec/meetingReschedule.md) */
//@ pure
export function originalBookingNoticeCurrent(scheduled: boolean, confirmedSeat: boolean, originalRevision: boolean, remainingMs: number): boolean {
  return scheduled && confirmedSeat && originalRevision && remainingMs > 0;
}

/** Story: Change the time only when everyone agrees / The original booking notice belongs to the original confirmed seat (spec/meetingReschedule.md) */
//@ pure
export function lawBookingStartEndsOriginalNotice(scheduled: boolean, confirmedSeat: boolean, originalRevision: boolean): boolean {
  //@ ensures \result === true
  return !originalBookingNoticeCurrent(scheduled, confirmedSeat, originalRevision, 0);
}

/** Story: Change the time only when everyone agrees / A named booking notice still needs every recorded seat (spec/meetingReschedule.md) */
//@ pure
export function bookingNoticeRosterCurrent(groupBooking: boolean, recordedRoster: boolean, includesRecipient: boolean, recordedSeatsConfirmed: boolean): boolean {
  return recordedRoster ? includesRecipient && recordedSeatsConfirmed : !groupBooking;
}

/** Story: Change the time only when everyone agrees / A named booking notice still needs every recorded seat (spec/meetingReschedule.md) */
//@ pure
export function lawWithdrawnSeatPreventsNotice(groupBooking: boolean, includesRecipient: boolean): boolean {
  //@ ensures \result === true
  return !bookingNoticeRosterCurrent(groupBooking, true, includesRecipient, false);
}

/** Story: Change the time only when everyone agrees / A named booking notice still needs every recorded seat (spec/meetingReschedule.md) */
//@ pure
export function lawUnboundGroupNoticeCannotSend(includesRecipient: boolean, recordedSeatsConfirmed: boolean): boolean {
  //@ ensures \result === true
  return !bookingNoticeRosterCurrent(true, false, includesRecipient, recordedSeatsConfirmed);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_meetingReschedule(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
