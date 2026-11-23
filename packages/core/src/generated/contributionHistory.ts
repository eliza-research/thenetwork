// GENERATED from spec/contributionHistory.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, minMemberAge as memberAge_minMemberAge, maxAge as memberAge_maxAge, minLooseHeightAge as memberAge_minLooseHeightAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, ageInRange as memberAge_ageInRange, recordedAgeFloorApplies as memberAge_recordedAgeFloorApplies, relayTurnReadsDirectAge as memberAge_relayTurnReadsDirectAge, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, recordedChatAge as memberAge_recordedChatAge, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawPhoneReassignmentEndsAgeProjection as memberAge_lawPhoneReassignmentEndsAgeProjection, lawRelayTurnDirectAgeNeedsSignedTextAndMatch as memberAge_lawRelayTurnDirectAgeNeedsSignedTextAndMatch, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, matchableAge as memberAge_matchableAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, confirmedUnderage as memberAge_confirmedUnderage, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";


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
