// GENERATED from spec/contributionHistory.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";


/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
export const contributionHistoryPageSize: number = 5;

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryAllowed(activeOwner: boolean, age: number): boolean {
  return activeOwner && memberAge_matchableAge(age);
}

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryReplayAllowed(activeOwner: boolean, sameReply: boolean): boolean {
  return activeOwner && sameReply;
}

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function lawContributionHistoryRequiresAdult(age: number): boolean {
  //@ ensures \result === true
  return !(age < memberAge_adultAge) || !contributionHistoryAllowed(true, age);
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryEntryVisible(positive: boolean, reversed: boolean): boolean {
  return positive && !reversed;
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function contributionEventReplayPriority(kind: string): number {
  return kind === "member_joined" ? 0 : (kind === "age_updated" ? 1 : (kind === "safety_flag" || kind === "abuse_confirmed" ? 2 : (kind === "plan_accepted" || kind === "help_given" ? 3 : (kind === "plan_confirmed" ? 4 : (kind === "plan_attended" ? 5 : (kind === "feedback_given" ? 6 : (kind === "member_removed" || kind === "fraud_confirmed" ? 8 : 7)))))));
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function lawContributionHistoryOmitsReversals(positive: boolean): boolean {
  //@ ensures \result === true
  return !contributionHistoryEntryVisible(positive, true);
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function lawContributionEvidencePrecedesCorrection(kind: string): boolean {
  //@ ensures \result === true
  return !(kind === "plan_accepted" || kind === "plan_attended" || kind === "feedback_given") || contributionEventReplayPriority(kind) < contributionEventReplayPriority("fraud_confirmed");
}
