// What friends.help reads about a member beyond the core MemberIndex: home and often-around
// neighborhoods (Presence areas), the stated travel tolerance, verification results, safety cues and
// standing availability. Agent-private facets (verification, safety cues, travel tolerance,
// availability) are read for hard filters only; they are never shown and never matched on. Cached
// per World (the World is immutable).
import type { MemberId } from "@thenetwork/core";
import type { StandingAvailability } from "../../attention.ts";
import type { World } from "../../world.ts";
import { hood, type Neighborhood } from "./geo.ts";

/** Facet tag vocabulary friends.help writes at onboarding (the simulator's snapshot uses the same). */
export const FT = {
  maxTravel: "friends:max_travel:", free: "friends:free:", groupPref: "friends:group_pref:", energy: "friends:energy:",
  lifeStage: "friends:life_stage:", newToCity: "friends:new_to_city", liveness: "verify:liveness:", age: "verify:age:", safety: "safety:", reviewCleared: "review:cleared",
} as const;

/** Weekly slots friends.help asks about ("usually free Tue evenings, Saturday mornings"): local start hour per slot. */
export const FRIENDS_SLOTS = ["mon_eve", "tue_eve", "wed_eve", "thu_eve", "fri_eve", "sat_am", "sat_pm", "sat_eve", "sun_am", "sun_pm", "sun_eve"] as const;
export type FriendsSlot = (typeof FRIENDS_SLOTS)[number];
/** JS weekday (0 = Sunday) and local start hour of each slot (attention templates: weekday 19, weekend 10 / 14 / 19). */
export const SLOT_TIME: Record<FriendsSlot, { day: number; hour: number }> = {
  mon_eve: { day: 1, hour: 19 }, tue_eve: { day: 2, hour: 19 }, wed_eve: { day: 3, hour: 19 }, thu_eve: { day: 4, hour: 19 }, fri_eve: { day: 5, hour: 19 },
  sat_am: { day: 6, hour: 10 }, sat_pm: { day: 6, hour: 14 }, sat_eve: { day: 6, hour: 19 }, sun_am: { day: 0, hour: 10 }, sun_pm: { day: 0, hour: 14 }, sun_eve: { day: 0, hour: 19 },
};

export interface FriendsInfo {
  home?: Neighborhood; often: Neighborhood[];
  /** Stated max one-way transit minutes (default 40 when not stated). */
  tolerance: number;
  /** Liveness and age assurance both passed (fail closed: absent = not verified). */
  verified: boolean;
  /** A safety cue the agent observed that a human reviewer has not cleared (held from matching). */
  safetyCue: boolean;
  groupPref?: string; energy?: string; lifeStage?: string;
  standing: StandingAvailability[];
}

/**
 * The one value a passed check has: verify:<check>:pass, as the staff verify path
 * (packages/network/service/service.ts verify) and slop write it. Anything else (fail, pending, the
 * older "passed") is not verified: fail closed.
 */
export const VERIFY_PASS = "pass";
/** The tag value of a check result (the simulator's personas say passed / failed / pending). */
export const verifyTag = (r: "passed" | "failed" | "pending" | "pass" | "fail") => (r === "passed" || r === "pass" ? "pass" : r === "failed" || r === "fail" ? "fail" : "pending");

export const DEFAULT_TOLERANCE = 40;
const cache = new WeakMap<World, Map<MemberId, FriendsInfo>>();

/** All tags of a member's facets, any scope (agent-side reads only). */
function tagsBy(w: World): Map<MemberId, string[]> {
  const out = new Map<MemberId, string[]>();
  for (const f of w.input.facets) {
    const id = w.canonical(f.memberId);
    if (f.validTo !== undefined && f.validTo < w.now) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(...f.tags);
  }
  return out;
}

export function standingFromTags(tags: readonly string[], statedAt: number): StandingAvailability[] {
  const out: StandingAvailability[] = [];
  for (const t of tags) {
    if (!t.startsWith(FT.free)) continue;
    const s = SLOT_TIME[t.slice(FT.free.length) as FriendsSlot];
    if (s) out.push({ byDay: [s.day], startHour: s.hour, endHour: s.hour + 3, source: "onboarding", statedAt });
  }
  return out;
}

export function friendsInfo(w: World): Map<MemberId, FriendsInfo> {
  let m = cache.get(w);
  if (m) return m;
  m = new Map();
  const tags = tagsBy(w);
  for (const id of w.ids) {
    const mi = w.get(id)!;
    const ts = tags.get(id) ?? [];
    const pres = mi.presence.filter(p => p.city === "nyc");
    const homeP = pres.find(p => p.type === "home");
    const home = hood(homeP?.areas[0]);
    const often = pres.flatMap(p => (p === homeP ? p.areas.slice(1) : p.areas)).map(hood).filter((x): x is Neighborhood => !!x);
    const val = (pre: string) => ts.find(t => t.startsWith(pre))?.slice(pre.length);
    const tol = Number(val(FT.maxTravel));
    m.set(id, {
      home, often, tolerance: Number.isFinite(tol) && tol > 0 ? tol : DEFAULT_TOLERANCE,
      verified: val(FT.liveness) === VERIFY_PASS && val(FT.age) === VERIFY_PASS,
      safetyCue: ts.some(t => t.startsWith(FT.safety)) && !ts.includes(FT.reviewCleared),
      groupPref: val(FT.groupPref), energy: val(FT.energy), lifeStage: val(FT.lifeStage),
      standing: standingFromTags(ts, mi.m.joinedAt),
    });
  }
  cache.set(w, m);
  return m;
}
