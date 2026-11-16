# Staff console analysis panels

The staff console (`packages/observatory/web`) has drawer panels that show numbers and let staff run the simulated world. This spec owns what these panels show in each data state and which controls they offer: the lab, the runs tab and its run comparison, the metrics tab with the bias monitor, the cost and the growth sections, the feed, the pipeline, and the game tab with its levels. The [workspace spec](consoleWorkspace.md) owns the loading, refused, unavailable, failed and empty rows of a panel, and the roles that open the lab and the bias monitor. The [navigation spec](consoleNavigation.md) owns which tab shows and the filters of each tab. The shell owns the fetches, the timers, the number formats and the server data. The server checks every role again and refuses the lab and the game on a real-only server.

## Story: Use the analysis panels only where my mode and role allow

> As a staff member, I want the analysis panels to offer a control only in the mode and to the role that can use it, so that I never start a simulation or change the world from real data.

### A new viewer or mode starts every analysis panel again

The panels know three modes: the simulated world, real data with the Network service, and real data without it. Real data without the service is read-only. A real-only server never shows the simulated world. An admin holds the analyst role and a simulation role. A new viewer answer or a mode change closes the lab form, the run comparison, the feed segment and the game state.

```quint
import consoleWorkspace as W from "./consoleWorkspace"

type PanelMode = SimulatedPanels | RealActing | RealReadOnly
type PanelStaff = { mode: PanelMode, analyst: bool, admin: bool, simRole: bool, realOnlyServer: bool }
type LabPhase = LabWaiting | LabOff | LabReady | LabStarting | LabStartRefused
type LabState = { phase: LabPhase, runCount: int, activeRuns: bool }
type DiffPhase = NoDiff | DiffLoading | DiffShown | DiffFailed
type RunCompare = { runTotal: int, comparing: bool, picked: int, diff: DiffPhase }
type FeedSegment = AllEvents | PeopleEvents | SafetyEvents | SystemEvents | MineEvents
type GamePanel = { present: bool, over: bool, levelPlaying: bool, resetSent: bool, levelChecked: bool }
type ConsolePanels = { staff: PanelStaff, lab: LabState, runs: RunCompare, feedSegment: FeedSegment, game: GamePanel }

pure val initial: ConsolePanels = {
  staff: { mode: RealReadOnly, analyst: false, admin: false, simRole: false, realOnlyServer: false },
  lab: { phase: LabWaiting, runCount: 0, activeRuns: false },
  runs: { runTotal: 0, comparing: false, picked: 0, diff: NoDiff },
  feedSegment: AllEvents,
  game: { present: false, over: false, levelPlaying: false, resetSent: false, levelChecked: false },
}

pure def canReceiveViewer(p: ConsolePanels, viewMode: PanelMode, realOnly: bool): bool =
  not(realOnly and viewMode == SimulatedPanels)

pure def receiveViewer(p: ConsolePanels, viewMode: PanelMode, analystRole: bool, adminRole: bool, simRoleHeld: bool,
  realOnly: bool): ConsolePanels =
  { ...initial,
    staff: { mode: viewMode, analyst: analystRole or adminRole, admin: adminRole, simRole: simRoleHeld or adminRole,
      realOnlyServer: realOnly } }

pure def alwaysAdminHoldsAnalystAndSimRole(p: ConsolePanels): bool =
  p.staff.admin implies (p.staff.analyst and p.staff.simRole)

pure def alwaysRealOnlyServerShowsRealData(p: ConsolePanels): bool =
  p.staff.realOnlyServer implies p.staff.mode != SimulatedPanels

pure def stepNewViewerStartsThePanelsAgain(before: ConsolePanels, via: str, after: ConsolePanels): bool =
  via == "receiveViewer" implies (after.lab == initial.lab and after.runs == initial.runs
    and after.feedSegment == AllEvents and after.game == initial.game)
```

### Panel writes exist only in the simulated world

A lab run, a world reset, a level choice and a level check change only the simulated world. The panels offer them only in the simulated world. Real data, with or without the Network service, gets no write from these panels.

```quint
pure def panelWritesOffered(staff: PanelStaff): bool = staff.mode == SimulatedPanels

pure val panelStaffValues: Set[PanelStaff] = Set(
  { mode: SimulatedPanels, analyst: true, admin: true, simRole: true, realOnlyServer: false },
  { mode: SimulatedPanels, analyst: false, admin: false, simRole: true, realOnlyServer: false },
  { mode: RealActing, analyst: true, admin: false, simRole: false, realOnlyServer: true },
  { mode: RealReadOnly, analyst: true, admin: true, simRole: true, realOnlyServer: false },
)

pure def lawRealDataOffersNoPanelWrite(panelStaff: PanelStaff): bool =
  panelStaff.mode != SimulatedPanels implies not(panelWritesOffered(panelStaff))

pure def lawRealOnlyServerOffersNoPanelWrite(panelStaff: PanelStaff): bool =
  (panelStaff.realOnlyServer and panelStaff.mode != SimulatedPanels) implies not(panelWritesOffered(panelStaff))
```

## Story: Run simulation experiments in the lab

> As an analyst, I want to start background runs of the experiment arms and read their safety counts, so that I can compare the arms without touching real members.

### The lab shows its runs, or says that it is off

The [workspace spec](consoleWorkspace.md) decides the loading, refused and failed rows of the lab. After an answer, a server with the lab off shows that the lab is off. The count of runs is never below zero. A lab with no runs shows the empty row. Otherwise the lab shows its runs, newest first, and the results of the run that staff chose, or of the newest run. While a run waits or runs, the lab reads its runs again every 3 seconds.

```quint
type LabBody = LabOffView | LabEmptyView | LabRunsView

pure def labBody(labOn: bool, runCount: int): LabBody =
  if (not(labOn)) LabOffView else if (runCount <= 0) LabEmptyView else LabRunsView

pure def labPolls(lab: LabState): bool = lab.activeRuns or lab.phase == LabStarting

pure def canReceiveLab(p: ConsolePanels, runCount: int): bool =
  p.staff.analyst and p.lab.phase != LabStarting and runCount >= 0

pure def receiveLab(p: ConsolePanels, labOn: bool, runCount: int, activeRuns: bool): ConsolePanels =
  { ...p, lab: { phase: if (labOn) LabReady else LabOff, runCount: runCount, activeRuns: labOn and activeRuns and runCount > 0 } }

pure def alwaysLabNeedsTheAnalystRole(p: ConsolePanels): bool = p.lab.phase != LabWaiting implies p.staff.analyst

pure def alwaysActiveRunsAreRuns(p: ConsolePanels): bool = p.lab.activeRuns implies p.lab.runCount > 0

pure def alwaysRunCountIsNeverNegative(p: ConsolePanels): bool = p.lab.runCount >= 0

pure val weight_receiveLab = 3

pure def sometimesLabOff(p: ConsolePanels): bool = p.lab.phase == LabOff
pure def sometimesLabPolls(p: ConsolePanels): bool = p.lab.phase == LabReady and labPolls(p.lab)
```

### A lab run starts only in the simulated world with a valid request

A request names one to three arms, one to five seeds and one to sixty days. The start control shows only to an analyst in the simulated world while the lab is on. One start is on its way at a time. An accepted start adds a run that waits. A refused start shows the error and keeps the form.

```quint
pure val maxLabArms: int = 3
pure val maxLabSeeds: int = 5
pure val maxLabDays: int = 60

pure def labRequestValid(armCount: int, seedCount: int, days: int): bool =
  armCount >= 1 and armCount <= maxLabArms and seedCount >= 1 and seedCount <= maxLabSeeds and days >= 1 and days <= maxLabDays

pure def labStartShown(p: ConsolePanels): bool =
  p.staff.analyst and panelWritesOffered(p.staff) and (p.lab.phase == LabReady or p.lab.phase == LabStartRefused)

pure def canStartLab(p: ConsolePanels, armCount: int, seedCount: int, days: int): bool =
  labStartShown(p) and labRequestValid(armCount, seedCount, days)

pure def startLab(p: ConsolePanels, armCount: int, seedCount: int, days: int): ConsolePanels =
  { ...p, lab: { ...p.lab, phase: LabStarting } }

pure def canReceiveLabStart(p: ConsolePanels): bool = p.lab.phase == LabStarting

pure def receiveLabStart(p: ConsolePanels, accepted: bool): ConsolePanels =
  if (accepted) { ...p, lab: { phase: LabReady, runCount: p.lab.runCount + 1, activeRuns: true } }
  else { ...p, lab: { ...p.lab, phase: LabStartRefused } }

pure def lawLabRequestNeedsAnArm(seedCount: int, days: int): bool = not(labRequestValid(0, seedCount, days))

pure def lawLabRequestIsBounded(armCount: int, seedCount: int, days: int): bool =
  labRequestValid(armCount, seedCount, days) implies (seedCount <= maxLabSeeds and days <= maxLabDays and armCount <= maxLabArms)

pure def alwaysLabStartIsSimulated(p: ConsolePanels): bool =
  p.lab.phase == LabStarting implies (p.staff.analyst and p.staff.mode == SimulatedPanels)

pure val weight_startLab = 3
pure val weight_receiveLabStart = 3

pure def sometimesLabStartRefused(p: ConsolePanels): bool = p.lab.phase == LabStartRefused
```

### A lab result marks each safety count

Each result row shows the judge invariants, the canary leaks and the minor contacts of one arm and seed. A count that is not known yet shows a dash. A zero count shows as good. A count above zero shows as an alarm.

```quint
type CountMark = CountUnknown | CountZero | CountAlarm

pure def countMark(known: bool, count: int): CountMark =
  if (not(known)) CountUnknown else if (count > 0) CountAlarm else CountZero

pure def lawEveryKnownPositiveCountIsAnAlarm(count: int): bool = (countMark(true, count) == CountAlarm) iff count > 0
```

## Story: Compare two matching runs

> As a staff member, I want to pick two matching runs and see what changed between them, so that I can see the effect of an engine change.

### The runs tab shows a run, asks for two runs, or shows their difference

With no run in the range, the tab shows the empty row. Out of compare, it shows the chosen run, the run of the focused opportunity, or the newest run. In compare, it asks for two runs until two are picked. Then it loads the difference, and shows it or the error. The older of the two runs is A.

```quint
type RunsView = NoRunsView | RunDetailView | PickTwoView | DiffLoadingView | DiffShownView | DiffFailedView

pure def runsView(r: RunCompare): RunsView =
  if (r.runTotal <= 0) NoRunsView
  else if (not(r.comparing)) RunDetailView
  else if (r.picked < 2 or r.diff == NoDiff) PickTwoView
  else if (r.diff == DiffLoading) DiffLoadingView
  else if (r.diff == DiffShown) DiffShownView
  else DiffFailedView

pure def canReceiveRuns(p: ConsolePanels, runTotal: int): bool = runTotal >= 0

pure def receiveRuns(p: ConsolePanels, runTotal: int): ConsolePanels =
  if (runTotal < 2) { ...p, runs: { runTotal: runTotal, comparing: false, picked: 0, diff: NoDiff } }
  else { ...p, runs: { ...p.runs, runTotal: runTotal } }

pure val weight_receiveRuns = 3

pure def sometimesRunDetail(p: ConsolePanels): bool = runsView(p.runs) == RunDetailView
pure def sometimesPickTwo(p: ConsolePanels): bool = runsView(p.runs) == PickTwoView
```

### Compare opens only with two runs, and a third pick drops the oldest

The compare control shows when the range holds two runs or more, and while compare is open. Opening or closing compare clears the picks. A pick that is already made can always be removed. A third pick drops the oldest pick, so two runs stay picked. A list with fewer than two runs closes compare.

```quint
pure val maxRunPicks: int = 2

pure def compareShown(p: ConsolePanels): bool = p.runs.comparing or p.runs.runTotal >= 2

pure def canToggleCompare(p: ConsolePanels): bool = compareShown(p)

pure def toggleCompare(p: ConsolePanels): ConsolePanels =
  { ...p, runs: { ...p.runs, comparing: not(p.runs.comparing), picked: 0, diff: NoDiff } }

pure def canPickRun(p: ConsolePanels, alreadyPicked: bool): bool =
  p.runs.comparing and (if (alreadyPicked) p.runs.picked > 0 else p.runs.picked < p.runs.runTotal)

pure def pickRun(p: ConsolePanels, alreadyPicked: bool): ConsolePanels =
  val pickCount = if (alreadyPicked) p.runs.picked - 1 else if (p.runs.picked >= maxRunPicks) maxRunPicks else p.runs.picked + 1
  { ...p, runs: { ...p.runs, picked: pickCount, diff: if (pickCount == maxRunPicks) DiffLoading else NoDiff } }

pure def alwaysPicksAreAtMostTwo(p: ConsolePanels): bool =
  p.runs.picked >= 0 and p.runs.picked <= maxRunPicks and p.runs.picked <= p.runs.runTotal

pure def alwaysCompareNeedsTwoRuns(p: ConsolePanels): bool = p.runs.comparing implies p.runs.runTotal >= 2

pure def alwaysPicksNeedCompare(p: ConsolePanels): bool = p.runs.picked > 0 implies p.runs.comparing

pure val weight_toggleCompare = 3
pure val weight_pickRun = 5
```

### The difference loads once two runs are picked

A difference loads only for two picked runs. A new pick starts a new load. A difference table hides a measure that is zero in both runs.

```quint
pure def canReceiveDiff(p: ConsolePanels): bool = p.runs.diff == DiffLoading

pure def receiveDiff(p: ConsolePanels, loaded: bool): ConsolePanels =
  { ...p, runs: { ...p.runs, diff: if (loaded) DiffShown else DiffFailed } }

pure def diffRowShown(valueA: int, valueB: int): bool = valueA != 0 or valueB != 0

pure def alwaysDiffNeedsTwoPicks(p: ConsolePanels): bool =
  p.runs.diff != NoDiff implies (p.runs.comparing and p.runs.picked == maxRunPicks)

pure def lawZeroMeasureIsHidden(valueA: int, valueB: int): bool =
  not(diffRowShown(valueA, valueB)) iff (valueA == 0 and valueB == 0)

pure val weight_receiveDiff = 3

pure def sometimesDiffShown(p: ConsolePanels): bool = runsView(p.runs) == DiffShownView
pure def sometimesDiffFailed(p: ConsolePanels): bool = runsView(p.runs) == DiffFailedView
pure def sometimesDiffLoading(p: ConsolePanels): bool = runsView(p.runs) == DiffLoadingView
```

## Story: Read the health numbers of an app

> As a staff member, I want the metrics tab to mark each number that misses its target, so that I see a problem without reading every number.

### The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data

The simulated world knows the hidden truth, so only it shows the precision and the unsafe proposals that the truth gives. The bias monitor and the cost section read real data. They follow the bias monitor role rule of the [workspace spec](consoleWorkspace.md): the analyst role and real data.

```quint
type MetricsSection = TruthSection | BiasSection | CostSection

pure def workStaff(staff: PanelStaff): W::StaffView = {
  mode: if (staff.mode == SimulatedPanels) W::SimulatedWorld else if (staff.mode == RealActing) W::RealWithService else W::RealWithoutService,
  safety: false, admin: staff.admin, analyst: staff.analyst, simRole: staff.simRole, globalPii: false,
}

pure def metricsSectionShown(section: MetricsSection, staff: PanelStaff): bool =
  if (section == TruthSection) staff.mode == SimulatedPanels
  else W::panelAllowed(W::BiasPanel, workStaff(staff))

pure def lawTruthAndRealDataNeverMeet(panelStaff: PanelStaff): bool =
  not(metricsSectionShown(TruthSection, panelStaff) and metricsSectionShown(CostSection, panelStaff))

pure def lawCostNeedsTheAnalystRole(panelStaff: PanelStaff): bool =
  metricsSectionShown(CostSection, panelStaff) implies panelStaff.analyst
```

### The bias monitor alerts below 0.8 times the outcome of everyone

The shell gives each outcome ratio in hundredths, rounded down. A group with a ratio under 80 hundredths shows as an alert in the table and in the alert list. A report with no such group says that no group is under 0.8x.

```quint
type BiasSummary = NoGroupBelowNote | GroupsBelowAlert

pure val biasAlertBelow: int = 80

pure def biasAlert(ratioHundredths: int): bool = ratioHundredths < biasAlertBelow

pure def biasSummary(alertCount: int): BiasSummary = if (alertCount > 0) GroupsBelowAlert else NoGroupBelowNote

pure def lawLowerRatioStaysAnAlert(ratioHundredths: int): bool = biasAlert(ratioHundredths) implies biasAlert(ratioHundredths - 1)

pure def lawEqualOutcomeIsNoAlert(ratioHundredths: int): bool = ratioHundredths >= 100 implies not(biasAlert(ratioHundredths))
```

### A cost budget turns amber at 80 percent and red at 100 percent

The cost section shows the cost of the app and of the shared line today, the use of each daily budget, and a table of days. The shell gives the use of a budget in whole percent, rounded down. The table shows a kind of cost only when a day in the period used it. A failed read shows the error and no number. The server computes the totals.

```quint
type BudgetMark = BudgetOk | BudgetNear | BudgetOver

pure def budgetMark(sharePercent: int): BudgetMark =
  if (sharePercent >= 100) BudgetOver else if (sharePercent >= 80) BudgetNear else BudgetOk

pure def costView(answer: W::PanelAnswer): W::PanelView =
  if (answer == W::NotAnswered) W::PanelLoading
  else if (answer == W::AnswerForbidden) W::PanelForbidden
  else if (answer == W::AnswerRows) W::PanelRows
  else W::PanelFailed

pure def costKindShown(daysWithKind: int): bool = daysWithKind > 0

pure def lawBudgetMarkGrowsWithUse(sharePercent: int): bool =
  (budgetMark(sharePercent) == BudgetOver implies budgetMark(sharePercent + 1) == BudgetOver)
    and (budgetMark(sharePercent) != BudgetOk implies budgetMark(sharePercent + 1) != BudgetOk)

pure def lawRefusedCostShowsNoNumber(answer: W::PanelAnswer): bool =
  costView(answer) == W::PanelRows iff answer == W::AnswerRows
```

### The proactive rate and the inviter share show their targets

The proactive rate is in hundredths of a message per member per week, rounded up. A rate above two messages shows as a warning. The share of members who invited someone is in whole percent, rounded down. A share of 30 percent or more meets the target. A share that is not known shows a dash.

```quint
type ShareMark = ShareUnknown | ShareMet | ShareBelow

pure val maxProactiveHundredths: int = 200
pure val inviterTargetPercent: int = 30

pure def proactiveWarns(rateHundredths: int): bool = rateHundredths > maxProactiveHundredths

pure def inviterMark(known: bool, sharePercent: int): ShareMark =
  if (not(known)) ShareUnknown else if (sharePercent >= inviterTargetPercent) ShareMet else ShareBelow

pure def lawTwoMessagesAWeekDoNotWarn(rateHundredths: int): bool = rateHundredths <= 200 implies not(proactiveWarns(rateHundredths))
```

## Story: Follow events in the feed and the pipeline

> As a staff member, I want to filter the feed by kind of event and see the pipeline by state, so that I find the events and the opportunities that need me.

### The feed segments group the event kinds

The shell puts each event kind in one group: joins, other people events, safety events, system events or other events. The people segment shows joins and other people events. The safety and system segments show their own group. The mine segment shows the events of the player in the simulated world. The all segment shows every event, but it hides joins when the feed holds 60 events or more.

```quint
type EventGroup = JoinGroup | PeopleGroup | SafetyGroup | SystemGroup | OtherGroup

pure val joinsHiddenFrom: int = 60

pure def feedShows(group: EventGroup, segment: FeedSegment, playerEvent: bool, feedSize: int): bool =
  if (segment == AllEvents) not(group == JoinGroup and feedSize >= joinsHiddenFrom)
  else if (segment == PeopleEvents) (group == JoinGroup or group == PeopleGroup)
  else if (segment == SafetyEvents) group == SafetyGroup
  else if (segment == SystemEvents) group == SystemGroup
  else playerEvent

pure def lawPeopleEventsAlwaysShowInAll(feedSize: int): bool = feedShows(PeopleGroup, AllEvents, false, feedSize)

pure def lawSafetyEventsShowInTheSafetySegment(playerEvent: bool, feedSize: int): bool =
  feedShows(SafetyGroup, SafetyEvents, playerEvent, feedSize)
```

### The mine segment exists only in the simulated world

The mine segment shows only in the simulated world. A wanted segment that does not show falls back to all. An empty feed says why: the simulated world waits for play, no event is in the range, or no event matches the filters and the focus.

```quint
type FeedNote = PressPlayNote | NoEventsInRangeNote | NothingMatchesNote

pure def feedSegmentOffered(segment: FeedSegment, staff: PanelStaff): bool =
  segment != MineEvents or staff.mode == SimulatedPanels

pure def feedSegmentNow(segment: FeedSegment, staff: PanelStaff): FeedSegment =
  if (feedSegmentOffered(segment, staff)) segment else AllEvents

pure def feedEmptyNote(feedEmpty: bool, canStep: bool, focused: bool): FeedNote =
  if (feedEmpty) (if (canStep) PressPlayNote else NoEventsInRangeNote)
  else if (focused or canStep) NothingMatchesNote
  else NoEventsInRangeNote

pure def canChooseFeedSegment(p: ConsolePanels, segment: FeedSegment): bool = feedSegmentOffered(segment, p.staff)

pure def chooseFeedSegment(p: ConsolePanels, segment: FeedSegment): ConsolePanels = { ...p, feedSegment: segment }

pure def alwaysMineSegmentIsSimulated(p: ConsolePanels): bool =
  p.feedSegment == MineEvents implies p.staff.mode == SimulatedPanels

pure def lawShownSegmentIsOffered(segment: FeedSegment, panelStaff: PanelStaff): bool =
  feedSegmentOffered(feedSegmentNow(segment, panelStaff), panelStaff)

pure def sometimesMineSegment(p: ConsolePanels): bool = p.feedSegment == MineEvents
```

### The pipeline shows the columns of the state filter, and the ladder of a consent network

The state filter keeps the columns of one state group, or every column. A consent network shows the consent ladder above the columns. A stub network says that it has no consent data. Before the network answers, no ladder shows.

```quint
type StateFilter = AnyState | ReviewStates | OpenStates | MetStates | ClosedStates
type PipelineColumn = ReviewColumn | OpenColumn | MetColumn | ClosedColumn
type LadderView = NoLadder | StubLadderNote | ConsentLadder

pure def columnShown(stateFilter: StateFilter, column: PipelineColumn): bool =
  if (stateFilter == AnyState) true
  else if (stateFilter == ReviewStates) column == ReviewColumn
  else if (stateFilter == OpenStates) column == OpenColumn
  else if (stateFilter == MetStates) column == MetColumn
  else column == ClosedColumn

pure def ladderView(networkKnown: bool, stubNetwork: bool): LadderView =
  if (not(networkKnown)) NoLadder else if (stubNetwork) StubLadderNote else ConsentLadder

pure def lawEveryColumnShowsWithoutAFilter(column: PipelineColumn): bool = columnShown(AnyState, column)

pure def lawAStateFilterKeepsOneColumnGroup(stateFilter: StateFilter): bool =
  stateFilter != AnyState implies not(columnShown(stateFilter, ReviewColumn) and columnShown(stateFilter, ClosedColumn))
```

## Story: Play the game tab and its levels

> As a staff member with a simulation role, I want to see my score, reset the world and check a level in the simulated world only, so that the game never touches real members.

### The game tab shows the score of the simulated world

The game tab has a game only in the simulated world. It shows the scoreboard, the missions, the levels and the player's run. A game with three safety strikes shows that the game is over.

```quint
type GameView = NoGameView | GamePlayingView | GameOverView

pure def gameView(g: GamePanel): GameView =
  if (not(g.present)) NoGameView else if (g.over) GameOverView else GamePlayingView

pure def canReceiveGame(p: ConsolePanels): bool = p.staff.mode == SimulatedPanels

pure def receiveGame(p: ConsolePanels, present: bool, over: bool, levelPlaying: bool): ConsolePanels =
  { ...p, game: { ...p.game, present: present, over: present and over, levelPlaying: present and levelPlaying,
    levelChecked: p.game.levelChecked and present and levelPlaying } }

pure def alwaysGameWorkIsSimulated(p: ConsolePanels): bool =
  (p.game.present or p.game.resetSent or p.game.levelChecked) implies p.staff.mode == SimulatedPanels

pure val weight_receiveGame = 3

pure def sometimesGamePlaying(p: ConsolePanels): bool = gameView(p.game) == GamePlayingView
pure def sometimesGameOver(p: ConsolePanels): bool = gameView(p.game) == GameOverView
```

### Only an admin resets the world, chooses a level or chooses the reviewer

The world reset, the level list and the reviewer switch show only to an admin in the simulated world while a game shows. A reset starts a new world, with a level or in free play, and clears a level check.

```quint
pure def gameControlsShown(p: ConsolePanels): bool =
  panelWritesOffered(p.staff) and p.staff.admin and p.game.present

pure def reviewerSwitchShown(p: ConsolePanels): bool = gameControlsShown(p)

pure def canResetWorld(p: ConsolePanels, chooseLevel: bool): bool = gameControlsShown(p)

pure def resetWorld(p: ConsolePanels, chooseLevel: bool): ConsolePanels =
  { ...p, game: { ...p.game, over: false, levelPlaying: chooseLevel, resetSent: true, levelChecked: false } }

pure def alwaysResetNeedsAnAdmin(p: ConsolePanels): bool = p.game.resetSent implies p.staff.admin

pure def sometimesWorldReset(p: ConsolePanels): bool = p.game.resetSent and p.game.levelPlaying
```

### A player checks the level that plays

The check control shows to a viewer with a simulation role while a level plays. Free play has no check.

```quint
pure def levelCheckShown(p: ConsolePanels): bool =
  panelWritesOffered(p.staff) and p.staff.simRole and p.game.present and p.game.levelPlaying

pure def canCheckLevel(p: ConsolePanels): bool = levelCheckShown(p)

pure def checkLevel(p: ConsolePanels): ConsolePanels = { ...p, game: { ...p.game, levelChecked: true } }

pure def alwaysLevelCheckNeedsALevel(p: ConsolePanels): bool =
  p.game.levelChecked implies (p.game.levelPlaying and p.staff.simRole)

pure def sometimesLevelChecked(p: ConsolePanels): bool = p.game.levelChecked
```
