// slopPack global assignment per tick (AppPack.selection.assign): who gets proposed to whom this run.
//   greedy  max reciprocal value first (a 1/2-approximation of the maximum-weight matching), on the
//           value after selection.adjust (exposure debt, scarce pools, popularity);
//   stable  stable roommates (Irving 1985) on each member's own predicted preference order: no two
//           members would both rather be proposed to each other than to whom they got. Works for
//           non-bipartite (queer, bi) pools, where Gale-Shapley does not apply; when no stable
//           matching exists the rest is filled greedily.
// Congestion control: a member is in at most `perMemberPerTick` proposals per run (rounds; round 2 is
// a backup the harness / dispatcher only sends when round 1 failed), so nobody is flooded with probes
// and every probe is one the member can act on (one first date at a time).
import type { MemberId } from "@thenetwork/core";
import type { AssignContext } from "../../pack.ts";
import type { Selected, SelectionResult } from "../../policy.ts";
import type { Scored } from "../../scoring.ts";
import type { Candidate } from "../../types.ts";
import { pairKey, type World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";

interface Edge { s: Scored; a: MemberId; b: MemberId; v: number }

/** Per-run context for selection.adjust (degree = eligible partners, demand = how many rank you top-5). */
const runStats = new WeakMap<World, { degree: Map<MemberId, number>; demand: Map<MemberId, number>; maxDemand: number }>();

/** selection.adjust: exposure debt lift, scarce-pool lift, popularity penalty. Pure in (w, c, value). */
export function slopAdjust(o: SlopPackOptions, w: World, c: Candidate, value: number, debt: Readonly<Record<MemberId, number>> = {}): number {
  const C = o.congestion, st = runStats.get(w);
  const ids = c.participants;
  let v = value;
  if (C.debtWeight) v += C.debtWeight * ids.reduce((s, id) => s + Math.min(C.debtCap, Math.max(0, debt[id] ?? 0)), 0) / ids.length;
  if (st && C.scarcityWeight) v += C.scarcityWeight * Math.max(...ids.map(id => 1 / Math.sqrt(Math.max(1, st.degree.get(id) ?? 1))));
  if (st && C.popularityPenalty && st.maxDemand > 0) v -= C.popularityPenalty * Math.max(...ids.map(id => (st.demand.get(id) ?? 0) / st.maxDemand));
  return v;
}

export function slopAssign(o: SlopPackOptions, w: World, scored: readonly Scored[], ctx: AssignContext): SelectionResult {
  const pairs = scored.filter(x => x.eligible && x.c.participants.length === 2 && !x.c.exploration);
  // Degree and demand for adjust.
  const degree = new Map<MemberId, number>();
  const ranked = new Map<MemberId, { other: MemberId; v: number }[]>();
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    for (const [m, other] of [[a, b], [b, a]] as const) {
      degree.set(m, (degree.get(m) ?? 0) + 1);
      const l = ranked.get(m) ?? []; l.push({ other, v: x.c.benefit[m] ?? 0 }); ranked.set(m, l);
    }
  }
  const demand = new Map<MemberId, number>();
  for (const [, l] of ranked) for (const e of l.sort((p, q) => (q.v - p.v) || (p.other < q.other ? -1 : 1)).slice(0, 5)) demand.set(e.other, (demand.get(e.other) ?? 0) + 1);
  runStats.set(w, { degree, demand, maxDemand: Math.max(0, ...demand.values()) });

  const usable = (id: MemberId) => !ctx.exclude?.has(id) && !w.get(id)!.inOpenOpportunity;
  const edges: Edge[] = [];
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    if (!usable(a) || !usable(b)) continue;
    const v = slopAdjust(o, w, x.c, x.score, ctx.debt);
    if (x.score < o.minValue) continue;
    edges.push({ s: x, a, b, v });
  }
  // Scarce pools first (tier 0), then by adjusted value.
  const C = o.congestion;
  const tier = (e: Edge) => (C.scarceDegree > 0 && Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.scarceDegree ? 0 : 1);
  edges.sort((p, q) => (tier(p) - tier(q)) || (q.v - p.v) || (p.s.c.key < q.s.c.key ? -1 : 1));

  const count = new Map<MemberId, number>();
  const used = new Set<string>();
  const selected: Selected[] = [];
  const rounds = Math.max(1, C.perMemberPerTick, C.backupMaxDegree > 0 ? 2 : 1);
  for (let round = 1; round <= rounds; round++) {
    const backupOnly = round > C.perMemberPerTick;
    const avail = edges.filter(e => !used.has(pairKey(e.a, e.b)) && (count.get(e.a) ?? 0) < round && (count.get(e.b) ?? 0) < round
      && (!backupOnly || Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.backupMaxDegree));
    const chosen = o.assignment === "stable" ? stableRound(avail) : greedyRound(avail);
    for (const e of chosen) {
      used.add(pairKey(e.a, e.b));
      count.set(e.a, (count.get(e.a) ?? 0) + 1); count.set(e.b, (count.get(e.b) ?? 0) + 1);
      selected.push({ s: e.s, exploration: false, rank: selected.length, probability: 1 });
    }
  }
  return { selected, budgetSkips: edges.length - selected.length };
}

/** Greedy: highest adjusted value first, each member at most once this round. */
function greedyRound(edges: readonly Edge[]): Edge[] {
  const taken = new Set<MemberId>();
  const out: Edge[] = [];
  for (const e of edges) {
    if (taken.has(e.a) || taken.has(e.b)) continue;
    taken.add(e.a); taken.add(e.b);
    out.push(e);
  }
  return out;
}

/**
 * Stable roommates with incomplete lists (Irving 1985; Gusfield & Irving 1989). Each member ranks
 * acceptable partners by their OWN predicted enjoyment (Candidate.benefit), ties by the pair's
 * value. Phase 1 (proposals) and phase 2 (rotation elimination). If no stable matching exists, the
 * members it could not settle are matched greedily on what is left.
 */
function stableRound(edges: readonly Edge[]): Edge[] {
  const byPair = new Map<string, Edge>();
  const prefs = new Map<MemberId, MemberId[]>();
  for (const e of edges) {
    byPair.set(pairKey(e.a, e.b), e);
    for (const [m, other] of [[e.a, e.b], [e.b, e.a]] as const) { const l = prefs.get(m) ?? []; l.push(other); prefs.set(m, l); }
  }
  const own = (m: MemberId, other: MemberId) => { const e = byPair.get(pairKey(m, other))!; return e.s.c.benefit[m] ?? 0; };
  const val = (m: MemberId, other: MemberId) => byPair.get(pairKey(m, other))!.v;
  const ids = [...prefs.keys()].sort();
  const rank = new Map<MemberId, Map<MemberId, number>>();
  for (const m of ids) {
    const l = prefs.get(m)!.sort((x, y) => (own(m, y) - own(m, x)) || (val(m, y) - val(m, x)) || (x < y ? -1 : 1));
    rank.set(m, new Map(l.map((x, i) => [x, i])));
  }
  const active = new Map<MemberId, Set<MemberId>>(ids.map(m => [m, new Set(prefs.get(m)!)]));
  const first = (m: MemberId) => prefs.get(m)!.find(x => active.get(m)!.has(x));
  const second = (m: MemberId) => { let n = 0; for (const x of prefs.get(m)!) if (active.get(m)!.has(x) && ++n === 2) return x; return undefined; };
  const last = (m: MemberId) => { const l = prefs.get(m)!; for (let i = l.length - 1; i >= 0; i--) if (active.get(m)!.has(l[i]!)) return l[i]; return undefined; };

  // Phase 1: everyone proposes down their list; each member holds the best proposal received.
  const held = new Map<MemberId, MemberId>(); // receiver -> proposer
  const free: MemberId[] = [...ids];
  const del = (a: MemberId, b: MemberId) => {
    active.get(a)!.delete(b); active.get(b)!.delete(a);
    if (held.get(a) === b) { held.delete(a); free.push(b); }
    if (held.get(b) === a) { held.delete(b); free.push(a); }
  };
  const proposing = (x: MemberId) => [...held.entries()].some(([, p]) => p === x);
  let guard = 0;
  while (free.length && guard++ < 1e6) {
    const x = free.shift()!;
    if (proposing(x)) continue;
    while (true) {
      const y = first(x);
      if (y === undefined) break;
      const cur = held.get(y);
      const ry = rank.get(y)!;
      if (cur === undefined || ry.get(x)! < ry.get(cur)!) {
        held.set(y, x);
        // y will never accept anyone worse than x: delete them (which frees cur, if any).
        for (const z of [...active.get(y)!]) if (ry.get(z)! > ry.get(x)!) del(y, z);
        break;
      }
      del(x, y);
    }
  }
  // Phase 2: eliminate rotations while some list has 2+ entries. A list emptied here (not in
  // phase 1) means no stable matching exists.
  const emptyAfter1 = new Set(ids.filter(m => active.get(m)!.size === 0));
  let ok = true;
  guard = 0;
  while (ok && guard++ < 1e5) {
    const start = ids.find(m => active.get(m)!.size >= 2);
    if (start === undefined) break;
    const seq: MemberId[] = [], pos = new Map<MemberId, number>();
    let x: MemberId | undefined = start;
    while (x !== undefined && !pos.has(x)) {
      pos.set(x, seq.length); seq.push(x);
      const y = second(x);
      x = y === undefined ? undefined : last(y);
    }
    if (x === undefined) { ok = false; break; }
    const cycle = seq.slice(pos.get(x)!);
    const ys = cycle.map(a => second(a)!);
    for (let i = 0; i < cycle.length; i++) {
      const b = ys[i]!, a = cycle[i]!, rb = rank.get(b)!;
      for (const z of [...active.get(b)!]) if (rb.get(z)! > rb.get(a)!) { active.get(b)!.delete(z); active.get(z)!.delete(b); }
    }
    if (ids.some(m => !emptyAfter1.has(m) && active.get(m)!.size === 0)) { ok = false; break; }
  }
  const out: Edge[] = [];
  const taken = new Set<MemberId>();
  for (const m of ids) {
    if (taken.has(m) || active.get(m)!.size !== 1) continue;
    const p = [...active.get(m)!][0]!;
    if (taken.has(p) || active.get(p)!.size !== 1 || !active.get(p)!.has(m)) continue;
    taken.add(m); taken.add(p);
    out.push(byPair.get(pairKey(m, p))!);
  }
  // Fallback (no stable matching, or members left over): greedy on the remaining edges.
  for (const e of greedyRound(edges.filter(e => !taken.has(e.a) && !taken.has(e.b)))) { taken.add(e.a); taken.add(e.b); out.push(e); }
  return out.sort((p, q) => (q.v - p.v) || (p.s.c.key < q.s.c.key ? -1 : 1));
}
