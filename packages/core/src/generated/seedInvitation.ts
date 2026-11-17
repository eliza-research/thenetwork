// GENERATED from spec/seedInvitation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { memberInviteDraftMs as memberInvitation_memberInviteDraftMs, memberInviteMaxMonths as memberInvitation_memberInviteMaxMonths, memberInviteBurstWindowMs as memberInvitation_memberInviteBurstWindowMs, memberInviteBurstPriorCount as memberInvitation_memberInviteBurstPriorCount, memberInviteWindowMs as memberInvitation_memberInviteWindowMs, defaultMemberInviteCapacity as memberInvitation_defaultMemberInviteCapacity, memberInviteUsesAllowance as memberInvitation_memberInviteUsesAllowance, memberInviteWithinWindow as memberInvitation_memberInviteWithinWindow, memberInviteDraftCurrent as memberInvitation_memberInviteDraftCurrent, memberInviteEvidenceValid as memberInvitation_memberInviteEvidenceValid, memberInviteConfirmationReady as memberInvitation_memberInviteConfirmationReady, memberInviteWithinBurstWindow as memberInvitation_memberInviteWithinBurstWindow, memberInviteVouchWeak as memberInvitation_memberInviteVouchWeak, memberInviteBurst as memberInvitation_memberInviteBurst, memberInviteNeedsReview as memberInvitation_memberInviteNeedsReview, memberInviteHeldLinkReleased as memberInvitation_memberInviteHeldLinkReleased, memberInviteLinkCanBeShared as memberInvitation_memberInviteLinkCanBeShared, memberInviteCanAttribute as memberInvitation_memberInviteCanAttribute, memberInviteSourceCurrent as memberInvitation_memberInviteSourceCurrent, memberInviteRelationshipKnown as memberInvitation_memberInviteRelationshipKnown, memberInviteCanIssue as memberInvitation_memberInviteCanIssue, lawUnavailableMemberInviteDoesNotSpend as memberInvitation_lawUnavailableMemberInviteDoesNotSpend, lawMemberInviteRequiresConfirmation as memberInvitation_lawMemberInviteRequiresConfirmation, lawUnusualMemberInviteRequiresReview as memberInvitation_lawUnusualMemberInviteRequiresReview, lawHeldMemberInviteNeedsApproval as memberInvitation_lawHeldMemberInviteNeedsApproval, lawMemberInviteLinkNeedsDirectReply as memberInvitation_lawMemberInviteLinkNeedsDirectReply, lawOldMemberInviteCannotBeAttributed as memberInvitation_lawOldMemberInviteCannotBeAttributed, memberMayRequestInvite as memberInvitation_memberMayRequestInvite, lawMemberInviteNeedsAdult as memberInvitation_lawMemberInviteNeedsAdult, lawMemberInviteNeedsDirectRequest as memberInvitation_lawMemberInviteNeedsDirectRequest } from "./memberInvitation.ts";

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export type SeedBatchDecision = "IssueSeedBatch" | "ReplaySeedBatch" | "RejectSeedBatch";
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export interface SeedBatchFacts { appAdmin: boolean; stableActor: boolean; validCity: boolean; validRecipients: boolean; uniqueRecipients: boolean; entryCount: number; shortestVouchBytes: number; longestVouchBytes: number; batchNew: boolean; sameBatch: boolean; batchLive: boolean }
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export type SeedInvitationPhase = "SeedUnissued" | "SeedIssued" | "SeedRedeemed" | "SeedClosed";
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export interface SeedInvitation { phase: SeedInvitationPhase; issuedAt: number; vouchRetained: boolean }
/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
export interface SeedRecipientFacts { exactApp: boolean; verifiedRecipient: boolean; recipientAllowed: boolean; unredeemed: boolean; issuedAt: number; now: number }
/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
export interface SeedRedemptionFacts { liveBinding: boolean; freshJoin: boolean; eligibleEnrollment: boolean; currentConsent: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "issueSeedInvitation"; batch: SeedBatchFacts; issuedAt: number }
  | { type: "redeemSeedInvitation"; recipient: SeedRecipientFacts; redemption: SeedRedemptionFacts }
  | { type: "closeSeedInvitation"; now: number; exactDecline: boolean; suppressedOrBanned: boolean };

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export const seedInvitationBatchLimit: number = 100;
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export const seedInvitationVouchByteLimit: number = 500;
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export const eligibleBatch: SeedBatchFacts = { appAdmin: true, stableActor: true, validCity: true, validRecipients: true, uniqueRecipients: true, entryCount: 1, shortestVouchBytes: 1, longestVouchBytes: 500, batchNew: true, sameBatch: false, batchLive: true };
/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
export const eligibleRecipient: SeedRecipientFacts = { exactApp: true, verifiedRecipient: true, recipientAllowed: true, unredeemed: true, issuedAt: 0, now: 1 };
/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
export const approvedRedemption: SeedRedemptionFacts = { liveBinding: true, freshJoin: true, eligibleEnrollment: true, currentConsent: true };
/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
export const initial: SeedInvitation = { phase: "SeedUnissued", issuedAt: 0, vouchRetained: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SeedInvitation): boolean {
  return alwaysOnlyIssuedOrClosedInvitationKeepsVouch(current) && alwaysIssuedSeedInvitationKeepsVouch(current) && alwaysIssuedSeedInvitationHasTimestamp(current);
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationCitySupported(city: string): boolean {
  return city === "nyc" || city === "sf";
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationBatchSizeAllowed(entryCount: number): boolean {
  return entryCount >= 1 && entryCount <= seedInvitationBatchLimit;
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationVouchSizeAllowed(bytes: number): boolean {
  return bytes >= 1 && bytes <= seedInvitationVouchByteLimit;
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationExpiresAt(issuedAt: number): number {
  return exact_seedInvitation(issuedAt + memberInvitation_memberInviteWindowMs);
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationBatchAuthorized(batch: SeedBatchFacts): boolean {
  return batch.appAdmin && batch.stableActor && batch.validCity && batch.validRecipients && batch.uniqueRecipients && seedInvitationBatchSizeAllowed(batch.entryCount) && seedInvitationVouchSizeAllowed(batch.shortestVouchBytes) && seedInvitationVouchSizeAllowed(batch.longestVouchBytes);
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationIssueNeedsOperator(batch: SeedBatchFacts): boolean {
  //@ ensures \result === true
  return !seedInvitationBatchAuthorized(batch) || (batch.appAdmin && batch.stableActor);
}

/** Story: Create the first cohort's invitations / Only an authorized app admin can issue an attributable batch (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationBatchStaysInSizeLimits(batch: SeedBatchFacts): boolean {
  //@ ensures \result === true
  return !seedInvitationBatchAuthorized(batch) || (batch.entryCount >= 1 && batch.entryCount <= 100 && batch.shortestVouchBytes >= 1 && batch.longestVouchBytes <= 500);
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function sometimesSeedInvitationIssued(invite: SeedInvitation): boolean {
  return invite.phase === "SeedIssued";
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function seedInvitationBatchDecision(batch: SeedBatchFacts): SeedBatchDecision {
  return !seedInvitationBatchAuthorized(batch) ? "RejectSeedBatch" : (batch.batchNew ? "IssueSeedBatch" : (batch.sameBatch && batch.batchLive ? "ReplaySeedBatch" : "RejectSeedBatch"));
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function canIssueSeedInvitation(invite: SeedInvitation, batch: SeedBatchFacts, issuedAt: number): boolean {
  return invite.phase === "SeedUnissued" && issuedAt >= 0 && seedInvitationBatchDecision(batch) === "IssueSeedBatch";
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function lawExistingSeedInvitationBatchCannotIssue(batch: SeedBatchFacts): boolean {
  //@ ensures \result === true
  return !(!batch.batchNew) || seedInvitationBatchDecision(batch) !== "IssueSeedBatch";
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationBatchReplayRequiresExactBatch(batch: SeedBatchFacts): boolean {
  //@ ensures \result === true
  return !(seedInvitationBatchDecision(batch) === "ReplaySeedBatch") || (!batch.batchNew && batch.sameBatch && batch.batchLive && seedInvitationBatchAuthorized(batch));
}

/** Story: Create the first cohort's invitations / A retry can return only the original live batch (spec/seedInvitation.md) */
//@ pure
export function issueSeedInvitation(invite: SeedInvitation, batch: SeedBatchFacts, issuedAt: number): SeedInvitation {
  //@ ensures (inv(invite) && canIssueSeedInvitation(invite, batch, issuedAt)) ==> alwaysOnlyIssuedOrClosedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canIssueSeedInvitation(invite, batch, issuedAt)) ==> alwaysIssuedSeedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canIssueSeedInvitation(invite, batch, issuedAt)) ==> alwaysIssuedSeedInvitationHasTimestamp(\result)
  //@ ensures (inv(invite) && canIssueSeedInvitation(invite, batch, issuedAt)) ==> stepTerminalSeedInvitationDoesNotChange(invite, \result)
  //@ ensures (inv(invite) && canIssueSeedInvitation(invite, batch, issuedAt)) ==> stepExistingSeedInvitationKeepsIssueTime(invite, \result)
  return canIssueSeedInvitation(invite, batch, issuedAt) ? ({ phase: "SeedIssued", issuedAt: issuedAt, vouchRetained: true } as SeedInvitation) : invite;
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function seedInvitationMayRedeem(redemption: SeedRedemptionFacts): boolean {
  return redemption.liveBinding && redemption.freshJoin && redemption.eligibleEnrollment && redemption.currentConsent;
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function seedInvitationRecipientCurrent(recipient: SeedRecipientFacts): boolean {
  return recipient.exactApp && recipient.verifiedRecipient && recipient.recipientAllowed && recipient.unredeemed && recipient.issuedAt >= 0 && memberInvitation_memberInviteWithinWindow(exact_seedInvitation(recipient.now - recipient.issuedAt));
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationRedemptionRequiresNewEligibleJoin(redemption: SeedRedemptionFacts): boolean {
  //@ ensures \result === true
  return !seedInvitationMayRedeem(redemption) || (redemption.freshJoin && redemption.eligibleEnrollment && redemption.currentConsent);
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function sometimesSeedInvitationRedeemed(invite: SeedInvitation): boolean {
  return invite.phase === "SeedRedeemed";
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function canRedeemSeedInvitation(invite: SeedInvitation, recipient: SeedRecipientFacts, redemption: SeedRedemptionFacts): boolean {
  return invite.phase === "SeedIssued" && invite.issuedAt === recipient.issuedAt && seedInvitationRecipientCurrent(recipient) && seedInvitationMayRedeem(redemption);
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationRequiresVerifiedAppRecipient(recipient: SeedRecipientFacts): boolean {
  //@ ensures \result === true
  return !seedInvitationRecipientCurrent(recipient) || (recipient.exactApp && recipient.verifiedRecipient && recipient.recipientAllowed && recipient.unredeemed);
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationCannotResolveAfterExpiry(recipient: SeedRecipientFacts): boolean {
  //@ ensures \result === true
  return !(recipient.now >= seedInvitationExpiresAt(recipient.issuedAt)) || !seedInvitationRecipientCurrent(recipient);
}

/** Story: Decide whether to join the cohort / Only the verified recipient can spend a current invitation (spec/seedInvitation.md) */
//@ pure
export function redeemSeedInvitation(invite: SeedInvitation, recipient: SeedRecipientFacts, redemption: SeedRedemptionFacts): SeedInvitation {
  //@ ensures (inv(invite) && canRedeemSeedInvitation(invite, recipient, redemption)) ==> alwaysOnlyIssuedOrClosedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canRedeemSeedInvitation(invite, recipient, redemption)) ==> alwaysIssuedSeedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canRedeemSeedInvitation(invite, recipient, redemption)) ==> alwaysIssuedSeedInvitationHasTimestamp(\result)
  //@ ensures (inv(invite) && canRedeemSeedInvitation(invite, recipient, redemption)) ==> stepTerminalSeedInvitationDoesNotChange(invite, \result)
  //@ ensures (inv(invite) && canRedeemSeedInvitation(invite, recipient, redemption)) ==> stepExistingSeedInvitationKeepsIssueTime(invite, \result)
  return canRedeemSeedInvitation(invite, recipient, redemption) ? ({ ...invite, phase: "SeedRedeemed", vouchRetained: false } as SeedInvitation) : invite;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function seedInvitationMayDecline(exactRecipient: boolean, open: boolean): boolean {
  return exactRecipient && open;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function alwaysOnlyIssuedOrClosedInvitationKeepsVouch(invite: SeedInvitation): boolean {
  return !invite.vouchRetained || (invite.phase === "SeedIssued" || invite.phase === "SeedClosed");
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function alwaysIssuedSeedInvitationKeepsVouch(invite: SeedInvitation): boolean {
  return !(invite.phase === "SeedIssued") || invite.vouchRetained;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function alwaysIssuedSeedInvitationHasTimestamp(invite: SeedInvitation): boolean {
  return !(invite.phase !== "SeedUnissued") || invite.issuedAt >= 0;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function stepTerminalSeedInvitationDoesNotChange(before: SeedInvitation, after: SeedInvitation): boolean {
  return !(before.phase === "SeedRedeemed" || before.phase === "SeedClosed") || equal_seedInvitation(after, before);
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function stepExistingSeedInvitationKeepsIssueTime(before: SeedInvitation, after: SeedInvitation): boolean {
  return !(before.phase !== "SeedUnissued") || after.issuedAt === before.issuedAt;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function sometimesSeedInvitationClosed(invite: SeedInvitation): boolean {
  return invite.phase === "SeedClosed";
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function canCloseSeedInvitation(invite: SeedInvitation, now: number, exactDecline: boolean, suppressedOrBanned: boolean): boolean {
  return invite.phase === "SeedIssued" && (seedInvitationMayDecline(exactDecline, invite.phase === "SeedIssued") || suppressedOrBanned || now >= seedInvitationExpiresAt(invite.issuedAt));
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function seedInvitationCloseClearsVouch(invite: SeedInvitation, now: number, exactDecline: boolean): boolean {
  return seedInvitationMayDecline(exactDecline, invite.phase === "SeedIssued") || now >= seedInvitationExpiresAt(invite.issuedAt);
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function closeSeedInvitation(invite: SeedInvitation, now: number, exactDecline: boolean, suppressedOrBanned: boolean): SeedInvitation {
  //@ ensures (inv(invite) && canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned)) ==> alwaysOnlyIssuedOrClosedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned)) ==> alwaysIssuedSeedInvitationKeepsVouch(\result)
  //@ ensures (inv(invite) && canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned)) ==> alwaysIssuedSeedInvitationHasTimestamp(\result)
  //@ ensures (inv(invite) && canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned)) ==> stepTerminalSeedInvitationDoesNotChange(invite, \result)
  //@ ensures (inv(invite) && canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned)) ==> stepExistingSeedInvitationKeepsIssueTime(invite, \result)
  return canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned) ? ({ ...invite, phase: "SeedClosed", vouchRetained: invite.vouchRetained && !seedInvitationCloseClearsVouch(invite, now, exactDecline) } as SeedInvitation) : invite;
}

/** Story: Decide whether to join the cohort / Decline, suppression and expiry end the invitation (spec/seedInvitation.md) */
//@ pure
export function lawSeedInvitationDeclineOrExpiryClearsVouch(issuedAt: number, now: number, exactDecline: boolean, suppressedOrBanned: boolean): boolean {
  //@ ensures \result === true
  const local_0: SeedInvitation = { phase: "SeedIssued", issuedAt: issuedAt, vouchRetained: true };
  return !seedInvitationCloseClearsVouch(local_0, now, exactDecline) || !closeSeedInvitation(local_0, now, exactDecline, suppressedOrBanned).vouchRetained;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SeedInvitation, event: Event): boolean {
  if (event.type === "issueSeedInvitation") return canIssueSeedInvitation(current, event.batch, event.issuedAt);
  if (event.type === "redeemSeedInvitation") return canRedeemSeedInvitation(current, event.recipient, event.redemption);
  if (event.type === "closeSeedInvitation") return canCloseSeedInvitation(current, event.now, event.exactDecline, event.suppressedOrBanned);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SeedInvitation, event: Event): SeedInvitation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "issueSeedInvitation" && canIssueSeedInvitation(current, event.batch, event.issuedAt)) return issueSeedInvitation(current, event.batch, event.issuedAt);
  if (event.type === "redeemSeedInvitation" && canRedeemSeedInvitation(current, event.recipient, event.redemption)) return redeemSeedInvitation(current, event.recipient, event.redemption);
  if (event.type === "closeSeedInvitation" && canCloseSeedInvitation(current, event.now, event.exactDecline, event.suppressedOrBanned)) return closeSeedInvitation(current, event.now, event.exactDecline, event.suppressedOrBanned);
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
  const is_SeedBatchFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.appAdmin === "boolean" && typeof v.stableActor === "boolean" && typeof v.validCity === "boolean" && typeof v.validRecipients === "boolean" && typeof v.uniqueRecipients === "boolean" && Number.isSafeInteger(v.entryCount) && Number.isSafeInteger(v.shortestVouchBytes) && Number.isSafeInteger(v.longestVouchBytes) && typeof v.batchNew === "boolean" && typeof v.sameBatch === "boolean" && typeof v.batchLive === "boolean";
  const is_SeedRecipientFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.exactApp === "boolean" && typeof v.verifiedRecipient === "boolean" && typeof v.recipientAllowed === "boolean" && typeof v.unredeemed === "boolean" && Number.isSafeInteger(v.issuedAt) && Number.isSafeInteger(v.now);
  const is_SeedRedemptionFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.liveBinding === "boolean" && typeof v.freshJoin === "boolean" && typeof v.eligibleEnrollment === "boolean" && typeof v.currentConsent === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "issueSeedInvitation" && is_SeedBatchFacts(raw.batch) && Number.isSafeInteger(raw.issuedAt)) return { type: "issueSeedInvitation", batch: ({ appAdmin: raw.batch.appAdmin, stableActor: raw.batch.stableActor, validCity: raw.batch.validCity, validRecipients: raw.batch.validRecipients, uniqueRecipients: raw.batch.uniqueRecipients, entryCount: raw.batch.entryCount, shortestVouchBytes: raw.batch.shortestVouchBytes, longestVouchBytes: raw.batch.longestVouchBytes, batchNew: raw.batch.batchNew, sameBatch: raw.batch.sameBatch, batchLive: raw.batch.batchLive }), issuedAt: raw.issuedAt };
  if (raw.type === "redeemSeedInvitation" && is_SeedRecipientFacts(raw.recipient) && is_SeedRedemptionFacts(raw.redemption)) return { type: "redeemSeedInvitation", recipient: ({ exactApp: raw.recipient.exactApp, verifiedRecipient: raw.recipient.verifiedRecipient, recipientAllowed: raw.recipient.recipientAllowed, unredeemed: raw.recipient.unredeemed, issuedAt: raw.recipient.issuedAt, now: raw.recipient.now }), redemption: ({ liveBinding: raw.redemption.liveBinding, freshJoin: raw.redemption.freshJoin, eligibleEnrollment: raw.redemption.eligibleEnrollment, currentConsent: raw.redemption.currentConsent }) };
  if (raw.type === "closeSeedInvitation" && Number.isSafeInteger(raw.now) && typeof raw.exactDecline === "boolean" && typeof raw.suppressedOrBanned === "boolean") return { type: "closeSeedInvitation", now: raw.now, exactDecline: raw.exactDecline, suppressedOrBanned: raw.suppressedOrBanned };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SeedInvitation | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "SeedUnissued" || raw.phase === "SeedIssued" || raw.phase === "SeedRedeemed" || raw.phase === "SeedClosed") && Number.isSafeInteger(raw.issuedAt) && typeof raw.vouchRetained === "boolean" && Object.keys(raw).length === 3)) return undefined;
  const parsed: SeedInvitation = ({ phase: raw.phase, issuedAt: raw.issuedAt, vouchRetained: raw.vouchRetained });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SeedInvitation {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_seedInvitation(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_seedInvitation(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_seedInvitation((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
