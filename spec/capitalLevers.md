# Network capital levers

The [inbox and capital flow model](models/notify_capital.md) covers the events that earn credits. This module computes limits after the ledger shell filters the person's own entries and totals eligible events.

## Story: Use my past contributions without changing who can match with me

> As a member, I want my past contributions to affect my own effort and organizing allowance while introductions still follow the same eligibility rules.

### Effort uses four tiers

Select the highest threshold the member meets. A member below the first threshold receives the baseline tier. The shell maps the tier to effort for this member's own requests.

```quint
type EffortBand = Baseline | First | Second | Highest

pure def capitalEffortBand(balance: int, firstThreshold: int, secondThreshold: int, highestThreshold: int): EffortBand =
  if (balance >= highestThreshold) Highest
  else if (balance >= secondThreshold) Second
  else if (balance >= firstThreshold) First
  else Baseline
```

### Vouch capacity stays within its configured limits

Successful vouches add a bounded bonus. Lost stakes subtract from the allowance. Capacity cannot go below zero or above the configured maximum. The shell applies the active abuse and fraud lock before calculating the allowance.

```quint
pure def vouchCapacityFromCounts(good: int, lost: int, base: int, perGood: int, perLost: int, maxBonus: int, maximum: int): int =
  val earned = good * perGood
  val bonus = if (earned < maxBonus) earned else maxBonus
  val total = base + bonus - lost * perLost
  val capped = if (total < maximum) total else maximum
  if (capped > 0) capped else 0

pure def lawVouchCapacityIsBounded(good: int, lost: int, base: int, perGood: int, perLost: int, maxBonus: int, maximum: int): bool =
  maximum >= 0 implies
    (vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) >= 0 and
    vouchCapacityFromCounts(good, lost, base, perGood, perLost, maxBonus, maximum) <= maximum)
```

### Earned organizing reach reserves the extra slots for low exposure

The configured maximum caps the total reach. Slots above the baseline are reserved for members with low exposure. The shell computes completed session bands and applies any active abuse or fraud lock.

```quint
type ReachAllowance = { max: int, reservedForLowExposure: int }

pure def reachFromBands(bands: int, base: int, perBand: int, maximum: int): ReachAllowance =
  val reach = base + bands * perBand
  val capped = if (reach < maximum) reach else maximum
  { max: capped, reservedForLowExposure: if (capped > base) capped - base else 0 }
```
