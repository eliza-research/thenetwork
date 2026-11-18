import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadScenario, runScenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("meeting_held requires an actual meeting when checking one named attendee", async () => {
  const template = await loadScenario(resolve(import.meta.dir, "../scenarios/group-flake-morning-of.json"));
  const actual = [], expected = [];
  for (const seed of [2, 9, 15]) for (const flake of [false, true]) {
    const s = structuredClone(template);
    s.personas = s.personas.slice(0, 2);
    for (const p of s.personas) p.preferredGroupSize = 2;
    s.actions = s.actions.filter(a => a.do !== "force_flake" || flake);
    for (const a of s.actions) {
      if (a.do === "force_flake") { a.persona = "dinner-1"; a.how = "no_show"; }
      if (a.do === "propose") { a.participants = s.personas.map(p => p.ref); a.kind = "intro"; a.objective = "dinner for two"; }
    }
    s.expectations = [
      { check: "meeting_held", personas: ["dinner-2"] },
      { check: "meeting_held", personas: ["dinner-2"], min: 1 },
    ];
    const r = await runScenario(s, { seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false });
    const attendees = r.world.records.filter(x => x.type === "outcome")
      .map(x => Object.entries(x.attendance).filter(([, a]) => a.showed).map(([id]) => id).sort());
    actual.push({ seed, flake, attendees, held: r.world.metrics.meetings.held, pass: r.pass, grades: r.results.map(x => x.status) });
    expected.push({ seed, flake, attendees: [flake ? ["dinner-2"] : ["dinner-1", "dinner-2"]],
      held: flake ? 0 : 1, pass: !flake, grades: Array(2).fill(flake ? "fail" : "pass") });
  }
  expect(actual).toEqual(expected);
});
