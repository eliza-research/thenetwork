import { expect, test } from "vitest";
import { DAY, localParts } from "@thenetwork/core";
import { candidateSlots, chooseTimeOptions } from "../../engine/src/attention.ts";
import { resolveAttention, resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, planFriendsWeek } from "../../engine/src/packs/friends/index.ts";
import { World } from "../../engine/src/world.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher } from "../src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, NYC_TZ } from "../src/apps/friends/snapshot.ts";
import { runFriendsWorld, VENUES } from "../src/apps/friends/world.ts";

test("Friends keeps the configured local minutes on proposed and offered windows", () => {
  // spec/planFormation.md, "A template supplies the start and the activity supplies the end"
  const seed = 1;
  const { world } = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: friendsPackMatcher() });
  world.state.week = 3;
  world.state.now += 7 * DAY;
  const snapshot = buildFriendsSnapshot(world.personas, world.state);
  const planner = new World(engineInputOf(snapshot), resolveConfig({ seed }), localEmbed, friendsPack);
  const input = { now: snapshot.now, tz: NYC_TZ, evidence: evidenceOf(planner, snapshot), venues: VENUES, crews: [], outcomes: [], offered: [] };
  const observed = [0, 15, 30, 45].map(minute => {
    const fraction = minute / 60;
    const cfg = resolveAttention({ availability: { templates: { weekday: [19 + fraction], weekend: [10 + fraction, 14 + fraction, 19 + fraction] } } });
    const week = planFriendsWeek(planner, input, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, cfg);
    return [...new Set([...week.plans, ...week.partners].flatMap(plan =>
      [plan.window.start, ...plan.options.map(option => option.start)].map(at => localParts(at, NYC_TZ).minute)))];
  });
  expect(observed).toEqual([[0], [15], [30], [45]]);
});

test("Sunday templates preserve ordinary minutes, skip the DST gap, and choose the first repeated hour", () => {
  // spec/planFormation.md, "A template supplies the start and the activity supplies the end"
  const cfg = resolveAttention({ availability: { minLeadHours: 0, templates: { weekday: [], weekend: [1.5, 2.5, 3 + 17 / 60] } } });
  const starts = (now: number, date: number) => candidateSlots(NYC_TZ, now, {}, cfg)
    .filter(slot => localParts(slot.start, NYC_TZ).day === date)
    .map(slot => new Date(slot.start).toISOString());
  expect([
    starts(Date.UTC(2027, 2, 13, 18), 14),
    starts(Date.UTC(2027, 10, 6, 18), 7),
  ]).toEqual([
    ["2027-03-14T06:30:00.000Z", "2027-03-14T07:00:00.000Z", "2027-03-14T07:17:00.000Z"],
    ["2027-11-07T05:30:00.000Z", "2027-11-07T07:30:00.000Z", "2027-11-07T08:17:00.000Z"],
  ]);
});

test("Time options exclude the fractional quiet interval and offer its end", () => {
  // spec/quietHours.md, "A quiet window includes its start and excludes its end"
  const now = Date.UTC(2026, 9, 9, 16);
  const candidate = (hour: number, minute: number) => ({ start: Date.UTC(2026, 9, 11, hour, minute), end: Date.UTC(2026, 9, 11, hour + 1, minute) });
  const before = candidate(1, 29);
  const quietStart = candidate(1, 30);
  const quietEnd = candidate(2, 30);
  const ev = { memberId: "a", tz: NYC_TZ, quietHours: [21.5, 22.5] as [number, number] };
  const offered = [before, quietStart, quietEnd].map(slot =>
    chooseTimeOptions([ev], now, { tz: NYC_TZ, candidates: [slot] }).slots.length > 0);
  expect(offered).toEqual([true, false, true]);
});
