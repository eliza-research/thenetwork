// GENERATED from spec/teenIntroSwitch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JudgeCall as automatedReview_JudgeCall, type JudgeClaim as automatedReview_JudgeClaim, type SimStaffAction as automatedReview_SimStaffAction, type VerdictWord as automatedReview_VerdictWord, type Rubric as automatedReview_Rubric, type JudgeVerdict as automatedReview_JudgeVerdict, type Approver as automatedReview_Approver, type ReviewPhase as automatedReview_ReviewPhase, type AutomatedReview as automatedReview_AutomatedReview, maxJudgeClaims as automatedReview_maxJudgeClaims, judgeMinLeadMs as automatedReview_judgeMinLeadMs, judgeCallDeadlineMs as automatedReview_judgeCallDeadlineMs, judgeLeaseMarginMs as automatedReview_judgeLeaseMarginMs, judgeLeaseMs as automatedReview_judgeLeaseMs, judgeCallsPerRun as automatedReview_judgeCallsPerRun, judgeWaitLimitMs as automatedReview_judgeWaitLimitMs, reviewJudgmentRetentionMs as automatedReview_reviewJudgmentRetentionMs, flaggedPairRetentionMs as automatedReview_flaggedPairRetentionMs, lawLeaseOutlastsCall as automatedReview_lawLeaseOutlastsCall, judgmentRetained as automatedReview_judgmentRetained, flaggedPairActive as automatedReview_flaggedPairActive, simulatedJudgeAnswers as automatedReview_simulatedJudgeAnswers, reviewRubric as automatedReview_reviewRubric, judgeCallDecision as automatedReview_judgeCallDecision, uncalledVerdict as automatedReview_uncalledVerdict, verdictAtRecord as automatedReview_verdictAtRecord, judgeClaimDecision as automatedReview_judgeClaimDecision, simulatedJudgeVerdict as automatedReview_simulatedJudgeVerdict, simulatedStaffAction as automatedReview_simulatedStaffAction, lawStandInIsSilentSometimes as automatedReview_lawStandInIsSilentSometimes, initial as automatedReview_initial, reviewOpen as automatedReview_reviewOpen, contactApproved as automatedReview_contactApproved, alwaysApprovalNamesApprover as automatedReview_alwaysApprovalNamesApprover, canRecordJudgment as automatedReview_canRecordJudgment, recordJudgment as automatedReview_recordJudgment, canHoldUnjudged as automatedReview_canHoldUnjudged, holdUnjudged as automatedReview_holdUnjudged, staffDecide as automatedReview_staffDecide, canStaffReroll as automatedReview_canStaffReroll, staffReroll as automatedReview_staffReroll, stepHeldItemNeedsStaff as automatedReview_stepHeldItemNeedsStaff, stepRerollStartsNewRevision as automatedReview_stepRerollStartsNewRevision, stopApproved as automatedReview_stopApproved, stepStopEndsOnlyAnApproval as automatedReview_stepStopEndsOnlyAnApproval, expireReview as automatedReview_expireReview, closeReview as automatedReview_closeReview, sometimesJudgeApproves as automatedReview_sometimesJudgeApproves, sometimesHeldForStaff as automatedReview_sometimesHeldForStaff, sometimesStaffApproves as automatedReview_sometimesStaffApproves, sometimesExpires as automatedReview_sometimesExpires, sometimesStopped as automatedReview_sometimesStopped, judgeVerdictOf as automatedReview_judgeVerdictOf, lawMinorRosterGetsStrictRubric as automatedReview_lawMinorRosterGetsStrictRubric, lawFreshFlagBeatsApproval as automatedReview_lawFreshFlagBeatsApproval, lawSuspectPacketNeverApproves as automatedReview_lawSuspectPacketNeverApproves, lawPriorFlagNeverApproves as automatedReview_lawPriorFlagNeverApproves, lawSpentBudgetNeverCalls as automatedReview_lawSpentBudgetNeverCalls, lawCallHasLeadTime as automatedReview_lawCallHasLeadTime, lawDecidedRowIsReused as automatedReview_lawDecidedRowIsReused, lawClaimsAreBounded as automatedReview_lawClaimsAreBounded, lawStandInApprovesWithoutExceptions as automatedReview_lawStandInApprovesWithoutExceptions, lawStandInHoldsSomeItems as automatedReview_lawStandInHoldsSomeItems, lawGatesBeatTheJudge as automatedReview_lawGatesBeatTheJudge, lawOnlyAnApprovalApproves as automatedReview_lawOnlyAnApprovalApproves, lawChangedPacketNeverApproves as automatedReview_lawChangedPacketNeverApproves, lawLateJudgmentExpires as automatedReview_lawLateJudgmentExpires, lawPausedMatchingHoldsNothing as automatedReview_lawPausedMatchingHoldsNothing, canStaffDecide as automatedReview_canStaffDecide, canStopApproved as automatedReview_canStopApproved, canExpireReview as automatedReview_canExpireReview, canCloseReview as automatedReview_canCloseReview, stepDecidedReviewStaysDecided as automatedReview_stepDecidedReviewStaysDecided, lawUnparsedReplyNeverApproves as automatedReview_lawUnparsedReplyNeverApproves, lawMinorApprovalNeedsMinorChecks as automatedReview_lawMinorApprovalNeedsMinorChecks, lawFlagNeedsReason as automatedReview_lawFlagNeedsReason, lawAwaitingItemNeedsTheJudge as automatedReview_lawAwaitingItemNeedsTheJudge, lawRevealedItemCannotBeStopped as automatedReview_lawRevealedItemCannotBeStopped } from "./automatedReview.ts";


/** Story: Meet only in public in the daytime / A teen meeting is at a meeting spot between 10:00 and 19:00 (spec/teenIntroSwitch.md) */
export const teenMeetingFirstMinute: number = 600;
/** Story: Meet only in public in the daytime / A teen meeting is at a meeting spot between 10:00 and 19:00 (spec/teenIntroSwitch.md) */
export const teenMeetingLastMinute: number = 1140;

/** Story: Stop teen introductions at once / Teen introductions are on unless a stop is recorded (spec/teenIntroSwitch.md) */
//@ pure
export function teenIntrosStoredOn(appOffersTeenLane: boolean, stopRecorded: boolean): boolean {
  return appOffersTeenLane && !stopRecorded;
}

/** Story: Stop teen introductions at once / Teen introductions are on unless a stop is recorded (spec/teenIntroSwitch.md) */
//@ pure
export function lawOnByDefault(appOffersTeenLane: boolean): boolean {
  //@ ensures \result === true
  return teenIntrosStoredOn(appOffersTeenLane, false) === appOffersTeenLane;
}

/** Story: Stop teen introductions at once / Teen introductions are on unless a stop is recorded (spec/teenIntroSwitch.md) */
//@ pure
export function lawStopRecordTurnsItOff(appOffersTeenLane: boolean): boolean {
  //@ ensures \result === true
  return !teenIntrosStoredOn(appOffersTeenLane, true);
}

/** Story: Stop teen introductions at once / The switch turns on only in an app that offers teen friendship (spec/teenIntroSwitch.md) */
//@ pure
export function teenIntroSwitchAllowed(on: boolean, appOffersTeenLane: boolean): boolean {
  return !on || appOffersTeenLane;
}

/** Story: Stop teen introductions at once / The switch turns on only in an app that offers teen friendship (spec/teenIntroSwitch.md) */
//@ pure
export function lawSwitchOnOnlyWhereOffered(on: boolean): boolean {
  //@ ensures \result === true
  return teenIntroSwitchAllowed(on, false) === !on;
}

/** Story: Stop each teen item that no longer passes the rule / A teen item continues only while the switch is on and the rule holds (spec/teenIntroSwitch.md) */
//@ pure
export function teenItemContinues(switchOn: boolean, rosterHasMinor: boolean, ruleHolds: boolean): boolean {
  return !rosterHasMinor || (switchOn && ruleHolds);
}

/** Story: Stop each teen item that no longer passes the rule / A teen item continues only while the switch is on and the rule holds (spec/teenIntroSwitch.md) */
//@ pure
export function lawSwitchOffEndsTeenItems(rosterHasMinor: boolean, ruleHolds: boolean): boolean {
  //@ ensures \result === true
  return teenItemContinues(false, rosterHasMinor, ruleHolds) === !rosterHasMinor;
}

/** Story: Stop each teen item that no longer passes the rule / A teen item continues only while the switch is on and the rule holds (spec/teenIntroSwitch.md) */
//@ pure
export function lawAdultItemsIgnoreTheSwitch(switchOn: boolean, ruleHolds: boolean): boolean {
  //@ ensures \result === true
  return teenItemContinues(switchOn, false, ruleHolds);
}

/** Story: Judge each teen introduction with the strict rubric / A teen item is approved by the judge with the strict rubric or by staff (spec/teenIntroSwitch.md) */
//@ pure
export function lawTeenRosterIsJudgedStrictly(rosterHasMinor: boolean): boolean {
  //@ ensures \result === true
  return !rosterHasMinor || automatedReview_reviewRubric(rosterHasMinor) === "MinorRubric";
}

/** Story: Meet only in public in the daytime / A teen meeting is at a meeting spot between 10:00 and 19:00 (spec/teenIntroSwitch.md) */
//@ pure
export function teenMeetingAllowed(rosterHasMinor: boolean, packVenue: boolean, startMinute: number, endMinute: number, adultSessionNearby: boolean): boolean {
  return !rosterHasMinor || (!packVenue && startMinute >= teenMeetingFirstMinute && endMinute <= teenMeetingLastMinute && !adultSessionNearby);
}

/** Story: Meet only in public in the daytime / A teen meeting is at a meeting spot between 10:00 and 19:00 (spec/teenIntroSwitch.md) */
//@ pure
export function lawTeenMeetingIsDaytimePublic(packVenue: boolean, startMinute: number, endMinute: number, adultSessionNearby: boolean): boolean {
  //@ ensures \result === true
  return !teenMeetingAllowed(true, packVenue, startMinute, endMinute, adultSessionNearby) || (!packVenue && startMinute >= 600 && endMinute <= 1140 && !adultSessionNearby);
}

/** Story: Share only interests in a teen introduction / A teen roster uses interest and boundary facets only (spec/teenIntroSwitch.md) */
//@ pure
export function teenFacetAllowed(kind: string): boolean {
  return kind === "interest" || kind === "boundary";
}

/** Story: Share only interests in a teen introduction / A teen roster uses interest and boundary facets only (spec/teenIntroSwitch.md) */
//@ pure
export function lawTeenFacetsAreInterestsOnly(kind: string): boolean {
  //@ ensures \result === true
  return !teenFacetAllowed(kind) || (kind === "interest" || kind === "boundary");
}

/** Story: Hold each teen relay text that does not pass cleanly / A teen-pair text that does not pass cleanly is held (spec/teenIntroSwitch.md) */
//@ pure
export function teenRelayHeld(teenPair: boolean, cleanPass: boolean): boolean {
  return teenPair && !cleanPass;
}

/** Story: Hold each teen relay text that does not pass cleanly / A teen-pair text that does not pass cleanly is held (spec/teenIntroSwitch.md) */
//@ pure
export function lawTeenRelayHoldsUnclean(cleanPass: boolean): boolean {
  //@ ensures \result === true
  return teenRelayHeld(true, cleanPass) === !cleanPass;
}
