// GENERATED from spec/soloConcierge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, maxAge as memberAge_maxAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, recordedChatAge as memberAge_recordedChatAge, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, ageInRange as memberAge_ageInRange, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, recordedAgeFloorApplies as memberAge_recordedAgeFloorApplies, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, matchableAge as memberAge_matchableAge, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, lawPhoneReassignmentEndsAgeProjection as memberAge_lawPhoneReassignmentEndsAgeProjection, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, confirmedUnderage as memberAge_confirmedUnderage, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";


/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
export const maxSoloEventOptions: number = 3;

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
export function lawTripAwayPreventsLocalSuggestion(home: boolean, visiting: boolean): boolean {
  //@ ensures \result === true
  return !soloEventCityAllowed(home, visiting, true);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function soloEventAgeAllowed(age: number, minimum: number, allAges: boolean): boolean {
  return memberAge_joinableAge(age) && age >= minimum && (memberAge_matchableAge(age) || allAges);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md) */
//@ pure
export function lawYoungSoloListingsNeedAllAges(age: number, minimum: number): boolean {
  //@ ensures \result === true
  return !(age < memberAge_adultAge) || !soloEventAgeAllowed(age, minimum, false);
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function soloReplyHasRoom(picked: number): boolean {
  return picked < maxSoloEventOptions;
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
export function lawSoloReplyHoldsAtMostThree(picked: number): boolean {
  //@ ensures \result === true
  return !(picked >= 3) || !soloReplyHasRoom(picked);
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md) */
//@ pure
export function lawChangedSoloReplyCannotReplay(authorized: boolean): boolean {
  //@ ensures \result === true
  return !soloReplyReplayAllowed(authorized, false);
}
