// GENERATED from spec/probeDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { reviewLate as reviewDeadline_reviewLate, reviewRevisionCurrent as reviewDeadline_reviewRevisionCurrent, lawReviewDeadlineIsExclusive as reviewDeadline_lawReviewDeadlineIsExclusive, lawSeenReviewRevisionIsCurrent as reviewDeadline_lawSeenReviewRevisionIsCurrent, lawRerolledReviewIsStale as reviewDeadline_lawRerolledReviewIsStale } from "./reviewDeadline.ts";
import { type UnlinkedCancellation as opportunityLifecycle_UnlinkedCancellation, type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, groupCanContinue as opportunityLifecycle_groupCanContinue, acceptedProbeWithdrawalAllowed as opportunityLifecycle_acceptedProbeWithdrawalAllowed, recurrenceAllowed as opportunityLifecycle_recurrenceAllowed, releasesOnRequesterClose as opportunityLifecycle_releasesOnRequesterClose, stepRerollRequiresNewApproval as opportunityLifecycle_stepRerollRequiresNewApproval, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, acceptedProbeCanWithdraw as opportunityLifecycle_acceptedProbeCanWithdraw, lawAcceptedProbeWithdrawalNeedsExactMatch as opportunityLifecycle_lawAcceptedProbeWithdrawalNeedsExactMatch, bookedReplyCurrent as opportunityLifecycle_bookedReplyCurrent, initial as opportunityLifecycle_initial, unlinkedCancellation as opportunityLifecycle_unlinkedCancellation, closesForMinor as opportunityLifecycle_closesForMinor, bookedGroupCanContinue as opportunityLifecycle_bookedGroupCanContinue, canStartProbing as opportunityLifecycle_canStartProbing, startProbing as opportunityLifecycle_startProbing, minorCloseTellsAcceptor as opportunityLifecycle_minorCloseTellsAcceptor, canReroll as opportunityLifecycle_canReroll, lawNoRecurrenceThatAMinorKnows as opportunityLifecycle_lawNoRecurrenceThatAMinorKnows, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, reroll as opportunityLifecycle_reroll, releasesPartialAcceptance as opportunityLifecycle_releasesPartialAcceptance, lawRequesterCloseNeverReleasesTheRequester as opportunityLifecycle_lawRequesterCloseNeverReleasesTheRequester, lawRequesterCloseReleasesOnlyAContactedAcceptor as opportunityLifecycle_lawRequesterCloseReleasesOnlyAContactedAcceptor, lawPairLeftFromGroupNeedsFreshConsent as opportunityLifecycle_lawPairLeftFromGroupNeedsFreshConsent, lawBookedReplyRequiresCurrentConsent as opportunityLifecycle_lawBookedReplyRequiresCurrentConsent, upcomingCancellationEligible as opportunityLifecycle_upcomingCancellationEligible, lawUnlinkedCancellationNeedsOneMatch as opportunityLifecycle_lawUnlinkedCancellationNeedsOneMatch, lawNamedCancellationCanSelectWithPendingReply as opportunityLifecycle_lawNamedCancellationCanSelectWithPendingReply, lawAskedMinorClosesABookedOpportunity as opportunityLifecycle_lawAskedMinorClosesABookedOpportunity, lawMinorOnTheRosterClosesABookedOpportunity as opportunityLifecycle_lawMinorOnTheRosterClosesABookedOpportunity, lawAMinorNeverLeavesABookedGroupRunning as opportunityLifecycle_lawAMinorNeverLeavesABookedGroupRunning, lawOtherDropsKeepTheGroupRule as opportunityLifecycle_lawOtherDropsKeepTheGroupRule, lawNoMinorCloseWithoutAMinorSignal as opportunityLifecycle_lawNoMinorCloseWithoutAMinorSignal, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity, lawMinorCloseNeverTellsTheMinor as opportunityLifecycle_lawMinorCloseNeverTellsTheMinor, lawReleaseNeedsAContactedAcceptor as opportunityLifecycle_lawReleaseNeedsAContactedAcceptor, lawStartedBookingCannotBeSelected as opportunityLifecycle_lawStartedBookingCannotBeSelected } from "./opportunityLifecycle.ts";

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export type ProbePhase = "Queued" | "AwaitingReply" | "Available" | "Unavailable" | "OutsideProbe";
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export interface ParticipantProbe { phase: ProbePhase; roster: number; about: number; told: boolean }
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export type ProbeTiming = "WaitForQuestion" | "WaitForWindow" | "CheckAvailability";
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export type ProbeAvailability = "ReadyToSend" | "ParticipantAway" | "NoCommonTime";
/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
export type ReplacementRoute = "IgnoreReplacement" | "CloseRequester" | "CloseManager" | "FindAlternate";
/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md) */
export type NoAlternateRoute = "ContinueGroup" | "CloseWithoutAlternate";
/** Story: Hear about one reviewed opportunity at a time / An activity-partner plan asks the member who agreed again before its alternate (spec/probeDispatch.md) */
export interface PartnerBackfill { bench: string[]; askAlternate: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "usePriorIntent"; primed: boolean; contacted: boolean; needsTimes: boolean }
  | { type: "openTurn"; first: boolean; firstAvailable: boolean }
  | { type: "recordProbeSent" }
  | { type: "markUnavailable" }
  | { type: "recordReply"; agreed: boolean }
  | { type: "offerOtherTimes"; hasFreshTimes: boolean }
  | { type: "expireProbe"; expired: boolean; timeQuestion: boolean }
  | { type: "joinRoster"; roster: number }
  | { type: "changeRoster" };

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
export const questionHoldMs: number = exact_probeDispatch(24 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
export const genericProbeResponseMs: number = exact_probeDispatch(48 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
export const shortProbeResponseMs: number = exact_probeDispatch(24 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
export const initial: ParticipantProbe = { phase: "Queued", roster: 0, about: 0, told: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ParticipantProbe): boolean {
  return alwaysAnOpenTurnIsAboutTheCurrentRoster(current) && alwaysAQueuedTurnHasNoProbe(current) && alwaysTheAnswerIsNotAheadOfTheRoster(current);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function usePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean, needsTimes: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "usePriorIntent", \result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "usePriorIntent", \result)
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "usePriorIntent", \result)
  return { ...participant, phase: "Available", about: participant.roster, told: false };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function openTurn(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "openTurn", \result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "openTurn", \result)
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "openTurn", \result)
  return { ...participant, phase: "AwaitingReply", about: participant.roster, told: false };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function probePending(participant: ParticipantProbe): boolean {
  return participant.phase === "Queued" || participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function turnReached(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): boolean {
  return probePending(participant) && (first || firstAvailable);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md) */
//@ pure
export function mayUsePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean): boolean {
  return probePending(participant) && !participant.told && primed && !contacted;
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
export function needsProbeSend(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply" && !participant.told;
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function recordProbeSent(participant: ParticipantProbe): ParticipantProbe {
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "recordProbeSent", \result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "recordProbeSent", \result)
  //@ ensures (inv(participant) && canRecordProbeSent(participant)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "recordProbeSent", \result)
  return { ...participant, told: true };
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
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "markUnavailable", \result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "markUnavailable", \result)
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "markUnavailable", \result)
  return { ...participant, phase: "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function canRecordProbeSent(participant: ParticipantProbe): boolean {
  return needsProbeSend(participant);
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md) */
//@ pure
export function lawProbeWaitsForOpenQuestion(windowOpen: boolean): boolean {
  //@ ensures \result === true
  return probeTiming(true, windowOpen) === "WaitForQuestion";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function probeResponseMs(slop: boolean, timeQuestion: boolean): number {
  return slop || timeQuestion ? shortProbeResponseMs : genericProbeResponseMs;
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
export function lawASentProbeIsOpenForItsWholeWindow(slop: boolean, timeQuestion: boolean, sentAt: number, asOf: number, sendDeadline: number): boolean {
  //@ ensures \result === true
  return !(asOf < exact_probeDispatch(sentAt + probeResponseMs(slop, timeQuestion))) || !probeExpired(asOf, probeExpiryDeadline(true, exact_probeDispatch(sentAt + probeResponseMs(slop, timeQuestion)), sendDeadline));
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function lawAGenericProbeIsStillOpenAfterOneDay(sentAt: number, sendDeadline: number): boolean {
  //@ ensures \result === true
  return !probeExpired(exact_probeDispatch(sentAt + exact_probeDispatch(24 * 3600000)), probeExpiryDeadline(true, exact_probeDispatch(sentAt + probeResponseMs(false, false)), sendDeadline)) && probeExpired(exact_probeDispatch(sentAt + exact_probeDispatch(48 * 3600000)), probeExpiryDeadline(true, exact_probeDispatch(sentAt + probeResponseMs(false, false)), sendDeadline));
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function lawASlopProbeOrTimeQuestionEndsAfterOneDay(slop: boolean, timeQuestion: boolean, sentAt: number, sendDeadline: number): boolean {
  //@ ensures \result === true
  return !(slop || timeQuestion) || probeExpired(exact_probeDispatch(sentAt + exact_probeDispatch(24 * 3600000)), probeExpiryDeadline(true, exact_probeDispatch(sentAt + probeResponseMs(slop, timeQuestion)), sendDeadline));
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function canRecordReply(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function recordReply(participant: ParticipantProbe, agreed: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "recordReply", \result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "recordReply", \result)
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "recordReply", \result)
  return { ...participant, phase: agreed ? "Available" : "Unavailable" };
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
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "offerOtherTimes", \result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "offerOtherTimes", \result)
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "offerOtherTimes", \result)
  return { ...participant, phase: "AwaitingReply" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function canExpireProbe(participant: ParticipantProbe, expired: boolean): boolean {
  return participant.phase === "AwaitingReply" && expired;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md) */
//@ pure
export function expireProbe(participant: ParticipantProbe, expired: boolean, timeQuestion: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "expireProbe", \result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "expireProbe", \result)
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "expireProbe", \result)
  return { ...participant, phase: timeQuestion ? "Available" : "Unavailable" };
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
export function replacementJudged(rosterListed: boolean): boolean {
  return rosterListed;
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
export function lawUnjudgedRosterNeverProbes(rosterListed: boolean): boolean {
  //@ ensures \result === true
  return !(!rosterListed) || !replacementJudged(rosterListed);
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

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function canJoinRoster(participant: ParticipantProbe, roster: number): boolean {
  return participant.phase === "Queued" && !participant.told && participant.roster === 0 && participant.about === 0 && roster >= 0;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function joinRoster(participant: ParticipantProbe, roster: number): ParticipantProbe {
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "joinRoster", \result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "joinRoster", \result)
  //@ ensures (inv(participant) && canJoinRoster(participant, roster)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "joinRoster", \result)
  return { phase: "Queued", roster: roster, about: roster, told: false };
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function stepAnAlternateJoinsQueuedForTheCurrentRoster(before: ParticipantProbe, via: string, after: ParticipantProbe): boolean {
  return !(via === "joinRoster") || (after.phase === "Queued" && !after.told && after.about === after.roster);
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function sometimesAgreedAgainAfterARosterChange(participant: ParticipantProbe): boolean {
  return participant.phase === "Available" && participant.told && participant.roster > 0;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function canChangeRoster(participant: ParticipantProbe): boolean {
  return true;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function changeRoster(participant: ParticipantProbe): ParticipantProbe {
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> alwaysAnOpenTurnIsAboutTheCurrentRoster(\result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> alwaysAQueuedTurnHasNoProbe(\result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> alwaysTheAnswerIsNotAheadOfTheRoster(\result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> stepAnAlternateJoinsQueuedForTheCurrentRoster(participant, "changeRoster", \result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> stepARosterChangeVoidsEveryEarlierProbe(participant, "changeRoster", \result)
  //@ ensures (inv(participant) && canChangeRoster(participant)) ==> stepOnlyARosterChangeMovesTheRoster(participant, "changeRoster", \result)
  const local_0 = exact_probeDispatch(participant.roster + 1);
  return participant.phase === "Unavailable" || participant.phase === "OutsideProbe" ? ({ ...participant, roster: local_0 } as ParticipantProbe) : (participant.told || participant.phase === "AwaitingReply" ? ({ phase: "Queued", roster: local_0, about: local_0, told: false } as ParticipantProbe) : ({ ...participant, roster: local_0, about: local_0 } as ParticipantProbe));
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function stepARosterChangeVoidsEveryEarlierProbe(before: ParticipantProbe, via: string, after: ParticipantProbe): boolean {
  return !(via === "changeRoster" && (before.phase === "AwaitingReply" || (before.phase === "Available" && before.told))) || (after.phase === "Queued" && !after.told);
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function stepOnlyARosterChangeMovesTheRoster(before: ParticipantProbe, via: string, after: ParticipantProbe): boolean {
  return (!(via !== "changeRoster" && via !== "joinRoster") || after.roster === before.roster) && (!(via === "changeRoster") || after.roster === exact_probeDispatch(before.roster + 1));
}

/** Story: Hear about one reviewed opportunity at a time / A replacement asks again every member who heard about the earlier roster (spec/probeDispatch.md) */
//@ pure
export function lawNoMemberWhoHeardTheEarlierRosterHasAgreedToTheNewOne(participant: ParticipantProbe): boolean {
  //@ ensures \result === true
  return !(participant.told || participant.phase === "AwaitingReply") || !agreedToRoster(changeRoster(participant), exact_probeDispatch(participant.roster + 1));
}

/** Story: Hear about one reviewed opportunity at a time / Nobody is introduced without a yes to the current roster (spec/probeDispatch.md) */
//@ pure
export function agreedToRoster(participant: ParticipantProbe, roster: number): boolean {
  return participant.phase === "Available" && participant.roster === roster && participant.about === roster;
}

/** Story: Hear about one reviewed opportunity at a time / Nobody is introduced without a yes to the current roster (spec/probeDispatch.md) */
//@ pure
export function alwaysAnOpenTurnIsAboutTheCurrentRoster(participant: ParticipantProbe): boolean {
  return !(participant.phase === "Queued" || participant.phase === "AwaitingReply" || participant.phase === "Available") || participant.about === participant.roster;
}

/** Story: Hear about one reviewed opportunity at a time / Nobody is introduced without a yes to the current roster (spec/probeDispatch.md) */
//@ pure
export function alwaysAQueuedTurnHasNoProbe(participant: ParticipantProbe): boolean {
  return !(participant.phase === "Queued") || !participant.told;
}

/** Story: Hear about one reviewed opportunity at a time / Nobody is introduced without a yes to the current roster (spec/probeDispatch.md) */
//@ pure
export function alwaysTheAnswerIsNotAheadOfTheRoster(participant: ParticipantProbe): boolean {
  return participant.about <= participant.roster;
}

/** Story: Hear about one reviewed opportunity at a time / Nobody is introduced without a yes to the current roster (spec/probeDispatch.md) */
//@ pure
export function lawAYesAboutAnEarlierRosterDoesNotCount(participant: ParticipantProbe, roster: number): boolean {
  //@ ensures \result === true
  return !(participant.about !== roster) || !agreedToRoster(participant, roster);
}

/** Story: Hear about one reviewed opportunity at a time / A queued probe goes out only for the roster that it describes (spec/probeDispatch.md) */
//@ pure
export function queuedProbeCurrent(rosterChanged: boolean, currentTurnProbe: boolean): boolean {
  return !rosterChanged || currentTurnProbe;
}

/** Story: Hear about one reviewed opportunity at a time / A queued probe goes out only for the roster that it describes (spec/probeDispatch.md) */
//@ pure
export function lawAnEarlierRosterProbeIsRefused(rosterChanged: boolean): boolean {
  //@ ensures \result === true
  return !rosterChanged || !queuedProbeCurrent(rosterChanged, false);
}

/** Story: Hear about one reviewed opportunity at a time / A group plan backfill keeps the words that each member heard (spec/probeDispatch.md) */
//@ pure
export function groupBackfillKeepsYeses(heard: number, describedAlike: number): boolean {
  return heard <= describedAlike;
}

/** Story: Hear about one reviewed opportunity at a time / A group plan backfill keeps the words that each member heard (spec/probeDispatch.md) */
//@ pure
export function lawAnAlternateWhoChangesTheWordsIsSkipped(heard: number, describedAlike: number): boolean {
  //@ ensures \result === true
  return !(describedAlike < heard) || !groupBackfillKeepsYeses(heard, describedAlike);
}

/** Story: Hear about one reviewed opportunity at a time / A group plan backfill keeps the words that each member heard (spec/probeDispatch.md) */
//@ pure
export function lawAnyAlternateCanJoinBeforeAProbe(describedAlike: number): boolean {
  //@ ensures \result === true
  return !(describedAlike >= 0) || groupBackfillKeepsYeses(0, describedAlike);
}

/** Story: Hear about one reviewed opportunity at a time / An activity-partner plan asks the member who agreed again before its alternate (spec/probeDispatch.md) */
//@ pure
export function partnerPlanBackfill(bench: string[], alternate: string, askedAgain: number): PartnerBackfill {
  return askedAgain > 0 ? ({ bench: ([alternate] as string[]).concat(bench), askAlternate: false } as PartnerBackfill) : ({ bench: bench, askAlternate: true } as PartnerBackfill);
}

/** Story: Hear about one reviewed opportunity at a time / An activity-partner plan asks the member who agreed again before its alternate (spec/probeDispatch.md) */
//@ pure
export function lawTheAlternateWaitsForTheMemberAskedAgain(bench: string[], alternate: string, askedAgain: number): boolean {
  //@ ensures \result === true
  return !(askedAgain > 0) || (!partnerPlanBackfill(bench, alternate, askedAgain).askAlternate && partnerPlanBackfill(bench, alternate, askedAgain).bench.length === exact_probeDispatch(bench.length + 1) && nth_probeDispatch(partnerPlanBackfill(bench, alternate, askedAgain).bench, 0) === alternate);
}

/** Story: Hear about one reviewed opportunity at a time / A reviewer can read each first probe of the open revision (spec/probeDispatch.md) */
//@ pure
export function reviewProbePreviewCurrent(pending: boolean, seenRevision: number, currentRevision: number, currentTime: number, deadline: number): boolean {
  return pending && reviewDeadline_reviewRevisionCurrent(seenRevision, currentRevision) && !reviewDeadline_reviewLate(currentTime, deadline);
}

/** Story: Hear about one reviewed opportunity at a time / A reviewer can read each first probe of the open revision (spec/probeDispatch.md) */
//@ pure
export function lawProbePreviewRefusesAnOlderRevision(currentTime: number, deadline: number, revision: number): boolean {
  //@ ensures \result === true
  return !reviewProbePreviewCurrent(true, revision, exact_probeDispatch(revision + 1), currentTime, deadline);
}

/** Story: Hear about one reviewed opportunity at a time / A reviewer can read each first probe of the open revision (spec/probeDispatch.md) */
//@ pure
export function lawProbePreviewClosesAtTheDeadline(revision: number, deadline: number): boolean {
  //@ ensures \result === true
  return !reviewProbePreviewCurrent(true, revision, revision, deadline, deadline);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ParticipantProbe, event: Event): boolean {
  if (event.type === "usePriorIntent") return canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes);
  if (event.type === "openTurn") return canOpenTurn(current, event.first, event.firstAvailable);
  if (event.type === "recordProbeSent") return canRecordProbeSent(current);
  if (event.type === "markUnavailable") return canMarkUnavailable(current);
  if (event.type === "recordReply") return canRecordReply(current);
  if (event.type === "offerOtherTimes") return canOfferOtherTimes(current, event.hasFreshTimes);
  if (event.type === "expireProbe") return canExpireProbe(current, event.expired);
  if (event.type === "joinRoster") return canJoinRoster(current, event.roster);
  if (event.type === "changeRoster") return canChangeRoster(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ParticipantProbe, event: Event): ParticipantProbe {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "usePriorIntent") return canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes) ? usePriorIntent(current, event.primed, event.contacted, event.needsTimes) : current;
  if (event.type === "openTurn") return canOpenTurn(current, event.first, event.firstAvailable) ? openTurn(current, event.first, event.firstAvailable) : current;
  if (event.type === "recordProbeSent") return canRecordProbeSent(current) ? recordProbeSent(current) : current;
  if (event.type === "markUnavailable") return canMarkUnavailable(current) ? markUnavailable(current) : current;
  if (event.type === "recordReply") return canRecordReply(current) ? recordReply(current, event.agreed) : current;
  if (event.type === "offerOtherTimes") return canOfferOtherTimes(current, event.hasFreshTimes) ? offerOtherTimes(current, event.hasFreshTimes) : current;
  if (event.type === "expireProbe") return canExpireProbe(current, event.expired) ? expireProbe(current, event.expired, event.timeQuestion) : current;
  if (event.type === "joinRoster") return canJoinRoster(current, event.roster) ? joinRoster(current, event.roster) : current;
  if (event.type === "changeRoster") return canChangeRoster(current) ? changeRoster(current) : current;
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
  if (raw.type === "usePriorIntent" && typeof raw.primed === "boolean" && typeof raw.contacted === "boolean" && typeof raw.needsTimes === "boolean") return { type: "usePriorIntent", primed: raw.primed, contacted: raw.contacted, needsTimes: raw.needsTimes };
  if (raw.type === "openTurn" && typeof raw.first === "boolean" && typeof raw.firstAvailable === "boolean") return { type: "openTurn", first: raw.first, firstAvailable: raw.firstAvailable };
  if (raw.type === "recordProbeSent") return { type: "recordProbeSent" };
  if (raw.type === "markUnavailable") return { type: "markUnavailable" };
  if (raw.type === "recordReply" && typeof raw.agreed === "boolean") return { type: "recordReply", agreed: raw.agreed };
  if (raw.type === "offerOtherTimes" && typeof raw.hasFreshTimes === "boolean") return { type: "offerOtherTimes", hasFreshTimes: raw.hasFreshTimes };
  if (raw.type === "expireProbe" && typeof raw.expired === "boolean" && typeof raw.timeQuestion === "boolean") return { type: "expireProbe", expired: raw.expired, timeQuestion: raw.timeQuestion };
  if (raw.type === "joinRoster" && Number.isSafeInteger(raw.roster)) return { type: "joinRoster", roster: raw.roster };
  if (raw.type === "changeRoster") return { type: "changeRoster" };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Queued" || raw.phase === "AwaitingReply" || raw.phase === "Available" || raw.phase === "Unavailable" || raw.phase === "OutsideProbe") && Number.isSafeInteger(raw.roster) && Number.isSafeInteger(raw.about) && typeof raw.told === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: ParticipantProbe = ({ phase: raw.phase, roster: raw.roster, about: raw.about, told: raw.told });
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

/** An element of a list, which must hold it. */
export function nth_probeDispatch<T>(xs: T[], i: number): T {
  if (!(0 <= i && i < xs.length)) throw new RangeError(`a list of ${xs.length} has no element ${i}`);
  return xs[i];
}
