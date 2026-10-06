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
