// Thin shell for venue open-hours checks, venue ranking, primary/backup selection,
// top-1 suggestion pivot loop, Bayesian venue feedback & quarantine, post-event follow-up
// scheduling, arrival relay gates, and anchor failover.
// All pure business decisions delegate to the Vibespec-generated modules under ./generated/.

import { HOUR, MINUTE } from "./clock.ts";
import { km } from "./geo.ts";
import { CITY_TZ, fromLocal, localParts } from "./time.ts";
import { chooseFairMidpoint, estimateTravelMinutes, getCity } from "./cities.ts";
import {
  fairMidpointCostScaled,
  groupVenueRubricScore,
  isWithinTravelLimit,
  needsPreRecommendOpenCheck,
  nextVenueStatusOnReport,
  shouldFetchExternalVenues,
  venueBudgetFitScore,
  venueHardEligible,
  venueRedLinesEligible,
  type VenueRedLinesInput,
} from "./generated/venueSelection.ts";
import {
  canPivotSuggestion,
  computeDensityTier,
  dateActivityAllowed,
  maxSuggestionPivots,
  modeVenueScore,
  nextSuggestionAction,
  slopNicheHobbyBonus,
  type ModeVenueScoreInput,
} from "./generated/suggestionFlow.ts";
import {
  anchorFailoverDecision,
  canAttendEventOrCoattend,
  canRelayArrivalSafe,
  canSendFollowup,
  computeFollowupLocalHour,
  meetupPhase,
  noShowDecision,
  shouldPivotToBackupV2,
  shouldQuarantineVenue,
  type AnchorFailoverInput,
  type ArrivalRelaySafeInput,
  type FollowupSendInput,
} from "./generated/meetupCoordination.ts";
import type {
  FollowupSchedule,
  LaunchCity,
  MeetupPhase,
  MemberVenuePrefs,
  VenueCandidateResult,
  VenueCategory,
  VenueFeedbackReport,
  VenueNoiseLevel,
  VenueRecord,
} from "./types.ts";

export const MAX_SUGGESTION_PIVOTS = maxSuggestionPivots;

export interface VenueOpenCheck {
  open: boolean;
  remainingMinutes: number;
}

export interface VenueRankRequest {
  city: LaunchCity;
  memberAreas: string[];
  members: MemberVenuePrefs[];
  startMs: number;
  mode: "date" | "group" | "solo";
  app?: "friends" | "slop" | "ntwrk";
  isWeekendOrHoliday?: boolean;
  badWeatherOrAfterDark?: boolean;
  overrideTravelLimitMin?: number;
  isFirstMeet?: boolean;
  hasReservation?: boolean;
  openEvent?: boolean;
  teenFriendAllowed?: boolean;
  concurrentHeadcountByVenue?: Record<string, number>;
  targetHobbies?: string[];
}

export interface PrimaryBackupVenuePick {
  primary?: VenueCandidateResult;
  backup?: VenueCandidateResult;
  candidates: VenueCandidateResult[];
  shouldFetchExternal: boolean;
}

export type DensityTier = "dense" | "medium" | "sparse";
export type SuggestionAction = "propose_next" | "ask_user_spot_or_pause";
export type AnchorFailoverAction = "promote_co_anchor" | "cancel_cleanly" | "cancel_low_quorum" | "proceed";
export type VenueRejectionReason =
  | "too_far"
  | "wrong_vibe"
  | "price"
  | "already_been"
  | "red_line"
  | "bad_time"
  | "bare_no";

export interface TopOneSuggestionState {
  candidates: VenueCandidateResult[];
  current?: VenueCandidateResult;
  backup?: VenueCandidateResult;
  rejectedIds: string[];
  visitedIds: string[];
  pivotsUsed: number;
  action: SuggestionAction;
  lastReason?: VenueRejectionReason;
}

export interface PivotFilterOptions {
  excludeCategories?: VenueCategory[];
  maxTravelMinutes?: number;
  maxPriceTier?: number;
  requireLowNoise?: boolean;
  requireNoAlcohol?: boolean;
}

export interface TopOneCopyOptions {
  state: TopOneSuggestionState;
  whenLabel: string;
  mode: "date" | "group" | "solo";
  partnerFirstName?: string;
  why?: string;
}

export interface ArrivalRelayInput {
  senderAge: number;
  recipientAge: number;
  senderConfirmed: boolean;
  recipientConfirmed: boolean;
  blocked: boolean;
  senderOptedOut: boolean;
  recipientOptedOut: boolean;
  minutesFromStart: number;
  alreadyMet: boolean;
  passedSafetyAndLeakCheck: boolean;
}

const ALCOHOL_CENTRIC_CATEGORIES = new Set<VenueCategory>([
  "brewery",
  "brewery_garden",
  "wine_bar",
  "cocktail_bar",
  "cocktail_lounge",
  "wine_beer_patio",
]);

const CLASSIC_DATE_CATEGORIES = new Set<VenueCategory>([
  "coffee_shop",
  "tea_house",
  "cafe_tea_bar",
  "bakery_cafe",
  "bookstore_cafe",
  "wine_bar",
  "cocktail_lounge",
  "casual_bistro",
  "dessert_cafe",
  "museum_gallery",
]);

const HOBBY_NATIVE_CATEGORIES = new Set<VenueCategory>([
  "game_store",
  "board_game_cafe",
  "climbing_gym",
  "bowling_arcade",
  "community_space",
  "bookstore_cafe",
  "museum_gallery",
  "tea_house",
]);

function noiseLevelToTier(noise: VenueNoiseLevel): number {
  switch (noise) {
    case "quiet":
      return 0;
    case "conversational":
      return 1;
    case "lively":
      return 2;
    case "loud":
      return 3;
  }
}

function isVenueAlcoholCentric(venue: VenueRecord): boolean {
  return venue.isAlcoholCentric ?? (venue.isBarOnly || ALCOHOL_CENTRIC_CATEGORIES.has(venue.category));
}

function isVenueAllAges(venue: VenueRecord): boolean {
  if (typeof venue.allAges === "boolean") return venue.allAges;
  return !venue.isBarOnly && !isVenueAlcoholCentric(venue) && (venue.ageMin ?? 0) <= 13;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_");
}

function computeActivityFitScore(
  venue: VenueRecord,
  members: MemberVenuePrefs[],
  targetHobbies?: string[]
): { activityFit: number; sharedHobbyHit: boolean; bothShareHighHobbyAffinity: boolean } {
  const venueHobbies = new Set((venue.hobbies ?? []).map(normalizeTag));
  const requested = new Set<string>((targetHobbies ?? []).map(normalizeTag));
  const memberHobbyCounts = new Map<string, number>();

  for (const m of members) {
    const seen = new Set<string>();
    for (const h of m.hobbies ?? []) {
      const nh = normalizeTag(h);
      if (!nh || seen.has(nh)) continue;
      seen.add(nh);
      memberHobbyCounts.set(nh, (memberHobbyCounts.get(nh) ?? 0) + 1);
    }
  }

  let sharedHit = false;
  let anyHit = false;
  for (const h of requested) {
    if (venueHobbies.has(h)) {
      anyHit = true;
      if (members.length <= 1 || (memberHobbyCounts.get(h) ?? 0) >= 2) sharedHit = true;
    }
  }
  for (const [h, count] of memberHobbyCounts) {
    if (venueHobbies.has(h)) {
      anyHit = true;
      if (members.length >= 2 && count >= 2) sharedHit = true;
    }
  }

  if (sharedHit) return { activityFit: 95, sharedHobbyHit: true, bothShareHighHobbyAffinity: members.length >= 2 };
  if (anyHit) return { activityFit: 82, sharedHobbyHit: false, bothShareHighHobbyAffinity: false };
  if (venue.category === "food_hall") {
    return { activityFit: 74, sharedHobbyHit: false, bothShareHighHobbyAffinity: false };
  }
  if (venue.category === "coffee_shop" || venue.category === "bakery_cafe" || venue.category === "park") {
    return { activityFit: 66, sharedHobbyHit: false, bothShareHighHobbyAffinity: false };
  }
  if (HOBBY_NATIVE_CATEGORIES.has(venue.category)) {
    return { activityFit: 56, sharedHobbyHit: false, bothShareHighHobbyAffinity: false };
  }
  return { activityFit: 58, sharedHobbyHit: false, bothShareHighHobbyAffinity: false };
}

function computeDateVibeScore(venue: VenueRecord, members: MemberVenuePrefs[]): number {
  let score = CLASSIC_DATE_CATEGORIES.has(venue.category)
    ? 80
    : venue.category === "food_hall"
      ? 72
      : venue.isBarOnly
        ? 64
        : 62;
  if (venue.noiseLevel === "conversational" || venue.noiseLevel === "quiet") score += 8;
  else if (venue.noiseLevel === "loud") score -= 15;

  const venueCuisines = new Set((venue.cuisineTags ?? []).map(normalizeTag));
  if (venueCuisines.size > 0) {
    let cuisineMatches = 0;
    for (const m of members) {
      if ((m.cuisinePrefs ?? []).some(c => venueCuisines.has(normalizeTag(c)))) {
        cuisineMatches++;
      }
    }
    if (cuisineMatches >= 2) score += 12;
    else if (cuisineMatches === 1) score += 6;
  }
  return Math.max(0, Math.min(100, score));
}

function computeSafetyAcousticsScore(venue: VenueRecord, isNight: boolean): number {
  const safetyPts = Math.max(0, Math.min(10, venue.safetyScore ?? 8)) * 5;
  const acousticPts =
    venue.liveMusicAtNight && isNight
      ? 10
      : venue.noiseLevel === "conversational"
        ? 50
        : venue.noiseLevel === "quiet"
          ? 45
          : venue.noiseLevel === "lively"
            ? 30
            : 10;
  return Math.max(0, Math.min(100, safetyPts + acousticPts));
}

/**
 * Check whether a venue is open at `startMs` in timezone `tz` with at least `bufferMin` remaining
 * before closing. Handles past-midnight slots (`closeMin > 1440`) cleanly.
 */
export function isVenueOpenAt(venue: VenueRecord, tz: string, startMs: number, bufferMin: number): VenueOpenCheck {
  const parts = localParts(startMs, tz);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const prevWeekday = (parts.weekday + 6) % 7;

  let bestRemaining = -1;
  for (const slot of venue.hours) {
    if (slot.weekday === parts.weekday) {
      if (minuteOfDay >= slot.openMin && minuteOfDay < slot.closeMin) {
        const rem = slot.closeMin - minuteOfDay;
        if (rem > bestRemaining) bestRemaining = rem;
      }
    } else if (slot.weekday === prevWeekday && slot.closeMin > 1440) {
      const shifted = minuteOfDay + 1440;
      if (shifted >= slot.openMin && shifted < slot.closeMin) {
        const rem = slot.closeMin - shifted;
        if (rem > bestRemaining) bestRemaining = rem;
      }
    }
  }
  const remainingMinutes = bestRemaining < 0 ? 0 : bestRemaining;
  return { open: bestRemaining >= bufferMin, remainingMinutes };
}

/** Compute a 0..100 Bayesian Beta mean taste score for the venue across member archetypes. */
export function computeVenuePersonaScore(venue: VenueRecord, archetypes: string[]): number {
  const keys = archetypes.filter(Boolean);
  const fallback = venue.personaPriors.default ?? {
    alpha: Math.max(2, Math.round((venue.yelpRating ?? 4.2) * 2)),
    beta: 2,
  };
  if (keys.length === 0) {
    return Math.round((fallback.alpha / (fallback.alpha + fallback.beta)) * 100);
  }
  let sum = 0;
  for (const k of keys) {
    const prior = venue.personaPriors[k] ?? fallback;
    sum += (prior.alpha / (prior.alpha + prior.beta)) * 100;
  }
  return Math.round(sum / keys.length);
}

/**
 * Filter and rank venues for a solo, 1-on-1 date, or 3+ group meetup.
 * Every hard eligibility, teen all-ages, and red-line invariant delegates to generated
 * `venueHardEligible` and `venueRedLinesEligible`; ranking delegates to `modeVenueScore`.
 */
export function rankVenuesForMatch(
  venues: VenueRecord[],
  request: VenueRankRequest,
  nowMs: number
): VenueCandidateResult[] {
  const citySpec = getCity(request.city);
  const tz = citySpec?.tz ?? (CITY_TZ as Record<string, string>)[request.city] ?? "America/New_York";
  const groupSize = Math.max(1, request.members.length);
  const requiredBuffer = groupSize >= 3 ? 120 : 90;
  const startParts = localParts(request.startMs, tz);
  const isNight = startParts.hour >= 19 || startParts.hour < 5;
  const isAfterDark = startParts.hour >= 19 || startParts.hour < 7;
  const isWeekend = request.isWeekendOrHoliday ?? (startParts.weekday >= 5);
  const badWeatherOrAfterDark = request.badWeatherOrAfterDark ?? isAfterDark;
  const isFirstMeet = request.isFirstMeet ?? (request.mode === "date");
  const hasReservation = request.hasReservation ?? false;
  const teenFriendAllowed = request.teenFriendAllowed ?? false;
  const scoreMode = request.app === "friends" || (request.app === undefined && request.mode === "group") ? "friends" : "slop";

  const minParticipantAge =
    request.members.length > 0 ? Math.min(...request.members.map(m => m.age)) : 0;
  const anyNonDrinker = request.members.some(m => !m.drinksAlcohol);
  const anyStrictSober = request.members.some(m => m.strictSober === true);
  const anyVegetarian = request.members.some(m => m.vegetarian);
  const anyVegan = request.members.some(m => m.vegan);
  const anyHalal = request.members.some(m => m.halal === true);
  const anyKosher = request.members.some(m => m.kosher === true);
  const anyGlutenFree = request.members.some(m => m.glutenFree === true);
  const anySevereAllergen = request.members.some(m => m.severeAllergen === true);
  const anyWheelchairNeeded = request.members.some(m => m.wheelchairNeeded);
  const anySmokeFree = request.members.some(m => m.smokeFree === true);
  const anyLowNoise = request.members.some(m => m.lowNoiseRequired === true);
  const anyDaytimeOnly = request.members.some(m => m.daytimeOnly === true);
  const bothOptedIntoActivityDates =
    request.members.length >= 2 && request.members.every(m => m.optedIntoActivityDates === true);

  const maxBudgetTier =
    request.members.length > 0 ? Math.min(...request.members.map(m => m.maxBudgetTier)) : 2;
  const defaultLimit =
    request.overrideTravelLimitMin ??
    (request.mode === "group" ? citySpec?.groupMaxMinutes ?? 35 : citySpec?.dateMaxMinutes ?? 25);
  const memberMaxTravel = request.members
    .map(m => m.maxTravelMinutes)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const travelLimitMin =
    memberMaxTravel.length > 0 ? Math.min(defaultLimit, ...memberMaxTravel) : defaultLimit;

  const visitedSet = new Set<string>();
  const rejectedSet = new Set<string>();
  const archetypes: string[] = [];
  for (const m of request.members) {
    for (const id of m.visitedVenueIds) visitedSet.add(id);
    for (const id of m.rejectedVenueIds) rejectedSet.add(id);
    if (m.archetype) archetypes.push(m.archetype);
  }

  const midpoint =
    request.memberAreas.length > 0
      ? chooseFairMidpoint(request.city, request.memberAreas, request.mode === "group" ? "group" : "date")
      : undefined;

  const ranked: VenueCandidateResult[] = [];
  for (const venue of venues) {
    if (venue.city !== request.city) continue;

    const travelTimes =
      request.memberAreas.length > 0
        ? request.memberAreas.map(area => estimateTravelMinutes(request.city, area, venue.neighborhood))
        : [5];
    const maxTravelMin = Math.max(...travelTimes);
    const meanTravelMin = Math.round(travelTimes.reduce((s, x) => s + x, 0) / travelTimes.length);
    if (!isWithinTravelLimit(maxTravelMin, travelLimitMin)) continue;

    const openCheck = isVenueOpenAt(venue, tz, request.startMs, requiredBuffer);
    const eligible = venueHardEligible({
      isPublic: venue.public === true,
      venueStatus: venue.status,
      minParticipantAge,
      venueAgeMin: venue.ageMin ?? 0,
      venueAllAges: isVenueAllAges(venue),
      teenFriendAllowed,
      anyNonDrinker,
      isBarOnly: venue.isBarOnly,
      alcoholOptional: venue.alcoholOptional,
      anyVegetarian,
      servesVegetarian: venue.servesVegetarian,
      anyVegan,
      servesVegan: venue.servesVegan,
      anyWheelchairNeeded,
      wheelchairAccessible: venue.wheelchairAccessible,
      anyVisited: visitedSet.has(venue.id),
      anyRejected: rejectedSet.has(venue.id),
      priceTier: venue.priceTier,
      maxBudgetTier,
      maxTravelMin,
      travelLimitMin,
      verifiedOpen: openCheck.open,
      openBufferMin: openCheck.remainingMinutes,
      groupSize,
      reservationRequired: venue.reservationRequired,
      separateChecks: venue.separateChecks,
      walkInCapacity: venue.walkInGroupCapacity,
      isNightLiveMusic: venue.liveMusicAtNight && isNight,
      isOutdoorOnly: venue.outdoor && !venue.indoor,
      badWeatherOrAfterDark,
    });
    if (!eligible) continue;

    const openEventEligible = (request.openEvent ?? groupSize > 6) ? venue.openEventEligible === true : false;
    const redLinesOk = venueRedLinesEligible({
      anyStrictSober,
      anyNonDrinker,
      isAlcoholCentric: isVenueAlcoholCentric(venue),
      isBarOnly: venue.isBarOnly,
      alcoholOptional: venue.alcoholOptional,
      anyHalal,
      halalFriendly: venue.halalFriendly === true,
      anyKosher,
      kosherFriendly: venue.kosherFriendly === true,
      anyGlutenFree,
      glutenFreeFriendly: venue.glutenFreeFriendly === true,
      anySevereAllergen,
      severeAllergenSafe: venue.severeAllergenSafe === true,
      anySmokeFree,
      isSmokeFree: venue.isSmokeFree === true,
      anyLowNoise,
      noiseTier: noiseLevelToTier(venue.noiseLevel),
      anyDaytimeOnly,
      isAfterDark,
      isFirstMeet,
      safetyScore: venue.safetyScore ?? 8,
      transitScore: venue.transitScore ?? 4,
      startLocalHour: startParts.hour,
      groupSize,
      hasReservation,
      openEventEligible,
      concurrentHeadcount: request.concurrentHeadcountByVenue?.[venue.id] ?? 0,
      walkInCapacity: venue.walkInGroupCapacity,
    });
    if (!redLinesOk) continue;

    const rubricScore = groupVenueRubricScore({
      separateChecks: venue.separateChecks,
      walkInCapacity: venue.walkInGroupCapacity,
      noiseLevel: venue.noiseLevel,
      liveMusicAtNight: venue.liveMusicAtNight && isNight,
      alcoholOptional: venue.alcoholOptional,
      servesVegetarian: venue.servesVegetarian,
      servesVegan: venue.servesVegan,
      safetyScore: venue.safetyScore ?? 8,
      indoor: venue.indoor,
      weatherSensitive: venue.weatherSensitive,
      hasArrivalLandmark: venue.arrivalLandmark.trim().length > 0,
      transitScore: venue.transitScore ?? 4,
    });
    const budgetFitScore = venueBudgetFitScore(venue.priceTier, maxBudgetTier);
    const personaScore = computeVenuePersonaScore(venue, archetypes);
    const ageHours = Math.floor((nowMs - venue.lastVerifiedAt) / HOUR);
    const needsOpenCheck = needsPreRecommendOpenCheck(ageHours, isWeekend);
    const travelCost = fairMidpointCostScaled(maxTravelMin, meanTravelMin);
    const travelScore = Math.max(0, 100 - Math.round(travelCost / 5));
    const midpointBonus = midpoint && midpoint.neighborhood.name === venue.neighborhood ? 6 : 0;

    const activity = computeActivityFitScore(venue, request.members, request.targetHobbies);
    const dateVibeFit = computeDateVibeScore(venue, request.members);
    const safetyAcoustics = computeSafetyAcousticsScore(venue, isNight);
    const nicheHobbyBonus = activity.bothShareHighHobbyAffinity ? 15 : 0;

    const score = modeVenueScore({
      scoreMode,
      activityFit: activity.activityFit,
      groupRubric: rubricScore,
      dateVibeFit,
      personaScore,
      travelScore,
      budgetFit: budgetFitScore,
      safetyAcoustics,
      bothShareHighHobbyAffinity: activity.bothShareHighHobbyAffinity,
      bothOptedIntoActivityDates,
      nicheHobbyBonus,
      midpointBonus,
    });

    ranked.push({
      venue,
      score,
      rubricScore,
      budgetFitScore,
      personaScore,
      maxTravelMinutes: maxTravelMin,
      meanTravelMinutes: meanTravelMin,
      needsOpenCheck,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.maxTravelMinutes - b.maxTravelMinutes || a.venue.id.localeCompare(b.venue.id));
  return ranked;
}

function selectNearbyBackup(
  primary: VenueCandidateResult | undefined,
  rest: VenueCandidateResult[]
): VenueCandidateResult | undefined {
  if (!primary || rest.length === 0) return undefined;
  const nearbyBackup = rest.find(
    c => km(primary.venue, c.venue) <= 0.8 || c.venue.neighborhood === primary.venue.neighborhood
  );
  return nearbyBackup ?? rest[0];
}

/**
 * Pick the top primary venue and a pre-verified backup venue (preferring within ~0.8 km / same neighborhood),
 * plus report whether external venue discovery is needed (< 10 qualified local matches).
 */
export function pickPrimaryAndBackupVenue(
  venues: VenueRecord[],
  request: VenueRankRequest,
  nowMs: number
): PrimaryBackupVenuePick {
  const candidates = rankVenuesForMatch(venues, request, nowMs);
  const shouldFetchExternal = shouldFetchExternalVenues(candidates.length);
  if (candidates.length === 0) {
    return { candidates, shouldFetchExternal };
  }
  const primary = candidates[0]!;
  const backup = selectNearbyBackup(primary, candidates.slice(1));
  return { primary, backup, candidates, shouldFetchExternal };
}

/** Initialize a bounded Top-1 venue suggestion flow (propose 1 crisp pick, pre-compute backup). */
export function proposeTopOne(
  venues: VenueRecord[],
  request: VenueRankRequest,
  nowMs: number
): TopOneSuggestionState {
  const pick = pickPrimaryAndBackupVenue(venues, request, nowMs);
  const visitedIds = [...new Set(request.members.flatMap(m => m.visitedVenueIds))];
  const rejectedIds = [...new Set(request.members.flatMap(m => m.rejectedVenueIds))];
  const action = nextSuggestionAction(0, pick.candidates.length) as SuggestionAction;
  return {
    candidates: pick.candidates,
    current: action === "propose_next" ? pick.primary : undefined,
    backup: action === "propose_next" ? pick.backup : undefined,
    rejectedIds,
    visitedIds,
    pivotsUsed: 0,
    action,
  };
}

/**
 * Record rejection of the current top-1 pick and pivot orthogonally along the stated reason,
 * strictly bounded by proved `canPivotSuggestion` and `nextSuggestionAction` (MAX_SUGGESTION_PIVOTS = 3).
 */
export function rejectAndPivot(
  state: TopOneSuggestionState,
  reason: VenueRejectionReason,
  opts: PivotFilterOptions = {}
): TopOneSuggestionState {
  const rejectedSet = new Set(state.rejectedIds);
  const visitedSet = new Set(state.visitedIds);
  const rejectedVenue = state.current?.venue;
  if (rejectedVenue) rejectedSet.add(rejectedVenue.id);

  const nextPivots = state.pivotsUsed + 1;
  const eligiblePool = state.candidates.filter(c => {
    if (!canPivotSuggestion(state.pivotsUsed, rejectedSet.has(c.venue.id), visitedSet.has(c.venue.id))) {
      return false;
    }
    if (opts.excludeCategories && opts.excludeCategories.includes(c.venue.category)) return false;
    if (typeof opts.maxTravelMinutes === "number" && c.maxTravelMinutes > opts.maxTravelMinutes) return false;
    if (typeof opts.maxPriceTier === "number" && c.venue.priceTier > opts.maxPriceTier) return false;
    if (opts.requireNoAlcohol && (isVenueAlcoholCentric(c.venue) || c.venue.isBarOnly)) return false;
    if (opts.requireLowNoise && noiseLevelToTier(c.venue.noiseLevel) > 1) return false;
    return true;
  });

  let ordered = [...eligiblePool];
  if (reason === "wrong_vibe" && rejectedVenue) {
    const orthogonal = ordered.filter(c => c.venue.category !== rejectedVenue.category);
    if (orthogonal.length > 0) ordered = orthogonal;
  } else if (reason === "too_far") {
    ordered.sort((a, b) => a.maxTravelMinutes - b.maxTravelMinutes || b.score - a.score);
  } else if (reason === "price") {
    ordered.sort((a, b) => a.venue.priceTier - b.venue.priceTier || b.score - a.score);
  }

  const action = nextSuggestionAction(nextPivots, ordered.length) as SuggestionAction;
  const nextCurrent = action === "propose_next" ? ordered[0] : undefined;
  const nextBackup = nextCurrent ? selectNearbyBackup(nextCurrent, ordered.slice(1)) : undefined;

  return {
    candidates: ordered,
    current: nextCurrent,
    backup: nextBackup,
    rejectedIds: [...rejectedSet],
    visitedIds: [...visitedSet],
    pivotsUsed: nextPivots,
    action,
    lastReason: reason,
  };
}

function sanitizeCopySnippet(text: string): string {
  return text.replace(/_/g, " ").replace(/\?/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Render concise member-facing copy for the Top-1 suggestion / pivot loop.
 * Obeys copy.ts style rules: <= 360 chars, at most 1 `?`, no raw tags,
 * no contact details, never asks to reply "cancel", never leaks red lines or who declined.
 */
export function buildTopOneCopy(opts: TopOneCopyOptions): string {
  const { state, mode } = opts;
  const when = sanitizeCopySnippet(opts.whenLabel);
  const partner = opts.partnerFirstName ? sanitizeCopySnippet(opts.partnerFirstName) : undefined;
  const why = opts.why ? sanitizeCopySnippet(opts.why) : undefined;

  if (state.action === "ask_user_spot_or_pause" || !state.current) {
    return "Looks like my picks aren't hitting the mark. Want to name a public spot you like nearby, or try again next week?";
  }

  const v = state.current.venue;
  const name = sanitizeCopySnippet(v.name);
  const hood = sanitizeCopySnippet(v.neighborhood);
  const reasonTail = why ? ` (${why})` : "";

  let text: string;
  if (state.pivotsUsed === 0) {
    if (mode === "date" && partner) {
      text = `You're both in: meet ${partner} ${when} at ${name} in ${hood}${reasonTail}. Works for you, or want to swap the vibe or area?`;
    } else if (mode === "group") {
      text = `I picked ${name} in ${hood} for ${when}${reasonTail}. Works for you, or want to swap the spot?`;
    } else {
      text = `Top spot for ${when}: ${name} in ${hood}${reasonTail}. Works for you, or want another idea?`;
    }
  } else if (state.pivotsUsed >= MAX_SUGGESTION_PIVOTS - 1) {
    text = `Got it. How about ${name} in ${hood} for ${when}${reasonTail}, or is there a neighborhood you'd rather stick to?`;
  } else {
    text = `Fair call. How about ${name} in ${hood} for ${when}${reasonTail} instead?`;
  }

  if (text.length <= 360) return text;
  const fallback = `How about ${name} in ${hood} for ${when}?`;
  return fallback.length <= 360 ? fallback : `${fallback.slice(0, 356).replace(/\?+$/, "")}...?`;
}

/** Bundled Top-1 suggestion flow helper (propose -> reject/pivot -> style-safe copy). */
export const TopOneSuggestionFlow = {
  maxPivots: MAX_SUGGESTION_PIVOTS,
  proposeTopOne,
  rejectAndPivot,
  buildTopOneCopy,
} as const;

/**
 * Apply post-meetup or live arrival feedback to a VenueRecord immutably:
 * - Immediate status transition via generated `nextVenueStatusOnReport` (quarantine on closure).
 * - Bayesian Beta prior update for each participating member archetype + default prior.
 */
export function applyVenueFeedback(
  venue: VenueRecord,
  memberArchetypes: string[],
  feedback: VenueFeedbackReport,
  nowMs: number
): VenueRecord {
  const providerPermanent = feedback.providerConfirmedStatus === "closed_permanent";
  const providerTemporary = feedback.providerConfirmedStatus === "closed_temporary";
  const nextStatus = nextVenueStatusOnReport(
    venue.status,
    feedback.reportedClosed,
    venue.closureReports,
    providerPermanent,
    providerTemporary
  ) as VenueRecord["status"];

  const closureReports = feedback.reportedClosed ? venue.closureReports + 1 : venue.closureReports;
  let quarantinedUntil = venue.quarantinedUntil;
  if (nextStatus === "closed_temporary") {
    quarantinedUntil = nowMs + 30 * 24 * HOUR;
  } else if (nextStatus === "suspect_closed") {
    quarantinedUntil = nowMs + 7 * 24 * HOUR;
  }

  let dAlpha = 0;
  let dBeta = 0;
  switch (feedback.outcome) {
    case "great":
      dAlpha = 2;
      break;
    case "ok":
      dAlpha = 1;
      dBeta = 0.5;
      break;
    case "closed":
      dBeta = 3;
      break;
    case "too_loud":
    case "crowded":
    case "bad_vibe":
    case "too_expensive":
      dBeta = 2;
      break;
  }

  const nextPriors: Record<string, { alpha: number; beta: number }> = {};
  for (const [k, v] of Object.entries(venue.personaPriors)) {
    nextPriors[k] = { alpha: v.alpha, beta: v.beta };
  }
  const baseFallback = venue.personaPriors.default ?? { alpha: 4, beta: 2 };
  const targets = new Set<string>(["default", ...memberArchetypes.filter(Boolean)]);
  for (const key of targets) {
    const cur = nextPriors[key] ?? baseFallback;
    nextPriors[key] = { alpha: cur.alpha + dAlpha, beta: cur.beta + dBeta };
  }

  return {
    ...venue,
    status: nextStatus,
    closureReports,
    quarantinedUntil,
    lastVerifiedAt: feedback.providerConfirmedStatus ? nowMs : venue.lastVerifiedAt,
    personaPriors: nextPriors,
  };
}

/**
 * Compute UTC dispatch schedule for a post-event/post-date follow-up using `computeFollowupLocalHour`.
 * Daytime end <= 16:00 -> same-day end + 2h; evening end > 16:00 -> next morning 9:30 local.
 */
export function computeFollowupTimestamp(eventEndMs: number, tz: string): FollowupSchedule {
  const endParts = localParts(eventEndMs, tz);
  const slot = computeFollowupLocalHour(endParts.hour);
  const dayParts = slot.nextDay ? localParts(eventEndMs + 24 * HOUR, tz) : endParts;
  const scheduledAt = fromLocal(dayParts.year, dayParts.month, dayParts.day, slot.localHour, tz) + slot.localMinute * MINUTE;
  return {
    scheduledAt,
    localHour: slot.localHour,
    localMinute: slot.localMinute,
    nextDay: slot.nextDay,
    reminderAt: scheduledAt + 36 * HOUR,
    maxReminders: 1,
  };
}

/** Thin wrapper around generated `venueRedLinesEligible`. */
export function evaluateVenueRedLines(input: VenueRedLinesInput): boolean {
  return venueRedLinesEligible(input);
}

/** Thin wrapper around generated `canPivotSuggestion`. */
export function evaluatePivotAllowed(
  pivotsUsed: number,
  candidateAlreadyRejected: boolean,
  candidateAlreadyVisited: boolean
): boolean {
  return canPivotSuggestion(pivotsUsed, candidateAlreadyRejected, candidateAlreadyVisited);
}

/** Thin wrapper around generated `nextSuggestionAction`. */
export function evaluateNextSuggestionAction(
  pivotsUsed: number,
  remainingCandidates: number
): SuggestionAction {
  return nextSuggestionAction(pivotsUsed, remainingCandidates) as SuggestionAction;
}

/** Thin wrapper around generated `computeDensityTier`. */
export function evaluateDensityTier(appKind: "friends" | "slop" | "ntwrk", qualifiedLocalCount: number): DensityTier {
  return computeDensityTier(appKind, qualifiedLocalCount) as DensityTier;
}

/** Thin wrapper around generated `dateActivityAllowed`. */
export function evaluateDateActivityAllowed(
  activityKind: string,
  anyStrictSober: boolean,
  anyNonDrinker: boolean,
  anyLowWalking: boolean,
  anyDaytimeOnly: boolean,
  isAfterDark: boolean
): boolean {
  return dateActivityAllowed(
    activityKind,
    anyStrictSober,
    anyNonDrinker,
    anyLowWalking,
    anyDaytimeOnly,
    isAfterDark
  );
}

/** Thin wrapper around generated `slopNicheHobbyBonus`. */
export function evaluateSlopNicheHobbyBonus(
  bothShareHighHobbyAffinity: boolean,
  bothOptedIntoActivityDates: boolean,
  requestedBonus: number
): number {
  return slopNicheHobbyBonus(bothShareHighHobbyAffinity, bothOptedIntoActivityDates, requestedBonus);
}

/** Thin wrapper around generated `modeVenueScore`. */
export function evaluateModeVenueScore(input: ModeVenueScoreInput): number {
  return modeVenueScore(input);
}

/** Thin wrapper around generated `canSendFollowup`. */
export function evaluateFollowupSend(input: FollowupSendInput): boolean {
  return canSendFollowup(input);
}

/** Thin wrapper around generated `meetupPhase`. */
export function evaluateMeetupPhase(nowMs: number, startMs: number): MeetupPhase {
  const minutesFromStart = Math.floor((nowMs - startMs) / MINUTE);
  return meetupPhase(minutesFromStart) as MeetupPhase;
}

/** Backward-compatible arrival relay wrapper delegating to `canRelayArrivalSafe`. */
export function evaluateArrivalRelay(
  input: Omit<ArrivalRelayInput, "minutesFromStart"> & { nowMs: number; startMs: number }
): boolean {
  const minutesFromStart = Math.floor((input.nowMs - input.startMs) / MINUTE);
  return canRelayArrivalSafe({
    senderAge: input.senderAge,
    recipientAge: input.recipientAge,
    anyMinorInEvent: false,
    senderConfirmed: input.senderConfirmed,
    recipientConfirmed: input.recipientConfirmed,
    blocked: input.blocked,
    panicTriggered: false,
    senderOptedOut: input.senderOptedOut,
    recipientOptedOut: input.recipientOptedOut,
    minutesFromStart,
    alreadyMet: input.alreadyMet,
    passedSafetyAndLeakCheck: input.passedSafetyAndLeakCheck,
  });
}

/** Thin wrapper around generated `canRelayArrivalSafe` (panic + block + minor + leak checks). */
export function evaluateArrivalRelaySafe(
  input: Omit<ArrivalRelaySafeInput, "minutesFromStart"> & { nowMs: number; startMs: number }
): boolean {
  const minutesFromStart = Math.floor((input.nowMs - input.startMs) / MINUTE);
  return canRelayArrivalSafe({
    senderAge: input.senderAge,
    recipientAge: input.recipientAge,
    anyMinorInEvent: input.anyMinorInEvent,
    senderConfirmed: input.senderConfirmed,
    recipientConfirmed: input.recipientConfirmed,
    blocked: input.blocked,
    panicTriggered: input.panicTriggered,
    senderOptedOut: input.senderOptedOut,
    recipientOptedOut: input.recipientOptedOut,
    minutesFromStart,
    alreadyMet: input.alreadyMet,
    passedSafetyAndLeakCheck: input.passedSafetyAndLeakCheck,
  });
}

/** Thin wrapper around generated `canAttendEventOrCoattend`. */
export function evaluateEventAttendance(
  participantAge: number,
  anyMinorInGroup: boolean,
  isSoloSuggestion: boolean
): boolean {
  return canAttendEventOrCoattend(participantAge, anyMinorInGroup, isSoloSuggestion);
}

/** Thin wrapper around generated `noShowDecision`. */
export function evaluateNoShow(
  nowMs: number,
  startMs: number,
  someArrived: boolean,
  otherCheckedIn: boolean,
  pingSent: boolean,
  waitingNotified: boolean
): "none" | "ping_late" | "notify_waiting" {
  const minutesAfterStart = Math.floor((nowMs - startMs) / MINUTE);
  return noShowDecision(minutesAfterStart, someArrived, otherCheckedIn, pingSent, waitingNotified) as
    | "none"
    | "ping_late"
    | "notify_waiting";
}

/** Backward-compatible backup pivot wrapper delegating to `shouldPivotToBackupV2`. */
export function evaluateBackupPivot(
  venueReportedClosed: boolean,
  hasVerifiedBackup: boolean,
  nowMs: number,
  startMs: number,
  alreadyPivoted: boolean
): boolean {
  const minutesFromStart = Math.floor((nowMs - startMs) / MINUTE);
  return shouldPivotToBackupV2(venueReportedClosed, false, hasVerifiedBackup, minutesFromStart, alreadyPivoted);
}

/** Thin wrapper around generated `shouldPivotToBackupV2` (supports both closed and full triggers). */
export function evaluateBackupPivotV2(
  venueReportedClosed: boolean,
  venueReportedFull: boolean,
  hasVerifiedBackup: boolean,
  nowMs: number,
  startMs: number,
  alreadyPivoted: boolean
): boolean {
  const minutesFromStart = Math.floor((nowMs - startMs) / MINUTE);
  return shouldPivotToBackupV2(
    venueReportedClosed,
    venueReportedFull,
    hasVerifiedBackup,
    minutesFromStart,
    alreadyPivoted
  );
}

/** Thin wrapper around generated `shouldQuarantineVenue` (quarantines only on closed, never solely on full). */
export function evaluateVenueQuarantine(venueReportedClosed: boolean, venueReportedFull: boolean): boolean {
  return shouldQuarantineVenue(venueReportedClosed, venueReportedFull);
}

/** Thin wrapper around generated `anchorFailoverDecision`. */
export function evaluateAnchorFailover(input: AnchorFailoverInput): AnchorFailoverAction {
  return anchorFailoverDecision(input) as AnchorFailoverAction;
}
