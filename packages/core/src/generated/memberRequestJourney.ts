// GENERATED from spec/memberRequestJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type MemberRequestPhase as memberRequest_MemberRequestPhase, type MemberRequestFlow as memberRequest_MemberRequestFlow, learnDuringRequestIntake as memberRequest_learnDuringRequestIntake, lawDirectRequestPassesInterview as memberRequest_lawDirectRequestPassesInterview, initial as memberRequest_initial, sameStandingRequest as memberRequest_sameStandingRequest, requestInReuseWindow as memberRequest_requestInReuseWindow, canCheckRequestAdmission as memberRequest_canCheckRequestAdmission, checkRequestAdmission as memberRequest_checkRequestAdmission, canRouteRepeatedRequest as memberRequest_canRouteRepeatedRequest, routeRepeatedRequest as memberRequest_routeRepeatedRequest, canRouteNewRequest as memberRequest_canRouteNewRequest, routeNewRequest as memberRequest_routeNewRequest, memberRequestWithdrawable as memberRequest_memberRequestWithdrawable, withdrawnRequestKeepsOpportunity as memberRequest_withdrawnRequestKeepsOpportunity, requesterHearsOpportunityClose as memberRequest_requesterHearsOpportunityClose, lawWithdrawnRequestHearsNoClose as memberRequest_lawWithdrawnRequestHearsNoClose, lawEndedOpportunityIsNotKept as memberRequest_lawEndedOpportunityIsNotKept, canApplyRequestWithdrawal as memberRequest_canApplyRequestWithdrawal, applyRequestWithdrawal as memberRequest_applyRequestWithdrawal, immediateRetryMs as memberRequest_immediateRetryMs, scheduledRetryMs as memberRequest_scheduledRetryMs, requesterConfirmCooldownMs as memberRequest_requesterConfirmCooldownMs, scheduledRequestLifetimeMs as memberRequest_scheduledRequestLifetimeMs, waitingMemberRequest as memberRequest_waitingMemberRequest, requesterConfirmationAllowsRetry as memberRequest_requesterConfirmationAllowsRetry, immediateRequestRetryReady as memberRequest_immediateRequestRetryReady, immediateRequestSearchAllowed as memberRequest_immediateRequestSearchAllowed, lawImmediateRetryNeedsEligibleWaitingMember as memberRequest_lawImmediateRetryNeedsEligibleWaitingMember, scheduledRequestRetryReady as memberRequest_scheduledRequestRetryReady, canRouteImmediateRequestRetry as memberRequest_canRouteImmediateRequestRetry, routeImmediateRequestRetry as memberRequest_routeImmediateRequestRetry, canConsiderScheduledRequestRetry as memberRequest_canConsiderScheduledRequestRetry, considerScheduledRequestRetry as memberRequest_considerScheduledRequestRetry, canRouteScheduledRequestRetry as memberRequest_canRouteScheduledRequestRetry, routeScheduledRequestRetry as memberRequest_routeScheduledRequestRetry, requestDesireWithdrawn as memberRequest_requestDesireWithdrawn, primeMemberRequest as memberRequest_primeMemberRequest, canReadRequestCandidates as memberRequest_canReadRequestCandidates, readRequestCandidates as memberRequest_readRequestCandidates, lawWithdrawalPreventsRequestPriming as memberRequest_lawWithdrawalPreventsRequestPriming, stepRequestReviewFollowsSearch as memberRequest_stepRequestReviewFollowsSearch, sometimesReviewsMemberRequest as memberRequest_sometimesReviewsMemberRequest, sometimesFindsNoRequestCandidate as memberRequest_sometimesFindsNoRequestCandidate, sometimesWithdrawsMemberRequest as memberRequest_sometimesWithdrawsMemberRequest } from "./memberRequest.ts";

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
export type RequestView = "NoRequest" | "WaitingForCandidate" | "PendingReview" | "WithdrawnRequest";
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
export interface MemberRequestJourney { candidateAvailable: boolean; request: RequestView; requestCount: number; attempts: number }
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
export type RequestEffect = "ReviewQueued" | "ReviewCleared" | "ParticipantContacted";
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
export interface RequestUpdate { state: MemberRequestJourney; out: RequestEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "textRequest" }
  | { type: "candidateArrives" }
  | { type: "textWithdrawal" }
  | { type: "restartJourney" };

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
export const initial: MemberRequestJourney = { candidateAvailable: false, request: "NoRequest", requestCount: 0, attempts: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function offerFor(candidateAvailable: boolean): RequestView {
  return candidateAvailable ? "PendingReview" : "WaitingForCandidate";
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function effectsFor(candidateAvailable: boolean): RequestEffect[] {
  return candidateAvailable ? (["ReviewQueued"] as RequestEffect[]) : ([] as RequestEffect[]);
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function canTextRequest(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function textRequest(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canTextRequest(s)) ==> stepNoParticipantContactedBeforeReview(s, \result.state, \result.out)
  //@ ensures (inv(s) && canTextRequest(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "textRequest", \result.state)
  return s.request === "WaitingForCandidate" || s.request === "PendingReview" ? ({ state: s, out: ([] as RequestEffect[]) } as RequestUpdate) : ({ state: ({ ...s, request: offerFor(s.candidateAvailable), requestCount: exact_memberRequestJourney(s.requestCount + 1), attempts: 1 } as MemberRequestJourney), out: effectsFor(s.candidateAvailable) } as RequestUpdate);
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function stepNoParticipantContactedBeforeReview(before: MemberRequestJourney, after: MemberRequestJourney, out: RequestEffect[]): boolean {
  return !out.some((effect: RequestEffect) => effect === "ParticipantContacted");
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function sometimesWaits(s: MemberRequestJourney): boolean {
  return s.request === "WaitingForCandidate";
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md) */
//@ pure
export function sometimesRequestsReview(s: MemberRequestJourney): boolean {
  return s.request === "PendingReview";
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md) */
//@ pure
export function canCandidateArrives(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md) */
//@ pure
export function candidateArrives(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canCandidateArrives(s)) ==> stepNoParticipantContactedBeforeReview(s, \result.state, \result.out)
  //@ ensures (inv(s) && canCandidateArrives(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "candidateArrives", \result.state)
  return s.candidateAvailable ? ({ state: s, out: ([] as RequestEffect[]) } as RequestUpdate) : (s.request === "WaitingForCandidate" ? ({ state: ({ ...s, candidateAvailable: true, request: "PendingReview", attempts: exact_memberRequestJourney(s.attempts + 1) } as MemberRequestJourney), out: (["ReviewQueued"] as RequestEffect[]) } as RequestUpdate) : ({ state: ({ ...s, candidateAvailable: true } as MemberRequestJourney), out: ([] as RequestEffect[]) } as RequestUpdate));
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md) */
//@ pure
export function sometimesRetriesExistingRequest(s: MemberRequestJourney): boolean {
  return s.request === "PendingReview" && s.requestCount === 1 && s.attempts === 2;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function canTextWithdrawal(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function textWithdrawal(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canTextWithdrawal(s)) ==> stepNoParticipantContactedBeforeReview(s, \result.state, \result.out)
  //@ ensures (inv(s) && canTextWithdrawal(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "textWithdrawal", \result.state)
  const local_0 = s.request === "PendingReview" ? "probing" : "none";
  const local_1 = memberRequest_memberRequestWithdrawable(true, s.request !== "NoRequest", true, s.request === "WithdrawnRequest", local_0);
  return { state: local_1 ? ({ ...s, request: "WithdrawnRequest" } as MemberRequestJourney) : s, out: s.request === "PendingReview" ? (["ReviewCleared"] as RequestEffect[]) : ([] as RequestEffect[]) };
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function canRestartJourney(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function restartJourney(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canRestartJourney(s)) ==> stepNoParticipantContactedBeforeReview(s, \result.state, \result.out)
  //@ ensures (inv(s) && canRestartJourney(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "restartJourney", \result.state)
  return { state: s, out: ([] as RequestEffect[]) };
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function sometimesWithdrawsRequest(s: MemberRequestJourney): boolean {
  return s.request === "WithdrawnRequest";
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function sometimesWithdrawsAfterRetry(s: MemberRequestJourney): boolean {
  return s.request === "WithdrawnRequest" && s.attempts === 2;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function sometimesReopensSearch(s: MemberRequestJourney): boolean {
  return s.requestCount > 1 && s.request === "PendingReview";
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md) */
//@ pure
export function stepAWithdrawnRequestNeedsNewAsk(before: MemberRequestJourney, via: string, after: MemberRequestJourney): boolean {
  return !(before.request === "WithdrawnRequest" && after.request !== "WithdrawnRequest") || via === "textRequest";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: MemberRequestJourney, event: Event): boolean {
  if (event.type === "textRequest") return canTextRequest(current);
  if (event.type === "candidateArrives") return canCandidateArrives(current);
  if (event.type === "textWithdrawal") return canTextWithdrawal(current);
  if (event.type === "restartJourney") return canRestartJourney(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: MemberRequestJourney, event: Event): RequestUpdate {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "textRequest") return canTextRequest(current) ? textRequest(current) : { state: current, out: ([] as RequestEffect[]) };
  if (event.type === "candidateArrives") return canCandidateArrives(current) ? candidateArrives(current) : { state: current, out: ([] as RequestEffect[]) };
  if (event.type === "textWithdrawal") return canTextWithdrawal(current) ? textWithdrawal(current) : { state: current, out: ([] as RequestEffect[]) };
  if (event.type === "restartJourney") return canRestartJourney(current) ? restartJourney(current) : { state: current, out: ([] as RequestEffect[]) };
  return { state: current, out: ([] as RequestEffect[]) };
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
  if (raw.type === "textRequest") return { type: "textRequest" };
  if (raw.type === "candidateArrives") return { type: "candidateArrives" };
  if (raw.type === "textWithdrawal") return { type: "textWithdrawal" };
  if (raw.type === "restartJourney") return { type: "restartJourney" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): MemberRequestJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.candidateAvailable === "boolean" && (raw.request === "NoRequest" || raw.request === "WaitingForCandidate" || raw.request === "PendingReview" || raw.request === "WithdrawnRequest") && Number.isSafeInteger(raw.requestCount) && Number.isSafeInteger(raw.attempts) && Object.keys(raw).length === 4)) return undefined;
  const parsed: MemberRequestJourney = ({ candidateAvailable: raw.candidateAvailable, request: raw.request, requestCount: raw.requestCount, attempts: raw.attempts });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): MemberRequestJourney {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_memberRequestJourney(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
