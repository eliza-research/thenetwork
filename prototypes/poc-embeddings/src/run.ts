// Retrieval-recall POC: does a real embedding model retrieve the oracle's latent good pairs better
// than the engine's hashing embedding? Writes out/results${TAG}.json and prints markdown tables.
//
//   bun prototypes/poc-embeddings/src/run.ts            # uses the disk cache; embeds only what's missing
//   bun prototypes/poc-embeddings/src/run.ts --no-api   # local + BM25 only
//   bun prototypes/poc-embeddings/src/run.ts --include-expired   # counterfactual: expired intents still live
import { parseArgs } from "node:util";
import { mkdirSync, appendFileSync } from "node:fs";
import type { MemberId } from "../../../packages/core/src/index.ts";
import { tokenize } from "../../../packages/engine/src/embed.ts";
import { provenanceWeight } from "../../../packages/engine/src/world.ts";
import { loadAll, candidatePools, oracleTruth, systematicTruth, statedScorer, statedPairOnlyScorer, structuredPublicScorer, facetText, intentText, type MemberView, type Truth } from "./data.ts";
import { localEmbedAll, openaiEmbedAll, newLog, POC_DIR, CACHE_DIR, type UsageLog } from "./embedders.ts";
import { BM25 } from "./bm25.ts";

const args = parseArgs({ options: { "no-api": { type: "boolean", default: false }, "include-expired": { type: "boolean", default: false } } }).values;
// --include-expired: counterfactual where "active" intents past their horizon still count (the
// oracle keeps those desires live; the engine drops them).
const TAG = args["include-expired"] ? "-include-expired" : "";
const KS = [10, 25, 50, 100];

const { d, personas, views, now } = await loadAll({ includeExpiredIntents: args["include-expired"] });
const byId = new Map(views.map(v => [v.id, v]));
const pools = candidatePools(d, views);

// ---- ground truth -------------------------------------------------------------------------------
const truths: Truth[] = [oracleTruth(personas, 1, now), oracleTruth(personas, 2, now), oracleTruth(personas, 3, now)];
const sys = systematicTruth(personas, now);
truths.push(sys.truth);
const stated = statedScorer(personas, now);
const statedPair = statedPairOnlyScorer(personas, now);
// A few latent pairs are connected by a public edge without a hidden relationship (e.g. an invite):
// they are outside every retrieval pool, so drop them from the truth (and report how many).
const droppedOutsidePool: Record<string, number> = {};
for (const t of truths) {
  let miss = 0;
  for (const [a, g] of t.good) for (const b of [...g]) if (!pools.get(a)?.includes(b)) { g.delete(b); miss++; }
  t.pairs -= miss / 2; droppedOutsidePool[t.name] = miss / 2;
}

// ---- texts to embed -----------------------------------------------------------------------------
const texts = new Set<string>();
for (const v of views) {
  texts.add(v.doc); texts.add(v.wants); texts.add(v.offers);
  for (const f of v.match) texts.add(facetText(f));
  for (const i of v.intents) texts.add(intentText(i));
}
const textList = [...texts];
console.error(`members ${views.length}, texts to embed ${textList.length}`);

type Vec = Float64Array;
type Emb = Map<string, Vec>;
const toF = (m: Map<string, number[]>): Emb => new Map([...m].map(([k, v]) => [k, Float64Array.from(v)]));
function dotF(a: Vec, b: Vec) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; }

const embeddings: Record<string, Emb> = {};
const usage: Record<string, UsageLog & { wallMs: number }> = {};
{
  const t0 = performance.now();
  embeddings["local-hash"] = toF(localEmbedAll(textList));
  usage["local-hash"] = { ...newLog("local-hash"), texts: textList.length, wallMs: Math.round(performance.now() - t0) };
}
if (!args["no-api"]) {
  for (const model of ["text-embedding-3-small", "text-embedding-3-large"]) {
    const log = newLog(model);
    const t0 = performance.now();
    embeddings[model] = toF(await openaiEmbedAll(model, textList, log));
    usage[model] = { ...log, wallMs: Math.round(performance.now() - t0) };
    if (log.texts) appendFileSync(`${CACHE_DIR}/usage.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...usage[model] }) + "\n");
    console.error(`${model}: embedded ${log.texts} new texts, ${log.tokens} tokens, $${log.costUsd.toFixed(5)}, cache hits ${log.cacheHits}`);
  }
}

// ---- scorers: (a, b) -> score, higher is better -----------------------------------------------
type Scorer = (a: MemberView, b: MemberView) => number;

function engineStyle(E: Emb): Scorer {
  // Mirrors World.intentFit / bestFacet: best facet cosine x provenance weight, +0.15 on a tag hit,
  // in both directions, and the profile-centroid cosine x 0.8 (retrieveByEmbedding).
  const centroid = new Map<string, Vec | null>();
  for (const v of views) {
    if (!v.match.length) { centroid.set(v.id, null); continue; }
    const dim = E.get(facetText(v.match[0]!))!.length;
    const c = new Float64Array(dim);
    for (const f of v.match) { const e = E.get(facetText(f))!; for (let i = 0; i < dim; i++) c[i]! += e[i]!; }
    let n = 0; for (let i = 0; i < dim; i++) n += c[i]! * c[i]!; n = Math.sqrt(n) || 1;
    for (let i = 0; i < dim; i++) c[i]! /= n;
    centroid.set(v.id, c);
  }
  const fit = (x: MemberView, y: MemberView) => {
    let best = 0;
    for (const it of x.intents) {
      const q = E.get(intentText(it))!;
      const toks = new Set(tokenize(intentText(it)));
      for (const f of y.match) {
        let s = dotF(q, E.get(facetText(f))!) * provenanceWeight(f);
        if (f.tags.some(t => toks.has(t.toLowerCase()))) s = Math.min(1, s + 0.15);
        if (s > best) best = s;
      }
    }
    return best;
  };
  return (a, b) => {
    const ca = centroid.get(a.id), cb = centroid.get(b.id);
    const prof = ca && cb ? 0.8 * dotF(ca, cb) : 0;
    return Math.max(fit(a, b), fit(b, a), prof);
  };
}
const docSim = (E: Emb): Scorer => (a, b) => dotF(E.get(a.doc)!, E.get(b.doc)!);
const wantOffer = (E: Emb): Scorer => (a, b) => dotF(E.get(a.wants)!, E.get(b.offers)!) + dotF(E.get(b.wants)!, E.get(a.offers)!);
const multiView = (E: Emb): Scorer => (a, b) => {
  const wa = E.get(a.wants)!, wb = E.get(b.wants)!;
  return dotF(E.get(a.doc)!, E.get(b.doc)!) + 0.5 * (dotF(wa, E.get(b.offers)!) + dotF(wb, E.get(a.offers)!)) + 0.5 * dotF(wa, wb);
};

const bm = new BM25(new Map(views.map(v => [v.id, v.doc])));
const methods: { name: string; group: string; scorer: Scorer }[] = [];
methods.push({ name: "random", group: "baseline", scorer: (a, b) => hashU(`${a.id}|${b.id}`) });
methods.push({ name: "BM25 (doc)", group: "baseline", scorer: (a, b) => bm.score(a.doc, b.id) + bm.score(b.doc, a.id) });
for (const model of Object.keys(embeddings)) {
  const E = embeddings[model]!;
  methods.push({ name: `${model} / engine-style facets`, group: model, scorer: engineStyle(E) });
  methods.push({ name: `${model} / profile doc`, group: model, scorer: docSim(E) });
  methods.push({ name: `${model} / want<->offer`, group: model, scorer: wantOffer(E) });
  methods.push({ name: `${model} / multi-view`, group: model, scorer: multiView(E) });
}
const structured = structuredPublicScorer(views, d);
methods.push({ name: "structured public (taxonomy + tags)", group: "structured", scorer: (a, b) => structured(a.id, b.id) });
for (const model of Object.keys(embeddings).filter(m => m !== "local-hash")) {
  const wo = wantOffer(embeddings[model]!);
  methods.push({ name: `structured + ${model} want<->offer (tie-break 0.1)`, group: "structured", scorer: (a, b) => structured(a.id, b.id) + 0.1 * wo(a, b) });
}
methods.push({ name: "ceiling: oracle pair terms on STATED profile, neutral member traits", group: "ceiling", scorer: (a, b) => statedPair(a.id, b.id) });
methods.push({ name: "ceiling: oracle utility on STATED public profile", group: "ceiling", scorer: (a, b) => stated(a.id, b.id) });
methods.push({ name: "ceiling: oracle utility on HIDDEN truth (no chemistry)", group: "ceiling", scorer: (a, b) => sys.score(a.id, b.id) });

function hashU(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

// ---- evaluation ---------------------------------------------------------------------------------
interface Metrics { recall: Record<number, number>; pairRecall: Record<number, number>; mrr: number; kFor80: number | null; kFor80Pair: number | null; queries: number; ms: number }

function evaluate(scorer: Scorer, truth: Truth, rankCache: Map<MemberId, MemberId[]>): Metrics {
  const t0 = performance.now();
  const ranks = rankCache;
  for (const [a, pool] of pools) {
    if (ranks.has(a)) continue;
    const va = byId.get(a)!;
    const s = pool.map(b => ({ b, s: scorer(va, byId.get(b)!) }));
    s.sort((x, y) => (y.s - x.s) || (x.b < y.b ? -1 : 1));
    ranks.set(a, s.map(x => x.b));
  }
  const maxK = Math.max(...[...pools.values()].map(p => p.length));
  const recallAt = new Float64Array(maxK + 1);
  let q = 0, rr = 0;
  const pos = new Map<MemberId, Map<MemberId, number>>(); // a -> b -> rank (1-based)
  for (const [a, g] of truth.good) {
    const r = ranks.get(a); if (!r || !g.size) continue;
    q++;
    const m = new Map<MemberId, number>(); r.forEach((b, i) => m.set(b, i + 1)); pos.set(a, m);
    const hits = new Int32Array(maxK + 2);
    let first = Infinity;
    for (const b of g) { const k = m.get(b); if (k) { hits[k]!++; first = Math.min(first, k); } }
    let c = 0;
    for (let k = 1; k <= maxK; k++) { c += hits[k]!; recallAt[k]! += c / g.size; }
    rr += Number.isFinite(first) ? 1 / first : 0;
  }
  const recall: Record<number, number> = {};
  for (const k of KS) recall[k] = recallAt[k]! / q;
  let kFor80: number | null = null;
  for (let k = 1; k <= maxK; k++) if (recallAt[k]! / q >= 0.8) { kFor80 = k; break; }
  // Pair-level recall: a pair is retrieved at K if either member has the other in its top K
  // (the engine retrieves per member, then unions).
  const pairs: { a: string; b: string }[] = [];
  for (const [a, g] of truth.good) for (const b of g) if (a < b) pairs.push({ a, b });
  const best = pairs.map(({ a, b }) => Math.min(pos.get(a)?.get(b) ?? Infinity, pos.get(b)?.get(a) ?? Infinity));
  const pairRecall: Record<number, number> = {};
  for (const k of KS) pairRecall[k] = best.filter(x => x <= k).length / pairs.length;
  let kFor80Pair: number | null = null;
  const sorted = [...best].sort((x, y) => x - y);
  const idx = Math.ceil(0.8 * sorted.length) - 1;
  if (idx >= 0 && Number.isFinite(sorted[idx]!)) kFor80Pair = sorted[idx]!;
  return { recall, pairRecall, mrr: rr / q, kFor80, kFor80Pair, queries: q, ms: Math.round(performance.now() - t0) };
}

const results: { method: string; group: string; truth: string; m: Metrics }[] = [];
for (const meth of methods) {
  const cache = new Map<MemberId, MemberId[]>();
  for (const t of truths) results.push({ method: meth.name, group: meth.group, truth: t.name, m: evaluate(meth.scorer, t, cache) });
  console.error(`scored ${meth.name}`);
}

// ---- output -------------------------------------------------------------------------------------
const poolSizes = [...pools.values()].map(p => p.length).sort((a, b) => a - b);
const meta = {
  droppedOutsidePool,
  members: views.length, queryMembers: pools.size,
  poolSize: { min: poolSizes[0], median: poolSizes[poolSizes.length >> 1], max: poolSizes[poolSizes.length - 1] },
  truths: truths.map(t => ({ name: t.name, pairs: t.pairs, membersWithGood: [...t.good.values()].filter(s => s.size).length, meanGoodPerMember: [...t.good.values()].reduce((s, x) => s + x.size, 0) / Math.max(1, t.good.size) })),
  textsEmbedded: textList.length,
  tokens: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, v])),
};
mkdirSync(`${POC_DIR}/out`, { recursive: true });
await Bun.write(`${POC_DIR}/out/results${TAG}.json`, JSON.stringify({ meta, results }, null, 2));

const pct = (x: number) => (100 * x).toFixed(1);
for (const t of truths) {
  console.log(`\n### ${t.name}: ${t.pairs} pairs\n`);
  console.log(`| Method | R@10 | R@25 | R@50 | R@100 | MRR | K for 80% (member) | pair R@50 | K for 80% (pair) |`);
  console.log(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of results.filter(r => r.truth === t.name)) {
    const m = r.m;
    console.log(`| ${r.method} | ${pct(m.recall[10]!)} | ${pct(m.recall[25]!)} | ${pct(m.recall[50]!)} | ${pct(m.recall[100]!)} | ${m.mrr.toFixed(3)} | ${m.kFor80 ?? "-"} | ${pct(m.pairRecall[50]!)} | ${m.kFor80Pair ?? "-"} |`);
  }
}
console.log("\n" + JSON.stringify(meta, null, 2));
