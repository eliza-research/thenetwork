// Experimental copy of the engine's global selection (src/policy.ts selectProposals/selectOnce)
// with optional levers. With every lever at its default it reproduces selectProposals exactly
// (checked by experiments/verify.ts). Offline research only: nothing here is used by the engine.
import type { City, MemberId } from "@thenetwork/core";
import type { Rng } from "../src/rng.ts";
import type { Scored } from "../src/scoring.ts";
import { CONTRIBUTOR_ROLES } from "../src/types.ts";
import { pairKey, type World } from "../src/world.ts";
import type { Selected, SelectionResult } from "../src/policy.ts";

export interface SelectLevers {
  /** Max share of selected proposals per generator (e.g. { warm_path: 0.3 }). */
  generatorShare?: Record<string, number>;
  /** Max share of selected proposals per engine cluster pair ("a|b", sorted). */
  clusterPairShare?: number;
  /**
   * MMR-style member-level diversity: when a member already has a selected proposal this run,
   * subtract `mmr` x similarity (same category 0.5 + same partner cluster 0.5) from new ones.
   */
  mmr?: number;
  /** Bonus added to adjusted score for cross-cluster pairs (bridges). */
  bridgeBonus?: number;
  /** Category rotation: penalty if the member's most recent proposal (history) had this category. */
  categoryRotation?: number;
  lastCategory?: Map<MemberId, string>;
  /** Max proposals per member in one run (budget pacing across nights). */
  perRunCap?: number;
  /** Members that must not be proposed this run (e.g. already in an open opportunity). */
  exclude?: Set<string>;
  /** Exposure-floor pass on/off (default on). */
  floor?: boolean;
  /** Extra per-candidate adjustment (e.g. acceptance-probability ordering). */
  adjust?: (x: Scored) => number;
  /** Re-order only (does not change who clears the threshold): replaces the greedy key. */
  orderKey?: (x: Scored, adjusted: number) => number;
  /** Exploration draw weight override. */
  exploreWeight?: (x: Scored) => number;
}

export function selectX(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>, L: SelectLevers = {}): SelectionResult {
  const dry = selectOnceX(w, scored, rng, debt, 0, L);
  const slots = Math.floor((w.cfg.exploration.rate * dry.selected.length) / (1 - w.cfg.exploration.rate));
  const res = selectOnceX(w, scored, rng, debt, slots, L);
  const maxE = Math.floor(w.cfg.exploration.maxShare * res.selected.length);
  let e = 0;
  res.selected = res.selected.filter(s => !s.exploration || ++e <= maxE);
  res.selected.forEach((s, i) => { s.rank = i; });
  return res;
}

const clusterPair = (w: World, ids: MemberId[]) => {
  const cs = [...new Set(ids.map(id => w.get(id)!.cluster))].sort();
  return cs.join("|");
};

function selectOnceX(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>, explorationSlots: number, L: SelectLevers): SelectionResult {
  const cfg = w.cfg;
  const proactive = new Map<MemberId, number>();
  const contribution = new Map<MemberId, number>();
  const timesSelected = new Map<MemberId, number>();
  const usedPairs = new Set<string>();
  const fixedSlots = new Map<MemberId, [number, number][]>();
  const perCity = new Map<City, number>();
  const taken = new Set<string>();
  const selected: Selected[] = [];
  const byGen = new Map<string, number>();
  const byCP = new Map<string, number>();
  const memberSel = new Map<MemberId, Scored[]>();
  // Quota denominators: the dry-run size is unknown inside one pass, so quotas apply against the
  // eligible pool size estimate (number of members / 2 is a loose cap); use a running rule:
  // a generator may hold at most share x max(10, selected so far + 1).
  const quotaOk = (x: Scored) => {
    const n = Math.max(10, selected.length + 1);
    const gs = L.generatorShare?.[x.c.generator];
    if (gs !== undefined && (byGen.get(x.c.generator) ?? 0) + 1 > gs * n) return false;
    if (L.clusterPairShare !== undefined && x.c.participants.length === 2) {
      const k = clusterPair(w, x.c.participants);
      if ((byCP.get(k) ?? 0) + 1 > L.clusterPairShare * n) return false;
    }
    return true;
  };

  const canTake = (x: Scored): boolean => {
    const c = x.c;
    if (taken.has(c.key)) return false;
    if ((perCity.get(c.city!) ?? 0) >= cfg.selection.maxProposalsPerCity) return false;
    for (const id of c.participants) {
      const mi = w.get(id)!;
      if (mi.recentProactive + (proactive.get(id) ?? 0) + 1 > cfg.budgets[mi.m.state].limit) return false;
      if (L.perRunCap !== undefined && (proactive.get(id) ?? 0) + 1 > L.perRunCap) return false;
      if (L.exclude?.has(id)) return false;
      const role = c.roles[id];
      if (role && CONTRIBUTOR_ROLES.has(role) && mi.recentContribution + (contribution.get(id) ?? 0) + 1 > cfg.contribution.limit) return false;
      if (c.fixedWindow && c.window) {
        for (const [s, e] of fixedSlots.get(id) ?? []) if (c.window.start < e && s < c.window.end) return false;
      }
    }
    for (let i = 0; i < c.participants.length; i++) for (let j = i + 1; j < c.participants.length; j++) {
      if (usedPairs.has(pairKey(c.participants[i]!, c.participants[j]!))) return false;
    }
    return true;
  };
  const take = (x: Scored, exploration: boolean, probability: number) => {
    const c = x.c;
    taken.add(c.key);
    perCity.set(c.city!, (perCity.get(c.city!) ?? 0) + 1);
    byGen.set(c.generator, (byGen.get(c.generator) ?? 0) + 1);
    if (c.participants.length === 2) { const k = clusterPair(w, c.participants); byCP.set(k, (byCP.get(k) ?? 0) + 1); }
    for (const id of c.participants) {
      proactive.set(id, (proactive.get(id) ?? 0) + 1);
      timesSelected.set(id, (timesSelected.get(id) ?? 0) + 1);
      if (!memberSel.has(id)) memberSel.set(id, []);
      memberSel.get(id)!.push(x);
      const role = c.roles[id];
      if (role && CONTRIBUTOR_ROLES.has(role)) contribution.set(id, (contribution.get(id) ?? 0) + 1);
      if (c.fixedWindow && c.window) {
        if (!fixedSlots.has(id)) fixedSlots.set(id, []);
        fixedSlots.get(id)!.push([c.window.start, c.window.end]);
      }
    }
    for (let i = 0; i < c.participants.length; i++) for (let j = i + 1; j < c.participants.length; j++) usedPairs.add(pairKey(c.participants[i]!, c.participants[j]!));
    selected.push({ s: x, exploration, rank: selected.length, probability });
  };
  const debtLift = (x: Scored) => {
    const ids = x.c.participants;
    const d = ids.reduce((s, id) => s + Math.min(cfg.selection.exposureDebtCap, Math.max(0, debt[id] ?? 0)), 0) / ids.length;
    return cfg.selection.exposureDebtWeight * d;
  };
  const leverAdj = (x: Scored) => {
    let v = 0;
    const ids = x.c.participants;
    if (L.mmr) {
      let pen = 0;
      for (const id of ids) for (const prev of memberSel.get(id) ?? []) {
        const others = (s: Scored) => s.c.participants.filter(p => p !== id).map(p => w.get(p)!.cluster);
        const sameCat = prev.c.category === x.c.category ? 0.5 : 0;
        const oc = new Set(others(prev));
        const sameCl = others(x).some(c => oc.has(c)) ? 0.5 : 0;
        pen = Math.max(pen, sameCat + sameCl);
      }
      v -= L.mmr * pen;
    }
    if (L.bridgeBonus && ids.length >= 2 && new Set(ids.map(id => w.get(id)!.cluster)).size > 1) v += L.bridgeBonus;
    if (L.categoryRotation && L.lastCategory) {
      if (ids.some(id => L.lastCategory!.get(id) === x.c.category)) v -= L.categoryRotation;
    }
    if (L.adjust) v += L.adjust(x);
    return v;
  };
  const adjusted = (x: Scored) => {
    const ids = x.c.participants;
    const load = ids.reduce((s, id) => s + (timesSelected.get(id) ?? 0), 0) / ids.length;
    return x.score - cfg.selection.runLoadPenalty * load + debtLift(x) + leverAdj(x);
  };

  const main = scored.filter(x => x.eligible && !x.c.exploration)
    .sort((a, b) => (b.score - a.score) || (a.c.key < b.c.key ? -1 : 1));

  if (L.floor !== false) {
    const floorMembers = w.ids.filter(id => { const mi = w.get(id)!; return mi.lowExposure && (mi.newcomer || mi.lowData || mi.recentExposure30 === 0); });
    rng.fork("floor").shuffle(floorMembers);
    const floorCap = Math.ceil(cfg.selection.exposureFloorShare * cfg.selection.maxProposalsPerCity * cfg.cities.length);
    let floorTaken = 0;
    for (const id of floorMembers) {
      if (floorTaken >= floorCap) break;
      if (selected.some(s => s.s.c.participants.includes(id))) continue;
      const best = main.find(x => x.c.participants.includes(id) && canTake(x) && quotaOk(x));
      if (best) { take(best, false, 1); floorTaken++; }
    }
  }

  const explore = rng.fork("explore");
  const pool = scored.filter(x => !taken.has(x.c.key) && !x.reason?.match(/floor|dealbreaker|ceiling/) && x.score >= Math.min(x.threshold, cfg.thresholds.exploration))
    .sort((a, b) => (a.c.key < b.c.key ? -1 : 1));
  for (let k = 0; k < explorationSlots; k++) {
    let avail = pool.filter(x => !taken.has(x.c.key) && canTake(x) && quotaOk(x));
    const expansionOnly = avail.filter(x => x.c.exploration);
    if (k % 2 === 0 && expansionOnly.length) avail = expansionOnly;
    if (!avail.length) break;
    const weights = avail.map(x => (L.exploreWeight ? L.exploreWeight(x) : Math.max(0.01, x.components.novelty * x.score) * (x.c.exploration ? 8 : 1)));
    const total = weights.reduce((s, v) => s + v, 0);
    let r = explore.next() * total; let idx = 0;
    while (idx < avail.length - 1 && r >= weights[idx]!) { r -= weights[idx]!; idx++; }
    take(avail[idx]!, true, weights[idx]! / total);
  }
  const remaining = main.filter(x => !taken.has(x.c.key));
  while (true) {
    let best: Scored | undefined; let bestV = -Infinity;
    for (const x of remaining) {
      if (taken.has(x.c.key)) continue;
      const v = adjusted(x);
      if (v < x.threshold) continue;
      const key = L.orderKey ? L.orderKey(x, v) : v;
      if (key > bestV && canTake(x) && quotaOk(x)) { best = x; bestV = key; }
    }
    if (!best) break;
    take(best, false, 1);
  }
  const budgetSkips = main.filter(x => !taken.has(x.c.key)).length;
  return { selected, budgetSkips };
}
