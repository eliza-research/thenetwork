// Data for the GEPA-lite pilot. Read-only over the COMMITTED eval artifacts:
//   - runs/evals/results/passes-gpt-6-luna.items.jsonl (362 items, rec-v1 labels, richness tiers;
//     produced by commit b5b4389, analysed in a374c6e). `visibleProfiles.pass1` is the exact user
//     message pass 1 saw, so the pilot replays it verbatim (no dataset rebuild, no hidden truth in prompts).
//   - a label decomposition from packages/evals/src/analysis/lunaErrors.ts run at commit a374c6e
//     (0 mismatches vs the items file). The working tree's dataset/sim code is mid-change (judge v2),
//     so it is NOT used: see prepare-soft-labels.sh.
//
// Soft label: pGood = P(label good) over the oracle's pair-chemistry draw (SD 0.13), given every other
// (systematic) term. Pairs: 1 - Phi((0.55 - sysMinE) / 0.13). Groups: Monte Carlo over pair shocks.
// Hard oracle flags (minor, adversarial, romance mismatch, city mismatch) and policy-unsafe items get 0.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const ITEMS_PATH = resolve(ROOT, "runs/evals/results/passes-gpt-6-luna.items.jsonl");

export type Split = "dev" | "test";
/** World-level split of the committed dataset: dev = sf-1 + nyc-1, test = sf-2 + nyc-2. */
export const SPLIT_OF: Record<string, Split> = { "sf-1": "dev", "nyc-1": "dev", "sf-2": "test", "nyc-2": "test" };

export interface Item {
  id: string; world: string; split: Split; group: boolean; tier: string; source: string;
  /** Exact pass-1 user message (JSON string) from the committed run. */
  user: string;
  /** Attending refs (P1..Pn) for schema validation. */
  attending: string[];
  drawnGood: boolean; pGood: number; sysGood: boolean; unsafe: boolean; hardFlag: boolean;
  /** The committed run's pass-1 output on this item (prompt pass1-screen-v2). */
  committed: { verdict: string; prob: number | null; reasoning: string };
}

const HARD = new Set(["adversarial_participant", "city_mismatch", "minor_included", "romance_mismatch", "ex_partner"]);
const SD = 0.13;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function normal(r: () => number) { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** P(good) for a group: mean enjoyment >= 0.55 and min >= 0.40, person chem = mean of its pair shocks. */
function groupPGood(sysE: number[], draws = 4000, seed = 11): number {
  const n = sysE.length, r = mulberry32(seed);
  let good = 0;
  for (let d = 0; d < draws; d++) {
    const z: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) z[a]![b] = z[b]![a] = normal(r) * SD;
    const e = sysE.map((s, a) => Math.max(0, Math.min(1, s + z[a]!.reduce((x, y) => x + y, 0) / (n - 1))));
    const mean = e.reduce((x, y) => x + y, 0) / n;
    if (mean >= 0.55 && Math.min(...e) >= 0.4) good++;
  }
  return good / draws;
}

export function loadItems(featuresPath: string): Item[] {
  const feats = new Map<string, any>();
  for (const l of readFileSync(featuresPath, "utf8").trim().split("\n")) { const f = JSON.parse(l); feats.set(f.itemId, f); }
  const out: Item[] = [];
  for (const l of readFileSync(ITEMS_PATH, "utf8").trim().split("\n")) {
    const r = JSON.parse(l);
    const f = feats.get(r.itemId);
    if (!f) throw new Error(`no features for ${r.itemId}`);
    const hardFlag = (r.label.oracleFlags as string[]).some(x => HARD.has(x));
    const unsafe = !!r.label.unsafe;
    const sysE: number[] = f.per.map((p: any) => p.sysE);
    const group = !!r.meta.group;
    const pGood = unsafe || hardFlag ? 0 : group ? groupPGood(sysE) : 1 - phi((0.55 - f.sysMinE) / SD);
    const view = r.visibleProfiles.pass1;
    out.push({
      id: r.itemId, world: r.world, split: SPLIT_OF[r.world]!, group, tier: r.meta.tier, source: r.meta.source,
      user: JSON.stringify(view),
      attending: (view.people as any[]).filter(p => p.attending).map(p => p.ref),
      drawnGood: !!r.label.good, pGood, sysGood: !unsafe && !hardFlag && !!f.sysGood, unsafe, hardFlag,
      committed: { verdict: r.perPassVerdicts.pass1, prob: r.confidence.pass1 ?? null, reasoning: r.explanations.pass1?.reasoning ?? "" },
    });
  }
  return out;
}

/** Deterministic shuffle (seeded). */
export function shuffle<T>(xs: T[], seed: number): T[] {
  const r = mulberry32(seed), a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** Stratified split of dev into a Pareto/validation set and a feedback (minibatch) set. */
export function splitDev(dev: Item[], nVal: number, seed = 3): { val: Item[]; feedback: Item[] } {
  const strata = new Map<string, Item[]>();
  for (const it of dev) {
    const k = `${it.group}|${it.unsafe ? "unsafe" : it.pGood >= 0.5 ? "good" : "bad"}`;
    strata.set(k, [...(strata.get(k) ?? []), it]);
  }
  const val: Item[] = [];
  for (const [, xs] of [...strata.entries()].sort()) val.push(...shuffle(xs, seed).slice(0, Math.round((xs.length / dev.length) * nVal)));
  const v = new Set(val.map(i => i.id));
  return { val, feedback: dev.filter(i => !v.has(i.id)) };
}
