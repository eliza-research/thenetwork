// GENERATED from spec/probeDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type UnlinkedCancellation as opportunityLifecycle_UnlinkedCancellation, type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, groupCanContinue as opportunityLifecycle_groupCanContinue, acceptedProbeWithdrawalAllowed as opportunityLifecycle_acceptedProbeWithdrawalAllowed, bookedReplyDeclines as opportunityLifecycle_bookedReplyDeclines, stepRerollRequiresNewApproval as opportunityLifecycle_stepRerollRequiresNewApproval, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, acceptedProbeCanWithdraw as opportunityLifecycle_acceptedProbeCanWithdraw, lawAcceptedProbeWithdrawalNeedsExactMatch as opportunityLifecycle_lawAcceptedProbeWithdrawalNeedsExactMatch, bookedReplyCurrent as opportunityLifecycle_bookedReplyCurrent, initial as opportunityLifecycle_initial, unlinkedCancellation as opportunityLifecycle_unlinkedCancellation, lawSwapWithdrawalAloneDoesNotCancel as opportunityLifecycle_lawSwapWithdrawalAloneDoesNotCancel, closesForMinor as opportunityLifecycle_closesForMinor, canStartProbing as opportunityLifecycle_canStartProbing, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, startProbing as opportunityLifecycle_startProbing, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, releasesPartialAcceptance as opportunityLifecycle_releasesPartialAcceptance, canReroll as opportunityLifecycle_canReroll, reroll as opportunityLifecycle_reroll, lawPairLeftFromGroupNeedsFreshConsent as opportunityLifecycle_lawPairLeftFromGroupNeedsFreshConsent, lawBookedReplyRequiresCurrentConsent as opportunityLifecycle_lawBookedReplyRequiresCurrentConsent, upcomingCancellationEligible as opportunityLifecycle_upcomingCancellationEligible, lawUnlinkedCancellationNeedsOneMatch as opportunityLifecycle_lawUnlinkedCancellationNeedsOneMatch, lawNamedCancellationCanSelectWithPendingReply as opportunityLifecycle_lawNamedCancellationCanSelectWithPendingReply, lawAskedMinorClosesABookedOpportunity as opportunityLifecycle_lawAskedMinorClosesABookedOpportunity, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity, closesForBlock as opportunityLifecycle_closesForBlock, lawReleaseNeedsAContactedAcceptor as opportunityLifecycle_lawReleaseNeedsAContactedAcceptor, lawStartedBookingCannotBeSelected as opportunityLifecycle_lawStartedBookingCannotBeSelected, lawBlockClosesOnlyAnActivePair as opportunityLifecycle_lawBlockClosesOnlyAnActivePair } from "./opportunityLifecycle.ts";

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export type ProbePhase = "Queued" | "AwaitingReply" | "Available" | "Unavailable" | "OutsideProbe";
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export interface ParticipantProbe { phase: ProbePhase }
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export type ProbeTiming = "WaitForQuestion" | "WaitForWindow" | "CheckAvailability";
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export type ProbeAvailability = "ReadyToSend" | "ParticipantAway" | "NoCommonTime";
/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
export type ReplacementRoute = "IgnoreReplacement" | "CloseRequester" | "CloseManager" | "FindAlternate";
/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
export type NoAlternateRoute = "ContinueGroup" | "CloseWithoutAlternate";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openTurn"; first: boolean; firstAvailable: boolean }
  | { type: "usePriorIntent"; primed: boolean; contacted: boolean; needsTimes: boolean }
  | { type: "markUnavailable" }
  | { type: "recordReply"; agreed: boolean }
  | { type: "offerOtherTimes"; hasFreshTimes: boolean }
  | { type: "expireProbe"; expired: boolean; timeQuestion: boolean };

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export const questionHoldMs: number = exact_probeDispatch(24 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
export const probeResponseMs: number = exact_probeDispatch(26 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export const initial: ParticipantProbe = { phase: "Queued" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ParticipantProbe): boolean {
  return true;
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function openTurn(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "AwaitingReply" };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function probePending(participant: ParticipantProbe): boolean {
  return participant.phase === "Queued" || participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function usePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean, needsTimes: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "Available" };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function turnReached(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): boolean {
  return probePending(participant) && (first || firstAvailable);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function mayUsePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean): boolean {
  return probePending(participant) && primed && !contacted;
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function canOpenTurn(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): boolean {
  return participant.phase === "Queued" && turnReached(participant, first, firstAvailable);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function lawLaterTurnRequiresFirst(participant: ParticipantProbe): boolean {
  //@ ensures \result === true
  return !turnReached(participant, false, false);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function canUsePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean, needsTimes: boolean): boolean {
  return mayUsePriorIntent(participant, primed, contacted) && !needsTimes;
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function probeIsInvite(requester: boolean, hiringManager: boolean): boolean {
  return !(requester || hiringManager);
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function probeQuestionHoldUntil(askedAt: number): number {
  return exact_probeDispatch(askedAt + questionHoldMs);
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function needsProbeSend(participant: ParticipantProbe, contacted: boolean): boolean {
  return participant.phase === "AwaitingReply" && !contacted;
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function probeTiming(questionOpen: boolean, windowOpen: boolean): ProbeTiming {
  return questionOpen ? "WaitForQuestion" : (!windowOpen ? "WaitForWindow" : "CheckAvailability");
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function probeAvailability(present: boolean, commonTimeGone: boolean): ProbeAvailability {
  return !present ? "ParticipantAway" : (commonTimeGone ? "NoCommonTime" : "ReadyToSend");
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function canMarkUnavailable(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function markUnavailable(participant: ParticipantProbe): ParticipantProbe {
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function lawProbeWaitsForOpenQuestion(windowOpen: boolean): boolean {
  //@ ensures \result === true
  return probeTiming(true, windowOpen) === "WaitForQuestion";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function needsOtherTimes(offeredTimes: boolean, pickedTimes: boolean): boolean {
  return offeredTimes && !pickedTimes;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function probeExpiryDeadline(sent: boolean, responseDeadline: number, sendDeadline: number): number {
  return sent ? responseDeadline : sendDeadline;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function probeExpired(asOf: number, deadline: number): boolean {
  return asOf >= deadline;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function canRecordReply(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function recordReply(participant: ParticipantProbe, agreed: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: agreed ? "Available" : "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function shouldLookForOtherTimes(offeredTimes: boolean, pickedTimes: boolean, offeredAgain: boolean): boolean {
  return needsOtherTimes(offeredTimes, pickedTimes) && !offeredAgain;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function canOfferOtherTimes(participant: ParticipantProbe, hasFreshTimes: boolean): boolean {
  return participant.phase === "Available" && hasFreshTimes;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function offerOtherTimes(participant: ParticipantProbe, hasFreshTimes: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "AwaitingReply" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function canExpireProbe(participant: ParticipantProbe, expired: boolean): boolean {
  return participant.phase === "AwaitingReply" && expired;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function expireProbe(participant: ParticipantProbe, expired: boolean, timeQuestion: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: timeQuestion ? "Available" : "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function stepUnavailableNeverReopens(before: ParticipantProbe, after: ParticipantProbe): boolean {
  return !(before.phase === "Unavailable") || after.phase === "Unavailable";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function sometimesAgreed(participant: ParticipantProbe): boolean {
  return participant.phase === "Available";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function sometimesSettledNo(participant: ParticipantProbe): boolean {
  return participant.phase === "Unavailable";
}

/** Story: Hear about one reviewed opportunity at a time / A Slop answer follows acceptance of the exact question (spec/probeDispatch.md) */
//@ pure
export function slopProbeReplyCurrent(direct: boolean, transportAccepted: boolean, receivedAt: number, acceptedAt: number): boolean {
  return direct && transportAccepted && receivedAt >= acceptedAt;
}

/** Story: Hear about one reviewed opportunity at a time / A Slop answer follows acceptance of the exact question (spec/probeDispatch.md) */
//@ pure
export function lawSlopProbeNeedsAcceptance(direct: boolean, receivedAt: number, acceptedAt: number): boolean {
  //@ ensures \result === true
  return !slopProbeReplyCurrent(direct, false, receivedAt, acceptedAt);
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function mayTryAlternate(alternatesRemain: boolean, replaced: number): boolean {
  return alternatesRemain && replaced < 3;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function alternateAllowed(eligible: boolean, sameFirstName: boolean, conflict: boolean): boolean {
  return eligible && !sameFirstName && !conflict;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function replacementRoute(probing: boolean, requesterOut: boolean, managerOut: boolean): ReplacementRoute {
  return !probing ? "IgnoreReplacement" : (requesterOut ? "CloseRequester" : (managerOut ? "CloseManager" : "FindAlternate"));
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function groupMayRemainWithoutAlternate(group: boolean, remaining: number): boolean {
  return group && opportunityLifecycle_groupCanContinue(remaining);
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function noAlternateRoute(group: boolean, remaining: number): NoAlternateRoute {
  return group && remaining >= 3 ? "ContinueGroup" : "CloseWithoutAlternate";
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function lawOneToOneClosesWithoutAlternate(remaining: number): boolean {
  //@ ensures \result === true
  return !groupMayRemainWithoutAlternate(false, remaining);
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function lawRequiredParticipantCannotBeReplaced(probing: boolean, requesterOut: boolean, managerOut: boolean): boolean {
  //@ ensures \result === true
  return !(requesterOut || managerOut) || replacementRoute(probing, requesterOut, managerOut) !== "FindAlternate";
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function lawPairClosesWithoutAlternate(remaining: number): boolean {
  //@ ensures \result === true
  return noAlternateRoute(false, remaining) === "CloseWithoutAlternate";
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
//@ pure
export function lawGroupBelowThreeCloses(remaining: number): boolean {
  //@ ensures \result === true
  return !(remaining < 3) || noAlternateRoute(true, remaining) === "CloseWithoutAlternate";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ParticipantProbe, event: Event): boolean {
  if (event.type === "openTurn") return canOpenTurn(current, event.first, event.firstAvailable);
  if (event.type === "usePriorIntent") return canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes);
  if (event.type === "markUnavailable") return canMarkUnavailable(current);
  if (event.type === "recordReply") return canRecordReply(current);
  if (event.type === "offerOtherTimes") return canOfferOtherTimes(current, event.hasFreshTimes);
  if (event.type === "expireProbe") return canExpireProbe(current, event.expired);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ParticipantProbe, event: Event): ParticipantProbe {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openTurn") return canOpenTurn(current, event.first, event.firstAvailable) ? openTurn(current, event.first, event.firstAvailable) : current;
  if (event.type === "usePriorIntent") return canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes) ? usePriorIntent(current, event.primed, event.contacted, event.needsTimes) : current;
  if (event.type === "markUnavailable") return canMarkUnavailable(current) ? markUnavailable(current) : current;
  if (event.type === "recordReply") return canRecordReply(current) ? recordReply(current, event.agreed) : current;
  if (event.type === "offerOtherTimes") return canOfferOtherTimes(current, event.hasFreshTimes) ? offerOtherTimes(current, event.hasFreshTimes) : current;
  if (event.type === "expireProbe") return canExpireProbe(current, event.expired) ? expireProbe(current, event.expired, event.timeQuestion) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openTurn" && typeof raw.first === "boolean" && typeof raw.firstAvailable === "boolean") return { type: "openTurn", first: raw.first, firstAvailable: raw.firstAvailable };
  if (raw.type === "usePriorIntent" && typeof raw.primed === "boolean" && typeof raw.contacted === "boolean" && typeof raw.needsTimes === "boolean") return { type: "usePriorIntent", primed: raw.primed, contacted: raw.contacted, needsTimes: raw.needsTimes };
  if (raw.type === "markUnavailable") return { type: "markUnavailable" };
  if (raw.type === "recordReply" && typeof raw.agreed === "boolean") return { type: "recordReply", agreed: raw.agreed };
  if (raw.type === "offerOtherTimes" && typeof raw.hasFreshTimes === "boolean") return { type: "offerOtherTimes", hasFreshTimes: raw.hasFreshTimes };
  if (raw.type === "expireProbe" && typeof raw.expired === "boolean" && typeof raw.timeQuestion === "boolean") return { type: "expireProbe", expired: raw.expired, timeQuestion: raw.timeQuestion };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ParticipantProbe | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Queued" || raw.phase === "AwaitingReply" || raw.phase === "Available" || raw.phase === "Unavailable" || raw.phase === "OutsideProbe") && Object.keys(raw).length === 1)) return undefined;
  const parsed: ParticipantProbe = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ParticipantProbe {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_probeDispatch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
