// A bare counter-offer ("How about Friday?") is not a yes (decision 11): it affirms nothing, so
// the member is asked again and never booked. A counter with an affirmation in the same reply
// ("Sounds fun! How about next week instead") stays a yes with no pick, as the consent corpus
// has always read it. Before the fix, parseProbeReply promoted every counter to a yes, so two
// members who only ever proposed other days were booked with each other.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

const scheduled = (w: Mini) => [...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled");

describe("a counter-offer to a probe", () => {
  test("two bare counters never book: both members are asked again instead", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"], () => "How about Friday?");
    await w.run(2 * DAY);
    expect(w.meetings.length).toBe(0);
    expect(scheduled(w)).toBe(false);
    expect(w.log("probe_unclear").length).toBeGreaterThan(0);
  });

  test("a hedged counter never books: an affirmation word under a hedge is not a yes", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"], () => "I'm not sure; how about Friday?");
    await w.run(2 * DAY);
    expect(w.meetings.length).toBe(0);
    expect(scheduled(w)).toBe(false);
    expect(w.log("probe_unclear").length).toBeGreaterThan(0);
  });

  test("an affirmed counter still counts as a yes with no pick", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"], id => (id === "a" ? "Sounds fun! How about next week instead" : "yes"));
    expect(w.meetings.length).toBe(1);
  });
});
