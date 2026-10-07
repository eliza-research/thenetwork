#!/usr/bin/env bun
// Final, one-shot evaluation on the TEST split (sf-2 + nyc-2, never seen by the optimizer).
//   bun run prototypes/prompt-opt/src/test.ts --features <features.jsonl> [--run out/pilot.json] [--cap 0.5]
// Arms: seed (committed outputs, replayed from the evals cache), seed re-run (fresh samples: the
// run-to-run noise floor), manual text fixes, GEPA-lite best-on-val. Also re-scores every arm on the
// dev val set for the dev-vs-test gap. Writes out/test-<tag>.json and prints a markdown summary.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { auc, brier, classification, ece, mcnemar, pairedBootstrap, percentile } from "../../../packages/evals/src/metrics.ts";
import { loadItems, type Item } from "./data.ts";
import { evaluate, type ItemResult } from "./evaluate.ts";
import { Budget } from "./llm.ts";
import { manualPrompt } from "./manual.ts";
import { seedPrompt } from "./seed.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const runPath = join(import.meta.dir, "..", arg("run", "out/pilot.json")!);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const items = loadItems(arg("features")!);
const test = items.filter(i => i.split === "test");
const val = items.filter(i => run.valIds.includes(i.id));
const CAP = Number(arg("cap", "0.5"));

const cands = run.candidates as { id: number; prompt: string; valMean: number }[];
const best = [...cands].sort((a, b) => b.valMean - a.valMean)[0]!;
const arms: { name: string; prompt: string; attemptBase: number }[] = [
  { name: "seed (pass1-screen-v2, committed run)", prompt: seedPrompt(), attemptBase: 0 },
  { name: "seed re-run (fresh samples)", prompt: seedPrompt(), attemptBase: 10 },
  { name: "manual text fixes (error analysis rec 4)", prompt: manualPrompt(), attemptBase: 0 },
  ...(best.id !== 0 ? [{ name: `GEPA-lite best on val (#${best.id})`, prompt: best.prompt, attemptBase: 0 }] : []),
];

const lnl = (p: number, q: number) => { const e = 1e-4, x = Math.min(1 - e, Math.max(e, q)); return -(p * Math.log(x) + (1 - p) * Math.log(1 - x)); };

function metrics(xs: Item[], rs: ItemResult[]) {
  const yes = rs.map(r => r.verdict === "yes");
  const ok = rs.map(r => r.verdict !== null);
  const drawn = xs.map(i => i.drawnGood), sys = xs.map(i => i.pGood >= 0.5);
  const probs = rs.map(r => r.prob ?? (r.verdict === "yes" ? 1 : 0));
  const cD = classification(yes, drawn), cS = classification(yes, sys);
  const byTier: Record<string, string> = {};
  for (const t of ["minimal", "light", "medium", "rich", "very_rich"]) {
    const idx = xs.map((x, k) => k).filter(k => xs[k]!.tier === t);
    if (idx.length) byTier[t] = `${(idx.reduce((s, k) => s + rs[k]!.expAcc, 0) / idx.length).toFixed(3)} (n=${idx.length})`;
  }
  return {
    n: xs.length, failures: ok.filter(x => !x).length, yesRate: yes.filter(Boolean).length / xs.length,
    accDrawn: cD.accuracy, precDrawn: cD.precision, recDrawn: cD.recall, f1Drawn: cD.f1,
    accSys: cS.accuracy, precSys: cS.precision, recSys: cS.recall,
    expAcc: rs.reduce((s, r) => s + r.expAcc, 0) / xs.length,
    brierDrawn: brier(probs, drawn), brierSoft: rs.reduce((s, r) => s + r.brierSoft, 0) / xs.length,
    logLossSoft: xs.reduce((s, it, k) => s + lnl(it.pGood, probs[k]!), 0) / xs.length,
    aucDrawn: auc(probs, drawn), aucSys: auc(probs, sys), eceDrawn: ece(probs, drawn),
    unsafeRejected: `${xs.filter((x, k) => x.unsafe && !yes[k]).length}/${xs.filter(x => x.unsafe).length}`,
    pairsExpAcc: avgOn(xs, rs, x => !x.group), groupsExpAcc: avgOn(xs, rs, x => x.group), byTier,
    reasoningFirst: rs.filter(r => r.reasoningFirst).length / Math.max(1, ok.filter(Boolean).length),
  };
}
const avgOn = (xs: Item[], rs: ItemResult[], f: (x: Item) => boolean) => { const idx = xs.map((x, k) => k).filter(k => f(xs[k]!)); return idx.reduce((s, k) => s + rs[k]!.expAcc, 0) / Math.max(1, idx.length); };

function paired(xs: Item[], a: ItemResult[], b: ItemResult[]) {
  const ya = a.map(r => r.verdict === "yes"), yb = b.map(r => r.verdict === "yes");
  const mc = (gold: boolean[]) => {
    let onlyA = 0, onlyB = 0;
    gold.forEach((g, k) => { const ra = ya[k] === g, rb = yb[k] === g; if (ra && !rb) onlyA++; if (rb && !ra) onlyB++; });
    return { onlyA, onlyB, p: mcnemar(onlyA, onlyB) };
  };
  const exp = (rs: ItemResult[]) => (idx: number[]) => idx.reduce((s, k) => s + rs[k]!.expAcc, 0) / idx.length;
  const bs = (rs: ItemResult[]) => (idx: number[]) => idx.reduce((s, k) => s + rs[k]!.brierSoft, 0) / idx.length;
  const accD = (y: boolean[]) => (idx: number[]) => idx.filter(k => y[k] === xs[k]!.drawnGood).length / idx.length;
  return {
    mcnemarDrawn: mc(xs.map(i => i.drawnGood)), mcnemarSys: mc(xs.map(i => i.pGood >= 0.5)),
    accDrawnDiff: pairedBootstrap(xs.length, accD(ya), accD(yb)),
    expAccDiff: pairedBootstrap(xs.length, exp(a), exp(b)),
    brierSoftDiff: pairedBootstrap(xs.length, bs(a), bs(b)),
    verdictAgreement: ya.filter((y, k) => y === yb[k]).length / xs.length,
  };
}

const out: any = { run: basename(runPath), bestCandidate: best.id, arms: [] };
const res: Record<string, { test: ItemResult[]; val: ItemResult[] }> = {};
for (const arm of arms) {
  const b = new Budget(CAP);
  const t = await evaluate(arm.prompt, test, b, undefined, arm.attemptBase);
  const v = arm.attemptBase === 0 ? await evaluate(arm.prompt, val, b) : [];
  res[arm.name] = { test: t, val: v };
  out.arms.push({
    name: arm.name, promptChars: arm.prompt.length, test: metrics(test, t), val: v.length ? metrics(val, v) : null,
    freshSpendUsd: b.usd, freshCalls: b.freshCalls, cachedCalls: b.cachedCalls,
    perCall: b.freshCalls ? { promptTokens: b.promptTokens / b.freshCalls, completionTokens: b.completionTokens / b.freshCalls, usdPer1000: (b.usd / b.freshCalls) * 1000, latencyP50: percentile(b.latencies, 50) / 1000, latencyP95: percentile(b.latencies, 95) / 1000 } : null,
  });
  console.log(`${arm.name}: test expAcc ${out.arms.at(-1).test.expAcc.toFixed(3)} accDrawn ${out.arms.at(-1).test.accDrawn.toFixed(3)}; fresh $${b.usd.toFixed(4)}`);
}
const base = res[arms[0]!.name]!.test;
out.pairedVsSeed = Object.fromEntries(arms.slice(1).map(a => [a.name, paired(test, res[a.name]!.test, base)]));
const tag = basename(runPath, ".json");
writeFileSync(join(import.meta.dir, `../out/test-${tag}.json`), JSON.stringify(out, null, 1));

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\n| Arm | split | n | acc (drawn) | P / R (drawn) | acc (systematic) | expected acc (soft) | Brier soft | log-loss soft | AUC (drawn) | ECE | unsafe rejected | yes rate | prompt chars |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const a of out.arms) for (const [s, m] of [["test", a.test], ["dev-val", a.val]] as const) if (m)
  console.log(`| ${a.name} | ${s} | ${m.n} | ${pct(m.accDrawn)} | ${pct(m.precDrawn)} / ${pct(m.recDrawn)} | ${pct(m.accSys)} | ${f(m.expAcc)} | ${f(m.brierSoft)} | ${f(m.logLossSoft)} | ${f(m.aucDrawn)} | ${f(m.eceDrawn)} | ${m.unsafeRejected} | ${pct(m.yesRate)} | ${a.promptChars} |`);
console.log(`\n| vs seed (test) | verdict agreement | McNemar drawn (only arm / only seed, p) | McNemar systematic | acc drawn diff (95% CI) | expected acc diff (95% CI, p) | Brier soft diff (95% CI) |`);
console.log(`|---|---|---|---|---|---|---|`);
for (const [n, p] of Object.entries(out.pairedVsSeed) as [string, any][])
  console.log(`| ${n} | ${pct(p.verdictAgreement)} | ${p.mcnemarDrawn.onlyA}/${p.mcnemarDrawn.onlyB}, p=${f(p.mcnemarDrawn.p, 2)} | ${p.mcnemarSys.onlyA}/${p.mcnemarSys.onlyB}, p=${f(p.mcnemarSys.p, 2)} | ${f(p.accDrawnDiff.diff * 100, 1)} pp (${f(p.accDrawnDiff.lo * 100, 1)} to ${f(p.accDrawnDiff.hi * 100, 1)}) | ${f(p.expAccDiff.diff)} (${f(p.expAccDiff.lo)} to ${f(p.expAccDiff.hi)}, p=${f(p.expAccDiff.p, 2)}) | ${f(p.brierSoftDiff.diff)} (${f(p.brierSoftDiff.lo)} to ${f(p.brierSoftDiff.hi)}) |`);
console.log(`\nper-tier expected accuracy (test):`);
for (const a of out.arms) console.log(`- ${a.name}: ${JSON.stringify(a.test.byTier)}; pairs ${f(a.test.pairsExpAcc)}, groups ${f(a.test.groupsExpAcc)}`);
console.log(`\ncost/latency per fresh call:`);
for (const a of out.arms) console.log(`- ${a.name}: ${a.perCall ? `${Math.round(a.perCall.promptTokens)} in / ${Math.round(a.perCall.completionTokens)} out tokens, $${f(a.perCall.usdPer1000, 4)} per 1,000 items, p50 ${f(a.perCall.latencyP50, 1)}s p95 ${f(a.perCall.latencyP95, 1)}s` : "all cached"}; fresh spend $${f(a.freshSpendUsd, 4)}`);
