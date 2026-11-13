// Age policy per app (platform plan 2.6), built on the one age policy in packages/core/src/policy.ts.
// Age is a person-level fact: the lowest age a person ever stated or a record held, on any app,
// decides. A person who said 15 on ntwrk cannot join slop later by saying 25.
import { canBeMatched, validAge } from "../../core/src/policy.ts";
import { lowerAge } from "../../core/src/generated/memberAge.ts";
import type { AppInfo } from "./apps.ts";

/** The lowest valid age of the ones given (undefined if none is valid). Unknown never raises an age. */
export function lowestAge(...ages: unknown[]): number | undefined {
  // spec/memberAge.md, "An older age cannot raise the effective age"
  let lowest: number | undefined;
  for (const age of ages) {
    if (!validAge(age)) continue;
    // Preserve Math.min's treatment of signed zero at the JavaScript boundary.
    lowest = lowest === undefined || Object.is(age, -0) ? age : lowerAge(lowest, age);
  }
  return lowest;
}

/** True if a person of this age may join the app. Missing or invalid ages fail closed. */
export const canJoinApp = (age: unknown, app: Pick<AppInfo, "minJoinAge">): boolean => validAge(age) && age >= app.minJoinAge;

/** True if a member of this age may be matched with others in the app. Never below the shared adult age. */
export const canMatchInApp = (age: unknown, app: Pick<AppInfo, "minMatchAge">): boolean => typeof age === "number" && canBeMatched(age) && age >= app.minMatchAge;

/** The join decision for a stated age and the person's stored lowest age (if any). */
export function joinAgeCheck(stated: unknown, personLowest: number | null | undefined, app: Pick<AppInfo, "minJoinAge">): { ok: boolean; effective: number | undefined } {
  if (!validAge(stated)) return { ok: false, effective: undefined };
  const effective = lowestAge(stated, personLowest ?? undefined);
  return { ok: canJoinApp(effective, app), effective };
}
