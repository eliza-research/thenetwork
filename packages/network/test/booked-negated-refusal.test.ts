// "Yes, please don't cancel" after a booking is a yes: a refusal word under a negation ("don't go
// without me", "don't ask someone else") keeps the booked plan; the plain refusal still calls it off.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const scheduled = (w: Mini) => [...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled");

async function booked() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  expect(scheduled(w)).toBe(true);
  return w;
}

describe("a negated refusal after a booking", () => {
  for (const text of ["Yes, please don't cancel", "Yes, don't go without me", "Yes, don't ask someone else", "Yes, do not deal me out", "Yes, don't go ahead without me"]) {
    test(`"${text}" keeps the booked plan`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(w.log("booked_cancelled")).toEqual([]);
      expect(scheduled(w)).toBe(true);
    });
  }

  // Cases from review by @dkuthoore: a plain refusal, or a request not to arrange it, still calls it off.
  for (const text of ["go ahead without me", "Please do not!", "Please do not arrange this meeting"]) {
    test(`"${text}" still calls it off`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(w.log("booked_cancelled").length).toBe(1);
      expect(scheduled(w)).toBe(false);
    });
  }
});
