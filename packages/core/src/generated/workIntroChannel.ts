// GENERATED from spec/workIntroChannel.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";

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
