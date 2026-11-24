// Age policy per app (platform plan 2.6), built on the one age policy in packages/core/src/policy.ts.
// Age is a person-level fact: the lowest age a person ever stated or a record held, on any app,
// decides. A person who said 15 on ntwrk cannot join slop later by saying 25.
import { canBeMatched, validAge } from "../../core/src/policy.ts";
import { adultAge, joinableAge, lowerAge } from "../../core/src/generated/memberAge.ts";
import { ageOnDate, birthdateAccepted, calendarDateOfDay, signupAdultDate, signupClockDay } from "../../core/src/generated/authorizationPages.ts";
import type { AppInfo } from "./apps.ts";
import type { PeopleStore, Person, SignupAge } from "./store.ts";

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

/** Resolve only the effective age. The private eligibility date stays inside the store. */
export async function personAgeAt(store: Pick<PeopleStore, "signupAgeAt">, person: Person, now: number): Promise<number | undefined> {
  return lowestAge(person.lowestAge, await store.signupAgeAt(person.id, now));
}

/** Convert a browser birthday before it reaches the account or profile. */
export function parseSignupBirthday(value: unknown, now: number): { age: number; signupAge?: SignupAge } | undefined {
  const parts = typeof value === "string" ? /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value) : null;
  if (!parts) return;
  const birth = { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) };
  const today = calendarDateOfDay(signupClockDay(now));
  if (!birthdateAccepted(birth, today)) return;
  const age = ageOnDate(birth, today);
  if (!joinableAge(age) || age >= adultAge) return { age };
  const adultDate = signupAdultDate(birth);
  return { age, signupAge: { initialMinorAge: age, eligibleAt: Date.UTC(adultDate.year, adultDate.month - 1, adultDate.day, 12) } };
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
