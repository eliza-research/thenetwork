// GENERATED from spec/automatedReview.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type JudgeVerdict = "JudgeApproves" | "JudgeFlags" | "JudgeUndecided" | "JudgeCannotRun";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type VerdictWord = "SaidApprove" | "SaidFlag" | "SaidCannotDecide" | "SaidOther";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type Rubric = "AdultRubric" | "MinorRubric";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type Approver = "NoApprover" | "JudgeApprover" | "StaffApprover";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type ReviewPhase = "AwaitingJudge" | "HeldForStaff" | "ReviewApproved" | "ReviewStopped" | "ReviewRejected" | "ReviewExpired" | "ReviewInvalidated";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export interface AutomatedReview { phase: ReviewPhase; revision: number; approver: Approver }
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type JudgeCall = "PacketSuspect" | "PriorFlag" | "NoProvider" | "BudgetReached" | "RequestLimitReached" | "DeadlineTooClose" | "CallJudge";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type JudgeClaim = "ClaimFirst" | "ClaimAgain" | "UseStored" | "WaitForLease" | "ClaimsSpent";
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export type SimStaffAction = "SimStaffApproves" | "SimStaffRejects" | "SimStaffWaits";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordJudgment"; revision: number; verdict: JudgeVerdict; packetCurrent: boolean; gatesPass: boolean; late: boolean }
  | { type: "holdUnjudged"; waitedMs: number; matchingOn: boolean }
  | { type: "staffDecide"; revision: number; approve: boolean; gatesPass: boolean; late: boolean }
  | { type: "staffReroll"; revision: number; late: boolean; replacementFound: boolean }
  | { type: "stopApproved"; revealed: boolean }
  | { type: "expireReview"; late: boolean }
  | { type: "closeReview" };

/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const initial: AutomatedReview = { phase: "AwaitingJudge", revision: 0, approver: "NoApprover" };
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const maxJudgeClaims: number = 2;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeMinLeadMs: number = 600000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeCallDeadlineMs: number = 120000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeLeaseMarginMs: number = 60000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeLeaseMs: number = 180000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeCallsPerRun: number = 4;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const judgeWaitLimitMs: number = 1800000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const reviewJudgmentRetentionMs: number = 7776000000;
/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
export const flaggedPairRetentionMs: number = 7776000000;

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AutomatedReview): boolean {
  return alwaysApprovalNamesApprover(current);
}

/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
//@ pure
export function reviewOpen(r: AutomatedReview): boolean {
  return r.phase === "AwaitingJudge" || r.phase === "HeldForStaff";
}

/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
//@ pure
export function contactApproved(r: AutomatedReview): boolean {
  return r.phase === "ReviewApproved" && r.approver !== "NoApprover";
}

/** Story: Contact a member only after a recorded approval / An approval names its approver (spec/automatedReview.md) */
//@ pure
export function alwaysApprovalNamesApprover(r: AutomatedReview): boolean {
  return (r.phase === "ReviewApproved" || r.phase === "ReviewStopped") === (r.approver !== "NoApprover");
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function canRecordJudgment(r: AutomatedReview, revision: number): boolean {
  return r.phase === "AwaitingJudge" && revision === r.revision;
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function recordJudgment(r: AutomatedReview, revision: number, verdict: JudgeVerdict, packetCurrent: boolean, gatesPass: boolean, late: boolean): AutomatedReview {
  //@ ensures (inv(r) && canRecordJudgment(r, revision)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canRecordJudgment(r, revision)) ==> stepHeldItemNeedsStaff(r, "recordJudgment", \result)
  //@ ensures (inv(r) && canRecordJudgment(r, revision)) ==> stepRerollStartsNewRevision(r, "recordJudgment", \result)
  //@ ensures (inv(r) && canRecordJudgment(r, revision)) ==> stepStopEndsOnlyAnApproval(r, "recordJudgment", \result)
  //@ ensures (inv(r) && canRecordJudgment(r, revision)) ==> stepDecidedReviewStaysDecided(r, "recordJudgment", \result)
  return late ? ({ ...r, phase: "ReviewExpired" } as AutomatedReview) : (!packetCurrent ? r : (!gatesPass ? ({ ...r, phase: "ReviewInvalidated" } as AutomatedReview) : (verdict === "JudgeApproves" ? ({ ...r, phase: "ReviewApproved", approver: "JudgeApprover" } as AutomatedReview) : ({ ...r, phase: "HeldForStaff" } as AutomatedReview))));
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function lawGatesBeatTheJudge(late: boolean): boolean {
  //@ ensures \result === true
  return recordJudgment(initial, 0, "JudgeApproves", true, false, late).phase !== "ReviewApproved";
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function lawOnlyAnApprovalApproves(verdict: JudgeVerdict, packetCurrent: boolean, gatesPass: boolean, late: boolean): boolean {
  //@ ensures \result === true
  return !(verdict !== "JudgeApproves") || recordJudgment(initial, 0, verdict, packetCurrent, gatesPass, late).phase !== "ReviewApproved";
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function lawChangedPacketNeverApproves(verdict: JudgeVerdict, gatesPass: boolean, late: boolean): boolean {
  //@ ensures \result === true
  return recordJudgment(initial, 0, verdict, false, gatesPass, late).phase !== "ReviewApproved";
}

/** Story: Contact a member only after a recorded approval / The judge decides an awaiting revision once, for the packet it read (spec/automatedReview.md) */
//@ pure
export function lawLateJudgmentExpires(verdict: JudgeVerdict, packetCurrent: boolean, gatesPass: boolean): boolean {
  //@ ensures \result === true
  return recordJudgment(initial, 0, verdict, packetCurrent, gatesPass, true).phase === "ReviewExpired";
}

/** Story: Contact a member only after a recorded approval / A judgment that does not come in time is held for staff (spec/automatedReview.md) */
//@ pure
export function canHoldUnjudged(r: AutomatedReview, waitedMs: number, matchingOn: boolean): boolean {
  return r.phase === "AwaitingJudge" && matchingOn && waitedMs >= judgeWaitLimitMs;
}

/** Story: Contact a member only after a recorded approval / A judgment that does not come in time is held for staff (spec/automatedReview.md) */
//@ pure
export function holdUnjudged(r: AutomatedReview, waitedMs: number, matchingOn: boolean): AutomatedReview {
  //@ ensures (inv(r) && canHoldUnjudged(r, waitedMs, matchingOn)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canHoldUnjudged(r, waitedMs, matchingOn)) ==> stepHeldItemNeedsStaff(r, "holdUnjudged", \result)
  //@ ensures (inv(r) && canHoldUnjudged(r, waitedMs, matchingOn)) ==> stepRerollStartsNewRevision(r, "holdUnjudged", \result)
  //@ ensures (inv(r) && canHoldUnjudged(r, waitedMs, matchingOn)) ==> stepStopEndsOnlyAnApproval(r, "holdUnjudged", \result)
  //@ ensures (inv(r) && canHoldUnjudged(r, waitedMs, matchingOn)) ==> stepDecidedReviewStaysDecided(r, "holdUnjudged", \result)
  return { ...r, phase: "HeldForStaff" };
}

/** Story: Contact a member only after a recorded approval / A judgment that does not come in time is held for staff (spec/automatedReview.md) */
//@ pure
export function lawPausedMatchingHoldsNothing(waitedMs: number): boolean {
  //@ ensures \result === true
  return !canHoldUnjudged(initial, waitedMs, false);
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function canStaffDecide(r: AutomatedReview, revision: number, approve: boolean): boolean {
  return revision === r.revision && (approve ? r.phase === "HeldForStaff" : reviewOpen(r));
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function staffDecide(r: AutomatedReview, revision: number, approve: boolean, gatesPass: boolean, late: boolean): AutomatedReview {
  //@ ensures (inv(r) && canStaffDecide(r, revision, approve)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canStaffDecide(r, revision, approve)) ==> stepHeldItemNeedsStaff(r, "staffDecide", \result)
  //@ ensures (inv(r) && canStaffDecide(r, revision, approve)) ==> stepRerollStartsNewRevision(r, "staffDecide", \result)
  //@ ensures (inv(r) && canStaffDecide(r, revision, approve)) ==> stepStopEndsOnlyAnApproval(r, "staffDecide", \result)
  //@ ensures (inv(r) && canStaffDecide(r, revision, approve)) ==> stepDecidedReviewStaysDecided(r, "staffDecide", \result)
  return late ? ({ ...r, phase: "ReviewExpired" } as AutomatedReview) : (!approve ? ({ ...r, phase: "ReviewRejected" } as AutomatedReview) : (!gatesPass ? ({ ...r, phase: "ReviewInvalidated" } as AutomatedReview) : ({ ...r, phase: "ReviewApproved", approver: "StaffApprover" } as AutomatedReview)));
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function canStaffReroll(r: AutomatedReview, revision: number, late: boolean): boolean {
  return r.phase === "HeldForStaff" && revision === r.revision && !late;
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function staffReroll(r: AutomatedReview, revision: number, late: boolean, replacementFound: boolean): AutomatedReview {
  //@ ensures (inv(r) && canStaffReroll(r, revision, late)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canStaffReroll(r, revision, late)) ==> stepHeldItemNeedsStaff(r, "staffReroll", \result)
  //@ ensures (inv(r) && canStaffReroll(r, revision, late)) ==> stepRerollStartsNewRevision(r, "staffReroll", \result)
  //@ ensures (inv(r) && canStaffReroll(r, revision, late)) ==> stepStopEndsOnlyAnApproval(r, "staffReroll", \result)
  //@ ensures (inv(r) && canStaffReroll(r, revision, late)) ==> stepDecidedReviewStaysDecided(r, "staffReroll", \result)
  return replacementFound ? ({ phase: "AwaitingJudge", revision: exact_automatedReview(r.revision + 1), approver: "NoApprover" } as AutomatedReview) : ({ ...r, phase: "ReviewRejected" } as AutomatedReview);
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function lawAwaitingItemNeedsTheJudge(revision: number): boolean {
  //@ ensures \result === true
  return !canStaffDecide(({ ...initial, revision: revision } as AutomatedReview), revision, true);
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function stepHeldItemNeedsStaff(before: AutomatedReview, via: string, after: AutomatedReview): boolean {
  return !(before.phase === "HeldForStaff" && after.phase === "ReviewApproved") || (after.approver === "StaffApprover" && via === "staffDecide");
}

/** Story: Contact a member only after a recorded approval / Staff approve only a held item and may reject any open item (spec/automatedReview.md) */
//@ pure
export function stepRerollStartsNewRevision(before: AutomatedReview, via: string, after: AutomatedReview): boolean {
  return !(via === "staffReroll" && after.phase === "AwaitingJudge") || after.revision === exact_automatedReview(before.revision + 1);
}

/** Story: Contact a member only after a recorded approval / Staff can stop an approved item before its reveal (spec/automatedReview.md) */
//@ pure
export function canStopApproved(r: AutomatedReview, revealed: boolean): boolean {
  return contactApproved(r) && !revealed;
}

/** Story: Contact a member only after a recorded approval / Staff can stop an approved item before its reveal (spec/automatedReview.md) */
//@ pure
export function stopApproved(r: AutomatedReview, revealed: boolean): AutomatedReview {
  //@ ensures (inv(r) && canStopApproved(r, revealed)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canStopApproved(r, revealed)) ==> stepHeldItemNeedsStaff(r, "stopApproved", \result)
  //@ ensures (inv(r) && canStopApproved(r, revealed)) ==> stepRerollStartsNewRevision(r, "stopApproved", \result)
  //@ ensures (inv(r) && canStopApproved(r, revealed)) ==> stepStopEndsOnlyAnApproval(r, "stopApproved", \result)
  //@ ensures (inv(r) && canStopApproved(r, revealed)) ==> stepDecidedReviewStaysDecided(r, "stopApproved", \result)
  return { ...r, phase: "ReviewStopped" };
}

/** Story: Contact a member only after a recorded approval / Staff can stop an approved item before its reveal (spec/automatedReview.md) */
//@ pure
export function lawRevealedItemCannotBeStopped(revision: number): boolean {
  //@ ensures \result === true
  return !canStopApproved(({ phase: "ReviewApproved", revision: revision, approver: "JudgeApprover" } as AutomatedReview), true);
}

/** Story: Contact a member only after a recorded approval / Staff can stop an approved item before its reveal (spec/automatedReview.md) */
//@ pure
export function stepStopEndsOnlyAnApproval(before: AutomatedReview, via: string, after: AutomatedReview): boolean {
  return !(via === "stopApproved") || (before.phase === "ReviewApproved" && after.phase === "ReviewStopped");
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function canExpireReview(r: AutomatedReview, late: boolean): boolean {
  return reviewOpen(r) && late;
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function expireReview(r: AutomatedReview, late: boolean): AutomatedReview {
  //@ ensures (inv(r) && canExpireReview(r, late)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canExpireReview(r, late)) ==> stepHeldItemNeedsStaff(r, "expireReview", \result)
  //@ ensures (inv(r) && canExpireReview(r, late)) ==> stepRerollStartsNewRevision(r, "expireReview", \result)
  //@ ensures (inv(r) && canExpireReview(r, late)) ==> stepStopEndsOnlyAnApproval(r, "expireReview", \result)
  //@ ensures (inv(r) && canExpireReview(r, late)) ==> stepDecidedReviewStaysDecided(r, "expireReview", \result)
  return { ...r, phase: "ReviewExpired" };
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function canCloseReview(r: AutomatedReview): boolean {
  return reviewOpen(r);
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function closeReview(r: AutomatedReview): AutomatedReview {
  //@ ensures (inv(r) && canCloseReview(r)) ==> alwaysApprovalNamesApprover(\result)
  //@ ensures (inv(r) && canCloseReview(r)) ==> stepHeldItemNeedsStaff(r, "closeReview", \result)
  //@ ensures (inv(r) && canCloseReview(r)) ==> stepRerollStartsNewRevision(r, "closeReview", \result)
  //@ ensures (inv(r) && canCloseReview(r)) ==> stepStopEndsOnlyAnApproval(r, "closeReview", \result)
  //@ ensures (inv(r) && canCloseReview(r)) ==> stepDecidedReviewStaysDecided(r, "closeReview", \result)
  return { ...r, phase: "ReviewInvalidated" };
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function stepDecidedReviewStaysDecided(before: AutomatedReview, via: string, after: AutomatedReview): boolean {
  return !(!reviewOpen(before) && !(before.phase === "ReviewApproved" && via === "stopApproved")) || equal_automatedReview(after, before);
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function sometimesJudgeApproves(r: AutomatedReview): boolean {
  return r.approver === "JudgeApprover";
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function sometimesHeldForStaff(r: AutomatedReview): boolean {
  return r.phase === "HeldForStaff";
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function sometimesStaffApproves(r: AutomatedReview): boolean {
  return r.approver === "StaffApprover";
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function sometimesExpires(r: AutomatedReview): boolean {
  return r.phase === "ReviewExpired";
}

/** Story: Contact a member only after a recorded approval / An open review closes unsent (spec/automatedReview.md) */
//@ pure
export function sometimesStopped(r: AutomatedReview): boolean {
  return r.phase === "ReviewStopped";
}

/** Story: Contact a member only after a recorded approval / A reply approves only when it is complete and consistent (spec/automatedReview.md) */
//@ pure
export function judgeVerdictOf(parsed: boolean, said: VerdictWord, reasonGiven: boolean, checksClear: boolean, rubric: Rubric, minorChecksClear: boolean): JudgeVerdict {
  return !parsed ? "JudgeUndecided" : (said === "SaidApprove" ? (!reasonGiven && checksClear && (rubric === "AdultRubric" || minorChecksClear) ? "JudgeApproves" : "JudgeUndecided") : said === "SaidFlag" ? (reasonGiven ? "JudgeFlags" : "JudgeUndecided") : said === "SaidCannotDecide" ? "JudgeUndecided" : "JudgeUndecided");
}

/** Story: Contact a member only after a recorded approval / A reply approves only when it is complete and consistent (spec/automatedReview.md) */
//@ pure
export function lawUnparsedReplyNeverApproves(said: VerdictWord, reasonGiven: boolean, checksClear: boolean, rubric: Rubric, minorChecksClear: boolean): boolean {
  //@ ensures \result === true
  return judgeVerdictOf(false, said, reasonGiven, checksClear, rubric, minorChecksClear) === "JudgeUndecided";
}

/** Story: Contact a member only after a recorded approval / A reply approves only when it is complete and consistent (spec/automatedReview.md) */
//@ pure
export function lawMinorApprovalNeedsMinorChecks(reasonGiven: boolean, checksClear: boolean): boolean {
  //@ ensures \result === true
  return judgeVerdictOf(true, "SaidApprove", reasonGiven, checksClear, "MinorRubric", false) !== "JudgeApproves";
}

/** Story: Contact a member only after a recorded approval / A reply approves only when it is complete and consistent (spec/automatedReview.md) */
//@ pure
export function lawFlagNeedsReason(checksClear: boolean, rubric: Rubric, minorChecksClear: boolean): boolean {
  //@ ensures \result === true
  return judgeVerdictOf(true, "SaidFlag", false, checksClear, rubric, minorChecksClear) === "JudgeUndecided";
}

/** Story: Contact a member only after a recorded approval / A roster with a minor gets the strict rubric (spec/automatedReview.md) */
//@ pure
export function reviewRubric(rosterHasMinor: boolean): Rubric {
  return rosterHasMinor ? "MinorRubric" : "AdultRubric";
}

/** Story: Contact a member only after a recorded approval / A roster with a minor gets the strict rubric (spec/automatedReview.md) */
//@ pure
export function lawMinorRosterGetsStrictRubric(rosterHasMinor: boolean): boolean {
  //@ ensures \result === true
  return !rosterHasMinor || reviewRubric(rosterHasMinor) === "MinorRubric";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function judgeCallDecision(packetClean: boolean, priorFlag: boolean, providerReady: boolean, spentMicros: number, budgetMicros: number, requestsUsed: number, requestLimit: number, msLeft: number): JudgeCall {
  return !packetClean ? "PacketSuspect" : (priorFlag ? "PriorFlag" : (!providerReady ? "NoProvider" : (spentMicros >= budgetMicros ? "BudgetReached" : (requestsUsed >= requestLimit ? "RequestLimitReached" : (msLeft < judgeMinLeadMs ? "DeadlineTooClose" : "CallJudge")))));
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function uncalledVerdict(call: JudgeCall): JudgeVerdict {
  return call === "PacketSuspect" ? "JudgeFlags" : call === "PriorFlag" ? "JudgeFlags" : "JudgeCannotRun";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function verdictAtRecord(verdict: JudgeVerdict, packetClean: boolean, priorFlag: boolean): JudgeVerdict {
  return verdict === "JudgeApproves" && (!packetClean || priorFlag) ? "JudgeFlags" : verdict;
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function lawFreshFlagBeatsApproval(verdict: JudgeVerdict, packetClean: boolean, priorFlag: boolean): boolean {
  //@ ensures \result === true
  return !(!packetClean || priorFlag) || verdictAtRecord(verdict, packetClean, priorFlag) !== "JudgeApproves";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function lawSuspectPacketNeverApproves(priorFlag: boolean, providerReady: boolean, spentMicros: number, budgetMicros: number, requestsUsed: number, requestLimit: number, msLeft: number): boolean {
  //@ ensures \result === true
  return judgeCallDecision(false, priorFlag, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) === "PacketSuspect" && uncalledVerdict("PacketSuspect") === "JudgeFlags";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function lawPriorFlagNeverApproves(packetClean: boolean, providerReady: boolean, spentMicros: number, budgetMicros: number, requestsUsed: number, requestLimit: number, msLeft: number): boolean {
  //@ ensures \result === true
  return judgeCallDecision(packetClean, true, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) !== "CallJudge";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function lawSpentBudgetNeverCalls(packetClean: boolean, priorFlag: boolean, spentMicros: number, budgetMicros: number, requestsUsed: number, requestLimit: number, msLeft: number): boolean {
  //@ ensures \result === true
  return !(spentMicros >= budgetMicros) || judgeCallDecision(packetClean, priorFlag, true, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) !== "CallJudge";
}

/** Story: Contact a member only after a recorded approval / A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline (spec/automatedReview.md) */
//@ pure
export function lawCallHasLeadTime(packetClean: boolean, priorFlag: boolean, providerReady: boolean, spentMicros: number, budgetMicros: number, requestsUsed: number, requestLimit: number, msLeft: number): boolean {
  //@ ensures \result === true
  return !(judgeCallDecision(packetClean, priorFlag, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) === "CallJudge") || msLeft >= judgeMinLeadMs;
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function judgeClaimDecision(rowExists: boolean, decided: boolean, claims: number, leaseExpired: boolean): JudgeClaim {
  return !rowExists ? "ClaimFirst" : (decided ? "UseStored" : (!leaseExpired ? "WaitForLease" : (claims < maxJudgeClaims ? "ClaimAgain" : "ClaimsSpent")));
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function lawDecidedRowIsReused(claims: number, leaseExpired: boolean): boolean {
  //@ ensures \result === true
  return judgeClaimDecision(true, true, claims, leaseExpired) === "UseStored";
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function lawClaimsAreBounded(claims: number): boolean {
  //@ ensures \result === true
  return !(claims >= maxJudgeClaims) || judgeClaimDecision(true, false, claims, true) === "ClaimsSpent";
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function lawLeaseOutlastsCall(callMs: number): boolean {
  //@ ensures \result === true
  return !(callMs <= judgeCallDeadlineMs) || exact_automatedReview(callMs + judgeLeaseMarginMs) <= judgeLeaseMs;
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function judgmentRetained(ageMs: number, openSafetyCase: boolean): boolean {
  return openSafetyCase || ageMs < reviewJudgmentRetentionMs;
}

/** Story: Contact a member only after a recorded approval / One judgment per packet for every replica (spec/automatedReview.md) */
//@ pure
export function flaggedPairActive(ageMs: number): boolean {
  return ageMs < flaggedPairRetentionMs;
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function simulatedJudgeAnswers(ticket: number, withExceptions: boolean): boolean {
  return !withExceptions || ticket < 7 || ticket >= 9;
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function simulatedJudgeVerdict(ticket: number, withExceptions: boolean): JudgeVerdict {
  return !withExceptions ? "JudgeApproves" : (ticket < 4 ? "JudgeFlags" : (ticket < 6 ? "JudgeUndecided" : (ticket < 7 ? "JudgeCannotRun" : "JudgeApproves")));
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function simulatedStaffAction(ticket: number): SimStaffAction {
  return remainder_automatedReview(ticket, 3) === 0 ? "SimStaffApproves" : (remainder_automatedReview(ticket, 3) === 1 ? "SimStaffRejects" : "SimStaffWaits");
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function lawStandInApprovesWithoutExceptions(ticket: number): boolean {
  //@ ensures \result === true
  return simulatedJudgeAnswers(ticket, false) && simulatedJudgeVerdict(ticket, false) === "JudgeApproves";
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function lawStandInHoldsSomeItems(withExceptions: boolean): boolean {
  //@ ensures \result === true
  return !withExceptions || simulatedJudgeVerdict(0, withExceptions) === "JudgeFlags";
}

/** Story: Contact a member only after a recorded approval / The simulator uses a deterministic stand-in judge (spec/automatedReview.md) */
//@ pure
export function lawStandInIsSilentSometimes(withExceptions: boolean): boolean {
  //@ ensures \result === true
  return !withExceptions || !simulatedJudgeAnswers(7, withExceptions);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AutomatedReview, event: Event): boolean {
  if (event.type === "recordJudgment") return canRecordJudgment(current, event.revision);
  if (event.type === "holdUnjudged") return canHoldUnjudged(current, event.waitedMs, event.matchingOn);
  if (event.type === "staffDecide") return canStaffDecide(current, event.revision, event.approve);
  if (event.type === "staffReroll") return canStaffReroll(current, event.revision, event.late);
  if (event.type === "stopApproved") return canStopApproved(current, event.revealed);
  if (event.type === "expireReview") return canExpireReview(current, event.late);
  if (event.type === "closeReview") return canCloseReview(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AutomatedReview, event: Event): AutomatedReview {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordJudgment") return canRecordJudgment(current, event.revision) ? recordJudgment(current, event.revision, event.verdict, event.packetCurrent, event.gatesPass, event.late) : current;
  if (event.type === "holdUnjudged") return canHoldUnjudged(current, event.waitedMs, event.matchingOn) ? holdUnjudged(current, event.waitedMs, event.matchingOn) : current;
  if (event.type === "staffDecide") return canStaffDecide(current, event.revision, event.approve) ? staffDecide(current, event.revision, event.approve, event.gatesPass, event.late) : current;
  if (event.type === "staffReroll") return canStaffReroll(current, event.revision, event.late) ? staffReroll(current, event.revision, event.late, event.replacementFound) : current;
  if (event.type === "stopApproved") return canStopApproved(current, event.revealed) ? stopApproved(current, event.revealed) : current;
  if (event.type === "expireReview") return canExpireReview(current, event.late) ? expireReview(current, event.late) : current;
  if (event.type === "closeReview") return canCloseReview(current) ? closeReview(current) : current;
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
  if (raw.type === "recordJudgment" && Number.isSafeInteger(raw.revision) && (raw.verdict === "JudgeApproves" || raw.verdict === "JudgeFlags" || raw.verdict === "JudgeUndecided" || raw.verdict === "JudgeCannotRun") && typeof raw.packetCurrent === "boolean" && typeof raw.gatesPass === "boolean" && typeof raw.late === "boolean") return { type: "recordJudgment", revision: raw.revision, verdict: raw.verdict, packetCurrent: raw.packetCurrent, gatesPass: raw.gatesPass, late: raw.late };
  if (raw.type === "holdUnjudged" && Number.isSafeInteger(raw.waitedMs) && typeof raw.matchingOn === "boolean") return { type: "holdUnjudged", waitedMs: raw.waitedMs, matchingOn: raw.matchingOn };
  if (raw.type === "staffDecide" && Number.isSafeInteger(raw.revision) && typeof raw.approve === "boolean" && typeof raw.gatesPass === "boolean" && typeof raw.late === "boolean") return { type: "staffDecide", revision: raw.revision, approve: raw.approve, gatesPass: raw.gatesPass, late: raw.late };
  if (raw.type === "staffReroll" && Number.isSafeInteger(raw.revision) && typeof raw.late === "boolean" && typeof raw.replacementFound === "boolean") return { type: "staffReroll", revision: raw.revision, late: raw.late, replacementFound: raw.replacementFound };
  if (raw.type === "stopApproved" && typeof raw.revealed === "boolean") return { type: "stopApproved", revealed: raw.revealed };
  if (raw.type === "expireReview" && typeof raw.late === "boolean") return { type: "expireReview", late: raw.late };
  if (raw.type === "closeReview") return { type: "closeReview" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AutomatedReview | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingJudge" || raw.phase === "HeldForStaff" || raw.phase === "ReviewApproved" || raw.phase === "ReviewStopped" || raw.phase === "ReviewRejected" || raw.phase === "ReviewExpired" || raw.phase === "ReviewInvalidated") && Number.isSafeInteger(raw.revision) && (raw.approver === "NoApprover" || raw.approver === "JudgeApprover" || raw.approver === "StaffApprover") && Object.keys(raw).length === 3)) return undefined;
  const parsed: AutomatedReview = ({ phase: raw.phase, revision: raw.revision, approver: raw.approver });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AutomatedReview {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_automatedReview(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_automatedReview(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_automatedReview((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_automatedReview(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}

/** The remainder of that division; it has the sign of the dividend. */
//@ pure
export function remainder_automatedReview(a: number, b: number): number {
  //@ requires b !== 0
  return a - b * quotient_automatedReview(a, b);
}
