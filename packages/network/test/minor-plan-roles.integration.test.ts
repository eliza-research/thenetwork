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

function heldFor(w: Mini, oppId: string) {
  const item = w.net.reviewQueue().find(i => i.oppId === oppId);
  expect(item?.exception?.verdict).toBe("flag");
  return item!;
}

function staffApprove(w: Mini, oppId: string) {
  const { revision } = heldFor(w, oppId);
  expect(w.net.review(oppId, "approve", { reviewer: "sim_staff", revision })).toBe(true);
}

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
  const oppId = w.net["submitPlan"](plan, now)!.id;
  await w.net.tick(w.clock.now());
  staffApprove(w, oppId);
  expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
  const opp = () => w.net.exportState().opps.find(o => o.id === oppId)!;
  const record = (id: string) => w.members.find(m => m.id === id)!;
  return { w, oppId, opp, record };
}

test("a plan submitted for review lists no minor beside a member aged 19 or more", async () => {
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
  w.members.find(m => m.id === "e")!.age = 16;
  await w.say("a", "hi");
  w.net["submitPlan"](plan("plan_alt", ["a", "b", "c"], ["e"]), now);
  await w.net.tick(w.clock.now());
  expect(w.net.reviewQueue().map(i => [i.proposal.participants, i.proposal.alternates ?? []])).toEqual([[["a", "b", "c"], []]]);
  w.members.find(m => m.id === "d")!.age = 15;
  await w.say("a", "hi again");
  w.net["submitPlan"](plan("plan_invitee", ["b", "c", "d"], []), now);
  await w.net.tick(w.clock.now());
  expect(w.net.reviewQueue().length).toBe(1);
  expect(w.log("plan_refused").map(l => l.detail.planId)).toEqual(["plan_invitee"]);
});

test("an alternate whose record age goes under 18 is never promoted into the plan", async () => {
  const { w, opp, record } = await probedGroupPlan();
  record("e").age = 16;
  await w.say("d", "no thanks");
  expect(opp().participants).not.toContain("e");
  expect(w.sent.filter(s => s.to === "e" && s.meta.type === "plan_probe")).toEqual([]);
  await w.run(HOUR);
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy", alternates: [] });
  expect(opp().participants).not.toContain("e");
});

test("a member who said yes to a plan and whose record age goes under 18 takes the plan down at the next unit", async () => {
  const { w, opp, record } = await probedGroupPlan();
  await w.say("a", "yes");
  expect(opp().status).toContainEqual(["a", "available"]);
  record("a").age = 16;
  await w.run(HOUR);
  expect(opp()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  const from = w.mark();
  for (const id of ["b", "c", "d"]) await w.say(id, "yes");
  await w.run(DAY);
  expect(w.meetings).toEqual([]);
  expect(w.sent.slice(from).filter(s => s.meta.proposalId === opp().id && s.meta.type !== "info")).toEqual([]);
});

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

test("a fallback partner plan closes when a member asked about the plan it came from is found to be a minor", async () => {
  const { w, oppId } = await probedGroupPlan(3);
  for (const [id, text] of [["a", "yes"], ["b", "yes"], ["c", "no thanks"], ["d", "no thanks"]] as const) await w.say(id, text);
  expect(await w.runUntil(() => w.probed("e"), DAY)).toBe(true);
  await w.say("e", "no thanks");
  const fallback = () => w.net.exportState().opps.find(o => o.id !== oppId)!;
  expect(fallback()).toMatchObject({ stage: "review", participants: ["a", "b"] });
  await w.net.tick(w.clock.now());
  heldFor(w, fallback().id);
  const from = w.mark();
  await w.say("c", "I'm 16, is that ok?");
  expect(fallback()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.net.reviewQueue()).toEqual([]);
  await w.run(DAY);
  expect(w.sent.slice(from).filter(s => s.meta.proposalId === fallback().id)).toEqual([]);
});

test("a replacement plan closes when a member asked about the plan it follows is found to be a minor", async () => {
  const { w, oppId } = await probedGroupPlan(3);
  const now = w.clock.now();
  const venue = PLAN_VENUES.find(v => v.id === "inwood-hill" && v.activities.includes("day_hike"))!;
  const window = { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR };
  const state = w.net.exportState();
  const source = state.opps.find(o => o.id === oppId)!;
  Object.assign(source, { stage: "closed", closedFrom: "scheduled", closedReason: "participant dropped",
    contacted: ["a", "b", "c", "d", "e"], meetingAt: now });
  for (const member of state.members) member.stated = { at: now - 1, until: window.end + DAY, windows: [{ start: window.start - HOUR, end: window.end + HOUR }] };
  w.net.importState(state);
  const follow = w.net["submitPlan"]({ ...source.plan!, id: "plan_replacement", activityId: "day_hike", venueId: venue.id, place: { name: venue.name, area: venue.area },
    invited: ["a", "b", "c"], alternates: [], window, probeDeadline: now + 4 * DAY, createdAt: now }, now, oppId)!;
  expect(w.net.exportState().opps.find(o => o.id === follow.id)).toMatchObject({ stage: "review", participants: ["a", "b", "c"],
    replacementFor: oppId, review: { queuedAt: now } });
  await w.net.tick(w.clock.now());
  heldFor(w, follow.id);
  expect(w.net.reviewQueue().map(i => i.oppId)).toEqual([follow.id]);
  await w.say("e", "I'm 16, is that ok?");
  expect(w.net.exportState().opps.find(o => o.id === follow.id)).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.net.reviewQueue()).toEqual([]);
});

test("a repeat plan in review closes when a member asked about the table it repeats is found to be a minor", async () => {
  const { w, completed, due } = await settledFriendsTable();
  w.clock.set(due);
  await w.net.tick(w.clock.now());
  const repeat = () => w.net.exportState().opps.find(o => o.plan?.repeatOf === completed)!;
  expect(repeat()).toMatchObject({ generator: "friends_repeat", stage: "review", participants: ["a", "b", "c"], plan: { repeatOf: completed } });
  heldFor(w, repeat().id);
  expect(w.net.reviewQueue().map(i => i.oppId)).toEqual([repeat().id]);
  await w.say("e", "I'm 16, is that ok?");
  expect(repeat()).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect(w.net.reviewQueue()).toEqual([]);
});

test("a repeat plan closes at its quorum when a member asked about the table it repeats is now a minor by the record", async () => {
  const { w, completed, due } = await settledFriendsTable();
  w.clock.set(due);
  await w.net.tick(w.clock.now());
  const repeat = () => w.net.exportState().opps.find(o => o.plan?.repeatOf === completed)!;
  expect(repeat()).toMatchObject({ generator: "friends_repeat", stage: "review", participants: ["a", "b", "c"] });
  staffApprove(w, repeat().id);
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

test("a table whose alternate joined with no record age and stated 30 gets a repeat", async () => {
  const { w, completed, due } = await settledFriendsTable(null, false);
  w.clock.set(due);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.find(o => o.plan?.repeatOf === completed)).toMatchObject({ generator: "friends_repeat", participants: ["a", "b", "c"] });
});

test("a table whose asked member's record age went under 18 before the member was forgotten never gets a repeat", async () => {
  const { w, completed, due } = await settledFriendsTable(null, false);
  w.members.find(m => m.id === "e")!.age = 16;
  await w.net.tick(w.clock.now());
  w.net.forgetMember("e");
  w.clock.set(due);
  expect(w.net.exportState().opps.find(o => o.id === completed)!.contacted).not.toContain("e");
  await w.net.tick(due);
  expect(w.net.exportState().opps.filter(o => o.plan?.repeatOf === completed)).toEqual([]);
});

test("a table a declined child was asked about never gets a repeat", async () => {
  const { w, completed, due } = await settledFriendsTable(null);
  w.clock.set(due);
  await w.say("e", "I am 12 years old");
  expect(w.net.isDeclined("e")).toBe(true);
  expect(w.net.exportState().opps.find(o => o.id === completed)).toMatchObject({ minorKnew: true });
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.repeatOf === completed)).toEqual([]);
  expect(w.net.reviewQueue()).toEqual([]);
});

async function settledFriendsTable(eAge: number | null = 30, eAnswered = true) {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c"];
  const w = new Mini([...ids, "e"].map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Eve"][index]!, age: id === "e" ? eAge ?? undefined : 30,
    area: venue.area, interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true,
    plansConfig: { ...FRIENDS_PLANS, crews: { ...FRIENDS_PLANS.crews, enabled: false } } });
  w.verify(...ids, "e");
  await w.onboard(...ids);
  if (eAge === null) await w.onboardStatingThirty("e");
  else await w.onboard("e");
  const at = Date.UTC(2026, 9, 10, 16);
  const due = Date.UTC(2026, 9, 15, 15);
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
  done.status = ids.map(id => [id, "yes"] as [string, "yes" | "no"]);
  if (eAnswered) done.status.push(["e", "no"]);
  done.bookedAt = Object.fromEntries(ids.map(id => [id, at - HOUR]));
  for (const member of state.members) member.stated = { at: due - 1, until: future + DAY, windows: [{ start: future, end: future + 3 * HOUR }] };
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
  w.clock.set(due - 6 * HOUR);
  return { w, completed: source.id, due };
}

async function crewFromATableEWasAskedAbout() {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d", "e"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov", "Eve"][index]!, age: id === "e" ? undefined : 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, plansConfig: FRIENDS_PLANS });
  w.verify(...ids);
  await w.onboard("a", "b", "c", "d");
  await w.onboardStatingThirty("e");
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

async function crewOfFour(statesThirty?: string) {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c", "d"];
  const w = new Mini(ids.map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov"][index]!, age: id === statesThirty ? undefined : 30, area: venue.area,
    interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, plansConfig: FRIENDS_PLANS });
  w.verify(...ids);
  await w.onboard(...ids.filter(id => id !== statesThirty));
  if (statesThirty) await w.onboardStatingThirty(statesThirty);
  const crew: plans.Crew = { id: "crew_abcd", activityId: activity, venueId: venue.id, city: "nyc", members: ids,
    cadenceDays: 7, hostRotation: ids, sessions: [], handedOff: false, slot: { start: Date.UTC(2026, 9, 10, 16) } };
  const state = w.net.exportState();
  state.plans!.crews.push(crew);
  w.net.importState(state);
  return { w, crew };
}

test("a crew session closes at its quorum when a member asked about the table the crew came from is now a minor by the record", async () => {
  const { w, crew } = await crewFromATableEWasAskedAbout();
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  const session = () => w.net.exportState().opps.find(o => o.plan?.crewId === crew.id)!;
  expect(session()).toMatchObject({ stage: "review", participants: ["a", "b", "c", "d"], plan: { quorum: 3 } });
  staffApprove(w, session().id);
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

test.each(["I'm 16, is that ok?", "I am 12 years old"])("a crew ends when a member asked about the table it came from writes %s", async text => {
  const { w, crew } = await crewFromATableEWasAskedAbout();
  await w.say("e", text);
  expect(w.net.exportState().plans!.crews.map(c => c.id)).not.toContain(crew.id);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});

test("a crew member found to be a minor ends the crew's sessions, even when enough adults remain", async () => {
  const { w, crew } = await crewOfFour();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("minor_signal").map(l => l.detail.memberId)).toEqual(["b"]);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});

test("a crew member who stated 30 and writes that they are 12 ends the crew", async () => {
  const { w, crew } = await crewOfFour("b");
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  expect(w.net.exportState().plans!.crews.map(c => c.id)).not.toContain(crew.id);
  w.clock.advance(DAY);
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.filter(o => o.plan?.crewId === crew.id)).toEqual([]);
  expect(w.log("crew_session")).toEqual([]);
});
