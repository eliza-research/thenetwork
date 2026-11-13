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
