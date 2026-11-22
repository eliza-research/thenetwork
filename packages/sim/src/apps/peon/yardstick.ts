import type { MemberId, WorldSnapshot } from "@thenetwork/core";
import { laneLimits } from "@thenetwork/core/src/generated/matchLane.ts";
import { resolveConfig, type EngineConfigInput } from "@thenetwork/engine/src/config.ts";
import { canonicalInput, type EngineResult } from "@thenetwork/engine/src/engine.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import type { AppPack } from "@thenetwork/engine/src/pack.ts";
import { jobOf, sides } from "@thenetwork/engine/src/packs/peon/profile.ts";
import { slateCap } from "@thenetwork/engine/src/packs/peon/selection.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { World } from "@thenetwork/engine/src/world.ts";

export interface MarketPair { cand: MemberId; job: MemberId; value: number; proposed: boolean }
export interface PeonMarket { week: number; pairs: MarketPair[]; room: Map<MemberId, number>; load: Map<MemberId, { proposals: number; room: number }> }

const pairId = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function peonMarket(week: number, snapshot: WorldSnapshot | EngineInput, cfgIn: EngineConfigInput, pack: AppPack, r: EngineResult): PeonMarket {
  const cfg = resolveConfig(cfgIn);
  const w = new World(canonicalInput(snapshot as EngineInput), cfg, localEmbed, pack);
  const proposed = new Set(r.proposals.filter(p => p.lane !== "Cofounder").map(p => pairId(p.participants[0]!, p.participants[1]!)));
  const pairs: MarketPair[] = [];
  const room = new Map<MemberId, number>();
  const budget = (id: MemberId) => {
    const mi = w.get(id)!;
    return mi.inOpenOpportunity ? 0 : Math.max(0, cfg.budgets[mi.m.state].limit - mi.recentProactive);
  };
  const roomOf = (id: MemberId) => {
    const seat = jobOf(w, id);
    return Math.min(seat ? slateCap(w, seat) : laneLimits("Hire").weeklyCapacity, budget(id));
  };
  for (const s of r.runLog.scored) {
    if (!s.eligible || !Number.isFinite(s.score) || s.participants.length !== 2) continue;
    const match = sides(w, s.participants);
    if (!match) continue;
    const { cand, job } = match;
    if (!room.has(cand.id)) room.set(cand.id, roomOf(cand.id));
    if (!room.has(job.id)) room.set(job.id, roomOf(job.id));
    pairs.push({ cand: cand.id, job: job.id, value: Math.round(s.score * 1000), proposed: proposed.has(pairId(cand.id, job.id)) });
  }
  pairs.sort((a, b) => (a.cand < b.cand ? -1 : a.cand > b.cand ? 1 : a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const load = new Map<MemberId, { proposals: number; room: number }>();
  for (const p of r.proposals) for (const id of p.participants) {
    const cur = load.get(id) ?? { proposals: 0, room: roomOf(id) };
    load.set(id, { ...cur, proposals: cur.proposals + 1 });
  }
  return { week, pairs, room, load };
}

export function optimumSelection(market: PeonMarket): { value: number; chosen: MarketPair[] } {
  const pairs = market.pairs.filter(p => p.value > 0 && (market.room.get(p.cand) ?? 0) > 0 && (market.room.get(p.job) ?? 0) > 0);
  const cands = [...new Set(pairs.map(p => p.cand))], jobs = [...new Set(pairs.map(p => p.job))];
  const S = 0, T = 1 + cands.length + jobs.length, n = T + 1;
  const node = new Map<MemberId, number>([...cands.map((id, i) => [id, 1 + i] as const), ...jobs.map((id, i) => [id, 1 + cands.length + i] as const)]);
  const to: number[] = [], cap: number[] = [], cost: number[] = [], next: number[] = [], head = new Array<number>(n).fill(-1);
  const add = (u: number, v: number, c: number, w: number) => {
    to.push(v); cap.push(c); cost.push(w); next.push(head[u]!); head[u] = to.length - 1;
    to.push(u); cap.push(0); cost.push(-w); next.push(head[v]!); head[v] = to.length - 1;
  };
  for (const id of cands) add(S, node.get(id)!, market.room.get(id)!, 0);
  const pairEdge = pairs.map(p => { add(node.get(p.cand)!, node.get(p.job)!, 1, -p.value); return to.length - 2; });
  for (const id of jobs) add(node.get(id)!, T, market.room.get(id)!, 0);
  const pot = new Array<number>(n).fill(0);
  for (const p of pairs) pot[node.get(p.job)!] = Math.min(pot[node.get(p.job)!]!, -p.value);
  pot[T] = Math.min(0, ...jobs.map(id => pot[node.get(id)!]!));
  let total = 0;
  for (;;) {
    const dist = new Array<number>(n).fill(Infinity), via = new Array<number>(n).fill(-1);
    dist[S] = 0;
    const heap: [number, number][] = [[0, S]];
    while (heap.length) {
      const [d, u] = popMin(heap);
      if (d > dist[u]!) continue;
      for (let e = head[u]!; e !== -1; e = next[e]!) {
        if (cap[e]! <= 0) continue;
        const v = to[e]!, nd = d + cost[e]! + pot[u]! - pot[v]!;
        if (nd < dist[v]!) { dist[v] = nd; via[v] = e; pushHeap(heap, [nd, v]); }
      }
    }
    if (dist[T] === Infinity) break;
    const pathCost = dist[T]! + pot[T]! - pot[S]!;
    if (pathCost >= 0) break;
    for (let v = 0; v < n; v++) pot[v]! += Math.min(dist[v]!, dist[T]!);
    let push = Infinity;
    for (let v = T; v !== S; v = to[via[v]! ^ 1]!) push = Math.min(push, cap[via[v]!]!);
    for (let v = T; v !== S; v = to[via[v]! ^ 1]!) { cap[via[v]!]! -= push; cap[via[v]! ^ 1]! += push; }
    total -= pathCost * push;
  }
  return { value: total, chosen: pairs.filter((_, i) => cap[pairEdge[i]!] === 0) };
}

function pushHeap(h: [number, number][], x: [number, number]) {
  h.push(x);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (!less(h[i]!, h[p]!)) break;
    [h[i], h[p]] = [h[p]!, h[i]!]; i = p;
  }
}
function popMin(h: [number, number][]): [number, number] {
  const top = h[0]!, last = h.pop()!;
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && less(h[l]!, h[m]!)) m = l;
      if (r < h.length && less(h[r]!, h[m]!)) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m]!, h[i]!]; i = m;
    }
  }
  return top;
}
const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

export interface MarketMeasures {
  greedyValue: number; optimumValue: number;
  optimumOnlySeats: number; optimumOnlyCandidates: number;
  overRoom: number;
  candidateProposals: number[];
  seatWeeks: number; seatsAtCap: number; seatsUnserved: number;
  candidatesAtCap: number; candidatesUnserved: number;
  popularProposalShare: number; popularRoomShare: number;
}

export function marketMeasures(markets: readonly PeonMarket[]): MarketMeasures {
  const out: MarketMeasures = {
    greedyValue: 0, optimumValue: 0, optimumOnlySeats: 0, optimumOnlyCandidates: 0, overRoom: 0,
    candidateProposals: [0, 0, 0, 0, 0], seatWeeks: 0, seatsAtCap: 0, seatsUnserved: 0, candidatesAtCap: 0, candidatesUnserved: 0,
    popularProposalShare: 0, popularRoomShare: 0,
  };
  let popularProposals = 0, allProposals = 0, popularRoom = 0, allRoom = 0;
  for (const m of markets) {
    const best = optimumSelection(m);
    out.optimumValue += best.value;
    const count = (xs: readonly MarketPair[], side: "cand" | "job") => {
      const c = new Map<MemberId, number>();
      for (const p of xs) c.set(p[side], (c.get(p[side]) ?? 0) + 1);
      return c;
    };
    const proposed = m.pairs.filter(p => p.proposed);
    out.greedyValue += proposed.reduce((s, p) => s + p.value, 0);
    const byCand = count(proposed, "cand"), bySeat = count(proposed, "job");
    const bestCand = count(best.chosen, "cand"), bestSeat = count(best.chosen, "job");
    const degree = count(m.pairs, "job");
    for (const l of m.load.values()) if (l.proposals > l.room) out.overRoom++;
    for (const id of new Set(m.pairs.map(p => p.cand))) {
      const room = m.room.get(id) ?? 0, n = byCand.get(id) ?? 0;
      if (room === 0) continue;
      out.candidateProposals[Math.min(4, n)]!++;
      if (n >= room) out.candidatesAtCap++;
      if (n === 0) out.candidatesUnserved++;
      if (n === 0 && bestCand.has(id)) out.optimumOnlyCandidates++;
    }
    const seats = [...degree.keys()].filter(id => (m.room.get(id) ?? 0) > 0)
      .sort((a, b) => (degree.get(b)! - degree.get(a)!) || (a < b ? -1 : 1));
    const popular = new Set(seats.slice(0, Math.ceil(seats.length / 10)));
    for (const id of seats) {
      const room = m.room.get(id)!, n = bySeat.get(id) ?? 0;
      out.seatWeeks++;
      if (n >= room) out.seatsAtCap++;
      if (n === 0) out.seatsUnserved++;
      if (n === 0 && bestSeat.has(id)) out.optimumOnlySeats++;
      allProposals += n; allRoom += room;
      if (popular.has(id)) { popularProposals += n; popularRoom += room; }
    }
  }
  out.popularProposalShare = allProposals ? popularProposals / allProposals : 0;
  out.popularRoomShare = allRoom ? popularRoom / allRoom : 0;
  return out;
}
