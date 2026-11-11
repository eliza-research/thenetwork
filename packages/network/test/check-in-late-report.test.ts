// The check-in after a date (AppHooks.postDateReports) says "tell me and I'll pass it to our safety
// team". A safety disclosure that comes after the first answer, inside the check-in's 7-day window,
// is the same report: a record for staff, a block between the two, the "reported" reply (SD-220).
// Other later chat is not a report.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const awaiting = (w: Mini, id: string) => w.net.memberList().find(m => m.id === id)?.awaiting?.kind;

async function checkedIn() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto", hooks: { postDateReports: true } });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  expect(await w.runUntil(() => awaiting(w, "a") === "feedback", 10 * DAY)).toBe(true);
  await w.say("a", "It was fine.");
  expect(w.net.safetyReports()).toEqual([]);
  return w;
}

describe("a safety disclosure after the check-in answer", () => {
  test("SD-220: a later disclosure about the date files the report", async () => {
    const w = await checkedIn();
    await w.run(DAY);
    const from = w.mark();
    await w.say("a", "actually he followed me home after");
    expect(w.net.safetyReports().map(r => [r.reporterId, r.subjectId, r.kind, r.source])).toEqual([["a", "b", "unsafe", "check_in"]]);
    expect(w.to("a", from).map(s => s.body)).toEqual([copy.reported]);
    expect(w.net.safetyHeld("b" as never)).toBe(true);
  });

  test("other later chat files no report", async () => {
    const w = await checkedIn();
    await w.say("a", "my boss was so rude today");
    expect(w.net.safetyReports()).toEqual([]);
  });
});
