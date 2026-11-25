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

### Vouch capacity counts only the vouches and stakes of its rolling period

The capacity is a rate per rolling period. The default period is thirty days. A good vouch or a lost stake counts only when its time is after the period start and not after the evaluation time. An entry exactly one period old no longer counts. So a lost stake lowers the allowance for one period, not for good, and an old good vouch does not raise it for good. The shell converts the configured days to milliseconds and counts the entries for which this check holds. A lost stake that the ledger has reversed stops counting from the time of the reversal: the reversal names that stake, and only that stake stops counting.

```quint
pure def vouchInPeriod(entryAt: int, asOf: int, periodMs: int): bool =
  entryAt > asOf - periodMs and entryAt <= asOf

pure def lawVouchPeriodDropsOldEntries(entryAt: int, asOf: int, periodMs: int): bool =
  entryAt <= asOf - periodMs implies not(vouchInPeriod(entryAt, asOf, periodMs))
```

### Earned organizing reach reserves the extra slots for low exposure

The configured maximum caps the total reach. Slots above the baseline are reserved for members with low exposure. A candidate takes a reserved slot only while a slot is left and the candidate's seat fits. A candidate whose seat does not fit is skipped and uses no slot. The shell computes completed session bands, applies any active abuse or fraud lock, and considers eligible candidates in order of least recent participation. For a Friends crew session, the shell finds that a seat fits only when the candidate has no block or avoid rule with each retained crew member and each candidate already added, and `currentFriendPlanSeatFits` ([plan decisions](planDecision.md)) holds for the candidate's current Friend pair values with them.

```quint
type ReachAllowance = { max: int, reservedForLowExposure: int }

pure def reachFromBands(bands: int, base: int, perBand: int, maximum: int): ReachAllowance =
  val reach = base + bands * perBand
  val capped = if (reach < maximum) reach else maximum
  { max: capped, reservedForLowExposure: if (capped > base) capped - base else 0 }

pure def organizingReachSeatTaken(added: int, extra: int, seatFits: bool): bool = added < extra and seatFits

pure def lawReachUsesOnlyReservedSlots(added: int, extra: int, seatFits: bool): bool =
  organizingReachSeatTaken(added, extra, seatFits) implies added + 1 <= extra
```

### Capital never makes an incompatible candidate eligible

Effort tiers and organizing reach change only how much work the Network does for the member and how many invitations a plan can carry. The shell uses the effort tier only for the effort settings of the member's own requests (judge depth, research depth and plan-building options), never for the pair gate or the pair value. A reserved reach slot still needs a seat that fits, so no amount of reach seats a candidate whose seat does not fit.

```quint
pure def lawReachNeverSeatsAnIncompatibleCandidate(added: int, extra: int): bool =
  not(organizingReachSeatTaken(added, extra, false))
```
