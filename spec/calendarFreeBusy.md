# Authorized calendar free/busy

[Story F17](product/stories.md#story-f17--schedule-a-meeting) uses calendar availability as private scheduling evidence. The calendar authority supplies an explicit scheduling grant and an observation from its exact connection. The Network supplies the local member consent and applies the resulting signal only when choosing or rechecking times.

## Story: Use my authorized calendar to choose a time

> As a member, I want the Network to consider when I am busy after I opt in, without reading or sharing what is on my calendar.

### Read only current anonymous intervals for the exact authorized connection

A current adult member must opt in within the app. The trusted calendar authority must supply an active Google Calendar grant for this member, app, connection and the scheduling free/busy purpose. The observation must come from that exact grant's connection on or after its grant time and be less than five minutes old. It contains a coverage interval of at most eight days and no more than 256 busy intervals wholly inside that coverage. The authority omits the grant once it is revoked. Missing authority, an inactive grant, or a malformed observation contributes no signal. The Network does not persist or share provider or event data.

```quint
pure val calendarSchedulingPurpose = "network-scheduling-free-busy-v1"
pure val calendarSource = "google_calendar"
pure val calendarObservationMaxAgeMs = 5 * 60000
pure val calendarCoverageMaxMs = 8 * 86400000
pure val calendarBusyIntervalLimit = 256

pure def calendarGrantCurrent(localOptIn: bool, eligibleOwner: bool, connectionCurrent: bool, exactScope: bool, grantedAt: int, expiresAt: int, now: int): bool =
  localOptIn and eligibleOwner and connectionCurrent and exactScope and grantedAt >= 0 and grantedAt <= now and now < expiresAt

pure def calendarObservationFresh(observedAt: int, now: int): bool =
  observedAt >= 0 and observedAt <= now and now - observedAt < calendarObservationMaxAgeMs

pure def calendarObservationCurrent(exactScope: bool, anonymous: bool, grantedAt: int, observedAt: int, now: int): bool =
  exactScope and anonymous and grantedAt <= observedAt and calendarObservationFresh(observedAt, now)

pure def calendarCoverageAllowed(start: int, end: int, busyCount: int): bool =
  start >= 0 and start < end and end - start <= calendarCoverageMaxMs and busyCount >= 0 and busyCount <= calendarBusyIntervalLimit

pure def calendarIntervalWithin(outerStart: int, outerEnd: int, start: int, end: int): bool =
  outerStart <= start and start < end and end <= outerEnd

pure def lawCalendarNeedsLocalConsent(eligibleOwner: bool, connectionCurrent: bool, exactScope: bool, grantedAt: int, expiresAt: int, now: int): bool =
  not(calendarGrantCurrent(false, eligibleOwner, connectionCurrent, exactScope, grantedAt, expiresAt, now))
```

### A known busy interval excludes the slot and incomplete coverage cannot make it free

Compare half-open intervals. A current busy interval excludes an overlapping slot in offers, bookings and rescheduling. Only complete coverage without a busy overlap gives a free signal. Missing, stale, expired or incomplete information is unknown where it has no busy overlap. Unknown falls back to existing scheduling information. Calendar availability alone does not enable new outreach.

```quint
type CalendarSignal = CalendarUnknown | CalendarBusy | CalendarFree

pure def calendarIntervalsOverlap(slotStart: int, slotEnd: int, busyStart: int, busyEnd: int): bool =
  slotStart < slotEnd and busyStart < busyEnd and busyStart < slotEnd and slotStart < busyEnd

pure def calendarSignal(valid: bool, overlapsBusy: bool, completeCoverage: bool): CalendarSignal =
  if (not(valid)) CalendarUnknown
  else if (overlapsBusy) CalendarBusy
  else if (completeCoverage) CalendarFree
  else CalendarUnknown

pure def lawCalendarIncompleteCoverageIsNeverFree(valid: bool, overlapsBusy: bool): bool =
  calendarSignal(valid, overlapsBusy, false) != CalendarFree
```
