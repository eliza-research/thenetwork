// GENERATED from spec/outreachPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Limit unsolicited messages across apps / The default daily proactive limit is three across all apps (spec/outreachPolicy.md:7) */
export const personDailyCap: number = 3;
/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md:36) */
export const inviteJoinNoticeLifetimeMs: number = 2592000000;

/** Story: Keep minors out of introductions and recruiting / Recruiting is an adult-only message at the time it is sent (spec/outreachPolicy.md:19) */
//@ pure
export function outreachRequiresAdult(kind: string): boolean {
  return kind === "probe" || kind === "reveal" || kind === "nudge" || kind === "scheduling" || kind === "reminder" || kind === "feedback" || kind === "relay" || kind === "growth" || kind === "invite_notice";
}

/** Story: Keep minors out of introductions and recruiting / Recruiting is an adult-only message at the time it is sent (spec/outreachPolicy.md:19) */
//@ pure
export function lawRecruitingRequiresAdult(kind: string): boolean {
  //@ ensures \result === true
  return !(kind === "growth") || outreachRequiresAdult(kind);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md:36) */
//@ pure
export function inviteJoinNoticeCurrent(attributed: boolean, inviteeConsents: boolean, bothEligible: boolean, ageMs: number): boolean {
  return attributed && inviteeConsents && bothEligible && ageMs >= 0 && ageMs < inviteJoinNoticeLifetimeMs;
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md:36) */
//@ pure
export function inviteJoinNoticeMayRideReply(directMemberTurn: boolean, reply: boolean, carriesMemberText: boolean): boolean {
  return directMemberTurn && reply && !carriesMemberText;
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md:36) */
//@ pure
export function lawInviteJoinNoticeNeedsAttribution(inviteeConsents: boolean, bothEligible: boolean, ageMs: number): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeCurrent(false, inviteeConsents, bothEligible, ageMs);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md:36) */
//@ pure
export function lawInviteJoinNoticeRequiresMemberTurn(reply: boolean, carriesMemberText: boolean): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeMayRideReply(false, reply, carriesMemberText);
}
