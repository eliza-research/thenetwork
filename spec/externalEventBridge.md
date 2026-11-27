# External event bridge

When local density in a city is too sparse for an in-network group, an adult member can anchor an impromptu public meetup syndicated through sanctioned external event platforms. Every published event requires a recorded approval from the review judge, or from a named staff member after the judge holds the item, under [automated review](automatedReview.md). Minors never attend, anchor, or receive invitations through syndicated external events, matching the adult boundary in [member age](memberAge.md).

## Story: Ingest and publish only sanctioned, anchored, capacity-safe external events

> As an adult member in a sparse city, I want the Network to syndicate an impromptu meetup only through sanctioned channels, with a confirmed anchor, clear expectations, hidden guest lists, and safe venue capacity.

### Accept only sanctioned external event sources

Only Network-hosted listings (`0`), official partner API listings (`1`), and verified member-submitted public links (`2`) may enter the external event catalog. Scraped or unauthorized sources are always refused.

```quint
pure val externalEventSourceHostNative: int = 0
pure val externalEventSourceOfficialApi: int = 1
pure val externalEventSourceMemberSubmittedPublic: int = 2
pure val externalEventMaxHeadcount: int = 15
pure val externalEventT24Hours: int = 24
pure val externalEventMinQuorum: int = 3

pure def isSanctionedExternalEventSource(sourceCode: int): bool =
  sourceCode == externalEventSourceHostNative or
    sourceCode == externalEventSourceOfficialApi or
    sourceCode == externalEventSourceMemberSubmittedPublic

pure val sourceCodeValues = Set(-1, 0, 1, 2, 3, 99)

pure def lawScrapedSourceRejected(sourceCode: int): bool =
  (sourceCode < 0 or sourceCode > 2) implies not(isSanctionedExternalEventSource(sourceCode))
```

### Publish an external event only with a confirmed anchor, recorded review approval, hidden gated RSVPs, and safe capacity

Publishing or syndicating an external event requires at least one confirmed adult Network anchor, recorded approval under [automated review](automatedReview.md), an adult-only roster, a public third-party venue, a sanctioned source, a hidden guest list, RSVP approval gating, upfront crowd disclosure, and a planned headcount within both the 15-person ceiling and the venue's walk-in capacity.

```quint
type PublishExternalEventInput = {
  confirmedNetworkAnchors: int,
  reviewApproved: bool,
  allParticipantsAdult: bool,
  isPublicVenue: bool,
  sourceSanctioned: bool,
  hideGuestList: bool,
  approvalRequired: bool,
  externalCrowdDisclosed: bool,
  plannedTotal: int,
  venueWalkInCapacity: int
}

pure def canPublishExternalEvent(req: PublishExternalEventInput): bool =
  req.confirmedNetworkAnchors >= 1 and
    req.reviewApproved and
    req.allParticipantsAdult and
    req.isPublicVenue and
    req.sourceSanctioned and
    req.hideGuestList and
    req.approvalRequired and
    req.externalCrowdDisclosed and
    req.venueWalkInCapacity >= 1 and
    req.plannedTotal >= req.confirmedNetworkAnchors and
    req.plannedTotal <= externalEventMaxHeadcount and
    req.plannedTotal <= req.venueWalkInCapacity

pure val confirmedNetworkAnchorsValues = Set(0, 1, 2)
pure val plannedTotalValues = Set(0, 1, 8, 15, 16)
pure val venueWalkInCapacityValues = Set(0, 6, 12, 15, 20)

pure def lawPublishRequiresAnchorAndReview(confirmedNetworkAnchors: int, reviewApproved: bool): bool =
  val ok = canPublishExternalEvent({
    confirmedNetworkAnchors: confirmedNetworkAnchors,
    reviewApproved: reviewApproved,
    allParticipantsAdult: true,
    isPublicVenue: true,
    sourceSanctioned: true,
    hideGuestList: true,
    approvalRequired: true,
    externalCrowdDisclosed: true,
    plannedTotal: 8,
    venueWalkInCapacity: 12
  })
  ok implies (confirmedNetworkAnchors >= 1 and reviewApproved)

pure def lawPublishRequiresHiddenGatedAndDisclosed(hideGuestList: bool, approvalRequired: bool, externalCrowdDisclosed: bool): bool =
  val ok = canPublishExternalEvent({
    confirmedNetworkAnchors: 1,
    reviewApproved: true,
    allParticipantsAdult: true,
    isPublicVenue: true,
    sourceSanctioned: true,
    hideGuestList: hideGuestList,
    approvalRequired: approvalRequired,
    externalCrowdDisclosed: externalCrowdDisclosed,
    plannedTotal: 8,
    venueWalkInCapacity: 12
  })
  ok implies (hideGuestList and approvalRequired and externalCrowdDisclosed)

pure def lawPublishRespectsCapacityAndAdultPublicVenue(allParticipantsAdult: bool, isPublicVenue: bool, plannedTotal: int, venueWalkInCapacity: int): bool =
  val ok = canPublishExternalEvent({
    confirmedNetworkAnchors: 1,
    reviewApproved: true,
    allParticipantsAdult: allParticipantsAdult,
    isPublicVenue: isPublicVenue,
    sourceSanctioned: true,
    hideGuestList: true,
    approvalRequired: true,
    externalCrowdDisclosed: true,
    plannedTotal: plannedTotal,
    venueWalkInCapacity: venueWalkInCapacity
  })
  ok implies (allParticipantsAdult and isPublicVenue and plannedTotal <= externalEventMaxHeadcount and plannedTotal <= venueWalkInCapacity)
```

### Bound external RSVP overbooking to the venue walk-in capacity and 15-person ceiling

Free external events use integer overbooking math assuming an 85 percent Network show rate and a 55 percent external show rate: `ceil((targetRoomSize * 100 - 85 * networkConfirmed) / 55)`. The approved external cap is always non-negative and clamped so total confirmed Network members plus approved external RSVPs never exceed 15 or the venue's walk-in capacity.

```quint
pure def computeApprovedExternalCap(networkConfirmed: int, venueWalkInCapacity: int, targetRoomSize: int): int =
  val hardCap = if (venueWalkInCapacity < externalEventMaxHeadcount) venueWalkInCapacity else externalEventMaxHeadcount
  val maxAdditional = hardCap - networkConfirmed
  val numerator = targetRoomSize * 100 - 85 * networkConfirmed
  val needed = if (numerator > 0) (numerator + 54) / 55 else 0
  if (networkConfirmed < 0 or venueWalkInCapacity <= 0 or targetRoomSize <= 0) 0
  else if (networkConfirmed >= hardCap) 0
  else if (numerator <= 0) 0
  else if (needed > maxAdditional) maxAdditional
  else needed

pure val networkConfirmedValues = Set(-1, 0, 1, 2, 10, 15, 16)
pure val targetRoomSizeValues = Set(0, 4, 7, 12, 20)

pure def lawApprovedCapBoundedAndNonNegative(networkConfirmed: int, venueWalkInCapacity: int, targetRoomSize: int): bool =
  val cap = computeApprovedExternalCap(networkConfirmed, venueWalkInCapacity, targetRoomSize)
  and {
    cap >= 0,
    cap <= externalEventMaxHeadcount,
    (networkConfirmed >= 0 and networkConfirmed <= externalEventMaxHeadcount and networkConfirmed <= venueWalkInCapacity)
      implies (networkConfirmed + cap <= externalEventMaxHeadcount and networkConfirmed + cap <= venueWalkInCapacity),
    (networkConfirmed >= externalEventMaxHeadcount or networkConfirmed >= venueWalkInCapacity) implies cap == 0
  }
```

## Story: Protect anchors from empty events, screen adult RSVPs, and quality-gate invites

> As an anchor and organizer, I want low-quorum events cancelled before event day, external RSVPs screened to adults within capacity, and Network invites sent only after verified positive meetups.

### Cancel when the anchor drops or when quorum stays too low at 24 hours before start

If no confirmed Network anchor remains, the event cancels with `"cancel_no_anchor"`. Inside 24 hours before start, if fewer than 3 Network members and fewer than 3 approved external RSVPs are confirmed, the event cancels early with `"cancel_low_quorum"`. Otherwise it proceeds with `"go"`.

```quint
pure def evaluateExternalEventT24Quorum(
  confirmedNetworkAnchors: int,
  confirmedNetworkTotal: int,
  approvedExternalRsvps: int,
  hoursToStart: int
): str =
  if (confirmedNetworkAnchors <= 0) "cancel_no_anchor"
  else if (hoursToStart <= externalEventT24Hours and confirmedNetworkTotal < externalEventMinQuorum and approvedExternalRsvps < externalEventMinQuorum) "cancel_low_quorum"
  else "go"

pure val confirmedNetworkTotalValues = Set(0, 1, 2, 3, 5)
pure val approvedExternalRsvpsValues = Set(0, 1, 2, 3, 6)
pure val hoursToStartValues = Set(1, 24, 25, 48)

pure def lawT24QuorumCancelsWithoutAnchorOrLowTurnout(
  confirmedNetworkAnchors: int,
  confirmedNetworkTotal: int,
  approvedExternalRsvps: int,
  hoursToStart: int
): bool =
  val decision = evaluateExternalEventT24Quorum(confirmedNetworkAnchors, confirmedNetworkTotal, approvedExternalRsvps, hoursToStart)
  and {
    confirmedNetworkAnchors <= 0 implies decision == "cancel_no_anchor",
    (confirmedNetworkAnchors >= 1 and hoursToStart <= externalEventT24Hours and confirmedNetworkTotal < externalEventMinQuorum and approvedExternalRsvps < externalEventMinQuorum)
      implies decision == "cancel_low_quorum",
    decision == "go" implies confirmedNetworkAnchors >= 1,
    (decision == "go" and hoursToStart <= externalEventT24Hours)
      implies (confirmedNetworkTotal >= externalEventMinQuorum or approvedExternalRsvps >= externalEventMinQuorum)
  }
```

### Approve an external RSVP only for an eligible screened adult within the cap

Every approved external RSVP must be an adult aged 18 to 120, not banned, not opted out, not on safety hold, within the approved external cap, and having answered the screening question.

```quint
type ApproveExternalEventRsvpInput = {
  attendeeAge: int,
  banned: bool,
  optedOut: bool,
  held: bool,
  currentApprovedExternal: int,
  approvedExternalCap: int,
  answeredScreeningQuestion: bool
}

pure def canApproveExternalEventRsvp(req: ApproveExternalEventRsvpInput): bool =
  req.attendeeAge >= 18 and
    req.attendeeAge <= 120 and
    not(req.banned) and
    not(req.optedOut) and
    not(req.held) and
    req.currentApprovedExternal >= 0 and
    req.approvedExternalCap > 0 and
    req.currentApprovedExternal < req.approvedExternalCap and
    req.answeredScreeningQuestion

pure val attendeeAgeValues = Set(13, 17, 18, 25, 120, 121)
pure val currentApprovedExternalValues = Set(-1, 0, 4, 10)
pure val approvedExternalCapValues = Set(0, 4, 10)

pure def lawMinorOrBlockedNeverApprovedForExternalRsvp(attendeeAge: int, banned: bool, optedOut: bool, held: bool): bool =
  val ok = canApproveExternalEventRsvp({
    attendeeAge: attendeeAge,
    banned: banned,
    optedOut: optedOut,
    held: held,
    currentApprovedExternal: 0,
    approvedExternalCap: 5,
    answeredScreeningQuestion: true
  })
  ok implies (attendeeAge >= 18 and attendeeAge <= 120 and not(banned) and not(optedOut) and not(held))

pure def lawExternalRsvpRespectsCapAndScreening(currentApprovedExternal: int, approvedExternalCap: int, answeredScreeningQuestion: bool): bool =
  val ok = canApproveExternalEventRsvp({
    attendeeAge: 28,
    banned: false,
    optedOut: false,
    held: false,
    currentApprovedExternal: currentApprovedExternal,
    approvedExternalCap: approvedExternalCap,
    answeredScreeningQuestion: answeredScreeningQuestion
  })
  ok implies (currentApprovedExternal >= 0 and currentApprovedExternal < approvedExternalCap and answeredScreeningQuestion)
```

### Invite an external attendee to the Network only after a positive, safe completed event

A post-event Network invite is sent at most once and only when the event completed, Network attendee feedback is positive, no safety flag exists, the attendee is an adult aged 18 to 120, the attendee is not opted out, banned, or already a member, zero prior invites were sent, and the local follow-up window is safe.

```quint
type InviteExternalEventAttendeeInput = {
  eventCompleted: bool,
  networkFeedbackPositive: bool,
  safetyFlag: bool,
  attendeeAge: int,
  optedOut: bool,
  banned: bool,
  alreadyMember: bool,
  invitesSent: int,
  safeFollowupWindow: bool
}

pure def canInviteExternalEventAttendee(req: InviteExternalEventAttendeeInput): bool =
  req.eventCompleted and
    req.networkFeedbackPositive and
    not(req.safetyFlag) and
    req.attendeeAge >= 18 and
    req.attendeeAge <= 120 and
    not(req.optedOut) and
    not(req.banned) and
    not(req.alreadyMember) and
    req.invitesSent == 0 and
    req.safeFollowupWindow

pure val invitesSentValues = Set(0, 1, 2)

pure def lawExternalEventInviteRequiresPositiveFeedbackAndZeroPriorInvites(
  eventCompleted: bool,
  networkFeedbackPositive: bool,
  safetyFlag: bool,
  invitesSent: int
): bool =
  val ok = canInviteExternalEventAttendee({
    eventCompleted: eventCompleted,
    networkFeedbackPositive: networkFeedbackPositive,
    safetyFlag: safetyFlag,
    attendeeAge: 28,
    optedOut: false,
    banned: false,
    alreadyMember: false,
    invitesSent: invitesSent,
    safeFollowupWindow: true
  })
  ok implies (eventCompleted and networkFeedbackPositive and not(safetyFlag) and invitesSent == 0)

pure def lawExternalEventInviteBlocksMinorsAndOptedOut(attendeeAge: int, optedOut: bool, banned: bool, alreadyMember: bool): bool =
  val ok = canInviteExternalEventAttendee({
    eventCompleted: true,
    networkFeedbackPositive: true,
    safetyFlag: false,
    attendeeAge: attendeeAge,
    optedOut: optedOut,
    banned: banned,
    alreadyMember: alreadyMember,
    invitesSent: 0,
    safeFollowupWindow: true
  })
  ok implies (attendeeAge >= 18 and attendeeAge <= 120 and not(optedOut) and not(banned) and not(alreadyMember))
```
