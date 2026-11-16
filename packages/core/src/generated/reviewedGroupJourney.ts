// GENERATED from spec/reviewedGroupJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type ReplyChoice as planDecision_ReplyChoice, type FallbackShape as planDecision_FallbackShape, type PlanStage as planDecision_PlanStage, type ReplyFacts as planDecision_ReplyFacts, unmetPlanQuorum as planDecision_unmetPlanQuorum, planBookingConsented as planDecision_planBookingConsented, qualifiesForPlanAllowance as planDecision_qualifiesForPlanAllowance, hasCrewQuorum as planDecision_hasCrewQuorum, crewBelowMinimum as planDecision_crewBelowMinimum, crewMembersWhoOptedIn as planDecision_crewMembersWhoOptedIn, planFallbackShape as planDecision_planFallbackShape, lawGroupBookingNeedsThreeMembers as planDecision_lawGroupBookingNeedsThreeMembers, lawPartnerBookingNeedsQuorum as planDecision_lawPartnerBookingNeedsQuorum, singlePlanSeedsCrew as planDecision_singlePlanSeedsCrew, canApplyPlanReply as planDecision_canApplyPlanReply, planProbeExpired as planDecision_planProbeExpired, planReplyChoice as planDecision_planReplyChoice, lawOnlyProbingPlansExpire as planDecision_lawOnlyProbingPlansExpire, lawDirectFallbackRequiresGroup as planDecision_lawDirectFallbackRequiresGroup, crewHostOrder as planDecision_crewHostOrder, lawBookingNeedsQuorum as planDecision_lawBookingNeedsQuorum, lawReplyAtDeadlineClosesProbe as planDecision_lawReplyAtDeadlineClosesProbe } from "./planDecision.ts";
import { type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, groupCanContinue as opportunityLifecycle_groupCanContinue, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, closesForMinor as opportunityLifecycle_closesForMinor, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, initial as opportunityLifecycle_initial, canStartProbing as opportunityLifecycle_canStartProbing, startProbing as opportunityLifecycle_startProbing, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity } from "./opportunityLifecycle.ts";

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export type GroupPhase = "AwaitingGroupReview" | "GroupInvited" | "ReviewDenied" | "GroupUnderfilled" | "HikeBooked" | "HikeCancelled";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export type GroupEffect = "AnonymousInvite" | "GroupReveal" | "PrivateCancellation";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export type Hiker = "FirstHiker" | "SecondHiker" | "ThirdHiker";
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export interface ReviewedGroupJourney { phase: GroupPhase; accepted: Hiker[]; declined: Hiker[]; invites: number; meetings: number; reveals: number; cancellations: number }
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export interface GroupStep { state: ReviewedGroupJourney; out: GroupEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "reviewGroup"; approved: boolean }
  | { type: "expireGroup" }
  | { type: "answerGroup"; hiker: Hiker; agrees: boolean }
  | { type: "withdrawFromGroup"; hiker: Hiker }
  | { type: "restartGroup" };

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export const initial: ReviewedGroupJourney = { phase: "AwaitingGroupReview", accepted: ([] as Hiker[]), declined: ([] as Hiker[]), invites: 0, meetings: 0, reveals: 0, cancellations: 0 };
/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
export const hikers: Hiker[] = ["FirstHiker", "SecondHiker", "ThirdHiker"];

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReviewedGroupJourney): boolean {
  return alwaysNoContactWithoutApproval(current) && alwaysRevealsBelongToOneBooking(current) && alwaysBookingRequiresQuorum(current) && alwaysCancellationFollowsBooking(current);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
//@ pure
export function canReviewGroup(s: ReviewedGroupJourney, approved: boolean): boolean {
  return s.phase === "AwaitingGroupReview";
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
//@ pure
export function alwaysNoContactWithoutApproval(s: ReviewedGroupJourney): boolean {
  return !(s.phase === "AwaitingGroupReview" || s.phase === "ReviewDenied") || (s.invites === 0 && s.meetings === 0 && s.reveals === 0 && s.cancellations === 0);
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
//@ pure
export function sometimesRejectedWithoutContact(s: ReviewedGroupJourney): boolean {
  return s.phase === "ReviewDenied";
}

/** Story: Join a reviewed public hike only after the group agrees / Review comes before anonymous contact (spec/reviewedGroupJourney.md:9) */
//@ pure
export function reviewGroup(s: ReviewedGroupJourney, approved: boolean): GroupStep {
  //@ ensures (inv(s) && canReviewGroup(s, approved)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canReviewGroup(s, approved)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canReviewGroup(s, approved)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canReviewGroup(s, approved)) ==> alwaysCancellationFollowsBooking(\result.state)
  return approved ? ({ state: ({ ...s, phase: "GroupInvited", invites: 3 } as ReviewedGroupJourney), out: (["AnonymousInvite", "AnonymousInvite", "AnonymousInvite"] as GroupEffect[]) } as GroupStep) : ({ state: ({ ...s, phase: "ReviewDenied" } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep);
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function groupReplyPending(s: ReviewedGroupJourney, hiker: Hiker): boolean {
  return !(s.accepted.includes(hiker) || s.declined.includes(hiker));
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function canExpireGroup(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupInvited";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function alwaysRevealsBelongToOneBooking(s: ReviewedGroupJourney): boolean {
  return s.meetings === (s.phase === "HikeBooked" || s.phase === "HikeCancelled" ? 1 : 0) && s.reveals === exact_reviewedGroupJourney(3 * s.meetings);
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function alwaysBookingRequiresQuorum(s: ReviewedGroupJourney): boolean {
  return !(s.phase === "HikeBooked") || s.accepted.length === 3;
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function sometimesThreeHikersBook(s: ReviewedGroupJourney): boolean {
  return s.phase === "HikeBooked";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function sometimesUnderfilledCloses(s: ReviewedGroupJourney): boolean {
  return s.phase === "GroupUnderfilled";
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function canAnswerGroup(s: ReviewedGroupJourney, hiker: Hiker, agrees: boolean): boolean {
  return s.phase === "GroupInvited" && groupReplyPending(s, hiker);
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
//@ pure
export function expireGroup(s: ReviewedGroupJourney): GroupStep {
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canExpireGroup(s)) ==> alwaysCancellationFollowsBooking(\result.state)
  return { state: ({ ...s, phase: "GroupUnderfilled", declined: hikers.filter((person: Hiker) => !s.accepted.includes(person)) } as ReviewedGroupJourney), out: ([] as GroupEffect[]) };
}

/** Story: Join a reviewed public hike only after the group agrees / Booking requires an independent yes from all three invitees (spec/reviewedGroupJourney.md:39) */
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

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function canWithdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): boolean {
  return s.phase === "HikeBooked" && s.accepted.includes(hiker);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function canRestartGroup(s: ReviewedGroupJourney): boolean {
  return true;
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function alwaysCancellationFollowsBooking(s: ReviewedGroupJourney): boolean {
  return s.cancellations === (s.phase === "HikeCancelled" ? 2 : 0);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function sometimesBookedGroupCancels(s: ReviewedGroupJourney): boolean {
  return s.phase === "HikeCancelled";
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function withdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): GroupStep {
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canWithdrawFromGroup(s, hiker)) ==> alwaysCancellationFollowsBooking(\result.state)
  const local_4 = s.accepted.filter((person: Hiker) => person !== hiker);
  return opportunityLifecycle_groupCanContinue(local_4.length) ? ({ state: ({ ...s, accepted: local_4 } as ReviewedGroupJourney), out: ([] as GroupEffect[]) } as GroupStep) : ({ state: ({ ...s, phase: "HikeCancelled", accepted: local_4, declined: ([hiker] as Hiker[]), cancellations: 2 } as ReviewedGroupJourney), out: (["PrivateCancellation", "PrivateCancellation"] as GroupEffect[]) } as GroupStep);
}

/** Story: Join a reviewed public hike only after the group agrees / A withdrawal below minimum closes a booked group privately (spec/reviewedGroupJourney.md:74) */
//@ pure
export function restartGroup(s: ReviewedGroupJourney): GroupStep {
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysNoContactWithoutApproval(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysRevealsBelongToOneBooking(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysBookingRequiresQuorum(\result.state)
  //@ ensures (inv(s) && canRestartGroup(s)) ==> alwaysCancellationFollowsBooking(\result.state)
  return { state: s, out: ([] as GroupEffect[]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReviewedGroupJourney, event: Event): boolean {
  if (event.type === "reviewGroup") return canReviewGroup(current, event.approved);
  if (event.type === "expireGroup") return canExpireGroup(current);
  if (event.type === "answerGroup") return canAnswerGroup(current, event.hiker, event.agrees);
  if (event.type === "withdrawFromGroup") return canWithdrawFromGroup(current, event.hiker);
  if (event.type === "restartGroup") return canRestartGroup(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: ReviewedGroupJourney, event: Event): GroupStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "reviewGroup" && canReviewGroup(current, event.approved)) return reviewGroup(current, event.approved);
  if (event.type === "expireGroup" && canExpireGroup(current)) return expireGroup(current);
  if (event.type === "answerGroup" && canAnswerGroup(current, event.hiker, event.agrees)) return answerGroup(current, event.hiker, event.agrees);
  if (event.type === "withdrawFromGroup" && canWithdrawFromGroup(current, event.hiker)) return withdrawFromGroup(current, event.hiker);
  if (event.type === "restartGroup" && canRestartGroup(current)) return restartGroup(current);
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
  if (raw.type === "reviewGroup" && typeof raw.approved === "boolean") return { type: "reviewGroup", approved: raw.approved };
  if (raw.type === "expireGroup") return { type: "expireGroup" };
  if (raw.type === "answerGroup" && (raw.hiker === "FirstHiker" || raw.hiker === "SecondHiker" || raw.hiker === "ThirdHiker") && typeof raw.agrees === "boolean") return { type: "answerGroup", hiker: raw.hiker, agrees: raw.agrees };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingGroupReview" || raw.phase === "GroupInvited" || raw.phase === "ReviewDenied" || raw.phase === "GroupUnderfilled" || raw.phase === "HikeBooked" || raw.phase === "HikeCancelled") && Array.isArray(raw.accepted) && raw.accepted.every((x1: any) => (x1 === "FirstHiker" || x1 === "SecondHiker" || x1 === "ThirdHiker")) && Array.isArray(raw.declined) && raw.declined.every((x1: any) => (x1 === "FirstHiker" || x1 === "SecondHiker" || x1 === "ThirdHiker")) && Number.isSafeInteger(raw.invites) && Number.isSafeInteger(raw.meetings) && Number.isSafeInteger(raw.reveals) && Number.isSafeInteger(raw.cancellations) && Object.keys(raw).length === 7)) return undefined;
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
