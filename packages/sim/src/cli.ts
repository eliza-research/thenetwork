#!/usr/bin/env bun
// Network World Simulator CLI.
//   bun run packages/sim/src/cli.ts --personas 40 --days 14 --mode discrete --seed 1 --network stub
//   bun run packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm          (Cerebras persona agents)
//   bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4
//   bun run packages/sim/src/cli.ts --engine ./path/to/engine.ts                   (module exporting createEngine())
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { CerebrasLLM } from "@thenetwork/core";
import { formatMetrics } from "@thenetwork/judge";
import { LLMPersonaAgent } from "./agent/llmAgent.ts";
import { generatePersonas } from "./generator.ts";
import { generateLLMPersonas } from "./llmGenerator.ts";
import type { Engine, NetworkUnderTest } from "./network.ts";
import type { RunMode } from "./scheduler.ts";
import { loadScenario, runScenarioPassK } from "./scenario.ts";
import { StubNetwork } from "./stubNetwork.ts";
import { DEFAULT_START, runWorld } from "./world.ts";

const { values: a } = parseArgs({
  options: {
    personas: { type: "string", default: "40" },
    days: { type: "string", default: "14" },
    mode: { type: "string", default: "discrete" },
    speed: { type: "string", default: "1440" },
    seed: { type: "string", default: "1" },
    network: { type: "string", default: "stub" },
    engine: { type: "string" },
    llm: { type: "boolean", default: false },
    "llm-personas": { type: "boolean", default: false },
    "adversarial-rate": { type: "string" },
    scenario: { type: "string" },
    k: { type: "string", default: "1" },
    "no-log": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (a.help) {
  console.log(`Usage: bun run packages/sim/src/cli.ts [options]
  --personas N        number of personas (default 40)
  --days N            simulated days (default 14)
  --mode M            discrete | accelerated | realtime (default discrete)
  --speed N           sim-seconds per wall-second in accelerated mode (default 1440)
  --seed N            run seed (default 1)
  --network NAME      network under test: stub (default)
  --engine PATH       module exporting createEngine(): Engine; proposals go to the network
  --llm               persona agents speak via Cerebras (decisions stay model-driven); use small runs
  --llm-personas      also enrich persona bios via Cerebras
  --adversarial-rate  share of adversarial personas (default 0.06)
  --scenario PATH     run a scenario file instead of a random world; --k N for pass^k
  --no-log            don't write runs/<runId>/
  --json              print metrics JSON`);
  process.exit(0);
}

const seed = Number(a.seed);
const mode = a.mode as RunMode;
if (!["discrete", "accelerated", "realtime"].includes(mode)) throw new Error(`bad --mode ${mode}`);

function makeNetwork(engine?: Engine, extra: Record<string, unknown> = {}): NetworkUnderTest {
  if (a.network !== "stub") throw new Error(`unknown --network ${a.network} (only "stub" is built in; inject others via the World API)`);
  return new StubNetwork({ seed, randomIntros: !engine, ...extra });
}

async function loadEngine(): Promise<Engine | undefined> {
  if (!a.engine) return undefined;
  const mod = await import(resolve(process.cwd(), a.engine));
  const engine: Engine = mod.createEngine ? await mod.createEngine() : mod.default;
  if (!engine?.propose) throw new Error(`${a.engine} must export createEngine(): Engine or a default Engine`);
  return engine;
}

const engine = await loadEngine();
const llm = a.llm || a["llm-personas"] ? new CerebrasLLM() : undefined;
const agent = a.llm && llm ? new LLMPersonaAgent(llm, DEFAULT_START) : undefined;

if (a.scenario) {
  const s = await loadScenario(a.scenario);
  const k = Number(a.k);
  const res = await runScenarioPassK(s, k, { network: sc => makeNetwork(engine, sc.stub), engine, agent, writeLog: !a["no-log"] });
  for (const run of res.runs) {
    console.log(`\n[${run.pass ? "PASS" : "FAIL"}] ${s.name} seed=${run.seed}${run.world.dir ? `  log=${run.world.dir}` : ""}`);
    for (const r of run.results) console.log(`  ${r.status.padEnd(7)} ${r.expectation.check}${"persona" in r.expectation ? `(${(r.expectation as any).persona})` : ""}: ${r.detail}`);
  }
  console.log(`\npass^${k}: ${res.passK ? "PASS" : "FAIL"} (${res.passes}/${k})`);
  process.exit(res.passK ? 0 : 1);
}

const n = Number(a.personas), days = Number(a.days);
const genOpts = { n, seed, adversarialRate: a["adversarial-rate"] ? Number(a["adversarial-rate"]) : undefined, joinSpreadDays: Math.min(7, days) };
const personas = a["llm-personas"] && llm ? await generateLLMPersonas({ ...genOpts, llm }) : generatePersonas(genOpts);

const res = await runWorld({
  seed, personas, days, mode, speed: Number(a.speed), network: makeNetwork(engine), engine, agent,
  writeLog: !a["no-log"],
  onDay: d => { if (!a.json) process.stderr.write(`  day ${d}/${days}\r`); },
});
if (!a.json) process.stderr.write("\n");
if (a.json) console.log(JSON.stringify(res.metrics, null, 2));
else {
  console.log(formatMetrics(res.metrics));
  console.log(`\nsim events=${res.events} wall=${res.wallMs}ms${agent ? ` llmCalls=${(agent as LLMPersonaAgent).calls} llmFailures=${(agent as LLMPersonaAgent).failures}` : ""}`);
  if (res.dir) console.log(`run log: ${res.dir}`);
}
