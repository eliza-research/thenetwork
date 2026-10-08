#!/usr/bin/env bun
// Model comparison eval CLI.
//   bun run packages/evals/src/cli.ts --models gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra --suite recommender,judge
// Options:
//   --models a,b,c          models on Surplus (default: gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra)
//   --suite recommender,judge
//   --concurrency N         per model (default 6); models run in parallel
//   --reasoning-effort E    minimal|low|medium|high (default medium), identical for every model
//   --max-tokens N          completion budget per call (default 4000)
//   --limit N               only the first N items of each suite (smoke runs)
//   --offline               replay from cache only (no network)
//   --offline-rec           replay the recommender suite from cache only (judge may call the API)
//   --out PATH              report path (default docs/results/2026-10-06-model-comparison.md)
//   --dataset-only          build datasets, print composition, exit
//
// Judgment passes (pass 1 screen, pass 2 rubric judge, pass 3 deep review + pipeline):
//   bun run packages/evals/src/cli.ts --suite passes            (model defaults to gpt-6-luna)
//   --max-spend USD         stop making new calls once fresh spend reaches this (default 3)
//   --passes pass1,pass2,pass3   subset of passes to run
//   --tag NAME              suffix for the results files (runs/evals/results/passes-<model>-NAME.*)
//   --legacy-data           use the pre-richness worlds (full public profiles) instead of richness tiers
//   --out PATH              default docs/results/2026-10-06-judge-passes.md
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildJudgeDataset } from "./judgeDataset.ts";
import { buildRecDataset, datasetComposition } from "./recDataset.ts";
import { renderReport } from "./report.ts";
import { constantBaseline, engineBaseline, runRecommender, scoreRec, type RecResult } from "./runRec.ts";
import { leakGuardBaseline, productionPolicy, rulesBaseline, runJudgeSuite, scoreJudge, type JudgeResult } from "./runJudge.ts";
import type { RequestSettings } from "./transport.ts";
import { DEFAULT_WORLDS } from "./worlds.ts";
import { DEFAULT_MODEL, endpointsFor } from "../../core/src/index.ts";
import { itemRecord, runPasses, SpendGuard, type PassName } from "./runPasses.ts";
import { scorePasses } from "./passScore.ts";
import { renderPassesReport } from "./passReport.ts";

const ROOT = resolve(import.meta.dir, "../../..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const suites = new Set((arg("suite", "recommender,judge")!).split(",").map(s => s.trim()));
  if (suites.has("passes")) return runPassesSuite();
  const models = (arg("models", "gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra")!).split(",").map(s => s.trim()).filter(Boolean);
  const concurrency = Number(arg("concurrency", "6"));
  const maxTokens = Number(arg("max-tokens", "4000"));
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const offline = arg("offline") === "true";
  const offlineRec = offline || arg("offline-rec") === "true";
  const settings: RequestSettings = { reasoning_effort: (arg("reasoning-effort", "medium") as RequestSettings["reasoning_effort"]) };
  const out = resolve(ROOT, arg("out", "docs/results/2026-10-06-model-comparison.md")!);
  const cacheDir = join(ROOT, "runs/evals/cache");
  const resultsDir = join(ROOT, "runs/evals/results");
  mkdirSync(resultsDir, { recursive: true });
  if (!offline && !endpointsFor("surplus").length && arg("dataset-only") !== "true") throw new Error("SURPLUS_API_KEY or OPENAI_API_KEY missing (.env)");

  const t0 = performance.now();
  const recDs = suites.has("recommender") ? await buildRecDataset() : undefined;
  const judgeItems = suites.has("judge") ? buildJudgeDataset() : undefined;
  if (recDs && limit) recDs.items.splice(limit);
  if (judgeItems && limit) judgeItems.splice(limit);
  if (recDs) console.log(`recommender dataset: ${JSON.stringify(datasetComposition(recDs.items))} (${Math.round(performance.now() - t0)}ms)`);
  if (judgeItems) console.log(`judge dataset: ${judgeItems.length} items`);
  if (arg("dataset-only") === "true") return;

  const progress = (tag: string) => {
    let last = 0;
    return (d: number, n: number) => { if (d === n || d - last >= Math.max(10, Math.floor(n / 10))) { last = d; console.log(`  [${tag}] ${d}/${n}`); } };
  };
  const recResults = new Map<string, RecResult[]>();
  const judgeResults = new Map<string, JudgeResult[]>();
  await Promise.all(models.map(async model => {
    const opts = { cacheDir, settings, concurrency, maxTokens, offline };
    if (recDs) {
      const r = await runRecommender(model, recDs, { ...opts, offline: offlineRec, onProgress: progress(`${model} rec`) });
      recResults.set(model, r);
      writeFileSync(join(resultsDir, `recommender-${model}.json`), JSON.stringify(r, null, 1));
    }
    if (judgeItems) {
      const r = await runJudgeSuite(model, judgeItems, { ...opts, onProgress: progress(`${model} judge`) });
      judgeResults.set(model, r);
      writeFileSync(join(resultsDir, `judge-${model}.json`), JSON.stringify(r, null, 1));
    }
  }));

  const recScores = recDs ? models.map(m => scoreRec(m, recDs.items, recResults.get(m)!)) : [];
  const recBaselines = recDs ? [scoreRec("engine-v1 (deterministic)", recDs.items, engineBaseline(recDs)), scoreRec("always-no", recDs.items, constantBaseline(recDs, false))] : [];
  const judgeScores = judgeItems ? models.map(m => scoreJudge(m, judgeItems, judgeResults.get(m)!)) : [];
  const rules = judgeItems ? scoreJudge("rules", judgeItems, rulesBaseline(judgeItems), { skipUnscored: true }) : undefined;
  const leakGuard = judgeItems ? scoreJudge("leak-guard (checkMemberFacing)", judgeItems, leakGuardBaseline(judgeItems), { skipUnscored: true }) : undefined;
  const production = judgeItems ? models.map(m => scoreJudge(`${m} + rules`, judgeItems, productionPolicy(judgeItems, judgeResults.get(m)!, `${m} + rules`))) : [];

  for (const s of recScores.concat(recBaselines)) {
    console.log(`REC  ${s.name.padEnd(28)} acc ${(s.accuracy * 100).toFixed(1)}%  P ${(s.precision * 100).toFixed(1)}% R ${(s.recall * 100).toFixed(1)}% F1 ${s.f1.toFixed(3)} AUC ${s.auc.toFixed(3)} unsafe ${s.unsafeRejected}/${s.unsafeN} fail ${s.failures} cost $${(s.costMicro / 1e6).toFixed(4)} (fresh $${(s.freshCostMicro / 1e6).toFixed(4)})`);
  }
  for (const s of judgeScores.concat(rules ? [rules] : [], leakGuard ? [leakGuard] : [], production)) {
    console.log(`JUDGE ${s.name.padEnd(27)} agree ${(s.agreement * 100).toFixed(1)}% hard ${(s.hardAccuracy * 100).toFixed(1)}% kappa ${s.kappa.toFixed(3)} privFN ${(s.privacyFnRate * 100).toFixed(1)}% policy ${((s.byCategory.policy?.accuracy ?? NaN) * 100).toFixed(1)}% fail ${s.failures} cost $${(s.costMicro / 1e6).toFixed(4)} (fresh $${(s.freshCostMicro / 1e6).toFixed(4)})`);
  }

  const strip = <T extends { correct: boolean[] }>(x: T) => ({ ...x, correct: undefined });
  writeFileSync(join(resultsDir, "summary.json"), JSON.stringify({
    models, settings, maxTokens, rec: recScores.concat(recBaselines).map(strip), judge: judgeScores.concat(rules ? [rules] : [], leakGuard ? [leakGuard] : [], production).map(strip),
  }, null, 1));

  if (limit) { console.log("--limit set: not writing the report"); return; }
  const md = renderReport({
    date: "2026-10-06", models, settings: { ...settings, max_completion_tokens: maxTokens, concurrency },
    rec: recDs ? { items: recDs.items, scores: recScores, baselines: recBaselines } : undefined,
    judge: judgeItems && rules ? { items: judgeItems, scores: judgeScores, rules, production } : undefined,
    worlds: DEFAULT_WORLDS.map(w => `${w.id} (${w.city.toUpperCase()}, seed ${w.seed}, ${w.n} personas)`).join(", "),
    command: `bun run packages/evals/src/cli.ts --models ${models.join(",")} --suite ${[...suites].join(",")}`,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(`report: ${out}`);
}

async function runPassesSuite() {
  const model = arg("models", DEFAULT_MODEL)!.split(",")[0]!.trim();
  const concurrency = Number(arg("concurrency", "4"));
  const maxTokens = Number(arg("max-tokens", "4000"));
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const offline = arg("offline") === "true";
  const settings: RequestSettings = { reasoning_effort: (arg("reasoning-effort", "medium") as RequestSettings["reasoning_effort"]) };
  const out = resolve(ROOT, arg("out", "docs/results/2026-10-06-judge-passes.md")!);
  const cacheDir = join(ROOT, "runs/evals/cache");
  const resultsDir = join(ROOT, "runs/evals/results");
  const passes = (arg("passes", "pass1,pass2,pass3")!).split(",").map(s => s.trim()) as PassName[];
  const guard = new SpendGuard(Number(arg("max-spend", "3")) * 1e6);
  mkdirSync(resultsDir, { recursive: true });
  if (!offline && !endpointsFor("surplus").length) throw new Error("SURPLUS_API_KEY or OPENAI_API_KEY missing (.env)");

  const t0 = performance.now();
  const richness = arg("legacy-data") !== "true";
  const recDs = await buildRecDataset({ richness });
  if (limit) recDs.items.splice(limit);
  console.log(`recommender dataset (${richness ? "richness tiers + connected sources" : "legacy full-profile"}): ${JSON.stringify(datasetComposition(recDs.items))} (${Math.round(performance.now() - t0)}ms)`);
  if (arg("dataset-only") === "true") return;
  const progress = (tag: string) => {
    let last = 0;
    return (d: number, n: number) => { if (d === n || d - last >= Math.max(10, Math.floor(n / 10))) { last = d; console.log(`  [${tag}] ${d}/${n} (fresh spend $${(guard.fresh / 1e6).toFixed(4)})`); } };
  };
  // Previous single-pass prompt (rec-eval-v1): replays from cache when the dataset is unchanged.
  const baseline = await runRecommender(model, recDs, { cacheDir, settings, concurrency: 6, maxTokens, offline, onProgress: progress(`${model} baseline`) });
  for (const r of baseline) guard.add(r.records);
  const results = await runPasses(model, recDs, {
    cacheDir, settings, concurrency, offline, guard, passes,
    maxTokens: { pass1: maxTokens, pass2: maxTokens, pass3: Number(arg("max-tokens-pass3", "6000")) },
    onProgress: progress(`${model} passes`),
  });
  const scores = scorePasses(recDs.items, results, baseline, [
    { name: "engine-v1 (deterministic)", results: engineBaseline(recDs) },
    { name: "always-no", results: constantBaseline(recDs, false) },
  ]);
  const tag = arg("tag") ? `-${arg("tag")}` : "";
  const stem = join(resultsDir, `passes-${model}${tag}`);
  writeFileSync(`${stem}.json`, JSON.stringify(results, null, 1));
  const recs = results.map((r, i) => itemRecord(r, baseline[i]));
  writeFileSync(`${stem}.items.jsonl`, recs.map(x => JSON.stringify(x)).join("\n") + "\n");
  const wrong = recs.filter(x => !x.correct.pipeline || !x.correct.pass1 || !x.correct.pass2 || !x.correct.pass3);
  writeFileSync(`${stem}.errors.jsonl`, wrong.map(x => JSON.stringify(x)).join("\n") + "\n");
  const strip = <T extends object>(x: T) => ({ ...x, decisions: undefined, correct: undefined, probs: undefined });
  writeFileSync(`${stem}.summary.json`, JSON.stringify({ model, settings, freshSpendMicro: guard.fresh, baseline: scores.baseline && strip(scores.baseline), rows: scores.rows.map(strip), references: scores.references.map(strip), gateOverridesAttempted: scores.gateOverridesAttempted, leaks: scores.leaks, internalCanaries: scores.internalCanaries }, null, 1));
  for (const r of [scores.baseline!, ...scores.rows, ...scores.references]) {
    console.log(`${r.name.padEnd(44)} acc ${(r.asNo.accuracy * 100).toFixed(1)}% P ${(r.asNo.precision * 100).toFixed(1)}% R ${(r.asNo.recall * 100).toFixed(1)}% F1 ${r.asNo.f1.toFixed(3)} AUC ${r.auc.toFixed(3)} ECE ${r.ece.toFixed(3)} abst ${(r.abstainRate * 100).toFixed(1)}% fail ${r.failures} cost $${(r.costMicro / 1e6).toFixed(4)}`);
  }
  console.log(`fresh spend this invocation: $${(guard.fresh / 1e6).toFixed(4)}; per-item output: ${stem}.items.jsonl (${recs.length}), errors: ${stem}.errors.jsonl (${wrong.length})`);
  if (limit) { console.log("--limit set: not writing the report"); return; }
  const md = renderPassesReport({
    model, settings: { ...settings, max_completion_tokens: maxTokens, max_completion_tokens_pass3: Number(arg("max-tokens-pass3", "6000")), concurrency },
    items: recDs.items, results, scores, freshSpendMicro: guard.fresh,
    worlds: DEFAULT_WORLDS.map(w => `${w.id} (${w.city.toUpperCase()}, seed ${w.seed}, ${w.n} personas${richness ? ", richness tiers + connected sources" : ""})`).join(", "),
    command: `bun run packages/evals/src/cli.ts --suite passes --models ${model}${richness ? "" : " --legacy-data"}`, richness,
    resultsStem: `runs/evals/results/passes-${model}${tag}`,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(`report: ${out}`);
}

main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
