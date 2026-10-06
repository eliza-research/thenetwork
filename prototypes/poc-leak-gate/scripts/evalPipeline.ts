// Evaluates the production pipeline decide() (SEND / HOLD_REVIEW / BLOCK) on a corpus split.
//   bun prototypes/poc-leak-gate/scripts/evalPipeline.ts --corpus test2 --split test2 --prompt v3 [--context c2] [--conc 16]
// --context c2 (default) calls the LLM through a disk cache (data/pipeline-cache/, keyed by the exact
// request) so reruns are free. --context c1 replays the ORIGINAL classifier verdicts from
// data/eval-cache/ (no new calls): the old LLM behaviour under the new pipeline rules.
// The LLM runs on every item (alwaysRunLLM) so per-layer numbers are measurable; the reported
// pipeline decision is identical to production because BLOCK takes precedence over every hold.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { llmFor, type ChatMessage, type ChatOptions, type LLM, type Provider } from "@thenetwork/core";
import type { ContextVersion } from "../src/classifier.ts";
import { DEFAULT_LLM_TIMEOUT_MS, decide } from "../src/gate.ts";
import type { GateInput } from "../src/types.ts";
import type { CorpusItem, Scenario } from "./buildCorpus.ts";
import { loadWorld } from "./world.ts";

const DATA = join(import.meta.dir, "../data");
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const corpusName = arg("corpus", "");
const split = arg("split", "test");
const prompt = arg("prompt", "v2");
const context = arg("context", "c2") as ContextVersion;
const model = arg("model", process.env.DEFAULT_LLM_MODEL ?? "gpt-6-luna");
const provider = arg("provider", process.env.DEFAULT_LLM_PROVIDER ?? "surplus") as Provider;
const conc = Number(arg("conc", "16"));
const timeoutMs = Number(arg("timeout", String(DEFAULT_LLM_TIMEOUT_MS)));
const CACHE = join(DATA, "pipeline-cache"); mkdirSync(CACHE, { recursive: true });

const w = loadWorld();
const scenarios = new Map((JSON.parse(readFileSync(join(DATA, corpusName ? `scenarios-${corpusName}.json` : "scenarios.json"), "utf8")) as Scenario[]).map(s => [s.id, s]));
const items = readFileSync(join(DATA, corpusName ? `corpus-${corpusName}.jsonl` : "corpus.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as CorpusItem).filter(x => split === "all" || x.split === split);
const canaries = [...w.members.values()].map(m => ({ memberId: m.id, token: m.canary }));
const toInput = (it: CorpusItem): GateInput => { const sc = scenarios.get(it.scenarioId)!; return { ...sc.input, draft: it.draft, directory: w.directory, canaries, purpose: sc.purposeHint }; };
const adj = new Map<string, string>();
for (const f of ["adjudication-corpus-deepseek-v4-pro.json", "adjudication-corpus-test2-deepseek-v4-pro.json", "adjudication-corpus-test3-deepseek-v4-pro.json"])
  if (existsSync(join(DATA, f))) for (const a of JSON.parse(readFileSync(join(DATA, f), "utf8"))) adj.set(a.id, a.verdict);

let liveCost = 0, liveCalls = 0;
const live = llmFor(provider, model, { timeoutMs: 120_000, onResponse: i => { liveCost += i.costMicro; } });

/** LLM that serves exact-request cache hits and records per-call latency (for the timeout simulation). */
function cachingLLM(lat: number[]): LLM {
  return { chat: async (messages: ChatMessage[], opts?: ChatOptions) => {
    const key = createHash("sha256").update(JSON.stringify({ provider, model, messages, opts })).digest("hex").slice(0, 32);
    const f = join(CACHE, `${key}.json`);
    if (existsSync(f)) { const c = JSON.parse(readFileSync(f, "utf8")); lat.push(c.latencyMs); return c.out; }
    const t0 = performance.now();
    const out = await live.chat(messages, opts);
    const ms = performance.now() - t0; liveCalls++;
    writeFileSync(f, JSON.stringify({ out, latencyMs: ms }));
    lat.push(ms);
    return out;
  } };
}

/** c1 replay: returns the original classifier verdict for this item from data/eval-cache/. */
function replayLLM(it: CorpusItem, lat: number[]): LLM {
  const key = createHash("sha256").update(`${provider}/${model}/${prompt}/${it.id}/${it.draft}`).digest("hex").slice(0, 24);
  const f = join(DATA, "eval-cache", `${key}.json`);
  return { chat: async () => {
    if (!existsSync(f)) throw new Error(`no c1 cache for ${it.id}`);
    const c = JSON.parse(readFileSync(f, "utf8"));
    lat.push(c.latencyMs);
    return c.error ? "unparseable (cached classifier failure)" : JSON.stringify({ reasoning: c.reasoning, quote: c.quote ?? "", category: c.category ?? "none", leak: c.leak });
  } };
}

async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]!); if (++done % 200 === 0) console.error(`  ${done}/${xs.length}`); } }));
  return out;
}

export interface PipelineRow {
  id: string; split: string; label: "leak" | "clean"; technique?: string; topic?: string; cleanType?: string; adj?: string;
  decision: string; decision8s: string; codes: string[]; first: string; core: boolean; lexicon: boolean;
  llmLeak: boolean; llmError: boolean; llmLatencyMs: number; topics?: string[]; romance?: boolean; reason: string; draft: string;
}

const rows = await pool(items, conc, async (it): Promise<PipelineRow> => {
  const lat: number[] = [];
  const llm = context === "c1" ? replayLLM(it, lat) : cachingLLM(lat);
  // Generous deadline here; the configured timeout is applied below from the measured latency.
  const r = await decide(toInput(it), { llm, prompt, context, alwaysRunLLM: true, timeoutMs: 300_000 });
  const codes = [...new Set(r.reasons.map(x => x.code))];
  const latency = lat.reduce((a, b) => a + b, 0);
  const decision8s = r.decision === "SEND" && latency > timeoutMs ? "HOLD_REVIEW" : r.decision;
  return { id: it.id, split: it.split, label: it.label, technique: it.technique, topic: it.topic, cleanType: it.cleanType, adj: adj.get(it.id),
    decision: r.decision, decision8s, codes: decision8s !== r.decision ? [...codes, "llm_timeout"] : codes, first: r.reasons[0]?.code ?? "ok",
    core: r.decision === "BLOCK", lexicon: codes.includes("lexicon"), llmLeak: !!r.llm?.leak && !r.llm?.error, llmError: !!r.llm?.error,
    llmLatencyMs: latency, topics: r.llm?.sensitiveTopicsAboutOthers, romance: r.llm?.romanceFraming, reason: r.reason.slice(0, 300), draft: it.draft };
});

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) : "n/a");
const leaks = rows.filter(r => r.label === "leak"), clean = rows.filter(r => r.label === "clean");
const caught = (r: PipelineRow, d = r.decision8s) => d !== "SEND";
const clearLeaks = leaks.filter(r => r.adj === "clear");
const summary = {
  corpus: corpusName || "main", split, prompt, context, model, timeoutMs, n: { leaks: leaks.length, clean: clean.length, clearLeaks: clearLeaks.length },
  oldGate: { // the original definition: deterministic core OR LLM leak (incl. errors), lexicon excluded
    recall: pct(leaks.filter(r => r.core || r.llmLeak || r.llmError).length, leaks.length),
    recallClear: pct(clearLeaks.filter(r => r.core || r.llmLeak || r.llmError).length, clearLeaks.length),
    fpr: pct(clean.filter(r => r.core || r.llmLeak || r.llmError).length, clean.length),
    llmOnlyRecall: pct(leaks.filter(r => r.llmLeak || r.llmError).length, leaks.length), llmOnlyFpr: pct(clean.filter(r => r.llmLeak || r.llmError).length, clean.length),
  },
  pipeline: {
    recall: pct(leaks.filter(r => caught(r)).length, leaks.length), recallClear: pct(clearLeaks.filter(r => caught(r)).length, clearLeaks.length),
    leakBlock: pct(leaks.filter(r => r.decision8s === "BLOCK").length, leaks.length),
    cleanSend: pct(clean.filter(r => r.decision8s === "SEND").length, clean.length),
    cleanHoldReview: pct(clean.filter(r => r.decision8s === "HOLD_REVIEW").length, clean.length),
    cleanBlock: pct(clean.filter(r => r.decision8s === "BLOCK").length, clean.length),
    timeoutsAt: { ms: timeoutMs, items: rows.filter(r => r.llmLatencyMs > timeoutMs).length },
  },
  cleanHoldByFirstReason: Object.fromEntries(Object.entries(clean.filter(r => r.decision8s === "HOLD_REVIEW").reduce((m, r) => (m[r.decision8s !== r.decision ? "llm_timeout" : r.first] = (m[r.decision8s !== r.decision ? "llm_timeout" : r.first] ?? 0) + 1, m), {} as Record<string, number>))),
  cleanAnyReason: Object.fromEntries(["llm_leak", "llm_error", "llm_timeout", "lexicon", "sensitive_topic_other", "romance_no_optin", "deterministic"].map(c => [c, clean.filter(r => r.codes.includes(c)).length])),
  cleanHoldByType: Object.fromEntries(Object.entries(clean.reduce((m, r) => ((m[r.cleanType!] ??= []).push(r), m), {} as Record<string, PipelineRow[]>)).map(([k, xs]) => [k, { n: xs.length, holdReview: pct(xs.filter(r => r.decision8s === "HOLD_REVIEW").length, xs.length), llmLeak: pct(xs.filter(r => r.llmLeak).length, xs.length) }])),
  recallByTechnique: Object.fromEntries(Object.entries(leaks.reduce((m, r) => ((m[r.technique!] ??= []).push(r), m), {} as Record<string, PipelineRow[]>)).map(([k, xs]) => [k, { n: xs.length, pipeline: pct(xs.filter(r => caught(r)).length, xs.length), block: pct(xs.filter(r => r.decision8s === "BLOCK").length, xs.length), oldGate: pct(xs.filter(r => r.core || r.llmLeak || r.llmError).length, xs.length) }])),
  llmLatency: (() => { const l = rows.map(r => r.llmLatencyMs).sort((a, b) => a - b); return { p50: Math.round(l[Math.floor(l.length / 2)]!), p95: Math.round(l[Math.floor(l.length * 0.95)]!), max: Math.round(l.at(-1)!) }; })(),
  liveCalls, liveCostUsd: liveCost / 1e6,
};
const tag = `${corpusName || "main"}-${split}-${prompt}-${context}`;
writeFileSync(join(DATA, `pipeline-${tag}.json`), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 2));
console.log(`missed (pipeline): ${leaks.filter(r => !caught(r)).map(r => `${r.id}[${r.technique}/${r.topic}/${r.adj ?? "?"}]`).join(", ")}`);
