import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] };
const belayer = { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true };

async function bookedRequest() {
  const x = new Mini([climber, belayer], { seed: 1, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a", "b");
  await x.say("a", "Find me a climbing partner.");
  const request = x.net.exportState().requests.at(-1)!;
  const oppId = request.oppId!;
  await x.net.tick(x.clock.now());
  expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await x.runUntil(() => x.probed("a"))).toBe(true);
  await x.say("a", "Yes, that works for me.");
  expect(await x.runUntil(() => x.probed("b"))).toBe(true);
  await x.say("b", "Yes, that works for me.");
  expect(await x.runUntil(() => x.meetings.length === 1)).toBe(true);
  return { x, requestId: request.id, oppId };
}

test("a booked meeting shows as in progress on the member's standing list", async () => {
  const { x, requestId, oppId } = await bookedRequest();
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("scheduled");
  expect(x.net.exportState().requests.find(r => r.id === requestId)!.outcome).toBe("booked");
  const view = x.net.standingView("a");
  expect(view.entries).toHaveLength(1);
  expect(view.entries[0]!.status).toBe("active");
  expect(view.entries[0]!.inProgress).toBe(true);
});

async function bookedPhotographyRequest() {
  const birder = { id: "a", name: "Alice Able", age: 30, interests: ["photography"] };
  const partner = { id: "b", name: "Boris Bell", age: 32, interests: ["photography"], shareable: true };
  const x = new Mini([birder, partner], { seed: 1, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a", "b");
  await x.say("a", "Find me someone who loves photography.");
  const request = x.net.exportState().requests.at(-1)!;
  expect(request.desireId).toBeUndefined();
  const oppId = request.oppId!;
  await x.net.tick(x.clock.now());
  expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await x.runUntil(() => x.probed("a"))).toBe(true);
  await x.say("a", "Yes, that works for me.");
  expect(await x.runUntil(() => x.probed("b"))).toBe(true);
  await x.say("b", "Yes, that works for me.");
  expect(await x.runUntil(() => x.meetings.length === 1)).toBe(true);
  return { x, requestId: request.id, oppId };
}

test("a booked request with no learned want still has a row on the standing list", async () => {
  const { x, requestId } = await bookedPhotographyRequest();
  expect(x.net.exportState().requests.find(r => r.id === requestId)!.outcome).toBe("booked");
  const view = x.net.standingView("a");
  expect(view.entries).toHaveLength(1);
  expect(view.entries[0]!.kind).toBe("request");
  expect(view.entries[0]!.inProgress).toBe(true);
});

test("a booked meeting that ends unfulfilled leaves the standing list", async () => {
  const { x, oppId } = await bookedPhotographyRequest();
  const meetingAt = x.meetings[0]!.at;
  await x.run(meetingAt - HOUR - x.clock.now());
  for (const member of ["a", "b"]) await x.say(member, "Thanks, still coming.");
  expect(await x.runUntil(() => x.net.memberList().find(m => m.id === "a")?.awaiting?.kind === "feedback", 2 * DAY)).toBe(true);
  await x.say("a", "Boris didn't show up.");
  await x.run(5 * DAY);
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.finalized).toBe(true);
  expect(x.net.standingView("a").entries).toHaveLength(0);
});

test("when a pair block closes the booked meeting, the request waits again", async () => {
  const { x, requestId, oppId } = await bookedRequest();
  x.edges.push({ from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: x.clock.now() });
  expect(await x.runUntil(() => x.net.exportState().opps.find(o => o.id === oppId)!.stage === "closed", DAY)).toBe(true);
  const after = x.net.exportState().requests.find(r => r.id === requestId)!;
  expect(after.outcome).toBe("none");
  expect(after.oppId).toBeUndefined();
});

test("when the other person drops the booked meeting, the request waits again and stays listed", async () => {
  const { x, requestId, oppId } = await bookedRequest();
  await x.say("b", "sorry, I can't make it anymore");
  await x.run(2 * HOUR);
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("closed");
  const after = x.net.exportState().requests.find(r => r.id === requestId)!;
  expect(after.outcome).toBe("none");
  const view = x.net.standingView("a");
  expect(view.entries).toHaveLength(1);
  expect(view.entries[0]!.status).toBe("active");
  expect(view.entries[0]!.inProgress).toBe(false);
});
