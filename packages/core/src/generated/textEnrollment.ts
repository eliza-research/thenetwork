// GENERATED from spec/textEnrollment.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";
import { type AgeSide as friendIntroAge_AgeSide, teenFriendMinAge as friendIntroAge_teenFriendMinAge, teenFriendMaxAge as friendIntroAge_teenFriendMaxAge, teenPartnerAge as friendIntroAge_teenPartnerAge, teenBirthGap as friendIntroAge_teenBirthGap, birthKeysWithinTwoYears as friendIntroAge_birthKeysWithinTwoYears, teenReady as friendIntroAge_teenReady, teenBarOnConflict as friendIntroAge_teenBarOnConflict, lawTeenReadyNeedsExactBirthDate as friendIntroAge_lawTeenReadyNeedsExactBirthDate, lawTeenReadyWithoutStaffStep as friendIntroAge_lawTeenReadyWithoutStaffStep, lawAnyDoubtMakesUnready as friendIntroAge_lawAnyDoubtMakesUnready, friendsVerifyPasses as friendIntroAge_friendsVerifyPasses, lawTeenReadyNeedsNoStaffVerify as friendIntroAge_lawTeenReadyNeedsNoStaffVerify, lawUnreadyNeedsStaffVerify as friendIntroAge_lawUnreadyNeedsStaffVerify, lawAdultRosterNeedsStaffVerify as friendIntroAge_lawAdultRosterNeedsStaffVerify, teenPairAllowed as friendIntroAge_teenPairAllowed, pairAgeAllowed as friendIntroAge_pairAgeAllowed, sidesAllowed as friendIntroAge_sidesAllowed, lawAdultPairUnchanged as friendIntroAge_lawAdultPairUnchanged, lawStoppedIsTheAdultRule as friendIntroAge_lawStoppedIsTheAdultRule, lawMinorPairOnlyInFriendshipLanes as friendIntroAge_lawMinorPairOnlyInFriendshipLanes, lawMinorPartnerIsThirteenToEighteen as friendIntroAge_lawMinorPartnerIsThirteenToEighteen, lawNineteenNeverWithAMinor as friendIntroAge_lawNineteenNeverWithAMinor, lawMinorPairWithinTwoYears as friendIntroAge_lawMinorPairWithinTwoYears, lawMinorPairNeedsReadySides as friendIntroAge_lawMinorPairNeedsReadySides, lawPairAgeSymmetric as friendIntroAge_lawPairAgeSymmetric, lawTeenPairWitness as friendIntroAge_lawTeenPairWitness, lawNineteenEdgeRefused as friendIntroAge_lawNineteenEdgeRefused, sideAllowedWithAll as friendIntroAge_sideAllowedWithAll, groupAgeAllowed as friendIntroAge_groupAgeAllowed, rosterHasMinor as friendIntroAge_rosterHasMinor, viaAllowedForRoster as friendIntroAge_viaAllowedForRoster, lawGroupWithMinorHoldsOnlyTeenAges as friendIntroAge_lawGroupWithMinorHoldsOnlyTeenAges, lawGroupStoppedAdultsOnly as friendIntroAge_lawGroupStoppedAdultsOnly, lawViaNeverWithAMinor as friendIntroAge_lawViaNeverWithAMinor, teenSideFits as friendIntroAge_teenSideFits, lawGroupNineteenNeverWithAMinor as friendIntroAge_lawGroupNineteenNeverWithAMinor, lawGroupMinorWithinTwoYearsOfEveryone as friendIntroAge_lawGroupMinorWithinTwoYearsOfEveryone, lawGroupWithMinorEverySideFits as friendIntroAge_lawGroupWithMinorEverySideFits, teenFriendRole as friendIntroAge_teenFriendRole, teenFriendFormat as friendIntroAge_teenFriendFormat, teenIntroShape as friendIntroAge_teenIntroShape, lawTeenShapeNeedsFriendshipLane as friendIntroAge_lawTeenShapeNeedsFriendshipLane, lawTeenShapeNeverAnEvent as friendIntroAge_lawTeenShapeNeverAnEvent, lawTeenShapeNeverVia as friendIntroAge_lawTeenShapeNeverVia, lawContributorRolesAreNotTeenRoles as friendIntroAge_lawContributorRolesAreNotTeenRoles, teenRosterMaximum as friendIntroAge_teenRosterMaximum, teenRosterSizeAllowed as friendIntroAge_teenRosterSizeAllowed, lawTeenRosterIsSmall as friendIntroAge_lawTeenRosterIsSmall, lawAdultRosterSizeUnchanged as friendIntroAge_lawAdultRosterSizeUnchanged, teenPlaceAllowed as friendIntroAge_teenPlaceAllowed, allAgesMarkValid as friendIntroAge_allAgesMarkValid, teenActivityOffered as friendIntroAge_teenActivityOffered, lawTeenPlaceIsAllAges as friendIntroAge_lawTeenPlaceIsAllAges, lawAdultPlaceUnchanged as friendIntroAge_lawAdultPlaceUnchanged, lawAllAgesNeverABarOrHome as friendIntroAge_lawAllAgesNeverABarOrHome, lawAllAgesOpensAtThirteen as friendIntroAge_lawAllAgesOpensAtThirteen, lawAdultPlansKeepTheirCatalog as friendIntroAge_lawAdultPlansKeepTheirCatalog, lawTeenGroupsGetOnlyAllAges as friendIntroAge_lawTeenGroupsGetOnlyAllAges, relayKindAllowed as friendIntroAge_relayKindAllowed, lawNoNumberOrPhotoWithAMinor as friendIntroAge_lawNoNumberOrPhotoWithAMinor, lawAdultRelayUnchanged as friendIntroAge_lawAdultRelayUnchanged, teenFriendCandidate as friendIntroAge_teenFriendCandidate, singlePlayerMember as friendIntroAge_singlePlayerMember, lawStoppedMinorIsSinglePlayer as friendIntroAge_lawStoppedMinorIsSinglePlayer, lawUnreadyMinorIsSinglePlayer as friendIntroAge_lawUnreadyMinorIsSinglePlayer, lawAdultIsNeverSinglePlayerByAge as friendIntroAge_lawAdultIsNeverSinglePlayerByAge, minorSignalOpens as friendIntroAge_minorSignalOpens, lawAdultRecordOpensOnEvidence as friendIntroAge_lawAdultRecordOpensOnEvidence, lawAgreeingMinorStatementOpensNothing as friendIntroAge_lawAgreeingMinorStatementOpensNothing } from "./friendIntroAge.ts";
import { type MatchLane as matchLane_MatchLane, type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneLimits as matchLane_LaneLimits, type LaneWeights as matchLane_LaneWeights, laneShape as matchLane_laneShape, laneSidesCompatible as matchLane_laneSidesCompatible, lawLaneSidesSymmetric as matchLane_lawLaneSidesSymmetric, standingCeiling as matchLane_standingCeiling, standingUncertaintyCeiling as matchLane_standingUncertaintyCeiling, laneLimits as matchLane_laneLimits, lawLaneLimitsWellFormed as matchLane_lawLaneLimitsWellFormed, laneWeights as matchLane_laneWeights, lawLaneWeightsWellFormed as matchLane_lawLaneWeightsWellFormed, laneOffset as matchLane_laneOffset, lawLaneOffsetAntisymmetric as matchLane_lawLaneOffsetAntisymmetric, lanePairValue as matchLane_lanePairValue, lawLanePairValueSymmetric as matchLane_lawLanePairValueSymmetric, laneOffered as matchLane_laneOffered, lawEveryAppHasALane as matchLane_lawEveryAppHasALane, teenFriendApp as matchLane_teenFriendApp, teenFriendLane as matchLane_teenFriendLane, teenFriendCategory as matchLane_teenFriendCategory, teenGroupPlanApp as matchLane_teenGroupPlanApp, lawTeenLanesOnlyInFriendApps as matchLane_lawTeenLanesOnlyInFriendApps, lawNoTeenOnSlopOrPeon as matchLane_lawNoTeenOnSlopOrPeon, lawTeenFriendLaneSameOnBothApps as matchLane_lawTeenFriendLaneSameOnBothApps, lawNtwrkTeenCategoryIsSocial as matchLane_lawNtwrkTeenCategoryIsSocial, lawTeenFriendLaneIsOffered as matchLane_lawTeenFriendLaneIsOffered, lawTeenPlansOnlyOnFriends as matchLane_lawTeenPlansOnlyOnFriends, lawNoTeenDateOrWork as matchLane_lawNoTeenDateOrWork, teenGenerator as matchLane_teenGenerator, lawTeenGeneratorOnlyInFriendApps as matchLane_lawTeenGeneratorOnlyInFriendApps, lawNtwrkHasNoTeenPlans as matchLane_lawNtwrkHasNoTeenPlans, lawRepeatsAndContributorsNeverTeen as matchLane_lawRepeatsAndContributorsNeverTeen } from "./matchLane.ts";
import { type UtilityTerm as pairValue_UtilityTerm, type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules } from "./pairValue.ts";

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export type RoutePhase = "AwaitingExplicitRoute" | "AwaitingFallbackRoute" | "DedicatedRoute" | "ProfileRoute" | "SurveyRoute" | "LookingForRoute" | "KeywordRoute" | "SafetyRoute" | "PendingJoinRoute" | "OpenItemRoute" | "RecentAppRoute" | "DefaultNetworkRoute";
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export interface TextRoute { phase: RoutePhase }
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export interface ExplicitFacts { dedicated: boolean; profileApp: boolean; surveyApp: boolean; pendingEnrollmentAnswer: boolean; appKeyword: boolean }
/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
export interface FallbackFacts { safetyClaim: boolean; hasPendingJoin: boolean; alreadyInPendingApp: boolean; hasMembership: boolean; answerHasAge: boolean; hasOpenItem: boolean }
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
export type JoinPhase = "AwaitingBan" | "JoinHeld" | "AwaitingInvite" | "InviteRequired" | "AwaitingAnswer" | "AskForAge" | "AskForHome" | "AwaitingJoinAge" | "RefuseAge" | "AskForName" | "AwaitingMember" | "AwaitingWelcome" | "JoinedWaitlist" | "JoinedWithShare" | "JoinedWithLookingFor" | "JoinedWithoutFollowUp" | "AwaitingAgeRecord" | "AwaitingInviteAgeRecord";
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
export interface TextJoin { phase: JoinPhase; ageAllowed: boolean; hasName: boolean; invalidHome: boolean; hasAge: boolean; ageRecorded: boolean; floorRefused: boolean }
/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
export interface JoinAnswerFacts { hasAge: boolean; hasName: boolean; invalidHome: boolean; floorRefused: boolean }
/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
export type JoinMembership = "NoMembership" | "InvitedMembership" | "LiveMembership" | "RemovedMembership";
/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
export type OtherAppOutcome = "SkipOtherApp" | "KeepOtherApp" | "CreateOtherApp";
/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
export type MinorNotice = "MinorSinglePlayerNotice" | "MinorBirthdayNotice" | "MinorTeenFriendNotice" | "MinorSlopNotice" | "MinorPeonNotice";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkJoinBan"; banned: boolean }
  | { type: "checkInvitation"; inviteOnly: boolean; invited: boolean; sharedNetwork: boolean; hasAge: boolean }
  | { type: "readJoinAnswer"; answerFacts: JoinAnswerFacts }
  | { type: "recordStatedAge" }
  | { type: "checkTextJoinAge"; ageAllowed: boolean }
  | { type: "recordTextMembership"; membershipActive: boolean }
  | { type: "recordWelcome"; hasOtherApp: boolean; sharedNetwork: boolean; invited: boolean };

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export const initialRoute: TextRoute = { phase: "AwaitingExplicitRoute" };
/** Story: Text the Network to join an app / A prepared Peon signup names its app on a separate first line (spec/textEnrollment.md) */
export const preparedPeonTextHeader: string = "join peon";
/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
export const openRouteOpportunityStates: string[] = ["PROPOSED", "SCHEDULED", "COMPLETED"];
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
export const initial: TextJoin = { phase: "AwaitingBan", ageAllowed: false, hasName: false, invalidHome: false, hasAge: false, ageRecorded: false, floorRefused: false };
/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
export const completedAnswer: JoinAnswerFacts = { hasAge: true, hasName: true, invalidHome: false, floorRefused: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TextJoin): boolean {
  return alwaysInviteRefusalKeepsStatedAge(current) && alwaysStatedAgeRecordedFirst(current) && alwaysRefusedFloorOnlyDeclines(current) && alwaysMembershipRequiresCompletedEligibleAnswer(current);
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function checkExplicitRoute(routing: TextRoute, explicitFacts: ExplicitFacts): TextRoute {
  return routing.phase !== "AwaitingExplicitRoute" ? routing : (explicitFacts.dedicated ? ({ phase: "DedicatedRoute" } as TextRoute) : (explicitFacts.profileApp ? ({ phase: "ProfileRoute" } as TextRoute) : (explicitFacts.surveyApp ? ({ phase: "SurveyRoute" } as TextRoute) : (explicitFacts.pendingEnrollmentAnswer ? ({ phase: "LookingForRoute" } as TextRoute) : (explicitFacts.appKeyword ? ({ phase: "KeywordRoute" } as TextRoute) : ({ phase: "AwaitingFallbackRoute" } as TextRoute))))));
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawDedicatedLineTakesPrecedence(profileApp: boolean, surveyApp: boolean, pendingEnrollmentAnswer: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: true, profileApp: profileApp, surveyApp: surveyApp, pendingEnrollmentAnswer: pendingEnrollmentAnswer, appKeyword: appKeyword } as ExplicitFacts)).phase === "DedicatedRoute";
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawProfileReadTakesPrecedence(surveyApp: boolean, pendingEnrollmentAnswer: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: false, profileApp: true, surveyApp: surveyApp, pendingEnrollmentAnswer: pendingEnrollmentAnswer, appKeyword: appKeyword } as ExplicitFacts)).phase === "ProfileRoute";
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawSurveyReplyTakesPrecedence(pendingEnrollmentAnswer: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: false, profileApp: false, surveyApp: true, pendingEnrollmentAnswer: pendingEnrollmentAnswer, appKeyword: appKeyword } as ExplicitFacts)).phase === "SurveyRoute";
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawPendingEnrollmentAnswerTakesPrecedence(appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: false, profileApp: false, surveyApp: false, pendingEnrollmentAnswer: true, appKeyword: appKeyword } as ExplicitFacts)).phase === "LookingForRoute";
}

/** Story: Text the Network to join an app / A prepared Peon signup names its app on a separate first line (spec/textEnrollment.md) */
//@ pure
export function preparedPeonTextNamesApp(header: string, profilePresent: boolean): boolean {
  return header === preparedPeonTextHeader && profilePresent;
}

/** Story: Text the Network to join an app / A prepared Peon signup names its app on a separate first line (spec/textEnrollment.md) */
//@ pure
export function lawPreparedPeonTextRequiresExplicitHeader(header: string, profilePresent: boolean): boolean {
  //@ ensures \result === true
  return preparedPeonTextNamesApp(header, profilePresent) === (header === preparedPeonTextHeader && profilePresent);
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function lawClosedOpportunityCannotSupplyRoute(opportunityState: string): boolean {
  //@ ensures \result === true
  return !(opportunityState === "CANCELLED" || opportunityState === "SKIPPED") || !openRouteOpportunityStates.includes(opportunityState);
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function shouldReadPendingAnswer(hasPendingJoin: boolean, alreadyInPendingApp: boolean, hasMembership: boolean): boolean {
  return hasPendingJoin && !alreadyInPendingApp && hasMembership;
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function checkFallbackRoute(routing: TextRoute, fallbackFacts: FallbackFacts): TextRoute {
  return routing.phase !== "AwaitingFallbackRoute" ? routing : (fallbackFacts.safetyClaim ? ({ phase: "SafetyRoute" } as TextRoute) : (fallbackFacts.hasPendingJoin && !fallbackFacts.alreadyInPendingApp && (!fallbackFacts.hasMembership || fallbackFacts.answerHasAge) ? ({ phase: "PendingJoinRoute" } as TextRoute) : (fallbackFacts.hasOpenItem ? ({ phase: "OpenItemRoute" } as TextRoute) : (fallbackFacts.hasMembership ? ({ phase: "RecentAppRoute" } as TextRoute) : ({ phase: "DefaultNetworkRoute" } as TextRoute)))));
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function pendingMatchesApp(pendingApp: string, routedApp: string): boolean {
  return pendingApp === routedApp;
}

/** Story: Text the Network to join an app / A safety claim routes before every other fallback (spec/textEnrollment.md) */
//@ pure
export function lawSafetyClaimRoutesFirst(hasPendingJoin: boolean, alreadyInPendingApp: boolean, hasMembership: boolean, answerHasAge: boolean, hasOpenItem: boolean): boolean {
  //@ ensures \result === true
  return checkFallbackRoute(({ phase: "AwaitingFallbackRoute" } as TextRoute), ({ safetyClaim: true, hasPendingJoin: hasPendingJoin, alreadyInPendingApp: alreadyInPendingApp, hasMembership: hasMembership, answerHasAge: answerHasAge, hasOpenItem: hasOpenItem } as FallbackFacts)).phase === "SafetyRoute";
}

/** Story: Text the Network to join an app / A safety claim routes before every other fallback (spec/textEnrollment.md) */
//@ pure
export function lawExplicitRouteKeepsSafetyClaimOut(dedicated: boolean, profileApp: boolean, surveyApp: boolean, pendingEnrollmentAnswer: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return !(dedicated || profileApp || surveyApp || pendingEnrollmentAnswer || appKeyword) || checkFallbackRoute(checkExplicitRoute(initialRoute, ({ dedicated: dedicated, profileApp: profileApp, surveyApp: surveyApp, pendingEnrollmentAnswer: pendingEnrollmentAnswer, appKeyword: appKeyword } as ExplicitFacts)), ({ safetyClaim: true, hasPendingJoin: false, alreadyInPendingApp: false, hasMembership: true, answerHasAge: false, hasOpenItem: false } as FallbackFacts)).phase !== "SafetyRoute";
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function canCheckJoinBan(joining: TextJoin): boolean {
  return joining.phase === "AwaitingBan";
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function checkJoinBan(joining: TextJoin, banned: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckJoinBan(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canCheckJoinBan(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canCheckJoinBan(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canCheckJoinBan(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: banned ? "JoinHeld" : "AwaitingInvite" };
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function canCheckInvitation(joining: TextJoin): boolean {
  return joining.phase === "AwaitingInvite";
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function checkInvitation(joining: TextJoin, inviteOnly: boolean, invited: boolean, sharedNetwork: boolean, hasAge: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckInvitation(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canCheckInvitation(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canCheckInvitation(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canCheckInvitation(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return inviteOnly && !invited && !sharedNetwork ? ({ ...joining, hasAge: hasAge, phase: hasAge ? "AwaitingInviteAgeRecord" : "InviteRequired" } as TextJoin) : ({ ...joining, phase: "AwaitingAnswer" } as TextJoin);
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function alwaysInviteRefusalKeepsStatedAge(joining: TextJoin): boolean {
  return !(joining.phase === "InviteRequired" && joining.hasAge) || joining.ageRecorded;
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
//@ pure
export function sometimesInviteRefusalRecordsAge(joining: TextJoin): boolean {
  return joining.phase === "InviteRequired" && joining.ageRecorded;
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function canReadJoinAnswer(joining: TextJoin): boolean {
  return joining.phase === "AwaitingAnswer";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function readJoinAnswer(joining: TextJoin, answerFacts: JoinAnswerFacts): TextJoin {
  //@ ensures (inv(joining) && canReadJoinAnswer(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canReadJoinAnswer(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canReadJoinAnswer(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canReadJoinAnswer(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, hasName: answerFacts.hasName, invalidHome: answerFacts.invalidHome, hasAge: answerFacts.hasAge, floorRefused: answerFacts.floorRefused, phase: answerFacts.hasAge ? "AwaitingAgeRecord" : (answerFacts.floorRefused ? "RefuseAge" : (answerFacts.invalidHome ? "AskForHome" : "AskForAge")) };
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function canRecordStatedAge(joining: TextJoin): boolean {
  return joining.phase === "AwaitingAgeRecord" || joining.phase === "AwaitingInviteAgeRecord";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function recordStatedAge(joining: TextJoin): TextJoin {
  //@ ensures (inv(joining) && canRecordStatedAge(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canRecordStatedAge(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canRecordStatedAge(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canRecordStatedAge(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, ageRecorded: true, phase: joining.phase === "AwaitingInviteAgeRecord" ? "InviteRequired" : "AwaitingJoinAge" };
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function canCheckTextJoinAge(joining: TextJoin): boolean {
  return joining.phase === "AwaitingJoinAge";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function checkTextJoinAge(joining: TextJoin, ageAllowed: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckTextJoinAge(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canCheckTextJoinAge(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canCheckTextJoinAge(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canCheckTextJoinAge(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, ageAllowed: ageAllowed, phase: !ageAllowed || joining.floorRefused ? "RefuseAge" : (joining.invalidHome ? "AskForHome" : (joining.hasName ? "AwaitingMember" : "AskForName")) };
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function joinAnswerSettled(phase: JoinPhase): boolean {
  return phase === "AwaitingJoinAge" || phase === "RefuseAge" || phase === "AskForAge" || phase === "AskForHome" || phase === "AskForName" || phase === "AwaitingMember" || phase === "AwaitingWelcome" || phase === "JoinedWaitlist" || phase === "JoinedWithShare" || phase === "JoinedWithLookingFor" || phase === "JoinedWithoutFollowUp";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function alwaysStatedAgeRecordedFirst(joining: TextJoin): boolean {
  return !(joining.hasAge && joinAnswerSettled(joining.phase)) || joining.ageRecorded;
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function alwaysRefusedFloorOnlyDeclines(joining: TextJoin): boolean {
  return !(joining.floorRefused && joinAnswerSettled(joining.phase)) || (joining.phase === "RefuseAge" || joining.phase === "AwaitingJoinAge");
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function sometimesRecordsStatedAge(joining: TextJoin): boolean {
  return joining.phase === "AwaitingAgeRecord";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function sometimesDeclinesRecordedFloor(joining: TextJoin): boolean {
  return joining.phase === "RefuseAge" && joining.floorRefused && !joining.hasAge;
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function textJoinKeepsMemberId(membership: JoinMembership): boolean {
  return membership === "InvitedMembership" || membership === "LiveMembership";
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function lawNoMembershipGetsNewMemberId(membership: JoinMembership): boolean {
  //@ ensures \result === true
  return !(membership === "NoMembership") || !textJoinKeepsMemberId(membership);
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function lawRemovedMembershipGetsNewMemberId(membership: JoinMembership): boolean {
  //@ ensures \result === true
  return !(membership === "RemovedMembership") || !textJoinKeepsMemberId(membership);
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function lawLiveMembershipKeepsItsMemberId(membership: JoinMembership): boolean {
  //@ ensures \result === true
  return !(membership === "LiveMembership") || textJoinKeepsMemberId(membership);
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function lawInvitedMembershipKeepsItsMemberId(membership: JoinMembership): boolean {
  //@ ensures \result === true
  return !(membership === "InvitedMembership") || textJoinKeepsMemberId(membership);
}

/** Story: Text the Network to join an app / A recorded-age decline without a stated age is sent at most once a day (spec/textEnrollment.md) */
//@ pure
export function sendAgeDecline(statedAge: boolean, declinedInLastDay: boolean): boolean {
  return statedAge || !declinedInLastDay;
}

/** Story: Text the Network to join an app / A recorded-age decline without a stated age is sent at most once a day (spec/textEnrollment.md) */
//@ pure
export function lawStatedAgeDeclineIsAlwaysSent(declinedInLastDay: boolean): boolean {
  //@ ensures \result === true
  return sendAgeDecline(true, declinedInLastDay);
}

/** Story: Text the Network to join an app / A recorded-age decline without a stated age is sent at most once a day (spec/textEnrollment.md) */
//@ pure
export function lawRecordedAgeDeclineAtMostOnceADay(statedAge: boolean): boolean {
  //@ ensures \result === true
  return !(!statedAge) || !sendAgeDecline(statedAge, true);
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function canRecordTextMembership(joining: TextJoin): boolean {
  return joining.phase === "AwaitingMember" && joining.ageAllowed && joining.hasName && !joining.invalidHome;
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function recordTextMembership(joining: TextJoin, membershipActive: boolean): TextJoin {
  //@ ensures (inv(joining) && canRecordTextMembership(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canRecordTextMembership(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canRecordTextMembership(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canRecordTextMembership(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: membershipActive ? "AwaitingWelcome" : "JoinedWaitlist" };
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function canRecordWelcome(joining: TextJoin): boolean {
  return joining.phase === "AwaitingWelcome" && joining.ageAllowed && joining.hasName && !joining.invalidHome;
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function recordWelcome(joining: TextJoin, hasOtherApp: boolean, sharedNetwork: boolean, invited: boolean): TextJoin {
  //@ ensures (inv(joining) && canRecordWelcome(joining)) ==> alwaysInviteRefusalKeepsStatedAge(\result)
  //@ ensures (inv(joining) && canRecordWelcome(joining)) ==> alwaysStatedAgeRecordedFirst(\result)
  //@ ensures (inv(joining) && canRecordWelcome(joining)) ==> alwaysRefusedFloorOnlyDeclines(\result)
  //@ ensures (inv(joining) && canRecordWelcome(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: hasOtherApp ? "JoinedWithShare" : (sharedNetwork && !invited ? "JoinedWithLookingFor" : "JoinedWithoutFollowUp") };
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function alwaysMembershipRequiresCompletedEligibleAnswer(joining: TextJoin): boolean {
  return !(joining.phase === "AwaitingMember" || joining.phase === "AwaitingWelcome" || joining.phase === "JoinedWaitlist" || joining.phase === "JoinedWithShare" || joining.phase === "JoinedWithLookingFor" || joining.phase === "JoinedWithoutFollowUp") || (joining.ageAllowed && joining.hasName && !joining.invalidHome);
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function sometimesAsksAge(joining: TextJoin): boolean {
  return joining.phase === "AskForAge";
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function sometimesRefusesAge(joining: TextJoin): boolean {
  return joining.phase === "RefuseAge";
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md) */
//@ pure
export function sometimesAsksWhatTheyWant(joining: TextJoin): boolean {
  return joining.phase === "JoinedWithLookingFor";
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function shouldReadLookingFor(hasKeyword: boolean, profileRead: boolean, isNetwork: boolean): boolean {
  return !(hasKeyword || profileRead) && isNetwork;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function namedOtherApp(appName: string, running: boolean): boolean {
  return appName !== "ntwrk" && running;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function networkEnrollmentAllowed(hasPerson: boolean, hasNetworkMembership: boolean, banned: boolean): boolean {
  return hasPerson && hasNetworkMembership && !banned;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function otherAppAllowed(appName: string, adult: boolean): boolean {
  return adult || (appName !== "slop" && appName !== "peon");
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function otherAppEnrollment(existingMember: boolean, ageEligible: boolean): OtherAppOutcome {
  return existingMember ? "KeepOtherApp" : (ageEligible ? "CreateOtherApp" : "SkipOtherApp");
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function bindTextJoinMember(sameRoutedApp: boolean, samePerson: boolean): boolean {
  return sameRoutedApp && samePerson;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function lawAnotherAppCannotRebindTextJoin(samePerson: boolean): boolean {
  //@ ensures \result === true
  return !bindTextJoinMember(false, samePerson);
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function lawSlopEnrollmentRequiresAdult(adult: boolean): boolean {
  //@ ensures \result === true
  return !otherAppAllowed("slop", adult) || adult;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function lawMinorEnrollsOnlyInFriendApps(appName: string): boolean {
  //@ ensures \result === true
  return !otherAppAllowed(appName, false) || (appName !== "slop" && appName !== "peon");
}

/** Story: Choose other apps from The Network / A first-contact notice cannot substitute for enrollment (spec/textEnrollment.md) */
//@ pure
export function firstContactMayCheckAge(signedTurn: boolean, nonMember: boolean, banned: boolean): boolean {
  return signedTurn && nonMember && !banned;
}

/** Story: Choose other apps from The Network / A first-contact notice cannot substitute for enrollment (spec/textEnrollment.md) */
//@ pure
export function firstContactNoticeAllowed(signedTurn: boolean, nonMember: boolean, banned: boolean, joinAgeAllowed: boolean, ageFloorAllowed: boolean): boolean {
  return firstContactMayCheckAge(signedTurn, nonMember, banned) && joinAgeAllowed && ageFloorAllowed;
}

/** Story: Choose other apps from The Network / A first-contact notice cannot substitute for enrollment (spec/textEnrollment.md) */
//@ pure
export function lawFirstContactNoticeRequiresEligibleNumber(signedTurn: boolean, nonMember: boolean, banned: boolean, joinAgeAllowed: boolean, ageFloorAllowed: boolean): boolean {
  //@ ensures \result === true
  return !firstContactNoticeAllowed(signedTurn, nonMember, banned, joinAgeAllowed, ageFloorAllowed) || (signedTurn && nonMember && !banned && joinAgeAllowed && ageFloorAllowed);
}

/** Story: Choose other apps from The Network / A first-contact notice cannot substitute for enrollment (spec/textEnrollment.md) */
//@ pure
export function lawMemberOrBannedGetsNoNotice(signedTurn: boolean, nonMember: boolean, banned: boolean, joinAgeAllowed: boolean, ageFloorAllowed: boolean): boolean {
  //@ ensures \result === true
  return !(!nonMember || banned || !signedTurn) || !firstContactNoticeAllowed(signedTurn, nonMember, banned, joinAgeAllowed, ageFloorAllowed);
}

/** Story: Tell a teen what the text line does with their age / A birthday is kept only for a person who can join (spec/textEnrollment.md) */
//@ pure
export function birthdayRecorded(birthKey: number, minDay: number): boolean {
  return memberAge_joinableAge(memberAge_ageOnDay(birthKey, minDay));
}

/** Story: Tell a teen what the text line does with their age / A birthday is kept only for a person who can join (spec/textEnrollment.md) */
//@ pure
export function lawUnderThirteenBirthdayIsNotRecorded(birthKey: number, minDay: number): boolean {
  //@ ensures \result === true
  return !(memberAge_ageOnDay(birthKey, minDay) < memberAge_minMemberAge) || !birthdayRecorded(birthKey, minDay);
}

/** Story: Tell a teen what the text line does with their age / A birthday is kept only for a person who can join (spec/textEnrollment.md) */
//@ pure
export function lawThirteenBirthdayIsRecorded(minDay: number): boolean {
  //@ ensures \result === true
  return birthdayRecorded(exact_textEnrollment(minDay - exact_textEnrollment(13 * memberAge_dayKeyYear)), minDay);
}

/** Story: Tell a teen what the text line does with their age / A typed age rises only on the anniversary of the day it was stated (spec/textEnrollment.md) */
//@ pure
export function statedAgeNow(selfAge: number, statedDay: number, minDay: number): number {
  return memberAge_ageOnDay(memberAge_statedAgeUpper(selfAge, statedDay), minDay);
}

/** Story: Tell a teen what the text line does with their age / A typed age rises only on the anniversary of the day it was stated (spec/textEnrollment.md) */
//@ pure
export function lawStatedAgeNeverFallsBelowTheStatement(selfAge: number, statedDay: number, minDay: number): boolean {
  //@ ensures \result === true
  return !(selfAge >= 0 && minDay >= statedDay) || statedAgeNow(selfAge, statedDay, minDay) >= selfAge;
}

/** Story: Tell a teen what the text line does with their age / A numeric birthday is read only when its month is clear (spec/textEnrollment.md) */
//@ pure
export function numericDateAmbiguous(firstNumber: number, secondNumber: number): boolean {
  return firstNumber >= 1 && firstNumber <= 12 && secondNumber >= 1 && secondNumber <= 12 && firstNumber !== secondNumber;
}

/** Story: Tell a teen what the text line does with their age / A numeric birthday is read only when its month is clear (spec/textEnrollment.md) */
//@ pure
export function lawSameNumbersAreClear(firstNumber: number): boolean {
  //@ ensures \result === true
  return !numericDateAmbiguous(firstNumber, firstNumber);
}

/** Story: Tell a teen what the text line does with their age / A numeric birthday is read only when its month is clear (spec/textEnrollment.md) */
//@ pure
export function lawDayAfterTwelveIsClear(firstNumber: number, secondNumber: number): boolean {
  //@ ensures \result === true
  return !(secondNumber > 12) || !numericDateAmbiguous(firstNumber, secondNumber);
}

/** Story: Tell a teen what the text line does with their age / A numeric birthday is read only when its month is clear (spec/textEnrollment.md) */
//@ pure
export function lawSwappedNumbersAreAlsoAmbiguous(firstNumber: number, secondNumber: number): boolean {
  //@ ensures \result === true
  return numericDateAmbiguous(firstNumber, secondNumber) === numericDateAmbiguous(secondNumber, firstNumber);
}

/** Story: Tell a teen what the text line does with their age / A numeric birthday is read only when its month is clear (spec/textEnrollment.md) */
//@ pure
export function lawJanuaryTwelfthIsAmbiguous(firstNumber: number): boolean {
  //@ ensures \result === true
  return !(firstNumber === 1) || numericDateAmbiguous(firstNumber, 12);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps its birthday only when nothing else in it contradicts it (spec/textEnrollment.md) */
//@ pure
export function joinBirthDateKept(hasTypedAge: boolean, typedAge: number, birthAge: number, otherNumber: boolean): boolean {
  return hasTypedAge ? exact_textEnrollment(typedAge - birthAge) <= 1 && exact_textEnrollment(birthAge - typedAge) <= 1 : !otherNumber;
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps its birthday only when nothing else in it contradicts it (spec/textEnrollment.md) */
//@ pure
export function lawBirthdayAloneIsKept(typedAge: number, birthAge: number): boolean {
  //@ ensures \result === true
  return joinBirthDateKept(false, typedAge, birthAge, false);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps its birthday only when nothing else in it contradicts it (spec/textEnrollment.md) */
//@ pure
export function lawBirthdayBesideAnotherNumberIsDropped(typedAge: number, birthAge: number): boolean {
  //@ ensures \result === true
  return !joinBirthDateKept(false, typedAge, birthAge, true);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps its birthday only when nothing else in it contradicts it (spec/textEnrollment.md) */
//@ pure
export function lawAgreeingTypedAgeKeepsTheBirthday(typedAge: number, otherNumber: boolean): boolean {
  //@ ensures \result === true
  return joinBirthDateKept(true, typedAge, typedAge, otherNumber) && joinBirthDateKept(true, typedAge, exact_textEnrollment(typedAge + 1), otherNumber);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps its birthday only when nothing else in it contradicts it (spec/textEnrollment.md) */
//@ pure
export function lawFarTypedAgeDropsTheBirthday(typedAge: number, birthAge: number, otherNumber: boolean): boolean {
  //@ ensures \result === true
  return !(exact_textEnrollment(typedAge - birthAge) > 1 || exact_textEnrollment(birthAge - typedAge) > 1) || !joinBirthDateKept(true, typedAge, birthAge, otherNumber);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps a contradicted typed age only when it is under 13 (spec/textEnrollment.md) */
//@ pure
export function joinTypedAgeKept(hasBirthAge: boolean, typedAge: number, birthAge: number): boolean {
  return !hasBirthAge || joinBirthDateKept(true, typedAge, birthAge, true) || !memberAge_joinableAge(typedAge);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps a contradicted typed age only when it is under 13 (spec/textEnrollment.md) */
//@ pure
export function lawTypedAgeAloneIsKept(typedAge: number, birthAge: number): boolean {
  //@ ensures \result === true
  return joinTypedAgeKept(false, typedAge, birthAge);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps a contradicted typed age only when it is under 13 (spec/textEnrollment.md) */
//@ pure
export function lawTypedChildAgeIsKept(hasBirthAge: boolean, birthAge: number): boolean {
  //@ ensures \result === true
  return joinTypedAgeKept(hasBirthAge, 12, birthAge);
}

/** Story: Tell a teen what the text line does with their age / A join answer keeps a contradicted typed age only when it is under 13 (spec/textEnrollment.md) */
//@ pure
export function lawFarJoinableTypedAgeIsDropped(typedAge: number): boolean {
  //@ ensures \result === true
  return !memberAge_joinableAge(typedAge) || !joinTypedAgeKept(true, typedAge, exact_textEnrollment(typedAge + 2));
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function teenBirthDateContradicted(birthExact: boolean, birthKey: number, minDay: number, maxDay: number, selfAge: number): boolean {
  return birthExact && friendIntroAge_teenPartnerAge(birthKey, minDay, maxDay) && (selfAge > friendIntroAge_teenFriendMaxAge || selfAge > exact_textEnrollment(memberAge_ageOnDay(birthKey, maxDay) + 1));
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function lawAdultStatementContradictsATeenBirthDate(selfAge: number): boolean {
  //@ ensures \result === true
  return !(selfAge > friendIntroAge_teenFriendMaxAge) || teenBirthDateContradicted(true, 20100315, 20261122, 20261122, selfAge);
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function lawTwoYearsOlderContradictsATeenBirthDate(selfAge: number): boolean {
  //@ ensures \result === true
  return !(selfAge >= 18) || teenBirthDateContradicted(true, 20100315, 20261122, 20261122, selfAge);
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function lawOneYearOlderIsNoContradiction(birthExact: boolean): boolean {
  //@ ensures \result === true
  return !teenBirthDateContradicted(birthExact, 20100315, 20261122, 20261122, 17);
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function lawCloseTeenStatementIsNoContradiction(birthExact: boolean, birthKey: number, minDay: number, maxDay: number, selfAge: number): boolean {
  //@ ensures \result === true
  return !(selfAge <= friendIntroAge_teenFriendMaxAge && selfAge <= exact_textEnrollment(memberAge_ageOnDay(birthKey, maxDay) + 1)) || !teenBirthDateContradicted(birthExact, birthKey, minDay, maxDay, selfAge);
}

/** Story: Tell a teen what the text line does with their age / An older age from a teen with a birth date is a contradiction (spec/textEnrollment.md) */
//@ pure
export function lawTypedAgeIsNoContradiction(birthKey: number, minDay: number, maxDay: number, selfAge: number): boolean {
  //@ ensures \result === true
  return !teenBirthDateContradicted(false, birthKey, minDay, maxDay, selfAge);
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function minorNoticeFor(app: string, teenIntros: boolean, teenReady: boolean, birthExact: boolean, doubtStored: boolean): MinorNotice {
  return app === "slop" ? "MinorSlopNotice" : (app === "peon" ? "MinorPeonNotice" : (doubtStored ? "MinorSinglePlayerNotice" : (matchLane_teenFriendApp(app) && teenIntros && teenReady ? "MinorTeenFriendNotice" : (matchLane_teenFriendApp(app) && teenIntros && !birthExact ? "MinorBirthdayNotice" : "MinorSinglePlayerNotice"))));
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function lawSlopMinorHearsNoDates(teenIntros: boolean, teenReady: boolean, birthExact: boolean, doubtStored: boolean): boolean {
  //@ ensures \result === true
  return minorNoticeFor("slop", teenIntros, teenReady, birthExact, doubtStored) === "MinorSlopNotice";
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function lawPeonMinorHearsNoWork(teenIntros: boolean, teenReady: boolean, birthExact: boolean, doubtStored: boolean): boolean {
  //@ ensures \result === true
  return minorNoticeFor("peon", teenIntros, teenReady, birthExact, doubtStored) === "MinorPeonNotice";
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function lawSwitchOffKeepsTheMinorNotice(app: string, teenReady: boolean, birthExact: boolean, doubtStored: boolean): boolean {
  //@ ensures \result === true
  return !(app !== "slop" && app !== "peon") || minorNoticeFor(app, false, teenReady, birthExact, doubtStored) === "MinorSinglePlayerNotice";
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function lawNoFriendPromiseWithDoubt(app: string, teenIntros: boolean, teenReady: boolean, birthExact: boolean): boolean {
  //@ ensures \result === true
  return minorNoticeFor(app, teenIntros, teenReady, birthExact, true) !== "MinorBirthdayNotice" && minorNoticeFor(app, teenIntros, teenReady, birthExact, true) !== "MinorTeenFriendNotice";
}

/** Story: Tell a teen what the text line does with their age / A minor hears which introductions the app makes (spec/textEnrollment.md) */
//@ pure
export function lawTeenFriendNoticeNeedsAReadyTeen(app: string, teenIntros: boolean, teenReady: boolean, birthExact: boolean, doubtStored: boolean): boolean {
  //@ ensures \result === true
  return !(minorNoticeFor(app, teenIntros, teenReady, birthExact, doubtStored) === "MinorTeenFriendNotice") || (matchLane_teenFriendApp(app) && teenIntros && teenReady && !doubtStored);
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function soloTeenApp(app: string): boolean {
  return app === "slop" || app === "peon";
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function minorScopeNoticeDue(minorNow: boolean, soloApp: boolean, alreadyTold: boolean): boolean {
  return minorNow && soloApp && !alreadyTold;
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function lawScopeNoticeOnce(minorNow: boolean, soloApp: boolean): boolean {
  //@ ensures \result === true
  return !minorScopeNoticeDue(minorNow, soloApp, true);
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function lawAdultHearsNoScopeNotice(soloApp: boolean, alreadyTold: boolean): boolean {
  //@ ensures \result === true
  return !minorScopeNoticeDue(false, soloApp, alreadyTold);
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function scopeNoticeTurnOpens(turnOpen: boolean, toldThisTurn: boolean): boolean {
  return turnOpen && !toldThisTurn;
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function lawScopeNoticeAnswersTheTurn(turnOpen: boolean): boolean {
  //@ ensures \result === true
  return !scopeNoticeTurnOpens(turnOpen, true);
}

/** Story: Tell a teen what the text line does with their age / A minor on slop.date or peon.biz hears once what they get (spec/textEnrollment.md) */
//@ pure
export function lawFriendAppsAreNotSolo(app: string): boolean {
  //@ ensures \result === true
  return !matchLane_teenFriendApp(app) || !soloTeenApp(app);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TextJoin, event: Event): boolean {
  if (event.type === "checkJoinBan") return canCheckJoinBan(current);
  if (event.type === "checkInvitation") return canCheckInvitation(current);
  if (event.type === "readJoinAnswer") return canReadJoinAnswer(current);
  if (event.type === "recordStatedAge") return canRecordStatedAge(current);
  if (event.type === "checkTextJoinAge") return canCheckTextJoinAge(current);
  if (event.type === "recordTextMembership") return canRecordTextMembership(current);
  if (event.type === "recordWelcome") return canRecordWelcome(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: TextJoin, event: Event): TextJoin {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkJoinBan") return canCheckJoinBan(current) ? checkJoinBan(current, event.banned) : current;
  if (event.type === "checkInvitation") return canCheckInvitation(current) ? checkInvitation(current, event.inviteOnly, event.invited, event.sharedNetwork, event.hasAge) : current;
  if (event.type === "readJoinAnswer") return canReadJoinAnswer(current) ? readJoinAnswer(current, event.answerFacts) : current;
  if (event.type === "recordStatedAge") return canRecordStatedAge(current) ? recordStatedAge(current) : current;
  if (event.type === "checkTextJoinAge") return canCheckTextJoinAge(current) ? checkTextJoinAge(current, event.ageAllowed) : current;
  if (event.type === "recordTextMembership") return canRecordTextMembership(current) ? recordTextMembership(current, event.membershipActive) : current;
  if (event.type === "recordWelcome") return canRecordWelcome(current) ? recordWelcome(current, event.hasOtherApp, event.sharedNetwork, event.invited) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  const is_JoinAnswerFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.hasAge === "boolean" && typeof v.hasName === "boolean" && typeof v.invalidHome === "boolean" && typeof v.floorRefused === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "checkJoinBan" && typeof raw.banned === "boolean") return { type: "checkJoinBan", banned: raw.banned };
  if (raw.type === "checkInvitation" && typeof raw.inviteOnly === "boolean" && typeof raw.invited === "boolean" && typeof raw.sharedNetwork === "boolean" && typeof raw.hasAge === "boolean") return { type: "checkInvitation", inviteOnly: raw.inviteOnly, invited: raw.invited, sharedNetwork: raw.sharedNetwork, hasAge: raw.hasAge };
  if (raw.type === "readJoinAnswer" && is_JoinAnswerFacts(raw.answerFacts)) return { type: "readJoinAnswer", answerFacts: ({ hasAge: raw.answerFacts.hasAge, hasName: raw.answerFacts.hasName, invalidHome: raw.answerFacts.invalidHome, floorRefused: raw.answerFacts.floorRefused }) };
  if (raw.type === "recordStatedAge") return { type: "recordStatedAge" };
  if (raw.type === "checkTextJoinAge" && typeof raw.ageAllowed === "boolean") return { type: "checkTextJoinAge", ageAllowed: raw.ageAllowed };
  if (raw.type === "recordTextMembership" && typeof raw.membershipActive === "boolean") return { type: "recordTextMembership", membershipActive: raw.membershipActive };
  if (raw.type === "recordWelcome" && typeof raw.hasOtherApp === "boolean" && typeof raw.sharedNetwork === "boolean" && typeof raw.invited === "boolean") return { type: "recordWelcome", hasOtherApp: raw.hasOtherApp, sharedNetwork: raw.sharedNetwork, invited: raw.invited };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): TextJoin | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingBan" || raw.phase === "JoinHeld" || raw.phase === "AwaitingInvite" || raw.phase === "InviteRequired" || raw.phase === "AwaitingAnswer" || raw.phase === "AskForAge" || raw.phase === "AskForHome" || raw.phase === "AwaitingJoinAge" || raw.phase === "RefuseAge" || raw.phase === "AskForName" || raw.phase === "AwaitingMember" || raw.phase === "AwaitingWelcome" || raw.phase === "JoinedWaitlist" || raw.phase === "JoinedWithShare" || raw.phase === "JoinedWithLookingFor" || raw.phase === "JoinedWithoutFollowUp" || raw.phase === "AwaitingAgeRecord" || raw.phase === "AwaitingInviteAgeRecord") && typeof raw.ageAllowed === "boolean" && typeof raw.hasName === "boolean" && typeof raw.invalidHome === "boolean" && typeof raw.hasAge === "boolean" && typeof raw.ageRecorded === "boolean" && typeof raw.floorRefused === "boolean" && Object.keys(raw).length === 7)) return undefined;
  const parsed: TextJoin = ({ phase: raw.phase, ageAllowed: raw.ageAllowed, hasName: raw.hasName, invalidHome: raw.invalidHome, hasAge: raw.hasAge, ageRecorded: raw.ageRecorded, floorRefused: raw.floorRefused });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TextJoin {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_textEnrollment(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
