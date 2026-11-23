# Repeat encounters after private feedback

[Story F19](product/stories.md#story-f19--give-feedback-and-meet-again) lets two adults ask privately to meet again. The Network keeps each response with its completed opportunity. The matching engine and the local review queue use the same evidence rules.

## Story: Consider another meeting after a mutual positive experience

> As a participant, I want the Network to offer another meeting only when we both independently ask for it after the same meeting.

### Save repeat interest only after an attended meeting

A repeat signal needs a delivered booking and an explicit request to meet again. A positive rating alone cannot supply a repeat signal. A negative response or a report that either participant missed the meeting cannot support a repeat. The Network keeps only the derived flag with the original feedback.

```quint
pure def recordsRepeatConsent(bookingDelivered: bool, explicitlyAgain: bool, wasNegative: bool, missed: bool): bool =
  bookingDelivered and explicitlyAgain and not(wasNegative or missed)

pure def lawMissedMeetingGivesNoRepeatConsent(bookingDelivered: bool, explicitlyAgain: bool, wasNegative: bool): bool =
  not(recordsRepeatConsent(bookingDelivered, explicitlyAgain, wasNegative, true))
```

### Require two independent responses about one recent completed opportunity

Use the most recent completed, two-person meeting in the past 60 days. Free-standing positive feedback and consent for two different meetings cannot combine. A review item is made once for that meeting. Both members must still permit the category and be eligible for outreach. A block, a recent decline, or a negative preference prevents the offer. The ordinary review and anonymous probe sequence handles the proposal. An earlier yes cannot accept a new booking.

```quint
pure val repeatWindowMs = 60 * 86400000

pure def recentRepeatSource(completed: bool, pair: bool, elapsedMs: int): bool =
  completed and pair and elapsedMs >= 0 and elapsedMs < repeatWindowMs

pure def sameEncounterConsent(consent: bool, answeredMeeting: str, sourceMeeting: str): bool =
  consent and answeredMeeting != "" and answeredMeeting == sourceMeeting

pure def queueRepeat(firstYes: bool, secondYes: bool, eligible: bool, pairAvailable: bool, alreadyQueued: bool): bool =
  firstYes and secondYes and eligible and pairAvailable and not(alreadyQueued)

pure def lawMismatchedMeetingGivesNoRepeatConsent(answeredMeeting: str, sourceMeeting: str): bool =
  answeredMeeting != sourceMeeting implies not(sameEncounterConsent(true, answeredMeeting, sourceMeeting))

pure def lawRepeatNeedsBothResponses(firstYes: bool, eligible: bool, pairAvailable: bool, alreadyQueued: bool): bool =
  not(queueRepeat(firstYes, false, eligible, pairAvailable, alreadyQueued))
```

### Use a public event only when both members can attend it

A repeat can use a public event when both members permit its category
and format and can be in its city for the full time. Rank only eligible
events. If none fits, consider the ordinary repeat format under the
same current pair checks.

```quint
pure def repeatEventMayAnchor(bothEligible: bool, coversEvent: bool): bool =
  bothEligible and coversEvent

pure def lawRepeatEventNeedsFullPresence(bothEligible: bool): bool =
  not(repeatEventMayAnchor(bothEligible, false))
```
