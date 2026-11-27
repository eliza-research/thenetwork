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

    await w.say("a", "My apartment has no stairs to the roof.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I pushed a wheelchair as a hospital volunteer.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I prefer no stairs after leg day.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "My building has wheelchair access in the lobby.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "My office is wheelchair accessible.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    await w.say("a", "I saw a wheelchair ramp at the station.");
    expect(w.net.memberRedLines("a")).not.toContain("wheelchair");

    const from = w.mark();
    await w.say("a", "I need step-free access for meetups.");
    expect(w.net.memberRedLines("a")).toContain("wheelchair");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved/);

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("wheelchair");
  });

  test("explicit first-person accessibility needs are stored", async () => {
    for (const text of ["I use a wheelchair.", "I'm in a wheelchair.", "I require elevator access.", "I can't do stairs.", "I cannot do stairs, please pick ground floor places.", "My wheelchair needs step-free access."]) {
      const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
      await w.onboard("a", "b");
      await w.say("a", text);
      expect(w.net.memberRedLines("a"), text).toContain("wheelchair");
    }
  });

  test("an accessibility text still activates a member whose onboarding stalled", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    const state = w.net.exportState();
    const a = state.members.find(m => m.id === "a")!;
    a.stage = "q1";
    a.activated = false;
    delete a.awaiting;
    w.net.importState(state);
    const from = w.mark();
    await w.say("a", "I need step-free access for meetups.");
    expect(w.net.memberRedLines("a")).toContain("wheelchair");
    expect(w.net.exportState().members.find(m => m.id === "a")?.stage).toBe("active");
    expect(w.to("a", from)).toHaveLength(1);
    expect(w.to("a", from)[0]!.body).toMatch(/saved/);
  });

  test("an accessibility need stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    await w.say("b", "Find me a climbing partner, I need wheelchair access.");
    expect(w.net.memberRedLines("b")).toContain("wheelchair");
  });
});
