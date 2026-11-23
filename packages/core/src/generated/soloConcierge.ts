// GENERATED from spec/soloConcierge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, minMemberAge as memberAge_minMemberAge, maxAge as memberAge_maxAge, minLooseHeightAge as memberAge_minLooseHeightAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, ageInRange as memberAge_ageInRange, recordedAgeFloorApplies as memberAge_recordedAgeFloorApplies, relayTurnReadsDirectAge as memberAge_relayTurnReadsDirectAge, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, recordedChatAge as memberAge_recordedChatAge, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawPhoneReassignmentEndsAgeProjection as memberAge_lawPhoneReassignmentEndsAgeProjection, lawRelayTurnDirectAgeNeedsSignedTextAndMatch as memberAge_lawRelayTurnDirectAgeNeedsSignedTextAndMatch, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, matchableAge as memberAge_matchableAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, confirmedUnderage as memberAge_confirmedUnderage, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";


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
