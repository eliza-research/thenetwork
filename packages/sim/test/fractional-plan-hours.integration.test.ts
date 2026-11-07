// Real Friends worlds feed their public snapshots into the weekly planner.
// Fractional template hours must survive into the plans and offered options.
import { expect, test } from "bun:test";
import { localParts } from "@thenetwork/core";
import { resolveAttention, resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, planFriendsWeek } from "../../engine/src/packs/friends/index.ts";
import { World } from "../../engine/src/world.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher } from "../src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, NYC_TZ } from "../src/apps/friends/snapshot.ts";
import { runFriendsWorld, VENUES } from "../src/apps/friends/world.ts";

test("Friends plans preserve the minutes in configured local template hours", () => {
  const observed: unknown[] = [], expected: unknown[] = [];
  for (const seed of [1, 2]) {
    const r = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: friendsPackMatcher() });
    const state = r.world.state;
    state.week = 3; state.now += 7 * 86_400_000;
    const s = buildFriendsSnapshot(r.world.personas, state);
    for (const minute of [0, 15, 30, 45]) {
      const att = resolveAttention({ availability: { templates: { weekday: [19 + minute / 60], weekend: [10 + minute / 60, 14 + minute / 60, 19 + minute / 60] } } });
      const w = new World(engineInputOf(s), resolveConfig({ seed }), localEmbed, friendsPack);
      const week = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: [], outcomes: [], offered: [] }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, att);
      const plans = [...week.plans, ...week.partners];
      const times = plans.flatMap(p => [p.window.start, ...p.options.map(o => o.start)]);
      observed.push({ seed, minute, planned: plans.length > 0, minutes: [...new Set(times.map(t => localParts(t, NYC_TZ).minute))] });
      expected.push({ seed, minute, planned: true, minutes: [minute] });
    }
  }
  expect(observed).toEqual(expected);
}, 30_000);
