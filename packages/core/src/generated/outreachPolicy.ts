// GENERATED from spec/outreachPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { maxOpenings as postingPolicy_maxOpenings, confirmPosting as postingPolicy_confirmPosting, postingDraftCurrent as postingPolicy_postingDraftCurrent, missingPostingFields as postingPolicy_missingPostingFields, openingsInRange as postingPolicy_openingsInRange, payRangeAllowed as postingPolicy_payRangeAllowed, inboundMayCommand as postingPolicy_inboundMayCommand, lawEditedPostingNeedsReadback as postingPolicy_lawEditedPostingNeedsReadback, lawStalePostingCannotBeConfirmed as postingPolicy_lawStalePostingCannotBeConfirmed, lawClosedPostingIsNeverCurrent as postingPolicy_lawClosedPostingIsNeverCurrent, lawAssistantProfileNeverCommands as postingPolicy_lawAssistantProfileNeverCommands, lawChangedPostingIsNeverCurrent as postingPolicy_lawChangedPostingIsNeverCurrent, lawNewDraftNeverOverwrites as postingPolicy_lawNewDraftNeverOverwrites, lawPayRangeIsOrdered as postingPolicy_lawPayRangeIsOrdered } from "./postingPolicy.ts";


/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
export const unansweredInviteWaitMs: number = exact_outreachPolicy(72 * 3600000);
/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
export const unansweredInviteLimit: number = 2;
/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
export const reengagementSilenceMs: number = exact_outreachPolicy(30 * 86400000);
/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
export const reengagementHighValueMs: number = exact_outreachPolicy(7 * 86400000);
/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
export const reengagementDeliveryPrefix: string = "reengagement:";
/** Story: Limit unsolicited messages across apps / The default daily proactive limit is three across all apps (spec/outreachPolicy.md) */
export const personDailyCap: number = 3;
/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
export const inviteJoinNoticeLifetimeMs: number = 2592000000;
/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
export const inviteBudgetDayMs: number = 86400000;

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function initialInviteInBudgetWindow(sentAt: number, now: number, budgetWindowDays: number): boolean {
  return exact_outreachPolicy(now - sentAt) < exact_outreachPolicy(budgetWindowDays * inviteBudgetDayMs);
}

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function initialInviteBudgetSpent(sentInBudgetWindow: number, budgetLimit: number): boolean {
  return sentInBudgetWindow >= budgetLimit;
}

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function lawInvitationJustSentCounts(sentAt: number, budgetWindowDays: number): boolean {
  //@ ensures \result === true
  return !(budgetWindowDays > 0) || initialInviteInBudgetWindow(sentAt, sentAt, budgetWindowDays);
}

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function lawZeroBudgetIsAlwaysSpent(sentInBudgetWindow: number): boolean {
  //@ ensures \result === true
  return !(sentInBudgetWindow >= 0) || initialInviteBudgetSpent(sentInBudgetWindow, 0);
}

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function lawBudgetBelowLimitIsOpen(sentInBudgetWindow: number, budgetLimit: number): boolean {
  //@ ensures \result === true
  return !(sentInBudgetWindow < budgetLimit) || !initialInviteBudgetSpent(sentInBudgetWindow, budgetLimit);
}

/** Story: Limit unsolicited messages across apps / An initial invitation fits the member's participation state budget (spec/outreachPolicy.md) */
//@ pure
export function lawInvitationAtWindowEdgeLeavesTheWindow(sentAt: number, budgetWindowDays: number): boolean {
  //@ ensures \result === true
  return !initialInviteInBudgetWindow(sentAt, exact_outreachPolicy(sentAt + exact_outreachPolicy(budgetWindowDays * inviteBudgetDayMs)), budgetWindowDays);
}

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
export function unansweredInviteCountAfterInbound(count: number, inbound: boolean): number {
  return inbound ? 0 : count;
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
export function lawInboundMessageEndsThePause(count: number): boolean {
  //@ ensures \result === true
  return !unansweredInvitePause(unansweredInviteCountAfterInbound(count, postingPolicy_inboundMayCommand("thread")));
}

/** Story: Pause new offers after two unanswered invitations / Count a sent invitation at terminal expiry or after 72 hours (spec/outreachPolicy.md) */
//@ pure
export function lawAssistantProfileKeepsUnanswered(count: number): boolean {
  //@ ensures \result === true
  return unansweredInviteCountAfterInbound(count, postingPolicy_inboundMayCommand("mcp")) === count;
}

/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
//@ pure
export function reengagementEvidenceCurrent(onlyWhenAsked: boolean, heldHighAt: number, now: number): boolean {
  return onlyWhenAsked && heldHighAt > 0 && heldHighAt <= now && exact_outreachPolicy(now - heldHighAt) <= reengagementHighValueMs;
}

/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
//@ pure
export function reengagementMayStage(onlyWhenAsked: boolean, lastInbound: number, lastAsk: number, heldHighAt: number, now: number): boolean {
  return reengagementEvidenceCurrent(onlyWhenAsked, heldHighAt, now) && exact_outreachPolicy(now - lastInbound) >= reengagementSilenceMs && exact_outreachPolicy(now - lastAsk) >= reengagementSilenceMs;
}

/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
//@ pure
export function reengagementMayDispatch(onlyWhenAsked: boolean, used: boolean, lastInbound: number, lastAsk: number, heldHighAt: number, stagedAt: number, now: number): boolean {
  return reengagementEvidenceCurrent(onlyWhenAsked, heldHighAt, now) && used && stagedAt <= now && lastAsk === stagedAt && exact_outreachPolicy(stagedAt - lastInbound) >= reengagementSilenceMs;
}

/** Story: Pause new offers after two unanswered invitations / Re-engagement requires current evidence of silence (spec/outreachPolicy.md) */
//@ pure
export function lawReplyStopsPendingReengagement(onlyWhenAsked: boolean, used: boolean, lastInbound: number, lastAsk: number, heldHighAt: number, stagedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(lastInbound >= stagedAt) || !reengagementMayDispatch(onlyWhenAsked, used, lastInbound, lastAsk, heldHighAt, stagedAt, now);
}

/** Story: Keep minors out of introductions and recruiting / Recruiting is an adult-only message at the time it is sent (spec/outreachPolicy.md) */
//@ pure
export function outreachRequiresAdult(kind: string): boolean {
  return kind === "probe" || kind === "reveal" || kind === "nudge" || kind === "scheduling" || kind === "reminder" || kind === "feedback" || kind === "relay" || kind === "growth" || kind === "invite_notice" || kind === "home_help_consent" || kind === "worthwhile" || kind === "reengage";
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
export function inviteJoinNoticeMayRideReply(directMemberTurn: boolean, reply: boolean, carriesMemberText: boolean, inviteeHasRole: boolean): boolean {
  return directMemberTurn && reply && !carriesMemberText && !inviteeHasRole;
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function lawInviteJoinNoticeNeedsAttribution(inviteeConsents: boolean, bothEligible: boolean, ageMs: number): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeCurrent(false, inviteeConsents, bothEligible, ageMs);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function lawInviteJoinNoticeRequiresMemberTurn(reply: boolean, carriesMemberText: boolean, inviteeHasRole: boolean): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeMayRideReply(false, reply, carriesMemberText, inviteeHasRole);
}

/** Story: Hear when someone I invited joins / An eligible join receipt can ride on a current reply (spec/outreachPolicy.md) */
//@ pure
export function lawInviteJoinNoticeNeverNamesARole(directMemberTurn: boolean, reply: boolean, carriesMemberText: boolean): boolean {
  //@ ensures \result === true
  return !inviteJoinNoticeMayRideReply(directMemberTurn, reply, carriesMemberText, true);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_outreachPolicy(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
