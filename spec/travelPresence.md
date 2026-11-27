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

### Shared areas lower cost only during the meeting window

For a proposed meeting in a city-bucket market, lower the activation cost when every participant has recorded presence in the same area for a common interval of positive length inside the proposed window. A valid dated visit replaces home or routine area evidence during that visit, including a visit inside the same city. A temporary presence needs both valid dates to supply area evidence. The end of a visit is excluded. For a candidate without a meeting window, use the listed areas.

```quint
pure def meetingAreaInterval(presence: PresenceWindow, requested: PresenceWindow): PresenceWindow = {
  from: if (presence.from > requested.from) presence.from else requested.from,
  to: if (presence.to < requested.to) presence.to else requested.to,
}

pure def lawMeetingAreaNeedsStrictOverlap(presence: PresenceWindow, requested: PresenceWindow): bool =
  presenceWindowValid(meetingAreaInterval(presence, requested)) == presenceWindowsOverlap(presence, requested)
```

## Story: Tell the Network my travel dates

> As a member, I want to tell the agent where I will be and see which app saved my travel dates.

### A signed travel statement saves only the member's own dates in that app

The signed conversation identifies the app and checks that the phone still belongs to the active member there. Without that binding, the command produces no write or reply. The shell accepts exact calendar dates in the destination city and treats the end date as the first day outside the trip. A missing, invalid, or ended window asks for dates. An overlapping stay in a different city needs a correction. Repeating the same stay leaves one record. The travel entry and its completed signed confirmation commit together under the [signed inbox rule](signedInbox.md). A runtime failure after the save preserves that confirmation for an authorized retry. This command changes no consent, account status, home location, or matching markets.

```quint
type TravelEntry = TravelUnavailable | TravelNeedsDates | TravelDateConflict | TravelAlreadySaved | TravelSave

pure def travelEntryReplyAllowed(canonicalMember: bool, activeMemberRow: bool): bool =
  canonicalMember and activeMemberRow

pure def samePresenceWindow(first: PresenceWindow, second: PresenceWindow): bool =
  first.from == second.from and first.to == second.to

pure def decideTravelEntry(authorized: bool, hasDates: bool, window: PresenceWindow, now: int, conflict: bool, saved: bool): TravelEntry =
  if (not(authorized)) TravelUnavailable
  else if (not(hasDates) or not(presenceWindowCurrentOrFuture(window, now))) TravelNeedsDates
  else if (conflict) TravelDateConflict
  else if (saved) TravelAlreadySaved
  else TravelSave

pure def lawUnavailableTravelNeverSaves(hasDates: bool, window: PresenceWindow, now: int, conflict: bool, saved: bool): bool =
  decideTravelEntry(false, hasDates, window, now, conflict, saved) == TravelUnavailable

pure def lawRepeatedTravelDoesNotSave(window: PresenceWindow, now: int, conflict: bool): bool =
  decideTravelEntry(true, true, window, now, conflict, true) != TravelSave

pure val firstValues = windowValues
pure val secondValues = windowValues
pure val presenceValues = windowValues
```

### A signed start correction moves one saved trip start

The signed conversation identifies the app and checks that the phone still belongs to the active member there, as for a save. Without that binding, the command produces no write or reply. A correction naming a saved trip's city, its new start weekday, and the start weekday it replaces moves only the earliest current or future saved trip to that city whose start falls on the replaced weekday, keeping that trip's end date. The new start is the named weekday in the same week as the saved start, read in the trip city's time zone. A start that would not precede the trip's end changes nothing. A later trip, a trip to another city, another member's trip, and a trip that has ended all stay. The reply names the corrected trip with its dates, with the end date excluded. When no such trip is saved, the reply says so and nothing changes. This command changes no consent, account status, home location, or matching markets.

```quint
type TravelStartCorrection = TravelStartUnavailable | TravelStartNone | TravelStartMove

pure def decideTravelStartCorrection(authorized: bool, matchingTrips: int, startPrecedesEnd: bool): TravelStartCorrection =
  if (not(authorized)) TravelStartUnavailable
  else if (matchingTrips > 0 and startPrecedesEnd) TravelStartMove
  else TravelStartNone

pure def lawStartCorrectionMovesOneOnlyWhenSaved(authorized: bool, matchingTrips: int, startPrecedesEnd: bool): bool =
  decideTravelStartCorrection(authorized, matchingTrips, startPrecedesEnd) == TravelStartMove implies (authorized and matchingTrips > 0 and startPrecedesEnd)

pure def lawUnauthorizedStartCorrectionChangesNothing(matchingTrips: int, startPrecedesEnd: bool): bool =
  decideTravelStartCorrection(false, matchingTrips, startPrecedesEnd) == TravelStartUnavailable

pure val matchingTripsValues = Set(-1, 0, 1, 2)
pure val startPrecedesEndValues = Set(true, false)
```
