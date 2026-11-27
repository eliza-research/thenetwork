# Post-encounter follow-up timing and send limits

Post-encounter follow-ups respect local quiet hours, evening deferral to the next morning, member opt-out, the 3-per-day proactive message cap, and reminder limits.

## Story: Schedule follow-ups outside quiet hours

> As a member who finished a meeting, I want follow-up messages to arrive during daytime hours and never late at night.

### Daytime encounters follow up two hours later and evening encounters wait until morning

A work introduction follows up at 10:00 local time. For non-work encounters ending after 16:00 local time, the follow-up waits until 09:00 the next morning. Daytime encounters ending at or before 16:00 follow up two hours after the end time, clamped so the hour never falls before 09:00 or at or after 20:00.

```quint
pure val followupQuietEndHour: int = 9
pure val followupQuietStartHour: int = 20
pure val followupEveningCutoffHour: int = 16
pure val workIntroFollowupHour: int = 10

pure def followupIsNextDay(endLocalHour: int): bool =
  endLocalHour > followupEveningCutoffHour

pure def computeFollowupLocalHour(endLocalHour: int, isWorkIntro: bool): int =
  if (isWorkIntro) workIntroFollowupHour
  else if (followupIsNextDay(endLocalHour)) followupQuietEndHour
  else if (endLocalHour + 2 < followupQuietEndHour) followupQuietEndHour
  else endLocalHour + 2

pure def lawFollowupHourOutsideQuietHours(endLocalHour: int, isWorkIntro: bool): bool =
  val hour = computeFollowupLocalHour(endLocalHour, isWorkIntro)
  hour >= followupQuietEndHour and hour < followupQuietStartHour

pure def lawEveningEncounterDefersToNextMorning(endLocalHour: int): bool =
  endLocalHour > followupEveningCutoffHour implies (
    followupIsNextDay(endLocalHour) and computeFollowupLocalHour(endLocalHour, false) == followupQuietEndHour)

pure def lawWorkIntroFollowsUpAtTen(endLocalHour: int): bool =
  computeFollowupLocalHour(endLocalHour, true) == workIntroFollowupHour

pure val endLocalHourValues = Set(0, 6, 7, 10, 14, 16, 17, 20, 23)
```

## Story: Enforce opt-out, quiet hours, and message caps before sending

> As a member, I want the Network to stop sending follow-ups when I opt out, during quiet hours, or once my daily or reminder limit is reached.

### Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2

A follow-up can send only when the member has not opted out, the current local time is outside quiet hours, the daily proactive count is below both the requested daily cap and the hard maximum of 3, and reminders sent are below both the requested reminder limit and the hard maximum of 2.

```quint
pure val maxFollowupDailyCap: int = 3
pure val maxFollowupReminders: int = 2

pure def canSendFollowup(
  optedOut: bool,
  isQuietHours: bool,
  dailyProactiveCount: int,
  dailyCap: int,
  remindersSent: int,
  maxReminders: int
): bool =
  val effectiveDailyCap = if (dailyCap > maxFollowupDailyCap) maxFollowupDailyCap else dailyCap
  val effectiveMaxReminders = if (maxReminders > maxFollowupReminders) maxFollowupReminders else maxReminders
  not(optedOut)
    and not(isQuietHours)
    and dailyProactiveCount >= 0
    and dailyProactiveCount < effectiveDailyCap
    and remindersSent >= 0
    and remindersSent < effectiveMaxReminders

pure def lawOptedOutNeverGetsFollowup(
  isQuietHours: bool, dailyProactiveCount: int, dailyCap: int, remindersSent: int, maxReminders: int
): bool =
  not(canSendFollowup(true, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders))

pure def lawQuietHoursNeverSendsFollowup(
  optedOut: bool, dailyProactiveCount: int, dailyCap: int, remindersSent: int, maxReminders: int
): bool =
  not(canSendFollowup(optedOut, true, dailyProactiveCount, dailyCap, remindersSent, maxReminders))

pure def lawDailyCapNeverExceedsThree(
  optedOut: bool, isQuietHours: bool, dailyProactiveCount: int, dailyCap: int, remindersSent: int, maxReminders: int
): bool =
  canSendFollowup(optedOut, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders)
    implies (dailyProactiveCount < maxFollowupDailyCap and dailyProactiveCount < dailyCap)

pure def lawRemindersNeverExceedTwo(
  optedOut: bool, isQuietHours: bool, dailyProactiveCount: int, dailyCap: int, remindersSent: int, maxReminders: int
): bool =
  canSendFollowup(optedOut, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders)
    implies (remindersSent < maxFollowupReminders and remindersSent < maxReminders)

pure val dailyProactiveCountValues = Set(-1, 0, 1, 2, 3, 4)
pure val dailyCapValues = Set(0, 1, 2, 3, 5)
pure val remindersSentValues = Set(-1, 0, 1, 2, 3)
pure val maxRemindersValues = Set(0, 1, 2, 4)
```
