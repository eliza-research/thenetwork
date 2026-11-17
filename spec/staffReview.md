# Staff review desk controller

The browser owns one draft controller per mounted review queue or opportunity view. It uses the selected app, mode, opportunity, and review revision to bind a controller to what the reviewer sees. The [standalone review desk model](models/review_desk.md) also models server decisions and the matching switch.

## Story: Review the opportunity I selected

> As a reviewer, I want the note and edit draft to belong to the opportunity and revision I can see.

### The visible card follows focus and queue order

Use an opportunity focus that remains pending. Otherwise use the reviewer’s held selection when it remains pending. Otherwise use the first card in the deadline-ordered list.

```quint
pure def selectedReviewCard(pendingCards: List[str], focusedCard: str, heldCard: str): str =
  if (pendingCards.includes(focusedCard)) focusedCard
  else if (pendingCards.includes(heldCard)) heldCard
  else if (pendingCards.length() > 0) pendingCards.head()
  else ""
```

### A changed card or revision starts a fresh draft

Start in idle mode. A different bound card resets the mode and its revision. The shell discards notes, draft text, and errors attached to the old revision. Selecting the same card again keeps its draft. The shell includes the review revision so a re-roll can replace the draft even when the opportunity ID is the same.

```quint
type ReviewMode = IdleReview | RejectReview | EditReview | RerollReview
type ReviewCtl = { cardKey: str, revision: int, mode: ReviewMode, noteNeeded: bool }
pure val initial: ReviewCtl = { cardKey: "", revision: 0, mode: IdleReview, noteNeeded: false }

pure def canBindCard(ctl: ReviewCtl, cardKey: str): bool = cardKey != ctl.cardKey
pure def bindCard(ctl: ReviewCtl, cardKey: str): ReviewCtl =
  { cardKey: cardKey, revision: ctl.revision + 1, mode: IdleReview, noteNeeded: false }
```

### A mode change applies only to a bound card

A mode button toggles its panel, and a shortcut opens that mode. Each mode change clears the prompt for a required note, also when a shortcut opens the mode that is already open. The shell supplies the selected card's current edit values when entering edit mode.

```quint
pure def canChangeReviewMode(ctl: ReviewCtl): bool = ctl.cardKey != ""

pure def changeReviewMode(ctl: ReviewCtl, requestedMode: ReviewMode, togglePanel: bool): ReviewCtl =
  { ...ctl, mode: if (togglePanel and requestedMode == ctl.mode) IdleReview else requestedMode, noteNeeded: false }

pure def canRequireReviewNote(ctl: ReviewCtl): bool = ctl.cardKey != "" and ctl.mode == RejectReview
pure def requireReviewNote(ctl: ReviewCtl): ReviewCtl = { ...ctl, noteNeeded: true }

pure def alwaysRequiredNoteBelongsToRejection(ctl: ReviewCtl): bool = ctl.noteNeeded implies ctl.mode == RejectReview
```

### An old response cannot clear or move a newer selection

Only a response from the same card and draft revision can settle the controller. The shell settles the controller only for an accepted decision. Settling clears the old draft, closes the mode panel, and starts a new revision. The shell moves to a neighbor only for an accepted decision that still belongs to this mounted queue. The shell does not settle the controller for a refused decision, so the draft stays on its own card.

```quint
pure def ownsReviewResponse(ctl: ReviewCtl, cardKey: str, revision: int): bool =
  ctl.cardKey != "" and ctl.cardKey == cardKey and ctl.revision == revision

pure def canSettleReview(ctl: ReviewCtl, cardKey: str, revision: int): bool =
  ownsReviewResponse(ctl, cardKey, revision)

pure def settleReview(ctl: ReviewCtl, cardKey: str, revision: int): ReviewCtl =
  { ...ctl, revision: ctl.revision + 1, mode: IdleReview, noteNeeded: false }

pure def stepRevisionNeverFalls(before: ReviewCtl, after: ReviewCtl): bool = after.revision >= before.revision
pure def sometimesReviewDraftOpens(ctl: ReviewCtl): bool = ctl.mode == EditReview
```

### A plan preview belongs to the open revision under review

For a planner proposal, staff authorized to read the review queue for the app can read the public place, activity window, quorum, seat limit, invitation deadline, and ordered alternates for the specific review revision. A Friends activity partner proposal with several reviewed times shows each complete interval in chronological order at the same venue. The preview uses the invitation deadline that applies to the earliest option. The Network reads these fields from the plan and the current review roster. It returns the preview only while that revision is pending and its review deadline is open. The read records the actor, app, and opportunity before it returns any preview.

```quint
import reviewDeadline as Deadline from "./reviewDeadline"

pure def reviewPlanPreviewCurrent(pending: bool, hasPlan: bool, seenRevision: int, currentRevision: int, currentTime: int, deadline: int): bool =
  pending and hasPlan and Deadline::reviewRevisionCurrent(seenRevision, currentRevision) and not(Deadline::reviewLate(currentTime, deadline))

pure def lawPlanPreviewClosesAtDeadline(pending: bool, hasPlan: bool, revision: int, deadline: int): bool =
  not(reviewPlanPreviewCurrent(pending, hasPlan, revision, revision, deadline, deadline))

pure def lawPlanPreviewRefusesOlderRevision(currentTime: int, deadline: int, revision: int): bool =
  not(reviewPlanPreviewCurrent(true, true, revision, revision + 1, currentTime, deadline))
```

### Plan approval in the console waits for the selected preview

The real review card waits for the preview of its selected app, opportunity, revision and deadline before enabling approval or edit-and-approve. A change to the viewer, mode, app, card, or revision drops the old preview. Pending and unavailable previews leave approval disabled. Rejection and re-roll remain available. The existing service rechecks eligibility and the review revision when a reviewer decides.

```quint
pure def planPreviewMatchesCard(cardApp: str, previewApp: str, cardId: str, previewId: str, cardRevision: int, previewRevision: int, cardDeadline: int, previewDeadline: int): bool =
  cardApp == previewApp and cardId == previewId and Deadline::reviewRevisionCurrent(cardRevision, previewRevision) and cardDeadline == previewDeadline

pure def lawOlderPlanPreviewCannotEnableApproval(app: str, id: str, revision: int, deadline: int): bool =
  not(planPreviewMatchesCard(app, app, id, id, revision + 1, revision, deadline, deadline))
```
