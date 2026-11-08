// A report in the answer to the check-in after a date keeps the trust rules of "report X"
// (trust.ts): each reporter who met the subject counts once, and two such reporters put points on
// the subject (SD-229). Before, the check-in path filed the record and the block only, so the same
// words counted toward the trust hold in one path and not in the other.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const awaiting = (w: Mini, id: string) => w.net.memberList().find(m => m.id === id)?.awaiting?.kind;

/** A date between `x` and Ben, held; Ben has answered the check-in, and it waits for `x`. */
async function dateWithBen(w: Mini, x: string) {
  const booked = w.meetings.length;
  w.propose([x, "b"]);
  await w.answerProbes([x, "b"]);
  expect(w.meetings.length).toBe(booked + 1);
  expect(await w.runUntil(() => awaiting(w, x) === "feedback" && awaiting(w, "b") === "feedback", 10 * DAY)).toBe(true);
  await w.say("b", "It was good.");
}

describe("a check-in report and the trust rules", () => {
  test("SD-229: two check-in reports by people who met him add trust points", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Park")], { review: "auto", hooks: { postDateReports: true } });
    await w.onboard("a", "b", "c");
    await dateWithBen(w, "a");
    await w.say("a", "Turns out he's married.");
    await dateWithBen(w, "c");
    await w.say("c", "He lied, he's married.");
    expect(w.net.safetyReports().map(r => [r.reporterId, r.subjectId, r.kind, r.source])).toEqual([["c", "b", "lying", "check_in"], ["a", "b", "lying", "check_in"]]);
    const ben = w.net.exportState().trust.find(r => r.id === "b");
    expect(ben?.reportsFrom.sort()).toEqual(["a", "c"]);
    expect(ben?.score).toBe(3);
    expect(ben?.level).toBe("watch");
  });
});
