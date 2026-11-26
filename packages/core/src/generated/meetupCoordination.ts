// GENERATED from spec/meetupCoordination.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
export interface ArrivalRelaySafeInput { senderAge: number; recipientAge: number; anyMinorInEvent: boolean; senderConfirmed: boolean; recipientConfirmed: boolean; blocked: boolean; panicTriggered: boolean; senderOptedOut: boolean; recipientOptedOut: boolean; minutesFromStart: number; alreadyMet: boolean; passedSafetyAndLeakCheck: boolean }
/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Promote a co-anchor or cancel cleanly on anchor drop or low T-24h quorum (spec/meetupCoordination.md) */
export interface AnchorFailoverInput { confirmedAnchors: number; backupNetworkMembers: number; totalConfirmed: number; hoursToStart: number; approvedExternalRsvps: number; totalNetworkMembers: number }
/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
export interface FollowupSlot { localHour: number; localMinute: number; nextDay: boolean }
/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
export interface FollowupSendInput { optedOut: boolean; inQuietHours: boolean; localHour: number; dailyProactiveCount: number; remindersSent: number; alreadyResponded: boolean }


/** Story: Coordinate safe on-site arrivals and backup pivots / Map relative meetup minutes to lifecycle phases (spec/meetupCoordination.md) */
//@ pure
export function meetupPhase(minutesFromStart: number): string {
  return minutesFromStart < -75 ? "before" : (minutesFromStart < -30 ? "pre_brief" : (minutesFromStart <= 45 ? "active_arrival" : "closed"));
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Map relative meetup minutes to lifecycle phases (spec/meetupCoordination.md) */
//@ pure
export function lawMeetupPhasePartition(minutesFromStart: number): boolean {
  //@ ensures \result === true
  const local_0 = meetupPhase(minutesFromStart);
  return (local_0 === "before" || local_0 === "pre_brief" || local_0 === "active_arrival" || local_0 === "closed") && (!(minutesFromStart < -75) || local_0 === "before") && (!(minutesFromStart >= -75 && minutesFromStart < -30) || local_0 === "pre_brief") && (!(minutesFromStart >= -30 && minutesFromStart <= 45) || local_0 === "active_arrival") && (!(minutesFromStart > 45) || local_0 === "closed");
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
//@ pure
export function canAttendEventOrCoattend(participantAge: number, anyMinorInGroup: boolean, isSoloSuggestion: boolean): boolean {
  return participantAge >= 13 && participantAge <= 120 && (isSoloSuggestion || (participantAge >= 18 && !anyMinorInGroup));
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
//@ pure
export function canRelayArrivalSafe(r: ArrivalRelaySafeInput): boolean {
  return !r.panicTriggered && !r.blocked && !r.anyMinorInEvent && r.senderAge >= 18 && r.senderAge <= 120 && r.recipientAge >= 18 && r.recipientAge <= 120 && r.senderConfirmed && r.recipientConfirmed && !r.senderOptedOut && !r.recipientOptedOut && meetupPhase(r.minutesFromStart) === "active_arrival" && !r.alreadyMet && r.passedSafetyAndLeakCheck;
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
//@ pure
export function lawNoMinorInAnyEventOrCoattend(participantAge: number, anyMinorInGroup: boolean): boolean {
  //@ ensures \result === true
  return !(participantAge < 18 || anyMinorInGroup) || !canAttendEventOrCoattend(participantAge, anyMinorInGroup, false);
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
//@ pure
export function lawPanicOrBlockImmediatelyHaltsRelay(r: ArrivalRelaySafeInput): boolean {
  //@ ensures \result === true
  return !(r.panicTriggered || r.blocked) || !canRelayArrivalSafe(r);
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Halt arrival relay immediately on panic, block, or any minor in the event (spec/meetupCoordination.md) */
//@ pure
export function lawNoMinorInArrivalRelayOrCoattend(r: ArrivalRelaySafeInput): boolean {
  //@ ensures \result === true
  return !(r.anyMinorInEvent || r.senderAge < 18 || r.recipientAge < 18) || !canRelayArrivalSafe(r);
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Escalate late arrivals at 12 minutes and free waiting attendees by 18 minutes (spec/meetupCoordination.md) */
//@ pure
export function noShowDecision(minutesAfterStart: number, someArrived: boolean, otherCheckedIn: boolean, pingSent: boolean, waitingNotified: boolean): string {
  return !someArrived || otherCheckedIn ? "none" : (minutesAfterStart >= 18 && !waitingNotified ? "notify_waiting" : (minutesAfterStart >= 12 && !pingSent ? "ping_late" : "none"));
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Escalate late arrivals at 12 minutes and free waiting attendees by 18 minutes (spec/meetupCoordination.md) */
//@ pure
export function lawNoShowNotifiesWaiterBy18m(minutesAfterStart: number, pingSent: boolean): boolean {
  //@ ensures \result === true
  return !(minutesAfterStart >= 18) || noShowDecision(minutesAfterStart, true, false, pingSent, false) === "notify_waiting";
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Escalate late arrivals at 12 minutes and free waiting attendees by 18 minutes (spec/meetupCoordination.md) */
//@ pure
export function lawNoShowSilentBefore12m(minutesAfterStart: number, someArrived: boolean, otherCheckedIn: boolean, pingSent: boolean, waitingNotified: boolean): boolean {
  //@ ensures \result === true
  return !(minutesAfterStart < 12) || noShowDecision(minutesAfterStart, someArrived, otherCheckedIn, pingSent, waitingNotified) === "none";
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Pivot to backup on closed or full venue, but quarantine only on closure (spec/meetupCoordination.md) */
//@ pure
export function shouldQuarantineVenue(venueReportedClosed: boolean, venueReportedFull: boolean): boolean {
  return venueReportedClosed;
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Pivot to backup on closed or full venue, but quarantine only on closure (spec/meetupCoordination.md) */
//@ pure
export function shouldPivotToBackupV2(venueReportedClosed: boolean, venueReportedFull: boolean, hasVerifiedBackup: boolean, minutesFromStart: number, alreadyPivoted: boolean): boolean {
  const local_1 = meetupPhase(minutesFromStart);
  return (venueReportedClosed || venueReportedFull) && hasVerifiedBackup && !alreadyPivoted && (local_1 === "pre_brief" || local_1 === "active_arrival");
}

/** Story: Coordinate safe on-site arrivals and backup pivots / Pivot to backup on closed or full venue, but quarantine only on closure (spec/meetupCoordination.md) */
//@ pure
export function lawVenueFullTriggersBackupPivotWithoutQuarantine(minutesFromStart: number): boolean {
  //@ ensures \result === true
  const local_2 = meetupPhase(minutesFromStart);
  return (!(local_2 === "pre_brief" || local_2 === "active_arrival") || shouldPivotToBackupV2(false, true, true, minutesFromStart, false)) && !shouldQuarantineVenue(false, true);
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Promote a co-anchor or cancel cleanly on anchor drop or low T-24h quorum (spec/meetupCoordination.md) */
//@ pure
export function anchorFailoverDecision(a: AnchorFailoverInput): string {
  return a.confirmedAnchors <= 0 ? (a.backupNetworkMembers >= 1 && a.totalConfirmed >= 3 ? "promote_co_anchor" : "cancel_cleanly") : (a.confirmedAnchors === 1 && a.hoursToStart <= 24 && a.approvedExternalRsvps < 3 && a.totalNetworkMembers < 3 ? "cancel_low_quorum" : "proceed");
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Promote a co-anchor or cancel cleanly on anchor drop or low T-24h quorum (spec/meetupCoordination.md) */
//@ pure
export function lawAnchorDropReassignedOrCancelled(a: AnchorFailoverInput): boolean {
  //@ ensures \result === true
  return !(a.confirmedAnchors <= 0) || (anchorFailoverDecision(a) === "promote_co_anchor" || anchorFailoverDecision(a) === "cancel_cleanly");
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Promote a co-anchor or cancel cleanly on anchor drop or low T-24h quorum (spec/meetupCoordination.md) */
//@ pure
export function lawQuorumOrCleanCancelBeforeCutoff(a: AnchorFailoverInput): boolean {
  //@ ensures \result === true
  return !(a.confirmedAnchors === 1 && a.hoursToStart <= 24 && a.approvedExternalRsvps < 3 && a.totalNetworkMembers < 3) || anchorFailoverDecision(a) === "cancel_low_quorum";
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
//@ pure
export function computeFollowupLocalHour(eventEndLocalHour: number): FollowupSlot {
  return eventEndLocalHour > 16 ? ({ localHour: 9, localMinute: 30, nextDay: true } as FollowupSlot) : (eventEndLocalHour < 7 ? ({ localHour: 9, localMinute: 30, nextDay: false } as FollowupSlot) : ({ localHour: exact_meetupCoordination(eventEndLocalHour + 2), localMinute: 0, nextDay: false } as FollowupSlot));
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
//@ pure
export function canSendFollowup(f: FollowupSendInput): boolean {
  return !f.optedOut && !f.inQuietHours && f.localHour >= 9 && f.localHour < 20 && f.dailyProactiveCount >= 0 && f.dailyProactiveCount < 3 && f.remindersSent >= 0 && f.remindersSent < 2 && !f.alreadyResponded;
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
//@ pure
export function lawFollowupNeverDuringQuietHoursOrOverCap(f: FollowupSendInput): boolean {
  //@ ensures \result === true
  return !canSendFollowup(f) || (!f.optedOut && !f.inQuietHours && f.localHour >= 9 && f.localHour < 20 && f.dailyProactiveCount < 3 && f.remindersSent < 2 && !f.alreadyResponded);
}

/** Story: Protect anchor failover, quorum cutoffs, and follow-up limits / Schedule follow-ups outside quiet hours and enforce opt-out and daily caps (spec/meetupCoordination.md) */
//@ pure
export function lawFollowupSlotAlwaysInSafeDayHours(eventEndLocalHour: number): boolean {
  //@ ensures \result === true
  const local_3: FollowupSlot = computeFollowupLocalHour(eventEndLocalHour);
  return !(eventEndLocalHour >= 0 && eventEndLocalHour <= 23) || (local_3.localHour >= 9 && local_3.localHour < 20 && (local_3.localMinute === 0 || local_3.localMinute === 30));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_meetupCoordination(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
