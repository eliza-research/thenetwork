# Matching budgets and cooldowns

The [engine flow model](models/engine_rules.md) checks proposal and outreach history, including `budgetHeld`, `categoryCooldownHeld`, and `pairCooldownHeld`. The engine supplies counts, limits, timestamps, and interaction outcomes. The [participation budget spec](participationBudgets.md) gives default state and lane budgets.

## Story: Respect a member's participation limits

> As a member, I want the engine to stop proposing outreach or contributions when I reach my limits.

### The limit includes use already reserved for the decision

The engine adds reserved use to recorded use. A result equal to or above the configured limit blocks another proposal. This applies to interruption budgets, contribution budgets, and per-category quotas. The engine determines which budget applies to the candidate's role and category.

```quint
pure def budgetReached(used: int, extra: int, limit: int): bool = used + extra >= limit

pure def lawBudgetHeld(used: int, extra: int, limit: int): bool =
  not(budgetReached(used, extra, limit)) implies used + extra < limit
```

## Story: Wait after a decline or negative feedback

> As a member, I want the engine to respect my recent refusals and negative feedback before offering a related proposal.

### An applicable event blocks proposals until its cooldown ends

A recent category decline or a negative rating can start a cooldown. The event stops blocking when its age reaches the configured window. With no applicable event, the cooldown does not block the proposal.

```quint
pure def inCooldown(now: int, has: bool, at: int, window: int): bool =
  has and now - at < window

pure def lawCategoryCooldownHeld(now: int, has: bool, at: int, window: int): bool =
  (has and now - at < window) implies inCooldown(now, has, at, window)

pure def lawCooldownEndsAtWindow(now: int, at: int, window: int): bool =
  now - at >= window implies not(inCooldown(now, true, at, window))
```

### A recent decline, expiry, or cancellation blocks another pair proposal

A pair can have several prior interactions. A cooldown applies if any prior interaction ended in one of these three outcomes within the configured window.

```quint
pure def pairInteractionCooling(outcome: str, now: int, at: int, window: int): bool =
  (outcome == "declined" or outcome == "expired" or outcome == "cancelled") and inCooldown(now, true, at, window)

pure def lawPairCooldownHeld(now: int, at: int, window: int): bool =
  now - at < window implies and {
    pairInteractionCooling("declined", now, at, window),
    pairInteractionCooling("expired", now, at, window),
    pairInteractionCooling("cancelled", now, at, window),
  }
```
