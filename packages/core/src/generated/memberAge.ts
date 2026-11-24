// GENERATED from spec/memberAge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export type FractionalAgeEvidence = "FractionalAgeUnknown" | "FractionalAgeLoose" | "FractionalAgeExplicit";
/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
export interface BirthReadings { lower: number; upper: number; youngest: number }

/** Story: Join at the eligible age / Joining requires a usable age of at least 13 (spec/memberAge.md) */
export const minMemberAge: number = 13;
/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export const minLooseHeightAge: number = 8;
/** Story: Join at the eligible age / Age data outside the human range is unusable (spec/memberAge.md) */
export const maxAge: number = 120;
/** Story: Take part in adult matching / A half age needs age wording to confirm an under-13 refusal (spec/memberAge.md) */
export const minLooseTeamAge: number = 10;
/** Story: Take part in adult matching / Matching requires a usable age of at least 18 (spec/memberAge.md) */
export const adultAge: number = 18;
/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
export const dayKeyYear: number = 10000;
/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
export const earliestBirthKey: number = 19000101;

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

/** Story: Take part in adult matching / Quoted age evidence does not change the sender (spec/memberAge.md) */
//@ pure
export function ownAgeEvidenceAllowed(quoted: boolean): boolean {
  return !quoted;
}

/** Story: Take part in adult matching / Quoted age evidence does not change the sender (spec/memberAge.md) */
//@ pure
export function ownYouthCueAllowed(quoted: boolean, ownAttribution: boolean, unfinishedCasual: boolean): boolean {
  return !quoted || ownAttribution || unfinishedCasual;
}

/** Story: Take part in adult matching / Quoted age evidence does not change the sender (spec/memberAge.md) */
//@ pure
export function lawQuotedWordsDoNotSetSenderAge(quoted: boolean): boolean {
  //@ ensures \result === true
  return !quoted || !ownAgeEvidenceAllowed(quoted);
}

/** Story: Take part in adult matching / Quoted age evidence does not change the sender (spec/memberAge.md) */
//@ pure
export function lawAnotherSpeakersYouthCueCannotRestrictSender(quoted: boolean): boolean {
  //@ ensures \result === true
  return !quoted || !ownYouthCueAllowed(quoted, false, false);
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

/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
//@ pure
export function ageOnDay(birthKey: number, dayKey: number): number {
  return dayKey >= birthKey ? quotient_memberAge(exact_memberAge(dayKey - birthKey), dayKeyYear) : -1;
}

/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
//@ pure
export function birthKeyUsable(birthKey: number, dayKey: number): boolean {
  return birthKey >= earliestBirthKey && birthKey <= dayKey && ageInRange(ageOnDay(birthKey, dayKey));
}

/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
//@ pure
export function lawBirthdayAddsOneYear(birthKey: number, dayKey: number): boolean {
  //@ ensures \result === true
  return !(dayKey >= birthKey) || ageOnDay(birthKey, exact_memberAge(dayKey + dayKeyYear)) === exact_memberAge(ageOnDay(birthKey, dayKey) + 1);
}

/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
//@ pure
export function lawLeapDayBirthdayCountsFromMarchFirst(birthYear: number, year: number): boolean {
  //@ ensures \result === true
  return !(year > birthYear) || (ageOnDay(exact_memberAge(exact_memberAge(birthYear * dayKeyYear) + 229), exact_memberAge(exact_memberAge(year * dayKeyYear) + 228)) === exact_memberAge(exact_memberAge(year - birthYear) - 1) && ageOnDay(exact_memberAge(exact_memberAge(birthYear * dayKeyYear) + 229), exact_memberAge(exact_memberAge(year * dayKeyYear) + 301)) === exact_memberAge(year - birthYear));
}

/** Story: Track age from a birth date / A birth date gives an age on each day (spec/memberAge.md) */
//@ pure
export function lawBirthKeyUsableIsHuman(birthKey: number, dayKey: number): boolean {
  //@ ensures \result === true
  return !birthKeyUsable(birthKey, dayKey) || ageInRange(ageOnDay(birthKey, dayKey));
}

/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
//@ pure
export function statedAgeLower(age: number, dayKey: number): number {
  return exact_memberAge(dayKey - exact_memberAge(exact_memberAge(age + 1) * dayKeyYear));
}

/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
//@ pure
export function statedAgeUpper(age: number, dayKey: number): number {
  return exact_memberAge(dayKey - exact_memberAge(age * dayKeyYear));
}

/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
//@ pure
export function birthDateLower(birthKey: number): number {
  return exact_memberAge(birthKey - 1);
}

/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
//@ pure
export function statedAgeBeforeBirthDates(age: number, createdDay: number, migrationDay: number): BirthReadings {
  return { lower: statedAgeLower(age, createdDay), upper: statedAgeUpper(age, migrationDay), youngest: statedAgeUpper(age, migrationDay) };
}

/** Story: Track age from a birth date / Each age statement is a range of possible birth dates (spec/memberAge.md) */
//@ pure
export function lawStatedAgeReadsBack(age: number, dayKey: number): boolean {
  //@ ensures \result === true
  return !(age >= 0) || (ageOnDay(statedAgeUpper(age, dayKey), dayKey) === age && ageOnDay(exact_memberAge(statedAgeLower(age, dayKey) + 1), dayKey) === age && ageOnDay(statedAgeLower(age, dayKey), dayKey) === exact_memberAge(age + 1));
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function laterBirthKey(firstKey: number, secondKey: number): number {
  return firstKey >= secondKey ? firstKey : secondKey;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function readingsConflict(readings: BirthReadings): boolean {
  return readings.lower >= readings.upper;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function mergeReading(hasEarlier: boolean, earlier: BirthReadings, lower: number, upper: number): BirthReadings {
  return !hasEarlier ? ({ lower: lower, upper: upper, youngest: upper } as BirthReadings) : ({ lower: earlier.lower >= lower ? earlier.lower : lower, upper: earlier.upper <= upper ? earlier.upper : upper, youngest: laterBirthKey(earlier.youngest, upper) } as BirthReadings);
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function effectiveBirthKey(readings: BirthReadings): number {
  return readingsConflict(readings) ? readings.youngest : readings.upper;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function birthDateExact(hasBirthDate: boolean, birthDate: number, readings: BirthReadings): boolean {
  return hasBirthDate && !readingsConflict(readings) && readings.upper === birthDate;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawAgreeingAgeKeepsTheBirthDateExact(birthKey: number, dayKey: number): boolean {
  //@ ensures \result === true
  const local_0: BirthReadings = { lower: birthDateLower(birthKey), upper: birthKey, youngest: birthKey };
  const local_1 = ageOnDay(birthKey, dayKey);
  return !(dayKey >= birthKey) || birthDateExact(true, birthKey, mergeReading(true, local_0, statedAgeLower(local_1, dayKey), statedAgeUpper(local_1, dayKey)));
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawConflictIsPermanent(earlier: BirthReadings, lower: number, upper: number): boolean {
  //@ ensures \result === true
  return !readingsConflict(earlier) || readingsConflict(mergeReading(true, earlier, lower, upper));
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawOlderClaimNeverUnlocksAdult(earlier: BirthReadings, lower: number, upper: number, dayKey: number): boolean {
  //@ ensures \result === true
  return !(earlier.youngest > earlier.lower && lower < upper) || ageOnDay(effectiveBirthKey(mergeReading(true, earlier, lower, upper)), dayKey) <= ageOnDay(exact_memberAge(earlier.lower + 1), dayKey);
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawFloorTwelveRefusesAdultBirthDate(adultBirthKey: number): boolean {
  //@ ensures \result === true
  const local_2: BirthReadings = { lower: statedAgeLower(12, 20260601), upper: statedAgeUpper(12, 20260601), youngest: statedAgeUpper(12, 20260601) };
  return !(adultBirthKey <= local_2.lower) || !joinableAge(ageOnDay(effectiveBirthKey(mergeReading(true, local_2, birthDateLower(adultBirthKey), adultBirthKey)), 20261122));
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function effectiveAge(readings: BirthReadings, dayKey: number): number {
  return ageOnDay(effectiveBirthKey(readings), dayKey);
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawLaterBirthDateWins(firstKey: number, secondKey: number): boolean {
  //@ ensures \result === true
  const local_3: BirthReadings = { lower: birthDateLower(firstKey), upper: firstKey, youngest: firstKey };
  return !(firstKey < secondKey) || effectiveBirthKey(mergeReading(true, local_3, birthDateLower(secondKey), secondKey)) === secondKey;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawMergeKeepsYoungest(hasEarlier: boolean, earlier: BirthReadings, lower: number, upper: number): boolean {
  //@ ensures \result === true
  const local_4: BirthReadings = mergeReading(hasEarlier, earlier, lower, upper);
  return local_4.youngest >= upper && (!hasEarlier || local_4.youngest >= earlier.youngest);
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawMergeKeepsWellFormed(hasEarlier: boolean, earlier: BirthReadings, lower: number, upper: number): boolean {
  //@ ensures \result === true
  const local_5: BirthReadings = mergeReading(hasEarlier, earlier, lower, upper);
  return !((!hasEarlier || earlier.youngest > earlier.lower) && lower < upper) || local_5.youngest > local_5.lower;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawMinorBeforeBirthDatesKeepsMinorAge(adultBirthKey: number): boolean {
  //@ ensures \result === true
  const local_6: BirthReadings = statedAgeBeforeBirthDates(15, 20260101, 20261122);
  return !(adultBirthKey <= local_6.lower) || ageOnDay(effectiveBirthKey(mergeReading(true, local_6, birthDateLower(adultBirthKey), adultBirthKey)), 20261122) === 15;
}

/** Story: Track age from a birth date / The youngest reading wins and an older claim never unlocks more (spec/memberAge.md) */
//@ pure
export function lawLowerStatedAgeWins(birthKey: number, age: number, dayKey: number): boolean {
  //@ ensures \result === true
  const local_7: BirthReadings = { lower: birthDateLower(birthKey), upper: birthKey, youngest: birthKey };
  const local_8: BirthReadings = mergeReading(true, local_7, statedAgeLower(age, dayKey), statedAgeUpper(age, dayKey));
  return !(dayKey >= birthKey && age >= 0 && age < ageOnDay(birthKey, dayKey)) || ageOnDay(effectiveBirthKey(local_8), dayKey) === age;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function signupAgeAt(initialMinorAge: number, eligibleAt: number, now: number): number {
  return now >= eligibleAt ? adultAge : initialMinorAge;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function mayClearMaturedSignupMinor(maturedSignup: boolean, currentAdult: boolean, otherYouthEvidence: boolean): boolean {
  return maturedSignup && currentAdult && !otherYouthEvidence;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function keepLaterEligibilityDate(first: number, second: number): number {
  return first >= second ? first : second;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function lawSignupAgeDoesNotAdvanceEarly(initialMinorAge: number, eligibleAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(now < eligibleAt) || signupAgeAt(initialMinorAge, eligibleAt, now) === initialMinorAge;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function lawSignupAgeAdvancesAtEligibility(initialMinorAge: number, eligibleAt: number): boolean {
  //@ ensures \result === true
  return signupAgeAt(initialMinorAge, eligibleAt, eligibleAt) === adultAge;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function lawSignupAgeKeepsAnIndependentFloor(initialMinorAge: number, eligibleAt: number, now: number, independentAge: number): boolean {
  //@ ensures \result === true
  return lowerAge(independentAge, signupAgeAt(initialMinorAge, eligibleAt, now)) <= independentAge;
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function lawOtherYouthEvidenceKeepsMinorRestricted(maturedSignup: boolean, currentAdult: boolean): boolean {
  //@ ensures \result === true
  return !mayClearMaturedSignupMinor(maturedSignup, currentAdult, true);
}

/** Story: Move from private signup eligibility to adult access / A private signup date can end a birthday-only minor restriction (spec/memberAge.md) */
//@ pure
export function lawAnotherSignupCannotAdvanceEligibility(first: number, second: number): boolean {
  //@ ensures \result === true
  return keepLaterEligibilityDate(first, second) >= first && keepLaterEligibilityDate(first, second) >= second;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_memberAge(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_memberAge(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
