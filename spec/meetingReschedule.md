# Reschedule a booked meeting

[Story F17](product/stories.md#story-f17--schedule-a-meeting) requires fresh consent for a changed time. The shell owns the signed turn, the current app's booking, the exact local-time parsing, venue hours, availability, persistence, and dispatch.

## Story: Change the time only when everyone agrees

> As a participant, I want to propose a different time and keep my original booking until everyone agrees to the change.

### A request selects one future booking and one viable slot

An explicit request names the existing and proposed start in New York local time. The member must still be an accepted participant in exactly one future booking in this app. The new time differs from the original and must still leave the normal meeting lead time. Require a public venue with applicable booking hours and recheck current participants and conflicts. Fixed public events and private venues keep their existing arrangement.

```quint
pure val rescheduleDraftLifetimeMs: int = 24 * 3600000

pure def rescheduleTimeEligible(now: int, originalAt: int, proposedAt: int, minimumLead: int, viable: bool): bool =
  originalAt > now and proposedAt != originalAt and minimumLead > 0 and proposedAt - now >= minimumLead and viable

pure def rescheduleDeadline(now: int, originalAt: int, proposedAt: int, minimumLead: int): int =
  val lifetimeEnd = now + rescheduleDraftLifetimeMs
  val latest = proposedAt - minimumLead
  val bookingEnd = if (originalAt < latest) originalAt else latest
  if (bookingEnd < lifetimeEnd) bookingEnd else lifetimeEnd

pure def rescheduleDraftCurrent(bookingCurrent: bool, exactOriginal: bool, exactRoster: bool, exactRevision: bool,
    viableSlot: bool, now: int, expiresAt: int): bool =
  bookingCurrent and exactOriginal and exactRoster and exactRevision and viableSlot and now < expiresAt
```

### Only independent answers to the current offer can change the booking

Save the original revision, both times, the current roster, the deadline and each member's own decision. An answer identifies the member's own exact offer in a direct turn. Each participant, including the requester, must explicitly accept the proposed time. A decline, an expired offer, or a changed booking, roster or safety check leaves the old time in place. A successful unanimous decision commits one time revision and retains the venue. Queued offers and change notices require their exact current booking state at admission.

```quint
type RescheduleDecision = RejectVote | KeepOriginal | AwaitParticipants | CommitNewTime

pure def rescheduleVote(ownAnswer: bool, currentOffer: bool, exactRecipientOffer: bool,
    repeated: bool, accepted: bool, yesAfter: int, rosterSize: int): RescheduleDecision =
  if (not(ownAnswer) or not(currentOffer) or not(exactRecipientOffer) or repeated) RejectVote
  else if (not(accepted)) KeepOriginal
  else if (rosterSize >= 2 and yesAfter == rosterSize) CommitNewTime
  else AwaitParticipants

pure def lawRescheduleNeedsEveryParticipant(ownAnswer: bool, currentOffer: bool, exactRecipientOffer: bool,
    repeated: bool, accepted: bool, yesAfter: int, rosterSize: int): bool =
  rescheduleVote(ownAnswer, currentOffer, exactRecipientOffer, repeated, accepted, yesAfter, rosterSize) == CommitNewTime
    implies (ownAnswer and currentOffer and exactRecipientOffer and not(repeated) and accepted and rosterSize >= 2 and yesAfter == rosterSize)

pure def lawExpiredRescheduleCannotCommit(ownAnswer: bool, exactRecipientOffer: bool,
    repeated: bool, accepted: bool, yesAfter: int, rosterSize: int): bool =
  rescheduleVote(ownAnswer, false, exactRecipientOffer, repeated, accepted, yesAfter, rosterSize) != CommitNewTime
```

### The original booking notice belongs to the original confirmed seat

A queued or replayed original booking notice needs a current scheduled booking and the recipient's confirmed seat. A revised time has its own notice. A closed booking or seat cannot send its original details again.

```quint
pure def originalBookingNoticeCurrent(scheduled: bool, confirmedSeat: bool, originalRevision: bool): bool =
  scheduled and confirmedSeat and originalRevision
```
