# Staff console navigation

The staff console (`apps/observatory/web`) has one top bar, one page, one stage, one inspector and one drawer. This spec owns where a staff member is: the page (one app, all apps, one person across apps, or no role), the stage (map or graph), the inspector subject and its history, the search box, the picks, and which drawer tab shows. The [snapshot spec](observatorySync.md) owns the data reads. The [permissions spec](staffPermissions.md) owns the server's role checks. The [sign-in spec](staffSignIn.md) owns the sign-in phases before the viewer is known. The [review spec](staffReview.md) owns the review card. The [workspace spec](consoleWorkspace.md) owns the work inside each panel. The shell owns the URL hash, the browser history, local storage, keyboard events and the map and graph renderers. The conversation search reads only the Network's own messages and system events, never the words of a member.

The shell builds the navigation state again on each render (`store.nav()`), so it does not call `receiveViewer`, `canReceiveViewer` or `afterModeChange`: it applies `pageForViewer` to the stored page, and a mode change goes through `switchMode` or `receiveModeChange`. The store applies `receiveQueues` to the queue facts, `dropMissingSubjects` after new data, and `pickHit` when staff open a search hit. These definitions are model-only helpers that the generated guards call: `allAppsAllowed`, `onAppPage`, `stageShown`, `withFocus`, `shownTab` and `typeQuery`. The store gets the query class from the search text with `queryClass`, which is the class that `typeQuery` writes. The console frame shows the stage from the generated `viewFor`.

## Story: Know which page I am on

> As a staff member, I want the console to show me only the pages that my roles cover, so that I never see an empty or refused page.

### The viewer answer selects a page that the roles cover

The console does not know the viewer until the server answers. A viewer with no app role and no cross-app role sees the no-role page. A viewer with only the cross-app role sees the all-apps page. A person page stays open only for a cross-app viewer in real mode. The all-apps page stays open only for a viewer with roles for two or more apps, or with the cross-app role. Every other viewer sees the app page. A global admin holds a role for every app and the cross-app role. A real-only server never shows the simulated mode. A viewer answer in another mode clears the subject and its history. A new viewer keeps the picks only when it can play in the simulated world in the same mode.

```quint
type ConsolePage = AppPage | AllAppsPage | PersonPage | NoRolePage
type ConsoleMode = SimulatedMode | RealMode
type ConsoleStage = MapStage | GraphStage
type Subject = Overview | NeighborhoodSubject | MemberSubject | OpportunitySubject
type DrawerTab = ReviewTab | FeedTab | PipelineTab | RequestsTab | EngineTab | SafetyTab | MetricsTab | LabTab | ConfigTab | GameTab
type Viewer = {
  known: bool, mode: ConsoleMode, appsHeld: int, crossApp: bool,
  admin: bool, analyst: bool, simRole: bool, safety: bool, realOnly: bool,
}
type QueueFacts = { reviewItems: bool, requestsKnown: bool }
type ConsoleNav = {
  page: ConsolePage, stage: ConsoleStage, subject: Subject, depth: int,
  wantedTab: DrawerTab, drawerOpen: bool, popoverOpen: bool, queryChars: int, picks: int,
  viewer: Viewer, queues: QueueFacts,
}

pure val maxFocusHistory: int = 20
pure val maxPicks: int = 6

pure val initial: ConsoleNav = {
  page: AppPage, stage: MapStage, subject: Overview, depth: 0,
  wantedTab: FeedTab, drawerOpen: true, popoverOpen: false, queryChars: 0, picks: 0,
  viewer: {
    known: false, mode: SimulatedMode, appsHeld: 0, crossApp: false,
    admin: false, analyst: false, simRole: false, safety: false, realOnly: false,
  },
  queues: { reviewItems: false, requestsKnown: false },
}

pure def allAppsAllowed(heldApps: int, crossAppRole: bool): bool = heldApps >= 2 or crossAppRole

pure def pageForViewer(page: ConsolePage, heldApps: int, crossAppRole: bool, viewMode: ConsoleMode): ConsolePage =
  if (heldApps <= 0 and not(crossAppRole)) NoRolePage
  else if (page == PersonPage and crossAppRole and viewMode == RealMode) PersonPage
  else if (heldApps <= 0) AllAppsPage
  else if ((page == AllAppsPage or page == PersonPage) and allAppsAllowed(heldApps, crossAppRole)) AllAppsPage
  else AppPage

pure def canReceiveViewer(nav: ConsoleNav, viewMode: ConsoleMode, heldApps: int, crossAppRole: bool, adminRole: bool,
  realOnlyServer: bool): bool =
  heldApps >= 0 and not(realOnlyServer and viewMode == SimulatedMode)
    and (adminRole implies (crossAppRole and heldApps >= 2))

pure def receiveViewer(nav: ConsoleNav, viewMode: ConsoleMode, heldApps: int, crossAppRole: bool, adminRole: bool,
  analystRole: bool, simRoleHeld: bool, safetyRole: bool, realOnlyServer: bool): ConsoleNav =
  val playable = viewMode == SimulatedMode and (simRoleHeld or adminRole)
  val sameMode = nav.viewer.mode == viewMode
  { ...nav,
    page: pageForViewer(nav.page, heldApps, crossAppRole, viewMode),
    subject: if (sameMode) nav.subject else Overview,
    depth: if (sameMode) nav.depth else 0,
    picks: if (playable and sameMode) nav.picks else 0,
    viewer: {
      known: true, mode: viewMode, appsHeld: heldApps, crossApp: crossAppRole, admin: adminRole,
      analyst: analystRole or adminRole, simRole: simRoleHeld or adminRole, safety: safetyRole or adminRole,
      realOnly: realOnlyServer,
    },
  }

pure def lawViewerPageIsCovered(page: ConsolePage, heldApps: int, crossAppRole: bool, viewMode: ConsoleMode): bool =
  val chosen = pageForViewer(page, heldApps, crossAppRole, viewMode)
  (chosen == AppPage implies heldApps > 0)
    and (chosen == AllAppsPage implies allAppsAllowed(heldApps, crossAppRole))
    and (chosen == PersonPage implies (crossAppRole and viewMode == RealMode))
    and ((chosen == NoRolePage) iff (heldApps <= 0 and not(crossAppRole)))

pure def alwaysAppPageNeedsAnApp(nav: ConsoleNav): bool =
  (nav.viewer.known and nav.page == AppPage) implies nav.viewer.appsHeld > 0

pure def alwaysAllAppsPageNeedsTwoAppsOrCrossApp(nav: ConsoleNav): bool =
  nav.page == AllAppsPage implies (nav.viewer.known and allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp))

pure def alwaysNoRolePageOnlyWithoutRoles(nav: ConsoleNav): bool =
  nav.page == NoRolePage implies (nav.viewer.known and nav.viewer.appsHeld <= 0 and not(nav.viewer.crossApp))

pure def alwaysPersonPageNeedsCrossAppInReal(nav: ConsoleNav): bool =
  nav.page == PersonPage implies (nav.viewer.known and nav.viewer.crossApp and nav.viewer.mode == RealMode)

pure def alwaysAdminHoldsEveryRole(nav: ConsoleNav): bool =
  nav.viewer.admin implies (nav.viewer.crossApp and nav.viewer.appsHeld >= 2 and nav.viewer.analyst
    and nav.viewer.simRole and nav.viewer.safety)

pure def alwaysRealOnlyServerStaysReal(nav: ConsoleNav): bool =
  nav.viewer.realOnly implies nav.viewer.mode == RealMode
```

### The app switcher opens one app or the all-apps page

The switcher lists only the apps that the viewer holds a role for. The switcher and its "all" choice show when the viewer holds roles for two or more apps, or holds the cross-app role. A change to another app clears the subject, its history and the picks. A choice of the app that shows keeps them.

```quint
pure def canOpenAllApps(nav: ConsoleNav): bool =
  nav.viewer.known and allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp)

pure def openAllApps(nav: ConsoleNav): ConsoleNav = { ...nav, page: AllAppsPage }

pure def canSelectApp(nav: ConsoleNav): bool = nav.viewer.known and nav.viewer.appsHeld > 0

pure def selectApp(nav: ConsoleNav, sameApp: bool): ConsoleNav =
  if (sameApp) { ...nav, page: AppPage }
  else { ...nav, page: AppPage, subject: Overview, depth: 0, picks: 0 }

pure def switcherShown(nav: ConsoleNav): bool = nav.viewer.known and allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp)

pure def sometimesAllAppsPage(nav: ConsoleNav): bool = nav.page == AllAppsPage
pure def sometimesNoRolePage(nav: ConsoleNav): bool = nav.page == NoRolePage
```

### Only a cross-app viewer in real mode opens one person across apps

The person page reads the platform schema, which exists only in real mode. The viewer opens it from the person lookup on the all-apps page or from the member inspector. The person lookup shows only to a cross-app viewer in real mode. Close returns to the all-apps page.

```quint
pure def canOpenPerson(nav: ConsoleNav): bool =
  nav.viewer.known and nav.viewer.crossApp and nav.viewer.mode == RealMode and nav.page != NoRolePage

pure def openPerson(nav: ConsoleNav): ConsoleNav = { ...nav, page: PersonPage }

pure def canClosePerson(nav: ConsoleNav): bool = nav.page == PersonPage

pure def closePerson(nav: ConsoleNav): ConsoleNav = { ...nav, page: AllAppsPage }

pure def personLookupShown(nav: ConsoleNav): bool =
  nav.page == AllAppsPage and nav.viewer.crossApp and nav.viewer.mode == RealMode

pure def sometimesPersonPage(nav: ConsoleNav): bool = nav.page == PersonPage
```

### A mode change clears the subject and the picks

Only a global admin on a server that is not real-only can switch between the simulated world and real data. The server can also announce a mode change. After either change, the console shows the overview with no picks. The game tab is replaced by the feed in real mode. A person page closes to the all-apps page when the mode becomes simulated.

```quint
pure def afterModeChange(viewMode: ConsoleMode, nav: ConsoleNav): ConsoleNav =
  { ...nav,
    viewer: { ...nav.viewer, mode: viewMode },
    picks: 0, subject: Overview, depth: 0,
    wantedTab: if (viewMode == RealMode and nav.wantedTab == GameTab) FeedTab else nav.wantedTab,
    page: if (nav.page == PersonPage and viewMode == SimulatedMode) AllAppsPage else nav.page,
  }

pure def modeSwitchShown(nav: ConsoleNav): bool = nav.viewer.known and nav.viewer.admin and not(nav.viewer.realOnly)

pure def canSwitchMode(nav: ConsoleNav, viewMode: ConsoleMode): bool =
  modeSwitchShown(nav) and viewMode != nav.viewer.mode

pure def switchMode(nav: ConsoleNav, viewMode: ConsoleMode): ConsoleNav = afterModeChange(viewMode, nav)

pure def canReceiveModeChange(nav: ConsoleNav, viewMode: ConsoleMode): bool =
  nav.viewer.known and viewMode != nav.viewer.mode and not(nav.viewer.realOnly and viewMode == SimulatedMode)

pure def receiveModeChange(nav: ConsoleNav, viewMode: ConsoleMode): ConsoleNav = afterModeChange(viewMode, nav)

pure def stepModeChangeClearsSubject(before: ConsoleNav, after: ConsoleNav): bool =
  after.viewer.mode != before.viewer.mode implies (after.subject == Overview and after.depth == 0 and after.picks == 0)

pure def sometimesRealMode(nav: ConsoleNav): bool = nav.viewer.known and nav.viewer.mode == RealMode
```

### The console view follows the page

Before the viewer is known, the console shows the loading view. The app page shows the filter bar, the stage, the inspector and the drawer. The other pages cover the stage and hide the filter bar and the drawer.

```quint
type ConsoleView = LoadingView | NoRoleView | AllAppsView | PersonView | WorkspaceView

pure def viewFor(nav: ConsoleNav): ConsoleView =
  if (not(nav.viewer.known)) LoadingView
  else if (nav.page == NoRolePage) NoRoleView
  else if (nav.page == AllAppsPage) AllAppsView
  else if (nav.page == PersonPage) PersonView
  else WorkspaceView

pure def onAppPage(nav: ConsoleNav): bool = viewFor(nav) == WorkspaceView

pure def stageShown(nav: ConsoleNav): bool = onAppPage(nav)

pure def lawOnlyTheAppPageShowsTheStage(page: ConsolePage): bool =
  stageShown({ ...initial, page: page, viewer: { ...initial.viewer, known: true } }) iff page == AppPage

pure def lawNothingShowsBeforeTheViewer(page: ConsolePage): bool =
  viewFor({ ...initial, page: page }) == LoadingView
```

## Story: Follow one subject

> As a staff member, I want one subject to drive the inspector and every panel, so that I can move between a member, an opportunity and a neighborhood and come back.

### Focus on a new subject keeps the last one in a short history

The inspector shows the overview, a neighborhood, a member or an opportunity. A focus on the subject already shown changes nothing. A focus from the overview starts no history. A focus from another subject adds that subject to the history. The history keeps at most twenty subjects. A step through a list (the review keys) replaces the subject without history.

```quint
pure def withFocus(target: Subject, nav: ConsoleNav, sameAsShown: bool): ConsoleNav =
  if (sameAsShown) nav
  else { ...nav, subject: target,
    depth: if (nav.subject == Overview) nav.depth
      else if (nav.depth >= maxFocusHistory) maxFocusHistory else nav.depth + 1 }

pure def canFocusOn(nav: ConsoleNav, target: Subject, sameAsShown: bool): bool =
  onAppPage(nav) and target != Overview and (sameAsShown implies target == nav.subject)

pure def focusOn(nav: ConsoleNav, target: Subject, sameAsShown: bool): ConsoleNav = withFocus(target, nav, sameAsShown)

pure def canReplaceFocus(nav: ConsoleNav, target: Subject): bool = onAppPage(nav) and target != Overview

pure def replaceFocus(nav: ConsoleNav, target: Subject): ConsoleNav = { ...nav, subject: target }

pure def stepFocusAddsAtMostOneEntry(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  (via == "focusOn" or via == "pickHit") implies (after.depth == before.depth or after.depth == before.depth + 1)

pure def alwaysHistoryIsBounded(nav: ConsoleNav): bool = nav.depth >= 0 and nav.depth <= maxFocusHistory

pure def alwaysOverviewHasNoHistory(nav: ConsoleNav): bool = nav.subject == Overview implies nav.depth == 0

pure def sometimesMemberShown(nav: ConsoleNav): bool = nav.subject == MemberSubject
pure def sometimesOpportunityShown(nav: ConsoleNav): bool = nav.subject == OpportunitySubject
pure def sometimesNeighborhoodShown(nav: ConsoleNav): bool = nav.subject == NeighborhoodSubject
pure def sometimesHistoryHasTwo(nav: ConsoleNav): bool = nav.depth >= 2
```

### Back returns to the last subject and clear returns to the overview

Back shows on the app page only while the history holds a subject. Clear empties the history. A new snapshot drops a subject that no longer exists and removes the missing subjects from the history.

```quint
pure def backShown(nav: ConsoleNav): bool = onAppPage(nav) and nav.depth > 0

pure def canGoBack(nav: ConsoleNav, previous: Subject): bool = backShown(nav) and previous != Overview

pure def goBack(nav: ConsoleNav, previous: Subject): ConsoleNav = { ...nav, subject: previous, depth: nav.depth - 1 }

pure def canClearFocus(nav: ConsoleNav): bool = nav.subject != Overview

pure def clearFocus(nav: ConsoleNav): ConsoleNav = { ...nav, subject: Overview, depth: 0 }

pure def canDropMissingSubjects(nav: ConsoleNav, droppedEntries: int): bool =
  droppedEntries >= 0 and droppedEntries <= nav.depth

pure def dropMissingSubjects(nav: ConsoleNav, subjectExists: bool, droppedEntries: int): ConsoleNav =
  if (subjectExists) { ...nav, depth: nav.depth - droppedEntries }
  else { ...nav, subject: Overview, depth: 0 }

pure def sometimesBackAfterHistory(nav: ConsoleNav): bool = backShown(nav) and nav.subject != Overview
```

### Escape closes one thing at a time

The help key opens and closes the help menu. Escape first closes an open menu. Then it clears the search text. Then it clears the picks. Then it clears the subject and its history.

```quint
pure def toggleHelp(nav: ConsoleNav): ConsoleNav = { ...nav, popoverOpen: not(nav.popoverOpen) }

pure def pressEscape(nav: ConsoleNav): ConsoleNav =
  if (nav.popoverOpen) { ...nav, popoverOpen: false }
  else if (nav.queryChars > 0) { ...nav, queryChars: 0 }
  else if (nav.picks > 0) { ...nav, picks: 0 }
  else { ...nav, subject: Overview, depth: 0 }

pure def stepEscapeKeepsSubjectWhileSomethingIsOpen(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  (via == "pressEscape" and (before.popoverOpen or before.queryChars > 0 or before.picks > 0))
    implies (after.subject == before.subject and after.depth == before.depth)

pure def stepEscapeClosesTheMenuFirst(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  (via == "pressEscape" and before.popoverOpen)
    implies (not(after.popoverOpen) and after.queryChars == before.queryChars and after.picks == before.picks)
```

### Search offers names and places from two characters and ids from three

The shell keeps the search text and sends its length class: 0, 1, 2, or 3 for three or more characters. The box offers members and neighborhoods from two characters, and opportunity ids from three. A viewer with the safety role can also search the conversations from two characters. The search box shows only on the app page. A chosen hit moves the focus and clears the search text.

```quint
type HitGroups = NoHits | NamesAndPlaces | NamesPlacesAndIds

pure def queryClass(characters: int): int =
  if (characters <= 0) 0 else if (characters >= 3) 3 else characters

pure def hitGroups(queryChars: int): HitGroups =
  if (queryChars >= 3) NamesPlacesAndIds else if (queryChars >= 2) NamesAndPlaces else NoHits

pure def conversationSearchShown(safetyRole: bool, queryChars: int): bool = safetyRole and queryChars >= 2

pure def searchShown(nav: ConsoleNav): bool = onAppPage(nav)

pure def canTypeQuery(nav: ConsoleNav): bool = searchShown(nav)

pure def typeQuery(nav: ConsoleNav, characters: int): ConsoleNav = { ...nav, queryChars: queryClass(characters) }

pure def canPickHit(nav: ConsoleNav, target: Subject, sameAsShown: bool): bool =
  searchShown(nav) and nav.queryChars >= 2 and target != Overview and (sameAsShown implies target == nav.subject)

pure def pickHit(nav: ConsoleNav, target: Subject, sameAsShown: bool): ConsoleNav =
  val focused = withFocus(target, nav, sameAsShown)
  { ...focused, queryChars: 0 }

pure def lawIdsNeedThreeCharacters(characters: int): bool =
  (hitGroups(queryClass(characters)) == NamesPlacesAndIds) iff characters >= 3

pure def lawNamesNeedTwoCharacters(characters: int): bool =
  (hitGroups(queryClass(characters)) == NoHits) iff characters < 2

pure def alwaysQueryClassIsBounded(nav: ConsoleNav): bool = nav.queryChars >= 0 and nav.queryChars <= 3

pure def sometimesIdsOffered(nav: ConsoleNav): bool = searchShown(nav) and hitGroups(nav.queryChars) == NamesPlacesAndIds
```

### Picks exist only for a viewer who plays the simulated world

A viewer with a simulation role picks two to six members for a proposal on the app page in the simulated world. A member under 18 cannot be picked. A pick that is already made can always be removed. A pick of a seventh member drops the oldest one, so the count stays at six.

```quint
pure def canTogglePick(nav: ConsoleNav, alreadyPicked: bool, minorMember: bool): bool =
  onAppPage(nav) and nav.viewer.mode == SimulatedMode and nav.viewer.simRole
    and (if (alreadyPicked) nav.picks > 0 else not(minorMember))

pure def togglePick(nav: ConsoleNav, alreadyPicked: bool, minorMember: bool): ConsoleNav =
  { ...nav, picks: if (alreadyPicked) nav.picks - 1 else if (nav.picks >= maxPicks) maxPicks else nav.picks + 1 }

pure def alwaysPicksNeedTheSimulatedWorld(nav: ConsoleNav): bool =
  nav.picks > 0 implies (nav.viewer.mode == SimulatedMode and nav.viewer.simRole)

pure def alwaysPicksAreBounded(nav: ConsoleNav): bool = nav.picks >= 0 and nav.picks <= maxPicks

pure def sometimesTwoPicks(nav: ConsoleNav): bool = nav.picks >= 2
```

## Story: Use the stage and the drawer

> As a staff member, I want the stage and the drawer to show only the views that apply to my roles and mode, so that I always land on a tab that works.

### The stage shows the map or the graph

The "g" key and the Map and Graph buttons choose the stage. A venue link always opens the map.

```quint
pure def canShowStage(nav: ConsoleNav, target: ConsoleStage): bool = target != nav.stage

pure def showStage(nav: ConsoleNav, target: ConsoleStage): ConsoleNav = { ...nav, stage: target }

pure def canFlyToVenue(nav: ConsoleNav): bool = onAppPage(nav)

pure def flyToVenue(nav: ConsoleNav): ConsoleNav = { ...nav, stage: MapStage }

pure def stepVenueOpensTheMap(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  via == "flyToVenue" implies after.stage == MapStage

pure def sometimesGraphStage(nav: ConsoleNav): bool = nav.stage == GraphStage and onAppPage(nav)
```

### Each drawer tab shows only where it applies

The review tab shows when items wait for staff, in the simulated world and in real mode. The game tab shows only in the simulated world. The requests tab shows when requests exist or the network is a consent network. The lab tab needs the analyst role and a server that is not real-only. The config tab needs the analyst role. An admin holds the analyst role. The feed, pipeline, runs, safety and metrics tabs always show. A wanted tab that does not show falls back to the feed. Changed (owner decisions D15 to D17 of 2026-11-22): the review mode "human" was removed and the review judge holds items for staff in both worlds, so the review tab no longer depends on a review mode.

```quint
type TabFacts = { simulated: bool, analystRole: bool, realOnlyServer: bool, reviewItems: bool, requestsKnown: bool }

pure def tabVisible(tab: DrawerTab, facts: TabFacts): bool =
  if (tab == ReviewTab) facts.reviewItems
  else if (tab == GameTab) facts.simulated
  else if (tab == RequestsTab) facts.requestsKnown
  else if (tab == LabTab) facts.analystRole and not(facts.realOnlyServer)
  else if (tab == ConfigTab) facts.analystRole
  else true

pure def shownTab(wanted: DrawerTab, facts: TabFacts): DrawerTab = if (tabVisible(wanted, facts)) wanted else FeedTab

pure def factsOf(nav: ConsoleNav): TabFacts = {
  simulated: nav.viewer.mode == SimulatedMode, analystRole: nav.viewer.analyst, realOnlyServer: nav.viewer.realOnly,
  reviewItems: nav.queues.reviewItems, requestsKnown: nav.queues.requestsKnown,
}

pure def tabNow(nav: ConsoleNav): DrawerTab = shownTab(nav.wantedTab, factsOf(nav))

pure def canReceiveQueues(nav: ConsoleNav): bool = nav.viewer.known

pure def receiveQueues(nav: ConsoleNav, reviewItems: bool, requestsKnown: bool): ConsoleNav =
  { ...nav, queues: { reviewItems: reviewItems, requestsKnown: requestsKnown } }

pure val factsValues: Set[TabFacts] = Set(
  { simulated: true, analystRole: true, realOnlyServer: false, reviewItems: false, requestsKnown: true },
  { simulated: true, analystRole: false, realOnlyServer: false, reviewItems: true, requestsKnown: false },
  { simulated: false, analystRole: true, realOnlyServer: true, reviewItems: true, requestsKnown: true },
  { simulated: false, analystRole: false, realOnlyServer: false, reviewItems: false, requestsKnown: false },
)

pure def lawShownTabIsVisible(wanted: DrawerTab, facts: TabFacts): bool = tabVisible(shownTab(wanted, facts), facts)

pure def lawFeedAlwaysShows(facts: TabFacts): bool = tabVisible(FeedTab, facts)

pure def lawGameTabNeedsTheSimulatedWorld(facts: TabFacts): bool = tabVisible(GameTab, facts) iff facts.simulated

pure def lawLabNeedsAnAnalystOffARealOnlyServer(facts: TabFacts): bool =
  tabVisible(LabTab, facts) iff (facts.analystRole and not(facts.realOnlyServer))
```

### A tab choice opens the drawer, and the open tab collapses it

A click on another tab shows that tab and opens the drawer. A click on the tab that shows while the drawer is open collapses the drawer. An alert or a count on the overview opens its tab. The collapse button opens or closes the drawer.

```quint
pure def canChooseTab(nav: ConsoleNav, tab: DrawerTab): bool = onAppPage(nav) and tabVisible(tab, factsOf(nav))

pure def chooseTab(nav: ConsoleNav, tab: DrawerTab): ConsoleNav =
  { ...nav, wantedTab: tab, drawerOpen: tabNow(nav) != tab or not(nav.drawerOpen) }

pure def canJumpToTab(nav: ConsoleNav, tab: DrawerTab): bool = onAppPage(nav) and tabVisible(tab, factsOf(nav))

pure def jumpToTab(nav: ConsoleNav, tab: DrawerTab): ConsoleNav = { ...nav, wantedTab: tab, drawerOpen: true }

pure def canToggleDrawer(nav: ConsoleNav): bool = onAppPage(nav)

pure def toggleDrawer(nav: ConsoleNav): ConsoleNav = { ...nav, drawerOpen: not(nav.drawerOpen) }

pure def stepJumpOpensTheDrawer(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  via == "jumpToTab" implies after.drawerOpen

pure def stepChosenTabShowsUnlessItCollapses(before: ConsoleNav, via: str, after: ConsoleNav): bool =
  (via == "chooseTab" and after.drawerOpen) implies tabVisible(after.wantedTab, factsOf(after))

pure def sometimesLabTabShows(nav: ConsoleNav): bool = onAppPage(nav) and nav.drawerOpen and tabNow(nav) == LabTab
pure def sometimesGameTabShows(nav: ConsoleNav): bool = onAppPage(nav) and nav.drawerOpen and tabNow(nav) == GameTab
pure def sometimesReviewTabShows(nav: ConsoleNav): bool = onAppPage(nav) and nav.drawerOpen and tabNow(nav) == ReviewTab
pure def sometimesDrawerCollapsed(nav: ConsoleNav): bool = onAppPage(nav) and not(nav.drawerOpen)
```

### The filter bar dims the filters that do not apply to the open tab

The review tab uses the borough, members, origin and domains filters. The feed uses all but the state filter. The pipeline uses every filter. The runs tab uses the range and domains filters. The safety and requests tabs use the range, borough, members and domains filters. The metrics tab uses the range, borough, origin and domains filters. The lab, config and game tabs use no filter. While the drawer is open, the filter bar dims each filter that the tab that shows does not use. While the drawer is collapsed, no filter is dimmed.

```quint
type FilterKey = RangeKey | BoroughKey | MembersKey | OriginKey | StateKey | DomainsKey

pure def filterApplies(tab: DrawerTab, filterKey: FilterKey): bool =
  if (tab == ReviewTab) (filterKey == BoroughKey or filterKey == MembersKey or filterKey == OriginKey or filterKey == DomainsKey)
  else if (tab == FeedTab) filterKey != StateKey
  else if (tab == PipelineTab) true
  else if (tab == EngineTab) (filterKey == RangeKey or filterKey == DomainsKey)
  else if (tab == SafetyTab or tab == RequestsTab) (filterKey == RangeKey or filterKey == BoroughKey or filterKey == MembersKey or filterKey == DomainsKey)
  else if (tab == MetricsTab) (filterKey == RangeKey or filterKey == BoroughKey or filterKey == OriginKey or filterKey == DomainsKey)
  else false

pure def filterDimmed(drawerOpen: bool, tab: DrawerTab, filterKey: FilterKey): bool =
  drawerOpen and not(filterApplies(tab, filterKey))

pure def lawToolTabsUseNoFilter(filterKey: FilterKey): bool =
  not(filterApplies(LabTab, filterKey)) and not(filterApplies(ConfigTab, filterKey)) and not(filterApplies(GameTab, filterKey))

pure def lawPipelineUsesEveryFilter(filterKey: FilterKey): bool = filterApplies(PipelineTab, filterKey)

pure def lawCollapsedDrawerDimsNothing(tab: DrawerTab, filterKey: FilterKey): bool = not(filterDimmed(false, tab, filterKey))
```
