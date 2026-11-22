import { expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { PLAN_VENUES } from "../src/plans.ts";
import { describeBookingStart, localBookingStart, rescheduleNoticeCurrent, rescheduleOfferKey, rescheduleUpdateKey } from "../src/rescheduling.ts";
import { Mini } from "./mini.ts";

const ids = ["a", "b", "c"];
const originalAt = Date.UTC(2026, 9, 10, 17);
const proposedAt = Date.UTC(2026, 9, 11, 18);
const request = `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`;

async function bookedFixture() {
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const state = w.net.exportState();
  const o = state.opps.find(item => item.id === id)!;
  expect(o.stage).toBe("scheduled");
  const venue = PLAN_VENUES.find(place => place.id === "mccarren-park")!;
  Object.assign(o, { meetingAt: originalAt, venue: venue.name, venueArea: venue.area });
  w.net.importState(state);
  const booking = () => w.net.exportState().opps.find(item => item.id === id)!;
  const vote = (member: string) => {
    const line = w.to(member).find(message => message.body.includes("Reply RESCHEDULE YES"))?.body;
    expect(line, JSON.stringify({ member, messages: w.to(member), guard: w.log("guard_blocked"), refusals: w.log("send_refused") })).toBeDefined();
    expect(line!).toContain(describeBookingStart(proposedAt));
    return /RESCHEDULE YES [a-p]{16}/.exec(line!)![0];
  };
  return { w, id, booking, vote };
}

test("only each participant's own answer to the exact offer commits a changed time across restart", async () => {
  const { w, id, booking, vote } = await bookedFixture();
  await w.say("a", request);
  await w.run(HOUR);
  const yes = Object.fromEntries(ids.map(member => [member, vote(member)]));
  expect(new Set(Object.values(yes)).size).toBe(3);
  expect(booking()).toMatchObject({ meetingAt: originalAt, reschedule: { accepted: [], roster: ids } });
  const draft = booking().reschedule!;
  const oldOfferKey = rescheduleOfferKey(draft, "c");
  expect(rescheduleNoticeCurrent({ ...booking(), current: true }, ids, "c", oldOfferKey, w.clock.now())).toBe(true);
  expect(w.net.rescheduleReplyCurrent("c", oldOfferKey)).toBe(true);
  expect(w.net.rescheduleReplyCurrent("b", oldOfferKey)).toBe(false);

  await w.say("b", yes.a!);
  await w.net.onInbound({ id: "profile-reschedule", memberId: "a", body: yes.a!, ts: w.clock.now(), channel: "sms", source: "mcp" });
  expect(booking().reschedule?.accepted).toEqual([]);
  await w.say("a", yes.a!);
  await w.say("a", yes.a!);
  await w.say("b", yes.b!);
  expect(booking()).toMatchObject({ meetingAt: originalAt, reschedule: { accepted: ["a", "b"] } });

  w.restart();
  await w.say("c", yes.c!);
  const committed = booking();
  expect(committed).toMatchObject({ meetingAt: proposedAt, scheduleRevision: 1, confirmed: ids });
  expect(committed.reschedule).toBeUndefined();
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", oldOfferKey, w.clock.now())).toBe(false);
  expect(w.net.rescheduleReplyCurrent("c", oldOfferKey)).toBe(false);
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", rescheduleUpdateKey(id, 1, "c"), w.clock.now())).toBe(true);
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", rescheduleUpdateKey(id, 0, "c"), w.clock.now())).toBe(false);
  expect(w.meetings.at(-1)).toMatchObject({ proposalId: id, at: proposedAt, previousAt: originalAt });
  await w.say("c", yes.c!);
  expect(w.log("meeting_rescheduled")).toHaveLength(1);
});

test("decline and expiry keep the original booking and invalidate queued offers", async () => {
  const { w, booking, vote } = await bookedFixture();
  await w.say("a", request);
  await w.run(HOUR);
  const originalVote = vote("b");
  await w.say("b", originalVote);
  expect(booking().reschedule?.accepted).toEqual(["b"]);
  await w.say("b", originalVote.replace(" YES ", " NO "));
  expect(booking().reschedule).toBeUndefined();
  await w.say("b", originalVote);
  expect(booking().meetingAt).toBe(originalAt);
  await w.say("a", request);
  const draft = booking().reschedule!;
  const expired = { ...booking(), current: true };
  expect(rescheduleNoticeCurrent(expired, ids, "a", rescheduleOfferKey(draft, "a"), draft.expiresAt)).toBe(false);
  w.clock.set(draft.expiresAt);
  await w.net.tick(w.clock.now());
  expect(booking()).toMatchObject({ meetingAt: originalAt, stage: "scheduled" });
  expect(booking().reschedule).toBeUndefined();
  expect(w.log("meeting_rescheduled")).toEqual([]);
});
