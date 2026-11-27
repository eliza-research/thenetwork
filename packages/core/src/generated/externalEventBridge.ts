// GENERATED from spec/externalEventBridge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity (spec/externalEventBridge.md) */
export interface PublishExternalEventInput { confirmedNetworkAnchors: number; reviewApproved: boolean; allParticipantsAdult: boolean; isPublicVenue: boolean; sourceSanctioned: boolean; hideGuestList: boolean; approvalRequired: boolean; externalCrowdDisclosed: boolean; plannedTotal: number; venueWalkInCapacity: number }
/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Approve an external RSVP only for an eligible screened adult within the cap (spec/externalEventBridge.md) */
export interface ApproveExternalEventRsvpInput { attendeeAge: number; banned: boolean; optedOut: boolean; held: boolean; currentApprovedExternal: number; approvedExternalCap: number; answeredScreeningQuestion: boolean }
/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Invite an external attendee to the Network only after a positive, safe completed event (spec/externalEventBridge.md) */
export interface InviteExternalEventAttendeeInput { eventCompleted: boolean; networkFeedbackPositive: boolean; safetyFlag: boolean; attendeeAge: number; optedOut: boolean; banned: boolean; alreadyMember: boolean; invitesSent: number; safeFollowupWindow: boolean }

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventSourceHostNative: number = 0;
/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventSourceOfficialApi: number = 1;
/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventSourceMemberSubmittedPublic: number = 2;
/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventMaxHeadcount: number = 15;
/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventT24Hours: number = 24;
/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
export const externalEventMinQuorum: number = 3;

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
//@ pure
export function isSanctionedExternalEventSource(sourceCode: number): boolean {
  return sourceCode === externalEventSourceHostNative || sourceCode === externalEventSourceOfficialApi || sourceCode === externalEventSourceMemberSubmittedPublic;
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Accept only sanctioned external event sources (spec/externalEventBridge.md) */
//@ pure
export function lawScrapedSourceRejected(sourceCode: number): boolean {
  //@ ensures \result === true
  return !(sourceCode < 0 || sourceCode > 2) || !isSanctionedExternalEventSource(sourceCode);
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity (spec/externalEventBridge.md) */
//@ pure
export function canPublishExternalEvent(req: PublishExternalEventInput): boolean {
  return req.confirmedNetworkAnchors >= 1 && req.reviewApproved && req.allParticipantsAdult && req.isPublicVenue && req.sourceSanctioned && req.hideGuestList && req.approvalRequired && req.externalCrowdDisclosed && req.venueWalkInCapacity >= 1 && req.plannedTotal >= req.confirmedNetworkAnchors && req.plannedTotal <= externalEventMaxHeadcount && req.plannedTotal <= req.venueWalkInCapacity;
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity (spec/externalEventBridge.md) */
//@ pure
export function lawPublishRequiresAnchorAndReview(confirmedNetworkAnchors: number, reviewApproved: boolean): boolean {
  //@ ensures \result === true
  const local_0 = canPublishExternalEvent(({ confirmedNetworkAnchors: confirmedNetworkAnchors, reviewApproved: reviewApproved, allParticipantsAdult: true, isPublicVenue: true, sourceSanctioned: true, hideGuestList: true, approvalRequired: true, externalCrowdDisclosed: true, plannedTotal: 8, venueWalkInCapacity: 12 } as PublishExternalEventInput));
  return !local_0 || (confirmedNetworkAnchors >= 1 && reviewApproved);
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity (spec/externalEventBridge.md) */
//@ pure
export function lawPublishRequiresHiddenGatedAndDisclosed(hideGuestList: boolean, approvalRequired: boolean, externalCrowdDisclosed: boolean): boolean {
  //@ ensures \result === true
  const local_1 = canPublishExternalEvent(({ confirmedNetworkAnchors: 1, reviewApproved: true, allParticipantsAdult: true, isPublicVenue: true, sourceSanctioned: true, hideGuestList: hideGuestList, approvalRequired: approvalRequired, externalCrowdDisclosed: externalCrowdDisclosed, plannedTotal: 8, venueWalkInCapacity: 12 } as PublishExternalEventInput));
  return !local_1 || (hideGuestList && approvalRequired && externalCrowdDisclosed);
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity (spec/externalEventBridge.md) */
//@ pure
export function lawPublishRespectsCapacityAndAdultPublicVenue(allParticipantsAdult: boolean, isPublicVenue: boolean, plannedTotal: number, venueWalkInCapacity: number): boolean {
  //@ ensures \result === true
  const local_2 = canPublishExternalEvent(({ confirmedNetworkAnchors: 1, reviewApproved: true, allParticipantsAdult: allParticipantsAdult, isPublicVenue: isPublicVenue, sourceSanctioned: true, hideGuestList: true, approvalRequired: true, externalCrowdDisclosed: true, plannedTotal: plannedTotal, venueWalkInCapacity: venueWalkInCapacity } as PublishExternalEventInput));
  return !local_2 || (allParticipantsAdult && isPublicVenue && plannedTotal <= externalEventMaxHeadcount && plannedTotal <= venueWalkInCapacity);
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Bound external RSVP overbooking to the venue walk-in capacity and 15-person ceiling (spec/externalEventBridge.md) */
//@ pure
export function computeApprovedExternalCap(networkConfirmed: number, venueWalkInCapacity: number, targetRoomSize: number): number {
  const local_3 = venueWalkInCapacity < externalEventMaxHeadcount ? venueWalkInCapacity : externalEventMaxHeadcount;
  const local_4 = exact_externalEventBridge(local_3 - networkConfirmed);
  const local_5 = exact_externalEventBridge(exact_externalEventBridge(targetRoomSize * 100) - exact_externalEventBridge(85 * networkConfirmed));
  const local_6 = local_5 > 0 ? quotient_externalEventBridge(exact_externalEventBridge(local_5 + 54), 55) : 0;
  return networkConfirmed < 0 || venueWalkInCapacity <= 0 || targetRoomSize <= 0 ? 0 : (networkConfirmed >= local_3 ? 0 : (local_5 <= 0 ? 0 : (local_6 > local_4 ? local_4 : local_6)));
}

/** Story: Ingest and publish only sanctioned, anchored, capacity-safe external events / Bound external RSVP overbooking to the venue walk-in capacity and 15-person ceiling (spec/externalEventBridge.md) */
//@ pure
export function lawApprovedCapBoundedAndNonNegative(networkConfirmed: number, venueWalkInCapacity: number, targetRoomSize: number): boolean {
  //@ ensures \result === true
  const local_7 = computeApprovedExternalCap(networkConfirmed, venueWalkInCapacity, targetRoomSize);
  return local_7 >= 0 && local_7 <= externalEventMaxHeadcount && (!(networkConfirmed >= 0 && networkConfirmed <= externalEventMaxHeadcount && networkConfirmed <= venueWalkInCapacity) || (exact_externalEventBridge(networkConfirmed + local_7) <= externalEventMaxHeadcount && exact_externalEventBridge(networkConfirmed + local_7) <= venueWalkInCapacity)) && (!(networkConfirmed >= externalEventMaxHeadcount || networkConfirmed >= venueWalkInCapacity) || local_7 === 0);
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Cancel when the anchor drops or when quorum stays too low at 24 hours before start (spec/externalEventBridge.md) */
//@ pure
export function evaluateExternalEventT24Quorum(confirmedNetworkAnchors: number, confirmedNetworkTotal: number, approvedExternalRsvps: number, hoursToStart: number): string {
  return confirmedNetworkAnchors <= 0 ? "cancel_no_anchor" : (hoursToStart <= externalEventT24Hours && confirmedNetworkTotal < externalEventMinQuorum && approvedExternalRsvps < externalEventMinQuorum ? "cancel_low_quorum" : "go");
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Cancel when the anchor drops or when quorum stays too low at 24 hours before start (spec/externalEventBridge.md) */
//@ pure
export function lawT24QuorumCancelsWithoutAnchorOrLowTurnout(confirmedNetworkAnchors: number, confirmedNetworkTotal: number, approvedExternalRsvps: number, hoursToStart: number): boolean {
  //@ ensures \result === true
  const local_8 = evaluateExternalEventT24Quorum(confirmedNetworkAnchors, confirmedNetworkTotal, approvedExternalRsvps, hoursToStart);
  return (!(confirmedNetworkAnchors <= 0) || local_8 === "cancel_no_anchor") && (!(confirmedNetworkAnchors >= 1 && hoursToStart <= externalEventT24Hours && confirmedNetworkTotal < externalEventMinQuorum && approvedExternalRsvps < externalEventMinQuorum) || local_8 === "cancel_low_quorum") && (!(local_8 === "go") || confirmedNetworkAnchors >= 1) && (!(local_8 === "go" && hoursToStart <= externalEventT24Hours) || (confirmedNetworkTotal >= externalEventMinQuorum || approvedExternalRsvps >= externalEventMinQuorum));
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Approve an external RSVP only for an eligible screened adult within the cap (spec/externalEventBridge.md) */
//@ pure
export function canApproveExternalEventRsvp(req: ApproveExternalEventRsvpInput): boolean {
  return req.attendeeAge >= 18 && req.attendeeAge <= 120 && !req.banned && !req.optedOut && !req.held && req.currentApprovedExternal >= 0 && req.approvedExternalCap > 0 && req.currentApprovedExternal < req.approvedExternalCap && req.answeredScreeningQuestion;
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Approve an external RSVP only for an eligible screened adult within the cap (spec/externalEventBridge.md) */
//@ pure
export function lawMinorOrBlockedNeverApprovedForExternalRsvp(attendeeAge: number, banned: boolean, optedOut: boolean, held: boolean): boolean {
  //@ ensures \result === true
  const local_9 = canApproveExternalEventRsvp(({ attendeeAge: attendeeAge, banned: banned, optedOut: optedOut, held: held, currentApprovedExternal: 0, approvedExternalCap: 5, answeredScreeningQuestion: true } as ApproveExternalEventRsvpInput));
  return !local_9 || (attendeeAge >= 18 && attendeeAge <= 120 && !banned && !optedOut && !held);
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Approve an external RSVP only for an eligible screened adult within the cap (spec/externalEventBridge.md) */
//@ pure
export function lawExternalRsvpRespectsCapAndScreening(currentApprovedExternal: number, approvedExternalCap: number, answeredScreeningQuestion: boolean): boolean {
  //@ ensures \result === true
  const local_10 = canApproveExternalEventRsvp(({ attendeeAge: 28, banned: false, optedOut: false, held: false, currentApprovedExternal: currentApprovedExternal, approvedExternalCap: approvedExternalCap, answeredScreeningQuestion: answeredScreeningQuestion } as ApproveExternalEventRsvpInput));
  return !local_10 || (currentApprovedExternal >= 0 && currentApprovedExternal < approvedExternalCap && answeredScreeningQuestion);
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Invite an external attendee to the Network only after a positive, safe completed event (spec/externalEventBridge.md) */
//@ pure
export function canInviteExternalEventAttendee(req: InviteExternalEventAttendeeInput): boolean {
  return req.eventCompleted && req.networkFeedbackPositive && !req.safetyFlag && req.attendeeAge >= 18 && req.attendeeAge <= 120 && !req.optedOut && !req.banned && !req.alreadyMember && req.invitesSent === 0 && req.safeFollowupWindow;
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Invite an external attendee to the Network only after a positive, safe completed event (spec/externalEventBridge.md) */
//@ pure
export function lawExternalEventInviteRequiresPositiveFeedbackAndZeroPriorInvites(eventCompleted: boolean, networkFeedbackPositive: boolean, safetyFlag: boolean, invitesSent: number): boolean {
  //@ ensures \result === true
  const local_11 = canInviteExternalEventAttendee(({ eventCompleted: eventCompleted, networkFeedbackPositive: networkFeedbackPositive, safetyFlag: safetyFlag, attendeeAge: 28, optedOut: false, banned: false, alreadyMember: false, invitesSent: invitesSent, safeFollowupWindow: true } as InviteExternalEventAttendeeInput));
  return !local_11 || (eventCompleted && networkFeedbackPositive && !safetyFlag && invitesSent === 0);
}

/** Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites / Invite an external attendee to the Network only after a positive, safe completed event (spec/externalEventBridge.md) */
//@ pure
export function lawExternalEventInviteBlocksMinorsAndOptedOut(attendeeAge: number, optedOut: boolean, banned: boolean, alreadyMember: boolean): boolean {
  //@ ensures \result === true
  const local_12 = canInviteExternalEventAttendee(({ eventCompleted: true, networkFeedbackPositive: true, safetyFlag: false, attendeeAge: attendeeAge, optedOut: optedOut, banned: banned, alreadyMember: alreadyMember, invitesSent: 0, safeFollowupWindow: true } as InviteExternalEventAttendeeInput));
  return !local_12 || (attendeeAge >= 18 && attendeeAge <= 120 && !optedOut && !banned && !alreadyMember);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_externalEventBridge(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_externalEventBridge(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
