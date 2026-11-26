import { HOUR, MINUTE } from "./clock.ts";
import { km } from "./geo.ts";
import { CITY_TZ, fromLocal, localParts } from "./time.ts";
import { chooseFairMidpoint, estimateTravelMinutes, getCity } from "./cities.ts";
import { fairMidpointCostScaled, isWithinTravelLimit } from "./generated/cityTravel.ts";
import {
  defaultLocalSufficiencyThreshold,
  groupOpenBufferMin,
  groupVenueRubricScore,
  impromptuGroupMinSize,
  needsPreRecommendOpenCheck,
  nextVenueStatusOnReport,
  pairOpenBufferMin,
  shouldFetchExternalVenues,
  venueBudgetFitScore,
  venueHardEligible,
} from "./generated/venueSelection.ts";
import {
  canSendFollowup,
  computeFollowupLocalHour,
  followupIsNextDay,
  maxFollowupDailyCap,
  maxFollowupReminders,
} from "./generated/encounterFollowup.ts";
import {
  canRelayArrival,
  meetupPhase,
  noShowDecision,
  shouldPivotToBackup,
} from "./generated/meetupArrival.ts";
import { chooseWorkIntroChannel } from "./generated/workIntroChannel.ts";
import type {
  City,
  FollowupSchedule,
  MeetupPhase,
  MemberVenuePrefs,
  NoShowAction,
  VenueCandidateResult,
  VenueFeedbackReport,
  VenueRecord,
  WorkIntroChannel,
} from "./types.ts";

export {
  canRelayArrival,
  canSendFollowup,
  chooseWorkIntroChannel,
  computeFollowupLocalHour,
  defaultLocalSufficiencyThreshold,
  followupIsNextDay,
  groupOpenBufferMin,
  groupVenueRubricScore,
  impromptuGroupMinSize,
  maxFollowupDailyCap,
  maxFollowupReminders,
  meetupPhase,
  needsPreRecommendOpenCheck,
  nextVenueStatusOnReport,
  noShowDecision,
  pairOpenBufferMin,
  shouldFetchExternalVenues,
  shouldPivotToBackup,
  venueBudgetFitScore,
  venueHardEligible,
};

export interface VenueOpenCheck {
  open: boolean;
  remainingMinutes: number;
}

export interface VenueRankRequest {
  city: City;
  memberAreas: string[];
  members: MemberVenuePrefs[];
  startMs: number;
  mode: "date" | "group" | "solo";
  isWeekendOrHoliday?: boolean;
  badWeatherOrAfterDark?: boolean;
  overrideTravelLimitMin?: number;
}

export interface PrimaryBackupVenuePick {
  primary?: VenueCandidateResult;
  backup?: VenueCandidateResult;
  candidates: VenueCandidateResult[];
  shouldFetchExternal: boolean;
}

export interface FollowupSendInput {
  optedOut: boolean;
  isQuietHours: boolean;
  dailyProactiveCount: number;
  dailyCap?: number;
  remindersSent: number;
  maxReminders?: number;
}

export interface ArrivalRelayInput {
  senderAge: number;
  recipientAge: number;
  senderConfirmed: boolean;
  recipientConfirmed: boolean;
  blocked: boolean;
  optedOut: boolean;
  phase?: MeetupPhase;
  nowMs?: number;
  startMs?: number;
  allMet?: boolean;
  senderMet: boolean;
  leakClean: boolean;
  safetyClean: boolean;
}

export interface NoShowInput {
  minutesSinceArrival?: number;
  nowMs?: number;
  arrivedAtMs?: number;
  partnerCheckedIn: boolean;
  pingedLate: boolean;
  notifiedWaiting: boolean;
}

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

export function rankVenuesForMatch(
  venues: VenueRecord[],
  request: VenueRankRequest,
  nowMs: number
): VenueCandidateResult[] {
  const citySpec = getCity(request.city);
  const tz = citySpec?.tz ?? CITY_TZ[request.city];
  const groupSize = Math.max(1, request.members.length);
  const requiredBuffer = groupSize >= impromptuGroupMinSize ? groupOpenBufferMin : pairOpenBufferMin;
  const startParts = localParts(request.startMs, tz);
  const isNight = startParts.hour >= 19 || startParts.hour < 5;
  const isAfterDark = startParts.hour >= 19 || startParts.hour < 7;
  const isWeekend = request.isWeekendOrHoliday ?? startParts.weekday >= 5;
  const badWeatherOrAfterDark = request.badWeatherOrAfterDark ?? isAfterDark;

  const minMemberAge = request.members.length > 0 ? Math.min(...request.members.map(m => m.age)) : 0;
  const anyNonDrinker = request.members.some(m => !m.drinksAlcohol);
  const anyVegetarian = request.members.some(m => m.vegetarian);
  const anyVegan = request.members.some(m => m.vegan);
  const anyWheelchair = request.members.some(m => m.wheelchairNeeded);

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

  const isGroupRanking = request.mode === "group" || groupSize >= impromptuGroupMinSize;
  const ranked: VenueCandidateResult[] = [];

  for (const venue of venues) {
    if (venue.city !== request.city) continue;

    const travelTimes =
      request.memberAreas.length > 0
        ? request.memberAreas.map(area => estimateTravelMinutes(request.city, area, venue.neighborhood))
        : [5];
    const maxTravelMin = Math.max(...travelTimes);
    const meanTravelMin = Math.round(travelTimes.reduce((s, x) => s + x, 0) / travelTimes.length);
    if (!isWithinTravelLimit(maxTravelMin, travelLimitMin, 0)) continue;

    const openCheck = isVenueOpenAt(venue, tz, request.startMs, requiredBuffer);
    const eligible = venueHardEligible(
      venue.public === true,
      venue.status,
      minMemberAge,
      venue.ageMin,
      venue.isBarOnly,
      venue.alcoholOptional,
      anyNonDrinker,
      anyVegan,
      venue.servesVegan,
      anyVegetarian,
      venue.servesVegetarian,
      anyWheelchair,
      venue.wheelchairAccessible,
      visitedSet.has(venue.id),
      rejectedSet.has(venue.id),
      venue.priceTier,
      maxBudgetTier,
      maxTravelMin,
      travelLimitMin,
      openCheck.open,
      openCheck.remainingMinutes,
      groupSize,
      venue.reservationRequired,
      venue.separateChecks,
      venue.walkInGroupCapacity
    );
    if (!eligible) continue;

    const weatherSensitive = venue.weatherSensitive || (badWeatherOrAfterDark && !venue.indoor);
    const rubricScore = groupVenueRubricScore(
      venue.separateChecks,
      venue.walkInGroupCapacity,
      venue.noiseLevel,
      venue.liveMusicAtNight && isNight,
      venue.alcoholOptional,
      venue.servesVegetarian,
      venue.servesVegan,
      venue.safetyScore ?? 8,
      venue.indoor,
      weatherSensitive,
      venue.arrivalLandmark.trim().length > 0,
      venue.transitScore ?? 4
    );
    const budgetFitScore = venueBudgetFitScore(venue.priceTier, maxBudgetTier);
    const personaScore = computeVenuePersonaScore(venue, archetypes);
    const ageMinutes = Math.floor((nowMs - venue.lastVerifiedAt) / MINUTE);
    const needsOpenCheck = needsPreRecommendOpenCheck(ageMinutes, isWeekend);
    const travelCost = fairMidpointCostScaled(maxTravelMin, meanTravelMin);
    const travelScore = Math.max(0, 100 - Math.round(travelCost / 5));
    const midpointBonus = midpoint && midpoint.neighborhood.name === venue.neighborhood ? 6 : 0;

    const score = Math.round(
      isGroupRanking
        ? 0.4 * rubricScore + 0.2 * budgetFitScore + 0.2 * personaScore + 0.2 * travelScore + midpointBonus
        : 0.35 * personaScore + 0.25 * budgetFitScore + 0.25 * travelScore + 0.15 * rubricScore + midpointBonus
    );

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

  ranked.sort(
    (a, b) => b.score - a.score || a.maxTravelMinutes - b.maxTravelMinutes || a.venue.id.localeCompare(b.venue.id)
  );
  return ranked;
}

function selectNearbyBackup(
  primary: VenueCandidateResult,
  rest: VenueCandidateResult[]
): VenueCandidateResult | undefined {
  if (rest.length === 0) return undefined;
  const nearby = rest.find(
    c => km(primary.venue, c.venue) <= 0.8 || c.venue.neighborhood === primary.venue.neighborhood
  );
  if (nearby) return nearby;
  return [...rest].sort(
    (a, b) =>
      km(primary.venue, a.venue) - km(primary.venue, b.venue) ||
      b.score - a.score ||
      a.venue.id.localeCompare(b.venue.id)
  )[0];
}

export function pickPrimaryAndBackupVenue(
  venues: VenueRecord[],
  request: VenueRankRequest,
  nowMs: number,
  apiBudgetRemaining = 1,
  sufficiencyThreshold = defaultLocalSufficiencyThreshold
): PrimaryBackupVenuePick {
  const candidates = rankVenuesForMatch(venues, request, nowMs);
  const shouldFetchExternal = shouldFetchExternalVenues(
    candidates.length,
    sufficiencyThreshold,
    apiBudgetRemaining
  );
  if (candidates.length === 0) {
    return { candidates, shouldFetchExternal };
  }
  const primary = candidates[0]!;
  const backup = selectNearbyBackup(primary, candidates.slice(1));
  return { primary, backup, candidates, shouldFetchExternal };
}

export function applyVenueFeedback(
  venue: VenueRecord,
  memberArchetypes: string[],
  feedback: VenueFeedbackReport,
  nowMs: number
): VenueRecord {
  const closureReportsAfter = feedback.reportedClosed ? venue.closureReports + 1 : venue.closureReports;
  const nextStatus = nextVenueStatusOnReport(
    venue.status,
    closureReportsAfter,
    feedback.providerCode ?? "ProviderOpen"
  );

  let quarantinedUntil = venue.quarantinedUntil;
  if (nextStatus === "ClosedTemporary") {
    quarantinedUntil = nowMs + 30 * 24 * HOUR;
  } else if (nextStatus === "SuspectClosed") {
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
    closureReports: closureReportsAfter,
    quarantinedUntil,
    lastVerifiedAt: feedback.providerCode ? nowMs : venue.lastVerifiedAt,
    personaPriors: nextPriors,
  };
}

export function computeFollowupTimestamp(
  eventEndMs: number,
  tz: string,
  isWorkIntro = false
): FollowupSchedule {
  const endParts = localParts(eventEndMs, tz);
  const localHour = computeFollowupLocalHour(endParts.hour, isWorkIntro);
  const nextDay = isWorkIntro ? endParts.hour >= localHour : followupIsNextDay(endParts.hour);
  const localMinute = isWorkIntro || nextDay || endParts.hour + 2 < localHour ? 0 : endParts.minute;
  const dayParts = nextDay ? localParts(eventEndMs + 24 * HOUR, tz) : endParts;
  const scheduledAt = fromLocal(dayParts.year, dayParts.month, dayParts.day, localHour, tz) + localMinute * MINUTE;
  return {
    scheduledAt,
    localHour,
    localMinute,
    nextDay,
    reminderAt: scheduledAt + 36 * HOUR,
    maxReminders: maxFollowupReminders,
  };
}

export function evaluateFollowupSend(input: FollowupSendInput): boolean {
  return canSendFollowup(
    input.optedOut,
    input.isQuietHours,
    input.dailyProactiveCount,
    input.dailyCap ?? maxFollowupDailyCap,
    input.remindersSent,
    input.maxReminders ?? maxFollowupReminders
  );
}

export function evaluateMeetupPhase(nowMs: number, startMs: number, allMet = false): MeetupPhase {
  const deltaMin = Math.floor((nowMs - startMs) / MINUTE);
  return meetupPhase(deltaMin, allMet);
}

export function evaluateArrivalRelay(input: ArrivalRelayInput): boolean {
  const phase =
    input.phase ??
    (input.nowMs !== undefined && input.startMs !== undefined
      ? evaluateMeetupPhase(input.nowMs, input.startMs, input.allMet ?? false)
      : "Closed");
  return canRelayArrival(
    input.senderAge,
    input.recipientAge,
    input.senderConfirmed,
    input.recipientConfirmed,
    input.blocked,
    input.optedOut,
    phase,
    input.senderMet,
    input.leakClean,
    input.safetyClean
  );
}

export function evaluateNoShow(input: NoShowInput): NoShowAction {
  const minutesSinceArrival =
    input.minutesSinceArrival ??
    (input.nowMs !== undefined && input.arrivedAtMs !== undefined
      ? Math.floor((input.nowMs - input.arrivedAtMs) / MINUTE)
      : 0);
  return noShowDecision(
    minutesSinceArrival,
    input.partnerCheckedIn,
    input.pingedLate,
    input.notifiedWaiting
  );
}

export function evaluateBackupPivot(
  closureReported: boolean,
  hasVerifiedBackup: boolean,
  alreadyPivoted: boolean
): boolean {
  return shouldPivotToBackup(closureReported, hasVerifiedBackup, alreadyPivoted);
}

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
