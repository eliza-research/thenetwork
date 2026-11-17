# Confirm attendance and choose private follow-up

## Story: Confirm attendance and choose whom to meet again

> As a member with an RSVP to the reviewed gathering, I want to report my own attendance and privately choose whether to meet an eligible co-group member again.

### Attendance comes from an exact signed reply after the gathering

Recording an RSVP or sending a prompt does not report attendance. Record only the current verified member's explicit signed yes or no for the exact approved gathering revision. Require a current active local adult and a retained affirmative RSVP. The seven-day window starts when the gathering ends and includes that instant. Received and handled times must both be valid. Keep one answer, taking the latest signed receive time and preferring no on a tie. A lower age, hold, invalidated membership or changed answer prevents replay of the old private receipt.

```quint
pure val gatheringFollowupWindowMs: int = 604800000

pure def gatheringFollowupOpen(approved: bool, exactRevision: bool, forReference: bool, startsAt: int, endsAt: int, receivedAt: int, now: int): bool =
  approved and exactRevision and startsAt < endsAt and
    (if (forReference) startsAt else endsAt) <= receivedAt and receivedAt <= now and now < endsAt + gatheringFollowupWindowMs

pure def gatheringFollowupMayReplace(savedChoice: bool, sameTurn: bool, storedAt: int, receivedAt: int, savedYes: bool, nextYes: bool): bool =
  not(savedChoice) or (not(sameTurn) and (storedAt < receivedAt or (storedAt == receivedAt and savedYes and not(nextYes))))

pure def lawGatheringAttendanceWaitsForEnd(exactRevision: bool, startsAt: int, endsAt: int, receivedAt: int, now: int): bool =
  receivedAt < endsAt implies not(gatheringFollowupOpen(true, exactRevision, false, startsAt, endsAt, receivedAt, now))

pure def lawGatheringFollowupCannotReplayMutation(storedAt: int, receivedAt: int, savedYes: bool, nextYes: bool): bool =
  not(gatheringFollowupMayReplace(true, true, storedAt, receivedAt, savedYes, nextYes))
```

### Only the member can obtain and choose to share their own reference

A member in the current approved grouping can request their own opaque reference starting at the gathering's start. Issuing it uses their own signed session, retained grouping opt-in and current eligibility. The reference identifies one member within the exact grouping and cannot grant access to a roster or a name. The member decides whether to share it. Reference issuance does not depend on anyone's attendance answer.

```quint
pure def gatheringFollowupReferenceAllowed(currentOwner: bool, groupingOptIn: bool, approvedGroup: bool): bool =
  currentOwner and groupingOptIn and approvedGroup

pure def lawGatheringReferenceIsOwned(groupingOptIn: bool, approvedGroup: bool): bool =
  not(gatheringFollowupReferenceAllowed(false, groupingOptIn, approvedGroup))
```

### A private follow-up choice requires two current affirmative attendance records

Resolve only the exact peer code within the requester's current approved group. Both people still need current eligibility, grouping opt-in and their own affirmative attendance record. A block or avoid in either direction stops a new choice. Receive a yes only at or after both attendance answers. A fresh no withdraws an existing choice or fences an older arrival for an eligible pair. Removing attendance or replacing its affirmative receipt invalidates dependent preferences. Read mutual current preferences only as internal evidence for the normal safety and human review process. Reply with the same neutral acknowledgement for an authorized follow-up command whether or not the other member or a current choice can be resolved. Never identify the peer or their answer in a reply.

```quint
pure def gatheringFollowupPairCurrent(sameGroup: bool, distinct: bool, pairEligible: bool, unblocked: bool, firstAttended: bool, secondAttended: bool): bool =
  sameGroup and distinct and pairEligible and unblocked and firstAttended and secondAttended

pure def gatheringFollowupCanChoose(currentPair: bool, ownAt: int, peerAt: int, receivedAt: int): bool =
  currentPair and ownAt <= receivedAt and peerAt <= receivedAt

pure def gatheringFollowupMutual(currentPair: bool, firstYes: bool, secondYes: bool, exactAttendance: bool): bool =
  currentPair and firstYes and secondYes and exactAttendance

pure def lawGatheringMutualNeedsBothChoices(currentPair: bool, exactAttendance: bool): bool =
  not(gatheringFollowupMutual(currentPair, true, false, exactAttendance))
```
