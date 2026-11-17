# Booked group late arrivals

A late-arrival report is part of the [booked meeting journey](product/stories.md). It updates an existing reviewed plan. It does not introduce or identify anyone.

## Story: Tell my group I am running late

> As a booked participant, I want to tell the other booked participants that someone is running late without sharing my message.

### Relay one direct report for one current booked group

Accept an exact late-arrival report from the member's signed conversation, for one reviewed, scheduled group whose confirmed roster includes that member. The group needs at least three accepted participants who received the current booking by the time the message arrived. Check a positive provider or signed gateway receipt for the exact member, opportunity and schedule revision. Both receipt of the member's text and handling must fall between one hour before the meeting and thirty minutes after it starts. An accepted member can make one report per schedule revision.

```quint
pure val lateArrivalLeadMs = 60 * 60000
pure val lateArrivalGraceMs = 30 * 60000
pure val lateArrivalMinimumRoster = 3
pure val lateArrivalDeliveryPrefix = "group-late:"
pure val lateArrivalNotice = "Someone in your group is running late."

pure def lateArrivalWindow(untilStart: int): bool =
  untilStart <= lateArrivalLeadMs and untilStart > -lateArrivalGraceMs

pure def lateArrivalReportTimeCurrent(untilStartAtReport: int, reportedAt: int, handledAt: int): bool =
  0 <= reportedAt and reportedAt <= handledAt and lateArrivalWindow(untilStartAtReport)

pure def lateArrivalBookingReceiptCurrent(positiveReceipt: bool, bookingAt: int, checkedAt: int): bool =
  positiveReceipt and 0 <= bookingAt and bookingAt <= checkedAt

pure def lawLateArrivalCannotPrecedeBookingReceipt(positiveReceipt: bool, bookingAt: int, checkedAt: int): bool =
  checkedAt < bookingAt implies not(lateArrivalBookingReceiptCurrent(positiveReceipt, bookingAt, checkedAt))

pure def lateArrivalGroupCurrent(scheduled: bool, reviewed: bool, logistics: bool, bookedFrom: bool, bookedCount: int, untilStart: int): bool =
  scheduled and reviewed and logistics and bookedFrom and bookedCount >= lateArrivalMinimumRoster and lateArrivalWindow(untilStart)

pure def lateArrivalMayReport(signedDirect: bool, exactReport: bool, eligibleFrom: bool, matchingGroups: int, alreadyReported: bool): bool =
  signedDirect and exactReport and eligibleFrom and matchingGroups == 1 and not(alreadyReported)

pure def lawLateArrivalNeedsOneGroup(signedDirect: bool, exactReport: bool, eligibleFrom: bool, matchingGroups: int): bool =
  lateArrivalMayReport(signedDirect, exactReport, eligibleFrom, matchingGroups, false) implies matchingGroups == 1
```

### Send only the fixed notice to each eligible booked recipient

Check the same current booked group, the report's exact schedule, the reporter and each different booked recipient again before sending. Recheck current booking receipts and the three-person minimum. Send the fixed short notice without the reporter's name, timing estimate, or original text. Use the same delivery key per reporter and recipient for each schedule revision. Queue and deferred sends obey the existing contact, quiet-hour and content gates.

```quint
pure def lateArrivalMayDispatch(currentGroup: bool, exactReport: bool, exactMessage: bool, bookedRecipient: bool, differentRecipient: bool, pairAllowed: bool): bool =
  currentGroup and exactReport and exactMessage and bookedRecipient and differentRecipient and pairAllowed

pure def lawLateArrivalNeverEchoes(currentGroup: bool, exactReport: bool, exactMessage: bool, bookedRecipient: bool, pairAllowed: bool): bool =
  not(lateArrivalMayDispatch(currentGroup, exactReport, exactMessage, bookedRecipient, false, pairAllowed))
```
