// GENERATED from spec/safetyCase.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export type CasePhase = "NoCase" | "CaseOpen" | "CaseHeld" | "CaseLifted" | "CaseClosed";
/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export interface SafetyCase { phase: CasePhase }
/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
export type StaffActionResult = "AllowedAction" | "ActorRequired" | "NotOnHold" | "UnknownCase" | "AlreadyClosed" | "UnknownReport" | "UnknownMember" | "NoMinorSignal" | "AgeUnknown" | "RecordMinor" | "StatedMinor";
/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
export type ReportPhase = "ReportOpen" | "ReportHeld" | "ReportBanned" | "ReportDismissed";
/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
export type ReportDecision = "HoldReport" | "BanReport" | "DismissReport";
/** Story: Resolve a report with its own disposition / A unique offered report name routes back to its app (spec/safetyCase.md) */
export type SharedReportRoute = "NoReportRoute" | "UniqueReportRoute" | "AmbiguousReportRoute";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordCaseEvent"; liftEvent: boolean; decayEvent: boolean }
  | { type: "markCaseHeld" }
  | { type: "markCaseLifted" }
  | { type: "closeCase" };

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export const initial: SafetyCase = { phase: "NoCase" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SafetyCase): boolean {
  return true;
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function canRecordCaseEvent(c: SafetyCase): boolean {
  return c.phase !== "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function recordCaseEvent(c: SafetyCase, liftEvent: boolean, decayEvent: boolean): SafetyCase {
  //@ ensures (inv(c) && canRecordCaseEvent(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return decayEvent ? c : (c.phase === "NoCase" || (c.phase === "CaseLifted" && !liftEvent) ? ({ phase: "CaseOpen" } as SafetyCase) : c);
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function lawDecayNeverOpensCase(liftEvent: boolean): boolean {
  //@ ensures \result === true
  return equal_safetyCase(recordCaseEvent(initial, liftEvent, true), initial);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function liveCase(c: SafetyCase): boolean {
  return c.phase !== "NoCase" && c.phase !== "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function markCaseHeld(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canMarkCaseHeld(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseHeld" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function markCaseLifted(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canMarkCaseLifted(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseLifted" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function closeCase(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canCloseCase(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseClosed" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function stepClosedCaseStaysClosed(before: SafetyCase, after: SafetyCase): boolean {
  return !(before.phase === "CaseClosed") || after.phase === "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function sometimesCaseCloses(c: SafetyCase): boolean {
  return c.phase === "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function sometimesCaseWasLifted(c: SafetyCase): boolean {
  return c.phase === "CaseLifted";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canMarkCaseHeld(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canMarkCaseLifted(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canCloseCase(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdSubjectKnown(knownMember: boolean, reportOnFile: boolean): boolean {
  return knownMember || reportOnFile;
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdLiftResult(actorPresent: boolean, currentlyHeld: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (currentlyHeld ? "AllowedAction" : "NotOnHold");
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function caseCloseResult(actorPresent: boolean, casePhase: CasePhase): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (casePhase === "NoCase" ? "UnknownCase" : (casePhase === "CaseClosed" ? "AlreadyClosed" : "AllowedAction"));
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdAuthority(actorPresent: boolean, reportMatches: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (!reportMatches ? "UnknownReport" : "AllowedAction");
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function immediateDangerReply(directText: boolean, currentDanger: boolean): boolean {
  return directText && currentDanger;
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function emergencyCheckInReport(exactReceipt: boolean, attributedReport: boolean): boolean {
  return exactReceipt && attributedReport;
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyReplyRequiresOwnText(currentDanger: boolean): boolean {
  //@ ensures \result === true
  return !immediateDangerReply(false, currentDanger);
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyReplyRequiresCurrentDanger(directText: boolean): boolean {
  //@ ensures \result === true
  return !immediateDangerReply(directText, false);
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyCheckInNeedsReceipt(attributedReport: boolean): boolean {
  //@ ensures \result === true
  return !emergencyCheckInReport(false, attributedReport);
}

/** Story: Block or report a person directly / Direct polite safety requests use the existing counterpart chooser (spec/safetyCase.md) */
//@ pure
export function safetyRequestMayResolveTarget(directCommand: boolean, conditionalOrDelayed: boolean): boolean {
  return directCommand && !conditionalOrDelayed;
}

/** Story: Block or report a person directly / Direct polite safety requests use the existing counterpart chooser (spec/safetyCase.md) */
//@ pure
export function lawConditionalSafetyRequestCannotResolveTarget(directCommand: boolean): boolean {
  //@ ensures \result === true
  return !safetyRequestMayResolveTarget(directCommand, true);
}

/** Story: Block or report a person directly / Report language distinguishes physical harm from casual contact (spec/safetyCase.md) */
//@ pure
export function acceptsReportEvidence(affirmative: boolean, casualContact: boolean): boolean {
  return affirmative && !casualContact;
}

/** Story: Block or report a person directly / Report language distinguishes physical harm from casual contact (spec/safetyCase.md) */
//@ pure
export function lawCasualContactDoesNotEstablishHarm(affirmative: boolean): boolean {
  //@ ensures \result === true
  return !acceptsReportEvidence(affirmative, true);
}

/** Story: Block or report a person directly / Report language distinguishes physical harm from casual contact (spec/safetyCase.md) */
//@ pure
export function lawDeniedEvidenceDoesNotEstablishHarm(casualContact: boolean): boolean {
  //@ ensures \result === true
  return !acceptsReportEvidence(false, casualContact);
}

/** Story: Block or report a person directly / A minor report needs affirmative attributable evidence (spec/safetyCase.md) */
//@ pure
export function acceptsMinorReportEvidence(eligibleSubject: boolean, minorAgeSignal: boolean, affirmative: boolean): boolean {
  return eligibleSubject && minorAgeSignal && affirmative;
}

/** Story: Block or report a person directly / A minor report needs affirmative attributable evidence (spec/safetyCase.md) */
//@ pure
export function lawMinorReportNeedsAffirmation(eligibleSubject: boolean, minorAgeSignal: boolean): boolean {
  //@ ensures \result === true
  return !acceptsMinorReportEvidence(eligibleSubject, minorAgeSignal, false);
}

/** Story: Block or report a person directly / A minor report needs affirmative attributable evidence (spec/safetyCase.md) */
//@ pure
export function lawMinorReportNeedsAnEligibleSubject(minorAgeSignal: boolean, affirmative: boolean): boolean {
  //@ ensures \result === true
  return !acceptsMinorReportEvidence(false, minorAgeSignal, affirmative);
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function reportAfterDecision(reportPhase: ReportPhase, decision: ReportDecision, sameMember: boolean, reportMatches: boolean): ReportPhase {
  return !sameMember ? reportPhase : (decision === "BanReport" && (reportPhase === "ReportOpen" || reportPhase === "ReportHeld") ? "ReportBanned" : (reportMatches && reportPhase === "ReportOpen" ? (decision === "HoldReport" ? "ReportHeld" : (decision === "DismissReport" ? "ReportDismissed" : reportPhase)) : reportPhase));
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function reportRestrictsMatching(reportPhase: ReportPhase, metBefore: boolean, urgent: boolean): boolean {
  return reportPhase === "ReportOpen" && metBefore && urgent;
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function lawDecidedReportDoesNotRestrictMatching(decision: ReportDecision, metBefore: boolean, urgent: boolean): boolean {
  //@ ensures \result === true
  return !reportRestrictsMatching(reportAfterDecision("ReportOpen", decision, true, true), metBefore, urgent);
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function lawDismissedReportStaysDismissed(decision: ReportDecision, sameMember: boolean, reportMatches: boolean): boolean {
  //@ ensures \result === true
  return reportAfterDecision("ReportDismissed", decision, sameMember, reportMatches) === "ReportDismissed";
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function archivedReportHoldAllowed(exactSubject: boolean, matchingRestriction: boolean): boolean {
  return exactSubject && matchingRestriction;
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawArchivedHoldRequiresExactSubject(matchingRestriction: boolean): boolean {
  //@ ensures \result === true
  return !archivedReportHoldAllowed(false, matchingRestriction);
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function carryReportOnAppLeave(ordinaryLeave: boolean, reportPhase: ReportPhase, metBefore: boolean, urgent: boolean, reportedMinor: boolean): boolean {
  return ordinaryLeave && (reportRestrictsMatching(reportPhase, metBefore, urgent) || (reportPhase === "ReportOpen" && reportedMinor));
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawOnlyOpenReportsCarry(ordinaryLeave: boolean, reportPhase: ReportPhase, metBefore: boolean, urgent: boolean, reportedMinor: boolean): boolean {
  //@ ensures \result === true
  return !carryReportOnAppLeave(ordinaryLeave, reportPhase, metBefore, urgent, reportedMinor) || reportPhase === "ReportOpen";
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawReportedMinorSignalSurvivesOrdinaryLeave(urgent: boolean): boolean {
  //@ ensures \result === true
  return carryReportOnAppLeave(true, "ReportOpen", false, urgent, true);
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawAccountErasureCarriesNoReport(reportPhase: ReportPhase, metBefore: boolean, urgent: boolean, reportedMinor: boolean): boolean {
  //@ ensures \result === true
  return !carryReportOnAppLeave(false, reportPhase, metBefore, urgent, reportedMinor);
}

/** Story: Resolve a report with its own disposition / A unique offered report name routes back to its app (spec/safetyCase.md) */
//@ pure
export function reportClarificationTimeCurrent(askedAt: number, receivedAt: number, asOf: number, oldestPrompt: number): boolean {
  return oldestPrompt <= askedAt && askedAt <= receivedAt && receivedAt <= asOf;
}

/** Story: Resolve a report with its own disposition / A unique offered report name routes back to its app (spec/safetyCase.md) */
//@ pure
export function sharedReportRoute(signedMember: boolean, choices: number): SharedReportRoute {
  return !signedMember || choices <= 0 ? "NoReportRoute" : (choices === 1 ? "UniqueReportRoute" : "AmbiguousReportRoute");
}

/** Story: Resolve a report with its own disposition / A unique offered report name routes back to its app (spec/safetyCase.md) */
//@ pure
export function lawReportReplyCannotPredateQuestion(askedAt: number, receivedAt: number, asOf: number, oldestPrompt: number): boolean {
  //@ ensures \result === true
  return !reportClarificationTimeCurrent(askedAt, receivedAt, asOf, oldestPrompt) || receivedAt >= askedAt;
}

/** Story: Resolve a report with its own disposition / A unique offered report name routes back to its app (spec/safetyCase.md) */
//@ pure
export function lawSharedReportRequiresOneChoice(signedMember: boolean, choices: number): boolean {
  //@ ensures \result === true
  return !(sharedReportRoute(signedMember, choices) === "UniqueReportRoute") || (signedMember && choices === 1);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyQuestionIsCurrent(askedAt: number, oldestQuestion: number): boolean {
  return askedAt >= oldestQuestion;
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyQuestionAcceptsName(confirmation: boolean, refusal: boolean, cancellation: boolean): boolean {
  return !(confirmation || refusal || cancellation);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyQuestionAppliesTarget(allowedTarget: boolean, excludesTarget: boolean): boolean {
  return allowedTarget && !excludesTarget;
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyQuestionExclusion(explicitExclusion: boolean, ambiguousExclusion: boolean, competingPrompt: boolean): boolean {
  return explicitExclusion || (ambiguousExclusion && !competingPrompt);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyReplyAfterExclusion(competingPrompt: boolean, replacementSentence: boolean, reply: string, separateReply: string): string {
  return !competingPrompt ? "" : (replacementSentence ? separateReply : reply);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawExpiredSafetyQuestionCannotAct(askedAt: number, oldestQuestion: number): boolean {
  //@ ensures \result === true
  return !(askedAt < oldestQuestion) || !safetyQuestionIsCurrent(askedAt, oldestQuestion);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawSafetyControlCannotNameTarget(confirmation: boolean, refusal: boolean, cancellation: boolean): boolean {
  //@ ensures \result === true
  return !(confirmation || refusal || cancellation) || !safetyQuestionAcceptsName(confirmation, refusal, cancellation);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawCompetingPromptNeedsExplicitSafetyExclusion(ambiguousExclusion: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionExclusion(false, ambiguousExclusion, true);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawExplicitSafetyExclusionStillApplies(ambiguousExclusion: boolean, competingPrompt: boolean): boolean {
  //@ ensures \result === true
  return safetyQuestionExclusion(true, ambiguousExclusion, competingPrompt);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawSafetyReplacementSendsOnlySeparateReply(competingPrompt: boolean, reply: string, separateReply: string): boolean {
  //@ ensures \result === true
  return safetyReplyAfterExclusion(competingPrompt, true, reply, separateReply) === (competingPrompt ? separateReply : "");
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawSafetyReplacementAloneDoesNotAnswerAnotherPrompt(competingPrompt: boolean, reply: string): boolean {
  //@ ensures \result === true
  return safetyReplyAfterExclusion(competingPrompt, true, reply, "") === "";
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function safetyQuestionResolves(allowedTarget: boolean, competingPrompt: boolean, cancels: boolean, excludesTarget: boolean, shortReply: boolean): boolean {
  return safetyQuestionAppliesTarget(allowedTarget, excludesTarget) || cancels || excludesTarget || (!competingPrompt && shortReply);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawTargetExclusionClosesWithoutFiling(allowedTarget: boolean, competingPrompt: boolean, shortReply: boolean): boolean {
  //@ ensures \result === true
  return safetyQuestionResolves(allowedTarget, competingPrompt, false, true, shortReply) && !safetyQuestionAppliesTarget(allowedTarget, true);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawLongUnrelatedReplyKeepsSafety(competingPrompt: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionResolves(false, competingPrompt, false, false, false);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawCompetingPromptKeepsUnresolvedSafety(shortReply: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionResolves(false, true, false, false, shortReply);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawCancellationResolvesSafety(competingPrompt: boolean, shortReply: boolean): boolean {
  //@ ensures \result === true
  return safetyQuestionResolves(false, competingPrompt, true, false, shortReply);
}

/** Story: Resolve a report with its own disposition / An unrelated reply keeps a current safety question (spec/safetyCase.md) */
//@ pure
export function lawAllowedTargetResolvesSafety(competingPrompt: boolean, cancels: boolean, shortReply: boolean): boolean {
  //@ ensures \result === true
  return safetyQuestionResolves(true, competingPrompt, cancels, false, shortReply);
}

/** Story: Resolve a report with its own disposition / A complete name or confirmation identifies one safety target (spec/safetyCase.md) */
//@ pure
export function safetyQuestionUsesSoleOffer(soleOffer: boolean, competingPrompt: boolean, exactConfirmation: boolean, hasNamedMatch: boolean): boolean {
  return soleOffer && !competingPrompt && exactConfirmation && !hasNamedMatch;
}

/** Story: Resolve a report with its own disposition / A complete name or confirmation identifies one safety target (spec/safetyCase.md) */
//@ pure
export function lawCompetingPromptCannotUseSoleSafetyOffer(soleOffer: boolean, exactConfirmation: boolean, hasNamedMatch: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionUsesSoleOffer(soleOffer, true, exactConfirmation, hasNamedMatch);
}

/** Story: Resolve a report with its own disposition / A complete name or confirmation identifies one safety target (spec/safetyCase.md) */
//@ pure
export function lawSoleSafetyOfferRequiresExactConfirmation(soleOffer: boolean, competingPrompt: boolean, hasNamedMatch: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionUsesSoleOffer(soleOffer, competingPrompt, false, hasNamedMatch);
}

/** Story: Resolve a report with its own disposition / A complete name or confirmation identifies one safety target (spec/safetyCase.md) */
//@ pure
export function lawNamedSafetyAnswerCannotUseSoleOffer(soleOffer: boolean, competingPrompt: boolean, exactConfirmation: boolean): boolean {
  //@ ensures \result === true
  return !safetyQuestionUsesSoleOffer(soleOffer, competingPrompt, exactConfirmation, true);
}

/** Story: Resolve a report with its own disposition / A ban allows only carrier commands and app leave (spec/safetyCase.md) */
//@ pure
export function inboundAllowedAfterBan(banned: boolean, compliance: boolean): boolean {
  return !banned || compliance;
}

/** Story: Resolve a report with its own disposition / A ban allows only carrier commands and app leave (spec/safetyCase.md) */
//@ pure
export function lawBanBlocksOrdinaryInbound(compliance: boolean): boolean {
  //@ ensures \result === true
  return inboundAllowedAfterBan(true, compliance) === compliance;
}

/** Story: Clear a mistaken minor signal after checking ages / A clear requires a known adult record and no stated minor age (spec/safetyCase.md) */
//@ pure
export function minorClearResult(actorPresent: boolean, memberKnown: boolean, hasSignal: boolean, ageKnown: boolean, recordMinor: boolean, statedMinor: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (!memberKnown ? "UnknownMember" : (!hasSignal ? "NoMinorSignal" : (!ageKnown ? "AgeUnknown" : (recordMinor ? "RecordMinor" : (statedMinor ? "StatedMinor" : "AllowedAction")))));
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SafetyCase, event: Event): boolean {
  if (event.type === "recordCaseEvent") return canRecordCaseEvent(current);
  if (event.type === "markCaseHeld") return canMarkCaseHeld(current);
  if (event.type === "markCaseLifted") return canMarkCaseLifted(current);
  if (event.type === "closeCase") return canCloseCase(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SafetyCase, event: Event): SafetyCase {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordCaseEvent") return canRecordCaseEvent(current) ? recordCaseEvent(current, event.liftEvent, event.decayEvent) : current;
  if (event.type === "markCaseHeld") return canMarkCaseHeld(current) ? markCaseHeld(current) : current;
  if (event.type === "markCaseLifted") return canMarkCaseLifted(current) ? markCaseLifted(current) : current;
  if (event.type === "closeCase") return canCloseCase(current) ? closeCase(current) : current;
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
  if (raw.type === "recordCaseEvent" && typeof raw.liftEvent === "boolean" && typeof raw.decayEvent === "boolean") return { type: "recordCaseEvent", liftEvent: raw.liftEvent, decayEvent: raw.decayEvent };
  if (raw.type === "markCaseHeld") return { type: "markCaseHeld" };
  if (raw.type === "markCaseLifted") return { type: "markCaseLifted" };
  if (raw.type === "closeCase") return { type: "closeCase" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SafetyCase | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NoCase" || raw.phase === "CaseOpen" || raw.phase === "CaseHeld" || raw.phase === "CaseLifted" || raw.phase === "CaseClosed") && Object.keys(raw).length === 1)) return undefined;
  const parsed: SafetyCase = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SafetyCase {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_safetyCase(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_safetyCase((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
