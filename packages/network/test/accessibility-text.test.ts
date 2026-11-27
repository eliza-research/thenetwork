import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("accessibility need texted after onboarding", () => {
  test("a step-free text updates the stored red lines the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "My sister needs step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "My friend uses a wheelchair.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "If I needed step-free access, I would ask for it.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I don't need step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I used to need step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "Should I say I need step-free access to skip the stairs venue?");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "He told me I need step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "The cafe has step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I need step-free access for my dad.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "Just joking, I need step-free access.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    const from = w.mark();
    await w.say("a", "I need step-free access for meetups.");
    expect(w.net.memberRedLines("a")).toContain("wheelchair");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved/);

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("wheelchair");
  });

  test("an accessibility need stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    await w.say("b", "Find me a climbing partner, I need wheelchair access.");
    expect(w.net.memberRedLines("b")).toContain("wheelchair");
  });
});
