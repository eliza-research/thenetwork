import { expect, test } from "vitest";
import { HOUR, MINUTE } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("a cancelled one-to-one booking notifies the other member and leaves the arrival flow", async () => {
  const pair = ["a", "b"];
  const w = new Mini(pair.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", quietHours: [22, 8], interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false, arrivalBriefs: true });
  await w.onboard(...pair);
  const id = w.propose(pair);
  await w.answerProbes(pair);
  const booked = w.net.exportState().opps.find(item => item.id === id)!;
  expect(booked.stage).toBe("scheduled");
  const meetingAt = booked.meetingAt!;
  expect(meetingAt).toBeGreaterThan(w.clock.now() + 2 * HOUR);

  const beforeCancel = w.mark();
  await w.say("a", "I can't make it anymore");

  const cancellationNotices = w.to("b", beforeCancel).filter(message => message.meta.type === "cancellation" && message.meta.proposalId === id);
  expect(cancellationNotices.map(message => message.body)).toEqual([
    "Quick update: this one is off now, sorry about that. I'll look for another time.",
  ]);
  expect(w.net.exportState().opps.find(item => item.id === id)?.stage).toBe("closed");
  expect(w.net.exportState().meetups?.meetups.find(meetup => meetup.meetupId === id)?.closed).toBe(true);

  const beforePreBrief = w.mark();
  w.clock.set(meetingAt - 70 * MINUTE);
  await w.net.tick(w.clock.now());
  const preBriefs = w.sent.slice(beforePreBrief).filter(message => message.meta.proposalId === id && /Heads up for/i.test(message.body));
  expect(preBriefs).toEqual([]);

  w.clock.set(meetingAt - 10 * MINUTE);
  const beforeArrival = w.mark();
  await w.say("b", "Just got here!");
  await w.say("a", "Just got here!");
  const arrivalRelays = w.sent.slice(beforeArrival).filter(message => /just arrived/i.test(message.body));
  expect(arrivalRelays).toEqual([]);
});

test("a deferred arrival relay does not go out after the one-to-one booking is cancelled", async () => {
  const pair = ["a", "b"];
  const w = new Mini(pair.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", quietHours: [21, 9], interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false, arrivalBriefs: true });
  await w.onboard(...pair);
  const id = w.propose(pair);
  await w.answerProbes(pair);
  const meetingAt = Date.UTC(2026, 9, 6, 13, 20);
  const state = w.net.exportState();
  state.opps.find(item => item.id === id)!.meetingAt = meetingAt;
  state.meetups!.meetups.find(item => item.meetupId === id)!.startMs = meetingAt;
  w.net.importState(state);

  w.clock.set(Date.UTC(2026, 9, 6, 12, 55));
  await w.say("a", "running 10 mins late");
  expect(w.net.exportState().deferred.map(item => [item.memberId, item.body])).toEqual([
    ["b", "Anton is running about 10 min late."],
  ]);

  w.clock.set(Date.UTC(2026, 9, 6, 12, 57));
  await w.say("a", "I can't make it anymore");
  expect(w.net.exportState().opps.find(item => item.id === id)?.stage).toBe("closed");

  const beforeTick = w.mark();
  w.clock.set(Date.UTC(2026, 9, 6, 13, 0));
  await w.net.tick(w.clock.now());
  const tickSends = w.sent.slice(beforeTick).filter(message => message.meta.proposalId === id);
  expect(tickSends.map(message => [message.to, message.body])).toEqual([
    ["b", "Quick update: this one is off now, sorry about that. I'll look for another time."],
  ]);
});
