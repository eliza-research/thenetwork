import { describe, expect, test } from "vitest";
import { officialGates as friendsGates } from "../src/apps/friends/gates";
import { friendsMetrics } from "../src/apps/friends/metrics";
import { friendsPackMatcher } from "../src/apps/friends/packMatcher";
import { runFriendsWorld } from "../src/apps/friends/world";

const noIntroductions = { name: "no introductions", propose: () => [] };

describe("Friendship gate with no measured friendship", () => {
  test("a run where no arm forms a friendship fails the friendship gate", () => {
    const empty = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 8, n: 400, matcher: noIntroductions }));
    expect(empty.friendshipTrackShare).toBe(0);
    const gates = friendsGates([empty], [empty], [empty]);
    const friendship = gates.find((gate) => gate.id === "friendship");
    expect(friendship?.value).toContain("0.0%");
    expect(friendship?.pass).toBe(false);
  });

  test("a run where the pack forms friendships and baselines form none passes the friendship gate", () => {
    const pack = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 8, n: 400, matcher: friendsPackMatcher() }));
    const empty = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 8, n: 400, matcher: noIntroductions }));
    expect(pack.friendshipTrackShare).toBeGreaterThan(0);
    expect(empty.friendshipTrackShare).toBe(0);
    const gates = friendsGates([pack], [empty], [empty]);
    const friendship = gates.find((gate) => gate.id === "friendship");
    expect(friendship?.pass).toBe(true);
  });
});
