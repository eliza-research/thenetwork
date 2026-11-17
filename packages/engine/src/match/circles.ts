// Circles of people who fit: cliques of the edge graph, seeded by the best triangles and grown
// greedily. Only neighbours in the edge list are considered, so the work is bounded by the edges.
import type { MemberId } from "@thenetwork/core";
import { circleCoherent, type CircleEvidence } from "../../../core/src/generated/groupFormation.ts";
import type { LaneLimits } from "../../../core/src/generated/matchLane.ts";
import { compareText, type EntityId, type MatchProfile } from "./profile.ts";
import type { MatchEdge } from "./search.ts";

export interface Circle { readonly members: readonly EntityId[]; readonly evidence: CircleEvidence }
type RankCircle = (circle: Circle) => number | undefined;

/**
 * The admission evidence of a group (spec/groupFormation.md, CircleEvidence). A pair without a value
 * (`valueOf` undefined) is not counted, so circleCoherent refuses the group (pairCount is short).
 */
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

// spec/groupFormation.md, "A primary circle values every pair and keeps a narrow standing spread"
const spreadAllowed = (group: readonly MatchProfile[], band: number): boolean => {
  const low = lowestStanding(group);
  const high = highestStanding(group);
  return high.standing - low.standing <= band + low.uncertainty + high.uncertainty;
};

interface Ranked<T> { readonly item: T; readonly low: number; readonly total: number; readonly key: string }
const byStrength = <T>(x: Ranked<T>, y: Ranked<T>): number => y.low - x.low || y.total - x.total || compareText(x.key, y.key);

/**
 * Circles for one lane. `edges` are that lane's edges (mutualEdges); a pair joins only with an edge
 * of value >= circlePairFloor. Each member is in at most one circle per run, and only while
 * `capacityLeft` is positive. Admission is the generated circleCoherent check. A plan can also rank
 * complete circles during growth so its activity and time floors apply before reservation.
 */
export function buildCircles(
  edges: readonly MatchEdge[], profilesById: ReadonlyMap<EntityId, MatchProfile>, limits: LaneLimits,
  capacityLeft: (profile: MatchProfile) => number, rankCircle?: RankCircle,
): Circle[] {
  if (limits.circleMaximum < 3) return [];
  const links = new Map<EntityId, Map<EntityId, number>>();
  const link = (x: EntityId, y: EntityId, value: number) => {
    const row = links.get(x);
    if (row) row.set(y, value); else links.set(x, new Map([[y, value]]));
  };
  for (const e of edges) {
    if (e.value < limits.circlePairFloor || e.a === e.b || !profilesById.has(e.a) || !profilesById.has(e.b)) continue;
    link(e.a, e.b, e.value); link(e.b, e.a, e.value);
  }
  const profileOf = (id: EntityId): MatchProfile[] => { const p = profilesById.get(id); return p ? [p] : []; };

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

  const used = new Set<MemberId>();
  const open = (p: MatchProfile, group: readonly MatchProfile[]) =>
    !used.has(p.memberId) && capacityLeft(p) > 0 && !group.some(g => g.id === p.id || g.memberId === p.memberId);
  const band = limits.rules.parityBand;
  const complete = (group: readonly MatchProfile[]): Circle | undefined => {
    if (group.length < limits.circleMinimum) return;
    const evidence = circleEvidence(group, (a, b) => links.get(a.id)?.get(b.id));
    if (circleCoherent(evidence, limits.circleMinimum, limits.circleMaximum, limits.circlePairFloor, band))
      return { members: group.map(profile => profile.id).sort(compareText), evidence };
  };
  const qualified = (group: readonly MatchProfile[]) => {
    const circle = rankCircle && complete(group);
    if (!circle) return;
    const rank = rankCircle?.(circle);
    return rank === undefined ? undefined : { circle, rank };
  };
  const circles: Circle[] = [];
  for (const seed of seeds) {
    const group: MatchProfile[] = [];
    for (const p of seed.item.flatMap(profileOf)) if (open(p, group)) group.push(p);
    if (group.length !== seed.item.length || !spreadAllowed(group, band)) continue;
    let preferred = qualified(group);
    while (group.length < limits.circleMaximum) {
      const options: Ranked<MatchProfile>[] = [];
      for (const [id] of links.get(group[0].id) ?? []) {
        const values = group.map(g => links.get(g.id)?.get(id));
        const [candidate] = profileOf(id);
        if (!candidate || values.some(v => v === undefined) || !open(candidate, group) || !spreadAllowed([...group, candidate], band)) continue;
        const known = values.flatMap(v => (v === undefined ? [] : [v]));
        options.push({ item: candidate, low: Math.min(...known), total: known.reduce((t, v) => t + v, 0), key: id });
      }
      options.sort(byStrength);
      if (!options.length) break;
      let next = options[0]!.item;
      if (rankCircle) {
        let extension: ReturnType<typeof qualified>;
        for (const { item } of options) {
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
    const circle = rankCircle ? preferred?.circle : complete(group);
    if (!circle) continue;
    for (const id of circle.members) used.add(profilesById.get(id)!.memberId);
    circles.push(circle);
  }
  return circles;
}
