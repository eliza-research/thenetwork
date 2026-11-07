// The real scenario runner must not grade a world with an unusable duration.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadScenario, runScenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("invalid world durations cannot turn the privacy scenario into a passing run", async () => {
  const scenario = await loadScenario(fileURLToPath(new URL("../scenarios/private-disclosure-canary.json", import.meta.url)));
  const rejected: string[] = [];
  for (const days of [0, -1, Number.NaN, null]) {
    try {
      await runScenario({ ...scenario, days: days as number }, { network: s => new StubNetwork({ seed: s.seed }), writeLog: false });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "world days must be a positive finite number") throw e;
      rejected.push(String(days));
    }
  }
  const valid = await runScenario(scenario, { network: s => new StubNetwork({ seed: s.seed }), writeLog: false });
  expect({ rejected, pass: valid.pass, exercised: valid.world.events > 0 && valid.world.metrics.run.joined > 0 && valid.world.channel.all().length > 0 })
    .toEqual({ rejected: ["0", "-1", "NaN", "null"], pass: true, exercised: true });
}, 30_000);
