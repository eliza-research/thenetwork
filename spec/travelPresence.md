# Travel presence

[F26](product/stories.md#story-f26--set-travel-and-presence) and [ME-011](product/source/prd.md#3312-engine-requirements) give a member a time-bounded presence in another city. The [candidate pool](models/candidate_pool.md) model abstracts that interval to a city per member. This rule supplies the interval for production matching and its dispatch recheck.

## Story: Use my travel dates for matching

> As a member, I want the Network to consider me in the city where I will be during an opportunity's time window.

### A temporary presence needs both dates in order

A trip starts before it ends. The shell reads both bounds before admitting a trip. A matching snapshot can keep an upcoming trip or one in progress. Once the end is reached, the trip no longer places the member in that city.

```quint
type PresenceWindow = { from: int, to: int }

pure val windowValues: Set[PresenceWindow] = Set(
  { from: -5, to: 0 }, { from: 0, to: 10 }, { from: 3, to: 8 },
  { from: 10, to: 20 }, { from: 10, to: 10 }, { from: 10, to: 5 })
pure val requestedValues = windowValues

pure def presenceWindowValid(window: PresenceWindow): bool = window.from < window.to

pure def presenceWindowCurrentOrFuture(window: PresenceWindow, now: int): bool =
  presenceWindowValid(window) and now < window.to

pure def lawTripLeavesSnapshotAtItsEnd(window: PresenceWindow): bool =
  not(presenceWindowCurrentOrFuture(window, window.to))
```

### City presence starts inclusively and ends exclusively

The member is in the trip city at its start and leaves at its end. A trip overrides home for the shared portion of a matching window. Windows that only touch have no shared time. When dispatch requires presence for a whole window, the trip must cover both bounds of that window.

```quint
pure def presenceWindowContains(window: PresenceWindow, at: int): bool =
  window.from <= at and at < window.to

pure def presenceWindowsOverlap(first: PresenceWindow, second: PresenceWindow): bool =
  presenceWindowValid(first) and presenceWindowValid(second) and first.from < second.to and second.from < first.to

pure def presenceWindowCovers(presence: PresenceWindow, requested: PresenceWindow): bool =
  presenceWindowValid(presence) and presenceWindowValid(requested) and presence.from <= requested.from and requested.to <= presence.to

pure def lawTripEndsExclusively(window: PresenceWindow): bool =
  not(presenceWindowContains(window, window.to))

pure def lawCoveringTripSharesTime(window: PresenceWindow, requested: PresenceWindow): bool =
  presenceWindowCovers(window, requested) implies presenceWindowsOverlap(window, requested)
```
