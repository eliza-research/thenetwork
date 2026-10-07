/**
 * Dedupe study over data/events.json (written by ingest.ts).
 *  - exact id merge within a source (CV llms-full + CV city page list the same events)
 *  - candidate pairs (city+date blocks), fuzzy scores, link-based ground truth
 *  - writes data/dedupe-sample.json (≈30 stratified pairs) for hand labelling;
 *    if fixtures/dedupe-labels.json exists, reports precision/recall on it.
 */
import { existsSync, readFileSync } from "node:fs";
import { candidatePairs, cluster, DEFAULT_THRESHOLD, mergeClusters, scorePair, linkMatch } from "../src/dedupe";
import type { NormalizedEvent } from "../src/types";

const d = JSON.parse(readFileSync("data/events.json", "utf8"));
const includeRestricted = process.env.WITH_RESTRICTED !== "0";
const raw: NormalizedEvent[] = [...d.events, ...(includeRestricted ? d.restricted : [])];

// 1. exact id merge within source (prefer the row with a time)
const byId = new Map<string, NormalizedEvent>();
for (const e of raw) {
  const prev = byId.get(e.id);
  if (!prev || (!prev.hasTime && e.hasTime)) byId.set(e.id, prev && !e.hasTime ? prev : { ...e, altUrls: [...new Set([...(prev?.altUrls ?? []), ...e.altUrls])] });
}
const events = [...byId.values()];
console.log(`rows ${raw.length} -> ${events.length} after exact same-source id merge`);

// 2. candidate pairs
const pairs = candidatePairs(events, 0.3);
const ev = new Map(events.map((e) => [e.id, e]));
const linkPairs = pairs.filter((p) => p.link);
console.log(`candidate pairs (score>=0.30 or link): ${pairs.length}; link-confirmed: ${linkPairs.length}; >= threshold ${DEFAULT_THRESHOLD}: ${pairs.filter((p) => p.score >= DEFAULT_THRESHOLD).length}`);

// 3. fuzzy-only recall on link-confirmed cross-platform pairs (ignore same-platform Luma id pairs, trivially identical)
const xLink = linkPairs.filter((p) => !(ev.get(p.a)!.source.startsWith("luma") && ev.get(p.b)!.source.startsWith("luma")));
const fuzzyOnly = (p: { a: string; b: string }) => {
  const a = { ...ev.get(p.a)!, url: "x:" + p.a, altUrls: [] }, b = { ...ev.get(p.b)!, url: "y:" + p.b, altUrls: [] };
  return scorePair(a, b).score;
};
const xHit = xLink.filter((p) => fuzzyOnly(p) >= DEFAULT_THRESHOLD).length;
console.log(`link-confirmed cross-platform pairs: ${xLink.length}; fuzzy-only matcher recovers ${xHit} (recall ${(xHit / Math.max(1, xLink.length)).toFixed(2)})`);
const missed = xLink.filter((p) => fuzzyOnly(p) < DEFAULT_THRESHOLD).slice(0, 8);
for (const p of missed) console.log(`  missed ${fuzzyOnly(p).toFixed(2)} | ${ev.get(p.a)!.title} || ${ev.get(p.b)!.title}`);

// 4. clusters + per-city counts
const cl = cluster(events, pairs, DEFAULT_THRESHOLD);
const merged = mergeClusters(events, cl);
const per: Record<string, { rows: number; unique: number; uniqueGreen: number; multiSource: number }> = {};
for (const c of ["sf", "nyc"]) {
  const rows = events.filter((e) => e.city === c);
  const uniq = merged.filter((m) => m.city === c);
  per[c] = {
    rows: rows.length,
    unique: uniq.length,
    uniqueGreen: merged.filter((m) => m.city === c && events.some((e) => cl.get(e.id) === cl.get(m.id) && e.tos === "green")).length,
    multiSource: uniq.filter((m) => m.sources.length > 1).length,
  };
}
console.table(per);
await Bun.write("data/events-deduped.json", JSON.stringify(merged, null, 1));

// 5. stratified sample of ~30 candidate pairs for hand-check (deterministic)
const labelled = new Set<string>(existsSync("fixtures/dedupe-labels.json") ? JSON.parse(readFileSync("fixtures/dedupe-labels.json", "utf8")).map((l: any) => l.key) : []);
const nonTrivial = pairs.filter((p) => !labelled.has(`${p.a}||${p.b}`) && !(p.link && ev.get(p.a)!.source.startsWith("luma") && ev.get(p.b)!.source.startsWith("luma")));
const bands: [number, number, number][] = [[0.8, 1.01, 10], [0.62, 0.8, 10], [0.45, 0.62, 6], [0.3, 0.45, 4]];
const sample: any[] = [];
for (const [lo, hi, n] of bands) {
  const inBand = nonTrivial.filter((p) => p.score >= lo && p.score < hi);
  const step = Math.max(1, Math.floor(inBand.length / n));
  for (let i = 0; i < inBand.length && sample.filter((s) => s.band === `${lo}-${hi}`).length < n; i += step) {
    const p = inBand[i];
    const A = ev.get(p.a)!, B = ev.get(p.b)!;
    const fmt = (e: NormalizedEvent) => ({ id: e.id, title: e.title, start: e.startsAt ?? e.startDate, venue: e.venueName, address: e.address, latlng: e.lat != null ? [+e.lat.toFixed(4), +e.lng!.toFixed(4)] : null, url: e.url });
    sample.push({ key: `${p.a}||${p.b}`, band: `${lo}-${hi}`, score: +p.score.toFixed(3), title: +p.title.toFixed(2), time: p.time, venue: p.venue, link: p.link, a: fmt(A), b: fmt(B) });
  }
}
await Bun.write("data/dedupe-sample.json", JSON.stringify(sample, null, 1));
console.log(`wrote ${sample.length} sample pairs to data/dedupe-sample.json`);

// 6. score against hand labels if present
if (existsSync("fixtures/dedupe-labels.json")) {
  const labels: { key: string; dup: boolean; why: string }[] = JSON.parse(readFileSync("fixtures/dedupe-labels.json", "utf8"));
  const scoreOf = new Map(pairs.map((p) => [`${p.a}||${p.b}`, p.score]));
  for (const round of [...new Set(labels.map((l: any) => l.round))].concat(["all"])) {
  let tp = 0, fp = 0, fn = 0, tn = 0, missing = 0;
  for (const l of labels.filter((x: any) => round === "all" || x.round === round)) {
    let s = scoreOf.get(l.key);
    if (s === undefined) { missing++; s = 0; } // fell below the 0.30 candidate floor => predicted non-duplicate
    const pred = s >= DEFAULT_THRESHOLD;
    if (pred && l.dup) tp++; else if (pred && !l.dup) fp++; else if (!pred && l.dup) fn++; else tn++;
  }
  console.log(`hand-labelled round ${round}: n=${tp + fp + fn + tn} tp=${tp} fp=${fp} fn=${fn} tn=${tn} precision=${(tp / Math.max(1, tp + fp)).toFixed(3)} recall=${(tp / Math.max(1, tp + fn)).toFixed(3)} (below-floor ${missing})`);
  }
}
