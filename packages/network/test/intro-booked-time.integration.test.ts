// An introduction must not book a member at a time they already have.
// docs/network.md: a booked plan counts as away when an intro time is chosen.
// bookPlan already drops anyone within 4 hours (BOOKING_GAP). The intro reveal must do the same.
import { expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { BOOKING_GAP } from "../src/plans.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
});

test("an introduction does not book a time a member already has", async () => {
  const w = new Mini([
    climber("a", "Ana Diaz"),
    climber("b", "Ben Ito"),
    climber("c", "Cy Moss"),
  ], { review: "auto", plans: false, growth: false });
  await w.onboard("a", "b", "c");
  const firstId = w.propose(["a", "c"], { category: "hobby", objective: "a weekday climb" });
  await w.answerProbes(["a", "c"]);

  const booked = w.net.exportState().opps.find(o => o.id === firstId);
  expect(booked?.stage).toBe("scheduled");
  const at = booked!.meetingAt!;
  expect(at).toBeGreaterThan(w.clock.now() + 6 * HOUR);

  // Both people in a second introduction already accepted this same start.
  // Ana is booked then. The introduction must not schedule her again.
  const st = w.net.exportState();
  const now = w.clock.now();
  const slot = { key: "a", start: at, end: at + 2 * HOUR, label: "Thursday 7pm" };
  const second = structuredClone(booked!);
  second.id = "intro-2";
  second.stage = "probing";
  second.participants = ["a", "b"];
  second.status = [["a", "available"], ["b", "available"]];
  second.contacted = ["a", "b"];
  second.primed = [];
  second.explanations = { a: "you both climb", b: "you both climb" };
  second.first = "a";
  second.createdAt = now;
  second.deadline = now + 2 * 24 * HOUR;
  second.turnAt = { a: now, b: now };
  second.sentAt = { a: now, b: now };
  second.offered = { a: [slot], b: [slot] };
  second.picks = { a: [at], b: [at] };
  delete second.meetingAt;
  delete second.bookedTold;
  delete second.bookedAt;
  delete second.confirmed;
  delete second.explicit;
  delete second.venue;
  delete second.venueId;
  delete second.venueArea;
  delete second.closedFrom;
  delete second.closedReason;
  st.opps.push(second);
  for (const member of st.members) if (member.id === "a" || member.id === "b") member.outbound = 0;
  st.matchingEnabled = false;
  w.net.importState(st);
  await w.net.tick(w.clock.now());

  const opps = w.net.exportState().opps;
  const clashes = opps.filter(o => o.stage === "scheduled" && o.meetingAt !== undefined
    && o.participants.includes("a") && Math.abs(o.meetingAt - at) < BOOKING_GAP);
  expect(clashes.map(o => o.id)).toEqual([firstId]);
  expect(opps.find(o => o.id === "intro-2")).toMatchObject({ stage: "closed", closedReason: "no common time" });
});
