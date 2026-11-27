# Top-1 suggestion flow, density routing, and mode scoring

Venue suggestions use a bounded single-pick pivot loop, density-aware supply tiers, red-line-safe first-date activity checks, and deterministic mode-specific scoring for friend meetups versus dates.

## Story: Bound suggestion pivots and prevent repeats

> As a member choosing a spot, I want at most three venue swaps and never to see a spot I already rejected or visited.

### Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues

Each scheduling attempt allows at most three pivots (`maxSuggestionPivots = 3`). Once three pivots are used, or when no eligible candidates remain, the flow asks the member to name a spot or pause instead of pitching another venue.

```quint
pure val maxSuggestionPivots: int = 3

pure def clampSuggestionScore(value: int, low: int, high: int): int =
  if (value < low) low else if (value > high) high else value

pure def canPivotSuggestion(
  pivotsUsed: int,
  candidateAlreadyRejected: bool,
  candidateAlreadyVisited: bool
): bool =
  pivotsUsed >= 0
    and pivotsUsed < maxSuggestionPivots
    and not(candidateAlreadyRejected)
    and not(candidateAlreadyVisited)

pure def nextSuggestionAction(pivotsUsed: int, remainingCandidates: int): str =
  if (pivotsUsed < 0 or pivotsUsed >= maxSuggestionPivots or remainingCandidates <= 0)
    "ask_user_spot_or_pause"
  else
    "propose_next"

pure def lawSuggestionPivotsBounded(
  pivotsUsed: int,
  candidateAlreadyRejected: bool,
  candidateAlreadyVisited: bool
): bool =
  canPivotSuggestion(pivotsUsed, candidateAlreadyRejected, candidateAlreadyVisited) implies
    (pivotsUsed >= 0 and pivotsUsed < maxSuggestionPivots and not(candidateAlreadyRejected) and not(candidateAlreadyVisited))

pure def lawNextSuggestionStopsAtLimitOrEmpty(pivotsUsed: int, remainingCandidates: int): bool =
  (pivotsUsed >= maxSuggestionPivots or pivotsUsed < 0 or remainingCandidates <= 0) implies
    nextSuggestionAction(pivotsUsed, remainingCandidates) == "ask_user_spot_or_pause"
```

## Story: Route local supply by density and enforce date activity red lines

> As a member, I want local matching to adapt cleanly to supply density and never suggest a date activity that breaks my red lines.

### Classify local supply into dense, medium, or sparse tiers

Friends uses thresholds `>= 6` (dense), `2..5` (medium), and `<= 1` (sparse). Dating (`"slop"`) uses thresholds `>= 3` (dense), `1..2` (medium), and `<= 0` (sparse).

```quint
pure def computeDensityTier(appKind: str, qualifiedLocalCount: int): str =
  if (appKind == "slop")
    if (qualifiedLocalCount >= 3) "dense"
    else if (qualifiedLocalCount >= 1) "medium"
    else "sparse"
  else
    if (qualifiedLocalCount >= 6) "dense"
    else if (qualifiedLocalCount >= 2) "medium"
    else "sparse"

pure def lawFriendsDensityTierThresholds(qualifiedLocalCount: int): bool =
  (qualifiedLocalCount >= 6 implies computeDensityTier("friends", qualifiedLocalCount) == "dense")
    and ((qualifiedLocalCount >= 2 and qualifiedLocalCount <= 5) implies computeDensityTier("friends", qualifiedLocalCount) == "medium")
    and (qualifiedLocalCount <= 1 implies computeDensityTier("friends", qualifiedLocalCount) == "sparse")

pure def lawSlopDensityTierThresholds(qualifiedLocalCount: int): bool =
  (qualifiedLocalCount >= 3 implies computeDensityTier("slop", qualifiedLocalCount) == "dense")
    and ((qualifiedLocalCount >= 1 and qualifiedLocalCount <= 2) implies computeDensityTier("slop", qualifiedLocalCount) == "medium")
    and (qualifiedLocalCount <= 0 implies computeDensityTier("slop", qualifiedLocalCount) == "sparse")

pure val appKindValues = Set("friends", "slop", "ntwrk")
```

### Exclude alcohol, high-walking, loud, and after-dark date activities when red lines apply

Forbid `"drinks"`, `"wine_bar"`, `"cocktail"`, `"bar"`, and `"brewery"` when any participant is strict sober or a non-drinker. Forbid `"hike"`, `"long_walk"`, `"climbing"`, and `"walk"` when any participant requires low walking. Forbid `"live_music"` and `"comedy"` when any participant requires low noise or daytime-only scheduling. Forbid `"outdoor_night_walk"` when daytime-only applies, and forbid any activity when daytime-only meets after dark.

```quint
pure def dateActivityAllowed(
  activityKind: str,
  anyStrictSober: bool,
  anyNonDrinker: bool,
  anyLowWalking: bool,
  anyLowNoise: bool,
  anyDaytimeOnly: bool,
  isAfterDark: bool
): bool =
  val isAlcoholActivity =
    activityKind == "drinks"
      or activityKind == "wine_bar"
      or activityKind == "cocktail"
      or activityKind == "bar"
      or activityKind == "brewery"
  val isHighWalkingActivity =
    activityKind == "hike"
      or activityKind == "long_walk"
      or activityKind == "climbing"
      or activityKind == "walk"
  val isLoudOrEveningActivity =
    activityKind == "live_music"
      or activityKind == "comedy"
  if (isAlcoholActivity and (anyStrictSober or anyNonDrinker))
    false
  else if (isHighWalkingActivity and anyLowWalking)
    false
  else if (isLoudOrEveningActivity and (anyLowNoise or anyDaytimeOnly))
    false
  else if (activityKind == "outdoor_night_walk" and anyDaytimeOnly)
    false
  else if (anyDaytimeOnly and isAfterDark)
    false
  else
    true

pure def lawSoberOrNonDrinkerNeverGetsDrinksActivity(
  anyStrictSober: bool,
  anyNonDrinker: bool,
  anyLowWalking: bool,
  anyLowNoise: bool,
  anyDaytimeOnly: bool,
  isAfterDark: bool
): bool =
  (anyStrictSober or anyNonDrinker) implies
    (not(dateActivityAllowed("drinks", anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, anyDaytimeOnly, isAfterDark))
      and not(dateActivityAllowed("wine_bar", anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, anyDaytimeOnly, isAfterDark))
      and not(dateActivityAllowed("cocktail", anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, anyDaytimeOnly, isAfterDark)))

pure def lawLowWalkingForbidsHike(
  anyStrictSober: bool,
  anyNonDrinker: bool,
  anyLowNoise: bool,
  anyDaytimeOnly: bool,
  isAfterDark: bool
): bool =
  not(dateActivityAllowed("hike", anyStrictSober, anyNonDrinker, true, anyLowNoise, anyDaytimeOnly, isAfterDark))
    and not(dateActivityAllowed("climbing", anyStrictSober, anyNonDrinker, true, anyLowNoise, anyDaytimeOnly, isAfterDark))
    and not(dateActivityAllowed("walk", anyStrictSober, anyNonDrinker, true, anyLowNoise, anyDaytimeOnly, isAfterDark))

pure def lawLowNoiseOrDaytimeForbidsLoudActivities(
  anyStrictSober: bool,
  anyNonDrinker: bool,
  anyLowWalking: bool,
  anyLowNoise: bool,
  anyDaytimeOnly: bool,
  isAfterDark: bool
): bool =
  (anyLowNoise or anyDaytimeOnly) implies
    (not(dateActivityAllowed("live_music", anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, anyDaytimeOnly, isAfterDark))
      and not(dateActivityAllowed("comedy", anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, anyDaytimeOnly, isAfterDark)))

pure def lawDaytimeOnlyForbidsAfterDark(
  activityKind: str,
  anyStrictSober: bool,
  anyNonDrinker: bool,
  anyLowWalking: bool,
  anyLowNoise: bool
): bool =
  not(dateActivityAllowed(activityKind, anyStrictSober, anyNonDrinker, anyLowWalking, anyLowNoise, true, true))

pure val activityKindValues = Set("coffee", "drinks", "wine_bar", "cocktail", "hike", "climbing", "walk", "live_music", "comedy", "outdoor_night_walk")
```

## Story: Score venues with mode-specific weights

> As the venue ranker, I want strong hobby-activity weighting for friend meetups and classic date-vibe weighting for dates.

### Compute a bounded 0..100 score with capped niche-hobby bonus on dates

Friends weights activity fit (35%), group rubric (30%), travel (15%), budget (10%), and persona (10%). Dating weights date vibe (30%), persona (25%), travel (20%), budget (15%), and safety/acoustics (10%), plus a capped 0..15 niche-hobby bonus only when both members share high hobby affinity and opted into activity dates.

```quint
type ModeVenueScoreInput = {
  scoreMode: str,
  activityFit: int,
  groupRubric: int,
  dateVibeFit: int,
  personaScore: int,
  travelScore: int,
  budgetFit: int,
  safetyAcoustics: int,
  bothShareHighHobbyAffinity: bool,
  bothOptedIntoActivityDates: bool,
  nicheHobbyBonus: int,
  midpointBonus: int
}

pure def slopNicheHobbyBonus(
  bothShareHighHobbyAffinity: bool,
  bothOptedIntoActivityDates: bool,
  requestedBonus: int
): int =
  if (bothShareHighHobbyAffinity and bothOptedIntoActivityDates)
    clampSuggestionScore(requestedBonus, 0, 15)
  else
    0

pure def modeVenueScore(m: ModeVenueScoreInput): int =
  val act = clampSuggestionScore(m.activityFit, 0, 100)
  val grp = clampSuggestionScore(m.groupRubric, 0, 100)
  val vibe = clampSuggestionScore(m.dateVibeFit, 0, 100)
  val prs = clampSuggestionScore(m.personaScore, 0, 100)
  val trv = clampSuggestionScore(m.travelScore, 0, 100)
  val bdg = clampSuggestionScore(m.budgetFit, 0, 100)
  val safe = clampSuggestionScore(m.safetyAcoustics, 0, 100)
  val mid = clampSuggestionScore(m.midpointBonus, 0, 10)
  val friendsBase = (35 * act + 30 * grp + 15 * trv + 10 * bdg + 10 * prs) / 100
  val slopBase = (30 * vibe + 25 * prs + 20 * trv + 15 * bdg + 10 * safe) / 100
  val hobbyBonus = slopNicheHobbyBonus(m.bothShareHighHobbyAffinity, m.bothOptedIntoActivityDates, m.nicheHobbyBonus)
  if (m.scoreMode == "friends")
    clampSuggestionScore(friendsBase + mid, 0, 100)
  else
    clampSuggestionScore(slopBase + hobbyBonus + mid, 0, 100)

pure def lawNicheHobbyBonusRequiresMutualOptInAndCap(
  bothShareHighHobbyAffinity: bool,
  bothOptedIntoActivityDates: bool,
  requestedBonus: int
): bool =
  val b = slopNicheHobbyBonus(bothShareHighHobbyAffinity, bothOptedIntoActivityDates, requestedBonus)
  b >= 0 and b <= 15 and (not(bothShareHighHobbyAffinity and bothOptedIntoActivityDates) implies b == 0)

pure def lawModeVenueScoreBounded(m: ModeVenueScoreInput): bool =
  val s = modeVenueScore(m)
  s >= 0 and s <= 100

pure val mValues = Set(
  {
    scoreMode: "friends", activityFit: 95, groupRubric: 90, dateVibeFit: 60, personaScore: 80,
    travelScore: 85, budgetFit: 90, safetyAcoustics: 90,
    bothShareHighHobbyAffinity: true, bothOptedIntoActivityDates: false, nicheHobbyBonus: 15, midpointBonus: 6
  },
  {
    scoreMode: "slop", activityFit: 50, groupRubric: 70, dateVibeFit: 88, personaScore: 85,
    travelScore: 80, budgetFit: 100, safetyAcoustics: 90,
    bothShareHighHobbyAffinity: true, bothOptedIntoActivityDates: true, nicheHobbyBonus: 25, midpointBonus: 6
  },
  {
    scoreMode: "slop", activityFit: 0, groupRubric: 0, dateVibeFit: 0, personaScore: 0,
    travelScore: 0, budgetFit: 0, safetyAcoustics: 0,
    bothShareHighHobbyAffinity: false, bothOptedIntoActivityDates: true, nicheHobbyBonus: 15, midpointBonus: -5
  }
)
```
