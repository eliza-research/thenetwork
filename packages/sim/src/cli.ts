#!/usr/bin/env bun
// Network World Simulator CLI.
//   bun run packages/sim/src/cli.ts --personas 40 --days 14 --mode discrete --seed 1 --network stub
//   bun run packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm          (LLM persona agents, default gpt-6-luna)
//   bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4
//   bun run packages/sim/src/cli.ts --engine ./path/to/engine.ts                   (module exporting createEngine())
//   bun run packages/sim/src/cli.ts --judge 20                                     (LLM-judge 20 sent messages)
// Models (founder decision 2026-10-05): persona agents and LLM persona bios use defaultLLM()
// (DEFAULT_LLM_PROVIDER / DEFAULT_LLM_MODEL, default Surplus gpt-6-luna); judging uses judgeLLM()
// (JUDGE_PROVIDER / JUDGE_MODEL, default Surplus gpt-6-luna).
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { defaultLLM, judgeLLM } from "@thenetwork/core";
import { formatMetrics, judgeMessageQuality, privacyAudit, type RunRecord } from "@thenetwork/judge";
import { LLMPersonaAgent } from "./agent/llmAgent.ts";
import { PolicyPersonaAgent } from "./agent/policy.ts";
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
    "minor-share": { type: "string" },
    richness: { type: "boolean", default: false },
    "stable-decisions": { type: "boolean", default: false },
    logistics: { type: "boolean", default: false },
    "quality-churn": { type: "boolean", default: false },
    "trip-clock": { type: "boolean", default: false },
    judge: { type: "string" },
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
  --llm               persona agents speak via defaultLLM() (DEFAULT_LLM_PROVIDER/DEFAULT_LLM_MODEL,
                      default surplus gpt-6-luna; decisions stay model-driven); use small runs
  --llm-personas      also enrich persona bios via defaultLLM()
  --adversarial-rate  share of adversarial personas (default 0.06)
  --minor-share       share of honest members aged 13-17 (default 0.05; never connected to anyone)
  --richness          profile richness tiers: the snapshot holds only what members told the agent
                      (default off: perfect onboarding, every boundary and romance preference known)
  --stable-decisions  oracle: re-asking the same people for the same thing in a week is the same
                      answer, and personas remember declines (default off)
  --logistics         oracle: travel and meeting time change show-up (default off)
  --quality-churn     policy personas lose trust after unsafe or poor intros and bad meetings,
                      and may STOP (default off: churn only from message volume)
  --trip-clock        travellers reply on the trip city's clock (default off: home-city clock)
  --judge N           after the run, LLM-judge N sent proactive messages (quality + privacy audit)
                      with the judge model judgeLLM() (JUDGE_PROVIDER/JUDGE_MODEL, default surplus gpt-6-luna)
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
const llm = a.llm || a["llm-personas"] ? defaultLLM() : undefined;
const agent = a.llm && llm ? new LLMPersonaAgent(llm, DEFAULT_START) : a["quality-churn"] || a["trip-clock"] ? new PolicyPersonaAgent(DEFAULT_START, { qualityChurn: a["quality-churn"], tripClock: a["trip-clock"] }) : undefined;

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
const genOpts = {
  n, seed, adversarialRate: a["adversarial-rate"] ? Number(a["adversarial-rate"]) : undefined,
  minorShare: a["minor-share"] !== undefined ? Number(a["minor-share"]) : undefined, joinSpreadDays: Math.min(7, days),
  ...(a.richness ? { richness: true } : {}),
};
const personas = a["llm-personas"] && llm ? await generateLLMPersonas({ ...genOpts, llm }) : generatePersonas(genOpts);

const res = await runWorld({
  seed, personas, days, mode, speed: Number(a.speed), network: makeNetwork(engine), engine, agent,
  writeLog: !a["no-log"],
  ...(a["stable-decisions"] || a.logistics ? { oracle: { stableDecisions: a["stable-decisions"], logistics: a.logistics } } : {}),
  onDay: d => { if (!a.json) process.stderr.write(`  day ${d}/${days}\r`); },
});
if (!a.json) process.stderr.write("\n");
if (a.json) console.log(JSON.stringify(res.metrics, null, 2));
else {
  console.log(formatMetrics(res.metrics));
  console.log(`\nsim events=${res.events} wall=${res.wallMs}ms${agent ? ` llmCalls=${(agent as LLMPersonaAgent).calls} llmFailures=${(agent as LLMPersonaAgent).failures}` : ""}`);
  if (res.dir) console.log(`run log: ${res.dir}`);
}
if (a.judge) await judgeRun(res.records, Number(a.judge));

/**
 * LLM judges over a deterministic, evenly spaced sample of every delivered Network message (not only
 * proactive ones), and a privacy audit of that sample against every private fact (in batches of 40).
 * A judge error is reported and the CLI exits non-zero, so an outage never reads as a clean audit.
 */
async function judgeRun(records: RunRecord[], k: number) {
  const judge = judgeLLM(); // judge model per JUDGE_PROVIDER / JUDGE_MODEL
  const sent = records.flatMap(r => (r.type === "message" && r.msg.direction === "outbound" && !r.msg.system && r.msg.status === "delivered" ? [r.msg] : []));
  const step = Math.max(1, Math.floor(sent.length / Math.max(1, k)));
  const sample = sent.filter((_, i) => i % step === 0).slice(0, k);
  const errors: string[] = [];
  const quality = await Promise.all(sample.map(m => judgeMessageQuality(judge, { message: m.body }).catch(e => { errors.push(String(e)); return { pass: false, score: 0, issues: [String(e)], reasoning: "" }; })));
  const facts = records.flatMap(r => (r.type === "persona" && r.persona.privateFact ? [{ owner: r.persona.id, fact: r.persona.privateFact }] : []));
  let leaks = 0;
  for (let i = 0; sample.length && i < facts.length; i += 40) {
    const audit = await privacyAudit(judge, { privateFacts: facts.slice(i, i + 40), messages: sample.map(m => ({ to: m.memberId, text: m.body })) }).catch(e => { errors.push(String(e)); return null; });
    leaks += audit?.leaks.length ?? 0;
  }
  const passN = quality.filter(q => q.pass).length;
  const out = {
    judge: `${process.env.JUDGE_PROVIDER ?? "surplus"}/${process.env.JUDGE_MODEL ?? "gpt-6-luna"}`,
    sampled: sample.length, qualityPass: passN, qualityPassRate: sample.length ? Math.round((passN / sample.length) * 1000) / 1000 : 0,
    meanScore: sample.length ? Math.round((quality.reduce((s, q) => s + q.score, 0) / sample.length) * 100) / 100 : 0,
    privacyLeaks: errors.length ? null : leaks, factsAudited: facts.length, errors: errors.length,
  };
  if (a.json) console.log(JSON.stringify({ llmJudges: out }, null, 2));
  else console.log(`LLM judges (${out.judge}): sampled=${out.sampled} quality pass=${out.qualityPass} (${(out.qualityPassRate * 100).toFixed(1)}%) mean=${out.meanScore} privacyLeaks=${out.privacyLeaks ?? "n/a"} facts=${out.factsAudited}`);
  if (errors.length) {
    console.error(`LLM judge errors: ${errors.length} (first: ${errors[0]})`);
    process.exit(1);
  }
}
