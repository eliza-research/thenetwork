// Fitting the Clef decision model (clefWeights.ts) from labelled photo pairs. Pure and offline: no
// file system, no network, no clock (the CLI, scripts/clef-fit.ts, passes the date and file hashes).
//
//   model      Bradley-Terry / pairwise logistic regression per dimension (face, body, overall):
//              P(a beats b on d) = sigmoid(w_d . (x_a - x_b)), x = a photo's Clef feature row (clef.ts).
//              The bias cancels in a difference, so the head's b is 0; `calibrateClefWeights` sets the
//              scale so the head reads as a z-score on the population it is calibrated on.
//   objective  mean log-loss + (l2 / 2) |w|^2, solved by Newton's method (18 features: exact and
//              deterministic). `l2: "auto"` picks l2 from a grid by 4-fold cross-validation on the
//              training split (folds by unordered pair, so repeat labels of one pair never straddle).
//   split      held-out share of labels, by unordered pair ("pair", default) or by photo ("photo": a
//              label is test when both photos are test photos, train when both are train, else dropped).
//   report     held-out pairwise accuracy, log-loss, Brier, calibration (reliability bins on the
//              predicted favourite and the expected calibration error), and per-rater agreement:
//              with the model on held-out labels, with the other raters (leave-one-out majority), with
//              themselves on repeated pairs, and the left-click share; Krippendorff's alpha per dimension.
//
// Body-type one-hot features are excluded from the heads by default: body type is a separate
// categorical matching attribute, and letting the attractiveness head learn a body-type penalty would
// bake a body-size preference of the raters into every score (iteration 4, I4.5). Gate features are
// never used (they decide whether a photo is rated at all).
import { CLEF_FEATURES } from "../clef.ts";
import { DEFAULT_CLEF_WEIGHTS, validateClefWeights, type ClefHead, type ClefProvenance, type ClefWeights } from "../clefWeights.ts";
import { hash32 } from "@thenetwork/core";

export type Dim = "face" | "body" | "overall";
export const DIMS: readonly Dim[] = ["face", "body", "overall"];
export const FITTER_VERSION = "clef-fit-1";

/** One label: which of two photos is more attractive on one dimension (default overall), by one rater. */
export interface LabelledPair { a: string; b: string; winner: "a" | "b"; dim?: Dim; rater?: string; repeat?: boolean }
/** A rater's flag on a photo (not one adult, may be under 18, not consented...). Flagged photos are dropped. */
export interface PhotoFlag { flag: string; reason?: string; rater?: string }
export type FeatureRows = ReadonlyMap<string, Record<string, number>>;

const sig = (z: number) => 1 / (1 + Math.exp(-z));
const isDim = (x: unknown): x is Dim => x === "face" || x === "body" || x === "overall";

/**
 * Parse one JSONL record from the labelling tool (or any compatible source). Accepts
 * {a, b, winner: "a"|"b"|<photo id>, dim?, rater?} and {flag: <photo id>, reason?, rater?}; skips
 * ("can't tell") and malformed lines return null.
 */
export function parseLabel(o: unknown): LabelledPair | PhotoFlag | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.flag === "string") return { flag: r.flag, ...(typeof r.reason === "string" ? { reason: r.reason } : {}), ...(typeof r.rater === "string" ? { rater: r.rater } : {}) };
  const a = r.a, b = r.b;
  if (typeof a !== "string" || typeof b !== "string" || !a || !b || a === b || r.skip) return null;
  const w = r.winner ?? r.choice;
  const winner = w === "a" || w === a ? "a" : w === "b" || w === b ? "b" : null;
  if (!winner) return null;
  const dim = r.dim === undefined || r.dim === null || r.dim === "" ? undefined : r.dim;
  if (dim !== undefined && !isDim(dim)) return null;
  return { a, b, winner, ...(dim ? { dim } : {}), ...(typeof r.rater === "string" && r.rater ? { rater: r.rater } : {}), ...(r.repeat ? { repeat: true } : {}) };
}

/** The features a head uses: every non-gate feature, minus body-type one-hots unless asked. */
export function headFeatures(o: { includeBodyType?: boolean; features?: readonly string[] } = {}): string[] {
  return [...(o.features ?? CLEF_FEATURES)].filter(f => !f.startsWith("gate.") && (o.includeBodyType || !f.startsWith("body.type=")));
}

export const pairKey = (p: { a: string; b: string }) => (p.a < p.b ? `${p.a}\u0000${p.b}` : `${p.b}\u0000${p.a}`);
const u01 = (...parts: (string | number)[]) => (hash32(...parts) % 1_000_000) / 1_000_000;
/** 1 when the lexically first photo of the pair won (the orientation used for agreement statistics). */
const firstWon = (p: LabelledPair) => ((p.winner === "a") === (p.a < p.b) ? 1 : 0);
const dimOf = (p: LabelledPair): Dim => p.dim ?? "overall";

// ---- the head: Newton's method on the L2-regularised pairwise logistic loss ---------------------------

interface Design { d: Float64Array[]; y: Uint8Array }
function design(rows: FeatureRows, pairs: readonly LabelledPair[], F: readonly string[]): Design {
  const d: Float64Array[] = [], y: number[] = [];
  for (const p of pairs) {
    const xa = rows.get(p.a), xb = rows.get(p.b);
    if (!xa || !xb) continue;
    d.push(Float64Array.from(F, f => (xa[f] ?? 0) - (xb[f] ?? 0)));
    y.push(p.winner === "a" ? 1 : 0);
  }
  return { d, y: Uint8Array.from(y) };
}

/** Solve A x = g for a symmetric positive-definite A (Cholesky). */
function cholSolve(A: number[][], g: number[]): number[] {
  const n = g.length, L = A.map(() => new Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i]![j]!;
    for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
    L[i]![j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j]![j]!;
  }
  const z = new Array(n).fill(0) as number[];
  for (let i = 0; i < n; i++) { let s = g[i]!; for (let k = 0; k < i; k++) s -= L[i]![k]! * z[k]!; z[i] = s / L[i]![i]!; }
  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) { let s = z[i]!; for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!; x[i] = s / L[i]![i]!; }
  return x;
}

function newton(D: Design, k: number, l2: number, iters = 50): number[] {
  const w = new Array(k).fill(0) as number[], n = D.d.length;
  if (!n) return w;
  for (let it = 0; it < iters; it++) {
    const g = w.map(x => l2 * x);
    const H = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? l2 + 1e-9 : 0)));
    for (let r = 0; r < n; r++) {
      const d = D.d[r]!;
      let z = 0;
      for (let i = 0; i < k; i++) z += d[i]! * w[i]!;
      const p = sig(z), e = (p - D.y[r]!) / n, h = (p * (1 - p)) / n;
      for (let i = 0; i < k; i++) { g[i]! += e * d[i]!; const hi = h * d[i]!; if (hi) for (let j = 0; j <= i; j++) H[i]![j]! += hi * d[j]!; }
    }
    for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) H[j]![i] = H[i]![j]!;
    const step = cholSolve(H, g);
    let mx = 0;
    for (let i = 0; i < k; i++) { w[i]! -= step[i]!; mx = Math.max(mx, Math.abs(step[i]!)); }
    if (mx < 1e-10) break;
  }
  return w;
}

export interface PairEval {
  n: number; accuracy: number; logLoss: number; brier: number;
  /** Expected calibration error over the reliability bins (weighted |predicted - observed|). */
  ece: number;
  /** Reliability bins on P(predicted favourite wins), 0.5-1 in steps of 0.1. */
  bins: { lo: number; hi: number; n: number; predicted: number; observed: number }[];
}

/** Evaluate a head on labelled pairs (pairs whose photos have no feature row are skipped). */
export function evalHead(head: ClefHead, rows: FeatureRows, pairs: readonly LabelledPair[]): PairEval {
  const bins = [0.5, 0.6, 0.7, 0.8, 0.9].map(lo => ({ lo, hi: lo + 0.1, n: 0, predicted: 0, observed: 0 }));
  let n = 0, right = 0, ll = 0, br = 0;
  for (const p of pairs) {
    const xa = rows.get(p.a), xb = rows.get(p.b);
    if (!xa || !xb) continue;
    let z = 0;
    for (const [f, k] of Object.entries(head.w)) z += k * ((xa[f] ?? 0) - (xb[f] ?? 0));
    const pa = sig(z), y = p.winner === "a" ? 1 : 0, pf = Math.max(pa, 1 - pa), favWon = (pa >= 0.5) === (y === 1) ? 1 : 0;
    n++; right += favWon; ll -= Math.log(Math.max(1e-12, y ? pa : 1 - pa)); br += (pa - y) ** 2;
    const bin = bins[Math.min(4, Math.floor((pf - 0.5) * 10))]!;
    bin.n++; bin.predicted += pf; bin.observed += favWon;
  }
  for (const b of bins) if (b.n) { b.predicted /= b.n; b.observed /= b.n; }
  const ece = n ? bins.reduce((s, b) => s + (b.n / n) * Math.abs(b.predicted - b.observed), 0) : 0;
  return { n, accuracy: n ? right / n : 0, logLoss: n ? ll / n : 0, brier: n ? br / n : 0, ece, bins };
}

export const L2_GRID = [0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3] as const;

/** Fit one head on pairs (one dimension's labels). `l2: "auto"` = 4-fold CV over L2_GRID. */
export function fitHead(rows: FeatureRows, pairs: readonly LabelledPair[], o: { l2?: number | "auto"; features?: readonly string[]; seed?: number } = {}): { head: ClefHead; l2: number; cv?: { l2: number; logLoss: number }[] } {
  const F = o.features ?? headFeatures();
  let l2 = typeof o.l2 === "number" ? o.l2 : 0.01, cv: { l2: number; logLoss: number }[] | undefined;
  if (o.l2 === "auto" && pairs.length >= 40) {
    const fold = (p: LabelledPair) => hash32("clef-cv", o.seed ?? 1, pairKey(p)) % 4;
    cv = L2_GRID.map(lam => {
      let ll = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const tr = pairs.filter(p => fold(p) !== k), te = pairs.filter(p => fold(p) === k);
        const head = toHead(F, newton(design(rows, tr, F), F.length, lam));
        const e = evalHead(head, rows, te);
        ll += e.logLoss * e.n; n += e.n;
      }
      return { l2: lam, logLoss: n ? ll / n : Infinity };
    });
    // Smallest CV loss; ties (within 1e-4) go to the stronger penalty.
    l2 = [...cv].sort((a, b) => (Math.abs(a.logLoss - b.logLoss) < 1e-4 ? b.l2 - a.l2 : a.logLoss - b.logLoss))[0]!.l2;
  }
  return { head: toHead(F, newton(design(rows, pairs, F), F.length, l2)), l2, ...(cv ? { cv } : {}) };
}
const toHead = (F: readonly string[], w: number[]): ClefHead => ({ w: Object.fromEntries(F.map((f, i) => [f, Number(w[i]!.toFixed(6))]).filter(([, x]) => x !== 0)), b: 0 });

/**
 * Label-side bias check: for labels where exactly one photo belongs to group g, the mean of
 * (g's photo won - the model's P(g's photo wins)). Positive = the model rates g LOWER than the human
 * raters do (e.g. Clef's zero-shot answers are biased against g and the linear head cannot undo it);
 * negative = higher. `se` is the standard error; |residual| > 2 se and > 0.05 is flagged by the CLI.
 * Groups are opt-in self-reports of the photo subjects, never inferred.
 */
export function groupResiduals(head: ClefHead, rows: FeatureRows, pairs: readonly LabelledPair[], groupOf: (photo: string) => string | undefined): Record<string, { n: number; residual: number; se: number }> {
  const acc = new Map<string, number[]>();
  for (const p of pairs) {
    const ga = groupOf(p.a), gb = groupOf(p.b), xa = rows.get(p.a), xb = rows.get(p.b);
    if (!xa || !xb || ga === gb) continue;
    const pa = sig(rawHead(head, xa) - rawHead(head, xb)), ya = p.winner === "a" ? 1 : 0;
    if (ga) { const a = acc.get(ga) ?? []; a.push(ya - pa); acc.set(ga, a); }
    if (gb) { const b = acc.get(gb) ?? []; b.push((1 - ya) - (1 - pa)); acc.set(gb, b); }
  }
  const out: Record<string, { n: number; residual: number; se: number }> = {};
  for (const [g, r] of [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = r.reduce((s, x) => s + x, 0) / r.length;
    const sd = r.length > 1 ? Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) : 0;
    out[g] = { n: r.length, residual: m, se: sd / Math.sqrt(r.length) };
  }
  return out;
}

/** Raw (uncalibrated) head output for one feature row. */
export const rawHead = (h: ClefHead, x: Record<string, number>) => Object.entries(h.w).reduce((s, [f, k]) => s + k * (x[f] ?? 0), h.b);

/** Recalibrate weights on a population of feature rows: mean and SD of each head's raw output. */
export function calibrateClefWeights(w: ClefWeights, population: Iterable<Record<string, number>>): ClefWeights {
  const xs = [...population];
  if (xs.length < 2) throw new Error("calibrate: need at least 2 rows");
  const cal = (d: Dim) => {
    const v = xs.map(x => rawHead(w.heads[d], x));
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) || 1;
    return { mean: Number(mean.toFixed(6)), sd: Number(sd.toFixed(6)) };
  };
  return validateClefWeights({ ...w, calibration: { face: cal("face"), body: cal("body"), overall: cal("overall") } });
}

// ---- agreement --------------------------------------------------------------------------------------

export interface RaterStats {
  rater: string; labels: number;
  /** Agreement with the fitted model's favourite on this rater's held-out labels. */
  vsModel: { n: number; agree: number } | null;
  /** Agreement with the majority of the OTHER raters on the same pair and dimension (ties skipped). */
  vsOthers: { n: number; agree: number } | null;
  /** Same rater, same pair, labelled twice (the tool repeats some pairs with sides swapped). */
  selfRepeat: { n: number; agree: number } | null;
  /** Share of labels where the left photo (a) won; far from 0.5 suggests clicking one side. */
  leftShare: number;
  flags: string[];
}
export interface AgreementReport {
  raters: RaterStats[];
  /** Krippendorff's alpha (nominal, binary) per dimension over pairs with labels from 2+ raters; null without overlap. */
  alpha: Record<Dim, { alpha: number | null; units: number; labels: number }>;
  /** Mean pairwise percent agreement between raters on overlapping pairs (all dimensions). */
  pairwiseAgreement: { n: number; agree: number } | null;
}

/** Krippendorff's alpha for binary nominal values; units = arrays of 0/1 values (one per rater). */
export function krippendorffAlphaBinary(units: readonly (readonly number[])[]): number | null {
  let o01 = 0, n0 = 0, n1 = 0;
  for (const u of units) {
    const m = u.length;
    if (m < 2) continue;
    const c1 = u.filter(v => v === 1).length, c0 = m - c1;
    o01 += (c0 * c1) / (m - 1); n0 += c0; n1 += c1;
  }
  const n = n0 + n1;
  if (n < 2 || !n0 || !n1) return n ? 1 : null;
  return 1 - ((n - 1) * o01) / (n0 * n1);
}

/**
 * Inter-rater reliability and per-rater quality flags. `favourite(p)` returns 1 when the model
 * favours the lexically first photo of `p` (null if unknown); `isTest(p)` selects held-out labels.
 */
export function raterAgreement(pairs: readonly LabelledPair[], favourite?: (p: LabelledPair) => number | null, isTest?: (p: LabelledPair) => boolean): AgreementReport {
  const unit = new Map<string, { rater: string; v: number }[]>();
  for (const p of pairs) {
    const k = `${dimOf(p)}\u0001${pairKey(p)}`;
    const arr = unit.get(k) ?? [];
    arr.push({ rater: p.rater ?? "?", v: firstWon(p) });
    unit.set(k, arr);
  }
  const byRater = new Map<string, LabelledPair[]>();
  for (const p of pairs) { const r = p.rater ?? "?"; const a = byRater.get(r); if (a) a.push(p); else byRater.set(r, [p]); }
  const raters: RaterStats[] = [];
  for (const [rater, ps] of [...byRater.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let mN = 0, mA = 0, oN = 0, oA = 0, sN = 0, sA = 0, left = 0;
    const seen = new Map<string, number>();
    for (const p of ps) {
      if (p.winner === "a") left++;
      const v = firstWon(p), k = `${dimOf(p)}\u0001${pairKey(p)}`;
      if (favourite && (!isTest || isTest(p))) { const f = favourite(p); if (f !== null) { mN++; if (f === v) mA++; } }
      const others = (unit.get(k) ?? []).filter(u => u.rater !== rater);
      if (others.length) {
        const s = others.reduce((t, u) => t + u.v, 0);
        if (2 * s !== others.length) { oN++; if ((2 * s > others.length ? 1 : 0) === v) oA++; }
      }
      if (seen.has(k)) { sN++; if (seen.get(k) === v) sA++; } else seen.set(k, v);
    }
    const r: RaterStats = {
      rater, labels: ps.length,
      vsModel: mN ? { n: mN, agree: mA / mN } : null,
      vsOthers: oN ? { n: oN, agree: oA / oN } : null,
      selfRepeat: sN ? { n: sN, agree: sA / sN } : null,
      leftShare: ps.length ? left / ps.length : 0.5, flags: [],
    };
    raters.push(r);
  }
  // Flags are relative to the median rater (the noise level of attractiveness labels varies by panel
  // and photo set) with absolute floors; each needs enough labels to be more than noise.
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN; };
  const medOthers = median(raters.filter(r => r.vsOthers && r.vsOthers.n >= 20).map(r => r.vsOthers!.agree));
  const medModel = median(raters.filter(r => r.vsModel && r.vsModel.n >= 30).map(r => r.vsModel!.agree));
  const pc = (x: number) => `${(100 * x).toFixed(0)}%`;
  for (const r of raters) {
    if (r.vsOthers && r.vsOthers.n >= 20 && (r.vsOthers.agree < 0.55 || r.vsOthers.agree < medOthers - 0.1)) r.flags.push(`agrees with other raters ${pc(r.vsOthers.agree)} (median rater ${pc(medOthers)})`);
    if (r.vsModel && r.vsModel.n >= 30 && (r.vsModel.agree < 0.55 || r.vsModel.agree < medModel - 0.1)) r.flags.push(`agrees with the model ${pc(r.vsModel.agree)} on held-out labels (median rater ${pc(medModel)})`);
    if (r.selfRepeat && r.selfRepeat.n >= 20 && r.selfRepeat.agree < 0.55) r.flags.push(`repeats its own answer ${pc(r.selfRepeat.agree)} of the time (< 55%)`);
    if ((r.labels >= 100 && Math.abs(r.leftShare - 0.5) > 0.15) || (r.labels >= 50 && Math.abs(r.leftShare - 0.5) > 0.2)) r.flags.push(`left photo chosen ${pc(r.leftShare)} of the time`);
  }
  const alpha = {} as AgreementReport["alpha"];
  for (const d of DIMS) {
    // One value per rater per unit (a rater's repeats collapse to their first answer).
    const units = [...unit.entries()].filter(([k]) => k.startsWith(`${d}\u0001`)).map(([, us]) => {
      const first = new Map<string, number>();
      for (const u of us) if (!first.has(u.rater)) first.set(u.rater, u.v);
      return [...first.values()];
    }).filter(u => u.length >= 2);
    alpha[d] = { alpha: krippendorffAlphaBinary(units), units: units.length, labels: units.reduce((s, u) => s + u.length, 0) };
  }
  let pN = 0, pA = 0;
  for (const us of unit.values()) {
    const first = new Map<string, number>();
    for (const u of us) if (!first.has(u.rater)) first.set(u.rater, u.v);
    const v = [...first.values()];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { pN++; if (v[i] === v[j]) pA++; }
  }
  return { raters, alpha, pairwiseAgreement: pN ? { n: pN, agree: pA / pN } : null };
}

// ---- the whole fit ----------------------------------------------------------------------------------

export interface FitOptions {
  version: string; notes?: string;
  /** ISO date for provenance (the CLI passes now; the sim passes a fixed date). */
  fittedAt: string;
  holdout?: number; split?: "pair" | "photo"; seed?: number;
  l2?: number | "auto";
  includeBodyType?: boolean;
  /** Features left out of every head (e.g. a zero-shot rating the label-side bias check flagged). */
  excludeFeatures?: readonly string[];
  /** Raters whose labels are dropped (after reviewing the agreement report; never automatic). */
  excludeRaters?: readonly string[];
  /** Minimum usable labels to fit a dimension; below it the base head is kept (and recorded). */
  minPairs?: number;
  /** Fit the shipped heads on train + test after evaluating on test (default true). */
  refitAll?: boolean;
  /** Rows to calibrate on (default: every usable feature row). */
  population?: Iterable<Record<string, number>>;
  base?: ClefWeights;
  /** Provenance extras from the CLI: file hashes, commit, source names. */
  provenance?: Partial<Pick<ClefProvenance, "commit" | "pairsSha256" | "featuresSha256" | "calibratedOn">>;
}
export interface DimReport {
  source: "fitted" | "base"; labels: number; train: number; test: number; l2: number | null;
  heldOut: PairEval | null; train_: PairEval | null;
  /** The base weights (the placeholder: Clef's zero-shot rating) on the same held-out labels: the P2 "does fitting help" baseline. */
  baseHeldOut: PairEval | null;
  cv?: { l2: number; logLoss: number }[];
}
export interface FitReport {
  photos: number; usablePhotos: number; labels: number; usableLabels: number; raters: number;
  dropped: { flaggedPhotos: number; noFeatures: number; gated: number; byFlag: number; byPhotoSplit: number; byRater: number };
  dims: Record<Dim, DimReport>;
  agreement: AgreementReport;
  features: string[];
}

/** Fit all three heads from labels, evaluate on the held-out split, calibrate, and record provenance. */
export function fitClefWeights(rows: FeatureRows, labels: readonly (LabelledPair | PhotoFlag)[], o: FitOptions): { weights: ClefWeights; report: FitReport } {
  const base = o.base ?? DEFAULT_CLEF_WEIGHTS, seed = o.seed ?? 1, holdout = o.holdout ?? 0.2, split = o.split ?? "pair", minPairs = o.minPairs ?? 50;
  const F = headFeatures({ includeBodyType: o.includeBodyType }).filter(f => !(o.excludeFeatures ?? []).includes(f));
  const flagged = new Set(labels.flatMap(l => ("flag" in l ? [l.flag] : [])));
  const usable = new Map<string, Record<string, number>>();
  let gated = 0;
  for (const [id, x] of rows) {
    if (flagged.has(id)) continue;
    if ((x["gate.one_adult"] ?? 1) < base.gate.oneAdult) { gated++; continue; }
    usable.set(id, x);
  }
  const pairs = labels.filter((l): l is LabelledPair => !("flag" in l));
  const dropped = { flaggedPhotos: flagged.size, noFeatures: 0, gated, byFlag: 0, byPhotoSplit: 0, byRater: 0 };
  const ok: LabelledPair[] = [];
  const excluded = new Set(o.excludeRaters ?? []);
  for (const p of pairs) {
    if (excluded.has(p.rater ?? "?")) { dropped.byRater++; continue; }
    if (flagged.has(p.a) || flagged.has(p.b)) { dropped.byFlag++; continue; }
    if (!usable.has(p.a) || !usable.has(p.b)) { dropped.noFeatures++; continue; }
    ok.push(p);
  }
  const testPhoto = (id: string) => u01("clef-split-photo", seed, id) < holdout;
  const side = (p: LabelledPair): "train" | "test" | "drop" => {
    if (split === "pair") return u01("clef-split", seed, pairKey(p)) < holdout ? "test" : "train";
    const ta = testPhoto(p.a), tb = testPhoto(p.b);
    return ta && tb ? "test" : !ta && !tb ? "train" : "drop";
  };
  const heads = { ...base.heads };
  const dims = {} as Record<Dim, DimReport>;
  const fitted = {} as Record<Dim, ClefHead | undefined>;
  for (const d of DIMS) {
    const all = ok.filter(p => dimOf(p) === d);
    const tr = all.filter(p => side(p) === "train"), te = all.filter(p => side(p) === "test");
    if (split === "photo") dropped.byPhotoSplit += all.length - tr.length - te.length;
    if (tr.length < minPairs) { dims[d] = { source: "base", labels: all.length, train: tr.length, test: te.length, l2: null, heldOut: null, train_: null, baseHeldOut: te.length ? evalHead(base.heads[d], usable, te) : null }; continue; }
    const f = fitHead(usable, tr, { l2: o.l2 ?? "auto", features: F, seed });
    fitted[d] = f.head;
    const final = o.refitAll === false ? f.head : fitHead(usable, [...tr, ...te], { l2: f.l2, features: F }).head;
    heads[d] = final;
    dims[d] = { source: "fitted", labels: all.length, train: tr.length, test: te.length, l2: f.l2, heldOut: te.length ? evalHead(f.head, usable, te) : null, train_: evalHead(f.head, usable, tr), baseHeldOut: te.length ? evalHead(base.heads[d], usable, te) : null, ...(f.cv ? { cv: f.cv } : {}) };
  }
  const favourite = (p: LabelledPair) => {
    const h = fitted[dimOf(p)], xa = usable.get(p.a), xb = usable.get(p.b);
    if (!h || !xa || !xb) return null;
    const first = p.a < p.b ? xa : xb, second = p.a < p.b ? xb : xa;
    return rawHead(h, first) >= rawHead(h, second) ? 1 : 0;
  };
  const agreement = raterAgreement(ok, favourite, p => side(p) === "test");
  const anyFitted = DIMS.some(d => dims[d].source === "fitted");
  const provenance: ClefProvenance = {
    fitter: FITTER_VERSION, fittedAt: o.fittedAt,
    ...(o.provenance?.commit ? { commit: o.provenance.commit } : {}),
    ...(o.provenance?.pairsSha256 ? { pairsSha256: o.provenance.pairsSha256 } : {}),
    ...(o.provenance?.featuresSha256 ? { featuresSha256: o.provenance.featuresSha256 } : {}),
    photos: usable.size, labels: ok.length, raters: agreement.raters.length, flaggedPhotos: flagged.size,
    split: { mode: split, holdout, seed }, features: F,
    dims: Object.fromEntries(DIMS.map(d => [d, { source: dims[d].source, labels: dims[d].labels, l2: dims[d].l2, heldOutAccuracy: dims[d].heldOut ? round(dims[d].heldOut!.accuracy) : null, heldOutEce: dims[d].heldOut ? round(dims[d].heldOut!.ece) : null }])) as ClefProvenance["dims"],
    alpha: Object.fromEntries(DIMS.map(d => [d, agreement.alpha[d].alpha === null ? null : round(agreement.alpha[d].alpha!)])) as ClefProvenance["alpha"],
    calibratedOn: o.provenance?.calibratedOn ?? (o.population ? "population file" : "the labelled photos' feature rows"),
  };
  const fittedDims = DIMS.filter(d => dims[d].source === "fitted");
  const notes = o.notes ?? `Fitted on ${ok.length} labels from ${agreement.raters.length} raters over ${usable.size} photos (${fittedDims.join(", ") || "no dimension"} fitted${fittedDims.length < 3 ? `; ${DIMS.filter(d => !fittedDims.includes(d)).join(", ")} kept from ${base.version}` : ""}).`;
  const weights = calibrateClefWeights({
    ...base, version: o.version, placeholder: !anyFitted, notes, heads,
    calibration: { face: { mean: 0, sd: 1 }, body: { mean: 0, sd: 1 }, overall: { mean: 0, sd: 1 } }, provenance,
  }, o.population ?? usable.values());
  return {
    weights,
    report: { photos: rows.size, usablePhotos: usable.size, labels: labels.length, usableLabels: ok.length, raters: agreement.raters.length, dropped, dims, agreement, features: F },
  };
}
const round = (x: number) => Number(x.toFixed(4));

/** Kendall's tau-b between two score maps over their shared keys. */
export function kendallTau(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  const ids = [...a.keys()].filter(k => b.has(k));
  let c = 0, d = 0, ta = 0, tb = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = Math.sign(a.get(ids[i]!)! - a.get(ids[j]!)!), y = Math.sign(b.get(ids[i]!)! - b.get(ids[j]!)!);
    if (x === 0 && y === 0) continue;
    if (x === 0) { ta++; continue; }
    if (y === 0) { tb++; continue; }
    if (x === y) c++; else d++;
  }
  const den = Math.sqrt((c + d + ta) * (c + d + tb));
  return den ? (c - d) / den : 0;
}

/** Human-readable report (aggregates only: no photo id, no per-photo score). */
export function formatFitReport(r: FitReport, w: ClefWeights): string {
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const L: string[] = [];
  L.push(`weights ${w.version}: ${r.usablePhotos}/${r.photos} photos usable, ${r.usableLabels}/${r.labels} label lines usable, ${r.raters} raters`);
  L.push(`dropped: ${r.dropped.flaggedPhotos} flagged photos (${r.dropped.byFlag} labels), ${r.dropped.gated} photos under the one-adult gate, ${r.dropped.noFeatures} labels without features${r.dropped.byPhotoSplit ? `, ${r.dropped.byPhotoSplit} labels straddling the photo split` : ""}${r.dropped.byRater ? `, ${r.dropped.byRater} labels from excluded raters` : ""}`);
  L.push(`features (${r.features.length}): ${r.features.join(", ")}`);
  L.push("");
  L.push("dim      source  labels  train  test   l2      held-out acc  log-loss  brier   ECE     (train acc)  base weights held-out acc");
  for (const d of DIMS) {
    const x = r.dims[d], h = x.heldOut;
    L.push(`${d.padEnd(8)} ${x.source.padEnd(7)} ${String(x.labels).padStart(6)} ${String(x.train).padStart(6)} ${String(x.test).padStart(5)}   ${x.l2 === null ? "-     " : String(x.l2).padEnd(6)}  ${h ? pct(h.accuracy).padStart(12) : "           -"}  ${h ? h.logLoss.toFixed(3).padStart(8) : "       -"}  ${h ? h.brier.toFixed(3) : "    -"}   ${h ? h.ece.toFixed(3) : "    -"}   ${(x.train_ ? pct(x.train_.accuracy) : "-").padEnd(12)} ${x.baseHeldOut?.n ? pct(x.baseHeldOut.accuracy) : "-"}`);
  }
  for (const d of DIMS) {
    const h = r.dims[d].heldOut;
    if (!h) continue;
    L.push(`calibration ${d} (P(favourite wins): predicted -> observed, n): ${h.bins.filter(b => b.n).map(b => `${b.predicted.toFixed(2)}->${b.observed.toFixed(2)} (${b.n})`).join("  ")}`);
  }
  L.push("");
  const a = r.agreement;
  L.push(`inter-rater: Krippendorff alpha ${DIMS.map(d => `${d} ${a.alpha[d].alpha === null ? "n/a" : a.alpha[d].alpha!.toFixed(3)} (${a.alpha[d].units} pairs)`).join(", ")}; pairwise agreement ${a.pairwiseAgreement ? `${pct(a.pairwiseAgreement.agree)} (${a.pairwiseAgreement.n})` : "n/a (no overlapping pairs)"}`);
  L.push("rater                labels  vs model (held-out)  vs others      self-repeat    left    flags");
  const f = (s: { n: number; agree: number } | null) => (s ? `${pct(s.agree)} (${s.n})` : "-");
  for (const x of a.raters) L.push(`${x.rater.slice(0, 20).padEnd(20)} ${String(x.labels).padStart(6)}  ${f(x.vsModel).padEnd(19)}  ${f(x.vsOthers).padEnd(13)}  ${f(x.selfRepeat).padEnd(13)}  ${pct(x.leftShare).padStart(6)}  ${x.flags.join("; ") || "-"}`);
  return L.join("\n");
}
