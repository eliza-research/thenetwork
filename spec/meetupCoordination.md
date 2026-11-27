# Meetup arrival coordination, failover, and follow-up timing

On-site arrival coordination, safety exits, no-show escalation, backup-venue pivots, anchor failover, and post-meetup follow-ups follow strict adult, consent, quiet-hour, and cap rules.

## Story: Coordinate safe on-site arrivals and backup pivots

> As a confirmed adult attendee, I want timely arrival updates, immediate halt on panic or block, no-show relief, and seamless backup pivots when a venue is closed or full.

### Map relative meetup minutes to lifecycle phases

Minutes relative to scheduled start map to `"before"` (`< -75`), `"pre_brief"` (`[-75, -30)`), `"active_arrival"` (`[-30, 45]`), and `"closed"` (`> 45`).

```quint
pure def meetupPhase(minutesFromStart: int): str =
  if (minutesFromStart < -75) "before"
  else if (minutesFromStart < -30) "pre_brief"
  else if (minutesFromStart <= 45) "active_arrival"
  else "closed"

pure def lawMeetupPhasePartition(minutesFromStart: int): bool =
  val p = meetupPhase(minutesFromStart)
  (p == "before" or p == "pre_brief" or p == "active_arrival" or p == "closed")
    and (minutesFromStart < -75 implies p == "before")
    and ((minutesFromStart >= -75 and minutesFromStart < -30) implies p == "pre_brief")
    and ((minutesFromStart >= -30 and minutesFromStart <= 45) implies p == "active_arrival")
    and (minutesFromStart > 45 implies p == "closed")

pure val minutesFromStartValues = Set(-90, -75, -45, -30, 0, 15, 45, 60)
```

### Halt arrival relay immediately on panic, block, or any minor in the event

Allow an arrival relay only when neither panic nor block is triggered, no minor is in the event, both sender and recipient are confirmed adults (18 to 120) who have not opted out, the meetup is in `"active_arrival"`, they have not already met, and the message passed leak and safety checks. Multi-person event co-attendance is strictly 18+, while minors (13 to 17) are limited to solo suggestions.

```quint
type ArrivalRelaySafeInput = {
  senderAge: int,
  recipientAge: int,
  anyMinorInEvent: bool,
  senderConfirmed: bool,
  recipientConfirmed: bool,
  blocked: bool,
  panicTriggered: bool,
  senderOptedOut: bool,
  recipientOptedOut: bool,
  minutesFromStart: int,
  alreadyMet: bool,
  passedSafetyAndLeakCheck: bool
}

pure def canRelayArrivalSafe(r: ArrivalRelaySafeInput): bool =
  not(r.panicTriggered)
    and not(r.blocked)
    and not(r.anyMinorInEvent)
    and r.senderAge >= 18
    and r.senderAge <= 120
    and r.recipientAge >= 18
    and r.recipientAge <= 120
    and r.senderConfirmed
    and r.recipientConfirmed
    and not(r.senderOptedOut)
    and not(r.recipientOptedOut)
    and meetupPhase(r.minutesFromStart) == "active_arrival"
    and not(r.alreadyMet)
    and r.passedSafetyAndLeakCheck

pure def canAttendEventOrCoattend(
  participantAge: int,
  anyMinorInGroup: bool,
  isSoloSuggestion: bool
): bool =
  participantAge >= 13
    and participantAge <= 120
    and (isSoloSuggestion or (participantAge >= 18 and not(anyMinorInGroup)))

pure def lawPanicOrBlockImmediatelyHaltsRelay(r: ArrivalRelaySafeInput): bool =
  (r.panicTriggered or r.blocked) implies not(canRelayArrivalSafe(r))

pure def lawNoMinorInArrivalRelayOrCoattend(r: ArrivalRelaySafeInput): bool =
  (r.anyMinorInEvent or r.senderAge < 18 or r.recipientAge < 18) implies not(canRelayArrivalSafe(r))

pure def lawNoMinorInAnyEventOrCoattend(participantAge: int, anyMinorInGroup: bool): bool =
  (participantAge < 18 or anyMinorInGroup) implies not(canAttendEventOrCoattend(participantAge, anyMinorInGroup, false))

pure val rValues = Set(
  {
    senderAge: 28, recipientAge: 29, anyMinorInEvent: false, senderConfirmed: true, recipientConfirmed: true,
    blocked: false, panicTriggered: false, senderOptedOut: false, recipientOptedOut: false,
    minutesFromStart: 0, alreadyMet: false, passedSafetyAndLeakCheck: true
  },
  {
    senderAge: 28, recipientAge: 29, anyMinorInEvent: false, senderConfirmed: true, recipientConfirmed: true,
    blocked: false, panicTriggered: true, senderOptedOut: false, recipientOptedOut: false,
    minutesFromStart: 0, alreadyMet: false, passedSafetyAndLeakCheck: true
  },
  {
    senderAge: 17, recipientAge: 29, anyMinorInEvent: true, senderConfirmed: true, recipientConfirmed: true,
    blocked: false, panicTriggered: false, senderOptedOut: false, recipientOptedOut: false,
    minutesFromStart: 0, alreadyMet: false, passedSafetyAndLeakCheck: true
  }
)
```

### Escalate late arrivals at 12 minutes and free waiting attendees by 18 minutes

When someone has arrived and the other attendee has not checked in, ping the late attendee at or after 12 minutes and notify the waiting attendee at or after 18 minutes.

```quint
pure def noShowDecision(
  minutesAfterStart: int,
  someArrived: bool,
  otherCheckedIn: bool,
  pingSent: bool,
  waitingNotified: bool
): str =
  if (not(someArrived) or otherCheckedIn)
    "none"
  else if (minutesAfterStart >= 18 and not(waitingNotified))
    "notify_waiting"
  else if (minutesAfterStart >= 12 and not(pingSent))
    "ping_late"
  else
    "none"

pure def lawNoShowNotifiesWaiterBy18m(
  minutesAfterStart: int,
  pingSent: bool
): bool =
  minutesAfterStart >= 18 implies noShowDecision(minutesAfterStart, true, false, pingSent, false) == "notify_waiting"

pure def lawNoShowSilentBefore12m(
  minutesAfterStart: int,
  someArrived: bool,
  otherCheckedIn: bool,
  pingSent: bool,
  waitingNotified: bool
): bool =
  minutesAfterStart < 12 implies noShowDecision(minutesAfterStart, someArrived, otherCheckedIn, pingSent, waitingNotified) == "none"

pure val minutesAfterStartValues = Set(-5, 0, 11, 12, 15, 18, 25)
```

### Pivot to backup on closed or full venue, but quarantine only on closure

A reported closed or full venue pivots once to a pre-verified backup during `"pre_brief"` or `"active_arrival"`. Only a reported closure quarantines the venue; a full venue logs crowding without closure quarantine.

```quint
pure def shouldPivotToBackupV2(
  venueReportedClosed: bool,
  venueReportedFull: bool,
  hasVerifiedBackup: bool,
  minutesFromStart: int,
  alreadyPivoted: bool
): bool =
  val phase = meetupPhase(minutesFromStart)
  (venueReportedClosed or venueReportedFull)
    and hasVerifiedBackup
    and not(alreadyPivoted)
    and (phase == "pre_brief" or phase == "active_arrival")

pure def shouldQuarantineVenue(venueReportedClosed: bool, venueReportedFull: bool): bool =
  venueReportedClosed

pure def lawVenueFullTriggersBackupPivotWithoutQuarantine(minutesFromStart: int): bool =
  val p = meetupPhase(minutesFromStart)
  ((p == "pre_brief" or p == "active_arrival") implies shouldPivotToBackupV2(false, true, true, minutesFromStart, false))
    and not(shouldQuarantineVenue(false, true))
```

## Story: Protect anchor failover, quorum cutoffs, and follow-up limits

> As an organizer or attendee, I want anchor drops reassigned or cancelled cleanly before travel, and post-meetup follow-ups sent only during safe hours within daily caps.

### Promote a co-anchor or cancel cleanly on anchor drop or low T-24h quorum

When zero confirmed anchors remain, promote a backup Network member if at least one backup exists and total confirmed attendees are at least 3; otherwise cancel cleanly. When one anchor remains within 24 hours with fewer than 3 approved external RSVPs and fewer than 3 Network members, cancel early for low quorum.

```quint
type AnchorFailoverInput = {
  confirmedAnchors: int,
  backupNetworkMembers: int,
  totalConfirmed: int,
  hoursToStart: int,
  approvedExternalRsvps: int,
  totalNetworkMembers: int
}

pure def anchorFailoverDecision(a: AnchorFailoverInput): str =
  if (a.confirmedAnchors <= 0)
    if (a.backupNetworkMembers >= 1 and a.totalConfirmed >= 3) "promote_co_anchor"
    else "cancel_cleanly"
  else if (
    a.confirmedAnchors == 1
      and a.hoursToStart <= 24
      and a.approvedExternalRsvps < 3
      and a.totalNetworkMembers < 3
  )
    "cancel_low_quorum"
  else
    "proceed"

pure def lawAnchorDropReassignedOrCancelled(a: AnchorFailoverInput): bool =
  a.confirmedAnchors <= 0 implies
    (anchorFailoverDecision(a) == "promote_co_anchor" or anchorFailoverDecision(a) == "cancel_cleanly")

pure def lawQuorumOrCleanCancelBeforeCutoff(a: AnchorFailoverInput): bool =
  (a.confirmedAnchors == 1 and a.hoursToStart <= 24 and a.approvedExternalRsvps < 3 and a.totalNetworkMembers < 3) implies
    anchorFailoverDecision(a) == "cancel_low_quorum"

pure val aValues = Set(
  { confirmedAnchors: 0, backupNetworkMembers: 1, totalConfirmed: 4, hoursToStart: 12, approvedExternalRsvps: 4, totalNetworkMembers: 2 },
  { confirmedAnchors: 0, backupNetworkMembers: 0, totalConfirmed: 4, hoursToStart: 12, approvedExternalRsvps: 4, totalNetworkMembers: 1 },
  { confirmedAnchors: 1, backupNetworkMembers: 0, totalConfirmed: 2, hoursToStart: 20, approvedExternalRsvps: 2, totalNetworkMembers: 1 },
  { confirmedAnchors: 1, backupNetworkMembers: 1, totalConfirmed: 5, hoursToStart: 20, approvedExternalRsvps: 4, totalNetworkMembers: 2 }
)
```

### Schedule follow-ups outside quiet hours and enforce opt-out and daily caps

Daytime endings (`7..16`) follow up two hours later the same day (preserving the ending minute in `computeFollowupLocalSlot`); early endings (`0..6`) follow up at 9:30 AM same day; evening endings (`> 16`) follow up at 9:30 AM the next day. No follow-up sends during quiet hours, outside `9..19`, after opt-out, after response, at or above 3 daily proactive messages, or at or above 2 attempts.

```quint
type FollowupSlot = {
  localHour: int,
  localMinute: int,
  nextDay: bool
}

type FollowupSendInput = {
  optedOut: bool,
  inQuietHours: bool,
  localHour: int,
  dailyProactiveCount: int,
  remindersSent: int,
  alreadyResponded: bool
}

pure def computeFollowupLocalHour(eventEndLocalHour: int): FollowupSlot =
  if (eventEndLocalHour > 16)
    { localHour: 9, localMinute: 30, nextDay: true }
  else if (eventEndLocalHour < 7)
    { localHour: 9, localMinute: 30, nextDay: false }
  else
    { localHour: eventEndLocalHour + 2, localMinute: 0, nextDay: false }

pure def computeFollowupLocalSlot(eventEndLocalHour: int, eventEndLocalMinute: int): FollowupSlot =
  val safeMinute = if (eventEndLocalMinute >= 0 and eventEndLocalMinute < 60) eventEndLocalMinute else 0
  if (eventEndLocalHour > 16)
    { localHour: 9, localMinute: 30, nextDay: true }
  else if (eventEndLocalHour < 7)
    { localHour: 9, localMinute: 30, nextDay: false }
  else
    { localHour: eventEndLocalHour + 2, localMinute: safeMinute, nextDay: false }

pure def canSendFollowup(f: FollowupSendInput): bool =
  not(f.optedOut)
    and not(f.inQuietHours)
    and f.localHour >= 9
    and f.localHour < 20
    and f.dailyProactiveCount >= 0
    and f.dailyProactiveCount < 3
    and f.remindersSent >= 0
    and f.remindersSent < 2
    and not(f.alreadyResponded)

pure def lawFollowupSlotAlwaysInSafeDayHours(eventEndLocalHour: int): bool =
  val slot = computeFollowupLocalHour(eventEndLocalHour)
  (eventEndLocalHour >= 0 and eventEndLocalHour <= 23) implies
    (slot.localHour >= 9 and slot.localHour < 20 and (slot.localMinute == 0 or slot.localMinute == 30))

pure def lawFollowupLocalSlotAlwaysInSafeDayHours(eventEndLocalHour: int, eventEndLocalMinute: int): bool =
  val slot = computeFollowupLocalSlot(eventEndLocalHour, eventEndLocalMinute)
  (eventEndLocalHour >= 0 and eventEndLocalHour <= 23 and eventEndLocalMinute >= 0 and eventEndLocalMinute < 60) implies
    (slot.localHour >= 9 and slot.localHour < 20 and slot.localMinute >= 0 and slot.localMinute < 60)

pure def lawFollowupNeverDuringQuietHoursOrOverCap(f: FollowupSendInput): bool =
  canSendFollowup(f) implies
    (not(f.optedOut) and not(f.inQuietHours) and f.localHour >= 9 and f.localHour < 20 and f.dailyProactiveCount < 3 and f.remindersSent < 2 and not(f.alreadyResponded))

pure val eventEndLocalHourValues = Set(0, 6, 7, 12, 16, 17, 21, 23)
pure val eventEndLocalMinuteValues = Set(0, 15, 30, 50, 59)
pure val fValues = Set(
  { optedOut: false, inQuietHours: false, localHour: 10, dailyProactiveCount: 1, remindersSent: 0, alreadyResponded: false },
  { optedOut: true, inQuietHours: false, localHour: 10, dailyProactiveCount: 0, remindersSent: 0, alreadyResponded: false },
  { optedOut: false, inQuietHours: true, localHour: 21, dailyProactiveCount: 0, remindersSent: 0, alreadyResponded: false },
  { optedOut: false, inQuietHours: false, localHour: 11, dailyProactiveCount: 3, remindersSent: 0, alreadyResponded: false }
)
```
