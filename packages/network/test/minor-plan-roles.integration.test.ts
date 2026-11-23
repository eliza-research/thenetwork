// No member who is a minor, or whose age is not known to be adult, holds a role in a plan: invitee,
// alternate, crew member. The age can go down after the plan was made (a staff correction of the record
// age, a late record, a stated age), so each step that adds or keeps a member checks it at that moment.
import { expect, test } from "vitest";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import { FRIENDS_PLANS, friendsPack, type plans } from "@thenetwork/engine";
import { bookingNoticeReceiptKey, meetingFeedbackKey } from "../src/network.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

/** A reviewed group plan of a, b, c and d (quorum 4 unless given) with e as its alternate, every invitee probed. */
async function probedGroupPlan(quorum = 4) {
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map(climber), { inlineJudge: holdEveryItem.inline });
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
  const w = new Mini(ids.map(climber), { inlineJudge: holdEveryItem.inline });
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

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": the Network checks
// each member on a booked plan or asked about it at the moment a late yes joins it. Review 2026-11-18: the late yes
// read only the joiner's record, so the plan stayed booked for d with a, now 16 by the record, until the next unit.
test("a late yes to a booking whose member's record age went under 18 closes it in the same unit", async () => {
  const { w, opp, record } = await probedGroupPlan(3);
  for (const id of ["a", "b", "c"]) await w.say(id, "yes");
  expect(opp().stage).toBe("scheduled");
  record("a").age = 16;
  const from = w.mark();
  await w.say("d", "yes");
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.sent.slice(from).filter(s => s.to === "d" || s.meta.booked)).toEqual([]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": a smaller plan that
// keeps the time and place of a plan counts as asked about for each member who was asked about that plan. Before,
// c declined the group plan, its two yes-sayers got a partner plan at the same time and place, and c was then
// found to be 16: the partner plan stayed in review for the two adults.
test("a fallback partner plan closes when a member asked about the plan it came from is found to be a minor", async () => {
  const { w, oppId } = await probedGroupPlan(3);
  for (const [id, text] of [["a", "yes"], ["b", "yes"], ["c", "no thanks"], ["d", "no thanks"]] as const) await w.say(id, text);
  expect(await w.runUntil(() => w.probed("e"), DAY)).toBe(true);
  await w.say("e", "no thanks");
  const fallback = () => w.net.exportState().opps.find(o => o.id !== oppId)!;
  expect(fallback()).toMatchObject({ stage: "review", participants: ["a", "b"] });
  const from = w.mark();
  await w.say("c", "I'm 16, is that ok?");
  expect(fallback()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.net.reviewQueue()).toEqual([]);
  await w.run(DAY);
  expect(w.sent.slice(from).filter(s => s.meta.proposalId === fallback().id)).toEqual([]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": a replacement for a
// cancelled booking and a repeat of a table keep the time and place of the plan they follow. Before, e, who was asked
// about that plan, was found to be 16, and the new plan for the three adults stayed in review.
test.each(["replacement", "repeat"] as const)("a %s plan closes when a member asked about the plan it follows is found to be a minor", async kind => {
  const { w, oppId } = await probedGroupPlan(3);
  const state = w.net.exportState();
  const source = state.opps.find(o => o.id === oppId)!;
  Object.assign(source, { stage: kind === "replacement" ? "closed" : "done", closedFrom: "scheduled", closedReason: "participant dropped",
    contacted: ["a", "b", "c", "d", "e"], meetingAt: w.clock.now() });
  w.net.importState(state);
  const now = w.clock.now();
  const follow = w.net["submitPlan"]({ ...source.plan!, id: `plan_${kind}`, invited: ["a", "b", "c"], alternates: [],
    ...(kind === "repeat" ? { repeatOf: oppId } : {}), createdAt: now }, now, kind === "replacement" ? oppId : undefined)!;
  expect(w.net.reviewQueue().map(i => i.oppId)).toEqual([follow.id]);
  await w.say("e", "I'm 16, is that ok?");
  expect(w.net.exportState().opps.find(o => o.id === follow.id)).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.net.reviewQueue()).toEqual([]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": the Network checks
// each member on a plan or asked about it, or about a plan whose time and place it keeps, at the moment it books.
// Review 2026-11-18: the booking check read only the plan's own roster, so a repeat of a table that e was asked about
// booked for the three adults after staff lowered e's record age to 16, and closed only at the next unit.
test("a repeat plan closes at its quorum when a member asked about the table it repeats is now a minor by the record", async () => {
  const { w, completed } = await settledFriendsTable();
  await w.net.tick(w.clock.now());
  const repeat = () => w.net.exportState().opps.find(o => o.plan?.repeatOf === completed)!;
  expect(repeat()).toMatchObject({ generator: "friends_repeat", stage: "review", participants: ["a", "b", "c"] });
  expect(w.net.review(repeat().id, "approve", { reviewer: "sim_staff" })).toBe(true);
  const asked = (id: string) => w.sent.some(s => s.to === id && s.meta.proposalId === repeat().id);
  for (const id of ["a", "b"]) {
    expect(await w.runUntil(() => asked(id), DAY)).toBe(true);
    await w.say(id, "yes");
  }
  expect(await w.runUntil(() => asked("c"), DAY)).toBe(true);
  w.members.find(m => m.id === "e")!.age = 16;
  const from = w.mark();
  await w.say("c", "yes");
  expect(repeat()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.log("plan_booked")).toEqual([]);
  expect(w.sent.slice(from).filter(s => s.meta.booked)).toEqual([]);
});

// spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows": after an under-13
// decline the Network deletes the child's data, but the table the child was asked about stays, and its mark
// (minorKnew) blocks every plan that would keep its time and place. Review 2026-11-18: no case showed this.
test("a table a declined child was asked about never gets a repeat", async () => {
  const { w, completed } = await settledFriendsTable(null);
  await w.say("e", "I am 12 years old");
  expect(w.net.isDeclined("e")).toBe(true);
  expect(w.net.exportState().opps.find(o => o.id === completed)).toMatchObject({ minorKnew: true });
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.repeatOf === completed)).toEqual([]);
  expect(w.net.reviewQueue()).toEqual([]);
});

/**
 * A finalized friends table of a, b and c, with settled attendance and feedback, that e was asked about as its
 * alternate and declined (spec/friendsWeek.md, "A Friends repeat uses its own completed table and a fresh review").
 * The clock stands at the moment the weekly repeat is due. With eAge null, e has no record age and states 30.
 */
async function settledFriendsTable(eAge: number | null = 30) {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c"];
  const w = new Mini([...ids, "e"].map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Eve"][index]!, age: id === "e" ? eAge ?? undefined : 30,
    area: venue.area, interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true,
    plansConfig: { ...FRIENDS_PLANS, crews: { ...FRIENDS_PLANS.crews, enabled: false } } });
  for (const { id } of w.members) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  if (eAge === null) for (const text of ["hi!", "I'm 30.", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("e", text);
  else await w.onboard("e");
  const at = Date.UTC(2026, 9, 10, 16);
  const now = Date.UTC(2026, 9, 15, 15);
  const future = at + 7 * DAY;
  const source = w.net["submitPlan"]({ id: "original-table", city: "nyc", activityId: activity, venueId: venue.id,
    place: { name: venue.name, area: venue.area }, window: { start: at, end: at + 90 * 60_000 },
    invited: ids, alternates: ["e"], hostId: "a", partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3,
    probeDeadline: at - HOUR, score: 0.8, u: {}, familiar: {}, createdAt: at - DAY, category: "social",
  }, at - DAY)!;
  const state = w.net.exportState();
  const done = state.opps.find(o => o.id === source.id)!;
  done.stage = "done";
  done.meetingAt = at;
  done.contacted = [...ids, "e"];
  done.status = [...ids.map(id => [id, "yes"] as [string, "yes"]), ["e", "no"]];
  done.bookedAt = Object.fromEntries(ids.map(id => [id, at - HOUR]));
  for (const member of state.members) member.stated = { at: now - 1, until: future + DAY, windows: [{ start: future, end: future + 3 * HOUR }] };
  w.net.importState(state);
  const receipts = new Map<string, InitialInviteReceipt>();
  for (const id of ids) {
    receipts.set(meetingFeedbackKey(source.id, id, 0), { kind: "accepted", at: at + 3 * HOUR });
    receipts.set(bookingNoticeReceiptKey(source.id, id, 0), { kind: "accepted", at: at - HOUR });
  }
  w.net.init({ ...w.ctx(), initialInviteReceipt: id => receipts.get(id) });
  w.clock.set(at + 4 * HOUR);
  for (const id of ids) await w.say(id, "We all came. It was great. I'd do it again.");
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.find(o => o.id === source.id)).toMatchObject({ finalized: true, feedbackFrom: ids });
  w.restart();
  w.clock.set(now);
  return { w, completed: source.id };
}

/**
 * A friends crew of a, b, c and d that came from a table e was asked about and declined. e joined with no record age
 * and stated 30.
 */
async function crewFromATableEWasAskedAbout() {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov", "Eve"][index]!, age: id === "e" ? undefined : 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, plansConfig: FRIENDS_PLANS });
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

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": a member of a crew,
// or a member asked about the table the crew came from, counts as asked about each session. Review 2026-11-18: the
// booking check read only the session's own roster, so the session booked for the adults after staff lowered e's
// record age to 16, and closed only at the next unit.
test("a crew session closes at its quorum when a member asked about the table the crew came from is now a minor by the record", async () => {
  const { w, crew } = await crewFromATableEWasAskedAbout();
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  const session = () => w.net.exportState().opps.find(o => o.plan?.crewId === crew.id)!;
  expect(session()).toMatchObject({ stage: "review", participants: ["a", "b", "c", "d"], plan: { quorum: 3 } });
  expect(w.net.review(session().id, "approve", { reviewer: "sim_staff" })).toBe(true);
  const asked = (id: string) => w.sent.some(s => s.to === id && s.meta.proposalId === session().id);
  for (const id of ["a", "b"]) {
    expect(await w.runUntil(() => asked(id), DAY)).toBe(true);
    await w.say(id, "yes");
  }
  expect(await w.runUntil(() => asked("c"), DAY)).toBe(true);
  w.members.find(m => m.id === "e")!.age = 16;
  const from = w.mark();
  await w.say("c", "yes");
  expect(session()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.log("plan_booked")).toEqual([]);
  expect(w.sent.slice(from).filter(s => s.meta.booked)).toEqual([]);
});

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
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, plansConfig: FRIENDS_PLANS });
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
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, plansConfig: FRIENDS_PLANS });
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
