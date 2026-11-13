// GENERATED from spec/staffPermissions.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md:9) */
export interface StaffGrant { app: string; role: string }
/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md:30) */
export type Admission = "AdmitRoute" | "NoAppRole" | "NeedsRole" | "ModeChanged";
/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md:30) */
export interface RouteFacts { appRoute: boolean; roleRestricted: boolean; mutating: boolean; hasModeHeader: boolean; matchesMode: boolean }
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
export type AdmissionPhase = "RouteUnchecked" | "RouteAdmitted" | "RouteRefused" | "RouteRunning";
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
export interface RouteCheck { phase: AdmissionPhase; decision: Admission }
/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md:88) */
export type MemberAccess = "AnyMember" | "OpenReviewMember" | "MemberRefused";

/** One variant per transition in the spec. */
export type Event =
  | { type: "enterHandler" }
  | { type: "authorizeRoute"; routeFacts: RouteFacts; roles: string[]; requiredRoles: string[] };

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
export const appRead: RouteFacts = { appRoute: true, roleRestricted: false, mutating: false, hasModeHeader: false, matchesMode: true };
/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
export const initial: RouteCheck = { phase: "RouteUnchecked", decision: "NoAppRole" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RouteCheck): boolean {
  return alwaysRunningRouteWasAdmitted(current);
}

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md:9) */
//@ pure
export function scopedGrants(grants: StaffGrant[], appName: string, realMode: boolean): StaffGrant[] {
  return grants.filter((g: StaffGrant) => (g.app === "*" || g.app === appName) && g.role !== "cross_app_safety" && (!realMode || g.role !== "engineer"));
}

/** Story: Work within my assigned staff role / A grant applies only to its app and mode (spec/staffPermissions.md:9) */
//@ pure
export function globalGrants(grants: StaffGrant[]): StaffGrant[] {
  return grants.filter((g: StaffGrant) => g.app === "*");
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md:30) */
//@ pure
export function allowedByRole(roles: string[], requiredRoles: string[]): boolean {
  return roles.includes("admin") || requiredRoles.some((r: string) => roles.includes(r));
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md:30) */
//@ pure
export function mayOpenCrossApp(globalRoles: string[]): boolean {
  return allowedByRole(globalRoles, ["cross_app_safety"]);
}

/** Story: Work within my assigned staff role / App admission requires an applicable role and the requested capability (spec/staffPermissions.md:30) */
//@ pure
export function routeAdmission(routeFacts: RouteFacts, roles: string[], requiredRoles: string[]): Admission {
  return routeFacts.appRoute && roles.length === 0 ? "NoAppRole" : (routeFacts.roleRestricted && !allowedByRole(roles, requiredRoles) ? "NeedsRole" : (routeFacts.appRoute && routeFacts.mutating && routeFacts.hasModeHeader && !routeFacts.matchesMode ? "ModeChanged" : "AdmitRoute"));
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function canAuthorizeRoute(check: RouteCheck): boolean {
  return check.phase === "RouteUnchecked";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function canEnterHandler(check: RouteCheck): boolean {
  return check.phase === "RouteAdmitted";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function enterHandler(check: RouteCheck): RouteCheck {
  //@ ensures (inv(check) && canEnterHandler(check)) ==> alwaysRunningRouteWasAdmitted(\result)
  //@ ensures (inv(check) && canEnterHandler(check)) ==> stepRefusedRouteStaysClosed(check, \result)
  return { ...check, phase: "RouteRunning" };
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function alwaysRunningRouteWasAdmitted(check: RouteCheck): boolean {
  return !(check.phase === "RouteAdmitted" || check.phase === "RouteRunning") || check.decision === "AdmitRoute";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function stepRefusedRouteStaysClosed(before: RouteCheck, after: RouteCheck): boolean {
  return !(before.phase === "RouteRefused") || after.phase === "RouteRefused";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function sometimesHandlerRuns(check: RouteCheck): boolean {
  return check.phase === "RouteRunning";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function sometimesRouteIsRefused(check: RouteCheck): boolean {
  return check.phase === "RouteRefused";
}

/** Story: Work within my assigned staff role / Only an admitted route can reach its handler (spec/staffPermissions.md:50) */
//@ pure
export function authorizeRoute(check: RouteCheck, routeFacts: RouteFacts, roles: string[], requiredRoles: string[]): RouteCheck {
  //@ ensures (inv(check) && canAuthorizeRoute(check)) ==> alwaysRunningRouteWasAdmitted(\result)
  //@ ensures (inv(check) && canAuthorizeRoute(check)) ==> stepRefusedRouteStaysClosed(check, \result)
  const decision: Admission = routeAdmission(routeFacts, roles, requiredRoles);
  return { phase: decision === "AdmitRoute" ? "RouteAdmitted" : "RouteRefused", decision: decision };
}

/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md:88) */
//@ pure
export function fullStaffView(roles: string[]): boolean {
  return allowedByRole(roles, ["reviewer", "safety", "engineer"]);
}

/** Story: See only the detail my role permits / The analyst view shows counts and shapes rather than people (spec/staffPermissions.md:88) */
//@ pure
export function staffMemberAccess(roles: string[], realMode: boolean): MemberAccess {
  return allowedByRole(roles, ["safety"]) || (!realMode && roles.includes("engineer")) ? "AnyMember" : (roles.includes("reviewer") ? "OpenReviewMember" : "MemberRefused");
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RouteCheck, event: Event): boolean {
  if (event.type === "enterHandler") return canEnterHandler(current);
  if (event.type === "authorizeRoute") return canAuthorizeRoute(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RouteCheck, event: Event): RouteCheck {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "enterHandler" && canEnterHandler(current)) return enterHandler(current);
  if (event.type === "authorizeRoute" && canAuthorizeRoute(current)) return authorizeRoute(current, event.routeFacts, event.roles, event.requiredRoles);
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
  if (raw.type === "enterHandler") return { type: "enterHandler" };
  if (raw.type === "authorizeRoute" && typeof raw.routeFacts === "object" && raw.routeFacts !== null && !Array.isArray(raw.routeFacts) && typeof raw.routeFacts.appRoute === "boolean" && typeof raw.routeFacts.roleRestricted === "boolean" && typeof raw.routeFacts.mutating === "boolean" && typeof raw.routeFacts.hasModeHeader === "boolean" && typeof raw.routeFacts.matchesMode === "boolean" && Array.isArray(raw.roles) && raw.roles.every((x0: any) => typeof x0 === "string") && Array.isArray(raw.requiredRoles) && raw.requiredRoles.every((x0: any) => typeof x0 === "string")) return { type: "authorizeRoute", routeFacts: ({ appRoute: raw.routeFacts.appRoute, roleRestricted: raw.routeFacts.roleRestricted, mutating: raw.routeFacts.mutating, hasModeHeader: raw.routeFacts.hasModeHeader, matchesMode: raw.routeFacts.matchesMode }), roles: raw.roles.map((x0: any) => x0), requiredRoles: raw.requiredRoles.map((x0: any) => x0) };
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
