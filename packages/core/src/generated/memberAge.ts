// GENERATED from spec/memberAge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export type HalfAgeEvidence = "HalfAgeUnknown" | "HalfAgeLoose" | "HalfAgeExplicit";

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md) */
export const minMemberAge: number = 13;
/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export const minLooseTeamAge: number = 10;
/** Story: Join at the eligible age / Age data outside the human range is unusable (spec/memberAge.md) */
export const maxAge: number = 120;
/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md) */
export const adultAge: number = 18;

/** Story: Join at the eligible age / Age data outside the human range is unusable (spec/memberAge.md) */
//@ pure
export function ageInRange(age: number): boolean {
  return age >= 0 && age <= maxAge;
}

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md) */
//@ pure
export function joinableAge(age: number): boolean {
  return ageInRange(age) && age >= minMemberAge;
}

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md) */
//@ pure
export function lawJoiningNeedsUsableAge(age: number): boolean {
  //@ ensures \result === true
  return !joinableAge(age) || (age >= minMemberAge && age <= maxAge);
}

/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md) */
//@ pure
export function matchableAge(age: number): boolean {
  return ageInRange(age) && age >= adultAge;
}

/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md) */
//@ pure
export function lawMatchingNeedsAdultAge(age: number): boolean {
  //@ ensures \result === true
  return !matchableAge(age) || (age >= adultAge && joinableAge(age));
}

/** Story: Take part in adult matching / Commit a stated age before projecting it across apps (spec/memberAge.md) */
//@ pure
export function recordedChatAge(age: number, appMinimum: number, declined: boolean): number {
  return declined || age >= appMinimum ? age : appMinimum;
}

/** Story: Take part in adult matching / Commit a stated age before projecting it across apps (spec/memberAge.md) */
//@ pure
export function lawDeclineKeepsStatedAge(age: number, appMinimum: number): boolean {
  //@ ensures \result === true
  return recordedChatAge(age, appMinimum, true) === age;
}

/** Story: Take part in adult matching / Commit a stated age before projecting it across apps (spec/memberAge.md) */
//@ pure
export function confirmedUnderage(age: number): boolean {
  return ageInRange(age) && !joinableAge(age);
}

/** Story: Take part in adult matching / Project a committed age using its original owner (spec/memberAge.md) */
//@ pure
export function recordedAgeFloorApplies(recordedOwner: string, currentOwner: string): boolean {
  return recordedOwner === currentOwner;
}

/** Story: Take part in adult matching / Project a committed age using its original owner (spec/memberAge.md) */
//@ pure
export function lawPhoneReassignmentEndsAgeProjection(recordedOwner: string, currentOwner: string): boolean {
  //@ ensures \result === true
  return !(recordedOwner !== currentOwner) || !recordedAgeFloorApplies(recordedOwner, currentOwner);
}

/** Story: Take part in adult matching / Resume a confirmed refusal from the durable age (spec/memberAge.md) */
//@ pure
export function underageCleanupRequired(age: number, membershipLive: boolean): boolean {
  return confirmedUnderage(age) && membershipLive;
}

/** Story: Take part in adult matching / Resume a confirmed refusal from the durable age (spec/memberAge.md) */
//@ pure
export function lawUnderageCleanupNeedsAConfirmedAge(age: number, membershipLive: boolean): boolean {
  //@ ensures \result === true
  return !underageCleanupRequired(age, membershipLive) || confirmedUnderage(age);
}

/** Story: Take part in adult matching / A confirmed refusal applies before every app finishes cleanup (spec/memberAge.md) */
//@ pure
export function textUseAllowedAtAge(age: number, complianceOrLeave: boolean): boolean {
  return !confirmedUnderage(age) || complianceOrLeave;
}

/** Story: Take part in adult matching / A confirmed refusal applies before every app finishes cleanup (spec/memberAge.md) */
//@ pure
export function lawConfirmedUnderageCannotRestart(age: number): boolean {
  //@ ensures \result === true
  return !confirmedUnderage(age) || !textUseAllowedAtAge(age, false);
}

/** Story: Take part in adult matching / A near birthday gives an estimate for the present age (spec/memberAge.md) */
//@ pure
export function precedingBirthdayAge(nextAge: number): number {
  return exact_memberAge(nextAge - 1);
}

/** Story: Take part in adult matching / A near birthday gives an estimate for the present age (spec/memberAge.md) */
//@ pure
export function ageQualifierFollows(nearBirthday: boolean, distantBirthday: boolean): boolean {
  return nearBirthday || distantBirthday;
}

/** Story: Take part in adult matching / A near birthday gives an estimate for the present age (spec/memberAge.md) */
//@ pure
export function lawDistantBirthdayQualifiesTheAge(nearBirthday: boolean): boolean {
  //@ ensures \result === true
  return ageQualifierFollows(nearBirthday, true);
}

/** Story: Take part in adult matching / A near birthday gives an estimate for the present age (spec/memberAge.md) */
//@ pure
export function lawBeforeAnEighteenthBirthdayIsNotAdult(nextAge: number): boolean {
  //@ ensures \result === true
  return !(nextAge <= adultAge) || !matchableAge(precedingBirthdayAge(nextAge));
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function ageConjunctionAllowed(age: number, statedBirthday: boolean, sportsRecord: boolean, teamResult: boolean): boolean {
  return statedBirthday || age >= minMemberAge || (!sportsRecord && (!teamResult || age >= minLooseTeamAge));
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function halfAgeEvidence(writtenAsAge: boolean, atClauseEnd: boolean, future: boolean): HalfAgeEvidence {
  return future ? "HalfAgeUnknown" : (writtenAsAge ? "HalfAgeExplicit" : (atClauseEnd ? "HalfAgeLoose" : "HalfAgeUnknown"));
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawSmallSportsRecordsDoNotSupplyAge(age: number): boolean {
  //@ ensures \result === true
  return !(age < minMemberAge) || !ageConjunctionAllowed(age, false, true, false);
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawSmallTeamResultsDoNotSupplyAge(age: number): boolean {
  //@ ensures \result === true
  return !(age < minLooseTeamAge) || !ageConjunctionAllowed(age, false, false, true);
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawStatedBirthdaySurvivesSportsContext(age: number): boolean {
  //@ ensures \result === true
  return ageConjunctionAllowed(age, true, true, true);
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawAnUpcomingHalfAgeSuppliesNoCurrentAge(writtenAsAge: boolean, atClauseEnd: boolean): boolean {
  //@ ensures \result === true
  return halfAgeEvidence(writtenAsAge, atClauseEnd, true) === "HalfAgeUnknown";
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawAHalfAgeNeedsAgeWordsToBeExplicit(atClauseEnd: boolean, future: boolean): boolean {
  //@ ensures \result === true
  return halfAgeEvidence(false, atClauseEnd, future) !== "HalfAgeExplicit";
}

/** Story: Take part in adult matching / An older age cannot raise the effective age (spec/memberAge.md) */
//@ pure
export function lowerAge(firstAge: number, secondAge: number): number {
  return firstAge <= secondAge ? firstAge : secondAge;
}

/** Story: Take part in adult matching / An older age cannot raise the effective age (spec/memberAge.md) */
//@ pure
export function lawEffectiveAgeCannotRise(firstAge: number, secondAge: number): boolean {
  //@ ensures \result === true
  return lowerAge(firstAge, secondAge) <= firstAge && lowerAge(firstAge, secondAge) <= secondAge;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_memberAge(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
