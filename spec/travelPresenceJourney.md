# Save and retire a signed travel window

A member of friends.help and slop.date declares a stay in the signed friends.help conversation. The [travel rules](travelPresence.md) define the dates and current authority. Each case uses two consecutive Pacific Time calendar dates. The driver reads the stored trip and the actual matching snapshot at the destination's end midnight.

## Story: Keep my travel dates in the app that owns them

> As a member, I want the signed conversation to save my confirmed trip once and stop using it when it ends or I leave that app.

### A new statement can save one trip in Friends

A member can save the dated stay in San Francisco or Los Angeles. A new statement for the same city and dates confirms the existing row. A new statement for the other city in the same interval asks for a correction. An incomplete or ended window asks for dates. A sender who has left Friends receives no travel reply. The trip and its collected confirmation belong to Friends only.

```quint
import travelPresence as Travel from "./travelPresence"

type TravelCity = SanFrancisco | LosAngeles
type SavedTrip = NoTrip | SanFranciscoTrip | LosAngelesTrip
type TravelEffect = TripSaved | TripAlreadySaved | DatesNeeded | DatesConflict | NoTravelReply | SaveReplayed | ReplayRefused
type TravelPresenceJourney = { activeFriends: bool, activeSlop: bool, reachedEnd: bool, trip: SavedTrip,
  hasSaveToRetry: bool, visibleForMatching: bool, slopTripCount: int }
type TravelStep = { state: TravelPresenceJourney, out: List[TravelEffect] }

pure val initial: TravelPresenceJourney = { activeFriends: true, activeSlop: true, reachedEnd: false,
  trip: NoTrip, hasSaveToRetry: false, visibleForMatching: false, slopTripCount: 0 }

pure def stayIn(city: TravelCity): SavedTrip = if (city == SanFrancisco) SanFranciscoTrip else LosAngelesTrip

pure def canDeclareTrip(s: TravelPresenceJourney, city: TravelCity, hasDates: bool): bool = true
pure def declareTrip(s: TravelPresenceJourney, city: TravelCity, hasDates: bool): TravelStep =
  val stay = stayIn(city)
  val decision = Travel::decideTravelEntry(s.activeFriends, hasDates, { from: 0, to: 1 },
    if (s.reachedEnd) 1 else 0, s.trip != NoTrip and s.trip != stay, s.trip == stay)
  if (decision == Travel::TravelSave)
    { state: { ...s, trip: stay, hasSaveToRetry: true, visibleForMatching: true }, out: List(TripSaved) }
  else { state: s, out: List(
    if (decision == Travel::TravelAlreadySaved) TripAlreadySaved
    else if (decision == Travel::TravelNeedsDates) DatesNeeded
    else if (decision == Travel::TravelDateConflict) DatesConflict
    else NoTravelReply) }

pure def alwaysOnlyFriendsOwnsTheTrip(s: TravelPresenceJourney): bool =
  s.activeSlop and s.slopTripCount == 0 and (s.trip != NoTrip implies s.activeFriends)

pure def sometimesSavesSanFrancisco(s: TravelPresenceJourney): bool = s.trip == SanFranciscoTrip
pure def sometimesSavesLosAngeles(s: TravelPresenceJourney): bool = s.trip == LosAngelesTrip
```

### The matching snapshot loses the trip at its exclusive end

At the first instant outside the trip, the matching snapshot leaves the trip out. The stored travel row remains until account cleanup. An exact retry of the original signed request returns the same collected confirmation to a current owner, even after the end. A new statement with ended dates asks for new dates.

```quint
pure def canReachTripEnd(s: TravelPresenceJourney): bool = true
pure def reachTripEnd(s: TravelPresenceJourney): TravelStep =
  { state: { ...s, reachedEnd: true, visibleForMatching: false }, out: List() }

pure def canRetryTripSave(s: TravelPresenceJourney): bool = s.hasSaveToRetry
pure def retryTripSave(s: TravelPresenceJourney): TravelStep =
  { state: s, out: List(if (s.activeFriends) SaveReplayed else ReplayRefused) }

pure def alwaysMatchingUsesTheLiveTrip(s: TravelPresenceJourney): bool =
  s.visibleForMatching == (s.trip != NoTrip and not(s.reachedEnd))

pure def sometimesTheSavedTripExpires(s: TravelPresenceJourney): bool = s.trip != NoTrip and s.reachedEnd
```

### Leaving Friends removes the trip and retires its saved reply

Leaving Friends erases the trip and prevents replay of its old collected reply. The member remains active in Slop and receives no travel reply for a new statement sent to the app they left.

```quint
pure def canLeaveTravelApp(s: TravelPresenceJourney): bool = true
pure def leaveTravelApp(s: TravelPresenceJourney): TravelStep =
  { state: { ...s, activeFriends: false, trip: NoTrip, visibleForMatching: false }, out: List() }

pure def sometimesLeavesAfterSaving(s: TravelPresenceJourney): bool = s.hasSaveToRetry and not(s.activeFriends)
```
