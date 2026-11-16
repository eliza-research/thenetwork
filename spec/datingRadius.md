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
