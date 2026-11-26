import type { MemberId } from "@thenetwork/core";
import { canReservePair, initial, memberCount, step } from "../../../../core/src/generated/slopAssignment.ts";
import type { AssignContext } from "../../pack.ts";
import { exposureFloor, type Selected, type SelectionResult } from "../../policy.ts";
import type { Scored } from "../../scoring.ts";
import { solveChooSiowIPFP, type SparsePairEdge } from "../../sinkhorn.ts";
import { pairKey, type World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import { SLOP_MATCH_LANE } from "./rules.ts";

interface Edge { s: Scored; a: MemberId; b: MemberId; key: string; v: number }

export function slopAssign(o: SlopPackOptions, w: World, scored: readonly Scored[], ctx: AssignContext): SelectionResult {
  const C = o.congestion;
  const pairs = scored.filter(x => x.eligible && x.c.participants.length === 2 && !x.c.exploration);
  const degree = new Map<MemberId, number>();
  for (const x of pairs) for (const id of x.c.participants) degree.set(id, (degree.get(id) ?? 0) + 1);
  const capacity = (id: MemberId) => w.match.profileIn(id, SLOP_MATCH_LANE)?.capacity ?? 0;
  const budgetLeft = (id: MemberId) => { const mi = w.get(id)!; return w.cfg.budgets[mi.m.state].limit - mi.recentProactive; };
  const capLimit = new Map<MemberId, number>();
  const roomLimit = (id: MemberId) => {
    let lim = capLimit.get(id);
    if (lim === undefined) {
      const mi = w.get(id)!;
      const open = !ctx.exclude?.has(id) && !mi.inOpenOpportunity;
      lim = open ? Math.max(0, Math.min(capacity(id), budgetLeft(id))) : 0;
      capLimit.set(id, lim);
    }
    return lim;
  };
  const debt = (id: MemberId) => Math.min(C.debtCap, Math.max(0, ctx.debt[id] ?? 0));

  const rawPairs: { s: Scored; a: MemberId; b: MemberId; key: string; baseV: number }[] = [];
  const sinkhornEdges: SparsePairEdge[] = [];
  const sinkhornBudgets = new Map<MemberId, number>();
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    if (budgetLeft(a) <= 0 || budgetLeft(b) <= 0 || ctx.exclude?.has(a) || ctx.exclude?.has(b)) continue;
    if (w.get(a)!.inOpenOpportunity || w.get(b)!.inOpenOpportunity || x.score < o.minValue) continue;
    const key = pairKey(a, b);
    const baseV = x.score + (C.debtWeight * (debt(a) + debt(b))) / 2;
    rawPairs.push({ s: x, a, b, key, baseV });
    const limA = roomLimit(a), limB = roomLimit(b);
    if (limA > 0 && limB > 0 && !w.minors.has(a) && !w.minors.has(b)) {
      sinkhornBudgets.set(a, limA);
      sinkhornBudgets.set(b, limB);
      sinkhornEdges.push({ a, b, surplus: x.score, uA: x.c.benefit[a] ?? x.score, uB: x.c.benefit[b] ?? x.score });
    }
  }

  const eq = w.ids.length - w.minors.size >= 20 && sinkhornEdges.length > 0
    ? solveChooSiowIPFP(sinkhornEdges, sinkhornBudgets, 0.25, 20, 0.5)
    : undefined;

  const edges: Edge[] = rawPairs.map(({ s, a, b, key, baseV }) => {
    let lift = 0;
    const mu = eq?.mu.get(key);
    if (mu !== undefined && mu > 0) {
      const adj = 0.5 * Math.log(Math.max(1e-6, mu)) - s.score;
      lift = Math.max(-0.06, Math.min(0.06, 0.06 * adj));
    }
    return { s, a, b, key, v: baseV + lift };
  });

  const tier = (e: Edge) => (C.scarceDegree > 0 && Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.scarceDegree ? 0 : 1);
  edges.sort((p, q) => (tier(p) - tier(q)) || (q.v - p.v) || (p.s.c.key < q.s.c.key ? -1 : 1));
  const byMember = new Map<MemberId, Edge[]>();
  for (const e of edges) for (const id of [e.a, e.b]) { const own = byMember.get(id); if (own) own.push(e); else byMember.set(id, [e]); }

  const selected: Selected[] = [];
  const configuredRounds = Math.floor(Math.max(1, C.perMemberPerTick, C.backupMaxDegree > 0 ? 2 : 1));
  const totalRounds = Number.isNaN(configuredRounds) ? 0 : Math.min(configuredRounds, edges.length);
  const baseRounds = Math.max(0, Math.min(Math.floor(C.perMemberPerTick), totalRounds)) || 0;
  let run = step(initial, { type: "configureAssignment", totalRounds, baseRounds });
  const withinBackupDegree = (e: Edge) => Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.backupMaxDegree;
  const usedCount = new Map<MemberId, number>();
  const usedPairs = new Set<string>();
  let roundUsed = new Set<MemberId>();
  const hasRoom = (id: MemberId) => (usedCount.get(id) ?? 0) < roomLimit(id) && memberCount(run.memberCounts, id) < roomLimit(id);
  const tryReserve = (e: Edge): boolean => {
    if (roundUsed.has(e.a) || roundUsed.has(e.b) || usedPairs.has(e.key)) return false;
    if (!hasRoom(e.a) || !hasRoom(e.b) || !canReservePair(run, e.key, e.a, e.b, withinBackupDegree(e))) return false;
    run = step(run, { type: "reservePair", pairKey: e.key, memberA: e.a, memberB: e.b, withinBackupDegree: withinBackupDegree(e) });
    usedPairs.add(e.key);
    roundUsed.add(e.a);
    roundUsed.add(e.b);
    usedCount.set(e.a, (usedCount.get(e.a) ?? 0) + 1);
    usedCount.set(e.b, (usedCount.get(e.b) ?? 0) + 1);
    selected.push({ s: e.s, exploration: false, rank: run.proposed - 1, probability: 1 });
    return true;
  };
  while (run.phase === "BetweenRounds") {
    run = step(run, { type: "openRound" });
    roundUsed = new Set<MemberId>();
    if (run.round === 1) {
      const floor = exposureFloor(w, ctx.rng, ctx.debt);
      let taken = 0;
      for (const id of floor.members) {
        if (taken >= floor.cap) break;
        if ((byMember.get(id) ?? []).some(tryReserve)) taken++;
      }
    }
    for (const e of edges) tryReserve(e);
    run = step(run, { type: "closeRound" });
  }
  return { selected, budgetSkips: edges.length - selected.length };
}
