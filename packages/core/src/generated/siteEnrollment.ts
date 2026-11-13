// GENERATED from spec/siteEnrollment.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md:9) */
export type EnrollmentPhase = "AwaitingAccountView" | "AccountChanged" | "AwaitingProfile" | "InvalidProfile" | "AwaitingConsent" | "ConsentMismatch" | "AwaitingEligibility" | "NeedsReview" | "AwaitingMembership" | "NeedsInvite" | "AwaitingAge" | "BelowJoinAge" | "ReturnExisting" | "AwaitingPersistence" | "Created" | "JoinHookFailed";
/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md:9) */
export interface Enrollment { phase: EnrollmentPhase; viewChecked: boolean; validProfile: boolean; currentConsent: boolean; currentEligibility: boolean; rejoin: boolean; invited: boolean; ageAllowed: boolean }
/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md:68) */
export interface MembershipFacts { existingMember: boolean; inviteRequired: boolean; hasInvite: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkAccountView"; viewMatches: boolean }
  | { type: "decodeProfile"; decoded: boolean }
  | { type: "confirmConsent"; consentMatches: boolean }
  | { type: "checkEligibility"; eligible: boolean }
  | { type: "checkMembership"; membershipFacts: MembershipFacts }
  | { type: "checkJoinAge"; ageEligible: boolean }
  | { type: "finishJoin"; hookSucceeded: boolean };

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md:9) */
export const initial: Enrollment = { phase: "AwaitingAccountView", viewChecked: false, validProfile: false, currentConsent: false, currentEligibility: false, rejoin: false, invited: false, ageAllowed: false };
/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md:38) */
export const typedJoinEntry: Enrollment = { ...initial, phase: "AwaitingConsent", validProfile: true, viewChecked: true };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Enrollment): boolean {
  return alwaysSuccessUsesEligibleProfile(current) && alwaysExistingMembershipStaysExisting(current);
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md:9) */
//@ pure
export function canCheckAccountView(joining: Enrollment): boolean {
  return joining.phase === "AwaitingAccountView";
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md:9) */
//@ pure
export function checkAccountView(joining: Enrollment, viewMatches: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckAccountView(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canCheckAccountView(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, viewChecked: viewMatches, phase: viewMatches ? "AwaitingProfile" : "AccountChanged" };
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md:38) */
//@ pure
export function canDecodeProfile(joining: Enrollment): boolean {
  return joining.phase === "AwaitingProfile" && joining.viewChecked;
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md:38) */
//@ pure
export function decodeProfile(joining: Enrollment, decoded: boolean): Enrollment {
  //@ ensures (inv(joining) && canDecodeProfile(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canDecodeProfile(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, validProfile: decoded, phase: decoded ? "AwaitingConsent" : "InvalidProfile" };
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md:38) */
//@ pure
export function canConfirmConsent(joining: Enrollment): boolean {
  return joining.phase === "AwaitingConsent" && joining.validProfile && joining.viewChecked;
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md:38) */
//@ pure
export function confirmConsent(joining: Enrollment, consentMatches: boolean): Enrollment {
  //@ ensures (inv(joining) && canConfirmConsent(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canConfirmConsent(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, currentConsent: consentMatches, phase: consentMatches ? "AwaitingEligibility" : "ConsentMismatch" };
}

/** Story: Save my approved profile in the app I asked for / A hold or ban prevents enrollment (spec/siteEnrollment.md:56) */
//@ pure
export function canCheckEligibility(joining: Enrollment): boolean {
  return joining.phase === "AwaitingEligibility" && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / A hold or ban prevents enrollment (spec/siteEnrollment.md:56) */
//@ pure
export function checkEligibility(joining: Enrollment, eligible: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckEligibility(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canCheckEligibility(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, currentEligibility: eligible, phase: eligible ? "AwaitingMembership" : "NeedsReview" };
}

/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md:68) */
//@ pure
export function canCheckMembership(joining: Enrollment): boolean {
  return joining.phase === "AwaitingMembership" && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md:68) */
//@ pure
export function checkMembership(joining: Enrollment, membershipFacts: MembershipFacts): Enrollment {
  //@ ensures (inv(joining) && canCheckMembership(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canCheckMembership(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  const missingInvite: boolean = membershipFacts.inviteRequired && !membershipFacts.existingMember && !membershipFacts.hasInvite;
  return { ...joining, rejoin: membershipFacts.existingMember, invited: membershipFacts.hasInvite, phase: missingInvite ? "NeedsInvite" : "AwaitingAge" };
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md:90) */
//@ pure
export function canCheckJoinAge(joining: Enrollment): boolean {
  return joining.phase === "AwaitingAge" && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md:90) */
//@ pure
export function checkJoinAge(joining: Enrollment, ageEligible: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckJoinAge(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canCheckJoinAge(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, ageAllowed: ageEligible, phase: !ageEligible ? "BelowJoinAge" : (joining.rejoin ? "ReturnExisting" : "AwaitingPersistence") };
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md:103) */
//@ pure
export function canFinishJoin(joining: Enrollment): boolean {
  return joining.phase === "AwaitingPersistence" && !joining.rejoin && joining.ageAllowed && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md:103) */
//@ pure
export function finishJoin(joining: Enrollment, hookSucceeded: boolean): Enrollment {
  //@ ensures (inv(joining) && canFinishJoin(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  //@ ensures (inv(joining) && canFinishJoin(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  return { ...joining, phase: hookSucceeded ? "Created" : "JoinHookFailed" };
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md:116) */
//@ pure
export function alwaysSuccessUsesEligibleProfile(joining: Enrollment): boolean {
  return !(joining.phase === "Created" || joining.phase === "ReturnExisting") || (joining.viewChecked && joining.validProfile && joining.currentConsent && joining.currentEligibility && joining.ageAllowed);
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md:116) */
//@ pure
export function alwaysExistingMembershipStaysExisting(joining: Enrollment): boolean {
  return (!(joining.phase === "ReturnExisting") || joining.rejoin) && (!(joining.phase === "Created") || !joining.rejoin);
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md:116) */
//@ pure
export function lawTypedEntryUsesSameConsentGate(consentMatches: boolean): boolean {
  //@ ensures \result === true
  return canConfirmConsent(typedJoinEntry) && confirmConsent(typedJoinEntry, consentMatches).phase === "AwaitingEligibility" === consentMatches;
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md:133) */
//@ pure
export function sometimesEnrolled(joining: Enrollment): boolean {
  return joining.phase === "Created";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md:133) */
//@ pure
export function sometimesExisting(joining: Enrollment): boolean {
  return joining.phase === "ReturnExisting";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md:133) */
//@ pure
export function sometimesAccountChanged(joining: Enrollment): boolean {
  return joining.phase === "AccountChanged";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md:133) */
//@ pure
export function sometimesNeedsInvite(joining: Enrollment): boolean {
  return joining.phase === "NeedsInvite";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md:133) */
//@ pure
export function sometimesBelowJoinAge(joining: Enrollment): boolean {
  return joining.phase === "BelowJoinAge";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Enrollment, event: Event): boolean {
  if (event.type === "checkAccountView") return canCheckAccountView(current);
  if (event.type === "decodeProfile") return canDecodeProfile(current);
  if (event.type === "confirmConsent") return canConfirmConsent(current);
  if (event.type === "checkEligibility") return canCheckEligibility(current);
  if (event.type === "checkMembership") return canCheckMembership(current);
  if (event.type === "checkJoinAge") return canCheckJoinAge(current);
  if (event.type === "finishJoin") return canFinishJoin(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Enrollment, event: Event): Enrollment {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkAccountView" && canCheckAccountView(current)) return checkAccountView(current, event.viewMatches);
  if (event.type === "decodeProfile" && canDecodeProfile(current)) return decodeProfile(current, event.decoded);
  if (event.type === "confirmConsent" && canConfirmConsent(current)) return confirmConsent(current, event.consentMatches);
  if (event.type === "checkEligibility" && canCheckEligibility(current)) return checkEligibility(current, event.eligible);
  if (event.type === "checkMembership" && canCheckMembership(current)) return checkMembership(current, event.membershipFacts);
  if (event.type === "checkJoinAge" && canCheckJoinAge(current)) return checkJoinAge(current, event.ageEligible);
  if (event.type === "finishJoin" && canFinishJoin(current)) return finishJoin(current, event.hookSucceeded);
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
  if (raw.type === "checkAccountView" && typeof raw.viewMatches === "boolean") return { type: "checkAccountView", viewMatches: raw.viewMatches };
  if (raw.type === "decodeProfile" && typeof raw.decoded === "boolean") return { type: "decodeProfile", decoded: raw.decoded };
  if (raw.type === "confirmConsent" && typeof raw.consentMatches === "boolean") return { type: "confirmConsent", consentMatches: raw.consentMatches };
  if (raw.type === "checkEligibility" && typeof raw.eligible === "boolean") return { type: "checkEligibility", eligible: raw.eligible };
  if (raw.type === "checkMembership" && typeof raw.membershipFacts === "object" && raw.membershipFacts !== null && !Array.isArray(raw.membershipFacts) && typeof raw.membershipFacts.existingMember === "boolean" && typeof raw.membershipFacts.inviteRequired === "boolean" && typeof raw.membershipFacts.hasInvite === "boolean") return { type: "checkMembership", membershipFacts: ({ existingMember: raw.membershipFacts.existingMember, inviteRequired: raw.membershipFacts.inviteRequired, hasInvite: raw.membershipFacts.hasInvite }) };
  if (raw.type === "checkJoinAge" && typeof raw.ageEligible === "boolean") return { type: "checkJoinAge", ageEligible: raw.ageEligible };
  if (raw.type === "finishJoin" && typeof raw.hookSucceeded === "boolean") return { type: "finishJoin", hookSucceeded: raw.hookSucceeded };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Enrollment | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingAccountView" || raw.phase === "AccountChanged" || raw.phase === "AwaitingProfile" || raw.phase === "InvalidProfile" || raw.phase === "AwaitingConsent" || raw.phase === "ConsentMismatch" || raw.phase === "AwaitingEligibility" || raw.phase === "NeedsReview" || raw.phase === "AwaitingMembership" || raw.phase === "NeedsInvite" || raw.phase === "AwaitingAge" || raw.phase === "BelowJoinAge" || raw.phase === "ReturnExisting" || raw.phase === "AwaitingPersistence" || raw.phase === "Created" || raw.phase === "JoinHookFailed") && typeof raw.viewChecked === "boolean" && typeof raw.validProfile === "boolean" && typeof raw.currentConsent === "boolean" && typeof raw.currentEligibility === "boolean" && typeof raw.rejoin === "boolean" && typeof raw.invited === "boolean" && typeof raw.ageAllowed === "boolean" && Object.keys(raw).length === 8)) return undefined;
  const parsed: Enrollment = ({ phase: raw.phase, viewChecked: raw.viewChecked, validProfile: raw.validProfile, currentConsent: raw.currentConsent, currentEligibility: raw.currentEligibility, rejoin: raw.rejoin, invited: raw.invited, ageAllowed: raw.ageAllowed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Enrollment {
  //@ ensures inv(\result)
  return initial;
}
