// GENERATED from spec/consoleNavigation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export interface QueueFacts { reviewItems: boolean; requestsKnown: boolean }
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export type ConsoleMode = "SimulatedMode" | "RealMode";
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export type ConsoleStage = "MapStage" | "GraphStage";
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export type ConsolePage = "AppPage" | "AllAppsPage" | "PersonPage" | "NoRolePage";
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export type Subject = "Overview" | "NeighborhoodSubject" | "MemberSubject" | "OpportunitySubject";
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export type DrawerTab = "ReviewTab" | "FeedTab" | "PipelineTab" | "RequestsTab" | "EngineTab" | "SafetyTab" | "MetricsTab" | "LabTab" | "ConfigTab" | "GameTab";
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export interface Viewer { known: boolean; mode: ConsoleMode; appsHeld: number; crossApp: boolean; admin: boolean; analyst: boolean; simRole: boolean; safety: boolean; realOnly: boolean }
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export interface ConsoleNav { page: ConsolePage; stage: ConsoleStage; subject: Subject; depth: number; wantedTab: DrawerTab; drawerOpen: boolean; popoverOpen: boolean; queryChars: number; picks: number; viewer: Viewer; queues: QueueFacts }
/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
export type ConsoleView = "LoadingView" | "NoRoleView" | "AllAppsView" | "PersonView" | "WorkspaceView";
/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
export type HitGroups = "NoHits" | "NamesAndPlaces" | "NamesPlacesAndIds";
/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
export interface TabFacts { simulated: boolean; analystRole: boolean; realOnlyServer: boolean; reviewItems: boolean; requestsKnown: boolean }
/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
export type FilterKey = "RangeKey" | "BoroughKey" | "MembersKey" | "OriginKey" | "StateKey";

/** One variant per transition in the spec. */
export type Event =
  | { type: "receiveViewer"; viewMode: ConsoleMode; heldApps: number; crossAppRole: boolean; adminRole: boolean; analystRole: boolean; simRoleHeld: boolean; safetyRole: boolean; realOnlyServer: boolean }
  | { type: "openAllApps" }
  | { type: "selectApp"; sameApp: boolean }
  | { type: "openPerson" }
  | { type: "closePerson" }
  | { type: "switchMode"; viewMode: ConsoleMode }
  | { type: "receiveModeChange"; viewMode: ConsoleMode }
  | { type: "replaceFocus"; target: Subject }
  | { type: "focusOn"; target: Subject; sameAsShown: boolean }
  | { type: "goBack"; previous: Subject }
  | { type: "clearFocus" }
  | { type: "dropMissingSubjects"; subjectExists: boolean; droppedEntries: number }
  | { type: "toggleHelp" }
  | { type: "pressEscape" }
  | { type: "typeQuery"; characters: number }
  | { type: "pickHit"; target: Subject; sameAsShown: boolean }
  | { type: "togglePick"; alreadyPicked: boolean; minorMember: boolean }
  | { type: "showStage"; target: ConsoleStage }
  | { type: "flyToVenue" }
  | { type: "receiveQueues"; reviewItems: boolean; requestsKnown: boolean }
  | { type: "jumpToTab"; tab: DrawerTab }
  | { type: "toggleDrawer" }
  | { type: "chooseTab"; tab: DrawerTab };

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export const maxFocusHistory: number = 20;
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export const maxPicks: number = 6;
/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
export const initial: ConsoleNav = { page: "AppPage", stage: "MapStage", subject: "Overview", depth: 0, wantedTab: "FeedTab", drawerOpen: true, popoverOpen: false, queryChars: 0, picks: 0, viewer: ({ known: false, mode: "SimulatedMode", appsHeld: 0, crossApp: false, admin: false, analyst: false, simRole: false, safety: false, realOnly: false } as Viewer), queues: ({ reviewItems: false, requestsKnown: false } as QueueFacts) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ConsoleNav): boolean {
  return alwaysAppPageNeedsAnApp(current) && alwaysAllAppsPageNeedsTwoAppsOrCrossApp(current) && alwaysNoRolePageOnlyWithoutRoles(current) && alwaysPersonPageNeedsCrossAppInReal(current) && alwaysAdminHoldsEveryRole(current) && alwaysRealOnlyServerStaysReal(current) && alwaysHistoryIsBounded(current) && alwaysOverviewHasNoHistory(current) && alwaysQueryClassIsBounded(current) && alwaysPicksNeedTheSimulatedWorld(current) && alwaysPicksAreBounded(current);
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function allAppsAllowed(heldApps: number, crossAppRole: boolean): boolean {
  return heldApps >= 2 || crossAppRole;
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function pageForViewer(page: ConsolePage, heldApps: number, crossAppRole: boolean, viewMode: ConsoleMode): ConsolePage {
  return heldApps <= 0 && !crossAppRole ? "NoRolePage" : (page === "PersonPage" && crossAppRole && viewMode === "RealMode" ? "PersonPage" : (heldApps <= 0 ? "AllAppsPage" : ((page === "AllAppsPage" || page === "PersonPage") && allAppsAllowed(heldApps, crossAppRole) ? "AllAppsPage" : "AppPage")));
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function canReceiveViewer(nav: ConsoleNav, viewMode: ConsoleMode, heldApps: number, crossAppRole: boolean, adminRole: boolean, realOnlyServer: boolean): boolean {
  return heldApps >= 0 && !(realOnlyServer && viewMode === "SimulatedMode") && (!adminRole || (crossAppRole && heldApps >= 2));
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function receiveViewer(nav: ConsoleNav, viewMode: ConsoleMode, heldApps: number, crossAppRole: boolean, adminRole: boolean, analystRole: boolean, simRoleHeld: boolean, safetyRole: boolean, realOnlyServer: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepFocusAddsAtMostOneEntry(nav, "receiveViewer", \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "receiveViewer", \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepEscapeClosesTheMenuFirst(nav, "receiveViewer", \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepVenueOpensTheMap(nav, "receiveViewer", \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepJumpOpensTheDrawer(nav, "receiveViewer", \result)
  //@ ensures (inv(nav) && canReceiveViewer(nav, viewMode, heldApps, crossAppRole, adminRole, realOnlyServer)) ==> stepChosenTabShowsUnlessItCollapses(nav, "receiveViewer", \result)
  const local_0 = viewMode === "SimulatedMode" && (simRoleHeld || adminRole);
  const local_1 = nav.viewer.mode === viewMode;
  return { ...nav, page: pageForViewer(nav.page, heldApps, crossAppRole, viewMode), subject: local_1 ? nav.subject : "Overview", depth: local_1 ? nav.depth : 0, picks: local_0 && local_1 ? nav.picks : 0, viewer: ({ known: true, mode: viewMode, appsHeld: heldApps, crossApp: crossAppRole, admin: adminRole, analyst: analystRole || adminRole, simRole: simRoleHeld || adminRole, safety: safetyRole || adminRole, realOnly: realOnlyServer } as Viewer) };
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysAppPageNeedsAnApp(nav: ConsoleNav): boolean {
  return !(nav.viewer.known && nav.page === "AppPage") || nav.viewer.appsHeld > 0;
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysAllAppsPageNeedsTwoAppsOrCrossApp(nav: ConsoleNav): boolean {
  return !(nav.page === "AllAppsPage") || (nav.viewer.known && allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp));
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysNoRolePageOnlyWithoutRoles(nav: ConsoleNav): boolean {
  return !(nav.page === "NoRolePage") || (nav.viewer.known && nav.viewer.appsHeld <= 0 && !nav.viewer.crossApp);
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysPersonPageNeedsCrossAppInReal(nav: ConsoleNav): boolean {
  return !(nav.page === "PersonPage") || (nav.viewer.known && nav.viewer.crossApp && nav.viewer.mode === "RealMode");
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysAdminHoldsEveryRole(nav: ConsoleNav): boolean {
  return !nav.viewer.admin || (nav.viewer.crossApp && nav.viewer.appsHeld >= 2 && nav.viewer.analyst && nav.viewer.simRole && nav.viewer.safety);
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function alwaysRealOnlyServerStaysReal(nav: ConsoleNav): boolean {
  return !nav.viewer.realOnly || nav.viewer.mode === "RealMode";
}

/** Story: Know which page I am on / The viewer answer selects a page that the roles cover (spec/consoleNavigation.md) */
//@ pure
export function lawViewerPageIsCovered(page: ConsolePage, heldApps: number, crossAppRole: boolean, viewMode: ConsoleMode): boolean {
  //@ ensures \result === true
  const local_2: ConsolePage = pageForViewer(page, heldApps, crossAppRole, viewMode);
  return (!(local_2 === "AppPage") || heldApps > 0) && (!(local_2 === "AllAppsPage") || allAppsAllowed(heldApps, crossAppRole)) && (!(local_2 === "PersonPage") || (crossAppRole && viewMode === "RealMode")) && (local_2 === "NoRolePage") === (heldApps <= 0 && !crossAppRole);
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function canOpenAllApps(nav: ConsoleNav): boolean {
  return nav.viewer.known && allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp);
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function openAllApps(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "openAllApps", \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "openAllApps", \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "openAllApps", \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepVenueOpensTheMap(nav, "openAllApps", \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepJumpOpensTheDrawer(nav, "openAllApps", \result)
  //@ ensures (inv(nav) && canOpenAllApps(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "openAllApps", \result)
  return { ...nav, page: "AllAppsPage" };
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function canSelectApp(nav: ConsoleNav): boolean {
  return nav.viewer.known && nav.viewer.appsHeld > 0;
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function selectApp(nav: ConsoleNav, sameApp: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "selectApp", \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "selectApp", \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "selectApp", \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepVenueOpensTheMap(nav, "selectApp", \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepJumpOpensTheDrawer(nav, "selectApp", \result)
  //@ ensures (inv(nav) && canSelectApp(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "selectApp", \result)
  return sameApp ? ({ ...nav, page: "AppPage" } as ConsoleNav) : ({ ...nav, page: "AppPage", subject: "Overview", depth: 0, picks: 0 } as ConsoleNav);
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function switcherShown(nav: ConsoleNav): boolean {
  return nav.viewer.known && allAppsAllowed(nav.viewer.appsHeld, nav.viewer.crossApp);
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function sometimesAllAppsPage(nav: ConsoleNav): boolean {
  return nav.page === "AllAppsPage";
}

/** Story: Know which page I am on / The app switcher opens one app or the all-apps page (spec/consoleNavigation.md) */
//@ pure
export function sometimesNoRolePage(nav: ConsoleNav): boolean {
  return nav.page === "NoRolePage";
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function canOpenPerson(nav: ConsoleNav): boolean {
  return nav.viewer.known && nav.viewer.crossApp && nav.viewer.mode === "RealMode" && nav.page !== "NoRolePage";
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function openPerson(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "openPerson", \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "openPerson", \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "openPerson", \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepVenueOpensTheMap(nav, "openPerson", \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepJumpOpensTheDrawer(nav, "openPerson", \result)
  //@ ensures (inv(nav) && canOpenPerson(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "openPerson", \result)
  return { ...nav, page: "PersonPage" };
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function canClosePerson(nav: ConsoleNav): boolean {
  return nav.page === "PersonPage";
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function closePerson(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "closePerson", \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "closePerson", \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "closePerson", \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepVenueOpensTheMap(nav, "closePerson", \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepJumpOpensTheDrawer(nav, "closePerson", \result)
  //@ ensures (inv(nav) && canClosePerson(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "closePerson", \result)
  return { ...nav, page: "AllAppsPage" };
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function personLookupShown(nav: ConsoleNav): boolean {
  return nav.page === "AllAppsPage" && nav.viewer.crossApp && nav.viewer.mode === "RealMode";
}

/** Story: Know which page I am on / Only a cross-app viewer in real mode opens one person across apps (spec/consoleNavigation.md) */
//@ pure
export function sometimesPersonPage(nav: ConsoleNav): boolean {
  return nav.page === "PersonPage";
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function stepModeChangeClearsSubject(before: ConsoleNav, after: ConsoleNav): boolean {
  return !(after.viewer.mode !== before.viewer.mode) || (after.subject === "Overview" && after.depth === 0 && after.picks === 0);
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function sometimesRealMode(nav: ConsoleNav): boolean {
  return nav.viewer.known && nav.viewer.mode === "RealMode";
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function afterModeChange(viewMode: ConsoleMode, nav: ConsoleNav): ConsoleNav {
  return { ...nav, viewer: ({ ...nav.viewer, mode: viewMode } as Viewer), picks: 0, subject: "Overview", depth: 0, wantedTab: viewMode === "RealMode" && nav.wantedTab === "GameTab" ? "FeedTab" : nav.wantedTab, page: nav.page === "PersonPage" && viewMode === "SimulatedMode" ? "AllAppsPage" : nav.page };
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function modeSwitchShown(nav: ConsoleNav): boolean {
  return nav.viewer.known && nav.viewer.admin && !nav.viewer.realOnly;
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function canReceiveModeChange(nav: ConsoleNav, viewMode: ConsoleMode): boolean {
  return nav.viewer.known && viewMode !== nav.viewer.mode && !(nav.viewer.realOnly && viewMode === "SimulatedMode");
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function canSwitchMode(nav: ConsoleNav, viewMode: ConsoleMode): boolean {
  return modeSwitchShown(nav) && viewMode !== nav.viewer.mode;
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function switchMode(nav: ConsoleNav, viewMode: ConsoleMode): ConsoleNav {
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepFocusAddsAtMostOneEntry(nav, "switchMode", \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "switchMode", \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepEscapeClosesTheMenuFirst(nav, "switchMode", \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepVenueOpensTheMap(nav, "switchMode", \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepJumpOpensTheDrawer(nav, "switchMode", \result)
  //@ ensures (inv(nav) && canSwitchMode(nav, viewMode)) ==> stepChosenTabShowsUnlessItCollapses(nav, "switchMode", \result)
  return afterModeChange(viewMode, nav);
}

/** Story: Know which page I am on / A mode change clears the subject and the picks (spec/consoleNavigation.md) */
//@ pure
export function receiveModeChange(nav: ConsoleNav, viewMode: ConsoleMode): ConsoleNav {
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepFocusAddsAtMostOneEntry(nav, "receiveModeChange", \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "receiveModeChange", \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepEscapeClosesTheMenuFirst(nav, "receiveModeChange", \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepVenueOpensTheMap(nav, "receiveModeChange", \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepJumpOpensTheDrawer(nav, "receiveModeChange", \result)
  //@ ensures (inv(nav) && canReceiveModeChange(nav, viewMode)) ==> stepChosenTabShowsUnlessItCollapses(nav, "receiveModeChange", \result)
  return afterModeChange(viewMode, nav);
}

/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
//@ pure
export function viewFor(nav: ConsoleNav): ConsoleView {
  return !nav.viewer.known ? "LoadingView" : (nav.page === "NoRolePage" ? "NoRoleView" : (nav.page === "AllAppsPage" ? "AllAppsView" : (nav.page === "PersonPage" ? "PersonView" : "WorkspaceView")));
}

/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
//@ pure
export function onAppPage(nav: ConsoleNav): boolean {
  return viewFor(nav) === "WorkspaceView";
}

/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
//@ pure
export function lawNothingShowsBeforeTheViewer(page: ConsolePage): boolean {
  //@ ensures \result === true
  return viewFor(({ ...initial, page: page } as ConsoleNav)) === "LoadingView";
}

/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
//@ pure
export function stageShown(nav: ConsoleNav): boolean {
  return onAppPage(nav);
}

/** Story: Know which page I am on / The console view follows the page (spec/consoleNavigation.md) */
//@ pure
export function lawOnlyTheAppPageShowsTheStage(page: ConsolePage): boolean {
  //@ ensures \result === true
  return stageShown(({ ...initial, page: page, viewer: ({ ...initial.viewer, known: true } as Viewer) } as ConsoleNav)) === (page === "AppPage");
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function withFocus(target: Subject, nav: ConsoleNav, sameAsShown: boolean): ConsoleNav {
  return sameAsShown ? nav : ({ ...nav, subject: target, depth: nav.subject === "Overview" ? nav.depth : (nav.depth >= maxFocusHistory ? maxFocusHistory : exact_consoleNavigation(nav.depth + 1)) } as ConsoleNav);
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function replaceFocus(nav: ConsoleNav, target: Subject): ConsoleNav {
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepFocusAddsAtMostOneEntry(nav, "replaceFocus", \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "replaceFocus", \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepEscapeClosesTheMenuFirst(nav, "replaceFocus", \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepVenueOpensTheMap(nav, "replaceFocus", \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepJumpOpensTheDrawer(nav, "replaceFocus", \result)
  //@ ensures (inv(nav) && canReplaceFocus(nav, target)) ==> stepChosenTabShowsUnlessItCollapses(nav, "replaceFocus", \result)
  return { ...nav, subject: target };
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function stepFocusAddsAtMostOneEntry(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "focusOn" || via === "pickHit") || (after.depth === before.depth || after.depth === exact_consoleNavigation(before.depth + 1));
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function alwaysHistoryIsBounded(nav: ConsoleNav): boolean {
  return nav.depth >= 0 && nav.depth <= maxFocusHistory;
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function alwaysOverviewHasNoHistory(nav: ConsoleNav): boolean {
  return !(nav.subject === "Overview") || nav.depth === 0;
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function sometimesMemberShown(nav: ConsoleNav): boolean {
  return nav.subject === "MemberSubject";
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function sometimesOpportunityShown(nav: ConsoleNav): boolean {
  return nav.subject === "OpportunitySubject";
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function sometimesNeighborhoodShown(nav: ConsoleNav): boolean {
  return nav.subject === "NeighborhoodSubject";
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function sometimesHistoryHasTwo(nav: ConsoleNav): boolean {
  return nav.depth >= 2;
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function focusOn(nav: ConsoleNav, target: Subject, sameAsShown: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepFocusAddsAtMostOneEntry(nav, "focusOn", \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "focusOn", \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepEscapeClosesTheMenuFirst(nav, "focusOn", \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepVenueOpensTheMap(nav, "focusOn", \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepJumpOpensTheDrawer(nav, "focusOn", \result)
  //@ ensures (inv(nav) && canFocusOn(nav, target, sameAsShown)) ==> stepChosenTabShowsUnlessItCollapses(nav, "focusOn", \result)
  return withFocus(target, nav, sameAsShown);
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function canFocusOn(nav: ConsoleNav, target: Subject, sameAsShown: boolean): boolean {
  return onAppPage(nav) && target !== "Overview" && (!sameAsShown || target === nav.subject);
}

/** Story: Follow one subject / Focus on a new subject keeps the last one in a short history (spec/consoleNavigation.md) */
//@ pure
export function canReplaceFocus(nav: ConsoleNav, target: Subject): boolean {
  return onAppPage(nav) && target !== "Overview";
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function goBack(nav: ConsoleNav, previous: Subject): ConsoleNav {
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepFocusAddsAtMostOneEntry(nav, "goBack", \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "goBack", \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepEscapeClosesTheMenuFirst(nav, "goBack", \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepVenueOpensTheMap(nav, "goBack", \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepJumpOpensTheDrawer(nav, "goBack", \result)
  //@ ensures (inv(nav) && canGoBack(nav, previous)) ==> stepChosenTabShowsUnlessItCollapses(nav, "goBack", \result)
  return { ...nav, subject: previous, depth: exact_consoleNavigation(nav.depth - 1) };
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function canClearFocus(nav: ConsoleNav): boolean {
  return nav.subject !== "Overview";
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function clearFocus(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "clearFocus", \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "clearFocus", \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "clearFocus", \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepVenueOpensTheMap(nav, "clearFocus", \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepJumpOpensTheDrawer(nav, "clearFocus", \result)
  //@ ensures (inv(nav) && canClearFocus(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "clearFocus", \result)
  return { ...nav, subject: "Overview", depth: 0 };
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function canDropMissingSubjects(nav: ConsoleNav, droppedEntries: number): boolean {
  return droppedEntries >= 0 && droppedEntries <= nav.depth;
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function dropMissingSubjects(nav: ConsoleNav, subjectExists: boolean, droppedEntries: number): ConsoleNav {
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepFocusAddsAtMostOneEntry(nav, "dropMissingSubjects", \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "dropMissingSubjects", \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepEscapeClosesTheMenuFirst(nav, "dropMissingSubjects", \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepVenueOpensTheMap(nav, "dropMissingSubjects", \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepJumpOpensTheDrawer(nav, "dropMissingSubjects", \result)
  //@ ensures (inv(nav) && canDropMissingSubjects(nav, droppedEntries)) ==> stepChosenTabShowsUnlessItCollapses(nav, "dropMissingSubjects", \result)
  return subjectExists ? ({ ...nav, depth: exact_consoleNavigation(nav.depth - droppedEntries) } as ConsoleNav) : ({ ...nav, subject: "Overview", depth: 0 } as ConsoleNav);
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function backShown(nav: ConsoleNav): boolean {
  return onAppPage(nav) && nav.depth > 0;
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function canGoBack(nav: ConsoleNav, previous: Subject): boolean {
  return backShown(nav) && previous !== "Overview";
}

/** Story: Follow one subject / Back returns to the last subject and clear returns to the overview (spec/consoleNavigation.md) */
//@ pure
export function sometimesBackAfterHistory(nav: ConsoleNav): boolean {
  return backShown(nav) && nav.subject !== "Overview";
}

/** Story: Follow one subject / Escape closes one thing at a time (spec/consoleNavigation.md) */
//@ pure
export function toggleHelp(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "toggleHelp", \result)
  //@ ensures (inv(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "toggleHelp", \result)
  //@ ensures (inv(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "toggleHelp", \result)
  //@ ensures (inv(nav)) ==> stepVenueOpensTheMap(nav, "toggleHelp", \result)
  //@ ensures (inv(nav)) ==> stepJumpOpensTheDrawer(nav, "toggleHelp", \result)
  //@ ensures (inv(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "toggleHelp", \result)
  return { ...nav, popoverOpen: !nav.popoverOpen };
}

/** Story: Follow one subject / Escape closes one thing at a time (spec/consoleNavigation.md) */
//@ pure
export function pressEscape(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "pressEscape", \result)
  //@ ensures (inv(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "pressEscape", \result)
  //@ ensures (inv(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "pressEscape", \result)
  //@ ensures (inv(nav)) ==> stepVenueOpensTheMap(nav, "pressEscape", \result)
  //@ ensures (inv(nav)) ==> stepJumpOpensTheDrawer(nav, "pressEscape", \result)
  //@ ensures (inv(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "pressEscape", \result)
  return nav.popoverOpen ? ({ ...nav, popoverOpen: false } as ConsoleNav) : (nav.queryChars > 0 ? ({ ...nav, queryChars: 0 } as ConsoleNav) : (nav.picks > 0 ? ({ ...nav, picks: 0 } as ConsoleNav) : ({ ...nav, subject: "Overview", depth: 0 } as ConsoleNav)));
}

/** Story: Follow one subject / Escape closes one thing at a time (spec/consoleNavigation.md) */
//@ pure
export function stepEscapeKeepsSubjectWhileSomethingIsOpen(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "pressEscape" && (before.popoverOpen || before.queryChars > 0 || before.picks > 0)) || (after.subject === before.subject && after.depth === before.depth);
}

/** Story: Follow one subject / Escape closes one thing at a time (spec/consoleNavigation.md) */
//@ pure
export function stepEscapeClosesTheMenuFirst(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "pressEscape" && before.popoverOpen) || (!after.popoverOpen && after.queryChars === before.queryChars && after.picks === before.picks);
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function queryClass(characters: number): number {
  return characters <= 0 ? 0 : (characters >= 3 ? 3 : characters);
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function conversationSearchShown(safetyRole: boolean, queryChars: number): boolean {
  return safetyRole && queryChars >= 2;
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function hitGroups(queryChars: number): HitGroups {
  return queryChars >= 3 ? "NamesPlacesAndIds" : (queryChars >= 2 ? "NamesAndPlaces" : "NoHits");
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function typeQuery(nav: ConsoleNav, characters: number): ConsoleNav {
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "typeQuery", \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "typeQuery", \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "typeQuery", \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepVenueOpensTheMap(nav, "typeQuery", \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepJumpOpensTheDrawer(nav, "typeQuery", \result)
  //@ ensures (inv(nav) && canTypeQuery(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "typeQuery", \result)
  return { ...nav, queryChars: queryClass(characters) };
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function lawIdsNeedThreeCharacters(characters: number): boolean {
  //@ ensures \result === true
  return (hitGroups(queryClass(characters)) === "NamesPlacesAndIds") === characters >= 3;
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function lawNamesNeedTwoCharacters(characters: number): boolean {
  //@ ensures \result === true
  return (hitGroups(queryClass(characters)) === "NoHits") === characters < 2;
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function alwaysQueryClassIsBounded(nav: ConsoleNav): boolean {
  return nav.queryChars >= 0 && nav.queryChars <= 3;
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function searchShown(nav: ConsoleNav): boolean {
  return onAppPage(nav);
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function pickHit(nav: ConsoleNav, target: Subject, sameAsShown: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepFocusAddsAtMostOneEntry(nav, "pickHit", \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "pickHit", \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepEscapeClosesTheMenuFirst(nav, "pickHit", \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepVenueOpensTheMap(nav, "pickHit", \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepJumpOpensTheDrawer(nav, "pickHit", \result)
  //@ ensures (inv(nav) && canPickHit(nav, target, sameAsShown)) ==> stepChosenTabShowsUnlessItCollapses(nav, "pickHit", \result)
  const local_3: ConsoleNav = withFocus(target, nav, sameAsShown);
  return { ...local_3, queryChars: 0 };
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function canTypeQuery(nav: ConsoleNav): boolean {
  return searchShown(nav);
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function canPickHit(nav: ConsoleNav, target: Subject, sameAsShown: boolean): boolean {
  return searchShown(nav) && nav.queryChars >= 2 && target !== "Overview" && (!sameAsShown || target === nav.subject);
}

/** Story: Follow one subject / Search offers names and places from two characters and ids from three (spec/consoleNavigation.md) */
//@ pure
export function sometimesIdsOffered(nav: ConsoleNav): boolean {
  return searchShown(nav) && hitGroups(nav.queryChars) === "NamesPlacesAndIds";
}

/** Story: Follow one subject / Picks exist only for a viewer who plays the simulated world (spec/consoleNavigation.md) */
//@ pure
export function togglePick(nav: ConsoleNav, alreadyPicked: boolean, minorMember: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepFocusAddsAtMostOneEntry(nav, "togglePick", \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "togglePick", \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepEscapeClosesTheMenuFirst(nav, "togglePick", \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepVenueOpensTheMap(nav, "togglePick", \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepJumpOpensTheDrawer(nav, "togglePick", \result)
  //@ ensures (inv(nav) && canTogglePick(nav, alreadyPicked, minorMember)) ==> stepChosenTabShowsUnlessItCollapses(nav, "togglePick", \result)
  return { ...nav, picks: alreadyPicked ? exact_consoleNavigation(nav.picks - 1) : (nav.picks >= maxPicks ? maxPicks : exact_consoleNavigation(nav.picks + 1)) };
}

/** Story: Follow one subject / Picks exist only for a viewer who plays the simulated world (spec/consoleNavigation.md) */
//@ pure
export function alwaysPicksNeedTheSimulatedWorld(nav: ConsoleNav): boolean {
  return !(nav.picks > 0) || (nav.viewer.mode === "SimulatedMode" && nav.viewer.simRole);
}

/** Story: Follow one subject / Picks exist only for a viewer who plays the simulated world (spec/consoleNavigation.md) */
//@ pure
export function alwaysPicksAreBounded(nav: ConsoleNav): boolean {
  return nav.picks >= 0 && nav.picks <= maxPicks;
}

/** Story: Follow one subject / Picks exist only for a viewer who plays the simulated world (spec/consoleNavigation.md) */
//@ pure
export function sometimesTwoPicks(nav: ConsoleNav): boolean {
  return nav.picks >= 2;
}

/** Story: Follow one subject / Picks exist only for a viewer who plays the simulated world (spec/consoleNavigation.md) */
//@ pure
export function canTogglePick(nav: ConsoleNav, alreadyPicked: boolean, minorMember: boolean): boolean {
  return onAppPage(nav) && nav.viewer.mode === "SimulatedMode" && nav.viewer.simRole && (alreadyPicked ? nav.picks > 0 : !minorMember);
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function canShowStage(nav: ConsoleNav, target: ConsoleStage): boolean {
  return target !== nav.stage;
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function showStage(nav: ConsoleNav, target: ConsoleStage): ConsoleNav {
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepFocusAddsAtMostOneEntry(nav, "showStage", \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "showStage", \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepEscapeClosesTheMenuFirst(nav, "showStage", \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepVenueOpensTheMap(nav, "showStage", \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepJumpOpensTheDrawer(nav, "showStage", \result)
  //@ ensures (inv(nav) && canShowStage(nav, target)) ==> stepChosenTabShowsUnlessItCollapses(nav, "showStage", \result)
  return { ...nav, stage: target };
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function flyToVenue(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "flyToVenue", \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "flyToVenue", \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "flyToVenue", \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepVenueOpensTheMap(nav, "flyToVenue", \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepJumpOpensTheDrawer(nav, "flyToVenue", \result)
  //@ ensures (inv(nav) && canFlyToVenue(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "flyToVenue", \result)
  return { ...nav, stage: "MapStage" };
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function stepVenueOpensTheMap(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "flyToVenue") || after.stage === "MapStage";
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function canFlyToVenue(nav: ConsoleNav): boolean {
  return onAppPage(nav);
}

/** Story: Use the stage and the drawer / The stage shows the map or the graph (spec/consoleNavigation.md) */
//@ pure
export function sometimesGraphStage(nav: ConsoleNav): boolean {
  return nav.stage === "GraphStage" && onAppPage(nav);
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function tabVisible(tab: DrawerTab, facts: TabFacts): boolean {
  return tab === "ReviewTab" ? facts.reviewItems : (tab === "GameTab" ? facts.simulated : (tab === "RequestsTab" ? facts.requestsKnown : (tab === "LabTab" ? facts.analystRole && !facts.realOnlyServer : (tab === "ConfigTab" ? facts.analystRole : true))));
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function shownTab(wanted: DrawerTab, facts: TabFacts): DrawerTab {
  return tabVisible(wanted, facts) ? wanted : "FeedTab";
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function factsOf(nav: ConsoleNav): TabFacts {
  return { simulated: nav.viewer.mode === "SimulatedMode", analystRole: nav.viewer.analyst, realOnlyServer: nav.viewer.realOnly, reviewItems: nav.queues.reviewItems, requestsKnown: nav.queues.requestsKnown };
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function canReceiveQueues(nav: ConsoleNav): boolean {
  return nav.viewer.known;
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function receiveQueues(nav: ConsoleNav, reviewItems: boolean, requestsKnown: boolean): ConsoleNav {
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "receiveQueues", \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "receiveQueues", \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "receiveQueues", \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepVenueOpensTheMap(nav, "receiveQueues", \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepJumpOpensTheDrawer(nav, "receiveQueues", \result)
  //@ ensures (inv(nav) && canReceiveQueues(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "receiveQueues", \result)
  return { ...nav, queues: ({ reviewItems: reviewItems, requestsKnown: requestsKnown } as QueueFacts) };
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function lawFeedAlwaysShows(facts: TabFacts): boolean {
  //@ ensures \result === true
  return tabVisible("FeedTab", facts);
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function lawGameTabNeedsTheSimulatedWorld(facts: TabFacts): boolean {
  //@ ensures \result === true
  return tabVisible("GameTab", facts) === facts.simulated;
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function lawLabNeedsAnAnalystOffARealOnlyServer(facts: TabFacts): boolean {
  //@ ensures \result === true
  return tabVisible("LabTab", facts) === (facts.analystRole && !facts.realOnlyServer);
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function tabNow(nav: ConsoleNav): DrawerTab {
  return shownTab(nav.wantedTab, factsOf(nav));
}

/** Story: Use the stage and the drawer / Each drawer tab shows only where it applies (spec/consoleNavigation.md) */
//@ pure
export function lawShownTabIsVisible(wanted: DrawerTab, facts: TabFacts): boolean {
  //@ ensures \result === true
  return tabVisible(shownTab(wanted, facts), facts);
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function jumpToTab(nav: ConsoleNav, tab: DrawerTab): ConsoleNav {
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepFocusAddsAtMostOneEntry(nav, "jumpToTab", \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "jumpToTab", \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepEscapeClosesTheMenuFirst(nav, "jumpToTab", \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepVenueOpensTheMap(nav, "jumpToTab", \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepJumpOpensTheDrawer(nav, "jumpToTab", \result)
  //@ ensures (inv(nav) && canJumpToTab(nav, tab)) ==> stepChosenTabShowsUnlessItCollapses(nav, "jumpToTab", \result)
  return { ...nav, wantedTab: tab, drawerOpen: true };
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function toggleDrawer(nav: ConsoleNav): ConsoleNav {
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepFocusAddsAtMostOneEntry(nav, "toggleDrawer", \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "toggleDrawer", \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepEscapeClosesTheMenuFirst(nav, "toggleDrawer", \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepVenueOpensTheMap(nav, "toggleDrawer", \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepJumpOpensTheDrawer(nav, "toggleDrawer", \result)
  //@ ensures (inv(nav) && canToggleDrawer(nav)) ==> stepChosenTabShowsUnlessItCollapses(nav, "toggleDrawer", \result)
  return { ...nav, drawerOpen: !nav.drawerOpen };
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function stepJumpOpensTheDrawer(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "jumpToTab") || after.drawerOpen;
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function stepChosenTabShowsUnlessItCollapses(before: ConsoleNav, via: string, after: ConsoleNav): boolean {
  return !(via === "chooseTab" && after.drawerOpen) || tabVisible(after.wantedTab, factsOf(after));
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function canChooseTab(nav: ConsoleNav, tab: DrawerTab): boolean {
  return onAppPage(nav) && tabVisible(tab, factsOf(nav));
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function chooseTab(nav: ConsoleNav, tab: DrawerTab): ConsoleNav {
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysAppPageNeedsAnApp(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysAllAppsPageNeedsTwoAppsOrCrossApp(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysNoRolePageOnlyWithoutRoles(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysPersonPageNeedsCrossAppInReal(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysAdminHoldsEveryRole(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysRealOnlyServerStaysReal(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysHistoryIsBounded(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysOverviewHasNoHistory(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysQueryClassIsBounded(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysPicksNeedTheSimulatedWorld(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> alwaysPicksAreBounded(\result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepModeChangeClearsSubject(nav, \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepFocusAddsAtMostOneEntry(nav, "chooseTab", \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepEscapeKeepsSubjectWhileSomethingIsOpen(nav, "chooseTab", \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepEscapeClosesTheMenuFirst(nav, "chooseTab", \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepVenueOpensTheMap(nav, "chooseTab", \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepJumpOpensTheDrawer(nav, "chooseTab", \result)
  //@ ensures (inv(nav) && canChooseTab(nav, tab)) ==> stepChosenTabShowsUnlessItCollapses(nav, "chooseTab", \result)
  return { ...nav, wantedTab: tab, drawerOpen: tabNow(nav) !== tab || !nav.drawerOpen };
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function canJumpToTab(nav: ConsoleNav, tab: DrawerTab): boolean {
  return onAppPage(nav) && tabVisible(tab, factsOf(nav));
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function canToggleDrawer(nav: ConsoleNav): boolean {
  return onAppPage(nav);
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function sometimesLabTabShows(nav: ConsoleNav): boolean {
  return onAppPage(nav) && nav.drawerOpen && tabNow(nav) === "LabTab";
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function sometimesGameTabShows(nav: ConsoleNav): boolean {
  return onAppPage(nav) && nav.drawerOpen && tabNow(nav) === "GameTab";
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function sometimesReviewTabShows(nav: ConsoleNav): boolean {
  return onAppPage(nav) && nav.drawerOpen && tabNow(nav) === "ReviewTab";
}

/** Story: Use the stage and the drawer / A tab choice opens the drawer, and the open tab collapses it (spec/consoleNavigation.md) */
//@ pure
export function sometimesDrawerCollapsed(nav: ConsoleNav): boolean {
  return onAppPage(nav) && !nav.drawerOpen;
}

/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
//@ pure
export function filterApplies(tab: DrawerTab, filterKey: FilterKey): boolean {
  return tab === "ReviewTab" ? filterKey === "BoroughKey" || filterKey === "MembersKey" || filterKey === "OriginKey" : (tab === "FeedTab" ? filterKey !== "StateKey" : (tab === "PipelineTab" ? true : (tab === "EngineTab" ? filterKey === "RangeKey" : (tab === "SafetyTab" || tab === "RequestsTab" ? filterKey === "RangeKey" || filterKey === "BoroughKey" || filterKey === "MembersKey" : (tab === "MetricsTab" ? filterKey === "RangeKey" || filterKey === "BoroughKey" || filterKey === "OriginKey" : false)))));
}

/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
//@ pure
export function filterDimmed(drawerOpen: boolean, tab: DrawerTab, filterKey: FilterKey): boolean {
  return drawerOpen && !filterApplies(tab, filterKey);
}

/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
//@ pure
export function lawToolTabsUseNoFilter(filterKey: FilterKey): boolean {
  //@ ensures \result === true
  return !filterApplies("LabTab", filterKey) && !filterApplies("ConfigTab", filterKey) && !filterApplies("GameTab", filterKey);
}

/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
//@ pure
export function lawPipelineUsesEveryFilter(filterKey: FilterKey): boolean {
  //@ ensures \result === true
  return filterApplies("PipelineTab", filterKey);
}

/** Story: Use the stage and the drawer / The filter bar dims the filters that do not apply to the open tab (spec/consoleNavigation.md) */
//@ pure
export function lawCollapsedDrawerDimsNothing(tab: DrawerTab, filterKey: FilterKey): boolean {
  //@ ensures \result === true
  return !filterDimmed(false, tab, filterKey);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ConsoleNav, event: Event): boolean {
  if (event.type === "receiveViewer") return canReceiveViewer(current, event.viewMode, event.heldApps, event.crossAppRole, event.adminRole, event.realOnlyServer);
  if (event.type === "openAllApps") return canOpenAllApps(current);
  if (event.type === "selectApp") return canSelectApp(current);
  if (event.type === "openPerson") return canOpenPerson(current);
  if (event.type === "closePerson") return canClosePerson(current);
  if (event.type === "switchMode") return canSwitchMode(current, event.viewMode);
  if (event.type === "receiveModeChange") return canReceiveModeChange(current, event.viewMode);
  if (event.type === "replaceFocus") return canReplaceFocus(current, event.target);
  if (event.type === "focusOn") return canFocusOn(current, event.target, event.sameAsShown);
  if (event.type === "goBack") return canGoBack(current, event.previous);
  if (event.type === "clearFocus") return canClearFocus(current);
  if (event.type === "dropMissingSubjects") return canDropMissingSubjects(current, event.droppedEntries);
  if (event.type === "toggleHelp") return true;
  if (event.type === "pressEscape") return true;
  if (event.type === "typeQuery") return canTypeQuery(current);
  if (event.type === "pickHit") return canPickHit(current, event.target, event.sameAsShown);
  if (event.type === "togglePick") return canTogglePick(current, event.alreadyPicked, event.minorMember);
  if (event.type === "showStage") return canShowStage(current, event.target);
  if (event.type === "flyToVenue") return canFlyToVenue(current);
  if (event.type === "receiveQueues") return canReceiveQueues(current);
  if (event.type === "jumpToTab") return canJumpToTab(current, event.tab);
  if (event.type === "toggleDrawer") return canToggleDrawer(current);
  if (event.type === "chooseTab") return canChooseTab(current, event.tab);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ConsoleNav, event: Event): ConsoleNav {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "receiveViewer") return canReceiveViewer(current, event.viewMode, event.heldApps, event.crossAppRole, event.adminRole, event.realOnlyServer) ? receiveViewer(current, event.viewMode, event.heldApps, event.crossAppRole, event.adminRole, event.analystRole, event.simRoleHeld, event.safetyRole, event.realOnlyServer) : current;
  if (event.type === "openAllApps") return canOpenAllApps(current) ? openAllApps(current) : current;
  if (event.type === "selectApp") return canSelectApp(current) ? selectApp(current, event.sameApp) : current;
  if (event.type === "openPerson") return canOpenPerson(current) ? openPerson(current) : current;
  if (event.type === "closePerson") return canClosePerson(current) ? closePerson(current) : current;
  if (event.type === "switchMode") return canSwitchMode(current, event.viewMode) ? switchMode(current, event.viewMode) : current;
  if (event.type === "receiveModeChange") return canReceiveModeChange(current, event.viewMode) ? receiveModeChange(current, event.viewMode) : current;
  if (event.type === "replaceFocus") return canReplaceFocus(current, event.target) ? replaceFocus(current, event.target) : current;
  if (event.type === "focusOn") return canFocusOn(current, event.target, event.sameAsShown) ? focusOn(current, event.target, event.sameAsShown) : current;
  if (event.type === "goBack") return canGoBack(current, event.previous) ? goBack(current, event.previous) : current;
  if (event.type === "clearFocus") return canClearFocus(current) ? clearFocus(current) : current;
  if (event.type === "dropMissingSubjects") return canDropMissingSubjects(current, event.droppedEntries) ? dropMissingSubjects(current, event.subjectExists, event.droppedEntries) : current;
  if (event.type === "toggleHelp") return toggleHelp(current);
  if (event.type === "pressEscape") return pressEscape(current);
  if (event.type === "typeQuery") return canTypeQuery(current) ? typeQuery(current, event.characters) : current;
  if (event.type === "pickHit") return canPickHit(current, event.target, event.sameAsShown) ? pickHit(current, event.target, event.sameAsShown) : current;
  if (event.type === "togglePick") return canTogglePick(current, event.alreadyPicked, event.minorMember) ? togglePick(current, event.alreadyPicked, event.minorMember) : current;
  if (event.type === "showStage") return canShowStage(current, event.target) ? showStage(current, event.target) : current;
  if (event.type === "flyToVenue") return canFlyToVenue(current) ? flyToVenue(current) : current;
  if (event.type === "receiveQueues") return canReceiveQueues(current) ? receiveQueues(current, event.reviewItems, event.requestsKnown) : current;
  if (event.type === "jumpToTab") return canJumpToTab(current, event.tab) ? jumpToTab(current, event.tab) : current;
  if (event.type === "toggleDrawer") return canToggleDrawer(current) ? toggleDrawer(current) : current;
  if (event.type === "chooseTab") return canChooseTab(current, event.tab) ? chooseTab(current, event.tab) : current;
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
  if (raw.type === "receiveViewer" && (raw.viewMode === "SimulatedMode" || raw.viewMode === "RealMode") && Number.isSafeInteger(raw.heldApps) && typeof raw.crossAppRole === "boolean" && typeof raw.adminRole === "boolean" && typeof raw.analystRole === "boolean" && typeof raw.simRoleHeld === "boolean" && typeof raw.safetyRole === "boolean" && typeof raw.realOnlyServer === "boolean") return { type: "receiveViewer", viewMode: raw.viewMode, heldApps: raw.heldApps, crossAppRole: raw.crossAppRole, adminRole: raw.adminRole, analystRole: raw.analystRole, simRoleHeld: raw.simRoleHeld, safetyRole: raw.safetyRole, realOnlyServer: raw.realOnlyServer };
  if (raw.type === "openAllApps") return { type: "openAllApps" };
  if (raw.type === "selectApp" && typeof raw.sameApp === "boolean") return { type: "selectApp", sameApp: raw.sameApp };
  if (raw.type === "openPerson") return { type: "openPerson" };
  if (raw.type === "closePerson") return { type: "closePerson" };
  if (raw.type === "switchMode" && (raw.viewMode === "SimulatedMode" || raw.viewMode === "RealMode")) return { type: "switchMode", viewMode: raw.viewMode };
  if (raw.type === "receiveModeChange" && (raw.viewMode === "SimulatedMode" || raw.viewMode === "RealMode")) return { type: "receiveModeChange", viewMode: raw.viewMode };
  if (raw.type === "replaceFocus" && (raw.target === "Overview" || raw.target === "NeighborhoodSubject" || raw.target === "MemberSubject" || raw.target === "OpportunitySubject")) return { type: "replaceFocus", target: raw.target };
  if (raw.type === "focusOn" && (raw.target === "Overview" || raw.target === "NeighborhoodSubject" || raw.target === "MemberSubject" || raw.target === "OpportunitySubject") && typeof raw.sameAsShown === "boolean") return { type: "focusOn", target: raw.target, sameAsShown: raw.sameAsShown };
  if (raw.type === "goBack" && (raw.previous === "Overview" || raw.previous === "NeighborhoodSubject" || raw.previous === "MemberSubject" || raw.previous === "OpportunitySubject")) return { type: "goBack", previous: raw.previous };
  if (raw.type === "clearFocus") return { type: "clearFocus" };
  if (raw.type === "dropMissingSubjects" && typeof raw.subjectExists === "boolean" && Number.isSafeInteger(raw.droppedEntries)) return { type: "dropMissingSubjects", subjectExists: raw.subjectExists, droppedEntries: raw.droppedEntries };
  if (raw.type === "toggleHelp") return { type: "toggleHelp" };
  if (raw.type === "pressEscape") return { type: "pressEscape" };
  if (raw.type === "typeQuery" && Number.isSafeInteger(raw.characters)) return { type: "typeQuery", characters: raw.characters };
  if (raw.type === "pickHit" && (raw.target === "Overview" || raw.target === "NeighborhoodSubject" || raw.target === "MemberSubject" || raw.target === "OpportunitySubject") && typeof raw.sameAsShown === "boolean") return { type: "pickHit", target: raw.target, sameAsShown: raw.sameAsShown };
  if (raw.type === "togglePick" && typeof raw.alreadyPicked === "boolean" && typeof raw.minorMember === "boolean") return { type: "togglePick", alreadyPicked: raw.alreadyPicked, minorMember: raw.minorMember };
  if (raw.type === "showStage" && (raw.target === "MapStage" || raw.target === "GraphStage")) return { type: "showStage", target: raw.target };
  if (raw.type === "flyToVenue") return { type: "flyToVenue" };
  if (raw.type === "receiveQueues" && typeof raw.reviewItems === "boolean" && typeof raw.requestsKnown === "boolean") return { type: "receiveQueues", reviewItems: raw.reviewItems, requestsKnown: raw.requestsKnown };
  if (raw.type === "jumpToTab" && (raw.tab === "ReviewTab" || raw.tab === "FeedTab" || raw.tab === "PipelineTab" || raw.tab === "RequestsTab" || raw.tab === "EngineTab" || raw.tab === "SafetyTab" || raw.tab === "MetricsTab" || raw.tab === "LabTab" || raw.tab === "ConfigTab" || raw.tab === "GameTab")) return { type: "jumpToTab", tab: raw.tab };
  if (raw.type === "toggleDrawer") return { type: "toggleDrawer" };
  if (raw.type === "chooseTab" && (raw.tab === "ReviewTab" || raw.tab === "FeedTab" || raw.tab === "PipelineTab" || raw.tab === "RequestsTab" || raw.tab === "EngineTab" || raw.tab === "SafetyTab" || raw.tab === "MetricsTab" || raw.tab === "LabTab" || raw.tab === "ConfigTab" || raw.tab === "GameTab")) return { type: "chooseTab", tab: raw.tab };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ConsoleNav | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.page === "AppPage" || raw.page === "AllAppsPage" || raw.page === "PersonPage" || raw.page === "NoRolePage") && (raw.stage === "MapStage" || raw.stage === "GraphStage") && (raw.subject === "Overview" || raw.subject === "NeighborhoodSubject" || raw.subject === "MemberSubject" || raw.subject === "OpportunitySubject") && Number.isSafeInteger(raw.depth) && (raw.wantedTab === "FeedTab" || raw.wantedTab === "ReviewTab" || raw.wantedTab === "PipelineTab" || raw.wantedTab === "RequestsTab" || raw.wantedTab === "EngineTab" || raw.wantedTab === "SafetyTab" || raw.wantedTab === "MetricsTab" || raw.wantedTab === "LabTab" || raw.wantedTab === "ConfigTab" || raw.wantedTab === "GameTab") && typeof raw.drawerOpen === "boolean" && typeof raw.popoverOpen === "boolean" && Number.isSafeInteger(raw.queryChars) && Number.isSafeInteger(raw.picks) && typeof raw.viewer === "object" && raw.viewer !== null && !Array.isArray(raw.viewer) && typeof raw.viewer.known === "boolean" && (raw.viewer.mode === "SimulatedMode" || raw.viewer.mode === "RealMode") && Number.isSafeInteger(raw.viewer.appsHeld) && typeof raw.viewer.crossApp === "boolean" && typeof raw.viewer.admin === "boolean" && typeof raw.viewer.analyst === "boolean" && typeof raw.viewer.simRole === "boolean" && typeof raw.viewer.safety === "boolean" && typeof raw.viewer.realOnly === "boolean" && Object.keys(raw.viewer).length === 9 && typeof raw.queues === "object" && raw.queues !== null && !Array.isArray(raw.queues) && typeof raw.queues.reviewItems === "boolean" && typeof raw.queues.requestsKnown === "boolean" && Object.keys(raw.queues).length === 2 && Object.keys(raw).length === 11)) return undefined;
  const parsed: ConsoleNav = ({ page: raw.page, stage: raw.stage, subject: raw.subject, depth: raw.depth, wantedTab: raw.wantedTab, drawerOpen: raw.drawerOpen, popoverOpen: raw.popoverOpen, queryChars: raw.queryChars, picks: raw.picks, viewer: ({ known: raw.viewer.known, mode: raw.viewer.mode, appsHeld: raw.viewer.appsHeld, crossApp: raw.viewer.crossApp, admin: raw.viewer.admin, analyst: raw.viewer.analyst, simRole: raw.viewer.simRole, safety: raw.viewer.safety, realOnly: raw.viewer.realOnly }), queues: ({ reviewItems: raw.queues.reviewItems, requestsKnown: raw.queues.requestsKnown }) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ConsoleNav {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_consoleNavigation(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
