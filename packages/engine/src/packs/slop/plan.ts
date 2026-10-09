// The booked first date the agent plans after a mutual yes (PRD 40.5; attention-budget iteration 4:
// the reveal IS the booked plan, "You're both in: meet Sam, Thu 7pm. Reply if you can't make it").
// Activity from the date ideas both stated, 2-3 time options from the slots both said they are
// usually free (then either, then the rest), a PUBLIC venue type only, short by default.
import { canBeMatched, type City, type MemberId } from "@thenetwork/core";
import { isOpaquePhotoId } from "../../relay.ts";
import type { EngineInput } from "../../types.ts";
import { mutualMarkets } from "./geo.ts";
import { SLOP_DEFAULT_OPTIONS, type SlopPackOptions } from "./options.ts";
import { SLOTS, slopProfiles, type SlopProfile, type Slot } from "./profile.ts";
import { dateActivity } from "./score.ts";
import { distanceBand, type DistanceBand } from "./zips.ts";

/** Public venue types per activity. There is no private or home option (safety basics). */
export const PUBLIC_VENUE: Record<string, { venue: string; minutes: number }> = {
  coffee: { venue: "a cafe", minutes: 60 }, drinks: { venue: "a bar", minutes: 75 }, walk: { venue: "a park", minutes: 60 },
  museum: { venue: "a museum", minutes: 90 }, dinner: { venue: "a restaurant", minutes: 90 }, live_music: { venue: "a music venue", minutes: 120 },
  comedy: { venue: "a comedy club", minutes: 90 }, climbing: { venue: "a climbing gym", minutes: 90 }, cooking_class: { venue: "a cooking class", minutes: 120 },
  hike: { venue: "a popular trailhead (daytime)", minutes: 120 },
};

export interface DatePlan {
  first: MemberId; partner: MemberId; market: City; activity: string; venue: string; public: true; minutes: number;
  /** Slot indices into SLOTS, best first (2-3). */
  options: number[]; slots: Slot[];
  /** What both are told about distance. */
  distance: DistanceBand;
}

/** P(a member is free in a slot): stated usual slots and slots they attended a date at, else a daypart prior. */
function freeScore(p: SlopProfile, s: number): number {
  if (p.free.includes(SLOTS[s]!) || p.history.attendedSlots.includes(s)) return 0.85;
  if (p.free.length) return s <= 4 ? 0.15 : 0.45; // they told us their usual slots; others are less likely
  return s <= 4 ? 0.4 : 0.55;
}

export function planFirstDate(first: SlopProfile, partner: SlopProfile, markets: readonly City[], o: SlopPackOptions = SLOP_DEFAULT_OPTIONS): DatePlan | null {
  const mm = mutualMarkets(first, partner, o, markets);
  if (!mm.length) return null;
  const activity = dateActivity(first, partner);
  const v = PUBLIC_VENUE[activity] ?? PUBLIC_VENUE.coffee!;
  const ranked = SLOTS.map((_, s) => ({ s, p: freeScore(first, s) * freeScore(partner, s) }))
    .sort((x, y) => (y.p - x.p) || (x.s - y.s));
  const options = ranked.slice(0, 3).map(x => x.s);
  return {
    first: first.id, partner: partner.id, market: mm[0]!.market, activity, venue: v.venue, public: true, minutes: v.minutes,
    options, slots: options.map(s => SLOTS[s]!), distance: distanceBand(mm[0]!.miles),
  };
}

/** Plan from an engine input (the platform and the simulator call this after the mutual yes, or to fill probe time options). */
export function planFromInput(input: EngineInput, first: MemberId, partner: MemberId, markets: readonly City[], o: SlopPackOptions = SLOP_DEFAULT_OPTIONS): DatePlan | null {
  const P = slopProfiles(input);
  const a = P.get(first), b = P.get(partner);
  return a && b ? planFirstDate(a, b, markets, o) : null;
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
