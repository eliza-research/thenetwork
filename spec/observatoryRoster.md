# Observatory opportunity rosters

## Story: F35 — Inspect a member's experience as staff

The authorized staff view shows the participant and alternate evidence that the Network recorded for the opportunity. It keeps these two lists as separate fields.

### A replacement uses the Network's recorded roster

Use the participant and alternate lists taken when the Network replaces a seat. A backfill can add a participant without replacing an existing entry. For an older replacement without roster lists, add the incoming entry once or substitute it for the outgoing entry, and remove the incoming entry from the alternates.

```quint
pure def replacementRosterMode(recordedRoster: bool, outgoingSeat: bool, incomingAlreadyListed: bool): str =
  if (recordedRoster) "recorded"
  else if (outgoingSeat) "substitute"
  else if (incomingAlreadyListed) "retain" else "append"

pure def lawReplacementPrefersRecorded(outgoingSeat: bool, incomingAlreadyListed: bool): bool =
  replacementRosterMode(true, outgoingSeat, incomingAlreadyListed) == "recorded"

pure def lawLegacyBackfillAddsOnce(incomingAlreadyListed: bool): bool =
  replacementRosterMode(false, false, incomingAlreadyListed) ==
    (if (incomingAlreadyListed) "retain" else "append")
```

### A probe closure keeps the final alternate evidence

Use the final alternate list when a probe closure carries it. An older closure without that list keeps the last known list. Updating the alternate evidence can apply to an already closed opportunity and leaves its terminal state unchanged.

```quint
pure def closedProbeUpdate(terminal: bool, recordedAlternates: bool): bool =
  not(terminal) or recordedAlternates

pure def lawClosedReplayWithoutRosterKeepsTerminal(terminal: bool): bool =
  closedProbeUpdate(terminal, false) == not(terminal)
```

### A held meeting needs two attendees

Count a completed meeting for staff only when at least two participants attended. Count it once for each attendee. Keep a person's attendance record when they were the only one to show, but leave it out of held-meeting and enjoyment counts. In the database view, use a completed or feedback-collected opportunity and its recorded participant attendance.

Count an enjoyment sample only when the attendee supplied a stored rating.
A zero rating contributes one sample. An absent rating contributes no
sample and leaves the attendance count in place.

```quint
pure val heldMeetingMinimum: int = 2

pure def observatoryMeetingHeld(attendees: int): bool =
  attendees >= heldMeetingMinimum

pure def lawOneAttendeeIsNotAHeldMeeting(attendees: int): bool =
  attendees <= 1 implies not(observatoryMeetingHeld(attendees))
```

### Reviewed offers contribute to a member's proposal activity after approval

Count a participant's opportunity once after approval. Pending, rejected, expired, and invalidated reviews supply no proposal activity. Keep an earlier published offer if the exact app, opportunity and member have positive evidence of an outbound probe or invitation. It must belong to a recorded approval. Keep existing proposal activity for historical opportunities without a review record. The opportunity inventory is separate from member proposal activity.

```quint
pure def observatoryProposalCounts(reviewed: bool, approved: bool, invalidated: bool, published: bool): bool =
  not(reviewed) or (approved and (not(invalidated) or published))

pure def lawPendingReviewCannotAddProposal(approved: bool, invalidated: bool, published: bool): bool =
  not(approved) implies not(observatoryProposalCounts(true, approved, invalidated, published))
```

### A due cancelled booking remains in completion

The completion rate uses bookings whose meeting start has arrived. A scheduled, completed, feedback-collected, abandoned, or cancelled booking with a recorded start can enter that count. A cancellation before booking or before the recorded start supplies no completion evidence. Only a held meeting counts as completed.

```quint
pure def observatoryCompletionBooking(bookingStage: str, hasStart: bool, start: int, now: int): bool =
  hasStart and start <= now and (bookingStage == "SCHEDULED" or bookingStage == "COMPLETED" or
    bookingStage == "FEEDBACK_COLLECTED" or bookingStage == "ABANDONED" or bookingStage == "CANCELLED")

pure def lawFutureBookingCannotCountForCompletion(bookingStage: str, hasStart: bool, start: int, now: int): bool =
  start > now implies not(observatoryCompletionBooking(bookingStage, hasStart, start, now))
```
