// Fitting and scoring the Clef relay decision layer (relayClef.ts). Pure and offline: no file system,
// no network, no clock (scripts/relay-eval.ts reads the corpora and the cached Clef answers, and passes
// the date). docs/results/2026-10-09-relay.md section 6.
//
//   labels    the relay corpora's classes: scam -> scam, harassment -> harassment, contact ->
//             contact_fishing, rating -> rating_probe; honest rows are negatives for every head.
//             Fit ONLY on the tuning sets (relay.jsonl, relay-paraphrases.jsonl, relay-heldout-1.jsonl).
//             relay-heldout-2.jsonl is scored, never fitted on. minor_signal has no labelled rows and
//             keeps its hand-set head.
//   modes     direct (the direct answer alone, a threshold), bank (logistic head on the detailed
//             questions), both (logistic head on all answers). `compareRelayClefModes` scores each by
//             5-fold cross-validation on the tuning rows, combined with the rules, and picks the best.
//   model     one-vs-rest logistic regression per category, L2 penalty, Newton's method (20 features:
//             exact and deterministic). The hold threshold is the lowest one on a grid (>= 0.3) that
//             keeps that head's honest false-hold share at or under `maxFalseHold` on the training rows.
import { hash32 } from "@thenetwork/core";
import { DEFAULT_RELAY_CLEF_WEIGHTS, RELAY_CLEF_BANK_VERSION, RELAY_CLEF_CATEGORIES, RELAY_CLEF_MODES, relayClefDecide, relayClefModeFeatures, relayClefProb, validateRelayClefWeights, type RelayClefCategory, type RelayClefHead, type RelayClefMode, type RelayClefWeights } from "./relayClef.ts";

export const RELAY_CLEF_FITTER = "relay-clef-fit-1";
export type RelayClass = "honest" | "scam" | "harassment" | "contact" | "rating";
export const RELAY_CLASSES: readonly RelayClass[] = ["honest", "scam", "harassment", "contact", "rating"];
export const CLASS_CATEGORY: Record<Exclude<RelayClass, "honest">, RelayClefCategory> = { scam: "scam", harassment: "harassment", contact: "contact_fishing", rating: "rating_probe" };
/** The heads fitted from labels (minor_signal stays hand-set). */
export const FITTED_CATEGORIES: readonly RelayClefCategory[] = ["scam", "harassment", "contact_fishing", "rating_probe"];

/** The relay reason families each category covers (for precision of the rules arm). */
export function reasonCategories(reasons: readonly string[]): Set<RelayClefCategory> {
  const out = new Set<RelayClefCategory>();
  for (const r of reasons) {
    const [fam, code] = r.split(":") as [string, string | undefined];
    if (fam === "clef" || fam === "clef_severe") { if ((RELAY_CLEF_CATEGORIES as readonly string[]).includes(code ?? "")) out.add(code as RelayClefCategory); continue; }
    if (fam === "scam" || fam === "offplatform") out.add("scam");
    else if (fam === "harass" || fam === "harass_severe") out.add("harassment");
    else if (fam === "contact" || fam === "fishing" || fam === "injection" || fam === "leak") out.add("contact_fishing");
    else if (fam === "rating") out.add("rating_probe");
    else if (fam === "minor") out.add("minor_signal");
  }
  return out;
}

/** One labelled row with its Clef answers (as a feature row) and the rules' decision on it. */
export interface RelayFitRow { cls: RelayClass; x: Record<string, number>; confidence: number; rulesStopped: boolean; rulesCategories?: readonly RelayClefCategory[] }

// --------------------------------------------------------------------------------- logistic fit
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f) for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-12));
}
const sig = (z: number) => 1 / (1 + Math.exp(-z));

/** L2-penalised logistic regression (the bias is not penalised), Newton's method. */
export function fitLogistic(X: readonly (readonly number[])[], y: readonly number[], l2 = 0.003, iters = 50): { w: number[]; b: number } {
  const d = X[0]?.length ?? 0, n = X.length || 1;
  let beta = new Array(d + 1).fill(0) as number[]; // [b, w...]
  for (let it = 0; it < iters; it++) {
    const g = new Array(d + 1).fill(0) as number[];
    const H = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0) as number[]);
    X.forEach((row, i) => {
      const z = [1, ...row];
      const p = sig(z.reduce((s, v, k) => s + v * beta[k]!, 0));
      const r = p - y[i]!, s = Math.max(p * (1 - p), 1e-6);
      for (let a = 0; a <= d; a++) { g[a]! += (r * z[a]!) / n; for (let c = 0; c <= d; c++) H[a]![c]! += (s * z[a]! * z[c]!) / n; }
    });
    for (let a = 1; a <= d; a++) { g[a]! += l2 * beta[a]!; H[a]![a]! += l2; }
    H[0]![0]! += 1e-6;
    const step = solve(H, g);
    beta = beta.map((v, k) => v - step[k]!);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return { b: beta[0]!, w: beta.slice(1) };
}

export const THRESHOLD_GRID = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95] as const;
function pickThreshold(probs: readonly number[], isPos: readonly boolean[], isHonest: readonly boolean[], maxFalseHold: number): number {
  const nh = isHonest.filter(Boolean).length || 1;
  for (const t of THRESHOLD_GRID) if (probs.filter((p, i) => isHonest[i] && p >= t).length / nh <= maxFalseHold) return t;
  return 0.95;
}

export interface RelayFitOptions { mode: RelayClefMode; l2?: number; maxFalseHold?: number; version?: string; base?: RelayClefWeights }

/** Fit the decision layer in one mode from labelled rows (tuning sets only). */
export function fitRelayClefWeights(rows: readonly RelayFitRow[], o: RelayFitOptions): RelayClefWeights {
  const base = o.base ?? DEFAULT_RELAY_CLEF_WEIGHTS;
  const heads = { ...base.heads } as Record<RelayClefCategory, RelayClefHead>;
  const honest = rows.map(r => r.cls === "honest");
  for (const c of FITTED_CATEGORIES) {
    const feats = relayClefModeFeatures(o.mode, c);
    const pos = rows.map(r => r.cls !== "honest" && CLASS_CATEGORY[r.cls] === c);
    const severe = c === "harassment" ? { severe: base.heads.harassment.severe ?? { features: ["threat", "slur"], min: 0.85 } } : {};
    let head: RelayClefHead;
    if (o.mode === "direct") head = { w: {}, b: 0, direct: feats[0]!, hold: 0.5, ...severe };
    else {
      const fit = fitLogistic(rows.map(r => feats.map(f => r.x[f] ?? 0)), pos.map(Number), o.l2 ?? 0.003);
      head = { w: Object.fromEntries(feats.map((f, i) => [f, Math.round(fit.w[i]! * 1e4) / 1e4])), b: Math.round(fit.b * 1e4) / 1e4, hold: 0.5, ...severe };
    }
    head.hold = pickThreshold(rows.map(r => relayClefProb(head, r.x)), pos, honest, o.maxFalseHold ?? 0.02);
    heads[c] = head;
  }
  // minor_signal keeps its hand-set head; in direct mode it reads the one minor question.
  if (o.mode === "direct") heads.minor_signal = { w: {}, b: 0, direct: "minor", hold: base.heads.minor_signal.hold };
  else if (o.mode === "bank" || o.mode === "both") heads.minor_signal = base.heads.minor_signal;
  return validateRelayClefWeights({ version: o.version ?? `relay-clef-${o.mode}-fit`, bank: RELAY_CLEF_BANK_VERSION, mode: o.mode, heads, uncertain: base.uncertain });
}

// ------------------------------------------------------------------------------------- scoring
export interface ArmScore {
  n: number;
  /** Share of each harmful class held or blocked. */
  recall: Record<Exclude<RelayClass, "honest">, number>;
  /** Of the rows attributed to a category, the share whose class is that category (NaN when none). */
  precision: Record<RelayClefCategory, number>;
  /** Honest rows held or blocked. */
  falseHold: number;
  counts: Record<RelayClass, number>;
}
export interface ArmRow { cls: RelayClass; stopped: boolean; categories: ReadonlySet<RelayClefCategory> | readonly RelayClefCategory[] }

export function scoreArm(rows: readonly ArmRow[]): ArmScore {
  const counts = Object.fromEntries(RELAY_CLASSES.map(c => [c, rows.filter(r => r.cls === c).length])) as Record<RelayClass, number>;
  const rate = (c: RelayClass) => rows.filter(r => r.cls === c && r.stopped).length / Math.max(1, counts[c]);
  const precision = {} as Record<RelayClefCategory, number>;
  for (const cat of RELAY_CLEF_CATEGORIES) {
    const att = rows.filter(r => r.stopped && [...r.categories].includes(cat));
    precision[cat] = att.length ? att.filter(r => r.cls !== "honest" && CLASS_CATEGORY[r.cls] === cat).length / att.length : Number.NaN;
  }
  return { n: rows.length, recall: { scam: rate("scam"), harassment: rate("harassment"), contact: rate("contact"), rating: rate("rating") }, precision, falseHold: rate("honest"), counts };
}

/** The three arms for one set of rows under one set of weights: rules only, Clef only, rules + Clef. */
export function scoreArms(rows: readonly RelayFitRow[], w: RelayClefWeights): { rules: ArmScore; clef: ArmScore; combined: ArmScore } {
  const per = rows.map(r => {
    const d = relayClefDecide(w, r.x, r.confidence);
    const clefCats = [...d.hold, ...d.block];
    const clefStop = clefCats.length > 0 || d.uncertain;
    return { r, clefCats, clefStop };
  });
  return {
    rules: scoreArm(per.map(({ r }) => ({ cls: r.cls, stopped: r.rulesStopped, categories: r.rulesCategories ?? [] }))),
    clef: scoreArm(per.map(({ r, clefCats, clefStop }) => ({ cls: r.cls, stopped: clefStop, categories: clefCats }))),
    combined: scoreArm(per.map(({ r, clefCats, clefStop }) => ({ cls: r.cls, stopped: r.rulesStopped || clefStop, categories: [...new Set([...(r.rulesCategories ?? []), ...clefCats])] }))),
  };
}

const meanRecall = (s: ArmScore) => (s.recall.scam + s.recall.harassment + s.recall.contact + s.recall.rating) / 4;

export interface ModeComparison {
  mode: RelayClefMode;
  /** 5-fold cross-validated, out-of-fold, on the tuning rows. */
  cv: { clef: ArmScore; combined: ArmScore };
  /**
   * The selection score: mean harmful-class recall of Clef ALONE, cross-validated. Clef alone, because
   * the rules were tuned on these files (rules + Clef saturates near 100% there and cannot rank modes).
   */
  score: number;
  /** The combined arm's cross-validated honest false-hold share is within the limit. */
  eligible: boolean;
}

/**
 * Compare direct, bank and both by 5-fold cross-validation on the tuning rows (folds by a hash of the
 * row index; deterministic). The best eligible mode (rules + Clef honest false hold <= `maxFalseHold`,
 * default 5%) by Clef-alone mean recall wins; ties go to the simpler mode (direct, then bank, then both).
 */
export function compareRelayClefModes(rows: readonly RelayFitRow[], o: { l2?: number; maxFalseHold?: number; headFalseHold?: number; folds?: number } = {}): { best: RelayClefMode; modes: ModeComparison[] } {
  const k = o.folds ?? 5;
  const fold = rows.map((_, i) => hash32("relay-clef-cv", i) % k);
  const modes: ModeComparison[] = RELAY_CLEF_MODES.map(mode => {
    const oof: { row: RelayFitRow; w: RelayClefWeights }[] = [];
    for (let f = 0; f < k; f++) {
      const train = rows.filter((_, i) => fold[i] !== f), test = rows.filter((_, i) => fold[i] === f);
      if (!train.length || !test.length) continue;
      const w = fitRelayClefWeights(train, { mode, l2: o.l2, maxFalseHold: o.headFalseHold });
      for (const row of test) oof.push({ row, w });
    }
    // Score the out-of-fold rows together, each with its own fold's weights.
    const clefRows: ArmRow[] = [], combRows: ArmRow[] = [];
    for (const { row, w } of oof) {
      const d = relayClefDecide(w, row.x, row.confidence);
      const cats = [...d.hold, ...d.block], stop = cats.length > 0 || d.uncertain;
      clefRows.push({ cls: row.cls, stopped: stop, categories: cats });
      combRows.push({ cls: row.cls, stopped: row.rulesStopped || stop, categories: [...new Set([...(row.rulesCategories ?? []), ...cats])] });
    }
    const clef = scoreArm(clefRows), combined = scoreArm(combRows);
    return { mode, cv: { clef, combined }, score: meanRecall(clef), eligible: combined.falseHold <= (o.maxFalseHold ?? 0.05) };
  });
  const order = (m: ModeComparison) => [m.eligible ? 1 : 0, Math.round(m.score * 1e6), -RELAY_CLEF_MODES.indexOf(m.mode)] as const;
  const best = [...modes].sort((a, b) => { const x = order(a), y = order(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0]!.mode;
  return { best, modes };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
/** A plain-text table for an arm (aggregates only: no message text). */
export function formatArm(name: string, s: ArmScore): string {
  return `${name.padEnd(28)} n ${String(s.n).padStart(3)}  recall scam ${pct(s.recall.scam)} harass ${pct(s.recall.harassment)} contact ${pct(s.recall.contact)} rating ${pct(s.recall.rating)}  honest held ${pct(s.falseHold)}  precision scam ${pct(s.precision.scam)} harass ${pct(s.precision.harassment)} contact ${pct(s.precision.contact_fishing)} rating ${pct(s.precision.rating_probe)}`;
}
