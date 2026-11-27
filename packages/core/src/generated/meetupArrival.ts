// GENERATED from spec/meetupArrival.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";

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
