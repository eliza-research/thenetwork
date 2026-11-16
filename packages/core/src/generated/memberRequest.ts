// GENERATED from spec/memberRequest.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
export type MemberRequestPhase = "RequestStarting" | "RequestRepeated" | "RequestAdmitted" | "RequestOutOfScope" | "RequestQuietRepeat" | "RequestAlreadyProbing" | "RequestMatchingPaused" | "CheckingImmediateRetry" | "RequestOnHold" | "RequestMemberBusy" | "CheckingScheduledMember" | "RequestDeferred" | "RequestSearching" | "RequestAwaitingReview" | "RequestWithoutCandidate" | "RequestWithdrawn" | "RequestKept";
/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
export interface MemberRequestFlow { phase: MemberRequestPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkRequestAdmission"; repeat: boolean; categoryAllowed: boolean }
  | { type: "routeRepeatedRequest"; quiet: boolean; probing: boolean; matching: boolean }
  | { type: "routeNewRequest"; matching: boolean; eligible: boolean; busy: boolean }
  | { type: "applyRequestWithdrawal"; matched: boolean }
  | { type: "routeImmediateRequestRetry"; ready: boolean }
  | { type: "considerScheduledRequestRetry"; due: boolean }
  | { type: "routeScheduledRequestRetry"; eligible: boolean; busy: boolean }
  | { type: "readRequestCandidates"; anyCandidate: boolean };

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
export const immediateRetryMs: number = 3600000;
/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
export const scheduledRetryMs: number = 72000000;
/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
export const requesterConfirmCooldownMs: number = 259200000;
/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
export const scheduledRequestLifetimeMs: number = 604800000;
/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
export const initial: MemberRequestFlow = { phase: "RequestStarting" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: MemberRequestFlow): boolean {
  return true;
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function sameStandingRequest(sameMember: boolean, people: boolean, sameWant: boolean, withdrawn: boolean, status: string): boolean {
  return sameMember && people && sameWant && !withdrawn && status !== "booked" && status !== "fulfilled";
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function requestInReuseWindow(probing: boolean, age: number, interval: number): boolean {
  return probing || age < interval;
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function canCheckRequestAdmission(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestStarting";
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function checkRequestAdmission(flow: MemberRequestFlow, repeat: boolean, categoryAllowed: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canCheckRequestAdmission(flow)) ==> stepRequestReviewFollowsSearch(flow, "checkRequestAdmission", \result)
  return { phase: repeat ? "RequestRepeated" : (categoryAllowed ? "RequestAdmitted" : "RequestOutOfScope") };
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function canRouteRepeatedRequest(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestRepeated";
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function routeRepeatedRequest(flow: MemberRequestFlow, quiet: boolean, probing: boolean, matching: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canRouteRepeatedRequest(flow)) ==> stepRequestReviewFollowsSearch(flow, "routeRepeatedRequest", \result)
  return { phase: quiet ? "RequestQuietRepeat" : (probing ? "RequestAlreadyProbing" : (!matching ? "RequestMatchingPaused" : "CheckingImmediateRetry")) };
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function canRouteNewRequest(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestAdmitted";
}

/** Story: Ask to meet someone and change my mind while the search is open / A repeat ask keeps the newest matching request (spec/memberRequest.md:9) */
//@ pure
export function routeNewRequest(flow: MemberRequestFlow, matching: boolean, eligible: boolean, busy: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canRouteNewRequest(flow)) ==> stepRequestReviewFollowsSearch(flow, "routeNewRequest", \result)
  return { phase: !matching ? "RequestMatchingPaused" : (!eligible ? "RequestOnHold" : (busy ? "RequestMemberBusy" : "RequestSearching")) };
}

/** Story: Ask to meet someone and change my mind while the search is open / Only the member's pending request for a withdrawn desire closes (spec/memberRequest.md:43) */
//@ pure
export function memberRequestWithdrawable(sameMember: boolean, people: boolean, desireMatches: boolean, withdrawn: boolean, status: string): boolean {
  return sameMember && people && desireMatches && !withdrawn && (status === "none" || status === "probing");
}

/** Story: Ask to meet someone and change my mind while the search is open / Only the member's pending request for a withdrawn desire closes (spec/memberRequest.md:43) */
//@ pure
export function closeOpportunityForRequestWithdrawal(stage: string): boolean {
  return stage === "review" || stage === "probing";
}

/** Story: Ask to meet someone and change my mind while the search is open / Only the member's pending request for a withdrawn desire closes (spec/memberRequest.md:43) */
//@ pure
export function canApplyRequestWithdrawal(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestStarting";
}

/** Story: Ask to meet someone and change my mind while the search is open / Only the member's pending request for a withdrawn desire closes (spec/memberRequest.md:43) */
//@ pure
export function applyRequestWithdrawal(flow: MemberRequestFlow, matched: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canApplyRequestWithdrawal(flow)) ==> stepRequestReviewFollowsSearch(flow, "applyRequestWithdrawal", \result)
  return { phase: matched ? "RequestWithdrawn" : "RequestKept" };
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function waitingMemberRequest(status: string, closed: boolean): boolean {
  return status === "none" && !closed;
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function requesterConfirmationAllowsRetry(asked: boolean, elapsed: number): boolean {
  return !(asked && elapsed < requesterConfirmCooldownMs);
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function immediateRequestRetryReady(attempted: boolean, attemptAge: number, asked: boolean, confirmAge: number): boolean {
  return (!attempted || attemptAge > immediateRetryMs) && requesterConfirmationAllowsRetry(asked, confirmAge);
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function scheduledRequestRetryReady(people: boolean, waiting: boolean, age: number, attempted: boolean, attemptAge: number, asked: boolean, confirmAge: number): boolean {
  return people && waiting && !(age > scheduledRequestLifetimeMs) && !(attempted && attemptAge < scheduledRetryMs) && requesterConfirmationAllowsRetry(asked, confirmAge);
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function canRouteImmediateRequestRetry(flow: MemberRequestFlow): boolean {
  return flow.phase === "CheckingImmediateRetry";
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function routeImmediateRequestRetry(flow: MemberRequestFlow, ready: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canRouteImmediateRequestRetry(flow)) ==> stepRequestReviewFollowsSearch(flow, "routeImmediateRequestRetry", \result)
  return { phase: ready ? "RequestSearching" : "RequestDeferred" };
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function canConsiderScheduledRequestRetry(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestStarting";
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function considerScheduledRequestRetry(flow: MemberRequestFlow, due: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canConsiderScheduledRequestRetry(flow)) ==> stepRequestReviewFollowsSearch(flow, "considerScheduledRequestRetry", \result)
  return { phase: due ? "CheckingScheduledMember" : "RequestDeferred" };
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function canRouteScheduledRequestRetry(flow: MemberRequestFlow): boolean {
  return flow.phase === "CheckingScheduledMember";
}

/** Story: Ask to meet someone and change my mind while the search is open / A standing request waits for its next search window (spec/memberRequest.md:58) */
//@ pure
export function routeScheduledRequestRetry(flow: MemberRequestFlow, eligible: boolean, busy: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canRouteScheduledRequestRetry(flow)) ==> stepRequestReviewFollowsSearch(flow, "routeScheduledRequestRetry", \result)
  return { phase: eligible && !busy ? "RequestSearching" : "RequestDeferred" };
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function requestDesireWithdrawn(closedIntent: boolean, activeIntent: boolean): boolean {
  return closedIntent && !activeIntent;
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function primeMemberRequest(withdrawnIntent: boolean, strongFit: boolean, selective: boolean): boolean {
  return !withdrawnIntent && (strongFit || !selective);
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function canReadRequestCandidates(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestSearching";
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function readRequestCandidates(flow: MemberRequestFlow, anyCandidate: boolean): MemberRequestFlow {
  //@ ensures (inv(flow) && canReadRequestCandidates(flow)) ==> stepRequestReviewFollowsSearch(flow, "readRequestCandidates", \result)
  return { phase: anyCandidate ? "RequestAwaitingReview" : "RequestWithoutCandidate" };
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function lawWithdrawalPreventsRequestPriming(strongFit: boolean, selective: boolean): boolean {
  //@ ensures \result === true
  return !primeMemberRequest(true, strongFit, selective);
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function stepRequestReviewFollowsSearch(before: MemberRequestFlow, via: string, after: MemberRequestFlow): boolean {
  return !(after.phase === "RequestAwaitingReview") || (before.phase === "RequestSearching" && via === "readRequestCandidates");
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function sometimesReviewsMemberRequest(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestAwaitingReview";
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function sometimesFindsNoRequestCandidate(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestWithoutCandidate";
}

/** Story: Ask to meet someone and change my mind while the search is open / A candidate proceeds to review with prior interest only when appropriate (spec/memberRequest.md:93) */
//@ pure
export function sometimesWithdrawsMemberRequest(flow: MemberRequestFlow): boolean {
  return flow.phase === "RequestWithdrawn";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: MemberRequestFlow, event: Event): boolean {
  if (event.type === "checkRequestAdmission") return canCheckRequestAdmission(current);
  if (event.type === "routeRepeatedRequest") return canRouteRepeatedRequest(current);
  if (event.type === "routeNewRequest") return canRouteNewRequest(current);
  if (event.type === "applyRequestWithdrawal") return canApplyRequestWithdrawal(current);
  if (event.type === "routeImmediateRequestRetry") return canRouteImmediateRequestRetry(current);
  if (event.type === "considerScheduledRequestRetry") return canConsiderScheduledRequestRetry(current);
  if (event.type === "routeScheduledRequestRetry") return canRouteScheduledRequestRetry(current);
  if (event.type === "readRequestCandidates") return canReadRequestCandidates(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: MemberRequestFlow, event: Event): MemberRequestFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkRequestAdmission" && canCheckRequestAdmission(current)) return checkRequestAdmission(current, event.repeat, event.categoryAllowed);
  if (event.type === "routeRepeatedRequest" && canRouteRepeatedRequest(current)) return routeRepeatedRequest(current, event.quiet, event.probing, event.matching);
  if (event.type === "routeNewRequest" && canRouteNewRequest(current)) return routeNewRequest(current, event.matching, event.eligible, event.busy);
  if (event.type === "applyRequestWithdrawal" && canApplyRequestWithdrawal(current)) return applyRequestWithdrawal(current, event.matched);
  if (event.type === "routeImmediateRequestRetry" && canRouteImmediateRequestRetry(current)) return routeImmediateRequestRetry(current, event.ready);
  if (event.type === "considerScheduledRequestRetry" && canConsiderScheduledRequestRetry(current)) return considerScheduledRequestRetry(current, event.due);
  if (event.type === "routeScheduledRequestRetry" && canRouteScheduledRequestRetry(current)) return routeScheduledRequestRetry(current, event.eligible, event.busy);
  if (event.type === "readRequestCandidates" && canReadRequestCandidates(current)) return readRequestCandidates(current, event.anyCandidate);
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
  if (raw.type === "checkRequestAdmission" && typeof raw.repeat === "boolean" && typeof raw.categoryAllowed === "boolean") return { type: "checkRequestAdmission", repeat: raw.repeat, categoryAllowed: raw.categoryAllowed };
  if (raw.type === "routeRepeatedRequest" && typeof raw.quiet === "boolean" && typeof raw.probing === "boolean" && typeof raw.matching === "boolean") return { type: "routeRepeatedRequest", quiet: raw.quiet, probing: raw.probing, matching: raw.matching };
  if (raw.type === "routeNewRequest" && typeof raw.matching === "boolean" && typeof raw.eligible === "boolean" && typeof raw.busy === "boolean") return { type: "routeNewRequest", matching: raw.matching, eligible: raw.eligible, busy: raw.busy };
  if (raw.type === "applyRequestWithdrawal" && typeof raw.matched === "boolean") return { type: "applyRequestWithdrawal", matched: raw.matched };
  if (raw.type === "routeImmediateRequestRetry" && typeof raw.ready === "boolean") return { type: "routeImmediateRequestRetry", ready: raw.ready };
  if (raw.type === "considerScheduledRequestRetry" && typeof raw.due === "boolean") return { type: "considerScheduledRequestRetry", due: raw.due };
  if (raw.type === "routeScheduledRequestRetry" && typeof raw.eligible === "boolean" && typeof raw.busy === "boolean") return { type: "routeScheduledRequestRetry", eligible: raw.eligible, busy: raw.busy };
  if (raw.type === "readRequestCandidates" && typeof raw.anyCandidate === "boolean") return { type: "readRequestCandidates", anyCandidate: raw.anyCandidate };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): MemberRequestFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "RequestStarting" || raw.phase === "RequestRepeated" || raw.phase === "RequestAdmitted" || raw.phase === "RequestOutOfScope" || raw.phase === "RequestQuietRepeat" || raw.phase === "RequestAlreadyProbing" || raw.phase === "RequestMatchingPaused" || raw.phase === "CheckingImmediateRetry" || raw.phase === "RequestOnHold" || raw.phase === "RequestMemberBusy" || raw.phase === "CheckingScheduledMember" || raw.phase === "RequestDeferred" || raw.phase === "RequestSearching" || raw.phase === "RequestAwaitingReview" || raw.phase === "RequestWithoutCandidate" || raw.phase === "RequestWithdrawn" || raw.phase === "RequestKept") && Object.keys(raw).length === 1)) return undefined;
  const parsed: MemberRequestFlow = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): MemberRequestFlow {
  //@ ensures inv(\result)
  return initial;
}
