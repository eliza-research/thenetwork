// Read a slop snapshot back into a typed dating profile per member: the reader the slop AppPack can
// use (or copy). It reads ONLY the snapshot, so anything it returns is agent-visible.
import { canBeMatched, type Facet, type MemberId } from "@thenetwork/core";
import { distanceBucket, zipInfo, zipMiles, CITY_ANCHOR_ZIP, type DistanceBucket, type SlopCity } from "./geo.ts";
import { SLOTS, TASTE_DIMS, type DateActivity, type Dealbreaker, type Goal, type LocationScope, type MatchGender, type Slot } from "./persona.ts";
import type { SlopSnapshot } from "./snapshot.ts";

export interface VisibleProfile {
  id: MemberId; name: string; age: number; matchable: boolean; paused: boolean;
  homeZip: string; homeCity: SlopCity;
  matchGender?: MatchGender; seeks: MatchGender[];
  /** Undefined when the agent has not asked yet (minimal tier). */
  ageRange?: [number, number]; scope?: LocationScope; maxMiles?: number; goal?: Goal;
  values: Record<string, string>; dealbreakers: Dealbreaker[];
  interests: string[]; shareableInterests: string[]; activities: DateActivity[]; usuallyFree: Slot[];
  wantsTraits?: number[]; selfTraits?: number[];
  safetySignals: string[];
  /** Temporary presence this week (announced trips). */
  visiting: SlopCity[];
}

/** Defaults a matcher may assume for a field the agent has not learned yet (documented in the doc). */
export const UNKNOWN_DEFAULTS = { ageSpread: 7, maxMiles: 25 };

const num = (t: string) => Number(t.slice(t.indexOf("=") + 1));

export function visibleProfiles(s: SlopSnapshot): Map<MemberId, VisibleProfile> {
  const byMember = new Map<MemberId, Facet[]>();
  for (const f of s.facets) { const l = byMember.get(f.memberId) ?? []; l.push(f); byMember.set(f.memberId, l); }
  const out = new Map<MemberId, VisibleProfile>();
  for (const m of s.members) {
    const tags = (byMember.get(m.id) ?? []).flatMap(f => f.tags.map(t => ({ t, f })));
    const has = (prefix: string) => tags.filter(x => x.t.startsWith(prefix)).map(x => x.t.slice(prefix.length));
    const zip = has("slop:zip:")[0] ?? "";
    const age = has("romance:age:")[0];
    const sc = has("slop:scope:")[0];
    const scope: LocationScope | undefined = !sc ? undefined : sc === "city" ? { mode: "city" }
      : sc.startsWith("radius:") ? { mode: "radius", zip, miles: Number(sc.slice(7)) }
      : { mode: "multi_city", cities: sc.slice(6).split(",") as SlopCity[] };
    const values: Record<string, string> = {};
    for (const k of ["smoking", "drinking", "has_kids", "wants_kids", "religion", "religion_importance", "politics"]) {
      const v = has(`slop:${k}:`)[0];
      if (v !== undefined) values[k] = v;
    }
    const wants = has("slop:wants:"), self = has("slop:self:");
    const interestFacets = (byMember.get(m.id) ?? []).filter(f => f.kind === "interest");
    out.set(m.id, {
      id: m.id, name: m.name, age: m.age, matchable: canBeMatched(m.age) && m.prefs.romanceOptIn, paused: m.state === "paused",
      homeZip: zip, homeCity: (zipInfo.get(zip)?.city ?? m.homeCity) as SlopCity,
      matchGender: has("romance:is:")[0] as MatchGender | undefined, seeks: has("romance:seeks:") as MatchGender[],
      ageRange: age ? (age.split("-").map(Number) as [number, number]) : undefined,
      scope, maxMiles: has("slop:max_miles:")[0] ? Number(has("slop:max_miles:")[0]) : undefined,
      goal: has("slop:goal:")[0] as Goal | undefined, values,
      dealbreakers: has("slop:dealbreaker:") as Dealbreaker[],
      interests: interestFacets.map(f => f.tags[0]!), shareableInterests: interestFacets.filter(f => f.scope === "shareable").map(f => f.tags[0]!),
      activities: has("slop:activity:") as DateActivity[], usuallyFree: has("slop:free:") as Slot[],
      wantsTraits: wants.length === TASTE_DIMS.length ? wants.map(num) : undefined,
      selfTraits: self.length === TASTE_DIMS.length ? self.map(num) : undefined,
      safetySignals: tags.filter(x => x.t.startsWith("safety:")).map(x => x.t),
      visiting: s.presence.filter(p => p.memberId === m.id && p.type === "temporary" && (p.from ?? 0) <= s.now && s.now < (p.to ?? Infinity)).map(p => p.city as unknown as SlopCity),
    });
  }
  return out;
}

/** Cities a member dates in, as visible (a known multi-city scope, else the home city, plus a trip this week). */
export function visibleCities(v: VisibleProfile): SlopCity[] {
  const base = v.scope?.mode === "multi_city" ? v.scope.cities : [v.homeCity];
  return Array.from(new Set([...base, ...v.visiting]));
}
const zipFor = (v: VisibleProfile, c: SlopCity) => (v.homeCity === c ? v.homeZip : CITY_ANCHOR_ZIP[c]);
const limitOf = (v: VisibleProfile) => (v.scope?.mode === "radius" ? v.scope.miles : v.maxMiles ?? UNKNOWN_DEFAULTS.maxMiles);
const rangeOf = (v: VisibleProfile): [number, number] => v.ageRange ?? [Math.max(18, v.age - UNKNOWN_DEFAULTS.ageSpread), v.age + UNKNOWN_DEFAULTS.ageSpread];

/**
 * Visible mutual filter: both matchable adults (claimed age), not paused, each in the other's
 * stated gender preferences and age range (UNKNOWN_DEFAULTS when not yet asked), and a city both
 * date in with each other inside both distance limits. Returns the cities where they could meet.
 */
export function visibleMutualCities(a: VisibleProfile, b: VisibleProfile): SlopCity[] {
  if (a.id === b.id || !a.matchable || !b.matchable || a.paused || b.paused) return [];
  if (!a.matchGender || !b.matchGender || !a.seeks.includes(b.matchGender) || !b.seeks.includes(a.matchGender)) return [];
  const [alo, ahi] = rangeOf(a), [blo, bhi] = rangeOf(b);
  if (b.age < alo || b.age > ahi || a.age < blo || a.age > bhi) return [];
  const out: SlopCity[] = [];
  for (const c of visibleCities(a)) {
    if (!visibleCities(b).includes(c)) continue;
    const d = zipMiles(zipFor(a, c), zipFor(b, c));
    if (d <= limitOf(a) && d <= limitOf(b)) out.push(c);
  }
  return out;
}

/** The only distance shown to members. */
export function shownDistance(a: VisibleProfile, b: VisibleProfile, city: SlopCity): DistanceBucket {
  return distanceBucket(zipMiles(zipFor(a, city), zipFor(b, city)));
}

/** Stated dealbreaker hit, from visible values only (unknown values never count as a hit). */
export function visibleDealbreakerHit(a: VisibleProfile, b: VisibleProfile): boolean {
  const v = b.values;
  return a.dealbreakers.some(d =>
    (d === "smoker" && v.smoking === "regular") || (d === "heavy_drinker" && v.drinking === "regular") ||
    (d === "has_kids" && v.has_kids === "yes") || (d === "wants_kids" && v.wants_kids === "yes") ||
    (d === "no_kids_ever" && v.wants_kids === "no") || (d === "religious" && Number(v.religion_importance) >= 2) ||
    (d === "nonreligious" && v.religion_importance === "0") || (d === "right_politics" && v.politics === "right") ||
    (d === "left_politics" && v.politics === "left"));
}

export const slotIndex = (s: Slot) => SLOTS.indexOf(s);
