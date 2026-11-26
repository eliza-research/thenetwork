// GENERATED from spec/recipientEligibility.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { personDailyCap as outreachPolicy_personDailyCap, inviteBudgetDayMs as outreachPolicy_inviteBudgetDayMs, initialInviteInBudgetWindow as outreachPolicy_initialInviteInBudgetWindow, initialInviteBudgetSpent as outreachPolicy_initialInviteBudgetSpent, lawZeroBudgetIsAlwaysSpent as outreachPolicy_lawZeroBudgetIsAlwaysSpent, lawBudgetBelowLimitIsOpen as outreachPolicy_lawBudgetBelowLimitIsOpen, lawInvitationAtWindowEdgeLeavesTheWindow as outreachPolicy_lawInvitationAtWindowEdgeLeavesTheWindow, lawInvitationJustSentCounts as outreachPolicy_lawInvitationJustSentCounts, unansweredInviteWaitMs as outreachPolicy_unansweredInviteWaitMs, unansweredInviteLimit as outreachPolicy_unansweredInviteLimit, unansweredInviteCounts as outreachPolicy_unansweredInviteCounts, unansweredInvitePause as outreachPolicy_unansweredInvitePause, lawUnacceptedInvitationDoesNotCount as outreachPolicy_lawUnacceptedInvitationDoesNotCount, lawInvitationCountsAtTerminalExpiry as outreachPolicy_lawInvitationCountsAtTerminalExpiry, lawInvitationCountsAtWait as outreachPolicy_lawInvitationCountsAtWait, lawTooFewInvitationsDoNotPause as outreachPolicy_lawTooFewInvitationsDoNotPause, unansweredInviteCountAfterInbound as outreachPolicy_unansweredInviteCountAfterInbound, lawInboundMessageEndsThePause as outreachPolicy_lawInboundMessageEndsThePause, lawAssistantProfileKeepsUnanswered as outreachPolicy_lawAssistantProfileKeepsUnanswered, reengagementSilenceMs as outreachPolicy_reengagementSilenceMs, reengagementHighValueMs as outreachPolicy_reengagementHighValueMs, reengagementDeliveryPrefix as outreachPolicy_reengagementDeliveryPrefix, reengagementEvidenceCurrent as outreachPolicy_reengagementEvidenceCurrent, reengagementMayStage as outreachPolicy_reengagementMayStage, reengagementMayDispatch as outreachPolicy_reengagementMayDispatch, lawReplyStopsPendingReengagement as outreachPolicy_lawReplyStopsPendingReengagement, outreachRequiresAdult as outreachPolicy_outreachRequiresAdult, outreachTeenItemKind as outreachPolicy_outreachTeenItemKind, lawRecruitingRequiresAdult as outreachPolicy_lawRecruitingRequiresAdult, lawRecruitingIsNeverATeenItemKind as outreachPolicy_lawRecruitingIsNeverATeenItemKind, inviteJoinNoticeLifetimeMs as outreachPolicy_inviteJoinNoticeLifetimeMs, inviteJoinNoticeCurrent as outreachPolicy_inviteJoinNoticeCurrent, inviteJoinNoticeConflictsWithRole as outreachPolicy_inviteJoinNoticeConflictsWithRole, lawInviteJoinNoticeWaitsForNamesake as outreachPolicy_lawInviteJoinNoticeWaitsForNamesake, inviteJoinNoticeMayRideReply as outreachPolicy_inviteJoinNoticeMayRideReply, lawInviteJoinNoticeNeedsAttribution as outreachPolicy_lawInviteJoinNoticeNeedsAttribution, lawInviteJoinNoticeRequiresMemberTurn as outreachPolicy_lawInviteJoinNoticeRequiresMemberTurn, lawInviteJoinNoticeNeverNamesARole as outreachPolicy_lawInviteJoinNoticeNeverNamesARole } from "./outreachPolicy.ts";

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export type RecipientVerdict = "RecipientEligible" | "RecipientDeclined" | "RecipientUnknown" | "RecipientOptedOut" | "RecipientAccountRestricted" | "RecipientMatchingNotActive" | "RecipientHeld" | "RecipientOnlyWhenAsked" | "RecipientMinor" | "RecipientOnWatch" | "RecipientBlockedPair" | "RecipientOtherNotMatchable" | "RecipientOtherHeld" | "RecipientOtherOnWatch";
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface RecipientFacts { declined: boolean; known: boolean; optedOut: boolean; accountRestricted: boolean; matchingStopped: boolean; held: boolean; onlyWhenAsked: boolean; notAdult: boolean; onWatch: boolean }
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface RecipientSend { kind: string; reply: boolean; proactive: boolean; askKind: boolean; teenItem: boolean }
/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export interface OtherParticipantFacts { blocked: boolean; avoided: boolean; present: boolean; verifiedInvitee: boolean; notAdult: boolean; restricted: boolean; matchingStopped: boolean; declinedAtJoin: boolean; reportHeld: boolean; watched: boolean }
/** Story: Contact only a member who can get this message now / Quiet hours hold every send that can wait (spec/recipientEligibility.md) */
export type RecipientTiming = "TimingNow" | "TimingLogistics" | "TimingSlot";

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
export const okOther: OtherParticipantFacts = { blocked: false, avoided: false, present: true, verifiedInvitee: false, notAdult: false, restricted: false, matchingStopped: false, declinedAtJoin: false, reportHeld: false, watched: false };

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function recipientPassive(send: RecipientSend): boolean {
  return send.reply || send.kind === "safety";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function recipientOwnVerdict(recipient: RecipientFacts, send: RecipientSend): RecipientVerdict {
  const local_0 = outreachPolicy_outreachRequiresAdult(send.kind);
  return recipient.declined ? "RecipientDeclined" : (!recipient.known ? "RecipientUnknown" : (recipient.optedOut ? "RecipientOptedOut" : (recipient.accountRestricted && !recipientPassive(send) ? "RecipientAccountRestricted" : (send.kind === "probe" && recipient.matchingStopped ? "RecipientMatchingNotActive" : (recipient.held && (local_0 || !recipientPassive(send)) ? "RecipientHeld" : (recipient.onlyWhenAsked && send.kind !== "reengage" && (send.proactive || (send.askKind && !send.reply)) ? "RecipientOnlyWhenAsked" : "RecipientEligible"))))));
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawOptedOutIsNeverEligible(kind: string, reply: boolean, proactive: boolean, askKind: boolean, accountRestricted: boolean, held: boolean, onlyWhenAsked: boolean, notAdult: boolean, onWatch: boolean): boolean {
  //@ ensures \result === true
  return recipientOwnVerdict(({ declined: false, known: true, optedOut: true, accountRestricted: accountRestricted, matchingStopped: false, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false } as RecipientSend)) === "RecipientOptedOut";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawDeclinedComesFirst(kind: string, reply: boolean, known: boolean, optedOut: boolean, held: boolean, notAdult: boolean): boolean {
  //@ ensures \result === true
  return recipientOwnVerdict(({ declined: true, known: known, optedOut: optedOut, accountRestricted: false, matchingStopped: false, held: held, onlyWhenAsked: false, notAdult: notAdult, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: false, askKind: false, teenItem: false } as RecipientSend)) === "RecipientDeclined";
}

/** Story: Contact only a member who can get this message now / Check the recipient's own state in a fixed order (spec/recipientEligibility.md) */
//@ pure
export function lawHeldGetsNothingAboutAnother(kind: string, reply: boolean, proactive: boolean, askKind: boolean, onlyWhenAsked: boolean): boolean {
  //@ ensures \result === true
  return !outreachPolicy_outreachRequiresAdult(kind) || recipientOwnVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: true, onlyWhenAsked: onlyWhenAsked, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false } as RecipientSend)) === "RecipientHeld";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function otherParticipantSkipped(kind: string, other: OtherParticipantFacts): boolean {
  return !other.present && kind === "invite_notice" && !other.declinedAtJoin && other.verifiedInvitee;
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function recipientAgeExempt(send: RecipientSend): boolean {
  return send.teenItem && outreachPolicy_outreachTeenItemKind(send.kind);
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function otherParticipantUnmatchable(send: RecipientSend, other: OtherParticipantFacts): boolean {
  return !otherParticipantSkipped(send.kind, other) && (!other.present || (other.notAdult && !recipientAgeExempt(send)) || other.restricted || other.declinedAtJoin || (send.kind === "probe" && other.matchingStopped));
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherBlocked(kind: string, others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => o.blocked || (kind === "probe" && o.avoided));
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function anyOtherUnmatchable(send: RecipientSend, others: OtherParticipantFacts[]): boolean {
  return others.some((o: OtherParticipantFacts) => otherParticipantUnmatchable(send, o));
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
export function recipientVerdict(recipient: RecipientFacts, send: RecipientSend, others: OtherParticipantFacts[]): RecipientVerdict {
  const local_1: RecipientVerdict = recipientOwnVerdict(recipient, send);
  return local_1 !== "RecipientEligible" ? local_1 : (!outreachPolicy_outreachRequiresAdult(send.kind) ? "RecipientEligible" : (recipient.notAdult && !recipientAgeExempt(send) ? "RecipientMinor" : (recipient.onWatch ? "RecipientOnWatch" : (anyOtherBlocked(send.kind, others) ? "RecipientBlockedPair" : (anyOtherUnmatchable(send, others) ? "RecipientOtherNotMatchable" : (anyOtherHeld(send.kind, others) ? "RecipientOtherHeld" : (anyOtherWatched(send.kind, others) ? "RecipientOtherOnWatch" : "RecipientEligible")))))));
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawNotAdultNeverGetsMessageAboutAnother(kind: string, reply: boolean, proactive: boolean, askKind: boolean, held: boolean, onlyWhenAsked: boolean, onWatch: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !outreachPolicy_outreachRequiresAdult(kind) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: true, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawNotAdultOtherIsNeverInMessage(kind: string, reply: boolean, proactive: boolean, teenItem: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && !(teenItem && outreachPolicy_outreachTeenItemKind(kind)) && others.some((o: OtherParticipantFacts) => o.notAdult && o.present)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false, onlyWhenAsked: false, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: false, teenItem: teenItem } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawBlockedPairIsNeverEligible(kind: string, reply: boolean, proactive: boolean, notAdult: boolean, onWatch: boolean, teenItem: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && anyOtherBlocked(kind, others)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false, onlyWhenAsked: false, notAdult: notAdult, onWatch: onWatch } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: false, teenItem: teenItem } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawAdultOnlyKindNeverReachesMinor(kind: string, reply: boolean, proactive: boolean, askKind: boolean, teenItem: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && !outreachPolicy_outreachTeenItemKind(kind)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false, onlyWhenAsked: false, notAdult: true, onWatch: false } as RecipientFacts), ({ kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: teenItem } as RecipientSend), others) === "RecipientMinor";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawTeenItemStillRefusesABlock(kind: string, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !(outreachPolicy_outreachRequiresAdult(kind) && anyOtherBlocked(kind, others)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false, onlyWhenAsked: false, notAdult: true, onWatch: false } as RecipientFacts), ({ kind: kind, reply: false, proactive: false, askKind: false, teenItem: true } as RecipientSend), others) !== "RecipientEligible";
}

/** Story: Contact only a member who can get this message now / A message about another member needs two adults with no block between them (spec/recipientEligibility.md) */
//@ pure
export function lawRefusalIsFinal(kind: string, reply: boolean, proactive: boolean, askKind: boolean, declined: boolean, known: boolean, optedOut: boolean, accountRestricted: boolean, matchingStopped: boolean, held: boolean, onlyWhenAsked: boolean, notAdult: boolean, onWatch: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  const local_2: RecipientFacts = { declined: declined, known: known, optedOut: optedOut, accountRestricted: accountRestricted, matchingStopped: matchingStopped, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch };
  const local_3: RecipientSend = { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false };
  return !(recipientOwnVerdict(local_2, local_3) !== "RecipientEligible") || recipientVerdict(local_2, local_3, others) === recipientOwnVerdict(local_2, local_3);
}

/** Story: Contact only a member who can get this message now / The refusal reason names the failed check (spec/recipientEligibility.md) */
//@ pure
export function recipientRefusalReason(verdict: RecipientVerdict): string {
  return verdict === "RecipientEligible" ? "" : verdict === "RecipientDeclined" ? "declined" : verdict === "RecipientUnknown" ? "unknown_member" : verdict === "RecipientOptedOut" ? "opted_out" : verdict === "RecipientAccountRestricted" ? "account" : verdict === "RecipientMatchingNotActive" ? "matching_not_active" : verdict === "RecipientHeld" ? "held" : verdict === "RecipientOnlyWhenAsked" ? "only_when_asked" : verdict === "RecipientMinor" ? "minor" : verdict === "RecipientOnWatch" ? "on_watch" : verdict === "RecipientBlockedPair" ? "blocked_pair" : verdict === "RecipientOtherNotMatchable" ? "other_not_matchable" : verdict === "RecipientOtherHeld" ? "other_held" : "other_on_watch";
}

/** Story: Contact only a member who can get this message now / The refusal reason names the failed check (spec/recipientEligibility.md) */
//@ pure
export function lawProbeNeedsActiveMatching(reply: boolean, proactive: boolean, others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: true, held: false, onlyWhenAsked: false, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: "probe", reply: reply, proactive: proactive, askKind: true, teenItem: false } as RecipientSend), others) === "RecipientMatchingNotActive";
}

/** Story: Contact only a member who can get this message now / The refusal reason names the failed check (spec/recipientEligibility.md) */
//@ pure
export function lawProbeRefusesAvoidedOrStoppedOther(others: OtherParticipantFacts[]): boolean {
  //@ ensures \result === true
  return !others.some((o: OtherParticipantFacts) => o.avoided || (o.present && o.matchingStopped)) || recipientVerdict(({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false, onlyWhenAsked: false, notAdult: false, onWatch: false } as RecipientFacts), ({ kind: "probe", reply: false, proactive: false, askKind: true, teenItem: false } as RecipientSend), others) !== "RecipientEligible";
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
