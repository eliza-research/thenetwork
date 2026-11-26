// GENERATED from spec/meetupArrival.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, maxAge as memberAge_maxAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, ageInRange as memberAge_ageInRange, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, recordedChatAge as memberAge_recordedChatAge, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, birthKeyUsable as memberAge_birthKeyUsable, matchableAge as memberAge_matchableAge, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, confirmedUnderage as memberAge_confirmedUnderage, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";

/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
export type MeetupPhase = "Before" | "PreBrief" | "ActiveArrival" | "Closed";
/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
export type NoShowAction = "NoAction" | "PingLate" | "NotifyWaiting";

/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
export const preBriefStartDeltaMin: number = -75;
/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
export const activeArrivalStartDeltaMin: number = -30;
/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
export const activeArrivalEndDeltaMin: number = 45;
/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
export const noShowPingLateMin: number = 12;
/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
export const noShowNotifyWaitingMin: number = 18;

/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
//@ pure
export function meetupPhase(deltaMin: number, allMet: boolean): MeetupPhase {
  return allMet || deltaMin > activeArrivalEndDeltaMin ? "Closed" : (deltaMin >= activeArrivalStartDeltaMin ? "ActiveArrival" : (deltaMin >= preBriefStartDeltaMin ? "PreBrief" : "Before"));
}

/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
//@ pure
export function lawAllMetClosesMeetup(deltaMin: number): boolean {
  //@ ensures \result === true
  return meetupPhase(deltaMin, true) === "Closed";
}

/** Story: Track arrival phases and gate arrival relays safely / Meetup arrival phases open 30 minutes before start and close 45 minutes after start (spec/meetupArrival.md) */
//@ pure
export function lawPastArrivalWindowClosesMeetup(deltaMin: number, allMet: boolean): boolean {
  //@ ensures \result === true
  return !(deltaMin > activeArrivalEndDeltaMin) || meetupPhase(deltaMin, allMet) === "Closed";
}

/** Story: Track arrival phases and gate arrival relays safely / Arrival relays require confirmed adults, active arrival phase, and clean safety checks (spec/meetupArrival.md) */
//@ pure
export function canRelayArrival(senderAge: number, recipientAge: number, senderConfirmed: boolean, recipientConfirmed: boolean, blocked: boolean, optedOut: boolean, phase: MeetupPhase, senderMet: boolean, leakClean: boolean, safetyClean: boolean): boolean {
  return memberAge_matchableAge(senderAge) && memberAge_matchableAge(recipientAge) && senderConfirmed && recipientConfirmed && !blocked && !optedOut && phase === "ActiveArrival" && !senderMet && leakClean && safetyClean;
}

/** Story: Track arrival phases and gate arrival relays safely / Arrival relays require confirmed adults, active arrival phase, and clean safety checks (spec/meetupArrival.md) */
//@ pure
export function lawMinorNeverRelaysArrival(senderAge: number, recipientAge: number, senderConfirmed: boolean, recipientConfirmed: boolean, blocked: boolean, optedOut: boolean, phase: MeetupPhase, senderMet: boolean, leakClean: boolean, safetyClean: boolean): boolean {
  //@ ensures \result === true
  return !(senderAge < memberAge_adultAge || recipientAge < memberAge_adultAge) || !canRelayArrival(senderAge, recipientAge, senderConfirmed, recipientConfirmed, blocked, optedOut, phase, senderMet, leakClean, safetyClean);
}

/** Story: Track arrival phases and gate arrival relays safely / Arrival relays require confirmed adults, active arrival phase, and clean safety checks (spec/meetupArrival.md) */
//@ pure
export function lawNoRelayOutsideActiveArrival(senderAge: number, recipientAge: number, senderConfirmed: boolean, recipientConfirmed: boolean, blocked: boolean, optedOut: boolean, phase: MeetupPhase, senderMet: boolean, leakClean: boolean, safetyClean: boolean): boolean {
  //@ ensures \result === true
  return !(phase !== "ActiveArrival") || !canRelayArrival(senderAge, recipientAge, senderConfirmed, recipientConfirmed, blocked, optedOut, phase, senderMet, leakClean, safetyClean);
}

/** Story: Track arrival phases and gate arrival relays safely / Arrival relays require confirmed adults, active arrival phase, and clean safety checks (spec/meetupArrival.md) */
//@ pure
export function lawNoRelayWhenBlockedOrOptedOut(senderAge: number, recipientAge: number, senderConfirmed: boolean, recipientConfirmed: boolean, blocked: boolean, optedOut: boolean, phase: MeetupPhase, senderMet: boolean, leakClean: boolean, safetyClean: boolean): boolean {
  //@ ensures \result === true
  return !(blocked || optedOut) || !canRelayArrival(senderAge, recipientAge, senderConfirmed, recipientConfirmed, blocked, optedOut, phase, senderMet, leakClean, safetyClean);
}

/** Story: Track arrival phases and gate arrival relays safely / Arrival relays require confirmed adults, active arrival phase, and clean safety checks (spec/meetupArrival.md) */
//@ pure
export function lawNoRelayOnLeakOrSafetyFailure(senderAge: number, recipientAge: number, senderConfirmed: boolean, recipientConfirmed: boolean, blocked: boolean, optedOut: boolean, phase: MeetupPhase, senderMet: boolean, leakClean: boolean, safetyClean: boolean): boolean {
  //@ ensures \result === true
  return !(!leakClean || !safetyClean) || !canRelayArrival(senderAge, recipientAge, senderConfirmed, recipientConfirmed, blocked, optedOut, phase, senderMet, leakClean, safetyClean);
}

/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
//@ pure
export function noShowDecision(minutesSinceArrival: number, partnerCheckedIn: boolean, pingedLate: boolean, notifiedWaiting: boolean): NoShowAction {
  return partnerCheckedIn ? "NoAction" : (minutesSinceArrival >= noShowNotifyWaitingMin && !notifiedWaiting ? "NotifyWaiting" : (minutesSinceArrival >= noShowPingLateMin && !pingedLate ? "PingLate" : "NoAction"));
}

/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
//@ pure
export function lawCheckedInPartnerNeedsNoEscalation(minutesSinceArrival: number, pingedLate: boolean, notifiedWaiting: boolean): boolean {
  //@ ensures \result === true
  return noShowDecision(minutesSinceArrival, true, pingedLate, notifiedWaiting) === "NoAction";
}

/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
//@ pure
export function lawNoEscalationBeforeTwelveMinutes(minutesSinceArrival: number, partnerCheckedIn: boolean, pingedLate: boolean, notifiedWaiting: boolean): boolean {
  //@ ensures \result === true
  return !(minutesSinceArrival < noShowPingLateMin) || noShowDecision(minutesSinceArrival, partnerCheckedIn, pingedLate, notifiedWaiting) === "NoAction";
}

/** Story: Escalate no-shows and pivot to a verified backup venue / No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes (spec/meetupArrival.md) */
//@ pure
export function lawWaitingNotifiedAtEighteenMinutes(minutesSinceArrival: number, pingedLate: boolean): boolean {
  //@ ensures \result === true
  return !(minutesSinceArrival >= noShowNotifyWaitingMin) || noShowDecision(minutesSinceArrival, false, pingedLate, false) === "NotifyWaiting";
}

/** Story: Escalate no-shows and pivot to a verified backup venue / Backup venue pivot occurs at most once when closure is reported and a backup is verified (spec/meetupArrival.md) */
//@ pure
export function shouldPivotToBackup(closureReported: boolean, hasVerifiedBackup: boolean, alreadyPivoted: boolean): boolean {
  return closureReported && hasVerifiedBackup && !alreadyPivoted;
}

/** Story: Escalate no-shows and pivot to a verified backup venue / Backup venue pivot occurs at most once when closure is reported and a backup is verified (spec/meetupArrival.md) */
//@ pure
export function lawBackupPivotIsOneShot(closureReported: boolean, hasVerifiedBackup: boolean): boolean {
  //@ ensures \result === true
  return !shouldPivotToBackup(closureReported, hasVerifiedBackup, true);
}

/** Story: Escalate no-shows and pivot to a verified backup venue / Backup venue pivot occurs at most once when closure is reported and a backup is verified (spec/meetupArrival.md) */
//@ pure
export function lawBackupPivotRequiresClosureAndBackup(closureReported: boolean, hasVerifiedBackup: boolean, alreadyPivoted: boolean): boolean {
  //@ ensures \result === true
  return !shouldPivotToBackup(closureReported, hasVerifiedBackup, alreadyPivoted) || (closureReported && hasVerifiedBackup);
}
