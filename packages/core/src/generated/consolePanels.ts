// GENERATED from spec/consolePanels.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type ReportStep as consoleWorkspace_ReportStep, type RequestSegment as consoleWorkspace_RequestSegment, type ConfigPhase as consoleWorkspace_ConfigPhase, type RequestOutcome as consoleWorkspace_RequestOutcome, type ConfigControl as consoleWorkspace_ConfigControl, type AuditPhase as consoleWorkspace_AuditPhase, type TrayPhase as consoleWorkspace_TrayPhase, type RevealPhase as consoleWorkspace_RevealPhase, type WorldEvent as consoleWorkspace_WorldEvent, type HeldStatus as consoleWorkspace_HeldStatus, type WorkMode as consoleWorkspace_WorkMode, type WorkPanel as consoleWorkspace_WorkPanel, type HeldChoice as consoleWorkspace_HeldChoice, type PanelAnswer as consoleWorkspace_PanelAnswer, type PanelView as consoleWorkspace_PanelView, type CaseRowStatus as consoleWorkspace_CaseRowStatus, type CaseStep as consoleWorkspace_CaseStep, type CaseRow as consoleWorkspace_CaseRow, type ConfigEditor as consoleWorkspace_ConfigEditor, type StaffView as consoleWorkspace_StaffView, type RevealForm as consoleWorkspace_RevealForm, type HeldRow as consoleWorkspace_HeldRow, type ReportRow as consoleWorkspace_ReportRow, type Workspace as consoleWorkspace_Workspace, minProposalPicks as consoleWorkspace_minProposalPicks, minReasonChars as consoleWorkspace_minReasonChars, maxRevealMinutes as consoleWorkspace_maxRevealMinutes, revealMinuteChoices as consoleWorkspace_revealMinuteChoices, proposalFormShown as consoleWorkspace_proposalFormShown, groupProposal as consoleWorkspace_groupProposal, heldReleasable as consoleWorkspace_heldReleasable, reportStepAllowed as consoleWorkspace_reportStepAllowed, reportDecision as consoleWorkspace_reportDecision, requestShown as consoleWorkspace_requestShown, configControl as consoleWorkspace_configControl, proposeAllowed as consoleWorkspace_proposeAllowed, lawAGroupShowsTheForm as consoleWorkspace_lawAGroupShowsTheForm, trayShown as consoleWorkspace_trayShown, worldMenuShown as consoleWorkspace_worldMenuShown, revealOffered as consoleWorkspace_revealOffered, staffActs as consoleWorkspace_staffActs, panelView as consoleWorkspace_panelView, panelAllowed as consoleWorkspace_panelAllowed, reportOutcome as consoleWorkspace_reportOutcome, lawClearMinorNeedsAMinorReport as consoleWorkspace_lawClearMinorNeedsAMinorReport, lawReadOnlyDataTakesNoReportDecision as consoleWorkspace_lawReadOnlyDataTakesNoReportDecision, lawEveryOutcomeHasASegment as consoleWorkspace_lawEveryOutcomeHasASegment, lawAllShowsEveryOutcome as consoleWorkspace_lawAllShowsEveryOutcome, lawOnlyAdminsGetTheSwitch as consoleWorkspace_lawOnlyAdminsGetTheSwitch, lawProposalNeedsTheForm as consoleWorkspace_lawProposalNeedsTheForm, lawMinorsAreNeverProposed as consoleWorkspace_lawMinorsAreNeverProposed, lawRefusedPanelShowsNoRows as consoleWorkspace_lawRefusedPanelShowsNoRows, lawRowsNeedAnAnswer as consoleWorkspace_lawRowsNeedAnAnswer, lawAuditLogIsAdminOnly as consoleWorkspace_lawAuditLogIsAdminOnly, markPhotoReviewed as consoleWorkspace_markPhotoReviewed, canDecideHeld as consoleWorkspace_canDecideHeld, decideHeld as consoleWorkspace_decideHeld, canReceiveHeldAnswer as consoleWorkspace_canReceiveHeldAnswer, receiveHeldAnswer as consoleWorkspace_receiveHeldAnswer, alwaysReleaseWasReleasable as consoleWorkspace_alwaysReleaseWasReleasable, alwaysHiddenMinorTextIsNeverReleased as consoleWorkspace_alwaysHiddenMinorTextIsNeverReleased, sometimesHeldTextReleased as consoleWorkspace_sometimesHeldTextReleased, sometimesHeldPhotoReleased as consoleWorkspace_sometimesHeldPhotoReleased, sometimesHeldTextRejected as consoleWorkspace_sometimesHeldTextRejected, canReceiveCase as consoleWorkspace_canReceiveCase, receiveCase as consoleWorkspace_receiveCase, canToggleCaseRow as consoleWorkspace_canToggleCaseRow, toggleCaseRow as consoleWorkspace_toggleCaseRow, canActOnCase as consoleWorkspace_canActOnCase, actOnCase as consoleWorkspace_actOnCase, canReceiveCaseAnswer as consoleWorkspace_canReceiveCaseAnswer, receiveCaseAnswer as consoleWorkspace_receiveCaseAnswer, alwaysCaseActionNeedsAnActingSafetyViewer as consoleWorkspace_alwaysCaseActionNeedsAnActingSafetyViewer, sometimesCaseClosed as consoleWorkspace_sometimesCaseClosed, sometimesHoldLifted as consoleWorkspace_sometimesHoldLifted, canReceiveReport as consoleWorkspace_canReceiveReport, receiveReport as consoleWorkspace_receiveReport, reportOpen as consoleWorkspace_reportOpen, typeReportNote as consoleWorkspace_typeReportNote, actOnReport as consoleWorkspace_actOnReport, canReceiveReportAnswer as consoleWorkspace_canReceiveReportAnswer, receiveReportAnswer as consoleWorkspace_receiveReportAnswer, alwaysBanNeedsTheService as consoleWorkspace_alwaysBanNeedsTheService, alwaysASentReportDecisionIsAllowed as consoleWorkspace_alwaysASentReportDecisionIsAllowed, alwaysReportDecisionNeedsANote as consoleWorkspace_alwaysReportDecisionNeedsANote, lawEveryReportStepLeavesTheOpenStatus as consoleWorkspace_lawEveryReportStepLeavesTheOpenStatus, sometimesReportBanned as consoleWorkspace_sometimesReportBanned, sometimesReportHeld as consoleWorkspace_sometimesReportHeld, sometimesReportDismissed as consoleWorkspace_sometimesReportDismissed, chooseRequestSegment as consoleWorkspace_chooseRequestSegment, sometimesAllRequests as consoleWorkspace_sometimesAllRequests, switchShown as consoleWorkspace_switchShown, canReceiveConfig as consoleWorkspace_canReceiveConfig, receiveConfig as consoleWorkspace_receiveConfig, pressMatchingSwitch as consoleWorkspace_pressMatchingSwitch, canEndConfirmation as consoleWorkspace_canEndConfirmation, endConfirmation as consoleWorkspace_endConfirmation, confirmMatchingSwitch as consoleWorkspace_confirmMatchingSwitch, canReceiveSwitchAnswer as consoleWorkspace_canReceiveSwitchAnswer, receiveSwitchAnswer as consoleWorkspace_receiveSwitchAnswer, alwaysConfigNeedsTheAnalystRole as consoleWorkspace_alwaysConfigNeedsTheAnalystRole, stepSwitchChangesOnlyAfterSaving as consoleWorkspace_stepSwitchChangesOnlyAfterSaving, alwaysSavedSwitchWasShown as consoleWorkspace_alwaysSavedSwitchWasShown, sometimesSwitchSaved as consoleWorkspace_sometimesSwitchSaved, sometimesSwitchRefused as consoleWorkspace_sometimesSwitchRefused, canLoadAudit as consoleWorkspace_canLoadAudit, loadAudit as consoleWorkspace_loadAudit, canReceiveAudit as consoleWorkspace_canReceiveAudit, receiveAudit as consoleWorkspace_receiveAudit, alwaysAuditLogNeedsAnAdmin as consoleWorkspace_alwaysAuditLogNeedsAnAdmin, sometimesAuditShown as consoleWorkspace_sometimesAuditShown, canSubmitProposal as consoleWorkspace_canSubmitProposal, submitProposal as consoleWorkspace_submitProposal, canReceiveProposalAnswer as consoleWorkspace_canReceiveProposalAnswer, receiveProposalAnswer as consoleWorkspace_receiveProposalAnswer, alwaysTrayWorkIsSimulated as consoleWorkspace_alwaysTrayWorkIsSimulated, sometimesProposed as consoleWorkspace_sometimesProposed, canOpenWorldMenu as consoleWorkspace_canOpenWorldMenu, openWorldMenu as consoleWorkspace_openWorldMenu, canCloseWorldMenu as consoleWorkspace_canCloseWorldMenu, closeWorldMenu as consoleWorkspace_closeWorldMenu, canSendWorldEvent as consoleWorkspace_canSendWorldEvent, sendWorldEvent as consoleWorkspace_sendWorldEvent, alwaysWorldMenuIsSimulated as consoleWorkspace_alwaysWorldMenuIsSimulated, sometimesWorldEventSent as consoleWorkspace_sometimesWorldEventSent, canStartReveal as consoleWorkspace_canStartReveal, startReveal as consoleWorkspace_startReveal, canTypeRevealReason as consoleWorkspace_canTypeRevealReason, typeRevealReason as consoleWorkspace_typeRevealReason, canChooseRevealMinutes as consoleWorkspace_canChooseRevealMinutes, chooseRevealMinutes as consoleWorkspace_chooseRevealMinutes, canCancelReveal as consoleWorkspace_canCancelReveal, cancelReveal as consoleWorkspace_cancelReveal, canSubmitReveal as consoleWorkspace_canSubmitReveal, submitReveal as consoleWorkspace_submitReveal, canReceiveRevealAnswer as consoleWorkspace_canReceiveRevealAnswer, receiveRevealAnswer as consoleWorkspace_receiveRevealAnswer, alwaysRevealHasAReasonAndALimit as consoleWorkspace_alwaysRevealHasAReasonAndALimit, alwaysRevealLengthIsAChoice as consoleWorkspace_alwaysRevealLengthIsAChoice, stepRevealFollowsAGrant as consoleWorkspace_stepRevealFollowsAGrant, canEndReveal as consoleWorkspace_canEndReveal, endReveal as consoleWorkspace_endReveal, canExpireReveal as consoleWorkspace_canExpireReveal, expireReveal as consoleWorkspace_expireReveal, sometimesRevealGranted as consoleWorkspace_sometimesRevealGranted, initial as consoleWorkspace_initial, alwaysAdminHoldsEveryRole as consoleWorkspace_alwaysAdminHoldsEveryRole, alwaysSimulatedWorldShowsNoRealData as consoleWorkspace_alwaysSimulatedWorldShowsNoRealData, stepNewViewerClosesForms as consoleWorkspace_stepNewViewerClosesForms, canReceiveHeldText as consoleWorkspace_canReceiveHeldText, receiveHeldText as consoleWorkspace_receiveHeldText, canTypeHeldReason as consoleWorkspace_canTypeHeldReason, typeHeldReason as consoleWorkspace_typeHeldReason, canLoadHeldPhoto as consoleWorkspace_canLoadHeldPhoto, loadHeldPhoto as consoleWorkspace_loadHeldPhoto, canMarkPhotoReviewed as consoleWorkspace_canMarkPhotoReviewed, canTypeReportNote as consoleWorkspace_canTypeReportNote, canActOnReport as consoleWorkspace_canActOnReport, canPressMatchingSwitch as consoleWorkspace_canPressMatchingSwitch, canConfirmMatchingSwitch as consoleWorkspace_canConfirmMatchingSwitch, alwaysSavingNeedsTheSwitch as consoleWorkspace_alwaysSavingNeedsTheSwitch, receiveViewer as consoleWorkspace_receiveViewer } from "./consoleWorkspace.ts";
import { type StaffActionResult as safetyCase_StaffActionResult, type ReportPhase as safetyCase_ReportPhase, type ReportDecision as safetyCase_ReportDecision, type SharedReportRoute as safetyCase_SharedReportRoute, type CasePhase as safetyCase_CasePhase, type SafetyCase as safetyCase_SafetyCase } from "./safetyCase.ts";

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export interface GamePanel { present: boolean; over: boolean; levelPlaying: boolean; resetSent: boolean; levelChecked: boolean }
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export type LabPhase = "LabWaiting" | "LabOff" | "LabReady" | "LabStarting" | "LabStartRefused";
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export type PanelMode = "SimulatedPanels" | "RealActing" | "RealReadOnly";
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export type DiffPhase = "NoDiff" | "DiffLoading" | "DiffShown" | "DiffFailed";
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export type FeedSegment = "AllEvents" | "PeopleEvents" | "SafetyEvents" | "SystemEvents" | "MineEvents";
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export interface PanelStaff { mode: PanelMode; analyst: boolean; admin: boolean; simRole: boolean; realOnlyServer: boolean }
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export interface LabState { phase: LabPhase; runCount: number; activeRuns: boolean }
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export interface RunCompare { runTotal: number; comparing: boolean; picked: number; diff: DiffPhase }
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export interface ConsolePanels { staff: PanelStaff; lab: LabState; runs: RunCompare; feedSegment: FeedSegment; game: GamePanel }
/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
export type LabBody = "LabOffView" | "LabEmptyView" | "LabRunsView";
/** Story: Run simulation experiments in the lab / A lab result marks each safety count (spec/consolePanels.md) */
export type CountMark = "CountUnknown" | "CountZero" | "CountAlarm";
/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
export type RunsView = "NoRunsView" | "RunDetailView" | "PickTwoView" | "DiffLoadingView" | "DiffShownView" | "DiffFailedView";
/** Story: Read the health numbers of an app / The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data (spec/consolePanels.md) */
export type MetricsSection = "TruthSection" | "BiasSection" | "CostSection";
/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
export type BiasSummary = "NoGroupBelowNote" | "GroupsBelowAlert";
/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
export type BudgetMark = "BudgetOk" | "BudgetNear" | "BudgetOver";
/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
export type ShareMark = "ShareUnknown" | "ShareMet" | "ShareBelow";
/** Story: Follow events in the feed and the pipeline / The feed segments group the event kinds (spec/consolePanels.md) */
export type EventGroup = "JoinGroup" | "PeopleGroup" | "SafetyGroup" | "SystemGroup" | "OtherGroup";
/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
export type FeedNote = "PressPlayNote" | "NoEventsInRangeNote" | "NothingMatchesNote";
/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
export type StateFilter = "AnyState" | "ReviewStates" | "OpenStates" | "MetStates" | "ClosedStates";
/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
export type PipelineColumn = "ReviewColumn" | "OpenColumn" | "MetColumn" | "ClosedColumn";
/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
export type LadderView = "NoLadder" | "StubLadderNote" | "ConsentLadder";
/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
export type GameView = "NoGameView" | "GamePlayingView" | "GameOverView";

/** One variant per transition in the spec. */
export type Event =
  | { type: "receiveViewer"; viewMode: PanelMode; analystRole: boolean; adminRole: boolean; simRoleHeld: boolean; realOnly: boolean }
  | { type: "receiveLab"; labOn: boolean; runCount: number; activeRuns: boolean }
  | { type: "startLab"; armCount: number; seedCount: number; days: number }
  | { type: "receiveLabStart"; accepted: boolean }
  | { type: "receiveRuns"; runTotal: number }
  | { type: "toggleCompare" }
  | { type: "pickRun"; alreadyPicked: boolean }
  | { type: "receiveDiff"; loaded: boolean }
  | { type: "chooseFeedSegment"; segment: FeedSegment }
  | { type: "receiveGame"; present: boolean; over: boolean; levelPlaying: boolean }
  | { type: "resetWorld"; chooseLevel: boolean }
  | { type: "checkLevel" };

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
export const maxRunPicks: number = 2;
/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
export const biasAlertBelow: number = 80;
/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
export const maxProactiveHundredths: number = 200;
/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
export const inviterTargetPercent: number = 30;
/** Story: Read the health numbers of an app / Confirmed proactive delivery contributes to the staff rate (spec/consolePanels.md) */
export const confirmedProactiveDeliveryStatuses: string[] = ["delivered", "read"];
/** Story: Follow events in the feed and the pipeline / The feed segments group the event kinds (spec/consolePanels.md) */
export const joinsHiddenFrom: number = 60;
/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
export const maxLabArms: number = 3;
/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
export const maxLabSeeds: number = 5;
/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
export const maxLabDays: number = 60;
/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
export const initial: ConsolePanels = { staff: ({ mode: "RealReadOnly", analyst: false, admin: false, simRole: false, realOnlyServer: false } as PanelStaff), lab: ({ phase: "LabWaiting", runCount: 0, activeRuns: false } as LabState), runs: ({ runTotal: 0, comparing: false, picked: 0, diff: "NoDiff" } as RunCompare), feedSegment: "AllEvents", game: ({ present: false, over: false, levelPlaying: false, resetSent: false, levelChecked: false } as GamePanel) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ConsolePanels): boolean {
  return alwaysAdminHoldsAnalystAndSimRole(current) && alwaysRealOnlyServerShowsRealData(current) && alwaysLabNeedsTheAnalystRole(current) && alwaysActiveRunsAreRuns(current) && alwaysRunCountIsNeverNegative(current) && alwaysLabStartIsSimulated(current) && alwaysPicksAreAtMostTwo(current) && alwaysCompareNeedsTwoRuns(current) && alwaysPicksNeedCompare(current) && alwaysDiffNeedsTwoPicks(current) && alwaysMineSegmentIsSimulated(current) && alwaysGameWorkIsSimulated(current) && alwaysResetNeedsAnAdmin(current) && alwaysLevelCheckNeedsALevel(current);
}

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
//@ pure
export function canReceiveViewer(p: ConsolePanels, viewMode: PanelMode, realOnly: boolean): boolean {
  return !(realOnly && viewMode === "SimulatedPanels");
}

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
//@ pure
export function alwaysAdminHoldsAnalystAndSimRole(p: ConsolePanels): boolean {
  return !p.staff.admin || (p.staff.analyst && p.staff.simRole);
}

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
//@ pure
export function alwaysRealOnlyServerShowsRealData(p: ConsolePanels): boolean {
  return !p.staff.realOnlyServer || p.staff.mode !== "SimulatedPanels";
}

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
//@ pure
export function receiveViewer(p: ConsolePanels, viewMode: PanelMode, analystRole: boolean, adminRole: boolean, simRoleHeld: boolean, realOnly: boolean): ConsolePanels {
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveViewer(p, viewMode, realOnly)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveViewer", \result)
  return { ...initial, staff: ({ mode: viewMode, analyst: analystRole || adminRole, admin: adminRole, simRole: simRoleHeld || adminRole, realOnlyServer: realOnly } as PanelStaff) };
}

/** Story: Use the analysis panels only where my mode and role allow / A new viewer or mode starts every analysis panel again (spec/consolePanels.md) */
//@ pure
export function stepNewViewerStartsThePanelsAgain(before: ConsolePanels, via: string, after: ConsolePanels): boolean {
  return !(via === "receiveViewer") || (equal_consolePanels(after.lab, initial.lab) && equal_consolePanels(after.runs, initial.runs) && after.feedSegment === "AllEvents" && equal_consolePanels(after.game, initial.game));
}

/** Story: Use the analysis panels only where my mode and role allow / Panel writes exist only in the simulated world (spec/consolePanels.md) */
//@ pure
export function panelWritesOffered(staff: PanelStaff): boolean {
  return staff.mode === "SimulatedPanels";
}

/** Story: Use the analysis panels only where my mode and role allow / Panel writes exist only in the simulated world (spec/consolePanels.md) */
//@ pure
export function lawRealDataOffersNoPanelWrite(panelStaff: PanelStaff): boolean {
  //@ ensures \result === true
  return !(panelStaff.mode !== "SimulatedPanels") || !panelWritesOffered(panelStaff);
}

/** Story: Use the analysis panels only where my mode and role allow / Panel writes exist only in the simulated world (spec/consolePanels.md) */
//@ pure
export function lawRealOnlyServerOffersNoPanelWrite(panelStaff: PanelStaff): boolean {
  //@ ensures \result === true
  return !(panelStaff.realOnlyServer && panelStaff.mode !== "SimulatedPanels") || !panelWritesOffered(panelStaff);
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function labBody(labOn: boolean, runCount: number): LabBody {
  return !labOn ? "LabOffView" : (runCount <= 0 ? "LabEmptyView" : "LabRunsView");
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function labPolls(lab: LabState): boolean {
  return lab.activeRuns || lab.phase === "LabStarting";
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function canReceiveLab(p: ConsolePanels, runCount: number): boolean {
  return p.staff.analyst && p.lab.phase !== "LabStarting" && runCount >= 0;
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function receiveLab(p: ConsolePanels, labOn: boolean, runCount: number, activeRuns: boolean): ConsolePanels {
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveLab(p, runCount)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveLab", \result)
  return { ...p, lab: ({ phase: labOn ? "LabReady" : "LabOff", runCount: runCount, activeRuns: labOn && activeRuns && runCount > 0 } as LabState) };
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function alwaysLabNeedsTheAnalystRole(p: ConsolePanels): boolean {
  return !(p.lab.phase !== "LabWaiting") || p.staff.analyst;
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function alwaysActiveRunsAreRuns(p: ConsolePanels): boolean {
  return !p.lab.activeRuns || p.lab.runCount > 0;
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function alwaysRunCountIsNeverNegative(p: ConsolePanels): boolean {
  return p.lab.runCount >= 0;
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function sometimesLabOff(p: ConsolePanels): boolean {
  return p.lab.phase === "LabOff";
}

/** Story: Run simulation experiments in the lab / The lab shows its runs, or says that it is off (spec/consolePanels.md) */
//@ pure
export function sometimesLabPolls(p: ConsolePanels): boolean {
  return p.lab.phase === "LabReady" && labPolls(p.lab);
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function labRequestValid(armCount: number, seedCount: number, days: number): boolean {
  return armCount >= 1 && armCount <= maxLabArms && seedCount >= 1 && seedCount <= maxLabSeeds && days >= 1 && days <= maxLabDays;
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function lawLabRequestNeedsAnArm(seedCount: number, days: number): boolean {
  //@ ensures \result === true
  return !labRequestValid(0, seedCount, days);
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function lawLabRequestIsBounded(armCount: number, seedCount: number, days: number): boolean {
  //@ ensures \result === true
  return !labRequestValid(armCount, seedCount, days) || (seedCount <= maxLabSeeds && days <= maxLabDays && armCount <= maxLabArms);
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function labStartShown(p: ConsolePanels): boolean {
  return p.staff.analyst && panelWritesOffered(p.staff) && (p.lab.phase === "LabReady" || p.lab.phase === "LabStartRefused");
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function startLab(p: ConsolePanels, armCount: number, seedCount: number, days: number): ConsolePanels {
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canStartLab(p, armCount, seedCount, days)) ==> stepNewViewerStartsThePanelsAgain(p, "startLab", \result)
  return { ...p, lab: ({ ...p.lab, phase: "LabStarting" } as LabState) };
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function canReceiveLabStart(p: ConsolePanels): boolean {
  return p.lab.phase === "LabStarting";
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function receiveLabStart(p: ConsolePanels, accepted: boolean): ConsolePanels {
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveLabStart(p)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveLabStart", \result)
  return accepted ? ({ ...p, lab: ({ phase: "LabReady", runCount: exact_consolePanels(p.lab.runCount + 1), activeRuns: true } as LabState) } as ConsolePanels) : ({ ...p, lab: ({ ...p.lab, phase: "LabStartRefused" } as LabState) } as ConsolePanels);
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function alwaysLabStartIsSimulated(p: ConsolePanels): boolean {
  return !(p.lab.phase === "LabStarting") || (p.staff.analyst && p.staff.mode === "SimulatedPanels");
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function sometimesLabStartRefused(p: ConsolePanels): boolean {
  return p.lab.phase === "LabStartRefused";
}

/** Story: Run simulation experiments in the lab / A lab run starts only in the simulated world with a valid request (spec/consolePanels.md) */
//@ pure
export function canStartLab(p: ConsolePanels, armCount: number, seedCount: number, days: number): boolean {
  return labStartShown(p) && labRequestValid(armCount, seedCount, days);
}

/** Story: Run simulation experiments in the lab / A lab result marks each safety count (spec/consolePanels.md) */
//@ pure
export function countMark(known: boolean, count: number): CountMark {
  return !known ? "CountUnknown" : (count > 0 ? "CountAlarm" : "CountZero");
}

/** Story: Run simulation experiments in the lab / A lab result marks each safety count (spec/consolePanels.md) */
//@ pure
export function lawEveryKnownPositiveCountIsAnAlarm(count: number): boolean {
  //@ ensures \result === true
  return (countMark(true, count) === "CountAlarm") === count > 0;
}

/** Story: Run simulation experiments in the lab / Stopping the console closes the lab and finishes interrupted runs (spec/consolePanels.md) */
//@ pure
export function labAcceptsWork(stopping: boolean): boolean {
  return !stopping;
}

/** Story: Run simulation experiments in the lab / Stopping the console closes the lab and finishes interrupted runs (spec/consolePanels.md) */
//@ pure
export function labRunInterrupted(status: string): boolean {
  return status === "queued" || status === "running";
}

/** Story: Run simulation experiments in the lab / Stopping the console closes the lab and finishes interrupted runs (spec/consolePanels.md) */
//@ pure
export function lawLabClosesAdmissionOnShutdown(stopping: boolean): boolean {
  //@ ensures \result === true
  return !stopping || !labAcceptsWork(stopping);
}

/** Story: Run simulation experiments in the lab / Stopping the console closes the lab and finishes interrupted runs (spec/consolePanels.md) */
//@ pure
export function lawFinishedLabRunSurvivesShutdown(status: string): boolean {
  //@ ensures \result === true
  return !(status === "done" || status === "failed") || !labRunInterrupted(status);
}

/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
//@ pure
export function runsView(r: RunCompare): RunsView {
  return r.runTotal <= 0 ? "NoRunsView" : (!r.comparing ? "RunDetailView" : (r.picked < 2 || r.diff === "NoDiff" ? "PickTwoView" : (r.diff === "DiffLoading" ? "DiffLoadingView" : (r.diff === "DiffShown" ? "DiffShownView" : "DiffFailedView"))));
}

/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
//@ pure
export function receiveRuns(p: ConsolePanels, runTotal: number): ConsolePanels {
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveRuns(p, runTotal)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveRuns", \result)
  return runTotal < 2 ? ({ ...p, runs: ({ runTotal: runTotal, comparing: false, picked: 0, diff: "NoDiff" } as RunCompare) } as ConsolePanels) : ({ ...p, runs: ({ ...p.runs, runTotal: runTotal } as RunCompare) } as ConsolePanels);
}

/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
//@ pure
export function sometimesRunDetail(p: ConsolePanels): boolean {
  return runsView(p.runs) === "RunDetailView";
}

/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
//@ pure
export function sometimesPickTwo(p: ConsolePanels): boolean {
  return runsView(p.runs) === "PickTwoView";
}

/** Story: Compare two matching runs / The runs tab shows a run, asks for two runs, or shows their difference (spec/consolePanels.md) */
//@ pure
export function canReceiveRuns(p: ConsolePanels, runTotal: number): boolean {
  return runTotal >= 0;
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function compareShown(p: ConsolePanels): boolean {
  return p.runs.comparing || p.runs.runTotal >= 2;
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function toggleCompare(p: ConsolePanels): ConsolePanels {
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canToggleCompare(p)) ==> stepNewViewerStartsThePanelsAgain(p, "toggleCompare", \result)
  return { ...p, runs: ({ ...p.runs, comparing: !p.runs.comparing, picked: 0, diff: "NoDiff" } as RunCompare) };
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function canPickRun(p: ConsolePanels, alreadyPicked: boolean): boolean {
  return p.runs.comparing && (alreadyPicked ? p.runs.picked > 0 : p.runs.picked < p.runs.runTotal);
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function pickRun(p: ConsolePanels, alreadyPicked: boolean): ConsolePanels {
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canPickRun(p, alreadyPicked)) ==> stepNewViewerStartsThePanelsAgain(p, "pickRun", \result)
  const local_0 = alreadyPicked ? exact_consolePanels(p.runs.picked - 1) : (p.runs.picked >= maxRunPicks ? maxRunPicks : exact_consolePanels(p.runs.picked + 1));
  return { ...p, runs: ({ ...p.runs, picked: local_0, diff: local_0 === maxRunPicks ? "DiffLoading" : "NoDiff" } as RunCompare) };
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function alwaysPicksAreAtMostTwo(p: ConsolePanels): boolean {
  return p.runs.picked >= 0 && p.runs.picked <= maxRunPicks && p.runs.picked <= p.runs.runTotal;
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function alwaysCompareNeedsTwoRuns(p: ConsolePanels): boolean {
  return !p.runs.comparing || p.runs.runTotal >= 2;
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function alwaysPicksNeedCompare(p: ConsolePanels): boolean {
  return !(p.runs.picked > 0) || p.runs.comparing;
}

/** Story: Compare two matching runs / Compare opens only with two runs, and a third pick drops the oldest (spec/consolePanels.md) */
//@ pure
export function canToggleCompare(p: ConsolePanels): boolean {
  return compareShown(p);
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function diffRowShown(valueA: number, valueB: number): boolean {
  return valueA !== 0 || valueB !== 0;
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function lawZeroMeasureIsHidden(valueA: number, valueB: number): boolean {
  //@ ensures \result === true
  return !diffRowShown(valueA, valueB) === (valueA === 0 && valueB === 0);
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function canReceiveDiff(p: ConsolePanels): boolean {
  return p.runs.diff === "DiffLoading";
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function receiveDiff(p: ConsolePanels, loaded: boolean): ConsolePanels {
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveDiff(p)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveDiff", \result)
  return { ...p, runs: ({ ...p.runs, diff: loaded ? "DiffShown" : "DiffFailed" } as RunCompare) };
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function alwaysDiffNeedsTwoPicks(p: ConsolePanels): boolean {
  return !(p.runs.diff !== "NoDiff") || (p.runs.comparing && p.runs.picked === maxRunPicks);
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function sometimesDiffShown(p: ConsolePanels): boolean {
  return runsView(p.runs) === "DiffShownView";
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function sometimesDiffFailed(p: ConsolePanels): boolean {
  return runsView(p.runs) === "DiffFailedView";
}

/** Story: Compare two matching runs / The difference loads once two runs are picked (spec/consolePanels.md) */
//@ pure
export function sometimesDiffLoading(p: ConsolePanels): boolean {
  return runsView(p.runs) === "DiffLoadingView";
}

/** Story: Read the health numbers of an app / The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data (spec/consolePanels.md) */
//@ pure
export function workStaff(staff: PanelStaff): consoleWorkspace_StaffView {
  return { mode: staff.mode === "SimulatedPanels" ? "SimulatedWorld" : (staff.mode === "RealActing" ? "RealWithService" : "RealWithoutService"), safety: false, admin: staff.admin, analyst: staff.analyst, simRole: staff.simRole, globalPii: false };
}

/** Story: Read the health numbers of an app / The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data (spec/consolePanels.md) */
//@ pure
export function metricsSectionShown(section: MetricsSection, staff: PanelStaff): boolean {
  return section === "TruthSection" ? staff.mode === "SimulatedPanels" : consoleWorkspace_panelAllowed("BiasPanel", workStaff(staff));
}

/** Story: Read the health numbers of an app / The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data (spec/consolePanels.md) */
//@ pure
export function lawTruthAndRealDataNeverMeet(panelStaff: PanelStaff): boolean {
  //@ ensures \result === true
  return !(metricsSectionShown("TruthSection", panelStaff) && metricsSectionShown("CostSection", panelStaff));
}

/** Story: Read the health numbers of an app / The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data (spec/consolePanels.md) */
//@ pure
export function lawCostNeedsTheAnalystRole(panelStaff: PanelStaff): boolean {
  //@ ensures \result === true
  return !metricsSectionShown("CostSection", panelStaff) || panelStaff.analyst;
}

/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
//@ pure
export function biasAlert(ratioHundredths: number): boolean {
  return ratioHundredths < biasAlertBelow;
}

/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
//@ pure
export function biasSummary(alertCount: number): BiasSummary {
  return alertCount > 0 ? "GroupsBelowAlert" : "NoGroupBelowNote";
}

/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
//@ pure
export function lawLowerRatioStaysAnAlert(ratioHundredths: number): boolean {
  //@ ensures \result === true
  return !biasAlert(ratioHundredths) || biasAlert(exact_consolePanels(ratioHundredths - 1));
}

/** Story: Read the health numbers of an app / The bias monitor alerts below 0.8 times the outcome of everyone (spec/consolePanels.md) */
//@ pure
export function lawEqualOutcomeIsNoAlert(ratioHundredths: number): boolean {
  //@ ensures \result === true
  return !(ratioHundredths >= 100) || !biasAlert(ratioHundredths);
}

/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
//@ pure
export function costKindShown(daysWithKind: number): boolean {
  return daysWithKind > 0;
}

/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
//@ pure
export function budgetMark(sharePercent: number): BudgetMark {
  return sharePercent >= 100 ? "BudgetOver" : (sharePercent >= 80 ? "BudgetNear" : "BudgetOk");
}

/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
//@ pure
export function costView(answer: consoleWorkspace_PanelAnswer): consoleWorkspace_PanelView {
  return answer === "NotAnswered" ? "PanelLoading" : (answer === "AnswerForbidden" ? "PanelForbidden" : (answer === "AnswerRows" ? "PanelRows" : "PanelFailed"));
}

/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
//@ pure
export function lawBudgetMarkGrowsWithUse(sharePercent: number): boolean {
  //@ ensures \result === true
  return (!(budgetMark(sharePercent) === "BudgetOver") || budgetMark(exact_consolePanels(sharePercent + 1)) === "BudgetOver") && (!(budgetMark(sharePercent) !== "BudgetOk") || budgetMark(exact_consolePanels(sharePercent + 1)) !== "BudgetOk");
}

/** Story: Read the health numbers of an app / A cost budget turns amber at 80 percent and red at 100 percent (spec/consolePanels.md) */
//@ pure
export function lawRefusedCostShowsNoNumber(answer: consoleWorkspace_PanelAnswer): boolean {
  //@ ensures \result === true
  return (costView(answer) === "PanelRows") === (answer === "AnswerRows");
}

/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
//@ pure
export function proactiveWarns(rateHundredths: number): boolean {
  return rateHundredths > maxProactiveHundredths;
}

/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
//@ pure
export function inviterMark(known: boolean, sharePercent: number): ShareMark {
  return !known ? "ShareUnknown" : (sharePercent >= inviterTargetPercent ? "ShareMet" : "ShareBelow");
}

/** Story: Read the health numbers of an app / The proactive rate and the inviter share show their targets (spec/consolePanels.md) */
//@ pure
export function lawTwoMessagesAWeekDoNotWarn(rateHundredths: number): boolean {
  //@ ensures \result === true
  return !(rateHundredths <= 200) || !proactiveWarns(rateHundredths);
}

/** Story: Read the health numbers of an app / Confirmed proactive delivery contributes to the staff rate (spec/consolePanels.md) */
//@ pure
export function confirmsProactiveDelivery(status: string): boolean {
  return confirmedProactiveDeliveryStatuses.reduce((confirmed: boolean, candidate: string) => confirmed || status === candidate, false);
}

/** Story: Read the health numbers of an app / Confirmed proactive delivery contributes to the staff rate (spec/consolePanels.md) */
//@ pure
export function lawAcceptedProactiveDeliveryIsUnconfirmed(status: string): boolean {
  //@ ensures \result === true
  return !(status === "queued" || status === "accepted" || status === "sent") || !confirmsProactiveDelivery(status);
}

/** Story: Follow events in the feed and the pipeline / The feed segments group the event kinds (spec/consolePanels.md) */
//@ pure
export function feedShows(group: EventGroup, segment: FeedSegment, playerEvent: boolean, feedSize: number): boolean {
  return segment === "AllEvents" ? !(group === "JoinGroup" && feedSize >= joinsHiddenFrom) : (segment === "PeopleEvents" ? group === "JoinGroup" || group === "PeopleGroup" : (segment === "SafetyEvents" ? group === "SafetyGroup" : (segment === "SystemEvents" ? group === "SystemGroup" : playerEvent)));
}

/** Story: Follow events in the feed and the pipeline / The feed segments group the event kinds (spec/consolePanels.md) */
//@ pure
export function lawPeopleEventsAlwaysShowInAll(feedSize: number): boolean {
  //@ ensures \result === true
  return feedShows("PeopleGroup", "AllEvents", false, feedSize);
}

/** Story: Follow events in the feed and the pipeline / The feed segments group the event kinds (spec/consolePanels.md) */
//@ pure
export function lawSafetyEventsShowInTheSafetySegment(playerEvent: boolean, feedSize: number): boolean {
  //@ ensures \result === true
  return feedShows("SafetyGroup", "SafetyEvents", playerEvent, feedSize);
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function feedSegmentOffered(segment: FeedSegment, staff: PanelStaff): boolean {
  return segment !== "MineEvents" || staff.mode === "SimulatedPanels";
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function feedEmptyNote(feedEmpty: boolean, canStep: boolean, focused: boolean): FeedNote {
  return feedEmpty ? (canStep ? "PressPlayNote" : "NoEventsInRangeNote") : (focused || canStep ? "NothingMatchesNote" : "NoEventsInRangeNote");
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function feedSegmentNow(segment: FeedSegment, staff: PanelStaff): FeedSegment {
  return feedSegmentOffered(segment, staff) ? segment : "AllEvents";
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function canChooseFeedSegment(p: ConsolePanels, segment: FeedSegment): boolean {
  return feedSegmentOffered(segment, p.staff);
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function chooseFeedSegment(p: ConsolePanels, segment: FeedSegment): ConsolePanels {
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canChooseFeedSegment(p, segment)) ==> stepNewViewerStartsThePanelsAgain(p, "chooseFeedSegment", \result)
  return { ...p, feedSegment: segment };
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function alwaysMineSegmentIsSimulated(p: ConsolePanels): boolean {
  return !(p.feedSegment === "MineEvents") || p.staff.mode === "SimulatedPanels";
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function sometimesMineSegment(p: ConsolePanels): boolean {
  return p.feedSegment === "MineEvents";
}

/** Story: Follow events in the feed and the pipeline / The mine segment exists only in the simulated world (spec/consolePanels.md) */
//@ pure
export function lawShownSegmentIsOffered(segment: FeedSegment, panelStaff: PanelStaff): boolean {
  //@ ensures \result === true
  return feedSegmentOffered(feedSegmentNow(segment, panelStaff), panelStaff);
}

/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
//@ pure
export function columnShown(stateFilter: StateFilter, column: PipelineColumn): boolean {
  return stateFilter === "AnyState" ? true : (stateFilter === "ReviewStates" ? column === "ReviewColumn" : (stateFilter === "OpenStates" ? column === "OpenColumn" : (stateFilter === "MetStates" ? column === "MetColumn" : column === "ClosedColumn")));
}

/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
//@ pure
export function ladderView(networkKnown: boolean, stubNetwork: boolean): LadderView {
  return !networkKnown ? "NoLadder" : (stubNetwork ? "StubLadderNote" : "ConsentLadder");
}

/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
//@ pure
export function lawEveryColumnShowsWithoutAFilter(column: PipelineColumn): boolean {
  //@ ensures \result === true
  return columnShown("AnyState", column);
}

/** Story: Follow events in the feed and the pipeline / The pipeline shows the columns of the state filter, and the ladder of a consent network (spec/consolePanels.md) */
//@ pure
export function lawAStateFilterKeepsOneColumnGroup(stateFilter: StateFilter): boolean {
  //@ ensures \result === true
  return !(stateFilter !== "AnyState") || !(columnShown(stateFilter, "ReviewColumn") && columnShown(stateFilter, "ClosedColumn"));
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function gameView(g: GamePanel): GameView {
  return !g.present ? "NoGameView" : (g.over ? "GameOverView" : "GamePlayingView");
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function canReceiveGame(p: ConsolePanels): boolean {
  return p.staff.mode === "SimulatedPanels";
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function receiveGame(p: ConsolePanels, present: boolean, over: boolean, levelPlaying: boolean): ConsolePanels {
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canReceiveGame(p)) ==> stepNewViewerStartsThePanelsAgain(p, "receiveGame", \result)
  return { ...p, game: ({ ...p.game, present: present, over: present && over, levelPlaying: present && levelPlaying, levelChecked: p.game.levelChecked && present && levelPlaying } as GamePanel) };
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function alwaysGameWorkIsSimulated(p: ConsolePanels): boolean {
  return !(p.game.present || p.game.resetSent || p.game.levelChecked) || p.staff.mode === "SimulatedPanels";
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function sometimesGamePlaying(p: ConsolePanels): boolean {
  return gameView(p.game) === "GamePlayingView";
}

/** Story: Play the game tab and its levels / The game tab shows the score of the simulated world (spec/consolePanels.md) */
//@ pure
export function sometimesGameOver(p: ConsolePanels): boolean {
  return gameView(p.game) === "GameOverView";
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function gameControlsShown(p: ConsolePanels): boolean {
  return panelWritesOffered(p.staff) && p.staff.admin && p.game.present;
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function resetWorld(p: ConsolePanels, chooseLevel: boolean): ConsolePanels {
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canResetWorld(p, chooseLevel)) ==> stepNewViewerStartsThePanelsAgain(p, "resetWorld", \result)
  return { ...p, game: ({ ...p.game, over: false, levelPlaying: chooseLevel, resetSent: true, levelChecked: false } as GamePanel) };
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function alwaysResetNeedsAnAdmin(p: ConsolePanels): boolean {
  return !p.game.resetSent || p.staff.admin;
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function sometimesWorldReset(p: ConsolePanels): boolean {
  return p.game.resetSent && p.game.levelPlaying;
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function reviewerSwitchShown(p: ConsolePanels): boolean {
  return gameControlsShown(p);
}

/** Story: Play the game tab and its levels / Only an admin resets the world, chooses a level or chooses the reviewer (spec/consolePanels.md) */
//@ pure
export function canResetWorld(p: ConsolePanels, chooseLevel: boolean): boolean {
  return gameControlsShown(p);
}

/** Story: Play the game tab and its levels / A player checks the level that plays (spec/consolePanels.md) */
//@ pure
export function levelCheckShown(p: ConsolePanels): boolean {
  return panelWritesOffered(p.staff) && p.staff.simRole && p.game.present && p.game.levelPlaying;
}

/** Story: Play the game tab and its levels / A player checks the level that plays (spec/consolePanels.md) */
//@ pure
export function checkLevel(p: ConsolePanels): ConsolePanels {
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysAdminHoldsAnalystAndSimRole(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysRealOnlyServerShowsRealData(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysLabNeedsTheAnalystRole(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysActiveRunsAreRuns(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysRunCountIsNeverNegative(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysLabStartIsSimulated(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysPicksAreAtMostTwo(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysCompareNeedsTwoRuns(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysPicksNeedCompare(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysDiffNeedsTwoPicks(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysMineSegmentIsSimulated(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysGameWorkIsSimulated(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysResetNeedsAnAdmin(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> alwaysLevelCheckNeedsALevel(\result)
  //@ ensures (inv(p) && canCheckLevel(p)) ==> stepNewViewerStartsThePanelsAgain(p, "checkLevel", \result)
  return { ...p, game: ({ ...p.game, levelChecked: true } as GamePanel) };
}

/** Story: Play the game tab and its levels / A player checks the level that plays (spec/consolePanels.md) */
//@ pure
export function alwaysLevelCheckNeedsALevel(p: ConsolePanels): boolean {
  return !p.game.levelChecked || (p.game.levelPlaying && p.staff.simRole);
}

/** Story: Play the game tab and its levels / A player checks the level that plays (spec/consolePanels.md) */
//@ pure
export function sometimesLevelChecked(p: ConsolePanels): boolean {
  return p.game.levelChecked;
}

/** Story: Play the game tab and its levels / A player checks the level that plays (spec/consolePanels.md) */
//@ pure
export function canCheckLevel(p: ConsolePanels): boolean {
  return levelCheckShown(p);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ConsolePanels, event: Event): boolean {
  if (event.type === "receiveViewer") return canReceiveViewer(current, event.viewMode, event.realOnly);
  if (event.type === "receiveLab") return canReceiveLab(current, event.runCount);
  if (event.type === "startLab") return canStartLab(current, event.armCount, event.seedCount, event.days);
  if (event.type === "receiveLabStart") return canReceiveLabStart(current);
  if (event.type === "receiveRuns") return canReceiveRuns(current, event.runTotal);
  if (event.type === "toggleCompare") return canToggleCompare(current);
  if (event.type === "pickRun") return canPickRun(current, event.alreadyPicked);
  if (event.type === "receiveDiff") return canReceiveDiff(current);
  if (event.type === "chooseFeedSegment") return canChooseFeedSegment(current, event.segment);
  if (event.type === "receiveGame") return canReceiveGame(current);
  if (event.type === "resetWorld") return canResetWorld(current, event.chooseLevel);
  if (event.type === "checkLevel") return canCheckLevel(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ConsolePanels, event: Event): ConsolePanels {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "receiveViewer") return canReceiveViewer(current, event.viewMode, event.realOnly) ? receiveViewer(current, event.viewMode, event.analystRole, event.adminRole, event.simRoleHeld, event.realOnly) : current;
  if (event.type === "receiveLab") return canReceiveLab(current, event.runCount) ? receiveLab(current, event.labOn, event.runCount, event.activeRuns) : current;
  if (event.type === "startLab") return canStartLab(current, event.armCount, event.seedCount, event.days) ? startLab(current, event.armCount, event.seedCount, event.days) : current;
  if (event.type === "receiveLabStart") return canReceiveLabStart(current) ? receiveLabStart(current, event.accepted) : current;
  if (event.type === "receiveRuns") return canReceiveRuns(current, event.runTotal) ? receiveRuns(current, event.runTotal) : current;
  if (event.type === "toggleCompare") return canToggleCompare(current) ? toggleCompare(current) : current;
  if (event.type === "pickRun") return canPickRun(current, event.alreadyPicked) ? pickRun(current, event.alreadyPicked) : current;
  if (event.type === "receiveDiff") return canReceiveDiff(current) ? receiveDiff(current, event.loaded) : current;
  if (event.type === "chooseFeedSegment") return canChooseFeedSegment(current, event.segment) ? chooseFeedSegment(current, event.segment) : current;
  if (event.type === "receiveGame") return canReceiveGame(current) ? receiveGame(current, event.present, event.over, event.levelPlaying) : current;
  if (event.type === "resetWorld") return canResetWorld(current, event.chooseLevel) ? resetWorld(current, event.chooseLevel) : current;
  if (event.type === "checkLevel") return canCheckLevel(current) ? checkLevel(current) : current;
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
  if (raw.type === "receiveViewer" && (raw.viewMode === "SimulatedPanels" || raw.viewMode === "RealActing" || raw.viewMode === "RealReadOnly") && typeof raw.analystRole === "boolean" && typeof raw.adminRole === "boolean" && typeof raw.simRoleHeld === "boolean" && typeof raw.realOnly === "boolean") return { type: "receiveViewer", viewMode: raw.viewMode, analystRole: raw.analystRole, adminRole: raw.adminRole, simRoleHeld: raw.simRoleHeld, realOnly: raw.realOnly };
  if (raw.type === "receiveLab" && typeof raw.labOn === "boolean" && Number.isSafeInteger(raw.runCount) && typeof raw.activeRuns === "boolean") return { type: "receiveLab", labOn: raw.labOn, runCount: raw.runCount, activeRuns: raw.activeRuns };
  if (raw.type === "startLab" && Number.isSafeInteger(raw.armCount) && Number.isSafeInteger(raw.seedCount) && Number.isSafeInteger(raw.days)) return { type: "startLab", armCount: raw.armCount, seedCount: raw.seedCount, days: raw.days };
  if (raw.type === "receiveLabStart" && typeof raw.accepted === "boolean") return { type: "receiveLabStart", accepted: raw.accepted };
  if (raw.type === "receiveRuns" && Number.isSafeInteger(raw.runTotal)) return { type: "receiveRuns", runTotal: raw.runTotal };
  if (raw.type === "toggleCompare") return { type: "toggleCompare" };
  if (raw.type === "pickRun" && typeof raw.alreadyPicked === "boolean") return { type: "pickRun", alreadyPicked: raw.alreadyPicked };
  if (raw.type === "receiveDiff" && typeof raw.loaded === "boolean") return { type: "receiveDiff", loaded: raw.loaded };
  if (raw.type === "chooseFeedSegment" && (raw.segment === "AllEvents" || raw.segment === "PeopleEvents" || raw.segment === "SafetyEvents" || raw.segment === "SystemEvents" || raw.segment === "MineEvents")) return { type: "chooseFeedSegment", segment: raw.segment };
  if (raw.type === "receiveGame" && typeof raw.present === "boolean" && typeof raw.over === "boolean" && typeof raw.levelPlaying === "boolean") return { type: "receiveGame", present: raw.present, over: raw.over, levelPlaying: raw.levelPlaying };
  if (raw.type === "resetWorld" && typeof raw.chooseLevel === "boolean") return { type: "resetWorld", chooseLevel: raw.chooseLevel };
  if (raw.type === "checkLevel") return { type: "checkLevel" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ConsolePanels | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.staff === "object" && raw.staff !== null && !Array.isArray(raw.staff) && (raw.staff.mode === "RealReadOnly" || raw.staff.mode === "SimulatedPanels" || raw.staff.mode === "RealActing") && typeof raw.staff.analyst === "boolean" && typeof raw.staff.admin === "boolean" && typeof raw.staff.simRole === "boolean" && typeof raw.staff.realOnlyServer === "boolean" && Object.keys(raw.staff).length === 5 && typeof raw.lab === "object" && raw.lab !== null && !Array.isArray(raw.lab) && (raw.lab.phase === "LabWaiting" || raw.lab.phase === "LabOff" || raw.lab.phase === "LabReady" || raw.lab.phase === "LabStarting" || raw.lab.phase === "LabStartRefused") && Number.isSafeInteger(raw.lab.runCount) && typeof raw.lab.activeRuns === "boolean" && Object.keys(raw.lab).length === 3 && typeof raw.runs === "object" && raw.runs !== null && !Array.isArray(raw.runs) && Number.isSafeInteger(raw.runs.runTotal) && typeof raw.runs.comparing === "boolean" && Number.isSafeInteger(raw.runs.picked) && (raw.runs.diff === "NoDiff" || raw.runs.diff === "DiffLoading" || raw.runs.diff === "DiffShown" || raw.runs.diff === "DiffFailed") && Object.keys(raw.runs).length === 4 && (raw.feedSegment === "AllEvents" || raw.feedSegment === "PeopleEvents" || raw.feedSegment === "SafetyEvents" || raw.feedSegment === "SystemEvents" || raw.feedSegment === "MineEvents") && typeof raw.game === "object" && raw.game !== null && !Array.isArray(raw.game) && typeof raw.game.present === "boolean" && typeof raw.game.over === "boolean" && typeof raw.game.levelPlaying === "boolean" && typeof raw.game.resetSent === "boolean" && typeof raw.game.levelChecked === "boolean" && Object.keys(raw.game).length === 5 && Object.keys(raw).length === 5)) return undefined;
  const parsed: ConsolePanels = ({ staff: ({ mode: raw.staff.mode, analyst: raw.staff.analyst, admin: raw.staff.admin, simRole: raw.staff.simRole, realOnlyServer: raw.staff.realOnlyServer }), lab: ({ phase: raw.lab.phase, runCount: raw.lab.runCount, activeRuns: raw.lab.activeRuns }), runs: ({ runTotal: raw.runs.runTotal, comparing: raw.runs.comparing, picked: raw.runs.picked, diff: raw.runs.diff }), feedSegment: raw.feedSegment, game: ({ present: raw.game.present, over: raw.game.over, levelPlaying: raw.game.levelPlaying, resetSent: raw.game.resetSent, levelChecked: raw.game.levelChecked }) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ConsolePanels {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_consolePanels(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_consolePanels(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_consolePanels((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
