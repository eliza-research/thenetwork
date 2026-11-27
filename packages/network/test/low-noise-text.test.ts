import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("low-noise need texted after onboarding", () => {
  test("a quiet-places text updates the stored red lines the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "My sister needs quiet places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "My friend can't do loud bars.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "If I needed quiet places, I would ask for them.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "I don't need quiet places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "I used to need quiet places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "Should I say I need quiet places to skip the loud bar?");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "He told me I need quiet places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "The cafe is a quiet place.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "I need quiet places for my dad.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "Just joking, I need quiet places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "Loud bars are fine for me.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "I don't mind loud places.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    await w.say("a", "I grabbed lunch at a quiet cafe today.");
    expect(w.net.memberRedLines("a")).not.toContain("low_noise");

    const from = w.mark();
    await w.say("a", "I need quiet places.");
    expect(w.net.memberRedLines("a")).toContain("low_noise");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved/);

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("low_noise");
  });

  test("explicit first-person low-noise needs are stored", async () => {
    for (const text of ["I can't do loud bars.", "I cannot do loud places.", "I'm noise-sensitive.", "I need somewhere quiet.", "I require low-noise venues.", "Loud places don't work for me."]) {
      const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
      await w.onboard("a", "b");
      await w.say("a", text);
      expect(w.net.memberRedLines("a"), text).toContain("low_noise");
    }
  });

  test("a low-noise text still activates a member whose onboarding stalled", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    const state = w.net.exportState();
    const a = state.members.find(m => m.id === "a")!;
    a.stage = "q1";
    a.activated = false;
    delete a.awaiting;
    w.net.importState(state);
    const from = w.mark();
    await w.say("a", "I need quiet places.");
    expect(w.net.memberRedLines("a")).toContain("low_noise");
    expect(w.net.exportState().members.find(m => m.id === "a")?.stage).toBe("active");
    expect(w.to("a", from)).toHaveLength(1);
    expect(w.to("a", from)[0]!.body).toMatch(/saved/);
  });

  test("a low-noise need stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    await w.say("b", "Find me a climbing partner, I need quiet places.");
    expect(w.net.memberRedLines("b")).toContain("low_noise");
  });
});
