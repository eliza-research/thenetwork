// Policy, load balancing, fairness and exploration (Sections 15.4, 33.8). One global selection
// step per run under constraints (per-member interruption + contribution budgets, no repeated
// pairs, no time-overlapping fixed-time commitments, per-city caps). Greedy with an in-run load
// penalty and an amortized exposure-debt lift; an exposure-floor pass first; then a seeded
// 10-15% exploration slice, logged with selection probabilities for off-policy evaluation.
import type { City, MemberId } from "@thenetwork/core";
import type { Rng } from "./rng.ts";
import type { Scored } from "./scoring.ts";
import type { FairnessMetrics } from "./types.ts";
import { CONTRIBUTOR_ROLES } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export interface Selected { s: Scored; exploration: boolean; rank: number; probability: number }

export interface SelectionResult { selected: Selected[]; budgetSkips: number }

export function selectProposals(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>): SelectionResult {
  // Dry run without exploration sizes the slice; the real run reserves exploration capacity
  // before the greedy pass so exploration picks are not starved of member budget.
  const dry = selectOnce(w, scored, rng, debt, 0);
  const slots = Math.floor((w.cfg.exploration.rate * dry.selected.length) / (1 - w.cfg.exploration.rate));
  const res = selectOnce(w, scored, rng, debt, slots);
  const maxE = Math.floor(w.cfg.exploration.maxShare * res.selected.length);
  let e = 0;
  res.selected = res.selected.filter(s => !s.exploration || ++e <= maxE);
  res.selected.forEach((s, i) => { s.rank = i; });
  return res;
}

function selectOnce(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>, explorationSlots: number): SelectionResult {
  const cfg = w.cfg;
  const proactive = new Map<MemberId, number>();
  const contribution = new Map<MemberId, number>();
  const timesSelected = new Map<MemberId, number>();
  const usedPairs = new Set<string>();
  const fixedSlots = new Map<MemberId, [number, number][]>();
  const perCity = new Map<City, number>();
  const taken = new Set<string>();
  const selected: Selected[] = [];
  let budgetSkips = 0;

  const canTake = (x: Scored): boolean => {
    const c = x.c;
    if (taken.has(c.key)) return false;
    if ((perCity.get(c.city!) ?? 0) >= cfg.selection.maxProposalsPerCity) return false;
    for (const id of c.participants) {
      const mi = w.get(id)!;
      if (mi.recentProactive + (proactive.get(id) ?? 0) + 1 > cfg.budgets[mi.m.state].limit) return false;
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
    for (const id of c.participants) {
      proactive.set(id, (proactive.get(id) ?? 0) + 1);
      timesSelected.set(id, (timesSelected.get(id) ?? 0) + 1);
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
  const adjusted = (x: Scored) => {
    const ids = x.c.participants;
    const load = ids.reduce((s, id) => s + (timesSelected.get(id) ?? 0), 0) / ids.length;
    return x.score - cfg.selection.runLoadPenalty * load + debtLift(x);
  };

  const main = scored.filter(x => x.eligible && !x.c.exploration)
    .sort((a, b) => (b.score - a.score) || (a.c.key < b.c.key ? -1 : 1));

  // 1. Exposure floor: low-exposure / newcomer / low-data members get their best viable option first.
  const floorMembers = w.ids.filter(id => { const mi = w.get(id)!; return mi.lowExposure && (mi.newcomer || mi.lowData || mi.recentExposure30 === 0); });
  rng.fork("floor").shuffle(floorMembers);
  const floorCap = Math.ceil(cfg.selection.exposureFloorShare * cfg.selection.maxProposalsPerCity * cfg.cities.length);
  let floorTaken = 0;
  for (const id of floorMembers) {
    if (floorTaken >= floorCap) break;
    if (selected.some(s => s.s.c.participants.includes(id))) continue;
    const best = main.find(x => x.c.participants.includes(id) && canTake(x));
    if (best) { take(best, false, 1); floorTaken++; }
  }

  // 2. Exploration slice (10-15% of the total), weighted by novelty x score, seeded; expansion picks favoured.
  const slots = explorationSlots;
  const explore = rng.fork("explore");
  const pool = scored.filter(x => !taken.has(x.c.key) && !x.reason?.match(/floor|dealbreaker|ceiling/) && x.score >= Math.min(x.threshold, cfg.thresholds.exploration))
    .sort((a, b) => (a.c.key < b.c.key ? -1 : 1));
  for (let k = 0; k < slots; k++) {
    let avail = pool.filter(x => !taken.has(x.c.key) && canTake(x));
    // Alternate draws between dedicated expansion picks (33.4) and the general novelty pool.
    const expansionOnly = avail.filter(x => x.c.exploration);
    if (k % 2 === 0 && expansionOnly.length) avail = expansionOnly;
    if (!avail.length) break;
    const weights = avail.map(x => Math.max(0.01, x.components.novelty * x.score) * (x.c.exploration ? 8 : 1));
    const total = weights.reduce((s, v) => s + v, 0);
    let r = explore.next() * total; let idx = 0;
    while (idx < avail.length - 1 && r >= weights[idx]!) { r -= weights[idx]!; idx++; }
    take(avail[idx]!, true, weights[idx]! / total);
  }
  // 3. Greedy global selection with in-run load penalty and exposure-debt lift.
  const remaining = main.filter(x => !taken.has(x.c.key));
  while (true) {
    let best: Scored | undefined; let bestV = -Infinity;
    for (const x of remaining) {
      if (taken.has(x.c.key)) continue;
      const v = adjusted(x);
      if (v < x.threshold) continue; // the adjusted score must still clear the bar
      if (v > bestV && canTake(x)) { best = x; bestV = v; }
    }
    if (!best) break;
    take(best, false, 1);
  }
  budgetSkips = main.filter(x => !taken.has(x.c.key)).length;

  return { selected, budgetSkips };
}

export function gini(xs: number[]): number {
  const n = xs.length;
  if (!n) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * s[i]!;
  return acc / (n * sum);
}

export function lorenz(xs: number[], points = 10): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  for (let p = 1; p <= points; p++) {
    const k = Math.round((p / points) * s.length);
    out.push(Number((s.slice(0, k).reduce((a, b) => a + b, 0) / sum).toFixed(4)));
  }
  return out;
}

/** Exposure-concentration and fairness metrics for a run (ME-012). */
export function fairnessMetrics(w: World, selected: Selected[], scored: Scored[]): FairnessMetrics {
  const eligible = w.ids.filter(id => { const m = w.get(id)!.m; return m.age >= w.cfg.ageMin && m.state !== "paused" && !w.holds.has(id); });
  const exp = new Map<MemberId, number>(eligible.map(id => [id, 0]));
  for (const s of selected) for (const id of s.s.c.participants) if (exp.has(id)) exp.set(id, exp.get(id)! + 1);
  const counts = [...exp.values()];
  const total = counts.reduce((a, b) => a + b, 0);
  const sorted = [...counts].sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(eligible.length * 0.1));
  const newcomers = eligible.filter(id => w.get(id)!.newcomer);
  const lowExp = eligible.filter(id => w.get(id)!.lowExposure);
  const byCity: Record<string, number> = {}, byInviter: Record<string, number> = {};
  for (const s of selected) {
    byCity[s.s.c.city!] = (byCity[s.s.c.city!] ?? 0) + 1;
    for (const id of s.s.c.participants) { const r = w.get(id)!.inviterRoot; byInviter[r] = (byInviter[r] ?? 0) + 1; }
  }
  const viable = new Set<MemberId>();
  for (const x of scored) if (x.eligible) for (const id of x.c.participants) viable.add(id);
  return {
    eligibleMembers: eligible.length,
    membersWithProposal: counts.filter(c => c > 0).length,
    zeroExposureShare: eligible.length ? counts.filter(c => c === 0).length / eligible.length : 0,
    gini: gini(counts),
    top10Share: total ? sorted.slice(0, topN).reduce((a, b) => a + b, 0) / total : 0,
    newcomerShare: total ? newcomers.reduce((s, id) => s + exp.get(id)!, 0) / total : 0,
    newcomerCoverage: newcomers.length ? newcomers.filter(id => exp.get(id)! > 0).length / newcomers.length : 1,
    lowExposureCoverage: lowExp.length ? lowExp.filter(id => exp.get(id)! > 0).length / lowExp.length : 1,
    byCity, byInviterCluster: byInviter, maxPerMember: Math.max(0, ...counts),
    lorenz: lorenz(counts), viableCoverage: eligible.length ? eligible.filter(id => viable.has(id)).length / eligible.length : 0,
  };
}

/**
 * Diagnostic only (not used for selection): eligible two-person candidates left unselected whose
 * score exceeds the best score each of its members received this run ("blocking pairs").
 */
export function blockingPairs(selected: Selected[], scored: Scored[]): number {
  const got = new Map<MemberId, number>();
  for (const s of selected) for (const id of s.s.c.participants) got.set(id, Math.max(got.get(id) ?? -Infinity, s.s.score));
  const takenKeys = new Set(selected.map(s => s.s.c.key));
  const seen = new Set<string>();
  let n = 0;
  for (const x of scored) {
    if (!x.eligible || x.c.participants.length !== 2 || takenKeys.has(x.c.key)) continue;
    const [a, b] = x.c.participants as [MemberId, MemberId];
    const k = pairKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    if (x.score > (got.get(a) ?? -Infinity) && x.score > (got.get(b) ?? -Infinity)) n++;
  }
  return n;
}

/** Amortized exposure debt: carried debt + best viable relevance this run - proposals received. */
export function updateExposureDebt(w: World, prior: Record<MemberId, number>, scored: Scored[], selected: Selected[]): Record<MemberId, number> {
  const bestRel = new Map<MemberId, number>();
  for (const x of scored) if (x.eligible) for (const id of x.c.participants) bestRel.set(id, Math.max(bestRel.get(id) ?? 0, Math.max(0, x.score)));
  const got = new Map<MemberId, number>();
  for (const s of selected) for (const id of s.s.c.participants) got.set(id, (got.get(id) ?? 0) + 1);
  const out: Record<MemberId, number> = {};
  for (const id of w.ids) {
    if (w.minors.has(id)) continue; // minors carry no exposure debt (they are never proposed)
    // Relevance is normalised so that a member at the typical threshold accrues ~1 per run.
    const rel = Math.min(1, (bestRel.get(id) ?? 0) / Math.max(0.01, w.cfg.thresholds.byState.normal));
    const v = Math.max(0, (prior[id] ?? 0) + rel - (got.get(id) ?? 0));
    if (v > 0) out[id] = Number(Math.min(w.cfg.selection.exposureDebtCap * 2, v).toFixed(4));
  }
  return out;
}
