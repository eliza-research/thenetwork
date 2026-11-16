// GENERATED from spec/invitationJoinProjection.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Hear when someone I invited joins in another city / The invitee's conversation owns its welcome (spec/invitationJoinProjection.md:7) */
//@ pure
export function projectInvitationWelcome(verifiedJoin: boolean, ownsInvitee: boolean, welcomeProjected: boolean): boolean {
  return verifiedJoin && ownsInvitee && !welcomeProjected;
}

/** Story: Hear when someone I invited joins in another city / The invitee's conversation owns its welcome (spec/invitationJoinProjection.md:7) */
//@ pure
export function lawInvitationWelcomeRequiresOwner(verifiedJoin: boolean, welcomeProjected: boolean): boolean {
  //@ ensures \result === true
  return !projectInvitationWelcome(verifiedJoin, false, welcomeProjected);
}

/** Story: Hear when someone I invited joins in another city / The inviter's conversation owns a notice after the welcome (spec/invitationJoinProjection.md:19) */
//@ pure
export function projectRemoteInvitationNotice(verifiedJoin: boolean, ownsInviter: boolean, welcomeProjected: boolean, noticeProjected: boolean): boolean {
  return verifiedJoin && ownsInviter && welcomeProjected && !noticeProjected;
}

/** Story: Hear when someone I invited joins in another city / The inviter's conversation owns a notice after the welcome (spec/invitationJoinProjection.md:19) */
//@ pure
export function lawInvitationNoticeRequiresWelcome(verifiedJoin: boolean, ownsInviter: boolean, noticeProjected: boolean): boolean {
  //@ ensures \result === true
  return !projectRemoteInvitationNotice(verifiedJoin, ownsInviter, false, noticeProjected);
}

/** Story: Hear when someone I invited joins in another city / The inviter's conversation owns a notice after the welcome (spec/invitationJoinProjection.md:19) */
//@ pure
export function lawInvitationNoticeCannotProjectTwice(verifiedJoin: boolean, ownsInviter: boolean, welcomeProjected: boolean): boolean {
  //@ ensures \result === true
  return !projectRemoteInvitationNotice(verifiedJoin, ownsInviter, welcomeProjected, true);
}
