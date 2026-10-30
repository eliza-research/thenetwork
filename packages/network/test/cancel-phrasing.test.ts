// Cancellation phrasing: recognize standard modal, polite, and contextual requests to cancel a booked date or meeting.
// Messages like "I have to cancel", "please cancel our date", "cancel tonight", and "won't be able to make it" must drop the booked plan and notify the other member.
import { describe, expect, test } from "bun:test";
import { classify } from "../src/classify.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

const scheduled = (w: Mini) => [...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled");

async function bookedWorld() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(scheduled(w)).toBe(true);
  return w;
}

describe("cancellation phrasing classification", () => {
  const cancelPhrases = [
    "I have to cancel",
    "I need to cancel",
    "I want to cancel",
    "I'd like to cancel",
    "please cancel our date",
    "can we cancel tonight?",
    "please cancel",
    "cancel the date",
    "cancel our meeting",
    "cancel tonight",
    "cancel tomorrow",
    "won't be able to make it",
    "not gonna make it",
    "not going to make it",
    "unable to attend",
    "can't make tonight",
    "can't make today",
    "can't make Friday",
    "call off the date",
    "call it off",
    "have to call it off",
    "call the meeting off",
    "have to bail",
    "can't make it",
    "something came up",
    "something came up, can't make it",
  ];

  for (const text of cancelPhrases) {
    test(`classifies "${text}" as cancel`, () => {
      expect(classify(text).kind).toBe("cancel");
    });
  }

  const nonCancelPhrases = [
    "no need to cancel, see you there",
    "we don't need to cancel",
    "don't cancel our meeting",
    "please don't cancel",
    "I'm looking for someone who won't cancel",
    "sounds good, see you tonight",
    "let's do dinner tonight",
  ];

  for (const text of nonCancelPhrases) {
    test(`does not classify "${text}" as cancel`, () => {
      expect(classify(text).kind).not.toBe("cancel");
    });
  }
});

describe("cancellation phrasing in Network service", () => {
  for (const text of ["I have to cancel", "please cancel our date", "cancel tonight, sorry", "won't be able to make it tonight", "have to call it off"]) {
    test(`"${text}" drops the booked meeting and acknowledges cancellation`, async () => {
      const w = await bookedWorld();
      const from = w.mark();
      await w.say("a", text);
      expect(w.log("booked_cancelled").length).toBe(1);
      expect(scheduled(w)).toBe(false);
      const toA = w.to("a", from);
      expect(toA.some(s => s.body.includes("No worries"))).toBe(true);
    });
  }
});
