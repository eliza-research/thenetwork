import { expect, test } from "vitest";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] };
const belayer = { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true };

async function bookedPair() {
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
  return { x, oppId };
}

// spec/opportunityLifecycle.md, "An explicit cancellation selects the named upcoming meeting"
test("a cancellation naming the booked start as the booked message wrote it cancels the meeting", async () => {
  const { x, oppId } = await bookedPair();
  await x.say("a", "Cancel Saturday 10 AM");
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("closed");
  expect(x.sent.filter(s => s.to === "b").map(s => s.body)).toContain("Quick update: this one is off now, sorry about that. I'll look for another time.");
});

test("a cancellation naming a start with no matching booking reports none and leaves the booking", async () => {
  const { x, oppId } = await bookedPair();
  const before = x.sent.length;
  await x.say("a", "Please cancel Sunday 10 AM");
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("scheduled");
  expect(x.sent.slice(before).filter(s => s.to === "a").map(s => s.body)).toContain("I couldn't find a matching upcoming meeting.");
});

test("a cancellation naming the same day at a different time leaves the booking", async () => {
  const { x, oppId } = await bookedPair();
  const before = x.sent.length;
  await x.say("a", "Cancel Saturday 10 PM");
  expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("scheduled");
  expect(x.sent.slice(before).filter(s => s.to === "a").map(s => s.body)).toContain("I couldn't find a matching upcoming meeting.");
  expect(x.sent.slice(before).filter(s => s.to === "b")).toHaveLength(0);
});

test("a cancellation naming a time that cannot be read leaves the booking and asks for the start", async () => {
  for (const text of ["Cancel Saturday 13:00 PM", "Cancel Saturday 15pm", "Cancel Saturday 25:00", "Cancel Saturday 0 AM"]) {
    const { x, oppId } = await bookedPair();
    const before = x.sent.length;
    await x.say("a", text);
    expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("scheduled");
    expect(x.sent.slice(before).filter(s => s.to === "a").map(s => s.body).some(body => body.includes("Which meeting should I cancel?"))).toBe(true);
    expect(x.sent.slice(before).filter(s => s.to === "b")).toHaveLength(0);
  }
});
