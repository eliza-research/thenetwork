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


test.each([
  ["I don't want to share my number yet", false, true],
  ["I'd rather not share my number before we meet", false, true],
  ["No, not my number", false, true],
  ["I need to cancel the number swap", false, true],
  ["Yes! But don't share my number yet", false, false],
  ["Don't give out my number - I'm not coming", true, false],
  ["Please don't share my number, I'm not comfortable meeting", true, false],
  ["I’m not sharing my number and not coming", true, false],
  ["I don't want to share my number or meet you", true, false],
  ["Don't give out my number. I can't make it.", true, false],
  ['Don’t share my number. The message said "I’m not coming. Bye."', false, true],
] as const)("keeps the private swap and booking consents separate (%s)", async (body, cancelled, awaiting) => {
  const { w, booked } = await bookedPair();
  const request = await w.net.relayRequest({ itemId: "my-number-swap", from: "a", kind: "contact_share", matchId: booked.id }, {
    contactOf: id => id === "a" ? "+12125550147" : "+12125550148",
  });
  expect(request.decision).toBe("held");
  expect(w.net.exportState().relay?.swaps.map(swap => swap.from)).toEqual(["a"]);
  const marker = w.mark();
  await w.say("a", body);
  expect(w.net.exportState().relay?.swaps).toEqual([]);
  expect(w.net.opps.get(booked.id)?.stage).toBe(cancelled ? "closed" : "scheduled");
  expect(w.net.memberList().find(member => member.id === "a")?.awaiting?.kind === "booked").toBe(awaiting);
  const notices = w.to("b", marker).filter(send => send.meta.type === "cancellation");
  expect(notices.map(send => send.meta.proposalId)).toEqual(cancelled ? [booked.id] : []);
});


test.each([
  ["I have to cancel", true],
  ["Please cancel our date", true],
  ["Have to call it off", true],
  ["Please cancel my meeting", true],
  ["No need to cancel, see you there", false],
  ["We don't need to cancel", false],
  ["I can't make it tonight if the trains stop", false],
  ["Won't be able to make it tonight", false],
] as const)("a booked reply uses its direct cancellation scope (%s)", async (body, cancelled) => {
  const { w, booked } = await bookedPair();
  await w.say("a", body);
  expect(w.net.opps.get(booked.id)?.stage).toBe(cancelled ? "closed" : "scheduled");
});

test("a named attendance refusal preserves the unrelated active booking slot", async () => {
  const { w, state, booked } = await bookedPair();
  state.opps = [
    { ...booked, objective: "running meetup", meetingAt: Date.UTC(2026, 9, 20, 23) },
    { ...booked, id: "coffee", objective: "coffee", meetingAt: Date.UTC(2026, 9, 21, 23) },
  ];
  w.net.importState(state);
  const marker = w.mark();
  await w.say("a", "I can't make it to coffee on Wednesday anymore, sorry");
  expect(w.to("a", marker).map(send => send.body).join(" ")).toContain("Which meeting should I cancel?");
  expect(w.net.opps.get("coffee")?.stage).toBe("scheduled");
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  await w.say("a", "I can't make it to my meeting on 2026-10-21 at 19:00");
  expect(w.net.opps.get("coffee")?.stage).toBe("closed");
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
  expect(w.net.memberList().find(member => member.id === "a")?.awaiting?.oppId).toBe(booked.id);
});

test("a day-only cancellation needs one booking on that New York date", async () => {
  const { w, state, booked } = await bookedPair();
  const today = Date.UTC(2026, 9, 5, 23);
  state.opps = [
    { ...booked, meetingAt: today + 2 * DAY },
    { ...booked, id: "today", meetingAt: today + 2 * HOUR },
    { ...booked, id: "another-today", meetingAt: today + HOUR },
  ];
  w.net.importState(state);
  w.clock.set(today);
  await w.say("a", "Cancel tonight, sorry");
  expect(w.net.exportState().opps.every(opp => opp.stage === "scheduled")).toBe(true);
  await w.say("a", "Please cancel my meeting on 2026-10-05 at 20:00");
  expect(w.net.opps.get("another-today")?.stage).toBe("closed");
  await w.say("a", "Cancel tonight, sorry");
  expect(w.net.opps.get("today")?.stage).toBe("closed");
  expect(w.net.opps.get(booked.id)?.stage).toBe("scheduled");
});
