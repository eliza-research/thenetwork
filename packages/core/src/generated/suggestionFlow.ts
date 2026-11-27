// GENERATED from spec/suggestionFlow.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Score venues with mode-specific weights / Compute a bounded 0..100 score with capped niche-hobby bonus on dates (spec/suggestionFlow.md) */
export interface ModeVenueScoreInput { scoreMode: string; activityFit: number; groupRubric: number; dateVibeFit: number; personaScore: number; travelScore: number; budgetFit: number; safetyAcoustics: number; bothShareHighHobbyAffinity: boolean; bothOptedIntoActivityDates: boolean; nicheHobbyBonus: number; midpointBonus: number }

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
export const maxSuggestionPivots: number = 3;

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
//@ pure
export function clampSuggestionScore(value: number, low: number, high: number): number {
  return value < low ? low : (value > high ? high : value);
}

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
//@ pure
export function canPivotSuggestion(pivotsUsed: number, candidateAlreadyRejected: boolean, candidateAlreadyVisited: boolean): boolean {
  return pivotsUsed >= 0 && pivotsUsed < maxSuggestionPivots && !candidateAlreadyRejected && !candidateAlreadyVisited;
}

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
//@ pure
export function nextSuggestionAction(pivotsUsed: number, remainingCandidates: number): string {
  return pivotsUsed < 0 || pivotsUsed >= maxSuggestionPivots || remainingCandidates <= 0 ? "ask_user_spot_or_pause" : "propose_next";
}

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
//@ pure
export function lawSuggestionPivotsBounded(pivotsUsed: number, candidateAlreadyRejected: boolean, candidateAlreadyVisited: boolean): boolean {
  //@ ensures \result === true
  return !canPivotSuggestion(pivotsUsed, candidateAlreadyRejected, candidateAlreadyVisited) || (pivotsUsed >= 0 && pivotsUsed < maxSuggestionPivots && !candidateAlreadyRejected && !candidateAlreadyVisited);
}

/** Story: Bound suggestion pivots and prevent repeats / Allow a suggestion pivot only below three pivots and for unvisited, unrejected venues (spec/suggestionFlow.md) */
//@ pure
export function lawNextSuggestionStopsAtLimitOrEmpty(pivotsUsed: number, remainingCandidates: number): boolean {
  //@ ensures \result === true
  return !(pivotsUsed >= maxSuggestionPivots || pivotsUsed < 0 || remainingCandidates <= 0) || nextSuggestionAction(pivotsUsed, remainingCandidates) === "ask_user_spot_or_pause";
}

/** Story: Route local supply by density and enforce date activity red lines / Classify local supply into dense, medium, or sparse tiers (spec/suggestionFlow.md) */
//@ pure
export function computeDensityTier(appKind: string, qualifiedLocalCount: number): string {
  return appKind === "slop" ? (qualifiedLocalCount >= 3 ? "dense" : (qualifiedLocalCount >= 1 ? "medium" : "sparse")) : (qualifiedLocalCount >= 6 ? "dense" : (qualifiedLocalCount >= 2 ? "medium" : "sparse"));
}

/** Story: Route local supply by density and enforce date activity red lines / Classify local supply into dense, medium, or sparse tiers (spec/suggestionFlow.md) */
//@ pure
export function lawFriendsDensityTierThresholds(qualifiedLocalCount: number): boolean {
  //@ ensures \result === true
  return (!(qualifiedLocalCount >= 6) || computeDensityTier("friends", qualifiedLocalCount) === "dense") && (!(qualifiedLocalCount >= 2 && qualifiedLocalCount <= 5) || computeDensityTier("friends", qualifiedLocalCount) === "medium") && (!(qualifiedLocalCount <= 1) || computeDensityTier("friends", qualifiedLocalCount) === "sparse");
}

/** Story: Route local supply by density and enforce date activity red lines / Classify local supply into dense, medium, or sparse tiers (spec/suggestionFlow.md) */
//@ pure
export function lawSlopDensityTierThresholds(qualifiedLocalCount: number): boolean {
  //@ ensures \result === true
  return (!(qualifiedLocalCount >= 3) || computeDensityTier("slop", qualifiedLocalCount) === "dense") && (!(qualifiedLocalCount >= 1 && qualifiedLocalCount <= 2) || computeDensityTier("slop", qualifiedLocalCount) === "medium") && (!(qualifiedLocalCount <= 0) || computeDensityTier("slop", qualifiedLocalCount) === "sparse");
}

/** Story: Route local supply by density and enforce date activity red lines / Exclude alcohol, high-walking, and after-dark date activities when red lines apply (spec/suggestionFlow.md) */
//@ pure
export function dateActivityAllowed(activityKind: string, anyStrictSober: boolean, anyNonDrinker: boolean, anyLowWalking: boolean, anyDaytimeOnly: boolean, isAfterDark: boolean): boolean {
  const local_0 = activityKind === "drinks" || activityKind === "wine_bar" || activityKind === "cocktail" || activityKind === "bar" || activityKind === "brewery";
  return local_0 && (anyStrictSober || anyNonDrinker) ? false : ((activityKind === "hike" || activityKind === "long_walk") && anyLowWalking ? false : (activityKind === "outdoor_night_walk" && anyDaytimeOnly ? false : (anyDaytimeOnly && isAfterDark ? false : true)));
}

/** Story: Route local supply by density and enforce date activity red lines / Exclude alcohol, high-walking, and after-dark date activities when red lines apply (spec/suggestionFlow.md) */
//@ pure
export function lawSoberOrNonDrinkerNeverGetsDrinksActivity(anyStrictSober: boolean, anyNonDrinker: boolean, anyLowWalking: boolean, anyDaytimeOnly: boolean, isAfterDark: boolean): boolean {
  //@ ensures \result === true
  return !(anyStrictSober || anyNonDrinker) || (!dateActivityAllowed("drinks", anyStrictSober, anyNonDrinker, anyLowWalking, anyDaytimeOnly, isAfterDark) && !dateActivityAllowed("wine_bar", anyStrictSober, anyNonDrinker, anyLowWalking, anyDaytimeOnly, isAfterDark) && !dateActivityAllowed("cocktail", anyStrictSober, anyNonDrinker, anyLowWalking, anyDaytimeOnly, isAfterDark));
}

/** Story: Route local supply by density and enforce date activity red lines / Exclude alcohol, high-walking, and after-dark date activities when red lines apply (spec/suggestionFlow.md) */
//@ pure
export function lawLowWalkingForbidsHike(anyStrictSober: boolean, anyNonDrinker: boolean, anyDaytimeOnly: boolean, isAfterDark: boolean): boolean {
  //@ ensures \result === true
  return !dateActivityAllowed("hike", anyStrictSober, anyNonDrinker, true, anyDaytimeOnly, isAfterDark);
}

/** Story: Route local supply by density and enforce date activity red lines / Exclude alcohol, high-walking, and after-dark date activities when red lines apply (spec/suggestionFlow.md) */
//@ pure
export function lawDaytimeOnlyForbidsAfterDark(activityKind: string, anyStrictSober: boolean, anyNonDrinker: boolean, anyLowWalking: boolean): boolean {
  //@ ensures \result === true
  return !dateActivityAllowed(activityKind, anyStrictSober, anyNonDrinker, anyLowWalking, true, true);
}

/** Story: Score venues with mode-specific weights / Compute a bounded 0..100 score with capped niche-hobby bonus on dates (spec/suggestionFlow.md) */
//@ pure
export function slopNicheHobbyBonus(bothShareHighHobbyAffinity: boolean, bothOptedIntoActivityDates: boolean, requestedBonus: number): number {
  return bothShareHighHobbyAffinity && bothOptedIntoActivityDates ? clampSuggestionScore(requestedBonus, 0, 15) : 0;
}

/** Story: Score venues with mode-specific weights / Compute a bounded 0..100 score with capped niche-hobby bonus on dates (spec/suggestionFlow.md) */
//@ pure
export function modeVenueScore(m: ModeVenueScoreInput): number {
  const local_1 = clampSuggestionScore(m.activityFit, 0, 100);
  const local_2 = clampSuggestionScore(m.groupRubric, 0, 100);
  const local_3 = clampSuggestionScore(m.dateVibeFit, 0, 100);
  const local_4 = clampSuggestionScore(m.personaScore, 0, 100);
  const local_5 = clampSuggestionScore(m.travelScore, 0, 100);
  const local_6 = clampSuggestionScore(m.budgetFit, 0, 100);
  const local_7 = clampSuggestionScore(m.safetyAcoustics, 0, 100);
  const local_8 = clampSuggestionScore(m.midpointBonus, 0, 10);
  const local_9 = quotient_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(35 * local_1) + exact_suggestionFlow(30 * local_2)) + exact_suggestionFlow(15 * local_5)) + exact_suggestionFlow(10 * local_6)) + exact_suggestionFlow(10 * local_4)), 100);
  const local_10 = quotient_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(exact_suggestionFlow(30 * local_3) + exact_suggestionFlow(25 * local_4)) + exact_suggestionFlow(20 * local_5)) + exact_suggestionFlow(15 * local_6)) + exact_suggestionFlow(10 * local_7)), 100);
  const local_11 = slopNicheHobbyBonus(m.bothShareHighHobbyAffinity, m.bothOptedIntoActivityDates, m.nicheHobbyBonus);
  return m.scoreMode === "friends" ? clampSuggestionScore(exact_suggestionFlow(local_9 + local_8), 0, 100) : clampSuggestionScore(exact_suggestionFlow(exact_suggestionFlow(local_10 + local_11) + local_8), 0, 100);
}

/** Story: Score venues with mode-specific weights / Compute a bounded 0..100 score with capped niche-hobby bonus on dates (spec/suggestionFlow.md) */
//@ pure
export function lawNicheHobbyBonusRequiresMutualOptInAndCap(bothShareHighHobbyAffinity: boolean, bothOptedIntoActivityDates: boolean, requestedBonus: number): boolean {
  //@ ensures \result === true
  const local_12 = slopNicheHobbyBonus(bothShareHighHobbyAffinity, bothOptedIntoActivityDates, requestedBonus);
  return local_12 >= 0 && local_12 <= 15 && (!(!(bothShareHighHobbyAffinity && bothOptedIntoActivityDates)) || local_12 === 0);
}

/** Story: Score venues with mode-specific weights / Compute a bounded 0..100 score with capped niche-hobby bonus on dates (spec/suggestionFlow.md) */
//@ pure
export function lawModeVenueScoreBounded(m: ModeVenueScoreInput): boolean {
  //@ ensures \result === true
  const local_13 = modeVenueScore(m);
  return local_13 >= 0 && local_13 <= 100;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_suggestionFlow(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_suggestionFlow(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
