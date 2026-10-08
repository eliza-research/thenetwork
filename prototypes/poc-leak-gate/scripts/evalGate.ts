// Evaluates the gate per layer on the corpus.
//   bun prototypes/poc-leak-gate/scripts/evalGate.ts --split dev --prompt v1 [--no-llm] [--model gpt-6-luna] [--conc 16]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { llmFor, type Provider } from "@thenetwork/core";
import { classifyLeak, type ClassifierResult } from "../src/classifier.ts";
import { deterministicCheck } from "../src/deterministic.ts";
import type { GateInput } from "../src/types.ts";
import type { CorpusItem, Scenario } from "./buildCorpus.ts";
import { loadWorld } from "./world.ts";

const DATA = join(import.meta.dir, "../data");
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const split = arg("split", "dev");
const prompt = arg("prompt", "v1");
const model = arg("model", process.env.DEFAULT_LLM_MODEL ?? "gpt-6-luna");
const provider = arg("provider", process.env.DEFAULT_LLM_PROVIDER ?? "surplus") as Provider;
const noLLM = process.argv.includes("--no-llm");
const conc = Number(arg("conc", "16"));
const corpusName = arg("corpus", "");
const rep = Number(arg("rep", "1")); // repeat index: a different cache key = an independent classifier sample // e.g. "test2" -> corpus-test2.jsonl / scenarios-test2.json
const CACHE = join(DATA, "eval-cache");
mkdirSync(CACHE, { recursive: true });

const w = loadWorld();
const scenarios = new Map((JSON.parse(readFileSync(join(DATA, corpusName ? `scenarios-${corpusName}.json` : "scenarios.json"), "utf8")) as Scenario[]).map(s => [s.id, s]));
const items = readFileSync(join(DATA, corpusName ? `corpus-${corpusName}.jsonl` : "corpus.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as CorpusItem).filter(x => split === "all" || x.split === split);
const canaries = [...w.members.values()].map(m => ({ memberId: m.id, token: m.canary }));
const toInput = (it: CorpusItem): GateInput => {
  const sc = scenarios.get(it.scenarioId)!;
  return { ...sc.input, draft: it.draft, directory: w.directory, canaries, purpose: sc.purposeHint };
};

async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]!, i); if (++done % 100 === 0) console.error(`  ${done}/${xs.length}`); } }));
  return out;
}

interface Row { it: CorpusItem; core: boolean; lex: boolean; detMs: number; detFindings: string[]; llm?: ClassifierResult; cached?: boolean }
const rows: Row[] = items.map(it => {
  const t0 = performance.now();
  const d = deterministicCheck(toInput(it));
  return { it, core: d.core, lex: d.lexicon, detMs: performance.now() - t0, detFindings: d.findings.map(f => `${f.rule}: ${f.detail}`) };
});

if (!noLLM) {
  await pool(rows, conc, async row => {
    const key = createHash("sha256").update(`${provider}/${model}/${prompt}/${row.it.id}/${row.it.draft}${rep > 1 ? `/rep${rep}` : ""}`).digest("hex").slice(0, 24);
    const f = join(CACHE, `${key}.json`);
    if (existsSync(f)) { row.llm = JSON.parse(readFileSync(f, "utf8")); row.cached = true; return; }
    // Meter cost/tokens on the client we pass in (classifyLeak only meters clients it builds itself).
    let cost = 0, pt = 0, ct = 0;
    const metered = llmFor(provider, model, { timeoutMs: 120_000, onResponse: i => { cost += i.costMicro; pt += i.usage.promptTokens; ct += i.usage.completionTokens; } });
    const r = await classifyLeak(toInput(row.it), { llm: metered, prompt });
    row.llm = { ...r, costMicro: cost, promptTokens: pt, completionTokens: ct };
    writeFileSync(f, JSON.stringify(row.llm));
  });
}

// ---------- metrics ----------
type Layer = "det_core" | "lexicon" | "det_all" | "llm" | "core+llm" | "all";
const LAYERS: Layer[] = noLLM ? ["det_core", "lexicon", "det_all"] : ["det_core", "lexicon", "det_all", "llm", "core+llm", "all"];
const holds = (r: Row, l: Layer) => ({ det_core: r.core, lexicon: r.lex, det_all: r.core || r.lex, llm: !!r.llm?.leak, "core+llm": r.core || !!r.llm?.leak, all: r.core || r.lex || !!r.llm?.leak })[l];
const pct = (a: number, b: number) => (b ? (100 * a) / b : NaN);
const leaks = rows.filter(r => r.it.label === "leak"), clean = rows.filter(r => r.it.label === "clean");
const group = (rs: Row[], k: (r: Row) => string) => rs.reduce((m, r) => ((m[k(r)] ??= []).push(r), m), {} as Record<string, Row[]>);
const table = (rs: Row[], key: (r: Row) => string, label: string, positive: boolean) => {
  const g = group(rs, key);
  const out: Record<string, Record<string, string>> = {};
  for (const [k, xs] of Object.entries(g).sort()) { out[k] = { n: String(xs.length) }; for (const l of LAYERS) out[k]![l] = pct(xs.filter(r => holds(r, l) === positive).length, xs.length).toFixed(1); }
  out["ALL"] = { n: String(rs.length) }; for (const l of LAYERS) out["ALL"]![l] = pct(rs.filter(r => holds(r, l) === positive).length, rs.length).toFixed(1);
  return { label, out };
};
const recallTech = table(leaks, r => r.it.technique!, "recall by technique (%)", true);
const recallTopic = table(leaks, r => r.it.topic!, "recall by topic (%)", true);
const fprType = table(clean, r => r.it.cleanType!, "false-positive rate by clean type (%)", true);

const llmRows = rows.filter(r => r.llm && !r.cached);
const lat = llmRows.map(r => r.llm!.latencyMs).sort((a, b) => a - b);
const q = (p: number) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]! : NaN;
const allLLM = rows.filter(r => r.llm);
const detLat = rows.map(r => r.detMs).sort((a, b) => a - b);
const perf = {
  detMsP50: detLat[Math.floor(detLat.length / 2)], detMsP99: detLat[Math.floor(detLat.length * 0.99)],
  llmMsP50: q(0.5), llmMsP95: q(0.95), llmMsMax: lat.at(-1), llmTimedSamples: lat.length,
  llmCostUsdPerMsg: allLLM.reduce((s, r) => s + r.llm!.costMicro, 0) / 1e6 / (allLLM.length || 1),
  llmPromptTokensMean: allLLM.reduce((s, r) => s + r.llm!.promptTokens, 0) / (allLLM.length || 1),
  llmCompletionTokensMean: allLLM.reduce((s, r) => s + r.llm!.completionTokens, 0) / (allLLM.length || 1),
  llmErrors: allLLM.filter(r => r.llm!.error).length,
  // Production cost: the LLM only runs when deterministic checks pass (short-circuit).
  llmCallShareWithShortCircuit: pct(rows.filter(r => !r.core).length, rows.length),
};
const missed = (l: Layer) => leaks.filter(r => !holds(r, l)).map(r => ({ id: r.it.id, technique: r.it.technique, topic: r.it.topic, fact: r.it.fact, draft: r.it.draft, llm: r.llm?.reasoning }));
const fps = (l: Layer) => clean.filter(r => holds(r, l)).map(r => ({ id: r.it.id, type: r.it.cleanType, draft: r.it.draft, det: r.detFindings, llm: r.llm?.leak ? `${r.llm.quote ?? ""} | ${r.llm.reasoning}` : undefined }));

const result = { split, prompt, model, provider, n: { leaks: leaks.length, clean: clean.length }, recallTech, recallTopic, fprType, perf,
  missed: Object.fromEntries(LAYERS.map(l => [l, missed(l)])), falsePositives: Object.fromEntries(LAYERS.map(l => [l, fps(l)])) };
const tag = noLLM ? `${split}-det` : `${split}-${model}-${prompt}${rep > 1 ? `-rep${rep}` : ""}`;
writeFileSync(join(DATA, `results-${tag}.json`), JSON.stringify(result, null, 2));

const show = (t: { label: string; out: Record<string, Record<string, string>> }) => {
  console.log(`\n${t.label}`); console.log(["", "n", ...LAYERS].map(s => s.padEnd(14)).join(""));
  for (const [k, v] of Object.entries(t.out)) console.log([k.slice(0, 13), v.n, ...LAYERS.map(l => v[l])].map(s => String(s).padEnd(14)).join(""));
};
console.log(`split=${split} prompt=${prompt} model=${model} leaks=${leaks.length} clean=${clean.length}`);
show(recallTech); show(recallTopic); show(fprType);
console.log("\nperf", perf);
for (const l of LAYERS) console.log(`${l}: missed ${missed(l).length}, FP ${fps(l).length}`);
