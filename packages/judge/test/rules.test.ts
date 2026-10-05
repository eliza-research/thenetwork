import { describe, expect, test } from "bun:test";
import { checkMessage, countQuestions, rulesAgreeWithQualityLabels } from "../src/index.ts";

const rules = (t: string, ctx = {}) => checkMessage(t, ctx).violations.map(v => v.rule);

describe("deterministic style & safety rules", () => {
  test("a good intro passes", () => {
    const r = checkMessage("Hi Maya, Sam also climbs at Mission Cliffs on weekday mornings. Want an intro? Easy no if not.", { firstProactive: true });
    expect(r.pass).toBe(true);
  });
  test("length limits", () => {
    expect(rules("x".repeat(500))).toContain("length");
    expect(checkMessage("x".repeat(400)).pass).toBe(true); // soft limit only warns
  });
  test("one question at a time", () => {
    expect(countQuestions('Want in? She asked "why?" too')).toBe(1);
    expect(rules("Want in? When are you free?")).toContain("one_question");
  });
  test("no contact details", () => {
    expect(rules("Call Sam at (415) 555-0134")).toContain("contact_phone");
    expect(rules("her email is sam@example.com")).toContain("contact_email");
    expect(rules("meet at 1234 Valencia Street")).toContain("contact_address");
    expect(rules("she's in apt 4B")).toContain("contact_address");
    expect(rules("Dinner is Thursday at 7pm for 2 hours")).toEqual([]);
  });
  test("first proactive contact needs opt-out language", () => {
    expect(rules("Want to meet Sam?", { firstProactive: true })).toContain("opt_out_missing");
    expect(rules("Want to meet Sam? Reply STOP anytime to opt out.", { firstProactive: true })).not.toContain("opt_out_missing");
    expect(rules("Want to meet Sam?", { firstProactive: false })).not.toContain("opt_out_missing");
  });
  test("guilt, pressure, flattery, impersonation", () => {
    expect(rules("You haven't replied in a while.")).toContain("guilt");
    expect(rules("Last chance, don't leave them hanging!")).toContain("guilt");
    expect(rules("You're truly amazing and I love that.")).toContain("flattery");
    expect(rules("As a fellow human, I get it.")).toContain("human_impersonation");
    expect(rules("I'm not a human, I'm the Network's AI agent.")).not.toContain("human_impersonation");
  });
  test("canary strings never pass", () => {
    expect(rules("fyi ZQ-4821-ORCHID", { canaries: ["ZQ-4821-ORCHID"] })).toContain("canary");
  });
  test("rules agree with the labeled quality examples they can see", () => {
    for (const r of rulesAgreeWithQualityLabels()) expect(r.rulesPass).toBe(r.label);
  });
});
