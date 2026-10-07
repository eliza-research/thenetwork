// Pure metric functions (unit-tested offline).

export interface Confusion { tp: number; fp: number; tn: number; fn: number }

export function confusion(pred: boolean[], gold: boolean[]): Confusion {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  pred.forEach((p, i) => {
    const g = gold[i]!;
    if (p && g) c.tp++; else if (p && !g) c.fp++; else if (!p && !g) c.tn++; else c.fn++;
  });
  return c;
}

export function classification(pred: boolean[], gold: boolean[]) {
  const c = confusion(pred, gold);
  const n = c.tp + c.fp + c.tn + c.fn;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { ...c, n, accuracy: n ? (c.tp + c.tn) / n : 0, precision, recall, f1 };
}

/** ROC AUC via the Mann-Whitney U statistic (ties count 0.5). NaN if one class is empty. */
export function auc(scores: number[], gold: boolean[]): number {
  const pos = scores.filter((_, i) => gold[i]), neg = scores.filter((_, i) => !gold[i]);
  if (!pos.length || !neg.length) return NaN;
  // Rank-based O(n log n).
  const all = scores.map((s, i) => ({ s, g: gold[i]! })).sort((a, b) => a.s - b.s);
  let rankSumPos = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j < all.length && all[j]!.s === all[i]!.s) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k]!.g) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/** Mean squared error of probabilities against 0/1 outcomes. */
export function brier(probs: number[], outcomes: boolean[]): number {
  if (!probs.length) return NaN;
  return probs.reduce((s, p, i) => s + (p - (outcomes[i] ? 1 : 0)) ** 2, 0) / probs.length;
}

export function mae(a: number[], b: number[]): number {
  if (!a.length) return NaN;
  return a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0) / a.length;
}

/** Cohen's kappa for two binary raters. */
export function cohensKappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (!n) return NaN;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(Boolean).length / n, pb = b.filter(Boolean).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
}

/** Nearest-rank percentile (p in [0,100]). */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

/** Wilson score interval for a proportion (95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [NaN, NaN];
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

/**
 * Exact two-sided McNemar test p-value on discordant counts (b: A right/B wrong, c: A wrong/B right):
 * p = min(1, 2 * P(X <= min(b, c))), X ~ Binomial(b + c, 1/2). Computed in log space so it stays
 * finite for any n (the naive C(n,k) / 2^n overflows past n ~ 1000).
 */
export function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  // log C(n, i) - n log 2, accumulated with log-sum-exp.
  let logCoef = 0, maxLog = -Infinity;
  const logs: number[] = [];
  for (let i = 0; i <= k; i++) {
    if (i > 0) logCoef += Math.log(n - i + 1) - Math.log(i);
    const l = logCoef - n * Math.LN2;
    logs.push(l);
    if (l > maxLog) maxLog = l;
  }
  const tail = Math.exp(maxLog) * logs.reduce((s, l) => s + Math.exp(l - maxLog), 0);
  return Math.min(1, 2 * tail);
}

/** Reliability bins (equal-width on [0,1]): mean predicted probability vs observed rate per bin. */
export function reliability(probs: number[], outcomes: boolean[], bins = 10): { lo: number; hi: number; n: number; meanP: number; rate: number }[] {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, pos: 0 }));
  probs.forEach((p, i) => {
    const b = out[Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))]!;
    b.n++; b.sumP += p; if (outcomes[i]) b.pos++;
  });
  return out.map(b => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? b.sumP / b.n : NaN, rate: b.n ? b.pos / b.n : NaN }));
}

/** Expected calibration error: sum over bins of (n_bin / n) * |mean predicted - observed rate|. */
export function ece(probs: number[], outcomes: boolean[], bins = 10): number {
  if (!probs.length) return NaN;
  return reliability(probs, outcomes, bins).reduce((s, b) => s + (b.n ? (b.n / probs.length) * Math.abs(b.meanP - b.rate) : 0), 0);
}

/** A three-way decision: propose, reject, or abstain ("insufficient information"). null = call failed. */
export type Decision3 = "yes" | "no" | "abstain";

export interface AbstentionMetrics {
  n: number; failures: number; abstentions: number;
  /** Share of items with an answer (not abstained, not failed). */
  coverage: number;
  /** Abstentions / items (the "insufficient info" rate). */
  abstainRate: number;
  /** Abstention rate among gold-good and gold-bad items (is abstaining informative?). */
  abstainRateOnGood: number; abstainRateOnBad: number;
  /** Abstain counts as "no"; failures count as wrong (flip of gold). */
  asNo: { accuracy: number; precision: number; recall: number; f1: number; tp: number; fp: number; tn: number; fn: number };
  /** Answered items only (selective prediction). Recall here is over answered gold-positives. */
  selective: { n: number; accuracy: number; precision: number; recall: number; f1: number };
  /**
   * Coverage-adjusted precision: precision is unchanged by "abstain = no" (abstentions are never
   * positive predictions), so it is reported together with the share of gold-positives that got a
   * committed "yes" (recall over ALL positives) and with precision x coverage, which penalises a
   * system that buys precision by abstaining on everything hard.
   */
  coverageAdjustedPrecision: number;
}

export function abstentionMetrics(pred: (Decision3 | null)[], gold: boolean[]): AbstentionMetrics {
  const n = pred.length;
  const failures = pred.filter(p => p === null).length;
  const abst = pred.filter(p => p === "abstain").length;
  const asNoPred = pred.map((p, i) => (p === null ? !gold[i] : p === "yes"));
  const asNo = classification(asNoPred, gold);
  const ans = pred.map((p, i) => i).filter(i => pred[i] === "yes" || pred[i] === "no");
  const sel = classification(ans.map(i => pred[i] === "yes"), ans.map(i => gold[i]!));
  const goodIdx = gold.map((g, i) => i).filter(i => gold[i]), badIdx = gold.map((g, i) => i).filter(i => !gold[i]);
  const coverage = n ? ans.length / n : NaN;
  return {
    n, failures, abstentions: abst, coverage, abstainRate: n ? abst / n : NaN,
    abstainRateOnGood: goodIdx.length ? goodIdx.filter(i => pred[i] === "abstain").length / goodIdx.length : NaN,
    abstainRateOnBad: badIdx.length ? badIdx.filter(i => pred[i] === "abstain").length / badIdx.length : NaN,
    asNo: { accuracy: asNo.accuracy, precision: asNo.precision, recall: asNo.recall, f1: asNo.f1, tp: asNo.tp, fp: asNo.fp, tn: asNo.tn, fn: asNo.fn },
    selective: { n: ans.length, accuracy: sel.accuracy, precision: sel.precision, recall: sel.recall, f1: sel.f1 },
    coverageAdjustedPrecision: asNo.precision * coverage,
  };
}

/** Deterministic PRNG (mulberry32) for bootstraps. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paired bootstrap of a statistic difference over items: resample item indices with replacement,
 * compute stat(A) - stat(B) on the same sample. Returns the observed difference, a 95% percentile
 * interval, and a two-sided p-value (share of resamples on the other side of 0, doubled).
 */
export function pairedBootstrap(n: number, statA: (idx: number[]) => number, statB: (idx: number[]) => number, B = 2000, seed = 7):
  { diff: number; lo: number; hi: number; p: number } {
  const all = Array.from({ length: n }, (_, i) => i);
  const diff = statA(all) - statB(all);
  const rnd = mulberry32(seed);
  const ds: number[] = [];
  for (let b = 0; b < B; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    const d = statA(idx) - statB(idx);
    if (Number.isFinite(d)) ds.push(d);
  }
  ds.sort((x, y) => x - y);
  const q = (p: number) => ds[Math.min(ds.length - 1, Math.max(0, Math.floor(p * ds.length)))]!;
  const below = ds.filter(d => d <= 0).length / ds.length, above = ds.filter(d => d >= 0).length / ds.length;
  return { diff, lo: q(0.025), hi: q(0.975), p: Math.min(1, 2 * Math.min(below, above)) };
}

/** Precision of yes-predictions over a subset of item indices (0 when there are no yes-predictions). */
export function precisionOn(idx: number[], pred: boolean[], gold: boolean[]): number {
  let tp = 0, fp = 0;
  for (const i of idx) if (pred[i]) { if (gold[i]) tp++; else fp++; }
  return tp + fp ? tp / (tp + fp) : 0;
}
export function f1On(idx: number[], pred: boolean[], gold: boolean[]): number {
  let tp = 0, fp = 0, fn = 0;
  for (const i of idx) { if (pred[i] && gold[i]) tp++; else if (pred[i]) fp++; else if (gold[i]) fn++; }
  return tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
}

/** Soft-label scores: Brier and log-loss of predicted probabilities against target probabilities. */
export function brierSoft(probs: number[], targets: number[]): number {
  if (!probs.length) return NaN;
  return probs.reduce((s, p, i) => s + (p - targets[i]!) ** 2, 0) / probs.length;
}
/** Cross-entropy of predictions q against soft targets p (q clipped to [0.01, 0.99]). */
export function logLossSoft(probs: number[], targets: number[]): number {
  if (!probs.length) return NaN;
  return probs.reduce((s, q0, i) => {
    const q = Math.min(0.99, Math.max(0.01, q0)), p = targets[i]!;
    return s - (p * Math.log(q) + (1 - p) * Math.log(1 - q));
  }, 0) / probs.length;
}
/** ECE against soft targets: per equal-width bin of the prediction, |mean prediction - mean target|, weighted by bin size. */
export function eceSoft(probs: number[], targets: number[], bins = 10): number {
  if (!probs.length) return NaN;
  const b = Array.from({ length: bins }, () => ({ n: 0, p: 0, t: 0 }));
  probs.forEach((q, i) => { const x = b[Math.min(bins - 1, Math.max(0, Math.floor(q * bins)))]!; x.n++; x.p += q; x.t += targets[i]!; });
  return b.reduce((s, x) => s + (x.n ? (x.n / probs.length) * Math.abs(x.p / x.n - x.t / x.n) : 0), 0);
}
