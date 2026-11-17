// GENERATED from spec/calendarInvite.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Add my booked meeting to my calendar / The member asks for one current booking (spec/calendarInvite.md) */
export type CalendarChoice = "PickBooking" | "AskForBooking" | "NoBooking";

/** Story: Add my booked meeting to my calendar / A calendar link follows the booked revision and the current owner (spec/calendarInvite.md) */
export const calendarInviteLifetimeMs: number = exact_calendarInvite(15 * 60000);
/** Story: Add my booked meeting to my calendar / A calendar link follows the booked revision and the current owner (spec/calendarInvite.md) */
export const calendarInvitePath: string = "/api/calendar/invite";

/** Story: Add my booked meeting to my calendar / The member asks for one current booking (spec/calendarInvite.md) */
//@ pure
export function calendarMeetingEligible(currentAdult: boolean, scheduled: boolean, confirmedSeat: boolean, bookingTold: boolean, publicVenue: boolean, remainingMs: number): boolean {
  return currentAdult && scheduled && confirmedSeat && bookingTold && publicVenue && remainingMs > 0;
}

/** Story: Add my booked meeting to my calendar / The member asks for one current booking (spec/calendarInvite.md) */
//@ pure
export function calendarChoice(matches: number): CalendarChoice {
  return matches === 1 ? "PickBooking" : (matches > 1 ? "AskForBooking" : "NoBooking");
}

/** Story: Add my booked meeting to my calendar / The member asks for one current booking (spec/calendarInvite.md) */
//@ pure
export function lawCalendarNeedsBookingNotice(currentAdult: boolean, scheduled: boolean, confirmedSeat: boolean, publicVenue: boolean, remainingMs: number): boolean {
  //@ ensures \result === true
  return !calendarMeetingEligible(currentAdult, scheduled, confirmedSeat, false, publicVenue, remainingMs);
}

/** Story: Add my booked meeting to my calendar / A calendar link follows the booked revision and the current owner (spec/calendarInvite.md) */
//@ pure
export function calendarDownloadAllowed(currentBooking: boolean, sameStart: boolean, sameRevision: boolean, now: number, expiresAt: number): boolean {
  return currentBooking && sameStart && sameRevision && now < expiresAt;
}

/** Story: Add my booked meeting to my calendar / A calendar link follows the booked revision and the current owner (spec/calendarInvite.md) */
//@ pure
export function lawCalendarLinkExpires(currentBooking: boolean, sameStart: boolean, sameRevision: boolean, expiresAt: number): boolean {
  //@ ensures \result === true
  return !calendarDownloadAllowed(currentBooking, sameStart, sameRevision, expiresAt, expiresAt);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_calendarInvite(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
