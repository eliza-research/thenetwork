// GENERATED from spec/expectedMemberInvitation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { memberInviteDraftMs as memberInvitation_memberInviteDraftMs, memberInviteMaxMonths as memberInvitation_memberInviteMaxMonths, memberInviteBurstWindowMs as memberInvitation_memberInviteBurstWindowMs, memberInviteBurstPriorCount as memberInvitation_memberInviteBurstPriorCount, memberInviteWindowMs as memberInvitation_memberInviteWindowMs, defaultMemberInviteCapacity as memberInvitation_defaultMemberInviteCapacity, memberInviteUsesAllowance as memberInvitation_memberInviteUsesAllowance, memberInviteWithinWindow as memberInvitation_memberInviteWithinWindow, memberInviteDraftCurrent as memberInvitation_memberInviteDraftCurrent, memberInviteEvidenceValid as memberInvitation_memberInviteEvidenceValid, memberInviteConfirmationReady as memberInvitation_memberInviteConfirmationReady, memberInviteWithinBurstWindow as memberInvitation_memberInviteWithinBurstWindow, memberInviteVouchWeak as memberInvitation_memberInviteVouchWeak, memberInviteBurst as memberInvitation_memberInviteBurst, memberInviteNeedsReview as memberInvitation_memberInviteNeedsReview, memberInviteLinkCanBeShared as memberInvitation_memberInviteLinkCanBeShared, memberInviteCanAttribute as memberInvitation_memberInviteCanAttribute, memberInviteSourceCurrent as memberInvitation_memberInviteSourceCurrent, memberInviteRelationshipKnown as memberInvitation_memberInviteRelationshipKnown, memberInviteCanIssue as memberInvitation_memberInviteCanIssue, lawUnavailableMemberInviteDoesNotSpend as memberInvitation_lawUnavailableMemberInviteDoesNotSpend, lawMemberInviteRequiresConfirmation as memberInvitation_lawMemberInviteRequiresConfirmation, lawUnusualMemberInviteRequiresReview as memberInvitation_lawUnusualMemberInviteRequiresReview, lawMemberInviteLinkNeedsDirectReply as memberInvitation_lawMemberInviteLinkNeedsDirectReply, lawOldMemberInviteCannotBeAttributed as memberInvitation_lawOldMemberInviteCannotBeAttributed, memberMayRequestInvite as memberInvitation_memberMayRequestInvite, lawMemberInviteNeedsAdult as memberInvitation_lawMemberInviteNeedsAdult, lawMemberInviteNeedsDirectRequest as memberInvitation_lawMemberInviteNeedsDirectRequest } from "./memberInvitation.ts";

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
export interface ExpectedInviteRequestFacts { direct: boolean; confirmedExpected: boolean; exactTarget: boolean; distinctRecipient: boolean; issuerCurrent: boolean; reviewClear: boolean; recipientAllowed: boolean; firstContact: boolean; now: number; expiresAt: number }
/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
export type ExpectedInvitePhase = "Unissued" | "Queued" | "Attempted" | "Retryable" | "Delivered" | "Redeemed" | "Closed";
/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
export interface ExpectedInvite { phase: ExpectedInvitePhase; expiresAt: number; deliveries: number }
/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
export interface ExpectedInviteDispatchFacts { queued: boolean; issuerCurrent: boolean; recipientAllowed: boolean; exactPayload: boolean; now: number; expiresAt: number }
/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
export interface ExpectedInviteAcceptanceFacts { exactApp: boolean; verifiedRecipient: boolean; unredeemed: boolean; issuerCurrent: boolean; recipientAllowed: boolean; now: number; expiresAt: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "stageExpectedInvite"; request: ExpectedInviteRequestFacts }
  | { type: "recordExpectedInviteReceipt"; exactPositiveReceipt: boolean }
  | { type: "requeueExpectedInvite"; neverAdmitted: boolean; sameKey: boolean }
  | { type: "dispatchExpectedInvite"; now: number; issuerCurrent: boolean; recipientAllowed: boolean; exactPayload: boolean }
  | { type: "acceptExpectedInvite"; now: number; exactApp: boolean; verifiedRecipient: boolean; issuerCurrent: boolean; recipientAllowed: boolean }
  | { type: "closeExpectedInvite"; now: number; invalidated: boolean; exactRecipientDeclined: boolean };

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
export const eligibleDispatch: ExpectedInviteDispatchFacts = { queued: true, issuerCurrent: true, recipientAllowed: true, exactPayload: true, now: 0, expiresAt: 100 };
/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
export const eligibleAcceptance: ExpectedInviteAcceptanceFacts = { exactApp: true, verifiedRecipient: true, unredeemed: true, issuerCurrent: true, recipientAllowed: true, now: 0, expiresAt: 100 };
/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
export const eligibleRequest: ExpectedInviteRequestFacts = { direct: true, confirmedExpected: true, exactTarget: true, distinctRecipient: true, issuerCurrent: true, reviewClear: true, recipientAllowed: true, firstContact: true, now: 0, expiresAt: 100 };
/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
export const initial: ExpectedInvite = { phase: "Unissued", expiresAt: 0, deliveries: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ExpectedInvite): boolean {
  return alwaysExpectedInviteDeliveriesAtMostOne(current) && alwaysUnclaimedExpectedInviteHasNoDelivery(current) && alwaysOnlyAClaimedInviteCanHaveAReceipt(current);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteLive(now: number, expiresAt: number): boolean {
  return now >= 0 && now < expiresAt;
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteTransportAllows(carrierAcceptsFirstContact: boolean, liveApproved: boolean): boolean {
  return carrierAcceptsFirstContact && liveApproved;
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteChallengeCurrent(issuedAt: number, now: number): boolean {
  return memberInvitation_memberInviteDraftCurrent(exact_expectedMemberInvitation(now - issuedAt));
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteMayStage(request: ExpectedInviteRequestFacts): boolean {
  return request.direct && request.confirmedExpected && request.exactTarget && request.distinctRecipient && request.issuerCurrent && request.reviewClear && request.recipientAllowed && request.firstContact && expectedInviteLive(request.now, request.expiresAt);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteChallengeCanReplay(transportAvailable: boolean, awaitingConfirmation: boolean, exactDraft: boolean, issuedAt: number, now: number, expiresAt: number): boolean {
  return transportAvailable && awaitingConfirmation && exactDraft && expectedInviteChallengeCurrent(issuedAt, now) && expectedInviteLive(now, expiresAt);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function canStageExpectedInvite(invite: ExpectedInvite, request: ExpectedInviteRequestFacts): boolean {
  return invite.phase === "Unissued" && expectedInviteMayStage(request);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function lawExpectedInviteNeedsExactConfirmation(request: ExpectedInviteRequestFacts): boolean {
  //@ ensures \result === true
  return !expectedInviteMayStage(request) || (request.direct && request.confirmedExpected && request.exactTarget && request.distinctRecipient);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function lawExpectedInviteNeedsCurrentReview(request: ExpectedInviteRequestFacts): boolean {
  //@ ensures \result === true
  return !expectedInviteMayStage(request) || (request.issuerCurrent && request.reviewClear);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function lawExpectedInviteNeedsAnEligibleFirstContact(request: ExpectedInviteRequestFacts): boolean {
  //@ ensures \result === true
  return !expectedInviteMayStage(request) || (request.recipientAllowed && request.firstContact);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function lawUnavailableTransportCannotReplay(approvalPending: boolean, exactDraft: boolean, issuedAt: number, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !expectedInviteChallengeCanReplay(false, approvalPending, exactDraft, issuedAt, now, expiresAt);
}

/** Story: Send an invitation that the recipient expects / Only a confirmed expected invitation can enter the shared line queue (spec/expectedMemberInvitation.md) */
//@ pure
export function stageExpectedInvite(invite: ExpectedInvite, request: ExpectedInviteRequestFacts): ExpectedInvite {
  //@ ensures (inv(invite) && canStageExpectedInvite(invite, request)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canStageExpectedInvite(invite, request)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canStageExpectedInvite(invite, request)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canStageExpectedInvite(invite, request)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canStageExpectedInvite(invite, request)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canStageExpectedInvite(invite, request) ? ({ phase: "Queued", expiresAt: request.expiresAt, deliveries: 0 } as ExpectedInvite) : invite;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteMayDispatch(dispatch: ExpectedInviteDispatchFacts): boolean {
  return dispatch.queued && dispatch.issuerCurrent && dispatch.recipientAllowed && dispatch.exactPayload && expectedInviteLive(dispatch.now, dispatch.expiresAt);
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function canRecordExpectedInviteReceipt(invite: ExpectedInvite, exactPositiveReceipt: boolean): boolean {
  return invite.phase === "Attempted" && exactPositiveReceipt;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function canRequeueExpectedInvite(invite: ExpectedInvite, neverAdmitted: boolean, sameKey: boolean): boolean {
  return invite.phase === "Attempted" && neverAdmitted && sameKey;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function alwaysExpectedInviteDeliveriesAtMostOne(invite: ExpectedInvite): boolean {
  return invite.deliveries >= 0 && invite.deliveries <= 1;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function alwaysUnclaimedExpectedInviteHasNoDelivery(invite: ExpectedInvite): boolean {
  return !(invite.phase === "Unissued" || invite.phase === "Queued") || invite.deliveries === 0;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function alwaysOnlyAClaimedInviteCanHaveAReceipt(invite: ExpectedInvite): boolean {
  return !(invite.phase === "Attempted" || invite.phase === "Retryable" || invite.phase === "Delivered" || invite.phase === "Redeemed") || invite.deliveries === 1;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function stepExpectedInviteDeliveriesNeverGoBack(before: ExpectedInvite, after: ExpectedInvite): boolean {
  return after.deliveries >= before.deliveries;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function sometimesExpectedInviteCanSend(invite: ExpectedInvite): boolean {
  return invite.phase === "Attempted";
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function sometimesExpectedInviteCanRetry(invite: ExpectedInvite): boolean {
  return invite.phase === "Retryable";
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function sometimesExpectedInviteFindsReceipt(invite: ExpectedInvite): boolean {
  return invite.phase === "Delivered";
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function canDispatchExpectedInvite(invite: ExpectedInvite, now: number, issuerCurrent: boolean, recipientAllowed: boolean, exactPayload: boolean): boolean {
  return expectedInviteMayDispatch(({ queued: invite.phase === "Queued" || invite.phase === "Retryable", issuerCurrent: issuerCurrent, recipientAllowed: recipientAllowed, exactPayload: exactPayload, now: now, expiresAt: invite.expiresAt } as ExpectedInviteDispatchFacts));
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function recordExpectedInviteReceipt(invite: ExpectedInvite, exactPositiveReceipt: boolean): ExpectedInvite {
  //@ ensures (inv(invite) && canRecordExpectedInviteReceipt(invite, exactPositiveReceipt)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canRecordExpectedInviteReceipt(invite, exactPositiveReceipt)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canRecordExpectedInviteReceipt(invite, exactPositiveReceipt)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canRecordExpectedInviteReceipt(invite, exactPositiveReceipt)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canRecordExpectedInviteReceipt(invite, exactPositiveReceipt)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canRecordExpectedInviteReceipt(invite, exactPositiveReceipt) ? ({ ...invite, phase: "Delivered" } as ExpectedInvite) : invite;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function requeueExpectedInvite(invite: ExpectedInvite, neverAdmitted: boolean, sameKey: boolean): ExpectedInvite {
  //@ ensures (inv(invite) && canRequeueExpectedInvite(invite, neverAdmitted, sameKey)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canRequeueExpectedInvite(invite, neverAdmitted, sameKey)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canRequeueExpectedInvite(invite, neverAdmitted, sameKey)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canRequeueExpectedInvite(invite, neverAdmitted, sameKey)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canRequeueExpectedInvite(invite, neverAdmitted, sameKey)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canRequeueExpectedInvite(invite, neverAdmitted, sameKey) ? ({ ...invite, phase: "Retryable" } as ExpectedInvite) : invite;
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function lawUnknownExpectedInviteCannotRetry(phase: ExpectedInvitePhase, sameKey: boolean): boolean {
  //@ ensures \result === true
  return !canRequeueExpectedInvite(({ phase: phase, expiresAt: 100, deliveries: 1 } as ExpectedInvite), false, sameKey);
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function lawSuppressedExpectedInviteCannotDispatch(dispatch: ExpectedInviteDispatchFacts): boolean {
  //@ ensures \result === true
  return !(!dispatch.recipientAllowed) || !expectedInviteMayDispatch(dispatch);
}

/** Story: Send an invitation that the recipient expects / One durably claimed dispatch may contact the recipient (spec/expectedMemberInvitation.md) */
//@ pure
export function dispatchExpectedInvite(invite: ExpectedInvite, now: number, issuerCurrent: boolean, recipientAllowed: boolean, exactPayload: boolean): ExpectedInvite {
  //@ ensures (inv(invite) && canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload) ? ({ ...invite, phase: "Attempted", deliveries: 1 } as ExpectedInvite) : invite;
}

/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteMayAccept(acceptance: ExpectedInviteAcceptanceFacts): boolean {
  return acceptance.exactApp && acceptance.verifiedRecipient && acceptance.unredeemed && acceptance.issuerCurrent && acceptance.recipientAllowed && expectedInviteLive(acceptance.now, acceptance.expiresAt);
}

/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
//@ pure
export function sometimesExpectedInviteRedeemed(invite: ExpectedInvite): boolean {
  return invite.phase === "Redeemed";
}

/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
//@ pure
export function canAcceptExpectedInvite(invite: ExpectedInvite, now: number, exactApp: boolean, verifiedRecipient: boolean, issuerCurrent: boolean, recipientAllowed: boolean): boolean {
  return expectedInviteMayAccept(({ exactApp: exactApp, verifiedRecipient: verifiedRecipient, unredeemed: invite.phase === "Attempted" || invite.phase === "Delivered", issuerCurrent: issuerCurrent, recipientAllowed: recipientAllowed, now: now, expiresAt: invite.expiresAt } as ExpectedInviteAcceptanceFacts));
}

/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
//@ pure
export function lawExpectedInviteAcceptanceRequiresVerifiedRecipient(acceptance: ExpectedInviteAcceptanceFacts): boolean {
  //@ ensures \result === true
  return !expectedInviteMayAccept(acceptance) || (acceptance.exactApp && acceptance.verifiedRecipient);
}

/** Story: Send an invitation that the recipient expects / Only the intended verified recipient can accept (spec/expectedMemberInvitation.md) */
//@ pure
export function acceptExpectedInvite(invite: ExpectedInvite, now: number, exactApp: boolean, verifiedRecipient: boolean, issuerCurrent: boolean, recipientAllowed: boolean): ExpectedInvite {
  //@ ensures (inv(invite) && canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed) ? ({ ...invite, phase: "Redeemed" } as ExpectedInvite) : invite;
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteMayDecline(exactRecipient: boolean, contactStarted: boolean): boolean {
  return exactRecipient && contactStarted;
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function sometimesExpectedInviteClosed(invite: ExpectedInvite): boolean {
  return invite.phase === "Closed";
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function expectedInviteContactStarted(phase: ExpectedInvitePhase): boolean {
  return phase === "Attempted" || phase === "Delivered";
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function stepExpectedInviteTerminalStatesStayClosed(before: ExpectedInvite, after: ExpectedInvite): boolean {
  return !(before.phase === "Redeemed" || before.phase === "Closed") || equal_expectedMemberInvitation(after, before);
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function canCloseExpectedInvite(invite: ExpectedInvite, now: number, invalidated: boolean, exactRecipientDeclined: boolean): boolean {
  return (invite.phase === "Queued" || invite.phase === "Retryable" || expectedInviteContactStarted(invite.phase)) && (invalidated || !expectedInviteLive(now, invite.expiresAt) || expectedInviteMayDecline(exactRecipientDeclined, expectedInviteContactStarted(invite.phase)));
}

/** Story: Send an invitation that the recipient expects / Decline, suppression and expiry end the invitation (spec/expectedMemberInvitation.md) */
//@ pure
export function closeExpectedInvite(invite: ExpectedInvite, now: number, invalidated: boolean, exactRecipientDeclined: boolean): ExpectedInvite {
  //@ ensures (inv(invite) && canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined)) ==> alwaysExpectedInviteDeliveriesAtMostOne(\result)
  //@ ensures (inv(invite) && canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined)) ==> alwaysUnclaimedExpectedInviteHasNoDelivery(\result)
  //@ ensures (inv(invite) && canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined)) ==> alwaysOnlyAClaimedInviteCanHaveAReceipt(\result)
  //@ ensures (inv(invite) && canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined)) ==> stepExpectedInviteDeliveriesNeverGoBack(invite, \result)
  //@ ensures (inv(invite) && canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined)) ==> stepExpectedInviteTerminalStatesStayClosed(invite, \result)
  return canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined) ? ({ ...invite, phase: "Closed" } as ExpectedInvite) : invite;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ExpectedInvite, event: Event): boolean {
  if (event.type === "stageExpectedInvite") return canStageExpectedInvite(current, event.request);
  if (event.type === "recordExpectedInviteReceipt") return canRecordExpectedInviteReceipt(current, event.exactPositiveReceipt);
  if (event.type === "requeueExpectedInvite") return canRequeueExpectedInvite(current, event.neverAdmitted, event.sameKey);
  if (event.type === "dispatchExpectedInvite") return canDispatchExpectedInvite(current, event.now, event.issuerCurrent, event.recipientAllowed, event.exactPayload);
  if (event.type === "acceptExpectedInvite") return canAcceptExpectedInvite(current, event.now, event.exactApp, event.verifiedRecipient, event.issuerCurrent, event.recipientAllowed);
  if (event.type === "closeExpectedInvite") return canCloseExpectedInvite(current, event.now, event.invalidated, event.exactRecipientDeclined);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ExpectedInvite, event: Event): ExpectedInvite {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "stageExpectedInvite" && canStageExpectedInvite(current, event.request)) return stageExpectedInvite(current, event.request);
  if (event.type === "recordExpectedInviteReceipt" && canRecordExpectedInviteReceipt(current, event.exactPositiveReceipt)) return recordExpectedInviteReceipt(current, event.exactPositiveReceipt);
  if (event.type === "requeueExpectedInvite" && canRequeueExpectedInvite(current, event.neverAdmitted, event.sameKey)) return requeueExpectedInvite(current, event.neverAdmitted, event.sameKey);
  if (event.type === "dispatchExpectedInvite" && canDispatchExpectedInvite(current, event.now, event.issuerCurrent, event.recipientAllowed, event.exactPayload)) return dispatchExpectedInvite(current, event.now, event.issuerCurrent, event.recipientAllowed, event.exactPayload);
  if (event.type === "acceptExpectedInvite" && canAcceptExpectedInvite(current, event.now, event.exactApp, event.verifiedRecipient, event.issuerCurrent, event.recipientAllowed)) return acceptExpectedInvite(current, event.now, event.exactApp, event.verifiedRecipient, event.issuerCurrent, event.recipientAllowed);
  if (event.type === "closeExpectedInvite" && canCloseExpectedInvite(current, event.now, event.invalidated, event.exactRecipientDeclined)) return closeExpectedInvite(current, event.now, event.invalidated, event.exactRecipientDeclined);
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
  const is_ExpectedInviteRequestFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.direct === "boolean" && typeof v.confirmedExpected === "boolean" && typeof v.exactTarget === "boolean" && typeof v.distinctRecipient === "boolean" && typeof v.issuerCurrent === "boolean" && typeof v.reviewClear === "boolean" && typeof v.recipientAllowed === "boolean" && typeof v.firstContact === "boolean" && Number.isSafeInteger(v.now) && Number.isSafeInteger(v.expiresAt);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "stageExpectedInvite" && is_ExpectedInviteRequestFacts(raw.request)) return { type: "stageExpectedInvite", request: ({ direct: raw.request.direct, confirmedExpected: raw.request.confirmedExpected, exactTarget: raw.request.exactTarget, distinctRecipient: raw.request.distinctRecipient, issuerCurrent: raw.request.issuerCurrent, reviewClear: raw.request.reviewClear, recipientAllowed: raw.request.recipientAllowed, firstContact: raw.request.firstContact, now: raw.request.now, expiresAt: raw.request.expiresAt }) };
  if (raw.type === "recordExpectedInviteReceipt" && typeof raw.exactPositiveReceipt === "boolean") return { type: "recordExpectedInviteReceipt", exactPositiveReceipt: raw.exactPositiveReceipt };
  if (raw.type === "requeueExpectedInvite" && typeof raw.neverAdmitted === "boolean" && typeof raw.sameKey === "boolean") return { type: "requeueExpectedInvite", neverAdmitted: raw.neverAdmitted, sameKey: raw.sameKey };
  if (raw.type === "dispatchExpectedInvite" && Number.isSafeInteger(raw.now) && typeof raw.issuerCurrent === "boolean" && typeof raw.recipientAllowed === "boolean" && typeof raw.exactPayload === "boolean") return { type: "dispatchExpectedInvite", now: raw.now, issuerCurrent: raw.issuerCurrent, recipientAllowed: raw.recipientAllowed, exactPayload: raw.exactPayload };
  if (raw.type === "acceptExpectedInvite" && Number.isSafeInteger(raw.now) && typeof raw.exactApp === "boolean" && typeof raw.verifiedRecipient === "boolean" && typeof raw.issuerCurrent === "boolean" && typeof raw.recipientAllowed === "boolean") return { type: "acceptExpectedInvite", now: raw.now, exactApp: raw.exactApp, verifiedRecipient: raw.verifiedRecipient, issuerCurrent: raw.issuerCurrent, recipientAllowed: raw.recipientAllowed };
  if (raw.type === "closeExpectedInvite" && Number.isSafeInteger(raw.now) && typeof raw.invalidated === "boolean" && typeof raw.exactRecipientDeclined === "boolean") return { type: "closeExpectedInvite", now: raw.now, invalidated: raw.invalidated, exactRecipientDeclined: raw.exactRecipientDeclined };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ExpectedInvite | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unissued" || raw.phase === "Queued" || raw.phase === "Attempted" || raw.phase === "Retryable" || raw.phase === "Delivered" || raw.phase === "Redeemed" || raw.phase === "Closed") && Number.isSafeInteger(raw.expiresAt) && Number.isSafeInteger(raw.deliveries) && Object.keys(raw).length === 3)) return undefined;
  const parsed: ExpectedInvite = ({ phase: raw.phase, expiresAt: raw.expiresAt, deliveries: raw.deliveries });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ExpectedInvite {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_expectedMemberInvitation(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_expectedMemberInvitation(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_expectedMemberInvitation((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
