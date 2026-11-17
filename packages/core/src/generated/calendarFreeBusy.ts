// GENERATED from spec/calendarFreeBusy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my authorized calendar to choose a time / A known busy interval excludes the slot and incomplete coverage cannot make it free (spec/calendarFreeBusy.md) */
export type CalendarSignal = "CalendarUnknown" | "CalendarBusy" | "CalendarFree";

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
export const calendarCoverageMaxMs: number = exact_calendarFreeBusy(8 * 86400000);
/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
export const calendarBusyIntervalLimit: number = 256;
/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
export const calendarSchedulingPurpose: string = "network-scheduling-free-busy-v1";
/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
export const calendarOwnerPath: string = "/internal/calendar-scheduling-owner";
/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
export const calendarPreloadPath: string = "/api/internal/network/calendar-scheduling";
/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
export const calendarAuthorityLifetimeMs: number = exact_calendarFreeBusy(30 * 1000);
/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
export const calendarSource: string = "google_calendar";
/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
export const calendarObservationMaxAgeMs: number = exact_calendarFreeBusy(5 * 60000);

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function calendarCoverageAllowed(start: number, end: number, busyCount: number): boolean {
  return start >= 0 && start < end && exact_calendarFreeBusy(end - start) <= calendarCoverageMaxMs && busyCount >= 0 && busyCount <= calendarBusyIntervalLimit;
}

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function calendarIntervalWithin(outerStart: number, outerEnd: number, start: number, end: number): boolean {
  return outerStart <= start && start < end && end <= outerEnd;
}

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function calendarGrantCurrent(localOptIn: boolean, eligibleOwner: boolean, connectionCurrent: boolean, exactScope: boolean, grantedAt: number, expiresAt: number, now: number): boolean {
  return localOptIn && eligibleOwner && connectionCurrent && exactScope && grantedAt >= 0 && grantedAt <= now && now < expiresAt;
}

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function calendarObservationFresh(observedAt: number, now: number): boolean {
  return observedAt >= 0 && observedAt <= now && exact_calendarFreeBusy(now - observedAt) < calendarObservationMaxAgeMs;
}

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function lawCalendarNeedsLocalConsent(eligibleOwner: boolean, connectionCurrent: boolean, exactScope: boolean, grantedAt: number, expiresAt: number, now: number): boolean {
  //@ ensures \result === true
  return !calendarGrantCurrent(false, eligibleOwner, connectionCurrent, exactScope, grantedAt, expiresAt, now);
}

/** Story: Use my authorized calendar to choose a time / Read only current anonymous intervals for the exact authorized connection (spec/calendarFreeBusy.md) */
//@ pure
export function calendarObservationCurrent(exactScope: boolean, anonymous: boolean, grantedAt: number, observedAt: number, now: number): boolean {
  return exactScope && anonymous && grantedAt <= observedAt && calendarObservationFresh(observedAt, now);
}

/** Story: Use my authorized calendar to choose a time / A known busy interval excludes the slot and incomplete coverage cannot make it free (spec/calendarFreeBusy.md) */
//@ pure
export function calendarIntervalsOverlap(slotStart: number, slotEnd: number, busyStart: number, busyEnd: number): boolean {
  return slotStart < slotEnd && busyStart < busyEnd && busyStart < slotEnd && slotStart < busyEnd;
}

/** Story: Use my authorized calendar to choose a time / A known busy interval excludes the slot and incomplete coverage cannot make it free (spec/calendarFreeBusy.md) */
//@ pure
export function calendarSignal(valid: boolean, overlapsBusy: boolean, completeCoverage: boolean): CalendarSignal {
  return !valid ? "CalendarUnknown" : (overlapsBusy ? "CalendarBusy" : (completeCoverage ? "CalendarFree" : "CalendarUnknown"));
}

/** Story: Use my authorized calendar to choose a time / A known busy interval excludes the slot and incomplete coverage cannot make it free (spec/calendarFreeBusy.md) */
//@ pure
export function lawCalendarIncompleteCoverageIsNeverFree(valid: boolean, overlapsBusy: boolean): boolean {
  //@ ensures \result === true
  return calendarSignal(valid, overlapsBusy, false) !== "CalendarFree";
}

/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
//@ pure
export function calendarBridgeProofCurrent(signed: boolean, exactRequest: boolean, exactOwner: boolean, issuedAt: number, expiresAt: number, now: number): boolean {
  return signed && exactRequest && exactOwner && issuedAt >= 0 && issuedAt <= now && now < expiresAt && exact_calendarFreeBusy(expiresAt - issuedAt) <= calendarAuthorityLifetimeMs;
}

/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
//@ pure
export function calendarBridgeOwnerAllowed(currentAdult: boolean, localOptIn: boolean, exactCanonicalMember: boolean): boolean {
  return currentAdult && localOptIn && exactCanonicalMember;
}

/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
//@ pure
export function calendarPreferenceMayApply(incomingAt: number, previousAt: number, requestedOn: boolean, previouslyEnabled: boolean): boolean {
  return incomingAt >= 0 && (incomingAt > previousAt || (incomingAt === previousAt && !requestedOn && previouslyEnabled));
}

/** Story: Use my authorized calendar to choose a time / Exchange fresh proofs for one member of one app (spec/calendarFreeBusy.md) */
//@ pure
export function lawCalendarBridgeProofNeedsExactOwner(signed: boolean, exactRequest: boolean, issuedAt: number, expiresAt: number, now: number): boolean {
  //@ ensures \result === true
  return !calendarBridgeProofCurrent(signed, exactRequest, false, issuedAt, expiresAt, now);
}

/** Story: Use my authorized calendar to choose a time / A scheduling read uses only the seats still involved in that work (spec/calendarFreeBusy.md) */
//@ pure
export function calendarPreloadSeatAllowed(status: string, booked: boolean, pendingLateSeat: boolean): boolean {
  return status !== "unavailable" && status !== "no" && status !== "dropped" && (!booked || status === "yes" || pendingLateSeat);
}

/** Story: Use my authorized calendar to choose a time / A scheduling read uses only the seats still involved in that work (spec/calendarFreeBusy.md) */
//@ pure
export function calendarDirectTurnReadsBooked(status: string, askerPending: boolean, rescheduling: boolean): boolean {
  const local_0 = !rescheduling && askerPending;
  return calendarPreloadSeatAllowed(status, true, local_0) && (local_0 || rescheduling);
}

/** Story: Use my authorized calendar to choose a time / A scheduling read uses only the seats still involved in that work (spec/calendarFreeBusy.md) */
//@ pure
export function lawCalendarDoesNotReadRetiredSeat(booked: boolean, pendingLateSeat: boolean): boolean {
  //@ ensures \result === true
  return !calendarPreloadSeatAllowed("dropped", booked, pendingLateSeat);
}

/** Story: Use my authorized calendar to choose a time / A scheduling read uses only the seats still involved in that work (spec/calendarFreeBusy.md) */
//@ pure
export function lawCalendarDirectTurnNeedsOwnSeat(status: string, askerPending: boolean, rescheduling: boolean): boolean {
  //@ ensures \result === true
  return !calendarDirectTurnReadsBooked(status, askerPending, rescheduling) || ((!rescheduling && askerPending) || (rescheduling && status === "yes"));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_calendarFreeBusy(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
