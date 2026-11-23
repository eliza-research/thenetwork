# Monthly Network gatherings

## Story: Author and review a public city gathering

> As an administrator, I want to create and review the monthly New York gathering before eligible members are invited.

### Only a current New York Network administrator can author or decide a gathering

The signed staff request uses the Network app and New York City. The staff identity has the real administrator role for the app. Record the actual staff actor from request authentication.

```quint
import consoleWorkspace as W from "./consoleWorkspace"

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

### The gathering panel offers the draft form and one confirmation at a time

The monthly gatherings are a work panel of the console (`GatheringPanel` in the [workspace spec](consoleWorkspace.md)). A panel that waits for the list shows the loading row. A 403 answer shows the refusal. A 503 answer shows that the gatherings are not available here. An answer with the list shows the rows. Any other answer shows the error. The draft form shows only when the panel has the list.

The form sends a draft only when each field has a value and the start and the end are each one exact New York time. A local time that the clock skips or repeats is not one exact time, and a year before 1970 is not a time. The window and the capacity must also pass the draft rule. The confirm control of a review shows only on a draft row, and only for the row and the revision that the staff member chose. One write is on its way at a time. A saved write puts the row in the list and closes the confirmation. A 403 answer shows the refusal and closes the confirmation. A 409 answer closes the confirmation and reads the list again. Any other failure keeps the confirmation and shows the error. The shell gives each error code of the server one error kind, and the component library keeps the words.

```quint
type GatheringWriteFollowUp = GatheringWriteSaved | GatheringWriteRefused | GatheringWriteConflict | GatheringWriteFailed
type GatheringError = GatheringInvalid | GatheringMonthTaken | GatheringNotReviewable | GatheringMissing | GatheringOtherError

pure val gatheringEarliestYear = 1970
pure val statusValues = Set(0, 200, 400, 403, 409, 503)
pure val chosenRevisionValues = Set(0, 1, 2)
pure val matchCountValues = Set(0, 1, 2)
pure val yearValues = Set(1969, 1970, 2026)

pure def gatheringPanelAnswer(answered: bool, status: int, listRead: bool): W::PanelAnswer =
  if (not(answered)) W::NotAnswered
  else if (status == 403) W::AnswerForbidden
  else if (status == 503) W::AnswerMissing
  else if (listRead) W::AnswerRows
  else W::AnswerFailed

pure def gatheringDraftFormShown(answer: W::PanelAnswer): bool = answer == W::AnswerRows

pure def gatheringLocalTimeExact(year: int, matchCount: int): bool =
  year >= gatheringEarliestYear and matchCount == 1

pure def gatheringDraftReady(fieldsComplete: bool, now: int, startsAt: int, endsAt: int, inMonth: bool, capacity: int): bool =
  fieldsComplete and gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity)

pure def gatheringConfirmShown(phase: GatheringPhase, sameRow: bool, chosenRevision: int, revision: int): bool =
  monthlyGatheringReviewOffered(phase) and sameRow and chosenRevision == revision

pure def gatheringWriteFollowUp(saved: bool, status: int): GatheringWriteFollowUp =
  if (saved) GatheringWriteSaved
  else if (status == 403) GatheringWriteRefused
  else if (status == 409) GatheringWriteConflict
  else GatheringWriteFailed

pure def gatheringConfirmationCloses(followUp: GatheringWriteFollowUp): bool = followUp != GatheringWriteFailed

pure def gatheringListRead(followUp: GatheringWriteFollowUp): bool = followUp == GatheringWriteConflict

pure def gatheringErrorFor(code: str): GatheringError =
  if (code == "invalid_gathering") GatheringInvalid
  else if (code == "month_unavailable") GatheringMonthTaken
  else if (code == "gathering_not_reviewable") GatheringNotReviewable
  else if (code == "not_found") GatheringMissing
  else GatheringOtherError

pure def lawRefusedGatheringListShowsNoForm(listRead: bool): bool =
  not(gatheringDraftFormShown(gatheringPanelAnswer(true, 403, listRead)))

pure def lawGatheringFormNeedsTheList(answered: bool, status: int, listRead: bool): bool =
  gatheringDraftFormShown(gatheringPanelAnswer(answered, status, listRead)) implies (answered and listRead)

pure def lawSkippedOrRepeatedTimeIsRefused(year: int, matchCount: int): bool =
  matchCount != 1 implies not(gatheringLocalTimeExact(year, matchCount))

pure def lawReadyDraftPassesTheWindowRule(fieldsComplete: bool, now: int, startsAt: int, endsAt: int, inMonth: bool, capacity: int): bool =
  gatheringDraftReady(fieldsComplete, now, startsAt, endsAt, inMonth, capacity) implies
    (fieldsComplete and gatheringDraftWindowAllowed(now, startsAt, endsAt, inMonth, capacity))

pure def lawStaleRevisionShowsNoConfirm(phase: GatheringPhase, sameRow: bool, chosenRevision: int, revision: int): bool =
  gatheringConfirmShown(phase, sameRow, chosenRevision, revision) implies
    (phase == GatheringDraft and sameRow and chosenRevision == revision)

pure def lawRefusedWriteClosesTheConfirmation(status: int): bool =
  (status == 403 or status == 409) implies gatheringConfirmationCloses(gatheringWriteFollowUp(false, status))

pure def lawOnlyAConflictReadsTheListAgain(saved: bool, status: int): bool =
  gatheringListRead(gatheringWriteFollowUp(saved, status)) iff (not(saved) and status == 409)
```
