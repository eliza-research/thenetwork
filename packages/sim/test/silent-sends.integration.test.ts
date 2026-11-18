import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld } from "../src/world.ts";

test("silence stops queued replies and automatic flake notices while explicit script messages still send", async () => {
  const actual = [], expected = [];
  const explicitText = "This is my one scripted update.";
  for (const family of ["reply", "flake"] as const) {
    const template = await loadScenario(resolve(import.meta.dir, `../scenarios/${family === "reply" ? "member-goes-silent" : "group-flake-morning-of"}.json`));
    const target = family === "reply" ? "ghost" : "dinner-4";
    for (const seed of family === "reply" ? [8, 14, 30] : [1, 3, 10]) {
      for (const mode of family === "reply" ? ["normal", "silent", "explicit"] : ["normal", "silent"]) {
        const scenario = structuredClone(template);
        if (family === "flake") {
          scenario.actions = scenario.actions.filter(a => a.do !== "force_flake");
          scenario.personas.find(p => p.ref === target)!.flakiness = 1;
          scenario.actions.push({ at: { day: 2, hour: 12 }, do: "go_silent", persona: target });
        }
        if (mode === "explicit") scenario.actions.push({ at: { day: 2, hour: 12 }, do: "say", persona: target, text: explicitText });
        const options = scenarioWorldOptions(scenario, { seed, network: () => new StubNetwork({ randomIntros: family === "reply" }), writeLog: false });
        const cutoff = options.actions!.find(a => a.action.do === "go_silent")!.at;
        if (mode === "normal") options.actions = options.actions!.filter(a => a.action.do !== "go_silent");
        const world = await runWorld(options);
        const messages = world.records.filter(r => r.type === "message").map(r => r.msg)
          .filter(m => m.direction === "inbound" && m.memberId === target);
        const late = messages.filter(m => m.ts >= cutoff);
        const queued = world.records.some(r => r.type === "decision" && r.memberId === target
          && r.t < cutoff && r.t + r.delayMs >= cutoff && r.intent !== "ignore");
        const outcome = world.records.find(r => r.type === "outcome");
        actual.push({ family, seed, mode, spokeBefore: messages.some(m => m.ts < cutoff),
          queuedBefore: family === "reply" ? queued : undefined,
          automaticAfter: late.some(m => m.body !== explicitText), explicitAfter: late.filter(m => m.body === explicitText).length,
          cancelledWithNotice: family === "flake" ? outcome!.attendance[target]!.cancelledWithNotice : undefined });
        expected.push({ family, seed, mode, spokeBefore: true, queuedBefore: family === "reply" ? true : undefined,
          automaticAfter: mode === "normal", explicitAfter: mode === "explicit" ? 1 : 0,
          cancelledWithNotice: family === "flake" ? mode === "normal" : undefined });
      }
    }
  }
  expect(actual).toEqual(expected);
});
