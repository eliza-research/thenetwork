// The arms compared in docs/results/2026-10-08-friends-pack.md: the pack, the baselines and the ablations.
import { BASELINES } from "./baselines.ts";
import { friendsPackMatcher } from "./packMatcher.ts";
import type { FriendsMatcher, FriendsWorld } from "./world.ts";

export type FriendsArm = FriendsMatcher | ((w: FriendsWorld) => FriendsMatcher);

/** The arms by name; `pack` takes an optional JSON override of the pack's knobs. */
export function friendsArms(packOverride: Record<string, unknown> = {}): Record<string, FriendsArm> {
  return {
    pack: friendsPackMatcher(packOverride),
    random: BASELINES.random, greedy: BASELINES.greedy, oracle: BASELINES.oracle,
    "pack-no-crews": friendsPackMatcher({ name: "pack-no-crews", policy: { crews: false } }),
    "pack-no-repeat": friendsPackMatcher({ name: "pack-no-repeat", policy: { crews: false, repeat: false } }),
    "pack-no-universal": friendsPackMatcher({ name: "pack-no-universal", policy: { universal: false, universalFirst: false } }),
    "pack-planner-only": friendsPackMatcher({ name: "pack-planner-only", policy: { tables: false, universal: false, universalFirst: false } }),
    "pack-no-zones": friendsPackMatcher({ name: "pack-no-zones", policy: { zones: false } }),
    "pack-no-minmax": friendsPackMatcher({ name: "pack-no-minmax", policy: { venueMinMax: false } }),
    "pack-no-partner": friendsPackMatcher({ name: "pack-no-partner", policy: { partnerIntros: 0, partnerFallback: false } }),
    "pack-spread": friendsPackMatcher({ name: "pack-spread", policy: { spreadNew: true } }),
    "pack-fairness": friendsPackMatcher({ name: "pack-fairness", policy: { fairness: true } }),
    "pack-options3": friendsPackMatcher({ name: "pack-options3", policy: { tableOptions: 3, split: true } }),
  };
}

export const ARMS: Record<string, FriendsArm> = friendsArms();
