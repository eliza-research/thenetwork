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

The reminder claim requires a positive provider or signed gateway receipt for this member's booking notice. A rescheduled meeting requires the notice for its current revision. A pending notice puts the reminder back in the queue with the same key while the window remains open. A notice is pending while it waits in the queue, waits for leak review, or was handed off and its receipt can still arrive. A receipt can still arrive for a notice that is sending, whose provider acceptance is unknown, or that a signed turn gave to the gateway. A gateway reply whose acceptance passed the receipt deadline (failed unknown) can still get a late turn receipt. A provider send whose acceptance passed the deadline cannot, because the queue does not look it up again. Refuse a reminder when the notice is absent or refused, the booking or seat is no longer current, or the window closes. Changed 2026-11-22: the reminder claim computed part of the pending decision in the service, and every failed unknown notice counted as one whose receipt can arrive, also a provider send that nothing looks up again, so the claims retried until their cutoff for no reason.

```quint
type ReminderClaim = SendReminder | WaitForBookingNotice | RefuseReminder
pure val bookingNoticeRetryMs = 5 * 60000

pure val receiptStatusValues = Set("pending", "parked_leak_review", "collected", "unknown_acceptance", "failed_unknown", "accepted", "refused_gateway")

pure def bookingNoticeReceived(receiptStatus: str, sentAt: int, checkedAt: int): bool =
  (receiptStatus == "accepted" or receiptStatus == "sent" or receiptStatus == "delivered" or receiptStatus == "read")
    and 0 <= sentAt and sentAt <= checkedAt

pure def bookingNoticeReceiptMayArrive(receiptStatus: str, gatewayReply: bool): bool =
  receiptStatus == "collected" or receiptStatus == "send_unknown" or receiptStatus == "sending" or receiptStatus == "unknown_acceptance"
    or (receiptStatus == "failed_unknown" and gatewayReply)

pure def bookingNoticePending(receiptStatus: str, gatewayReply: bool): bool =
  receiptStatus == "pending" or receiptStatus == "retry_scheduled" or receiptStatus == "deferred_quiet_hours"
    or receiptStatus == "held_awaiting_reply" or receiptStatus == "parked_leak_review"
    or bookingNoticeReceiptMayArrive(receiptStatus, gatewayReply)

pure def lawExpiredProviderNoticeGetsNoReceipt(receiptStatus: str): bool =
  receiptStatus == "failed_unknown" implies not(bookingNoticePending(receiptStatus, false))

pure def lawExpiredGatewayNoticeMayGetReceipt(receiptStatus: str): bool =
  receiptStatus == "failed_unknown" implies bookingNoticeReceiptMayArrive(receiptStatus, true)

pure def lawArrivingReceiptIsPending(receiptStatus: str, gatewayReply: bool): bool =
  bookingNoticeReceiptMayArrive(receiptStatus, gatewayReply) implies bookingNoticePending(receiptStatus, gatewayReply)

pure def lawReceivedNoticeIsNotPending(receiptStatus: str, gatewayReply: bool): bool =
  bookingNoticeReceived(receiptStatus, 0, 0) implies not(bookingNoticePending(receiptStatus, gatewayReply))

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

A recorded booking notice can be waiting in the queue. Require positive provider or signed gateway receipt for the same app, opportunity and member before sending a terminal cancellation. Receipt of the original booking or any committed updated schedule qualifies, since the participant may still expect to meet. An invitation, an offer to move the meeting, or a notice that never left the queue is insufficient. If the booking notice was already handed off and its receipt can still arrive, retry the same cancellation before the start. A gateway reply whose acceptance passed the receipt deadline (failed unknown) can still get a late turn receipt, so it counts as a receipt that can arrive; a provider send past the same deadline does not. Keep the content neutral. Changed 2026-11-22: a booking notice in a signed turn ended failed unknown six hours after the turn, and the reminder, cancellation and feedback claims then refused for good, also after a late accepted receipt showed that the member got the booking.

```quint
type BookedCancellationClaim = SendCancellation | WaitForCancellationReceipt | RefuseCancellation

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

### Learn a dating availability slot from the booked time

Slop uses completed meeting evidence when it ranks future time options. Read the booked start in the time zone recorded at booking: the meeting venue's time zone, else the zone of the planned meeting, else the New York zone for a place that the Network picked in New York. Keep the time feedback was received for feedback history. An older interaction can use the booked start from its stored opportunity. A completed interaction whose booked meeting is not known gives no slot. An interaction without a booked meeting field (an input from an older caller) uses its own time in the time zone of the member's home city. The synthetic dating world records the booked start and the time zone of the date's city.

```quint
pure def completedMeetingSlot(localWeekday: int, localHour: int): int =
  if (localWeekday < 0 or localWeekday > 6 or localHour < 0 or localHour > 23) -1
  else if (localWeekday < 5) (if (localHour >= 17) localWeekday else -1)
  else if (localWeekday == 5) (if (localHour >= 17) 6 else 5)
  else if (localHour >= 17) 8 else 7

pure def lawWeekdayMeetingSlotNeedsEvening(localWeekday: int, localHour: int): bool =
  (localWeekday < 5 and localHour < 17) implies completedMeetingSlot(localWeekday, localHour) == -1
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

## Story: Choose a report or a block after a meeting that went wrong

> As a member who tells the check-in that something went wrong, I want the Network to ask me once whether to report or block the person, so that I do not have to know the right words.

### A check-in answer that describes a problem asks once whether to report or block

Read the member's answer to the feedback prompt with the existing readers only: the check-in report reader gives a report kind (a cue), and the urgent kinds are harassment, unsafe, scam and minor; the no-show reader gives a no-show cue; the concern reader finds a problem said without a report kind, such as "he made me uncomfortable" or "something felt off", and ignores a denied concern ("I wasn't uncomfortable at all"). A positive or neutral answer, and a negative answer about chemistry only ("we didn't click", "not my type"), is fine and asks nothing. An app that files every cue at once (slop.date and peon.biz, the `postDateReports` hook, for a meeting that is not a group plan) keeps that path. An urgent cue files the report at once in every app, without a question, when the meeting was an adult pair. Otherwise a cue or a concern about the one other attendee of an adult pair gets one question in the member's own thread: whether to report that person to the safety team, block them, or neither. An adult pair is a meeting that is not a group plan, with exactly one other booked attendee, where both people are known adults by the existing age decisions; a minor, an age doubt, or a group plan gets no question and no new urgent path. The question names only the first name that the feedback prompt already named, offers report, block or no, and goes through the leak guard as a direct reply (no pause path, no proactive cap). If the leak guard refuses it, the member gets the ordinary thanks and nothing waits. The Network stores ids and the report kind, never the member's words: the member, the meeting, the person asked about, the kind (the cue, else "other"), and the time of the question. The feedback is kept as feedback whatever the member answers later. Changed (owner decision 2026-11-22): before, a problem said without the word "report" or "block" was kept only as feedback and opened no case in ntwrk.party and friends.help, and a concern without a report kind opened no case in any app; now the member is asked once, and an urgent cue opens the case at once in every app. Changed (owner decision 2026-11-22, answers A2 to A5): a teen pair gets the same steps as an adult pair. A teen pair is a meeting that is not a group plan, with exactly one other booked attendee, of a done teen friendship item whose roster still passes the teen friendship rule at the time of the answer and holds both people. An urgent cue files the report at once, and a cue or a concern gets the one question. The question to a member of a teen pair names nobody: it says "them" in place of the first name. Before, a teen who told the check-in that something went wrong got only the thanks, and no case opened.

```quint
type CheckInReading = CheckInFine | CheckInConcern | CheckInCue | CheckInUrgent
type CheckInSafetyStep = CheckInNoStep | CheckInAsk | CheckInFileNow

pure def checkInReading(cueRead: bool, urgentCue: bool, concernRead: bool): CheckInReading =
  if (cueRead and urgentCue) CheckInUrgent
  else if (cueRead) CheckInCue
  else if (concernRead) CheckInConcern
  else CheckInFine

pure def checkInSafetyStep(reading: CheckInReading, appFilesEveryCue: bool, adultPair: bool, teenPair: bool): CheckInSafetyStep =
  if (reading == CheckInFine) CheckInNoStep
  else if (appFilesEveryCue and reading != CheckInConcern) CheckInFileNow
  else if (not(adultPair or teenPair)) CheckInNoStep
  else if (reading == CheckInUrgent) CheckInFileNow
  else CheckInAsk

pure def lawFineAnswerAsksNothing(appFilesEveryCue: bool, adultPair: bool, teenPair: bool): bool =
  checkInSafetyStep(CheckInFine, appFilesEveryCue, adultPair, teenPair) == CheckInNoStep

pure def lawNoCueAndNoConcernIsFine(urgentCue: bool): bool =
  checkInReading(false, urgentCue, false) == CheckInFine

pure def lawUrgentCueFilesAtOnceInAnAdultPair(appFilesEveryCue: bool): bool =
  checkInSafetyStep(CheckInUrgent, appFilesEveryCue, true, false) == CheckInFileNow

pure def lawUrgentCueIsNeverAsked(appFilesEveryCue: bool, adultPair: bool, teenPair: bool): bool =
  checkInSafetyStep(CheckInUrgent, appFilesEveryCue, adultPair, teenPair) != CheckInAsk

pure def lawCuesStillFileWhereTheyDid(reading: CheckInReading, adultPair: bool, teenPair: bool): bool =
  (reading == CheckInCue or reading == CheckInUrgent) implies checkInSafetyStep(reading, true, adultPair, teenPair) == CheckInFileNow

pure def lawQuestionNeedsAnAdultPair(reading: CheckInReading, appFilesEveryCue: bool): bool =
  checkInSafetyStep(reading, appFilesEveryCue, false, false) != CheckInAsk

pure def lawConcernAsksInAnAdultPair(appFilesEveryCue: bool): bool =
  checkInSafetyStep(CheckInConcern, appFilesEveryCue, true, false) == CheckInAsk

pure def lawTeenPairGetsTheAdultPairStep(reading: CheckInReading, appFilesEveryCue: bool): bool =
  checkInSafetyStep(reading, appFilesEveryCue, false, true) == checkInSafetyStep(reading, appFilesEveryCue, true, false)
```

### The answer to the check-in question acts once, then the question closes

The question waits for the member's next own text (not a reaction, not text from an assistant) for 24 hours, the same window as "Who do you mean?", and the shared line routes a short answer to the app that asked in the same way. While another question of the Network is open in the same thread (an anonymous probe, a day-of check-in for a booked meeting, a crew offer or the weekly check-in), only a text that uses the words report, flag or block answers the check-in question; a bare yes or no goes to the other question and the check-in question stays open. Otherwise any own text closes the question, so it is never asked again. An answer received before the question or handled more than 24 hours after it is not an answer: the question lapses and the feedback stays. The Network reads the answer clause by clause. A clause that ends in a question mark ("Should I report him?") chooses nothing. A clause with a refusal before the word ("I don't want to report him", "rather not block") refuses that choice. "Both" counts only as a whole answer ("both", "both please"), never inside a sentence ("we both moved on"). An answer that says report (also "report and block", "both", or "report him") opens the safety case exactly as a check-in report does: the pair block, the close of the pair's open items, the trust report as someone who met the person, the report with its stored kind, source "check_in" and the meeting, and the urgent hold when the kind is urgent. A report also blocks, so an answer that refuses the block does not choose the report. An answer that says block blocks exactly as "block <name>" does for a person the member met. An answer that says no or neither, or refuses each choice it names, closes the question with a short acknowledgement. An answer that both refuses and chooses ("No, report him") is unclear. A report or block command that names a person other than the person asked about, or a name that matches nobody or more than one person, goes to the ordinary report and block flow. Any other answer is unclear: it opens no case, it is not asked again, and the Network reads the text as an ordinary message. The check-in log keeps flags and ids only, never the member's words. Changed (owner decision 2026-11-22): this answer is new; before, the Network asked nothing after a check-in answer. Changed again (owner decision 2026-11-22, review of the first build): a refusal now wins over a choice, a question or a refused word chooses nothing, and a bare answer goes to another open question, because the first reader filed reports that the member had refused and lost the answers to probes and day-of check-ins.

```quint
type CheckInSafetyAnswer = AnswerReport | AnswerBlock | AnswerNeither | AnswerUnclear

pure val checkInSafetyAnswerMs = 24 * 3600000

pure def checkInSafetyAnswerCurrent(questionAt: int, answerAt: int, answerHandledAt: int): bool =
  questionAt <= answerAt and answerAt <= answerHandledAt and answerHandledAt - questionAt <= checkInSafetyAnswerMs

pure def checkInSafetyAnswerApplies(namesChoice: bool, otherQuestionOpen: bool): bool =
  namesChoice or not(otherQuestionOpen)

pure def checkInSafetyAnswer(wantsReport: bool, wantsBlock: bool, declines: bool): CheckInSafetyAnswer =
  if (declines and (wantsReport or wantsBlock)) AnswerUnclear
  else if (wantsReport) AnswerReport
  else if (wantsBlock) AnswerBlock
  else if (declines) AnswerNeither
  else AnswerUnclear

pure val questionAtValues = Set(0, 1)
pure val answerAtValues = Set(-1, 0, 1, 86400000, 86400001, 86400002)
pure val answerHandledAtValues = Set(0, 1, 86400000, 86400001, 86400002)

pure def lawReportAndBlockFilesTheReport(otherQuestionOpen: bool): bool =
  checkInSafetyAnswerApplies(true, otherQuestionOpen) and checkInSafetyAnswer(true, true, false) == AnswerReport

pure def lawRefusalWithAChoiceActsOnNobody(wantsReport: bool, wantsBlock: bool): bool =
  checkInSafetyAnswer(wantsReport, wantsBlock, true) != AnswerReport and checkInSafetyAnswer(wantsReport, wantsBlock, true) != AnswerBlock

pure def lawBareAnswerWaitsForTheOtherQuestion(otherQuestionOpen: bool): bool =
  checkInSafetyAnswerApplies(false, otherQuestionOpen) == not(otherQuestionOpen)

pure def lawUnclearAnswerActsOnNobody(declines: bool): bool =
  checkInSafetyAnswer(false, false, declines) != AnswerReport and checkInSafetyAnswer(false, false, declines) != AnswerBlock

pure def lawLateAnswerLapses(questionAt: int, answerAt: int): bool =
  not(checkInSafetyAnswerCurrent(questionAt, answerAt, questionAt + checkInSafetyAnswerMs + 1))

pure def lawEarlyAnswerIsNotTheAnswer(questionAt: int, answerHandledAt: int): bool =
  not(checkInSafetyAnswerCurrent(questionAt, questionAt - 1, answerHandledAt))
```
