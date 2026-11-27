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

    await w.say("a", "I had one beer an hour ago so I am sober now.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I stayed sober last night to drive.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I am sober enough to drive.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I don't drink on weeknights.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink on weekdays.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink this week.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink before work.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink while driving.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink beer, prefer wine.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I don't drink cocktails.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    const from = w.mark();
    await w.say("a", "I don't drink.");
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.to("a", from).map(s => s.body).join(" ")).toMatch(/saved that you don't drink/);

    const fromSober = w.mark();
    await w.say("a", "I'm sober.");
    expect(w.net.memberRedLines("a")).toContain("strict_sober");
    expect(w.to("a", fromSober).map(s => s.body).join(" ")).toMatch(/saved that you're strictly sober/);

    w.restart();
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.net.memberRedLines("a")).toContain("strict_sober");
  });

  test("standing abstinence statements still save, and the turn stays open", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");

    await w.say("b", "I don't drink anymore.");
    expect(w.net.memberRedLines("b")).toContain("non_drinker");

    await w.say("b", "I am alcohol-free.");
    expect(w.net.memberRedLines("b")).toContain("strict_sober");

    const from = w.mark();
    const disposition = await w.net.onInbound({ id: "open-turn-1", memberId: "a", body: "I never drink.", ts: w.clock.now(), channel: "sms" });
    expect(disposition).toBe("open");
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.to("a", from).filter(s => /saved/.test(s.body))).toHaveLength(1);
  });

  test("a drinking fact from a stalled onboarding still activates the member", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.say("a", "hi!");
    await w.run(4 * 24 * 60 * 60 * 1000);
    await w.say("a", "I don't drink.");
    expect(w.net.memberRedLines("a")).toContain("non_drinker");
    expect(w.net.exportState().members.find(m => m.id === "a")?.stage).toBe("active");
  });

  test("a drinking fact stated with a request is stored before the search", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");
    const from = w.mark();
    await w.say("b", "Find me a climbing partner, I don't drink alcohol.");
    expect(w.net.memberRedLines("b")).toContain("non_drinker");
    expect(w.to("b", from).map(s => s.body).join(" ")).toMatch(/saved that you don't drink/);
  });

  test("another person's recovery, a medical recovery, a venue wish, a hedge and a joke save nothing", async () => {
    const w = new Mini([climber("a", "Ana Diaz", "Greenpoint"), climber("b", "Ben Ito", "Astoria")]);
    await w.onboard("a", "b");

    await w.say("a", "I'm in recovery from knee surgery.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I'm in recovery after my surgery, so nothing too active.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "My boyfriend is in recovery.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "My fiance is in recovery.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "My cousin is in AA.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "My date is a non-drinker, pick somewhere else.");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I want to try a zero alcohol bar.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I'm sober-ish.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I'm sober-curious.");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I'm sober as a judge lol");
    expect(w.net.memberRedLines("a")).not.toContain("strict_sober");

    await w.say("a", "I don't drink... unless it's free lol");
    expect(w.net.memberRedLines("a")).not.toContain("non_drinker");

    await w.say("a", "I'm in recovery, please no bar meetups.");
    expect(w.net.memberRedLines("a")).toContain("strict_sober");

    await w.say("b", "I've been sober for two years.");
    expect(w.net.memberRedLines("b")).toContain("strict_sober");

    await w.say("b", "I'm in AA.");
    expect(w.net.memberRedLines("b")).toContain("strict_sober");

    await w.say("b", "I can't be around alcohol.");
    expect(w.net.memberRedLines("b")).toContain("strict_sober");

    await w.say("b", "I'm a recovering alcoholic.");
    expect(w.net.memberRedLines("b")).toContain("strict_sober");

    await w.say("b", "I'm teetotal.");
    expect(w.net.memberRedLines("b")).toContain("non_drinker");
  });
});
