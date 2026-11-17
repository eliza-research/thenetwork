# Staff console workspace

The staff console (`packages/observatory/web`) puts the admin work in drawer panels and in the inspector. This spec owns the view states of that work: held texts, safety cases, post-date reports, member requests, the matching switch, the audit log, the propose tray and the world menu of the simulated world, the PII reveal, and the loading, empty and error rows of each panel. The [safety case spec](safetyCase.md) owns what the Network does with a case or a report. The [review spec](staffReview.md) owns the review card. The [member view spec](consoleMemberView.md) owns the detail reads and the Slop photos. The [navigation spec](consoleNavigation.md) owns which tab shows. The server writes an audit row before every staff read and action, and it checks every role again. The shell owns the fetches, the timers and the toasts.

The shell calls each answer guard (`canReceiveHeldText`, `canReceiveHeldAnswer`, `canReceiveCaseAnswer`, `canReceiveReportAnswer`, `canReceiveSwitchAnswer`, `canReceiveAudit`) before it applies the answer. The reveal form goes through the generated `step`, which checks the guards of the reveal. These definitions are model-only helpers that the generated guards call: `staffActs`, `heldReleasable`, `reportDecision`, `reportOutcome`, `switchShown` and `proposeAllowed`.

## Story: Work only in the panels my role and mode allow

> As a staff member, I want each panel to show its controls only to the roles and modes that can use them, so that I never press a control that the server must refuse.

### A new viewer or mode starts every panel again

The console has three modes for work: the simulated world, real data with the Network service, and real data without it. Real data without the service is read-only. The simulated world never shows real data, so the server's "all data shown" setting applies only to real data. An admin holds every other role. A new viewer answer, a mode change or a credential change closes every draft, form and menu.

```quint
import safetyCase as S from "./safetyCase"

type WorkMode = SimulatedWorld | RealWithService | RealWithoutService
type StaffView = { mode: WorkMode, safety: bool, admin: bool, analyst: bool, simRole: bool, globalPii: bool }

type HeldStatus = HeldEmpty | HeldWaiting | HeldSending | HeldReleased | HeldRejected
type HeldChoice = ReleaseHeld | RejectHeld
type HeldRow = { status: HeldStatus, choice: HeldChoice, photo: bool, minorHidden: bool, reasonReady: bool, photoLoaded: bool, photoReviewed: bool }

type CaseRowStatus = CaseRowEmpty | CaseRowOpen | CaseRowClosed
type CaseStep = LiftStep | CloseStep
type CaseRow = { status: CaseRowStatus, onHold: bool, expanded: bool, caseSending: bool, caseStep: CaseStep }

type ReportStep = HoldPersonStep | BanPhoneStep | BanPersonStep | DismissStep | ClearMinorStep
type ReportRow = { present: bool, status: S::ReportPhase, minorReport: bool, noteReady: bool, reportSending: bool, reportStep: ReportStep }

type RequestSegment = OpenSegment | FulfilledSegment | NoneSegment | AnsweredSegment | AllSegment
type ConfigPhase = ConfigLoading | ConfigShown | ConfigConfirming | ConfigSaving | ConfigFailed
type ConfigEditor = { phase: ConfigPhase, matchingOn: bool, packLocked: bool, changeable: bool, saved: bool }
type AuditPhase = AuditClosed | AuditLoading | AuditShown | AuditFailed
type TrayPhase = TrayIdle | TraySending | TrayProposed
type RevealPhase = RevealHidden | RevealDrafting | RevealSending | RevealGranted
type RevealForm = { phase: RevealPhase, reasonReady: bool, minutes: int }

type Workspace = {
  staff: StaffView, held: HeldRow, caseRow: CaseRow, report: ReportRow, requestSegment: RequestSegment,
  config: ConfigEditor, audit: AuditPhase, tray: TrayPhase, worldMenuOpen: bool, worldEventSent: bool, reveal: RevealForm,
}

pure val minReasonChars: int = 5
pure val maxRevealMinutes: int = 15

pure val initial: Workspace = {
  staff: { mode: RealWithoutService, safety: false, admin: false, analyst: false, simRole: false, globalPii: false },
  held: { status: HeldEmpty, choice: RejectHeld, photo: false, minorHidden: false, reasonReady: false, photoLoaded: false, photoReviewed: false },
  caseRow: { status: CaseRowEmpty, onHold: false, expanded: false, caseSending: false, caseStep: CloseStep },
  report: { present: false, status: S::ReportOpen, minorReport: false, noteReady: false, reportSending: false, reportStep: DismissStep },
  requestSegment: OpenSegment,
  config: { phase: ConfigLoading, matchingOn: false, packLocked: false, changeable: false, saved: false },
  audit: AuditClosed, tray: TrayIdle, worldMenuOpen: false, worldEventSent: false,
  reveal: { phase: RevealHidden, reasonReady: false, minutes: maxRevealMinutes },
}

pure def receiveViewer(w: Workspace, viewMode: WorkMode, safetyRole: bool, adminRole: bool, analystRole: bool,
  simRoleHeld: bool, globalPiiShown: bool): Workspace =
  { ...initial,
    staff: {
      mode: viewMode, admin: adminRole, safety: safetyRole or adminRole, analyst: analystRole or adminRole,
      simRole: simRoleHeld or adminRole, globalPii: globalPiiShown and viewMode != SimulatedWorld,
    } }

pure def staffActs(staff: StaffView): bool = staff.mode != RealWithoutService

pure def alwaysAdminHoldsEveryRole(w: Workspace): bool =
  w.staff.admin implies (w.staff.safety and w.staff.analyst and w.staff.simRole)

pure def alwaysSimulatedWorldShowsNoRealData(w: Workspace): bool =
  w.staff.mode == SimulatedWorld implies not(w.staff.globalPii)

pure def stepNewViewerClosesForms(before: Workspace, via: str, after: Workspace): bool =
  via == "receiveViewer" implies (after.tray == TrayIdle and not(after.worldMenuOpen) and after.reveal.phase == RevealHidden
    and after.audit == AuditClosed and after.config.phase == ConfigLoading)
```

### Each panel shows a loading, refused, unavailable, failed, empty or full view

A panel that waits for its first answer shows a loading row. A 403 answer shows that the role cannot see the panel. A 404 answer for the held texts or the bias monitor shows that the feature is not available here. Any other failure shows the error. An answer with no rows shows the empty row. A refused answer never shows rows.

```quint
type WorkPanel = HeldPanel | CasesPanel | ReportsPanel | RequestsPanel | ConfigPanel | AuditPanel | LabPanel | BiasPanel
type PanelAnswer = NotAnswered | AnswerRows | AnswerForbidden | AnswerMissing | AnswerFailed
type PanelView = PanelLoading | PanelForbidden | PanelUnavailable | PanelFailed | PanelEmpty | PanelRows

pure def panelView(panel: WorkPanel, answer: PanelAnswer, rowCount: int): PanelView =
  if (answer == NotAnswered) PanelLoading
  else if (answer == AnswerForbidden) PanelForbidden
  else if (answer == AnswerMissing and (panel == HeldPanel or panel == BiasPanel)) PanelUnavailable
  else if (answer != AnswerRows) PanelFailed
  else if (rowCount <= 0) PanelEmpty
  else PanelRows

pure def lawRefusedPanelShowsNoRows(panel: WorkPanel, rowCount: int): bool =
  panelView(panel, AnswerForbidden, rowCount) == PanelForbidden

pure def lawRowsNeedAnAnswer(panel: WorkPanel, answer: PanelAnswer, rowCount: int): bool =
  panelView(panel, answer, rowCount) == PanelRows implies (answer == AnswerRows and rowCount > 0)
```

### Each panel opens only for the roles that can read it

Held texts, safety cases and reports need the safety role. The server records the staff member and selected app before it reads or returns the safety queue. An audit failure refuses the read. The matching switch and the lab need the analyst role. The audit log needs the admin role. The bias monitor needs the analyst role and real data. Member requests are open to every staff role.

```quint
pure def panelAllowed(panel: WorkPanel, staff: StaffView): bool =
  if (panel == HeldPanel or panel == CasesPanel or panel == ReportsPanel) staff.safety
  else if (panel == ConfigPanel or panel == LabPanel) staff.analyst
  else if (panel == AuditPanel) staff.admin
  else if (panel == BiasPanel) (staff.analyst and staff.mode != SimulatedWorld)
  else true

pure val staffValues: Set[StaffView] = Set(
  { mode: SimulatedWorld, safety: true, admin: true, analyst: true, simRole: true, globalPii: false },
  { mode: RealWithService, safety: true, admin: false, analyst: false, simRole: false, globalPii: false },
  { mode: RealWithoutService, safety: false, admin: false, analyst: true, simRole: false, globalPii: false },
  { mode: RealWithService, safety: false, admin: false, analyst: false, simRole: true, globalPii: true },
)

pure def lawAuditLogIsAdminOnly(staff: StaffView): bool = panelAllowed(AuditPanel, staff) iff staff.admin
```

## Story: Decide a held text with a reason

> As a safety staff member, I want to release or reject a text that waits for staff, with a reason, so that a risky text never goes out without a check.

### A held text waits for a reason of five characters or more

Held texts exist only on real data with the Network service. A new held row starts with no reason. A change of the reason clears the photo check. The text of a member under 18, or with an unknown age, stays hidden.

```quint
pure def canReceiveHeldText(w: Workspace): bool =
  w.staff.safety and w.staff.mode == RealWithService and w.held.status != HeldSending

pure def receiveHeldText(w: Workspace, photoItem: bool, minorItem: bool): Workspace =
  { ...w, held: { status: HeldWaiting, choice: RejectHeld, photo: photoItem, minorHidden: minorItem,
    reasonReady: false, photoLoaded: false, photoReviewed: false } }

pure def canTypeHeldReason(w: Workspace): bool = w.held.status == HeldWaiting

pure def typeHeldReason(w: Workspace, reasonChars: int): Workspace =
  { ...w, held: { ...w.held, reasonReady: reasonChars >= minReasonChars, photoReviewed: false } }

pure val weight_receiveHeldText = 4
pure val weight_typeHeldReason = 4
```

### A held photo is released only after staff load it and confirm the review

A held photo loads only with a reason and only for a row whose member is not hidden as a minor. Staff confirm the review only after the photo loads. A new load clears the confirmation.

```quint
pure def canLoadHeldPhoto(w: Workspace): bool =
  w.held.status == HeldWaiting and w.held.photo and w.held.reasonReady and not(w.held.minorHidden)

pure def loadHeldPhoto(w: Workspace, loaded: bool): Workspace =
  { ...w, held: { ...w.held, photoLoaded: loaded, photoReviewed: false } }

pure def canMarkPhotoReviewed(w: Workspace): bool = w.held.status == HeldWaiting and w.held.photoLoaded

pure def markPhotoReviewed(w: Workspace, reviewed: bool): Workspace = { ...w, held: { ...w.held, photoReviewed: reviewed } }

pure val weight_loadHeldPhoto = 4
pure val weight_markPhotoReviewed = 4
```

### Release needs a releasable text, and reject needs only a reason

Release needs a visible text and, for a photo, a loaded and reviewed photo. Reject needs only the reason. One decision is on its way at a time. An accepted answer releases or rejects the text. A refused answer keeps the row waiting.

```quint
pure def heldReleasable(held: HeldRow): bool =
  not(held.minorHidden) and (not(held.photo) or (held.photoLoaded and held.photoReviewed))

pure def canDecideHeld(w: Workspace, choice: HeldChoice): bool =
  w.held.status == HeldWaiting and w.staff.safety and w.staff.mode == RealWithService and w.held.reasonReady
    and (choice == RejectHeld or heldReleasable(w.held))

pure def decideHeld(w: Workspace, choice: HeldChoice): Workspace = { ...w, held: { ...w.held, status: HeldSending, choice: choice } }

pure def canReceiveHeldAnswer(w: Workspace): bool = w.held.status == HeldSending

pure def receiveHeldAnswer(w: Workspace, accepted: bool): Workspace =
  { ...w, held: { ...w.held, status:
    if (not(accepted)) HeldWaiting else if (w.held.choice == ReleaseHeld) HeldReleased else HeldRejected } }

pure def alwaysReleaseWasReleasable(w: Workspace): bool =
  (w.held.status == HeldReleased or (w.held.status == HeldSending and w.held.choice == ReleaseHeld))
    implies (heldReleasable(w.held) and w.held.reasonReady)

pure def alwaysHiddenMinorTextIsNeverReleased(w: Workspace): bool =
  w.held.minorHidden implies w.held.status != HeldReleased

pure val weight_decideHeld = 4
pure val weight_receiveHeldAnswer = 4

pure def sometimesHeldTextReleased(w: Workspace): bool = w.held.status == HeldReleased
pure def sometimesHeldPhotoReleased(w: Workspace): bool = w.held.status == HeldReleased and w.held.photo
pure def sometimesHeldTextRejected(w: Workspace): bool = w.held.status == HeldRejected
```

## Story: Act on safety cases and reports

> As a safety staff member, I want to open a case or a report, choose a decision and see its outcome, so that every safety decision is deliberate and recorded.

### A case row opens, and a safety viewer lifts its hold or closes it

A case row opens and closes on a click. A safety viewer acts in the simulated world or with the Network service. Lift needs a case on hold. One action is on its way at a time. An accepted lift removes the hold. An accepted close closes the case. A refused action keeps the row as it was.

```quint
pure def canReceiveCase(w: Workspace): bool = w.staff.safety and not(w.caseRow.caseSending)

pure def receiveCase(w: Workspace, heldCase: bool): Workspace =
  { ...w, caseRow: { status: CaseRowOpen, onHold: heldCase, expanded: false, caseSending: false, caseStep: CloseStep } }

pure def canToggleCaseRow(w: Workspace): bool = w.caseRow.status != CaseRowEmpty

pure def toggleCaseRow(w: Workspace): Workspace = { ...w, caseRow: { ...w.caseRow, expanded: not(w.caseRow.expanded) } }

pure def canActOnCase(w: Workspace, caseStep: CaseStep): bool =
  w.caseRow.expanded and w.caseRow.status == CaseRowOpen and not(w.caseRow.caseSending)
    and w.staff.safety and staffActs(w.staff) and (caseStep == LiftStep implies w.caseRow.onHold)

pure def actOnCase(w: Workspace, caseStep: CaseStep): Workspace =
  { ...w, caseRow: { ...w.caseRow, caseSending: true, caseStep: caseStep } }

pure def canReceiveCaseAnswer(w: Workspace): bool = w.caseRow.caseSending

pure def receiveCaseAnswer(w: Workspace, accepted: bool): Workspace =
  val row = w.caseRow
  { ...w, caseRow: { ...row, caseSending: false,
    onHold: if (accepted and row.caseStep == LiftStep) false else row.onHold,
    status: if (accepted and row.caseStep == CloseStep) CaseRowClosed else row.status } }

pure def alwaysCaseActionNeedsAnActingSafetyViewer(w: Workspace): bool =
  w.caseRow.caseSending implies (w.staff.safety and staffActs(w.staff) and w.caseRow.status == CaseRowOpen)

pure val weight_toggleCaseRow = 3
pure val weight_actOnCase = 3

pure def sometimesCaseClosed(w: Workspace): bool = w.caseRow.status == CaseRowClosed
pure def sometimesHoldLifted(w: Workspace): bool = w.caseRow.status == CaseRowOpen and not(w.caseRow.onHold) and w.caseRow.caseStep == LiftStep
```

### A report decision needs a note and the Network service

A report decision needs a note of five characters or more. Hold, ban by phone, ban by person and dismiss need the Network service. Clear minor signal needs a minor report and a mode that acts. The [safety case spec](safetyCase.md) decides the report status after a decision: a hold marks the report held, a ban marks it banned, and a dismissal marks it dismissed. A minor clear dismisses the minor report. The row shows that status only after the server accepts the decision. While a decision is with the server, it stays a decision that the report and the mode allow. A refused decision keeps the report open.

```quint
pure def reportStepAllowed(reportStep: ReportStep, mode: WorkMode, minorReport: bool): bool =
  if (reportStep == ClearMinorStep) (minorReport and mode != RealWithoutService) else mode == RealWithService

pure def reportDecision(reportStep: ReportStep): S::ReportDecision =
  if (reportStep == HoldPersonStep) S::HoldReport
  else if (reportStep == BanPhoneStep or reportStep == BanPersonStep) S::BanReport
  else S::DismissReport

pure def reportOutcome(reportStep: ReportStep): S::ReportPhase =
  S::reportAfterDecision(S::ReportOpen, reportDecision(reportStep), true, true)

pure def canReceiveReport(w: Workspace): bool = w.staff.safety and not(w.report.reportSending)

pure def receiveReport(w: Workspace, minorKind: bool): Workspace =
  { ...w, report: { present: true, status: S::ReportOpen, minorReport: minorKind, noteReady: false, reportSending: false, reportStep: DismissStep } }

pure def reportOpen(w: Workspace): bool = w.report.present and w.report.status == S::ReportOpen

pure def canTypeReportNote(w: Workspace): bool = reportOpen(w) and not(w.report.reportSending)

pure def typeReportNote(w: Workspace, noteChars: int): Workspace = { ...w, report: { ...w.report, noteReady: noteChars >= minReasonChars } }

pure def canActOnReport(w: Workspace, reportStep: ReportStep): bool =
  reportOpen(w) and not(w.report.reportSending) and w.staff.safety and w.report.noteReady
    and reportStepAllowed(reportStep, w.staff.mode, w.report.minorReport)

pure def actOnReport(w: Workspace, reportStep: ReportStep): Workspace =
  { ...w, report: { ...w.report, reportSending: true, reportStep: reportStep } }

pure def canReceiveReportAnswer(w: Workspace): bool = w.report.reportSending

pure def receiveReportAnswer(w: Workspace, accepted: bool): Workspace =
  { ...w, report: { ...w.report, reportSending: false,
    status: if (accepted) reportOutcome(w.report.reportStep) else w.report.status } }

pure def alwaysBanNeedsTheService(w: Workspace): bool =
  (w.report.status == S::ReportBanned or w.report.status == S::ReportHeld) implies (w.report.present and w.staff.mode == RealWithService)

pure def alwaysASentReportDecisionIsAllowed(w: Workspace): bool =
  w.report.reportSending implies
    (w.report.present and reportStepAllowed(w.report.reportStep, w.staff.mode, w.report.minorReport))

pure def alwaysReportDecisionNeedsANote(w: Workspace): bool =
  (w.report.reportSending or w.report.status != S::ReportOpen) implies (w.report.present and w.report.noteReady)

pure def lawClearMinorNeedsAMinorReport(mode: WorkMode): bool = not(reportStepAllowed(ClearMinorStep, mode, false))

pure def lawReadOnlyDataTakesNoReportDecision(reportStep: ReportStep, minorReport: bool): bool =
  not(reportStepAllowed(reportStep, RealWithoutService, minorReport))

pure def lawEveryReportStepLeavesTheOpenStatus(reportStep: ReportStep): bool = reportOutcome(reportStep) != S::ReportOpen

pure val weight_typeReportNote = 3
pure val weight_actOnReport = 3

pure def sometimesReportBanned(w: Workspace): bool = w.report.status == S::ReportBanned
pure def sometimesReportHeld(w: Workspace): bool = w.report.status == S::ReportHeld
pure def sometimesReportDismissed(w: Workspace): bool = w.report.status == S::ReportDismissed
```

## Story: See what members asked for

> As a staff member, I want to filter member requests by their outcome, so that I can see which requests still wait.

### The request segments group the outcomes

The open segment shows requests that probe or wait. The fulfilled segment shows fulfilled and booked requests, because a booked request is a fulfilled request with a booked plan. Every outcome shows in one segment other than all. The none and answered segments show their own outcome. The all segment shows every request. The list starts on the open segment.

```quint
type RequestOutcome = ProbingOutcome | OpenOutcome | FulfilledOutcome | BookedOutcome | NoneOutcome | AnsweredOutcome

pure def requestShown(requestOutcome: RequestOutcome, segment: RequestSegment): bool =
  if (segment == AllSegment) true
  else if (segment == OpenSegment) (requestOutcome == ProbingOutcome or requestOutcome == OpenOutcome)
  else if (segment == FulfilledSegment) (requestOutcome == FulfilledOutcome or requestOutcome == BookedOutcome)
  else if (segment == NoneSegment) requestOutcome == NoneOutcome
  else requestOutcome == AnsweredOutcome

pure def chooseRequestSegment(w: Workspace, segment: RequestSegment): Workspace = { ...w, requestSegment: segment }

pure def lawEveryOutcomeHasASegment(requestOutcome: RequestOutcome): bool =
  requestShown(requestOutcome, OpenSegment) or requestShown(requestOutcome, FulfilledSegment) or requestShown(requestOutcome, NoneSegment)
    or requestShown(requestOutcome, AnsweredSegment)

pure def lawAllShowsEveryOutcome(requestOutcome: RequestOutcome): bool = requestShown(requestOutcome, AllSegment)

pure def sometimesAllRequests(w: Workspace): bool = w.requestSegment == AllSegment
```

## Story: Change the matching switch with a confirmation

> As an admin, I want to turn proactive matching on or off with a second press, so that a single slip does not change matching for an app.

### The switch shows only to an admin who can change it

The config panel shows the switch, its history and the settings in force. A pack lock keeps matching off and shows the lock. Otherwise an admin on a server that can change the switch sees the switch. Other analysts see that only an admin can change it, or that the server is read-only.

```quint
type ConfigControl = SwitchControl | LockedNote | AdminOnlyNote | ReadOnlyNote

pure def configControl(changeable: bool, adminRole: bool, packLocked: bool, matchingOn: bool): ConfigControl =
  if (packLocked and not(matchingOn)) LockedNote
  else if (changeable and adminRole) SwitchControl
  else if (changeable) AdminOnlyNote
  else ReadOnlyNote

pure def switchShown(w: Workspace): bool =
  w.config.phase != ConfigLoading
    and configControl(w.config.changeable, w.staff.admin, w.config.packLocked, w.config.matchingOn) == SwitchControl

pure def canReceiveConfig(w: Workspace): bool = w.staff.analyst and w.config.phase != ConfigSaving

pure def receiveConfig(w: Workspace, matchingEnabled: bool, locked: bool, canChange: bool): Workspace =
  { ...w, config: { phase: ConfigShown, matchingOn: matchingEnabled, packLocked: locked, changeable: canChange, saved: false } }

pure def lawOnlyAdminsGetTheSwitch(changeable: bool, packLocked: bool, matchingOn: bool): bool =
  configControl(changeable, false, packLocked, matchingOn) != SwitchControl
```

### The first press asks for a confirmation and the second press saves

The first press shows a confirmation for a short time. The confirmation ends without a change when that time passes. The second press saves. An accepted save flips the switch. A refused save shows the failure and keeps the old setting, and the admin can press the switch again.

```quint
pure def canPressMatchingSwitch(w: Workspace): bool =
  (w.config.phase == ConfigShown or w.config.phase == ConfigFailed) and switchShown(w)

pure def pressMatchingSwitch(w: Workspace): Workspace = { ...w, config: { ...w.config, phase: ConfigConfirming, saved: false } }

pure def canEndConfirmation(w: Workspace): bool = w.config.phase == ConfigConfirming

pure def endConfirmation(w: Workspace): Workspace = { ...w, config: { ...w.config, phase: ConfigShown } }

pure def canConfirmMatchingSwitch(w: Workspace): bool = w.config.phase == ConfigConfirming and switchShown(w)

pure def confirmMatchingSwitch(w: Workspace): Workspace = { ...w, config: { ...w.config, phase: ConfigSaving } }

pure def canReceiveSwitchAnswer(w: Workspace): bool = w.config.phase == ConfigSaving

pure def receiveSwitchAnswer(w: Workspace, accepted: bool): Workspace =
  { ...w, config: { ...w.config,
    phase: if (accepted) ConfigShown else ConfigFailed, saved: accepted,
    matchingOn: if (accepted) not(w.config.matchingOn) else w.config.matchingOn } }

pure def alwaysSavingNeedsTheSwitch(w: Workspace): bool =
  (w.config.phase == ConfigConfirming or w.config.phase == ConfigSaving) implies switchShown(w)

pure def alwaysConfigNeedsTheAnalystRole(w: Workspace): bool = w.config.phase != ConfigLoading implies w.staff.analyst

pure def stepSwitchChangesOnlyAfterSaving(before: Workspace, via: str, after: Workspace): bool =
  (after.config.matchingOn != before.config.matchingOn and via != "receiveConfig" and via != "receiveViewer")
    implies (via == "receiveSwitchAnswer" and before.config.phase == ConfigSaving)

pure val weight_receiveConfig = 3
pure val weight_pressMatchingSwitch = 3
pure val weight_confirmMatchingSwitch = 3

pure def alwaysSavedSwitchWasShown(w: Workspace): bool = w.config.saved implies (w.staff.admin and w.config.changeable)

pure def sometimesSwitchSaved(w: Workspace): bool = w.config.saved
pure def sometimesSwitchRefused(w: Workspace): bool = w.config.phase == ConfigFailed
```

## Story: Read the audit log as an admin

> As an admin, I want to read the staff audit log by actor or target, so that I can check every staff read and action.

### Only an admin loads the audit log

The admin enters an actor, a target or both, and loads the rows. The server logs each load. A failed load shows its error.

```quint
pure def canLoadAudit(w: Workspace): bool = w.staff.admin and w.audit != AuditLoading

pure def loadAudit(w: Workspace): Workspace = { ...w, audit: AuditLoading }

pure def canReceiveAudit(w: Workspace): bool = w.audit == AuditLoading

pure def receiveAudit(w: Workspace, loaded: bool): Workspace = { ...w, audit: if (loaded) AuditShown else AuditFailed }

pure def alwaysAuditLogNeedsAnAdmin(w: Workspace): bool = w.audit != AuditClosed implies w.staff.admin

pure def sometimesAuditShown(w: Workspace): bool = w.audit == AuditShown
```

## Story: Play the simulated world

> As a staff member with a simulation role, I want to propose introductions and change the world in the simulated mode only, so that no real member is touched.

### The propose tray sends a proposal for two to six adults with a spark left

The tray shows in the simulated world to a viewer with a simulation role while the viewer has picks. The proposal form shows from two picks, also when Propose is off, so that staff see why. Two picks make an intro, and more than two picks make a group. A proposal needs two to six picks, no member under 18, a spark left and a game that is not over. One proposal is on its way at a time.

```quint
pure val minProposalPicks: int = 2

pure def proposalFormShown(pickCount: int): bool = pickCount >= minProposalPicks

pure def groupProposal(pickCount: int): bool = pickCount > minProposalPicks

pure def proposeAllowed(pickCount: int, minorPicked: bool, sparksLeft: int, gameOver: bool): bool =
  proposalFormShown(pickCount) and pickCount <= 6 and not(minorPicked) and sparksLeft > 0 and not(gameOver)

pure def lawProposalNeedsTheForm(pickCount: int, minorPicked: bool, sparksLeft: int, gameOver: bool): bool =
  proposeAllowed(pickCount, minorPicked, sparksLeft, gameOver) implies proposalFormShown(pickCount)

pure def lawAGroupShowsTheForm(pickCount: int): bool = groupProposal(pickCount) implies proposalFormShown(pickCount)

pure def trayShown(staff: StaffView, pickCount: int): bool = staff.mode == SimulatedWorld and staff.simRole and pickCount > 0

pure def canSubmitProposal(w: Workspace, pickCount: int, minorPicked: bool, sparksLeft: int, gameOver: bool): bool =
  w.tray != TraySending and trayShown(w.staff, pickCount) and proposeAllowed(pickCount, minorPicked, sparksLeft, gameOver)

pure def submitProposal(w: Workspace, pickCount: int, minorPicked: bool, sparksLeft: int, gameOver: bool): Workspace =
  { ...w, tray: TraySending }

pure def canReceiveProposalAnswer(w: Workspace): bool = w.tray == TraySending

pure def receiveProposalAnswer(w: Workspace, accepted: bool): Workspace = { ...w, tray: if (accepted) TrayProposed else TrayIdle }

pure def lawMinorsAreNeverProposed(pickCount: int, sparksLeft: int, gameOver: bool): bool =
  not(proposeAllowed(pickCount, true, sparksLeft, gameOver))

pure def alwaysTrayWorkIsSimulated(w: Workspace): bool =
  w.tray != TrayIdle implies (w.staff.mode == SimulatedWorld and w.staff.simRole)

pure val weight_submitProposal = 3

pure def sometimesProposed(w: Workspace): bool = w.tray == TrayProposed
```

### The world menu exists only in the simulated world

The world menu of a member makes the persona go silent, flake on the next meeting, or text STOP. It opens only in the simulated world for a viewer with a simulation role. A choice closes the menu.

```quint
type WorldEvent = GoSilent | ForceFlake | TextStop

pure def worldMenuShown(staff: StaffView): bool = staff.mode == SimulatedWorld and staff.simRole

pure def canOpenWorldMenu(w: Workspace): bool = worldMenuShown(w.staff) and not(w.worldMenuOpen)

pure def openWorldMenu(w: Workspace): Workspace = { ...w, worldMenuOpen: true }

pure def canCloseWorldMenu(w: Workspace): bool = w.worldMenuOpen

pure def closeWorldMenu(w: Workspace): Workspace = { ...w, worldMenuOpen: false }

pure def canSendWorldEvent(w: Workspace, worldEvent: WorldEvent): bool = w.worldMenuOpen and worldMenuShown(w.staff)

pure def sendWorldEvent(w: Workspace, worldEvent: WorldEvent): Workspace = { ...w, worldMenuOpen: false, worldEventSent: true }

pure def alwaysWorldMenuIsSimulated(w: Workspace): bool =
  (w.worldMenuOpen or w.worldEventSent) implies (w.staff.mode == SimulatedWorld and w.staff.simRole)

pure def sometimesWorldEventSent(w: Workspace): bool = w.worldEventSent
```

## Story: Reveal one member's private data with a logged reason

> As a safety staff member, I want to reveal one member's names and own words for a short time with a reason, so that I can judge a case while every reveal stays on record.

### A reveal needs real data, the safety role and a reason

The reveal control shows on real data to a safety viewer when the server does not already show all data. The form needs a reason of five characters or more and a length of 5, 10 or 15 minutes. The length is always one of these three; the form starts at 15 minutes. Cancel closes the form. A reveal shows only after the server grants it. The server records the reason before it grants the reveal. A refused reveal keeps the form open.

```quint
pure def revealOffered(staff: StaffView): bool = staff.safety and staff.mode != SimulatedWorld and not(staff.globalPii)

pure def canStartReveal(w: Workspace): bool = revealOffered(w.staff) and w.reveal.phase == RevealHidden

pure def startReveal(w: Workspace): Workspace = { ...w, reveal: { phase: RevealDrafting, reasonReady: false, minutes: maxRevealMinutes } }

pure def canTypeRevealReason(w: Workspace): bool = w.reveal.phase == RevealDrafting

pure def typeRevealReason(w: Workspace, reasonChars: int): Workspace =
  { ...w, reveal: { ...w.reveal, reasonReady: reasonChars >= minReasonChars } }

pure val revealMinuteChoices: Set[int] = Set(5, 10, 15)

pure def canChooseRevealMinutes(w: Workspace, minutes: int): bool =
  w.reveal.phase == RevealDrafting and revealMinuteChoices.contains(minutes)

pure val minutesValues: Set[int] = Set(0, 5, 10, 15, 16)

pure def chooseRevealMinutes(w: Workspace, minutes: int): Workspace = { ...w, reveal: { ...w.reveal, minutes: minutes } }

pure def canCancelReveal(w: Workspace): bool = w.reveal.phase == RevealDrafting

pure def cancelReveal(w: Workspace): Workspace = { ...w, reveal: { ...w.reveal, phase: RevealHidden } }

pure def canSubmitReveal(w: Workspace): bool =
  w.reveal.phase == RevealDrafting and w.reveal.reasonReady and revealOffered(w.staff)

pure def submitReveal(w: Workspace): Workspace = { ...w, reveal: { ...w.reveal, phase: RevealSending } }

pure def canReceiveRevealAnswer(w: Workspace): bool = w.reveal.phase == RevealSending

pure def receiveRevealAnswer(w: Workspace, granted: bool): Workspace =
  { ...w, reveal: { ...w.reveal, phase: if (granted) RevealGranted else RevealDrafting } }

pure def alwaysRevealHasAReasonAndALimit(w: Workspace): bool =
  (w.reveal.phase == RevealSending or w.reveal.phase == RevealGranted)
    implies (w.reveal.reasonReady and revealMinuteChoices.contains(w.reveal.minutes) and revealOffered(w.staff))

pure def alwaysRevealLengthIsAChoice(w: Workspace): bool = revealMinuteChoices.contains(w.reveal.minutes)

pure def stepRevealFollowsAGrant(before: Workspace, via: str, after: Workspace): bool =
  (after.reveal.phase == RevealGranted and before.reveal.phase != RevealGranted)
    implies (via == "receiveRevealAnswer" and before.reveal.phase == RevealSending)

pure val weight_typeRevealReason = 3
pure val weight_submitReveal = 3
```

### A reveal ends early on request or when its time passes

The staff member can end a reveal before its time. The server logs the early end. A reveal also ends when its time passes.

```quint
pure def canEndReveal(w: Workspace): bool = w.reveal.phase == RevealGranted

pure def endReveal(w: Workspace): Workspace = { ...w, reveal: { ...w.reveal, phase: RevealHidden } }

pure def canExpireReveal(w: Workspace): bool = w.reveal.phase == RevealGranted

pure def expireReveal(w: Workspace): Workspace = { ...w, reveal: { ...w.reveal, phase: RevealHidden } }

pure def sometimesRevealGranted(w: Workspace): bool = w.reveal.phase == RevealGranted
```
