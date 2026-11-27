import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

// spec/meetingReschedule.md, "Story: Change the time only when everyone agrees";
// spec/opportunityLifecycle.md, "A number-swap refusal does not decline the booked meeting"
const ids = ["a", "b"];
async function booked() {
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const booking = () => w.net.exportState().opps.find(item => item.id === id)!;
  expect(booking().stage).toBe("scheduled");
  return { w, booking };
}

test("a venue-change request keeps the booking and confirms nothing", async () => {
  const { w, booking } = await booked();
  await w.say("a", "That place is too far for me. Can we meet somewhere closer instead?");
  expect(booking().stage).toBe("scheduled");
  expect(booking().confirmed ?? []).not.toContain("a");
  expect(w.log("booked_cancelled")).toEqual([]);
  expect(w.to("b").map(m => m.body).join("\n")).not.toContain("off now");
});

test("a venue-change request after a friendly opener does not confirm the old place", async () => {
  const { w, booking } = await booked();
  await w.say("a", "Sounds good, but can we meet somewhere else instead?");
  expect(booking().stage).toBe("scheduled");
  expect(booking().confirmed ?? []).not.toContain("a");
  expect(w.log("booked_cancelled")).toEqual([]);
});

test("a direct attendance decline still cancels the booking", async () => {
  const { w, booking } = await booked();
  await w.say("a", "I can't make it");
  expect(booking().stage).toBe("closed");
  expect(w.log("booked_cancelled")).toHaveLength(1);
});

test("a place objection with no alternative still cancels the booking", async () => {
  const { w, booking } = await booked();
  await w.say("a", "I can't make it to that place.");
  expect(booking().stage).toBe("closed");
  expect(w.log("booked_cancelled")).toHaveLength(1);
});

test("a venue-change request with a place objection still keeps the booking", async () => {
  const requests = [
    "Can we meet somewhere else? I'm not sure about that park",
    "Can we go somewhere else? It's not happening at that bar for me",
  ];
  for (const text of requests) {
    const { w, booking } = await booked();
    await w.say("a", text);
    expect(booking().stage).toBe("scheduled");
    expect(booking().confirmed ?? []).not.toContain("a");
    expect(w.log("booked_cancelled")).toEqual([]);
  }
});

test("a booked reply with a refusal word but no place request keeps the booking", async () => {
  const keeps = [
    "Yes, please don't go ahead without me.",
    "Don't start without me!",
    "Can't wait. I'm done with exams by then",
    "I'm in. Not meeting anyone else that day",
  ];
  for (const text of keeps) {
    const { w, booking } = await booked();
    await w.say("a", text);
    expect(booking().stage).toBe("scheduled");
    expect(w.log("booked_cancelled")).toEqual([]);
  }
});

test("a refusal that names another place still cancels the booking", async () => {
  const refusals = [
    "No thanks, I'd rather meet someone else somewhere else",
    "Cancel it, we can meet somewhere else some other time",
    "I won't be there, go somewhere else without me",
    "No. Find a different place with someone else.",
    "I'm out. Choose another venue with someone else",
    "Not happening, find a different venue for yourself",
    "Not happening. Find a different place for yourself.",
    "No. Pick another place, I'm not interested.",
    "Not interested anymore, go somewhere else",
    "No, I'm not meeting. Pick a different spot.",
    "Nah, find another place, I'm done",
    "No thanks. Meet somewhere else alone.",
    "No. Go somewhere else.",
    "I'm not interested, go find another venue",
  ];
  for (const text of refusals) {
    const { w, booking } = await booked();
    await w.say("a", text);
    expect(booking().stage).toBe("closed");
    expect(w.log("booked_cancelled")).toHaveLength(1);
  }
});
