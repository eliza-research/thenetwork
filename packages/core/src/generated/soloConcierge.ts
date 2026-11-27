// GENERATED from spec/soloConcierge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";


/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
export const maxSoloEventOptions: number = 3;

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function soloEventAgeAllowed(age: number, minimum: number, allAges: boolean): boolean {
  return memberAge_joinableAge(age) && age >= minimum && (memberAge_matchableAge(age) || allAges);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function soloEventCityAllowed(home: boolean, visiting: boolean, away: boolean): boolean {
  return !away && (home || visiting);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function soloEventEligible(freshListed: boolean, fitsRequest: boolean, present: boolean, hasAvailability: boolean, fitsAvailability: boolean, hasTripLimit: boolean, travelMinutes: number, limit: number): boolean {
  return freshListed && fitsRequest && present && (!hasAvailability || fitsAvailability) && (!hasTripLimit || travelMinutes <= limit);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function lawYoungSoloListingsNeedAllAges(age: number, minimum: number): boolean {
  //@ ensures \result === true
  return !(age < memberAge_adultAge) || !soloEventAgeAllowed(age, minimum, false);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function lawTripAwayPreventsLocalSuggestion(home: boolean, visiting: boolean): boolean {
  //@ ensures \result === true
  return !soloEventCityAllowed(home, visiting, true);
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function soloReplyHasRoom(picked: number): boolean {
  return picked < maxSoloEventOptions;
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function lawSoloReplyHoldsAtMostThree(picked: number): boolean {
  //@ ensures \result === true
  return !(picked >= 3) || !soloReplyHasRoom(picked);
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function soloEventPrecedes(fit: number, minutes: number, start: number, otherFit: number, otherMinutes: number, otherStart: number): boolean {
  return fit > otherFit || (fit === otherFit && (minutes < otherMinutes || (minutes === otherMinutes && start < otherStart)));
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function soloReplyReplayAllowed(authorized: boolean, sameLiveReply: boolean): boolean {
  return authorized && sameLiveReply;
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function lawChangedSoloReplyCannotReplay(authorized: boolean): boolean {
  //@ ensures \result === true
  return !soloReplyReplayAllowed(authorized, false);
}
