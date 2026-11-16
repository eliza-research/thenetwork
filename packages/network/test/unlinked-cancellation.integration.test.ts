import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { confirmationWindowHours } from "../../core/src/generated/meetingSettlement.ts";
import { Mini } from "./mini.ts";

async function bookedPair() {
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
  const a = state.members.find(member => member.id === "a")!;
  expect(a.awaiting?.kind).toBe("booked");
  const booked = state.opps.find(opp => opp.stage === "scheduled")!;
  return { w, state, booked };
}

test("an unlinked explicit cancellation selects the one future booking, even with a started booking still scheduled", async () => {
  const { w, state, booked } = await bookedPair();
  const replyExpires = w.clock.now() + confirmationWindowHours * HOUR + 1;
  const start = replyExpires + 2 * DAY;
  state.opps = [
    { ...booked, meetingAt: start },
    { ...booked, id: "upcoming", meetingAt: start + 2 * HOUR },
  ];
  w.net.importState(state);
  w.clock.set(replyExpires);
  await w.net.tick(replyExpires);
  expect(w.net.memberList().find(member => member.id === "a")?.awaiting?.kind).not.toBe("booked");
  w.clock.set(start);
  await w.say("a", "Sorry, I can’t make it anymore.");
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  expect(w.net.opps.get("upcoming")?.stage).toBe("closed");
  expect(w.log("booked_cancelled").map(entry => entry.detail.oppId)).toEqual(["upcoming"]);
});

test("multiple future bookings require a unique explicit local start and never infer consent from a profile", async () => {
  const { w, booked } = await bookedPair();
  await w.say("a", "Okay.");
  const state = w.net.exportState();
  state.opps = [
    { ...booked, id: "first", meetingAt: Date.UTC(2026, 9, 20, 23) },
    { ...booked, id: "second", meetingAt: Date.UTC(2026, 9, 21, 23) },
  ];
  w.net.importState(state);
  const bothBooked = () => w.net.exportState().opps.map(opp => opp.stage);
  await w.say("a", "Something came up.");
  expect(bothBooked()).toEqual(["scheduled", "scheduled"]);
  const marker = w.mark();
  await w.say("a", "Please cancel my meeting.");
  expect(bothBooked()).toEqual(["scheduled", "scheduled"]);
  expect(w.to("a", marker).map(reply => reply.body).join(" ")).toContain("I found more than one upcoming meeting. Which one should I cancel?");

  const command = "Please cancel my meeting on 2026-10-21 at 19:00";
  await w.net.onInbound({ id: "synthetic-profile", memberId: "a", body: command, ts: w.clock.now(), channel: "sms", source: "mcp" });
  expect(bothBooked()).toEqual(["scheduled", "scheduled"]);
  await w.say("a", "Please cancel my meeting on 2026-10-21 at 18:00");
  expect(bothBooked()).toEqual(["scheduled", "scheduled"]);
  await w.say("a", command);
  expect(bothBooked()).toEqual(["scheduled", "closed"]);
  expect(w.log("booked_cancelled").map(entry => entry.detail.oppId)).toEqual(["second"]);
});
