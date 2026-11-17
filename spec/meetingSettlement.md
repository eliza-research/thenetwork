# Booked meeting settlement

The [opportunity model](models/opportunity.md) follows a booked meeting through confirmation and cancellation. The [plan run model](models/plan_run.md) covers group plans, and the [capital model](models/notify_capital.md) records attendance and feedback events. The Network supplies delivery, time, and feedback evidence from the stored opportunity. It sends messages and writes ledger events in their existing order.

## Story: Confirm a booked meeting after the details arrive

> As a participant, I want the Network to record my confirmation once it has told me the meeting details.

### Confirmation needs an accepted invitation and a delivered booking

Record confirmation once. A participant can confirm in words. A participant also confirms when the 48-hour opt-out window expires or the meeting starts. A later confirmation in words still records the participant's explicit reply without emitting another confirmation.

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

Start at 24 hours before the meeting. The day-before reminder can wait for the member's quiet hours to end before the 12-hour cutoff. Recheck the window, current schedule and accepted seat when a queued reminder is claimed. Aim to send the near-meeting reminder three hours before the meeting, or at the last available tick if the member's window would be closed then. The near reminder uses the period after the day-before cutoff. A job introduction has no booked meeting for the Network to remind people about. The usual contact and content rules apply.

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

### Claim a reminder only after the member received the current booking notice

The reminder claim requires a positive provider or signed gateway receipt for this member's booking notice. A rescheduled meeting requires the notice for its current revision. A pending notice puts the reminder back in the queue with the same key while the window remains open. Refuse a reminder when the notice is absent or refused, the booking or seat is no longer current, or the window closes.

```quint
type ReminderClaim = SendReminder | WaitForBookingNotice | RefuseReminder
pure val bookingNoticeRetryMs = 5 * 60000

pure def bookingNoticeReceived(receiptStatus: str, sentAt: int, checkedAt: int): bool =
  (receiptStatus == "accepted" or receiptStatus == "sent" or receiptStatus == "delivered" or receiptStatus == "read")
    and 0 <= sentAt and sentAt <= checkedAt

pure def queuedReminderClaim(bookingCurrent: bool, noticeAccepted: bool, noticePending: bool): ReminderClaim =
  if (not(bookingCurrent)) RefuseReminder
  else if (noticeAccepted) SendReminder
  else if (noticePending) WaitForBookingNotice
  else RefuseReminder

pure def lawReminderClaimNeedsNotice(bookingCurrent: bool, noticePending: bool): bool =
  queuedReminderClaim(bookingCurrent, false, noticePending) != SendReminder

pure def lawReminderCannotWaitOnExpiredBooking(noticeAccepted: bool, noticePending: bool): bool =
  queuedReminderClaim(false, noticeAccepted, noticePending) == RefuseReminder

pure def lawFutureBookingReceiptIsNotEvidence(receiptStatus: str, sentAt: int, checkedAt: int): bool =
  sentAt > checkedAt implies not(bookingNoticeReceived(receiptStatus, sentAt, checkedAt))
```

### Claim a cancellation only for a member who received booking details

A recorded booking notice can be waiting in the queue. Require positive provider or signed gateway receipt for the same app, opportunity and member before sending a terminal cancellation. Receipt of the original booking or any committed updated schedule qualifies, since the participant may still expect to meet. An invitation, an offer to move the meeting, or a notice that never left the queue is insufficient. If the booking notice was already handed off and its receipt can still arrive, retry the same cancellation before the start. Keep the content neutral.

```quint
type BookedCancellationClaim = SendCancellation | WaitForCancellationReceipt | RefuseCancellation

pure def bookingNoticeReceiptMayArrive(receiptStatus: str): bool =
  receiptStatus == "collected" or receiptStatus == "send_unknown" or receiptStatus == "sending" or receiptStatus == "unknown_acceptance"

pure def queuedBookingCancellationClaim(cancellationCurrent: bool, noticeAccepted: bool, receiptMayArrive: bool): BookedCancellationClaim =
  if (not(cancellationCurrent)) RefuseCancellation
  else if (noticeAccepted) SendCancellation
  else if (receiptMayArrive) WaitForCancellationReceipt
  else RefuseCancellation

pure def lawCancellationClaimNeedsReceipt(cancellationCurrent: bool, receiptMayArrive: bool): bool =
  queuedBookingCancellationClaim(cancellationCurrent, false, receiptMayArrive) != SendCancellation

pure def lawStaleCancellationCannotWait(noticeAccepted: bool, receiptMayArrive: bool): bool =
  queuedBookingCancellationClaim(false, noticeAccepted, receiptMayArrive) == RefuseCancellation
```

## Story: Check whether a booked participant is still coming

> As a booked participant, I want a light check-in on the day of the meeting so I can report a change or a delay.

### The day-of check-in uses one near-meeting message

If the near reminder falls on the meeting's local day, ask whether the participant is still coming and tell them they can report a delay or change. The check-in uses the same message slot as the near reminder. A reminder sent on the previous day stays informational. Keep an unrelated pending question intact. Use the existing booked reply when its slot is free or already refers to this meeting. Bind that reply to the meeting's current schedule. Accept it only while that schedule is current and the check-in window is open: on the meeting's local day, at most 12 hours before the meeting and before it starts. Require a positive receipt for the exact check-in and accept only an answer received at or after receipt and no later than handling. The participant can still use an explicit cancellation under the [booking selector](opportunityLifecycle.md). Sending the check-in and receiving no reply leave the confirmation and attendance rules as they were. A replacement schedule gets its own reminder IDs. The queue checks both the current schedule and the check-in window before delivery.

```quint
pure def dayOfCheckInWindow(sameLocalDay: bool, remainingMs: int): bool =
  sameLocalDay and nearMeetingReminderWindow(remainingMs)

pure def dayOfCheckInDue(sameLocalDay: bool, replySlotAvailable: bool, remainingMs: int): bool =
  replySlotAvailable and dayOfCheckInWindow(sameLocalDay, remainingMs)

pure def dayOfReplyAccepted(currentSchedule: bool, sameLocalDay: bool, remainingMs: int): bool =
  currentSchedule and dayOfCheckInWindow(sameLocalDay, remainingMs)

pure def lawDayOfReplyNeedsCurrentScheduleBeforeStart(currentSchedule: bool, sameLocalDay: bool, remainingMs: int): bool =
  dayOfReplyAccepted(currentSchedule, sameLocalDay, remainingMs) implies (currentSchedule and remainingMs > 0)

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

### Send feedback requests during the open attendance period

Completion opens the period when a feedback request can go out. Assign one request per opportunity, schedule revision and participant. Before delivery, verify the exact stored request, the completed opportunity, the participant's accepted seat and receipt of the current booked schedule. The participant must not have answered, and attendance must still be open. If a booking notice already went to a carrier or signed gateway and its result is unresolved, retry the same request while the period remains open. A queued booking notice that never left the service is insufficient. Keep consent, quiet hours and text safety in effect.

```quint
type MeetingFeedbackClaim = SendMeetingFeedback | WaitForMeetingBookingReceipt | RefuseMeetingFeedback
pure val meetingFeedbackPrefix = "meeting-feedback:"
pure val feedbackDelayMs = feedbackDelayHours * 3600000
pure val settlementDelayMs = settlementDelayDays * 86400000

pure def meetingFeedbackWindow(elapsedMs: int): bool =
  elapsedMs >= feedbackDelayMs and elapsedMs < settlementDelayMs

pure def queuedMeetingFeedbackClaim(completeAndOpen: bool, acceptedSeat: bool, exactRequest: bool, elapsedMs: int, receivedBooking: bool, receiptMayArrive: bool): MeetingFeedbackClaim =
  if (not(completeAndOpen and acceptedSeat and exactRequest and meetingFeedbackWindow(elapsedMs))) RefuseMeetingFeedback
  else if (receivedBooking) SendMeetingFeedback
  else if (receiptMayArrive) WaitForMeetingBookingReceipt
  else RefuseMeetingFeedback

pure def lawFeedbackClaimNeedsBookingReceipt(completeAndOpen: bool, acceptedSeat: bool, exactRequest: bool, elapsedMs: int, receiptMayArrive: bool): bool =
  queuedMeetingFeedbackClaim(completeAndOpen, acceptedSeat, exactRequest, elapsedMs, false, receiptMayArrive) != SendMeetingFeedback

pure def lawClosedAttendanceStopsFeedbackClaim(acceptedSeat: bool, exactRequest: bool, elapsedMs: int, receivedBooking: bool, receiptMayArrive: bool): bool =
  queuedMeetingFeedbackClaim(false, acceptedSeat, exactRequest, elapsedMs, receivedBooking, receiptMayArrive) == RefuseMeetingFeedback
```

### A feedback reply needs receipt of its exact prompt

Take feedback from the participant's own text about the current completed booking. Accept one answer per participant. Require a positive receipt of that participant's exact prompt for this opportunity and schedule revision. The text must arrive at or after receipt and by the time it is handled. A late answer can enter private feedback within seven days of the meeting. Once attendance settles or its four-day period expires, a late answer cannot change attendance, reliability, capital or crew formation. A member can report a safety issue through the independent report flow at any time it permits.

```quint
pure val meetingFeedbackReplyMs = 7 * 86400000

pure def meetingFeedbackCandidate(completed: bool, acceptedSeat: bool, alreadyAnswered: bool, elapsedMs: int): bool =
  completed and acceptedSeat and not(alreadyAnswered) and elapsedMs >= feedbackDelayMs and elapsedMs < meetingFeedbackReplyMs

pure def meetingFeedbackReplyAllowed(ownText: bool, currentCandidate: bool, exactReceipt: bool, acceptedAt: int, receivedAt: int, handledAt: int): bool =
  ownText and currentCandidate and dayOfCheckInAnswerCurrent(exactReceipt, acceptedAt, receivedAt, handledAt)

pure def meetingFeedbackCanSettle(finalized: bool, receivedElapsedMs: int, handledElapsedMs: int): bool =
  not(finalized) and meetingFeedbackWindow(receivedElapsedMs) and meetingFeedbackWindow(handledElapsedMs)

pure def lawFeedbackReplyNeedsReceipt(ownText: bool, currentCandidate: bool, acceptedAt: int, receivedAt: int, handledAt: int): bool =
  not(meetingFeedbackReplyAllowed(ownText, currentCandidate, false, acceptedAt, receivedAt, handledAt))

pure def lawFeedbackReplyCannotReopenAttendance(receivedElapsedMs: int, handledElapsedMs: int): bool =
  not(meetingFeedbackCanSettle(true, receivedElapsedMs, handledElapsedMs))
```

### Classify each attendee from the available reports

Only participants with an accepted invitation and a delivered booking count as booked. At settlement, use a positive receipt for the participant's exact current booking revision. A queued notice and an unresolved receipt are insufficient. A delayed positive receipt counts if available when attendance settles. A participant who said they did not come is a no-show. Otherwise the Network counts attendance when the participant said they came, a counterpart who came says nobody was missing, or the organizer's check-in counts them. Only an attendee with a reply gets a feedback entry. A booked participant in a pair who received the feedback prompt on time and is reported missing without an explicit confirmation is recorded as ghosted. If that participant explicitly confirmed, the Network records a no-show. In pairs and groups, a missing-participant report can affect an unaccounted participant's reliability only if that participant received the feedback prompt on time and did not reply.

```quint
type AttendanceMark = Attended | Absent | Ghosted | NoFinding
type AttendanceEvidence = {
  saidAttended: bool, saidAbsent: bool, hasFeedback: bool, counterpartVerified: bool,
  organizerVerified: bool, pairMeeting: bool, reportedMissing: bool, explicitReply: bool, receivedFeedbackPrompt: bool,
}
type AttendanceFinding = { mark: AttendanceMark, logFeedback: bool, reliabilityNoShow: bool }

pure def deliveredInvitee(accepted: bool, bookingDelivered: bool): bool = accepted and bookingDelivered

pure def attendanceBookingReceived(accepted: bool, exactReceipt: bool, receiptAt: int, settledAt: int): bool =
  deliveredInvitee(accepted, exactReceipt and receiptAt >= 0 and receiptAt <= settledAt)

pure def lawAttendanceNeedsExactBookingReceipt(accepted: bool, receiptAt: int, settledAt: int): bool =
  not(attendanceBookingReceived(accepted, false, receiptAt, settledAt))

pure def countAttendance(evidence: AttendanceEvidence): AttendanceFinding =
  val corroboratedMissing = evidence.reportedMissing and evidence.receivedFeedbackPrompt
  val mark =
    if (evidence.saidAttended or (not(evidence.saidAbsent) and (evidence.counterpartVerified or evidence.organizerVerified))) Attended
    else if (evidence.saidAbsent) Absent
    else if (evidence.pairMeeting and corroboratedMissing) (if (evidence.explicitReply) Absent else Ghosted)
    else NoFinding
  { mark: mark, logFeedback: mark == Attended and evidence.hasFeedback,
    reliabilityNoShow: mark != Attended and not(evidence.hasFeedback) and corroboratedMissing }
```

### A host's check-in uses the host's response

A host who was booked and says they came can verify attendance. If the host reports missing people, count only other booked participants who say they came and whom the host did not name as missing. Otherwise use the host's attendance list if given. If the host gave no names, count other booked participants who did not say they missed the meeting. A member request counts as fulfilled only when the requester and at least one other participant attended.

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

### Verified value needs an independent attendance confirmation

A worthwhile answer records the member's own experience during the open attendance period. At settlement, only another attendee's timely reply to their own delivered feedback prompt can corroborate that the meeting took place. The second member must explicitly confirm that the pair met or that the whole group attended. Positive sentiment by itself supplies no attendance confirmation. Count only receipt-backed attendees as confirmers and keep the existing ledger checks on vouch eligibility and relationships.

```quint
pure def verifiedMeetingValueAllowed(attended: bool, worthwhile: bool, independentConfirmers: int): bool =
  attended and worthwhile and independentConfirmers > 0

pure def lawMeetingValueCannotConfirmItself(attended: bool, worthwhile: bool): bool =
  not(verifiedMeetingValueAllowed(attended, worthwhile, 0))
```
