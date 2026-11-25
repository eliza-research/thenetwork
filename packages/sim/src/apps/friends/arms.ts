// Current Friends pack, baselines, and ablations for options the planner still exposes.
import { BASELINES } from "./baselines.ts";
import { friendsPackMatcher, friendsTeenMatcher } from "./packMatcher.ts";
import type { FriendsMatcher, FriendsWorld } from "./world.ts";

export type FriendsArm = FriendsMatcher | ((w: FriendsWorld) => FriendsMatcher);

/** The arms by name; `pack` takes an optional JSON override of the pack's knobs. */
export function friendsArms(packOverride: Record<string, unknown> = {}): Record<string, FriendsArm> {
  return {
    pack: friendsPackMatcher(packOverride),
    "pack-teen": friendsTeenMatcher(friendsPackMatcher(packOverride)),
    random: BASELINES.random, greedy: BASELINES.greedy, oracle: BASELINES.oracle,
    "pack-no-crews": friendsPackMatcher({ name: "pack-no-crews", policy: { crews: false } }),
    "pack-no-repeat": friendsPackMatcher({ name: "pack-no-repeat", policy: { crews: false, repeat: false } }),
    "pack-no-universal": friendsPackMatcher({ name: "pack-no-universal", policy: { universal: false } }),
    "pack-no-partner": friendsPackMatcher({ name: "pack-no-partner", policy: { partnerIntros: 0 } }),
    "pack-spread": friendsPackMatcher({ name: "pack-spread", policy: { spreadNew: true } }),
    "pack-options3": friendsPackMatcher({ name: "pack-options3", policy: { tableOptions: 3, split: true } }),
  };
}

export const ARMS: Record<string, FriendsArm> = friendsArms();
