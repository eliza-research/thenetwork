# Dating radius

The [engine flow model](models/engine_rules.md) checks `radiusMutual` and `pairDecisionSymmetric` with a small set of locations and whole distances. The runtime calculates distance from coarse cells in miles, including fractional miles, adds the privacy margin, and supplies the adjusted distance to these comparisons without rounding.

## Story: Find a date within both travel limits

> As a slop.date member, I want a proposed meeting market to fit both members' travel limits and location preferences.

### A meeting market must be available to both members

The market must be in the app's configured market list and in each member's set of dating markets. These sets include the markets each member selected and their relevant trips. The engine reads both sets before calculating the distance.

```quint
pure def sharedDatingMarket(inFirst: bool, inSecond: bool, listed: bool): bool =
  inFirst and inSecond and listed
```

### The distance and margin must fit both members' limits

The engine adds the privacy margin to the distance between the two coarse cells. Equality with either limit is allowed. The engine handles an unknown limit separately and orders eligible markets by distance.

```quint
pure def withinAdjustedRadius(adjustedMiles: int, firstLimit: int, secondLimit: int): bool =
  adjustedMiles <= firstLimit and adjustedMiles <= secondLimit

pure def lawRadiusMutual(adjustedMiles: int, firstLimit: int, secondLimit: int): bool =
  withinAdjustedRadius(adjustedMiles, firstLimit, secondLimit) implies
    (adjustedMiles <= firstLimit and adjustedMiles <= secondLimit)

pure def lawPairDecisionSymmetric(adjustedMiles: int, firstLimit: int, secondLimit: int): bool =
  withinAdjustedRadius(adjustedMiles, firstLimit, secondLimit) ==
    withinAdjustedRadius(adjustedMiles, secondLimit, firstLimit)
```

### Both members' current dating limits apply until reveal

Recheck the exact pair at review approval, before either anonymous probe, before booking, and when the queued probe or reveal is claimed. Both members must still be eligible adults with complete dating settings and no current safety hold. Both must still fit the other's stated seeking, age range, dealbreakers, and travel limits in the app's market. If either person's authority changes, stop the outdated invitation or reveal. Keep the review and each member's consent as separate requirements.

```quint
type CurrentSlopPair = { adults: bool, optedIn: bool, safetyClear: bool, complete: bool,
  seeksMutually: bool, agesFit: bool, dealbreakersClear: bool, radiusFits: bool }

pure def slopPairConstraintsCurrent(pair: CurrentSlopPair): bool = and {
  pair.adults, pair.optedIn, pair.safetyClear, pair.complete,
  pair.seeksMutually, pair.agesFit, pair.dealbreakersClear, pair.radiusFits,
}

pure def slopPairContactAllowed(approved: bool, pairCurrent: bool, reveal: bool, bothConsented: bool): bool =
  approved and pairCurrent and (not(reveal) or bothConsented)

pure def lawSlopPairRevealNeedsCurrentConsent(approved: bool, pairCurrent: bool, bothConsented: bool): bool =
  slopPairContactAllowed(approved, pairCurrent, true, bothConsented) implies (approved and pairCurrent and bothConsented)
```

### Date planning uses the matched members' canonical profiles

Apply the same input member aliases to matching and date planning. A current member ID takes priority over an alias with the same key. Follow at most eight links. An ID that still has no current member supplies no profile evidence. A caller that supplies its own resolver gets a separate profile view.

```quint
pure val maxMemberAliasHops = 8

pure def mayFollowMemberAlias(currentMember: bool, aliasExists: bool, hops: int): bool =
  not(currentMember) and aliasExists and hops < maxMemberAliasHops

pure def lawCurrentMemberIdHasPriority(aliasExists: bool, hops: int): bool =
  not(mayFollowMemberAlias(true, aliasExists, hops))

pure def lawMemberAliasSearchIsBounded(currentMember: bool, aliasExists: bool, hops: int): bool =
  hops >= maxMemberAliasHops implies not(mayFollowMemberAlias(currentMember, aliasExists, hops))
```

### A mutual named introduction stays in first-date history

Use a positive receipt from each member's exact original named booking on the same reviewed Slop opportunity. Record one accepted introduction at the later receipt time. Keep it if the booking changes, is cancelled, or receives no feedback. Other receipts and anonymous probes leave first-date history open. An accepted introduction records exposure to the other member's name. Attended-meeting evidence and an explicit mutual request to meet again use their own rules.

```quint
pure def slopFirstIntroductionAt(firstCollected: int, firstReceived: int, secondCollected: int, secondReceived: int, asOf: int): int =
  if (firstCollected >= 0 and secondCollected >= 0 and firstReceived >= firstCollected and
      secondReceived >= secondCollected and firstReceived <= asOf and secondReceived <= asOf) {
    if (firstReceived >= secondReceived) firstReceived else secondReceived
  } else -1

pure def lawSlopIntroductionNeedsBothReceipts(firstCollected: int, firstReceived: int, secondCollected: int, asOf: int): bool =
  slopFirstIntroductionAt(firstCollected, firstReceived, secondCollected, -1, asOf) == -1
```

### Only encounter-backed blocks inform a member review

Every block keeps both members apart. A block can inform the separate dating review only when the same two members already shared a recorded completed or no-show encounter in this app. Count each qualifying blocker once. Anonymous proposals and later encounters provide no evidence for the earlier block. Other safety and staff decisions apply independently.

```quint
pure def slopRecordedBlockContext(encounterResult: str): bool = Set("completed", "no_show").contains(encounterResult)

pure def slopContextualBlockAllowed(encounterAt: int, blockedAt: int, now: int): bool =
  encounterAt >= 0 and encounterAt <= blockedAt and blockedAt <= now

pure def lawNoBlockContextWithoutAnEncounter(blockedAt: int, now: int): bool =
  not(slopContextualBlockAllowed(-1, blockedAt, now))
```
