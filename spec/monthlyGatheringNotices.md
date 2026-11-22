# Monthly gathering reminders and attendance prompt

## Story: Hear about a gathering I reserved and say whether I attended

> As a Network member with a current RSVP, I want permitted reminders and a private way to confirm whether I attended.

### Each notice needs the exact current RSVP and its own send window

The approved New York gathering and the member's exact RSVP must remain current. A withdrawn RSVP, a member who has lost eligibility, or a stopped rollout closes future notices. Keep one day-before reminder from 24 hours to 12 hours before start and one near reminder in the remaining window. Aim for three hours before start or the last permitted earlier tick. Check the current public venue and time before sending either reminder. The attendance prompt can go from one hour through 24 hours after the approved end, before the member has submitted an attendance answer. It asks a question without presuming the member or anybody else attended or that the event took place.

```quint
type GatheringNoticeKind = GatheringDayBefore | GatheringNearStart | GatheringAttendancePrompt

pure val monthlyGatheringNoticePrefix: str = "monthly-gathering-notice:"
pure val gatheringAttendancePromptDelayMs = 3600000
pure val gatheringAttendancePromptLimitMs = 24 * 3600000

pure def gatheringNoticeWindow(kind: GatheringNoticeKind, reminderWindow: bool, sinceEnd: int): bool =
  if (kind == GatheringAttendancePrompt)
    gatheringAttendancePromptDelayMs <= sinceEnd and sinceEnd < gatheringAttendancePromptLimitMs
  else reminderWindow

pure def gatheringNoticeAllowed(rollout: bool, exactApproval: bool, currentRsvp: bool, currentRecipient: bool,
    insideWindow: bool, currentVenue: bool, hasAttendanceAnswer: bool, kind: GatheringNoticeKind): bool =
  rollout and exactApproval and currentRsvp and currentRecipient and insideWindow and
    (if (kind == GatheringAttendancePrompt) not(hasAttendanceAnswer) else currentVenue)

pure def lawGatheringNoticeNeverFollowsWithdrawal(rollout: bool, exactApproval: bool, currentRecipient: bool,
    insideWindow: bool, currentVenue: bool, hasAttendanceAnswer: bool, kind: GatheringNoticeKind): bool =
  not(gatheringNoticeAllowed(rollout, exactApproval, false, currentRecipient, insideWindow, currentVenue, hasAttendanceAnswer, kind))
```

### The queue always verifies the exact notice and its current authority

A reminder or attendance question concerns a member's own RSVP. Use the normal booked logistics timing and attention rules. Keep the body fixed and run the ordinary leak, consent, quiet-hours and line checks. Each notice has one stable identity for the exact event, revision, recipient and kind. At final claim, check the exact stored message, payload, window and eligibility again. A staged or delivered prompt does not record an attendance answer.

```quint
pure def gatheringNoticeMayClaim(authorityCurrent: bool, exactPayload: bool, matchingMessage: bool): bool =
  authorityCurrent and exactPayload and matchingMessage

pure def lawGatheringNoticeCannotClaimChangedPayload(authorityCurrent: bool, matchingMessage: bool): bool =
  not(gatheringNoticeMayClaim(authorityCurrent, false, matchingMessage))
```
