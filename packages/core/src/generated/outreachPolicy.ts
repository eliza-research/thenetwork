// GENERATED from spec/outreachPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
export const unansweredInviteLimit: number = 2;
/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
export const inviteJoinNoticeLifetimeMs: number = 2592000000;
/** Story: Limit unsolicited messages across apps / The default daily proactive limit is three across all apps (spec/outreachPolicy.md) */
export const personDailyCap: number = 3;
/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
export const unansweredInviteWaitMs: number = exact_outreachPolicy(72 * 3600000);

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function unansweredInviteCounts(accepted: boolean, acceptedAt: number, expired: boolean, expiredAt: number, now: number): boolean {
  return accepted && acceptedAt <= now && ((expired && acceptedAt <= expiredAt && expiredAt <= now) || exact_outreachPolicy(now - acceptedAt) >= unansweredInviteWaitMs);
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function unansweredInvitePause(count: number): boolean {
  return count >= unansweredInviteLimit;
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function lawInvitationCountsAtWait(acceptedAt: number): boolean {
  //@ ensures \result === true
  return unansweredInviteCounts(true, acceptedAt, false, 0, exact_outreachPolicy(acceptedAt + unansweredInviteWaitMs));
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function lawTooFewInvitationsDoNotPause(count: number): boolean {
  //@ ensures \result === true
  return !(count < unansweredInviteLimit) || !unansweredInvitePause(count);
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function lawUnacceptedInvitationDoesNotCount(acceptedAt: number, expired: boolean, expiredAt: number, now: number): boolean {
  //@ ensures \result === true
  return !unansweredInviteCounts(false, acceptedAt, expired, expiredAt, now);
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function lawInvitationCountsAtTerminalExpiry(acceptedAt: number, expiredAt: number): boolean {
  //@ ensures \result === true
  return !(acceptedAt <= expiredAt) || unansweredInviteCounts(true, acceptedAt, true, expiredAt, expiredAt);
}

/** Story: Keep minors out of introductions and recruiting / Recruiting is an adult-only message at the time it is sent (spec/outreachPolicy.md) */
//@ pure
export function outreachRequiresAdult(kind: string): boolean {
  return kind === "probe" || kind === "reveal" || kind === "nudge" || kind === "scheduling" || kind === "reminder" || kind === "feedback" || kind === "relay" || kind === "growth" || kind === "invite_notice" || kind === "home_help_consent" || kind === "worthwhile";
}

/** Story: Keep minors out of introductions and recruiting / Recruiting is an adult-only message at the time it is sent (spec/outreachPolicy.md) */
//@ pure
export function lawRecruitingRequiresAdult(kind: string): boolean {
  //@ ensures \result === true
  return !(kind === "growth") || outreachRequiresAdult(kind);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function inviteJoinNoticeCurrent(attributed: boolean, inviteeConsents: boolean, bothEligible: boolean, ageMs: number): boolean {
  return attributed && inviteeConsents && bothEligible && ageMs >= 0 && ageMs < inviteJoinNoticeLifetimeMs;
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function inviteJoinNoticeMayRideReply(directMemberTurn: boolean, reply: boolean, carriesMemberText: boolean): boolean {
  return directMemberTurn && reply && !carriesMemberText;
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function lawInviteJoinNoticeNeedsAttribution(inviteeConsents: boolean, bothEligible: boolean, ageMs: number): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeCurrent(false, inviteeConsents, bothEligible, ageMs);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function lawInviteJoinNoticeRequiresMemberTurn(reply: boolean, carriesMemberText: boolean): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeMayRideReply(false, reply, carriesMemberText);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_outreachPolicy(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
