// GENERATED from spec/venueSelection.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
export interface VenueHardEligibilityInput { isPublic: boolean; venueStatus: string; minParticipantAge: number; venueAgeMin: number; venueAllAges: boolean; teenFriendAllowed: boolean; anyNonDrinker: boolean; isBarOnly: boolean; alcoholOptional: boolean; anyVegetarian: boolean; servesVegetarian: boolean; anyVegan: boolean; servesVegan: boolean; anyWheelchairNeeded: boolean; wheelchairAccessible: boolean; anyVisited: boolean; anyRejected: boolean; priceTier: number; maxBudgetTier: number; maxTravelMin: number; travelLimitMin: number; verifiedOpen: boolean; openBufferMin: number; groupSize: number; reservationRequired: boolean; hasReservation: boolean; separateChecks: boolean; walkInCapacity: number; isNightLiveMusic: boolean; isOutdoorOnly: boolean; badWeatherOrAfterDark: boolean }
/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
export interface VenueRedLinesInput { anyStrictSober: boolean; anyNonDrinker: boolean; isAlcoholCentric: boolean; isBarOnly: boolean; alcoholOptional: boolean; anyHalal: boolean; halalFriendly: boolean; anyKosher: boolean; kosherFriendly: boolean; anyGlutenFree: boolean; glutenFreeFriendly: boolean; anySevereAllergen: boolean; severeAllergenSafe: boolean; anySmokeFree: boolean; isSmokeFree: boolean; anyLowNoise: boolean; noiseTier: number; anyDaytimeOnly: boolean; isAfterDark: boolean; isFirstMeet: boolean; safetyScore: number; transitScore: number; startLocalHour: number; groupSize: number; hasReservation: boolean; openEventEligible: boolean; concurrentHeadcount: number; walkInCapacity: number }
/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
export interface GroupVenueRubricInput { separateChecks: boolean; walkInCapacity: number; noiseLevel: string; liveMusicAtNight: boolean; alcoholOptional: boolean; servesVegetarian: boolean; servesVegan: boolean; safetyScore: number; indoor: boolean; weatherSensitive: boolean; hasArrivalLandmark: boolean; transitScore: number }


/** Story: Bound travel time and score fair midpoints / Keep every participant travel time non-negative and within the travel limit (spec/venueSelection.md) */
//@ pure
export function isWithinTravelLimit(travelMin: number, limitMin: number): boolean {
  return travelMin >= 0 && limitMin > 0 && travelMin <= limitMin;
}

/** Story: Bound travel time and score fair midpoints / Keep every participant travel time non-negative and within the travel limit (spec/venueSelection.md) */
//@ pure
export function lawNegativeTravelNeverWithinLimit(limitMin: number): boolean {
  //@ ensures \result === true
  return !isWithinTravelLimit(-1, limitMin);
}

/** Story: Bound travel time and score fair midpoints / Keep every participant travel time non-negative and within the travel limit (spec/venueSelection.md) */
//@ pure
export function lawNonPositiveLimitNeverAcceptsTravel(travelMin: number): boolean {
  //@ ensures \result === true
  return !isWithinTravelLimit(travelMin, 0) && !isWithinTravelLimit(travelMin, -1);
}

/** Story: Bound travel time and score fair midpoints / Keep every participant travel time non-negative and within the travel limit (spec/venueSelection.md) */
//@ pure
export function lawExceedingLimitRejected(travelMin: number, limitMin: number): boolean {
  //@ ensures \result === true
  return !(travelMin > limitMin) || !isWithinTravelLimit(travelMin, limitMin);
}

/** Story: Bound travel time and score fair midpoints / Balance worst-case fairness and mean travel in integer-scaled midpoint cost (spec/venueSelection.md) */
//@ pure
export function fairMidpointCostScaled(maxMin: number, meanMin: number): number {
  return exact_venueSelection(exact_venueSelection(6 * maxMin) + exact_venueSelection(4 * meanMin));
}

/** Story: Bound travel time and score fair midpoints / Balance worst-case fairness and mean travel in integer-scaled midpoint cost (spec/venueSelection.md) */
//@ pure
export function fairMidpointNetCostScaled(maxMin: number, meanMin: number, supplyBonusScaled: number): number {
  return exact_venueSelection(fairMidpointCostScaled(maxMin, meanMin) - supplyBonusScaled);
}

/** Story: Bound travel time and score fair midpoints / Balance worst-case fairness and mean travel in integer-scaled midpoint cost (spec/venueSelection.md) */
//@ pure
export function lawMidpointCostBoundedByMeanAndMax(maxMin: number, meanMin: number): boolean {
  //@ ensures \result === true
  return !(maxMin >= 0 && meanMin >= 0 && meanMin <= maxMin) || (fairMidpointCostScaled(maxMin, meanMin) >= exact_venueSelection(10 * meanMin) && fairMidpointCostScaled(maxMin, meanMin) <= exact_venueSelection(10 * maxMin));
}

/** Story: Bound travel time and score fair midpoints / Accept a midpoint only when every attendee fits within bounded relaxation (spec/venueSelection.md) */
//@ pure
export function isValidMidpoint(travelMinutes: number[], limitMin: number, relaxStepMin: number): boolean {
  return travelMinutes.length > 0 && limitMin > 0 && relaxStepMin >= 0 && relaxStepMin <= 10 && !travelMinutes.some((t: number) => !isWithinTravelLimit(t, exact_venueSelection(limitMin + relaxStepMin)));
}

/** Story: Bound travel time and score fair midpoints / Accept a midpoint only when every attendee fits within bounded relaxation (spec/venueSelection.md) */
//@ pure
export function lawEmptyTravelListNeverValidMidpoint(limitMin: number, relaxStepMin: number): boolean {
  //@ ensures \result === true
  return !isValidMidpoint(([] as number[]), limitMin, relaxStepMin);
}

/** Story: Bound travel time and score fair midpoints / Accept a midpoint only when every attendee fits within bounded relaxation (spec/venueSelection.md) */
//@ pure
export function lawRelaxationBeyondTenMinutesRejected(travelMinutes: number[], limitMin: number): boolean {
  //@ ensures \result === true
  return !isValidMidpoint(travelMinutes, limitMin, 11) && !isValidMidpoint(travelMinutes, limitMin, -1);
}

/** Story: Bound travel time and score fair midpoints / Accept a midpoint only when every attendee fits within bounded relaxation (spec/venueSelection.md) */
//@ pure
export function lawValidMidpointFitsEveryAttendee(travelMinutes: number[], limitMin: number, relaxStepMin: number): boolean {
  //@ ensures \result === true
  return !isValidMidpoint(travelMinutes, limitMin, relaxStepMin) || !travelMinutes.some((t: number) => !(t >= 0 && t <= exact_venueSelection(limitMin + relaxStepMin)));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function venueHardEligible(v: VenueHardEligibilityInput): boolean {
  return v.isPublic && v.venueStatus === "active" && v.groupSize >= 1 && v.minParticipantAge >= 13 && v.minParticipantAge <= 120 && v.minParticipantAge >= v.venueAgeMin && (v.minParticipantAge >= 18 || (v.venueAllAges && !v.isBarOnly && v.alcoholOptional && v.venueAgeMin <= 13)) && (v.groupSize < 2 || v.minParticipantAge >= 18 || (v.teenFriendAllowed && v.groupSize <= 6)) && (!v.anyNonDrinker || (!v.isBarOnly && v.alcoholOptional)) && (!v.anyVegetarian || v.servesVegetarian) && (!v.anyVegan || v.servesVegan) && (!v.anyWheelchairNeeded || v.wheelchairAccessible) && !v.anyVisited && !v.anyRejected && v.priceTier >= 0 && v.priceTier <= v.maxBudgetTier && isWithinTravelLimit(v.maxTravelMin, v.travelLimitMin) && v.verifiedOpen && (v.groupSize >= 3 ? v.openBufferMin >= 120 : v.openBufferMin >= 90) && (v.groupSize < 3 || ((!v.reservationRequired || v.hasReservation) && v.separateChecks && v.walkInCapacity >= v.groupSize && !v.isNightLiveMusic)) && !(v.isOutdoorOnly && v.badWeatherOrAfterDark);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawNoPrivateHomeRecommended(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !venueHardEligible(v) || v.isPublic;
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawNoClosedOrSuspectVenueRecommended(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !venueHardEligible(v) || v.venueStatus === "active";
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawNoVisitedOrRejectedRecommended(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !venueHardEligible(v) || (!v.anyVisited && !v.anyRejected);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawMinorVenueRequiresAllAgesAndTeenRule(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !(venueHardEligible(v) && v.minParticipantAge < 18) || (v.venueAllAges && !v.isBarOnly && v.alcoholOptional && v.venueAgeMin <= 13 && (v.groupSize < 2 || (v.teenFriendAllowed && v.groupSize <= 6)));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawNonDrinkerNeverBarHard(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !(venueHardEligible(v) && v.anyNonDrinker) || (!v.isBarOnly && v.alcoholOptional);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawBudgetCeilingRespected(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !venueHardEligible(v) || (v.priceTier >= 0 && v.priceTier <= v.maxBudgetTier);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawRecommendedMustBeVerifiedOpen(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !venueHardEligible(v) || (v.verifiedOpen && (v.groupSize >= 3 ? v.openBufferMin >= 120 : v.openBufferMin >= 90));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Require public active open venues that honor age, all-ages teen rules, diet, mobility, budget, and group walk-in rules (spec/venueSelection.md) */
//@ pure
export function lawGroupReservationRequirementHonored(v: VenueHardEligibilityInput): boolean {
  //@ ensures \result === true
  return !(venueHardEligible(v) && v.groupSize >= 3 && v.reservationRequired) || v.hasReservation;
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function venueRedLinesEligible(r: VenueRedLinesInput): boolean {
  return r.groupSize >= 1 && (!r.anyStrictSober || (!r.isAlcoholCentric && !r.isBarOnly)) && (!r.anyNonDrinker || (!r.isBarOnly && r.alcoholOptional)) && (!r.anyHalal || r.halalFriendly) && (!r.anyKosher || r.kosherFriendly) && (!r.anyGlutenFree || r.glutenFreeFriendly) && (!r.anySevereAllergen || r.severeAllergenSafe) && (!r.anySmokeFree || r.isSmokeFree) && (!r.anyLowNoise || (r.noiseTier >= 0 && r.noiseTier <= 1)) && (!r.anyDaytimeOnly || !r.isAfterDark) && (!(r.isAfterDark || r.isFirstMeet) || (r.safetyScore >= 7 && r.transitScore >= 3)) && (!r.isFirstMeet || (r.startLocalHour >= 0 && r.startLocalHour <= 21)) && (r.hasReservation || r.openEventEligible || r.groupSize <= 6) && (!r.openEventEligible || r.groupSize <= 15) && r.concurrentHeadcount >= 0 && r.walkInCapacity >= 0 && exact_venueSelection(r.concurrentHeadcount + r.groupSize) <= r.walkInCapacity;
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawStrictSoberNeverAlcoholCentric(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !(venueRedLinesEligible(r) && r.anyStrictSober) || (!r.isAlcoholCentric && !r.isBarOnly);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawNonDrinkerNeverBar(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !(venueRedLinesEligible(r) && r.anyNonDrinker) || (!r.isBarOnly && r.alcoholOptional);
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawAllergenAndReligiousDietRespected(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !venueRedLinesEligible(r) || ((!r.anyHalal || r.halalFriendly) && (!r.anyKosher || r.kosherFriendly) && (!r.anyGlutenFree || r.glutenFreeFriendly) && (!r.anySevereAllergen || r.severeAllergenSafe));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawSensoryAndDaytimeBoundariesRespected(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !venueRedLinesEligible(r) || ((!r.anySmokeFree || r.isSmokeFree) && (!r.anyLowNoise || (r.noiseTier >= 0 && r.noiseTier <= 1)) && (!r.anyDaytimeOnly || !r.isAfterDark));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawAfterDarkSafetyAndTransitFloor(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !venueRedLinesEligible(r) || ((!(r.isAfterDark || r.isFirstMeet) || (r.safetyScore >= 7 && r.transitScore >= 3)) && (!r.isFirstMeet || (r.startLocalHour >= 0 && r.startLocalHour <= 21)));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawUnreservedGroupSizeCapped(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !venueRedLinesEligible(r) || ((r.hasReservation || r.openEventEligible || r.groupSize <= 6) && (!r.openEventEligible || r.groupSize <= 15));
}

/** Story: Enforce hard venue eligibility and attendee red lines / Enforce strict sobriety, allergens, religious diets, sensory limits, after-dark floors, and concurrent capacity (spec/venueSelection.md) */
//@ pure
export function lawVenueConcurrentCapacityRespected(r: VenueRedLinesInput): boolean {
  //@ ensures \result === true
  return !venueRedLinesEligible(r) || (r.concurrentHeadcount >= 0 && r.walkInCapacity >= 0 && exact_venueSelection(r.concurrentHeadcount + r.groupSize) <= r.walkInCapacity);
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Fetch external venues only when fewer than ten qualified local venues exist (spec/venueSelection.md) */
//@ pure
export function shouldFetchExternalVenues(localQualifiedCount: number): boolean {
  return localQualifiedCount < 10;
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Fetch external venues only when fewer than ten qualified local venues exist (spec/venueSelection.md) */
//@ pure
export function lawNoExternalSearchWhenSufficient(localQualifiedCount: number): boolean {
  //@ ensures \result === true
  return !(localQualifiedCount >= 10) || !shouldFetchExternalVenues(localQualifiedCount);
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Verify live opening status after 24 hours on weekdays or 6 hours on weekends and holidays (spec/venueSelection.md) */
//@ pure
export function needsPreRecommendOpenCheck(ageHours: number, isWeekendOrHoliday: boolean): boolean {
  const local_0 = isWeekendOrHoliday ? 6 : 24;
  return ageHours < 0 || ageHours >= local_0;
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Verify live opening status after 24 hours on weekdays or 6 hours on weekends and holidays (spec/venueSelection.md) */
//@ pure
export function lawFreshnessThresholdMatchesDayType(ageHours: number, isWeekendOrHoliday: boolean): boolean {
  //@ ensures \result === true
  return isWeekendOrHoliday ? needsPreRecommendOpenCheck(ageHours, true) === (ageHours < 0 || ageHours >= 6) : needsPreRecommendOpenCheck(ageHours, false) === (ageHours < 0 || ageHours >= 24);
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Quarantine a venue immediately on any closure report (spec/venueSelection.md) */
//@ pure
export function nextVenueStatusOnReport(currentStatus: string, reportedClosed: boolean, closureReportCount: number, providerPermanent: boolean, providerTemporary: boolean): string {
  return providerPermanent ? "closed_permanent" : (reportedClosed && exact_venueSelection(closureReportCount + 1) >= 2 ? "closed_permanent" : (providerTemporary ? "closed_temporary" : (reportedClosed ? (currentStatus === "closed_permanent" ? "closed_permanent" : (currentStatus === "closed_temporary" ? "closed_temporary" : "suspect_closed")) : currentStatus)));
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Quarantine a venue immediately on any closure report (spec/venueSelection.md) */
//@ pure
export function lawClosureQuarantinesImmediately(currentStatus: string, closureReportCount: number, providerPermanent: boolean, providerTemporary: boolean): boolean {
  //@ ensures \result === true
  return nextVenueStatusOnReport(currentStatus, true, closureReportCount, providerPermanent, providerTemporary) !== "active";
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
//@ pure
export function clampInt(value: number, low: number, high: number): number {
  return value < low ? low : (value > high ? high : value);
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
//@ pure
export function groupVenueRubricScore(g: GroupVenueRubricInput): number {
  const local_1 = g.separateChecks ? 20 : 0;
  const local_2 = g.walkInCapacity >= 6 ? 20 : (g.walkInCapacity >= 4 ? 12 : 0);
  const local_3 = g.liveMusicAtNight ? 0 : (g.noiseLevel === "conversational" || g.noiseLevel === "lively" ? 15 : (g.noiseLevel === "quiet" ? 6 : 0));
  const local_4 = exact_venueSelection(exact_venueSelection((g.alcoholOptional ? 8 : 0) + (g.servesVegetarian ? 4 : 0)) + (g.servesVegan ? 3 : 0));
  const local_5 = clampInt(g.safetyScore, 0, 10);
  const local_6 = g.indoor && !g.weatherSensitive ? 10 : (g.indoor ? 7 : (!g.weatherSensitive ? 4 : 0));
  const local_7 = g.hasArrivalLandmark ? 5 : 0;
  const local_8 = clampInt(g.transitScore, 0, 5);
  return exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(exact_venueSelection(local_1 + local_2) + local_3) + local_4) + local_5) + local_6) + local_7) + local_8);
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
//@ pure
export function venueBudgetFitScore(priceTier: number, maxBudgetTier: number): number {
  const local_9 = exact_venueSelection(maxBudgetTier - priceTier);
  return priceTier < 0 || maxBudgetTier < 0 || priceTier > maxBudgetTier ? 0 : (local_9 === 0 ? 100 : (local_9 === 1 ? 90 : (local_9 === 2 ? 75 : 60)));
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
//@ pure
export function lawGroupRubricScoreBounded(g: GroupVenueRubricInput): boolean {
  //@ ensures \result === true
  const local_10 = groupVenueRubricScore(g);
  return local_10 >= 0 && local_10 <= 100;
}

/** Story: Maintain catalog freshness, closure quarantine, and deterministic venue scores / Clamp integers and compute bounded group rubric and budget scores (spec/venueSelection.md) */
//@ pure
export function lawBudgetFitScoreBoundedAndZeroOverBudget(priceTier: number, maxBudgetTier: number): boolean {
  //@ ensures \result === true
  const local_11 = venueBudgetFitScore(priceTier, maxBudgetTier);
  return local_11 >= 0 && local_11 <= 100 && (!(priceTier > maxBudgetTier) || local_11 === 0);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_venueSelection(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
