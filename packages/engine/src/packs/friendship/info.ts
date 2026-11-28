import { getCity, type City, type Facet, type MemberId } from "@thenetwork/core";
import type { StandingAvailability } from "../../attention.ts";
import type { World } from "../../world.ts";
import { friendOpennessUnanswered, type FriendOpenness, type FriendStatement, type StatedGender } from "../../../../core/src/generated/mutualOpenness.ts";
import { FRIENDS_CITY, hoodForCity, type Neighborhood } from "./geo.ts";

export const FT = {
  maxTravel: "friends:max_travel:", free: "friends:free:", groupPref: "friends:group_pref:", energy: "friends:energy:",
  lifeStage: "friends:life_stage:", newToCity: "friends:new_to_city", gender: "friends:gender:", openGender: "friends:open_gender:", liveness: "verify:liveness:", age: "verify:age:", safety: "safety:", reviewCleared: "review:cleared",
} as const;

export const FTT = {
  maxTravel: "friendship:max_travel:", free: "friendship:free:", groupPref: "friendship:group_pref:", energy: "friendship:energy:",
  lifeStage: "friendship:life_stage:", newToCity: "friendship:new_to_city", gender: "friendship:gender:", openGender: "friendship:open_gender:", liveness: "verify:liveness:", age: "verify:age:", safety: "safety:", reviewCleared: "review:cleared",
} as const;

export const FRIENDSHIP_SLOTS = ["mon_eve", "tue_eve", "wed_eve", "thu_eve", "fri_eve", "sat_am", "sat_pm", "sat_eve", "sun_am", "sun_pm", "sun_eve"] as const;
export const FRIENDS_SLOTS = FRIENDSHIP_SLOTS;
export type FriendshipSlot = (typeof FRIENDSHIP_SLOTS)[number];
export type FriendsSlot = FriendshipSlot;
export const SLOT_TIME: Record<FriendshipSlot, { day: number; hour: number }> = {
  mon_eve: { day: 1, hour: 19 }, tue_eve: { day: 2, hour: 19 }, wed_eve: { day: 3, hour: 19 }, thu_eve: { day: 4, hour: 19 }, fri_eve: { day: 5, hour: 19 },
  sat_am: { day: 6, hour: 10 }, sat_pm: { day: 6, hour: 14 }, sat_eve: { day: 6, hour: 19 }, sun_am: { day: 0, hour: 10 }, sun_pm: { day: 0, hour: 14 }, sun_eve: { day: 0, hour: 19 },
};

export interface FriendshipInfo {
  city?: City;
  home?: Neighborhood; often: Neighborhood[];
  tolerance: number;
  verified: boolean;
  safetyCue: boolean;
  groupPref?: string; energy?: string; lifeStage?: string;
  friend: FriendStatement;
  standing: StandingAvailability[];
}
export type FriendsInfo = FriendshipInfo;

const FRIEND_GENDER: Readonly<Record<string, StatedGender>> = { woman: "GenderWoman", man: "GenderMan", nonbinary: "GenderNonbinary" };
const FRIEND_OPENNESS: Readonly<Record<string, FriendOpenness>> = { women: "FriendsWithWomen", men: "FriendsWithMen", anyone: "FriendsWithAnyone" };
function friendStatementOf(gender: string | undefined, openGender: string | undefined): FriendStatement {
  return { friendGender: FRIEND_GENDER[gender ?? ""] ?? "GenderUnstated", friendOpenness: FRIEND_OPENNESS[openGender ?? ""] ?? friendOpennessUnanswered };
}

export const VERIFY_PASS = "pass";
export const verifyTag = (r: "passed" | "failed" | "pending" | "pass" | "fail") => (r === "passed" || r === "pass" ? "pass" : r === "failed" || r === "fail" ? "fail" : "pending");
export function friendshipStaffVerified(tags: readonly string[]): boolean {
  return tags.find(t => t.startsWith(FT.age)) === `${FT.age}${VERIFY_PASS}`
    && tags.find(t => t.startsWith(FT.liveness)) === `${FT.liveness}${VERIFY_PASS}`;
}
export const friendsStaffVerified = friendshipStaffVerified;

export const DEFAULT_TOLERANCE = 40;
const cache = new WeakMap<World, Map<MemberId, FriendshipInfo>>();

function facetsBy(w: World): Map<MemberId, Facet[]> {
  const out = new Map<MemberId, Facet[]>();
  for (const f of w.input.facets) {
    const id = w.canonical(f.memberId);
    if (f.validFrom !== undefined && f.validFrom > w.now) continue;
    if (f.validTo !== undefined && f.validTo < w.now) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(f);
  }
  return out;
}

function standingFromTags(tags: readonly string[], statedAt: number): StandingAvailability[] {
  const out: StandingAvailability[] = [];
  for (const t of tags) {
    const raw = t.startsWith(FTT.free) ? t.slice(FTT.free.length) : t.startsWith(FT.free) ? t.slice(FT.free.length) : undefined;
    if (raw === undefined) continue;
    const s = SLOT_TIME[raw as FriendshipSlot];
    if (s) out.push({ byDay: [s.day], startHour: s.hour, endHour: s.hour + 3, source: "onboarding", statedAt });
  }
  return out;
}

export function friendshipInfo(w: World): Map<MemberId, FriendshipInfo> {
  let m = cache.get(w);
  if (m) return m;
  m = new Map();
  const facets = facetsBy(w);
  for (const id of w.ids) {
    const mi = w.get(id)!;
    const fs = facets.get(id) ?? [];
    const ts = fs.flatMap(f => f.tags);
    const matchableTs = fs.filter(f => f.scope === "matchable" || f.scope === "shareable").flatMap(f => f.tags);
    const city: City = getCity(mi.m.homeCity) ? mi.m.homeCity : FRIENDS_CITY;
    const pres = mi.presence.filter(p => p.city === city);
    const homeP = pres.find(p => p.type === "home");
    const home = hoodForCity(city, homeP?.areas[0]);
    const often = pres.flatMap(p => (p === homeP ? p.areas.slice(1) : p.areas)).map(a => hoodForCity(city, a)).filter((x): x is Neighborhood => !!x);
    const val = (k: keyof typeof FT) =>
      ts.find(t => t.startsWith(FTT[k]))?.slice(FTT[k].length) ?? ts.find(t => t.startsWith(FT[k]))?.slice(FT[k].length);
    const matchVal = (k: keyof typeof FT) =>
      matchableTs.find(t => t.startsWith(FTT[k]))?.slice(FTT[k].length) ?? matchableTs.find(t => t.startsWith(FT[k]))?.slice(FT[k].length);
    const tol = Number(val("maxTravel"));
    m.set(id, {
      city, home, often, tolerance: Number.isFinite(tol) && tol > 0 ? tol : DEFAULT_TOLERANCE,
      verified: friendshipStaffVerified(ts),
      safetyCue: ts.some(t => t.startsWith(FT.safety)) && !ts.includes(FT.reviewCleared),
      groupPref: val("groupPref"), energy: val("energy"), lifeStage: matchVal("lifeStage"),
      friend: friendStatementOf(val("gender"), val("openGender")),
      standing: fs.flatMap(f => standingFromTags(f.tags, f.observedAt ?? f.validFrom ?? mi.m.joinedAt)),
    });
  }
  cache.set(w, m);
  return m;
}
export const friendsInfo = friendshipInfo;
