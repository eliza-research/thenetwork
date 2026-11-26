import { describe, expect, test } from "vitest";
import { officialGates as friendsGates } from "../src/apps/friends/gates";
import { friendsMetrics } from "../src/apps/friends/metrics";
import { friendsPackMatcher } from "../src/apps/friends/packMatcher";
import { runFriendsWorld } from "../src/apps/friends/world";

const noIntroductions = { name: "no introductions", propose: () => [] };

describe("V14 gate with no measured value", () => {
  test("a run where no arm makes an introduction fails the V14 gate", () => {
    const empty = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 4, n: 400, matcher: noIntroductions }));
    expect(empty.v14).toBe(0);
    const gates = friendsGates([empty], [empty], [empty]);
    const v14 = gates.find((gate) => gate.id === "v14");
    expect(v14?.value).toContain("0.0%");
    expect(v14?.pass).toBe(false);
  });

  test("a run where the pack measures value and a baseline measures none passes the V14 gate", () => {
    const pack = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 4, n: 400, matcher: friendsPackMatcher() }));
    const empty = friendsMetrics(runFriendsWorld({ seed: 5, weeks: 4, n: 400, matcher: noIntroductions }));
    expect(pack.v14).toBeGreaterThan(0);
    expect(empty.v14).toBe(0);
    const gates = friendsGates([pack], [empty], [empty]);
    const v14 = gates.find((gate) => gate.id === "v14");
    expect(v14?.pass).toBe(true);
  });
});
