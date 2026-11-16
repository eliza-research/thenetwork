// GENERATED from spec/memberInvitation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
export const memberInviteWindowMs: number = 2592000000;
/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
export const defaultMemberInviteCapacity: number = 3;

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function memberInviteUsesAllowance(status: string): boolean {
  return status === "issued" || status === "review";
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function memberInviteWithinWindow(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < memberInviteWindowMs;
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function memberMayRequestInvite(adult: boolean, accountEligible: boolean, consents: boolean, clearOfHolds: boolean, now: number, invitesBlockedUntil: number, used: number, limit: number): boolean {
  return adult && accountEligible && consents && clearOfHolds && now >= invitesBlockedUntil && used >= 0 && used < limit;
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function memberInviteRelationshipKnown(relationship: string): boolean {
  return relationship === "friend" || relationship === "coworker" || relationship === "roommate" || relationship === "family";
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function lawMemberInviteNeedsAdult(accountEligible: boolean, consents: boolean, clearOfHolds: boolean, now: number, invitesBlockedUntil: number, used: number, limit: number): boolean {
  //@ ensures \result === true
  return !memberMayRequestInvite(false, accountEligible, consents, clearOfHolds, now, invitesBlockedUntil, used, limit);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function lawUnavailableMemberInviteDoesNotSpend(status: string): boolean {
  //@ ensures \result === true
  return !(status === "unavailable") || !memberInviteUsesAllowance(status);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function memberInviteCanIssue(directMemberRequest: boolean, eligible: boolean, relationship: string): boolean {
  return directMemberRequest && eligible && memberInviteRelationshipKnown(relationship);
}

/** Story: Forward an invitation for someone I know / A direct named vouch can use the adult member's allowance (spec/memberInvitation.md:7) */
//@ pure
export function lawMemberInviteNeedsDirectRequest(eligible: boolean, relationship: string): boolean {
  //@ ensures \result === true
  return !memberInviteCanIssue(false, eligible, relationship);
}

/** Story: Forward an invitation for someone I know / The link goes to the inviter as a reply (spec/memberInvitation.md:40) */
//@ pure
export function memberInviteLinkCanBeShared(directMemberReply: boolean, issuedLink: boolean, appOwnedLink: boolean, presentOnce: boolean): boolean {
  return directMemberReply && issuedLink && appOwnedLink && presentOnce;
}

/** Story: Forward an invitation for someone I know / The link goes to the inviter as a reply (spec/memberInvitation.md:40) */
//@ pure
export function lawMemberInviteLinkNeedsDirectReply(issuedLink: boolean, appOwnedLink: boolean, presentOnce: boolean): boolean {
  //@ ensures \result === true
  return !memberInviteLinkCanBeShared(false, issuedLink, appOwnedLink, presentOnce);
}

/** Story: Forward an invitation for someone I know / A new verified acceptance can be attributed (spec/memberInvitation.md:52) */
//@ pure
export function memberInviteCanAttribute(freshJoin: boolean, trustedAcceptance: boolean, inviterMatches: boolean): boolean {
  return freshJoin && trustedAcceptance && inviterMatches;
}

/** Story: Forward an invitation for someone I know / A new verified acceptance can be attributed (spec/memberInvitation.md:52) */
//@ pure
export function lawOldMemberInviteCannotBeAttributed(trustedAcceptance: boolean, inviterMatches: boolean): boolean {
  //@ ensures \result === true
  return !memberInviteCanAttribute(false, trustedAcceptance, inviterMatches);
}
