# Requested calendar invitations

## Story: Add my booked meeting to my calendar

> As a booked participant, I want a calendar file for the meeting I asked about.

### The member asks for one current booking

In a signed conversation the member can ask for a calendar invite, optionally with the meeting's exact New York date and 24-hour time. The sender must own a current adult membership in this app. Only a future meeting with a confirmed seat and a booking notice recorded for that seat is eligible. A calendar invite is available for one matching meeting with a public venue. If several match, ask which one the member means.

```quint
type CalendarChoice = PickBooking | AskForBooking | NoBooking

pure def calendarMeetingEligible(currentAdult: bool, scheduled: bool, confirmedSeat: bool, bookingTold: bool, publicVenue: bool, remainingMs: int): bool =
  currentAdult and scheduled and confirmedSeat and bookingTold and publicVenue and remainingMs > 0

pure def calendarChoice(matches: int): CalendarChoice =
  if (matches == 1) PickBooking else if (matches > 1) AskForBooking else NoBooking

pure def lawCalendarNeedsBookingNotice(currentAdult: bool, scheduled: bool, confirmedSeat: bool, publicVenue: bool, remainingMs: int): bool =
  not(calendarMeetingEligible(currentAdult, scheduled, confirmedSeat, false, publicVenue, remainingMs))
```

### A calendar link follows the booked revision and the current owner

The signed reply and the app-scoped download grant commit together. The link expires after 15 minutes or at the meeting start, whichever comes first. Recheck the phone, member, opt-in, booking and exact start and revision on each download and replay. The owner is current only when the grant's phone still owns the same active, opted-in adult membership. The file contains the public time and venue. It has no guest list, contact details, or private context.

```quint
pure val calendarInviteLifetimeMs = 15 * 60000
pure val calendarInvitePath = "/api/calendar/invite"

pure def calendarInviteExpiresAt(issuedAt: int, startAt: int): int =
  if (startAt < issuedAt + calendarInviteLifetimeMs) startAt else issuedAt + calendarInviteLifetimeMs

pure def calendarDownloadAllowed(currentOwner: bool, currentBooking: bool, sameStart: bool, sameRevision: bool, now: int, expiresAt: int): bool =
  currentOwner and currentBooking and sameStart and sameRevision and now < expiresAt

pure def lawCalendarLinkExpires(currentOwner: bool, currentBooking: bool, sameStart: bool, sameRevision: bool, expiresAt: int): bool =
  not(calendarDownloadAllowed(currentOwner, currentBooking, sameStart, sameRevision, expiresAt, expiresAt))

pure def lawCalendarLinkNeedsCurrentOwner(currentBooking: bool, sameStart: bool, sameRevision: bool, now: int, expiresAt: int): bool =
  not(calendarDownloadAllowed(false, currentBooking, sameStart, sameRevision, now, expiresAt))

pure def lawCalendarLinkEndsByStartAndLifetime(issuedAt: int, startAt: int): bool =
  calendarInviteExpiresAt(issuedAt, startAt) <= startAt
    and calendarInviteExpiresAt(issuedAt, startAt) <= issuedAt + calendarInviteLifetimeMs
```
