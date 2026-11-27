# Venue selection and geographic travel bounds

Public venue selection serves one-to-one dates, small friend groups, open impromptu meetups, and solo suggestions across the five launch cities. Pure travel bounds, midpoint costs, hard eligibility rules, red-line checks, catalog freshness, closure quarantine, group rubric scores, and budget scores live here. Every venue with a minor obeys the all-ages rule in [friend introductions with a minor](friendIntroAge.md).

## Story: Bound travel time and score fair midpoints

> As a member meeting others across a city, I want the selected neighborhood and venue to keep every commute fair and within our travel limit.

### Keep every participant travel time non-negative and within the travel limit

A travel time is valid only when it is non-negative, the travel limit is positive, and the travel time does not exceed the limit.

```quint
pure def isWithinTravelLimit(travelMin: int, limitMin: int): bool =
  travelMin >= 0 and limitMin > 0 and travelMin <= limitMin

pure def lawNegativeTravelNeverWithinLimit(limitMin: int): bool =
  not(isWithinTravelLimit(-1, limitMin))

pure def lawNonPositiveLimitNeverAcceptsTravel(travelMin: int): bool =
  not(isWithinTravelLimit(travelMin, 0)) and not(isWithinTravelLimit(travelMin, -1))

pure def lawExceedingLimitRejected(travelMin: int, limitMin: int): bool =
  travelMin > limitMin implies not(isWithinTravelLimit(travelMin, limitMin))
```

### Balance worst-case fairness and mean travel in integer-scaled midpoint cost

Score candidate midpoints with integer scaling (`6 * maxMin + 4 * meanMin`) and subtract a non-negative scaled venue supply bonus when comparing hubs.

```quint
pure def fairMidpointCostScaled(maxMin: int, meanMin: int): int =
  6 * maxMin + 4 * meanMin

pure def fairMidpointNetCostScaled(maxMin: int, meanMin: int, supplyBonusScaled: int): int =
  fairMidpointCostScaled(maxMin, meanMin) - supplyBonusScaled

pure def lawMidpointCostBoundedByMeanAndMax(maxMin: int, meanMin: int): bool =
  (maxMin >= 0 and meanMin >= 0 and meanMin <= maxMin) implies
    (fairMidpointCostScaled(maxMin, meanMin) >= 10 * meanMin and fairMidpointCostScaled(maxMin, meanMin) <= 10 * maxMin)
```

### Accept a midpoint only when every attendee fits within bounded relaxation

A midpoint candidate needs a non-empty list of travel times, a positive base limit, a relaxation step from 0 to 10 minutes, and every attendee travel time within `limitMin + relaxStepMin`.

```quint
pure def isValidMidpoint(travelMinutes: List[int], limitMin: int, relaxStepMin: int): bool =
  travelMinutes.length() > 0
    and limitMin > 0
    and relaxStepMin >= 0
    and relaxStepMin <= 10
    and travelMinutes.every(t => isWithinTravelLimit(t, limitMin + relaxStepMin))

pure def lawEmptyTravelListNeverValidMidpoint(limitMin: int, relaxStepMin: int): bool =
  not(isValidMidpoint(List(), limitMin, relaxStepMin))

pure def lawRelaxationBeyondTenMinutesRejected(travelMinutes: List[int], limitMin: int): bool =
  not(isValidMidpoint(travelMinutes, limitMin, 11)) and not(isValidMidpoint(travelMinutes, limitMin, -1))

pure def lawValidMidpointFitsEveryAttendee(travelMinutes: List[int], limitMin: int, relaxStepMin: int): bool =
  isValidMidpoint(travelMinutes, limitMin, relaxStepMin) implies
    travelMinutes.every(t => t >= 0 and t <= limitMin + relaxStepMin)

pure val travelMinutesValues = Set(List(), List(5, 15), List(10, 25), List(-1, 10), List(5, 45))
```

## Story: Enforce hard venue eligibility and attendee red lines

> As a member, I want every recommended venue to be a public, open, accessible place that respects all safety, age, dietary, and sobriety red lines.

### Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules

Every recommended venue must be public, active, verified open with at least 90 minutes buffer (120 minutes for groups of 3 or more), within budget and travel ceilings, and neither visited nor rejected. When a minor is present, the venue must be all-ages (`venueAllAges`, not bar-only, alcohol-optional, age minimum at most 13), and multi-person rosters require `teenFriendAllowed` and at most 6 people. Groups of 3 or more require separate checks, sufficient walk-in capacity, no live night music, and either no reservation required or a confirmed reservation (`hasReservation`).

```quint
type VenueHardEligibilityInput = {
  isPublic: bool,
  venueStatus: str,
  minParticipantAge: int,
  venueAgeMin: int,
  venueAllAges: bool,
  teenFriendAllowed: bool,
  anyNonDrinker: bool,
  isBarOnly: bool,
  alcoholOptional: bool,
  anyVegetarian: bool,
  servesVegetarian: bool,
  anyVegan: bool,
  servesVegan: bool,
  anyWheelchairNeeded: bool,
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
  hasReservation: bool,
  separateChecks: bool,
  walkInCapacity: int,
  isNightLiveMusic: bool,
  isOutdoorOnly: bool,
  badWeatherOrAfterDark: bool
}

pure def venueHardEligible(v: VenueHardEligibilityInput): bool =
  v.isPublic
    and v.venueStatus == "active"
    and v.groupSize >= 1
    and v.minParticipantAge >= 13
    and v.minParticipantAge <= 120
    and v.minParticipantAge >= v.venueAgeMin
    and (v.minParticipantAge >= 18 or (v.venueAllAges and not(v.isBarOnly) and v.alcoholOptional and v.venueAgeMin <= 13))
    and ((v.groupSize < 2 or v.minParticipantAge >= 18) or (v.teenFriendAllowed and v.groupSize <= 6))
    and (not(v.anyNonDrinker) or (not(v.isBarOnly) and v.alcoholOptional))
    and (not(v.anyVegetarian) or v.servesVegetarian)
    and (not(v.anyVegan) or v.servesVegan)
    and (not(v.anyWheelchairNeeded) or v.wheelchairAccessible)
    and not(v.anyVisited)
    and not(v.anyRejected)
    and v.priceTier >= 0
    and v.priceTier <= v.maxBudgetTier
    and isWithinTravelLimit(v.maxTravelMin, v.travelLimitMin)
    and v.verifiedOpen
    and (if (v.groupSize >= 3) v.openBufferMin >= 120 else v.openBufferMin >= 90)
    and (v.groupSize < 3 or ((not(v.reservationRequired) or v.hasReservation) and v.separateChecks and v.walkInCapacity >= v.groupSize and not(v.isNightLiveMusic)))
    and not(v.isOutdoorOnly and v.badWeatherOrAfterDark)

pure def lawNoPrivateHomeRecommended(v: VenueHardEligibilityInput): bool =
  venueHardEligible(v) implies v.isPublic

pure def lawNoClosedOrSuspectVenueRecommended(v: VenueHardEligibilityInput): bool =
  venueHardEligible(v) implies v.venueStatus == "active"

pure def lawNoVisitedOrRejectedRecommended(v: VenueHardEligibilityInput): bool =
  venueHardEligible(v) implies (not(v.anyVisited) and not(v.anyRejected))

pure def lawMinorVenueRequiresAllAgesAndTeenRule(v: VenueHardEligibilityInput): bool =
  (venueHardEligible(v) and v.minParticipantAge < 18) implies
    (v.venueAllAges and not(v.isBarOnly) and v.alcoholOptional and v.venueAgeMin <= 13 and (v.groupSize < 2 or (v.teenFriendAllowed and v.groupSize <= 6)))

pure def lawNonDrinkerNeverBarHard(v: VenueHardEligibilityInput): bool =
  (venueHardEligible(v) and v.anyNonDrinker) implies (not(v.isBarOnly) and v.alcoholOptional)

pure def lawBudgetCeilingRespected(v: VenueHardEligibilityInput): bool =
  venueHardEligible(v) implies (v.priceTier >= 0 and v.priceTier <= v.maxBudgetTier)

pure def lawRecommendedMustBeVerifiedOpen(v: VenueHardEligibilityInput): bool =
  venueHardEligible(v) implies (v.verifiedOpen and (if (v.groupSize >= 3) v.openBufferMin >= 120 else v.openBufferMin >= 90))

pure def lawGroupReservationRequirementHonored(v: VenueHardEligibilityInput): bool =
  (venueHardEligible(v) and v.groupSize >= 3 and v.reservationRequired) implies v.hasReservation

pure val vValues = Set(
  {
    isPublic: true, venueStatus: "active", minParticipantAge: 28, venueAgeMin: 0, venueAllAges: true, teenFriendAllowed: false,
    anyNonDrinker: false, isBarOnly: false, alcoholOptional: true, anyVegetarian: true, servesVegetarian: true,
    anyVegan: false, servesVegan: true, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 2, maxBudgetTier: 2, maxTravelMin: 15, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 2, reservationRequired: false, hasReservation: false, separateChecks: true,
    walkInCapacity: 8, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  },
  {
    isPublic: false, venueStatus: "active", minParticipantAge: 28, venueAgeMin: 0, venueAllAges: true, teenFriendAllowed: false,
    anyNonDrinker: false, isBarOnly: false, alcoholOptional: true, anyVegetarian: false, servesVegetarian: true,
    anyVegan: false, servesVegan: true, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 1, maxBudgetTier: 2, maxTravelMin: 10, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 2, reservationRequired: false, hasReservation: false, separateChecks: true,
    walkInCapacity: 8, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  },
  {
    isPublic: true, venueStatus: "active", minParticipantAge: 16, venueAgeMin: 0, venueAllAges: true, teenFriendAllowed: true,
    anyNonDrinker: true, isBarOnly: false, alcoholOptional: true, anyVegetarian: false, servesVegetarian: true,
    anyVegan: false, servesVegan: true, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 1, maxBudgetTier: 2, maxTravelMin: 12, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 4, reservationRequired: false, hasReservation: false, separateChecks: true,
    walkInCapacity: 10, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  },
  {
    isPublic: true, venueStatus: "active", minParticipantAge: 16, venueAgeMin: 21, venueAllAges: false, teenFriendAllowed: false,
    anyNonDrinker: true, isBarOnly: true, alcoholOptional: false, anyVegetarian: false, servesVegetarian: false,
    anyVegan: false, servesVegan: false, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 2, maxBudgetTier: 2, maxTravelMin: 12, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 2, reservationRequired: false, hasReservation: false, separateChecks: true,
    walkInCapacity: 6, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  },
  {
    isPublic: true, venueStatus: "active", minParticipantAge: 28, venueAgeMin: 0, venueAllAges: true, teenFriendAllowed: false,
    anyNonDrinker: false, isBarOnly: false, alcoholOptional: true, anyVegetarian: false, servesVegetarian: true,
    anyVegan: false, servesVegan: true, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 2, maxBudgetTier: 3, maxTravelMin: 12, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 4, reservationRequired: true, hasReservation: true, separateChecks: true,
    walkInCapacity: 8, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  },
  {
    isPublic: true, venueStatus: "active", minParticipantAge: 28, venueAgeMin: 0, venueAllAges: true, teenFriendAllowed: false,
    anyNonDrinker: false, isBarOnly: false, alcoholOptional: true, anyVegetarian: false, servesVegetarian: true,
    anyVegan: false, servesVegan: true, anyWheelchairNeeded: false, wheelchairAccessible: true,
    anyVisited: false, anyRejected: false, priceTier: 2, maxBudgetTier: 3, maxTravelMin: 12, travelLimitMin: 25,
    verifiedOpen: true, openBufferMin: 120, groupSize: 4, reservationRequired: true, hasReservation: false, separateChecks: true,
    walkInCapacity: 8, isNightLiveMusic: false, isOutdoorOnly: false, badWeatherOrAfterDark: false
  }
)
```

### Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity

Strict sobriety excludes alcohol-centric venues even when alcohol is optional. Halal, kosher, gluten-free, and severe allergen needs fail closed. Smoke-free, low-noise (`noiseTier` 0 or 1), and daytime-only boundaries are enforced. After-dark or first-meet venues require `safetyScore >= 7` and `transitScore >= 3`, and first meets start at or before 21:00 local time. Unreserved non-open-event groups stay at or below 6, open events stay at or below 15, and concurrent headcount plus group size never exceeds walk-in capacity.

```quint
type VenueRedLinesInput = {
  anyStrictSober: bool,
  anyNonDrinker: bool,
  isAlcoholCentric: bool,
  isBarOnly: bool,
  alcoholOptional: bool,
  anyHalal: bool,
  halalFriendly: bool,
  anyKosher: bool,
  kosherFriendly: bool,
  anyGlutenFree: bool,
  glutenFreeFriendly: bool,
  anySevereAllergen: bool,
  severeAllergenSafe: bool,
  anySmokeFree: bool,
  isSmokeFree: bool,
  anyLowNoise: bool,
  noiseTier: int,
  anyDaytimeOnly: bool,
  isAfterDark: bool,
  isFirstMeet: bool,
  safetyScore: int,
  transitScore: int,
  startLocalHour: int,
  groupSize: int,
  hasReservation: bool,
  openEventEligible: bool,
  concurrentHeadcount: int,
  walkInCapacity: int
}

pure def venueRedLinesEligible(r: VenueRedLinesInput): bool =
  r.groupSize >= 1
    and (not(r.anyStrictSober) or (not(r.isAlcoholCentric) and not(r.isBarOnly)))
    and (not(r.anyNonDrinker) or (not(r.isBarOnly) and r.alcoholOptional))
    and (not(r.anyHalal) or r.halalFriendly)
    and (not(r.anyKosher) or r.kosherFriendly)
    and (not(r.anyGlutenFree) or r.glutenFreeFriendly)
    and (not(r.anySevereAllergen) or r.severeAllergenSafe)
    and (not(r.anySmokeFree) or r.isSmokeFree)
    and (not(r.anyLowNoise) or (r.noiseTier >= 0 and r.noiseTier <= 1))
    and (not(r.anyDaytimeOnly) or not(r.isAfterDark))
    and (not(r.isAfterDark or r.isFirstMeet) or (r.safetyScore >= 7 and r.transitScore >= 3))
    and (not(r.isFirstMeet) or (r.startLocalHour >= 0 and r.startLocalHour <= 21))
    and ((r.hasReservation or r.openEventEligible) or r.groupSize <= 6)
    and (not(r.openEventEligible) or r.groupSize <= 15)
    and r.concurrentHeadcount >= 0
    and r.walkInCapacity >= 0
    and r.concurrentHeadcount + r.groupSize <= r.walkInCapacity

pure def lawStrictSoberNeverAlcoholCentric(r: VenueRedLinesInput): bool =
  (venueRedLinesEligible(r) and r.anyStrictSober) implies (not(r.isAlcoholCentric) and not(r.isBarOnly))

pure def lawNonDrinkerNeverBar(r: VenueRedLinesInput): bool =
  (venueRedLinesEligible(r) and r.anyNonDrinker) implies (not(r.isBarOnly) and r.alcoholOptional)

pure def lawAllergenAndReligiousDietRespected(r: VenueRedLinesInput): bool =
  venueRedLinesEligible(r) implies
    ((not(r.anyHalal) or r.halalFriendly)
      and (not(r.anyKosher) or r.kosherFriendly)
      and (not(r.anyGlutenFree) or r.glutenFreeFriendly)
      and (not(r.anySevereAllergen) or r.severeAllergenSafe))

pure def lawSensoryAndDaytimeBoundariesRespected(r: VenueRedLinesInput): bool =
  venueRedLinesEligible(r) implies
    ((not(r.anySmokeFree) or r.isSmokeFree)
      and (not(r.anyLowNoise) or (r.noiseTier >= 0 and r.noiseTier <= 1))
      and (not(r.anyDaytimeOnly) or not(r.isAfterDark)))

pure def lawAfterDarkSafetyAndTransitFloor(r: VenueRedLinesInput): bool =
  venueRedLinesEligible(r) implies
    ((not(r.isAfterDark or r.isFirstMeet) or (r.safetyScore >= 7 and r.transitScore >= 3))
      and (not(r.isFirstMeet) or (r.startLocalHour >= 0 and r.startLocalHour <= 21)))

pure def lawUnreservedGroupSizeCapped(r: VenueRedLinesInput): bool =
  venueRedLinesEligible(r) implies
    (((r.hasReservation or r.openEventEligible) or r.groupSize <= 6)
      and (not(r.openEventEligible) or r.groupSize <= 15))

pure def lawVenueConcurrentCapacityRespected(r: VenueRedLinesInput): bool =
  venueRedLinesEligible(r) implies
    (r.concurrentHeadcount >= 0 and r.walkInCapacity >= 0 and r.concurrentHeadcount + r.groupSize <= r.walkInCapacity)

pure val rValues = Set(
  {
    anyStrictSober: true, anyNonDrinker: true, isAlcoholCentric: false, isBarOnly: false, alcoholOptional: true,
    anyHalal: true, halalFriendly: true, anyKosher: false, kosherFriendly: false, anyGlutenFree: true, glutenFreeFriendly: true,
    anySevereAllergen: true, severeAllergenSafe: true, anySmokeFree: true, isSmokeFree: true, anyLowNoise: true, noiseTier: 1,
    anyDaytimeOnly: false, isAfterDark: true, isFirstMeet: true, safetyScore: 9, transitScore: 4, startLocalHour: 19,
    groupSize: 2, hasReservation: false, openEventEligible: false, concurrentHeadcount: 2, walkInCapacity: 8
  },
  {
    anyStrictSober: true, anyNonDrinker: true, isAlcoholCentric: true, isBarOnly: false, alcoholOptional: true,
    anyHalal: false, halalFriendly: false, anyKosher: false, kosherFriendly: false, anyGlutenFree: false, glutenFreeFriendly: false,
    anySevereAllergen: false, severeAllergenSafe: false, anySmokeFree: false, isSmokeFree: true, anyLowNoise: false, noiseTier: 2,
    anyDaytimeOnly: false, isAfterDark: false, isFirstMeet: true, safetyScore: 9, transitScore: 4, startLocalHour: 18,
    groupSize: 2, hasReservation: false, openEventEligible: false, concurrentHeadcount: 0, walkInCapacity: 10
  },
  {
    anyStrictSober: false, anyNonDrinker: false, isAlcoholCentric: false, isBarOnly: false, alcoholOptional: true,
    anyHalal: false, halalFriendly: false, anyKosher: false, kosherFriendly: false, anyGlutenFree: false, glutenFreeFriendly: false,
    anySevereAllergen: false, severeAllergenSafe: false, anySmokeFree: false, isSmokeFree: true, anyLowNoise: false, noiseTier: 1,
    anyDaytimeOnly: false, isAfterDark: true, isFirstMeet: true, safetyScore: 5, transitScore: 2, startLocalHour: 22,
    groupSize: 8, hasReservation: false, openEventEligible: false, concurrentHeadcount: 6, walkInCapacity: 10
  }
)
```

## Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores

> As the venue catalog service, I want to avoid unnecessary external searches, quarantine reported closures immediately, and score venues deterministically.

### Fetch external venues only when fewer than ten qualified local venues exist

Skip external discovery calls once ten or more local venues qualify.

```quint
pure def shouldFetchExternalVenues(localQualifiedCount: int): bool =
  localQualifiedCount < 10

pure def lawNoExternalSearchWhenSufficient(localQualifiedCount: int): bool =
  localQualifiedCount >= 10 implies not(shouldFetchExternalVenues(localQualifiedCount))
```

### Verify live opening status after 24 hours on weekdays or 6 hours on weekends and holidays

Require a pre-recommendation open check whenever the freshness age is negative or reaches the window limit.

```quint
pure def needsPreRecommendOpenCheck(ageHours: int, isWeekendOrHoliday: bool): bool =
  val maxFreshHours = if (isWeekendOrHoliday) 6 else 24
  ageHours < 0 or ageHours >= maxFreshHours

pure def lawFreshnessThresholdMatchesDayType(ageHours: int, isWeekendOrHoliday: bool): bool =
  if (isWeekendOrHoliday)
    needsPreRecommendOpenCheck(ageHours, true) iff (ageHours < 0 or ageHours >= 6)
  else
    needsPreRecommendOpenCheck(ageHours, false) iff (ageHours < 0 or ageHours >= 24)
```

### Quarantine a venue immediately on any closure report

A provider permanent closure or at least two user closure reports transitions the venue to `"closed_permanent"`. A single user closure report moves an active venue out of `"active"` to `"suspect_closed"`.

```quint
pure def nextVenueStatusOnReport(
  currentStatus: str,
  reportedClosed: bool,
  closureReportCount: int,
  providerPermanent: bool,
  providerTemporary: bool
): str =
  if (providerPermanent)
    "closed_permanent"
  else if (reportedClosed and closureReportCount + 1 >= 2)
    "closed_permanent"
  else if (providerTemporary)
    "closed_temporary"
  else if (reportedClosed)
    if (currentStatus == "closed_permanent")
      "closed_permanent"
    else if (currentStatus == "closed_temporary")
      "closed_temporary"
    else
      "suspect_closed"
  else
    currentStatus

pure def lawClosureQuarantinesImmediately(
  currentStatus: str,
  closureReportCount: int,
  providerPermanent: bool,
  providerTemporary: bool
): bool =
  nextVenueStatusOnReport(currentStatus, true, closureReportCount, providerPermanent, providerTemporary) != "active"

pure val currentStatusValues = Set("active", "suspect_closed", "closed_temporary", "closed_permanent")
```

### Clamp integers and compute bounded group rubric and budget scores

Group rubric and budget-fit scores always stay in `0..100`, and venues above the maximum budget tier score `0`.

```quint
type GroupVenueRubricInput = {
  separateChecks: bool,
  walkInCapacity: int,
  noiseLevel: str,
  liveMusicAtNight: bool,
  alcoholOptional: bool,
  servesVegetarian: bool,
  servesVegan: bool,
  safetyScore: int,
  indoor: bool,
  weatherSensitive: bool,
  hasArrivalLandmark: bool,
  transitScore: int
}

pure def clampInt(value: int, low: int, high: int): int =
  if (value < low) low else if (value > high) high else value

pure def groupVenueRubricScore(g: GroupVenueRubricInput): int =
  val checksPts = if (g.separateChecks) 20 else 0
  val capacityPts = if (g.walkInCapacity >= 6) 20 else if (g.walkInCapacity >= 4) 12 else 0
  val acousticPts =
    if (g.liveMusicAtNight) 0
    else if (g.noiseLevel == "conversational" or g.noiseLevel == "lively") 15
    else if (g.noiseLevel == "quiet") 6
    else 0
  val inclusivityPts =
    (if (g.alcoholOptional) 8 else 0)
      + (if (g.servesVegetarian) 4 else 0)
      + (if (g.servesVegan) 3 else 0)
  val safetyPts = clampInt(g.safetyScore, 0, 10)
  val weatherPts =
    if (g.indoor and not(g.weatherSensitive)) 10
    else if (g.indoor) 7
    else if (not(g.weatherSensitive)) 4
    else 0
  val landmarkPts = if (g.hasArrivalLandmark) 5 else 0
  val transitPts = clampInt(g.transitScore, 0, 5)
  checksPts + capacityPts + acousticPts + inclusivityPts + safetyPts + weatherPts + landmarkPts + transitPts

pure def venueBudgetFitScore(priceTier: int, maxBudgetTier: int): int =
  val diff = maxBudgetTier - priceTier
  if (priceTier < 0 or maxBudgetTier < 0 or priceTier > maxBudgetTier)
    0
  else if (diff == 0) 100
  else if (diff == 1) 90
  else if (diff == 2) 75
  else 60

pure def lawGroupRubricScoreBounded(g: GroupVenueRubricInput): bool =
  val s = groupVenueRubricScore(g)
  s >= 0 and s <= 100

pure def lawBudgetFitScoreBoundedAndZeroOverBudget(priceTier: int, maxBudgetTier: int): bool =
  val s = venueBudgetFitScore(priceTier, maxBudgetTier)
  s >= 0 and s <= 100 and (priceTier > maxBudgetTier implies s == 0)

pure val gValues = Set(
  {
    separateChecks: true, walkInCapacity: 12, noiseLevel: "conversational", liveMusicAtNight: false,
    alcoholOptional: true, servesVegetarian: true, servesVegan: true, safetyScore: 10,
    indoor: true, weatherSensitive: false, hasArrivalLandmark: true, transitScore: 5
  },
  {
    separateChecks: false, walkInCapacity: 2, noiseLevel: "loud", liveMusicAtNight: true,
    alcoholOptional: false, servesVegetarian: false, servesVegan: false, safetyScore: -2,
    indoor: false, weatherSensitive: true, hasArrivalLandmark: false, transitScore: 9
  }
)
```
