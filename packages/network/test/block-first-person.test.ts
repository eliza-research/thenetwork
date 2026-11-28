import { describe, expect, test } from "vitest";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function bookedPair() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const opp = () => w.net.exportState().opps.find(o => o.id === id);
  expect(opp()?.stage).toBe("scheduled");
  return { w, opp };
}

async function bookedGroup() {
  const w = new Mini([climber("m", "Max Reed"), climber("s", "Sam Ortiz"), climber("a", "Ana Diaz"), climber("j", "Jordan Lee")]);
  await w.onboard("m", "s", "a", "j");
  const id = w.propose(["m", "s", "a"]);
  await w.answerProbes(["m", "s", "a"]);
  const opp = () => w.net.exportState().opps.find(o => o.id === id);
  expect(opp()?.stage).toBe("scheduled");
  return { w, opp };
}

describe("first-person block requests", () => {
  test("'I want to block him' blocks the booked counterpart and calls the meeting off", async () => {
    const { w, opp } = await bookedPair();
    const from = w.mark();
    await w.say("a", "I want to block him");
    expect(w.net.exportState().blocks).toEqual(["a|b"]);
    expect(opp()?.stage).toBe("closed");
    expect(w.to("a", from).map(s => s.body)).toEqual([copy.blocked]);
    expect(w.to("b", from).map(s => s.body)).toEqual([copy.declinedQuiet]);
  });

  test("'I need to block Ben Ito' blocks by name", async () => {
    const { w, opp } = await bookedPair();
    await w.say("a", "I need to block Ben Ito");
    expect(w.net.exportState().blocks).toEqual(["a|b"]);
    expect(opp()?.stage).toBe("closed");
  });

  test("'I want to block my date' uses the counterpart chooser", async () => {
    const { w, opp } = await bookedPair();
    await w.say("a", "I want to block my date");
    expect(w.net.exportState().blocks).toEqual(["a|b"]);
    expect(opp()?.stage).toBe("closed");
  });

  test("'I'd like to block Sam' blocks Sam and nobody else", async () => {
    const { w } = await bookedGroup();
    await w.say("m", "I'd like to block Sam");
    expect(w.net.exportState().blocks).toEqual(["m|s"]);
    expect(w.net.safetyReports()).toEqual([]);
  });

  test("conditional and non-person first-person forms do not block", async () => {
    const { w, opp } = await bookedPair();
    for (const text of ["I want to block him if he texts again", "I want to block out Saturday"]) {
      await w.say("a", text);
      expect(w.net.exportState().blocks).toEqual([]);
      expect(opp()?.stage).toBe("scheduled");
    }
    await w.say("a", "I don't want to block him");
    expect(w.net.exportState().blocks).toEqual([]);
  });

  test.each([
    "I want to block Saturday for Sam",
    "I'd like to block lunch with Sam on Friday",
    "I need to block an hour with Ana",
    "I'd like to report some feedback about Sam's plan",
    "I need to block Sam's time on Friday",
    "I need to block Sam's birthday on my calendar",
    "I want to block next Friday for Sam",
    "I need to block early Saturday for Sam",
    "I'd like to block half an hour with Sam",
    "I want to block next week for Ana",
    "I want to block late Friday for drinks with Sam",
    "I need to block spam texts",
    "I want to block notifications",
    "I need to block next weekend for Ana and me",
    "I want to block March 5 for Sam",
    "I need to block Oct 17 for Ana",
    "i want to block march 5 for sam",
    "i need to block spam texts",
    "i want to block notifications",
  ])("a non-person first-person object blocks and reports nobody: %s", async text => {
    const { w, opp } = await bookedGroup();
    const from = w.mark();
    await w.say("m", text);
    expect(w.net.exportState().blocks).toEqual([]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("scheduled");
    const replies = w.to("m", from).map(s => s.body);
    expect(replies).not.toContain(copy.blocked);
    expect(replies).not.toContain(copy.blockUnmatched);
    expect(replies).not.toContain(copy.reportUnmatched());
  });

  test.each([
    "I want to block Jordan, Sam is fine",
    "I'd like to block Jordan, not Sam",
    "I want to block Jordan, but not Sam",
    "I want to block Jordan instead of Sam",
    "I'd like to block Jordan rather than Sam",
    "I want to block Jordan though Sam is fine",
    "I want to block Jordan (Sam is fine)",
    "I need to block Jordan and keep Sam",
    "I want to block Jordan—Sam is fine",
    "I want to block Jordan Sam is fine",
    "I want to block Jordan Sam is my friend",
    "I want to block Jordan Sam seems fine",
    "I want to block Jordan Sam can stay",
    "I want to block Jordan Sam has been great",
    "I want to block Jordan Sam stays",
    "I want to block Jordan Sam will stay",
    "I need to block Jordan Sam isn't the problem",
    "I want to block Jordan Sam and Ana are fine",
    "I want to block Jordan Sam I like",
  ])("a name in a later clause is not the target: %s", async text => {
    const { w, opp } = await bookedGroup();
    const from = w.mark();
    await w.say("m", text);
    expect(w.net.exportState().blocks).toEqual(["j|m"]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("scheduled");
    expect(w.to("m", from).map(s => s.body)).toEqual([copy.blockUnmatched]);
  });

  test("a possessive after a second name blocks nobody", async () => {
    const { w, opp } = await bookedGroup();
    const from = w.mark();
    await w.say("m", "I want to block Jordan Sam's fine");
    expect(w.net.exportState().blocks).toEqual([]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("scheduled");
    const replies = w.to("m", from).map(s => s.body);
    expect(replies).not.toContain(copy.blocked);
    expect(replies).not.toContain(copy.blockUnmatched);
    expect(replies).not.toContain(copy.reportUnmatched());
  });

  test("a quoted name blocks that counterpart", async () => {
    const { w, opp } = await bookedGroup();
    await w.say("m", "I need to block \"Sam\"");
    expect(w.net.exportState().blocks).toEqual(["m|s"]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("closed");
  });

  test.each([
    "I want to block Sam for being rude",
    "I'd like to block Sam Lee",
    "i want to block sam",
    "i need to block sam ortiz",
    "i want to block sam for being rude",
    "I want to block Sam Lee is rude",
    "I want to block Sam is that possible",
  ])("a named counterpart with a reason or a full name blocks: %s", async text => {
    const { w, opp } = await bookedGroup();
    await w.say("m", text);
    expect(w.net.exportState().blocks).toEqual(["m|s"]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("closed");
  });

  test("a full name followed by a reason keeps the surname when two counterparts share a first name", async () => {
    const w = new Mini([climber("m", "Max Reed"), climber("s1", "Sam Lee"), climber("s2", "Sam Park")]);
    await w.onboard("m", "s1", "s2");
    const id = w.propose(["m", "s1", "s2"]);
    await w.answerProbes(["m", "s1", "s2"]);
    await w.say("m", "I want to block Sam Lee for being rude");
    expect(w.net.exportState().blocks).toEqual(["m|s1"]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(w.net.exportState().opps.find(o => o.id === id)?.stage).toBe("closed");
  });

  test("lowercase later-clause phrasing keeps only the first named target", async () => {
    const { w, opp } = await bookedGroup();
    const from = w.mark();
    await w.say("m", "i want to block jordan instead of sam");
    expect(w.net.exportState().blocks).toEqual(["j|m"]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(opp()?.stage).toBe("scheduled");
    expect(w.to("m", from).map(s => s.body)).toEqual([copy.blockUnmatched]);
  });
});
