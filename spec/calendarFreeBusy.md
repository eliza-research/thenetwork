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


### Exchange fresh proofs for one member of one app

The calendar service first proves the owner with a current verified Cloud account and its selected connection. Its signed owner request binds those identifiers to the member's verified phone and exact app. The Network returns a short-lived proof only when the same adult membership still allows calendars. Its reply contains the opaque person and member IDs, bound to the full request.

Before reviewed scheduling work, the Network asks for one current scoped observation using only opaque person and member IDs, purpose, nonce and coverage. Both directions require the dedicated calendar service signature. Each successful response is bound to its request and expires within thirty seconds. The authority rechecks selected connection and scheduling consent before responding. HTTP errors, a wrong person, stale or out-of-window intervals, and revocation leave the unit without calendar evidence. The Network reloads its own consent before use and drops the in-memory observation at the end of the scheduling unit. A delayed enable cannot undo a newer disable. At the same event time, disable wins.

```quint
pure val calendarOwnerPath = "/internal/calendar-scheduling-owner"
pure val calendarPreloadPath = "/api/internal/network/calendar-scheduling"
pure val calendarAuthorityLifetimeMs = 30 * 1000

pure def calendarBridgeProofCurrent(signed: bool, exactRequest: bool, exactOwner: bool, issuedAt: int, expiresAt: int, now: int): bool =
  signed and exactRequest and exactOwner and issuedAt >= 0 and issuedAt <= now and now < expiresAt and expiresAt - issuedAt <= calendarAuthorityLifetimeMs

pure def calendarBridgeOwnerAllowed(currentAdult: bool, localOptIn: bool, exactCanonicalMember: bool): bool =
  currentAdult and localOptIn and exactCanonicalMember

pure def calendarPreferenceMayApply(incomingAt: int, previousAt: int, requestedOn: bool, previouslyEnabled: bool): bool =
  incomingAt >= 0 and (incomingAt > previousAt or (incomingAt == previousAt and not(requestedOn) and previouslyEnabled))

pure def lawCalendarBridgeProofNeedsExactOwner(signed: bool, exactRequest: bool, issuedAt: int, expiresAt: int, now: int): bool =
  not(calendarBridgeProofCurrent(signed, exactRequest, false, issuedAt, expiresAt, now))
```

### A scheduling read uses only the seats still involved in that work

Skip members who declined, withdrew or became unavailable for the opportunity. A booked reschedule uses only the accepted roster. Work on a late plan seat can use the accepted roster and the still-pending invitees. A direct member turn may read a booked plan with a pending seat only when that member has a pending seat or is rescheduling an accepted seat.

```quint
pure val statusValues = Set("", "queued", "probing", "available", "unavailable", "yes", "no", "dropped")

pure def calendarPreloadSeatAllowed(status: str, booked: bool, pendingLateSeat: bool): bool =
  status != "unavailable" and status != "no" and status != "dropped" and
    (not(booked) or status == "yes" or pendingLateSeat)

pure def lawCalendarDoesNotReadRetiredSeat(booked: bool, pendingLateSeat: bool): bool =
  not(calendarPreloadSeatAllowed("dropped", booked, pendingLateSeat))
```

## Service contract

The Network owns `POST /internal/calendar-scheduling-owner`. Eliza Cloud calls it after verifying the Cloud account, its phone, and the chosen owned Google connection. The signed JSON request contains `app`, `e164`, `organizationId`, `userId`, `connectionId`, `purpose`, and `nonce`. The HMAC ID is `calendar-owner:<nonce>`. A successful response contains `app`, `personId`, `memberId`, `purpose`, `requestSha256`, `issuedAt`, and `expiresAt`.

Eliza Cloud must implement `POST /api/internal/network/calendar-scheduling`. That request contains `app`, `personId`, `memberId`, `purpose`, `nonce`, and `coverage` with integer `start` and `end`. The HMAC ID is `calendar-read:<nonce>`. The response uses the same owner proof fields plus `grant` and `observation`. The grant contains `app`, `memberId`, `purpose`, `provider`, `connectionId`, `active`, `grantedAt`, and `expiresAt`. The observation contains `app`, `memberId`, `purpose`, `provider`, `connectionId`, `observedAt`, `coverage`, and `busy`. Every interval has only `start` and `end`. All timestamps are Unix milliseconds, the connection and nonce are UUIDs, and the provider is `google_calendar`. Use the purpose `network-scheduling-free-busy-v1` for both requests. A response may cover less than the requested window. The host treats the rest as unknown.

Sign the exact path and raw body with `NETWORK_CALENDAR_FREE_BUSY_SECRET` using the existing service HMAC envelope. Both responses use the original request ID followed by `:proof` and bind the SHA-256 of the raw request body. The Network checks the signature and rejects replays to another request. The service preloads up to twelve known, opted-in participants for relevant reviewed scheduling at a time. The opt-in command alone makes no remote request. Provider revocation takes effect on the next preload. Within a scheduling unit, a proof can expire before work advances. Neither the observation nor the provider grant is saved.
