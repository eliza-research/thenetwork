// No member who is a minor, or whose age is not known to be adult, holds a role in a plan: invitee,
// alternate, crew member. The age can go down after the plan was made (a staff correction of the record
// age, a late record, a stated age), so each step that adds or keeps a member checks it at that moment.
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { FRIENDS_PLANS, friendsPack, type plans } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

/** A reviewed group plan of a, b, c and d (quorum 4 unless given) with e as its alternate, every invitee probed. */
async function probedGroupPlan(quorum = 4) {
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map(climber), { review: "human" });
  await w.onboard(...ids);
  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "plan_group", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR }, invited: ["a", "b", "c", "d"], alternates: ["e"],
    partner: false, size: { min: 3, target: 4, max: 4 }, quorum, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {},
    createdAt: now, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  const oppId = w.net.reviewQueue()[0]!.oppId;
  expect(w.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
  const opp = () => w.net.exportState().opps.find(o => o.id === oppId)!;
  const record = (id: string) => w.members.find(m => m.id === id)!;
  return { w, oppId, opp, record };
}

// spec/groupFormation.md, "Only eligible adults enter the group search"; spec/planFormation.md, "Alternates must
// fit the entire offered group": the planner's world can be older than the member records, so the Network checks
// every role again when it submits the plan. Before, the review item listed e as an alternate, and the plan
// with d as an invitee waited for review.
test("a plan submitted for review lists no member who is not an adult at that moment", async () => {
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map(climber), { review: "human" });
  await w.onboard(...ids);
  const now = w.clock.now();
  const plan = (id: string, invited: string[], alternates: string[]): plans.Plan => ({
    id, city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR }, invited, alternates,
    partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {},
    createdAt: now, category: "hobby",
  });
  const submit = (p: plans.Plan) => (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): unknown }).submitPlan(p, now);
  // Staff correct e's record age to 16; nothing has read the records again yet.
  w.members.find(m => m.id === "e")!.age = 16;
  await w.say("a", "hi");
  submit(plan("plan_alt", ["a", "b", "c"], ["e"]));
  expect(w.net.reviewQueue().map(i => [i.proposal.participants, i.proposal.alternates ?? []])).toEqual([[["a", "b", "c"], []]]);
  w.members.find(m => m.id === "d")!.age = 15;
  await w.say("a", "hi again");
  submit(plan("plan_invitee", ["b", "c", "d"], []));
  expect(w.net.reviewQueue().length).toBe(1);
  expect(w.log("plan_refused").map(l => l.detail.planId)).toEqual(["plan_invitee"]);
});

// spec/planFormation.md, "Alternates must fit the entire offered group"
test("an alternate whose record age goes under 18 is never promoted into the plan", async () => {
  const { w, opp, record } = await probedGroupPlan();
  // Staff correct e's record age to 16 between units; d declines before the next unit reads the records.
  record("e").age = 16;
  await w.say("d", "no thanks");
  expect(opp().participants).not.toContain("e");
  expect(w.sent.filter(s => s.to === "e" && s.meta.type === "plan_probe")).toEqual([]);
  // At the next unit e leaves the alternate list, and the reviewed plan that listed e closes.
  await w.run(HOUR);
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy", alternates: [] });
  expect(opp().participants).not.toContain("e");
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
test("a member who said yes to a plan and whose record age goes under 18 takes the plan down at the next unit", async () => {
  const { w, opp, record } = await probedGroupPlan();
  await w.say("a", "yes");
  expect(opp().status).toContainEqual(["a", "available"]);
  // A yes that waits for the quorum does not make a busy; the age change must still reach the plan.
  record("a").age = 16;
  await w.run(HOUR);
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  const from = w.mark();
  for (const id of ["b", "c", "d"]) await w.say(id, "yes");
  await w.run(DAY);
  expect(w.meetings).toEqual([]);
  expect(w.sent.slice(from).filter(s => s.meta.proposalId === opp().id && s.meta.type !== "info")).toEqual([]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": the Network checks
// every member on the plan or asked about it again at the moment it books. Before, a, who said yes, had a record age
// of 16 by the time the quorum came; the reveal check left a out, and the two adults got a fallback plan from a plan
// that a minor was asked about.
test("a plan whose member who said yes is now a minor by the record closes at the quorum instead of booking or falling back", async () => {
  const { w, opp, record } = await probedGroupPlan(3);
  await w.say("a", "yes");
  record("a").age = 16;
  const from = w.mark();
  await w.say("b", "yes");
  await w.say("c", "yes");
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.log("plan_booked")).toEqual([]);
  expect(w.log("plan_fallback")).toEqual([]);
  expect(w.net.exportState().opps.filter(o => o.id !== opp().id)).toEqual([]);
  expect(w.sent.slice(from).filter(s => s.to === "a")).toEqual([]);
});

/**
 * A friends crew of a, b, c and d that came from a table e was asked about and declined. e joined with no record age
 * and stated 30.
 */
async function crewFromATableEWasAskedAbout() {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov", "Eve"][index]!, age: id === "e" ? undefined : 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, review: "human", plans: true, plansConfig: FRIENDS_PLANS });
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard("a", "b", "c", "d");
  for (const text of ["hi!", "I'm 30.", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("e", text);
  const crewIds = ["a", "b", "c", "d"];
  const at = Date.UTC(2026, 9, 10, 16);
  const source = w.net["submitPlan"]({ id: "crew-source-table", city: "nyc", activityId: activity, venueId: venue.id,
    place: { name: venue.name, area: venue.area }, window: { start: at, end: at + 90 * 60_000 },
    invited: crewIds, alternates: ["e"], hostId: "a", partner: false, size: { min: 3, target: 4, max: 4 }, quorum: 3,
    probeDeadline: at - HOUR, score: 0.8, u: {}, familiar: {}, createdAt: at - DAY, category: "social",
  }, at - DAY)!;
  const crew: plans.Crew = { id: "crew_abcd", activityId: activity, venueId: venue.id, city: "nyc", members: crewIds,
    cadenceDays: 7, hostRotation: crewIds, sessions: [], handedOff: false, slot: { start: at } };
  const state = w.net.exportState();
  const done = state.opps.find(o => o.id === source.id)!;
  done.stage = "done";
  done.meetingAt = at;
  done.contacted = ids;
  done.status = [...crewIds.map(id => [id, "yes"] as [string, "yes"]), ["e", "no"]];
  state.plans!.crews.push(crew);
  state.plans!.crewOffers.push({ crew, planId: source.id, at: at + DAY, offered: crewIds, yes: crewIds, no: [], resolved: true });
  w.net.importState(state);
  return { w, crew };
}

// spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows": a crew meets at the
// time and place of the table it came from. Before, e, who was asked about that table and declined, was found to
// be a minor, and the crew of four adults still got its next session.
test.each(["I'm 16, is that ok?", "I am 12 years old"])("a crew ends when a member asked about the table it came from writes %s", async text => {
  const { w, crew } = await crewFromATableEWasAskedAbout();
  await w.say("e", text);
  expect(w.net.exportState().plans!.crews.map(c => c.id)).not.toContain(crew.id);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});

// spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
test("a crew member found to be a minor ends the crew's sessions, even when enough adults remain", async () => {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov"][index]!, age: 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, review: "human", plans: true, plansConfig: FRIENDS_PLANS });
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  const crew: plans.Crew = { id: "crew_abcd", activityId: activity, venueId: venue.id, city: "nyc", members: ids,
    cadenceDays: 7, hostRotation: ids, sessions: [], handedOff: false, slot: { start: Date.UTC(2026, 9, 10, 16) } };
  const state = w.net.exportState();
  state.plans!.crews.push(crew);
  w.net.importState(state);
  // b knows the crew's weekly time and place.
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("minor_signal").map(l => l.detail.memberId)).toEqual(["b"]);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});

// spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows". Review 2026-11-17:
// a crew member who stated 30 and then wrote "I am 12 years old" was deleted from the crew, so no known minor
// stayed in it and the crew of three adults went on.
test("a crew member who stated 30 and writes that they are 12 ends the crew", async () => {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov"][index]!, age: id === "b" ? undefined : 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, review: "human", plans: true, plansConfig: FRIENDS_PLANS });
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard("a", "c", "d");
  for (const text of ["hi!", "I'm 30.", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("b", text);
  const crew: plans.Crew = { id: "crew_abcd", activityId: activity, venueId: venue.id, city: "nyc", members: ids,
    cadenceDays: 7, hostRotation: ids, sessions: [], handedOff: false, slot: { start: Date.UTC(2026, 9, 10, 16) } };
  const state = w.net.exportState();
  state.plans!.crews.push(crew);
  w.net.importState(state);
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  expect(w.net.exportState().plans!.crews.map(c => c.id)).not.toContain(crew.id);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});
