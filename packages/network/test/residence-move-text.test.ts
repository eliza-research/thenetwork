import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

const areaOf = (w: Mini, id: string) => w.net.exportState().members.find(m => m.id === id)?.area;

describe("residence move texted after onboarding", () => {
  test("a move text updates the stored residence the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(areaOf(w, "a")).toBe("Greenpoint");

    await w.say("a", "I moved to Astoria.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "My friend lives in Bay Ridge.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "I used to live in Bay Ridge.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "If I moved to Bay Ridge I would climb more.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "I live in Bay Ridge now.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");
  });
});
