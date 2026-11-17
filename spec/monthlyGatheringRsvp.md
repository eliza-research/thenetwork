# Monthly gathering RSVPs

## Story: Choose how to attend the monthly gathering

> As an eligible Network member, I want to reserve my own place at the reviewed gathering and choose whether staff can include me in a grouping suggestion.

### Only the exact approved gathering accepts a fresh RSVP

Use the signed direct member turn in the gathering's app. Resolve the current member through the verified phone, account, app consent, ban and hold rules. A new RSVP is for an active local adult. Use the server's lowest matching age. The exact gathering revision must be approved. Both the signed receive time and the handling time must precede the start. An affirmative RSVP and its receipt require the exact approved public listing and window to remain in the fresh catalog when that listing supplied the venue. Serialize this check with catalog publication. A member can take an existing RSVP back until the gathering ends, even if the listing changes. Recognizing a command outside the signed member path cannot change attendance.

```quint
pure def gatheringRsvpWindow(approved: bool, sameRevision: bool, isWithdrawal: bool, approvedAt: int, startAt: int, endAt: int, receivedAt: int, handledAt: int): bool =
  approved and sameRevision and 0 < approvedAt and approvedAt <= receivedAt and receivedAt <= handledAt and
    handledAt < (if (isWithdrawal) endAt else startAt)

pure def gatheringRsvpAttendanceAllowed(currentOwner: bool, adult: bool, localMember: bool, activeParticipant: bool): bool =
  currentOwner and adult and localMember and activeParticipant

pure def gatheringRsvpNeedsListingCheck(publishedListing: bool, withdrawing: bool, beforeStart: bool): bool =
  publishedListing and not(withdrawing) and beforeStart

pure def lawGatheringWithdrawalDoesNotDependOnListing(publishedListing: bool, beforeStart: bool): bool =
  not(gatheringRsvpNeedsListingCheck(publishedListing, true, beforeStart))

pure def lawGatheringRequiresApproval(sameRevision: bool, isWithdrawal: bool, approvedAt: int, startAt: int, endAt: int, receivedAt: int, handledAt: int): bool =
  not(gatheringRsvpWindow(false, sameRevision, isWithdrawal, approvedAt, startAt, endAt, receivedAt, handledAt))

pure def lawGatheringMinorCannotAttend(currentOwner: bool, localMember: bool, activeParticipant: bool): bool =
  not(gatheringRsvpAttendanceAllowed(currentOwner, false, localMember, activeParticipant))
```

### Each member owns one RSVP and withdrawal wins a tie

Serialize changes and capacity checks on the gathering row. Keep a single decision per app, gathering and member. A fresh yes reserves one seat only if one remains or that member already reserves a seat. A fresh plain yes can take back grouping consent while keeping the seat. An older request or the same signed turn cannot change the newest decision. If a withdrawal and a yes have the same signed receive time, withdrawal wins. A newer yes can reserve a place again while RSVPs are open. Removing membership erases its RSVP.

```quint
pure def gatheringRsvpReplaces(saved: bool, sameTurn: bool, storedAt: int, newAt: int, withdrawing: bool, reserved: bool): bool =
  not(saved) or (not(sameTurn) and (newAt > storedAt or (newAt == storedAt and withdrawing and reserved)))

pure def gatheringRsvpHasSeat(alreadyReserved: bool, reservedCount: int, capacity: int): bool =
  alreadyReserved or (0 <= reservedCount and reservedCount < capacity)

pure def lawGatheringCannotReplayRsvp(storedAt: int, newAt: int, withdrawing: bool, reserved: bool): bool =
  not(gatheringRsvpReplaces(true, true, storedAt, newAt, withdrawing, reserved))

pure def lawGatheringCapacityDoesNotOverbook(reservedCount: int, capacity: int): bool =
  gatheringRsvpHasSeat(false, reservedCount, capacity) implies reservedCount < capacity
```

### The private roster uses current eligibility and separate grouping consent

The roster belongs to authorized gathering operations. Return only operational member identifiers for the exact approved current gathering. Recheck current eligibility on read. Before start, apply the same listing check to the roster and grouping review. During the gathering, staff can still read reservations because the catalog serves future listings only. A plain RSVP never grants grouping permission. A member who explicitly includes grouping can enter staff's candidate roster. Any actual connection needs the normal review, pair safety, and consent. No member sees the roster, contact data or someone else's choice through RSVP.

```quint
pure def gatheringRsvpRosterAllowed(approved: bool, sameRevision: bool, approvedAt: int, endsAt: int, now: int): bool =
  approved and sameRevision and 0 < approvedAt and approvedAt <= now and now < endsAt

pure def gatheringRsvpGroupingAllowed(attending: bool, groupingConsent: bool, currentlyEligible: bool): bool =
  attending and groupingConsent and currentlyEligible

pure def lawGatheringAttendanceIsNotGroupingConsent(attending: bool, currentlyEligible: bool): bool =
  not(gatheringRsvpGroupingAllowed(attending, false, currentlyEligible))
```

### Priority suggests whom staff should consider first

Among current eligible members, give one priority point for each documented condition that applies: newcomer, isolated member, or a pending second encounter. Use a stable ID to break ties. Treat equal evidence equally. Keep priority private to staff. A score neither authorizes delivery nor reserves a seat. Use existing current, app-local engine evidence for each condition; do not infer a reason from private conversation text.

Recommendations are for the exact approved future Network gathering in New York. Consider current local adults who have finished onboarding and accept event opportunities. Withhold members on watch, paused, or available only when they ask. Exclude every existing RSVP choice for the revision. Return no more IDs than gathering capacity.

Use the first week after joining as the newcomer window. After that week, absence of an accepted participation in the past 30 days and the absence of a future booking provide the local isolation evidence. A pending second encounter needs bilateral repeat consent from an eligible recent pair. It can be awaiting its first offer, staff review, or probe response. A booked, declined, closed or previously completed repeat does not count.

```quint
pure val gatheringNewcomerMs: int = 604800000
pure val gatheringIsolationMs: int = 2592000000

pure def gatheringPriorityNewcomer(joinedAt: int, now: int): bool =
  0 <= joinedAt and joinedAt <= now and now - joinedAt <= gatheringNewcomerMs

pure def gatheringPriorityIsolated(joinedAt: int, lastParticipationAt: int, hasUpcoming: bool, now: int): bool =
  0 <= joinedAt and now - joinedAt > gatheringNewcomerMs and not(hasUpcoming) and
    (lastParticipationAt < 0 or now - lastParticipationAt > gatheringIsolationMs)

pure def lawGatheringNewcomerIsNotIsolated(joinedAt: int, lastParticipationAt: int, hasUpcoming: bool, now: int): bool =
  gatheringPriorityNewcomer(joinedAt, now) implies not(gatheringPriorityIsolated(joinedAt, lastParticipationAt, hasUpcoming, now))

pure def gatheringInvitationPriority(eligible: bool, newcomer: bool, isolated: bool, pendingSecondEncounter: bool): int =
  if (eligible) (if (newcomer) 1 else 0) + (if (isolated) 1 else 0) + (if (pendingSecondEncounter) 1 else 0) else -1

pure def lawGatheringPriorityRequiresEligibility(newcomer: bool, isolated: bool, pendingSecondEncounter: bool): bool =
  gatheringInvitationPriority(false, newcomer, isolated, pendingSecondEncounter) < 0
```
