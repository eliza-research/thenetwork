// GENERATED from spec/memberInvitation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
export const memberInviteDraftMs: number = 900000;
/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
export const memberInviteMaxMonths: number = 1500;
/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
export const memberInviteBurstWindowMs: number = 86400000;
/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
export const memberInviteBurstPriorCount: number = 2;
/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
export const memberInviteWindowMs: number = 2592000000;
/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
export const defaultMemberInviteCapacity: number = 3;

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberInviteUsesAllowance(status: string): boolean {
  return status === "issued" || status === "review";
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberInviteWithinWindow(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < memberInviteWindowMs;
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberInviteSourceCurrent(adult: boolean, accountEligible: boolean, consents: boolean, clearOfHolds: boolean, now: number, invitesBlockedUntil: number): boolean {
  return adult && accountEligible && consents && clearOfHolds && now >= invitesBlockedUntil;
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberInviteRelationshipKnown(relationship: string): boolean {
  return relationship === "friend" || relationship === "coworker" || relationship === "roommate" || relationship === "family";
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberInviteCanIssue(directMemberRequest: boolean, eligible: boolean, relationship: string): boolean {
  return directMemberRequest && eligible && memberInviteRelationshipKnown(relationship);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function lawUnavailableMemberInviteDoesNotSpend(status: string): boolean {
  //@ ensures \result === true
  return !(status === "unavailable") || !memberInviteUsesAllowance(status);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function memberMayRequestInvite(adult: boolean, accountEligible: boolean, consents: boolean, clearOfHolds: boolean, now: number, invitesBlockedUntil: number, used: number, limit: number): boolean {
  return memberInviteSourceCurrent(adult, accountEligible, consents, clearOfHolds, now, invitesBlockedUntil) && used >= 0 && used < limit;
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function lawMemberInviteNeedsAdult(accountEligible: boolean, consents: boolean, clearOfHolds: boolean, now: number, invitesBlockedUntil: number, used: number, limit: number): boolean {
  //@ ensures \result === true
  return !memberMayRequestInvite(false, accountEligible, consents, clearOfHolds, now, invitesBlockedUntil, used, limit);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md) */
//@ pure
export function lawMemberInviteNeedsDirectRequest(eligible: boolean, relationship: string): boolean {
  //@ ensures \result === true
  return !memberInviteCanIssue(false, eligible, relationship);
}

/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
//@ pure
export function memberInviteDraftCurrent(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < memberInviteDraftMs;
}

/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
//@ pure
export function memberInviteEvidenceValid(durationMonths: number, depth: string): boolean {
  return durationMonths >= 0 && durationMonths <= memberInviteMaxMonths && (depth === "met_once" || depth === "somewhat" || depth === "well");
}

/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
//@ pure
export function memberInviteConfirmationReady(direct: boolean, draftCurrent: boolean, evidenceValid: boolean, explicitlyConfirmed: boolean): boolean {
  return direct && draftCurrent && evidenceValid && explicitlyConfirmed;
}

/** Story: Forward an invitation for someone I know / Confirm private relationship evidence before issuance (spec/memberInvitation.md) */
//@ pure
export function lawMemberInviteRequiresConfirmation(direct: boolean, draftCurrent: boolean, evidenceValid: boolean): boolean {
  //@ ensures \result === true
  return !memberInviteConfirmationReady(direct, draftCurrent, evidenceValid, false);
}

/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
//@ pure
export function memberInviteWithinBurstWindow(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < memberInviteBurstWindowMs;
}

/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
//@ pure
export function memberInviteVouchWeak(durationMonths: number, depth: string): boolean {
  return durationMonths < 1 || depth === "met_once";
}

/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
//@ pure
export function memberInviteBurst(priorCount: number): boolean {
  return priorCount >= memberInviteBurstPriorCount;
}

/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
//@ pure
export function memberInviteNeedsReview(weak: boolean, burst: boolean, riskLanguage: boolean): boolean {
  return weak || burst || riskLanguage;
}

/** Story: Forward an invitation for someone I know / Hold weak or unusual invitations for staff (spec/memberInvitation.md) */
//@ pure
export function lawUnusualMemberInviteRequiresReview(weak: boolean, burst: boolean, riskLanguage: boolean): boolean {
  //@ ensures \result === true
  return !(weak || burst || riskLanguage) || memberInviteNeedsReview(weak, burst, riskLanguage);
}

/** Story: Forward an invitation for someone I know / The link goes to the inviter as a reply (spec/memberInvitation.md) */
//@ pure
export function memberInviteLinkCanBeShared(directMemberReply: boolean, issuedLink: boolean, appOwnedLink: boolean, presentOnce: boolean): boolean {
  return directMemberReply && issuedLink && appOwnedLink && presentOnce;
}

/** Story: Forward an invitation for someone I know / The link goes to the inviter as a reply (spec/memberInvitation.md) */
//@ pure
export function lawMemberInviteLinkNeedsDirectReply(issuedLink: boolean, appOwnedLink: boolean, presentOnce: boolean): boolean {
  //@ ensures \result === true
  return !memberInviteLinkCanBeShared(false, issuedLink, appOwnedLink, presentOnce);
}

/** Story: Forward an invitation for someone I know / A new verified acceptance can be attributed (spec/memberInvitation.md) */
//@ pure
export function memberInviteCanAttribute(freshJoin: boolean, trustedAcceptance: boolean, inviterMatches: boolean): boolean {
  return freshJoin && trustedAcceptance && inviterMatches;
}

/** Story: Forward an invitation for someone I know / A new verified acceptance can be attributed (spec/memberInvitation.md) */
//@ pure
export function lawOldMemberInviteCannotBeAttributed(trustedAcceptance: boolean, inviterMatches: boolean): boolean {
  //@ ensures \result === true
  return !memberInviteCanAttribute(false, trustedAcceptance, inviterMatches);
}
