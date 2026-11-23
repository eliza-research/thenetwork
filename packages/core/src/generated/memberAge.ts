// GENERATED from spec/memberAge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export type FractionalAgeEvidence = "FractionalAgeUnknown" | "FractionalAgeLoose" | "FractionalAgeExplicit";

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md) */
export const minMemberAge: number = 13;
/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export const minLooseHeightAge: number = 8;
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

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function ageConjunctionAllowed(age: number, statedBirthday: boolean, sportsRecord: boolean, teamResult: boolean): boolean {
  return statedBirthday || age >= minMemberAge || (!sportsRecord && (!teamResult || age >= minLooseTeamAge));
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
export function fractionalAgeEvidence(age: number, possibleHeight: boolean, monthsOrQuarter: boolean, writtenAsAge: boolean, atClauseEnd: boolean, atAgeTail: boolean, future: boolean): FractionalAgeEvidence {
  return future ? "FractionalAgeUnknown" : (writtenAsAge ? "FractionalAgeExplicit" : (possibleHeight && age < minLooseHeightAge ? "FractionalAgeUnknown" : ((!monthsOrQuarter && atClauseEnd) || (joinableAge(age) && atAgeTail) ? "FractionalAgeLoose" : "FractionalAgeUnknown")));
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawAnUpcomingFractionalAgeSuppliesNoCurrentAge(age: number, possibleHeight: boolean, monthsOrQuarter: boolean, writtenAsAge: boolean, atClauseEnd: boolean, atAgeTail: boolean): boolean {
  //@ ensures \result === true
  return fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, writtenAsAge, atClauseEnd, atAgeTail, true) === "FractionalAgeUnknown";
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawAFractionalAgeNeedsAgeWordsToBeExplicit(age: number, possibleHeight: boolean, monthsOrQuarter: boolean, atClauseEnd: boolean, atAgeTail: boolean, future: boolean): boolean {
  //@ ensures \result === true
  return fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, false, atClauseEnd, atAgeTail, future) !== "FractionalAgeExplicit";
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawPossibleHeightRequiresAgeWords(age: number, atClauseEnd: boolean, atAgeTail: boolean): boolean {
  //@ ensures \result === true
  return !(age < minLooseHeightAge) || fractionalAgeEvidence(age, true, false, false, atClauseEnd, atAgeTail, false) === "FractionalAgeUnknown";
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawExplicitCurrentFractionalAgeIsAccepted(age: number, possibleHeight: boolean, monthsOrQuarter: boolean, atClauseEnd: boolean, atAgeTail: boolean): boolean {
  //@ ensures \result === true
  return fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, true, atClauseEnd, atAgeTail, false) === "FractionalAgeExplicit";
}

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
//@ pure
export function lawUnderageMonthOrQuarterNeedsAgeWords(age: number, atClauseEnd: boolean, atAgeTail: boolean): boolean {
  //@ ensures \result === true
  return !(age < minMemberAge) || fractionalAgeEvidence(age, false, true, false, atClauseEnd, atAgeTail, false) === "FractionalAgeUnknown";
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
