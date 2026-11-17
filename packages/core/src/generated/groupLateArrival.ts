// GENERATED from spec/groupLateArrival.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalMinimumRoster: number = 3;
/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalDeliveryPrefix: string = "group-late:";
/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalNotice: string = "Someone in your group is running late.";
/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalPairNotice: string = "The person you are meeting is running late.";
/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalLeadMs: number = exact_groupLateArrival(60 * 60000);
/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
export const lateArrivalGraceMs: number = exact_groupLateArrival(30 * 60000);

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalIsPair(groupOpportunity: boolean, groupPlan: boolean, participantCount: number): boolean {
  return !groupOpportunity && !groupPlan && participantCount === 2;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalRosterReady(pairBooking: boolean, bookedCount: number): boolean {
  return pairBooking ? bookedCount === 2 : bookedCount >= lateArrivalMinimumRoster;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalMayReport(signedDirect: boolean, exactReport: boolean, eligibleFrom: boolean, matchingMeetings: number, alreadyReported: boolean): boolean {
  return signedDirect && exactReport && eligibleFrom && matchingMeetings === 1 && !alreadyReported;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalWindow(untilStart: number): boolean {
  return untilStart <= lateArrivalLeadMs && untilStart > exact_groupLateArrival(0 - lateArrivalGraceMs);
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalBookingReceiptCurrent(positiveReceipt: boolean, bookingAt: number, checkedAt: number): boolean {
  return positiveReceipt && 0 <= bookingAt && bookingAt <= checkedAt;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalGroupCannotUsePairRoster(groupOpportunity: boolean, groupPlan: boolean): boolean {
  //@ ensures \result === true
  return !(groupOpportunity || groupPlan) || !lateArrivalRosterReady(lateArrivalIsPair(groupOpportunity, groupPlan, 2), 2);
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalPairNeedsBoth(bookedCount: number): boolean {
  //@ ensures \result === true
  return !lateArrivalRosterReady(true, bookedCount) || bookedCount === 2;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalBookingCurrent(scheduled: boolean, reviewed: boolean, logistics: boolean, bookedFrom: boolean, pairBooking: boolean, bookedCount: number, untilStart: number): boolean {
  return scheduled && reviewed && logistics && bookedFrom && lateArrivalRosterReady(pairBooking, bookedCount) && lateArrivalWindow(untilStart);
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalNeedsOneMeeting(signedDirect: boolean, exactReport: boolean, eligibleFrom: boolean, matchingMeetings: number): boolean {
  //@ ensures \result === true
  return !lateArrivalMayReport(signedDirect, exactReport, eligibleFrom, matchingMeetings, false) || matchingMeetings === 1;
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalReportTimeCurrent(untilStartAtReport: number, reportedAt: number, handledAt: number): boolean {
  return 0 <= reportedAt && reportedAt <= handledAt && lateArrivalWindow(untilStartAtReport);
}

/** Story: Tell the other booked participants I am running late / Relay one direct report for one current booked meeting (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalCannotPrecedeBookingReceipt(positiveReceipt: boolean, bookingAt: number, checkedAt: number): boolean {
  //@ ensures \result === true
  return !(checkedAt < bookingAt) || !lateArrivalBookingReceiptCurrent(positiveReceipt, bookingAt, checkedAt);
}

/** Story: Tell the other booked participants I am running late / Send only the fixed notice to each eligible booked recipient (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalText(pairBooking: boolean): string {
  return pairBooking ? lateArrivalPairNotice : lateArrivalNotice;
}

/** Story: Tell the other booked participants I am running late / Send only the fixed notice to each eligible booked recipient (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalMayDispatch(currentBooking: boolean, exactReport: boolean, exactMessage: boolean, bookedRecipient: boolean, differentRecipient: boolean, pairAllowed: boolean): boolean {
  return currentBooking && exactReport && exactMessage && bookedRecipient && differentRecipient && pairAllowed;
}

/** Story: Tell the other booked participants I am running late / Send only the fixed notice to each eligible booked recipient (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalNeverEchoes(currentBooking: boolean, exactReport: boolean, exactMessage: boolean, bookedRecipient: boolean, pairAllowed: boolean): boolean {
  //@ ensures \result === true
  return !lateArrivalMayDispatch(currentBooking, exactReport, exactMessage, bookedRecipient, false, pairAllowed);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_groupLateArrival(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
