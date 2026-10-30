import { expect, test } from "bun:test";
import { Mini } from "./mini.ts";

test("a skill sought during onboarding is not the seeker's own capability", async () => {
  for (const seed of [1, 2, 3]) for (const row of [
    { body: "I need a product designer.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "I am a product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "I'm looking for someone who plays bass.", skill: "bass", ask: "Help me start a band.", own: false },
    { body: "I play bass.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "Product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "Plays bass.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "I enjoy quiet walks.", skill: "design", ask: "I want to meet other founders.", own: false },
  ]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30 }, { id: "b", name: "Boris Bell", age: 32 }], { seed, review: "human" });
    await x.onboard("a");
    for (const text of ["hi!", row.body, "Weekends, mostly.", "One-on-one is good."]) await x.say("b", text);
    x.restart();
    const input = x.net.engineInput(x.clock.now());
    expect(input.facets.some(f => f.memberId === "b" && f.kind === "skill" && f.tags.includes(row.skill))).toBe(row.own);
    await x.say("a", row.ask);
    expect(x.net.reviewQueue().length).toBe(row.own ? 1 : 0);
    expect(x.net.reviewQueue().every(q => q.proposal.participants.includes("b"))).toBe(true);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
  }
});
