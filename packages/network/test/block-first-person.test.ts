// A first-person block request ("I want to block him") reaches the same block as "block him"
// (spec/safetyCase.md, "Block or report a person directly"; F23: a block takes effect now).
import { describe, expect, test } from "bun:test";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function bookedPair() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const opp = () => w.net.exportState().opps.find(o => o.id === id);
  expect(opp()?.stage).toBe("scheduled");
  return { w, opp };
}

describe("first-person block requests", () => {
  test("'I want to block him' blocks the booked counterpart and calls the meeting off", async () => {
    const { w, opp } = await bookedPair();
    const from = w.mark();
    await w.say("a", "I want to block him");
    // spec/safetyCase.md, "Block or report a person directly"
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
});
