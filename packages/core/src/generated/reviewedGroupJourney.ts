// GENERATED from spec/reviewedGroupJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type PlanStage as planDecision_PlanStage, type ReplyChoice as planDecision_ReplyChoice, type ReplyFacts as planDecision_ReplyFacts, type FallbackShape as planDecision_FallbackShape, canApplyPlanReply as planDecision_canApplyPlanReply, planProbeExpired as planDecision_planProbeExpired, planReplyChoice as planDecision_planReplyChoice, currentFriendPlanSeatFits as planDecision_currentFriendPlanSeatFits, lawFriendPlanSeatNeedsACurrentProfile as planDecision_lawFriendPlanSeatNeedsACurrentProfile, lawFriendPlanSeatNeedsEveryPairValue as planDecision_lawFriendPlanSeatNeedsEveryPairValue, planProfileCapacityAllows as planDecision_planProfileCapacityAllows, lawBookingNeedsQuorum as planDecision_lawBookingNeedsQuorum, unmetPlanQuorum as planDecision_unmetPlanQuorum, lawOnlyProbingPlansExpire as planDecision_lawOnlyProbingPlansExpire, lawReplyAtDeadlineClosesProbe as planDecision_lawReplyAtDeadlineClosesProbe, planFallbackShape as planDecision_planFallbackShape, lawDirectFallbackRequiresGroup as planDecision_lawDirectFallbackRequiresGroup, friendsPartnerPlanFits as planDecision_friendsPartnerPlanFits, planBookingConsented as planDecision_planBookingConsented, lawGroupBookingNeedsThreeMembers as planDecision_lawGroupBookingNeedsThreeMembers, lawPartnerBookingNeedsQuorum as planDecision_lawPartnerBookingNeedsQuorum, qualifiesForPlanAllowance as planDecision_qualifiesForPlanAllowance, hasCrewQuorum as planDecision_hasCrewQuorum, singlePlanSeedsCrew as planDecision_singlePlanSeedsCrew, crewBelowMinimum as planDecision_crewBelowMinimum, crewMembersWhoOptedIn as planDecision_crewMembersWhoOptedIn, crewHostOrder as planDecision_crewHostOrder } from "./planDecision.ts";
import { type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, type UnlinkedCancellation as opportunityLifecycle_UnlinkedCancellation, initial as opportunityLifecycle_initial, canStartProbing as opportunityLifecycle_canStartProbing, startProbing as opportunityLifecycle_startProbing, canReroll as opportunityLifecycle_canReroll, reroll as opportunityLifecycle_reroll, stepRerollRequiresNewApproval as opportunityLifecycle_stepRerollRequiresNewApproval, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, groupCanContinue as opportunityLifecycle_groupCanContinue, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, lawPairLeftFromGroupNeedsFreshConsent as opportunityLifecycle_lawPairLeftFromGroupNeedsFreshConsent, acceptedProbeCanWithdraw as opportunityLifecycle_acceptedProbeCanWithdraw, acceptedProbeWithdrawalAllowed as opportunityLifecycle_acceptedProbeWithdrawalAllowed, lawAcceptedProbeWithdrawalNeedsExactMatch as opportunityLifecycle_lawAcceptedProbeWithdrawalNeedsExactMatch, bookedReplyCurrent as opportunityLifecycle_bookedReplyCurrent, lawBookedReplyRequiresCurrentConsent as opportunityLifecycle_lawBookedReplyRequiresCurrentConsent, upcomingCancellationEligible as opportunityLifecycle_upcomingCancellationEligible, unlinkedCancellation as opportunityLifecycle_unlinkedCancellation, lawUnlinkedCancellationNeedsOneMatch as opportunityLifecycle_lawUnlinkedCancellationNeedsOneMatch, lawNamedCancellationCanSelectWithPendingReply as opportunityLifecycle_lawNamedCancellationCanSelectWithPendingReply, lawStartedBookingCannotBeSelected as opportunityLifecycle_lawStartedBookingCannotBeSelected, bookedReplyDeclines as opportunityLifecycle_bookedReplyDeclines, lawSwapWithdrawalAloneDoesNotCancel as opportunityLifecycle_lawSwapWithdrawalAloneDoesNotCancel, lawKeepingTheBookingVetoesABookedDecline as opportunityLifecycle_lawKeepingTheBookingVetoesABookedDecline, playerBookingConfirmationAllowed as opportunityLifecycle_playerBookingConfirmationAllowed, lawPlayerCannotConfirmAStartedBooking as opportunityLifecycle_lawPlayerCannotConfirmAStartedBooking, lawPlayerCanConfirmOnlyThePromptBooking as opportunityLifecycle_lawPlayerCanConfirmOnlyThePromptBooking, lawCancellationRequestCannotConfirmPlayerAttendance as opportunityLifecycle_lawCancellationRequestCannotConfirmPlayerAttendance, lawPlayerAttendanceConfirmationNeedsAClearYes as opportunityLifecycle_lawPlayerAttendanceConfirmationNeedsAClearYes, closesForMinor as opportunityLifecycle_closesForMinor, bookedGroupCanContinue as opportunityLifecycle_bookedGroupCanContinue, lawAskedMinorClosesABookedOpportunity as opportunityLifecycle_lawAskedMinorClosesABookedOpportunity, lawMinorOnTheRosterClosesABookedOpportunity as opportunityLifecycle_lawMinorOnTheRosterClosesABookedOpportunity, lawAMinorNeverLeavesABookedGroupRunning as opportunityLifecycle_lawAMinorNeverLeavesABookedGroupRunning, lawOtherDropsKeepTheGroupRule as opportunityLifecycle_lawOtherDropsKeepTheGroupRule, lawNoMinorCloseWithoutAMinorSignal as opportunityLifecycle_lawNoMinorCloseWithoutAMinorSignal, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity, minorCloseTellsAcceptor as opportunityLifecycle_minorCloseTellsAcceptor, lawMinorCloseNeverTellsTheMinor as opportunityLifecycle_lawMinorCloseNeverTellsTheMinor, recurrenceAllowed as opportunityLifecycle_recurrenceAllowed, lawNoRecurrenceThatAMinorKnows as opportunityLifecycle_lawNoRecurrenceThatAMinorKnows, closesForBlock as opportunityLifecycle_closesForBlock, lawBlockClosesOnlyAnActivePair as opportunityLifecycle_lawBlockClosesOnlyAnActivePair, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, releasesPartialAcceptance as opportunityLifecycle_releasesPartialAcceptance, lawReleaseNeedsAContactedAcceptor as opportunityLifecycle_lawReleaseNeedsAContactedAcceptor, releasesOnRequesterClose as opportunityLifecycle_releasesOnRequesterClose, lawRequesterCloseNeverReleasesTheRequester as opportunityLifecycle_lawRequesterCloseNeverReleasesTheRequester, lawRequesterCloseReleasesOnlyAContactedAcceptor as opportunityLifecycle_lawRequesterCloseReleasesOnlyAContactedAcceptor } from "./opportunityLifecycle.ts";

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export type Hiker = "FirstHiker" | "SecondHiker" | "ThirdHiker";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export type GroupPhase = "AwaitingGroupJudge" | "GroupHeldForStaff" | "GroupInvited" | "ReviewDenied" | "GroupUnderfilled" | "HikeBooked" | "HikeCancelled";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export type GroupEffect = "AnonymousInvite" | "GroupReveal" | "PrivateCancellation";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export interface ReviewedGroupJourney { phase: GroupPhase; accepted: Hiker[]; declined: Hiker[]; invites: number; meetings: number; reveals: number; cancellations: number }
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export interface GroupStep { state: ReviewedGroupJourney; out: GroupEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "judgeGroup"; approved: boolean }
  | { type: "staffDecideGroup"; approved: boolean }
  | { type: "answerGroup"; hiker: Hiker; agrees: boolean }
  | { type: "expireGroup" }
  | { type: "withdrawFromGroup"; hiker: Hiker }
  | { type: "restartGroup" };

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export const hikers: Hiker[] = ["FirstHiker", "SecondHiker", "ThirdHiker"];
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
export const initial: ReviewedGroupJourney = { phase: "AwaitingGroupJudge", accepted: ([] as Hiker[]), declined: ([] as Hiker[]), invites: 0, meetings: 0, reveals: 0, cancellations: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReviewedGroupJourney): boolean {
  return alwaysNoContactWithoutApproval(current) && alwaysRevealsBelongToOneBooking(current) && alwaysBookingRequiresQuorum(current) && alwaysCancellationFollowsBooking(current);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function canJudgeGroup(s: ReviewedGroupJourney, approved: boolean): boolean {
  return s.phase === "AwaitingGroupJudge";
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function judgeGroup(s: ReviewedGroupJourney, approved: boolean): GroupStep {
  //@ ensures (inv(s) && canJudgeGroup(s, approved)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canJudgeGroup(s, approved)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canJudgeGroup(s, approved)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canJudgeGroup(s, approved)) ==> alwaysCancellationFollowsBooking(\result.state)
  return approved ? ({ state: ({ ...s, phase: "GroupInvited", invites: 3 } as ReviewedGroupJourney), out: (["AnonymousInvite", "AnonymousInvite", "AnonymousInvite"] as GroupEffect[]) } as GroupStep) : ({ state: ({ ...s, phase: "GroupHeldForStaff" } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function canStaffDecideGroup(s: ReviewedGroupJourney, approved: boolean): boolean {
  return approved ? s.phase === "GroupHeldForStaff" : s.phase === "AwaitingGroupJudge" || s.phase === "GroupHeldForStaff";
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function staffDecideGroup(s: ReviewedGroupJourney, approved: boolean): GroupStep {
  //@ ensures (inv(s) && canStaffDecideGroup(s, approved)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canStaffDecideGroup(s, approved)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canStaffDecideGroup(s, approved)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canStaffDecideGroup(s, approved)) ==> alwaysCancellationFollowsBooking(\result.state)
  return approved ? ({ state: ({ ...s, phase: "GroupInvited", invites: 3 } as ReviewedGroupJourney), out: (["AnonymousInvite", "AnonymousInvite", "AnonymousInvite"] as GroupEffect[]) } as GroupStep) : ({ state: ({ ...s, phase: "ReviewDenied" } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function alwaysNoContactWithoutApproval(s: ReviewedGroupJourney): boolean {
  return !(s.phase === "AwaitingGroupJudge" || s.phase === "GroupHeldForStaff" || s.phase === "ReviewDenied") || (s.invites === 0 && s.meetings === 0 && s.reveals === 0 && s.cancellations === 0);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesRejectedWithoutContact(s: ReviewedGroupJourney): boolean {
  return s.phase === "ReviewDenied";
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesHeldForStaff(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupHeldForStaff";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function groupReplyPending(s: ReviewedGroupJourney, hiker: Hiker): boolean {
  return !(s.accepted.includes(hiker) || s.declined.includes(hiker));
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function canAnswerGroup(s: ReviewedGroupJourney, hiker: Hiker, agrees: boolean): boolean {
  return s.phase === "GroupInvited" && groupReplyPending(s, hiker);
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function answerGroup(s: ReviewedGroupJourney, hiker: Hiker, agrees: boolean): GroupStep {
  //@ ensures (inv(s) && canAnswerGroup(s, hiker, agrees)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canAnswerGroup(s, hiker, agrees)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canAnswerGroup(s, hiker, agrees)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canAnswerGroup(s, hiker, agrees)) ==> alwaysCancellationFollowsBooking(\result.state)
  const local_0 = hikers.filter((person: Hiker) => s.accepted.includes(person) || (agrees && person === hiker));
  const local_1 = hikers.filter((person: Hiker) => s.declined.includes(person) || (!agrees && person === hiker));
  const local_2: ReviewedGroupJourney = { ...s, accepted: local_0, declined: local_1 };
  const local_3: planDecision_ReplyChoice = planDecision_planReplyChoice(({ phase: "Probing", pendingMember: groupReplyPending(s, hiker), accepted: agrees, yesAfter: local_0.length, needed: 3, partnerPlan: false, firstMember: false, beforeDeadline: true, lateJoinOpen: true } as planDecision_ReplyFacts));
  return local_3 === "BookPlan" ? ({ state: ({ ...local_2, phase: "HikeBooked", meetings: 1, reveals: 3 } as ReviewedGroupJourney), out: (["GroupReveal", "GroupReveal", "GroupReveal"] as GroupEffect[]) } as GroupStep) : (planDecision_unmetPlanQuorum(exact_reviewedGroupJourney(exact_reviewedGroupJourney(3 - local_0.length) - local_1.length), local_0.length, 3) ? ({ state: ({ ...local_2, phase: "GroupUnderfilled" } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep) : ({ state: local_2, out: ([] as GroupEffect[]) } as GroupStep));
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function canExpireGroup(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupInvited";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function expireGroup(s: ReviewedGroupJourney): GroupStep {
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysCancellationFollowsBooking(\result.state)
  return { state: ({ ...s, phase: "GroupUnderfilled" } as ReviewedGroupJourney), out: ([] as GroupEffect[]) };
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function alwaysRevealsBelongToOneBooking(s: ReviewedGroupJourney): boolean {
  return s.meetings === (s.phase === "HikeBooked" || s.phase === "HikeCancelled" ? 1 : 0) && s.reveals === exact_reviewedGroupJourney(3 * s.meetings);
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function alwaysBookingRequiresQuorum(s: ReviewedGroupJourney): boolean {
  return !(s.phase === "HikeBooked") || s.accepted.length === 3;
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesThreeHikersBook(s: ReviewedGroupJourney): boolean {
  return s.phase === "HikeBooked";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesUnderfilledCloses(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupUnderfilled";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesExpiresWithNobodyDeclined(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupUnderfilled" && s.declined.length === 0;
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function canWithdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): boolean {
  return s.phase === "HikeBooked" && s.accepted.includes(hiker);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function withdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): GroupStep {
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysCancellationFollowsBooking(\result.state)
  const local_4 = s.accepted.filter((person: Hiker) => person !== hiker);
  return opportunityLifecycle_groupCanContinue(local_4.length) ? ({ state: ({ ...s, accepted: local_4 } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep) : ({ state: ({ ...s, phase: "HikeCancelled", accepted: local_4, declined: ([hiker] as Hiker[]), cancellations: 2 } as ReviewedGroupJourney), out: (["PrivateCancellation", "PrivateCancellation"] as GroupEffect[]) } as GroupStep);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function canRestartGroup(s: ReviewedGroupJourney): boolean {
  return true;
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function restartGroup(s: ReviewedGroupJourney): GroupStep {
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysCancellationFollowsBooking(\result.state)
  return { state: s, out: ([] as GroupEffect[]) };
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function alwaysCancellationFollowsBooking(s: ReviewedGroupJourney): boolean {
  return s.cancellations === (s.phase === "HikeCancelled" ? 2 : 0);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md) */
//@ pure
export function sometimesBookedGroupCancels(s: ReviewedGroupJourney): boolean {
  return s.phase === "HikeCancelled";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReviewedGroupJourney, event: Event): boolean {
  if (event.type === "judgeGroup") return canJudgeGroup(current, event.approved);
  if (event.type === "staffDecideGroup") return canStaffDecideGroup(current, event.approved);
  if (event.type === "answerGroup") return canAnswerGroup(current, event.hiker, event.agrees);
  if (event.type === "expireGroup") return canExpireGroup(current);
  if (event.type === "withdrawFromGroup") return canWithdrawFromGroup(current, event.hiker);
  if (event.type === "restartGroup") return canRestartGroup(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: ReviewedGroupJourney, event: Event): GroupStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "judgeGroup") return canJudgeGroup(current, event.approved) ? judgeGroup(current, event.approved) : { state: current, out: ([] as GroupEffect[]) };
  if (event.type === "staffDecideGroup") return canStaffDecideGroup(current, event.approved) ? staffDecideGroup(current, event.approved) : { state: current, out: ([] as GroupEffect[]) };
  if (event.type === "answerGroup") return canAnswerGroup(current, event.hiker, event.agrees) ? answerGroup(current, event.hiker, event.agrees) : { state: current, out: ([] as GroupEffect[]) };
  if (event.type === "expireGroup") return canExpireGroup(current) ? expireGroup(current) : { state: current, out: ([] as GroupEffect[]) };
  if (event.type === "withdrawFromGroup") return canWithdrawFromGroup(current, event.hiker) ? withdrawFromGroup(current, event.hiker) : { state: current, out: ([] as GroupEffect[]) };
  if (event.type === "restartGroup") return canRestartGroup(current) ? restartGroup(current) : { state: current, out: ([] as GroupEffect[]) };
  return { state: current, out: ([] as GroupEffect[]) };
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
  if (raw.type === "judgeGroup" && typeof raw.approved === "boolean") return { type: "judgeGroup", approved: raw.approved };
  if (raw.type === "staffDecideGroup" && typeof raw.approved === "boolean") return { type: "staffDecideGroup", approved: raw.approved };
  if (raw.type === "answerGroup" && (raw.hiker === "FirstHiker" || raw.hiker === "SecondHiker" || raw.hiker === "ThirdHiker") && typeof raw.agrees === "boolean") return { type: "answerGroup", hiker: raw.hiker, agrees: raw.agrees };
  if (raw.type === "expireGroup") return { type: "expireGroup" };
  if (raw.type === "withdrawFromGroup" && (raw.hiker === "FirstHiker" || raw.hiker === "SecondHiker" || raw.hiker === "ThirdHiker")) return { type: "withdrawFromGroup", hiker: raw.hiker };
  if (raw.type === "restartGroup") return { type: "restartGroup" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReviewedGroupJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingGroupJudge" || raw.phase === "GroupHeldForStaff" || raw.phase === "GroupInvited" || raw.phase === "ReviewDenied" || raw.phase === "GroupUnderfilled" || raw.phase === "HikeBooked" || raw.phase === "HikeCancelled") && Array.isArray(raw.accepted) && raw.accepted.every((x1: any) => (x1 === "FirstHiker" || x1 === "SecondHiker" || x1 === "ThirdHiker")) && Array.isArray(raw.declined) && raw.declined.every((x1: any) => (x1 === "FirstHiker" || x1 === "SecondHiker" || x1 === "ThirdHiker")) && Number.isSafeInteger(raw.invites) && Number.isSafeInteger(raw.meetings) && Number.isSafeInteger(raw.reveals) && Number.isSafeInteger(raw.cancellations) && Object.keys(raw).length === 7)) return undefined;
  const parsed: ReviewedGroupJourney = ({ phase: raw.phase, accepted: raw.accepted.map((x1: any) => x1), declined: raw.declined.map((x1: any) => x1), invites: raw.invites, meetings: raw.meetings, reveals: raw.reveals, cancellations: raw.cancellations });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReviewedGroupJourney {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_reviewedGroupJourney(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
