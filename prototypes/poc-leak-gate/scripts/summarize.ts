// Pools held-out results (test + test2), adds Wilson 95% CIs, the 2-sample union, and the
// adjudicated view (leaks a third-family model judged real). Prints markdown for RESULTS.md.
//   bun prototypes/poc-leak-gate/scripts/summarize.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = join(import.meta.dir, "../data");
const J = (f: string) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const corpus = (f: string) => readFileSync(join(DATA, f), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const items = [...corpus("corpus.jsonl"), ...corpus("corpus-test2.jsonl")];
const byId = new Map(items.map((x: any) => [x.id, x]));
const adj = new Map<string, string>();
for (const f of ["adjudication-corpus-deepseek-v4-pro.json", "adjudication-corpus-test2-deepseek-v4-pro.json"]) if (existsSync(join(DATA, f))) for (const a of J(f)) adj.set(a.id, a.verdict);

function wilson(k: number, n: number) {
  if (!n) return "n/a";
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return `${(100 * p).toFixed(2)}% [${(100 * Math.max(0, c - h)).toFixed(1)}, ${(100 * Math.min(1, c + h)).toFixed(1)}]`;
}

const LAYERS = ["det_core", "lexicon", "det_all", "llm", "core+llm", "all"];
function pooled(files: string[]) {
  const rs = files.map(J);
  const nL = rs.reduce((s, r) => s + r.n.leaks, 0), nC = rs.reduce((s, r) => s + r.n.clean, 0);
  const missed = (l: string) => rs.flatMap(r => r.missed[l].map((m: any) => m.id)) as string[];
  const fps = (l: string) => rs.flatMap(r => r.falsePositives[l].map((m: any) => m.id)) as string[];
  return { nL, nC, missed, fps, rs };
}

const sets: [string, string[], string[]][] = [
  ["v2 (frozen choice)", ["results-test-gpt-6-luna-v2.json", "results-test2-gpt-6-luna-v2.json"], ["results-test-gpt-6-luna-v2-rep2.json", "results-test2-gpt-6-luna-v2-rep2.json"]],
  ["v3", ["results-test-gpt-6-luna-v3.json", "results-test2-gpt-6-luna-v3.json"], []],
];
const leakIds = items.filter((x: any) => x.label === "leak" && x.split !== "dev").map((x: any) => x.id);
const realLeak = new Set(leakIds.filter(id => adj.get(id) === "clear"));
const realOrWeak = new Set(leakIds.filter(id => ["clear", "weak"].includes(adj.get(id) ?? "")));
console.log(`Adjudication of held-out leaks: clear ${realLeak.size}, weak ${realOrWeak.size - realLeak.size}, no ${leakIds.filter(id => adj.get(id) === "no").length}, unadjudicated ${leakIds.filter(id => !adj.has(id) || adj.get(id) === "error").length}\n`);

for (const [name, files, rep2] of sets) {
  const p = pooled(files);
  console.log(`### ${name}: held-out test + test2 (${p.nL} leaks, ${p.nC} clean)\n`);
  console.log(`| layer | recall (95% CI) | FPR (95% CI) | recall on adjudicated-clear leaks |`);
  console.log(`|---|---|---|---|`);
  for (const l of LAYERS) {
    const m = p.missed(l), f = p.fps(l);
    const mClear = m.filter(id => realLeak.has(id)).length;
    console.log(`| ${l} | ${wilson(p.nL - m.length, p.nL)} | ${wilson(f.length, p.nC)} | ${wilson(realLeak.size - mClear, realLeak.size)} |`);
  }
  if (rep2.length) {
    const q = pooled(rep2);
    for (const l of ["core+llm", "all"]) {
      const m1 = new Set(p.missed(l)), m2 = q.missed(l), f = new Set([...p.fps(l), ...q.fps(l)]);
      const both = m2.filter(id => m1.has(id));
      console.log(`| ${l}, sample 2 alone | ${wilson(p.nL - m2.length, p.nL)} | ${wilson(q.fps(l).length, p.nC)} | ${wilson(realLeak.size - m2.filter(id => realLeak.has(id)).length, realLeak.size)} |`);
      console.log(`| ${l}, hold if either of 2 samples flags | ${wilson(p.nL - both.length, p.nL)} | ${wilson(f.size, p.nC)} | ${wilson(realLeak.size - both.filter(id => realLeak.has(id)).length, realLeak.size)} |`);
    }
  }
  console.log("");
  console.log(`Misses (core+llm): ${p.missed("core+llm").map(id => `${id} [${byId.get(id).technique}/${byId.get(id).topic}, adjudicated ${adj.get(id) ?? "?"}]`).join("; ")}\n`);
  console.log(`FPs (all): ${p.fps("all").join(", ")}\n`);
}

// Pooled per-class tables for the frozen configuration (v2, sample 1).
{
  const p = pooled(sets[0]![1]);
  const held = items.filter((x: any) => x.split !== "dev");
  const tableBy = (label: "leak" | "clean", key: string, title: string) => {
    const groups = new Map<string, string[]>();
    for (const x of held.filter((x: any) => x.label === label)) (groups.get(x[key]) ?? groups.set(x[key], []).get(x[key])!).push(x.id);
    console.log(`\n#### ${title}\n\n| ${key} | n | ${LAYERS.join(" | ")} |\n|---|---|${LAYERS.map(() => "---").join("|")}|`);
    const rows = [...groups.entries()].sort();
    rows.push(["ALL", [...groups.values()].flat()]);
    for (const [k, ids] of rows) {
      const set = new Set(ids);
      const cells = LAYERS.map(l => {
        const bad = (label === "leak" ? p.missed(l) : p.fps(l)).filter(id => set.has(id)).length;
        return (100 * (label === "leak" ? ids.length - bad : bad) / ids.length).toFixed(1);
      });
      console.log(`| ${k} | ${ids.length} | ${cells.join(" | ")} |`);
    }
  };
  tableBy("leak", "technique", "Recall (%) by leak technique, held-out test+test2, v2");
  tableBy("leak", "topic", "Recall (%) by topic, held-out test+test2, v2");
  tableBy("clean", "cleanType", "False-positive rate (%) by clean message type, held-out test+test2, v2");
  const perf = p.rs.map((r: any) => r.perf);
  console.log(`\nperf per split: ${JSON.stringify(perf.map((x: any) => ({ detP50: x.detMsP50.toFixed(2), detP99: x.detMsP99.toFixed(2), llmP50: Math.round(x.llmMsP50), llmP95: Math.round(x.llmMsP95), llmMax: Math.round(x.llmMsMax), usdPerMsg: x.llmCostUsdPerMsg, inTok: Math.round(x.llmPromptTokensMean), outTok: Math.round(x.llmCompletionTokensMean), llmShare: x.llmCallShareWithShortCircuit.toFixed(1) })))}`);
}
