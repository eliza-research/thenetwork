// GENERATED from spec/workIntroChannel.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, maxAge as memberAge_maxAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, ageInRange as memberAge_ageInRange, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, recordedChatAge as memberAge_recordedChatAge, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, birthKeyUsable as memberAge_birthKeyUsable, matchableAge as memberAge_matchableAge, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, confirmedUnderage as memberAge_confirmedUnderage, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
export type WorkIntroChannel = "NoChannel" | "WarmEmail" | "ScheduledVideo" | "RelayShare";


/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function chooseWorkIntroChannel(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, candHasEmail: boolean, mgrHasEmail: boolean, mutualSlotConfirmed: boolean, wantsVideo: boolean): WorkIntroChannel {
  return !memberAge_matchableAge(candAge) || !memberAge_matchableAge(mgrAge) || !candOptedIn || !mgrOptedIn ? "NoChannel" : (candHasEmail && mgrHasEmail && !(wantsVideo && mutualSlotConfirmed) ? "WarmEmail" : (mutualSlotConfirmed ? "ScheduledVideo" : "RelayShare"));
}

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function lawWorkIntroRequiresDoubleOptIn(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, candHasEmail: boolean, mgrHasEmail: boolean, mutualSlotConfirmed: boolean, wantsVideo: boolean): boolean {
  //@ ensures \result === true
  return !(!candOptedIn || !mgrOptedIn) || chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) === "NoChannel";
}

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function lawWorkIntroAdultsOnly(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, candHasEmail: boolean, mgrHasEmail: boolean, mutualSlotConfirmed: boolean, wantsVideo: boolean): boolean {
  //@ ensures \result === true
  return !(candAge < memberAge_adultAge || mgrAge < memberAge_adultAge) || chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) === "NoChannel";
}

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function lawNoScheduledVideoWithoutConfirmedSlot(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, candHasEmail: boolean, mgrHasEmail: boolean, wantsVideo: boolean): boolean {
  //@ ensures \result === true
  return chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, false, wantsVideo) !== "ScheduledVideo";
}

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function lawWarmEmailDefaultWhenBothHaveEmail(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, mutualSlotConfirmed: boolean): boolean {
  //@ ensures \result === true
  return !(memberAge_matchableAge(candAge) && memberAge_matchableAge(mgrAge) && candOptedIn && mgrOptedIn) || chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, true, true, mutualSlotConfirmed, false) === "WarmEmail";
}

/** Story: Hand off a work introduction over the right digital channel / Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel (spec/workIntroChannel.md) */
//@ pure
export function lawWarmEmailRequiresBothEmails(candAge: number, mgrAge: number, candOptedIn: boolean, mgrOptedIn: boolean, candHasEmail: boolean, mgrHasEmail: boolean, mutualSlotConfirmed: boolean, wantsVideo: boolean): boolean {
  //@ ensures \result === true
  return !(chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) === "WarmEmail") || (candHasEmail && mgrHasEmail);
}
