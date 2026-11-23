import { expect, test } from "vitest";
import { runFriendsWorld, type FriendsProposal } from "../src/apps/friends/world.ts";
import { slotTime } from "../src/apps/friends/snapshot.ts";

test("a second mutually accepted Friends meetup uses its free alternate slot", () => {
  const plan = { kind: "partner", activity: "coffee_crawl", venueHood: "forest_hills", alternates: [], quorum: 2 } satisfies Omit<FriendsProposal, "invited" | "options">;
  const result = runFriendsWorld({
    seed: 114, n: 80, weeks: 1,
    matcher: { name: "overlapping pairs", propose: () => [
      { ...plan, invited: ["f0012", "f0039"], options: [0] },
      { ...plan, invited: ["f0012", "f0058"], options: [0, 1] },
    ] },
  });
  expect(result.flows.map(f => f.yes)).toEqual([2, 2]);
  expect(result.flows.map(f => f.booked.length)).toEqual([2, 2]);
  expect(result.world.state.interactions.map(i => i.at)).toEqual([slotTime(0, 0), slotTime(0, 1)]);
});
