import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

const nameOf = (w: Mini, id: string) => w.net.exportState().members.find(m => m.id === id);

describe("name change texted after onboarding", () => {
  test("a name-change text updates the stored name the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(nameOf(w, "a")?.first).toBe("Ana");

    await w.say("a", "Please call me Ari.");
    expect(nameOf(w, "a")?.first).toBe("Ari");
    expect(nameOf(w, "a")?.name).toBe("Ari Diaz");
    expect(nameOf(w, "a")?.display).toBe("Ari D.");

    await w.say("a", "Call me at 415-555-0199.");
    expect(nameOf(w, "a")?.first).toBe("Ari");

    await w.say("a", "My friend said call me Bea.");
    expect(nameOf(w, "a")?.first).toBe("Ari");

    await w.say("a", "If I changed it, call me Bea.");
    expect(nameOf(w, "a")?.first).toBe("Ari");

    await w.say("a", "Don't call me Bea.");
    expect(nameOf(w, "a")?.first).toBe("Ari");

    await w.say("a", "My name is Bea.");
    expect(nameOf(w, "a")?.first).toBe("Bea");

    await w.say("a", "I go by Cyd now.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");
  });
});
