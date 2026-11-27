# Observatory staff permissions

The Observatory gets staff grants after authentication. The [standalone staff model](models/staff_console.md) covers changes to grants and the [privacy model](models/console_privacy.md) covers the view classes. The server and browser use the same grant projection. Authentication, audit writes, and shaping response bodies stay in the shell.

## Story: Work within my assigned staff role

> As a staff member, I want the console to offer and admit work for the app and mode my role covers.

### A grant applies only to its app and mode

An app view receives grants for that app and for all apps. The engineer role applies only in game mode. The cross-app safety role does not grant access to an individual app. A global check uses grants explicitly covering all apps.

```quint
type StaffGrant = { app: str, role: str }

pure def scopedGrants(grants: List[StaffGrant], appName: str, realMode: bool): List[StaffGrant] =
  grants.select(g => (g.app == "*" or g.app == appName) and g.role != "cross_app_safety" and
    (not(realMode) or g.role != "engineer"))

pure def globalGrants(grants: List[StaffGrant]): List[StaffGrant] = grants.select(g => g.app == "*")

pure val grantsValues: Set[List[StaffGrant]] = Set(
  List(),
  List({ app: "*", role: "admin" }),
  List({ app: "slop", role: "reviewer" }, { app: "*", role: "engineer" }),
  List({ app: "*", role: "cross_app_safety" }, { app: "peon", role: "analyst" }),
)
```

### App admission requires an applicable role and the requested capability

An app route requires at least one role for that app. When a route names a capability, the applicable roles must include admin or one of the roles it lists. An authenticated global route has no app requirement. A global capability uses the global grants. Only global admin and global cross-app safety grant the cross-app person view.

```quint
pure def allowedByRole(roles: List[str], requiredRoles: List[str]): bool =
  roles.includes("admin") or requiredRoles.some(r => roles.includes(r))

pure def mayOpenCrossApp(globalRoles: List[str]): bool = allowedByRole(globalRoles, List("cross_app_safety"))

type Admission = AdmitRoute | NoAppRole | NeedsRole | ModeChanged
type RouteFacts = { appRoute: bool, roleRestricted: bool, mutating: bool, hasModeHeader: bool, matchesMode: bool }

pure def routeAdmission(routeFacts: RouteFacts, roles: List[str], requiredRoles: List[str]): Admission =
  if (routeFacts.appRoute and roles.length() == 0) NoAppRole
  else if (routeFacts.roleRestricted and not(allowedByRole(roles, requiredRoles))) NeedsRole
  else if (routeFacts.appRoute and routeFacts.mutating and routeFacts.hasModeHeader and not(routeFacts.matchesMode)) ModeChanged
  else AdmitRoute
```

### Only an admitted route can reach its handler

First check role and mode. A route that has been admitted can enter its handler. A refused route finishes without entering it. Handler-level audit, member eligibility, and source readiness checks still apply before returning data or acting.

```quint
type AdmissionPhase = RouteUnchecked | RouteAdmitted | RouteRefused | RouteRunning
type RouteCheck = { phase: AdmissionPhase, decision: Admission }
pure val initial: RouteCheck = { phase: RouteUnchecked, decision: NoAppRole }

pure def canAuthorizeRoute(check: RouteCheck): bool = check.phase == RouteUnchecked
pure def authorizeRoute(check: RouteCheck, routeFacts: RouteFacts, roles: List[str], requiredRoles: List[str]): RouteCheck =
  val decision = routeAdmission(routeFacts, roles, requiredRoles)
  { phase: if (decision == AdmitRoute) RouteAdmitted else RouteRefused, decision: decision }

pure def canEnterHandler(check: RouteCheck): bool = check.phase == RouteAdmitted
pure def enterHandler(check: RouteCheck): RouteCheck = { ...check, phase: RouteRunning }

pure def alwaysRunningRouteWasAdmitted(check: RouteCheck): bool =
  (check.phase == RouteAdmitted or check.phase == RouteRunning) implies check.decision == AdmitRoute

pure def stepRefusedRouteStaysClosed(before: RouteCheck, after: RouteCheck): bool =
  before.phase == RouteRefused implies after.phase == RouteRefused

pure def sometimesHandlerRuns(check: RouteCheck): bool = check.phase == RouteRunning
pure def sometimesRouteIsRefused(check: RouteCheck): bool = check.phase == RouteRefused

pure val appRead: RouteFacts = { appRoute: true, roleRestricted: false, mutating: false, hasModeHeader: false, matchesMode: true }
pure val routeFactsValues = Set(appRead, { ...appRead, roleRestricted: true },
  { ...appRead, roleRestricted: true, mutating: true, hasModeHeader: true, matchesMode: false },
  { ...appRead, appRoute: false }, { ...appRead, appRoute: false, roleRestricted: true })
pure val rolesValues = Set(List(), List("admin"), List("safety"), List("reviewer"), List("engineer"), List("analyst"))
pure val requiredRolesValues = Set(List(), List("safety"), List("reviewer"), List("analyst"))
```

## Story: See only the detail my role permits

> As a staff member, I want the console to use the right view for my role.

### The analyst view shows counts and shapes rather than people

Admin, reviewer, safety, and game engineer roles receive the full view. Without one of those roles the view shows counts. Individual member details are a separate check. Admin, safety, and game engineers can open them. Reviewers can open a member only when the member is in an open review.

```quint
type MemberAccess = AnyMember | OpenReviewMember | MemberRefused

pure def fullStaffView(roles: List[str]): bool =
  allowedByRole(roles, List("reviewer", "safety", "engineer"))

pure def staffMemberAccess(roles: List[str], realMode: bool): MemberAccess =
  if (allowedByRole(roles, List("safety")) or (not(realMode) and roles.includes("engineer"))) AnyMember
  else if (roles.includes("reviewer")) OpenReviewMember
  else MemberRefused
```

### The server grants a reveal for 5, 10 or 15 minutes only

A safety staff member asks for a reveal of one member with a reason and a length. The length is 5, 10 or 15 minutes, and a request without a length gets 15 minutes. The server refuses any other length with `bad_minutes` and writes an audit row of the refusal; it does not shorten or lengthen the request. Changed (audit stories-b-3): the server changed any length to a value from 1 to 15 minutes -> it refuses any other length, because only the console form kept the three lengths of the [reveal form rule](consoleWorkspace.md).

```quint
pure val staffRevealMinuteChoices: Set[int] = Set(5, 10, 15)

pure def staffRevealMinutesAccepted(revealMinutes: int): bool = staffRevealMinuteChoices.contains(revealMinutes)

pure def lawAcceptedRevealEndsWithinFifteenMinutes(revealMinutes: int): bool =
  staffRevealMinutesAccepted(revealMinutes) implies (revealMinutes >= 5 and revealMinutes <= 15)

pure def lawRevealRefusesOneMinute(revealMinutes: int): bool =
  revealMinutes < 5 implies not(staffRevealMinutesAccepted(revealMinutes))

pure val revealMinutesValues = Set(-1, 0, 1, 4, 5, 7, 10, 15, 16, 90)
```

## Story: Take a gate or safety step in the console as myself

> As a staff member, I want to verify an employer, keep postings, review home help, member invitations, agent signals, privacy requests, held outbound texts and flagged relay photos in the console, so that the step needs my own role and the audit names me, not a shared token.

### Each console staff step needs the role that its staff route needs

The console offers each staff step and checks the person's own role before it forwards the step. Reading postings needs the reviewer role. Saving or closing a posting, verifying an employer, a seed invitation batch and a staff invite need the admin role. Home help, member verification, a decision on an agent signal, venue catalog reads and quarantine status changes (`ReadVenues`, `UpdateVenueStatus`), matchmaker reads and kill-switch status changes (`ReadMatchmakers`, `UpdateMatchmakerStatus`), and the held queues need the safety role. Reading and reviewing sanctioned external events (`ReadExternalEvents`, `ReviewExternalEvent`) need the reviewer role. Member invitations and reading agent signals need the reviewer or safety role. Reading the judged introductions (`ReadJudgedReviews`: the judged list and one judgment with its explanation and packet) and stopping an approved introduction before its reveal (`StopApprovedReview`) need the reviewer or safety role. A review decision (`DecideReviewItem`) needs the reviewer role and a safety case decision (`DecideSafetyCase`: hold, ban, dismiss, lift, close, clear a minor signal, stop or resume teen friendship introductions (`/teen-intros`; the service still needs admin to resume) and report a member older than stated (`/safety/older-than-stated`)) needs the safety role; the console keeps its own routes for these two. The `DecideSafetyCase` step exists so that the service can refuse a shared token on it; the `DecideReviewItem` step takes a shared reviewer token, which the service records as itself (the step-actor rule below). Admin passes every check. A posting or employer step exists only on peon. Matchmaker steps (`ReadMatchmakers`, `UpdateMatchmakerStatus`) are never offered on peon, matching the cross-app firewall in [external matchmaker](externalMatchmaker.md). A privacy request, its confirmation and the privacy replay need admin for all apps, and an app grant does not count. Releasing the sender of a signed shared-line turn that did not finish (`ResolveInboundTurn`), reading the shared-line turn watch counts (`ReadTurnWatch`), and reading cross-app city readiness (`/ops/cities`, `ReadCityOps`) also need admin for all apps, because one shared line and city catalog serve every app. `ReadHeldRelay` and `DecideHeldRelay` cover both held queues of the console: the leak queue (outbound texts that the leak guard held) and the relay queue (relay photos that the automatic image check flagged, [photo consent and review](photoRelayReview.md)). Both need the safety role, because a held text can show a member's private facts and a flagged photo shows a member's photo. No relayed text is held. Changed (audits PER35, console-api-gaps and STAFF-held-role of 2026-11-21 and 2026-11-22, owner decisions D3, D15 to D17): the steps were staff-port calls with a shared token, the held routes hard-coded the safety role, and the relay queue held texts -> each step is a console step with its own role, the judge-watch steps are new, and the relay queue holds only flagged photos, because the audit must name a person and no relayed text waits for staff. Changed (audit PER35, 2026-11-22): the service admitted a shared token on `/teen-intros` and `/safety/older-than-stated` -> both are `DecideSafetyCase` steps, because the audit must name a person.

```quint
type StaffStep = ReadPostings | SavePosting | ClosePosting | VerifyEmployer | ReadHomeHelp | DecideHomeHelp
  | ReadMemberInvitations | DecideMemberInvitation | SeedInvitations | VerifyMember | InviteMember
  | ReadAgentSignals | DecideAgentSignal | OpenPrivacyRequest | ConfirmPrivacyRequest | ReplayPrivacy
  | ReadHeldRelay | DecideHeldRelay | ResolveInboundTurn | ReadTurnWatch
  | DecideReviewItem | DecideSafetyCase | ReadJudgedReviews | StopApprovedReview
  | ReadVenues | UpdateVenueStatus | ReadExternalEvents | ReviewExternalEvent
  | ReadMatchmakers | UpdateMatchmakerStatus | ReadCityOps

pure def staffStepRoles(staffStep: StaffStep): List[str] =
  match staffStep {
    | ReadPostings => List("reviewer")
    | SavePosting => List("admin")
    | ClosePosting => List("admin")
    | VerifyEmployer => List("admin")
    | ReadHomeHelp => List("safety")
    | DecideHomeHelp => List("safety")
    | ReadMemberInvitations => List("reviewer", "safety")
    | DecideMemberInvitation => List("reviewer", "safety")
    | SeedInvitations => List("admin")
    | VerifyMember => List("safety")
    | InviteMember => List("admin")
    | ReadAgentSignals => List("reviewer", "safety")
    | DecideAgentSignal => List("safety")
    | OpenPrivacyRequest => List("admin")
    | ConfirmPrivacyRequest => List("admin")
    | ReplayPrivacy => List("admin")
    | ReadHeldRelay => List("safety")
    | DecideHeldRelay => List("safety")
    | ResolveInboundTurn => List("admin")
    | ReadTurnWatch => List("admin")
    | DecideReviewItem => List("reviewer")
    | DecideSafetyCase => List("safety")
    | ReadJudgedReviews => List("reviewer", "safety")
    | StopApprovedReview => List("reviewer", "safety")
    | ReadVenues => List("safety")
    | UpdateVenueStatus => List("safety")
    | ReadExternalEvents => List("reviewer")
    | ReviewExternalEvent => List("reviewer")
    | ReadMatchmakers => List("safety")
    | UpdateMatchmakerStatus => List("safety")
    | ReadCityOps => List("admin")
  }

pure def staffStepEveryApp(staffStep: StaffStep): bool =
  match staffStep {
    | OpenPrivacyRequest => true
    | ConfirmPrivacyRequest => true
    | ReplayPrivacy => true
    | ResolveInboundTurn => true
    | ReadTurnWatch => true
    | ReadCityOps => true
    | _ => false
  }

pure def staffStepOffered(staffStep: StaffStep, appName: str): bool =
  match staffStep {
    | ReadPostings => appName == "peon"
    | SavePosting => appName == "peon"
    | ClosePosting => appName == "peon"
    | VerifyEmployer => appName == "peon"
    | ReadMatchmakers => appName != "peon"
    | UpdateMatchmakerStatus => appName != "peon"
    | _ => true
  }

pure def staffStepAdmitted(staffStep: StaffStep, appName: str, appRoles: List[str], globalRoles: List[str]): bool =
  staffStepOffered(staffStep, appName) and
    allowedByRole(if (staffStepEveryApp(staffStep)) globalRoles else appRoles, staffStepRoles(staffStep))

pure def lawEveryAppStepNeedsGlobalAdmin(staffStep: StaffStep, appName: str, appRoles: List[str], globalRoles: List[str]): bool =
  (staffStepEveryApp(staffStep) and staffStepAdmitted(staffStep, appName, appRoles, globalRoles)) implies globalRoles.includes("admin")

pure def lawStepWithoutAppRoleRefused(staffStep: StaffStep, appName: str, globalRoles: List[str]): bool =
  not(staffStepEveryApp(staffStep)) implies not(staffStepAdmitted(staffStep, appName, List(), globalRoles))

pure def lawEmployerVerificationOnlyOnPeon(appName: str, appRoles: List[str], globalRoles: List[str]): bool =
  staffStepAdmitted(VerifyEmployer, appName, appRoles, globalRoles) implies appName == "peon"

pure def lawMatchmakerStepsRefusedOnPeon(appRoles: List[str], globalRoles: List[str]): bool =
  not(staffStepAdmitted(ReadMatchmakers, "peon", appRoles, globalRoles)) and
    not(staffStepAdmitted(UpdateMatchmakerStatus, "peon", appRoles, globalRoles))

pure val appNameValues = Set("peon", "slop", "friends", "ntwrk")
pure val appRolesValues = Set(List(), List("admin"), List("reviewer"), List("safety"), List("analyst"))
pure val globalRolesValues = Set(List(), List("admin"), List("safety"), List("reviewer", "safety"))
```

### The staff API takes a step that needs a person only from a named person

When the service has a console token, it refuses every console staff step that needs a person and whose actor the console did not name in `X-Network-Staff-Id`. The console names the signed-in person and never takes the name from the browser. A service without a console token, as in development or a test harness, has no way to name a person, so it records its token. The step list in `serviceStaffStep` decides which routes are console steps. The review desk steps do not need a person: a review decision on a held item (`DecideReviewItem`), stopping an approved introduction before its reveal (`StopApprovedReview`) and reading the judged introductions (`ReadJudgedReviews`). A shared token with the role of the step (reviewer for a decision; reviewer or safety for a stop and for the judged list) takes them and is the reviewer of record as itself (`token:<role>#...`); the service ignores `X-Network-Staff-Id` from any token other than the console's, so no audit row names a person that the token did not prove. Every other console step needs a person: the safety hold, ban, dismiss, lift, close, clear-minor, `/teen-intros` and `/safety/older-than-stated` routes (`DecideSafetyCase`), the privacy, verification, invitation, posting, home-help, signal, held-relay and shared-line steps. The laws check the decision at fixed inputs: a service with a console token refuses a shared token on a step that needs a person, only the three review desk steps take a shared token, a safety case always needs a person, a named reviewer is always accepted, the console token only refuses steps, and it changes the answer only for a shared token. Changed (audit PER35): a shared role token recorded itself as the actor of a step, also of a review decision or a minor-signal clear -> a service with a console token refuses a shared token on every console step, because a step could change a gate or a safety state, or let a member be matched again, without a person on the audit row. Changed (owner answer 2026-11-23): a service with a console token refused a shared token also on the review desk steps -> a shared reviewer token decides a held item, stops an approval and reads the judged list, recorded as itself, because staff decide only the few items the judge holds, a held item expires unsent at its deadline, and an operator without the console must still be able to clear or stop one; the token, not an unproven name, is on the audit row.

```quint
type StepActor = NamedReviewer | SharedToken

pure def staffStepNeedsPerson(staffStep: StaffStep): bool =
  match staffStep {
    | DecideReviewItem => false
    | StopApprovedReview => false
    | ReadJudgedReviews => false
    | _ => true
  }

pure def staffStepActorAccepted(consoleConfigured: bool, staffStep: StaffStep, actor: StepActor): bool =
  actor == NamedReviewer or not(consoleConfigured) or not(staffStepNeedsPerson(staffStep))

pure def lawConsoleServiceRefusesSharedToken(consoleConfigured: bool, staffStep: StaffStep): bool =
  (consoleConfigured and staffStepNeedsPerson(staffStep)) implies not(staffStepActorAccepted(consoleConfigured, staffStep, SharedToken))

pure def lawOnlyReviewDeskStepsTakeSharedToken(staffStep: StaffStep): bool =
  staffStepActorAccepted(true, staffStep, SharedToken) implies
    (staffStep == DecideReviewItem or staffStep == StopApprovedReview or staffStep == ReadJudgedReviews)

pure def lawSafetyCaseNeedsPerson(consoleConfigured: bool): bool =
  consoleConfigured implies not(staffStepActorAccepted(consoleConfigured, DecideSafetyCase, SharedToken))

pure def lawNamedReviewerAlwaysAccepted(consoleConfigured: bool, staffStep: StaffStep): bool =
  staffStepActorAccepted(consoleConfigured, staffStep, NamedReviewer)

pure def lawConsoleTokenOnlyTightens(staffStep: StaffStep, actor: StepActor): bool =
  staffStepActorAccepted(true, staffStep, actor) implies staffStepActorAccepted(false, staffStep, actor)

pure def lawConsoleTokenDecidesOnlyForSharedToken(consoleConfigured: bool, staffStep: StaffStep, actor: StepActor): bool =
  staffStepActorAccepted(consoleConfigured, staffStep, actor) != staffStepActorAccepted(not(consoleConfigured), staffStep, actor) implies actor == SharedToken
```
