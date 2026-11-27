// GENERATED from spec/monthlyGathering.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type WorkMode as consoleWorkspace_WorkMode, type StaffView as consoleWorkspace_StaffView, type HeldStatus as consoleWorkspace_HeldStatus, type HeldChoice as consoleWorkspace_HeldChoice, type HeldRow as consoleWorkspace_HeldRow, type CaseRowStatus as consoleWorkspace_CaseRowStatus, type CaseStep as consoleWorkspace_CaseStep, type CaseRow as consoleWorkspace_CaseRow, type ReportStep as consoleWorkspace_ReportStep, type ReportRow as consoleWorkspace_ReportRow, type RequestSegment as consoleWorkspace_RequestSegment, type ConfigPhase as consoleWorkspace_ConfigPhase, type ConfigEditor as consoleWorkspace_ConfigEditor, type AuditPhase as consoleWorkspace_AuditPhase, type TrayPhase as consoleWorkspace_TrayPhase, type RevealPhase as consoleWorkspace_RevealPhase, type RevealForm as consoleWorkspace_RevealForm, type Workspace as consoleWorkspace_Workspace, type WorkPanel as consoleWorkspace_WorkPanel, type PanelAnswer as consoleWorkspace_PanelAnswer, type PanelView as consoleWorkspace_PanelView, type RequestOutcome as consoleWorkspace_RequestOutcome, type ConfigControl as consoleWorkspace_ConfigControl, type WorldEvent as consoleWorkspace_WorldEvent, minReasonChars as consoleWorkspace_minReasonChars, maxRevealMinutes as consoleWorkspace_maxRevealMinutes, initial as consoleWorkspace_initial, receiveViewer as consoleWorkspace_receiveViewer, staffActs as consoleWorkspace_staffActs, alwaysAdminHoldsEveryRole as consoleWorkspace_alwaysAdminHoldsEveryRole, alwaysSimulatedWorldShowsNoRealData as consoleWorkspace_alwaysSimulatedWorldShowsNoRealData, stepNewViewerClosesForms as consoleWorkspace_stepNewViewerClosesForms, panelView as consoleWorkspace_panelView, lawRefusedPanelShowsNoRows as consoleWorkspace_lawRefusedPanelShowsNoRows, lawRowsNeedAnAnswer as consoleWorkspace_lawRowsNeedAnAnswer, panelAllowed as consoleWorkspace_panelAllowed, lawAuditLogIsAdminOnly as consoleWorkspace_lawAuditLogIsAdminOnly, lawGatheringPanelNeedsARealAdmin as consoleWorkspace_lawGatheringPanelNeedsARealAdmin, canReceiveHeldText as consoleWorkspace_canReceiveHeldText, receiveHeldText as consoleWorkspace_receiveHeldText, canTypeHeldReason as consoleWorkspace_canTypeHeldReason, typeHeldReason as consoleWorkspace_typeHeldReason, canLoadHeldPhoto as consoleWorkspace_canLoadHeldPhoto, loadHeldPhoto as consoleWorkspace_loadHeldPhoto, canMarkPhotoReviewed as consoleWorkspace_canMarkPhotoReviewed, markPhotoReviewed as consoleWorkspace_markPhotoReviewed, heldReleasable as consoleWorkspace_heldReleasable, canDecideHeld as consoleWorkspace_canDecideHeld, decideHeld as consoleWorkspace_decideHeld, canReceiveHeldAnswer as consoleWorkspace_canReceiveHeldAnswer, receiveHeldAnswer as consoleWorkspace_receiveHeldAnswer, alwaysReleaseWasReleasable as consoleWorkspace_alwaysReleaseWasReleasable, alwaysHiddenMinorTextIsNeverReleased as consoleWorkspace_alwaysHiddenMinorTextIsNeverReleased, sometimesHeldTextReleased as consoleWorkspace_sometimesHeldTextReleased, sometimesHeldPhotoReleased as consoleWorkspace_sometimesHeldPhotoReleased, sometimesHeldTextRejected as consoleWorkspace_sometimesHeldTextRejected, canReceiveCase as consoleWorkspace_canReceiveCase, receiveCase as consoleWorkspace_receiveCase, canToggleCaseRow as consoleWorkspace_canToggleCaseRow, toggleCaseRow as consoleWorkspace_toggleCaseRow, canActOnCase as consoleWorkspace_canActOnCase, actOnCase as consoleWorkspace_actOnCase, canReceiveCaseAnswer as consoleWorkspace_canReceiveCaseAnswer, receiveCaseAnswer as consoleWorkspace_receiveCaseAnswer, alwaysCaseActionNeedsAnActingSafetyViewer as consoleWorkspace_alwaysCaseActionNeedsAnActingSafetyViewer, sometimesCaseClosed as consoleWorkspace_sometimesCaseClosed, sometimesHoldLifted as consoleWorkspace_sometimesHoldLifted, reportStepAllowed as consoleWorkspace_reportStepAllowed, reportDecision as consoleWorkspace_reportDecision, reportOutcome as consoleWorkspace_reportOutcome, canReceiveReport as consoleWorkspace_canReceiveReport, receiveReport as consoleWorkspace_receiveReport, reportOpen as consoleWorkspace_reportOpen, canTypeReportNote as consoleWorkspace_canTypeReportNote, typeReportNote as consoleWorkspace_typeReportNote, canActOnReport as consoleWorkspace_canActOnReport, actOnReport as consoleWorkspace_actOnReport, canReceiveReportAnswer as consoleWorkspace_canReceiveReportAnswer, receiveReportAnswer as consoleWorkspace_receiveReportAnswer, alwaysBanNeedsTheService as consoleWorkspace_alwaysBanNeedsTheService, alwaysASentReportDecisionIsAllowed as consoleWorkspace_alwaysASentReportDecisionIsAllowed, alwaysReportDecisionNeedsANote as consoleWorkspace_alwaysReportDecisionNeedsANote, lawClearMinorNeedsAMinorReport as consoleWorkspace_lawClearMinorNeedsAMinorReport, lawReadOnlyDataTakesNoReportDecision as consoleWorkspace_lawReadOnlyDataTakesNoReportDecision, lawEveryReportStepLeavesTheOpenStatus as consoleWorkspace_lawEveryReportStepLeavesTheOpenStatus, sometimesReportBanned as consoleWorkspace_sometimesReportBanned, sometimesReportHeld as consoleWorkspace_sometimesReportHeld, sometimesReportDismissed as consoleWorkspace_sometimesReportDismissed, requestShown as consoleWorkspace_requestShown, chooseRequestSegment as consoleWorkspace_chooseRequestSegment, lawEveryOutcomeHasASegment as consoleWorkspace_lawEveryOutcomeHasASegment, lawAllShowsEveryOutcome as consoleWorkspace_lawAllShowsEveryOutcome, sometimesAllRequests as consoleWorkspace_sometimesAllRequests, configControl as consoleWorkspace_configControl, switchShown as consoleWorkspace_switchShown, canReceiveConfig as consoleWorkspace_canReceiveConfig, receiveConfig as consoleWorkspace_receiveConfig, lawOnlyAdminsGetTheSwitch as consoleWorkspace_lawOnlyAdminsGetTheSwitch, canPressMatchingSwitch as consoleWorkspace_canPressMatchingSwitch, pressMatchingSwitch as consoleWorkspace_pressMatchingSwitch, canEndConfirmation as consoleWorkspace_canEndConfirmation, endConfirmation as consoleWorkspace_endConfirmation, canConfirmMatchingSwitch as consoleWorkspace_canConfirmMatchingSwitch, confirmMatchingSwitch as consoleWorkspace_confirmMatchingSwitch, canReceiveSwitchAnswer as consoleWorkspace_canReceiveSwitchAnswer, receiveSwitchAnswer as consoleWorkspace_receiveSwitchAnswer, alwaysSavingNeedsTheSwitch as consoleWorkspace_alwaysSavingNeedsTheSwitch, alwaysConfigNeedsTheAnalystRole as consoleWorkspace_alwaysConfigNeedsTheAnalystRole, stepSwitchChangesOnlyAfterSaving as consoleWorkspace_stepSwitchChangesOnlyAfterSaving, alwaysSavedSwitchWasShown as consoleWorkspace_alwaysSavedSwitchWasShown, sometimesSwitchSaved as consoleWorkspace_sometimesSwitchSaved, sometimesSwitchRefused as consoleWorkspace_sometimesSwitchRefused, canLoadAudit as consoleWorkspace_canLoadAudit, loadAudit as consoleWorkspace_loadAudit, canReceiveAudit as consoleWorkspace_canReceiveAudit, receiveAudit as consoleWorkspace_receiveAudit, alwaysAuditLogNeedsAnAdmin as consoleWorkspace_alwaysAuditLogNeedsAnAdmin, sometimesAuditShown as consoleWorkspace_sometimesAuditShown, minProposalPicks as consoleWorkspace_minProposalPicks, proposalFormShown as consoleWorkspace_proposalFormShown, groupProposal as consoleWorkspace_groupProposal, proposeAllowed as consoleWorkspace_proposeAllowed, lawProposalNeedsTheForm as consoleWorkspace_lawProposalNeedsTheForm, lawAGroupShowsTheForm as consoleWorkspace_lawAGroupShowsTheForm, trayShown as consoleWorkspace_trayShown, canSubmitProposal as consoleWorkspace_canSubmitProposal, submitProposal as consoleWorkspace_submitProposal, canReceiveProposalAnswer as consoleWorkspace_canReceiveProposalAnswer, receiveProposalAnswer as consoleWorkspace_receiveProposalAnswer, lawMinorsAreNeverProposed as consoleWorkspace_lawMinorsAreNeverProposed, alwaysTrayWorkIsSimulated as consoleWorkspace_alwaysTrayWorkIsSimulated, sometimesProposed as consoleWorkspace_sometimesProposed, worldMenuShown as consoleWorkspace_worldMenuShown, canOpenWorldMenu as consoleWorkspace_canOpenWorldMenu, openWorldMenu as consoleWorkspace_openWorldMenu, canCloseWorldMenu as consoleWorkspace_canCloseWorldMenu, closeWorldMenu as consoleWorkspace_closeWorldMenu, canSendWorldEvent as consoleWorkspace_canSendWorldEvent, sendWorldEvent as consoleWorkspace_sendWorldEvent, alwaysWorldMenuIsSimulated as consoleWorkspace_alwaysWorldMenuIsSimulated, sometimesWorldEventSent as consoleWorkspace_sometimesWorldEventSent, revealOffered as consoleWorkspace_revealOffered, canStartReveal as consoleWorkspace_canStartReveal, startReveal as consoleWorkspace_startReveal, canTypeRevealReason as consoleWorkspace_canTypeRevealReason, typeRevealReason as consoleWorkspace_typeRevealReason, revealMinuteChoices as consoleWorkspace_revealMinuteChoices, canChooseRevealMinutes as consoleWorkspace_canChooseRevealMinutes, chooseRevealMinutes as consoleWorkspace_chooseRevealMinutes, canCancelReveal as consoleWorkspace_canCancelReveal, cancelReveal as consoleWorkspace_cancelReveal, canSubmitReveal as consoleWorkspace_canSubmitReveal, submitReveal as consoleWorkspace_submitReveal, canReceiveRevealAnswer as consoleWorkspace_canReceiveRevealAnswer, receiveRevealAnswer as consoleWorkspace_receiveRevealAnswer, alwaysRevealHasAReasonAndALimit as consoleWorkspace_alwaysRevealHasAReasonAndALimit, alwaysRevealLengthIsAChoice as consoleWorkspace_alwaysRevealLengthIsAChoice, stepRevealFollowsAGrant as consoleWorkspace_stepRevealFollowsAGrant, canEndReveal as consoleWorkspace_canEndReveal, endReveal as consoleWorkspace_endReveal, canExpireReveal as consoleWorkspace_canExpireReveal, expireReveal as consoleWorkspace_expireReveal, sometimesRevealGranted as consoleWorkspace_sometimesRevealGranted } from "./consoleWorkspace.ts";
import { type AgeSide as friendIntroAge_AgeSide } from "./friendIntroAge.ts";
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings } from "./memberAge.ts";
import { type CasePhase as safetyCase_CasePhase, type SafetyCase as safetyCase_SafetyCase, type StaffActionResult as safetyCase_StaffActionResult, type ReportPhase as safetyCase_ReportPhase, type ReportDecision as safetyCase_ReportDecision, type SharedReportRoute as safetyCase_SharedReportRoute } from "./safetyCase.ts";

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringPhase = "GatheringDraft" | "GatheringApproved" | "GatheringRejected";
/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringReviewDecision = "ApproveGathering" | "RejectGathering";
/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringReviewOutcome = "GatheringReviewRefused" | "GatheringReviewApproved" | "GatheringReviewRejected";
/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
export type GatheringWriteFollowUp = "GatheringWriteSaved" | "GatheringWriteRefused" | "GatheringWriteConflict" | "GatheringWriteFailed";
/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
export type GatheringError = "GatheringInvalid" | "GatheringMonthTaken" | "GatheringNotReviewable" | "GatheringMissing" | "GatheringOtherError";

/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMinDurationMs: number = 1800000;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMaxDurationMs: number = 21600000;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMinCapacity: number = 3;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMaxCapacity: number = 150;
/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
export const gatheringEarliestYear: number = 1970;

/** Story: Author and review a public city gathering / Only a current New York Network administrator can author or decide a gathering (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringStaffAllowed(networkApp: boolean, nyc: boolean, appAdmin: boolean): boolean {
  return networkApp && nyc && appAdmin;
}

/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
//@ pure
export function gatheringDraftWindowAllowed(now: number, startsAt: number, endsAt: number, inMonth: boolean, capacity: number): boolean {
  return now < startsAt && gatheringMinDurationMs <= exact_monthlyGathering(endsAt - startsAt) && exact_monthlyGathering(endsAt - startsAt) <= gatheringMaxDurationMs && inMonth && gatheringMinCapacity <= capacity && capacity <= gatheringMaxCapacity;
}

/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringWindowAllowed(now: number, startsAt: number, endsAt: number, inMonth: boolean, publicWindow: boolean, capacity: number): boolean {
  return publicWindow && gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity);
}

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringReview(phase: GatheringPhase, revision: number, expectedRevision: number, decision: GatheringReviewDecision, currentWindow: boolean): GatheringReviewOutcome {
  return phase !== "GatheringDraft" || revision !== expectedRevision ? "GatheringReviewRefused" : (decision === "RejectGathering" ? "GatheringReviewRejected" : (currentWindow ? "GatheringReviewApproved" : "GatheringReviewRefused"));
}

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
//@ pure
export function lawGatheringReviewRequiresDraft(phase: GatheringPhase, revision: number, expectedRevision: number, decision: GatheringReviewDecision, currentWindow: boolean): boolean {
  //@ ensures \result === true
  return !(monthlyGatheringReview(phase, revision, expectedRevision, decision, currentWindow) !== "GatheringReviewRefused") || (phase === "GatheringDraft" && revision === expectedRevision);
}

/** Story: Author and review a public city gathering / The real staff console authors and reviews the exact gathering (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringConsoleAllowed(realMode: boolean, networkApp: boolean, appAdmin: boolean, serviceAvailable: boolean): boolean {
  return realMode && serviceAvailable && monthlyGatheringStaffAllowed(networkApp, true, appAdmin);
}

/** Story: Author and review a public city gathering / The real staff console authors and reviews the exact gathering (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringReviewOffered(phase: GatheringPhase): boolean {
  return phase === "GatheringDraft";
}

/** Story: Author and review a public city gathering / The real staff console authors and reviews the exact gathering (spec/monthlyGathering.md) */
//@ pure
export function lawMonthlyGatheringConsoleNeedsReal(networkApp: boolean, appAdmin: boolean, serviceAvailable: boolean): boolean {
  //@ ensures \result === true
  return !monthlyGatheringConsoleAllowed(false, networkApp, appAdmin, serviceAvailable);
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringPanelAnswer(answered: boolean, status: number, listRead: boolean): consoleWorkspace_PanelAnswer {
  return !answered ? "NotAnswered" : (status === 403 ? "AnswerForbidden" : (status === 503 ? "AnswerMissing" : (listRead ? "AnswerRows" : "AnswerFailed")));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringDraftFormShown(answer: consoleWorkspace_PanelAnswer): boolean {
  return answer === "AnswerRows";
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringLocalTimeExact(year: number, matchCount: number): boolean {
  return year >= gatheringEarliestYear && matchCount === 1;
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringDraftReady(fieldsComplete: boolean, now: number, startsAt: number, endsAt: number, inMonth: boolean, capacity: number): boolean {
  return fieldsComplete && gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity);
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringConfirmShown(phase: GatheringPhase, sameRow: boolean, chosenRevision: number, revision: number): boolean {
  return monthlyGatheringReviewOffered(phase) && sameRow && chosenRevision === revision;
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringWriteFollowUp(saved: boolean, status: number): GatheringWriteFollowUp {
  return saved ? "GatheringWriteSaved" : (status === 403 ? "GatheringWriteRefused" : (status === 409 ? "GatheringWriteConflict" : "GatheringWriteFailed"));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringConfirmationCloses(followUp: GatheringWriteFollowUp): boolean {
  return followUp !== "GatheringWriteFailed";
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringListRead(followUp: GatheringWriteFollowUp): boolean {
  return followUp === "GatheringWriteConflict";
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function gatheringErrorFor(code: string): GatheringError {
  return code === "invalid_gathering" ? "GatheringInvalid" : (code === "month_unavailable" ? "GatheringMonthTaken" : (code === "gathering_not_reviewable" ? "GatheringNotReviewable" : (code === "not_found" ? "GatheringMissing" : "GatheringOtherError")));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawRefusedGatheringListShowsNoForm(listRead: boolean): boolean {
  //@ ensures \result === true
  return !gatheringDraftFormShown(gatheringPanelAnswer(true, 403, listRead));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawGatheringFormNeedsTheList(answered: boolean, status: number, listRead: boolean): boolean {
  //@ ensures \result === true
  return !gatheringDraftFormShown(gatheringPanelAnswer(answered, status, listRead)) || (answered && listRead);
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawSkippedOrRepeatedTimeIsRefused(year: number, matchCount: number): boolean {
  //@ ensures \result === true
  return !(matchCount !== 1) || !gatheringLocalTimeExact(year, matchCount);
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawReadyDraftPassesTheWindowRule(fieldsComplete: boolean, now: number, startsAt: number, endsAt: number, inMonth: boolean, capacity: number): boolean {
  //@ ensures \result === true
  return !gatheringDraftReady(fieldsComplete, now, startsAt, endsAt, inMonth, capacity) || (fieldsComplete && gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawStaleRevisionShowsNoConfirm(phase: GatheringPhase, sameRow: boolean, chosenRevision: number, revision: number): boolean {
  //@ ensures \result === true
  return !gatheringConfirmShown(phase, sameRow, chosenRevision, revision) || (phase === "GatheringDraft" && sameRow && chosenRevision === revision);
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawRefusedWriteClosesTheConfirmation(status: number): boolean {
  //@ ensures \result === true
  return !(status === 403 || status === 409) || gatheringConfirmationCloses(gatheringWriteFollowUp(false, status));
}

/** Story: Author and review a public city gathering / The gathering panel offers the draft form and one confirmation at a time (spec/monthlyGathering.md) */
//@ pure
export function lawOnlyAConflictReadsTheListAgain(saved: boolean, status: number): boolean {
  //@ ensures \result === true
  return gatheringListRead(gatheringWriteFollowUp(saved, status)) === (!saved && status === 409);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_monthlyGathering(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
