// Which staff grants count, as pure functions, proved with LemmaScript. This file imports nothing.
// Who the user is (tokens, Cloudflare Access) is staff.ts, and is outside this proof.

export type GrantRole = "admin" | "reviewer" | "safety" | "analyst" | "engineer" | "cross_app_safety";
export type GrantMode = "game" | "real";
export interface Grant { role: GrantRole; app: string; }

/** A grant counts for one app: for that app or every app. Engineer gives nothing in real mode; cross_app_safety is never a per-app role. */
export function roleCounts(g: Grant, app: string, mode: GrantMode): boolean {
  //@ verify
  //@ ensures \result ==> g.role !== "cross_app_safety"
  //@ ensures \result && mode === "real" ==> g.role !== "engineer"
  //@ ensures \result ==> g.app === "*" || g.app === app
  if (g.app !== "*" && g.app !== app) return false;
  if (g.role === "cross_app_safety" || (g.role === "engineer" && mode === "real")) return false;
  return true;
}

/** Admin for the app passes every check for it; anyone else needs one of the listed roles for that app. */
export function allowedFor(grants: Grant[], need: GrantRole[], app: string, mode: GrantMode): boolean {
  //@ verify
  //@ ensures \result ==> exists(i: number, 0 <= i && i < grants.length && roleCounts(grants[i], app, mode) && (grants[i].role === "admin" || need.includes(grants[i].role)))
  return grants.some(g => roleCounts(g, app, mode) && (g.role === "admin" || need.includes(g.role)));
}

/** The role for every app ("role@*"). */
export function holdsEverywhere(grants: Grant[], role: GrantRole): boolean {
  //@ verify
  return grants.some(g => g.role === role && g.app === "*");
}

/** The cross-app person view: cross_app_safety@* or admin@*. Never a reviewer. */
export function crossAppAllowed(grants: Grant[]): boolean {
  //@ verify
  //@ ensures \result ==> exists(i: number, 0 <= i && i < grants.length && grants[i].app === "*" && (grants[i].role === "admin" || grants[i].role === "cross_app_safety"))
  return holdsEverywhere(grants, "admin") || holdsEverywhere(grants, "cross_app_safety");
}
