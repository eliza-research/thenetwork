// friends.help on the generic match core: one Friend membership (Peers) per adult member who passes
// the pack's member rules and has a home neighborhood. Interests are activity tags, seeks are the
// member's specific wants, offers are what the member brings. Closeness compares home position,
// schedule lean and social energy. Friend has no vertical dimension: everyone stands in the middle.
import type { MemberId } from "@thenetwork/core";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { standingFromRating, standingRatingScale } from "../../../../core/src/generated/memberStanding.ts";
import { memberReason } from "../../filters.ts";
import type { MatchEntity, PackVectors } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { FRIENDS_CITY, FRIENDS_EXCLUDED_ACTIVITIES } from "./geo.ts";
import { friendsInfo } from "./info.ts";

/** The activity tags friends.help plans around. */
export const FRIENDS_ACTIVITY_TAGS: ReadonlySet<string> = new Set(ACTIVITIES.filter(a => !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)).flatMap(a => a.tags));

const SEEK_KINDS = new Set(["desire", "goal"]);
const OFFER_KINDS = new Set(["skill", "offer", "resource"]);
const ENERGY: ReadonlyMap<string, number> = new Map([["low", 0], ["mid", 1], ["high", 2]]);
const MIDDLE_ENERGY = 1;
const KM_PER_DEGREE_NORTH = 111;
const KM_PER_DEGREE_EAST = 84;

/** Weekend share of the member's usual free slots, permille (500 when none are stated). */
function weekendLean(w: World, id: MemberId): number {
  const days = (friendsInfo(w).get(id)?.standing ?? []).flatMap(s => s.byDay);
  if (days.length === 0) return 500;
  return Math.floor((1000 * days.filter(d => d === 0 || d === 6).length) / days.length);
}

const homeOf = (w: World, id: MemberId) => friendsInfo(w).get(id)?.home;

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
      // A member who does an activity brings it to whoever seeks a partner for it (coverage), apart
      // from the shared-interest term.
      offers: [...interests, ...match.filter(f => OFFER_KINDS.has(f.kind)).flatMap(f => f.tags)],
    };
  },
  // spec/memberStanding.md: Friend has no vertical dimension, so every member sits in the middle.
  standing: () => ({ standing: standingFromRating(standingRatingScale / 2), uncertainty: 0 }),
  traits: {
    // Per unit: 50 per km north or east (0 at 20 km), 1 per permille of weekend lean, 250 per energy step.
    costs: [50, 50, 1, 250],
    of(w, entity) {
      const id = entity.memberId;
      // memberships() gives no Friend entity without a home.
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
