import { expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

// spec/opportunityLifecycle.md, "An explicit cancellation selects the named upcoming meeting":
// a direct date-only cancellation selects the unique booking on the named local day.
async function bookedDayBefore() {
  const w = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { seed: 1 });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings).toHaveLength(1);
  const booked = w.net.exportState().opps.find(opp => opp.stage === "scheduled")!;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(booked.meetingAt);
  const dayBefore = booked.meetingAt! - 20 * HOUR;
  if (dayBefore > w.clock.now()) await w.run(dayBefore - w.clock.now());
  return { w, booked, weekday };
}

test.each([
  "I need to cancel {day}",
  "I have to cancel {day}",
  "I need to cancel tomorrow",
  "I have to cancel tomorrow",
  "I have to bail {day}",
  "I need to call it off {day}",
  "Sorry, I need to cancel {day}",
])("a need-or-have cancellation naming the booked day cancels it (%s)", async template => {
  const { w, booked, weekday } = await bookedDayBefore();
  const marker = w.mark();
  await w.say("a", template.replace("{day}", weekday));
  expect(w.net.opps.get(booked.id)?.stage).toBe("closed");
  const status = Object.fromEntries(w.net.exportState().opps.find(opp => opp.id === booked.id)!.status);
  expect(status.a).toBe("dropped");
  expect(w.to("a", marker).map(send => send.body)).toContain("No worries, thanks for the heads up.");
  expect(w.to("b", marker).filter(send => send.meta.type === "cancellation").map(send => send.meta.proposalId)).toEqual([booked.id]);
  expect(w.log("booked_cancelled").map(entry => entry.detail.oppId)).toEqual([booked.id]);
});

test("a need-or-have cancellation naming another day reports no match and keeps the booking", async () => {
  const { w, booked, weekday } = await bookedDayBefore();
  const otherDay = weekday === "Sunday" ? "Monday" : "Sunday";
  const marker = w.mark();
  await w.say("a", `I need to cancel ${otherDay}`);
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  expect(w.to("a", marker).map(send => send.body)).toContain("I couldn't find a matching upcoming meeting.");
  expect(w.log("booked_cancelled")).toEqual([]);
});

test.each([
  "No need to cancel {day}",
  "I need to cancel {day} if it rains",
  "Can I cancel {day}?",
])("a kept, conditional, or questioned cancellation naming the booked day keeps it (%s)", async template => {
  const { w, booked, weekday } = await bookedDayBefore();
  await w.say("a", template.replace("{day}", weekday));
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  expect(w.log("booked_cancelled")).toEqual([]);
});
