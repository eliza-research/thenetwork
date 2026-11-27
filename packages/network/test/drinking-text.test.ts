import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("drinking fact texted after onboarding", () => {
  test("a no-drinking text updates the stored red lines the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "My sister doesn't drink.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "My friend is sober.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "If I don't drink tonight, I can drive us home.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink coffee.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink much.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I'm not sober.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I used to be sober.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "Should I say I don't drink to skip the bar?");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "He told me I don't drink enough water.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    const from = w.mark();
    await w.say("a", "I don't drink.");
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved/);

    await w.say("a", "I'm sober.");
    expect(w.net.memberRedLines("a")).toContain("strict_sober");

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.net.memberRedLines("a")).toContain("strict_sober");
  });

  test("a drinking fact stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    await w.say("b", "Find me a climbing partner, I don't drink alcohol.");
    expect(w.net.memberRedLines("b")).toContain("non_drinker");
  });
});
