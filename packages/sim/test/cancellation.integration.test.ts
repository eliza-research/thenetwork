import { expect, test } from "bun:test";
import { evaluateExpectations, loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("only a delivered whole-meeting cancellation stops the remaining participants attending", async () => {
  const template = await loadScenario(`${import.meta.dir}/../scenarios/group-flake-morning-of.json`);
  const outcomes = [];
  const cases = [
    { size: 2, flake: false, seed: 21, failureRate: 0 },
    { size: 2, flake: true, seed: 21, failureRate: 0 },
    { size: 6, flake: false, seed: 21, failureRate: 0 },
    { size: 6, flake: true, seed: 21, failureRate: 0 },
    { size: 2, flake: true, seed: 35, failureRate: 0.1 },
  ];
  for (const { size, flake, seed, failureRate } of cases) {
    const scenario = structuredClone(template);
    scenario.personas = scenario.personas.slice(0, size);
    if (size === 2) for (const persona of scenario.personas) persona.preferredGroupSize = 2;
    scenario.actions = scenario.actions.filter(a => a.do !== "force_flake" || flake);
    for (const action of scenario.actions) {
      if (action.do === "force_flake") action.persona = "dinner-1";
      if (action.do === "propose") {
        action.participants = scenario.personas.map(p => p.ref);
        if (size === 2) action.kind = "intro";
      }
    }
    scenario.expectations = [
      { check: "flake_notice", persona: "dinner-1" },
      { check: "flake_notice", persona: "dinner-2" },
      { check: "others_notified_of_drop", persona: "dinner-1" },
      { check: "others_notified_of_drop", persona: "dinner-2" },
    ];
    const result = await new World({ ...scenarioWorldOptions(scenario, {
      seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false,
    }), failureRate }).run();
    const meetings = result.records.filter(r => r.type === "outcome");
    const cancellations = result.channel.all().filter(m => m.direction === "outbound" && m.meta?.type === "cancellation");
    expect(meetings).toHaveLength(1);
    expect(cancellations).toHaveLength(flake ? size - 1 : 0);
    expect(cancellations.every(m => m.status === (failureRate ? "failed" : "delivered") && m.ts < meetings[0]!.at)).toBe(true);
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.invariants.total).toBe(0);
    outcomes.push({
      size, flake, seed,
      showed: Object.entries(meetings[0]!.attendance).filter(([, a]) => a.showed).map(([id]) => id),
      cancelled: Object.entries(meetings[0]!.attendance).filter(([, a]) => a.cancelledWithNotice || a.cancelledByNetwork).map(([id]) => id),
      noShowRate: result.metrics.meetings.noShowRate,
      grades: evaluateExpectations(scenario, result, "stub").map(g => g.status),
    });
  }
  const all = template.personas.map(p => p.ref);
  expect(outcomes).toEqual([
    { size: 2, flake: false, seed: 21, showed: all.slice(0, 2), cancelled: [], noShowRate: 0, grades: ["fail", "fail", "fail", "fail"] },
    { size: 2, flake: true, seed: 21, showed: [], cancelled: all.slice(0, 2), noShowRate: 0, grades: ["pass", "fail", "pass", "fail"] },
    { size: 6, flake: false, seed: 21, showed: all, cancelled: [], noShowRate: 0, grades: ["fail", "fail", "fail", "fail"] },
    { size: 6, flake: true, seed: 21, showed: all.slice(1), cancelled: all.slice(0, 1), noShowRate: 0, grades: ["pass", "fail", "pass", "fail"] },
    { size: 2, flake: true, seed: 35, showed: all.slice(1, 2), cancelled: all.slice(0, 1), noShowRate: 0, grades: ["pass", "fail", "fail", "fail"] },
  ]);
});
