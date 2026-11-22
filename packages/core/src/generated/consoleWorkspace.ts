// GENERATED from spec/consoleWorkspace.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type StaffActionResult as safetyCase_StaffActionResult, type ReportPhase as safetyCase_ReportPhase, type ReportDecision as safetyCase_ReportDecision, type SharedReportRoute as safetyCase_SharedReportRoute, type CasePhase as safetyCase_CasePhase, type SafetyCase as safetyCase_SafetyCase, holdSubjectKnown as safetyCase_holdSubjectKnown, immediateDangerReply as safetyCase_immediateDangerReply, emergencyCheckInReport as safetyCase_emergencyCheckInReport, archivedReportHoldAllowed as safetyCase_archivedReportHoldAllowed, reportClarificationTimeCurrent as safetyCase_reportClarificationTimeCurrent, inboundAllowedAfterBan as safetyCase_inboundAllowedAfterBan, liveCase as safetyCase_liveCase, markCaseHeld as safetyCase_markCaseHeld, markCaseLifted as safetyCase_markCaseLifted, closeCase as safetyCase_closeCase, stepClosedCaseStaysClosed as safetyCase_stepClosedCaseStaysClosed, sometimesCaseCloses as safetyCase_sometimesCaseCloses, sometimesCaseWasLifted as safetyCase_sometimesCaseWasLifted, holdLiftResult as safetyCase_holdLiftResult, caseCloseResult as safetyCase_caseCloseResult, holdAuthority as safetyCase_holdAuthority, lawEmergencyReplyRequiresOwnText as safetyCase_lawEmergencyReplyRequiresOwnText, lawEmergencyReplyRequiresCurrentDanger as safetyCase_lawEmergencyReplyRequiresCurrentDanger, initial as safetyCase_initial, lawEmergencyCheckInNeedsReceipt as safetyCase_lawEmergencyCheckInNeedsReceipt, reportAfterDecision as safetyCase_reportAfterDecision, canRecordCaseEvent as safetyCase_canRecordCaseEvent, reportRestrictsMatching as safetyCase_reportRestrictsMatching, lawArchivedHoldRequiresExactSubject as safetyCase_lawArchivedHoldRequiresExactSubject, sharedReportRoute as safetyCase_sharedReportRoute, lawReportReplyCannotPredateQuestion as safetyCase_lawReportReplyCannotPredateQuestion, lawBanBlocksOrdinaryInbound as safetyCase_lawBanBlocksOrdinaryInbound, minorClearResult as safetyCase_minorClearResult, recordCaseEvent as safetyCase_recordCaseEvent, canMarkCaseHeld as safetyCase_canMarkCaseHeld, canMarkCaseLifted as safetyCase_canMarkCaseLifted, canCloseCase as safetyCase_canCloseCase, lawDecidedReportDoesNotRestrictMatching as safetyCase_lawDecidedReportDoesNotRestrictMatching, lawDismissedReportStaysDismissed as safetyCase_lawDismissedReportStaysDismissed, carryReportOnAppLeave as safetyCase_carryReportOnAppLeave, lawSharedReportRequiresOneChoice as safetyCase_lawSharedReportRequiresOneChoice, lawDecayNeverOpensCase as safetyCase_lawDecayNeverOpensCase, lawOnlyOpenReportsCarry as safetyCase_lawOnlyOpenReportsCarry } from "./safetyCase.ts";

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type ReportStep = "HoldPersonStep" | "BanPhoneStep" | "BanPersonStep" | "DismissStep" | "ClearMinorStep";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type RequestSegment = "OpenSegment" | "FulfilledSegment" | "NoneSegment" | "AnsweredSegment" | "AllSegment";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type ConfigPhase = "ConfigLoading" | "ConfigShown" | "ConfigConfirming" | "ConfigSaving" | "ConfigFailed";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type AuditPhase = "AuditClosed" | "AuditLoading" | "AuditShown" | "AuditFailed";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type TrayPhase = "TrayIdle" | "TraySending" | "TrayProposed";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type RevealPhase = "RevealHidden" | "RevealDrafting" | "RevealSending" | "RevealGranted";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type HeldStatus = "HeldEmpty" | "HeldWaiting" | "HeldSending" | "HeldReleased" | "HeldRejected";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type WorkMode = "SimulatedWorld" | "RealWithService" | "RealWithoutService";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type HeldChoice = "ReleaseHeld" | "RejectHeld";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type CaseRowStatus = "CaseRowEmpty" | "CaseRowOpen" | "CaseRowClosed";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export type CaseStep = "LiftStep" | "CloseStep";
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface CaseRow { status: CaseRowStatus; onHold: boolean; expanded: boolean; caseSending: boolean; caseStep: CaseStep }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface ConfigEditor { phase: ConfigPhase; matchingOn: boolean; packLocked: boolean; changeable: boolean; saved: boolean }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface StaffView { mode: WorkMode; safety: boolean; admin: boolean; analyst: boolean; simRole: boolean; globalPii: boolean }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface RevealForm { phase: RevealPhase; reasonReady: boolean; minutes: number }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface HeldRow { status: HeldStatus; choice: HeldChoice; photo: boolean; minorHidden: boolean; reasonReady: boolean; photoLoaded: boolean; photoReviewed: boolean }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface ReportRow { present: boolean; status: safetyCase_ReportPhase; minorReport: boolean; noteReady: boolean; reportSending: boolean; reportStep: ReportStep }
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export interface Workspace { staff: StaffView; held: HeldRow; caseRow: CaseRow; report: ReportRow; requestSegment: RequestSegment; config: ConfigEditor; audit: AuditPhase; tray: TrayPhase; worldMenuOpen: boolean; worldEventSent: boolean; reveal: RevealForm }
/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
export type WorkPanel = "HeldPanel" | "CasesPanel" | "ReportsPanel" | "RequestsPanel" | "ConfigPanel" | "AuditPanel" | "LabPanel" | "BiasPanel";
/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
export type PanelAnswer = "NotAnswered" | "AnswerRows" | "AnswerForbidden" | "AnswerMissing" | "AnswerFailed";
/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
export type PanelView = "PanelLoading" | "PanelForbidden" | "PanelUnavailable" | "PanelFailed" | "PanelEmpty" | "PanelRows";
/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
export type RequestOutcome = "ProbingOutcome" | "OpenOutcome" | "FulfilledOutcome" | "BookedOutcome" | "NoneOutcome" | "AnsweredOutcome";
/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
export type ConfigControl = "SwitchControl" | "LockedNote" | "AdminOnlyNote" | "ReadOnlyNote";
/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
export type WorldEvent = "GoSilent" | "ForceFlake" | "TextStop";

/** One variant per transition in the spec. */
export type Event =
  | { type: "receiveViewer"; viewMode: WorkMode; safetyRole: boolean; adminRole: boolean; analystRole: boolean; simRoleHeld: boolean; globalPiiShown: boolean }
  | { type: "receiveHeldText"; photoItem: boolean; minorItem: boolean }
  | { type: "typeHeldReason"; reasonChars: number }
  | { type: "markPhotoReviewed"; reviewed: boolean }
  | { type: "loadHeldPhoto"; loaded: boolean }
  | { type: "decideHeld"; choice: HeldChoice }
  | { type: "receiveHeldAnswer"; accepted: boolean }
  | { type: "receiveCase"; heldCase: boolean }
  | { type: "toggleCaseRow" }
  | { type: "actOnCase"; caseStep: CaseStep }
  | { type: "receiveCaseAnswer"; accepted: boolean }
  | { type: "receiveReport"; minorKind: boolean }
  | { type: "typeReportNote"; noteChars: number }
  | { type: "actOnReport"; reportStep: ReportStep }
  | { type: "receiveReportAnswer"; accepted: boolean }
  | { type: "chooseRequestSegment"; segment: RequestSegment }
  | { type: "receiveConfig"; matchingEnabled: boolean; locked: boolean; canChange: boolean }
  | { type: "pressMatchingSwitch" }
  | { type: "endConfirmation" }
  | { type: "confirmMatchingSwitch" }
  | { type: "receiveSwitchAnswer"; accepted: boolean }
  | { type: "loadAudit" }
  | { type: "receiveAudit"; loaded: boolean }
  | { type: "submitProposal"; pickCount: number; minorPicked: boolean; sparksLeft: number; gameOver: boolean }
  | { type: "receiveProposalAnswer"; accepted: boolean }
  | { type: "openWorldMenu" }
  | { type: "closeWorldMenu" }
  | { type: "sendWorldEvent"; worldEvent: WorldEvent }
  | { type: "startReveal" }
  | { type: "typeRevealReason"; reasonChars: number }
  | { type: "chooseRevealMinutes"; minutes: number }
  | { type: "cancelReveal" }
  | { type: "submitReveal" }
  | { type: "receiveRevealAnswer"; granted: boolean }
  | { type: "endReveal" }
  | { type: "expireReveal" };

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
export const minProposalPicks: number = 2;
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export const minReasonChars: number = 5;
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export const maxRevealMinutes: number = 15;
/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
export const revealMinuteChoices: number[] = [5, 10, 15];
/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
export const initial: Workspace = { staff: ({ mode: "RealWithoutService", safety: false, admin: false, analyst: false, simRole: false, globalPii: false } as StaffView), held: ({ status: "HeldEmpty", choice: "RejectHeld", photo: false, minorHidden: false, reasonReady: false, photoLoaded: false, photoReviewed: false } as HeldRow), caseRow: ({ status: "CaseRowEmpty", onHold: false, expanded: false, caseSending: false, caseStep: "CloseStep" } as CaseRow), report: ({ present: false, status: "ReportOpen", minorReport: false, noteReady: false, reportSending: false, reportStep: "DismissStep" } as ReportRow), requestSegment: "OpenSegment", config: ({ phase: "ConfigLoading", matchingOn: false, packLocked: false, changeable: false, saved: false } as ConfigEditor), audit: "AuditClosed", tray: "TrayIdle", worldMenuOpen: false, worldEventSent: false, reveal: ({ phase: "RevealHidden", reasonReady: false, minutes: maxRevealMinutes } as RevealForm) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Workspace): boolean {
  return alwaysAdminHoldsEveryRole(current) && alwaysSimulatedWorldShowsNoRealData(current) && alwaysReleaseWasReleasable(current) && alwaysHiddenMinorTextIsNeverReleased(current) && alwaysCaseActionNeedsAnActingSafetyViewer(current) && alwaysBanNeedsTheService(current) && alwaysASentReportDecisionIsAllowed(current) && alwaysReportDecisionNeedsANote(current) && alwaysConfigNeedsTheAnalystRole(current) && alwaysSavedSwitchWasShown(current) && alwaysSavingNeedsTheSwitch(current) && alwaysAuditLogNeedsAnAdmin(current) && alwaysTrayWorkIsSimulated(current) && alwaysWorldMenuIsSimulated(current) && alwaysRevealHasAReasonAndALimit(current) && alwaysRevealLengthIsAChoice(current);
}

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
//@ pure
export function staffActs(staff: StaffView): boolean {
  return staff.mode !== "RealWithoutService";
}

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
//@ pure
export function alwaysAdminHoldsEveryRole(w: Workspace): boolean {
  return !w.staff.admin || (w.staff.safety && w.staff.analyst && w.staff.simRole);
}

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
//@ pure
export function alwaysSimulatedWorldShowsNoRealData(w: Workspace): boolean {
  return !(w.staff.mode === "SimulatedWorld") || !w.staff.globalPii;
}

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
//@ pure
export function stepNewViewerClosesForms(before: Workspace, via: string, after: Workspace): boolean {
  return !(via === "receiveViewer") || (after.tray === "TrayIdle" && !after.worldMenuOpen && after.reveal.phase === "RevealHidden" && after.audit === "AuditClosed" && after.config.phase === "ConfigLoading");
}

/** Story: Work only in the panels my role and mode allow / A new viewer or mode starts every panel again (spec/consoleWorkspace.md) */
//@ pure
export function receiveViewer(w: Workspace, viewMode: WorkMode, safetyRole: boolean, adminRole: boolean, analystRole: boolean, simRoleHeld: boolean, globalPiiShown: boolean): Workspace {
  //@ ensures (inv(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w)) ==> stepNewViewerClosesForms(w, "receiveViewer", \result)
  //@ ensures (inv(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveViewer", \result)
  //@ ensures (inv(w)) ==> stepRevealFollowsAGrant(w, "receiveViewer", \result)
  return { ...initial, staff: ({ mode: viewMode, admin: adminRole, safety: safetyRole || adminRole, analyst: analystRole || adminRole, simRole: simRoleHeld || adminRole, globalPii: globalPiiShown && viewMode !== "SimulatedWorld" } as StaffView) };
}

/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
//@ pure
export function panelView(panel: WorkPanel, answer: PanelAnswer, rowCount: number): PanelView {
  return answer === "NotAnswered" ? "PanelLoading" : (answer === "AnswerForbidden" ? "PanelForbidden" : (answer === "AnswerMissing" && (panel === "HeldPanel" || panel === "BiasPanel") ? "PanelUnavailable" : (answer !== "AnswerRows" ? "PanelFailed" : (rowCount <= 0 ? "PanelEmpty" : "PanelRows"))));
}

/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
//@ pure
export function lawRefusedPanelShowsNoRows(panel: WorkPanel, rowCount: number): boolean {
  //@ ensures \result === true
  return panelView(panel, "AnswerForbidden", rowCount) === "PanelForbidden";
}

/** Story: Work only in the panels my role and mode allow / Each panel shows a loading, refused, unavailable, failed, empty or full view (spec/consoleWorkspace.md) */
//@ pure
export function lawRowsNeedAnAnswer(panel: WorkPanel, answer: PanelAnswer, rowCount: number): boolean {
  //@ ensures \result === true
  return !(panelView(panel, answer, rowCount) === "PanelRows") || (answer === "AnswerRows" && rowCount > 0);
}

/** Story: Work only in the panels my role and mode allow / Each panel opens only for the roles that can read it (spec/consoleWorkspace.md) */
//@ pure
export function panelAllowed(panel: WorkPanel, staff: StaffView): boolean {
  return panel === "HeldPanel" || panel === "CasesPanel" || panel === "ReportsPanel" ? staff.safety : (panel === "ConfigPanel" || panel === "LabPanel" ? staff.analyst : (panel === "AuditPanel" ? staff.admin : (panel === "BiasPanel" ? staff.analyst && staff.mode !== "SimulatedWorld" : true)));
}

/** Story: Work only in the panels my role and mode allow / Each panel opens only for the roles that can read it (spec/consoleWorkspace.md) */
//@ pure
export function lawAuditLogIsAdminOnly(staff: StaffView): boolean {
  //@ ensures \result === true
  return panelAllowed("AuditPanel", staff) === staff.admin;
}

/** Story: Decide a held text with a reason / A held text waits for a reason of five characters or more (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveHeldText(w: Workspace): boolean {
  return w.staff.safety && w.staff.mode === "RealWithService" && w.held.status !== "HeldSending";
}

/** Story: Decide a held text with a reason / A held text waits for a reason of five characters or more (spec/consoleWorkspace.md) */
//@ pure
export function receiveHeldText(w: Workspace, photoItem: boolean, minorItem: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> stepNewViewerClosesForms(w, "receiveHeldText", \result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveHeldText", \result)
  //@ ensures (inv(w) && canReceiveHeldText(w)) ==> stepRevealFollowsAGrant(w, "receiveHeldText", \result)
  return { ...w, held: ({ status: "HeldWaiting", choice: "RejectHeld", photo: photoItem, minorHidden: minorItem, reasonReady: false, photoLoaded: false, photoReviewed: false } as HeldRow) };
}

/** Story: Decide a held text with a reason / A held text waits for a reason of five characters or more (spec/consoleWorkspace.md) */
//@ pure
export function canTypeHeldReason(w: Workspace): boolean {
  return w.held.status === "HeldWaiting";
}

/** Story: Decide a held text with a reason / A held text waits for a reason of five characters or more (spec/consoleWorkspace.md) */
//@ pure
export function typeHeldReason(w: Workspace, reasonChars: number): Workspace {
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> stepNewViewerClosesForms(w, "typeHeldReason", \result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "typeHeldReason", \result)
  //@ ensures (inv(w) && canTypeHeldReason(w)) ==> stepRevealFollowsAGrant(w, "typeHeldReason", \result)
  return { ...w, held: ({ ...w.held, reasonReady: reasonChars >= minReasonChars, photoReviewed: false } as HeldRow) };
}

/** Story: Decide a held text with a reason / A held photo is released only after staff load it and confirm the review (spec/consoleWorkspace.md) */
//@ pure
export function markPhotoReviewed(w: Workspace, reviewed: boolean): Workspace {
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> stepNewViewerClosesForms(w, "markPhotoReviewed", \result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "markPhotoReviewed", \result)
  //@ ensures (inv(w) && canMarkPhotoReviewed(w)) ==> stepRevealFollowsAGrant(w, "markPhotoReviewed", \result)
  return { ...w, held: ({ ...w.held, photoReviewed: reviewed } as HeldRow) };
}

/** Story: Decide a held text with a reason / A held photo is released only after staff load it and confirm the review (spec/consoleWorkspace.md) */
//@ pure
export function canLoadHeldPhoto(w: Workspace): boolean {
  return w.held.status === "HeldWaiting" && w.held.photo && w.held.reasonReady && !w.held.minorHidden;
}

/** Story: Decide a held text with a reason / A held photo is released only after staff load it and confirm the review (spec/consoleWorkspace.md) */
//@ pure
export function loadHeldPhoto(w: Workspace, loaded: boolean): Workspace {
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> stepNewViewerClosesForms(w, "loadHeldPhoto", \result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "loadHeldPhoto", \result)
  //@ ensures (inv(w) && canLoadHeldPhoto(w)) ==> stepRevealFollowsAGrant(w, "loadHeldPhoto", \result)
  return { ...w, held: ({ ...w.held, photoLoaded: loaded, photoReviewed: false } as HeldRow) };
}

/** Story: Decide a held text with a reason / A held photo is released only after staff load it and confirm the review (spec/consoleWorkspace.md) */
//@ pure
export function canMarkPhotoReviewed(w: Workspace): boolean {
  return w.held.status === "HeldWaiting" && w.held.photoLoaded;
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function heldReleasable(held: HeldRow): boolean {
  return !held.minorHidden && (!held.photo || (held.photoLoaded && held.photoReviewed));
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function canDecideHeld(w: Workspace, choice: HeldChoice): boolean {
  return w.held.status === "HeldWaiting" && w.staff.safety && w.staff.mode === "RealWithService" && w.held.reasonReady && (choice === "RejectHeld" || heldReleasable(w.held));
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function decideHeld(w: Workspace, choice: HeldChoice): Workspace {
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> stepNewViewerClosesForms(w, "decideHeld", \result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> stepSwitchChangesOnlyAfterSaving(w, "decideHeld", \result)
  //@ ensures (inv(w) && canDecideHeld(w, choice)) ==> stepRevealFollowsAGrant(w, "decideHeld", \result)
  return { ...w, held: ({ ...w.held, status: "HeldSending", choice: choice } as HeldRow) };
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveHeldAnswer(w: Workspace): boolean {
  return w.held.status === "HeldSending";
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function receiveHeldAnswer(w: Workspace, accepted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveHeldAnswer", \result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveHeldAnswer", \result)
  //@ ensures (inv(w) && canReceiveHeldAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveHeldAnswer", \result)
  return { ...w, held: ({ ...w.held, status: !accepted ? "HeldWaiting" : (w.held.choice === "ReleaseHeld" ? "HeldReleased" : "HeldRejected") } as HeldRow) };
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function alwaysReleaseWasReleasable(w: Workspace): boolean {
  return !(w.held.status === "HeldReleased" || (w.held.status === "HeldSending" && w.held.choice === "ReleaseHeld")) || (heldReleasable(w.held) && w.held.reasonReady);
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function alwaysHiddenMinorTextIsNeverReleased(w: Workspace): boolean {
  return !w.held.minorHidden || w.held.status !== "HeldReleased";
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function sometimesHeldTextReleased(w: Workspace): boolean {
  return w.held.status === "HeldReleased";
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function sometimesHeldPhotoReleased(w: Workspace): boolean {
  return w.held.status === "HeldReleased" && w.held.photo;
}

/** Story: Decide a held text with a reason / Release needs a releasable text, and reject needs only a reason (spec/consoleWorkspace.md) */
//@ pure
export function sometimesHeldTextRejected(w: Workspace): boolean {
  return w.held.status === "HeldRejected";
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveCase(w: Workspace): boolean {
  return w.staff.safety && !w.caseRow.caseSending;
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function receiveCase(w: Workspace, heldCase: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> stepNewViewerClosesForms(w, "receiveCase", \result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveCase", \result)
  //@ ensures (inv(w) && canReceiveCase(w)) ==> stepRevealFollowsAGrant(w, "receiveCase", \result)
  return { ...w, caseRow: ({ status: "CaseRowOpen", onHold: heldCase, expanded: false, caseSending: false, caseStep: "CloseStep" } as CaseRow) };
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function canToggleCaseRow(w: Workspace): boolean {
  return w.caseRow.status !== "CaseRowEmpty";
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function toggleCaseRow(w: Workspace): Workspace {
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> stepNewViewerClosesForms(w, "toggleCaseRow", \result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "toggleCaseRow", \result)
  //@ ensures (inv(w) && canToggleCaseRow(w)) ==> stepRevealFollowsAGrant(w, "toggleCaseRow", \result)
  return { ...w, caseRow: ({ ...w.caseRow, expanded: !w.caseRow.expanded } as CaseRow) };
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function canActOnCase(w: Workspace, caseStep: CaseStep): boolean {
  return w.caseRow.expanded && w.caseRow.status === "CaseRowOpen" && !w.caseRow.caseSending && w.staff.safety && staffActs(w.staff) && (!(caseStep === "LiftStep") || w.caseRow.onHold);
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function actOnCase(w: Workspace, caseStep: CaseStep): Workspace {
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> stepNewViewerClosesForms(w, "actOnCase", \result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> stepSwitchChangesOnlyAfterSaving(w, "actOnCase", \result)
  //@ ensures (inv(w) && canActOnCase(w, caseStep)) ==> stepRevealFollowsAGrant(w, "actOnCase", \result)
  return { ...w, caseRow: ({ ...w.caseRow, caseSending: true, caseStep: caseStep } as CaseRow) };
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveCaseAnswer(w: Workspace): boolean {
  return w.caseRow.caseSending;
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function receiveCaseAnswer(w: Workspace, accepted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveCaseAnswer", \result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveCaseAnswer", \result)
  //@ ensures (inv(w) && canReceiveCaseAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveCaseAnswer", \result)
  const local_0: CaseRow = w.caseRow;
  return { ...w, caseRow: ({ ...local_0, caseSending: false, onHold: accepted && local_0.caseStep === "LiftStep" ? false : local_0.onHold, status: accepted && local_0.caseStep === "CloseStep" ? "CaseRowClosed" : local_0.status } as CaseRow) };
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function alwaysCaseActionNeedsAnActingSafetyViewer(w: Workspace): boolean {
  return !w.caseRow.caseSending || (w.staff.safety && staffActs(w.staff) && w.caseRow.status === "CaseRowOpen");
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function sometimesCaseClosed(w: Workspace): boolean {
  return w.caseRow.status === "CaseRowClosed";
}

/** Story: Act on safety cases and reports / A case row opens, and a safety viewer lifts its hold or closes it (spec/consoleWorkspace.md) */
//@ pure
export function sometimesHoldLifted(w: Workspace): boolean {
  return w.caseRow.status === "CaseRowOpen" && !w.caseRow.onHold && w.caseRow.caseStep === "LiftStep";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function reportStepAllowed(reportStep: ReportStep, mode: WorkMode, minorReport: boolean): boolean {
  return reportStep === "ClearMinorStep" ? minorReport && mode !== "RealWithoutService" : mode === "RealWithService";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function reportDecision(reportStep: ReportStep): safetyCase_ReportDecision {
  return reportStep === "HoldPersonStep" ? "HoldReport" : (reportStep === "BanPhoneStep" || reportStep === "BanPersonStep" ? "BanReport" : "DismissReport");
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function reportOutcome(reportStep: ReportStep): safetyCase_ReportPhase {
  return safetyCase_reportAfterDecision("ReportOpen", reportDecision(reportStep), true, true);
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function lawClearMinorNeedsAMinorReport(mode: WorkMode): boolean {
  //@ ensures \result === true
  return !reportStepAllowed("ClearMinorStep", mode, false);
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function lawReadOnlyDataTakesNoReportDecision(reportStep: ReportStep, minorReport: boolean): boolean {
  //@ ensures \result === true
  return !reportStepAllowed(reportStep, "RealWithoutService", minorReport);
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveReport(w: Workspace): boolean {
  return w.staff.safety && !w.report.reportSending;
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function receiveReport(w: Workspace, minorKind: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> stepNewViewerClosesForms(w, "receiveReport", \result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveReport", \result)
  //@ ensures (inv(w) && canReceiveReport(w)) ==> stepRevealFollowsAGrant(w, "receiveReport", \result)
  return { ...w, report: ({ present: true, status: "ReportOpen", minorReport: minorKind, noteReady: false, reportSending: false, reportStep: "DismissStep" } as ReportRow) };
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function reportOpen(w: Workspace): boolean {
  return w.report.present && w.report.status === "ReportOpen";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function typeReportNote(w: Workspace, noteChars: number): Workspace {
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> stepNewViewerClosesForms(w, "typeReportNote", \result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "typeReportNote", \result)
  //@ ensures (inv(w) && canTypeReportNote(w)) ==> stepRevealFollowsAGrant(w, "typeReportNote", \result)
  return { ...w, report: ({ ...w.report, noteReady: noteChars >= minReasonChars } as ReportRow) };
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function actOnReport(w: Workspace, reportStep: ReportStep): Workspace {
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> stepNewViewerClosesForms(w, "actOnReport", \result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> stepSwitchChangesOnlyAfterSaving(w, "actOnReport", \result)
  //@ ensures (inv(w) && canActOnReport(w, reportStep)) ==> stepRevealFollowsAGrant(w, "actOnReport", \result)
  return { ...w, report: ({ ...w.report, reportSending: true, reportStep: reportStep } as ReportRow) };
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveReportAnswer(w: Workspace): boolean {
  return w.report.reportSending;
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function receiveReportAnswer(w: Workspace, accepted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveReportAnswer", \result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveReportAnswer", \result)
  //@ ensures (inv(w) && canReceiveReportAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveReportAnswer", \result)
  return { ...w, report: ({ ...w.report, reportSending: false, status: accepted ? reportOutcome(w.report.reportStep) : w.report.status } as ReportRow) };
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function alwaysBanNeedsTheService(w: Workspace): boolean {
  return !(w.report.status === "ReportBanned" || w.report.status === "ReportHeld") || (w.report.present && w.staff.mode === "RealWithService");
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function alwaysASentReportDecisionIsAllowed(w: Workspace): boolean {
  return !w.report.reportSending || (w.report.present && reportStepAllowed(w.report.reportStep, w.staff.mode, w.report.minorReport));
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function alwaysReportDecisionNeedsANote(w: Workspace): boolean {
  return !(w.report.reportSending || w.report.status !== "ReportOpen") || (w.report.present && w.report.noteReady);
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function lawEveryReportStepLeavesTheOpenStatus(reportStep: ReportStep): boolean {
  //@ ensures \result === true
  return reportOutcome(reportStep) !== "ReportOpen";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function sometimesReportBanned(w: Workspace): boolean {
  return w.report.status === "ReportBanned";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function sometimesReportHeld(w: Workspace): boolean {
  return w.report.status === "ReportHeld";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function sometimesReportDismissed(w: Workspace): boolean {
  return w.report.status === "ReportDismissed";
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function canTypeReportNote(w: Workspace): boolean {
  return reportOpen(w) && !w.report.reportSending;
}

/** Story: Act on safety cases and reports / A report decision needs a note and the Network service (spec/consoleWorkspace.md) */
//@ pure
export function canActOnReport(w: Workspace, reportStep: ReportStep): boolean {
  return reportOpen(w) && !w.report.reportSending && w.staff.safety && w.report.noteReady && reportStepAllowed(reportStep, w.staff.mode, w.report.minorReport);
}

/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
//@ pure
export function requestShown(requestOutcome: RequestOutcome, segment: RequestSegment): boolean {
  return segment === "AllSegment" ? true : (segment === "OpenSegment" ? requestOutcome === "ProbingOutcome" || requestOutcome === "OpenOutcome" : (segment === "FulfilledSegment" ? requestOutcome === "FulfilledOutcome" || requestOutcome === "BookedOutcome" : (segment === "NoneSegment" ? requestOutcome === "NoneOutcome" : requestOutcome === "AnsweredOutcome")));
}

/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
//@ pure
export function lawEveryOutcomeHasASegment(requestOutcome: RequestOutcome): boolean {
  //@ ensures \result === true
  return requestShown(requestOutcome, "OpenSegment") || requestShown(requestOutcome, "FulfilledSegment") || requestShown(requestOutcome, "NoneSegment") || requestShown(requestOutcome, "AnsweredSegment");
}

/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
//@ pure
export function lawAllShowsEveryOutcome(requestOutcome: RequestOutcome): boolean {
  //@ ensures \result === true
  return requestShown(requestOutcome, "AllSegment");
}

/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
//@ pure
export function chooseRequestSegment(w: Workspace, segment: RequestSegment): Workspace {
  //@ ensures (inv(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w)) ==> stepNewViewerClosesForms(w, "chooseRequestSegment", \result)
  //@ ensures (inv(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "chooseRequestSegment", \result)
  //@ ensures (inv(w)) ==> stepRevealFollowsAGrant(w, "chooseRequestSegment", \result)
  return { ...w, requestSegment: segment };
}

/** Story: See what members asked for / The request segments group the outcomes (spec/consoleWorkspace.md) */
//@ pure
export function sometimesAllRequests(w: Workspace): boolean {
  return w.requestSegment === "AllSegment";
}

/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
//@ pure
export function configControl(changeable: boolean, adminRole: boolean, packLocked: boolean, matchingOn: boolean): ConfigControl {
  return packLocked && !matchingOn ? "LockedNote" : (changeable && adminRole ? "SwitchControl" : (changeable ? "AdminOnlyNote" : "ReadOnlyNote"));
}

/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
//@ pure
export function lawOnlyAdminsGetTheSwitch(changeable: boolean, packLocked: boolean, matchingOn: boolean): boolean {
  //@ ensures \result === true
  return configControl(changeable, false, packLocked, matchingOn) !== "SwitchControl";
}

/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
//@ pure
export function switchShown(w: Workspace): boolean {
  return w.config.phase !== "ConfigLoading" && configControl(w.config.changeable, w.staff.admin, w.config.packLocked, w.config.matchingOn) === "SwitchControl";
}

/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveConfig(w: Workspace): boolean {
  return w.staff.analyst && w.config.phase !== "ConfigSaving";
}

/** Story: Change the matching switch with a confirmation / The switch shows only to an admin who can change it (spec/consoleWorkspace.md) */
//@ pure
export function receiveConfig(w: Workspace, matchingEnabled: boolean, locked: boolean, canChange: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> stepNewViewerClosesForms(w, "receiveConfig", \result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveConfig", \result)
  //@ ensures (inv(w) && canReceiveConfig(w)) ==> stepRevealFollowsAGrant(w, "receiveConfig", \result)
  return { ...w, config: ({ phase: "ConfigShown", matchingOn: matchingEnabled, packLocked: locked, changeable: canChange, saved: false } as ConfigEditor) };
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function pressMatchingSwitch(w: Workspace): Workspace {
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> stepNewViewerClosesForms(w, "pressMatchingSwitch", \result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "pressMatchingSwitch", \result)
  //@ ensures (inv(w) && canPressMatchingSwitch(w)) ==> stepRevealFollowsAGrant(w, "pressMatchingSwitch", \result)
  return { ...w, config: ({ ...w.config, phase: "ConfigConfirming", saved: false } as ConfigEditor) };
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function canEndConfirmation(w: Workspace): boolean {
  return w.config.phase === "ConfigConfirming";
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function endConfirmation(w: Workspace): Workspace {
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> stepNewViewerClosesForms(w, "endConfirmation", \result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "endConfirmation", \result)
  //@ ensures (inv(w) && canEndConfirmation(w)) ==> stepRevealFollowsAGrant(w, "endConfirmation", \result)
  return { ...w, config: ({ ...w.config, phase: "ConfigShown" } as ConfigEditor) };
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function confirmMatchingSwitch(w: Workspace): Workspace {
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> stepNewViewerClosesForms(w, "confirmMatchingSwitch", \result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "confirmMatchingSwitch", \result)
  //@ ensures (inv(w) && canConfirmMatchingSwitch(w)) ==> stepRevealFollowsAGrant(w, "confirmMatchingSwitch", \result)
  return { ...w, config: ({ ...w.config, phase: "ConfigSaving" } as ConfigEditor) };
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveSwitchAnswer(w: Workspace): boolean {
  return w.config.phase === "ConfigSaving";
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function receiveSwitchAnswer(w: Workspace, accepted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveSwitchAnswer", \result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveSwitchAnswer", \result)
  //@ ensures (inv(w) && canReceiveSwitchAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveSwitchAnswer", \result)
  return { ...w, config: ({ ...w.config, phase: accepted ? "ConfigShown" : "ConfigFailed", saved: accepted, matchingOn: accepted ? !w.config.matchingOn : w.config.matchingOn } as ConfigEditor) };
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function alwaysConfigNeedsTheAnalystRole(w: Workspace): boolean {
  return !(w.config.phase !== "ConfigLoading") || w.staff.analyst;
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function stepSwitchChangesOnlyAfterSaving(before: Workspace, via: string, after: Workspace): boolean {
  return !(after.config.matchingOn !== before.config.matchingOn && via !== "receiveConfig" && via !== "receiveViewer") || (via === "receiveSwitchAnswer" && before.config.phase === "ConfigSaving");
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function alwaysSavedSwitchWasShown(w: Workspace): boolean {
  return !w.config.saved || (w.staff.admin && w.config.changeable);
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function sometimesSwitchSaved(w: Workspace): boolean {
  return w.config.saved;
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function sometimesSwitchRefused(w: Workspace): boolean {
  return w.config.phase === "ConfigFailed";
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function canPressMatchingSwitch(w: Workspace): boolean {
  return (w.config.phase === "ConfigShown" || w.config.phase === "ConfigFailed") && switchShown(w);
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function canConfirmMatchingSwitch(w: Workspace): boolean {
  return w.config.phase === "ConfigConfirming" && switchShown(w);
}

/** Story: Change the matching switch with a confirmation / The first press asks for a confirmation and the second press saves (spec/consoleWorkspace.md) */
//@ pure
export function alwaysSavingNeedsTheSwitch(w: Workspace): boolean {
  return !(w.config.phase === "ConfigConfirming" || w.config.phase === "ConfigSaving") || switchShown(w);
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function canLoadAudit(w: Workspace): boolean {
  return w.staff.admin && w.audit !== "AuditLoading";
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function loadAudit(w: Workspace): Workspace {
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> stepNewViewerClosesForms(w, "loadAudit", \result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "loadAudit", \result)
  //@ ensures (inv(w) && canLoadAudit(w)) ==> stepRevealFollowsAGrant(w, "loadAudit", \result)
  return { ...w, audit: "AuditLoading" };
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveAudit(w: Workspace): boolean {
  return w.audit === "AuditLoading";
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function receiveAudit(w: Workspace, loaded: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> stepNewViewerClosesForms(w, "receiveAudit", \result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveAudit", \result)
  //@ ensures (inv(w) && canReceiveAudit(w)) ==> stepRevealFollowsAGrant(w, "receiveAudit", \result)
  return { ...w, audit: loaded ? "AuditShown" : "AuditFailed" };
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function alwaysAuditLogNeedsAnAdmin(w: Workspace): boolean {
  return !(w.audit !== "AuditClosed") || w.staff.admin;
}

/** Story: Read the audit log as an admin / Only an admin loads the audit log (spec/consoleWorkspace.md) */
//@ pure
export function sometimesAuditShown(w: Workspace): boolean {
  return w.audit === "AuditShown";
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function proposalFormShown(pickCount: number): boolean {
  return pickCount >= minProposalPicks;
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function groupProposal(pickCount: number): boolean {
  return pickCount > minProposalPicks;
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function proposeAllowed(pickCount: number, minorPicked: boolean, sparksLeft: number, gameOver: boolean): boolean {
  return proposalFormShown(pickCount) && pickCount <= 6 && !minorPicked && sparksLeft > 0 && !gameOver;
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function lawAGroupShowsTheForm(pickCount: number): boolean {
  //@ ensures \result === true
  return !groupProposal(pickCount) || proposalFormShown(pickCount);
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function trayShown(staff: StaffView, pickCount: number): boolean {
  return staff.mode === "SimulatedWorld" && staff.simRole && pickCount > 0;
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function lawProposalNeedsTheForm(pickCount: number, minorPicked: boolean, sparksLeft: number, gameOver: boolean): boolean {
  //@ ensures \result === true
  return !proposeAllowed(pickCount, minorPicked, sparksLeft, gameOver) || proposalFormShown(pickCount);
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function lawMinorsAreNeverProposed(pickCount: number, sparksLeft: number, gameOver: boolean): boolean {
  //@ ensures \result === true
  return !proposeAllowed(pickCount, true, sparksLeft, gameOver);
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function canSubmitProposal(w: Workspace, pickCount: number, minorPicked: boolean, sparksLeft: number, gameOver: boolean): boolean {
  return w.tray !== "TraySending" && trayShown(w.staff, pickCount) && proposeAllowed(pickCount, minorPicked, sparksLeft, gameOver);
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function submitProposal(w: Workspace, pickCount: number, minorPicked: boolean, sparksLeft: number, gameOver: boolean): Workspace {
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> stepNewViewerClosesForms(w, "submitProposal", \result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> stepSwitchChangesOnlyAfterSaving(w, "submitProposal", \result)
  //@ ensures (inv(w) && canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)) ==> stepRevealFollowsAGrant(w, "submitProposal", \result)
  return { ...w, tray: "TraySending" };
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveProposalAnswer(w: Workspace): boolean {
  return w.tray === "TraySending";
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function receiveProposalAnswer(w: Workspace, accepted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveProposalAnswer", \result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveProposalAnswer", \result)
  //@ ensures (inv(w) && canReceiveProposalAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveProposalAnswer", \result)
  return { ...w, tray: accepted ? "TrayProposed" : "TrayIdle" };
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function alwaysTrayWorkIsSimulated(w: Workspace): boolean {
  return !(w.tray !== "TrayIdle") || (w.staff.mode === "SimulatedWorld" && w.staff.simRole);
}

/** Story: Play the simulated world / The propose tray sends a proposal for two to six adults with a spark left (spec/consoleWorkspace.md) */
//@ pure
export function sometimesProposed(w: Workspace): boolean {
  return w.tray === "TrayProposed";
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function worldMenuShown(staff: StaffView): boolean {
  return staff.mode === "SimulatedWorld" && staff.simRole;
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function canOpenWorldMenu(w: Workspace): boolean {
  return worldMenuShown(w.staff) && !w.worldMenuOpen;
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function openWorldMenu(w: Workspace): Workspace {
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> stepNewViewerClosesForms(w, "openWorldMenu", \result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "openWorldMenu", \result)
  //@ ensures (inv(w) && canOpenWorldMenu(w)) ==> stepRevealFollowsAGrant(w, "openWorldMenu", \result)
  return { ...w, worldMenuOpen: true };
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function canCloseWorldMenu(w: Workspace): boolean {
  return w.worldMenuOpen;
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function closeWorldMenu(w: Workspace): Workspace {
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> stepNewViewerClosesForms(w, "closeWorldMenu", \result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "closeWorldMenu", \result)
  //@ ensures (inv(w) && canCloseWorldMenu(w)) ==> stepRevealFollowsAGrant(w, "closeWorldMenu", \result)
  return { ...w, worldMenuOpen: false };
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function canSendWorldEvent(w: Workspace, worldEvent: WorldEvent): boolean {
  return w.worldMenuOpen && worldMenuShown(w.staff);
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function sendWorldEvent(w: Workspace, worldEvent: WorldEvent): Workspace {
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> stepNewViewerClosesForms(w, "sendWorldEvent", \result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> stepSwitchChangesOnlyAfterSaving(w, "sendWorldEvent", \result)
  //@ ensures (inv(w) && canSendWorldEvent(w, worldEvent)) ==> stepRevealFollowsAGrant(w, "sendWorldEvent", \result)
  return { ...w, worldMenuOpen: false, worldEventSent: true };
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function alwaysWorldMenuIsSimulated(w: Workspace): boolean {
  return !(w.worldMenuOpen || w.worldEventSent) || (w.staff.mode === "SimulatedWorld" && w.staff.simRole);
}

/** Story: Play the simulated world / The world menu exists only in the simulated world (spec/consoleWorkspace.md) */
//@ pure
export function sometimesWorldEventSent(w: Workspace): boolean {
  return w.worldEventSent;
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function revealOffered(staff: StaffView): boolean {
  return staff.safety && staff.mode !== "SimulatedWorld" && !staff.globalPii;
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canStartReveal(w: Workspace): boolean {
  return revealOffered(w.staff) && w.reveal.phase === "RevealHidden";
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function startReveal(w: Workspace): Workspace {
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> stepNewViewerClosesForms(w, "startReveal", \result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "startReveal", \result)
  //@ ensures (inv(w) && canStartReveal(w)) ==> stepRevealFollowsAGrant(w, "startReveal", \result)
  return { ...w, reveal: ({ phase: "RevealDrafting", reasonReady: false, minutes: maxRevealMinutes } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canTypeRevealReason(w: Workspace): boolean {
  return w.reveal.phase === "RevealDrafting";
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function typeRevealReason(w: Workspace, reasonChars: number): Workspace {
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> stepNewViewerClosesForms(w, "typeRevealReason", \result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "typeRevealReason", \result)
  //@ ensures (inv(w) && canTypeRevealReason(w)) ==> stepRevealFollowsAGrant(w, "typeRevealReason", \result)
  return { ...w, reveal: ({ ...w.reveal, reasonReady: reasonChars >= minReasonChars } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canChooseRevealMinutes(w: Workspace, minutes: number): boolean {
  return w.reveal.phase === "RevealDrafting" && revealMinuteChoices.includes(minutes);
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function chooseRevealMinutes(w: Workspace, minutes: number): Workspace {
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> stepNewViewerClosesForms(w, "chooseRevealMinutes", \result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> stepSwitchChangesOnlyAfterSaving(w, "chooseRevealMinutes", \result)
  //@ ensures (inv(w) && canChooseRevealMinutes(w, minutes)) ==> stepRevealFollowsAGrant(w, "chooseRevealMinutes", \result)
  return { ...w, reveal: ({ ...w.reveal, minutes: minutes } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canCancelReveal(w: Workspace): boolean {
  return w.reveal.phase === "RevealDrafting";
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function cancelReveal(w: Workspace): Workspace {
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> stepNewViewerClosesForms(w, "cancelReveal", \result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "cancelReveal", \result)
  //@ ensures (inv(w) && canCancelReveal(w)) ==> stepRevealFollowsAGrant(w, "cancelReveal", \result)
  return { ...w, reveal: ({ ...w.reveal, phase: "RevealHidden" } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canSubmitReveal(w: Workspace): boolean {
  return w.reveal.phase === "RevealDrafting" && w.reveal.reasonReady && revealOffered(w.staff);
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function submitReveal(w: Workspace): Workspace {
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> stepNewViewerClosesForms(w, "submitReveal", \result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "submitReveal", \result)
  //@ ensures (inv(w) && canSubmitReveal(w)) ==> stepRevealFollowsAGrant(w, "submitReveal", \result)
  return { ...w, reveal: ({ ...w.reveal, phase: "RevealSending" } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function canReceiveRevealAnswer(w: Workspace): boolean {
  return w.reveal.phase === "RevealSending";
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function receiveRevealAnswer(w: Workspace, granted: boolean): Workspace {
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> stepNewViewerClosesForms(w, "receiveRevealAnswer", \result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "receiveRevealAnswer", \result)
  //@ ensures (inv(w) && canReceiveRevealAnswer(w)) ==> stepRevealFollowsAGrant(w, "receiveRevealAnswer", \result)
  return { ...w, reveal: ({ ...w.reveal, phase: granted ? "RevealGranted" : "RevealDrafting" } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function alwaysRevealHasAReasonAndALimit(w: Workspace): boolean {
  return !(w.reveal.phase === "RevealSending" || w.reveal.phase === "RevealGranted") || (w.reveal.reasonReady && revealMinuteChoices.includes(w.reveal.minutes) && revealOffered(w.staff));
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function alwaysRevealLengthIsAChoice(w: Workspace): boolean {
  return revealMinuteChoices.includes(w.reveal.minutes);
}

/** Story: Reveal one member's private data with a logged reason / A reveal needs real data, the safety role and a reason (spec/consoleWorkspace.md) */
//@ pure
export function stepRevealFollowsAGrant(before: Workspace, via: string, after: Workspace): boolean {
  return !(after.reveal.phase === "RevealGranted" && before.reveal.phase !== "RevealGranted") || (via === "receiveRevealAnswer" && before.reveal.phase === "RevealSending");
}

/** Story: Reveal one member's private data with a logged reason / A reveal ends early on request or when its time passes (spec/consoleWorkspace.md) */
//@ pure
export function canEndReveal(w: Workspace): boolean {
  return w.reveal.phase === "RevealGranted";
}

/** Story: Reveal one member's private data with a logged reason / A reveal ends early on request or when its time passes (spec/consoleWorkspace.md) */
//@ pure
export function endReveal(w: Workspace): Workspace {
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> stepNewViewerClosesForms(w, "endReveal", \result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "endReveal", \result)
  //@ ensures (inv(w) && canEndReveal(w)) ==> stepRevealFollowsAGrant(w, "endReveal", \result)
  return { ...w, reveal: ({ ...w.reveal, phase: "RevealHidden" } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal ends early on request or when its time passes (spec/consoleWorkspace.md) */
//@ pure
export function canExpireReveal(w: Workspace): boolean {
  return w.reveal.phase === "RevealGranted";
}

/** Story: Reveal one member's private data with a logged reason / A reveal ends early on request or when its time passes (spec/consoleWorkspace.md) */
//@ pure
export function expireReveal(w: Workspace): Workspace {
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysSimulatedWorldShowsNoRealData(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysReleaseWasReleasable(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysHiddenMinorTextIsNeverReleased(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysCaseActionNeedsAnActingSafetyViewer(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysBanNeedsTheService(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysASentReportDecisionIsAllowed(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysReportDecisionNeedsANote(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysConfigNeedsTheAnalystRole(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysSavedSwitchWasShown(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysSavingNeedsTheSwitch(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysAuditLogNeedsAnAdmin(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysTrayWorkIsSimulated(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysWorldMenuIsSimulated(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysRevealHasAReasonAndALimit(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> alwaysRevealLengthIsAChoice(\result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> stepNewViewerClosesForms(w, "expireReveal", \result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> stepSwitchChangesOnlyAfterSaving(w, "expireReveal", \result)
  //@ ensures (inv(w) && canExpireReveal(w)) ==> stepRevealFollowsAGrant(w, "expireReveal", \result)
  return { ...w, reveal: ({ ...w.reveal, phase: "RevealHidden" } as RevealForm) };
}

/** Story: Reveal one member's private data with a logged reason / A reveal ends early on request or when its time passes (spec/consoleWorkspace.md) */
//@ pure
export function sometimesRevealGranted(w: Workspace): boolean {
  return w.reveal.phase === "RevealGranted";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Workspace, event: Event): boolean {
  if (event.type === "receiveViewer") return true;
  if (event.type === "receiveHeldText") return canReceiveHeldText(current);
  if (event.type === "typeHeldReason") return canTypeHeldReason(current);
  if (event.type === "markPhotoReviewed") return canMarkPhotoReviewed(current);
  if (event.type === "loadHeldPhoto") return canLoadHeldPhoto(current);
  if (event.type === "decideHeld") return canDecideHeld(current, event.choice);
  if (event.type === "receiveHeldAnswer") return canReceiveHeldAnswer(current);
  if (event.type === "receiveCase") return canReceiveCase(current);
  if (event.type === "toggleCaseRow") return canToggleCaseRow(current);
  if (event.type === "actOnCase") return canActOnCase(current, event.caseStep);
  if (event.type === "receiveCaseAnswer") return canReceiveCaseAnswer(current);
  if (event.type === "receiveReport") return canReceiveReport(current);
  if (event.type === "typeReportNote") return canTypeReportNote(current);
  if (event.type === "actOnReport") return canActOnReport(current, event.reportStep);
  if (event.type === "receiveReportAnswer") return canReceiveReportAnswer(current);
  if (event.type === "chooseRequestSegment") return true;
  if (event.type === "receiveConfig") return canReceiveConfig(current);
  if (event.type === "pressMatchingSwitch") return canPressMatchingSwitch(current);
  if (event.type === "endConfirmation") return canEndConfirmation(current);
  if (event.type === "confirmMatchingSwitch") return canConfirmMatchingSwitch(current);
  if (event.type === "receiveSwitchAnswer") return canReceiveSwitchAnswer(current);
  if (event.type === "loadAudit") return canLoadAudit(current);
  if (event.type === "receiveAudit") return canReceiveAudit(current);
  if (event.type === "submitProposal") return canSubmitProposal(current, event.pickCount, event.minorPicked, event.sparksLeft, event.gameOver);
  if (event.type === "receiveProposalAnswer") return canReceiveProposalAnswer(current);
  if (event.type === "openWorldMenu") return canOpenWorldMenu(current);
  if (event.type === "closeWorldMenu") return canCloseWorldMenu(current);
  if (event.type === "sendWorldEvent") return canSendWorldEvent(current, event.worldEvent);
  if (event.type === "startReveal") return canStartReveal(current);
  if (event.type === "typeRevealReason") return canTypeRevealReason(current);
  if (event.type === "chooseRevealMinutes") return canChooseRevealMinutes(current, event.minutes);
  if (event.type === "cancelReveal") return canCancelReveal(current);
  if (event.type === "submitReveal") return canSubmitReveal(current);
  if (event.type === "receiveRevealAnswer") return canReceiveRevealAnswer(current);
  if (event.type === "endReveal") return canEndReveal(current);
  if (event.type === "expireReveal") return canExpireReveal(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Workspace, event: Event): Workspace {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "receiveViewer") return receiveViewer(current, event.viewMode, event.safetyRole, event.adminRole, event.analystRole, event.simRoleHeld, event.globalPiiShown);
  if (event.type === "receiveHeldText") return canReceiveHeldText(current) ? receiveHeldText(current, event.photoItem, event.minorItem) : current;
  if (event.type === "typeHeldReason") return canTypeHeldReason(current) ? typeHeldReason(current, event.reasonChars) : current;
  if (event.type === "markPhotoReviewed") return canMarkPhotoReviewed(current) ? markPhotoReviewed(current, event.reviewed) : current;
  if (event.type === "loadHeldPhoto") return canLoadHeldPhoto(current) ? loadHeldPhoto(current, event.loaded) : current;
  if (event.type === "decideHeld") return canDecideHeld(current, event.choice) ? decideHeld(current, event.choice) : current;
  if (event.type === "receiveHeldAnswer") return canReceiveHeldAnswer(current) ? receiveHeldAnswer(current, event.accepted) : current;
  if (event.type === "receiveCase") return canReceiveCase(current) ? receiveCase(current, event.heldCase) : current;
  if (event.type === "toggleCaseRow") return canToggleCaseRow(current) ? toggleCaseRow(current) : current;
  if (event.type === "actOnCase") return canActOnCase(current, event.caseStep) ? actOnCase(current, event.caseStep) : current;
  if (event.type === "receiveCaseAnswer") return canReceiveCaseAnswer(current) ? receiveCaseAnswer(current, event.accepted) : current;
  if (event.type === "receiveReport") return canReceiveReport(current) ? receiveReport(current, event.minorKind) : current;
  if (event.type === "typeReportNote") return canTypeReportNote(current) ? typeReportNote(current, event.noteChars) : current;
  if (event.type === "actOnReport") return canActOnReport(current, event.reportStep) ? actOnReport(current, event.reportStep) : current;
  if (event.type === "receiveReportAnswer") return canReceiveReportAnswer(current) ? receiveReportAnswer(current, event.accepted) : current;
  if (event.type === "chooseRequestSegment") return chooseRequestSegment(current, event.segment);
  if (event.type === "receiveConfig") return canReceiveConfig(current) ? receiveConfig(current, event.matchingEnabled, event.locked, event.canChange) : current;
  if (event.type === "pressMatchingSwitch") return canPressMatchingSwitch(current) ? pressMatchingSwitch(current) : current;
  if (event.type === "endConfirmation") return canEndConfirmation(current) ? endConfirmation(current) : current;
  if (event.type === "confirmMatchingSwitch") return canConfirmMatchingSwitch(current) ? confirmMatchingSwitch(current) : current;
  if (event.type === "receiveSwitchAnswer") return canReceiveSwitchAnswer(current) ? receiveSwitchAnswer(current, event.accepted) : current;
  if (event.type === "loadAudit") return canLoadAudit(current) ? loadAudit(current) : current;
  if (event.type === "receiveAudit") return canReceiveAudit(current) ? receiveAudit(current, event.loaded) : current;
  if (event.type === "submitProposal") return canSubmitProposal(current, event.pickCount, event.minorPicked, event.sparksLeft, event.gameOver) ? submitProposal(current, event.pickCount, event.minorPicked, event.sparksLeft, event.gameOver) : current;
  if (event.type === "receiveProposalAnswer") return canReceiveProposalAnswer(current) ? receiveProposalAnswer(current, event.accepted) : current;
  if (event.type === "openWorldMenu") return canOpenWorldMenu(current) ? openWorldMenu(current) : current;
  if (event.type === "closeWorldMenu") return canCloseWorldMenu(current) ? closeWorldMenu(current) : current;
  if (event.type === "sendWorldEvent") return canSendWorldEvent(current, event.worldEvent) ? sendWorldEvent(current, event.worldEvent) : current;
  if (event.type === "startReveal") return canStartReveal(current) ? startReveal(current) : current;
  if (event.type === "typeRevealReason") return canTypeRevealReason(current) ? typeRevealReason(current, event.reasonChars) : current;
  if (event.type === "chooseRevealMinutes") return canChooseRevealMinutes(current, event.minutes) ? chooseRevealMinutes(current, event.minutes) : current;
  if (event.type === "cancelReveal") return canCancelReveal(current) ? cancelReveal(current) : current;
  if (event.type === "submitReveal") return canSubmitReveal(current) ? submitReveal(current) : current;
  if (event.type === "receiveRevealAnswer") return canReceiveRevealAnswer(current) ? receiveRevealAnswer(current, event.granted) : current;
  if (event.type === "endReveal") return canEndReveal(current) ? endReveal(current) : current;
  if (event.type === "expireReveal") return canExpireReveal(current) ? expireReveal(current) : current;
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
  if (raw.type === "receiveViewer" && (raw.viewMode === "SimulatedWorld" || raw.viewMode === "RealWithService" || raw.viewMode === "RealWithoutService") && typeof raw.safetyRole === "boolean" && typeof raw.adminRole === "boolean" && typeof raw.analystRole === "boolean" && typeof raw.simRoleHeld === "boolean" && typeof raw.globalPiiShown === "boolean") return { type: "receiveViewer", viewMode: raw.viewMode, safetyRole: raw.safetyRole, adminRole: raw.adminRole, analystRole: raw.analystRole, simRoleHeld: raw.simRoleHeld, globalPiiShown: raw.globalPiiShown };
  if (raw.type === "receiveHeldText" && typeof raw.photoItem === "boolean" && typeof raw.minorItem === "boolean") return { type: "receiveHeldText", photoItem: raw.photoItem, minorItem: raw.minorItem };
  if (raw.type === "typeHeldReason" && Number.isSafeInteger(raw.reasonChars)) return { type: "typeHeldReason", reasonChars: raw.reasonChars };
  if (raw.type === "markPhotoReviewed" && typeof raw.reviewed === "boolean") return { type: "markPhotoReviewed", reviewed: raw.reviewed };
  if (raw.type === "loadHeldPhoto" && typeof raw.loaded === "boolean") return { type: "loadHeldPhoto", loaded: raw.loaded };
  if (raw.type === "decideHeld" && (raw.choice === "ReleaseHeld" || raw.choice === "RejectHeld")) return { type: "decideHeld", choice: raw.choice };
  if (raw.type === "receiveHeldAnswer" && typeof raw.accepted === "boolean") return { type: "receiveHeldAnswer", accepted: raw.accepted };
  if (raw.type === "receiveCase" && typeof raw.heldCase === "boolean") return { type: "receiveCase", heldCase: raw.heldCase };
  if (raw.type === "toggleCaseRow") return { type: "toggleCaseRow" };
  if (raw.type === "actOnCase" && (raw.caseStep === "LiftStep" || raw.caseStep === "CloseStep")) return { type: "actOnCase", caseStep: raw.caseStep };
  if (raw.type === "receiveCaseAnswer" && typeof raw.accepted === "boolean") return { type: "receiveCaseAnswer", accepted: raw.accepted };
  if (raw.type === "receiveReport" && typeof raw.minorKind === "boolean") return { type: "receiveReport", minorKind: raw.minorKind };
  if (raw.type === "typeReportNote" && Number.isSafeInteger(raw.noteChars)) return { type: "typeReportNote", noteChars: raw.noteChars };
  if (raw.type === "actOnReport" && (raw.reportStep === "HoldPersonStep" || raw.reportStep === "BanPhoneStep" || raw.reportStep === "BanPersonStep" || raw.reportStep === "DismissStep" || raw.reportStep === "ClearMinorStep")) return { type: "actOnReport", reportStep: raw.reportStep };
  if (raw.type === "receiveReportAnswer" && typeof raw.accepted === "boolean") return { type: "receiveReportAnswer", accepted: raw.accepted };
  if (raw.type === "chooseRequestSegment" && (raw.segment === "OpenSegment" || raw.segment === "FulfilledSegment" || raw.segment === "NoneSegment" || raw.segment === "AnsweredSegment" || raw.segment === "AllSegment")) return { type: "chooseRequestSegment", segment: raw.segment };
  if (raw.type === "receiveConfig" && typeof raw.matchingEnabled === "boolean" && typeof raw.locked === "boolean" && typeof raw.canChange === "boolean") return { type: "receiveConfig", matchingEnabled: raw.matchingEnabled, locked: raw.locked, canChange: raw.canChange };
  if (raw.type === "pressMatchingSwitch") return { type: "pressMatchingSwitch" };
  if (raw.type === "endConfirmation") return { type: "endConfirmation" };
  if (raw.type === "confirmMatchingSwitch") return { type: "confirmMatchingSwitch" };
  if (raw.type === "receiveSwitchAnswer" && typeof raw.accepted === "boolean") return { type: "receiveSwitchAnswer", accepted: raw.accepted };
  if (raw.type === "loadAudit") return { type: "loadAudit" };
  if (raw.type === "receiveAudit" && typeof raw.loaded === "boolean") return { type: "receiveAudit", loaded: raw.loaded };
  if (raw.type === "submitProposal" && Number.isSafeInteger(raw.pickCount) && typeof raw.minorPicked === "boolean" && Number.isSafeInteger(raw.sparksLeft) && typeof raw.gameOver === "boolean") return { type: "submitProposal", pickCount: raw.pickCount, minorPicked: raw.minorPicked, sparksLeft: raw.sparksLeft, gameOver: raw.gameOver };
  if (raw.type === "receiveProposalAnswer" && typeof raw.accepted === "boolean") return { type: "receiveProposalAnswer", accepted: raw.accepted };
  if (raw.type === "openWorldMenu") return { type: "openWorldMenu" };
  if (raw.type === "closeWorldMenu") return { type: "closeWorldMenu" };
  if (raw.type === "sendWorldEvent" && (raw.worldEvent === "GoSilent" || raw.worldEvent === "ForceFlake" || raw.worldEvent === "TextStop")) return { type: "sendWorldEvent", worldEvent: raw.worldEvent };
  if (raw.type === "startReveal") return { type: "startReveal" };
  if (raw.type === "typeRevealReason" && Number.isSafeInteger(raw.reasonChars)) return { type: "typeRevealReason", reasonChars: raw.reasonChars };
  if (raw.type === "chooseRevealMinutes" && Number.isSafeInteger(raw.minutes)) return { type: "chooseRevealMinutes", minutes: raw.minutes };
  if (raw.type === "cancelReveal") return { type: "cancelReveal" };
  if (raw.type === "submitReveal") return { type: "submitReveal" };
  if (raw.type === "receiveRevealAnswer" && typeof raw.granted === "boolean") return { type: "receiveRevealAnswer", granted: raw.granted };
  if (raw.type === "endReveal") return { type: "endReveal" };
  if (raw.type === "expireReveal") return { type: "expireReveal" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Workspace | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.staff === "object" && raw.staff !== null && !Array.isArray(raw.staff) && (raw.staff.mode === "RealWithoutService" || raw.staff.mode === "SimulatedWorld" || raw.staff.mode === "RealWithService") && typeof raw.staff.safety === "boolean" && typeof raw.staff.admin === "boolean" && typeof raw.staff.analyst === "boolean" && typeof raw.staff.simRole === "boolean" && typeof raw.staff.globalPii === "boolean" && Object.keys(raw.staff).length === 6 && typeof raw.held === "object" && raw.held !== null && !Array.isArray(raw.held) && (raw.held.status === "HeldEmpty" || raw.held.status === "HeldWaiting" || raw.held.status === "HeldSending" || raw.held.status === "HeldReleased" || raw.held.status === "HeldRejected") && (raw.held.choice === "RejectHeld" || raw.held.choice === "ReleaseHeld") && typeof raw.held.photo === "boolean" && typeof raw.held.minorHidden === "boolean" && typeof raw.held.reasonReady === "boolean" && typeof raw.held.photoLoaded === "boolean" && typeof raw.held.photoReviewed === "boolean" && Object.keys(raw.held).length === 7 && typeof raw.caseRow === "object" && raw.caseRow !== null && !Array.isArray(raw.caseRow) && (raw.caseRow.status === "CaseRowEmpty" || raw.caseRow.status === "CaseRowOpen" || raw.caseRow.status === "CaseRowClosed") && typeof raw.caseRow.onHold === "boolean" && typeof raw.caseRow.expanded === "boolean" && typeof raw.caseRow.caseSending === "boolean" && (raw.caseRow.caseStep === "CloseStep" || raw.caseRow.caseStep === "LiftStep") && Object.keys(raw.caseRow).length === 5 && typeof raw.report === "object" && raw.report !== null && !Array.isArray(raw.report) && typeof raw.report.present === "boolean" && (raw.report.status === "ReportOpen" || raw.report.status === "ReportHeld" || raw.report.status === "ReportBanned" || raw.report.status === "ReportDismissed") && typeof raw.report.minorReport === "boolean" && typeof raw.report.noteReady === "boolean" && typeof raw.report.reportSending === "boolean" && (raw.report.reportStep === "DismissStep" || raw.report.reportStep === "HoldPersonStep" || raw.report.reportStep === "BanPhoneStep" || raw.report.reportStep === "BanPersonStep" || raw.report.reportStep === "ClearMinorStep") && Object.keys(raw.report).length === 6 && (raw.requestSegment === "OpenSegment" || raw.requestSegment === "FulfilledSegment" || raw.requestSegment === "NoneSegment" || raw.requestSegment === "AnsweredSegment" || raw.requestSegment === "AllSegment") && typeof raw.config === "object" && raw.config !== null && !Array.isArray(raw.config) && (raw.config.phase === "ConfigLoading" || raw.config.phase === "ConfigShown" || raw.config.phase === "ConfigConfirming" || raw.config.phase === "ConfigSaving" || raw.config.phase === "ConfigFailed") && typeof raw.config.matchingOn === "boolean" && typeof raw.config.packLocked === "boolean" && typeof raw.config.changeable === "boolean" && typeof raw.config.saved === "boolean" && Object.keys(raw.config).length === 5 && (raw.audit === "AuditClosed" || raw.audit === "AuditLoading" || raw.audit === "AuditShown" || raw.audit === "AuditFailed") && (raw.tray === "TrayIdle" || raw.tray === "TraySending" || raw.tray === "TrayProposed") && typeof raw.worldMenuOpen === "boolean" && typeof raw.worldEventSent === "boolean" && typeof raw.reveal === "object" && raw.reveal !== null && !Array.isArray(raw.reveal) && (raw.reveal.phase === "RevealHidden" || raw.reveal.phase === "RevealDrafting" || raw.reveal.phase === "RevealSending" || raw.reveal.phase === "RevealGranted") && typeof raw.reveal.reasonReady === "boolean" && Number.isSafeInteger(raw.reveal.minutes) && Object.keys(raw.reveal).length === 3 && Object.keys(raw).length === 11)) return undefined;
  const parsed: Workspace = ({ staff: ({ mode: raw.staff.mode, safety: raw.staff.safety, admin: raw.staff.admin, analyst: raw.staff.analyst, simRole: raw.staff.simRole, globalPii: raw.staff.globalPii }), held: ({ status: raw.held.status, choice: raw.held.choice, photo: raw.held.photo, minorHidden: raw.held.minorHidden, reasonReady: raw.held.reasonReady, photoLoaded: raw.held.photoLoaded, photoReviewed: raw.held.photoReviewed }), caseRow: ({ status: raw.caseRow.status, onHold: raw.caseRow.onHold, expanded: raw.caseRow.expanded, caseSending: raw.caseRow.caseSending, caseStep: raw.caseRow.caseStep }), report: ({ present: raw.report.present, status: raw.report.status, minorReport: raw.report.minorReport, noteReady: raw.report.noteReady, reportSending: raw.report.reportSending, reportStep: raw.report.reportStep }), requestSegment: raw.requestSegment, config: ({ phase: raw.config.phase, matchingOn: raw.config.matchingOn, packLocked: raw.config.packLocked, changeable: raw.config.changeable, saved: raw.config.saved }), audit: raw.audit, tray: raw.tray, worldMenuOpen: raw.worldMenuOpen, worldEventSent: raw.worldEventSent, reveal: ({ phase: raw.reveal.phase, reasonReady: raw.reveal.reasonReady, minutes: raw.reveal.minutes }) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Workspace {
  //@ ensures inv(\result)
  return initial;
}
