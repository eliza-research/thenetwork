import type { MemberId } from "@thenetwork/core";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { friendAdmits, friendOpennessUnanswered, type FriendStatement, type StatedGender } from "../../../../core/src/generated/mutualOpenness.ts";
import { standingMiddle } from "../../../../core/src/generated/memberStanding.ts";
import { memberReason } from "../../filters.ts";
import type { EntitySegment, MatchEntity, PackVectors } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { FRIENDS_CITY, FRIENDS_EXCLUDED_ACTIVITIES, NEIGHBORHOODS, transitMinutes, withinTransitTolerance, type Neighborhood } from "./geo.ts";
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

function friendsSegment(w: World, home: Neighborhood, tolerance: number, friend: FriendStatement): EntitySegment {
  let reachable = reachableByRun.get(w);
  if (!reachable) { reachable = new Map(); reachableByRun.set(w, reachable); }
  const key = `${home.id}|${tolerance}|${friend.friendGender}|${friend.friendOpenness}`;
  const known = reachable.get(key);
  if (known) return known;
  const genders = FRIEND_GENDERS.filter(g => friendAdmits(friend, { friendGender: g, friendOpenness: friendOpennessUnanswered }));
  const partners = new Set<string>();
  for (const other of NEIGHBORHOODS) {
    const minutes = transitMinutes(home, other);
    for (let k = 0; k <= TOLERANCE_CLASSES.length; k++) {
      if (withinTransitTolerance(minutes, tolerance, classBound(k))) for (const g of genders) partners.add(homeSegment(other, k, g));
    }
  }
  const segment = { own: homeSegment(home, toleranceClass(tolerance), friend.friendGender), partners: [...partners].sort() };
  reachable.set(key, segment);
  return segment;
}

export const friendsVectors: PackVectors = {
  memberships(w, memberId) {
    const mi = w.get(memberId);
    if (!mi || !homeOf(w, memberId)) return [];
    if (memberReason(w, memberId, { category: "social", role: "peer", format: "small_group", timeSensitive: false }) !== null) return [];
    return [{ id: memberId, lane: "Friend", side: "Peer", market: FRIENDS_CITY, capacity: laneLimits("Friend").weeklyCapacity - mi.recentProactive }];
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
    return info?.home ? friendsSegment(w, info.home, info.tolerance, info.friend) : undefined;
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
};
