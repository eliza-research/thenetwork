import type { City, MemberId } from "@thenetwork/core";
import { laneLimits, laneWeights } from "../../../../core/src/generated/matchLane.ts";
import { friendAdmits, friendOpennessUnanswered, type FriendStatement, type StatedGender } from "../../../../core/src/generated/mutualOpenness.ts";
import { standingMiddle } from "../../../../core/src/generated/memberStanding.ts";
import { directedUtility, pairValueScale } from "../../../../core/src/generated/pairValue.ts";
import { isMinor, memberReason } from "../../filters.ts";
import { discretionGateOk, humanVectorOf, memberMayHavePositiveVectorBonus, spendTierCompatible, spendTierRank, type HumanVector } from "../../humanVector.ts";
import { intersectCount } from "../../match/pair.ts";
import type { EntitySegment, MatchEntity, MatchProfile, PackVectors } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { cityNeighborhoods, FRIENDS_CITY, FRIENDS_EXCLUDED_ACTIVITIES, transitMinutesInCity, withinTransitTolerance, type Neighborhood } from "./geo.ts";
import { friendsInfo } from "./info.ts";

export const FRIENDS_ACTIVITY_TAGS: ReadonlySet<string> = new Set(ACTIVITIES.filter(a => !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)).flatMap(a => a.tags));

const SEEK_KINDS = new Set(["desire", "goal"]);
const OFFER_KINDS = new Set(["skill", "offer", "resource"]);
const ENERGY: ReadonlyMap<string, number> = new Map([["low", 0], ["mid", 1], ["high", 2]]);
const MIDDLE_ENERGY = 1;
const KM_PER_DEGREE_NORTH = 111;
const KM_PER_DEGREE_EAST = 84;

function weekendLean(w: World, id: MemberId): number {
  const days = (friendsInfo(w).get(id)?.standing ?? []).flatMap(s => s.byDay);
  if (days.length === 0) return 500;
  return Math.floor((1000 * days.filter(d => d === 0 || d === 6).length) / days.length);
}

const homeOf = (w: World, id: MemberId) => friendsInfo(w).get(id)?.home;

const TOLERANCE_CLASSES = [10, 15, 20, 30, 40, 60, 90, 120] as const;
const toleranceClass = (tolerance: number): number => {
  const k = TOLERANCE_CLASSES.findIndex(bound => tolerance <= bound);
  return k < 0 ? TOLERANCE_CLASSES.length : k;
};
const classBound = (k: number): number => TOLERANCE_CLASSES[k] ?? Infinity;
const homeSegment = (home: Neighborhood, k: number, gender: StatedGender): string => `${home.id}|${k}|${gender}`;
const FRIEND_GENDERS: readonly StatedGender[] = ["GenderWoman", "GenderMan", "GenderNonbinary", "GenderUnstated"];
const reachableByRun = new WeakMap<World, Map<string, EntitySegment>>();

function friendsSegment(w: World, city: City, home: Neighborhood, tolerance: number, friend: FriendStatement): EntitySegment {
  let reachable = reachableByRun.get(w);
  if (!reachable) { reachable = new Map(); reachableByRun.set(w, reachable); }
  const key = `${city}|${home.id}|${tolerance}|${friend.friendGender}|${friend.friendOpenness}`;
  const known = reachable.get(key);
  if (known) return known;
  const genders = FRIEND_GENDERS.filter(g => friendAdmits(friend, { friendGender: g, friendOpenness: friendOpennessUnanswered }));
  const partners = new Set<string>();
  for (const other of cityNeighborhoods(city)) {
    const minutes = transitMinutesInCity(city, home, other);
    for (let k = 0; k <= TOLERANCE_CLASSES.length; k++) {
      if (withinTransitTolerance(minutes, tolerance, classBound(k))) for (const g of genders) partners.add(homeSegment(other, k, g));
    }
  }
  const segment = { own: homeSegment(home, toleranceClass(tolerance), friend.friendGender), partners: [...partners].sort() };
  reachable.set(key, segment);
  return segment;
}

function lifeStageKey(w: World, id: MemberId, v: HumanVector): string | undefined {
  if (v.explicitSignals.lifeStage) return v.horizontal.lifeStage;
  return friendsInfo(w).get(id)?.lifeStage?.trim().toLowerCase() || undefined;
}

function baseFriendUtility(a: MatchProfile, b: MatchProfile): number {
  const ta = a.traits, tb = b.traits;
  const d0 = Math.abs(ta[0]! - tb[0]!) * 50;
  const d1 = Math.abs(ta[1]! - tb[1]!) * 50;
  const d2 = Math.abs(ta[2]! - tb[2]!);
  const d3 = Math.abs(ta[3]! - tb[3]!) * 250;
  const c0 = d0 < pairValueScale ? pairValueScale - d0 : 0;
  const c1 = d1 < pairValueScale ? pairValueScale - d1 : 0;
  const c2 = d2 < pairValueScale ? pairValueScale - d2 : 0;
  const c3 = d3 < pairValueScale ? pairValueScale - d3 : 0;
  const closeness = (c0 + c1 + c2 + c3) >> 2;
  const comp = a.seeks.length > 0 ? Math.floor((pairValueScale * intersectCount(a.seeks, b.offers)) / a.seeks.length) : 0;
  const aff = a.interests.length > 0 ? Math.floor((pairValueScale * intersectCount(a.interests, b.interests)) / a.interests.length) : 0;
  return Math.floor((comp + 6 * aff + 2 * closeness) / 9);
}

function friendsPackValue(w: World, a: MatchProfile, b: MatchProfile): number {
  const base = baseFriendUtility(a, b);
  if (isMinor(w, a.memberId) || isMinor(w, b.memberId)) return base;
  const va = humanVectorOf(w, a.memberId);
  const vb = humanVectorOf(w, b.memberId);
  if (!va || !vb) return base;

  const ea = va.explicitSignals;
  const eb = vb.explicitSignals;
  const sharedGuild = va.exchange.guilds.length > 0 && vb.exchange.guilds.some(g => va.exchange.guilds.includes(g));
  const needsDiscretionCheck = ea.hypeOrExtraction || eb.hypeOrExtraction
    || va.capital.economic.value >= 0.9 || vb.capital.economic.value >= 0.9
    || va.capital.symbolic.publicityTier.value >= 0.65 || vb.capital.symbolic.publicityTier.value >= 0.65;
  if (needsDiscretionCheck) {
    const discOk = discretionGateOk(
      vb.capital.symbolic.publicityTier.value * 100,
      vb.capital.economic.value * 100,
      va.behavioral.discretionVouchScore * 100,
      va.behavioral.extractionRiskScore * 100,
      sharedGuild,
    ) && discretionGateOk(
      va.capital.symbolic.publicityTier.value * 100,
      va.capital.economic.value * 100,
      vb.behavioral.discretionVouchScore * 100,
      vb.behavioral.extractionRiskScore * 100,
      sharedGuild,
    );
    if (!discOk) return 0;
  }

  let delta = 0;
  if (ea.spendTier || eb.spendTier) {
    const tierA = va.horizontal.lifestyle.spendComfortTier;
    const tierB = vb.horizontal.lifestyle.spendComfortTier;
    const tierDiff = Math.abs(spendTierRank(tierA) - spendTierRank(tierB));
    if (!spendTierCompatible(tierA, tierB, sharedGuild)) return 0;
    if (sharedGuild && tierDiff >= 2) delta += 240;
    else if (ea.spendTier && eb.spendTier && tierDiff === 0) delta += 100;
  }

  const lsA = lifeStageKey(w, a.memberId, va);
  const lsB = lifeStageKey(w, b.memberId, vb);
  if (lsA && lsB && lsA === lsB) delta += 110;
  if (ea.depth && eb.depth) {
    const depthDiff = Math.abs(va.horizontal.communication.depthPreference.value - vb.horizontal.communication.depthPreference.value);
    delta += Math.round(100 * (1 - depthDiff));
  }
  if (ea.humor && eb.humor && va.horizontal.communication.humorRegister.some(h => vb.horizontal.communication.humorRegister.includes(h))) delta += 100;
  if (ea.transitions && eb.transitions && va.horizontal.activeTransitions.some(t => vb.horizontal.activeTransitions.includes(t))) delta += 100;
  if (ea.guilds && eb.guilds && sharedGuild) delta += 140;
  if ((ea.hypeOrExtraction || eb.hypeOrExtraction) && (!va.behavioral.dunbarSaturation.affinity50Open || !vb.behavioral.dunbarSaturation.affinity50Open)) {
    delta -= 100;
  }

  return Math.max(0, Math.min(pairValueScale, Math.round(base + delta)));
}

const FRIEND_UNTOUCHED_BASE_CAP = directedUtility([
  { weight: laneWeights("Friend").complement, value: 0 },
  { weight: laneWeights("Friend").affinity, value: 0 },
  { weight: laneWeights("Friend").closeness, value: pairValueScale },
]);

function friendsPackBound(w: World, a: MatchProfile, b: MatchProfile): number {
  const base = baseFriendUtility(a, b);
  if ((a.packClass ?? 0) === 0 && (b.packClass ?? 0) === 0) return base;
  if (isMinor(w, a.memberId) || isMinor(w, b.memberId)) return base;
  const va = humanVectorOf(w, a.memberId);
  const vb = humanVectorOf(w, b.memberId);
  if (!va || !vb) return base;
  const ea = va.explicitSignals;
  const eb = vb.explicitSignals;
  let bonus = 0;
  if (ea.spendTier || eb.spendTier) bonus += 240;
  if (lifeStageKey(w, a.memberId, va) && lifeStageKey(w, b.memberId, vb)) bonus += 110;
  if (ea.depth && eb.depth) bonus += 100;
  if (ea.humor && eb.humor) bonus += 100;
  if (ea.transitions && eb.transitions) bonus += 100;
  if (ea.guilds && eb.guilds) bonus += 140;
  return bonus === 0 ? base : Math.min(pairValueScale, base + bonus);
}

function friendsPackClass(w: World, entity: MatchEntity): number {
  if (isMinor(w, entity.memberId)) return 0;
  if (memberMayHavePositiveVectorBonus(w, entity.memberId, false)) return 1;
  return friendsInfo(w).get(entity.memberId)?.lifeStage ? 1 : 0;
}

function friendsPackClassCap(w: World, a: MatchProfile, partnerClass: number, untouched: boolean): number {
  if (!untouched) return pairValueScale;
  if ((a.packClass ?? 0) === 0 && partnerClass === 0) return FRIEND_UNTOUCHED_BASE_CAP;
  if (isMinor(w, a.memberId)) return FRIEND_UNTOUCHED_BASE_CAP;
  const va = humanVectorOf(w, a.memberId);
  if (!va) return FRIEND_UNTOUCHED_BASE_CAP;
  const ea = va.explicitSignals;
  if (partnerClass === 0) {
    return Math.min(pairValueScale, FRIEND_UNTOUCHED_BASE_CAP + (ea.spendTier ? 240 : 0));
  }
  let bonus = 240;
  if (lifeStageKey(w, a.memberId, va)) bonus += 110;
  if (ea.depth) bonus += 100;
  if (ea.humor) bonus += 100;
  if (ea.transitions) bonus += 100;
  if (ea.guilds) bonus += 140;
  return Math.min(pairValueScale, FRIEND_UNTOUCHED_BASE_CAP + bonus);
}

export const friendsVectors: PackVectors = {
  memberships(w, memberId) {
    const mi = w.get(memberId);
    const info = friendsInfo(w).get(memberId);
    if (!mi || !info?.home) return [];
    if (memberReason(w, memberId, { category: "social", role: "peer", format: "small_group", timeSensitive: false }) !== null) return [];
    return [{ id: memberId, lane: "Friend", side: "Peer", market: info.city ?? FRIENDS_CITY, capacity: laneLimits("Friend").weeklyCapacity - mi.recentProactive }];
  },
  tags(w, entity: MatchEntity) {
    const match = w.get(entity.memberId)?.match ?? [];
    const interests = match.flatMap(f => f.tags).filter(t => FRIENDS_ACTIVITY_TAGS.has(t));
    return {
      interests,
      seeks: match.filter(f => SEEK_KINDS.has(f.kind)).flatMap(f => f.tags),
      offers: [...interests, ...match.filter(f => OFFER_KINDS.has(f.kind)).flatMap(f => f.tags)],
    };
  },
  segment(w, entity) {
    const info = friendsInfo(w).get(entity.memberId);
    return info?.home ? friendsSegment(w, info.city ?? FRIENDS_CITY, info.home, info.tolerance, info.friend) : undefined;
  },
  standing: () => ({ standing: standingMiddle, uncertainty: 0 }),
  traits: {
    costs: [50, 50, 1, 250],
    of(w, entity) {
      const id = entity.memberId;
      const home = homeOf(w, id)!;
      return [
        Math.round(home.lat * KM_PER_DEGREE_NORTH),
        Math.round(home.lng * KM_PER_DEGREE_EAST),
        weekendLean(w, id),
        ENERGY.get(friendsInfo(w).get(id)?.energy ?? "") ?? MIDDLE_ENERGY,
      ];
    },
  },
  packValue: friendsPackValue,
  packBound: friendsPackBound,
  packClasses: { of: friendsPackClass, cap: friendsPackClassCap },
};
