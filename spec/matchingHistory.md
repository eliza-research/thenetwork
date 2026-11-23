# Matching history follows recorded replies and attendance

## Story: Use what each invitee did

> As an invitee, I want my response to affect my matching history and the meeting to follow its recorded booking and attendance.

### Preserve a booked or held group and record individual refusals

An attendance record sets the result and identifies who attended. A booked
meeting retains its recorded roster while it waits for attendance. A delivered
refusal has its own timestamp. It cannot replace the booking or the attendance
result. Only a pair involving a recorded refusal gets the refusal's pair
history. Legacy records without recorded refusal times retain their pair
history.

```quint
type MatchingHistoryOutcome =
  | HistoryCompleted
  | HistoryNoShow
  | HistoryBooked
  | HistoryDeclined
  | HistoryExpired
  | HistoryInviting

pure def matchingHistoryOutcome(attendance: bool, held: bool, booked: bool, declined: bool, expired: bool): MatchingHistoryOutcome =
  if (attendance) {
    if (held) HistoryCompleted else HistoryNoShow
  } else if (booked) HistoryBooked
  else if (declined) HistoryDeclined
  else if (expired) HistoryExpired
  else HistoryInviting

type MatchingPairHistory =
  | HistoryRecordedPair
  | HistoryRefusedPair
  | HistoryOmittedPair

pure def matchingPairHistory(rosterPair: bool, pairHasRefusal: bool, unconfirmedGroupDeclined: bool): MatchingPairHistory =
  if (pairHasRefusal) HistoryRefusedPair
  else if (rosterPair and not(unconfirmedGroupDeclined)) HistoryRecordedPair
  else HistoryOmittedPair

pure def lawAttendanceKeepsHeldGroup(booked: bool, declined: bool, expired: bool): bool =
  matchingHistoryOutcome(true, true, booked, declined, expired) == HistoryCompleted

pure def lawBookedGroupKeepsItsBooking(declined: bool, expired: bool): bool =
  matchingHistoryOutcome(false, false, true, declined, expired) == HistoryBooked

pure def lawPairRefusalRequiresARecordedRefusal(rosterPair: bool, unconfirmedGroupDeclined: bool): bool =
  matchingPairHistory(rosterPair, false, unconfirmedGroupDeclined) != HistoryRefusedPair
```

### Apply a category cooldown to the person whose answer is known

For an expired invite with a response record, use only members who received
an invite and did not answer it in time. An empty response record applies no
category cooldown. For old expired records without response records, use the
legacy participant list. A separate explicit refusal applies at its recorded
time.

```quint
pure def matchingExpiryCooldown(knownResponses: bool, recipientDidNotReply: bool, listedParticipant: bool): bool =
  if (knownResponses) recipientDidNotReply else listedParticipant

pure def lawKnownExpiryRequiresARecipientWithoutAReply(listedParticipant: bool): bool =
  not(matchingExpiryCooldown(true, false, listedParticipant))
```
