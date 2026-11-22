import { DAY, type MemberId } from "@thenetwork/core";
import {
  circleCoherent, circleRepeatWindowDays, circleSeedAllowed, circleSwapImproves, circleSwapRoundRuns, type CircleEvidence,
} from "../../../core/src/generated/groupFormation.ts";
import type { LaneLimits } from "../../../core/src/generated/matchLane.ts";
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
    const value = valueOf(group[i], group[j]);
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

const byStanding = (a: MatchProfile, b: MatchProfile): number => a.standing - b.standing || a.ordinal - b.ordinal;
const lowestStanding = (group: readonly MatchProfile[]): MatchProfile => group.reduce((low, p) => (byStanding(p, low) < 0 ? p : low));
const highestStanding = (group: readonly MatchProfile[]): MatchProfile => group.reduce((high, p) => (byStanding(p, high) > 0 ? p : high));

const spreadAllowed = (group: readonly MatchProfile[], band: number): boolean => {
  const low = lowestStanding(group);
  const high = highestStanding(group);
  return high.standing - low.standing <= band + low.uncertainty + high.uncertainty;
};

interface Ranked<T> { readonly item: T; readonly low: number; readonly total: number; readonly key: string }
const byStrength = <T>(x: Ranked<T>, y: Ranked<T>): number => y.low - x.low || y.total - x.total || compareText(x.key, y.key);

export function buildCircles(
  edges: readonly MatchEdge[], profilesById: ReadonlyMap<EntityId, MatchProfile>, limits: LaneLimits,
  capacityLeft: (profile: MatchProfile) => number, options: CircleOptions = {},
): Circle[] {
  if (limits.circleMaximum < 3) return [];
  const { rankCircle, incumbents = [], forced = [] } = options;
  const floor = limits.circlePairFloor, band = limits.rules.parityBand, maximum = limits.circleMaximum;
  const links = new Map<EntityId, Map<EntityId, number>>();
  const link = (x: EntityId, y: EntityId, value: number) => {
    const row = links.get(x);
    if (row) row.set(y, value); else links.set(x, new Map([[y, value]]));
  };
  for (const e of edges) {
    if (e.value < floor || e.a === e.b || !profilesById.has(e.a) || !profilesById.has(e.b)) continue;
    link(e.a, e.b, e.value); link(e.b, e.a, e.value);
  }
  const profileOf = (id: EntityId): MatchProfile[] => { const p = profilesById.get(id); return p ? [p] : []; };
  const valueOf = (a: MatchProfile, b: MatchProfile) => links.get(a.id)?.get(b.id);

  const used = new Set<MemberId>();
  const open = (p: MatchProfile, group: readonly MatchProfile[]) =>
    !used.has(p.memberId) && capacityLeft(p) > 0 && !group.some(g => g.id === p.id || g.memberId === p.memberId);
  const complete = (group: readonly MatchProfile[]): Circle | undefined => {
    if (group.length < limits.circleMinimum) return;
    const evidence = circleEvidence(group, valueOf);
    if (circleCoherent(evidence, limits.circleMinimum, maximum, floor, band))
      return { members: group.map(profile => profile.id).sort(compareText), evidence };
  };
  const qualified = (group: readonly MatchProfile[]) => {
    const circle = rankCircle && complete(group);
    if (!circle) return;
    const rank = rankCircle?.(circle);
    if (rank === undefined || !Number.isFinite(rank)) return;
    return { circle, rank };
  };
  const lowestOf = (group: readonly MatchProfile[]): number => {
    let lowest = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) lowest = Math.min(lowest, valueOf(group[i]!, group[j]!) ?? floor - 1);
    return lowest;
  };

  const grow = (group: MatchProfile[]): Circle | undefined => {
    let preferred = qualified(group);
    while (group.length < maximum) {
      const choices: Ranked<MatchProfile>[] = [];
      for (const [id] of links.get(group[0]!.id) ?? []) {
        const values = group.map(g => links.get(g.id)?.get(id));
        const [candidate] = profileOf(id);
        if (!candidate || values.some(v => v === undefined) || !open(candidate, group) || !spreadAllowed([...group, candidate], band)) continue;
        const known = values.flatMap(v => (v === undefined ? [] : [v]));
        choices.push({ item: candidate, low: Math.min(...known), total: known.reduce((t, v) => t + v, 0), key: id });
      }
      choices.sort(byStrength);
      if (!choices.length) break;
      let next = choices[0]!.item;
      if (rankCircle && group.length + 1 >= limits.circleMinimum) {
        let extension: ReturnType<typeof qualified>;
        for (const { item } of choices) {
          const candidate = qualified([...group, item]);
          if (candidate && (!extension || candidate.rank > extension.rank)) {
            extension = candidate;
            next = item;
          }
        }
        if (extension && (!preferred || extension.rank > preferred.rank)) preferred = extension;
      }
      group.push(next);
    }
    return rankCircle ? preferred?.circle : complete(group);
  };
  const circles: Circle[] = [];
  const take = (circle: Circle | undefined) => {
    if (!circle) return;
    for (const id of circle.members) used.add(profilesById.get(id)!.memberId);
    circles.push(circle);
  };

  for (const ids of incumbents) {
    const group: MatchProfile[] = [];
    for (const p of ids.flatMap(profileOf)) if (open(p, group)) group.push(p);
    const membersOpen = group.length === ids.length;
    if (!circleSeedAllowed(ids.length, maximum, membersOpen, lowestOf(group), floor, group.length > 0 && spreadAllowed(group, band))) continue;
    take(grow(group));
  }
  const earlier = circles.length;

  const seeds: Ranked<EntityId[]>[] = [];
  for (const [x, row] of links) for (const [y, xy] of row) {
    if (compareText(x, y) >= 0) continue;
    for (const [z, xz] of row) {
      const yz = compareText(y, z) < 0 ? links.get(y)?.get(z) : undefined;
      if (yz === undefined) continue;
      seeds.push({ item: [x, y, z], low: Math.min(xy, xz, yz), total: xy + xz + yz, key: `${x}\u0000${y}\u0000${z}` });
    }
  }
  seeds.sort(byStrength);
  for (const seed of seeds) {
    const group: MatchProfile[] = [];
    for (const p of seed.item.flatMap(profileOf)) if (open(p, group)) group.push(p);
    if (group.length !== seed.item.length || !spreadAllowed(group, band)) continue;
    take(grow(group));
  }
  if (!circleSwapRoundRuns(rankCircle !== undefined, forced.length)) return circles;
  return [...circles.slice(0, earlier), ...improveBySwaps(circles.slice(earlier))];

  function improveBySwaps(found: readonly Circle[]): Circle[] {
    const out = found.map(c => c.members.flatMap(profileOf));
    const home = new Map<EntityId, number>();
    out.forEach((group, k) => { for (const p of group) home.set(p.id, k); });
    const result = found.slice();
    for (let k = 0; k < out.length; k++) {
      const neighbours = new Set<number>();
      for (const p of out[k]!) for (const [id] of links.get(p.id) ?? []) { const h = home.get(id); if (h !== undefined && h > k) neighbours.add(h); }
      for (const m of [...neighbours].sort((x, y) => x - y)) {
        const first = out[k]!, second = out[m]!;
        const before = [result[k]!.evidence.lowestPairValue, result[m]!.evidence.lowestPairValue] as const;
        const tries: [MatchProfile[], MatchProfile[]][] = [];
        for (const p of first) tries.push([first.filter(q => q !== p), [...second, p]]);
        for (const p of second) tries.push([[...first, p], second.filter(q => q !== p)]);
        for (const p of first) for (const q of second) tries.push([[...first.filter(x => x !== p), q], [...second.filter(x => x !== q), p]]);
        let best: { a: Circle; b: Circle; low: number; key: string } | undefined;
        for (const [a, b] of tries) {
          if (a.length > maximum || b.length > maximum) continue;
          const ca = complete(a), cb = complete(b);
          if (!ca || !cb || !circleSwapImproves(before[0], before[1], ca.evidence.lowestPairValue, cb.evidence.lowestPairValue)) continue;
          const low = Math.min(ca.evidence.lowestPairValue, cb.evidence.lowestPairValue);
          const key = `${ca.members.join(",")}|${cb.members.join(",")}`;
          if (!best || low > best.low || (low === best.low && compareText(key, best.key) < 0)) best = { a: ca, b: cb, low, key };
        }
        if (!best) continue;
        result[k] = best.a; result[m] = best.b;
        out[k] = best.a.members.flatMap(profileOf); out[m] = best.b.members.flatMap(profileOf);
        for (const p of out[k]!) home.set(p.id, k);
        for (const p of out[m]!) home.set(p.id, m);
      }
    }
    return result;
  }
}
