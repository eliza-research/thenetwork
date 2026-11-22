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

A safety staff member asks for a reveal of one member with a reason and a length. The length is 5, 10 or 15 minutes, and a request without a length gets 15 minutes. The server refuses any other length with `bad_minutes` and writes an audit row of the refusal; it does not shorten or lengthen the request. Changed on 2026-11-22 (audit stories-b-3): before, the server changed any length to a value from 1 to 15 minutes, so only the console form kept the three lengths of the [reveal form rule](consoleWorkspace.md).

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

> As a staff member, I want to verify an employer, keep postings, review home help, member invitations, agent signals, privacy requests and held relay items in the console, so that the step needs my own role and the audit names me, not a shared token.

### Each console staff step needs the role that its staff route needs

New rule (2026-11-21, audit PER35): these steps were raw staff-port calls with a shared token, so the console now offers them and checks the person's own role before it forwards a step. Reading postings needs the reviewer role. Saving or closing a posting, verifying an employer, a seed invitation batch and a staff invite need the admin role. Home help, member verification, a decision on an agent signal and held relay items need the safety role. Member invitations and reading agent signals need the reviewer or safety role. Admin passes every check. A posting or employer step exists only on peon. A privacy request, its confirmation and the privacy replay need admin for all apps, and an app grant does not count. Releasing the sender of a signed shared-line turn that did not finish, and reading the shared-line turn watch counts, also need admin for all apps, because one shared line serves every app. Changed on 2026-11-22 (audit console-api-gaps): before, the console had no step for these two service routes, so staff used a shared token on the staff port. Changed on 2026-11-22 (audit STAFF-held-role): the console held-text routes hard-coded the safety role, so they now ask this rule for the read and the decision steps, and these two steps cover both held queues of the console, the leak queue and the relay queue. For a held relay read the console is stricter than the service: the service relay list also admits a reviewer, but the console needs safety, because a held text shows an adult's own words. Changed on 2026-11-22 (audit of the PER35 fix): a review decision needs the reviewer role and a safety case decision (hold, ban, dismiss, lift, close, clear a minor signal) needs the safety role. The console keeps its own review and safety routes for these two; the steps exist so that the service can refuse a shared token on them.

```quint
type StaffStep = ReadPostings | SavePosting | ClosePosting | VerifyEmployer | ReadHomeHelp | DecideHomeHelp
  | ReadMemberInvitations | DecideMemberInvitation | SeedInvitations | VerifyMember | InviteMember
  | ReadAgentSignals | DecideAgentSignal | OpenPrivacyRequest | ConfirmPrivacyRequest | ReplayPrivacy
  | ReadHeldRelay | DecideHeldRelay | ResolveInboundTurn | ReadTurnWatch
  | DecideReviewItem | DecideSafetyCase

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
  }

pure def staffStepEveryApp(staffStep: StaffStep): bool =
  match staffStep {
    | OpenPrivacyRequest => true
    | ConfirmPrivacyRequest => true
    | ReplayPrivacy => true
    | ResolveInboundTurn => true
    | ReadTurnWatch => true
    | _ => false
  }

pure def staffStepOffered(staffStep: StaffStep, appName: str): bool =
  match staffStep {
    | ReadPostings => appName == "peon"
    | SavePosting => appName == "peon"
    | ClosePosting => appName == "peon"
    | VerifyEmployer => appName == "peon"
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

pure val appNameValues = Set("peon", "slop", "ntwrk")
pure val appRolesValues = Set(List(), List("admin"), List("reviewer"), List("safety"), List("analyst"))
pure val globalRolesValues = Set(List(), List("admin"), List("safety"), List("reviewer", "safety"))
```

### The staff API takes a console step only from a named person

New rule (2026-11-21, audit PER35): a shared role token recorded itself as the reviewer of record, so a step could change a gate or a safety state without a person on the audit row. When the service has a console token, it refuses every console staff step whose actor the console did not name in `X-Network-Staff-Id`. The console names the signed-in person and never takes the name from the browser. A service without a console token, as in development or a test harness, has no way to name a person, so it records its token. Changed 2026-11-22: the two laws restated the definition, so they now check the decision at fixed inputs: a service with a console token refuses a shared token, and a named reviewer is always accepted. Two more laws say how the console token changes the decision: it only refuses steps, and it changes the answer only for a shared token. The step list in `serviceStaffStep` decides which routes are console steps. Changed 2026-11-22 (audit of the PER35 fix): the review decision route (`DecideReviewItem`) and the safety hold, ban, dismiss, lift, close and clear-minor routes (`DecideSafetyCase`) were not console steps, so a shared token recorded itself as the actor of a review decision or of a minor-signal clear, which lets a member be matched again. They are console steps now, and a service with a console token refuses a shared token on them.

```quint
type StepActor = NamedReviewer | SharedToken

pure def staffStepActorAccepted(consoleConfigured: bool, actor: StepActor): bool =
  actor == NamedReviewer or not(consoleConfigured)

pure def lawConsoleServiceRefusesSharedToken(consoleConfigured: bool): bool =
  consoleConfigured implies not(staffStepActorAccepted(consoleConfigured, SharedToken))

pure def lawNamedReviewerAlwaysAccepted(consoleConfigured: bool): bool =
  staffStepActorAccepted(consoleConfigured, NamedReviewer)

pure def lawConsoleTokenOnlyTightens(actor: StepActor): bool =
  staffStepActorAccepted(true, actor) implies staffStepActorAccepted(false, actor)

pure def lawConsoleTokenDecidesOnlyForSharedToken(consoleConfigured: bool, actor: StepActor): bool =
  staffStepActorAccepted(consoleConfigured, actor) != staffStepActorAccepted(not(consoleConfigured), actor) implies actor == SharedToken
```
