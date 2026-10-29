// A refusal that starts with "ok" or "sure" ("ok, not going", "sure I'm away that week") is a no to the
// probe: no meeting is booked. A yes that only uses the same words ("sure, don't cancel it") still books.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const scheduled = (w: Mini) => [...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled");
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

  for (const text of ["sure, don't cancel it", "yes, not going to lie I'm excited", "yes! never mind what I said before", "nvm I can make it"]) {
    test(`"${text}" books the meeting`, async () => {
      expect((await probeAnswer(text)).meetings.length).toBe(1);
    });
  }
});

// After a booking, a yes that uses the same words keeps the date; an ok/sure refusal calls it off.
describe("a reply to a booked plan", () => {
  async function booked() {
    const w = await probeAnswer("yes");
    expect(scheduled(w)).toBe(true);
    return w;
  }
  for (const text of ["I'm not coming late, see you at 7", "yes! never mind what I said before", "nvm I can make it"]) {
    test(`"${text}" keeps the date`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(w.log("booked_cancelled")).toEqual([]);
      expect(scheduled(w)).toBe(true);
    });
  }
  for (const text of ["ok, not going", "ok never mind"]) {
    test(`"${text}" calls it off`, async () => {
      const w = await booked();
      await w.say("a", text);
      expect(scheduled(w)).toBe(false);
    });
  }
});
