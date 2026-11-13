# Opportunity review deadline

## Story: Act on a proposal while review is open

> As a member, I want the Network to close a proposal that staff do not review by its deadline.

### An opportunity expires at its review deadline

The deadline is exclusive. If the clock reaches it before the expiry tick, the review endpoint refuses the action and the tick closes the item without sending.

```quint
pure def reviewLate(currentTime: int, deadline: int): bool =
  currentTime >= deadline

pure def lawReviewDeadlineIsExclusive(deadline: int): bool =
  reviewLate(deadline, deadline)
```
