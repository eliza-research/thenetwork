import type { MemberId } from "@thenetwork/core";
import { canReservePair, initial, step, type AssignmentPhase, type AssignmentRun, type Event as AssignmentEvent } from "../../../../core/src/generated/slopAssignment.ts";
import type { AssignContext } from "../../pack.ts";
import { exposureFloor, type Selected, type SelectionResult } from "../../policy.ts";
import type { Scored } from "../../scoring.ts";
import { solveChooSiowIPFP, type MarketEquilibrium, type SparsePairEdge } from "../../sinkhorn.ts";
import { pairKey, type World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import { SLOP_MATCH_LANE } from "./rules.ts";

interface Edge { s: Scored; a: MemberId; b: MemberId; key: string; v: number }

export class ProjectedSlopAssignmentRun {
  private phase: AssignmentPhase = initial.phase;
  private round = initial.round;
  private totalRounds = initial.totalRounds;
  private baseRounds = initial.baseRounds;
  private proposed = initial.proposed;
  private readonly usedPairs = new Set<string>();
  private roundUsed = new Set<string>();
  private readonly memberCounts = new Map<string, number>();

  get currentPhase(): AssignmentPhase { return this.phase; }
  get currentRound(): number { return this.round; }
  get proposedCount(): number { return this.proposed; }

  countOf(id: string): number { return this.memberCounts.get(id) ?? 0; }
  pairUsed(key: string): boolean { return this.usedPairs.has(key); }
  usedThisRound(id: string): boolean { return this.roundUsed.has(id); }

  private localView(pairKeyStr?: string, memberA?: string, memberB?: string): AssignmentRun {
    const usedPairs: Record<string, boolean> = {};
    const usedInRound: Record<string, boolean> = {};
    const memberCounts: Record<string, number> = {};
    if (pairKeyStr !== undefined && this.usedPairs.has(pairKeyStr)) usedPairs["$" + pairKeyStr] = true;
    if (memberA !== undefined) {
      if (this.roundUsed.has(memberA)) usedInRound["$" + memberA] = true;
      const cA = this.memberCounts.get(memberA);
      if (cA !== undefined) memberCounts["$" + memberA] = cA;
    }
    if (memberB !== undefined && memberB !== memberA) {
      if (this.roundUsed.has(memberB)) usedInRound["$" + memberB] = true;
      const cB = this.memberCounts.get(memberB);
      if (cB !== undefined) memberCounts["$" + memberB] = cB;
    }
    return {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      baseRounds: this.baseRounds,
      proposed: this.proposed,
      usedPairs,
      usedInRound,
      memberCounts,
    };
  }

  canReserve(pairKeyStr: string, memberA: string, memberB: string, withinBackupDegree: boolean): boolean {
    return canReservePair(this.localView(pairKeyStr, memberA, memberB), pairKeyStr, memberA, memberB, withinBackupDegree);
  }

  apply(event: AssignmentEvent): boolean {
    const local = event.type === "reservePair"
      ? this.localView(event.pairKey, event.memberA, event.memberB)
      : this.localView();
    const next = step(local, event);
    if (next === local) return false;
    this.phase = next.phase;
    this.round = next.round;
    this.totalRounds = next.totalRounds;
    this.baseRounds = next.baseRounds;
    this.proposed = next.proposed;
    if (event.type === "openRound") {
      this.roundUsed = new Set<string>();
    } else if (event.type === "reservePair") {
      this.usedPairs.add(event.pairKey);
      this.roundUsed.add(event.memberA);
      this.roundUsed.add(event.memberB);
      this.memberCounts.set(event.memberA, (this.memberCounts.get(event.memberA) ?? 0) + 1);
      this.memberCounts.set(event.memberB, (this.memberCounts.get(event.memberB) ?? 0) + 1);
    }
    return true;
  }
}

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

  const rawPairs: { s: Scored; a: MemberId; b: MemberId; key: string; city: string; baseV: number }[] = [];
  const edgesByCity = new Map<string, SparsePairEdge[]>();
  const budgetsByCity = new Map<string, Map<MemberId, number>>();
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    if (budgetLeft(a) <= 0 || budgetLeft(b) <= 0 || ctx.exclude?.has(a) || ctx.exclude?.has(b)) continue;
    if (w.get(a)!.inOpenOpportunity || w.get(b)!.inOpenOpportunity || x.score < o.minValue) continue;
    const key = pairKey(a, b);
    const city = x.c.city ?? w.get(a)!.m.homeCity;
    const baseV = x.score + (C.debtWeight * (debt(a) + debt(b))) / 2;
    rawPairs.push({ s: x, a, b, key, city, baseV });
    const limA = roomLimit(a), limB = roomLimit(b);
    if (limA > 0 && limB > 0 && !w.minors.has(a) && !w.minors.has(b)) {
      let cBud = budgetsByCity.get(city);
      if (!cBud) { cBud = new Map(); budgetsByCity.set(city, cBud); }
      cBud.set(a, limA);
      cBud.set(b, limB);
      let cEdges = edgesByCity.get(city);
      if (!cEdges) { cEdges = []; edgesByCity.set(city, cEdges); }
      cEdges.push({ a, b, surplus: x.score, uA: x.c.benefit[a] ?? x.score, uB: x.c.benefit[b] ?? x.score });
    }
  }

  const eqByCity = new Map<string, MarketEquilibrium>();
  if (w.ids.length - w.minors.size >= 20) {
    for (const city of [...edgesByCity.keys()].sort()) {
      const cEdges = edgesByCity.get(city)!;
      const cBud = budgetsByCity.get(city)!;
      if (cEdges.length > 0) eqByCity.set(city, solveChooSiowIPFP(cEdges, cBud, 0.25, 20, 0.5));
    }
  }

  const edges: Edge[] = rawPairs.map(({ s, a, b, key, city, baseV }) => {
    let lift = 0;
    const eq = eqByCity.get(city);
    if (eq) {
      const lamA = eq.shadowPrice.get(a);
      const lamB = eq.shadowPrice.get(b);
      if (lamA !== undefined && lamB !== undefined) {
        const adj = -((lamA - eq.medianShadowPrice) + (lamB - eq.medianShadowPrice));
        lift = Math.max(-0.06, Math.min(0.06, 0.06 * adj));
      }
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
  const run = new ProjectedSlopAssignmentRun();
  run.apply({ type: "configureAssignment", totalRounds, baseRounds });
  const withinBackupDegree = (e: Edge) => Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.backupMaxDegree;
  const hasRoom = (id: MemberId) => run.countOf(id) < roomLimit(id);
  const tryReserve = (e: Edge): boolean => {
    if (run.usedThisRound(e.a) || run.usedThisRound(e.b) || run.pairUsed(e.key)) return false;
    const backup = withinBackupDegree(e);
    if (!hasRoom(e.a) || !hasRoom(e.b) || !run.canReserve(e.key, e.a, e.b, backup)) return false;
    if (!run.apply({ type: "reservePair", pairKey: e.key, memberA: e.a, memberB: e.b, withinBackupDegree: backup })) return false;
    selected.push({ s: e.s, exploration: false, rank: run.proposedCount - 1, probability: 1 });
    return true;
  };
  while (run.currentPhase === "BetweenRounds") {
    run.apply({ type: "openRound" });
    if (run.currentRound === 1) {
      const floor = exposureFloor(w, ctx.rng, ctx.debt);
      let taken = 0;
      for (const id of floor.members) {
        if (taken >= floor.cap) break;
        if ((byMember.get(id) ?? []).some(tryReserve)) taken++;
      }
    }
    for (const e of edges) tryReserve(e);
    run.apply({ type: "closeRound" });
  }
  return { selected, budgetSkips: edges.length - selected.length };
}
export const datingAssign = slopAssign;
