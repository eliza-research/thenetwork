import { describe, expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area: string) => ({
  id, name, age: 30, area, interests: ["climbing"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("allergy texted after onboarding", () => {
  test("an allergy text updates the stored red lines the engine reads", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "My sister is allergic to peanuts.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "My friend has a severe peanut allergy.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "If I had a peanut allergy, I would avoid Thai food.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "I'm not allergic to peanuts.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "I used to be allergic to peanuts.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "I have no allergies.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "Should I say I'm allergic to peanuts to skip the Thai place?");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "The menu says peanut allergy warnings everywhere.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    await w.say("a", "I love Thai food, peanut allergy warnings everywhere.");
    expect(w.net.memberRedLines("a")).not.toContain("severe_allergen");

    const from = w.mark();
    await w.say("a", "I'm allergic to peanuts.");
    expect(w.net.memberRedLines("a")).toContain("severe_allergen");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved to your profile that you have a severe allergy/);

    await w.say("a", "I keep halal.");
    expect(w.net.memberRedLines("a")).toContain("halal");

    await w.say("a", "I'm vegetarian now.");
    expect(w.net.memberRedLines("a")).toContain("vegetarian");

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("severe_allergen");
  });

  test("casual food and venue mentions do not become red lines", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    for (const text of [
      "I grabbed lunch at a halal cart today.",
      "I tried a vegan bakery in Greenpoint.",
      "My favorite bagel shop is kosher.",
      "I baked gluten-free brownies for the potluck.",
      "Yes, Thursday at 7pm works! I grabbed a halal platter earlier.",
      "I heard the new place is vegan.",
      "She is vegan and I eat with her often.",
      "My coworker keeps kosher.",
      "I'm vegan-ish.",
      "I'm vegan-curious.",
      "I'm kosher-style, not strict.",
      "I'm vegetarian on Mondays.",
      "I'm allergic to nuts lol jk",
    ]) {
      await w.say("a", text);
      expect(w.net.memberRedLines("a")).toEqual([]);
    }
    await w.say("a", "I am vegan.");
    expect(w.net.memberRedLines("a")).toContain("vegan");
    await w.say("a", "I eat only halal food.");
    expect(w.net.memberRedLines("a")).toContain("halal");
    await w.say("a", "I have celiac disease.");
    expect(w.net.memberRedLines("a")).toContain("gluten_free");
  });

  test("an allergy stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    await w.say("b", "Find me a climbing partner, I'm allergic to shellfish.");
    expect(w.net.memberRedLines("b")).toContain("severe_allergen");

    await w.say("b", "I keep kosher, have a shellfish allergy.");
    expect(w.net.memberRedLines("b")).toContain("kosher");

    const from = w.mark();
    await w.say("b", "Find me a climbing partner, I'm vegetarian.");
    expect(w.net.memberRedLines("b")).toContain("vegetarian");
    expect(w.to("b", from).map(s => s.body).join(" ")).toMatch(/saved to your profile that you're vegetarian/);
  });
});
