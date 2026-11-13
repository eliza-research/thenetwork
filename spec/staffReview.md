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

A mode button toggles its panel, and a shortcut opens that mode. Leaving a mode clears the prompt for a required note. The shell supplies the selected card's current edit values when entering edit mode.

```quint
pure def canChangeReviewMode(ctl: ReviewCtl): bool = ctl.cardKey != ""

pure def changeReviewMode(ctl: ReviewCtl, requestedMode: ReviewMode, togglePanel: bool): ReviewCtl =
  { ...ctl, mode: if (togglePanel and requestedMode == ctl.mode) IdleReview else requestedMode, noteNeeded: false }

pure def canRequireReviewNote(ctl: ReviewCtl): bool = ctl.cardKey != "" and ctl.mode == RejectReview
pure def requireReviewNote(ctl: ReviewCtl): ReviewCtl = { ...ctl, noteNeeded: true }

pure def alwaysRequiredNoteBelongsToRejection(ctl: ReviewCtl): bool = ctl.noteNeeded implies ctl.mode == RejectReview
```

### An old response cannot clear or move a newer selection

Only a response from the same card and draft revision can settle the controller. An accepted decision clears the old draft. The shell moves to a neighbor only for an accepted decision that still belongs to this mounted queue. A refused decision keeps the draft on its own card.

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
