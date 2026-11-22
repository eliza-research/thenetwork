// GENERATED from spec/mutualConsentJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type ProbeTiming as probeDispatch_ProbeTiming, type ProbeAvailability as probeDispatch_ProbeAvailability, type ReplacementRoute as probeDispatch_ReplacementRoute, type ProbePhase as probeDispatch_ProbePhase, type NoAlternateRoute as probeDispatch_NoAlternateRoute, type ParticipantProbe as probeDispatch_ParticipantProbe, questionHoldMs as probeDispatch_questionHoldMs, probeResponseMs as probeDispatch_probeResponseMs, probeIsInvite as probeDispatch_probeIsInvite, probeQuestionHoldUntil as probeDispatch_probeQuestionHoldUntil, needsOtherTimes as probeDispatch_needsOtherTimes, probeExpiryDeadline as probeDispatch_probeExpiryDeadline, probeExpired as probeDispatch_probeExpired, slopProbeReplyCurrent as probeDispatch_slopProbeReplyCurrent, mayTryAlternate as probeDispatch_mayTryAlternate, alternateAllowed as probeDispatch_alternateAllowed, openTurn as probeDispatch_openTurn, needsProbeSend as probeDispatch_needsProbeSend, probeTiming as probeDispatch_probeTiming, probeAvailability as probeDispatch_probeAvailability, canMarkUnavailable as probeDispatch_canMarkUnavailable, markUnavailable as probeDispatch_markUnavailable, canRecordReply as probeDispatch_canRecordReply, recordReply as probeDispatch_recordReply, shouldLookForOtherTimes as probeDispatch_shouldLookForOtherTimes, initial as probeDispatch_initial, canOfferOtherTimes as probeDispatch_canOfferOtherTimes, offerOtherTimes as probeDispatch_offerOtherTimes, canExpireProbe as probeDispatch_canExpireProbe, expireProbe as probeDispatch_expireProbe, stepUnavailableNeverReopens as probeDispatch_stepUnavailableNeverReopens, sometimesAgreed as probeDispatch_sometimesAgreed, sometimesSettledNo as probeDispatch_sometimesSettledNo, lawSlopProbeNeedsAcceptance as probeDispatch_lawSlopProbeNeedsAcceptance, probePending as probeDispatch_probePending, replacementRoute as probeDispatch_replacementRoute, groupMayRemainWithoutAlternate as probeDispatch_groupMayRemainWithoutAlternate, noAlternateRoute as probeDispatch_noAlternateRoute, usePriorIntent as probeDispatch_usePriorIntent, turnReached as probeDispatch_turnReached, lawProbeWaitsForOpenQuestion as probeDispatch_lawProbeWaitsForOpenQuestion, lawOneToOneClosesWithoutAlternate as probeDispatch_lawOneToOneClosesWithoutAlternate, lawRequiredParticipantCannotBeReplaced as probeDispatch_lawRequiredParticipantCannotBeReplaced, lawPairClosesWithoutAlternate as probeDispatch_lawPairClosesWithoutAlternate, lawGroupBelowThreeCloses as probeDispatch_lawGroupBelowThreeCloses, mayUsePriorIntent as probeDispatch_mayUsePriorIntent, canOpenTurn as probeDispatch_canOpenTurn, lawLaterTurnRequiresFirst as probeDispatch_lawLaterTurnRequiresFirst, canUsePriorIntent as probeDispatch_canUsePriorIntent } from "./probeDispatch.ts";
import { type UnlinkedCancellation as opportunityLifecycle_UnlinkedCancellation, type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, groupCanContinue as opportunityLifecycle_groupCanContinue, acceptedProbeWithdrawalAllowed as opportunityLifecycle_acceptedProbeWithdrawalAllowed, bookedReplyDeclines as opportunityLifecycle_bookedReplyDeclines, stepRerollRequiresNewApproval as opportunityLifecycle_stepRerollRequiresNewApproval, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, acceptedProbeCanWithdraw as opportunityLifecycle_acceptedProbeCanWithdraw, lawAcceptedProbeWithdrawalNeedsExactMatch as opportunityLifecycle_lawAcceptedProbeWithdrawalNeedsExactMatch, bookedReplyCurrent as opportunityLifecycle_bookedReplyCurrent, initial as opportunityLifecycle_initial, unlinkedCancellation as opportunityLifecycle_unlinkedCancellation, lawSwapWithdrawalAloneDoesNotCancel as opportunityLifecycle_lawSwapWithdrawalAloneDoesNotCancel, closesForMinor as opportunityLifecycle_closesForMinor, canStartProbing as opportunityLifecycle_canStartProbing, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, startProbing as opportunityLifecycle_startProbing, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, releasesPartialAcceptance as opportunityLifecycle_releasesPartialAcceptance, canReroll as opportunityLifecycle_canReroll, reroll as opportunityLifecycle_reroll, lawPairLeftFromGroupNeedsFreshConsent as opportunityLifecycle_lawPairLeftFromGroupNeedsFreshConsent, lawBookedReplyRequiresCurrentConsent as opportunityLifecycle_lawBookedReplyRequiresCurrentConsent, upcomingCancellationEligible as opportunityLifecycle_upcomingCancellationEligible, lawUnlinkedCancellationNeedsOneMatch as opportunityLifecycle_lawUnlinkedCancellationNeedsOneMatch, lawNamedCancellationCanSelectWithPendingReply as opportunityLifecycle_lawNamedCancellationCanSelectWithPendingReply, lawAskedMinorClosesABookedOpportunity as opportunityLifecycle_lawAskedMinorClosesABookedOpportunity, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity, closesForBlock as opportunityLifecycle_closesForBlock, lawReleaseNeedsAContactedAcceptor as opportunityLifecycle_lawReleaseNeedsAContactedAcceptor, lawStartedBookingCannotBeSelected as opportunityLifecycle_lawStartedBookingCannotBeSelected, lawBlockClosesOnlyAnActivePair as opportunityLifecycle_lawBlockClosesOnlyAnActivePair } from "./opportunityLifecycle.ts";

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export type ConsentAnswer = "ExplicitYes" | "QualifiedAnswer";
/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export type ConsentPhase = "WaitingForRequester" | "WaitingForPartnerWindow" | "WaitingForPartner" | "MeetingScheduled";
/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export type ConsentSide = "Requester" | "Partner";
/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export type ReceiptResult = "BookingReceiptStored" | "BookingReceiptReplayed";
/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export interface MutualConsentJourney { phase: ConsentPhase; partnerReplies: number; lateWindow: boolean; partnerProbeCount: number; bookingCount: number; partnerBookingSent: boolean }
/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export interface ConsentStep { state: MutualConsentJourney; out: ReceiptResult[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "replyToProbe"; byMember: ConsentSide; answer: ConsentAnswer }
  | { type: "reachLateSendWindow" }
  | { type: "recordBookingReceipt" };

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
export const initial: MutualConsentJourney = { phase: "WaitingForRequester", partnerReplies: 3, lateWindow: false, partnerProbeCount: 0, bookingCount: 0, partnerBookingSent: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: MutualConsentJourney): boolean {
  return alwaysPartnerProbeFollowsRequesterAgreement(current) && alwaysBookingFollowsBothAgreements(current) && alwaysReplySamplesAreBounded(current);
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function alwaysPartnerProbeFollowsRequesterAgreement(s: MutualConsentJourney): boolean {
  return s.partnerProbeCount === (s.phase === "WaitingForRequester" || s.phase === "WaitingForPartnerWindow" ? 0 : 1);
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function alwaysBookingFollowsBothAgreements(s: MutualConsentJourney): boolean {
  return s.bookingCount === (s.phase === "MeetingScheduled" ? 2 : 0);
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function sometimesPartnerGetsAProbe(s: MutualConsentJourney): boolean {
  return s.phase === "WaitingForPartner";
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function sometimesBothAgreeToBook(s: MutualConsentJourney): boolean {
  return s.phase === "MeetingScheduled";
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function canReplyToProbe(s: MutualConsentJourney, byMember: ConsentSide, answer: ConsentAnswer): boolean {
  return true;
}

/** Story: Book the introduction only after both members agree / A reply can advance only the probe addressed to that participant (spec/mutualConsentJourney.md) */
//@ pure
export function replyToProbe(s: MutualConsentJourney, byMember: ConsentSide, answer: ConsentAnswer): ConsentStep {
  //@ ensures (inv(s) && canReplyToProbe(s, byMember, answer)) ==> alwaysPartnerProbeFollowsRequesterAgreement(\result.state)
  //@ ensures (inv(s) && canReplyToProbe(s, byMember, answer)) ==> alwaysBookingFollowsBothAgreements(\result.state)
  //@ ensures (inv(s) && canReplyToProbe(s, byMember, answer)) ==> alwaysReplySamplesAreBounded(\result.state)
  //@ ensures (inv(s) && canReplyToProbe(s, byMember, answer)) ==> stepNoOtherActionChangesDelivery(s, "replyToProbe", \result.state)
  const local_0 = s.phase === "WaitingForRequester" && byMember === "Requester" && answer === "ExplicitYes";
  const local_1 = s.phase === "WaitingForPartner" && byMember === "Partner" && answer === "ExplicitYes";
  const local_2 = byMember === "Partner" && s.partnerReplies < 5 ? exact_mutualConsentJourney(s.partnerReplies + 1) : s.partnerReplies;
  const local_3: MutualConsentJourney = { ...s, partnerReplies: local_2 };
  const local_4: MutualConsentJourney = probeDispatch_canOpenTurn(probeDispatch_initial, false, local_0) ? (s.lateWindow || s.partnerReplies < 5 ? ({ ...local_3, phase: "WaitingForPartner", partnerProbeCount: 1 } as MutualConsentJourney) : ({ ...local_3, phase: "WaitingForPartnerWindow" } as MutualConsentJourney)) : (opportunityLifecycle_canBook(({ phase: "Probing", approved: true } as opportunityLifecycle_OpportunityLifecycle), local_1) ? ({ ...local_3, phase: "MeetingScheduled", bookingCount: 2 } as MutualConsentJourney) : local_3);
  return { state: local_4, out: ([] as ReceiptResult[]) };
}

/** Story: Book the introduction only after both members agree / The partner probe waits for their send window (spec/mutualConsentJourney.md) */
//@ pure
export function canReachLateSendWindow(s: MutualConsentJourney): boolean {
  return true;
}

/** Story: Book the introduction only after both members agree / The partner probe waits for their send window (spec/mutualConsentJourney.md) */
//@ pure
export function alwaysReplySamplesAreBounded(s: MutualConsentJourney): boolean {
  return s.partnerReplies >= 3 && s.partnerReplies <= 5;
}

/** Story: Book the introduction only after both members agree / The partner probe waits for their send window (spec/mutualConsentJourney.md) */
//@ pure
export function sometimesPartnerWaitsForLearnedWindow(s: MutualConsentJourney): boolean {
  return s.phase === "WaitingForPartnerWindow";
}

/** Story: Book the introduction only after both members agree / The partner probe waits for their send window (spec/mutualConsentJourney.md) */
//@ pure
export function reachLateSendWindow(s: MutualConsentJourney): ConsentStep {
  //@ ensures (inv(s) && canReachLateSendWindow(s)) ==> alwaysPartnerProbeFollowsRequesterAgreement(\result.state)
  //@ ensures (inv(s) && canReachLateSendWindow(s)) ==> alwaysBookingFollowsBothAgreements(\result.state)
  //@ ensures (inv(s) && canReachLateSendWindow(s)) ==> alwaysReplySamplesAreBounded(\result.state)
  //@ ensures (inv(s) && canReachLateSendWindow(s)) ==> stepNoOtherActionChangesDelivery(s, "reachLateSendWindow", \result.state)
  return { state: s.phase === "WaitingForPartnerWindow" ? ({ ...s, lateWindow: true, phase: "WaitingForPartner", partnerProbeCount: 1 } as MutualConsentJourney) : ({ ...s, lateWindow: true } as MutualConsentJourney), out: ([] as ReceiptResult[]) };
}

/** Story: Book the introduction only after both members agree / Collection and gateway acceptance remain distinct (spec/mutualConsentJourney.md) */
//@ pure
export function canRecordBookingReceipt(s: MutualConsentJourney): boolean {
  return s.phase === "MeetingScheduled";
}

/** Story: Book the introduction only after both members agree / Collection and gateway acceptance remain distinct (spec/mutualConsentJourney.md) */
//@ pure
export function stepNoOtherActionChangesDelivery(before: MutualConsentJourney, via: string, after: MutualConsentJourney): boolean {
  return (!(via !== "recordBookingReceipt") || before.partnerBookingSent === after.partnerBookingSent) && (!before.partnerBookingSent || after.partnerBookingSent);
}

/** Story: Book the introduction only after both members agree / Collection and gateway acceptance remain distinct (spec/mutualConsentJourney.md) */
//@ pure
export function sometimesGatewayAcceptsTheBooking(s: MutualConsentJourney): boolean {
  return s.partnerBookingSent;
}

/** Story: Book the introduction only after both members agree / Collection and gateway acceptance remain distinct (spec/mutualConsentJourney.md) */
//@ pure
export function recordBookingReceipt(s: MutualConsentJourney): ConsentStep {
  //@ ensures (inv(s) && canRecordBookingReceipt(s)) ==> alwaysPartnerProbeFollowsRequesterAgreement(\result.state)
  //@ ensures (inv(s) && canRecordBookingReceipt(s)) ==> alwaysBookingFollowsBothAgreements(\result.state)
  //@ ensures (inv(s) && canRecordBookingReceipt(s)) ==> alwaysReplySamplesAreBounded(\result.state)
  //@ ensures (inv(s) && canRecordBookingReceipt(s)) ==> stepNoOtherActionChangesDelivery(s, "recordBookingReceipt", \result.state)
  return { state: ({ ...s, partnerBookingSent: true } as MutualConsentJourney), out: ([s.partnerBookingSent ? "BookingReceiptReplayed" : "BookingReceiptStored"] as ReceiptResult[]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: MutualConsentJourney, event: Event): boolean {
  if (event.type === "replyToProbe") return canReplyToProbe(current, event.byMember, event.answer);
  if (event.type === "reachLateSendWindow") return canReachLateSendWindow(current);
  if (event.type === "recordBookingReceipt") return canRecordBookingReceipt(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: MutualConsentJourney, event: Event): ConsentStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "replyToProbe") return canReplyToProbe(current, event.byMember, event.answer) ? replyToProbe(current, event.byMember, event.answer) : { state: current, out: ([] as ReceiptResult[]) };
  if (event.type === "reachLateSendWindow") return canReachLateSendWindow(current) ? reachLateSendWindow(current) : { state: current, out: ([] as ReceiptResult[]) };
  if (event.type === "recordBookingReceipt") return canRecordBookingReceipt(current) ? recordBookingReceipt(current) : { state: current, out: ([] as ReceiptResult[]) };
  return { state: current, out: ([] as ReceiptResult[]) };
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
  if (raw.type === "replyToProbe" && (raw.byMember === "Requester" || raw.byMember === "Partner") && (raw.answer === "ExplicitYes" || raw.answer === "QualifiedAnswer")) return { type: "replyToProbe", byMember: raw.byMember, answer: raw.answer };
  if (raw.type === "reachLateSendWindow") return { type: "reachLateSendWindow" };
  if (raw.type === "recordBookingReceipt") return { type: "recordBookingReceipt" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): MutualConsentJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "WaitingForRequester" || raw.phase === "WaitingForPartnerWindow" || raw.phase === "WaitingForPartner" || raw.phase === "MeetingScheduled") && Number.isSafeInteger(raw.partnerReplies) && typeof raw.lateWindow === "boolean" && Number.isSafeInteger(raw.partnerProbeCount) && Number.isSafeInteger(raw.bookingCount) && typeof raw.partnerBookingSent === "boolean" && Object.keys(raw).length === 6)) return undefined;
  const parsed: MutualConsentJourney = ({ phase: raw.phase, partnerReplies: raw.partnerReplies, lateWindow: raw.lateWindow, partnerProbeCount: raw.partnerProbeCount, bookingCount: raw.bookingCount, partnerBookingSent: raw.partnerBookingSent });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): MutualConsentJourney {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_mutualConsentJourney(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
