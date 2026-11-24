// GENERATED from spec/contributionHistory.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, maxAge as memberAge_maxAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, recordedChatAge as memberAge_recordedChatAge, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, ageInRange as memberAge_ageInRange, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, recordedAgeFloorApplies as memberAge_recordedAgeFloorApplies, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, matchableAge as memberAge_matchableAge, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, lawPhoneReassignmentEndsAgeProjection as memberAge_lawPhoneReassignmentEndsAgeProjection, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, confirmedUnderage as memberAge_confirmedUnderage, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";


/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
export const contributionHistoryPageSize: number = 5;

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryReplayAllowed(activeOwner: boolean, sameReply: boolean): boolean {
  return activeOwner && sameReply;
}

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryAllowed(activeOwner: boolean, age: number): boolean {
  return activeOwner && memberAge_matchableAge(age);
}

/** Story: Read what I contributed / Read the current member's history in the app that owns it (spec/contributionHistory.md) */
//@ pure
export function lawContributionHistoryRequiresAdult(age: number): boolean {
  //@ ensures \result === true
  return !(age < memberAge_adultAge) || !contributionHistoryAllowed(true, age);
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function contributionEventReplayPriority(kind: string): number {
  return kind === "member_joined" ? 0 : (kind === "age_updated" ? 1 : (kind === "safety_flag" || kind === "abuse_confirmed" ? 2 : (kind === "plan_accepted" || kind === "help_given" ? 3 : (kind === "plan_confirmed" ? 4 : (kind === "plan_attended" ? 5 : (kind === "feedback_given" ? 6 : (kind === "member_removed" || kind === "fraud_confirmed" ? 8 : 7)))))));
}

/** Story: Read what I contributed / Show verified acts a page at a time (spec/contributionHistory.md) */
//@ pure
export function contributionHistoryEntryVisible(positive: boolean, reversed: boolean): boolean {
  return positive && !reversed;
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
