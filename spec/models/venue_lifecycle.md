# Venue catalog, red lines, and suggestion pivots

## Story: Recommend only safe, verified public venues within member red lines and pivot bounds

A member needs every venue suggestion to be a public, verified-open place that obeys every participant's hard red lines, respects walk-in capacity, keeps teen friend venues strictly all-ages, and stops proposing after three rejections.

### Safety rules and reachability

Check venue discovery sufficiency, live open verification, closure quarantine, hard red lines (`strictSober`, halal/kosher/gluten-free/severe allergens, after-dark and first-meet safety and transit floors), unreserved group size caps, concurrent walk-in capacity, top-1 suggestion pivot bounds (`MAX_SUGGESTION_PIVOTS = 3`), and the `allAges` rule for in-network teen friend rosters ([friend introductions with a minor](../friendIntroAge.md)). The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [venue selection spec](../venueSelection.md) generates pure venue eligibility, open-freshness, closure transition, and group rubric decisions. The [suggestion flow spec](../suggestionFlow.md) generates pure suggestion pivot bounds, density tiers, activity red-line checks, and mode-specific venue scores. The [friend introductions spec](../friendIntroAge.md) governs `allAges` places (`teenPlaceAllowed`, `teenRosterSizeAllowed`) for in-network teen friendship groups on `friends.help` and the `ntwrk` Friend lane; bars, alcohol-centric venues, and dating remain strictly adult-only.

See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=4000 verify-steps=8
//
// Venue catalog, discovery, open verification, red-line eligibility, top-1 suggestion pivot loop,
// concurrent walk-in capacity, teen all-ages friend venue guard, feedback, and closure quarantine
// lifecycle (docs/design/2026-11-26-meetup-setup-and-external-matchmaking.md;
// spec/venueSelection.md, spec/suggestionFlow.md, spec/friendIntroAge.md).
//
// Bounds: 2 matched members (m1, m2), 9 tracked venues (including a brewery with alcoholOptional=true,
// a low-safety/low-transit dim venue, a large open-event food hall, a private home, a bar-only spot,
// an upscale venue, and 2 external candidates), plus tracked localQualifiedCount starting at 8 (< 10).
// Time unit: 1 hour; open verification TTL = 24 hours.
module venue_lifecycle {

  // ------------------------------------------------------------------------------------------ constants
  pure val MEMBERS = Set("m1", "m2")
  pure val VENUES = Set(
    "v_cafe", "v_hall", "v_brewery", "v_bar", "v_dim", "v_upscale", "v_home", "v_ext1", "v_ext2"
  )
  pure val EXTERNAL_VENUES = Set("v_ext1", "v_ext2")
  pure val SUFFICIENCY_THRESHOLD = 10
  pure val INITIAL_API_BUDGET = 4
  pure val OPEN_CHECK_TTL = 24
  pure val DATE_TRAVEL_LIMIT = 25
  pure val GROUP_TRAVEL_LIMIT = 35
  pure val MAX_SUGGESTION_PIVOTS = 3
  pure val UNRESERVED_STD_GROUP_CAP = 6
  pure val OPEN_EVENT_GROUP_CAP = 15
  pure val TEEN_ROSTER_MAX = 6
  pure val MIN_SAFETY_FLOOR = 7
  pure val MIN_TRANSIT_FLOOR = 3
  pure val FIRST_MEET_MAX_START_HOUR = 21

  // ------------------------------------------------------------------------------------------ types
  type Venue = {
    inPool: bool,
    status: str,              // active | suspect_closed | closed_temporary | closed_permanent
    verifiedOpenAt: int,      // -1 if never verified, else hour timestamp of last fresh open check
    openBufferOk: bool,       // open >= 90m (date) / >= 120m (group) past proposed start
    isPublic: bool,
    allAges: bool,            // spec/friendIntroAge.md allAgesMarkValid: public, <= 13+, not bar/alcohol-centric
    isBarOnly: bool,
    alcoholOptional: bool,
    isAlcoholCentric: bool,   // bars, breweries, wine bars, cocktail lounges, taprooms
    halalFriendly: bool,
    kosherFriendly: bool,
    glutenFreeFriendly: bool,
    severeAllergenSafe: bool,
    isSmokeFree: bool,
    noiseTier: int,           // 0=quiet, 1=conversational, 2=lively, 3=loud
    safetyScore: int,         // 0..10
    transitScore: int,        // 0..5
    priceTier: int,           // 0..4 ($..$$$$)
    groupSuitable: bool,      // separate checks, conversational
    reservationRequired: bool,
    openEventEligible: bool,  // mega food hall / large walk-in space eligible up to 15
    walkInCapacity: int,      // physical walk-in capacity in a 2h window
    concurrentHeadcount: int, // currently booked Network headcount in overlapping 2h window
    travelMin: int,
    closureReports: int,
    tasteLikes: int,
    tasteDislikes: int,
    visitCount: int,
  }

  type Member = {
    visited: Set[str],
    rejected: Set[str],
    isNonDrinker: bool,
    isStrictSober: bool,
    needsHalal: bool,
    needsKosher: bool,
    needsGlutenFree: bool,
    hasSevereAllergen: bool,
    needsSmokeFree: bool,
    needsLowNoise: bool,
    daytimeOnly: bool,
    budgetTier: int,          // 1..4
  }

  // Ghost snapshot of every recommendation ever emitted, evaluated at recommendation time.
  type RecEvent = {
    venue: str,
    isPublic: bool,
    allAges: bool,
    status: str,
    verifiedFresh: bool,
    openBufferOk: bool,
    anyVisited: bool,
    anyRejected: bool,
    anyNonDrinker: bool,
    anyStrictSober: bool,
    isBarOnly: bool,
    alcoholOptional: bool,
    isAlcoholCentric: bool,
    anyHalal: bool,
    anyKosher: bool,
    anyGlutenFree: bool,
    anySevereAllergen: bool,
    halalFriendly: bool,
    kosherFriendly: bool,
    glutenFreeFriendly: bool,
    severeAllergenSafe: bool,
    isAfterDark: bool,
    isFirstMeet: bool,
    startLocalHour: int,
    safetyScore: int,
    transitScore: int,
    priceTier: int,
    minBudget: int,
    forGroup: bool,
    isTeenFriendRoster: bool,
    groupSize: int,
    reservationRequired: bool,
    hasReservation: bool,
    openEventEligible: bool,
    groupSuitable: bool,
    walkInCapacity: int,
    concurrentBefore: int,
    travelMin: int,
    travelLimit: int,
    pivotsUsedAtOffer: int,
  }

  // ------------------------------------------------------------------------------------------ state
  var now: int
  var venues: str -> Venue
  var members: str -> Member
  var externalApiCalls: int
  var apiBudget: int
  var localQualifiedCount: int
  var recommendedVenue: str
  var recommendedForGroup: bool
  var recommendedGroupSize: int
  var pivotsUsed: int
  var roundState: str             // idle | offered | asked_user_or_paused
  var roundRejected: Set[str]
  // Ghost state for historical invariant checks and witness reachability
  var recHistory: Set[RecEvent]
  var apiCallWhenSufficient: bool
  var skippedWhenSufficient: bool

  // ------------------------------------------------------------------------------------------ helpers
  pure def mkVenue(
    inPool: bool,
    isPublic: bool,
    allAges: bool,
    isBarOnly: bool,
    alcoholOptional: bool,
    isAlcoholCentric: bool,
    halal: bool,
    kosher: bool,
    gf: bool,
    allergenSafe: bool,
    safetyScore: int,
    transitScore: int,
    priceTier: int,
    groupSuitable: bool,
    reservationRequired: bool,
    openEventEligible: bool,
    walkInCapacity: int,
    travelMin: int,
    verifiedAt: int
  ): Venue = {
    inPool: inPool,
    status: "active",
    verifiedOpenAt: verifiedAt,
    openBufferOk: verifiedAt >= 0,
    isPublic: isPublic,
    allAges: allAges,
    isBarOnly: isBarOnly,
    alcoholOptional: alcoholOptional,
    isAlcoholCentric: isAlcoholCentric,
    halalFriendly: halal,
    kosherFriendly: kosher,
    glutenFreeFriendly: gf,
    severeAllergenSafe: allergenSafe,
    isSmokeFree: true,
    noiseTier: if (isBarOnly) 2 else 1,
    safetyScore: safetyScore,
    transitScore: transitScore,
    priceTier: priceTier,
    groupSuitable: groupSuitable,
    reservationRequired: reservationRequired,
    openEventEligible: openEventEligible,
    walkInCapacity: walkInCapacity,
    concurrentHeadcount: 0,
    travelMin: travelMin,
    closureReports: 0,
    tasteLikes: 0,
    tasteDislikes: 0,
    visitCount: 0,
  }

  pure def minInt(a: int, b: int): int = if (a <= b) a else b

  pure def minMemberBudget(ms: str -> Member): int =
    minInt(ms.get("m1").budgetTier, ms.get("m2").budgetTier)

  pure def anyMemberNonDrinker(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).isNonDrinker or ms.get(m).isStrictSober)

  pure def anyMemberStrictSober(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).isStrictSober)

  pure def anyMemberHalal(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).needsHalal)

  pure def anyMemberKosher(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).needsKosher)

  pure def anyMemberGlutenFree(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).needsGlutenFree)

  pure def anyMemberSevereAllergen(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).hasSevereAllergen)

  pure def anyMemberSmokeFree(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).needsSmokeFree)

  pure def anyMemberLowNoise(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).needsLowNoise)

  pure def anyMemberDaytimeOnly(ms: str -> Member): bool =
    MEMBERS.exists(m => ms.get(m).daytimeOnly)

  pure def anyMemberVisited(ms: str -> Member, v: str): bool =
    MEMBERS.exists(m => ms.get(m).visited.contains(v))

  pure def anyMemberRejected(ms: str -> Member, v: str): bool =
    MEMBERS.exists(m => ms.get(m).rejected.contains(v))

  pure def isFreshOpen(vn: Venue, t: int): bool =
    vn.verifiedOpenAt >= 0 and t - vn.verifiedOpenAt <= OPEN_CHECK_TTL and vn.openBufferOk

  pure def travelLimitFor(forGroup: bool): int =
    if (forGroup) GROUP_TRAVEL_LIMIT else DATE_TRAVEL_LIMIT

  // Mirrors spec/venueSelection.md venueHardEligible + venueRedLinesEligible
  // and spec/friendIntroAge.md teenPlaceAllowed + teenRosterSizeAllowed.
  pure def venueEligible(
    vn: Venue,
    vId: str,
    ms: str -> Member,
    t: int,
    forGroup: bool,
    isTeenFriendRoster: bool,
    groupSize: int,
    hasReservation: bool,
    startLocalHour: int,
    isFirstMeet: bool
  ): bool = {
    val isAfterDark = startLocalHour >= 19 or startLocalHour < 7
    and {
      vn.inPool,
      vn.isPublic,
      vn.status == "active",
      isFreshOpen(vn, t),
      not(anyMemberVisited(ms, vId)),
      not(anyMemberRejected(ms, vId)),
      anyMemberNonDrinker(ms) implies (not(vn.isBarOnly) and vn.alcoholOptional),
      anyMemberStrictSober(ms) implies (not(vn.isAlcoholCentric) and not(vn.isBarOnly)),
      isTeenFriendRoster implies (vn.allAges and not(vn.isBarOnly) and not(vn.isAlcoholCentric) and groupSize >= 2 and groupSize <= TEEN_ROSTER_MAX),
      anyMemberHalal(ms) implies vn.halalFriendly,
      anyMemberKosher(ms) implies vn.kosherFriendly,
      anyMemberGlutenFree(ms) implies vn.glutenFreeFriendly,
      anyMemberSevereAllergen(ms) implies vn.severeAllergenSafe,
      anyMemberSmokeFree(ms) implies vn.isSmokeFree,
      anyMemberLowNoise(ms) implies vn.noiseTier <= 1,
      anyMemberDaytimeOnly(ms) implies not(isAfterDark),
      (isAfterDark or isFirstMeet) implies (vn.safetyScore >= MIN_SAFETY_FLOOR and vn.transitScore >= MIN_TRANSIT_FLOOR),
      isFirstMeet implies startLocalHour <= FIRST_MEET_MAX_START_HOUR,
      vn.priceTier <= minMemberBudget(ms),
      groupSize >= 2,
      (not(hasReservation) and not(vn.openEventEligible)) implies groupSize <= UNRESERVED_STD_GROUP_CAP,
      vn.openEventEligible implies groupSize <= OPEN_EVENT_GROUP_CAP,
      vn.concurrentHeadcount + groupSize <= vn.walkInCapacity,
      forGroup implies (vn.groupSuitable and (not(vn.reservationRequired) or hasReservation) and groupSize >= 3),
      not(forGroup) implies groupSize == 2,
      vn.travelMin <= travelLimitFor(forGroup),
    }
  }

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    now' = 0,
    venues' = Map(
      "v_cafe"    -> mkVenue(true,  true,  true,  false, true,  false, true,  true,  true,  true,  9, 5, 1, true,  false, false, 8,  15, 0),
      "v_hall"    -> mkVenue(true,  true,  true,  false, true,  false, true,  true,  true,  true,  8, 4, 2, true,  false, true,  15, 20, 0),
      "v_brewery" -> mkVenue(true,  true,  false, false, true,  true,  false, false, true,  true,  8, 4, 2, true,  false, true,  12, 16, 0),
      "v_bar"     -> mkVenue(true,  true,  false, true,  false, true,  false, false, false, false, 7, 4, 2, false, false, false, 4,  15, 0),
      "v_dim"     -> mkVenue(true,  true,  false, false, true,  false, true,  true,  true,  true,  5, 2, 1, true,  false, false, 6,  12, 0),
      "v_upscale" -> mkVenue(true,  true,  true,  false, true,  false, true,  false, true,  true,  9, 4, 4, true,  true,  false, 6,  18, 0),
      "v_home"    -> mkVenue(true,  false, false, false, true,  false, true,  true,  true,  true,  9, 5, 0, true,  false, false, 10, 10, 0),
      "v_ext1"    -> mkVenue(false, true,  true,  false, true,  false, true,  true,  true,  true,  8, 4, 1, true,  false, false, 10, 12, -1),
      "v_ext2"    -> mkVenue(false, true,  true,  false, true,  false, true,  true,  true,  true,  8, 4, 2, true,  false, true,  14, 22, -1),
    ),
    members' = Map(
      "m1" -> {
        visited: Set(), rejected: Set(),
        isNonDrinker: false, isStrictSober: false,
        needsHalal: false, needsKosher: false, needsGlutenFree: false, hasSevereAllergen: false,
        needsSmokeFree: true, needsLowNoise: false, daytimeOnly: false,
        budgetTier: 2,
      },
      "m2" -> {
        visited: Set(), rejected: Set(),
        isNonDrinker: false, isStrictSober: false,
        needsHalal: false, needsKosher: false, needsGlutenFree: false, hasSevereAllergen: false,
        needsSmokeFree: true, needsLowNoise: false, daytimeOnly: false,
        budgetTier: 3,
      },
    ),
    externalApiCalls' = 0,
    apiBudget' = INITIAL_API_BUDGET,
    localQualifiedCount' = 8,
    recommendedVenue' = "",
    recommendedForGroup' = false,
    recommendedGroupSize' = 0,
    pivotsUsed' = 0,
    roundState' = "idle",
    roundRejected' = Set(),
    recHistory' = Set(),
    apiCallWhenSufficient' = false,
    skippedWhenSufficient' = false,
  }

  // ------------------------------------------------------------------------------------------ actions
  // External venue discovery (Google Places / Yelp): ONLY allowed when localQualifiedCount < 10
  // and apiBudget > 0 (spec/venueSelection.md shouldFetchExternalVenues).
  action discoverExternalVenues(v: str): bool = {
    val vn = venues.get(v)
    all {
      EXTERNAL_VENUES.contains(v),
      not(vn.inPool),
      localQualifiedCount < SUFFICIENCY_THRESHOLD,
      apiBudget > 0,
      venues' = venues.set(v, { ...vn, inPool: true, verifiedOpenAt: now, openBufferOk: true }),
      externalApiCalls' = externalApiCalls + 1,
      apiBudget' = apiBudget - 1,
      localQualifiedCount' = localQualifiedCount + 2,
      apiCallWhenSufficient' = (apiCallWhenSufficient or localQualifiedCount >= SUFFICIENCY_THRESHOLD),
      now' = now, members' = members, recommendedVenue' = recommendedVenue,
      recommendedForGroup' = recommendedForGroup, recommendedGroupSize' = recommendedGroupSize,
      pivotsUsed' = pivotsUsed, roundState' = roundState, roundRejected' = roundRejected,
      recHistory' = recHistory, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Local sufficiency gate: when localQualifiedCount >= 10, external search is skipped (0 API calls).
  action skipExternalSearchWhenSufficient: bool = all {
    localQualifiedCount >= SUFFICIENCY_THRESHOLD,
    skippedWhenSufficient' = true,
    now' = now, venues' = venues, members' = members, externalApiCalls' = externalApiCalls,
    apiBudget' = apiBudget, localQualifiedCount' = localQualifiedCount,
    recommendedVenue' = recommendedVenue, recommendedForGroup' = recommendedForGroup,
    recommendedGroupSize' = recommendedGroupSize, pivotsUsed' = pivotsUsed,
    roundState' = roundState, roundRejected' = roundRejected,
    recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
  }

  // Lightweight pre-recommendation open check (Place Details businessStatus + currentOpeningHours).
  action verifyVenueOpen(v: str, isOpenNow: bool, bufferOk: bool): bool = {
    val vn = venues.get(v)
    val clearsRec = recommendedVenue == v and (not(isOpenNow) or not(bufferOk))
    val nextConcurrent = if (clearsRec and vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else vn.concurrentHeadcount
    all {
      VENUES.contains(v),
      vn.inPool,
      vn.status == "active",
      if (isOpenNow) all {
        venues' = venues.set(v, {
          ...vn,
          verifiedOpenAt: now,
          openBufferOk: bufferOk,
          concurrentHeadcount: nextConcurrent,
        }),
        recommendedVenue' = if (clearsRec) "" else recommendedVenue,
        recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
        roundState' = if (clearsRec) "idle" else roundState,
        localQualifiedCount' = localQualifiedCount,
      } else all {
        venues' = venues.set(v, {
          ...vn,
          status: "suspect_closed",
          openBufferOk: false,
          concurrentHeadcount: nextConcurrent,
        }),
        recommendedVenue' = if (clearsRec) "" else recommendedVenue,
        recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
        roundState' = if (clearsRec) "idle" else roundState,
        localQualifiedCount' = if (localQualifiedCount > 0) localQualifiedCount - 1 else 0,
      },
      now' = now, members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      recommendedForGroup' = recommendedForGroup, pivotsUsed' = pivotsUsed,
      roundRejected' = roundRejected, recHistory' = recHistory,
      apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Another concurrent Network group occupies walk-in capacity at a venue (overlapping 2h window).
  action reserveConcurrentCapacity(v: str, headcount: int): bool = {
    val vn = venues.get(v)
    all {
      VENUES.contains(v),
      vn.inPool,
      vn.status == "active",
      headcount >= 2,
      vn.concurrentHeadcount + headcount <= vn.walkInCapacity,
      venues' = venues.set(v, { ...vn, concurrentHeadcount: vn.concurrentHeadcount + headcount }),
      now' = now, members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedVenue' = recommendedVenue,
      recommendedForGroup' = recommendedForGroup, recommendedGroupSize' = recommendedGroupSize,
      pivotsUsed' = pivotsUsed, roundState' = roundState, roundRejected' = roundRejected,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Recommend Top-1 venue for a 1:1 date/friend (groupSize=2), 3-6 small group (adult or teen all-ages),
  // or 6-15 adult open impromptu event.
  action recommendVenue(
    v: str,
    forGroup: bool,
    isTeenFriendRoster: bool,
    groupSize: int,
    hasReservation: bool,
    startLocalHour: int,
    isFirstMeet: bool
  ): bool = {
    val vn = venues.get(v)
    val isAfterDark = startLocalHour >= 19 or startLocalHour < 7
    val ev: RecEvent = {
      venue: v,
      isPublic: vn.isPublic,
      allAges: vn.allAges,
      status: vn.status,
      verifiedFresh: vn.verifiedOpenAt >= 0 and now - vn.verifiedOpenAt <= OPEN_CHECK_TTL,
      openBufferOk: vn.openBufferOk,
      anyVisited: anyMemberVisited(members, v),
      anyRejected: anyMemberRejected(members, v),
      anyNonDrinker: anyMemberNonDrinker(members),
      anyStrictSober: anyMemberStrictSober(members),
      isBarOnly: vn.isBarOnly,
      alcoholOptional: vn.alcoholOptional,
      isAlcoholCentric: vn.isAlcoholCentric,
      anyHalal: anyMemberHalal(members),
      anyKosher: anyMemberKosher(members),
      anyGlutenFree: anyMemberGlutenFree(members),
      anySevereAllergen: anyMemberSevereAllergen(members),
      halalFriendly: vn.halalFriendly,
      kosherFriendly: vn.kosherFriendly,
      glutenFreeFriendly: vn.glutenFreeFriendly,
      severeAllergenSafe: vn.severeAllergenSafe,
      isAfterDark: isAfterDark,
      isFirstMeet: isFirstMeet,
      startLocalHour: startLocalHour,
      safetyScore: vn.safetyScore,
      transitScore: vn.transitScore,
      priceTier: vn.priceTier,
      minBudget: minMemberBudget(members),
      forGroup: forGroup,
      isTeenFriendRoster: isTeenFriendRoster,
      groupSize: groupSize,
      reservationRequired: vn.reservationRequired,
      hasReservation: hasReservation,
      openEventEligible: vn.openEventEligible,
      groupSuitable: vn.groupSuitable,
      walkInCapacity: vn.walkInCapacity,
      concurrentBefore: vn.concurrentHeadcount,
      travelMin: vn.travelMin,
      travelLimit: travelLimitFor(forGroup),
      pivotsUsedAtOffer: pivotsUsed,
    }
    all {
      VENUES.contains(v),
      recommendedVenue == "",
      roundState == "idle",
      pivotsUsed < MAX_SUGGESTION_PIVOTS,
      not(roundRejected.contains(v)),
      venueEligible(vn, v, members, now, forGroup, isTeenFriendRoster, groupSize, hasReservation, startLocalHour, isFirstMeet),
      venues' = venues.set(v, { ...vn, concurrentHeadcount: vn.concurrentHeadcount + groupSize }),
      recommendedVenue' = v,
      recommendedForGroup' = forGroup,
      recommendedGroupSize' = groupSize,
      roundState' = "offered",
      recHistory' = recHistory.union(Set(ev)),
      now' = now, members' = members, externalApiCalls' = externalApiCalls,
      apiBudget' = apiBudget, localQualifiedCount' = localQualifiedCount,
      pivotsUsed' = pivotsUsed, roundRejected' = roundRejected,
      apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Member rejects the current Top-1 suggestion: persists rejection, releases reserved capacity,
  // increments pivotsUsed; when pivotsUsed hits MAX_SUGGESTION_PIVOTS (3), stops proposing and asks user/pauses.
  action rejectCurrentSuggestion(m: str): bool = {
    val v = recommendedVenue
    val vn = venues.get(v)
    val mem = members.get(m)
    val nextPivots = pivotsUsed + 1
    val nextConcurrent = if (vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else 0
    all {
      MEMBERS.contains(m),
      v != "",
      roundState == "offered",
      pivotsUsed < MAX_SUGGESTION_PIVOTS,
      venues' = venues.set(v, { ...vn, concurrentHeadcount: nextConcurrent }),
      members' = members.set(m, { ...mem, rejected: mem.rejected.union(Set(v)) }),
      recommendedVenue' = "",
      recommendedGroupSize' = 0,
      pivotsUsed' = nextPivots,
      roundState' = if (nextPivots >= MAX_SUGGESTION_PIVOTS) "asked_user_or_paused" else "idle",
      roundRejected' = roundRejected.union(Set(v)),
      now' = now, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedForGroup' = recommendedForGroup,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // After exhausting pivots and asking the user or pausing, start a fresh scheduling round later.
  action resetSuggestionRound: bool = all {
    roundState == "asked_user_or_paused",
    recommendedVenue == "",
    pivotsUsed' = 0,
    roundState' = "idle",
    roundRejected' = Set(),
    now' = now, venues' = venues, members' = members, externalApiCalls' = externalApiCalls,
    apiBudget' = apiBudget, localQualifiedCount' = localQualifiedCount,
    recommendedVenue' = recommendedVenue, recommendedForGroup' = recommendedForGroup,
    recommendedGroupSize' = recommendedGroupSize, recHistory' = recHistory,
    apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
  }

  // Record a completed visit and post-encounter taste feedback (marks visited for both members,
  // releases concurrent walk-in capacity, resets suggestion round).
  action recordVisitAndFeedback(v: str, liked: bool): bool = {
    val vn = venues.get(v)
    val m1 = members.get("m1")
    val m2 = members.get("m2")
    val nextConcurrent = if (vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else 0
    all {
      recommendedVenue == v,
      venues' = venues.set(v, {
        ...vn,
        visitCount: vn.visitCount + 1,
        tasteLikes: if (liked) vn.tasteLikes + 1 else vn.tasteLikes,
        tasteDislikes: if (liked) vn.tasteDislikes else vn.tasteDislikes + 1,
        concurrentHeadcount: nextConcurrent,
      }),
      members' = members
        .set("m1", { ...m1, visited: m1.visited.union(Set(v)) })
        .set("m2", { ...m2, visited: m2.visited.union(Set(v)) }),
      recommendedVenue' = "",
      recommendedGroupSize' = 0,
      pivotsUsed' = 0,
      roundState' = "idle",
      roundRejected' = Set(),
      now' = now, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedForGroup' = recommendedForGroup,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // User reports venue closed: IMMEDIATELY quarantine to suspect_closed (unless already closed_permanent).
  action reportVenueClosed(v: str): bool = {
    val vn = venues.get(v)
    val nextStatus = if (vn.status == "closed_permanent") "closed_permanent" else "suspect_closed"
    val wasActive = vn.status == "active"
    val clearsRec = recommendedVenue == v
    val nextConcurrent = if (clearsRec and vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else vn.concurrentHeadcount
    all {
      VENUES.contains(v),
      vn.inPool,
      vn.closureReports < 3,
      venues' = venues.set(v, {
        ...vn,
        status: nextStatus,
        closureReports: vn.closureReports + 1,
        concurrentHeadcount: nextConcurrent,
      }),
      recommendedVenue' = if (clearsRec) "" else recommendedVenue,
      recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
      roundState' = if (clearsRec) "idle" else roundState,
      localQualifiedCount' = if (wasActive and localQualifiedCount > 0) localQualifiedCount - 1 else localQualifiedCount,
      now' = now, members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      recommendedForGroup' = recommendedForGroup, pivotsUsed' = pivotsUsed,
      roundRejected' = roundRejected, recHistory' = recHistory,
      apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Confirm permanent closure after >= 2 independent user reports or external provider confirmation.
  action confirmClosurePermanent(v: str, providerConfirmed: bool): bool = {
    val vn = venues.get(v)
    val wasActive = vn.status == "active"
    val clearsRec = recommendedVenue == v
    val nextConcurrent = if (clearsRec and vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else vn.concurrentHeadcount
    all {
      VENUES.contains(v),
      vn.inPool,
      vn.status != "closed_permanent",
      vn.closureReports >= 2 or providerConfirmed,
      venues' = venues.set(v, { ...vn, status: "closed_permanent", concurrentHeadcount: nextConcurrent }),
      recommendedVenue' = if (clearsRec) "" else recommendedVenue,
      recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
      roundState' = if (clearsRec) "idle" else roundState,
      localQualifiedCount' = if (wasActive and localQualifiedCount > 0) localQualifiedCount - 1 else localQualifiedCount,
      now' = now, members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      recommendedForGroup' = recommendedForGroup, pivotsUsed' = pivotsUsed,
      roundRejected' = roundRejected, recHistory' = recHistory,
      apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Confirm temporary closure (e.g., renovation/seasonal) from provider check.
  action confirmClosureTemporary(v: str): bool = {
    val vn = venues.get(v)
    val wasActive = vn.status == "active"
    val clearsRec = recommendedVenue == v
    val nextConcurrent = if (clearsRec and vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else vn.concurrentHeadcount
    all {
      VENUES.contains(v),
      vn.inPool,
      vn.status == "active" or vn.status == "suspect_closed",
      venues' = venues.set(v, { ...vn, status: "closed_temporary", concurrentHeadcount: nextConcurrent }),
      recommendedVenue' = if (clearsRec) "" else recommendedVenue,
      recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
      roundState' = if (clearsRec) "idle" else roundState,
      localQualifiedCount' = if (wasActive and localQualifiedCount > 0) localQualifiedCount - 1 else localQualifiedCount,
      now' = now, members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      recommendedForGroup' = recommendedForGroup, pivotsUsed' = pivotsUsed,
      roundRejected' = roundRejected, recHistory' = recHistory,
      apiCallWhenSufficient' = apiCallWhenSufficient, skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Member rejects a venue out-of-band (never recommend to them again).
  action recordVenueRejection(m: str, v: str): bool = {
    val mem = members.get(m)
    val vn = venues.get(v)
    val clearsRec = recommendedVenue == v
    val nextConcurrent = if (clearsRec and vn.concurrentHeadcount >= recommendedGroupSize)
      vn.concurrentHeadcount - recommendedGroupSize
    else vn.concurrentHeadcount
    all {
      MEMBERS.contains(m),
      VENUES.contains(v),
      vn.inPool,
      not(mem.rejected.contains(v)),
      members' = members.set(m, { ...mem, rejected: mem.rejected.union(Set(v)) }),
      venues' = venues.set(v, { ...vn, concurrentHeadcount: nextConcurrent }),
      recommendedVenue' = if (clearsRec) "" else recommendedVenue,
      recommendedGroupSize' = if (clearsRec) 0 else recommendedGroupSize,
      roundState' = if (clearsRec) "idle" else roundState,
      now' = now, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedForGroup' = recommendedForGroup,
      pivotsUsed' = pivotsUsed, roundRejected' = roundRejected,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Member updates red-line preferences (alcohol, strict sober, halal/kosher/GF/allergen, budget) between recommendations.
  action updateMemberPrefs(
    m: str,
    nonDrinker: bool,
    strictSober: bool,
    halal: bool,
    kosher: bool,
    glutenFree: bool,
    severeAllergen: bool,
    tier: int
  ): bool = {
    val mem = members.get(m)
    all {
      MEMBERS.contains(m),
      recommendedVenue == "",
      tier >= 1 and tier <= 4,
      members' = members.set(m, {
        ...mem,
        isNonDrinker: nonDrinker or strictSober,
        isStrictSober: strictSober,
        needsHalal: halal,
        needsKosher: kosher,
        needsGlutenFree: glutenFree,
        hasSevereAllergen: severeAllergen,
        budgetTier: tier,
      }),
      now' = now, venues' = venues, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedVenue' = recommendedVenue,
      recommendedForGroup' = recommendedForGroup, recommendedGroupSize' = recommendedGroupSize,
      pivotsUsed' = pivotsUsed, roundState' = roundState, roundRejected' = roundRejected,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  // Time advances (hours), causing old open checks to go stale past OPEN_CHECK_TTL and clearing stale reservations.
  action advanceClock(dt: int): bool = {
    val staleRec = recommendedVenue != "" and not(isFreshOpen(venues.get(recommendedVenue), now + dt))
    val nextVenues = if (staleRec) {
      val vn = venues.get(recommendedVenue)
      val nextConcurrent = if (vn.concurrentHeadcount >= recommendedGroupSize)
        vn.concurrentHeadcount - recommendedGroupSize
      else 0
      venues.set(recommendedVenue, { ...vn, concurrentHeadcount: nextConcurrent })
    } else venues
    all {
      dt > 0,
      now < 120,
      now' = now + dt,
      venues' = nextVenues,
      recommendedVenue' = if (staleRec) "" else recommendedVenue,
      recommendedGroupSize' = if (staleRec) 0 else recommendedGroupSize,
      roundState' = if (staleRec) "idle" else roundState,
      members' = members, externalApiCalls' = externalApiCalls, apiBudget' = apiBudget,
      localQualifiedCount' = localQualifiedCount, recommendedForGroup' = recommendedForGroup,
      pivotsUsed' = pivotsUsed, roundRejected' = roundRejected,
      recHistory' = recHistory, apiCallWhenSufficient' = apiCallWhenSufficient,
      skippedWhenSufficient' = skippedWhenSufficient,
    }
  }

  action step = any {
    nondet v = EXTERNAL_VENUES.oneOf()
    discoverExternalVenues(v),
    skipExternalSearchWhenSufficient,
    nondet v = VENUES.oneOf()
    nondet openNow = Set(true, false).oneOf()
    nondet bufOk = Set(true, false).oneOf()
    verifyVenueOpen(v, openNow, bufOk),
    nondet v = VENUES.oneOf()
    nondet hc = Set(2, 4).oneOf()
    reserveConcurrentCapacity(v, hc),
    nondet v = VENUES.oneOf()
    nondet grp = Set(false, true).oneOf()
    nondet teen = Set(false, true).oneOf()
    nondet sz = Set(2, 5, 10, 16).oneOf()
    nondet res = Set(false, true).oneOf()
    nondet hr = Set(14, 19, 22).oneOf()
    nondet fm = Set(true, false).oneOf()
    recommendVenue(v, grp, teen, sz, res, hr, fm),
    all {
      recommendedVenue != "",
      nondet m = MEMBERS.oneOf()
      rejectCurrentSuggestion(m),
    },
    resetSuggestionRound,
    all {
      recommendedVenue != "",
      nondet liked = Set(true, false).oneOf()
      recordVisitAndFeedback(recommendedVenue, liked),
    },
    nondet v = VENUES.oneOf()
    reportVenueClosed(v),
    nondet v = VENUES.oneOf()
    nondet prov = Set(false, true).oneOf()
    confirmClosurePermanent(v, prov),
    nondet v = VENUES.oneOf()
    confirmClosureTemporary(v),
    nondet m = MEMBERS.oneOf()
    nondet v = VENUES.oneOf()
    recordVenueRejection(m, v),
    nondet m = MEMBERS.oneOf()
    nondet nd = Set(false, true).oneOf()
    nondet ss = Set(false, true).oneOf()
    nondet hl = Set(false, true).oneOf()
    nondet ks = Set(false, true).oneOf()
    nondet gf = Set(false, true).oneOf()
    nondet al = Set(false, true).oneOf()
    nondet tier = Set(1, 2, 3, 4).oneOf()
    updateMemberPrefs(m, nd, ss, hl, ks, gf, al, tier),
    nondet dt = Set(6, 25).oneOf()
    advanceClock(dt),
  }

  // ------------------------------------------------------------------------------------------ invariants
  // spec/venueSelection.md venueHardEligible: only public venues are ever recommended, never homes.
  val noPrivateHomeRecommended =
    recHistory.forall(e => e.isPublic) and
    (recommendedVenue != "" implies venues.get(recommendedVenue).isPublic)

  // spec/venueSelection.md venueHardEligible: closed, temporary-closed, or suspect-closed venues are never recommended.
  val noClosedOrSuspectVenueRecommended =
    recHistory.forall(e => e.status == "active") and
    (recommendedVenue != "" implies venues.get(recommendedVenue).status == "active")

  // spec/venueSelection.md venueHardEligible: venues already visited or rejected by either member are never recommended.
  val noVisitedOrRejectedRecommended =
    recHistory.forall(e => not(e.anyVisited) and not(e.anyRejected)) and
    (recommendedVenue != "" implies (not(anyMemberVisited(members, recommendedVenue)) and not(anyMemberRejected(members, recommendedVenue))))

  // spec/venueSelection.md venueHardEligible: a non-drinker is never sent to a bar-only or non-alcohol-optional venue.
  val nonDrinkerNeverBar =
    recHistory.forall(e => e.anyNonDrinker implies (not(e.isBarOnly) and e.alcoholOptional)) and
    ((recommendedVenue != "" and anyMemberNonDrinker(members)) implies
      (not(venues.get(recommendedVenue).isBarOnly) and venues.get(recommendedVenue).alcoholOptional))

  // spec/venueSelection.md venueRedLinesEligible (D-1): strict sober member is never sent to an alcohol-centric venue
  // (bars, breweries, wine bars, cocktail lounges, taprooms) even if alcoholOptional is true.
  val strictSoberNeverAlcoholCentric =
    recHistory.forall(e => e.anyStrictSober implies (not(e.isAlcoholCentric) and not(e.isBarOnly))) and
    ((recommendedVenue != "" and anyMemberStrictSober(members)) implies
      (not(venues.get(recommendedVenue).isAlcoholCentric) and not(venues.get(recommendedVenue).isBarOnly)))

  // spec/friendIntroAge.md teenPlaceAllowed + teenRosterSizeAllowed:
  // An in-network teen friend roster meets only at an all-ages public non-alcohol-centric venue with <= 6 people.
  val teenFriendPlaceIsAllAges =
    recHistory.forall(e =>
      e.isTeenFriendRoster implies (e.allAges and e.isPublic and not(e.isBarOnly) and not(e.isAlcoholCentric) and e.groupSize >= 2 and e.groupSize <= TEEN_ROSTER_MAX)
    )

  // spec/venueSelection.md venueRedLinesEligible (D-2): halal, kosher, gluten-free, and severe allergen red lines fail closed.
  val allergenAndReligiousDietRespected =
    recHistory.forall(e => and {
      e.anyHalal implies e.halalFriendly,
      e.anyKosher implies e.kosherFriendly,
      e.anyGlutenFree implies e.glutenFreeFriendly,
      e.anySevereAllergen implies e.severeAllergenSafe,
    }) and
    (recommendedVenue != "" implies and {
      anyMemberHalal(members) implies venues.get(recommendedVenue).halalFriendly,
      anyMemberKosher(members) implies venues.get(recommendedVenue).kosherFriendly,
      anyMemberGlutenFree(members) implies venues.get(recommendedVenue).glutenFreeFriendly,
      anyMemberSevereAllergen(members) implies venues.get(recommendedVenue).severeAllergenSafe,
    })

  // spec/venueSelection.md venueRedLinesEligible (D-3): after-dark and first-meet safety/transit hard floors + first-meet start cap <= 21:00.
  val afterDarkSafetyAndTransitFloor =
    recHistory.forall(e =>
      ((e.isAfterDark or e.isFirstMeet) implies (e.safetyScore >= MIN_SAFETY_FLOOR and e.transitScore >= MIN_TRANSIT_FLOOR)) and
      (e.isFirstMeet implies e.startLocalHour <= FIRST_MEET_MAX_START_HOUR)
    )

  // spec/venueSelection.md venueRedLinesEligible (E-2): unreserved standard groups capped at <= 6; open impromptu events capped at <= 15.
  val unreservedGroupSizeCapped =
    recHistory.forall(e =>
      ((not(e.hasReservation) and not(e.openEventEligible)) implies e.groupSize <= UNRESERVED_STD_GROUP_CAP) and
      (e.openEventEligible implies e.groupSize <= OPEN_EVENT_GROUP_CAP)
    )

  // spec/venueSelection.md venueRedLinesEligible (E-2): concurrent Network headcount + new group never exceeds walkInCapacity.
  val venueConcurrentCapacityRespected =
    recHistory.forall(e => e.concurrentBefore + e.groupSize <= e.walkInCapacity) and
    VENUES.forall(v => venues.get(v).concurrentHeadcount >= 0 and venues.get(v).concurrentHeadcount <= venues.get(v).walkInCapacity)

  // spec/suggestionFlow.md canPivotSuggestion / nextSuggestionAction: pivots bounded at MAX_SUGGESTION_PIVOTS = 3
  // and rejected venues are never re-proposed.
  val suggestionPivotsBounded =
    pivotsUsed >= 0 and
    pivotsUsed <= MAX_SUGGESTION_PIVOTS and
    recHistory.forall(e => e.pivotsUsedAtOffer < MAX_SUGGESTION_PIVOTS) and
    (pivotsUsed >= MAX_SUGGESTION_PIVOTS implies (recommendedVenue == "" and roundState == "asked_user_or_paused")) and
    (recommendedVenue != "" implies not(roundRejected.contains(recommendedVenue)))

  // spec/venueSelection.md venueHardEligible: recommended venue price tier never exceeds the minimum member budget.
  val budgetCeilingRespected =
    recHistory.forall(e => e.priceTier <= e.minBudget) and
    (recommendedVenue != "" implies venues.get(recommendedVenue).priceTier <= minMemberBudget(members))

  // spec/venueSelection.md shouldFetchExternalVenues: no external search API call when localQualifiedCount >= 10.
  val noExternalSearchWhenSufficient =
    not(apiCallWhenSufficient) and apiBudget >= 0 and externalApiCalls <= INITIAL_API_BUDGET

  // spec/venueSelection.md nextVenueStatusOnReport: any user closure report immediately quarantines the venue out of active.
  val closureQuarantinesImmediately =
    VENUES.forall(v => venues.get(v).closureReports > 0 implies venues.get(v).status != "active")

  // spec/venueSelection.md venueHardEligible: every recommended venue has a fresh verified-open check with buffer,
  // satisfies group suitability and reservation requirements when recommended for a group, and stays within the travel bound.
  val recommendedMustBeVerifiedOpen =
    recHistory.forall(e =>
      e.verifiedFresh and
      e.openBufferOk and
      (e.forGroup implies (e.groupSuitable and (not(e.reservationRequired) or e.hasReservation))) and
      e.travelMin <= e.travelLimit
    ) and
    (recommendedVenue != "" implies isFreshOpen(venues.get(recommendedVenue), now))

  val safety = and {
    noPrivateHomeRecommended,
    noClosedOrSuspectVenueRecommended,
    noVisitedOrRejectedRecommended,
    nonDrinkerNeverBar,
    strictSoberNeverAlcoholCentric,
    teenFriendPlaceIsAllAges,
    allergenAndReligiousDietRespected,
    afterDarkSafetyAndTransitFloor,
    unreservedGroupSizeCapped,
    venueConcurrentCapacityRespected,
    suggestionPivotsBounded,
    budgetCeilingRespected,
    noExternalSearchWhenSufficient,
    closureQuarantinesImmediately,
    recommendedMustBeVerifiedOpen,
  }

  // ------------------------------------------------------------------------------------------ witnesses
  val witness_happyVisitCompleted = not(
    recHistory.size() > 0 and VENUES.exists(v => venues.get(v).visitCount > 0)
  )

  val witness_sufficiencySkipsApi = not(
    localQualifiedCount >= SUFFICIENCY_THRESHOLD and skippedWhenSufficient
  )

  val witness_closureConfirmedPermanent = not(
    VENUES.exists(v => venues.get(v).status == "closed_permanent")
  )

  val witness_externalDiscoveryUsed = not(externalApiCalls > 0)

  val witness_strictSoberAndDietaryRec = not(
    recHistory.exists(e => e.anyStrictSober and (e.anyHalal or e.anySevereAllergen))
  )

  val witness_teenFriendAllAgesRec = not(
    recHistory.exists(e => e.isTeenFriendRoster and e.allAges)
  )

  val witness_pivotLimitReached = not(
    pivotsUsed == MAX_SUGGESTION_PIVOTS and roundState == "asked_user_or_paused"
  )

  val witness_openImpromptuEventBooked = not(
    recHistory.exists(e => e.openEventEligible and e.groupSize > UNRESERVED_STD_GROUP_CAP and e.groupSize <= OPEN_EVENT_GROUP_CAP)
  )

  // ------------------------------------------------------------------------------------------ run tests
  run happyRecommendationAndVisitTest =
    init
      .then(verifyVenueOpen("v_cafe", true, true))
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .expect(recommendedVenue == "v_cafe" and venues.get("v_cafe").concurrentHeadcount == 2 and safety)
      .then(recordVisitAndFeedback("v_cafe", true))
      .expect(
        recommendedVenue == "" and
        venues.get("v_cafe").visitCount == 1 and
        venues.get("v_cafe").tasteLikes == 1 and
        venues.get("v_cafe").concurrentHeadcount == 0 and
        members.get("m1").visited.contains("v_cafe") and
        members.get("m2").visited.contains("v_cafe") and
        safety
      )

  run sufficiencyCutoffSkipsApiTest =
    init
      .then(discoverExternalVenues("v_ext1"))
      .expect(localQualifiedCount == 10 and externalApiCalls == 1 and safety)
      .then(skipExternalSearchWhenSufficient)
      .expect(skippedWhenSufficient and noExternalSearchWhenSufficient and safety)

  run externalSearchRefusedWhenSufficientTest =
    init
      .then(discoverExternalVenues("v_ext1"))
      .then(discoverExternalVenues("v_ext2"))
      .fail()

  run preRecClosureFallbackTest =
    init
      .then(verifyVenueOpen("v_cafe", false, false))
      .expect(venues.get("v_cafe").status == "suspect_closed" and safety)
      .then(verifyVenueOpen("v_hall", true, true))
      .then(recommendVenue("v_hall", true, false, 5, false, 14, true))
      .expect(recommendedVenue == "v_hall" and noClosedOrSuspectVenueRecommended and safety)

  run userClosureQuarantineTest =
    init
      .then(reportVenueClosed("v_cafe"))
      .expect(venues.get("v_cafe").status == "suspect_closed" and closureQuarantinesImmediately and safety)
      .then(reportVenueClosed("v_cafe"))
      .then(confirmClosurePermanent("v_cafe", false))
      .expect(venues.get("v_cafe").status == "closed_permanent" and closureQuarantinesImmediately and safety)

  run strictSoberBreweryRejectedTest =
    init
      .then(updateMemberPrefs("m1", true, true, false, false, false, false, 2))
      .then(recommendVenue("v_brewery", false, false, 2, false, 14, true))
      .fail()

  run strictSoberCafeAllowedTest =
    init
      .then(updateMemberPrefs("m1", true, true, true, true, true, true, 2))
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .expect(
        recommendedVenue == "v_cafe" and
        strictSoberNeverAlcoholCentric and
        allergenAndReligiousDietRespected and
        safety
      )

  run teenFriendAllAgesCafeAllowedTest =
    init
      .then(recommendVenue("v_cafe", true, true, 5, false, 14, true))
      .expect(recommendedVenue == "v_cafe" and teenFriendPlaceIsAllAges and safety)

  run teenFriendBreweryRejectedTest =
    init
      .then(recommendVenue("v_brewery", true, true, 5, false, 14, true))
      .fail()

  run teenFriendOverSixRejectedTest =
    init
      .then(recommendVenue("v_hall", true, true, 10, false, 14, true))
      .fail()

  run halalRedLineRejectedTest =
    init
      .then(updateMemberPrefs("m2", false, false, true, false, false, false, 2))
      .then(recommendVenue("v_brewery", false, false, 2, false, 14, true))
      .fail()

  run afterDarkLowSafetyRejectedTest =
    init
      .then(recommendVenue("v_dim", false, false, 2, false, 19, true))
      .fail()

  run firstMeetLateHourRejectedTest =
    init
      .then(recommendVenue("v_cafe", false, false, 2, false, 22, true))
      .fail()

  run unreservedStandardGroupOverCapRejectedTest =
    init
      .then(recommendVenue("v_cafe", true, false, 10, false, 14, true))
      .fail()

  run openImpromptuEventWithinCapAllowedTest =
    init
      .then(recommendVenue("v_hall", true, false, 10, false, 14, true))
      .expect(recommendedVenue == "v_hall" and unreservedGroupSizeCapped and safety)

  run concurrentCapacityOverflowRejectedTest =
    init
      .then(reserveConcurrentCapacity("v_cafe", 4))
      .then(recommendVenue("v_cafe", true, false, 5, false, 14, true))
      .fail()

  run suggestionPivotBoundEnforcedTest =
    init
      .then(discoverExternalVenues("v_ext1"))
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .then(rejectCurrentSuggestion("m1"))
      .then(recommendVenue("v_hall", false, false, 2, false, 14, true))
      .then(rejectCurrentSuggestion("m1"))
      .then(recommendVenue("v_brewery", false, false, 2, false, 14, true))
      .then(rejectCurrentSuggestion("m1"))
      .expect(pivotsUsed == 3 and roundState == "asked_user_or_paused" and suggestionPivotsBounded and safety)
      .then(recommendVenue("v_ext1", false, false, 2, false, 14, true))
      .fail()

  run privateHomeRejectedTest =
    init
      .then(recommendVenue("v_home", false, false, 2, false, 14, true))
      .fail()

  run visitedVenueRejectedTest =
    init
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .then(recordVisitAndFeedback("v_cafe", true))
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .fail()

  run rejectedVenueExcludedTest =
    init
      .then(recordVenueRejection("m2", "v_hall"))
      .then(recommendVenue("v_hall", false, false, 2, false, 14, true))
      .fail()

  run staleOpenCheckRejectedTest =
    init
      .then(advanceClock(25))
      .then(recommendVenue("v_cafe", false, false, 2, false, 14, true))
      .fail()

  run reservedGroupAllowedTest =
    init
      .then(updateMemberPrefs("m1", false, false, false, false, false, false, 4))
      .then(updateMemberPrefs("m2", false, false, false, false, false, false, 4))
      .then(recommendVenue("v_upscale", true, false, 5, true, 14, true))
      .expect(recommendedVenue == "v_upscale" and recommendedMustBeVerifiedOpen and safety)

  run unreservedReservationVenueRejectedTest =
    init
      .then(updateMemberPrefs("m1", false, false, false, false, false, false, 4))
      .then(updateMemberPrefs("m2", false, false, false, false, false, false, 4))
      .then(recommendVenue("v_upscale", true, false, 5, false, 14, true))
      .fail()
}
```
