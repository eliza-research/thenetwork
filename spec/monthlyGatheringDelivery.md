# Deliver reviewed monthly gathering invitations

## Story: Receive an invitation to the reviewed gathering

> As a Network member who accepts event invitations, I want one invitation to a current reviewed local gathering with an explicit way to respond.

### A gathering and its invitation recipients both need exact review

The New York Network runtime stages a proactive invitation only when its rollout permits matching. The gathering and the staff recipient selection must approve the exact current revision. The invitee must be in that selection, and the gathering must still be in the future with spare RSVP capacity. Recheck the public venue and exact listing window when staging and again before claiming the send. The staff request itself schedules no text and reserves no seat.

```quint
pure val monthlyGatheringInvitePrefix: str = "monthly-gathering-invite:"

pure def gatheringInvitationReviewCurrent(rollout: bool, eventApproved: bool, exactRevision: bool, selected: bool, eventApprovedAt: int, selectedAt: int, startAt: int, now: int): bool =
  rollout and eventApproved and exactRevision and selected and 0 < eventApprovedAt and eventApprovedAt <= selectedAt and selectedAt <= now and now < startAt

pure def lawGatheringInvitationNeedsSelectedRecipient(rollout: bool, eventApproved: bool, exactRevision: bool, eventApprovedAt: int, selectedAt: int, startAt: int, now: int): bool =
  not(gatheringInvitationReviewCurrent(rollout, eventApproved, exactRevision, false, eventApprovedAt, selectedAt, startAt, now))
```

### The invitation depends on the recipient's current eligibility

Use the active local member and exact verified phone. Canonical opt-in, lowest adult age, safety holds, onboarding, participation and event preference are checked on queue and again at final admission. A STOP, pause, safety hold, loss of event consent, app removal, RSVP or withdrawal suppresses contact. Capacity is checked without assigning a seat. A member who wants messages only when they ask does not receive this invitation.

```quint
pure def gatheringInvitationRecipientCurrent(currentMember: bool, trustedActiveMember: bool, eventOptIn: bool, hasRsvp: bool, seatsRemain: bool): bool =
  currentMember and trustedActiveMember and eventOptIn and not(hasRsvp) and seatsRemain

pure def lawGatheringRsvpFencesInvitation(currentMember: bool, trustedActiveMember: bool, eventOptIn: bool, seatsRemain: bool): bool =
  not(gatheringInvitationRecipientCurrent(currentMember, trustedActiveMember, eventOptIn, true, seatsRemain))
```

### One approved text goes through the usual outbound controls

The exact event, revision and recipient determine one durable message key. The card contains the public time and place and an exact RSVP command. It contains no other attendee information, staff notes, private scored reasons or contact values. The proactive outreach controller applies its budget, timing and pause path. The persisted channel applies shared caps, quiet hours, leak checks and delivery receipts. Changed (owner decision 2026-11-22): the channel no longer applies a live approval, because the owner approved every app and the configured channel alone decides whether a send is real. The final claim checks that the immutable text matches the approved card and that its matching Network message exists. Retries and restart use the original key.

```quint
pure def gatheringInvitationMayAdmit(currentReview: bool, eligibleRecipient: bool, exactPayload: bool, exactQueueKey: bool, storedMessage: bool): bool =
  currentReview and eligibleRecipient and exactPayload and exactQueueKey and storedMessage

pure def lawGatheringInvitationRejectsChangedPayload(currentReview: bool, eligibleRecipient: bool, exactQueueKey: bool, storedMessage: bool): bool =
  not(gatheringInvitationMayAdmit(currentReview, eligibleRecipient, false, exactQueueKey, storedMessage))
```
