// A refusal that starts with "ok" or "sure" ("ok, not going", "sure I'm away that week") is a no to the
// probe: no meeting is booked. A yes that only uses the same words ("sure, don't cancel it") still books.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function probeAnswer(text: string) {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"], id => (id === "a" ? text : "yes"));
  return w;
}

describe("a probe answer that starts with ok or sure", () => {
  for (const text of ["ok, not going", "ok cancel", "I'm in no mood", "sure I'm away that week", "ok not anymore", "ok never mind"]) {
    test(`"${text}" books no meeting`, async () => {
      expect((await probeAnswer(text)).meetings).toEqual([]);
    });
  }

  for (const text of ["sure, don't cancel it", "yes, not going to lie I'm excited"]) {
    test(`"${text}" books the meeting`, async () => {
      expect((await probeAnswer(text)).meetings.length).toBe(1);
    });
  }
});
