// GENERATED from spec/reviewContactJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type UnlinkedCancellation as opportunityLifecycle_UnlinkedCancellation, type OpportunityPhase as opportunityLifecycle_OpportunityPhase, type OpportunityLifecycle as opportunityLifecycle_OpportunityLifecycle, groupCanContinue as opportunityLifecycle_groupCanContinue, acceptedProbeWithdrawalAllowed as opportunityLifecycle_acceptedProbeWithdrawalAllowed, stepRerollRequiresNewApproval as opportunityLifecycle_stepRerollRequiresNewApproval, alwaysContactStagesRequireApproval as opportunityLifecycle_alwaysContactStagesRequireApproval, canBook as opportunityLifecycle_canBook, book as opportunityLifecycle_book, lawAGroupNeedsAtLeastThree as opportunityLifecycle_lawAGroupNeedsAtLeastThree, acceptedProbeCanWithdraw as opportunityLifecycle_acceptedProbeCanWithdraw, lawAcceptedProbeWithdrawalNeedsExactMatch as opportunityLifecycle_lawAcceptedProbeWithdrawalNeedsExactMatch, bookedReplyCurrent as opportunityLifecycle_bookedReplyCurrent, initial as opportunityLifecycle_initial, unlinkedCancellation as opportunityLifecycle_unlinkedCancellation, closesForMinor as opportunityLifecycle_closesForMinor, canStartProbing as opportunityLifecycle_canStartProbing, canComplete as opportunityLifecycle_canComplete, complete as opportunityLifecycle_complete, canClose as opportunityLifecycle_canClose, close as opportunityLifecycle_close, stepTerminalOpportunityCannotReopen as opportunityLifecycle_stepTerminalOpportunityCannotReopen, sometimesCanBook as opportunityLifecycle_sometimesCanBook, sometimesCanComplete as opportunityLifecycle_sometimesCanComplete, sometimesCanCloseBeforeContact as opportunityLifecycle_sometimesCanCloseBeforeContact, startProbing as opportunityLifecycle_startProbing, releasesPartialAcceptance as opportunityLifecycle_releasesPartialAcceptance, canReroll as opportunityLifecycle_canReroll, reroll as opportunityLifecycle_reroll, lawPairLeftFromGroupNeedsFreshConsent as opportunityLifecycle_lawPairLeftFromGroupNeedsFreshConsent, lawBookedReplyRequiresCurrentConsent as opportunityLifecycle_lawBookedReplyRequiresCurrentConsent, upcomingCancellationEligible as opportunityLifecycle_upcomingCancellationEligible, lawUnlinkedCancellationNeedsOneMatch as opportunityLifecycle_lawUnlinkedCancellationNeedsOneMatch, lawNamedCancellationCanSelectWithPendingReply as opportunityLifecycle_lawNamedCancellationCanSelectWithPendingReply, lawAskedMinorClosesABookedOpportunity as opportunityLifecycle_lawAskedMinorClosesABookedOpportunity, lawMinorContactClosesAnUnbookedOpportunity as opportunityLifecycle_lawMinorContactClosesAnUnbookedOpportunity, lawReleaseNeedsAContactedAcceptor as opportunityLifecycle_lawReleaseNeedsAContactedAcceptor, lawStartedBookingCannotBeSelected as opportunityLifecycle_lawStartedBookingCannotBeSelected } from "./opportunityLifecycle.ts";
import { reviewLate as reviewDeadline_reviewLate, reviewRevisionCurrent as reviewDeadline_reviewRevisionCurrent, lawReviewDeadlineIsExclusive as reviewDeadline_lawReviewDeadlineIsExclusive, lawSeenReviewRevisionIsCurrent as reviewDeadline_lawSeenReviewRevisionIsCurrent, lawRerolledReviewIsStale as reviewDeadline_lawRerolledReviewIsStale } from "./reviewDeadline.ts";

/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
export type ReviewReply = "DecisionAccepted" | "DeadlinePassed" | "NoLongerPending";
/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
export type ContactReview = "AwaitingReviewer" | "ReviewerApproved" | "ReviewerRejected" | "ReviewExpired";
/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
export interface ReviewContactJourney { review: ContactReview; probeCount: number }
/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
export interface ReviewContactStep { state: ReviewContactJourney; out: ReviewReply[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "runServiceTick" }
  | { type: "decideProposal"; approve: boolean; atDeadline: boolean };

/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
export const initial: ReviewContactJourney = { review: "AwaitingReviewer", probeCount: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReviewContactJourney): boolean {
  return alwaysContactRequiresReview(current);
}

/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
//@ pure
export function canRunServiceTick(s: ReviewContactJourney): boolean {
  return true;
}

/** Story: Ask about an introduction only after a person approves / A pending proposal sends no probe (spec/reviewContactJourney.md) */
//@ pure
export function runServiceTick(s: ReviewContactJourney): ReviewContactStep {
  //@ ensures (inv(s) && canRunServiceTick(s)) ==> alwaysContactRequiresReview(\result.state)
  //@ ensures (inv(s) && canRunServiceTick(s)) ==> stepClosedReviewStaysClosed(s, \result.state)
  return { state: s, out: ([] as ReviewReply[]) };
}

/** Story: Ask about an introduction only after a person approves / Timely approval permits one anonymous probe to the requester (spec/reviewContactJourney.md) */
//@ pure
export function alwaysContactRequiresReview(s: ReviewContactJourney): boolean {
  return s.probeCount === (s.review === "ReviewerApproved" ? 1 : 0);
}

/** Story: Ask about an introduction only after a person approves / Timely approval permits one anonymous probe to the requester (spec/reviewContactJourney.md) */
//@ pure
export function sometimesFirstProbeIsSent(s: ReviewContactJourney): boolean {
  return s.probeCount === 1;
}

/** Story: Ask about an introduction only after a person approves / Timely approval permits one anonymous probe to the requester (spec/reviewContactJourney.md) */
//@ pure
export function canDecideProposal(s: ReviewContactJourney, approve: boolean, atDeadline: boolean): boolean {
  return true;
}

/** Story: Ask about an introduction only after a person approves / Timely approval permits one anonymous probe to the requester (spec/reviewContactJourney.md) */
//@ pure
export function decideProposal(s: ReviewContactJourney, approve: boolean, atDeadline: boolean): ReviewContactStep {
  //@ ensures (inv(s) && canDecideProposal(s, approve, atDeadline)) ==> alwaysContactRequiresReview(\result.state)
  //@ ensures (inv(s) && canDecideProposal(s, approve, atDeadline)) ==> stepClosedReviewStaysClosed(s, \result.state)
  return s.review !== "AwaitingReviewer" ? ({ state: s, out: (["NoLongerPending"] as ReviewReply[]) } as ReviewContactStep) : (reviewDeadline_reviewLate(atDeadline ? 1 : 0, 1) ? ({ state: ({ ...s, review: "ReviewExpired" } as ReviewContactJourney), out: (["DeadlinePassed"] as ReviewReply[]) } as ReviewContactStep) : (opportunityLifecycle_canStartProbing(opportunityLifecycle_initial, approve, true) ? ({ state: ({ review: "ReviewerApproved", probeCount: 1 } as ReviewContactJourney), out: (["DecisionAccepted"] as ReviewReply[]) } as ReviewContactStep) : ({ state: ({ ...s, review: "ReviewerRejected" } as ReviewContactJourney), out: (["DecisionAccepted"] as ReviewReply[]) } as ReviewContactStep)));
}

/** Story: Ask about an introduction only after a person approves / Rejected and expired items stay unsent (spec/reviewContactJourney.md) */
//@ pure
export function stepClosedReviewStaysClosed(before: ReviewContactJourney, after: ReviewContactJourney): boolean {
  return !(before.review !== "AwaitingReviewer") || equal_reviewContactJourney(after, before);
}

/** Story: Ask about an introduction only after a person approves / Rejected and expired items stay unsent (spec/reviewContactJourney.md) */
//@ pure
export function sometimesReviewerRejects(s: ReviewContactJourney): boolean {
  return s.review === "ReviewerRejected";
}

/** Story: Ask about an introduction only after a person approves / Rejected and expired items stay unsent (spec/reviewContactJourney.md) */
//@ pure
export function sometimesReviewExpires(s: ReviewContactJourney): boolean {
  return s.review === "ReviewExpired";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReviewContactJourney, event: Event): boolean {
  if (event.type === "runServiceTick") return canRunServiceTick(current);
  if (event.type === "decideProposal") return canDecideProposal(current, event.approve, event.atDeadline);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: ReviewContactJourney, event: Event): ReviewContactStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "runServiceTick") return canRunServiceTick(current) ? runServiceTick(current) : { state: current, out: ([] as ReviewReply[]) };
  if (event.type === "decideProposal") return canDecideProposal(current, event.approve, event.atDeadline) ? decideProposal(current, event.approve, event.atDeadline) : { state: current, out: ([] as ReviewReply[]) };
  return { state: current, out: ([] as ReviewReply[]) };
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
  if (raw.type === "runServiceTick") return { type: "runServiceTick" };
  if (raw.type === "decideProposal" && typeof raw.approve === "boolean" && typeof raw.atDeadline === "boolean") return { type: "decideProposal", approve: raw.approve, atDeadline: raw.atDeadline };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReviewContactJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.review === "AwaitingReviewer" || raw.review === "ReviewerApproved" || raw.review === "ReviewerRejected" || raw.review === "ReviewExpired") && Number.isSafeInteger(raw.probeCount) && Object.keys(raw).length === 2)) return undefined;
  const parsed: ReviewContactJourney = ({ review: raw.review, probeCount: raw.probeCount });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReviewContactJourney {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_reviewContactJourney(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_reviewContactJourney((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
