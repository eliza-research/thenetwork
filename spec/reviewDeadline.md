# Opportunity review deadline

## Story: Act on a proposal while review is open

> As a member, I want the Network to close a proposal that staff do not review by its deadline.

### An opportunity expires at its review deadline

The deadline is exclusive. If the clock reaches it before the expiry tick, the review endpoint refuses the action and the tick closes the item without sending. The deadline also ends an exception that the review judge held for staff: it expires unsent. Changed (owner decision 2026-11-22, D17, "Hold for staff"): staff reviewed every item before its deadline; now the deadline ends an item that waits for the judge or that the judge held, and no held item is sent late.

```quint
pure def reviewLate(currentTime: int, deadline: int): bool =
  currentTime >= deadline

pure def lawReviewDeadlineIsExclusive(deadline: int): bool =
  reviewLate(deadline, deadline)
```

### A decision applies only to the revision the reviewer saw

The review revision of an opportunity is the number of re-rolls that kept it in review. It starts at 0 when the opportunity enters review, and each such re-roll adds 1, because a re-roll changes the people and the explanations. The review queue shows the revision with each item. A staff decision (approve, edit, reject, or re-roll) carries the revision that the reviewer saw, and the staff API refuses a decision without one. A decision with another revision is refused as stale and changes nothing: nobody is contacted, and the item waits for a decision on what it now says. The staff audit keeps the requested row and the refused result row. A materially changed proposal must pass review again ([policies](product/policies.md)). A caller inside the Network that reads and decides in the same unit of work cannot see an old revision, so it may decide without one.

```quint
pure def reviewRevisionCurrent(seenRevision: int, currentRevision: int): bool =
  seenRevision == currentRevision

pure def lawSeenReviewRevisionIsCurrent(revision: int): bool =
  reviewRevisionCurrent(revision, revision)

pure def lawRerolledReviewIsStale(seenRevision: int): bool =
  not(reviewRevisionCurrent(seenRevision, seenRevision + 1))
```
