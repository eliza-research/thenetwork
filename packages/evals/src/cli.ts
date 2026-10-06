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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildJudgeDataset } from "./judgeDataset.ts";
import { buildRecDataset, datasetComposition } from "./recDataset.ts";
import { renderReport } from "./report.ts";
import { constantBaseline, engineBaseline, runRecommender, scoreRec, type RecResult } from "./runRec.ts";
import { productionPolicy, rulesBaseline, runJudgeSuite, scoreJudge, type JudgeResult } from "./runJudge.ts";
import type { RequestSettings } from "./transport.ts";
import { DEFAULT_WORLDS } from "./worlds.ts";

const ROOT = resolve(import.meta.dir, "../../..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const models = (arg("models", "gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra")!).split(",").map(s => s.trim()).filter(Boolean);
  const suites = new Set((arg("suite", "recommender,judge")!).split(",").map(s => s.trim()));
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
  if (!offline && !process.env.SURPLUS_API_KEY && arg("dataset-only") !== "true") throw new Error("SURPLUS_API_KEY missing (.env)");

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
  const production = judgeItems ? models.map(m => scoreJudge(`${m} + rules`, judgeItems, productionPolicy(judgeItems, judgeResults.get(m)!, `${m} + rules`))) : [];

  for (const s of recScores.concat(recBaselines)) {
    console.log(`REC  ${s.name.padEnd(28)} acc ${(s.accuracy * 100).toFixed(1)}%  P ${(s.precision * 100).toFixed(1)}% R ${(s.recall * 100).toFixed(1)}% F1 ${s.f1.toFixed(3)} AUC ${s.auc.toFixed(3)} unsafe ${s.unsafeRejected}/${s.unsafeN} fail ${s.failures} cost $${(s.costMicro / 1e6).toFixed(4)} (fresh $${(s.freshCostMicro / 1e6).toFixed(4)})`);
  }
  for (const s of judgeScores.concat(rules ? [rules] : [], production)) {
    console.log(`JUDGE ${s.name.padEnd(27)} agree ${(s.agreement * 100).toFixed(1)}% hard ${(s.hardAccuracy * 100).toFixed(1)}% kappa ${s.kappa.toFixed(3)} privFN ${(s.privacyFnRate * 100).toFixed(1)}% policy ${((s.byCategory.policy?.accuracy ?? NaN) * 100).toFixed(1)}% fail ${s.failures} cost $${(s.costMicro / 1e6).toFixed(4)} (fresh $${(s.freshCostMicro / 1e6).toFixed(4)})`);
  }

  const strip = <T extends { correct: boolean[] }>(x: T) => ({ ...x, correct: undefined });
  writeFileSync(join(resultsDir, "summary.json"), JSON.stringify({
    models, settings, maxTokens, rec: recScores.concat(recBaselines).map(strip), judge: judgeScores.concat(rules ? [rules] : [], production).map(strip),
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

main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
