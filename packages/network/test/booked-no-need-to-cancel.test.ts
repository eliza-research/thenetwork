// After a booking, "no need to cancel" is not a cancel: the date stays and the
// other member hears nothing. "I need to cancel" still calls it off.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const scheduled = (w: Mini) => [...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled");

async function booked() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(scheduled(w)).toBe(true);
  return w;
}

describe("cancel words after a booking", () => {
  for (const text of ["no need to cancel, see you there", "no need to cancel, I'm still coming"]) {
    test(`"${text}" keeps the date`, async () => {
      const w = await booked();
      const from = w.mark();
      await w.say("a", text);
      expect(w.log("booked_cancelled")).toEqual([]);
      expect(scheduled(w)).toBe(true);
      expect(w.to("b", from)).toEqual([]);
    });
  }

  for (const text of ["I need to cancel, sorry", "sorry, something came up"]) {
    test(`"${text}" calls it off`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(w.log("booked_cancelled").length).toBe(1);
      expect(scheduled(w)).toBe(false);
    });
  }
});
