import { expect, test } from "vitest";
import { DAY, type Facet, type MemberId } from "@thenetwork/core";
import { friendsPack, localEmbed, plans, resolveConfig, World, type EngineInput } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

test("friends: a crew session is pair-gated on Friend profiles, and a block between two members stops it", () => {
  // spec/groupFormation.md and spec/planDecision.md: a crew's next session needs a pair value for
  // every pair in the plans lane. network.ts planWorld builds this World from the app's pack, so a
  // friends crew is gated on friendsPack Friend profiles, not on The Network's lanes.
  const venue = PLAN_VENUES.find(v => v.activities.includes("restaurant_dinner"))!;
  const interests = ["cooking", "climbing"];
  const mini = new Mini([
    { id: "a", name: "Ana Diaz", age: 30, area: venue.area, interests },
    { id: "b", name: "Ben Ito", age: 31, area: venue.area, interests },
    { id: "c", name: "Cara Li", age: 29, area: venue.area, interests },
  ]);
  const ids: MemberId[] = ["a", "b", "c"];
  for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 } satisfies Facet);
  const snapshot = JSON.parse(JSON.stringify(mini.ctx().snapshot())) as EngineInput;
  const cfg = resolveConfig({ seed: 1, cities: ["nyc"] });
  const crew: plans.Crew = {
    id: "crew_abc", activityId: "restaurant_dinner", venueId: venue.id, city: "nyc", members: ids, cadenceDays: 7,
    hostRotation: ids, sessions: [], handedOff: false, slot: { start: START + 2 * DAY },
  };
  const place = { name: venue.name, area: venue.area };

  const fitting = new World(snapshot, cfg, localEmbed, friendsPack);
  const next = plans.crewSessionPlan(fitting, crew, START, place);
  expect(next?.invited).toEqual(ids);

  const blocked = new World({ ...snapshot, edges: [{ from: "b", to: "c", type: "blocked", strength: 1, explicit: true, createdAt: START - DAY }] }, cfg, localEmbed, friendsPack);
  expect(plans.crewSessionPlan(blocked, crew, START, place)).toBeNull();
});
