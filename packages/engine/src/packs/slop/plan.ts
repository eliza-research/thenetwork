// The booked first date the agent plans after a mutual yes (PRD 40.5; attention-budget iteration 4:
// the reveal IS the booked plan, "You're both in: meet Sam, Thu 7pm. Reply if you can't make it").
// Activity from the date ideas both stated, 2-3 time options from the slots both said they are
// usually free (then either, then the rest), a PUBLIC venue type only, short by default.
import {
  canBeMatched, pickPrimaryAndBackupVenue, seedVenuesForCity,
  type City, type LaunchCity, type MemberId, type MemberVenuePrefs, type VenueRecord,
} from "@thenetwork/core";
import { slopDatePairAllowed, slopDateProfilesAllowed } from "../../../../core/src/generated/slopDatePlan.ts";
import { isOpaquePhotoId } from "../../relay.ts";
import type { EngineInput } from "../../types.ts";
import { memberIdResolver } from "../../world.ts";
import { mutualMarkets } from "./geo.ts";
import { SLOP_DEFAULT_OPTIONS, type SlopPackOptions } from "./options.ts";
import { SLOTS, slopProfiles, type SlopProfile, type Slot } from "./profile.ts";
import { dateActivity, slopRedLinesOf } from "./score.ts";
import { distanceBand, type DistanceBand } from "./zips.ts";

/** Public venue types per activity. There is no private or home option (safety basics). */
export const PUBLIC_VENUE: Record<string, { venue: string; minutes: number }> = {
  coffee: { venue: "a cafe", minutes: 60 }, drinks: { venue: "a bar", minutes: 75 }, walk: { venue: "a park", minutes: 60 },
  museum: { venue: "a museum", minutes: 90 }, dinner: { venue: "a restaurant", minutes: 90 }, live_music: { venue: "a music venue", minutes: 120 },
  comedy: { venue: "a comedy club", minutes: 90 }, climbing: { venue: "a climbing gym", minutes: 90 }, cooking_class: { venue: "a cooking class", minutes: 120 },
  hike: { venue: "a popular trailhead (daytime)", minutes: 120 },
};

export interface PlanVenueContext {
  city?: LaunchCity;
  venues?: readonly VenueRecord[];
  memberAreas?: [string | undefined, string | undefined];
  memberPrefs?: [Partial<MemberVenuePrefs>, Partial<MemberVenuePrefs>];
  startMs?: number;
  nowMs?: number;
  isAfterDark?: boolean;
  badWeatherOrAfterDark?: boolean;
  concurrentHeadcountByVenue?: Record<string, number>;
  targetHobbies?: string[];
}

export interface DatePlan {
  first: MemberId; partner: MemberId; market: City; activity: string; venue: string; public: true; minutes: number;
  /** Slot indices into SLOTS, best first (2-3). */
  options: number[]; slots: Slot[];
  /** What both are told about distance. */
  distance: DistanceBand;
  venueRecord?: VenueRecord;
  backupVenue?: VenueRecord;
}

/** P(a member is free in a slot): stated usual slots and slots they attended a date at, else a daypart prior. */
function freeScore(p: SlopProfile, s: number): number {
  if (p.free.includes(SLOTS[s]!) || p.history.attendedSlots.includes(s)) return 0.85;
  if (p.free.length) return s <= 4 ? 0.15 : 0.45; // they told us their usual slots; others are less likely
  return s <= 4 ? 0.4 : 0.55;
}

function buildVenuePrefs(
  p: SlopProfile,
  override: Partial<MemberVenuePrefs> | undefined,
  redLines: { strictSober: boolean; nonDrinker: boolean; lowWalking: boolean; daytimeOnly: boolean }
): MemberVenuePrefs {
  return {
    memberId: p.id,
    age: p.age,
    drinksAlcohol: override?.drinksAlcohol !== undefined ? override.drinksAlcohol && !redLines.nonDrinker : !redLines.nonDrinker,
    strictSober: override?.strictSober === true || redLines.strictSober,
    vegetarian: override?.vegetarian ?? false,
    vegan: override?.vegan ?? false,
    halal: override?.halal,
    kosher: override?.kosher,
    glutenFree: override?.glutenFree,
    severeAllergen: override?.severeAllergen,
    wheelchairNeeded: override?.wheelchairNeeded ?? false,
    lowWalking: override?.lowWalking === true || redLines.lowWalking,
    smokeFree: override?.smokeFree,
    lowNoiseRequired: override?.lowNoiseRequired,
    daytimeOnly: override?.daytimeOnly === true || redLines.daytimeOnly,
    maxBudgetTier: override?.maxBudgetTier ?? 2,
    maxTravelMinutes: override?.maxTravelMinutes,
    visitedVenueIds: override?.visitedVenueIds ?? [],
    rejectedVenueIds: override?.rejectedVenueIds ?? [],
    archetype: override?.archetype,
    hobbies: override?.hobbies ?? p.interests,
    cuisinePrefs: override?.cuisinePrefs,
    optedIntoActivityDates: override?.optedIntoActivityDates,
  };
}

export function planFirstDate(
  first: SlopProfile,
  partner: SlopProfile,
  markets: readonly City[],
  o: SlopPackOptions = SLOP_DEFAULT_OPTIONS,
  venueCtx?: PlanVenueContext
): DatePlan | null {
  const adults = first.adult && partner.adult && canBeMatched(first.age) && canBeMatched(partner.age);
  if (!slopDateProfilesAllowed(first.id !== partner.id, adults, first.optedIn && partner.optedIn, first.paused || partner.paused)) return null;
  const mm = mutualMarkets(first, partner, o, markets);
  if (!mm.length) return null;
  const prefA = venueCtx?.memberPrefs?.[0];
  const prefB = venueCtx?.memberPrefs?.[1];
  const rl = slopRedLinesOf(first, partner, {
    ...(prefA?.strictSober || prefB?.strictSober ? { anyStrictSober: true } : {}),
    ...(prefA?.drinksAlcohol === false || prefB?.drinksAlcohol === false ? { anyNonDrinker: true } : {}),
    ...(prefA?.lowWalking || prefB?.lowWalking ? { anyLowWalking: true } : {}),
    ...(prefA?.daytimeOnly || prefB?.daytimeOnly ? { anyDaytimeOnly: true } : {}),
    ...(venueCtx?.isAfterDark !== undefined ? { isAfterDark: venueCtx.isAfterDark } : {}),
  });
  const activity = dateActivity(first, partner, rl);
  let v = PUBLIC_VENUE[activity] ?? PUBLIC_VENUE.coffee!;
  if ((rl.anyStrictSober || rl.anyNonDrinker) && v.venue === "a bar") {
    v = PUBLIC_VENUE.coffee!;
  }
  const daytimeOnly = activity === "hike" || rl.anyDaytimeOnly;
  const ranked = SLOTS.map((_, s) => ({ s, p: freeScore(first, s) * freeScore(partner, s) }))
    .filter(({ s }) => !daytimeOnly || SLOTS[s]!.endsWith("_day"))
    .sort((x, y) => (y.p - x.p) || (x.s - y.s));
  const options = ranked.slice(0, 3).map(x => x.s);
  const market = mm[0]!.market;

  let venueLabel = v.venue;
  let venueRecord: VenueRecord | undefined;
  let backupVenue: VenueRecord | undefined;

  if (venueCtx) {
    const venueCity: LaunchCity = venueCtx.city ?? market;
    const pool = venueCtx.venues ? [...venueCtx.venues] : seedVenuesForCity(venueCity);
    if (pool.length > 0) {
      const rlA = slopRedLinesOf(first, first);
      const rlB = slopRedLinesOf(partner, partner);
      const memberA = buildVenuePrefs(first, prefA, {
        strictSober: rlA.anyStrictSober, nonDrinker: rlA.anyNonDrinker, lowWalking: rlA.anyLowWalking, daytimeOnly: rlA.anyDaytimeOnly,
      });
      const memberB = buildVenuePrefs(partner, prefB, {
        strictSober: rlB.anyStrictSober, nonDrinker: rlB.anyNonDrinker, lowWalking: rlB.anyLowWalking, daytimeOnly: rlB.anyDaytimeOnly,
      });
      const areas: string[] = [];
      for (const a of venueCtx.memberAreas ?? []) if (typeof a === "string" && a.trim().length > 0) areas.push(a);
      const sharedHobbies = first.interests.filter(t => partner.interests.includes(t));
      const nowMs = venueCtx.nowMs ?? venueCtx.startMs ?? Date.UTC(2026, 9, 15, 19, 0);
      const startMs = venueCtx.startMs ?? nowMs;
      const pick = pickPrimaryAndBackupVenue(
        pool,
        {
          city: venueCity,
          memberAreas: areas,
          members: [memberA, memberB],
          startMs,
          mode: "date",
          app: "slop",
          isFirstMeet: true,
          ...(venueCtx.badWeatherOrAfterDark !== undefined ? { badWeatherOrAfterDark: venueCtx.badWeatherOrAfterDark } : {}),
          ...(venueCtx.concurrentHeadcountByVenue ? { concurrentHeadcountByVenue: venueCtx.concurrentHeadcountByVenue } : {}),
          ...(venueCtx.targetHobbies?.length || sharedHobbies.length ? { targetHobbies: venueCtx.targetHobbies ?? sharedHobbies } : {}),
        },
        nowMs
      );
      if (pick.primary) {
        venueRecord = pick.primary.venue;
        venueLabel = pick.primary.venue.name;
        backupVenue = pick.backup?.venue;
      }
    }
  }

  return {
    first: first.id, partner: partner.id, market, activity, venue: venueLabel, public: true, minutes: v.minutes,
    options, slots: options.map(s => SLOTS[s]!), distance: distanceBand(mm[0]!.miles),
    ...(venueRecord ? { venueRecord } : {}),
    ...(backupVenue ? { backupVenue } : {}),
  };
}

/** Plan from an engine input (the platform and the simulator call this after the mutual yes, or to fill probe time options). */
export function planFromInput(
  input: EngineInput,
  first: MemberId,
  partner: MemberId,
  markets: readonly City[],
  o: SlopPackOptions = SLOP_DEFAULT_OPTIONS,
  venueCtx?: PlanVenueContext
): DatePlan | null {
  const canonical = memberIdResolver(input);
  const aId = canonical(first), bId = canonical(partner);
  const blocked = input.edges.some(edge => {
    if (edge.type !== "blocked") return false;
    const from = canonical(edge.from), to = canonical(edge.to);
    return (from === aId && to === bId) || (from === bId && to === aId);
  });
  const held = input.safetyHolds?.some(hold => {
    const id = canonical(hold.memberId);
    return (id === aId || id === bId) && hold.from <= input.now && (hold.to === undefined || input.now < hold.to);
  }) ?? false;
  if (!slopDatePairAllowed(blocked, held)) return null;
  const profiles = slopProfiles(input);
  const a = profiles.get(aId), b = profiles.get(bId);
  return a && b ? planFirstDate(a, b, markets, o, venueCtx) : null;
}

// ------------------------------------------------------------------------------- photo in the probe
// Founder decision 2026-10-08 (PRD 40.5): the anonymous first probe can include one photo of the
// other person. Name and contact stay hidden until both say yes. The platform and the slop world
// both call `probePhotoRefs`, so the sim's photo arm and the live probe follow the same rule.

/** The member whose photo would be shown, as the platform knows them. */
export interface ProbePhotoSubject {
  /** LOWEST stated or recorded age; undefined = unknown (never shown). */
  age: number | undefined;
  /** Consent to show their photos to a proposed match (separate from the upload consent). */
  photoConsent: boolean;
  /** Their photos with the current consent, best first (opaque ids). */
  photoIds: readonly string[];
  /** An open safety hold or ban: no photo goes out. */
  held?: boolean;
}
/** A photo reference in a probe: an opaque id the platform resolves to a short-lived image. Never a URL. */
export interface ProbePhotoRef { id: string }
export const PROBE_PHOTO_MAX = 1;

/**
 * The photo(s) a probe may carry: [] unless the subject AND the recipient are adults (core
 * `canBeMatched` on the lowest age), the subject consented to photo use, is not held, and has a
 * valid opaque photo id. At most PROBE_PHOTO_MAX.
 */
export function probePhotoRefs(subject: ProbePhotoSubject, recipient: { age: number | undefined }): ProbePhotoRef[] {
  if (!canBeMatched(subject.age) || !canBeMatched(recipient.age) || !subject.photoConsent || subject.held) return [];
  return subject.photoIds.filter(isOpaquePhotoId).slice(0, PROBE_PHOTO_MAX).map(id => ({ id }));
}
