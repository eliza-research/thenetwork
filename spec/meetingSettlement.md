# Booked meeting settlement

The [opportunity model](models/opportunity.md) follows a booked meeting through confirmation and cancellation. The [plan run model](models/plan_run.md) covers group plans, and the [capital model](models/notify_capital.md) records attendance and feedback events. The Network supplies delivery, time, and feedback evidence from the stored opportunity. It sends messages and writes ledger events in their existing order.

## Story: Confirm a booked meeting after the details arrive

> As a participant, I want the Network to record my confirmation once it has told me the meeting details.

### Confirmation needs an accepted invitation and a delivered booking

Record confirmation once. A participant can confirm in words. A participant also confirms when the opt-out window expires or the meeting starts. A later confirmation in words still records the participant's explicit reply without emitting another confirmation.

```quint
pure val confirmationWindowHours = 48
pure val confirmationWindowMs = confirmationWindowHours * 3600000

type ConfirmationChanges = { recordWords: bool, emitConfirmation: bool }

pure def confirmationChanges(accepted: bool, bookingDelivered: bool, wordsRecorded: bool, confirmed: bool, explicitReply: bool): ConfirmationChanges =
  val eligible = accepted and bookingDelivered
  { recordWords: eligible and explicitReply and not(wordsRecorded), emitConfirmation: eligible and not(confirmed) }

pure def silentConfirmationDue(accepted: bool, bookingDelivered: bool, confirmed: bool, elapsedMs: int, meetingStarted: bool): bool =
  accepted and bookingDelivered and not(confirmed) and (elapsedMs >= confirmationWindowMs or meetingStarted)

pure def lawConfirmedDoesNotRepeat(accepted: bool, bookingDelivered: bool, wordsRecorded: bool, explicitReply: bool): bool =
  not(confirmationChanges(accepted, bookingDelivered, wordsRecorded, true, explicitReply).emitConfirmation)
```

## Story: Hear about a booked meeting the day before

> As a booked participant, I want a reminder early enough to plan for the meeting.

### A day-before reminder has its own send window

Start at 24 hours before the meeting. The day-before reminder can wait for the member's quiet hours to end before the 12-hour cutoff. Recheck the window, current schedule and accepted seat when a queued reminder is claimed. Check that the member already received the booking details. Aim to send the near-meeting reminder three hours before the meeting, or at the last available tick if the member's window would be closed then. The near reminder uses the period after the day-before cutoff. A job introduction has no booked meeting for the Network to remind people about. The usual contact and content rules apply.

```quint
pure val dayBeforeReminderStartMs = 24 * 3600000
pure val dayBeforeReminderEndMs = 12 * 3600000
pure val nearMeetingReminderLeadMs = 3 * 3600000

pure def dayBeforeReminderWindow(remainingMs: int): bool =
  remainingMs <= dayBeforeReminderStartMs and remainingMs > dayBeforeReminderEndMs

pure def nearMeetingReminderWindow(remainingMs: int): bool =
  remainingMs > 0 and remainingMs <= dayBeforeReminderEndMs

pure def dayBeforeReminderDue(accepted: bool, bookingDelivered: bool, earlySent: bool, remainingMs: int): bool =
  accepted and bookingDelivered and not(earlySent) and dayBeforeReminderWindow(remainingMs)

pure def lawDayBeforeReminderFollowsBooking(accepted: bool, earlySent: bool, remainingMs: int): bool =
  not(dayBeforeReminderDue(accepted, false, earlySent, remainingMs))

pure def lawDayBeforeReminderDoesNotRepeat(accepted: bool, bookingDelivered: bool, remainingMs: int): bool =
  not(dayBeforeReminderDue(accepted, bookingDelivered, true, remainingMs))
```

## Story: Check whether a booked participant is still coming

> As a booked participant, I want a light check-in on the day of the meeting so I can report a change or a delay.

### The day-of check-in uses one near-meeting message

If the near reminder falls on the meeting's local day, ask whether the participant is still coming and tell them they can report a delay or change. The check-in uses the same message slot as the near reminder. A reminder sent on the previous day stays informational. Keep an unrelated pending question intact. Use the existing booked reply when its slot is free or already refers to this meeting. Bind that reply to the meeting's current schedule. Require a positive receipt for the exact check-in and accept only an answer received at or after receipt, within the current check-in window and no later than handling. The participant can still use an explicit cancellation under the [booking selector](opportunityLifecycle.md). Sending the check-in and receiving no reply leave the confirmation and attendance rules as they were. A replacement schedule gets its own reminder IDs. The queue checks both the current schedule and the check-in window before delivery.

```quint
pure def dayOfCheckInWindow(sameLocalDay: bool, remainingMs: int): bool =
  sameLocalDay and nearMeetingReminderWindow(remainingMs)

pure def dayOfCheckInDue(sameLocalDay: bool, replySlotAvailable: bool, remainingMs: int): bool =
  replySlotAvailable and dayOfCheckInWindow(sameLocalDay, remainingMs)

pure def dayOfCheckInAnswerCurrent(exactReceipt: bool, acceptedAt: int, receivedAt: int, handledAt: int): bool =
  exactReceipt and 0 <= acceptedAt and acceptedAt <= receivedAt and receivedAt <= handledAt

pure def lawPendingCheckInCannotAuthorizeAnswer(acceptedAt: int, receivedAt: int, handledAt: int): bool =
  not(dayOfCheckInAnswerCurrent(false, acceptedAt, receivedAt, handledAt))

pure def lawEarlyCheckInAnswerCannotChangeBooking(acceptedAt: int, receivedAt: int, handledAt: int): bool =
  receivedAt < acceptedAt implies not(dayOfCheckInAnswerCurrent(true, acceptedAt, receivedAt, handledAt))

pure def lawDayOfCheckInNeedsAFutureMeeting(sameLocalDay: bool, replySlotAvailable: bool, remainingMs: int): bool =
  dayOfCheckInDue(sameLocalDay, replySlotAvailable, remainingMs) implies (sameLocalDay and remainingMs > 0)
```

## Story: Ask for feedback and close attendance once

> As a participant, I want the Network to wait until after the meeting before asking how it went, then settle attendance once it has the available answers.

### A feedback request opens the attendance period

A scheduled meeting becomes ready for feedback three hours after its start, if the Network has not already requested it. A stored opportunity that is done can resume attendance collection. Attendance closes after every still-accepted participant has responded or four days have passed since the meeting started.

```quint
type SettlementPhase = BeforeFeedback | AwaitingAttendance | SettlementComplete
type MeetingSettlement = { phase: SettlementPhase }

pure val initial: MeetingSettlement = { phase: BeforeFeedback }
pure val feedbackDelayHours = 3
pure val settlementDelayDays = 4

pure def restoreAttendance(resolved: bool): MeetingSettlement =
  { phase: if (resolved) SettlementComplete else AwaitingAttendance }

pure def canRequestFeedback(s: MeetingSettlement, unsent: bool, asOf: int, feedbackAt: int): bool =
  s.phase == BeforeFeedback and unsent and asOf >= feedbackAt
pure def requestFeedback(s: MeetingSettlement, unsent: bool, asOf: int, feedbackAt: int): MeetingSettlement =
  { phase: AwaitingAttendance }

pure def canResolveAttendance(s: MeetingSettlement, timedOut: bool, everyoneResponded: bool): bool =
  s.phase == AwaitingAttendance and (timedOut or everyoneResponded)
pure def resolveAttendance(s: MeetingSettlement, timedOut: bool, everyoneResponded: bool): MeetingSettlement =
  { phase: SettlementComplete }

pure val asOfValues = Set(0, 1, 2)
pure val feedbackAtValues = Set(1, 2)

pure def stepSettlementStaysClosed(before: MeetingSettlement, after: MeetingSettlement): bool =
  before.phase == SettlementComplete implies after.phase == SettlementComplete
pure def sometimesResolvesAttendance(s: MeetingSettlement): bool = s.phase == SettlementComplete
```

### Classify each attendee from the available reports

Only participants with an accepted invitation and a delivered booking count as booked. A participant who said they did not come is a no-show. Otherwise the Network counts attendance when the participant said they came, a counterpart who came says nobody was missing, or the organizer's check-in counts them. Only an attendee with a reply gets a feedback entry. A booked participant in a pair reported missing without an explicit confirmation is recorded as ghosted. If that participant explicitly confirmed, the Network records a no-show. Across pairs and groups, a participant left unaccounted for with no reply gets a reliability no-show when someone who came reported a missing participant.

```quint
type AttendanceMark = Attended | Absent | Ghosted | NoFinding
type AttendanceEvidence = {
  saidAttended: bool, saidAbsent: bool, hasFeedback: bool, counterpartVerified: bool,
  organizerVerified: bool, pairMeeting: bool, reportedMissing: bool, explicitReply: bool,
}
type AttendanceFinding = { mark: AttendanceMark, logFeedback: bool, reliabilityNoShow: bool }

pure def deliveredInvitee(accepted: bool, bookingDelivered: bool): bool = accepted and bookingDelivered

pure def countAttendance(evidence: AttendanceEvidence): AttendanceFinding =
  val mark =
    if (evidence.saidAttended or (not(evidence.saidAbsent) and (evidence.counterpartVerified or evidence.organizerVerified))) Attended
    else if (evidence.saidAbsent) Absent
    else if (evidence.pairMeeting and evidence.reportedMissing) (if (evidence.explicitReply) Absent else Ghosted)
    else NoFinding
  { mark: mark, logFeedback: mark == Attended and evidence.hasFeedback,
    reliabilityNoShow: mark != Attended and not(evidence.hasFeedback) and evidence.reportedMissing }
```

### A host's check-in uses the host's response

A host who was booked and says they came can verify attendance. If the host reports missing people, count only other booked participants who say they came and whom the host did not name as missing. Otherwise use the host's attendance list if given. If the host gave no names, count other booked participants who did not say they missed the meeting.

```quint
type CheckInSource = NoCheckIn | MissingNames | PresentNames | BookedParticipants

pure def organizerCanVerify(booked: bool, came: bool): bool = booked and came

pure def chooseCheckIn(hostResponded: bool, hostReportsMissing: bool, hasNames: bool): CheckInSource =
  if (not(hostResponded)) NoCheckIn
  else if (hostReportsMissing) MissingNames
  else if (hasNames) PresentNames
  else BookedParticipants

pure def counterpartConfirmsAttendance(came: bool, reportsMissing: bool): bool = came and not(reportsMissing)

pure def requestAttendanceSatisfied(requesterAttended: bool, anotherAttended: bool): bool =
  requesterAttended and anotherAttended
```
