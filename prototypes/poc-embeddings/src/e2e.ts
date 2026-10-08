// End-to-end check through the production runEngine path: plug each embedding in via deps.embed and
// measure, against the oracle's latent good pairs, where good pairs are lost: retrieval (never
// generated/scored), ranking (scored but not eligible / not selected), or selection budget.
//
//   bun prototypes/poc-embeddings/src/e2e.ts
import { mkdirSync } from "node:fs";
import type { MemberId } from "../../../packages/core/src/index.ts";
import { runEngine } from "../../../packages/engine/src/index.ts";
import { cosine, localEmbed } from "../../../packages/engine/src/embed.ts";
import { toSnapshot } from "../../../scripts/synthetic/load.ts";
import { loadAll, candidatePools, oracleTruth, systematicTruth, structuredPublicScorer, facetText, intentText } from "./data.ts";
import { openaiEmbedAll, newLog, POC_DIR } from "./embedders.ts";

const { d, personas, views, now } = await loadAll();
const snap = toSnapshot(d);
const pools = candidatePools(d, views);
const truth = oracleTruth(personas, 1, now);
for (const [a, g] of truth.good) for (const b of [...g]) if (!pools.get(a)?.includes(b)) g.delete(b);
const sys = systematicTruth(personas, now);
const structured = structuredPublicScorer(views, d);
const isGood = (a: MemberId, b: MemberId) => truth.good.get(a)?.has(b) ?? false;
const latent = [...truth.good.values()].reduce((s, g) => s + g.size, 0) / 2;
const allPairs = [...pools.values()].reduce((s, p) => s + p.length, 0) / 2;

/** Sync EmbedFn backed by precomputed vectors; records misses so a second pass can fill them. */
function lookupEmbed(table: Map<string, number[]>, misses: Set<string>, dim: number) {
  return (t: string) => { const v = table.get(t); if (v) return v; misses.add(t); return new Array(dim).fill(0); };
}

// Thresholds in DEFAULT_CONFIG were tuned on the hashing embedding's cosine scale. For a real model,
// map each threshold to the same quantile of the intent->facet cosine distribution.
function quantileMap(embedA: (t: string) => number[], embedB: (t: string) => number[], ths: number[]): number[] {
  const intents = views.flatMap(v => v.intents.map(intentText)).slice(0, 300);
  const facets = views.flatMap(v => v.match.map(facetText)).filter((_, i) => i % 5 === 0);
  const sa: number[] = [], sb: number[] = [];
  for (const i of intents) { const qa = embedA(i), qb = embedB(i); for (const f of facets) { sa.push(cosine(qa, embedA(f))); sb.push(cosine(qb, embedB(f))); } }
  sa.sort((x, y) => x - y); sb.sort((x, y) => x - y);
  return ths.map(th => { let lo = 0; while (lo < sa.length && sa[lo]! < th) lo++; return sb[Math.min(sb.length - 1, lo)]!; });
}

async function engineTexts(): Promise<Set<string>> {
  const seen = new Set<string>();
  await runEngine(snap, { seed: 1, judge: { enabled: false } }, { embed: t => { seen.add(t); return localEmbed(t); } });
  return seen;
}

const report: Record<string, unknown>[] = [];
const texts = await engineTexts();
const backends: { name: string; embed: (t: string) => number[]; cfg: any }[] = [{ name: "local-hash", embed: localEmbed, cfg: {} }];
for (const model of ["text-embedding-3-small", "text-embedding-3-large"]) {
  const table = await openaiEmbedAll(model, [...texts], newLog(model));
  let misses = new Set<string>();
  let fn = lookupEmbed(table, misses, table.values().next().value!.length);
  // Second pass: texts that only appear on paths opened by the new embedding (themes, gap queries).
  await runEngine(snap, { seed: 1, judge: { enabled: false } }, { embed: fn });
  if (misses.size) {
    const more = await openaiEmbedAll(model, [...misses], newLog(model));
    for (const [k, v] of more) table.set(k, v);
    misses = new Set(); fn = lookupEmbed(table, misses, table.values().next().value!.length);
  }
  const [minSim, warmMinSim, poolSim] = quantileMap(localEmbed, fn, [0.2, 0.15, 0.4]);
  backends.push({ name: `${model} (default thresholds)`, embed: fn, cfg: {} });
  backends.push({ name: `${model} (quantile-mapped thresholds)`, embed: fn, cfg: { retrieval: { minSim, warmMinSim, poolSim } } });
}

for (const b of backends) {
  const t0 = performance.now();
  const { proposals, runLog } = await runEngine(snap, { seed: 1, judge: { enabled: false }, ...b.cfg }, { embed: b.embed, embedModel: b.name });
  const ms = Math.round(performance.now() - t0);
  const pairsOf = (ps: MemberId[]) => { const out: [MemberId, MemberId][] = []; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) out.push([ps[i]!, ps[j]!]); return out; };
  const key = (a: string, b2: string) => (a < b2 ? `${a}|${b2}` : `${b2}|${a}`);
  const scoredPairs = new Map<string, { score: number; eligible: boolean }>();
  for (const s of runLog.scored) for (const [x, y] of pairsOf(s.participants)) {
    const k = key(x, y); const cur = scoredPairs.get(k);
    if (!cur || s.score > cur.score) scoredPairs.set(k, { score: s.score, eligible: s.eligible || !!cur?.eligible });
  }
  const selPairs = new Set<string>(); const selIntro = new Set<string>();
  for (const p of proposals) for (const [x, y] of pairsOf(p.participants)) { selPairs.add(key(x, y)); if (p.participants.length === 2) selIntro.add(key(x, y)); }
  const good = (k: string) => { const [x, y] = k.split("|") as [string, string]; return isGood(x, y); };
  const cnt = (ks: Iterable<string>) => { let n = 0, g = 0; for (const k of ks) { n++; if (good(k)) g++; } return { n, g, precision: n ? g / n : 0, recall: g / latent }; };
  const scored = cnt(scoredPairs.keys());
  const eligible = cnt([...scoredPairs].filter(([, v]) => v.eligible).map(([k]) => k));
  const selected = cnt(selPairs);
  const selectedIntro = cnt(selIntro);
  // Ranking diagnostic over the SAME scored candidate set: precision of the top-N pairs by engine
  // score vs by an alternative ranker, N = number of selected pairs.
  const N = selPairs.size;
  const cands = [...scoredPairs.entries()];
  const topBy = (f: (k: string, v: { score: number }) => number) => cands.map(([k, v]) => ({ k, s: f(k, v) })).sort((p, q) => q.s - p.s).slice(0, N);
  const prec = (xs: { k: string }[]) => xs.filter(x => good(x.k)).length / Math.max(1, xs.length);
  const split = (k: string) => k.split("|") as [string, string];
  const rank = {
    engineScore: prec(topBy((_, v) => v.score)),
    structuredPublic: prec(topBy(k => structured(...split(k)))),
    oracleSystematicCeiling: prec(topBy(k => sys.score(...split(k)))),
    random: scored.precision,
  };
  report.push({ backend: b.name, ms, cfg: b.cfg, proposals: proposals.length, scored, eligible, selected, selectedIntro, rankingPrecisionAtN: { N, ...rank } });
  console.error(`done ${b.name} in ${ms} ms`);
}

mkdirSync(`${POC_DIR}/out`, { recursive: true });
await Bun.write(`${POC_DIR}/out/e2e.json`, JSON.stringify({ latentPairs: latent, sameCityCandidatePairs: allPairs, baseRate: latent / allPairs, report }, null, 2));
const pct = (x: number) => (100 * x).toFixed(1);
console.log(`latent good pairs ${latent} of ${allPairs} same-city adult non-connected pairs (base rate ${pct(latent / allPairs)}%)\n`);
console.log("| Backend | Proposals | Scored pairs (good, recall, precision) | Eligible pairs (good, recall, precision) | Selected pairs (good, recall, precision) | Intro precision | Top-N precision: engine score / structured / oracle ceiling |");
console.log("|---|---:|---|---|---|---:|---|");
for (const r of report as any[]) {
  const f = (x: any) => `${x.n} (${x.g}, ${pct(x.recall)}%, ${pct(x.precision)}%)`;
  console.log(`| ${r.backend} | ${r.proposals} | ${f(r.scored)} | ${f(r.eligible)} | ${f(r.selected)} | ${pct(r.selectedIntro.precision)}% | ${pct(r.rankingPrecisionAtN.engineScore)}% / ${pct(r.rankingPrecisionAtN.structuredPublic)}% / ${pct(r.rankingPrecisionAtN.oracleSystematicCeiling)}% (N=${r.rankingPrecisionAtN.N}) |`);
}
