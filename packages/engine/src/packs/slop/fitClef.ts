// Fitting and calibrating the Clef decision model (clefWeights.ts) from labelled data. Pure, offline.
//
//   fitPairwise    Bradley-Terry / logistic regression on feature DIFFERENCES: for a labelled pair
//                  "a looks more attractive than b on dimension d", P(a > b) = sigmoid(w_d . (x_a - x_b)).
//                  L2-regularised, full-batch gradient descent (deterministic). The bias cancels in a
//                  difference, so the head's b is 0 and calibration sets the scale.
//   calibrate      mean and SD of the raw head output over a population of feature rows, so the
//                  calibrated score is a z-score on OUR members (0 = typical member here).
//
// Labels should come from several raters per pair, consented, and audited for group bias before use
// (docs/results/2026-10-08-slop-pack.md, iteration 4). Features: one row per member (the mean of
// their photos' rows) or per photo, from WorkersAIClefRater.features().
import { CLEF_FEATURES } from "./clef.ts";
import { validateClefWeights, type ClefHead, type ClefWeights } from "./clefWeights.ts";

export type Dim = "face" | "body" | "overall";
export interface LabelledPair { a: string; b: string; dim: Dim; /** "a" when a was preferred. */ winner: "a" | "b" }
export interface FitOptions { l2?: number; lr?: number; iters?: number; features?: readonly string[] }

const sig = (z: number) => 1 / (1 + Math.exp(-z));

/** Fit one head from pairs on one dimension. Returns the head and the training log-loss / accuracy. */
export function fitPairwise(rows: ReadonlyMap<string, Record<string, number>>, pairs: readonly LabelledPair[], dim: Dim, o: FitOptions = {}): { head: ClefHead; loss: number; accuracy: number; n: number } {
  const F = [...(o.features ?? CLEF_FEATURES)].filter(f => !f.startsWith("gate."));
  const data: { d: number[]; y: number }[] = [];
  for (const p of pairs) {
    if (p.dim !== dim) continue;
    const xa = rows.get(p.a), xb = rows.get(p.b);
    if (!xa || !xb) continue;
    data.push({ d: F.map(f => (xa[f] ?? 0) - (xb[f] ?? 0)), y: p.winner === "a" ? 1 : 0 });
  }
  const w = new Array(F.length).fill(0) as number[];
  const l2 = o.l2 ?? 0.01, lr = o.lr ?? 0.5, iters = o.iters ?? 2000, n = data.length;
  if (!n) throw new Error(`fitPairwise: no usable pairs for ${dim}`);
  for (let it = 0; it < iters; it++) {
    const g = w.map(x => l2 * x);
    for (const { d, y } of data) { const p = sig(d.reduce((s, x, i) => s + x * w[i]!, 0)); for (let i = 0; i < d.length; i++) g[i]! += ((p - y) * d[i]!) / n; }
    for (let i = 0; i < w.length; i++) w[i]! -= lr * g[i]!;
  }
  let loss = 0, right = 0;
  for (const { d, y } of data) { const p = sig(d.reduce((s, x, i) => s + x * w[i]!, 0)); loss -= y ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12)); if ((p >= 0.5) === (y === 1)) right++; }
  const head: ClefHead = { w: Object.fromEntries(F.map((f, i) => [f, Number(w[i]!.toFixed(6))]).filter(([, x]) => x !== 0)), b: 0 };
  return { head, loss: loss / n, accuracy: right / n, n };
}

/** Recalibrate weights on a population of feature rows: mean and SD of each head's raw output. */
export function calibrateClefWeights(w: ClefWeights, population: Iterable<Record<string, number>>): ClefWeights {
  const xs = [...population];
  if (xs.length < 2) throw new Error("calibrate: need at least 2 rows");
  const raw = (h: ClefHead, x: Record<string, number>) => Object.entries(h.w).reduce((s, [f, k]) => s + k * (x[f] ?? 0), h.b);
  const cal = (d: Dim) => {
    const v = xs.map(x => raw(w.heads[d], x));
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) || 1;
    return { mean, sd };
  };
  return validateClefWeights({ ...w, calibration: { face: cal("face"), body: cal("body"), overall: cal("overall") } });
}

/** Fit all three heads and calibrate on the rows: a complete weights file. */
export function fitClefWeights(rows: ReadonlyMap<string, Record<string, number>>, pairs: readonly LabelledPair[], o: FitOptions & { version: string; notes: string; base?: ClefWeights }): { weights: ClefWeights; report: Record<Dim, { loss: number; accuracy: number; n: number }> } {
  const base = o.base;
  const fit = (d: Dim) => fitPairwise(rows, pairs, d, o);
  const f = fit("face"), b = fit("body"), ov = fit("overall");
  const weights = calibrateClefWeights({
    version: o.version, placeholder: false, notes: o.notes,
    heads: { face: f.head, body: b.head, overall: ov.head },
    calibration: { face: { mean: 0, sd: 1 }, body: { mean: 0, sd: 1 }, overall: { mean: 0, sd: 1 } },
    gate: base?.gate ?? { oneAdult: 0.5 }, bodyType: base?.bodyType ?? { minProb: 0.45 }, confidence: base?.confidence ?? { scale: 1, singlePhotoSpread: 0.6 },
  }, rows.values());
  return { weights, report: { face: { loss: f.loss, accuracy: f.accuracy, n: f.n }, body: { loss: b.loss, accuracy: b.accuracy, n: b.n }, overall: { loss: ov.loss, accuracy: ov.accuracy, n: ov.n } } };
}
