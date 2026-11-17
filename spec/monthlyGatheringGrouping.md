# Monthly gathering conversation groupings

## Story: Review suggested conversation groupings for the monthly gathering

> As a Network administrator, I want small conversation groupings of willing attendees that I can review for the exact gathering.

### Each suggested group has three to five current willing adults

Use the current private grouping consent for the approved New York gathering revision. Only eligible local adults can take a place. Every placed pair passes the app's current safety, block and avoidance checks. Each person can take at most one place. Use the strongest available compatible connections and a stable order, with no requirement to place everyone. Return only staff-operational member IDs. Keep names, phones, interests and pair values out of the response.

```quint
pure val gatheringGroupingMinimum = 3
pure val gatheringGroupingMaximum = 5
pure val seatCountValues = Set(0, 2, 3, 4, 5, 6)

pure def gatheringGroupingSizeAllowed(seatCount: int): bool =
  gatheringGroupingMinimum <= seatCount and seatCount <= gatheringGroupingMaximum

pure def gatheringGroupingCanSeat(eligible: bool, compatible: bool, assigned: bool, seatCount: int): bool =
  eligible and compatible and not(assigned) and 0 <= seatCount and seatCount < gatheringGroupingMaximum

pure def lawGatheringGroupingCannotSeatBlocked(eligible: bool, assigned: bool, seatCount: int): bool =
  not(gatheringGroupingCanSeat(eligible, false, assigned, seatCount))

pure def lawGatheringGroupingCannotSeatTwice(eligible: bool, compatible: bool, seatCount: int): bool =
  not(gatheringGroupingCanSeat(eligible, compatible, true, seatCount))
```

### Human approval binds the exact current nonempty suggestion for one gathering revision

A current Network administrator can view suggestions until the gathering ends. Approval is possible before it starts, after rechecking current membership, grouping consent and pair eligibility. The submitted fingerprint must match the exact current groups in the requested revision. A retry of the current complete approval returns its aggregate receipt. If the suggestion changes, staff must review the changed fingerprint. Store one current approval at a time, preserve the staff audit and retire the previous approval when staff approves a new one. Membership erasure removes the corresponding saved member rows. A staff grouping approval authorizes no contact, send, identity disclosure or post-event connection.

```quint
pure def gatheringGroupingReviewAllowed(currentGathering: bool, beforeStart: bool, exactFingerprint: bool, nonempty: bool): bool =
  currentGathering and beforeStart and exactFingerprint and nonempty

pure def gatheringGroupingApprovalCurrent(recorded: bool, exactFingerprint: bool, complete: bool): bool =
  recorded and exactFingerprint and complete

pure def lawGatheringGroupingRejectsStaleFingerprint(currentGathering: bool, beforeStart: bool, nonempty: bool): bool =
  not(gatheringGroupingReviewAllowed(currentGathering, beforeStart, false, nonempty))
```
