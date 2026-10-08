// slop.date personas: a dater with HIDDEN truth (what the Network can never read) and a STATED side
// (what they would tell the agent over iMessage). The snapshot builder (snapshot.ts) shows the
// matcher only the stated side, filtered by profile richness. The oracle (oracle.ts) reads hidden
// truth. See docs/results/2026-10-08-slop-world.md for the model and its research grounding.
import type { MemberId } from "@thenetwork/core";
import { Rng, hash32 } from "@thenetwork/core";
import { FIRST_NAMES, LAST_NAMES, INTERESTS } from "@thenetwork/sim/src/taxonomy.ts";
import type { RichnessTier } from "@thenetwork/sim/src/sources.ts";
import { CITY_ANCHOR_ZIP, SLOP_CITIES, zipInfo, zipsIn, type SlopCity } from "./geo.ts";

export type { RichnessTier };

/** Coarse matching gender (what preferences are written in). Separate from identity. */
export type MatchGender = "woman" | "man" | "nonbinary";
export type GenderIdentity = "cis_woman" | "trans_woman" | "cis_man" | "trans_man" | "nonbinary" | "genderqueer" | "agender";
export type Orientation = "straight" | "gay" | "lesbian" | "bisexual" | "pansexual" | "queer";
export type Goal = "casual" | "long_term" | "unsure";
export type Smoking = "never" | "sometimes" | "regular";
export type Drinking = "never" | "social" | "regular";
export type WantsKids = "yes" | "no" | "open";
export type Religion = "none" | "christian" | "jewish" | "muslim" | "hindu" | "buddhist" | "spiritual";
export type Politics = "left" | "moderate" | "right";
export type Dealbreaker =
  | "smoker" | "heavy_drinker" | "has_kids" | "wants_kids" | "no_kids_ever" | "religious" | "nonreligious"
  | "right_politics" | "left_politics";
export const DEALBREAKERS: readonly Dealbreaker[] = ["smoker", "heavy_drinker", "has_kids", "wants_kids", "no_kids_ever", "religious", "nonreligious", "right_politics", "left_politics"];
export type DateActivity = "coffee" | "drinks" | "dinner" | "walk" | "museum" | "live_music" | "comedy" | "climbing" | "hike" | "cooking_class";
export const DATE_ACTIVITIES: readonly DateActivity[] = ["coffee", "drinks", "dinner", "walk", "museum", "live_music", "comedy", "climbing", "hike", "cooking_class"];
/** Trait / taste dimensions. A person HAS traits and has a (revealed) TASTE over others' traits. */
export const TASTE_DIMS = ["adventurous", "intellectual", "artsy", "ambitious", "homebody"] as const;
export type AdversaryKind = "romance_scammer" | "catfish" | "harasser" | "age_liar" | "not_single";
export const ADVERSARY_KINDS: readonly AdversaryKind[] = ["romance_scammer", "catfish", "harasser", "age_liar", "not_single"];

/** Where someone will date. `radius`: within `miles` of a zip. */
export type LocationScope =
  | { mode: "city" }
  | { mode: "multi_city"; cities: SlopCity[] }
  | { mode: "radius"; zip: string; miles: number };

/** Weekly date slots. Index = slot id (stable; used in time options). */
export const SLOTS = ["mon_eve", "tue_eve", "wed_eve", "thu_eve", "fri_eve", "sat_day", "sat_eve", "sun_day", "sun_eve"] as const;
export type Slot = (typeof SLOTS)[number];
/** Day offset of each slot within the week (Monday = 0), for time-to-first-date. */
export const SLOT_DAY: Record<Slot, number> = { mon_eve: 0, tue_eve: 1, wed_eve: 2, thu_eve: 3, fri_eve: 4, sat_day: 5, sat_eve: 5, sun_day: 6, sun_eve: 6 };

export interface Values {
  smoking: Smoking; drinking: Drinking; hasKids: boolean; wantsKids: WantsKids;
  religion: Religion; /** 0 not at all .. 3 central */ religionImportance: number; politics: Politics;
}

/** Hidden weekly availability (as in the attention harness, experiments/attention.ts hiddenAvailability). */
export interface Availability {
  /** P(free) per slot in a typical week. A one-off shock (p = shock) makes a slot busy that week. */
  slotFree: number[]; shock: number;
}

export interface HiddenTruth {
  trueAge: number;
  /** True age 13-17. Flagged here only: the snapshot carries the claimed age, never this flag. */
  isMinor: boolean;
  matchGender: MatchGender; identity: GenderIdentity; orientation: Orientation;
  /** Revealed preferences: who they actually respond to. */
  seeks: MatchGender[]; ageRange: [number, number];
  homeZip: string; homeCity: SlopCity; scope: LocationScope; maxMiles: number;
  /** Cities they are physically in, per week of the run (multi-city members and travelers). */
  presence: { city: SlopCity; weeks: number[] }[];
  /** Latent desirability (partner effect), standard-normal scale. Consistent across cities. */
  desirability: number;
  /** Actor effect: how readily they like people in general. */
  warmth: number;
  traits: number[]; taste: number[];
  goal: Goal; values: Values; dealbreakers: Dealbreaker[];
  interests: string[]; activities: DateActivity[];
  /** Baseline appetite for a date in a given week (0..1). */
  appetite: number;
  availability: Availability;
  replyProb: number; latencyMedianMin: number;
  /** P(no-show | booked), before availability. */
  flakiness: number;
  /** P(reported feedback matches true feeling). */
  honesty: number;
  richness: RichnessTier;
  adversary?: AdversaryKind;
  /** Unique token that must never appear in a snapshot (leak tests). */
  canary: string;
}

/** What the member would tell the agent if asked. The snapshot shows a richness-filtered subset. */
export interface StatedProfile {
  claimedAge: number;
  matchGender: MatchGender; identity: GenderIdentity; orientation: Orientation;
  seeks: MatchGender[]; ageRange: [number, number];
  homeZip: string; scope: LocationScope; maxMiles: number;
  goal: Goal; values: Values; dealbreakers: Dealbreaker[];
  /** Self-description on the trait dimensions (noisy). */
  selfTraits: number[];
  /** Stated "type" (what they say they want). Weakly related to revealed taste (Eastwick & Finkel 2008). */
  wantsTraits: number[];
  interests: string[]; activities: DateActivity[];
  /** Slots they say are usually free. */
  usuallyFree: Slot[];
  relationshipStatus: "single";
  occupation: string; bio: string;
}

export interface SlopPersona {
  id: MemberId; name: string;
  hidden: HiddenTruth; stated: StatedProfile;
  /** True when bio came from the optional LLM prose pass (prose.ts). */
  enriched?: boolean;
}

export interface SlopGenOptions {
  seed: number | string;
  /** Personas per city (default 300). */
  perCity?: number;
  cities?: readonly SlopCity[];
  /** Share of 13-17 year olds who join (default 0.04). */
  minorShare?: number;
  /** Share of minors who claim 18+ (age liars; default 0.4). */
  minorLiarShare?: number;
  /** Adult adversary shares (default 0.01 scammer, 0.015 catfish, 0.015 harasser, 0.03 not single). */
  adversaryShares?: Partial<Record<Exclude<AdversaryKind, "age_liar">, number>>;
  /** Share of adults who date in several cities (default 0.05) or travel (default 0.04). */
  multiCityShare?: number; travelerShare?: number;
  richnessMix?: Partial<Record<RichnessTier, number>>;
  /** Weeks in the run (presence schedules; default 4). */
  weeks?: number;
}

export const SLOP_DEFAULTS = {
  perCity: 300, minorShare: 0.04, minorLiarShare: 0.4, multiCityShare: 0.05, travelerShare: 0.04, weeks: 4,
  adversaryShares: { romance_scammer: 0.01, catfish: 0.015, harasser: 0.015, not_single: 0.03 },
  richnessMix: { minimal: 0.15, light: 0.25, medium: 0.3, rich: 0.2, very_rich: 0.1 } as Record<RichnessTier, number>,
};

const OCCUPATIONS = ["nurse", "software engineer", "teacher", "designer", "barista", "lawyer", "line cook", "grad student", "product manager", "electrician", "physical therapist", "writer", "accountant", "musician", "researcher", "sales lead", "architect", "social worker", "photographer", "founder"];
const ACTIVITY_BY_CLUSTER: Record<string, DateActivity[]> = {
  outdoors: ["hike", "walk", "climbing"], sports: ["walk", "drinks"], music: ["live_music", "drinks"], arts: ["museum", "comedy"],
  ideas: ["coffee", "museum"], tech: ["coffee", "drinks"], food: ["dinner", "cooking_class", "drinks"], play: ["drinks", "coffee"],
  civic: ["coffee", "walk"], family: ["walk", "coffee"], wellness: ["walk", "coffee"],
};

const unit = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const clampAge = (a: number) => Math.max(18, Math.min(70, Math.round(a)));

function drawAge(r: Rng): number {
  return r.bool(0.7) ? Math.max(18, Math.min(60, Math.round(r.normal(30, 5.5)))) : r.int(18, 60);
}

function drawGender(r: Rng): { g: MatchGender; id: GenderIdentity; o: Orientation; seeks: MatchGender[] } {
  const g = r.weighted<MatchGender>([["man", 0.48], ["woman", 0.48], ["nonbinary", 0.04]]);
  const id: GenderIdentity = g === "man" ? (r.bool(0.03) ? "trans_man" : "cis_man")
    : g === "woman" ? (r.bool(0.03) ? "trans_woman" : "cis_woman")
    : r.weighted<GenderIdentity>([["nonbinary", 0.6], ["genderqueer", 0.25], ["agender", 0.15]]);
  const all: MatchGender[] = ["woman", "man", "nonbinary"];
  if (g === "man") {
    const o = r.weighted<Orientation>([["straight", 0.85], ["gay", 0.09], ["bisexual", 0.05], ["pansexual", 0.01]]);
    return { g, id, o, seeks: o === "straight" ? ["woman"] : o === "gay" ? ["man"] : o === "pansexual" ? all : r.bool(0.4) ? all : ["woman", "man"] };
  }
  if (g === "woman") {
    const o = r.weighted<Orientation>([["straight", 0.8], ["lesbian", 0.06], ["bisexual", 0.11], ["queer", 0.03]]);
    return { g, id, o, seeks: o === "straight" ? ["man"] : o === "lesbian" ? (r.bool(0.3) ? ["woman", "nonbinary"] : ["woman"]) : o === "queer" ? all : r.bool(0.4) ? all : ["man", "woman"] };
  }
  const o = r.weighted<Orientation>([["queer", 0.5], ["pansexual", 0.2], ["lesbian", 0.15], ["gay", 0.15]]);
  return { g, id, o, seeks: o === "lesbian" ? ["woman", "nonbinary"] : o === "gay" ? ["man", "nonbinary"] : all };
}

/** Bruch & Newman (2018): desirability falls with age for women from about 18, peaks near 40-50 for men. */
function ageDesirability(g: MatchGender, age: number): number {
  if (g === "woman") return -0.035 * Math.max(0, age - 22);
  if (g === "man") return age <= 40 ? 0.025 * (age - 25) : 0.375 - 0.03 * (age - 40);
  return -0.015 * Math.max(0, age - 28);
}

function statedAgeRange(g: MatchGender, age: number, r: Rng): [number, number] {
  const [lo, hi] = g === "man" ? [age - 8, age + 3] : g === "woman" ? [age - 3, age + 8] : [age - 6, age + 6];
  return [Math.max(18, Math.round(lo + r.normal(0, 1.5))), clampAge(Math.max(lo + 4, hi + r.normal(0, 2)))];
}

function drawValues(r: Rng, age: number): Values {
  const religion = r.weighted<Religion>([["none", 0.38], ["christian", 0.3], ["jewish", 0.07], ["muslim", 0.04], ["hindu", 0.04], ["buddhist", 0.04], ["spiritual", 0.13]]);
  const hasKids = r.bool(Math.min(0.55, Math.max(0.02, (age - 26) * 0.025)));
  return {
    smoking: r.weighted<Smoking>([["never", 0.8], ["sometimes", 0.13], ["regular", 0.07]]),
    drinking: r.weighted<Drinking>([["never", 0.12], ["social", 0.7], ["regular", 0.18]]),
    hasKids,
    wantsKids: age > 45 ? (r.bool(0.85) ? "no" : "open") : r.weighted<WantsKids>([["yes", 0.42], ["no", 0.23], ["open", 0.35]]),
    religion, religionImportance: religion === "none" ? 0 : r.weighted([[1, 0.4], [2, 0.35], [3, 0.25]] as const),
    politics: r.weighted<Politics>([["left", 0.6], ["moderate", 0.28], ["right", 0.12]]),
  };
}

/** True when `v` (the other person's values) hits dealbreaker `d`. */
export function violates(d: Dealbreaker, v: Values): boolean {
  switch (d) {
    case "smoker": return v.smoking === "regular";
    case "heavy_drinker": return v.drinking === "regular";
    case "has_kids": return v.hasKids;
    case "wants_kids": return v.wantsKids === "yes";
    case "no_kids_ever": return v.wantsKids === "no";
    case "religious": return v.religionImportance >= 2;
    case "nonreligious": return v.religionImportance === 0;
    case "right_politics": return v.politics === "right";
    case "left_politics": return v.politics === "left";
  }
}

function drawDealbreakers(r: Rng, v: Values): Dealbreaker[] {
  const out: Dealbreaker[] = [];
  if (v.smoking === "never" && r.bool(0.45)) out.push("smoker");
  if (v.drinking !== "regular" && r.bool(0.15)) out.push("heavy_drinker");
  if (!v.hasKids && r.bool(0.12)) out.push("has_kids");
  if (v.wantsKids === "no" && r.bool(0.5)) out.push("wants_kids");
  if (v.wantsKids === "yes" && r.bool(0.5)) out.push("no_kids_ever");
  if (v.religionImportance === 0 && r.bool(0.15)) out.push("religious");
  if (v.religionImportance >= 2 && r.bool(0.4)) out.push("nonreligious");
  if (v.politics === "left" && r.bool(0.35)) out.push("right_politics");
  if (v.politics === "right" && r.bool(0.25)) out.push("left_politics");
  return out;
}

function drawAvailability(r: Rng): Availability {
  const freeEves = new Set(r.sample([0, 1, 2, 3, 4], r.int(1, 3)));
  const slotFree = SLOTS.map((s, i) => {
    if (i <= 4) return freeEves.has(i) ? 0.85 : 0.15;
    return s.endsWith("day") ? r.range(0.35, 0.75) : r.range(0.3, 0.7);
  });
  return { slotFree, shock: 0.15 };
}

/**
 * Generate personas for every city, deterministic in `seed`. `perCity` personas live in each city
 * (home zip there); some date in several cities or travel during the run.
 */
export function generateSlopPersonas(opts: SlopGenOptions): SlopPersona[] {
  const perCity = opts.perCity ?? SLOP_DEFAULTS.perCity;
  const cities = opts.cities ?? SLOP_CITIES;
  const weeks = opts.weeks ?? SLOP_DEFAULTS.weeks;
  const minorShare = opts.minorShare ?? SLOP_DEFAULTS.minorShare;
  const liarShare = opts.minorLiarShare ?? SLOP_DEFAULTS.minorLiarShare;
  const advShares = { ...SLOP_DEFAULTS.adversaryShares, ...(opts.adversaryShares ?? {}) };
  const mix = { ...SLOP_DEFAULTS.richnessMix, ...(opts.richnessMix ?? {}) };
  const root = new Rng(hash32("slop-world", opts.seed));
  const out: SlopPersona[] = [];
  for (const city of cities) {
    const cr = root.fork("city", city);
    const nMinor = Math.round(perCity * minorShare);
    // Fixed-quota slots so every city gets the same composition at any seed.
    const slots = cr.fork("slots").shuffle([...Array(perCity).keys()]);
    const role = new Map<number, AdversaryKind | "minor">();
    let k = 0;
    for (let i = 0; i < nMinor; i++) role.set(slots[k++]!, i < Math.round(nMinor * liarShare) ? "age_liar" : "minor");
    for (const kind of ["romance_scammer", "catfish", "harasser", "not_single"] as const)
      for (let i = 0; i < Math.round(perCity * advShares[kind]); i++) role.set(slots[k++]!, kind);
    const tierOrder = cr.fork("tiers").shuffle([...Array(perCity).keys()]);
    const tierOf = new Map<number, RichnessTier>();
    let acc = 0, ti = 0;
    const tiers = Object.entries(mix) as [RichnessTier, number][];
    const total = tiers.reduce((s, [, w]) => s + w, 0);
    for (const [tier, w] of tiers) { acc += w / total; while (ti < Math.round(acc * perCity)) tierOf.set(tierOrder[ti++]!, tier); }
    for (let i = 0; i < perCity; i++) {
      out.push(makePersona(`${city}-${String(i).padStart(3, "0")}`, city, cr.fork("p", i), role.get(i), tierOf.get(i) ?? "medium", weeks, opts, cities));
    }
  }
  return out;
}

function makePersona(id: string, city: SlopCity, r: Rng, role: AdversaryKind | "minor" | undefined, richness: RichnessTier, weeks: number, opts: SlopGenOptions, cities: readonly SlopCity[]): SlopPersona {
  const minor = role === "minor" || role === "age_liar";
  const trueAge = minor ? r.int(13, 17) : drawAge(r);
  const claimedAge = role === "age_liar" ? r.int(18, 20) : trueAge;
  const ageForPrefs = claimedAge;
  const { g, id: identity, o, seeks } = drawGender(r);
  const home = r.pick(zipsIn(city));
  const statedRange = statedAgeRange(g, ageForPrefs, r);
  // Revealed range: the stated one, a little wider for less desirable people (they date outside it).
  const desirability = r.normal(0, 1) + ageDesirability(g, trueAge) + (role === "romance_scammer" || role === "catfish" ? 0.8 : 0);
  const widen = desirability < 0 ? 2 : 0;
  const ageRange: [number, number] = [Math.max(18, statedRange[0] - widen), statedRange[1] + widen];
  const maxMiles = r.weighted([[5, 0.2], [10, 0.35], [25, 0.3], [50, 0.15]] as const);
  // Location scope: most date in their city; some within a radius of their zip; a few in several cities.
  const multi = !minor && r.bool(opts.multiCityShare ?? SLOP_DEFAULTS.multiCityShare);
  const traveler = !minor && !multi && r.bool(opts.travelerShare ?? SLOP_DEFAULTS.travelerShare);
  const other = r.pick(cities.filter(c => c !== city).length ? cities.filter(c => c !== city) : [city]);
  const scope: LocationScope = multi ? { mode: "multi_city", cities: [city, other] }
    : r.bool(0.45) ? { mode: "radius", zip: home.zip, miles: maxMiles } : { mode: "city" };
  const allWeeks = [...Array(weeks).keys()];
  let presence: HiddenTruth["presence"] = [{ city, weeks: allWeeks }];
  if (multi) { const away = allWeeks.filter(w => w % 2 === 1); presence = [{ city, weeks: allWeeks.filter(w => !away.includes(w)) }, { city: other, weeks: away }]; }
  else if (traveler) { const w = r.int(0, Math.max(0, weeks - 1)); presence = [{ city, weeks: allWeeks.filter(x => x !== w) }, { city: other, weeks: [w] }]; }
  const traits = TASTE_DIMS.map(() => r.normal(0, 1));
  const taste = unit(TASTE_DIMS.map(() => r.normal(0, 1)));
  // Stated type: weakly correlated with revealed taste (r about 0.35).
  const noise = unit(TASTE_DIMS.map(() => r.normal(0, 1)));
  const wantsTraits = unit(taste.map((t, i) => 0.35 * t + 0.94 * noise[i]!));
  const selfTraits = traits.map(t => t + r.normal(0, 0.8));
  const goal = r.weighted<Goal>([["long_term", 0.45], ["casual", 0.25], ["unsure", 0.3]]);
  const values = drawValues(r, trueAge);
  const dealbreakers = drawDealbreakers(r, values);
  // Stated dealbreakers: most real ones, plus a soft one people say but do not hold.
  const statedDealbreakers = dealbreakers.filter(() => r.bool(0.85));
  const soft = r.pick(DEALBREAKERS);
  if (r.bool(0.3) && !statedDealbreakers.includes(soft) && !violates(soft, values)) statedDealbreakers.push(soft);
  const interestDefs = r.sample(INTERESTS.filter(t => t.cluster !== "family" || trueAge > 25), r.int(3, 6));
  const interests = interestDefs.map(t => t.tag);
  const actPool = Array.from(new Set(interestDefs.flatMap(t => ACTIVITY_BY_CLUSTER[t.cluster] ?? ["coffee"])));
  const activities = Array.from(new Set([...r.sample(actPool, r.int(2, 4)), r.pick<DateActivity>(["coffee", "drinks", "walk"])]));
  const availability = drawAvailability(r);
  const usuallyFree = SLOTS.filter((_, i) => availability.slotFree[i]! >= 0.5 ? r.bool(0.9) : r.bool(0.1));
  const statedGoal: Goal = goal === "unsure" && r.bool(0.4) ? "long_term" : goal;
  const name = `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
  const occupation = minor ? "student" : r.pick(OCCUPATIONS);
  const adversary: AdversaryKind | undefined = role === "minor" ? undefined : role;
  const hidden: HiddenTruth = {
    trueAge, isMinor: minor, matchGender: g, identity, orientation: o, seeks, ageRange,
    homeZip: home.zip, homeCity: city, scope, maxMiles, presence,
    desirability, warmth: r.normal(0, 0.6), traits, taste,
    goal: adversary === "romance_scammer" ? "long_term" : goal, values, dealbreakers, interests, activities,
    appetite: Math.min(0.95, Math.max(0.1, (goal === "casual" ? 0.62 : goal === "long_term" ? 0.55 : 0.42) + r.normal(0, 0.15))),
    availability,
    replyProb: adversary === "romance_scammer" ? 0.98 : Math.min(0.98, Math.max(0.35, r.normal(0.82, 0.12))),
    latencyMedianMin: Math.round(r.logNormal(45, 1)),
    flakiness: adversary === "romance_scammer" ? 0.85 : adversary === "catfish" ? 0.5 : Math.min(0.4, Math.max(0.02, r.logNormal(0.08, 0.6))),
    honesty: Math.min(1, Math.max(0.6, r.normal(0.9, 0.08))),
    richness, adversary,
    canary: `CANARY-${hash32("canary", id, String(opts.seed)).toString(36)}`,
  };
  const stated: StatedProfile = {
    claimedAge, matchGender: g, identity, orientation: o, seeks: [...seeks], ageRange: statedRange,
    homeZip: home.zip, scope, maxMiles, goal: adversary === "romance_scammer" ? "long_term" : statedGoal, values: { ...values },
    dealbreakers: statedDealbreakers, selfTraits, wantsTraits, interests: [...interests], activities: [...activities],
    usuallyFree, relationshipStatus: "single", occupation,
    bio: templateBio(name, occupation, home.area, interests, activities),
  };
  return { id, name, hidden, stated };
}

/** Template bio (the world runs fully without the LLM; prose.ts can replace it). */
export function templateBio(name: string, occupation: string, area: string, interests: string[], activities: DateActivity[]): string {
  const first = name.split(" ")[0];
  const label = (t: string) => INTERESTS.find(i => i.tag === t)?.label ?? t.replace(/_/g, " ");
  return `${first} is a ${occupation} in ${area}. Into ${interests.slice(0, 3).map(label).join(", ")}. Ideal first date: ${activities[0]!.replace(/_/g, " ")}.`;
}

/** Cities a persona is physically in during `week` (hidden truth). */
export function citiesInWeek(p: SlopPersona, week: number): SlopCity[] {
  return p.hidden.presence.filter(x => x.weeks.includes(week)).map(x => x.city);
}

/** Zip a persona is located at when in `city` (home zip at home, the city's anchor otherwise). */
export function zipIn(p: SlopPersona, city: SlopCity, stated = true): string {
  const home = stated ? p.stated.homeZip : p.hidden.homeZip;
  return zipInfo.get(home)?.city === city ? home : CITY_ANCHOR_ZIP[city];
}

/** Fairness group label: matching gender and orientation (e.g. "woman:bisexual"). */
export const groupOf = (p: SlopPersona): string => `${p.stated.matchGender}:${p.stated.orientation}`;
