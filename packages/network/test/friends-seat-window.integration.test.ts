import { expect, test } from "vitest";
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, localEmbed, planFriendsWeek, resolveConfig, World, type EngineInput, type plans } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

const TZ = "America/New_York";

test("friends: a fitting triangle whose strongest member has no window still seats the others who fit", () => {
  // spec/friendsWeek.md and spec/groupFormation.md: circles form among the members a table can seat.
  // d pairs best with a and b, so the triangle a-b-d is the strongest; c and d have a block between
  // them, so no circle holds all four. d has no window this week. Each member is in one circle per
  // run, so a circle that keeps d would hold a and b and leave a table of two.
  const venue = PLAN_VENUES.find(v => v.activities.includes("restaurant_dinner"))!;
  const wide = ["cooking", "climbing"];
  const mini = new Mini([
    { id: "a", name: "Ana Diaz", age: 30, area: venue.area, interests: wide },
    { id: "b", name: "Ben Ito", age: 31, area: venue.area, interests: wide },
    { id: "c", name: "Cara Li", age: 29, area: venue.area, interests: ["cooking"] },
    { id: "d", name: "Dan Wu", age: 30, area: venue.area, interests: wide },
  ]);
  const ids: MemberId[] = ["a", "b", "c", "d"];
  for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 } satisfies Facet);
  const snapshot = JSON.parse(JSON.stringify(mini.ctx().snapshot())) as EngineInput;
  const input: EngineInput = { ...snapshot, edges: [{ from: "c", to: "d", type: "blocked", strength: 1, explicit: true, createdAt: START - DAY }] };
  const w = new World(input, resolveConfig({ seed: 1, cities: ["nyc"] }), localEmbed, friendsPack);

  // Every evening from Tuesday to Sunday, 18:00-23:00 New York.
  const windows = Array.from({ length: 6 }, (_, k) => { const start = Date.UTC(2026, 9, 6 + k, 22); return { start, end: start + 5 * HOUR }; });
  const evidence = new Map<MemberId, plans.PlanEvidence>(["a", "b", "c"].map(id => [id, { memberId: id, tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY } }]));
  // The production policy (network.ts friendsWeekPlans): alternates only as replacements.
  const week = planFriendsWeek(w, { now: START, tz: TZ, evidence, venues: PLAN_VENUES, crews: [], outcomes: [], offered: [] }, { ...DEFAULT_FRIENDS_POLICY, openTable: false }, FRIENDS_PLANS);

  expect(week.plans.some(p => ["a", "b", "c"].every(id => p.invited.includes(id)))).toBe(true);
  expect([...week.plans, ...week.partners].some(p => p.invited.includes("d") || p.alternates.includes("d"))).toBe(false);
});
