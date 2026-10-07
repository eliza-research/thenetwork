// HARNESS ONLY (2026-10-08 plans experiment, docs/results/2026-10-08-plans.md). Everything the
// simulator does not model for plans, simulated here the way attention.ts simulates hidden weekly
// availability: (1) a synthetic list of public venues per city; (2) the plan oracle: how much a
// persona would enjoy a plan (activity fit x group chemistry x logistics) and whether they say yes
// to an anonymous plan probe; (3) availability capture: who opts in to the weekly check-in, what
// they answer, and who states standing availability at onboarding. Reads hidden truth: never used by
// the engine or the Network under test, only to simulate personas and to score outcomes.
import type { City, MemberId } from "@thenetwork/core";
import { ACTIVITIES, activityById, type ActivityType, type Venue } from "../src/activities.ts";
import type { StandingAvailability, TimeSlot } from "../src/attention.ts";
import type { Plan } from "../src/plans.ts";
import type { Oracle } from "../../sim/src/oracle.ts";
import type { Persona } from "../../sim/src/persona.ts";
import { Rng as SimRng, clamp01, hash32 } from "../../sim/src/rng.ts";
import { NEIGHBORHOODS, desireById } from "../../sim/src/taxonomy.ts";
import { localParts as simLocalParts } from "../../sim/src/time.ts";
import type { World as SimWorld } from "../../sim/src/world.ts";
import { chem } from "./lib.ts";

/**
 * Hidden weekly availability: the same model as experiments/attention.ts hiddenAvailability
 * (iteration 3), copied so this harness does not import attention.ts (whose CLI parses argv on load).
 */
export function hiddenAvailability(get: () => SimWorld, seed: number) {
  return (id: MemberId, t: number): boolean => {
    const p = get().oracle.persona(id);
    if (!p) return false;
    const lp = simLocalParts(t, p.homeCity);
    const h = lp.hour + lp.minute / 60, d = lp.weekday;
    const { wake, sleep, busyBlocks, freeEvenings } = p.routine;
    const bed = sleep < 12 ? sleep + 24 : sleep;
    if (h < wake + 1 || h + 2 > bed) return false;
    const key = `${lp.year}-${lp.month}-${lp.day}`;
    const draw = (tag: string) => new SimRng(hash32(seed, "avail", tag, id, key)).next();
    if (draw("shock") < 0.15) return false;
    const weekend = d === 0 || d === 6;
    if (h >= 17) return freeEvenings.includes(d) || (weekend && draw("weekend-evening") < 0.3);
    if (!weekend) return !busyBlocks.some(([a, b]) => h < b && h + 2 > a) && draw("weekday-day") < 0.5;
    return draw(h < 12 ? "weekend-am" : "weekend-pm") < 0.6;
  };
}

// ------------------------------------------------------------------------------------------------
// (1) Venues: 3 public venues per activity per city, in rotating neighborhoods (about 100 per city).

const KIND: Record<string, string> = {
  bouldering: "climbing gym", group_run: "running track", day_hike: "trailhead", group_ride: "bike shop meetup", tennis: "public courts",
  pickleball: "rec center courts", pickup_basketball: "park courts", park_yoga: "park lawn", group_sit: "meditation center", live_show: "music hall",
  jazz_night: "jazz club", open_mic: "cafe stage", film_screening: "indie cinema", open_studio: "ceramics studio", sketch_session: "art center",
  photo_walk: "plaza", theater_night: "community theater", dance_class: "dance studio", book_club: "bookshop cafe", writing_session: "public library",
  board_game_cafe: "board game cafe", chess_park: "park chess tables", restaurant_dinner: "family-style restaurant", coffee_crawl: "coffee roaster",
  wine_bar: "wine bar", night_market: "night market", tech_meetup: "coworking space", food_bank_shift: "food bank", park_cleanup: "park conservancy",
  community_garden: "community garden", walking_tour: "historical society", dog_park: "dog park",
};
export function syntheticVenues(): Venue[] {
  const out: Venue[] = [];
  for (const city of ["sf", "nyc"] as City[]) {
    const hoods = NEIGHBORHOODS[city];
    ACTIVITIES.forEach((a, i) => {
      for (let k = 0; k < 3; k++) {
        const area = hoods[(i * 5 + k * 4) % hoods.length]!;
        const day = a.dayparts.every(d => d === "weekend_day");
        out.push({
          id: `v:${city}:${a.id}:${k}`, city, area, name: `the ${area} ${KIND[a.id] ?? "venue"}`, activities: [a.id], priceTier: a.costTier, ageMin: a.ageMin,
          hours: day ? { weekday: [8, 18], weekend: [8, 18] } : { weekday: [9, 23], weekend: [9, 23] },
          ...(a.kind === "volunteer" ? { org: `${area} ${KIND[a.id]}` } : {}), public: true, source: "curated",
        });
      }
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// (2) The plan oracle

/** Hidden liking of an activity: 1 a held interest or skill; 0.8 a held want it serves; 0.35 a liked family; else 0.1. */
export function hiddenLike(p: Persona, a: ActivityType): number {
  const has = (x: ActivityType) => x.tags.some(t => p.hidden.interests.includes(t) || p.hidden.skills.includes(t));
  if (has(a)) return 1;
  if (p.hidden.desires.some(d => a.objectives.includes(d.id) || (desireById.get(d.id)?.needsInterests ?? []).some(t => a.tags.includes(t)))) return 0.8;
  if (ACTIVITIES.some(x => x.family === a.family && has(x))) return 0.35;
  return 0.1;
}

/**
 * Enjoyment of a plan for each attendee (HARNESS ONLY):
 *   e_i = clamp01(0.85 x A_i x C_i x L_i + n_i)
 *   A_i = 0.4 + 0.6 x like_i(a)                               activity fit
 *   C_i = clamp(0.35 + mean_j [pairEnjoyment(i, j) + chem(i, j)], 0.2, 1.1)   group chemistry (the sim's own pair model and pair chemistry draw)
 *   L_i = 1 - 0.06 x max(0, |G| - preferredGroupSize) x (1 - socialEnergy) - 0.05 [venue not in home/work area]
 *         + 0.08 x [a familiar face] x (1 - socialEnergy)       logistics and comfort
 *   n_i ~ N(0, 0.08) per (plan, member)                        how the evening went
 * The plan is worthwhile for the group (least misery) when every attendee has e_i >= 0.5.
 */
export function planEnjoyment(oracle: Oracle, seed: number, plan: Pick<Plan, "id" | "activityId" | "place">, attendees: MemberId[]): Record<MemberId, number> {
  const a = activityById.get(plan.activityId)!;
  const ps = attendees.map(id => oracle.persona(id)).filter((p): p is Persona => !!p);
  const out: Record<MemberId, number> = {};
  for (const p of ps) {
    const others = ps.filter(o => o.id !== p.id);
    const chemI = others.length ? others.reduce((s, o) => s + oracle.pairEnjoyment(p, o, "social").e + chem(seed, p.id, o.id), 0) / others.length : 0;
    const A = 0.4 + 0.6 * hiddenLike(p, a);
    const C = Math.max(0.2, Math.min(1.1, 0.35 + chemI));
    const fam = others.some(o => p.relationships.some(r => r.to === o.id && r.type !== "ex"));
    const area = plan.place.area?.toLowerCase();
    const L = 1 - 0.06 * Math.max(0, ps.length - p.hidden.preferredGroupSize) * (1 - p.hidden.socialEnergy)
      - (area && area !== p.routine.homeArea.toLowerCase() && area !== p.routine.workArea.toLowerCase() ? 0.05 : 0)
      + (fam ? 0.08 * (1 - p.hidden.socialEnergy) : 0);
    const noise = new SimRng(hash32(seed, "plan-night", plan.id, p.id)).normal(0, 0.08);
    out[p.id] = Math.round(clamp01(0.85 * A * C * L + noise) * 1000) / 1000;
  }
  return out;
}

/**
 * P(yes) to an anonymous plan probe (HARNESS ONLY; replaces oracle.probe for plan keys). The probe
 * shows activity, time, place, size and cost, not who:
 *   (0.3 + 0.7 x this week's capacity) x fatigue x (0.15 + 0.75 x like) x (0.6 + 0.4 x socialEnergy) x size comfort x presence.
 * Primed (the member stated a window this week covering the plan's time): 0.85 x (0.3 + 0.7 x like).
 * Whether the persona is free at the plan's time is decided separately (hidden availability): a yes
 * at a time they are not free becomes "can't make that time".
 */
export function planYesProb(oracle: Oracle, id: MemberId, a: ActivityType, size: number, city: City, at: number, recentAsks: number, primed = false): number {
  const p = oracle.persona(id);
  if (!p) return 0;
  if (p.hidden.adversarial && ["spammer", "scammer", "harasser"].includes(p.hidden.adversarial)) return 0.95;
  // Window priming (the plan analogue of fix 1's ask priming): the member told us this week they are
  // free then; time and appetite are settled, so the decision rests on the activity.
  if (primed) return clamp01(0.85 * (0.3 + 0.7 * hiddenLike(p, a)) * (oracle.presentIn(p, city, at) ? 1 : 0.1));
  const cap = 0.3 + 0.7 * oracle.weekCapacity(p, at);
  const fatigue = Math.pow(0.85, Math.max(0, recentAsks - 1));
  const size_ = 1 - 0.08 * Math.max(0, size - p.hidden.preferredGroupSize) * (1 - p.hidden.socialEnergy);
  return clamp01(cap * fatigue * (0.15 + 0.75 * hiddenLike(p, a)) * (0.6 + 0.4 * p.hidden.socialEnergy) * size_ * (oracle.presentIn(p, city, at) ? 1 : 0.1));
}

// ------------------------------------------------------------------------------------------------
// (3) Availability capture

export interface CaptureModel {
  /** Opts in to the weekly "what's your week like?" check-in: p = base + slope x socialEnergy. */
  checkIn: { base: number; slope: number };
  /** States standing availability at onboarding ("usually free Tue evenings"). */
  standing: number;
  /** A stated window covers a truly free slot with p = recall; a busy one with p = falsePositive. */
  recall: number; falsePositive: number;
}
export const DEFAULT_CAPTURE: CaptureModel = { checkIn: { base: 0.25, slope: 0.35 }, standing: 0.5, recall: 0.8, falsePositive: 0.05 };

export const optsInToCheckIn = (oracle: Oracle, seed: number, id: MemberId, m: CaptureModel) => {
  const p = oracle.persona(id);
  return !!p && new SimRng(hash32(seed, "checkin-optin", id)).next() < m.checkIn.base + m.checkIn.slope * p.hidden.socialEnergy;
};

/** Standing availability a persona states at onboarding: their free evenings, and weekend days (each with p 0.6), from their routine. */
export function statedStanding(oracle: Oracle, seed: number, id: MemberId, at: number, m: CaptureModel): StandingAvailability[] {
  const p = oracle.persona(id);
  if (!p || new SimRng(hash32(seed, "standing", id)).next() >= m.standing) return [];
  const r = new SimRng(hash32(seed, "standing-days", id));
  const out: StandingAvailability[] = [];
  if (p.routine.freeEvenings.length) out.push({ byDay: [...p.routine.freeEvenings], startHour: 17, endHour: 22, source: "onboarding", statedAt: at });
  const wk = [0, 6].filter(() => r.next() < 0.6);
  if (wk.length) out.push({ byDay: wk, startHour: 10, endHour: 17, source: "onboarding", statedAt: at });
  return out;
}

/** What a persona answers to "what's your week like?": the candidate slots they are truly free for (recall), plus a few they are not. */
export function checkInAnswer(seed: number, id: MemberId, slots: readonly TimeSlot[], free: (id: MemberId, t: number) => boolean, m: CaptureModel): TimeSlot[] {
  return slots.filter(s => new SimRng(hash32(seed, "checkin-ans", id, s.start)).next() < (free(id, s.start) ? m.recall : m.falsePositive));
}
