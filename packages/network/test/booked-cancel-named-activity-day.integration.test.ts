import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

// spec/opportunityLifecycle.md, "An explicit cancellation selects the named upcoming meeting":
// a date-only cancellation selects a unique booking on the named local day, and a natural-language
// activity name that does not bind an exact start asks for the full start before changing a booking.
async function confirmedPairOn(meetingAt: number) {
  const ids = ["a", "b"];
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const state = w.net.exportState();
  const booked = state.opps.find(opp => opp.stage === "scheduled")!;
  state.opps = [{ ...booked, meetingAt }];
  w.net.importState(state);
  await w.say("a", "Yes, see you there.");
  expect(w.net.memberList().find(member => member.id === "a")?.awaiting?.kind).not.toBe("booked");
  return { w, booked };
}

test("an activity cancellation naming another day leaves the confirmed booking and asks for the start", async () => {
  // Friday 2026-10-09 19:00 New York; the member names Wednesday.
  const { w, booked } = await confirmedPairOn(Date.UTC(2026, 9, 9, 23));
  const marker = w.mark();
  await w.say("a", "I can't make it to coffee on Wednesday anymore, sorry");
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  expect(w.log("booked_cancelled")).toEqual([]);
  expect(w.to("a", marker).map(send => send.body).join(" ")).toContain("Which meeting should I cancel?");
  expect(w.to("b", marker).filter(send => send.meta.type === "cancellation")).toEqual([]);
});

test("an activity cancellation naming the booked day still cancels the unique booking", async () => {
  // Wednesday 2026-10-07 19:00 New York.
  const { w, booked } = await confirmedPairOn(Date.UTC(2026, 9, 7, 23));
  await w.say("a", "I can't make it to coffee on Wednesday anymore, sorry");
  expect(w.net.opps.get(booked.id)?.stage).toBe("closed");
  expect(w.log("booked_cancelled").map(entry => entry.detail.oppId)).toEqual([booked.id]);
});
