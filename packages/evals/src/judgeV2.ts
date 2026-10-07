#!/usr/bin/env bun
// Judge v2 suite (docs/results/2026-10-07-judge-v2.md): dataset v2 (soft labels, systematic
// selection, opt-in consistency) x old vs new prompts for passes 1-3 and the pipelines, on one split.
//
//   bun run packages/evals/src/judgeV2.ts --split dev  [--max-spend 1] [--limit N] [--variants new|old|both]
//   bun run packages/evals/src/judgeV2.ts --split test --max-spend 1.2
//
// Output: runs/evals/results/judge-v2-<split>{-tag}.{summary.json,items.jsonl,tables.md}. LLM calls go
// through the eval cache (runs/evals/cache), so reruns are free. The model is gpt-6-luna on Surplus.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_MODEL } from "../../core/src/index.ts";
import { mcnemar, pairedBootstrap, precisionOn, f1On, brierSoft } from "./metrics.ts";
import { scoreRow, type RowScore } from "./passScore.ts";
import { buildRecDataset, REC_DATASET_V2, type RecDataset } from "./recDataset.ts";
import { constantBaseline, engineBaseline, runRecommender, type RecResult } from "./runRec.ts";
import { itemRecord, NEW_VARIANTS, OLD_VARIANTS, passDecision, passProb, pipeline, runPasses, SpendGuard, type D3, type PassItemResult, type PassName } from "./runPasses.ts";
import type { RequestSettings } from "./transport.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
};

export type Mix = Partial<Record<PassName, "old" | "new">>;
/** A PassItemResult whose passes come from the old or the new prompt run (for mixed pipelines). */
export function mix(old: PassItemResult | undefined, neu: PassItemResult | undefined, m: Mix): PassItemResult {
  const base = (neu ?? old)!;
  const pick = (p: PassName) => (m[p] === "old" ? old : neu)![p];
  return { ...base, pass1: m.pass1 ? pick("pass1") : base.pass1, pass2: m.pass2 ? pick("pass2") : base.pass2, pass3: m.pass3 ? pick("pass3") : base.pass3 } as PassItemResult;
}

export interface RowSpec { name: string; decisions: (D3 | null)[]; probs: (number | null)[]; recs: PassItemResult["pass1"]["records"][] }

/** Paired comparison of row A against row B on the same items (binary label = pGood >= 0.5). */
export function compareRows(a: RowScore, b: RowScore, gold: boolean[], soft?: number[]) {
  let onlyA = 0, onlyB = 0;
  a.correct.forEach((x, i) => { if (x && !b.correct[i]) onlyA++; if (!x && b.correct[i]) onlyB++; });
  const yesA = a.decisions.map(d => d === "yes"), yesB = b.decisions.map(d => d === "yes");
  const n = gold.length;
  const acc = pairedBootstrap(n, idx => idx.filter(i => a.correct[i]).length / idx.length, idx => idx.filter(i => b.correct[i]).length / idx.length, 2000, 13);
  const prec = pairedBootstrap(n, idx => precisionOn(idx, yesA, gold), idx => precisionOn(idx, yesB, gold));
  const f1 = pairedBootstrap(n, idx => f1On(idx, yesA, gold), idx => f1On(idx, yesB, gold), 2000, 11);
  let brier: ReturnType<typeof pairedBootstrap> | undefined;
  if (soft) {
    const ok = (i: number) => a.probs[i] != null && b.probs[i] != null;
    const bs = (row: RowScore) => (idx: number[]) => { const j = idx.filter(ok); return brierSoft(j.map(i => row.probs[i]!), j.map(i => soft[i]!)); };
    brier = pairedBootstrap(n, bs(a), bs(b), 2000, 17);
  }
  return { onlyA, onlyB, mcnemarP: mcnemar(onlyA, onlyB), accuracy: acc, precision: prec, f1, brier };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "-");
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "-");
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`;
const pv = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));

export function tablesMarkdown(split: string, rows: RowScore[], comps: { a: string; b: string; c: ReturnType<typeof compareRows> }[], n: number): string {
  const L: string[] = [];
  L.push(`### ${split} split: ${n} items`, "");
  L.push("| Row | Accuracy | Precision | Recall | F1 | AUC | ECE (vs pGood) | Brier vs pGood | Log-loss vs pGood | Abstain | Fail | Pairs acc | Groups acc | Cost |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    L.push(`| ${r.name} | ${pct(r.asNo.accuracy)} | ${pct(r.asNo.precision)} | ${pct(r.asNo.recall)} | ${f3(r.asNo.f1)} | ${f3(r.auc)} | ${f3(r.soft?.ece ?? NaN)} | ${f3(r.soft?.brier ?? NaN)} | ${f3(r.soft?.logLoss ?? NaN)} | ${pct(r.abstainRate)} | ${r.failures} | ${pct(r.byGroup.pair?.accuracy ?? NaN)} | ${pct(r.byGroup.group?.accuracy ?? NaN)} | $${(r.costMicro / 1e6).toFixed(4)} |`);
  }
  L.push("", "By richness tier (accuracy / precision / recall; n per tier in the header):", "");
  const tiers = [...new Set(rows.flatMap(r => Object.keys(r.byTier)))];
  const order = ["minimal", "light", "medium", "rich", "very_rich"];
  tiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  L.push(`| Row | ${tiers.map(t => `${t} (n=${rows[0]!.byTier[t]?.n ?? 0})`).join(" | ")} |`, `|---|${tiers.map(() => "---").join("|")}|`);
  for (const r of rows) L.push(`| ${r.name} | ${tiers.map(t => { const x = r.byTier[t]; return x ? `${pct(x.accuracy)} / ${pct(x.precision)} / ${pct(x.recall)}${x.abstain ? `, abst ${x.abstain}` : ""}` : "-"; }).join(" | ")} |`);
  L.push("", "Paired comparisons (A vs B on the same items; McNemar exact on correctness; paired bootstrap 2,000 resamples, 95% CI):", "");
  L.push("| A | B | Accuracy delta (95% CI) | A-only right / B-only right | McNemar p | Precision delta (95% CI), p | F1 delta, p | Brier-vs-pGood delta (95% CI), p |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const { a, b, c } of comps) {
    L.push(`| ${a} | ${b} | ${pp(c.accuracy.diff)} (${pp(c.accuracy.lo)} to ${pp(c.accuracy.hi)}) | ${c.onlyA} / ${c.onlyB} | ${pv(c.mcnemarP)} | ${pp(c.precision.diff)} (${pp(c.precision.lo)} to ${pp(c.precision.hi)}), ${pv(c.precision.p)} | ${c.f1.diff >= 0 ? "+" : ""}${c.f1.diff.toFixed(3)}, ${pv(c.f1.p)} | ${c.brier ? `${c.brier.diff >= 0 ? "+" : ""}${c.brier.diff.toFixed(4)} (${c.brier.lo.toFixed(4)} to ${c.brier.hi.toFixed(4)}), ${pv(c.brier.p)}` : "-"} |`);
  }
  return L.join("\n") + "\n";
}

/** Score every row of the suite for one split from the old- and new-prompt runs. */
export function scoreSplit(items: RecDataset["items"], old: PassItemResult[] | undefined, neu: PassItemResult[] | undefined, baseline: RecResult[] | undefined, refs: { name: string; results: RecResult[] }[]) {
  const tiers = (neu ?? old)!.map(r => r.meta.tier);
  const proxies = (neu ?? old)!.map(r => r.meta.proxyBucket);
  const so = { tiers, proxies };
  const rows: RowScore[] = [];
  const fromRec = (name: string, rr: RecResult[]) => scoreRow(name, items, rr.map(r => (r.prediction ? (r.prediction.goodMatch && !r.prediction.dealbreaker ? "yes" : "no") : null)), rr.map(r => r.prediction?.matchProbability ?? null), rr.map(r => r.records), so);
  if (baseline) rows.push(fromRec("baseline: single pass (rec-eval-v1)", baseline));
  const runs: [string, PassItemResult[] | undefined, Record<PassName, string>][] = [
    ["old", old, { pass1: "pass1-screen-v2", pass2: "judge-v2.1", pass3: "pass3-deep-v2" }],
    ["new", neu, { pass1: "pass1-screen-v3", pass2: "judge-v3", pass3: "pass3-deep-v3" }],
  ];
  for (const p of ["pass1", "pass2", "pass3"] as PassName[]) for (const [tag, rs, names] of runs) {
    if (!rs || rs.every(r => r[p].error === "skipped")) continue;
    const dec = rs.map(r => passDecision(r, p)), prob = rs.map(r => passProb(r, p)), recs = rs.map(r => r[p].records);
    rows.push(scoreRow(`${p} ${tag} (${names[p]}), model only`, items, dec, prob, recs, so));
    rows.push(scoreRow(`${p} ${tag} (${names[p]}) + hard gate`, items, rs.map((r, i) => (r.hardGate ? "no" : dec[i]!)), rs.map((r, i) => (r.hardGate ? 0 : prob[i]!)), rs.map(r => (r.hardGate ? [] : r[p].records)), so));
  }
  const pipes: [string, PassName[], Mix][] = [
    ["pipeline old: gate > 1 > 3", ["pass1", "pass3"], { pass1: "old", pass3: "old" }],
    ["pipeline new: gate > 1 > 3", ["pass1", "pass3"], { pass1: "new", pass3: "new" }],
    ["pipeline: gate > 1 new > 3 old", ["pass1", "pass3"], { pass1: "new", pass3: "old" }],
    ["pipeline: gate > 1 old > 3 new", ["pass1", "pass3"], { pass1: "old", pass3: "new" }],
    ["pipeline old: gate > 1 > 2 > 3", ["pass1", "pass2", "pass3"], { pass1: "old", pass2: "old", pass3: "old" }],
    ["pipeline new: gate > 1 > 2 > 3", ["pass1", "pass2", "pass3"], { pass1: "new", pass2: "new", pass3: "new" }],
    ["pipeline new: gate > 1 > 2", ["pass1", "pass2"], { pass1: "new", pass2: "new" }],
    ["pipeline new: gate > 2 > 3", ["pass2", "pass3"], { pass2: "new", pass3: "new" }],
    ["pipeline new: gate > 1 only", ["pass1"], { pass1: "new" }],
  ];
  for (const [name, stages, m] of pipes) {
    const need = Object.values(m);
    if ((need.includes("old") && !old) || (need.includes("new") && !neu)) continue;
    const rs = items.map((_, i) => mix(old?.[i], neu?.[i], m));
    if (stages.some(p => rs.every(r => r[p].error === "skipped"))) continue;
    const pl = rs.map(r => pipeline(r, stages));
    rows.push(scoreRow(name, items, pl.map(x => x.decision), pl.map(x => x.prob), rs.map((r, i) => pl[i]!.reached.flatMap(p => r[p].records)), so));
  }
  for (const r of refs) rows.push(fromRec(r.name, r.results));
  return rows;
}

async function main() {
  const split = (arg("split", "dev") as "dev" | "test");
  const model = arg("model", DEFAULT_MODEL)!;
  const which = arg("variants", "both")!;
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const offline = arg("offline") === "true";
  const tag = arg("tag") ? `-${arg("tag")}` : "";
  const settings: RequestSettings = { reasoning_effort: "medium" };
  const guard = new SpendGuard(Number(arg("max-spend", "1")) * 1e6);
  const cacheDir = join(ROOT, "runs/evals/cache"), resultsDir = join(ROOT, "runs/evals/results");
  mkdirSync(resultsDir, { recursive: true });
  const passes = (arg("passes", "pass1,pass2,pass3")!).split(",") as PassName[];

  const full = await buildRecDataset({ version: 2 });
  const items = full.items.filter(i => i.split === split).slice(0, limit);
  const ds: RecDataset = { ...full, items };
  console.log(`${REC_DATASET_V2} ${split}: ${items.length} items, ${items.filter(i => i.truth.good).length} good (pGood >= 0.5)`);
  const progress = (t: string) => { let last = 0; return (d: number, n: number) => { if (d === n || d - last >= Math.max(20, n / 5)) { last = d; console.log(`  [${t}] ${d}/${n} fresh $${(guard.fresh / 1e6).toFixed(4)}`); } }; };
  const concurrency = Number(arg("concurrency", "10"));
  const common = { cacheDir, settings, concurrency, offline, guard, passes, maxTokens: { pass1: 4000, pass2: 4000, pass3: 6000 } };
  // Baseline, old prompts and new prompts run side by side (each with its own concurrency limit).
  const [baseline, old, neu] = await Promise.all([
    arg("no-baseline") === "true" ? undefined : runRecommender(model, ds, { cacheDir, settings, concurrency, maxTokens: 4000, offline, onProgress: progress("baseline") }).then(rs => { for (const r of rs) guard.add(r.records); return rs; }),
    which === "new" ? undefined : runPasses(model, ds, { ...common, variants: OLD_VARIANTS, onProgress: progress("old prompts") }),
    which === "old" ? undefined : runPasses(model, ds, { ...common, variants: NEW_VARIANTS, onProgress: progress("new prompts") }),
  ]);

  const rows = scoreSplit(items, old, neu, baseline, [{ name: "engine-v1 (deterministic)", results: engineBaseline(ds) }, { name: "always-no", results: constantBaseline(ds, false) }]);
  const gold = items.map(i => i.truth.good), soft = items.map(i => i.truth.pGood!);
  const by = (n: string) => rows.find(r => r.name === n) ?? rows.find(r => r.name.startsWith(n));
  const pairs: [string, string][] = [
    ["pass1 new", "pass1 old"], ["pass2 new", "pass2 old"], ["pass3 new", "pass3 old"],
    ["pipeline new: gate > 1 > 3", "pipeline old: gate > 1 > 3"],
    ["pipeline: gate > 1 new > 3 old", "pipeline old: gate > 1 > 3"],
    ["pipeline: gate > 1 old > 3 new", "pipeline old: gate > 1 > 3"],
    ["pipeline new: gate > 1 > 2 > 3", "pipeline new: gate > 1 > 3"],
    ["pipeline new: gate > 1 > 2", "pipeline new: gate > 1 > 3"],
    ["pipeline new: gate > 1 > 3", "pipeline new: gate > 1 only"],
    ["pipeline old: gate > 1 > 3", "baseline"], ["pipeline new: gate > 1 > 3", "baseline"], ["pass1 new", "baseline"],
  ];
  const comps = pairs.flatMap(([a, b]) => {
    const A = by(a), B = by(b);
    return A && B ? [{ a: A.name, b: B.name, c: compareRows(A, B, gold, soft) }] : [];
  });
  for (const r of rows) console.log(`${r.name.padEnd(52)} acc ${pct(r.asNo.accuracy)} P ${pct(r.asNo.precision)} R ${pct(r.asNo.recall)} F1 ${f3(r.asNo.f1)} AUC ${f3(r.auc)} brierSoft ${f3(r.soft?.brier ?? NaN)} abst ${pct(r.abstainRate)} fail ${r.failures}`);
  for (const { a, b, c } of comps) console.log(`${a} vs ${b}: acc ${pp(c.accuracy.diff)} p=${pv(c.mcnemarP)}  prec ${pp(c.precision.diff)} p=${pv(c.precision.p)}`);
  const stem = join(resultsDir, `judge-v2-${split}${tag}`);
  const strip = (r: RowScore) => ({ ...r, decisions: undefined, correct: undefined, probs: undefined });
  writeFileSync(`${stem}.summary.json`, JSON.stringify({ dataset: REC_DATASET_V2, split, model, settings, n: items.length, freshSpendMicro: guard.fresh, rows: rows.map(strip), comparisons: comps }, null, 1));
  if (old || neu) {
    const lines = items.map((it, i) => JSON.stringify({ itemId: it.id, split: it.split, pGood: it.truth.pGood, drawnGood: it.truth.drawnGood,
      baseline: baseline?.[i]?.prediction ?? null, old: old ? itemRecord(old[i]!, baseline?.[i]) : null, new: neu ? itemRecord(neu[i]!) : null }));
    writeFileSync(`${stem}.items.jsonl`, lines.join("\n") + "\n");
  }
  writeFileSync(`${stem}.tables.md`, tablesMarkdown(split, rows, comps, items.length));
  console.log(`fresh spend this invocation: $${(guard.fresh / 1e6).toFixed(4)}; tables: ${stem}.tables.md`);
}

if (import.meta.main) main().catch(e => { console.error(String(e?.stack ?? e)); process.exit(1); });
