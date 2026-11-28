// GENERATED from spec/staffPermissions.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md) */
export interface StaffGrant { app: string; role: string }
/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md) */
export type Admission = "AdmitRoute" | "NoAppRole" | "NeedsRole" | "ModeChanged";
/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md) */
export interface RouteFacts { appRoute: boolean; roleRestricted: boolean; mutating: boolean; hasModeHeader: boolean; matchesMode: boolean }
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
export type AdmissionPhase = "RouteUnchecked" | "RouteAdmitted" | "RouteRefused" | "RouteRunning";
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
export interface RouteCheck { phase: AdmissionPhase; decision: Admission }
/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md) */
export type MemberAccess = "AnyMember" | "OpenReviewMember" | "MemberRefused";
/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
export type StaffStep = "ReadPostings" | "SavePosting" | "ClosePosting" | "VerifyEmployer" | "ReadHomeHelp" | "DecideHomeHelp" | "ReadMemberInvitations" | "DecideMemberInvitation" | "SeedInvitations" | "VerifyMember" | "InviteMember" | "ReadAgentSignals" | "DecideAgentSignal" | "OpenPrivacyRequest" | "ConfirmPrivacyRequest" | "ReplayPrivacy" | "ReadHeldRelay" | "DecideHeldRelay" | "ResolveInboundTurn" | "ReadTurnWatch" | "DecideReviewItem" | "DecideSafetyCase" | "ReadJudgedReviews" | "StopApprovedReview" | "ReadVenues" | "UpdateVenueStatus" | "ReadExternalEvents" | "ReviewExternalEvent" | "ReadMatchmakers" | "UpdateMatchmakerStatus" | "ReadCityOps";
/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
export type StepActor = "NamedReviewer" | "SharedToken";

/** One variant per transition in the spec. */
export type Event =
  | { type: "authorizeRoute"; routeFacts: RouteFacts; roles: string[]; requiredRoles: string[] }
  | { type: "enterHandler" };

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
export const initial: RouteCheck = { phase: "RouteUnchecked", decision: "NoAppRole" };
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
export const appRead: RouteFacts = { appRoute: true, roleRestricted: false, mutating: false, hasModeHeader: false, matchesMode: true };
/** Story: See only the detail my role permits / The server grants a reveal for 5, 10 or 15 minutes only (spec/staffPermissions.md) */
export const staffRevealMinuteChoices: number[] = [5, 10, 15];

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RouteCheck): boolean {
  return alwaysRunningRouteWasAdmitted(current);
}

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md) */
//@ pure
export function scopedGrants(grants: StaffGrant[], appName: string, realMode: boolean): StaffGrant[] {
  return grants.filter((g: StaffGrant) => (g.app === "*" || g.app === appName) && g.role !== "cross_app_safety" && (!realMode || g.role !== "engineer"));
}

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md) */
//@ pure
export function globalGrants(grants: StaffGrant[]): StaffGrant[] {
  return grants.filter((g: StaffGrant) => g.app === "*");
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md) */
//@ pure
export function allowedByRole(roles: string[], requiredRoles: string[]): boolean {
  return roles.includes("admin") || requiredRoles.some((r: string) => roles.includes(r));
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md) */
//@ pure
export function mayOpenCrossApp(globalRoles: string[]): boolean {
  return allowedByRole(globalRoles, (["cross_app_safety"] as string[]));
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md) */
//@ pure
export function routeAdmission(routeFacts: RouteFacts, roles: string[], requiredRoles: string[]): Admission {
  return routeFacts.appRoute && roles.length === 0 ? "NoAppRole" : (routeFacts.roleRestricted && !allowedByRole(roles, requiredRoles) ? "NeedsRole" : (routeFacts.appRoute && routeFacts.mutating && routeFacts.hasModeHeader && !routeFacts.matchesMode ? "ModeChanged" : "AdmitRoute"));
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function canAuthorizeRoute(check: RouteCheck): boolean {
  return check.phase === "RouteUnchecked";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function authorizeRoute(check: RouteCheck, routeFacts: RouteFacts, roles: string[], requiredRoles: string[]): RouteCheck {
  //@ ensures (inv(check) && canAuthorizeRoute(check)) ==> alwaysRunningRouteWasAdmitted(\result)
  //@ ensures (inv(check) && canAuthorizeRoute(check)) ==> stepRefusedRouteStaysClosed(check, \result)
  const local_0: Admission = routeAdmission(routeFacts, roles, requiredRoles);
  return { phase: local_0 === "AdmitRoute" ? "RouteAdmitted" : "RouteRefused", decision: local_0 };
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function canEnterHandler(check: RouteCheck): boolean {
  return check.phase === "RouteAdmitted";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function enterHandler(check: RouteCheck): RouteCheck {
  //@ ensures (inv(check) && canEnterHandler(check)) ==> alwaysRunningRouteWasAdmitted(\result)
  //@ ensures (inv(check) && canEnterHandler(check)) ==> stepRefusedRouteStaysClosed(check, \result)
  return { ...check, phase: "RouteRunning" };
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function alwaysRunningRouteWasAdmitted(check: RouteCheck): boolean {
  return !(check.phase === "RouteAdmitted" || check.phase === "RouteRunning") || check.decision === "AdmitRoute";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function stepRefusedRouteStaysClosed(before: RouteCheck, after: RouteCheck): boolean {
  return !(before.phase === "RouteRefused") || after.phase === "RouteRefused";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function sometimesHandlerRuns(check: RouteCheck): boolean {
  return check.phase === "RouteRunning";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md) */
//@ pure
export function sometimesRouteIsRefused(check: RouteCheck): boolean {
  return check.phase === "RouteRefused";
}

/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md) */
//@ pure
export function fullStaffView(roles: string[]): boolean {
  return allowedByRole(roles, (["reviewer", "safety", "engineer"] as string[]));
}

/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md) */
//@ pure
export function staffMemberAccess(roles: string[], realMode: boolean): MemberAccess {
  return allowedByRole(roles, (["safety"] as string[])) || (!realMode && roles.includes("engineer")) ? "AnyMember" : (roles.includes("reviewer") ? "OpenReviewMember" : "MemberRefused");
}

/** Story: See only the detail my role permits / The server grants a reveal for 5, 10 or 15 minutes only (spec/staffPermissions.md) */
//@ pure
export function staffRevealMinutesAccepted(revealMinutes: number): boolean {
  return staffRevealMinuteChoices.includes(revealMinutes);
}

/** Story: See only the detail my role permits / The server grants a reveal for 5, 10 or 15 minutes only (spec/staffPermissions.md) */
//@ pure
export function lawAcceptedRevealEndsWithinFifteenMinutes(revealMinutes: number): boolean {
  //@ ensures \result === true
  return !staffRevealMinutesAccepted(revealMinutes) || (revealMinutes >= 5 && revealMinutes <= 15);
}

/** Story: See only the detail my role permits / The server grants a reveal for 5, 10 or 15 minutes only (spec/staffPermissions.md) */
//@ pure
export function lawRevealRefusesOneMinute(revealMinutes: number): boolean {
  //@ ensures \result === true
  return !(revealMinutes < 5) || !staffRevealMinutesAccepted(revealMinutes);
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function staffStepRoles(staffStep: StaffStep): string[] {
  return staffStep === "ReadPostings" ? (["reviewer"] as string[]) : staffStep === "SavePosting" ? (["admin"] as string[]) : staffStep === "ClosePosting" ? (["admin"] as string[]) : staffStep === "VerifyEmployer" ? (["admin"] as string[]) : staffStep === "ReadHomeHelp" ? (["safety"] as string[]) : staffStep === "DecideHomeHelp" ? (["safety"] as string[]) : staffStep === "ReadMemberInvitations" ? (["reviewer", "safety"] as string[]) : staffStep === "DecideMemberInvitation" ? (["reviewer", "safety"] as string[]) : staffStep === "SeedInvitations" ? (["admin"] as string[]) : staffStep === "VerifyMember" ? (["safety"] as string[]) : staffStep === "InviteMember" ? (["admin"] as string[]) : staffStep === "ReadAgentSignals" ? (["reviewer", "safety"] as string[]) : staffStep === "DecideAgentSignal" ? (["safety"] as string[]) : staffStep === "OpenPrivacyRequest" ? (["admin"] as string[]) : staffStep === "ConfirmPrivacyRequest" ? (["admin"] as string[]) : staffStep === "ReplayPrivacy" ? (["admin"] as string[]) : staffStep === "ReadHeldRelay" ? (["safety"] as string[]) : staffStep === "DecideHeldRelay" ? (["safety"] as string[]) : staffStep === "ResolveInboundTurn" ? (["admin"] as string[]) : staffStep === "ReadTurnWatch" ? (["admin"] as string[]) : staffStep === "DecideReviewItem" ? (["reviewer"] as string[]) : staffStep === "DecideSafetyCase" ? (["safety"] as string[]) : staffStep === "ReadJudgedReviews" ? (["reviewer", "safety"] as string[]) : staffStep === "StopApprovedReview" ? (["reviewer", "safety"] as string[]) : staffStep === "ReadVenues" ? (["safety"] as string[]) : staffStep === "UpdateVenueStatus" ? (["safety"] as string[]) : staffStep === "ReadExternalEvents" ? (["reviewer"] as string[]) : staffStep === "ReviewExternalEvent" ? (["reviewer"] as string[]) : staffStep === "ReadMatchmakers" ? (["safety"] as string[]) : staffStep === "UpdateMatchmakerStatus" ? (["safety"] as string[]) : (["admin"] as string[]);
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function staffStepEveryApp(staffStep: StaffStep): boolean {
  return staffStep === "OpenPrivacyRequest" ? true : staffStep === "ConfirmPrivacyRequest" ? true : staffStep === "ReplayPrivacy" ? true : staffStep === "ResolveInboundTurn" ? true : staffStep === "ReadTurnWatch" ? true : staffStep === "ReadCityOps" ? true : false;
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function staffStepOffered(staffStep: StaffStep, appName: string): boolean {
  return staffStep === "ReadPostings" ? appName === "peon" : staffStep === "SavePosting" ? appName === "peon" : staffStep === "ClosePosting" ? appName === "peon" : staffStep === "VerifyEmployer" ? appName === "peon" : staffStep === "ReadMatchmakers" ? appName !== "peon" : staffStep === "UpdateMatchmakerStatus" ? appName !== "peon" : true;
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function staffStepAdmitted(staffStep: StaffStep, appName: string, appRoles: string[], globalRoles: string[]): boolean {
  return staffStepOffered(staffStep, appName) && allowedByRole(staffStepEveryApp(staffStep) ? globalRoles : appRoles, staffStepRoles(staffStep));
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function lawEveryAppStepNeedsGlobalAdmin(staffStep: StaffStep, appName: string, appRoles: string[], globalRoles: string[]): boolean {
  //@ ensures \result === true
  return !(staffStepEveryApp(staffStep) && staffStepAdmitted(staffStep, appName, appRoles, globalRoles)) || globalRoles.includes("admin");
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function lawStepWithoutAppRoleRefused(staffStep: StaffStep, appName: string, globalRoles: string[]): boolean {
  //@ ensures \result === true
  return !(!staffStepEveryApp(staffStep)) || !staffStepAdmitted(staffStep, appName, ([] as string[]), globalRoles);
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function lawEmployerVerificationOnlyOnPeon(appName: string, appRoles: string[], globalRoles: string[]): boolean {
  //@ ensures \result === true
  return !staffStepAdmitted("VerifyEmployer", appName, appRoles, globalRoles) || appName === "peon";
}

/** Story: Take a gate or safety step in the console as myself / Each console staff step needs the role that its staff route needs (spec/staffPermissions.md) */
//@ pure
export function lawMatchmakerStepsRefusedOnPeon(appRoles: string[], globalRoles: string[]): boolean {
  //@ ensures \result === true
  return !staffStepAdmitted("ReadMatchmakers", "peon", appRoles, globalRoles) && !staffStepAdmitted("UpdateMatchmakerStatus", "peon", appRoles, globalRoles);
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function staffStepNeedsPerson(staffStep: StaffStep): boolean {
  return staffStep === "DecideReviewItem" ? false : staffStep === "StopApprovedReview" ? false : staffStep === "ReadJudgedReviews" ? false : true;
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function staffStepActorAccepted(consoleConfigured: boolean, staffStep: StaffStep, actor: StepActor): boolean {
  return actor === "NamedReviewer" || !consoleConfigured || !staffStepNeedsPerson(staffStep);
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawConsoleServiceRefusesSharedToken(consoleConfigured: boolean, staffStep: StaffStep): boolean {
  //@ ensures \result === true
  return !(consoleConfigured && staffStepNeedsPerson(staffStep)) || !staffStepActorAccepted(consoleConfigured, staffStep, "SharedToken");
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawOnlyReviewDeskStepsTakeSharedToken(staffStep: StaffStep): boolean {
  //@ ensures \result === true
  return !staffStepActorAccepted(true, staffStep, "SharedToken") || (staffStep === "DecideReviewItem" || staffStep === "StopApprovedReview" || staffStep === "ReadJudgedReviews");
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawSafetyCaseNeedsPerson(consoleConfigured: boolean): boolean {
  //@ ensures \result === true
  return !consoleConfigured || !staffStepActorAccepted(consoleConfigured, "DecideSafetyCase", "SharedToken");
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawNamedReviewerAlwaysAccepted(consoleConfigured: boolean, staffStep: StaffStep): boolean {
  //@ ensures \result === true
  return staffStepActorAccepted(consoleConfigured, staffStep, "NamedReviewer");
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawConsoleTokenOnlyTightens(staffStep: StaffStep, actor: StepActor): boolean {
  //@ ensures \result === true
  return !staffStepActorAccepted(true, staffStep, actor) || staffStepActorAccepted(false, staffStep, actor);
}

/** Story: Take a gate or safety step in the console as myself / The staff API takes a step that needs a person only from a named person (spec/staffPermissions.md) */
//@ pure
export function lawConsoleTokenDecidesOnlyForSharedToken(consoleConfigured: boolean, staffStep: StaffStep, actor: StepActor): boolean {
  //@ ensures \result === true
  return !(staffStepActorAccepted(consoleConfigured, staffStep, actor) !== staffStepActorAccepted(!consoleConfigured, staffStep, actor)) || actor === "SharedToken";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RouteCheck, event: Event): boolean {
  if (event.type === "authorizeRoute") return canAuthorizeRoute(current);
  if (event.type === "enterHandler") return canEnterHandler(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RouteCheck, event: Event): RouteCheck {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "authorizeRoute") return canAuthorizeRoute(current) ? authorizeRoute(current, event.routeFacts, event.roles, event.requiredRoles) : current;
  if (event.type === "enterHandler") return canEnterHandler(current) ? enterHandler(current) : current;
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
  const is_RouteFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.appRoute === "boolean" && typeof v.roleRestricted === "boolean" && typeof v.mutating === "boolean" && typeof v.hasModeHeader === "boolean" && typeof v.matchesMode === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "authorizeRoute" && is_RouteFacts(raw.routeFacts) && Array.isArray(raw.roles) && raw.roles.every((x0: any) => typeof x0 === "string") && Array.isArray(raw.requiredRoles) && raw.requiredRoles.every((x0: any) => typeof x0 === "string")) return { type: "authorizeRoute", routeFacts: ({ appRoute: raw.routeFacts.appRoute, roleRestricted: raw.routeFacts.roleRestricted, mutating: raw.routeFacts.mutating, hasModeHeader: raw.routeFacts.hasModeHeader, matchesMode: raw.routeFacts.matchesMode }), roles: raw.roles.map((x0: any) => x0), requiredRoles: raw.requiredRoles.map((x0: any) => x0) };
  if (raw.type === "enterHandler") return { type: "enterHandler" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): RouteCheck | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "RouteUnchecked" || raw.phase === "RouteAdmitted" || raw.phase === "RouteRefused" || raw.phase === "RouteRunning") && (raw.decision === "NoAppRole" || raw.decision === "AdmitRoute" || raw.decision === "NeedsRole" || raw.decision === "ModeChanged") && Object.keys(raw).length === 2)) return undefined;
  const parsed: RouteCheck = ({ phase: raw.phase, decision: raw.decision });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RouteCheck {
  //@ ensures inv(\result)
  return initial;
}
