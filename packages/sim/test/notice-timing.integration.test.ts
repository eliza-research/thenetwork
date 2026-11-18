import { expect, test } from "bun:test";
import { evaluateExpectations, loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("cancellation notice counts only after the persona sends it, before the meeting", async () => {
  const template = await loadScenario(`${import.meta.dir}/../scenarios/group-flake-morning-of.json`);
  const actual = [];
  for (const seed of [2, 9, 15]) for (const mode of ["early", "late", "stopped"] as const) {
    const scenario = structuredClone(template);
    scenario.days = 9;
    scenario.actions = scenario.actions.filter(a => a.do !== "force_flake");
    const persona = scenario.personas.find(p => p.ref === "dinner-4")!;
    persona.flakiness = 1;
    persona.responsiveness = { latencyMedianMin: mode === "early" ? 20 : 600, latencySigma: 0, ignoreProb: 0 };
    if (mode === "stopped") scenario.actions.push({ at: { day: 3, hour: 16 }, do: "opt_out", persona: persona.ref });
    scenario.expectations = [{ check: "flake_notice", persona: persona.ref }];
    const result = await new World(scenarioWorldOptions(scenario, {
      seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false,
    })).run();
    const outcomes = result.records.filter(r => r.type === "outcome");
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;
    const decisions = result.records.filter(r => r.type === "decision")
      .filter(r => r.memberId === persona.ref && r.intent === "flake_notice");
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.t).toBeLessThan(outcome.at);
    const messages = result.channel.all().filter(m => m.direction === "inbound" && m.memberId === persona.ref && /can't make it/.test(m.body));
    expect(messages).toHaveLength(mode === "stopped" ? 0 : 1);
    if (messages.length) expect(messages[0]!.ts).toBe(decision.t + decision.delayMs);
    actual.push({
      seed, mode, sentBeforeMeeting: messages.length ? messages[0]!.ts < outcome.at : null,
      showed: outcome.attendance[persona.ref]!.showed,
      notice: outcome.attendance[persona.ref]!.cancelledWithNotice,
      noShowRate: result.metrics.meetings.noShowRate,
      grade: evaluateExpectations(scenario, result, "stub")[0]!.status,
    });
  }
  expect(actual).toEqual([2, 9, 15].flatMap(seed => [
    { seed, mode: "early", sentBeforeMeeting: true, showed: false, notice: true, noShowRate: 0, grade: "pass" },
    { seed, mode: "late", sentBeforeMeeting: false, showed: false, notice: false, noShowRate: 0.167, grade: "fail" },
    { seed, mode: "stopped", sentBeforeMeeting: null, showed: false, notice: false, noShowRate: 0.167, grade: "fail" },
  ]));
});
