// Synthetic Clef fitting data from the slop world's hidden appearance (P2 sim check). Deterministic.
//
//   photos    one photo per real adult persona (no minors, no adversaries); its hidden truth is
//             `trueAppearance` (snapshot.ts) standardised over the population.
//   features  what Clef might answer: the zero-shot ratings (rate.face / body / overall) track the
//             truth with noise AND a photo-quality confound (better-lit photos rate higher); the
//             auxiliary answers carry partial signal (grooming ~ face, fitness ~ body, style ~ overall)
//             or none (expression, smile); body type is the persona's body type with 80% of the mass.
//             `clefBias` shifts the zero-shot ratings of the synthetic group B (demoGroupOf) down by
//             that many truth SDs: a biased model the audit should catch.
//   labels    Bradley-Terry on the truth: P(a wins) = sigmoid(k (t_a - t_b)), per rater sharpness k,
//             plus a lapse rate (a random click). Five careful raters (k 2, lapse 5%) and one careless
//             rater (lapse 60%, left-leaning) the agreement report should flag. 20% of pairs go to 3
//             raters (overlap for inter-rater reliability), 5% of a rater's pairs repeat with sides swapped.
//             `raterBias` lowers group B's truth by that many SDs in the raters' eyes.
//   split     25% of photos are held out entirely (never in a label); the ranking check is Kendall's tau
//             between the fitted, calibrated score and the hidden truth on those unseen photos.
import { CLEF_FEATURES, CLEF_QUESTIONS, applyHead, type ClefAnswer } from "@thenetwork/engine/src/packs/slop/clef.ts";
import type { ClefWeights } from "@thenetwork/engine/src/packs/slop/clefWeights.ts";
import { DEFAULT_CLEF_WEIGHTS } from "@thenetwork/engine/src/packs/slop/clefWeights.ts";
import { DIMS, fitClefWeights, kendallTau, type Dim, type FitReport, type LabelledPair } from "@thenetwork/engine/src/packs/slop/clef-fit/fit.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { BODY_TYPES } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { trueBodyType } from "./bodyType.ts";
import { isSafe } from "./oracle.ts";
import { generateSlopPersonas } from "./persona.ts";
import { demoGroupOf, trueAppearance } from "./snapshot.ts";

export interface SynthPhotos {
  rows: Map<string, Record<string, number>>;
  truth: Map<string, Record<Dim, number>>;
  group: Map<string, "A" | "B">;
  train: string[]; test: string[];
}
export interface SynthRater { id: string; k: number; lapse: number; left?: number }
export const SYNTH_RATERS: readonly SynthRater[] = [
  ...[1, 2, 3, 4, 5].map(i => ({ id: `rater-${i}`, k: 2, lapse: 0.05 })),
  { id: "rater-careless", k: 2, lapse: 0.6, left: 0.85 },
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sig = (z: number) => 1 / (1 + Math.exp(-z));

export function synthPhotos(o: { seed: number; perCity?: number; clefBias?: number; testShare?: number }): SynthPhotos {
  const ps = generateSlopPersonas({ seed: o.seed, perCity: o.perCity ?? 250, minorShare: 0 }).filter(p => isSafe(p) && !p.hidden.isMinor);
  const raw = ps.map(p => ({ id: `${p.id}/photo-1.jpg`, pid: p.id, t: trueAppearance(p) }));
  const z = (k: Dim) => { const v = raw.map(r => r.t[k]), m = v.reduce((s, x) => s + x, 0) / v.length, sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); return (x: number) => (x - m) / sd; };
  const zs = { face: z("face"), body: z("body"), overall: z("overall") };
  const rows = new Map<string, Record<string, number>>(), truth = new Map<string, Record<Dim, number>>(), group = new Map<string, "A" | "B">();
  const train: string[] = [], test: string[] = [];
  for (const r of raw) {
    const t = { face: zs.face(r.t.face), body: zs.body(r.t.body), overall: zs.overall(r.t.overall) };
    const g = demoGroupOf(r.pid);
    const rng = new Rng(hash32("clef-synth", o.seed, r.id));
    const shift = g === "B" ? -(o.clefBias ?? 0) : 0;
    const quality = clamp01(0.55 + rng.normal(0, 0.18));
    const qc = quality - 0.55;
    const x: Record<string, number> = {
      "gate.one_adult": clamp01(0.96 + rng.normal(0, 0.02)), "gate.face_visible": clamp01(0.9 + rng.normal(0, 0.06)), "gate.body_visible": clamp01(0.75 + rng.normal(0, 0.2)),
      "rate.face": clamp01(0.5 + 0.12 * (t.face + shift) + 0.35 * qc + rng.normal(0, 0.1)),
      "rate.body": clamp01(0.5 + 0.1 * (t.body + shift) + 0.35 * qc + rng.normal(0, 0.12)),
      "rate.overall": clamp01(0.5 + 0.12 * (t.overall + shift) + 0.4 * qc + rng.normal(0, 0.1)),
      "aux.photo_quality": clamp01(quality + rng.normal(0, 0.05)),
      "aux.grooming": clamp01(0.5 + 0.07 * t.face + rng.normal(0, 0.12)),
      "aux.fitness": clamp01(0.5 + 0.09 * t.body + rng.normal(0, 0.12)),
      "aux.style": clamp01(0.5 + 0.05 * t.overall + 0.15 * qc + rng.normal(0, 0.14)),
      "aux.expression": clamp01(0.5 + rng.normal(0, 0.15)),
      "aux.smile": clamp01(0.5 + rng.normal(0, 0.3)),
    };
    const bt = trueBodyType(r.pid);
    for (const k of [...BODY_TYPES, "unclear"]) x[`body.type=${k}`] = k === bt ? 0.8 : 0.2 / BODY_TYPES.length;
    for (const f of CLEF_FEATURES) x[f] = Number((x[f] ?? 0.5).toFixed(4));
    rows.set(r.id, x); truth.set(r.id, t); group.set(r.id, g);
    ((hash32("clef-synth-split", o.seed, r.id) % 1000) / 1000 < (o.testShare ?? 0.25) ? test : train).push(r.id);
  }
  return { rows, truth, group, train, test };
}

/** `n` label lines on one dimension among `photos`, from `raters` (overlap and repeats as above). */
export function synthLabels(s: SynthPhotos, o: { n: number; dim: Dim; seed: number; raters?: readonly SynthRater[]; raterBias?: number; overlap?: number; repeat?: number; photos?: readonly string[] }): LabelledPair[] {
  const raters = o.raters ?? SYNTH_RATERS, ids = o.photos ?? s.train, r = new Rng(hash32("clef-synth-labels", o.seed, o.dim));
  const t = (id: string) => s.truth.get(id)![o.dim] - (s.group.get(id) === "B" ? (o.raterBias ?? 0) : 0);
  const out: LabelledPair[] = [];
  const label = (a: string, b: string, rater: SynthRater, repeat = false) => {
    let winner: "a" | "b";
    if (r.next() < rater.lapse) winner = r.next() < (rater.left ?? 0.5) ? "a" : "b";
    else winner = r.next() < sig(rater.k * (t(a) - t(b))) ? "a" : "b";
    out.push({ a, b, winner, dim: o.dim, rater: rater.id, ...(repeat ? { repeat: true } : {}) });
  };
  const byRater = new Map<string, [string, string][]>();
  while (out.length < o.n) {
    const a = r.pick(ids), b = r.pick(ids);
    if (a === b) continue;
    const who = r.next() < (o.overlap ?? 0.2) ? r.sample([...raters], Math.min(3, raters.length)) : [r.pick([...raters])];
    for (const rt of who) {
      if (out.length >= o.n) break;
      const [x, y] = r.next() < 0.5 ? [a, b] : [b, a];
      label(x, y, rt);
      const seen = byRater.get(rt.id) ?? [];
      seen.push([x, y]); byRater.set(rt.id, seen);
      if (out.length < o.n && r.next() < (o.repeat ?? 0.05)) { const [p, q] = r.pick(seen); label(q, p, rt, true); }
    }
  }
  return out;
}

/** Clef answers that `clefFeatures` maps back to the row (for a fake Workers AI fetch). */
export function synthAnswers(x: Record<string, number>): Record<string, ClefAnswer> {
  const out: Record<string, ClefAnswer> = {};
  for (const [id, q] of Object.entries(CLEF_QUESTIONS)) {
    if (q.type === "noul") out[id] = { type: "noul", noul: x[id] ?? 0.5 };
    else if (q.type === "score") out[id] = { type: "score", score: (x[id] ?? 0.5) * (q.criteria.length - 1), confidence: 0.8 };
    else out[id] = { type: "choice", probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, x[`${id}=${k}`] ?? 0])) };
  }
  return out;
}

/** Kendall's tau of calibrated head scores vs the hidden truth on the held-out photos. */
export function tauOnTest(s: SynthPhotos, w: ClefWeights, dim: Dim): number {
  const score = new Map(s.test.map(id => [id, applyHead(w, s.rows.get(id)!)[dim]]));
  const truth = new Map(s.test.map(id => [id, s.truth.get(id)![dim]]));
  return kendallTau(score, truth);
}

export interface SynthFit { weights: ClefWeights; report: FitReport; tau: Record<Dim, number>; placeholderTau: Record<Dim, number> }
/** Fit all three dimensions on `n` labels each and measure ranking recovery on unseen photos. */
export function synthFit(s: SynthPhotos, o: { n: number; seed: number; raterBias?: number; raters?: readonly SynthRater[] }): SynthFit {
  const labels = DIMS.flatMap(dim => synthLabels(s, { n: o.n, dim, seed: o.seed, raterBias: o.raterBias, raters: o.raters }));
  const { weights, report } = fitClefWeights(s.rows, labels, { version: `synth-${o.seed}-${o.n}`, fittedAt: "2026-10-09", seed: o.seed, population: s.train.map(id => s.rows.get(id)!), provenance: { calibratedOn: "synthetic train photos" } });
  const tau = Object.fromEntries(DIMS.map(d => [d, tauOnTest(s, weights, d)])) as Record<Dim, number>;
  const placeholderTau = Object.fromEntries(DIMS.map(d => [d, tauOnTest(s, DEFAULT_CLEF_WEIGHTS, d)])) as Record<Dim, number>;
  return { weights, report, tau, placeholderTau };
}

export interface CurvePoint { n: number; tau: number; tauSe: number; heldOutAccuracy: number; ece: number; alpha: number | null; careless: boolean }
/** Label count vs ranking recovery and held-out accuracy (overall), mean over seeds. */
export function labelCurve(o: { seeds: readonly number[]; counts: readonly number[]; perCity?: number; dim?: Dim }): { points: CurvePoint[]; placeholderTau: number; ceilingTau: number } {
  const dim = o.dim ?? "overall";
  const points: CurvePoint[] = [];
  const photos = o.seeds.map(seed => synthPhotos({ seed, perCity: o.perCity }));
  const placeholderTau = photos.reduce((t, s) => t + tauOnTest(s, DEFAULT_CLEF_WEIGHTS, dim), 0) / photos.length;
  // Ceiling: noiseless labels (k = 50, no lapse, one rater), 20k pairs: the best this feature set can rank.
  const ceilingTau = photos.reduce((t, s, i) => {
    const labels = synthLabels(s, { n: 20_000, dim, seed: o.seeds[i]!, raters: [{ id: "oracle", k: 50, lapse: 0 }], overlap: 0, repeat: 0 });
    const { weights } = fitClefWeights(s.rows, labels, { version: "ceiling", fittedAt: "2026-10-09", l2: 0.0003, population: s.train.map(id => s.rows.get(id)!) });
    return t + tauOnTest(s, weights, dim);
  }, 0) / photos.length;
  for (const n of o.counts) {
    const taus: number[] = [], acc: number[] = [], ece: number[] = [], alphas: number[] = [];
    let careless = true;
    photos.forEach((s, i) => {
      const labels = synthLabels(s, { n, dim, seed: o.seeds[i]! });
      const { weights, report } = fitClefWeights(s.rows, labels, { version: "curve", fittedAt: "2026-10-09", seed: o.seeds[i]!, minPairs: 20, population: s.train.map(id => s.rows.get(id)!) });
      taus.push(tauOnTest(s, weights, dim));
      const h = report.dims[dim].heldOut;
      if (h) { acc.push(h.accuracy); ece.push(h.ece); }
      const a = report.agreement.alpha[dim].alpha;
      if (a !== null) alphas.push(a);
      careless &&= !!report.agreement.raters.find(r => r.rater === "rater-careless")?.flags.length;
    });
    const m = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
    const sd = Math.sqrt(taus.reduce((s, x) => s + (x - m(taus)) ** 2, 0) / Math.max(1, taus.length - 1));
    points.push({ n, tau: m(taus), tauSe: sd / Math.sqrt(taus.length), heldOutAccuracy: m(acc), ece: m(ece), alpha: alphas.length ? m(alphas) : null, careless });
  }
  return { points, placeholderTau, ceilingTau };
}
