# Booked meeting late arrivals

A late-arrival report is part of the [booked meeting journey](product/stories.md). It gives already-booked participants a short logistics update.

## Story: Tell the other booked participants I am running late

> As a booked participant, I want to tell the other booked participants that someone is running late without sharing my message.

### Relay one direct report for one current booked meeting

Accept an exact late-arrival report from the member's signed conversation for one reviewed, scheduled meeting whose confirmed roster includes that member. The meeting must be one whose logistics the Network arranged, not a job introduction. A pair booking has two distinct participants and uses the pair rule only when the opportunity and any underlying plan allow a pair. Both participants must have accepted and received the current booking by the time the message arrived. A group needs at least three such participants. Check a positive provider or signed gateway receipt for the exact member, opportunity and schedule revision. Both receipt of the member's text and handling must fall between one hour before the meeting and thirty minutes after it starts. An accepted member can make one report per schedule revision.

```quint
pure val lateArrivalLeadMs = 60 * 60000
pure val lateArrivalGraceMs = 30 * 60000
pure val lateArrivalMinimumRoster = 3
pure val lateArrivalDeliveryPrefix = "group-late:"
pure val lateArrivalNotice = "Someone in your group is running late."
pure val lateArrivalPairNotice = "The person you are meeting is running late."

pure def lateArrivalWindow(untilStart: int): bool =
  untilStart <= lateArrivalLeadMs and untilStart > -lateArrivalGraceMs

pure def lateArrivalReportTimeCurrent(untilStartAtReport: int, reportedAt: int, handledAt: int): bool =
  0 <= reportedAt and reportedAt <= handledAt and lateArrivalWindow(untilStartAtReport)

pure def lateArrivalBookingReceiptCurrent(positiveReceipt: bool, bookingAt: int, checkedAt: int): bool =
  positiveReceipt and 0 <= bookingAt and bookingAt <= checkedAt

pure def lawLateArrivalCannotPrecedeBookingReceipt(positiveReceipt: bool, bookingAt: int, checkedAt: int): bool =
  checkedAt < bookingAt implies not(lateArrivalBookingReceiptCurrent(positiveReceipt, bookingAt, checkedAt))

pure def lateArrivalIsPair(groupOpportunity: bool, groupPlan: bool, participantCount: int): bool =
  not(groupOpportunity) and not(groupPlan) and participantCount == 2

pure def lateArrivalRosterReady(pairBooking: bool, bookedCount: int): bool =
  if (pairBooking) bookedCount == 2 else bookedCount >= lateArrivalMinimumRoster

pure def lawLateArrivalGroupCannotUsePairRoster(groupOpportunity: bool, groupPlan: bool): bool =
  (groupOpportunity or groupPlan) implies not(lateArrivalRosterReady(lateArrivalIsPair(groupOpportunity, groupPlan, 2), 2))

pure def lawLateArrivalPairNeedsBoth(bookedCount: int): bool =
  lateArrivalRosterReady(true, bookedCount) implies bookedCount == 2

pure def lateArrivalBookingCurrent(scheduled: bool, reviewed: bool, logistics: bool, bookedFrom: bool,
    pairBooking: bool, bookedCount: int, untilStart: int): bool =
  scheduled and reviewed and logistics and bookedFrom and lateArrivalRosterReady(pairBooking, bookedCount) and lateArrivalWindow(untilStart)

pure def lateArrivalMayReport(signedDirect: bool, exactReport: bool, eligibleFrom: bool, matchingMeetings: int, alreadyReported: bool): bool =
  signedDirect and exactReport and eligibleFrom and matchingMeetings == 1 and not(alreadyReported)

pure def lawLateArrivalNeedsOneMeeting(signedDirect: bool, exactReport: bool, eligibleFrom: bool, matchingMeetings: int): bool =
  lateArrivalMayReport(signedDirect, exactReport, eligibleFrom, matchingMeetings, false) implies matchingMeetings == 1
```

### Send only the fixed notice to each eligible booked recipient

Check the same current booked meeting, the report's exact schedule, the reporter and each different booked recipient again before sending. Recheck current booking receipts and the required roster. Send the fixed short notice for the meeting type without the reporter's name, timing estimate, or original text. Use the same delivery key per reporter and recipient for each schedule revision. Queue and deferred sends obey the existing contact, quiet-hour and content gates.

```quint
pure def lateArrivalText(pairBooking: bool): str =
  if (pairBooking) lateArrivalPairNotice else lateArrivalNotice

pure def lateArrivalMayDispatch(currentBooking: bool, exactReport: bool, exactMessage: bool, bookedRecipient: bool, differentRecipient: bool, pairAllowed: bool): bool =
  currentBooking and exactReport and exactMessage and bookedRecipient and differentRecipient and pairAllowed

pure def lawLateArrivalNeverEchoes(currentBooking: bool, exactReport: bool, exactMessage: bool, bookedRecipient: bool, pairAllowed: bool): bool =
  not(lateArrivalMayDispatch(currentBooking, exactReport, exactMessage, bookedRecipient, false, pairAllowed))
```
