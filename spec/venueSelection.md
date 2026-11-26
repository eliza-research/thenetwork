# Venue eligibility, freshness, and scoring

Every venue recommendation passes hard safety, accessibility, freshness, budget, and travel checks before ranking. Local venue supply suppresses external API calls when enough qualified venues already exist.

## Story: Recommend only safe, open, and suitable public venues

> As a member meeting others at a recommended venue, I want the venue to be public, open, age-appropriate, within my budget and travel limit, and compatible with everyone's dietary and accessibility needs.

### Hard venue eligibility enforces public safety, age, dietary, and group rules

A venue is eligible only when it is public, active, verified open with sufficient closing buffer (at least 120 minutes for groups of 3 or more, and at least 90 minutes otherwise), within budget and travel limits, and neither visited nor rejected by any participant. Every participant must meet the venue minimum age. Any roster with a minor requires an all-ages venue (`venueAgeMin <= 13`), never bar-only, with alcohol optional. Non-drinkers never receive bar-only venues and require alcohol-optional service. Vegan, vegetarian, and wheelchair requirements are mandatory when any participant needs them. Impromptu groups of 3 or more require no reservation, separate checks, and walk-in capacity at least equal to the group size.

```quint
import memberAge as Age from "./memberAge"

type VenueStatus = Active | SuspectClosed | ClosedTemporary | ClosedPermanent

pure val pairOpenBufferMin: int = 90
pure val groupOpenBufferMin: int = 120
pure val impromptuGroupMinSize: int = 3

pure def venueHardEligible(
  isPublic: bool,
  status: VenueStatus,
  minMemberAge: int,
  venueAgeMin: int,
  isBarOnly: bool,
  alcoholOptional: bool,
  anyNonDrinker: bool,
  anyVegan: bool,
  servesVegan: bool,
  anyVegetarian: bool,
  servesVegetarian: bool,
  anyWheelchair: bool,
  wheelchairAccessible: bool,
  anyVisited: bool,
  anyRejected: bool,
  priceTier: int,
  maxBudgetTier: int,
  maxTravelMin: int,
  travelLimitMin: int,
  verifiedOpen: bool,
  openBufferMin: int,
  groupSize: int,
  reservationRequired: bool,
  separateChecks: bool,
  walkInCapacity: int
): bool =
  val requiredBuffer = if (groupSize >= impromptuGroupMinSize) groupOpenBufferMin else pairOpenBufferMin
  val minorOk = minMemberAge >= Age::adultAge or (venueAgeMin <= Age::minMemberAge and not(isBarOnly) and alcoholOptional)
  val groupOk = groupSize < impromptuGroupMinSize or (not(reservationRequired) and separateChecks and walkInCapacity >= groupSize)
  isPublic
    and status == Active
    and groupSize >= 1
    and Age::joinableAge(minMemberAge)
    and venueAgeMin >= 0
    and venueAgeMin <= minMemberAge
    and minorOk
    and (not(anyNonDrinker) or (not(isBarOnly) and alcoholOptional))
    and (not(anyVegan) or servesVegan)
    and (not(anyVegetarian) or servesVegetarian)
    and (not(anyWheelchair) or wheelchairAccessible)
    and not(anyVisited)
    and not(anyRejected)
    and priceTier >= 0
    and priceTier <= maxBudgetTier
    and maxTravelMin >= 0
    and travelLimitMin > 0
    and maxTravelMin <= travelLimitMin
    and verifiedOpen
    and openBufferMin >= requiredBuffer
    and groupOk

pure def lawPrivateVenueNeverEligible(
  status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyNonDrinker: bool, anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  not(venueHardEligible(
    false, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
    anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
    anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
    priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
    verifiedOpen, openBufferMin, groupSize, reservationRequired,
    separateChecks, walkInCapacity))

pure def lawInactiveVenueNeverEligible(
  isPublic: bool, status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyNonDrinker: bool, anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  (status != Active) implies not(venueHardEligible(
    isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
    anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
    anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
    priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
    verifiedOpen, openBufferMin, groupSize, reservationRequired,
    separateChecks, walkInCapacity))

pure def lawVisitedOrRejectedNeverEligible(
  isPublic: bool, status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyNonDrinker: bool, anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  (anyVisited or anyRejected) implies not(venueHardEligible(
    isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
    anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
    anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
    priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
    verifiedOpen, openBufferMin, groupSize, reservationRequired,
    separateChecks, walkInCapacity))

pure def lawNonDrinkerNeverGetsBar(
  isPublic: bool, status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  (isBarOnly or not(alcoholOptional)) implies not(venueHardEligible(
    isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
    true, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
    anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
    priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
    verifiedOpen, openBufferMin, groupSize, reservationRequired,
    separateChecks, walkInCapacity))

pure def lawMinorNeverGetsAdultOrBarVenue(
  isPublic: bool, status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyNonDrinker: bool, anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  (minMemberAge < Age::adultAge and (venueAgeMin > Age::minMemberAge or isBarOnly or not(alcoholOptional)))
    implies not(venueHardEligible(
      isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
      anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
      anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
      priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
      verifiedOpen, openBufferMin, groupSize, reservationRequired,
      separateChecks, walkInCapacity))

pure def lawImpromptuGroupNeedsWalkInAndSeparateChecks(
  isPublic: bool, status: VenueStatus, minMemberAge: int, venueAgeMin: int, isBarOnly: bool, alcoholOptional: bool,
  anyNonDrinker: bool, anyVegan: bool, servesVegan: bool, anyVegetarian: bool, servesVegetarian: bool,
  anyWheelchair: bool, wheelchairAccessible: bool, anyVisited: bool, anyRejected: bool,
  priceTier: int, maxBudgetTier: int, maxTravelMin: int, travelLimitMin: int,
  verifiedOpen: bool, openBufferMin: int, groupSize: int, reservationRequired: bool,
  separateChecks: bool, walkInCapacity: int
): bool =
  (groupSize >= impromptuGroupMinSize and venueHardEligible(
    isPublic, status, minMemberAge, venueAgeMin, isBarOnly, alcoholOptional,
    anyNonDrinker, anyVegan, servesVegan, anyVegetarian, servesVegetarian,
    anyWheelchair, wheelchairAccessible, anyVisited, anyRejected,
    priceTier, maxBudgetTier, maxTravelMin, travelLimitMin,
    verifiedOpen, openBufferMin, groupSize, reservationRequired,
    separateChecks, walkInCapacity))
    implies (not(reservationRequired) and separateChecks and walkInCapacity >= groupSize and openBufferMin >= groupOpenBufferMin)

pure val minMemberAgeValues = Set(12, 13, 16, 17, 18, 25, 121)
pure val venueAgeMinValues = Set(0, 13, 18, 21)
pure val priceTierValues = Set(-1, 0, 1, 2, 3, 4)
pure val maxBudgetTierValues = Set(0, 1, 2, 3, 4)
pure val maxTravelMinValues = Set(-1, 0, 15, 30, 45)
pure val travelLimitMinValues = Set(0, 20, 30, 45)
pure val openBufferMinValues = Set(0, 60, 90, 120, 180)
pure val groupSizeValues = Set(0, 1, 2, 3, 4, 6)
pure val walkInCapacityValues = Set(0, 2, 4, 6, 10)
```

## Story: Keep venue data fresh and avoid redundant external searches

> As the matching service, I want to query external venue providers only when local supply is below threshold, recheck stale open hours before recommending, and quarantine reported closures immediately.

### External venue search runs only when local supply is below threshold and budget remains

When the local catalog already holds at least the sufficiency threshold (default 10) of qualified venues, or when no API budget remains, the service does not fetch external venues.

```quint
pure val defaultLocalSufficiencyThreshold: int = 10

pure def shouldFetchExternalVenues(localQualifiedCount: int, sufficiencyThreshold: int, apiBudgetRemaining: int): bool =
  localQualifiedCount < sufficiencyThreshold and apiBudgetRemaining > 0

pure def lawSufficientLocalPoolNeverFetches(localQualifiedCount: int, apiBudgetRemaining: int): bool =
  localQualifiedCount >= defaultLocalSufficiencyThreshold
    implies not(shouldFetchExternalVenues(localQualifiedCount, defaultLocalSufficiencyThreshold, apiBudgetRemaining))

pure def lawZeroBudgetNeverFetches(localQualifiedCount: int, sufficiencyThreshold: int, apiBudgetRemaining: int): bool =
  apiBudgetRemaining <= 0 implies not(shouldFetchExternalVenues(localQualifiedCount, sufficiencyThreshold, apiBudgetRemaining))

pure val localQualifiedCountValues = Set(0, 5, 9, 10, 15)
pure val sufficiencyThresholdValues = Set(5, 10, 15)
pure val apiBudgetRemainingValues = Set(-1, 0, 1, 5)
```

### Pre-recommendation open check expires after 6 hours on weekends or 24 hours on weekdays

A venue open-hours check is stale when its age is negative, at least 360 minutes on a weekend or holiday, or at least 1440 minutes on a weekday.

```quint
pure val weekendOpenCheckMaxAgeMin: int = 360
pure val weekdayOpenCheckMaxAgeMin: int = 1440

pure def needsPreRecommendOpenCheck(ageMinutes: int, isWeekendOrHoliday: bool): bool =
  val maxAgeMin = if (isWeekendOrHoliday) weekendOpenCheckMaxAgeMin else weekdayOpenCheckMaxAgeMin
  ageMinutes < 0 or ageMinutes >= maxAgeMin

pure def lawNegativeAgeAlwaysNeedsOpenCheck(ageMinutes: int, isWeekendOrHoliday: bool): bool =
  ageMinutes < 0 implies needsPreRecommendOpenCheck(ageMinutes, isWeekendOrHoliday)

pure def lawWeekendCheckExpiresAtSixHours(ageMinutes: int): bool =
  ageMinutes >= weekendOpenCheckMaxAgeMin implies needsPreRecommendOpenCheck(ageMinutes, true)

pure def lawWeekdayCheckExpiresAtTwentyFourHours(ageMinutes: int): bool =
  ageMinutes >= weekdayOpenCheckMaxAgeMin implies needsPreRecommendOpenCheck(ageMinutes, false)

pure val ageMinutesValues = Set(-10, 0, 120, 359, 360, 720, 1439, 1440, 2000)
```

### Closure reports quarantine active venues immediately

A provider permanent closure signal or at least two closure reports moves a venue to `ClosedPermanent`. A provider temporary closure signal moves a non-permanent venue to `ClosedTemporary`. Any single closure report immediately moves an `Active` venue out of active rotation into `SuspectClosed`.

```quint
type ProviderClosureSignal = ProviderOpen | ProviderTemporaryClosed | ProviderPermanentClosed

pure val permanentClosureReportThreshold: int = 2

pure def nextVenueStatusOnReport(currentStatus: VenueStatus, closureReportsAfter: int, providerCode: ProviderClosureSignal): VenueStatus =
  if (providerCode == ProviderPermanentClosed or closureReportsAfter >= permanentClosureReportThreshold) ClosedPermanent
  else if (providerCode == ProviderTemporaryClosed) (if (currentStatus == ClosedPermanent) ClosedPermanent else ClosedTemporary)
  else if (closureReportsAfter >= 1) (
    if (currentStatus == ClosedPermanent) ClosedPermanent
    else if (currentStatus == ClosedTemporary) ClosedTemporary
    else SuspectClosed)
  else currentStatus

pure def lawClosureReportQuarantinesActiveVenue(closureReportsAfter: int, providerCode: ProviderClosureSignal): bool =
  closureReportsAfter >= 1 implies nextVenueStatusOnReport(Active, closureReportsAfter, providerCode) != Active

pure def lawTwoReportsMarkPermanentClosure(currentStatus: VenueStatus, closureReportsAfter: int, providerCode: ProviderClosureSignal): bool =
  closureReportsAfter >= permanentClosureReportThreshold implies nextVenueStatusOnReport(currentStatus, closureReportsAfter, providerCode) == ClosedPermanent

pure def lawProviderPermanentMarksPermanentClosure(currentStatus: VenueStatus, closureReportsAfter: int): bool =
  nextVenueStatusOnReport(currentStatus, closureReportsAfter, ProviderPermanentClosed) == ClosedPermanent

pure val closureReportsAfterValues = Set(0, 1, 2, 3)
```

## Story: Score eligible venues for group fit and budget alignment

> As the matching engine, I want deterministic 0 to 100 scores for impromptu group suitability and member budget alignment.

### Group venue rubric scores suitability from 0 to 100

The group rubric awards up to 20 points for separate checks, up to 20 for walk-in seating capacity, up to 15 for conversational acoustics without night live music, up to 15 for alcohol-optional and dietary inclusivity, up to 10 for safety, up to 10 for indoor weather protection, 5 for a clear arrival landmark, and up to 5 for transit access.

```quint
type NoiseLevel = Quiet | Conversational | Lively | Loud

pure def clampScore(score: int, low: int, high: int): int =
  if (score < low) low else if (score > high) high else score

pure def groupVenueRubricScore(
  separateChecks: bool,
  walkInCapacity: int,
  noiseLevel: NoiseLevel,
  liveMusicAtNight: bool,
  alcoholOptional: bool,
  servesVegetarian: bool,
  servesVegan: bool,
  safetyScore: int,
  indoor: bool,
  weatherSensitive: bool,
  hasArrivalLandmark: bool,
  transitScore: int
): int =
  val checksPts = if (separateChecks) 20 else 0
  val capacityPts = if (walkInCapacity >= 6) 20 else if (walkInCapacity >= 4) 12 else 0
  val acousticPts =
    if (liveMusicAtNight) 0
    else if (noiseLevel == Conversational or noiseLevel == Lively) 15
    else if (noiseLevel == Quiet) 6
    else 0
  val inclusivityPts = (if (alcoholOptional) 8 else 0) + (if (servesVegetarian) 4 else 0) + (if (servesVegan) 3 else 0)
  val safetyPts = clampScore(safetyScore, 0, 10)
  val weatherPts = if (indoor and not(weatherSensitive)) 10 else if (indoor) 7 else if (not(weatherSensitive)) 4 else 0
  val landmarkPts = if (hasArrivalLandmark) 5 else 0
  val transitPts = clampScore(transitScore, 0, 5)
  checksPts + capacityPts + acousticPts + inclusivityPts + safetyPts + weatherPts + landmarkPts + transitPts

pure def lawGroupRubricScoreInRange(
  separateChecks: bool, walkInCapacity: int, noiseLevel: NoiseLevel, liveMusicAtNight: bool,
  alcoholOptional: bool, servesVegetarian: bool, servesVegan: bool, safetyScore: int,
  indoor: bool, weatherSensitive: bool, hasArrivalLandmark: bool, transitScore: int
): bool =
  val total = groupVenueRubricScore(
    separateChecks, walkInCapacity, noiseLevel, liveMusicAtNight,
    alcoholOptional, servesVegetarian, servesVegan, safetyScore,
    indoor, weatherSensitive, hasArrivalLandmark, transitScore)
  total >= 0 and total <= 100

pure val safetyScoreValues = Set(-1, 0, 5, 10, 12)
pure val transitScoreValues = Set(-1, 0, 3, 5, 8)
```

### Budget fit scores alignment from 0 to 100 and rejects over-budget venues

Any negative tier or venue price tier above the target budget tier scores 0. Exact match scores 100, one tier below scores 90, two tiers below scores 75, and further below scores 60.

```quint
pure def venueBudgetFitScore(priceTier: int, targetBudgetTier: int): int =
  val diff = targetBudgetTier - priceTier
  if (priceTier < 0 or targetBudgetTier < 0 or priceTier > targetBudgetTier) 0
  else if (diff == 0) 100
  else if (diff == 1) 90
  else if (diff == 2) 75
  else 60

pure def lawBudgetFitScoreInRange(priceTier: int, targetBudgetTier: int): bool =
  val score = venueBudgetFitScore(priceTier, targetBudgetTier)
  score >= 0 and score <= 100

pure def lawOverBudgetVenueScoresZero(priceTier: int, targetBudgetTier: int): bool =
  priceTier > targetBudgetTier implies venueBudgetFitScore(priceTier, targetBudgetTier) == 0

pure def lawExactBudgetScoresHundred(targetBudgetTier: int): bool =
  targetBudgetTier >= 0 implies venueBudgetFitScore(targetBudgetTier, targetBudgetTier) == 100

pure val targetBudgetTierValues = Set(-1, 0, 1, 2, 3, 4)
```
