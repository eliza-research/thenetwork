import { expect, test } from "vitest";
import { DAY, fromLocal, type Facet, type MemberId } from "@thenetwork/core";
import { FRIENDS_PLANS, friendsPack, localEmbed, plans, resolveConfig, World, type EngineInput } from "@thenetwork/engine";
import { CapitalLedger, ledgerReader } from "../src/capital.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

test("friends: a crew session is pair-gated on Friend profiles, and a block between two members stops it", () => {
  // spec/groupFormation.md and spec/planDecision.md: a crew's next session needs a pair value for
  // every pair in the plans lane. network.ts planWorld builds this World from the app's pack, so a
  // friends crew is gated on friendsPack Friend profiles, not on The Network's lanes.
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const interests = ["coffee", "climbing"];
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
    id: "crew_abc", activityId: activity, venueId: venue.id, city: "nyc", members: ids, cadenceDays: 7,
    hostRotation: ids, sessions: [], handedOff: false, slot: { start: Date.UTC(2026, 9, 10, 16) },
  };
  const place = { name: venue.name, area: venue.area };

  const fitting = new World(snapshot, cfg, localEmbed, friendsPack);
  const next = plans.crewSessionPlan(fitting, crew, START, place);
  expect(next?.invited).toEqual(ids);

  const blocked = new World({ ...snapshot, edges: [{ from: "b", to: "c", type: "blocked", strength: 1, explicit: true, createdAt: START - DAY }] }, cfg, localEmbed, friendsPack);
  expect(plans.crewSessionPlan(blocked, crew, START, place)).toBeNull();
});

// spec/crewOffer.md, "A new recurring session uses a current public venue"
test.each(["open", "closes_during_session", "removed"] as const)("a Friends crew checks its recorded venue before review: %s", async availability => {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const ids = ["a", "b", "c"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara"][index]!, age: 30, area: venue.area,
    interests: ["coffee", "climbing"],
  })), { app: "friends", pack: friendsPack, review: "human", plans: true, plansConfig: FRIENDS_PLANS });
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  const start = availability === "closes_during_session" ? fromLocal(2026, 10, 10, venue.hours.weekend[1] - 1, "America/New_York") : Date.UTC(2026, 9, 10, 16);
  const crew: plans.Crew = { id: "crew_availability", activityId: activity,
    venueId: availability === "removed" ? "removed-public-venue" : venue.id, city: "nyc", members: ids,
    cadenceDays: 7, hostRotation: ids, sessions: [], handedOff: false, slot: { start } };
  const state = w.net.exportState();
  state.plans!.crews.push(crew);
  w.net.importState(state);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());

  const result = w.net.exportState();
  const session = result.opps.find(o => o.plan?.crewId === crew.id);
  const retained = result.plans?.crews.find(c => c.id === crew.id);
  if (availability === "open") expect(session).toMatchObject({ stage: "review", participants: ids, plan: { venueId: venue.id, quorum: 3 } });
  else expect(session).toBeUndefined();
  expect(retained?.members).toEqual(ids);
  expect(retained?.sessions).toHaveLength(availability === "open" ? 1 : 0);
  expect(w.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
});

// spec/capitalLevers.md, "Earned organizing reach reserves the extra slots for low exposure"
test("friends crew reach fills only compatible seats in exposure order", async () => {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const crewIds = ["crew-a", "crew-b", "crew-c"];
  const applicants = ["a-blocked", "b-weak", "c-first", "d-blocked", "e-avoided", "f-next", "g-over-cap"];
  const ledger = new CapitalLedger();
  for (const id of crewIds) ledger.record({ id: `join:${id}`, type: "member_joined", member: id, age: 30, t: START - 7 * DAY });
  for (const daysAgo of [6, 5, 4]) ledger.record({
    id: `organized:${daysAgo}`, type: "organized", organizer: "crew-a", planId: `prior:${daysAgo}`,
    publicVenue: true, recurring: true, attendees: ["crew-b", "crew-c"], label: "Coffee crawl", t: START - daysAgo * DAY,
  });
  const capital = ledgerReader(ledger);
  expect(capital.organizingReach("crew-a", START)).toEqual({ max: 10, reservedForLowExposure: 2 });

  const names = ["Ari", "Ben", "Cy", "Dee", "Eli", "Fay", "Gio", "Hal", "Ira", "Jay"];
  const w = new Mini([...crewIds, ...applicants].map((id, index) => ({
    id, name: names[index]!, age: 30, area: venue.area,
    interests: id === "crew-c" ? ["climbing"] : id === "b-weak" ? ["coffee"] : ["coffee", "climbing"],
  })), { app: "friends", pack: friendsPack, review: "human", plans: true, plansConfig: FRIENDS_PLANS, capital });
  for (const { id } of w.members) w.facets.push({
    id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"],
    scope: "agent_private", provenance: "said", confidence: 1,
  });
  await w.onboard(...crewIds, ...applicants);
  const crew: plans.Crew = { id: "crew_fixture", activityId: activity, venueId: venue.id, city: "nyc", members: crewIds,
    cadenceDays: 7, hostRotation: crewIds, sessions: [], handedOff: false, slot: { start: Date.UTC(2026, 9, 10, 16) } };
  const state = w.net.exportState();
  state.plans!.crews.push(crew);
  state.blocks.push("a-blocked|crew-b", "c-first|d-blocked");
  state.avoid.push("c-first|e-avoided");
  w.net.importState(state);
  // Tuesday runs the crew session without the opt-in planner's Monday or Thursday group batch.
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());

  const session = w.net.exportState().opps.find(o => o.plan?.crewId === crew.id);
  const invited = [...crewIds, "c-first", "f-next"];
  expect(session).toMatchObject({ stage: "review", participants: invited, plan: {
    invited, hostId: "crew-a", venueId: venue.id, window: { start: crew.slot.start }, size: { target: 5, max: 5 },
  } });
  expect(w.log("organizing_reach").map(event => event.detail)).toEqual([
    { planId: session?.plan?.id, host: "crew-a", max: 10, reserved: 2, added: 2 },
  ]);
  expect(w.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
});
