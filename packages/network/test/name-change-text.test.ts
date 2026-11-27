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

    const from = w.mark();
    await w.say("a", "Please call me Ari.");
    expect(nameOf(w, "a")?.first).toBe("Ari");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/call you Ari/);
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

    await w.say("a", "Sorry, I'm called away tonight.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "I'm called into work this afternoon.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me crazy, Saturday works!");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me old-fashioned, I prefer coffee.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me biased, that spot is great.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "I go by train usually.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "I go by myself usually.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me Monday.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me after 6.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me ASAP.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me around noon.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Yes! Call me Thursday about the plan.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me tmrw.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me during lunch.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Can you call me Uber?");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me impatient but any news on my climbing partner?");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Call me Beyonce lol");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "My boss likes to call me Champ.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "My coworkers call me Champ.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "The book starts with Call me Ishmael.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "My name is spelled wrong on the reservation.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "Correction: my name is spelled Jon, not John.");
    expect(nameOf(w, "a")?.first).toBe("Cyd");

    await w.say("a", "call me ari");
    expect(nameOf(w, "a")?.first).toBe("Ari");
    expect(nameOf(w, "a")?.name).toBe("Ari Diaz");
  });

  test("a booked partner can still block by the name they were introduced to", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);

    const from = w.mark();
    await w.say("a", "Please call me Ari.");
    expect(nameOf(w, "a")?.first).toBe("Ari");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/call you Ari/);

    await w.say("b", "Block Ana.");
    expect(w.net.exportState().blocks).toContain("a|b");
  });
});
