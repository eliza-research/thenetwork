# Monthly Network gatherings

## Story: Author and review a public city gathering

> As an administrator, I want to create and review the monthly New York gathering before eligible members are invited.

### Only a current New York Network administrator can author or decide a gathering

The signed staff request uses the Network app and New York City. The staff identity has the real administrator role for the app. Record the actual staff actor from request authentication.

```quint
pure def monthlyGatheringStaffAllowed(networkApp: bool, nyc: bool, appAdmin: bool): bool =
  networkApp and nyc and appAdmin
```

### A draft needs a future local month and an eligible public venue with bounded capacity

The entire window falls in the selected New York month. It starts in the future and lasts 30 minutes to six hours. A curated public venue must be open for the window. A current published listing must supply that exact window. Capacity is between 3 and 150. Only one draft or approved gathering can occupy the month. Rejection frees the month while preserving the old review record.

```quint
pure val gatheringMinDurationMs = 1800000
pure val gatheringMaxDurationMs = 21600000
pure val gatheringMinCapacity = 3
pure val gatheringMaxCapacity = 150
pure val startsAtValues = Set(0, 1, gatheringMinDurationMs, gatheringMaxDurationMs)
pure val endsAtValues = Set(0, 1, gatheringMinDurationMs, gatheringMinDurationMs + 1, gatheringMaxDurationMs + 1)
pure val capacityValues = Set(2, 3, 150, 151)

pure def gatheringDraftWindowAllowed(now: int, startsAt: int, endsAt: int, inMonth: bool, capacity: int): bool =
  now < startsAt and gatheringMinDurationMs <= endsAt - startsAt and endsAt - startsAt <= gatheringMaxDurationMs and
    inMonth and gatheringMinCapacity <= capacity and capacity <= gatheringMaxCapacity

pure def monthlyGatheringWindowAllowed(now: int, startsAt: int, endsAt: int, inMonth: bool, publicWindow: bool, capacity: int): bool =
  publicWindow and gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity)
```

### Review decides the exact draft once and does not contact members

An administrator reviews the draft revision. Approve only if the stored public place and window still qualify. Reject the draft without requiring the venue to remain current. Store one terminal decision with the reviewer and the decision time. Record successful creation and decisions in the staff audit trail in the same transaction. Record an authorized but refused review of a known gathering as a failed attempt. Authoring and review write no invitation, RSVP, member roster or provider message. The approved revision is available for a separate eligible invitation flow.

```quint
type GatheringPhase = GatheringDraft | GatheringApproved | GatheringRejected
type GatheringReviewDecision = ApproveGathering | RejectGathering
type GatheringReviewOutcome = GatheringReviewRefused | GatheringReviewApproved | GatheringReviewRejected
pure val revisionValues = Set(0, 1, 2)
pure val expectedRevisionValues = Set(0, 1, 2)

pure def monthlyGatheringReview(phase: GatheringPhase, revision: int, expectedRevision: int, decision: GatheringReviewDecision, currentWindow: bool): GatheringReviewOutcome =
  if (phase != GatheringDraft or revision != expectedRevision) GatheringReviewRefused
  else if (decision == RejectGathering) GatheringReviewRejected
  else if (currentWindow) GatheringReviewApproved
  else GatheringReviewRefused

pure def lawGatheringReviewRequiresDraft(phase: GatheringPhase, revision: int, expectedRevision: int, decision: GatheringReviewDecision, currentWindow: bool): bool =
  monthlyGatheringReview(phase, revision, expectedRevision, decision, currentWindow) != GatheringReviewRefused implies
    (phase == GatheringDraft and revision == expectedRevision)
```

### The real staff console authors and reviews the exact gathering

The real Network workspace offers monthly New York gatherings only to an administrator with the Network service available. Staff can enter a city-local start and end, select a curated public venue or supply a published event reference, set capacity, and create a draft. The console lists the server's drafts and prior decisions. Review shows only for a draft, confirms the selected decision and submits the exact revision. The server's response controls the row. Authoring and review never approve or deliver an invitation.

```quint
pure def monthlyGatheringConsoleAllowed(realMode: bool, networkApp: bool, appAdmin: bool, serviceAvailable: bool): bool =
  realMode and serviceAvailable and monthlyGatheringStaffAllowed(networkApp, true, appAdmin)

pure def monthlyGatheringReviewOffered(phase: GatheringPhase): bool = phase == GatheringDraft

pure def lawMonthlyGatheringConsoleNeedsReal(networkApp: bool, appAdmin: bool, serviceAvailable: bool): bool =
  not(monthlyGatheringConsoleAllowed(false, networkApp, appAdmin, serviceAvailable))
```
