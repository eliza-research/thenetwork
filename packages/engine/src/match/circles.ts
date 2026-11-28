import { DAY, type MemberId } from "@thenetwork/core";
import {
  circleCoherent, circleRepeatWindowDays, circleSeedAllowed, circleSwapImproves, circleSwapRoundRuns, type CircleEvidence,
} from "../../../core/src/generated/groupFormation.ts";
import type { LaneLimits } from "../../../core/src/generated/matchLane.ts";
import { parityAllowed } from "../../../core/src/generated/pairValue.ts";
import type { World } from "../world.ts";
import { compareText, type EntityId, type MatchProfile } from "./profile.ts";
import type { MatchEdge } from "./search.ts";

export interface Circle { readonly members: readonly EntityId[]; readonly evidence: CircleEvidence }
type RankCircle = (circle: Circle) => number | undefined;

export interface CircleOptions {
  readonly rankCircle?: RankCircle;
  readonly incumbents?: readonly (readonly EntityId[])[];
  readonly forced?: readonly EntityId[];
}

const K_SEED_DEGREE = 32;
const MAX_SWAP_PASSES = 2;

const pastTables = new WeakMap<World, readonly (readonly MemberId[])[]>();

export function repeatTables(w: World, profileIn: (memberId: MemberId) => MatchProfile | undefined): EntityId[][] {
  let tables = pastTables.get(w);
  if (!tables) {
    const again = new Set(w.feedback.filter(f => f.wouldMeetAgain === true && f.opportunityId !== undefined)
      .map(f => `${f.opportunityId}\u0000${f.from}\u0000${f.about}`));
    const said = (opportunity: string, a: MemberId, b: MemberId) => again.has(`${opportunity}\u0000${a}\u0000${b}`);
    tables = w.interactions
      .filter(r => r.outcome === "completed" && r.at <= w.now && w.now - r.at < circleRepeatWindowDays * DAY && r.participants.length >= 2)
      .sort((x, y) => y.at - x.at || compareText(x.id, y.id))
      .map(r => r.participants.filter(a => r.participants.some(b => b !== a && said(r.id, a, b) && said(r.id, b, a))))
      .filter(ids => ids.length >= 2);
    pastTables.set(w, tables);
  }
  return tables
    .map(ids => ids.flatMap(id => { const p = profileIn(id); return p ? [p.id] : []; }))
    .filter(ids => ids.length >= 2);
}

export function circleEvidence(group: readonly MatchProfile[], valueOf: (a: MatchProfile, b: MatchProfile) => number | undefined): CircleEvidence {
  let lowestPairValue = Number.MAX_SAFE_INTEGER, pairValueTotal = 0, pairCount = 0;
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const value = valueOf(group[i]!, group[j]!);
    if (value === undefined) continue;
    lowestPairValue = Math.min(lowestPairValue, value);
    pairValueTotal += value;
    pairCount++;
  }
  const low = lowestStanding(group);
  const high = highestStanding(group);
  return {
    size: group.length, lowestPairValue: pairCount > 0 ? lowestPairValue : 0, pairValueTotal, pairCount,
    standingLow: low.standing, standingHigh: high.standing, uncertaintyTotal: low.uncertainty + high.uncertainty,
  };
}

export function mfhgCoalitionNsw(
  group: readonly MatchProfile[],
  valueOf: (a: MatchProfile, b: MatchProfile) => number | undefined,
): number {
  const m = group.length;
  if (m < 2) return 0;
  const denom = m - 1;
  let logSum = 0;
  for (let i = 0; i < m; i++) {
    let sumOther = 0;
    for (let j = 0; j < m; j++) {
      if (i === j) continue;
      sumOther += Math.max(0, valueOf(group[i]!, group[j]!) ?? 0);
    }
    const u = sumOther / denom;
    logSum += Math.log(Math.max(1, u));
  }
  return Math.round(1000 * Math.exp(logSum / m));
}

const byStanding = (a: MatchProfile, b: MatchProfile): number => a.standing - b.standing || a.ordinal - b.ordinal;
const lowestStanding = (group: readonly MatchProfile[]): MatchProfile => group.reduce((low, p) => (byStanding(p, low) < 0 ? p : low));
const highestStanding = (group: readonly MatchProfile[]): MatchProfile => group.reduce((high, p) => (byStanding(p, high) > 0 ? p : high));

const spreadAllowed = (group: readonly MatchProfile[], band: number): boolean => {
  const low = lowestStanding(group);
  const high = highestStanding(group);
  return parityAllowed(high.standing - low.standing, band, low.uncertainty, high.uncertainty);
};

interface DenseCircleGraph {
  readonly count: number;
  readonly profiles: readonly MatchProfile[];
  readonly idToIdx: ReadonlyMap<EntityId, number>;
  readonly adj: readonly Map<number, number>[];
}

function buildDenseGraph(
  edges: readonly MatchEdge[],
  profilesById: ReadonlyMap<EntityId, MatchProfile>,
  floor: number,
): DenseCircleGraph {
  const touched = new Set<EntityId>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (e.value < floor || e.a === e.b || !profilesById.has(e.a) || !profilesById.has(e.b)) continue;
    touched.add(e.a);
    touched.add(e.b);
  }
  const sortedIds = [...touched].sort(compareText);
  const idToIdx = new Map<EntityId, number>();
  const profiles = new Array<MatchProfile>(sortedIds.length);
  const adj = new Array<Map<number, number>>(sortedIds.length);
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i]!;
    idToIdx.set(id, i);
    profiles[i] = profilesById.get(id)!;
    adj[i] = new Map<number, number>();
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (e.value < floor || e.a === e.b) continue;
    const u = idToIdx.get(e.a);
    const v = idToIdx.get(e.b);
    if (u === undefined || v === undefined) continue;
    adj[u]!.set(v, e.value);
    adj[v]!.set(u, e.value);
  }

  return {
    count: profiles.length,
    profiles,
    idToIdx,
    adj,
  };
}

function standingSpreadOkIdx(
  buf: Int32Array,
  len: number,
  profiles: readonly MatchProfile[],
  band: number,
): boolean {
  if (len <= 0) return false;
  let low = profiles[buf[0]!]!;
  let high = low;
  for (let i = 1; i < len; i++) {
    const p = profiles[buf[i]!]!;
    if (byStanding(p, low) < 0) low = p;
    if (byStanding(p, high) > 0) high = p;
  }
  return parityAllowed(high.standing - low.standing, band, low.uncertainty, high.uncertainty);
}

function mfhgLogSumIdx(
  buf: Int32Array,
  len: number,
  adj: readonly Map<number, number>[],
): number {
  if (len < 2) return -Infinity;
  const denom = len - 1;
  let logSum = 0;
  for (let i = 0; i < len; i++) {
    const row = adj[buf[i]!]!;
    let sumOther = 0;
    for (let j = 0; j < len; j++) {
      if (i === j) continue;
      const v = row.get(buf[j]!);
      if (v !== undefined && v > 0) sumOther += v;
    }
    const u = sumOther / denom;
    logSum += Math.log(u > 1 ? u : 1);
  }
  return logSum;
}

function mfhgNswFromLogSum(logSum: number, len: number): number {
  return len < 2 ? 0 : Math.round(1000 * Math.exp(logSum / len));
}

function circleEvidenceIdx(
  buf: Int32Array,
  len: number,
  profiles: readonly MatchProfile[],
  adj: readonly Map<number, number>[],
): CircleEvidence {
  let lowestPairValue = Number.MAX_SAFE_INTEGER;
  let pairValueTotal = 0;
  let pairCount = 0;
  let low = profiles[buf[0]!]!;
  let high = low;
  for (let i = 0; i < len; i++) {
    const pi = profiles[buf[i]!]!;
    if (i > 0) {
      if (byStanding(pi, low) < 0) low = pi;
      if (byStanding(pi, high) > 0) high = pi;
    }
    const row = adj[buf[i]!]!;
    for (let j = i + 1; j < len; j++) {
      const v = row.get(buf[j]!);
      if (v === undefined) continue;
      if (v < lowestPairValue) lowestPairValue = v;
      pairValueTotal += v;
      pairCount++;
    }
  }
  return {
    size: len,
    lowestPairValue: pairCount > 0 ? lowestPairValue : 0,
    pairValueTotal,
    pairCount,
    standingLow: low.standing,
    standingHigh: high.standing,
    uncertaintyTotal: low.uncertainty + high.uncertainty,
  };
}

export function buildCircles(
  edges: readonly MatchEdge[], profilesById: ReadonlyMap<EntityId, MatchProfile>, limits: LaneLimits,
  capacityLeft: (profile: MatchProfile) => number, options: CircleOptions = {},
): Circle[] {
  if (limits.circleMaximum < 3) return [];
  const { rankCircle, incumbents = [], forced = [] } = options;
  const floor = limits.circlePairFloor, band = limits.rules.parityBand, maximum = limits.circleMaximum;
  const graph = buildDenseGraph(edges, profilesById, floor);
  const { profiles, idToIdx, adj } = graph;

  const used = new Set<MemberId>();
  const openIdx = (idx: number, buf: Int32Array, len: number): boolean => {
    const p = profiles[idx]!;
    if (used.has(p.memberId) || capacityLeft(p) <= 0) return false;
    for (let i = 0; i < len; i++) {
      const g = profiles[buf[i]!]!;
      if (buf[i] === idx || g.memberId === p.memberId) return false;
    }
    return true;
  };

  const completeIdx = (buf: Int32Array, len: number): Circle | undefined => {
    if (len < limits.circleMinimum) return;
    const evidence = circleEvidenceIdx(buf, len, profiles, adj);
    if (circleCoherent(evidence, limits.circleMinimum, maximum, floor, band)) {
      const members = new Array<EntityId>(len);
      for (let i = 0; i < len; i++) members[i] = profiles[buf[i]!]!.id;
      members.sort(compareText);
      return { members, evidence };
    }
  };

  const qualifiedIdx = (buf: Int32Array, len: number) => {
    const circle = rankCircle && completeIdx(buf, len);
    if (!circle) return;
    const rank = rankCircle?.(circle);
    if (rank === undefined || !Number.isFinite(rank)) return;
    return { circle, rank };
  };

  const lowestOfIdx = (buf: Int32Array, len: number): number => {
    let lowest = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < len; i++) {
      const row = adj[buf[i]!]!;
      for (let j = i + 1; j < len; j++) {
        const v = row.get(buf[j]!) ?? (floor - 1);
        if (v < lowest) lowest = v;
      }
    }
    return lowest;
  };

  const optimizeSize = rankCircle === undefined && forced.length === 0;
  const scratch = new Int32Array(maximum + 1);
  const bestBuf = new Int32Array(maximum + 1);

  const grow = (seedIdx: Int32Array, seedLen: number): Circle | undefined => {
    let len = seedLen;
    for (let i = 0; i < len; i++) scratch[i] = seedIdx[i]!;
    let preferred = qualifiedIdx(scratch, len);
    let curLow = len >= 2 ? lowestOfIdx(scratch, len) : Number.MAX_SAFE_INTEGER;
    let bestLen = len >= limits.circleMinimum ? len : 0;
    if (bestLen > 0) for (let i = 0; i < len; i++) bestBuf[i] = scratch[i]!;
    let bestWeight = bestLen > 0 ? bestLen * curLow : -1;
    let bestNsw = bestLen > 0 ? mfhgNswFromLogSum(mfhgLogSumIdx(scratch, len, adj), len) : -1;

    while (len < maximum) {
      let minRow = adj[scratch[0]!]!;
      for (let i = 1; i < len; i++) {
        const r = adj[scratch[i]!]!;
        if (r.size < minRow.size) minRow = r;
      }
      if (minRow.size === 0) break;

      let bestLow = -1;
      const rawChoices: { idx: number; low: number; total: number; key: EntityId }[] = [];
      for (const [candIdx] of minRow) {
        if (!openIdx(candIdx, scratch, len)) continue;
        let candLow = Number.MAX_SAFE_INTEGER;
        let candTotal = 0;
        let allLinked = true;
        for (let i = 0; i < len; i++) {
          const v = adj[scratch[i]!]!.get(candIdx);
          if (v === undefined) { allLinked = false; break; }
          if (v < candLow) candLow = v;
          candTotal += v;
        }
        if (!allLinked) continue;
        scratch[len] = candIdx;
        if (!standingSpreadOkIdx(scratch, len + 1, profiles, band)) continue;
        if (candLow > bestLow) bestLow = candLow;
        rawChoices.push({ idx: candIdx, low: candLow, total: candTotal, key: profiles[candIdx]!.id });
      }
      if (!rawChoices.length) break;

      let nextIdx: number;
      let nextEdgeLow: number;
      if (rankCircle && len + 1 >= limits.circleMinimum) {
        rawChoices.sort((x, y) => y.low - x.low || y.total - x.total || compareText(x.key, y.key));
        nextIdx = rawChoices[0]!.idx;
        nextEdgeLow = rawChoices[0]!.low;
        let extension: ReturnType<typeof qualifiedIdx>;
        for (let i = 0; i < rawChoices.length; i++) {
          const choice = rawChoices[i]!;
          scratch[len] = choice.idx;
          const candidate = qualifiedIdx(scratch, len + 1);
          if (candidate && (!extension || candidate.rank > extension.rank)) {
            extension = candidate;
            nextIdx = choice.idx;
            nextEdgeLow = choice.low;
          }
        }
        if (extension && (!preferred || extension.rank > preferred.rank)) preferred = extension;
      } else {
        let tiedCount = 0;
        let pickIdx = -1;
        let pickLow = -1;
        let pickTotal = -1;
        let pickKey = "" as EntityId;
        let pickNsw = -1;
        for (let i = 0; i < rawChoices.length; i++) {
          const c = rawChoices[i]!;
          if (c.low !== bestLow) continue;
          tiedCount++;
          if (tiedCount === 1) {
            pickIdx = c.idx;
            pickLow = c.low;
            pickTotal = c.total;
            pickKey = c.key;
          } else {
            if (tiedCount === 2) {
              scratch[len] = pickIdx;
              pickNsw = mfhgNswFromLogSum(mfhgLogSumIdx(scratch, len + 1, adj), len + 1);
            }
            scratch[len] = c.idx;
            const nsw = mfhgNswFromLogSum(mfhgLogSumIdx(scratch, len + 1, adj), len + 1);
            if (nsw > pickNsw || (nsw === pickNsw && (c.total > pickTotal || (c.total === pickTotal && compareText(c.key, pickKey) < 0)))) {
              pickIdx = c.idx;
              pickLow = c.low;
              pickTotal = c.total;
              pickKey = c.key;
              pickNsw = nsw;
            }
          }
        }
        nextIdx = pickIdx;
        nextEdgeLow = pickLow;
      }

      const nextLow = Math.min(curLow, nextEdgeLow);
      if (optimizeSize && len >= limits.circleMinimum) {
        const nextWeight = (len + 1) * nextLow;
        if (nextWeight < bestWeight) break;
      }

      scratch[len] = nextIdx;
      len++;
      curLow = nextLow;
      if (optimizeSize && len >= limits.circleMinimum) {
        const wNow = len * curLow;
        if (wNow > bestWeight) {
          bestWeight = wNow;
          bestLen = len;
          for (let i = 0; i < len; i++) bestBuf[i] = scratch[i]!;
          bestNsw = mfhgNswFromLogSum(mfhgLogSumIdx(scratch, len, adj), len);
        } else if (wNow === bestWeight) {
          const nswNow = mfhgNswFromLogSum(mfhgLogSumIdx(scratch, len, adj), len);
          if (nswNow >= bestNsw) {
            bestLen = len;
            for (let i = 0; i < len; i++) bestBuf[i] = scratch[i]!;
            bestNsw = nswNow;
          }
        }
      }
    }
    if (rankCircle) return preferred?.circle;
    return optimizeSize && bestLen > 0 ? completeIdx(bestBuf, bestLen) : completeIdx(scratch, len);
  };

  const circles: Circle[] = [];
  const take = (circle: Circle | undefined) => {
    if (!circle) return;
    for (const id of circle.members) used.add(profilesById.get(id)!.memberId);
    circles.push(circle);
  };

  const seedBuf = new Int32Array(maximum + 1);
  for (const ids of incumbents) {
    let slen = 0;
    for (const id of ids) {
      const idx = idToIdx.get(id);
      if (idx !== undefined && openIdx(idx, seedBuf, slen)) seedBuf[slen++] = idx;
    }
    const membersOpen = slen === ids.length;
    if (!circleSeedAllowed(ids.length, maximum, membersOpen, lowestOfIdx(seedBuf, slen), floor, slen > 0 && standingSpreadOkIdx(seedBuf, slen, profiles, band))) continue;
    take(grow(seedBuf, slen));
  }
  const earlier = circles.length;

  const seeds: { a: number; b: number; c: number; low: number; nsw: number; total: number }[] = [];
  const nNodes = profiles.length;
  for (let x = 0; x < nNodes; x++) {
    const row = adj[x]!;
    if (row.size < 2) continue;
    let topNeighbors: [number, number][];
    if (row.size <= K_SEED_DEGREE) {
      topNeighbors = [];
      for (const entry of row.entries()) if (entry[0] > x) topNeighbors.push(entry);
    } else {
      topNeighbors = [...row.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, K_SEED_DEGREE)
        .filter(entry => entry[0] > x);
    }
    const tLen = topNeighbors.length;
    if (tLen < 2) continue;
    topNeighbors.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < tLen - 1; i++) {
      const [y, xy] = topNeighbors[i]!;
      const yRow = adj[y]!;
      for (let j = i + 1; j < tLen; j++) {
        const [z, xz] = topNeighbors[j]!;
        const yz = yRow.get(z);
        if (yz === undefined) continue;
        const uX = (xy + xz) * 0.5;
        const uY = (xy + yz) * 0.5;
        const uZ = (xz + yz) * 0.5;
        const nsw = Math.round(1000 * Math.cbrt((uX > 1 ? uX : 1) * (uY > 1 ? uY : 1) * (uZ > 1 ? uZ : 1)));
        seeds.push({
          a: x, b: y, c: z,
          low: xy < xz ? (xy < yz ? xy : yz) : (xz < yz ? xz : yz),
          nsw,
          total: xy + xz + yz,
        });
      }
    }
  }
  seeds.sort((x, y) =>
    y.low - x.low
    || y.nsw - x.nsw
    || y.total - x.total
    || x.a - y.a
    || x.b - y.b
    || x.c - y.c);

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!;
    let slen = 0;
    if (openIdx(s.a, seedBuf, slen)) seedBuf[slen++] = s.a;
    if (openIdx(s.b, seedBuf, slen)) seedBuf[slen++] = s.b;
    if (openIdx(s.c, seedBuf, slen)) seedBuf[slen++] = s.c;
    if (slen !== 3 || !standingSpreadOkIdx(seedBuf, 3, profiles, band)) continue;
    take(grow(seedBuf, 3));
  }
  if (!circleSwapRoundRuns(rankCircle !== undefined, forced.length)) return circles;
  return [...circles.slice(0, earlier), ...improveBySwapsIdx(circles.slice(earlier), {
    profiles, idToIdx, adj, completeIdx, maximum, minimum: limits.circleMinimum, floor, band,
  })];
}

interface SwapIdxContext {
  readonly profiles: readonly MatchProfile[];
  readonly idToIdx: ReadonlyMap<EntityId, number>;
  readonly adj: readonly Map<number, number>[];
  readonly completeIdx: (buf: Int32Array, len: number) => Circle | undefined;
  readonly maximum: number;
  readonly minimum: number;
  readonly floor: number;
  readonly band: number;
}

function improveBySwapsIdx(found: readonly Circle[], ctx: SwapIdxContext): Circle[] {
  const { profiles, idToIdx, adj, completeIdx, maximum, minimum, floor, band } = ctx;
  const out: number[][] = found.map(c => c.members.map(id => idToIdx.get(id)!));
  const home = new Int32Array(profiles.length).fill(-1);
  for (let k = 0; k < out.length; k++) {
    const group = out[k]!;
    for (let i = 0; i < group.length; i++) home[group[i]!] = k;
  }
  const result = found.slice();
  const bufA = new Int32Array(maximum + 1);
  const bufB = new Int32Array(maximum + 1);

  const fastLowest = (buf: Int32Array, len: number): number => {
    if (len < minimum || len > maximum) return -1;
    let lowest = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < len; i++) {
      const row = adj[buf[i]!]!;
      for (let j = i + 1; j < len; j++) {
        const v = row.get(buf[j]!);
        if (v === undefined || v < floor) return -1;
        if (v < lowest) lowest = v;
      }
    }
    return standingSpreadOkIdx(buf, len, profiles, band) ? lowest : -1;
  };

  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    let changed = false;
    for (let k = 0; k < out.length; k++) {
      const neighbours = new Set<number>();
      const gk = out[k]!;
      for (let i = 0; i < gk.length; i++) {
        for (const [nb] of adj[gk[i]!]!) {
          const h = home[nb]!;
          if (h > k) neighbours.add(h);
        }
      }
      const sortedNb = [...neighbours].sort((x, y) => x - y);
      for (let ni = 0; ni < sortedNb.length; ni++) {
        const m = sortedNb[ni]!;
        const first = out[k]!;
        const second = out[m]!;
        const fLen = first.length;
        const sLen = second.length;
        const b0 = result[k]!.evidence.lowestPairValue;
        const b1 = result[m]!.evidence.lowestPairValue;

        let best: { a: Circle; b: Circle; low: number; nsw: number; key: string } | undefined;

        const consider = (lenA: number, lenB: number) => {
          const lowA = fastLowest(bufA, lenA);
          if (lowA < 0) return;
          const lowB = fastLowest(bufB, lenB);
          if (lowB < 0) return;
          if (!circleSwapImproves(b0, b1, lowA, lowB)) return;
          const low = lowA < lowB ? lowA : lowB;
          if (best && low < best.low) return;
          const ca = completeIdx(bufA, lenA);
          const cb = completeIdx(bufB, lenB);
          if (!ca || !cb) return;
          const nsw = mfhgNswFromLogSum(mfhgLogSumIdx(bufA, lenA, adj), lenA) + mfhgNswFromLogSum(mfhgLogSumIdx(bufB, lenB, adj), lenB);
          const key = `${ca.members.join(",")}|${cb.members.join(",")}`;
          if (!best || low > best.low || (low === best.low && (nsw > best.nsw || (nsw === best.nsw && compareText(key, best.key) < 0)))) {
            best = { a: ca, b: cb, low, nsw, key };
          }
        };

        if (fLen - 1 >= minimum && sLen + 1 <= maximum) {
          for (let i = 0; i < fLen; i++) {
            let aLen = 0;
            for (let t = 0; t < fLen; t++) if (t !== i) bufA[aLen++] = first[t]!;
            for (let t = 0; t < sLen; t++) bufB[t] = second[t]!;
            bufB[sLen] = first[i]!;
            consider(aLen, sLen + 1);
          }
        }
        if (sLen - 1 >= minimum && fLen + 1 <= maximum) {
          for (let j = 0; j < sLen; j++) {
            for (let t = 0; t < fLen; t++) bufA[t] = first[t]!;
            bufA[fLen] = second[j]!;
            let bLen = 0;
            for (let t = 0; t < sLen; t++) if (t !== j) bufB[bLen++] = second[t]!;
            consider(fLen + 1, bLen);
          }
        }
        for (let i = 0; i < fLen; i++) {
          for (let j = 0; j < sLen; j++) {
            for (let t = 0; t < fLen; t++) bufA[t] = t === i ? second[j]! : first[t]!;
            for (let t = 0; t < sLen; t++) bufB[t] = t === j ? first[i]! : second[t]!;
            consider(fLen, sLen);
          }
        }

        if (!best) continue;
        changed = true;
        result[k] = best.a;
        result[m] = best.b;
        const nextK = best.a.members.map(id => idToIdx.get(id)!);
        const nextM = best.b.members.map(id => idToIdx.get(id)!);
        out[k] = nextK;
        out[m] = nextM;
        for (let i = 0; i < nextK.length; i++) home[nextK[i]!] = k;
        for (let i = 0; i < nextM.length; i++) home[nextM[i]!] = m;
      }
    }
    if (!changed) break;
  }
  return result;
}
