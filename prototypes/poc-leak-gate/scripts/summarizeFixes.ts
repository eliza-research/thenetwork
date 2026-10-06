// Pools pipeline-*.json results (from evalPipeline.ts) into the before/after tables for RESULTS.md "Fixes".
//   bun prototypes/poc-leak-gate/scripts/summarizeFixes.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PipelineRow } from "./evalPipeline.ts";

const DATA = join(import.meta.dir, "../data");
const load = (tags: string[]): PipelineRow[] => tags.flatMap(t => { const f = join(DATA, `pipeline-${t}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).rows : []; });
function wilson(k: number, n: number) {
  if (!n) return "n/a";
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return `${(100 * p).toFixed(2)}% [${(100 * Math.max(0, c - h)).toFixed(1)}, ${(100 * Math.min(1, c + h)).toFixed(1)}]`;
}
const OWN = "intro that mentions the recipient's own private fact back to them";
/** Pipeline decision under a given LLM deadline (Infinity = no timeout). */
const dec = (r: PipelineRow, t: number) => (r.decision === "SEND" && r.llmLatencyMs > t ? "HOLD_REVIEW" : r.decision);
const oldHold = (r: PipelineRow) => r.core || r.llmLeak || r.llmError;

function report(name: string, rs: PipelineRow[]) {
  if (!rs.length) return;
  const L = rs.filter(r => r.label === "leak"), C = rs.filter(r => r.label === "clean"), clear = L.filter(r => r.adj === "clear"), own = C.filter(r => r.cleanType === OWN);
  const row = (label: string, leakHit: (r: PipelineRow) => boolean, cleanHit: (r: PipelineRow) => boolean) =>
    `| ${name} | ${label} | ${wilson(L.filter(leakHit).length, L.length)} | ${wilson(clear.filter(leakHit).length, clear.length)} | ${wilson(C.filter(cleanHit).length, C.length)} | ${(100 * own.filter(cleanHit).length / (own.length || 1)).toFixed(1)}% |`;
  console.log(row("core+LLM (old gate def.)", oldHold, oldHold));
  console.log(row("LLM leak only", r => r.llmLeak || r.llmError, r => r.llmLeak || r.llmError));
  for (const t of [8000, 15000, Infinity]) console.log(row(`pipeline, timeout ${t === Infinity ? "none" : `${t / 1000}s`} (BLOCK or HOLD)`, r => dec(r, t) !== "SEND", r => dec(r, t) !== "SEND"));
  console.log(`|   | n = ${L.length} leaks (${clear.length} clear), ${C.length} clean (${own.length} own-fact echoes) | | | | |`);
}

const SETS: [string, string[]][] = [
  ["c1 replay v2 (old classifier, new rules)", ["main-test-v2-c1", "test2-test2-v2-c1"]],
  ["c2 v2", ["main-test-v2-c2", "test2-test2-v2-c2"]],
  ["c2 v3", ["main-test-v3-c2", "test2-test2-v3-c2"]],
  ["dev c2 v2", ["main-dev-v2-c2"]],
  ["dev c2 v3", ["main-dev-v3-c2"]],
  ["test3 c2 (frozen)", [`test3-test3-${process.argv[2] ?? "v3"}-c2`]],
];
console.log("| config | layer | recall (95% CI) | recall, adjudicated-clear | clean held/blocked (95% CI) | own-fact-echo held |\n|---|---|---|---|---|---|");
for (const [n, t] of SETS) report(n, load(t));

// Reviewer load breakdown for the c2 sets: first reason of each clean HOLD_REVIEW at 8 s.
for (const [n, t] of SETS.filter(([n]) => n.includes("c2"))) {
  const C = load(t).filter(r => r.label === "clean");
  if (!C.length) continue;
  const m: Record<string, number> = {};
  for (const r of C) { const d = dec(r, 8000); if (d === "SEND") continue; const k = d !== r.decision ? "llm_timeout" : r.first; m[k] = (m[k] ?? 0) + 1; }
  console.log(`\n${n}: clean HOLD_REVIEW by first reason (8 s, n=${C.length}): ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${(100 * v / C.length).toFixed(2)}%)`).join(", ")}`);
  const L = load(t).filter(r => r.label === "leak");
  console.log(`  missed leaks (8 s): ${L.filter(r => dec(r, 8000) === "SEND").map(r => `${r.id}[${r.technique}/${r.topic}/${r.adj ?? "?"}]`).join(", ") || "none"}`);
  const lat = load(t).map(r => r.llmLatencyMs).sort((a, b) => a - b);
  console.log(`  LLM latency p50 ${Math.round(lat[Math.floor(lat.length / 2)]!)} ms, p95 ${Math.round(lat[Math.floor(lat.length * 0.95)]!)} ms, >8 s ${(100 * lat.filter(x => x > 8000).length / lat.length).toFixed(1)}%`);
}
