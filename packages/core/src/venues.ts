// Thin shell for venue open-hours checks, venue ranking, primary/backup selection,
// top-1 suggestion pivot loop, Bayesian venue feedback & quarantine, post-event follow-up
// scheduling, arrival relay gates, and anchor failover.
// All pure business decisions delegate to the Vibespec-generated modules under ./generated/.

import { tryChatJson } from "./chatJson.ts";
import { HOUR, MINUTE } from "./clock.ts";
import { fenceUntrusted, UNTRUSTED_NOTE } from "./fence.ts";
import { km } from "./geo.ts";
import { LeakGuard } from "./guard.ts";
import type { LLM } from "./llm.ts";
import { cleanPhrase, formatTopOneVenueSuggestion, styleViolations } from "./smsCopy.ts";
import { cityTimezone, fromLocal, localParts } from "./time.ts";
import { ALCOHOL_CENTRIC_CATEGORIES, chooseFairMidpoint, estimateTravelMinutes, getCity } from "./cities.ts";
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
  computeFollowupLocalSlot,
  meetupPhase,
  noShowDecision,
  shouldPivotToBackupV2,
  shouldQuarantineVenue,
  type AnchorFailoverInput,
  type ArrivalRelaySafeInput,
  type FollowupSendInput,
} from "./generated/meetupCoordination.ts";
import {
  canSendFollowup as canSendFollowupLegacy,
  computeFollowupLocalHour as computeFollowupLocalHourLegacy,
  followupIsNextDay,
  maxFollowupDailyCap,
  maxFollowupReminders,
} from "./generated/encounterFollowup.ts";
import { chooseWorkIntroChannel } from "./generated/workIntroChannel.ts";
import type {
  AppId,
  CityId,
  ConnectionOntologySpecLike,
  FollowupSchedule,
  MeetingModality,
  MeetupPhase,
  MemberVenuePrefs,
  OutcomePolicyProfile,
  VenueCandidateResult,
  VenueCategory,
  VenueFeedbackReport,
  VenueNoiseLevel,
  VenueRecord,
  WorkIntroChannel,
} from "./types.ts";

export const MAX_SUGGESTION_PIVOTS = maxSuggestionPivots;
export const defaultLocalSufficiencyThreshold = 10;

export interface WorkIntroChannelInput {
  candAge: number;
  mgrAge: number;
  candOptedIn: boolean;
  mgrOptedIn: boolean;
  candHasEmail: boolean;
  mgrHasEmail: boolean;
  mutualSlotConfirmed: boolean;
  wantsVideo: boolean;
}

export interface VenueOpenCheck {
  open: boolean;
  remainingMinutes: number;
}

export interface VenueRankRequest {
  city: CityId;
  memberAreas: string[];
  members: MemberVenuePrefs[];
  startMs: number;
  mode: "date" | "group" | "solo" | "professional";
  app?: AppId;
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
  mode: "date" | "group" | "solo" | "professional";
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

const PROFESSIONAL_CATEGORIES = new Set<VenueCategory>([
  "coffee_shop",
  "tea_house",
  "cafe_tea_bar",
  "bakery_cafe",
  "bookstore_cafe",
  "coffee_casual",
  "food_hall",
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

interface HoistedActivityContext {
  memberCount: number;
  requested: ReadonlySet<string>;
  memberHobbyCounts: ReadonlyMap<string, number>;
  memberCuisineSets: readonly ReadonlySet<string>[];
}

function buildHoistedActivityContext(
  members: readonly MemberVenuePrefs[],
  targetHobbies?: readonly string[]
): HoistedActivityContext {
  const requested = new Set<string>();
  for (const h of targetHobbies ?? []) {
    const nh = normalizeTag(h);
    if (nh) requested.add(nh);
  }
  const memberHobbyCounts = new Map<string, number>();
  const memberCuisineSets: ReadonlySet<string>[] = [];

  for (const m of members) {
    const seen = new Set<string>();
    for (const h of m.hobbies ?? []) {
      const nh = normalizeTag(h);
      if (!nh || seen.has(nh)) continue;
      seen.add(nh);
      memberHobbyCounts.set(nh, (memberHobbyCounts.get(nh) ?? 0) + 1);
    }
    const cuisines = new Set<string>();
    for (const c of m.cuisinePrefs ?? []) {
      const nc = normalizeTag(c);
      if (nc) cuisines.add(nc);
    }
    if (cuisines.size > 0) memberCuisineSets.push(cuisines);
  }

  return { memberCount: members.length, requested, memberHobbyCounts, memberCuisineSets };
}

function computeActivityFitScore(
  venue: VenueRecord,
  ctx: HoistedActivityContext
): { activityFit: number; sharedHobbyHit: boolean; bothShareHighHobbyAffinity: boolean } {
  const venueHobbies = new Set((venue.hobbies ?? []).map(normalizeTag));

  let sharedHit = false;
  let anyHit = false;
  if (venueHobbies.size > 0) {
    for (const h of ctx.requested) {
      if (venueHobbies.has(h)) {
        anyHit = true;
        if (ctx.memberCount <= 1 || (ctx.memberHobbyCounts.get(h) ?? 0) >= 2) sharedHit = true;
      }
    }
    for (const [h, count] of ctx.memberHobbyCounts) {
      if (venueHobbies.has(h)) {
        anyHit = true;
        if (ctx.memberCount >= 2 && count >= 2) sharedHit = true;
      }
    }
  }

  if (sharedHit) return { activityFit: 95, sharedHobbyHit: true, bothShareHighHobbyAffinity: ctx.memberCount >= 2 };
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

function computeDateVibeScore(venue: VenueRecord, ctx: HoistedActivityContext, isProfessional: boolean): number {
  let score = isProfessional
    ? (PROFESSIONAL_CATEGORIES.has(venue.category) ? 86 : 62)
    : CLASSIC_DATE_CATEGORIES.has(venue.category)
      ? 80
      : venue.category === "food_hall"
        ? 72
        : venue.isBarOnly
          ? 64
          : 62;
  if (venue.noiseLevel === "quiet") score += isProfessional ? 12 : 8;
  else if (venue.noiseLevel === "conversational") score += 8;
  else if (venue.noiseLevel === "loud") score -= 15;

  const venueCuisines = venue.cuisineTags?.length ? new Set(venue.cuisineTags.map(normalizeTag)) : undefined;
  if (venueCuisines && ctx.memberCuisineSets.length > 0) {
    let cuisineMatches = 0;
    for (const memberCuisines of ctx.memberCuisineSets) {
      for (const c of memberCuisines) {
        if (venueCuisines.has(c)) {
          cuisineMatches++;
          break;
        }
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
 * Filter and rank venues for a solo, 1-on-1 date, professional coffee, or 3+ group meetup.
 * Every hard eligibility, teen all-ages, and red-line invariant delegates to generated
 * `venueHardEligible` and `venueRedLinesEligible`; ranking delegates to `modeVenueScore`.
 */
export function rankVenuesForMatch(
  venues: readonly VenueRecord[],
  request: VenueRankRequest,
  nowMs: number
): VenueCandidateResult[] {
  const cityKey = request.city.trim().toLowerCase();
  const citySpec = getCity(cityKey);
  const tz = cityTimezone(cityKey) ?? citySpec?.tz ?? "America/New_York";
  const groupSize = Math.max(1, request.members.length);
  const requiredBuffer = groupSize >= 3 ? 120 : 90;
  const startParts = localParts(request.startMs, tz);
  const isNight = startParts.hour >= 19 || startParts.hour < 5;
  const isAfterDark = startParts.hour >= 19 || startParts.hour < 7;
  const isWeekend = request.isWeekendOrHoliday ?? (startParts.weekday >= 5);
  const badWeatherOrAfterDark = request.badWeatherOrAfterDark ?? isAfterDark;
  const isProfessional = request.mode === "professional" || request.app === "peon";
  const isFirstMeet = request.isFirstMeet ?? (request.mode === "date" || isProfessional);
  const hasReservation = request.hasReservation ?? false;
  const teenFriendAllowed = isProfessional ? false : (request.teenFriendAllowed ?? false);
  const scoreMode = request.app === "friends" || (request.app === undefined && request.mode === "group") ? "friends" : "slop";

  const minParticipantAge =
    request.members.length > 0 ? Math.min(...request.members.map(m => m.age)) : 0;
  const anyNonDrinker = isProfessional || request.members.some(m => !m.drinksAlcohol);
  const anyStrictSober = isProfessional || request.members.some(m => m.strictSober === true);
  const anyVegetarian = request.members.some(m => m.vegetarian);
  const anyVegan = request.members.some(m => m.vegan);
  const anyHalal = request.members.some(m => m.halal === true);
  const anyKosher = request.members.some(m => m.kosher === true);
  const anyGlutenFree = request.members.some(m => m.glutenFree === true);
  const anySevereAllergen = request.members.some(m => m.severeAllergen === true);
  const anyWheelchairNeeded = request.members.some(m => m.wheelchairNeeded);
  const anySmokeFree = isProfessional || request.members.some(m => m.smokeFree === true);
  const anyLowNoise = isProfessional || request.members.some(m => m.lowNoiseRequired === true);
  const anyDaytimeOnly = isProfessional || request.members.some(m => m.daytimeOnly === true);
  const bothOptedIntoActivityDates =
    !isProfessional && request.members.length >= 2 && request.members.every(m => m.optedIntoActivityDates === true);

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

  const activityCtx = buildHoistedActivityContext(request.members, request.targetHobbies);
  const midpoint =
    request.memberAreas.length > 0
      ? chooseFairMidpoint(cityKey, request.memberAreas, request.mode === "group" ? "group" : "date")
      : undefined;

  const ranked: VenueCandidateResult[] = [];
  for (const venue of venues) {
    if (venue.city.trim().toLowerCase() !== cityKey) continue;

    const travelTimes =
      request.memberAreas.length > 0
        ? request.memberAreas.map(area => estimateTravelMinutes(cityKey, area, venue.neighborhood))
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
      hasReservation,
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

    const activity = computeActivityFitScore(venue, activityCtx);
    const dateVibeFit = computeDateVibeScore(venue, activityCtx, isProfessional);
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
  venues: readonly VenueRecord[],
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
  venues: readonly VenueRecord[],
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
  if (!state.current || state.action === "ask_user_spot_or_pause") {
    return {
      ...state,
      current: undefined,
      backup: undefined,
      action: "ask_user_spot_or_pause",
      lastReason: reason,
    };
  }

  const rejectedSet = new Set(state.rejectedIds);
  const visitedSet = new Set(state.visitedIds);
  const rejectedVenue = state.current.venue;
  rejectedSet.add(rejectedVenue.id);

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
  if (reason === "wrong_vibe") {
    const orthogonal = ordered.filter(c => c.venue.category !== rejectedVenue.category);
    const sameCategory = ordered.filter(c => c.venue.category === rejectedVenue.category);
    ordered = [...orthogonal, ...sameCategory];
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

/**
 * Render concise member-facing copy for the Top-1 suggestion / pivot loop.
 * Delegates to the single canonical formatter in smsCopy.ts.
 */
export function buildTopOneCopy(opts: TopOneCopyOptions): string {
  const { state, mode } = opts;
  if (state.action === "ask_user_spot_or_pause" || !state.current) {
    return formatTopOneVenueSuggestion("", "", opts.whenLabel, { exhausted: true });
  }
  const v = state.current.venue;
  return formatTopOneVenueSuggestion(v.name, v.neighborhood, opts.whenLabel, {
    partner: opts.partnerFirstName,
    why: opts.why,
    pivot: state.pivotsUsed,
    mode,
    maxPivots: MAX_SUGGESTION_PIVOTS,
  });
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
  const providerPermanent =
    feedback.providerConfirmedStatus === "closed_permanent" || feedback.providerCode === "ProviderPermanentClosed";
  const providerTemporary =
    feedback.providerConfirmedStatus === "closed_temporary" || feedback.providerCode === "ProviderTemporaryClosed";
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
    lastVerifiedAt: feedback.providerConfirmedStatus || feedback.providerCode ? nowMs : venue.lastVerifiedAt,
    personaPriors: nextPriors,
  };
}

function clampTimestampToSafeLocalHours(ts: number, tz: string): number {
  const parts = localParts(ts, tz);
  if (parts.hour >= 9 && parts.hour < 20) return ts;
  if (parts.hour < 9) {
    return fromLocal(parts.year, parts.month, parts.day, 9.5, tz);
  }
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return fromLocal(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 9.5, tz);
}

/**
 * Compute UTC dispatch schedule for a post-event/post-date follow-up using `computeFollowupLocalSlot`.
 * Daytime end <= 16:59 -> same-day end + 2h preserving minutes; evening end > 16:59 -> next calendar day 09:30 local (DST-safe).
 * Reminders (+36h) are always clamped into local safe hours [9, 20).
 */
export function computeFollowupTimestamp(eventEndMs: number, tz: string, isWorkIntro = false): FollowupSchedule {
  const endParts = localParts(eventEndMs, tz);
  if (isWorkIntro) {
    const localHour = computeFollowupLocalHourLegacy(endParts.hour, true);
    const nextDay = endParts.hour >= localHour;
    const dayParts = nextDay ? localParts(eventEndMs + 24 * HOUR, tz) : endParts;
    const scheduledAt = fromLocal(dayParts.year, dayParts.month, dayParts.day, localHour, tz);
    return {
      scheduledAt,
      localHour,
      localMinute: 0,
      nextDay,
      reminderAt: scheduledAt + 36 * HOUR,
      maxReminders: maxFollowupReminders,
    };
  }
  const slot = computeFollowupLocalSlot(endParts.hour, endParts.minute);
  let targetYear = endParts.year;
  let targetMonth = endParts.month;
  let targetDay = endParts.day;
  if (slot.nextDay) {
    const nextCal = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day + 1));
    targetYear = nextCal.getUTCFullYear();
    targetMonth = nextCal.getUTCMonth() + 1;
    targetDay = nextCal.getUTCDate();
  }
  const scheduledAt = fromLocal(targetYear, targetMonth, targetDay, slot.localHour + slot.localMinute / 60, tz);
  const reminderAt = clampTimestampToSafeLocalHours(scheduledAt + 36 * HOUR, tz);
  return {
    scheduledAt,
    localHour: slot.localHour,
    localMinute: slot.localMinute,
    nextDay: slot.nextDay,
    reminderAt,
    maxReminders: maxFollowupReminders,
  };
}

const APPEARANCE_LANGUAGE_RE =
  /\b(?:attractive(?:ness)?|unattractive|good[- ]looking|cute|pretty|handsome|beautiful|gorgeous|sexy|appearance|body[- ]?type|clef|photo rating|out of your league|in your league|slim|athletic|curvy|plus[- ]size[d]?|heavyset|overweight|skinny|petite|chubby|top\s+\d+\s*%|\d+(?:st|nd|rd|th)\s+percentile)\b/i;

export interface VenueLLMRerankOptions {
  llm?: LLM;
  candidates: readonly VenueCandidateResult[];
  shareableInterests?: readonly string[];
  mode: "date" | "group" | "solo" | "professional";
  forbiddenFacts?: readonly string[];
  extraLeakCheck?: (text: string) => string | null;
  deadlineMs?: number;
  maxTokens?: number;
}

export interface VenueLLMRerankResult {
  picked?: VenueCandidateResult;
  why?: string;
  usedLLM: boolean;
  fallbackReason?: string;
}

const VENUE_RERANK_SYSTEM = [
  "You select ONE best public venue from a pre-verified Top-5 list and write one short, warm rationale.",
  UNTRUSTED_NOTE,
  "Never invent a venue ID outside the provided list. Never mention private constraints, health, sobriety, diet, appearance, looks, or contact details.",
  'Reply with JSON ONLY using keys in this EXACT order: {"reasoning":"short explanation","picked_id":"exact id from list","why":"<=90 chars, no question mark, natural phrasing"}.',
].join("\n");

/**
 * Stage 2 bounded Top-5 verified-ID LLM rerank/rationale helper.
 * Structurally impossible to hallucinate venue IDs; enforces reasoning-first, fenceUntrusted, LeakGuard,
 * appearance-language guard, and styleViolations; fails open cleanly to deterministic candidates[0].
 */
export async function rerankTopVenuesWithLLM(opts: VenueLLMRerankOptions): Promise<VenueLLMRerankResult> {
  const top5 = opts.candidates.slice(0, 5);
  if (top5.length === 0) return { usedLLM: false, fallbackReason: "empty_candidates" };
  const deterministicPick = top5[0]!;
  if (!opts.llm) return { picked: deterministicPick, usedLLM: false, fallbackReason: "no_llm" };

  const byId = new Map<string, VenueCandidateResult>(top5.map(c => [c.venue.id, c]));
  const compactCandidates = top5.map(c => ({
    id: c.venue.id,
    name: c.venue.name,
    category: c.venue.category,
    neighborhood: c.venue.neighborhood,
    noiseLevel: c.venue.noiseLevel,
    priceTier: c.venue.priceTier,
    hobbies: (c.venue.hobbies ?? []).slice(0, 4),
    score: c.score,
  }));
  const shareableInterests = (opts.shareableInterests ?? [])
    .map(cleanPhrase)
    .filter(Boolean)
    .slice(0, 8);
  const payload = JSON.stringify({
    mode: opts.mode,
    shareableInterests,
    candidates: compactCandidates,
  });

  const guard = new LeakGuard({
    forbidden: opts.forbiddenFacts ? [...opts.forbiddenFacts] : undefined,
    contacts: true,
  });

  const res = await tryChatJson<{ pickedId: string; why: string }>(
    opts.llm,
    [
      { role: "system", content: VENUE_RERANK_SYSTEM },
      { role: "user", content: fenceUntrusted(payload, "venue_candidates") },
    ],
    raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("expected object");
      }
      const obj = raw as Record<string, unknown>;
      const keys = Object.keys(obj);
      const rIdx = keys.indexOf("reasoning");
      const pIdx = keys.indexOf("picked_id");
      if (rIdx < 0 || pIdx < 0 || rIdx > pIdx) {
        throw new Error("reasoning_must_precede_picked_id");
      }
      if (typeof obj.reasoning !== "string" || !obj.reasoning.trim()) {
        throw new Error("missing_reasoning");
      }
      if (typeof obj.picked_id !== "string" || !byId.has(obj.picked_id)) {
        throw new Error("invalid_venue_id");
      }
      if (typeof obj.why !== "string") {
        throw new Error("missing_why");
      }
      const why = cleanPhrase(obj.why);
      if (!why || why.length > 90) {
        throw new Error("invalid_why_length");
      }
      if (APPEARANCE_LANGUAGE_RE.test(why) || opts.extraLeakCheck?.(why)) {
        throw new Error("appearance_leak");
      }
      if (guard.check(why).length > 0 || styleViolations(why).length > 0) {
        throw new Error("why_failed_guard");
      }
      return { pickedId: obj.picked_id, why };
    },
    {
      attempts: 1,
      maxTokens: opts.maxTokens ?? 450,
      deadlineMs: opts.deadlineMs ?? 8_000,
    }
  );

  if (!res.ok) {
    return {
      picked: deterministicPick,
      usedLLM: false,
      fallbackReason: res.error instanceof Error ? res.error.message : "llm_rerank_failed",
    };
  }
  return {
    picked: byId.get(res.value.pickedId) ?? deterministicPick,
    why: res.value.why,
    usedLLM: true,
  };
}

const ASYNC_OR_VIDEO_PEON_ONTOLOGIES = new Set([
  "work_hiring",
  "step_ahead_mentorship",
  "patronage_sponsorship",
]);

const SANCTIONED_EVENT_ONTOLOGIES = new Set([
  "event_travel_companion",
  "intellectual_salon",
  "civic_action_coalition",
]);

/**
 * Pure mapper from `(app, ConnectionOntologySpec)` to `OutcomePolicyProfile`.
 * Preserves `teenFriendAgeRule` (13-17 ONLY on friends or ntwrk:friendship, size 2..6, zero external events/slop/peon)
 * and `crossAppScoreFirewall` (slop aesthetic/external prospects strictly isolated from peon/friends/ntwrk).
 */
export function mapOntologyToOutcomePolicy(
  app: AppId,
  spec: ConnectionOntologySpecLike,
  opts: { hasMinor?: boolean } = {}
): OutcomePolicyProfile {
  const isPeon = app === "peon";
  const isSlop = app === "slop";
  const isFriends = app === "friends";
  const teenFriendEligible = isFriends || (app === "ntwrk" && spec.id === "friendship");
  const hasMinor = opts.hasMinor === true;

  const venueMode: OutcomePolicyProfile["venueMode"] = isPeon || spec.defaultCategory === "professional"
    ? "professional"
    : isSlop || spec.id === "dating"
      ? "date"
      : spec.defaultFormat === "small_group" || spec.sizeRange[1] >= 3
        ? "group"
        : spec.sizeRange[1] <= 1
          ? "solo"
          : "date";

  let modality: MeetingModality;
  if (isPeon && ASYNC_OR_VIDEO_PEON_ONTOLOGIES.has(spec.id)) {
    modality = "async_or_video";
  } else if (!hasMinor && !isSlop && (spec.defaultFormat === "event" || SANCTIONED_EVENT_ONTOLOGIES.has(spec.id))) {
    modality = "sanctioned_event";
  } else {
    modality = "irl_venue";
  }

  const maxGroupSize = teenFriendEligible && hasMinor
    ? Math.min(6, Math.max(2, spec.sizeRange[1]))
    : Math.max(1, spec.sizeRange[1]);

  return {
    app,
    ontologyId: spec.id,
    modality,
    venueMode,
    adultOnly: !teenFriendEligible,
    teenFriendEligible,
    minGroupSize: Math.max(1, spec.sizeRange[0]),
    maxGroupSize,
    ...(spec.defaultFreeAnchor ? { maxBudgetTier: 0 as const } : {}),
    lowNoiseRequired: spec.requiresHighDiscretion || venueMode === "professional",
    daytimeOnly: venueMode === "professional",
    alcoholExcluded: venueMode === "professional" || spec.id === "habit_accountability" || (teenFriendEligible && hasMinor),
    aestheticReadAllowed: isSlop,
    peonCapitalAllowed: isPeon,
    externalProspectReadAllowed: isSlop,
    externalEventsAllowed: !isSlop && !hasMinor,
    followupCadence: isPeon ? "work_48h_90d" : "next_day_local",
    firewallScope: app,
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
  anyLowNoise: boolean,
  anyDaytimeOnly: boolean,
  isAfterDark: boolean
): boolean {
  return dateActivityAllowed(
    activityKind,
    anyStrictSober,
    anyNonDrinker,
    anyLowWalking,
    anyLowNoise,
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

export type FollowupSendCompatInput =
  | FollowupSendInput
  | {
      optedOut: boolean;
      isQuietHours: boolean;
      dailyProactiveCount: number;
      dailyCap?: number;
      remindersSent: number;
      maxReminders?: number;
    };

/** Thin wrapper around generated `canSendFollowup` (supports both meetupCoordination and encounterFollowup callers). */
export function evaluateFollowupSend(input: FollowupSendCompatInput): boolean {
  if ("isQuietHours" in input) {
    return canSendFollowupLegacy(
      input.optedOut,
      input.isQuietHours,
      input.dailyProactiveCount,
      input.dailyCap ?? maxFollowupDailyCap,
      input.remindersSent,
      input.maxReminders ?? maxFollowupReminders
    );
  }
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

/** Thin wrapper around generated `chooseWorkIntroChannel`. */
export function selectWorkIntroChannel(input: WorkIntroChannelInput): WorkIntroChannel {
  return chooseWorkIntroChannel(
    input.candAge,
    input.mgrAge,
    input.candOptedIn,
    input.mgrOptedIn,
    input.candHasEmail,
    input.mgrHasEmail,
    input.mutualSlotConfirmed,
    input.wantsVideo
  );
}
