# Reschedule a booked meeting

[Story F17](product/stories.md#story-f17--schedule-a-meeting) requires fresh consent for a changed time. The shell owns the signed turn, the current app's booking, the exact local-time parsing, venue hours, availability, persistence, and dispatch.

## Story: Change the time only when everyone agrees

> As a participant, I want to propose a different time and keep my original booking until everyone agrees to the change.

### A request selects one future booking and one viable slot

An explicit request names the existing and proposed start in New York local time. The member must still be an accepted participant in exactly one future booking in this app. The new time differs from the original and must still leave the normal meeting lead time. Require a public venue with applicable booking hours and recheck current participants and conflicts. Fixed public events and private venues keep their existing arrangement. The offer expires at the earliest of three times: 24 hours after the request, the original start, and the latest time that still leaves the lead time before the proposed start. A request whose offer would already be expired is refused. A saved offer stays current only while the booking, its original start, its roster, its revision and the proposed slot are unchanged and the offer has not expired.

```quint
pure val rescheduleDraftLifetimeMs: int = 24 * 3600000

pure def rescheduleBookingSelected(matchingBookings: int): bool = matchingBookings == 1

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

Save the original revision, both times, the current roster, the deadline and each member's own decision. An answer identifies the member's own exact offer in a direct turn. Require a positive delivery receipt for that offer and recipient. The signed receive time must be at or after the receipt and no later than handling. A staged or failed send cannot authorize a vote. Each participant, including the requester, must explicitly accept the proposed time. A decline, an expired offer, or a changed booking, roster or safety check leaves the old time in place. A successful unanimous decision commits one time revision and retains the venue. Queued offers and change notices require their exact current booking state at admission.

```quint
type RescheduleDecision = RejectVote | KeepOriginal | AwaitParticipants | CommitNewTime

pure def rescheduleAnswerAfterReceipt(exactReceipt: bool, acceptedAt: int, receivedAt: int, handledAt: int): bool =
  exactReceipt and 0 <= acceptedAt and acceptedAt <= receivedAt and receivedAt <= handledAt

pure def lawStagedRescheduleOfferCannotAuthorizeAnswer(acceptedAt: int, receivedAt: int, handledAt: int): bool =
  not(rescheduleAnswerAfterReceipt(false, acceptedAt, receivedAt, handledAt))

pure def lawEarlyRescheduleAnswerCannotCommit(acceptedAt: int, receivedAt: int, handledAt: int): bool =
  receivedAt < acceptedAt implies not(rescheduleAnswerAfterReceipt(true, acceptedAt, receivedAt, handledAt))

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

A queued or replayed original booking notice needs a future scheduled booking and the recipient's confirmed seat. A revised time has its own notice. At or after the start, a held original notice cannot send and a signed replay cannot return its details, even while the booking is still scheduled for attendance.

```quint
pure def originalBookingNoticeCurrent(scheduled: bool, confirmedSeat: bool, originalRevision: bool, remainingMs: int): bool =
  scheduled and confirmedSeat and originalRevision and remainingMs > 0

pure def lawBookingStartEndsOriginalNotice(scheduled: bool, confirmedSeat: bool, originalRevision: bool): bool =
  not(originalBookingNoticeCurrent(scheduled, confirmedSeat, originalRevision, 0))
```

### A named booking notice still needs every recorded seat

Record the roster from the notice when its text is created. On queued delivery and signed replay, require the recipient to be on that roster and every recorded member to still accept this booking. Another member's acceptance is independent of whether their own notice has left quiet hours. A new accepted seat does not invalidate an earlier notice. A withdrawal withholds a staged notice that names the departing member, even when the remaining group can continue. An older staged group notice without a recorded roster cannot establish current consent to disclose every name. Erasure clears the stored roster and the notice that names the removed member.

If an unstaged group notice waited for quiet hours and its recorded roster is no longer current, make a new notice for the same future booking and accepted recipient from the seats that still accept. Use the same time and place and check the recipients again before staging. When the old text described the original group, use general booking copy for the current group.

```quint
pure def bookingNoticeRosterCurrent(groupBooking: bool, recordedRoster: bool, includesRecipient: bool, recordedSeatsAccepted: bool): bool =
  if (recordedRoster) includesRecipient and recordedSeatsAccepted else not(groupBooking)

pure def lawWithdrawnSeatPreventsNotice(groupBooking: bool, includesRecipient: bool): bool =
  not(bookingNoticeRosterCurrent(groupBooking, true, includesRecipient, false))

pure def lawUnboundGroupNoticeCannotSend(includesRecipient: bool, recordedSeatsAccepted: bool): bool =
  not(bookingNoticeRosterCurrent(true, false, includesRecipient, recordedSeatsAccepted))
```
