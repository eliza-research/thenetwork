// GENERATED from spec/textEnrollment.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md:9) */
export interface ExplicitFacts { dedicated: boolean; profileApp: boolean; appKeyword: boolean }
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md:9) */
export type RoutePhase = "AwaitingExplicitRoute" | "AwaitingFallbackRoute" | "DedicatedRoute" | "ExplicitRoute" | "PendingJoinRoute" | "OpenItemRoute" | "RecentAppRoute" | "DefaultNetworkRoute";
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md:9) */
export interface TextRoute { phase: RoutePhase }
/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md:26) */
export interface FallbackFacts { hasPendingJoin: boolean; alreadyInPendingApp: boolean; hasMembership: boolean; answerHasAge: boolean; hasOpenItem: boolean }
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
export type JoinPhase = "AwaitingBan" | "JoinHeld" | "AwaitingInvite" | "InviteRequired" | "AwaitingAnswer" | "AskForAge" | "AskForHome" | "AwaitingJoinAge" | "RefuseAge" | "AskForName" | "AwaitingMember" | "AwaitingWelcome" | "JoinedWaitlist" | "JoinedWithShare" | "JoinedWithLookingFor" | "JoinedWithoutFollowUp";
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
export interface TextJoin { phase: JoinPhase; ageAllowed: boolean; hasName: boolean; invalidHome: boolean }
/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
export interface JoinAnswerFacts { hasAge: boolean; hasName: boolean; invalidHome: boolean }
/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
export type OtherAppOutcome = "SkipOtherApp" | "KeepOtherApp" | "CreateOtherApp";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkJoinBan"; banned: boolean }
  | { type: "checkInvitation"; inviteOnly: boolean; invited: boolean; sharedNetwork: boolean }
  | { type: "readJoinAnswer"; answerFacts: JoinAnswerFacts }
  | { type: "checkTextJoinAge"; ageAllowed: boolean }
  | { type: "recordTextMembership"; membershipActive: boolean }
  | { type: "recordWelcome"; hasOtherApp: boolean; sharedNetwork: boolean; invited: boolean };

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
export const completedAnswer: JoinAnswerFacts = { hasAge: true, hasName: true, invalidHome: false };
/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
export const initial: TextJoin = { phase: "AwaitingBan", ageAllowed: false, hasName: false, invalidHome: false };
/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md:9) */
export const initialRoute: TextRoute = { phase: "AwaitingExplicitRoute" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TextJoin): boolean {
  return alwaysMembershipRequiresCompletedEligibleAnswer(current);
}

/** Story: Text the Network to join an app / Dedicated lines and explicit app choices take priority (spec/textEnrollment.md:9) */
//@ pure
export function checkExplicitRoute(routing: TextRoute, explicitFacts: ExplicitFacts): TextRoute {
  return routing.phase !== "AwaitingExplicitRoute" ? routing : (explicitFacts.dedicated ? ({ phase: "DedicatedRoute" } as TextRoute) : (explicitFacts.profileApp || explicitFacts.appKeyword ? ({ phase: "ExplicitRoute" } as TextRoute) : ({ phase: "AwaitingFallbackRoute" } as TextRoute)));
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md:26) */
//@ pure
export function shouldReadPendingAnswer(hasPendingJoin: boolean, alreadyInPendingApp: boolean, hasMembership: boolean): boolean {
  return hasPendingJoin && !alreadyInPendingApp && hasMembership;
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md:26) */
//@ pure
export function pendingMatchesApp(pendingApp: string, routedApp: string): boolean {
  return pendingApp === routedApp;
}

/** Story: Text the Network to join an app / A pending join routes only a possible join answer (spec/textEnrollment.md:26) */
//@ pure
export function checkFallbackRoute(routing: TextRoute, fallbackFacts: FallbackFacts): TextRoute {
  return routing.phase !== "AwaitingFallbackRoute" ? routing : (fallbackFacts.hasPendingJoin && !fallbackFacts.alreadyInPendingApp && (!fallbackFacts.hasMembership || fallbackFacts.answerHasAge) ? ({ phase: "PendingJoinRoute" } as TextRoute) : (fallbackFacts.hasOpenItem ? ({ phase: "OpenItemRoute" } as TextRoute) : (fallbackFacts.hasMembership ? ({ phase: "RecentAppRoute" } as TextRoute) : ({ phase: "DefaultNetworkRoute" } as TextRoute))));
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
//@ pure
export function canCheckJoinBan(joining: TextJoin): boolean {
  return joining.phase === "AwaitingBan";
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
//@ pure
export function checkJoinBan(joining: TextJoin, banned: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckJoinBan(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: banned ? "JoinHeld" : "AwaitingInvite" };
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
//@ pure
export function canCheckInvitation(joining: TextJoin): boolean {
  return joining.phase === "AwaitingInvite";
}

/** Story: Text the Network to join an app / A join needs permission to enter this app (spec/textEnrollment.md:45) */
//@ pure
export function checkInvitation(joining: TextJoin, inviteOnly: boolean, invited: boolean, sharedNetwork: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckInvitation(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: inviteOnly && !invited && !sharedNetwork ? "InviteRequired" : "AwaitingAnswer" };
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
//@ pure
export function canReadJoinAnswer(joining: TextJoin): boolean {
  return joining.phase === "AwaitingAnswer";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
//@ pure
export function readJoinAnswer(joining: TextJoin, answerFacts: JoinAnswerFacts): TextJoin {
  //@ ensures (inv(joining) && canReadJoinAnswer(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, hasName: answerFacts.hasName, invalidHome: answerFacts.invalidHome, phase: answerFacts.hasAge ? "AwaitingJoinAge" : (answerFacts.invalidHome ? "AskForHome" : "AskForAge") };
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
//@ pure
export function canCheckTextJoinAge(joining: TextJoin): boolean {
  return joining.phase === "AwaitingJoinAge";
}

/** Story: Text the Network to join an app / Confirm age before creating a member (spec/textEnrollment.md:65) */
//@ pure
export function checkTextJoinAge(joining: TextJoin, ageAllowed: boolean): TextJoin {
  //@ ensures (inv(joining) && canCheckTextJoinAge(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, ageAllowed: ageAllowed, phase: !ageAllowed ? "RefuseAge" : (joining.invalidHome ? "AskForHome" : (joining.hasName ? "AwaitingMember" : "AskForName")) };
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function canRecordTextMembership(joining: TextJoin): boolean {
  return joining.phase === "AwaitingMember" && joining.ageAllowed && joining.hasName && !joining.invalidHome;
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function recordTextMembership(joining: TextJoin, membershipActive: boolean): TextJoin {
  //@ ensures (inv(joining) && canRecordTextMembership(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: membershipActive ? "AwaitingWelcome" : "JoinedWaitlist" };
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function canRecordWelcome(joining: TextJoin): boolean {
  return joining.phase === "AwaitingWelcome" && joining.ageAllowed && joining.hasName && !joining.invalidHome;
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function recordWelcome(joining: TextJoin, hasOtherApp: boolean, sharedNetwork: boolean, invited: boolean): TextJoin {
  //@ ensures (inv(joining) && canRecordWelcome(joining)) ==> alwaysMembershipRequiresCompletedEligibleAnswer(\result)
  return { ...joining, phase: hasOtherApp ? "JoinedWithShare" : (sharedNetwork && !invited ? "JoinedWithLookingFor" : "JoinedWithoutFollowUp") };
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function alwaysMembershipRequiresCompletedEligibleAnswer(joining: TextJoin): boolean {
  return !(joining.phase === "AwaitingMember" || joining.phase === "AwaitingWelcome" || joining.phase === "JoinedWaitlist" || joining.phase === "JoinedWithShare" || joining.phase === "JoinedWithLookingFor" || joining.phase === "JoinedWithoutFollowUp") || (joining.ageAllowed && joining.hasName && !joining.invalidHome);
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function sometimesAsksAge(joining: TextJoin): boolean {
  return joining.phase === "AskForAge";
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function sometimesRefusesAge(joining: TextJoin): boolean {
  return joining.phase === "RefuseAge";
}

/** Story: Text the Network to join an app / An active membership gets its welcome and at most one follow-up (spec/textEnrollment.md:87) */
//@ pure
export function sometimesAsksWhatTheyWant(joining: TextJoin): boolean {
  return joining.phase === "JoinedWithLookingFor";
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function shouldReadLookingFor(hasKeyword: boolean, profileRead: boolean, isNetwork: boolean): boolean {
  return !(hasKeyword || profileRead) && isNetwork;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function namedOtherApp(appName: string, running: boolean): boolean {
  return appName !== "ntwrk" && running;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function networkEnrollmentAllowed(hasPerson: boolean, hasNetworkMembership: boolean, banned: boolean): boolean {
  return hasPerson && hasNetworkMembership && !banned;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function otherAppAllowed(appName: string, adult: boolean): boolean {
  return appName !== "slop" || adult;
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function otherAppEnrollment(existingMember: boolean, ageEligible: boolean): OtherAppOutcome {
  return existingMember ? "KeepOtherApp" : (ageEligible ? "CreateOtherApp" : "SkipOtherApp");
}

/** Story: Choose other apps from The Network / A current Network member's answer controls other-app enrollment (spec/textEnrollment.md:118) */
//@ pure
export function lawSlopEnrollmentRequiresAdult(adult: boolean): boolean {
  //@ ensures \result === true
  return !otherAppAllowed("slop", adult) || adult;
}

/** Story: Choose other apps from The Network / A first-contact notice cannot substitute for enrollment (spec/textEnrollment.md:136) */
//@ pure
export function noticeAllowed(joinAgeAllowed: boolean, ageFloorAllowed: boolean): boolean {
  return joinAgeAllowed && ageFloorAllowed;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TextJoin, event: Event): boolean {
  if (event.type === "checkJoinBan") return canCheckJoinBan(current);
  if (event.type === "checkInvitation") return canCheckInvitation(current);
  if (event.type === "readJoinAnswer") return canReadJoinAnswer(current);
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
  if (event.type === "checkJoinBan" && canCheckJoinBan(current)) return checkJoinBan(current, event.banned);
  if (event.type === "checkInvitation" && canCheckInvitation(current)) return checkInvitation(current, event.inviteOnly, event.invited, event.sharedNetwork);
  if (event.type === "readJoinAnswer" && canReadJoinAnswer(current)) return readJoinAnswer(current, event.answerFacts);
  if (event.type === "checkTextJoinAge" && canCheckTextJoinAge(current)) return checkTextJoinAge(current, event.ageAllowed);
  if (event.type === "recordTextMembership" && canRecordTextMembership(current)) return recordTextMembership(current, event.membershipActive);
  if (event.type === "recordWelcome" && canRecordWelcome(current)) return recordWelcome(current, event.hasOtherApp, event.sharedNetwork, event.invited);
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
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "checkJoinBan" && typeof raw.banned === "boolean") return { type: "checkJoinBan", banned: raw.banned };
  if (raw.type === "checkInvitation" && typeof raw.inviteOnly === "boolean" && typeof raw.invited === "boolean" && typeof raw.sharedNetwork === "boolean") return { type: "checkInvitation", inviteOnly: raw.inviteOnly, invited: raw.invited, sharedNetwork: raw.sharedNetwork };
  if (raw.type === "readJoinAnswer" && typeof raw.answerFacts === "object" && raw.answerFacts !== null && !Array.isArray(raw.answerFacts) && typeof raw.answerFacts.hasAge === "boolean" && typeof raw.answerFacts.hasName === "boolean" && typeof raw.answerFacts.invalidHome === "boolean") return { type: "readJoinAnswer", answerFacts: ({ hasAge: raw.answerFacts.hasAge, hasName: raw.answerFacts.hasName, invalidHome: raw.answerFacts.invalidHome }) };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingBan" || raw.phase === "JoinHeld" || raw.phase === "AwaitingInvite" || raw.phase === "InviteRequired" || raw.phase === "AwaitingAnswer" || raw.phase === "AskForAge" || raw.phase === "AskForHome" || raw.phase === "AwaitingJoinAge" || raw.phase === "RefuseAge" || raw.phase === "AskForName" || raw.phase === "AwaitingMember" || raw.phase === "AwaitingWelcome" || raw.phase === "JoinedWaitlist" || raw.phase === "JoinedWithShare" || raw.phase === "JoinedWithLookingFor" || raw.phase === "JoinedWithoutFollowUp") && typeof raw.ageAllowed === "boolean" && typeof raw.hasName === "boolean" && typeof raw.invalidHome === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: TextJoin = ({ phase: raw.phase, ageAllowed: raw.ageAllowed, hasName: raw.hasName, invalidHome: raw.invalidHome });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TextJoin {
  //@ ensures inv(\result)
  return initial;
}
