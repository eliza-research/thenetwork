// After a booking, a word about the number swap ("I don't want to share my number yet") is not a no to
// the plan: the date stays and the other member hears nothing. A no to the plan in the same message
// ("No. Also don't share my number", "I can't make it, and don't send my number") still calls it off.
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

describe("number talk after a booking", () => {
  for (const text of ["I don't want to share my number yet", "I don't want to give out my number", "I don't want to swap numbers anymore", "yes! but don't share my number yet"]) {
    test(`"${text}" keeps the booked plan`, async () => {
      const w = await booked();
      const from = w.mark();
      await w.say("a", text);
      expect(w.log("booked_cancelled")).toEqual([]);
      expect(scheduled(w)).toBe(true);
      expect(w.to("b", from)).toEqual([]);
    });
  }

  for (const text of ["No. Also don't share my number", "I can't make it, and don't send my number"]) {
    test(`"${text}" still calls it off`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(w.log("booked_cancelled").length).toBe(1);
      expect(scheduled(w)).toBe(false);
    });
  }
});
