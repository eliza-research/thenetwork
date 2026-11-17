// GENERATED from spec/boundedHelp.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md) */
export type BoundedHelpRoute = "SearchPublicHelp" | "ReviewHomeEntryHelp" | "RefuseHighRiskHelp";
/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
export type HomeHelpTask = "MoveFurniture" | "CarryBoxes";
/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
export type HomeHelpAlternative = "NoSuitableService" | "ServiceUnavailable" | "MemberDeclinedService";
/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
export type HomeHelpPhase = "NotSubmitted" | "AwaitingHelpers" | "AwaitingReview" | "Approved" | "Closed";
/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
export interface HomeHelpPlan { phase: HomeHelpPhase; revision: number; expiresAt: number; rosterKey: string }

/** One variant per transition in the spec. */
export type Event =
  | { type: "submitHomeHelp"; draftAllowed: boolean; expiresAt: number }
  | { type: "setHomeHelpRoster"; now: number; revision: number; rosterKey: string; rosterAllowed: boolean }
  | { type: "reviseHomeHelp"; now: number; revision: number; draftAllowed: boolean; expiresAt: number }
  | { type: "approveHomeHelp"; now: number; revision: number; rosterKey: string; reviewerAuthorized: boolean; rosterAllowed: boolean }
  | { type: "closeHomeHelp"; now: number; revision: number; authorized: boolean }
  | { type: "expireHomeHelp"; now: number };

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
export const initial: HomeHelpPlan = { phase: "NotSubmitted", revision: 0, expiresAt: 0, rosterKey: "" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: HomeHelpPlan): boolean {
  return alwaysSubmittedHomeHelpHasDeadline(current) && alwaysHomeHelpReviewHasFixedRoster(current);
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md) */
//@ pure
export function openHomeHelpCase(adult: boolean, hasOpenCase: boolean): boolean {
  return adult && !hasOpenCase;
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md) */
//@ pure
export function boundedHelpRoute(highRisk: boolean, homeEntry: boolean): BoundedHelpRoute {
  return highRisk ? "RefuseHighRiskHelp" : (homeEntry ? "ReviewHomeEntryHelp" : "SearchPublicHelp");
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md) */
//@ pure
export function lawHomeHelpNeverUsesPublicSearch(highRisk: boolean): boolean {
  //@ ensures \result === true
  return boundedHelpRoute(highRisk, true) !== "SearchPublicHelp";
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md) */
//@ pure
export function lawHighRiskHelpTakesPrecedence(homeEntry: boolean): boolean {
  //@ ensures \result === true
  return boundedHelpRoute(true, homeEntry) === "RefuseHighRiskHelp";
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md) */
//@ pure
export function homeHelperSetAllowed(helperCount: number, knownSingleton: boolean): boolean {
  return helperCount >= 2 || (helperCount === 1 && knownSingleton);
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md) */
//@ pure
export function needsSecondHomeHelper(homeEntry: boolean, requestedHelpers: number, knownSingleton: boolean): boolean {
  return homeEntry && requestedHelpers === 1 && !knownSingleton;
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md) */
//@ pure
export function lawUnfamiliarHomeSingletonIsDisallowed(helperCount: number): boolean {
  //@ ensures \result === true
  return !(helperCount < 2) || !homeHelperSetAllowed(helperCount, false);
}

/** Story: Review a private home-help plan with a fixed roster / A moving-help offer comes from its own eligible member (spec/boundedHelp.md) */
//@ pure
export function homeHelpOfferChangeAllowed(eligibleAdultOwner: boolean, explicitChoice: boolean): boolean {
  return eligibleAdultOwner && explicitChoice;
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function homeHelpTaskKnown(task: string): boolean {
  return task === "MoveFurniture" || task === "CarryBoxes";
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function homeHelpAlternativeKnown(alternative: string): boolean {
  return alternative === "NoSuitableService" || alternative === "ServiceUnavailable" || alternative === "MemberDeclinedService";
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function homeHelpDraftAllowed(ownerEligible: boolean, detailsConfirmed: boolean, knownArea: boolean, alternativeChecked: boolean, now: number, expiresAt: number, startsAt: number, endsAt: number, effortMinutes: number): boolean {
  return ownerEligible && detailsConfirmed && knownArea && alternativeChecked && now < expiresAt && expiresAt <= startsAt && startsAt < endsAt && effortMinutes > 0 && exact_boundedHelp(effortMinutes * 60000) <= exact_boundedHelp(endsAt - startsAt);
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function canSubmitHomeHelp(plan: HomeHelpPlan, draftAllowed: boolean, expiresAt: number): boolean {
  return plan.phase === "NotSubmitted" && draftAllowed && expiresAt > 0;
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function submitHomeHelp(plan: HomeHelpPlan, draftAllowed: boolean, expiresAt: number): HomeHelpPlan {
  //@ ensures (inv(plan) && canSubmitHomeHelp(plan, draftAllowed, expiresAt)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canSubmitHomeHelp(plan, draftAllowed, expiresAt)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canSubmitHomeHelp(plan, draftAllowed, expiresAt)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canSubmitHomeHelp(plan, draftAllowed, expiresAt)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { phase: "AwaitingHelpers", revision: 1, expiresAt: expiresAt, rosterKey: "" };
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function homeHelpOpen(plan: HomeHelpPlan, now: number): boolean {
  return (plan.phase === "AwaitingHelpers" || plan.phase === "AwaitingReview" || plan.phase === "Approved") && now < plan.expiresAt;
}

/** Story: Review a private home-help plan with a fixed roster / Intake keeps only structured home-help details after considering a service (spec/boundedHelp.md) */
//@ pure
export function alwaysSubmittedHomeHelpHasDeadline(plan: HomeHelpPlan): boolean {
  return !(plan.phase !== "NotSubmitted") || (plan.revision > 0 && plan.expiresAt > 0);
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function homeHelpRosterAllowed(helperCount: number, knownSingleton: boolean, currentEligibility: boolean): boolean {
  return helperCount <= 3 && homeHelperSetAllowed(helperCount, knownSingleton) && currentEligibility;
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function setHomeHelpRoster(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, rosterAllowed: boolean): HomeHelpPlan {
  //@ ensures (inv(plan) && canSetHomeHelpRoster(plan, now, revision, rosterKey, rosterAllowed)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canSetHomeHelpRoster(plan, now, revision, rosterKey, rosterAllowed)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canSetHomeHelpRoster(plan, now, revision, rosterKey, rosterAllowed)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canSetHomeHelpRoster(plan, now, revision, rosterKey, rosterAllowed)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { ...plan, phase: "AwaitingReview", revision: exact_boundedHelp(plan.revision + 1), rosterKey: rosterKey };
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function reviseHomeHelp(plan: HomeHelpPlan, now: number, revision: number, draftAllowed: boolean, expiresAt: number): HomeHelpPlan {
  //@ ensures (inv(plan) && canReviseHomeHelp(plan, now, revision, draftAllowed, expiresAt)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canReviseHomeHelp(plan, now, revision, draftAllowed, expiresAt)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canReviseHomeHelp(plan, now, revision, draftAllowed, expiresAt)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canReviseHomeHelp(plan, now, revision, draftAllowed, expiresAt)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { phase: "AwaitingHelpers", revision: exact_boundedHelp(plan.revision + 1), expiresAt: expiresAt, rosterKey: "" };
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function homeHelpRevisionMatches(plan: HomeHelpPlan, revision: number, rosterKey: string): boolean {
  return revision === plan.revision && rosterKey !== "" && rosterKey === plan.rosterKey;
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function approveHomeHelp(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, reviewerAuthorized: boolean, rosterAllowed: boolean): HomeHelpPlan {
  //@ ensures (inv(plan) && canApproveHomeHelp(plan, now, revision, rosterKey, reviewerAuthorized, rosterAllowed)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canApproveHomeHelp(plan, now, revision, rosterKey, reviewerAuthorized, rosterAllowed)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canApproveHomeHelp(plan, now, revision, rosterKey, reviewerAuthorized, rosterAllowed)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canApproveHomeHelp(plan, now, revision, rosterKey, reviewerAuthorized, rosterAllowed)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { ...plan, phase: "Approved" };
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function stepHomeHelpRevisionClearsApproval(before: HomeHelpPlan, after: HomeHelpPlan): boolean {
  return !(after.revision > before.revision) || after.phase !== "Approved";
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function alwaysHomeHelpReviewHasFixedRoster(plan: HomeHelpPlan): boolean {
  return (plan.phase === "AwaitingReview" || plan.phase === "Approved") === (plan.rosterKey !== "");
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function canSetHomeHelpRoster(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, rosterAllowed: boolean): boolean {
  return homeHelpOpen(plan, now) && revision === plan.revision && rosterAllowed && rosterKey !== "" && rosterKey !== plan.rosterKey;
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function canReviseHomeHelp(plan: HomeHelpPlan, now: number, revision: number, draftAllowed: boolean, expiresAt: number): boolean {
  return homeHelpOpen(plan, now) && revision === plan.revision && draftAllowed && expiresAt > 0 && now < expiresAt && expiresAt <= plan.expiresAt;
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function canApproveHomeHelp(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, reviewerAuthorized: boolean, rosterAllowed: boolean): boolean {
  return plan.phase === "AwaitingReview" && homeHelpOpen(plan, now) && reviewerAuthorized && rosterAllowed && homeHelpRevisionMatches(plan, revision, rosterKey);
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function homeHelpApprovalCurrent(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, rosterAllowed: boolean): boolean {
  return plan.phase === "Approved" && homeHelpOpen(plan, now) && rosterAllowed && homeHelpRevisionMatches(plan, revision, rosterKey);
}

/** Story: Review a private home-help plan with a fixed roster / Fix the roster before review and recheck it at approval (spec/boundedHelp.md) */
//@ pure
export function lawHomeHelpApprovalNeedsExactRoster(plan: HomeHelpPlan, now: number, revision: number, rosterKey: string, rosterAllowed: boolean): boolean {
  //@ ensures \result === true
  return !homeHelpApprovalCurrent(plan, now, revision, rosterKey, rosterAllowed) || homeHelpRevisionMatches(plan, revision, rosterKey);
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function closeHomeHelp(plan: HomeHelpPlan, now: number, revision: number, authorized: boolean): HomeHelpPlan {
  //@ ensures (inv(plan) && canCloseHomeHelp(plan, now, revision, authorized)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canCloseHomeHelp(plan, now, revision, authorized)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canCloseHomeHelp(plan, now, revision, authorized)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canCloseHomeHelp(plan, now, revision, authorized)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { ...plan, phase: "Closed", rosterKey: "" };
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function canExpireHomeHelp(plan: HomeHelpPlan, now: number): boolean {
  return (plan.phase === "AwaitingHelpers" || plan.phase === "AwaitingReview" || plan.phase === "Approved") && now >= plan.expiresAt;
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function expireHomeHelp(plan: HomeHelpPlan, now: number): HomeHelpPlan {
  //@ ensures (inv(plan) && canExpireHomeHelp(plan, now)) ==> alwaysSubmittedHomeHelpHasDeadline(\result)
  //@ ensures (inv(plan) && canExpireHomeHelp(plan, now)) ==> alwaysHomeHelpReviewHasFixedRoster(\result)
  //@ ensures (inv(plan) && canExpireHomeHelp(plan, now)) ==> stepHomeHelpRevisionClearsApproval(plan, \result)
  //@ ensures (inv(plan) && canExpireHomeHelp(plan, now)) ==> stepClosedHomeHelpStaysClosed(plan, \result)
  return { ...plan, phase: "Closed", rosterKey: "" };
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function stepClosedHomeHelpStaysClosed(before: HomeHelpPlan, after: HomeHelpPlan): boolean {
  return !(before.phase === "Closed") || after.phase === "Closed";
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function sometimesHomeHelpCanReachReview(plan: HomeHelpPlan): boolean {
  return plan.phase === "AwaitingReview";
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function sometimesHomeHelpCanBeApproved(plan: HomeHelpPlan): boolean {
  return plan.phase === "Approved";
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function canCloseHomeHelp(plan: HomeHelpPlan, now: number, revision: number, authorized: boolean): boolean {
  return homeHelpOpen(plan, now) && revision === plan.revision && authorized;
}

/** Story: Review a private home-help plan with a fixed roster / Closure and expiry end authority for this plan (spec/boundedHelp.md) */
//@ pure
export function lawExpiredHomeHelpHasNoApproval(plan: HomeHelpPlan, revision: number, rosterKey: string, rosterAllowed: boolean): boolean {
  //@ ensures \result === true
  return !homeHelpApprovalCurrent(plan, plan.expiresAt, revision, rosterKey, rosterAllowed);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: HomeHelpPlan, event: Event): boolean {
  if (event.type === "submitHomeHelp") return canSubmitHomeHelp(current, event.draftAllowed, event.expiresAt);
  if (event.type === "setHomeHelpRoster") return canSetHomeHelpRoster(current, event.now, event.revision, event.rosterKey, event.rosterAllowed);
  if (event.type === "reviseHomeHelp") return canReviseHomeHelp(current, event.now, event.revision, event.draftAllowed, event.expiresAt);
  if (event.type === "approveHomeHelp") return canApproveHomeHelp(current, event.now, event.revision, event.rosterKey, event.reviewerAuthorized, event.rosterAllowed);
  if (event.type === "closeHomeHelp") return canCloseHomeHelp(current, event.now, event.revision, event.authorized);
  if (event.type === "expireHomeHelp") return canExpireHomeHelp(current, event.now);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: HomeHelpPlan, event: Event): HomeHelpPlan {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "submitHomeHelp") return canSubmitHomeHelp(current, event.draftAllowed, event.expiresAt) ? submitHomeHelp(current, event.draftAllowed, event.expiresAt) : current;
  if (event.type === "setHomeHelpRoster") return canSetHomeHelpRoster(current, event.now, event.revision, event.rosterKey, event.rosterAllowed) ? setHomeHelpRoster(current, event.now, event.revision, event.rosterKey, event.rosterAllowed) : current;
  if (event.type === "reviseHomeHelp") return canReviseHomeHelp(current, event.now, event.revision, event.draftAllowed, event.expiresAt) ? reviseHomeHelp(current, event.now, event.revision, event.draftAllowed, event.expiresAt) : current;
  if (event.type === "approveHomeHelp") return canApproveHomeHelp(current, event.now, event.revision, event.rosterKey, event.reviewerAuthorized, event.rosterAllowed) ? approveHomeHelp(current, event.now, event.revision, event.rosterKey, event.reviewerAuthorized, event.rosterAllowed) : current;
  if (event.type === "closeHomeHelp") return canCloseHomeHelp(current, event.now, event.revision, event.authorized) ? closeHomeHelp(current, event.now, event.revision, event.authorized) : current;
  if (event.type === "expireHomeHelp") return canExpireHomeHelp(current, event.now) ? expireHomeHelp(current, event.now) : current;
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
  if (raw.type === "submitHomeHelp" && typeof raw.draftAllowed === "boolean" && Number.isSafeInteger(raw.expiresAt)) return { type: "submitHomeHelp", draftAllowed: raw.draftAllowed, expiresAt: raw.expiresAt };
  if (raw.type === "setHomeHelpRoster" && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.revision) && typeof raw.rosterKey === "string" && typeof raw.rosterAllowed === "boolean") return { type: "setHomeHelpRoster", now: raw.now, revision: raw.revision, rosterKey: raw.rosterKey, rosterAllowed: raw.rosterAllowed };
  if (raw.type === "reviseHomeHelp" && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.revision) && typeof raw.draftAllowed === "boolean" && Number.isSafeInteger(raw.expiresAt)) return { type: "reviseHomeHelp", now: raw.now, revision: raw.revision, draftAllowed: raw.draftAllowed, expiresAt: raw.expiresAt };
  if (raw.type === "approveHomeHelp" && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.revision) && typeof raw.rosterKey === "string" && typeof raw.reviewerAuthorized === "boolean" && typeof raw.rosterAllowed === "boolean") return { type: "approveHomeHelp", now: raw.now, revision: raw.revision, rosterKey: raw.rosterKey, reviewerAuthorized: raw.reviewerAuthorized, rosterAllowed: raw.rosterAllowed };
  if (raw.type === "closeHomeHelp" && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.revision) && typeof raw.authorized === "boolean") return { type: "closeHomeHelp", now: raw.now, revision: raw.revision, authorized: raw.authorized };
  if (raw.type === "expireHomeHelp" && Number.isSafeInteger(raw.now)) return { type: "expireHomeHelp", now: raw.now };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): HomeHelpPlan | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NotSubmitted" || raw.phase === "AwaitingHelpers" || raw.phase === "AwaitingReview" || raw.phase === "Approved" || raw.phase === "Closed") && Number.isSafeInteger(raw.revision) && Number.isSafeInteger(raw.expiresAt) && typeof raw.rosterKey === "string" && Object.keys(raw).length === 4)) return undefined;
  const parsed: HomeHelpPlan = ({ phase: raw.phase, revision: raw.revision, expiresAt: raw.expiresAt, rosterKey: raw.rosterKey });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): HomeHelpPlan {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_boundedHelp(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
