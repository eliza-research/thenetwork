// Age policy per app (platform plan 2.6), built on the one age policy in packages/core/src/policy.ts.
// Age is a person-level fact: the lowest age a person ever stated or a record held, on any app,
// decides. A person who said 15 on ntwrk cannot join slop later by saying 25.
import { isMinor, validAge } from "../../core/src/policy.ts";
import type { AppInfo } from "./apps.ts";

/** The lowest valid age of the ones given (undefined if none is valid). Unknown never raises an age. */
export function lowestAge(...ages: unknown[]): number | undefined {
  const ok = ages.filter(validAge);
  return ok.length ? Math.min(...ok) : undefined;
}

/** True if a person of this age may join the app. Missing or invalid ages fail closed. */
export const canJoinApp = (age: unknown, app: Pick<AppInfo, "minJoinAge">): boolean => validAge(age) && age >= app.minJoinAge;

/** True if a member of this age may be matched with others in the app. Never below 18 (core isMinor). */
export const canMatchInApp = (age: unknown, app: Pick<AppInfo, "minMatchAge">): boolean => !isMinor(age) && (age as number) >= app.minMatchAge;

/** The join decision for a stated age and the person's stored lowest age (if any). */
export function joinAgeCheck(stated: unknown, personLowest: number | null | undefined, app: Pick<AppInfo, "minJoinAge">): { ok: boolean; effective: number | undefined } {
  if (!validAge(stated)) return { ok: false, effective: undefined };
  const effective = lowestAge(stated, personLowest ?? undefined);
  return { ok: canJoinApp(effective, app), effective };
}
