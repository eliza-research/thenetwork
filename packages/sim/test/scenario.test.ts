import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { StubNetwork, loadScenario, runScenario, runScenarioPassK } from "../src/index.ts";

const dir = `${import.meta.dir}/../scenarios`;
const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();

describe("scenario scripts (graded by final state)", () => {
  test("scenario files load", async () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const s = await loadScenario(`${dir}/${f}`);
      expect(s.name).toBeTruthy(); expect(s.expectations.length).toBeGreaterThan(0);
    }
  });

  for (const f of files) {
    test(`stub network passes applicable expectations: ${f}`, async () => {
      const s = await loadScenario(`${dir}/${f}`);
      const r = await runScenario(s, { network: sc => new StubNetwork({ seed: s.seed, ...sc.stub }) });
      const failed = r.results.filter(x => x.status === "fail");
      if (failed.length) console.log(f, JSON.stringify(failed, null, 1));
      expect(failed).toEqual([]);
      expect(r.results.some(x => x.status === "pass")).toBe(true);
    });
  }

  test("pass^3 on critical flows (STOP, group flake)", async () => {
    for (const f of ["stop-keyword.json", "group-flake-morning-of.json"]) {
      const s = await loadScenario(`${dir}/${f}`);
      const r = await runScenarioPassK(s, 3, { network: sc => new StubNetwork({ seed: s.seed, ...sc.stub }) });
      expect(r.passK).toBe(true);
    }
  });

  test("canary scenario fails against a leaky network (the check has teeth)", async () => {
    const s = await loadScenario(`${dir}/private-disclosure-canary.json`);
    const r = await runScenario({ ...s, background: { personas: 6 } }, { network: () => new StubNetwork({ seed: 1, leakyExplanations: true, introRate: 1 }) });
    expect(r.results.find(x => x.expectation.check === "canary_not_leaked")!.status).toBe("fail");
  });
});
