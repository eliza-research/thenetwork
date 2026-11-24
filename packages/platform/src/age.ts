import { canBeMatched, canJoin, validAge } from "../../core/src/policy.ts";
import { birthKeyOfParts, earliestDayKeyOf, latestDayKeyOf } from "../../core/src/birth-date.ts";
import {
  ageOnDay, birthDateExact, birthDateLower, birthKeyUsable, type BirthReadings, effectiveAge, effectiveBirthKey, laterBirthKey,
  lowerAge, readingsConflict, signupAgeAt, statedAgeBeforeBirthDates, statedAgeLower, statedAgeUpper,
} from "../../core/src/generated/memberAge.ts";
import { teenBarOnConflict } from "../../core/src/generated/friendIntroAge.ts";
import { exactReadingKept, firstReadingExact, floorStatedAge, mergeAgeReadings } from "../../core/src/generated/siteEnrollment.ts";
import type { AppInfo } from "./apps.ts";
import type { AgeFloorRecord, Person, SignupAge } from "./store.ts";

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

export type AgeReading = { kind: "age"; age: number } | { kind: "birthDate"; birthDate: number };
export type TeenBarReason = "conflict" | "report" | "older_than_stated" | "ban";

export interface AgeStanding { person: Person | undefined; floor: AgeFloorRecord | undefined; signup?: SignupAge }

export interface AgeRecord {
  age: number | undefined;
  maxAge: number | undefined;
  birthKey: number | undefined;
  birthExact: boolean;
  ageConflict: boolean;
  teenBarred: boolean;
}

interface PersonAgeWrite { readings: BirthReadings; birthDate: number | null; firstExact: boolean | null; lowestAge: number }
interface MovedPersonAge { person: PersonAgeWrite; bar: boolean }
interface AgeWrite { person: PersonAgeWrite | undefined; floor: AgeFloorRecord; bar: boolean }

const NO_READINGS: BirthReadings = { lower: 0, upper: 0, youngest: 0 };

const typedReading = (age: number, dayKey: number): BirthReadings => {
  const upper = statedAgeUpper(age, dayKey);
  return { lower: statedAgeLower(age, dayKey), upper, youngest: upper };
};

const exactReading = (birthKey: number): BirthReadings => ({ lower: birthDateLower(birthKey), upper: birthKey, youngest: birthKey });

const mergeInto = (earlier: BirthReadings | undefined, reading: BirthReadings): BirthReadings =>
  mergeAgeReadings(earlier !== undefined, earlier ?? NO_READINGS, reading);

const mergeRecords = (first: BirthReadings | undefined, second: BirthReadings | undefined): BirthReadings | undefined =>
  second === undefined ? first : mergeInto(first, second);

const floorAt = (before: AgeFloorRecord | undefined, age: number, at: number): number => (before && before.age <= age ? before.at : at);

const livePerson = (p: Person | undefined): Person | undefined => (p && p.deletedAt === null ? p : undefined);

export const joinBirthDateUsable = (birthKey: number, at: number): boolean =>
  birthKeyOfParts(Math.trunc(birthKey / 10000), Math.trunc(birthKey / 100) % 100, birthKey % 100) === birthKey && birthKeyUsable(birthKey, earliestDayKeyOf(at));

export const readingAge = (stated: AgeReading, at: number): number =>
  stated.kind === "age" ? stated.age : ageOnDay(stated.birthDate, earliestDayKeyOf(at));

function personReadings(p: Person | undefined, at: number): BirthReadings | undefined {
  const live = livePerson(p);
  if (!live) return undefined;
  if (live.birth) return live.birth.readings;
  return live.lowestAge === null ? undefined : statedAgeBeforeBirthDates(live.lowestAge, earliestDayKeyOf(live.createdAt), earliestDayKeyOf(at));
}

function floorReadings(f: AgeFloorRecord | undefined): BirthReadings | undefined {
  if (!f) return undefined;
  return f.readings ?? statedAgeBeforeBirthDates(f.age, earliestDayKeyOf(f.at), earliestDayKeyOf(f.at));
}

const hasStoredReadings = (s: AgeStanding): boolean => !!livePerson(s.person)?.birth || !!s.floor?.readings;

function combinedReadings(s: AgeStanding, at: number): BirthReadings | undefined {
  return mergeRecords(personReadings(s.person, at), floorReadings(s.floor));
}

export function effectiveAgeAt(s: AgeStanding, at: number): number | undefined {
  const readings = hasStoredReadings(s) ? combinedReadings(s, at) : undefined;
  const age = readings ? effectiveAge(readings, earliestDayKeyOf(at)) : lowestAge(livePerson(s.person)?.lowestAge, s.floor?.age);
  if (!s.signup) return age;
  const signup = signupAgeAt(s.signup.initialMinorAge, s.signup.eligibleAt, at);
  return at < s.signup.eligibleAt ? lowestAge(age, signup) : age ?? signup;
}

export function ageRecordOf(s: AgeStanding, at: number, barred: boolean): AgeRecord {
  const readings = hasStoredReadings(s) ? combinedReadings(s, at) : undefined;
  if (readings === undefined) {
    const integerAge = effectiveAgeAt(s, at);
    return { age: integerAge, maxAge: integerAge, birthKey: undefined, birthExact: false, ageConflict: false, teenBarred: barred };
  }
  const key = effectiveBirthKey(readings);
  const birthDate = livePerson(s.person)?.birth?.birthDate ?? null;
  return {
    age: effectiveAgeAt(s, at),
    maxAge: ageOnDay(key, latestDayKeyOf(at)),
    birthKey: key,
    birthExact: birthDateExact(birthDate !== null, birthDate ?? 0, readings),
    ageConflict: readingsConflict(readings),
    teenBarred: barred,
  };
}

function personFirstExact(p: Person, statesUsableBirthDate: boolean): boolean {
  const stored = p.birth?.firstExact ?? null;
  const hadReading = p.birth === null && p.lowestAge !== null;
  return firstReadingExact(stored !== null, stored === true, hadReading, statesUsableBirthDate);
}

function personAfter(p: Person, at: number, reading: BirthReadings, birthDate: number | null, statedAge: number): PersonAgeWrite {
  const storedDate = p.birth?.birthDate ?? null;
  return {
    readings: mergeInto(personReadings(p, at), reading),
    birthDate: birthDate === null ? storedDate : laterBirthKey(storedDate ?? birthDate, birthDate),
    firstExact: personFirstExact(p, birthDate !== null),
    lowestAge: lowerAge(p.lowestAge ?? statedAge, statedAge),
  };
}

function floorFirstExact(f: AgeFloorRecord | undefined, statesUsableBirthDate: boolean): boolean {
  const stored = f?.firstExact ?? null;
  return firstReadingExact(stored !== null, stored === true, f !== undefined, statesUsableBirthDate);
}

export const createdFirstExact = (floor: AgeFloorRecord | undefined): boolean | null =>
  floor === undefined ? null : floorFirstExact(floor, false);

export function ageWrite(s: AgeStanding, stated: AgeReading, at: number): AgeWrite | undefined {
  const today = earliestDayKeyOf(at);
  if (stated.kind === "birthDate" && !birthKeyUsable(stated.birthDate, today)) return undefined;
  const statedAge = readingAge(stated, at);
  if (!validAge(statedAge)) return undefined;
  const typed = typedReading(statedAge, today);
  const floorBefore = floorReadings(s.floor);
  const person = livePerson(s.person);
  const statesBirthDate = stated.kind === "birthDate";
  const exact = person && stated.kind === "birthDate" ? personAfter(person, at, exactReading(stated.birthDate), stated.birthDate, statedAge) : undefined;
  const ageWithBirthDate = exact ? effectiveAge(mergeRecords(exact.readings, floorBefore) ?? exact.readings, today) : statedAge;
  const keepExact = exactReadingKept(statesBirthDate, person !== undefined, ageWithBirthDate);
  const personNext = keepExact && exact ? exact : person ? personAfter(person, at, typed, null, statedAge) : undefined;
  const withStatement = personNext ? mergeRecords(personNext.readings, floorBefore) ?? personNext.readings : mergeInto(floorBefore, typed);
  const floorAge = floorStatedAge(statedAge, effectiveAge(withStatement, today));
  const floorLowest = lowestAge(s.floor?.age, floorAge, person?.lowestAge ?? undefined) ?? floorAge;
  const floorAfter = mergeInto(floorBefore, typedReading(floorAge, today));
  const floor: AgeFloorRecord = {
    age: floorLowest, at: floorAt(s.floor, floorLowest, at), readings: floorAfter,
    firstExact: floorFirstExact(s.floor, statesBirthDate && canJoin(statedAge)),
  };
  const final = mergeRecords(personNext?.readings, floorAfter) ?? floorAfter;
  return { person: personNext, floor, bar: teenBarOnConflict(readingsConflict(final), ageOnDay(final.youngest, latestDayKeyOf(at))) };
}

export function createdReadings(floor: AgeFloorRecord | undefined, lowest: number | null, at: number): BirthReadings | undefined {
  const typed = lowest !== null && validAge(lowest) ? typedReading(lowest, earliestDayKeyOf(at)) : undefined;
  return mergeRecords(floorReadings(floor), typed);
}

export function floorAfterErasure(s: AgeStanding, at: number): AgeFloorRecord | undefined {
  const age = effectiveAgeAt(s, at);
  if (age === undefined || !validAge(age) || age <= 0) return undefined;
  const integer = lowestAge(age, livePerson(s.person)?.lowestAge ?? undefined, s.floor?.age) ?? age;
  return { age: integer, at: floorAt(s.floor, integer, at), readings: mergeInto(floorReadings(s.floor), typedReading(age, earliestDayKeyOf(at))), firstExact: false };
}

export function mergedFloors(moved: AgeFloorRecord, existing: AgeFloorRecord | undefined): AgeFloorRecord {
  if (!existing) return moved;
  const readings = moved.readings || existing.readings ? mergeRecords(floorReadings(moved), floorReadings(existing)) ?? null : null;
  const lower = moved.age <= existing.age ? moved : existing;
  return { age: lower.age, at: lower.at, readings, firstExact: false };
}

export function movedPersonAge(s: AgeStanding, at: number): MovedPersonAge | undefined {
  const person = livePerson(s.person);
  const floor = floorReadings(s.floor);
  if (!person || !s.floor || floor === undefined) return undefined;
  const readings = mergeRecords(personReadings(person, at), floor) ?? floor;
  return {
    person: {
      readings,
      birthDate: person.birth?.birthDate ?? null,
      firstExact: personFirstExact(person, false),
      lowestAge: lowestAge(person.lowestAge ?? undefined, s.floor.age) ?? s.floor.age,
    },
    bar: teenBarOnConflict(readingsConflict(readings), ageOnDay(readings.youngest, latestDayKeyOf(at))),
  };
}
