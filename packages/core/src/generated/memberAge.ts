// GENERATED from spec/memberAge.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny


/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md:20) */
export const minMemberAge: number = 13;
/** Story: Join at the eligible age / Age data outside the human range is unusable (spec/memberAge.md:9) */
export const maxAge: number = 120;
/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md:38) */
export const adultAge: number = 18;

/** Story: Join at the eligible age / Age data outside the human range is unusable (spec/memberAge.md:9) */
//@ pure
export function ageInRange(age: number): boolean {
  return age >= 0 && age <= maxAge;
}

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md:20) */
//@ pure
export function joinableAge(age: number): boolean {
  return ageInRange(age) && age >= minMemberAge;
}

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md:20) */
//@ pure
export function lawJoiningNeedsUsableAge(age: number): boolean {
  //@ ensures \result === true
  return !joinableAge(age) || (age >= minMemberAge && age <= maxAge);
}

/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md:38) */
//@ pure
export function matchableAge(age: number): boolean {
  return ageInRange(age) && age >= adultAge;
}

/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md:38) */
//@ pure
export function lawMatchingNeedsAdultAge(age: number): boolean {
  //@ ensures \result === true
  return !matchableAge(age) || (age >= adultAge && joinableAge(age));
}

/** Story: Take part in adult matching / An older age cannot raise the effective age (spec/memberAge.md:52) */
//@ pure
export function lowerAge(firstAge: number, secondAge: number): number {
  return firstAge <= secondAge ? firstAge : secondAge;
}

/** Story: Take part in adult matching / An older age cannot raise the effective age (spec/memberAge.md:52) */
//@ pure
export function lawEffectiveAgeCannotRise(firstAge: number, secondAge: number): boolean {
  //@ ensures \result === true
  return lowerAge(firstAge, secondAge) <= firstAge && lowerAge(firstAge, secondAge) <= secondAge;
}
