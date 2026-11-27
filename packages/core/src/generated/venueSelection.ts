// GENERATED from spec/venueSelection.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
export type VenueStatus = "Active" | "SuspectClosed" | "ClosedTemporary" | "ClosedPermanent";
/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
export type ProviderClosureSignal = "ProviderOpen" | "ProviderTemporaryClosed" | "ProviderPermanentClosed";
/** Story: Score eligible venues for group fit and budget alignment / Group venue rubric scores suitability from 0 to 100 (spec/venueSelection.md) */
export type NoiseLevel = "Quiet" | "Conversational" | "Lively" | "Loud";

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
export const pairOpenBufferMin: number = 90;
/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
export const groupOpenBufferMin: number = 120;
/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
export const impromptuGroupMinSize: number = 3;
/** Story: Keep venue data fresh and avoid redundant external searches / External venue search runs only when local supply is below threshold and budget remains (spec/venueSelection.md) */
export const defaultLocalSufficiencyThreshold: number = 10;
/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
export const weekendOpenCheckMaxAgeMin: number = 360;
/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
export const weekdayOpenCheckMaxAgeMin: number = 1440;
/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
export const permanentClosureReportThreshold: number = 2;

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function venueHardEligible(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  const local_0 = groupSize >= impromptuGroupMinSize ? groupOpenBufferMin : pairOpenBufferMin;
  const local_1 = minMemberAge >= memberAge_adultAge || (venueAgeMin <= memberAge_minMemberAge && !isBarOnly && alcoholOptional);
  const local_2 = groupSize < impromptuGroupMinSize || (!reservationRequired && separateChecks && walkInCapacity >= groupSize);
  return isPublic && status === "Active" && groupSize >= 1 && memberAge_joinableAge(minMemberAge) && venueAgeMin >= 0 && venueAgeMin <= minMemberAge && local_1 && (!anyNonDrinker || (!isBarOnly && alcoholOptional)) && (!anyVegan || servesVegan) && (!anyVegetarian || servesVegetarian) && (!anyWheelchair || wheelchairAccessible) && !anyVisited && !anyRejected && priceTier >= 0 && priceTier <= maxBudgetTier && maxTravelMin >= 0 && travelLimitMin > 0 && maxTravelMin <= travelLimitMin && verifiedOpen && openBufferMin >= local_0 && local_2;
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawPrivateVenueNeverEligible(status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !venueHardEligible(false, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity);
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawInactiveVenueNeverEligible(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !(status !== "Active") || !venueHardEligible(isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity);
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawVisitedOrRejectedNeverEligible(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !(anyVisited || anyRejected) || !venueHardEligible(isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity);
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawNonDrinkerNeverGetsBar(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !(isBarOnly || !alcoholOptional) || !venueHardEligible(isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, true, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity);
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawMinorNeverGetsAdultOrBarVenue(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !(minMemberAge < memberAge_adultAge && (venueAgeMin > memberAge_minMemberAge || isBarOnly || !alcoholOptional)) || !venueHardEligible(isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity);
}

/** Story: Recommend only safe, open, and suitable public venues / Hard venue eligibility enforces public safety, age, dietary, and group rules (spec/venueSelection.md) */
//@ pure
export function lawImpromptuGroupNeedsWalkInAndSeparateChecks(isPublic: boolean, status: VenueStatus, minMemberAge: number, venueAgeMin: number, isBarOnly: boolean, alcoholOptional: boolean, anyNonDrinker: boolean, anyVegan: boolean, servesVegan: boolean, anyVegetarian: boolean, servesVegetarian: boolean, anyWheelchair: boolean, wheelchairAccessible: boolean, anyVisited: boolean, anyRejected: boolean, priceTier: number, maxBudgetTier: number, maxTravelMin: number, travelLimitMin: number, verifiedOpen: boolean, openBufferMin: number, groupSize: number, reservationRequired: boolean, separateChecks: boolean, walkInCapacity: number): boolean {
  //@ ensures \result === true
  return !(groupSize >= impromptuGroupMinSize && venueHardEligible(isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional, anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian, anyWheelchair, wheelchairAccessible, anyVisited, anyRejected, priceTier, maxBudgetTier, maxTravelMin, travelLimitMin, verifiedOpen, openBufferMin, groupSize, reservationRequired, separateChecks, walkInCapacity)) || (!reservationRequired && separateChecks && walkInCapacity >= groupSize && openBufferMin >= groupOpenBufferMin);
}

/** Story: Keep venue data fresh and avoid redundant external searches / External venue search runs only when local supply is below threshold and budget remains (spec/venueSelection.md) */
//@ pure
export function shouldFetchExternalVenues(localQualifiedCount: number, sufficiencyThreshold: number, apiBudgetRemaining: number): boolean {
  return localQualifiedCount < sufficiencyThreshold && apiBudgetRemaining > 0;
}

/** Story: Keep venue data fresh and avoid redundant external searches / External venue search runs only when local supply is below threshold and budget remains (spec/venueSelection.md) */
//@ pure
export function lawSufficientLocalPoolNeverFetches(localQualifiedCount: number, apiBudgetRemaining: number): boolean {
  //@ ensures \result === true
  return !(localQualifiedCount >= defaultLocalSufficiencyThreshold) || !shouldFetchExternalVenues(localQualifiedCount, defaultLocalSufficiencyThreshold, apiBudgetRemaining);
}

/** Story: Keep venue data fresh and avoid redundant external searches / External venue search runs only when local supply is below threshold and budget remains (spec/venueSelection.md) */
//@ pure
export function lawZeroBudgetNeverFetches(localQualifiedCount: number, sufficiencyThreshold: number, apiBudgetRemaining: number): boolean {
  //@ ensures \result === true
  return !(apiBudgetRemaining <= 0) || !shouldFetchExternalVenues(localQualifiedCount, sufficiencyThreshold, apiBudgetRemaining);
}

/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
//@ pure
export function needsPreRecommendOpenCheck(ageMinutes: number, isWeekendOrHoliday: boolean): boolean {
  const local_3 = isWeekendOrHoliday ? weekendOpenCheckMaxAgeMin : weekdayOpenCheckMaxAgeMin;
  return ageMinutes < 0 || ageMinutes >= local_3;
}

/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
//@ pure
export function lawNegativeAgeAlwaysNeedsOpenCheck(ageMinutes: number, isWeekendOrHoliday: boolean): boolean {
  //@ ensures \result === true
  return !(ageMinutes < 0) || needsPreRecommendOpenCheck(ageMinutes, isWeekendOrHoliday);
}

/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
//@ pure
export function lawWeekendCheckExpiresAtSixHours(ageMinutes: number): boolean {
  //@ ensures \result === true
  return !(ageMinutes >= weekendOpenCheckMaxAgeMin) || needsPreRecommendOpenCheck(ageMinutes, true);
}

/** Story: Keep venue data fresh and avoid redundant external searches / Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays (spec/venueSelection.md) */
//@ pure
export function lawWeekdayCheckExpiresAtTwentyFourHours(ageMinutes: number): boolean {
  //@ ensures \result === true
  return !(ageMinutes >= weekdayOpenCheckMaxAgeMin) || needsPreRecommendOpenCheck(ageMinutes, false);
}

/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
//@ pure
export function nextVenueStatusOnReport(currentStatus: VenueStatus, closureReportsAfter: number, providerCode: ProviderClosureSignal): VenueStatus {
  return providerCode === "ProviderPermanentClosed" || closureReportsAfter >= permanentClosureReportThreshold ? "ClosedPermanent" : (providerCode === "ProviderTemporaryClosed" ? (currentStatus === "ClosedPermanent" ? "ClosedPermanent" : "ClosedTemporary") : (closureReportsAfter >= 1 ? (currentStatus === "ClosedPermanent" ? "ClosedPermanent" : (currentStatus === "ClosedTemporary" ? "ClosedTemporary" : "SuspectClosed")) : currentStatus));
}

/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
//@ pure
export function lawClosureReportQuarantinesActiveVenue(closureReportsAfter: number, providerCode: ProviderClosureSignal): boolean {
  //@ ensures \result === true
  return !(closureReportsAfter >= 1) || nextVenueStatusOnReport("Active", closureReportsAfter, providerCode) !== "Active";
}

/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
//@ pure
export function lawTwoReportsMarkPermanentClosure(currentStatus: VenueStatus, closureReportsAfter: number, providerCode: ProviderClosureSignal): boolean {
  //@ ensures \result === true
  return !(closureReportsAfter >= permanentClosureReportThreshold) || nextVenueStatusOnReport(currentStatus, closureReportsAfter, providerCode) === "ClosedPermanent";
}

/** Story: Keep venue data fresh and avoid redundant external searches / Closure reports quarantine active venues immediately (spec/venueSelection.md) */
//@ pure
export function lawProviderPermanentMarksPermanentClosure(currentStatus: VenueStatus, closureReportsAfter: number): boolean {
  //@ ensures \result === true
  return nextVenueStatusOnReport(currentStatus, closureReportsAfter, "ProviderPermanentClosed") === "ClosedPermanent";
}

/** Story: Score eligible venues for group fit and budget alignment / Group venue rubric scores suitability from 0 to 100 (spec/venueSelection.md) */
//@ pure
export function clampScore(score: number, low: number, high: number): number {
  return score < low ? low : (score > high ? high : score);
}

/** Story: Score eligible venues for group fit and budget alignment / Group venue rubric scores suitability from 0 to 100 (spec/venueSelection.md) */
//@ pure
export function groupVenueRubricScore(separateChecks: boolean, walkInCapacity: number, noiseLevel: NoiseLevel, liveMusicAtNight: boolean, alcoholOptional: boolean, servesVegetarian: boolean, servesVegan: boolean, safetyScore: number, indoor: boolean, weatherSensitive: boolean, hasArrivalLandmark: boolean, transitScore: number): number {
  const local_4 = separateChecks ? 20 : 0;
  const local_5 = walkInCapacity >= 6 ? 20 : (walkInCapacity >= 4 ? 12 : 0);
  const local_6 = liveMusicAtNight ? 0 : (noiseLevel === "Conversational" || noiseLevel === "Lively" ? 15 : (noiseLevel === "Quiet" ? 6 : 0));
  const local_7 = exact_venueSelection(exact_venueSelection((alcoholOptional ? 8 : 0) + (servesVegetarian ? 4 : 0)) + (servesVegan ? 3 : 0));
  const local_8 = clampScore(safetyScore, 0, 10);
  const local_9 = indoor && !weatherSensitive ? 10 : (indoor ? 7 : (!weatherSensitive ? 4 : 0));
  const local_10 = hasArrivalLandmark ? 5 : 0;
  const local_11 = clampScore(transitScore, 0, 5);
  return exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(local_4 + local_5) + local_6) + local_7) + local_8) + local_9) + local_10) + local_11);
}

/** Story: Score eligible venues for group fit and budget alignment / Group venue rubric scores suitability from 0 to 100 (spec/venueSelection.md) */
//@ pure
export function lawGroupRubricScoreInRange(separateChecks: boolean, walkInCapacity: number, noiseLevel: NoiseLevel, liveMusicAtNight: boolean, alcoholOptional: boolean, servesVegetarian: boolean, servesVegan: boolean, safetyScore: number, indoor: boolean, weatherSensitive: boolean, hasArrivalLandmark: boolean, transitScore: number): boolean {
  //@ ensures \result === true
  const local_12 = groupVenueRubricScore(separateChecks, walkInCapacity, noiseLevel, liveMusicAtNight, alcoholOptional, servesVegetarian, servesVegan, safetyScore, indoor, weatherSensitive, hasArrivalLandmark, transitScore);
  return local_12 >= 0 && local_12 <= 100;
}

/** Story: Score eligible venues for group fit and budget alignment / Budget fit scores alignment from 0 to 100 and rejects over-budget venues (spec/venueSelection.md) */
//@ pure
export function venueBudgetFitScore(priceTier: number, targetBudgetTier: number): number {
  const local_13 = exact_venueSelection(targetBudgetTier - priceTier);
  return priceTier < 0 || targetBudgetTier < 0 || priceTier > targetBudgetTier ? 0 : (local_13 === 0 ? 100 : (local_13 === 1 ? 90 : (local_13 === 2 ? 75 : 60)));
}

/** Story: Score eligible venues for group fit and budget alignment / Budget fit scores alignment from 0 to 100 and rejects over-budget venues (spec/venueSelection.md) */
//@ pure
export function lawBudgetFitScoreInRange(priceTier: number, targetBudgetTier: number): boolean {
  //@ ensures \result === true
  const local_14 = venueBudgetFitScore(priceTier, targetBudgetTier);
  return local_14 >= 0 && local_14 <= 100;
}

/** Story: Score eligible venues for group fit and budget alignment / Budget fit scores alignment from 0 to 100 and rejects over-budget venues (spec/venueSelection.md) */
//@ pure
export function lawOverBudgetVenueScoresZero(priceTier: number, targetBudgetTier: number): boolean {
  //@ ensures \result === true
  return !(priceTier > targetBudgetTier) || venueBudgetFitScore(priceTier, targetBudgetTier) === 0;
}

/** Story: Score eligible venues for group fit and budget alignment / Budget fit scores alignment from 0 to 100 and rejects over-budget venues (spec/venueSelection.md) */
//@ pure
export function lawExactBudgetScoresHundred(targetBudgetTier: number): boolean {
  //@ ensures \result === true
  return !(targetBudgetTier >= 0) || venueBudgetFitScore(targetBudgetTier, targetBudgetTier) === 100;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_venueSelection(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
