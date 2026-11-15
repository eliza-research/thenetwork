# Dating radius

The [engine flow model](models/engine_rules.md) checks `radiusMutual` and `pairDecisionSymmetric` with a small set of locations and whole distances. The runtime calculates distance from coarse cells in miles, including fractional miles, and supplies it to these comparisons without rounding.

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
pure def withinMutualRadius(miles: int, margin: int, firstLimit: int, secondLimit: int): bool =
  miles + margin <= firstLimit and miles + margin <= secondLimit

pure def lawRadiusMutual(miles: int, margin: int, firstLimit: int, secondLimit: int): bool =
  withinMutualRadius(miles, margin, firstLimit, secondLimit) implies
    (miles + margin <= firstLimit and miles + margin <= secondLimit)

pure def lawPairDecisionSymmetric(miles: int, margin: int, firstLimit: int, secondLimit: int): bool =
  withinMutualRadius(miles, margin, firstLimit, secondLimit) ==
    withinMutualRadius(miles, margin, secondLimit, firstLimit)
```
