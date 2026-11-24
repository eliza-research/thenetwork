// GENERATED from spec/siteEnrollment.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, maxAge as memberAge_maxAge, minLooseTeamAge as memberAge_minLooseTeamAge, adultAge as memberAge_adultAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, recordedChatAge as memberAge_recordedChatAge, signupAgeAt as memberAge_signupAgeAt, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, ageInRange as memberAge_ageInRange, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, recordedAgeFloorApplies as memberAge_recordedAgeFloorApplies, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, matchableAge as memberAge_matchableAge, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, lawPhoneReassignmentEndsAgeProjection as memberAge_lawPhoneReassignmentEndsAgeProjection, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, confirmedUnderage as memberAge_confirmedUnderage, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
export type EnrollmentPhase = "AwaitingAccountView" | "AccountChanged" | "AwaitingProfile" | "InvalidProfile" | "AwaitingConsent" | "ConsentMismatch" | "AwaitingEligibility" | "NeedsReview" | "AwaitingMembership" | "NeedsInvite" | "InvalidInvitation" | "AwaitingAge" | "BelowJoinAge" | "ReturnExisting" | "AwaitingRepair" | "AwaitingPersistence" | "Created" | "JoinHookFailed";
/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
export interface Enrollment { phase: EnrollmentPhase; viewChecked: boolean; validProfile: boolean; currentConsent: boolean; currentEligibility: boolean; rejoin: boolean; invited: boolean; referred: boolean; invalidReferral: boolean; ageAllowed: boolean }
/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
export interface JoinConsentEvidence { smsAccepted: boolean; wordingSupplied: boolean; wordingAccepted: boolean; versionSupplied: boolean; versionAccepted: boolean }
/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md) */
export type ReferralFact = "NoReferral" | "InvalidReferral" | "VerifiedReferral";
/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md) */
export interface MembershipFacts { existingMember: boolean; inviteRequired: boolean; hasInvite: boolean; referral: ReferralFact }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkAccountView"; viewMatches: boolean }
  | { type: "decodeProfile"; decoded: boolean }
  | { type: "confirmConsent"; consentMatches: boolean }
  | { type: "checkEligibility"; eligible: boolean }
  | { type: "checkMembership"; membershipFacts: MembershipFacts }
  | { type: "checkJoinAge"; ageEligible: boolean; memberMissing: boolean }
  | { type: "finishRepair"; hookSucceeded: boolean }
  | { type: "finishJoin"; hookSucceeded: boolean };

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
export const completeJoinConsent: JoinConsentEvidence = { smsAccepted: true, wordingSupplied: true, wordingAccepted: true, versionSupplied: true, versionAccepted: true };
/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
export const initial: Enrollment = { phase: "AwaitingAccountView", viewChecked: false, validProfile: false, currentConsent: false, currentEligibility: false, rejoin: false, invited: false, referred: false, invalidReferral: false, ageAllowed: false };
/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
export const typedJoinEntry: Enrollment = { ...initial, phase: "AwaitingConsent", validProfile: true, viewChecked: true };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Enrollment): boolean {
  return alwaysExistingMembershipStaysExisting(current) && alwaysReferralOnlyOnNewMembership(current) && alwaysSuccessUsesEligibleProfile(current);
}

/** Story: Find the app's public signup entry / Public signup uses the app's supported surface (spec/siteEnrollment.md) */
//@ pure
export function publicSignupUsesBrowser(app: string): boolean {
  return app === "peon";
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
//@ pure
export function signupAccountViewMatches(markerSupplied: boolean, markerMatches: boolean): boolean {
  return !markerSupplied || markerMatches;
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
//@ pure
export function lawRejectStaleSignupAccountView(markerSupplied: boolean, markerMatches: boolean): boolean {
  //@ ensures \result === true
  return !(markerSupplied && !markerMatches) || !signupAccountViewMatches(markerSupplied, markerMatches);
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
//@ pure
export function canCheckAccountView(joining: Enrollment): boolean {
  return joining.phase === "AwaitingAccountView";
}

/** Story: Save my approved profile in the app I asked for / A submitted account marker must match the authenticated account (spec/siteEnrollment.md) */
//@ pure
export function checkAccountView(joining: Enrollment, viewMatches: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckAccountView(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canCheckAccountView(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canCheckAccountView(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, viewChecked: viewMatches, phase: viewMatches ? "AwaitingProfile" : "AccountChanged" };
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function joinConsentEvidenceAllowed(evidence: JoinConsentEvidence): boolean {
  return evidence.smsAccepted && (evidence.wordingSupplied || evidence.versionSupplied) && (!evidence.wordingSupplied || evidence.wordingAccepted) && (!evidence.versionSupplied || evidence.versionAccepted);
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function joinAgeFieldsValid(hasBirthDate: boolean, hasAge: boolean): boolean {
  return (hasBirthDate || hasAge) && !(hasBirthDate && hasAge);
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function canDecodeProfile(joining: Enrollment): boolean {
  return joining.phase === "AwaitingProfile" && joining.viewChecked;
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function decodeProfile(joining: Enrollment, decoded: boolean): Enrollment {
  //@ ensures (inv(joining) && canDecodeProfile(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canDecodeProfile(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canDecodeProfile(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, validProfile: decoded, phase: decoded ? "AwaitingConsent" : "InvalidProfile" };
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function lawEverySuppliedJoinConsentFieldMustAgree(evidence: JoinConsentEvidence): boolean {
  //@ ensures \result === true
  return !((evidence.wordingSupplied && !evidence.wordingAccepted) || (evidence.versionSupplied && !evidence.versionAccepted)) || !joinConsentEvidenceAllowed(evidence);
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function lawBothOrNeitherAgeFieldIsMalformed(hasBirthDate: boolean, hasAge: boolean): boolean {
  //@ ensures \result === true
  return !(hasBirthDate === hasAge) || !joinAgeFieldsValid(hasBirthDate, hasAge);
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function canConfirmConsent(joining: Enrollment): boolean {
  return joining.phase === "AwaitingConsent" && joining.validProfile && joining.viewChecked;
}

/** Story: Save my approved profile in the app I asked for / Decode the profile and accept current consent before locking the account (spec/siteEnrollment.md) */
//@ pure
export function confirmConsent(joining: Enrollment, consentMatches: boolean): Enrollment {
  //@ ensures (inv(joining) && canConfirmConsent(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canConfirmConsent(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canConfirmConsent(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, currentConsent: consentMatches, phase: consentMatches ? "AwaitingEligibility" : "ConsentMismatch" };
}

/** Story: Save my approved profile in the app I asked for / An authenticated join accepts one age input (spec/siteEnrollment.md) */
//@ pure
export function joinAgeInputAllowed(ageSupplied: boolean, birthdaySupplied: boolean): boolean {
  return ageSupplied !== birthdaySupplied;
}

/** Story: Save my approved profile in the app I asked for / An authenticated join accepts one age input (spec/siteEnrollment.md) */
//@ pure
export function lawJoinRefusesAmbiguousAgeInput(ageSupplied: boolean, birthdaySupplied: boolean): boolean {
  //@ ensures \result === true
  return !(ageSupplied === birthdaySupplied) || !joinAgeInputAllowed(ageSupplied, birthdaySupplied);
}

/** Story: Save my approved profile in the app I asked for / A hold or ban prevents enrollment (spec/siteEnrollment.md) */
//@ pure
export function canCheckEligibility(joining: Enrollment): boolean {
  return joining.phase === "AwaitingEligibility" && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / A hold or ban prevents enrollment (spec/siteEnrollment.md) */
//@ pure
export function checkEligibility(joining: Enrollment, eligible: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckEligibility(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canCheckEligibility(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canCheckEligibility(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, currentEligibility: eligible, phase: eligible ? "AwaitingMembership" : "NeedsReview" };
}

/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md) */
//@ pure
export function canCheckMembership(joining: Enrollment): boolean {
  return joining.phase === "AwaitingMembership" && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / The current membership determines whether a join needs an invite (spec/siteEnrollment.md) */
//@ pure
export function checkMembership(joining: Enrollment, membershipFacts: MembershipFacts): Enrollment {
  //@ ensures (inv(joining) && canCheckMembership(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canCheckMembership(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canCheckMembership(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  const local_0 = !membershipFacts.existingMember && membershipFacts.referral === "VerifiedReferral";
  const local_1 = !membershipFacts.existingMember && membershipFacts.referral === "InvalidReferral";
  const local_2 = membershipFacts.inviteRequired && !membershipFacts.existingMember && !membershipFacts.hasInvite && !local_0 && !local_1;
  return { ...joining, rejoin: membershipFacts.existingMember, invited: membershipFacts.hasInvite, referred: local_0, invalidReferral: local_1, phase: local_2 ? "NeedsInvite" : "AwaitingAge" };
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md) */
//@ pure
export function canCheckJoinAge(joining: Enrollment): boolean {
  return joining.phase === "AwaitingAge" && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md) */
//@ pure
export function checkJoinAge(joining: Enrollment, ageEligible: boolean, memberMissing: boolean): Enrollment {
  //@ ensures (inv(joining) && canCheckJoinAge(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canCheckJoinAge(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canCheckJoinAge(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, ageAllowed: ageEligible, phase: !ageEligible ? "BelowJoinAge" : (joining.rejoin ? (memberMissing ? "AwaitingRepair" : "ReturnExisting") : (joining.invalidReferral ? "InvalidInvitation" : "AwaitingPersistence")) };
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md) */
//@ pure
export function canFinishRepair(joining: Enrollment): boolean {
  return joining.phase === "AwaitingRepair" && joining.rejoin && joining.ageAllowed && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / The effective age controls the result of a new or repeated join (spec/siteEnrollment.md) */
//@ pure
export function finishRepair(joining: Enrollment, hookSucceeded: boolean): Enrollment {
  //@ ensures (inv(joining) && canFinishRepair(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canFinishRepair(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canFinishRepair(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, phase: hookSucceeded ? "ReturnExisting" : "JoinHookFailed" };
}

/** Story: Save my approved profile in the app I asked for / A decline below the join age ends the number's unbound access (spec/siteEnrollment.md) */
//@ pure
export function declineEndsUnboundAccess(effectiveAge: number): boolean {
  return memberAge_confirmedUnderage(effectiveAge);
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md) */
//@ pure
export function joinFailureForgetsMembership(referred: boolean): boolean {
  return !referred;
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md) */
//@ pure
export function forgetEndsAppAccess(joinFailed: boolean): boolean {
  return !joinFailed;
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md) */
//@ pure
export function canFinishJoin(joining: Enrollment): boolean {
  return joining.phase === "AwaitingPersistence" && !joining.rejoin && !joining.invalidReferral && joining.ageAllowed && joining.currentEligibility && joining.viewChecked && joining.validProfile && joining.currentConsent;
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md) */
//@ pure
export function finishJoin(joining: Enrollment, hookSucceeded: boolean): Enrollment {
  //@ ensures (inv(joining) && canFinishJoin(joining)) ==> alwaysExistingMembershipStaysExisting(\result)
  //@ ensures (inv(joining) && canFinishJoin(joining)) ==> alwaysReferralOnlyOnNewMembership(\result)
  //@ ensures (inv(joining) && canFinishJoin(joining)) ==> alwaysSuccessUsesEligibleProfile(\result)
  return { ...joining, phase: hookSucceeded ? "Created" : "JoinHookFailed" };
}

/** Story: Save my approved profile in the app I asked for / Success for a new membership follows the join hook (spec/siteEnrollment.md) */
//@ pure
export function lawFailedOrdinaryJoinForgetsOnlyTheMember(joining: Enrollment): boolean {
  //@ ensures \result === true
  return !(canFinishJoin(joining) && !joining.referred) || (finishJoin(joining, false).phase === "JoinHookFailed" && joinFailureForgetsMembership(joining.referred) && !forgetEndsAppAccess(true));
}

/** Story: Save my approved profile in the app I asked for / The approved profile reaches onboarding and its stated age counts (spec/siteEnrollment.md) */
//@ pure
export function profileJoinAge(typedAge: number, profileAge: number, profileStatesAge: boolean): number {
  return profileStatesAge && profileAge < typedAge ? profileAge : typedAge;
}

/** Story: Save my approved profile in the app I asked for / The approved profile reaches onboarding and its stated age counts (spec/siteEnrollment.md) */
//@ pure
export function profileAgeCounts(statedExplicitly: boolean, declinedForAge: boolean, ageMatchable: boolean): boolean {
  return statedExplicitly || declinedForAge || !ageMatchable;
}

/** Story: Save my approved profile in the app I asked for / The approved profile reaches onboarding and its stated age counts (spec/siteEnrollment.md) */
//@ pure
export function lawProfileMinorAgeAlwaysCounts(statedExplicitly: boolean, declinedForAge: boolean): boolean {
  //@ ensures \result === true
  return profileAgeCounts(statedExplicitly, declinedForAge, false);
}

/** Story: Save my approved profile in the app I asked for / The approved profile reaches onboarding and its stated age counts (spec/siteEnrollment.md) */
//@ pure
export function lawProfileAgeNeverRaisesJoinAge(typedAge: number, profileAge: number, profileStatesAge: boolean): boolean {
  //@ ensures \result === true
  return profileJoinAge(typedAge, profileAge, profileStatesAge) <= typedAge && (!profileStatesAge || profileJoinAge(typedAge, profileAge, profileStatesAge) <= profileAge);
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md) */
//@ pure
export function alwaysExistingMembershipStaysExisting(joining: Enrollment): boolean {
  return (!(joining.phase === "ReturnExisting") || joining.rejoin) && (!(joining.phase === "Created") || !joining.rejoin);
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md) */
//@ pure
export function alwaysReferralOnlyOnNewMembership(joining: Enrollment): boolean {
  return !joining.referred || !joining.rejoin;
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md) */
//@ pure
export function alwaysSuccessUsesEligibleProfile(joining: Enrollment): boolean {
  return !(joining.phase === "Created" || joining.phase === "ReturnExisting") || (joining.viewChecked && joining.validProfile && joining.currentConsent && joining.currentEligibility && joining.ageAllowed);
}

/** Story: Save my approved profile in the app I asked for / Success requires an eligible profile with current consent (spec/siteEnrollment.md) */
//@ pure
export function lawTypedEntryUsesSameConsentGate(consentMatches: boolean): boolean {
  //@ ensures \result === true
  return canConfirmConsent(typedJoinEntry) && confirmConsent(typedJoinEntry, consentMatches).phase === "AwaitingEligibility" === consentMatches;
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesEnrolled(joining: Enrollment): boolean {
  return joining.phase === "Created";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesExisting(joining: Enrollment): boolean {
  return joining.phase === "ReturnExisting";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesAccountChanged(joining: Enrollment): boolean {
  return joining.phase === "AccountChanged";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesNeedsInvite(joining: Enrollment): boolean {
  return joining.phase === "NeedsInvite";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesInvalidInvitation(joining: Enrollment): boolean {
  return joining.phase === "InvalidInvitation";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesBelowJoinAge(joining: Enrollment): boolean {
  return joining.phase === "BelowJoinAge";
}

/** Story: Save my approved profile in the app I asked for / A request can enroll, reuse its membership or stop at a refusal (spec/siteEnrollment.md) */
//@ pure
export function sometimesRepairsMember(joining: Enrollment): boolean {
  return joining.phase === "AwaitingRepair";
}

/** Story: Keep the age readings of a person and a phone / Readings of two records merge without a new date (spec/siteEnrollment.md) */
//@ pure
export function mergeAgeReadings(hasEarlier: boolean, earlier: memberAge_BirthReadings, added: memberAge_BirthReadings): memberAge_BirthReadings {
  return !hasEarlier ? added : ({ lower: memberAge_laterBirthKey(earlier.lower, added.lower), upper: earlier.upper <= added.upper ? earlier.upper : added.upper, youngest: memberAge_laterBirthKey(earlier.youngest, added.youngest) } as memberAge_BirthReadings);
}

/** Story: Keep the age readings of a person and a phone / Readings of two records merge without a new date (spec/siteEnrollment.md) */
//@ pure
export function lawMergeKeepsEveryYoungestReading(earlier: memberAge_BirthReadings, added: memberAge_BirthReadings): boolean {
  //@ ensures \result === true
  const local_3: memberAge_BirthReadings = mergeAgeReadings(true, earlier, added);
  return local_3.youngest >= earlier.youngest && local_3.youngest >= added.youngest;
}

/** Story: Keep the age readings of a person and a phone / Readings of two records merge without a new date (spec/siteEnrollment.md) */
//@ pure
export function lawMergeNarrowsTheRange(earlier: memberAge_BirthReadings, added: memberAge_BirthReadings): boolean {
  //@ ensures \result === true
  const local_4: memberAge_BirthReadings = mergeAgeReadings(true, earlier, added);
  return local_4.lower >= earlier.lower && local_4.lower >= added.lower && local_4.upper <= earlier.upper && local_4.upper <= added.upper;
}

/** Story: Keep the age readings of a person and a phone / Readings of two records merge without a new date (spec/siteEnrollment.md) */
//@ pure
export function lawMergeKeepsAConflict(earlier: memberAge_BirthReadings, added: memberAge_BirthReadings): boolean {
  //@ ensures \result === true
  const local_5: memberAge_BirthReadings = mergeAgeReadings(true, earlier, added);
  return !(earlier.lower >= earlier.upper || added.lower >= added.upper) || local_5.lower >= local_5.upper;
}

/** Story: Keep the age readings of a person and a phone / Readings of two records merge without a new date (spec/siteEnrollment.md) */
//@ pure
export function lawMergeWithNoRecordKeepsTheRecord(earlier: memberAge_BirthReadings, added: memberAge_BirthReadings): boolean {
  //@ ensures \result === true
  const local_6: memberAge_BirthReadings = mergeAgeReadings(false, earlier, added);
  return local_6.lower === added.lower && local_6.upper === added.upper && local_6.youngest === added.youngest;
}

/** Story: Keep the age readings of a person and a phone / A verified browser join can keep a private teen birth reading (spec/siteEnrollment.md) */
//@ pure
export function browserEnrollmentKeepsPrivateBirth(membershipAccepted: boolean, bindingCurrent: boolean, age: number): boolean {
  return memberAge_verifiedBrowserBirthMayBeKept(membershipAccepted && bindingCurrent, age);
}

/** Story: Keep the age readings of a person and a phone / A verified browser join can keep a private teen birth reading (spec/siteEnrollment.md) */
//@ pure
export function lawBrowserEnrollmentBirthNeedsCurrentAcceptedOwner(membershipAccepted: boolean, bindingCurrent: boolean, age: number): boolean {
  //@ ensures \result === true
  return !browserEnrollmentKeepsPrivateBirth(membershipAccepted, bindingCurrent, age) || (membershipAccepted && bindingCurrent);
}

/** Story: Keep the age readings of a person and a phone / A birth date below the join age is kept only as a typed age (spec/siteEnrollment.md) */
//@ pure
export function exactReadingKept(statesBirthDate: boolean, hasPerson: boolean, ageWithBirthDate: number): boolean {
  return statesBirthDate && hasPerson && memberAge_joinableAge(ageWithBirthDate);
}

/** Story: Keep the age readings of a person and a phone / A birth date below the join age is kept only as a typed age (spec/siteEnrollment.md) */
//@ pure
export function lawUnderageBirthDateIsNeverKept(statesBirthDate: boolean, hasPerson: boolean, ageWithBirthDate: number): boolean {
  //@ ensures \result === true
  return !(!memberAge_joinableAge(ageWithBirthDate)) || !exactReadingKept(statesBirthDate, hasPerson, ageWithBirthDate);
}

/** Story: Keep the age readings of a person and a phone / A birth date below the join age is kept only as a typed age (spec/siteEnrollment.md) */
//@ pure
export function lawBirthDateWithoutAPersonIsOnlyTyped(statesBirthDate: boolean, ageWithBirthDate: number): boolean {
  //@ ensures \result === true
  return !exactReadingKept(statesBirthDate, false, ageWithBirthDate);
}

/** Story: Keep the age readings of a person and a phone / The phone floor keeps the lowest age that a statement gives (spec/siteEnrollment.md) */
//@ pure
export function floorStatedAge(statedAge: number, mergedAge: number): number {
  return memberAge_ageInRange(mergedAge) ? memberAge_lowerAge(statedAge, mergedAge) : statedAge;
}

/** Story: Keep the age readings of a person and a phone / The phone floor keeps the lowest age that a statement gives (spec/siteEnrollment.md) */
//@ pure
export function floorAgeAfterReading(statedAge: number, mergedAge: number, privateSignup: boolean, typed: boolean): number {
  return privateSignup && typed ? statedAge : floorStatedAge(statedAge, mergedAge);
}

/** Story: Keep the age readings of a person and a phone / The phone floor keeps the lowest age that a statement gives (spec/siteEnrollment.md) */
//@ pure
export function lawFloorNeverRaisesTheStatedAge(statedAge: number, mergedAge: number): boolean {
  //@ ensures \result === true
  return floorStatedAge(statedAge, mergedAge) <= statedAge;
}

/** Story: Keep the age readings of a person and a phone / The phone floor keeps the lowest age that a statement gives (spec/siteEnrollment.md) */
//@ pure
export function lawFloorFollowsALowerMergedAge(statedAge: number, mergedAge: number): boolean {
  //@ ensures \result === true
  return !(memberAge_ageInRange(mergedAge) && mergedAge < statedAge) || floorStatedAge(statedAge, mergedAge) === mergedAge;
}

/** Story: Keep the age readings of a person and a phone / The phone floor keeps the lowest age that a statement gives (spec/siteEnrollment.md) */
//@ pure
export function lawPrivateBrowserAgeNeverBecomesATypedFloor(statedAge: number, mergedAge: number): boolean {
  //@ ensures \result === true
  return floorAgeAfterReading(statedAge, mergedAge, true, true) === statedAge;
}

/** Story: Keep the age readings of a person and a phone / The review of a teen item learns whether the first age reading was a birth date (spec/siteEnrollment.md) */
//@ pure
export function firstReadingExact(hasStored: boolean, storedExact: boolean, hadReading: boolean, statesUsableBirthDate: boolean): boolean {
  return hasStored ? storedExact : !hadReading && statesUsableBirthDate;
}

/** Story: Keep the age readings of a person and a phone / The review of a teen item learns whether the first age reading was a birth date (spec/siteEnrollment.md) */
//@ pure
export function lawAnEarlierReadingIsNeverFirstExact(hadReading: boolean, statesUsableBirthDate: boolean): boolean {
  //@ ensures \result === true
  return !hadReading || !firstReadingExact(false, false, hadReading, statesUsableBirthDate);
}

/** Story: Keep the age readings of a person and a phone / The review of a teen item learns whether the first age reading was a birth date (spec/siteEnrollment.md) */
//@ pure
export function lawTheStoredAnswerNeverChanges(storedExact: boolean, hadReading: boolean, statesUsableBirthDate: boolean): boolean {
  //@ ensures \result === true
  return firstReadingExact(true, storedExact, hadReading, statesUsableBirthDate) === storedExact;
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
  if (event.type === "finishRepair") return canFinishRepair(current);
  if (event.type === "finishJoin") return canFinishJoin(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Enrollment, event: Event): Enrollment {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkAccountView") return canCheckAccountView(current) ? checkAccountView(current, event.viewMatches) : current;
  if (event.type === "decodeProfile") return canDecodeProfile(current) ? decodeProfile(current, event.decoded) : current;
  if (event.type === "confirmConsent") return canConfirmConsent(current) ? confirmConsent(current, event.consentMatches) : current;
  if (event.type === "checkEligibility") return canCheckEligibility(current) ? checkEligibility(current, event.eligible) : current;
  if (event.type === "checkMembership") return canCheckMembership(current) ? checkMembership(current, event.membershipFacts) : current;
  if (event.type === "checkJoinAge") return canCheckJoinAge(current) ? checkJoinAge(current, event.ageEligible, event.memberMissing) : current;
  if (event.type === "finishRepair") return canFinishRepair(current) ? finishRepair(current, event.hookSucceeded) : current;
  if (event.type === "finishJoin") return canFinishJoin(current) ? finishJoin(current, event.hookSucceeded) : current;
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
  const is_MembershipFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.existingMember === "boolean" && typeof v.inviteRequired === "boolean" && typeof v.hasInvite === "boolean" && (v.referral === "NoReferral" || v.referral === "InvalidReferral" || v.referral === "VerifiedReferral");
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "checkAccountView" && typeof raw.viewMatches === "boolean") return { type: "checkAccountView", viewMatches: raw.viewMatches };
  if (raw.type === "decodeProfile" && typeof raw.decoded === "boolean") return { type: "decodeProfile", decoded: raw.decoded };
  if (raw.type === "confirmConsent" && typeof raw.consentMatches === "boolean") return { type: "confirmConsent", consentMatches: raw.consentMatches };
  if (raw.type === "checkEligibility" && typeof raw.eligible === "boolean") return { type: "checkEligibility", eligible: raw.eligible };
  if (raw.type === "checkMembership" && is_MembershipFacts(raw.membershipFacts)) return { type: "checkMembership", membershipFacts: ({ existingMember: raw.membershipFacts.existingMember, inviteRequired: raw.membershipFacts.inviteRequired, hasInvite: raw.membershipFacts.hasInvite, referral: raw.membershipFacts.referral }) };
  if (raw.type === "checkJoinAge" && typeof raw.ageEligible === "boolean" && typeof raw.memberMissing === "boolean") return { type: "checkJoinAge", ageEligible: raw.ageEligible, memberMissing: raw.memberMissing };
  if (raw.type === "finishRepair" && typeof raw.hookSucceeded === "boolean") return { type: "finishRepair", hookSucceeded: raw.hookSucceeded };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingAccountView" || raw.phase === "AccountChanged" || raw.phase === "AwaitingProfile" || raw.phase === "InvalidProfile" || raw.phase === "AwaitingConsent" || raw.phase === "ConsentMismatch" || raw.phase === "AwaitingEligibility" || raw.phase === "NeedsReview" || raw.phase === "AwaitingMembership" || raw.phase === "NeedsInvite" || raw.phase === "InvalidInvitation" || raw.phase === "AwaitingAge" || raw.phase === "BelowJoinAge" || raw.phase === "ReturnExisting" || raw.phase === "AwaitingRepair" || raw.phase === "AwaitingPersistence" || raw.phase === "Created" || raw.phase === "JoinHookFailed") && typeof raw.viewChecked === "boolean" && typeof raw.validProfile === "boolean" && typeof raw.currentConsent === "boolean" && typeof raw.currentEligibility === "boolean" && typeof raw.rejoin === "boolean" && typeof raw.invited === "boolean" && typeof raw.referred === "boolean" && typeof raw.invalidReferral === "boolean" && typeof raw.ageAllowed === "boolean" && Object.keys(raw).length === 10)) return undefined;
  const parsed: Enrollment = ({ phase: raw.phase, viewChecked: raw.viewChecked, validProfile: raw.validProfile, currentConsent: raw.currentConsent, currentEligibility: raw.currentEligibility, rejoin: raw.rejoin, invited: raw.invited, referred: raw.referred, invalidReferral: raw.invalidReferral, ageAllowed: raw.ageAllowed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Enrollment {
  //@ ensures inv(\result)
  return initial;
}
