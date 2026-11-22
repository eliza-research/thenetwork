// GENERATED from spec/textEnrollment.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export type RoutePhase = "AwaitingExplicitRoute" | "AwaitingFallbackRoute" | "DedicatedRoute" | "ProfileRoute" | "SurveyRoute" | "KeywordRoute" | "SafetyRoute" | "PendingJoinRoute" | "OpenItemRoute" | "RecentAppRoute" | "DefaultNetworkRoute";
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export interface ExplicitFacts { dedicated: boolean; profileApp: boolean; surveyApp: boolean; appKeyword: boolean }
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export interface TextRoute { phase: RoutePhase }
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

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkJoinBan"; banned: boolean }
  | { type: "checkInvitation"; inviteOnly: boolean; invited: boolean; sharedNetwork: boolean; hasAge: boolean }
  | { type: "readJoinAnswer"; answerFacts: JoinAnswerFacts }
  | { type: "recordStatedAge" }
  | { type: "checkTextJoinAge"; ageAllowed: boolean }
  | { type: "recordTextMembership"; membershipActive: boolean }
  | { type: "recordWelcome"; hasOtherApp: boolean; sharedNetwork: boolean; invited: boolean };

/** Story: Text the Network to join an app / A prepared Peon signup names its app on a separate first line (spec/textEnrollment.md) */
export const preparedPeonTextHeader: string = "join peon";
/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
export const completedAnswer: JoinAnswerFacts = { hasAge: true, hasName: true, invalidHome: false, floorRefused: false };
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md) */
export const initial: TextJoin = { phase: "AwaitingBan", ageAllowed: false, hasName: false, invalidHome: false, hasAge: false, ageRecorded: false, floorRefused: false };
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
export const initialRoute: TextRoute = { phase: "AwaitingExplicitRoute" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TextJoin): boolean {
  return alwaysInviteRefusalKeepsStatedAge(current) && alwaysStatedAgeRecordedFirst(current) && alwaysRefusedFloorOnlyDeclines(current) && alwaysMembershipRequiresCompletedEligibleAnswer(current);
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function checkExplicitRoute(routing: TextRoute, explicitFacts: ExplicitFacts): TextRoute {
  return routing.phase !== "AwaitingExplicitRoute" ? routing : (explicitFacts.dedicated ? ({ phase: "DedicatedRoute" } as TextRoute) : (explicitFacts.profileApp ? ({ phase: "ProfileRoute" } as TextRoute) : (explicitFacts.surveyApp ? ({ phase: "SurveyRoute" } as TextRoute) : (explicitFacts.appKeyword ? ({ phase: "KeywordRoute" } as TextRoute) : ({ phase: "AwaitingFallbackRoute" } as TextRoute)))));
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawDedicatedLineTakesPrecedence(profileApp: boolean, surveyApp: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: true, profileApp: profileApp, surveyApp: surveyApp, appKeyword: appKeyword } as ExplicitFacts)).phase === "DedicatedRoute";
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawProfileReadTakesPrecedence(surveyApp: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: false, profileApp: true, surveyApp: surveyApp, appKeyword: appKeyword } as ExplicitFacts)).phase === "ProfileRoute";
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md) */
//@ pure
export function lawSurveyReplyTakesPrecedence(appKeyword: boolean): boolean {
  //@ ensures \result === true
  return checkExplicitRoute(initialRoute, ({ dedicated: false, profileApp: false, surveyApp: true, appKeyword: appKeyword } as ExplicitFacts)).phase === "SurveyRoute";
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
export function shouldReadPendingAnswer(hasPendingJoin: boolean, alreadyInPendingApp: boolean, hasMembership: boolean): boolean {
  return hasPendingJoin && !alreadyInPendingApp && hasMembership;
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function pendingMatchesApp(pendingApp: string, routedApp: string): boolean {
  return pendingApp === routedApp;
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md) */
//@ pure
export function checkFallbackRoute(routing: TextRoute, fallbackFacts: FallbackFacts): TextRoute {
  return routing.phase !== "AwaitingFallbackRoute" ? routing : (fallbackFacts.safetyClaim ? ({ phase: "SafetyRoute" } as TextRoute) : (fallbackFacts.hasPendingJoin && !fallbackFacts.alreadyInPendingApp && (!fallbackFacts.hasMembership || fallbackFacts.answerHasAge) ? ({ phase: "PendingJoinRoute" } as TextRoute) : (fallbackFacts.hasOpenItem ? ({ phase: "OpenItemRoute" } as TextRoute) : (fallbackFacts.hasMembership ? ({ phase: "RecentAppRoute" } as TextRoute) : ({ phase: "DefaultNetworkRoute" } as TextRoute)))));
}

/** Story: Text the Network to join an app / A safety claim routes before every other fallback (spec/textEnrollment.md) */
//@ pure
export function lawSafetyClaimRoutesFirst(hasPendingJoin: boolean, alreadyInPendingApp: boolean, hasMembership: boolean, answerHasAge: boolean, hasOpenItem: boolean): boolean {
  //@ ensures \result === true
  return checkFallbackRoute(({ phase: "AwaitingFallbackRoute" } as TextRoute), ({ safetyClaim: true, hasPendingJoin: hasPendingJoin, alreadyInPendingApp: alreadyInPendingApp, hasMembership: hasMembership, answerHasAge: answerHasAge, hasOpenItem: hasOpenItem } as FallbackFacts)).phase === "SafetyRoute";
}

/** Story: Text the Network to join an app / A safety claim routes before every other fallback (spec/textEnrollment.md) */
//@ pure
export function lawExplicitRouteKeepsSafetyClaimOut(dedicated: boolean, profileApp: boolean, surveyApp: boolean, appKeyword: boolean): boolean {
  //@ ensures \result === true
  return !(dedicated || profileApp || surveyApp || appKeyword) || checkFallbackRoute(checkExplicitRoute(initialRoute, ({ dedicated: dedicated, profileApp: profileApp, surveyApp: surveyApp, appKeyword: appKeyword } as ExplicitFacts)), ({ safetyClaim: true, hasPendingJoin: false, alreadyInPendingApp: false, hasMembership: true, answerHasAge: false, hasOpenItem: false } as FallbackFacts)).phase !== "SafetyRoute";
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
export function sometimesRecordsStatedAge(joining: TextJoin): boolean {
  return joining.phase === "AwaitingAgeRecord";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md) */
//@ pure
export function sometimesDeclinesRecordedFloor(joining: TextJoin): boolean {
  return joining.phase === "RefuseAge" && joining.floorRefused && !joining.hasAge;
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

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function textJoinKeepsMemberId(membership: JoinMembership): boolean {
  return membership === "InvitedMembership" || membership === "LiveMembership";
}

/** Story: Text the Network to join an app / A text join keeps the member id of a membership that is not removed (spec/textEnrollment.md) */
//@ pure
export function lawInvitedMembershipKeepsItsMemberId(membership: JoinMembership): boolean {
  //@ ensures \result === true
  return !(membership === "InvitedMembership") || textJoinKeepsMemberId(membership);
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
  return appName !== "slop" || adult;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function otherAppEnrollment(existingMember: boolean, ageEligible: boolean): OtherAppOutcome {
  return existingMember ? "KeepOtherApp" : (ageEligible ? "CreateOtherApp" : "SkipOtherApp");
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md) */
//@ pure
export function lawSlopEnrollmentRequiresAdult(adult: boolean): boolean {
  //@ ensures \result === true
  return !otherAppAllowed("slop", adult) || adult;
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
