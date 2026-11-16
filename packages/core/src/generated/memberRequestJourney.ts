// GENERATED from spec/memberRequestJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type MemberRequestPhase as memberRequest_MemberRequestPhase, type MemberRequestFlow as memberRequest_MemberRequestFlow, immediateRetryMs as memberRequest_immediateRetryMs, scheduledRetryMs as memberRequest_scheduledRetryMs, requesterConfirmCooldownMs as memberRequest_requesterConfirmCooldownMs, scheduledRequestLifetimeMs as memberRequest_scheduledRequestLifetimeMs, sameStandingRequest as memberRequest_sameStandingRequest, requestInReuseWindow as memberRequest_requestInReuseWindow, memberRequestWithdrawable as memberRequest_memberRequestWithdrawable, closeOpportunityForRequestWithdrawal as memberRequest_closeOpportunityForRequestWithdrawal, waitingMemberRequest as memberRequest_waitingMemberRequest, requesterConfirmationAllowsRetry as memberRequest_requesterConfirmationAllowsRetry, requestDesireWithdrawn as memberRequest_requestDesireWithdrawn, primeMemberRequest as memberRequest_primeMemberRequest, canCheckRequestAdmission as memberRequest_canCheckRequestAdmission, checkRequestAdmission as memberRequest_checkRequestAdmission, canRouteRepeatedRequest as memberRequest_canRouteRepeatedRequest, routeRepeatedRequest as memberRequest_routeRepeatedRequest, canRouteNewRequest as memberRequest_canRouteNewRequest, routeNewRequest as memberRequest_routeNewRequest, canApplyRequestWithdrawal as memberRequest_canApplyRequestWithdrawal, applyRequestWithdrawal as memberRequest_applyRequestWithdrawal, immediateRequestRetryReady as memberRequest_immediateRequestRetryReady, scheduledRequestRetryReady as memberRequest_scheduledRequestRetryReady, canRouteImmediateRequestRetry as memberRequest_canRouteImmediateRequestRetry, routeImmediateRequestRetry as memberRequest_routeImmediateRequestRetry, canConsiderScheduledRequestRetry as memberRequest_canConsiderScheduledRequestRetry, considerScheduledRequestRetry as memberRequest_considerScheduledRequestRetry, canRouteScheduledRequestRetry as memberRequest_canRouteScheduledRequestRetry, routeScheduledRequestRetry as memberRequest_routeScheduledRequestRetry, canReadRequestCandidates as memberRequest_canReadRequestCandidates, readRequestCandidates as memberRequest_readRequestCandidates, lawWithdrawalPreventsRequestPriming as memberRequest_lawWithdrawalPreventsRequestPriming, stepRequestReviewFollowsSearch as memberRequest_stepRequestReviewFollowsSearch, sometimesReviewsMemberRequest as memberRequest_sometimesReviewsMemberRequest, sometimesFindsNoRequestCandidate as memberRequest_sometimesFindsNoRequestCandidate, sometimesWithdrawsMemberRequest as memberRequest_sometimesWithdrawsMemberRequest, initial as memberRequest_initial } from "./memberRequest.ts";

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
export type RequestEffect = "ReviewQueued" | "ReviewCleared" | "ParticipantContacted";
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
export type RequestView = "NoRequest" | "WaitingForCandidate" | "PendingHumanReview" | "WithdrawnRequest";
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
export interface MemberRequestJourney { candidateAvailable: boolean; request: RequestView; requestCount: number; attempts: number }
/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
export interface RequestUpdate { state: MemberRequestJourney; out: RequestEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "textRequest" }
  | { type: "candidateArrives" }
  | { type: "restartJourney" }
  | { type: "textWithdrawal" };

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
export const initial: MemberRequestJourney = { candidateAvailable: false, request: "NoRequest", requestCount: 0, attempts: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function sometimesWaits(s: MemberRequestJourney): boolean {
  return s.request === "WaitingForCandidate";
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function sometimesRequestsReview(s: MemberRequestJourney): boolean {
  return s.request === "PendingHumanReview";
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function offerFor(candidateAvailable: boolean): RequestView {
  return candidateAvailable ? "PendingHumanReview" : "WaitingForCandidate";
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function effectsFor(candidateAvailable: boolean): RequestEffect[] {
  return candidateAvailable ? ["ReviewQueued"] : ([] as RequestEffect[]);
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function canTextRequest(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A repeat ask keeps the current request (spec/memberRequestJourney.md:9) */
//@ pure
export function textRequest(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canTextRequest(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "textRequest", \result.state)
  return s.request === "WaitingForCandidate" || s.request === "PendingHumanReview" ? ({ state: s, out: ([] as RequestEffect[]) } as RequestUpdate) : ({ state: ({ ...s, request: offerFor(s.candidateAvailable), requestCount: exact_memberRequestJourney(s.requestCount + 1), attempts: 1 } as MemberRequestJourney), out: effectsFor(s.candidateAvailable) } as RequestUpdate);
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md:36) */
//@ pure
export function canCandidateArrives(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md:36) */
//@ pure
export function sometimesRetriesExistingRequest(s: MemberRequestJourney): boolean {
  return s.request === "PendingHumanReview" && s.requestCount === 1 && s.attempts === 2;
}

/** Story: Keep control of my request for an introduction / A newly available candidate can take the waiting search to review (spec/memberRequestJourney.md:36) */
//@ pure
export function candidateArrives(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canCandidateArrives(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "candidateArrives", \result.state)
  return s.candidateAvailable ? ({ state: s, out: ([] as RequestEffect[]) } as RequestUpdate) : (s.request === "WaitingForCandidate" ? ({ state: ({ ...s, candidateAvailable: true, request: "PendingHumanReview", attempts: exact_memberRequestJourney(s.attempts + 1) } as MemberRequestJourney), out: ["ReviewQueued"] } as RequestUpdate) : ({ state: ({ ...s, candidateAvailable: true } as MemberRequestJourney), out: ([] as RequestEffect[]) } as RequestUpdate));
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function canTextWithdrawal(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function canRestartJourney(s: MemberRequestJourney): boolean {
  return true;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function sometimesWithdrawsRequest(s: MemberRequestJourney): boolean {
  return s.request === "WithdrawnRequest";
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function sometimesWithdrawsAfterRetry(s: MemberRequestJourney): boolean {
  return s.request === "WithdrawnRequest" && s.attempts === 2;
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function sometimesReopensSearch(s: MemberRequestJourney): boolean {
  return s.requestCount > 1 && s.request === "PendingHumanReview";
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function stepAWithdrawnRequestNeedsNewAsk(before: MemberRequestJourney, via: string, after: MemberRequestJourney): boolean {
  return !(before.request === "WithdrawnRequest" && after.request !== "WithdrawnRequest") || via === "textRequest";
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function restartJourney(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canRestartJourney(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "restartJourney", \result.state)
  return { state: s, out: ([] as RequestEffect[]) };
}

/** Story: Keep control of my request for an introduction / Withdrawal clears a waiting review and remains closed after restart (spec/memberRequestJourney.md:51) */
//@ pure
export function textWithdrawal(s: MemberRequestJourney): RequestUpdate {
  //@ ensures (inv(s) && canTextWithdrawal(s)) ==> stepAWithdrawnRequestNeedsNewAsk(s, "textWithdrawal", \result.state)
  const local_0 = s.request === "PendingHumanReview" ? "probing" : "none";
  const local_1 = memberRequest_memberRequestWithdrawable(true, s.request !== "NoRequest", true, s.request === "WithdrawnRequest", local_0);
  return { state: local_1 ? ({ ...s, request: "WithdrawnRequest" } as MemberRequestJourney) : s, out: s.request === "PendingHumanReview" ? ["ReviewCleared"] : ([] as RequestEffect[]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: MemberRequestJourney, event: Event): boolean {
  if (event.type === "textRequest") return canTextRequest(current);
  if (event.type === "candidateArrives") return canCandidateArrives(current);
  if (event.type === "restartJourney") return canRestartJourney(current);
  if (event.type === "textWithdrawal") return canTextWithdrawal(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: MemberRequestJourney, event: Event): RequestUpdate {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "textRequest" && canTextRequest(current)) return textRequest(current);
  if (event.type === "candidateArrives" && canCandidateArrives(current)) return candidateArrives(current);
  if (event.type === "restartJourney" && canRestartJourney(current)) return restartJourney(current);
  if (event.type === "textWithdrawal" && canTextWithdrawal(current)) return textWithdrawal(current);
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
  if (raw.type === "restartJourney") return { type: "restartJourney" };
  if (raw.type === "textWithdrawal") return { type: "textWithdrawal" };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.candidateAvailable === "boolean" && (raw.request === "NoRequest" || raw.request === "WaitingForCandidate" || raw.request === "PendingHumanReview" || raw.request === "WithdrawnRequest") && Number.isSafeInteger(raw.requestCount) && Number.isSafeInteger(raw.attempts) && Object.keys(raw).length === 4)) return undefined;
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
