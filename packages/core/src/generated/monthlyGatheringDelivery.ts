// GENERATED from spec/monthlyGatheringDelivery.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Receive an invitation to the reviewed gathering / A gathering and its invitation recipients both need exact review (spec/monthlyGatheringDelivery.md) */
export const monthlyGatheringInvitePrefix: string = "monthly-gathering-invite:";

/** Story: Receive an invitation to the reviewed gathering / A gathering and its invitation recipients both need exact review (spec/monthlyGatheringDelivery.md) */
//@ pure
export function gatheringInvitationReviewCurrent(rollout: boolean, eventApproved: boolean, exactRevision: boolean, selected: boolean, eventApprovedAt: number, selectedAt: number, startAt: number, now: number): boolean {
  return rollout && eventApproved && exactRevision && selected && 0 < eventApprovedAt && eventApprovedAt <= selectedAt && selectedAt <= now && now < startAt;
}

/** Story: Receive an invitation to the reviewed gathering / A gathering and its invitation recipients both need exact review (spec/monthlyGatheringDelivery.md) */
//@ pure
export function lawGatheringInvitationNeedsSelectedRecipient(rollout: boolean, eventApproved: boolean, exactRevision: boolean, eventApprovedAt: number, selectedAt: number, startAt: number, now: number): boolean {
  //@ ensures \result === true
  return !gatheringInvitationReviewCurrent(rollout, eventApproved, exactRevision, false, eventApprovedAt, selectedAt, startAt, now);
}

/** Story: Receive an invitation to the reviewed gathering / The invitation depends on the recipient's current eligibility (spec/monthlyGatheringDelivery.md) */
//@ pure
export function gatheringInvitationRecipientCurrent(currentMember: boolean, trustedActiveMember: boolean, eventOptIn: boolean, hasRsvp: boolean, seatsRemain: boolean): boolean {
  return currentMember && trustedActiveMember && eventOptIn && !hasRsvp && seatsRemain;
}

/** Story: Receive an invitation to the reviewed gathering / The invitation depends on the recipient's current eligibility (spec/monthlyGatheringDelivery.md) */
//@ pure
export function lawGatheringRsvpFencesInvitation(currentMember: boolean, trustedActiveMember: boolean, eventOptIn: boolean, seatsRemain: boolean): boolean {
  //@ ensures \result === true
  return !gatheringInvitationRecipientCurrent(currentMember, trustedActiveMember, eventOptIn, true, seatsRemain);
}

/** Story: Receive an invitation to the reviewed gathering / One approved text goes through the usual outbound controls (spec/monthlyGatheringDelivery.md) */
//@ pure
export function gatheringInvitationMayAdmit(currentReview: boolean, eligibleRecipient: boolean, exactPayload: boolean, exactQueueKey: boolean, storedMessage: boolean): boolean {
  return currentReview && eligibleRecipient && exactPayload && exactQueueKey && storedMessage;
}

/** Story: Receive an invitation to the reviewed gathering / One approved text goes through the usual outbound controls (spec/monthlyGatheringDelivery.md) */
//@ pure
export function lawGatheringInvitationRejectsChangedPayload(currentReview: boolean, eligibleRecipient: boolean, exactQueueKey: boolean, storedMessage: boolean): boolean {
  //@ ensures \result === true
  return !gatheringInvitationMayAdmit(currentReview, eligibleRecipient, false, exactQueueKey, storedMessage);
}
