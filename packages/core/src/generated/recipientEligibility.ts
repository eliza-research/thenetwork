// GENERATED from spec/recipientEligibility.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { unansweredInviteLimit as outreachPolicy_unansweredInviteLimit, reengagementSilenceMs as outreachPolicy_reengagementSilenceMs, reengagementHighValueMs as outreachPolicy_reengagementHighValueMs, reengagementDeliveryPrefix as outreachPolicy_reengagementDeliveryPrefix, personDailyCap as outreachPolicy_personDailyCap, inviteJoinNoticeLifetimeMs as outreachPolicy_inviteJoinNoticeLifetimeMs, unansweredInviteWaitMs as outreachPolicy_unansweredInviteWaitMs, unansweredInviteCountAfterInbound as outreachPolicy_unansweredInviteCountAfterInbound, outreachEngagementSource as outreachPolicy_outreachEngagementSource, reengagementEvidenceCurrent as outreachPolicy_reengagementEvidenceCurrent, outreachRequiresAdult as outreachPolicy_outreachRequiresAdult, inviteJoinNoticeCurrent as outreachPolicy_inviteJoinNoticeCurrent, inviteJoinNoticeMayRideReply as outreachPolicy_inviteJoinNoticeMayRideReply, unansweredInviteCounts as outreachPolicy_unansweredInviteCounts, unansweredInvitePause as outreachPolicy_unansweredInvitePause, lawInvitationCountsAtWait as outreachPolicy_lawInvitationCountsAtWait, lawTooFewInvitationsDoNotPause as outreachPolicy_lawTooFewInvitationsDoNotPause, lawInboundMessageEndsThePause as outreachPolicy_lawInboundMessageEndsThePause, lawAssistantProfileKeepsUnanswered as outreachPolicy_lawAssistantProfileKeepsUnanswered, reengagementMayStage as outreachPolicy_reengagementMayStage, reengagementMayDispatch as outreachPolicy_reengagementMayDispatch, lawRecruitingRequiresAdult as outreachPolicy_lawRecruitingRequiresAdult, lawInviteJoinNoticeNeedsAttribution as outreachPolicy_lawInviteJoinNoticeNeedsAttribution, lawInviteJoinNoticeRequiresMemberTurn as outreachPolicy_lawInviteJoinNoticeRequiresMemberTurn, lawInviteJoinNoticeNeverNamesARole as outreachPolicy_lawInviteJoinNoticeNeverNamesARole, lawUnacceptedInvitationDoesNotCount as outreachPolicy_lawUnacceptedInvitationDoesNotCount, lawInvitationCountsAtTerminalExpiry as outreachPolicy_lawInvitationCountsAtTerminalExpiry, lawReplyStopsPendingReengagement as outreachPolicy_lawReplyStopsPendingReengagement } from "./outreachPolicy.ts";

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export type RecipientVerdict = "RecipientEligible" | "RecipientDeclined" | "RecipientUnknown" | "RecipientOptedOut" | "RecipientAccountRestricted" | "RecipientHeld" | "RecipientOnlyWhenAsked" | "RecipientMinor" | "RecipientOnWatch" | "RecipientBlockedPair" | "RecipientOtherNotMatchable" | "RecipientOtherHeld" | "RecipientOtherOnWatch";
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface RecipientFacts { declined: boolean; known: boolean; optedOut: boolean; accountRestricted: boolean; held: boolean; onlyWhenAsked: boolean; notAdult: boolean; onWatch: boolean }
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface RecipientSend { kind: string; reply: boolean; proactive: boolean; askKind: boolean }
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface OtherParticipantFacts { blocked: boolean; present: boolean; verifiedInvitee: boolean; notAdult: boolean; restricted: boolean; declinedAtJoin: boolean; reportHeld: boolean; watched: boolean }
/** Story: Contact only a member who can get this message now / Quiet hours hold every send that can wait (spec/recipientEligibility.md) */
export type RecipientTiming = "TimingNow" | "TimingLogistics" | "TimingSlot";

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export const okOther: OtherParticipantFacts = { blocked: false, present: true, verifiedInvitee: false, notAdult: false, restricted: false, declinedAtJoin: false, reportHeld: false, watched: false };

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function recipientPassive(send: RecipientSend): boolean {
  return send.reply || send.kind === "safety";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function recipientOwnVerdict(recipient: RecipientFacts, send: RecipientSend): RecipientVerdict {
  const local_0 = outreachPolicy_outreachRequiresAdult(send.kind);
  return recipient.declined ? "RecipientDeclined" : (!recipient.known ? "RecipientUnknown" : (recipient.optedOut ? "RecipientOptedOut" : (recipient.accountRestricted && !recipientPassive(send) ? "RecipientAccountRestricted" : (recipient.held && (local_0 || !recipientPassive(send)) ? "RecipientHeld" : (recipient.onlyWhenAsked && send.kind !== "reengage" && (send.proactive || (send.askKind && !send.reply)) ? "RecipientOnlyWhenAsked" : "RecipientEligible")))));
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawOptedOutIsNeverEligible(kind: string, reply: boolean, proactive: boolean, askKind: boolean, accountRestricted: boolean, held: boolean, onlyWhenAsked: boolean, notAdult: boolean, onWatch: boolean): boolean {
  //@ ensures \result === true
  return recipientOwnVerdict(({ declined: false, known: true, optedOut: true, accountRestricted: accountRestricted, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind } as RecipientSend)) === "RecipientOptedOut";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawDeclinedComesFirst(kind: string, reply: boolean, known: boolean, optedOut: boolean, held: boolean, notAdult: boolean): boolean {
  //@ ensures \result === true
  return recipientOwnVerdict(({ declined: true, known: known, optedOut: optedOut, accountRestricted: false, held: held, onlyWhenAsked: false, notAdult: notAdult, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: false, askKind: false } as RecipientSend)) === "RecipientDeclined";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawHeldGetsNothingAboutAnother(kind: string, reply: boolean, proactive: boolean, askKind: boolean, onlyWhenAsked: boolean): boolean {
  //@ ensures \result === true
  return !outreachPolicy_outreachRequiresAdult(kind) || recipientOwnVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, held: true, onlyWhenAsked: onlyWhenAsked, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind } as RecipientSend)) === "RecipientHeld";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function otherParticipantSkipped(kind: string, other: OtherParticipantFacts): boolean {
  return !other.present && kind === "invite_notice" && !other.declinedAtJoin && other.verifiedInvitee;
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherBlocked(others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => o.blocked);
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function otherParticipantUnmatchable(kind: string, other: OtherParticipantFacts): boolean {
  return !otherParticipantSkipped(kind, other) && (!other.present || other.notAdult || other.restricted || other.declinedAtJoin);
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherHeld(kind: string, others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => !otherParticipantSkipped(kind, o) && o.reportHeld);
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherWatched(kind: string, others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => !otherParticipantSkipped(kind, o) && o.watched);
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherUnmatchable(kind: string, others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => otherParticipantUnmatchable(kind, o));
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function recipientVerdict(recipient: RecipientFacts, send: RecipientSend, others: OtherParticipantFacts[]): RecipientVerdict {
  const local_1: RecipientVerdict = recipientOwnVerdict(recipient, send);
  return local_1 !== "RecipientEligible" ? local_1 : (!outreachPolicy_outreachRequiresAdult(send.kind) ? "RecipientEligible" : (recipient.notAdult ? "RecipientMinor" : (recipient.onWatch ? "RecipientOnWatch" : (anyOtherBlocked(others) ? "RecipientBlockedPair" : (anyOtherUnmatchable(send.kind, others) ? "RecipientOtherNotMatchable" : (anyOtherHeld(send.kind, others) ? "RecipientOtherHeld" : (anyOtherWatched(send.kind, others) ? "RecipientOtherOnWatch" : "RecipientEligible")))))));
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawNotAdultNeverGetsMessageAboutAnother(kind: string, reply: boolean, proactive: boolean, askKind: boolean, held: boolean, onlyWhenAsked: boolean, onWatch: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !outreachPolicy_outreachRequiresAdult(kind) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: true, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawNotAdultOtherIsNeverInMessage(kind: string, reply: boolean, proactive: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && others.some((o: OtherParticipantFacts) => o.notAdult && o.present)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, held: false, onlyWhenAsked: false, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: false } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawBlockedPairIsNeverEligible(kind: string, reply: boolean, proactive: boolean, notAdult: boolean, onWatch: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && anyOtherBlocked(others)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, held: false, onlyWhenAsked: false, notAdult: notAdult, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: false } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawRefusalIsFinal(kind: string, reply: boolean, proactive: boolean, askKind: boolean, declined: boolean, known: boolean, optedOut: boolean, accountRestricted: boolean, held: boolean, onlyWhenAsked: boolean, notAdult: boolean, onWatch: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  const local_2: RecipientFacts = { declined: declined, known: known, optedOut: optedOut, accountRestricted: accountRestricted, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch };
  const local_3: RecipientSend = { kind: kind, reply: reply, proactive: proactive, askKind: askKind };
  return !(recipientOwnVerdict(local_2, local_3) !== "RecipientEligible") || recipientVerdict(local_2, local_3, others) === recipientOwnVerdict(local_2, local_3);
}

/** Story: Contact only a member who can get this message now / The refusal reason names the failed check (spec/recipientEligibility.md) */
//@ pure
export function recipientRefusalReason(verdict: RecipientVerdict): string {
  return verdict === "RecipientEligible" ? "" : verdict === "RecipientDeclined" ? "declined" : verdict === "RecipientUnknown" ? "unknown_member" : verdict === "RecipientOptedOut" ? "opted_out" : verdict === "RecipientAccountRestricted" ? "account" : verdict === "RecipientHeld" ? "held" : verdict === "RecipientOnlyWhenAsked" ? "only_when_asked" : verdict === "RecipientMinor" ? "minor" : verdict === "RecipientOnWatch" ? "on_watch" : verdict === "RecipientBlockedPair" ? "blocked_pair" : verdict === "RecipientOtherNotMatchable" ? "other_not_matchable" : verdict === "RecipientOtherHeld" ? "other_held" : "other_on_watch";
}

/** Story: Contact only a member who can get this message now / The refusal reason names the failed check (spec/recipientEligibility.md) */
//@ pure
export function lawOnlyEligibleHasNoReason(verdict: RecipientVerdict): boolean {
  //@ ensures \result === true
  return (recipientRefusalReason(verdict) === "") === (verdict === "RecipientEligible");
}

/** Story: Contact only a member who can get this message now / Quiet hours hold every send that can wait (spec/recipientEligibility.md) */
//@ pure
export function recipientTimingAllowed(timing: RecipientTiming, quiet: boolean, inWindow: boolean): boolean {
  return timing === "TimingNow" || (!quiet && (timing === "TimingLogistics" || inWindow));
}

/** Story: Contact only a member who can get this message now / Quiet hours hold every send that can wait (spec/recipientEligibility.md) */
//@ pure
export function lawQuietHoursHoldEveryWaitingSend(timing: RecipientTiming, inWindow: boolean): boolean {
  //@ ensures \result === true
  return !(timing !== "TimingNow") || !recipientTimingAllowed(timing, true, inWindow);
}

/** Story: Contact only a member who can get this message now / Quiet hours hold every send that can wait (spec/recipientEligibility.md) */
//@ pure
export function lawInterruptionNeedsWindow(quiet: boolean): boolean {
  //@ ensures \result === true
  return !recipientTimingAllowed("TimingSlot", quiet, false);
}
