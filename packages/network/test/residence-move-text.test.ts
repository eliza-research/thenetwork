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

    const from = w.mark();
    await w.say("a", "I moved to Astoria.");
    expect(areaOf(w, "a")).toBe("Astoria");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/home area to Astoria/);

    await w.say("a", "My friend lives in Bay Ridge.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "I used to live in Bay Ridge.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "If I moved to Bay Ridge I would climb more.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "I live in Bay Ridge now.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm in Soho right now, anyone free for coffee?");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm in Williamsburg tonight for a show.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm near Bushwick this afternoon.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm around Greenpoint after 6pm.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm in Astoria for dinner.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I'm now in Astoria.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "I moved to Bay Ridge in 2015 and then left.");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "Should I live in Bay Ridge?");
    expect(areaOf(w, "a")).toBe("Astoria");

    await w.say("a", "My new apartment is in Bushwick.");
    expect(areaOf(w, "a")).toBe("Bushwick");

    await w.say("a", "I moved out of Bushwick, I live in Bay Ridge now.");
    expect(areaOf(w, "a")).toBe("Bay Ridge");

    await w.say("a", "I live in Inwood now.");
    expect(areaOf(w, "a")).toBe("Inwood");

    await w.say("a", "I moved to Astoria last year, then moved back to Inwood.");
    expect(areaOf(w, "a")).toBe("Inwood");

    await w.say("a", "I moved to Astoria in my dreams lol");
    expect(areaOf(w, "a")).toBe("Inwood");
  });
});
