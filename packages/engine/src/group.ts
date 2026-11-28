import type { Category, City, MemberId } from "@thenetwork/core";
import {
  alternateAllowed, groupLocationAllowed, initial, poolEligible, step,
  type CircleEvidence, type CircleLimits, type Formation,
} from "../../core/src/generated/groupFormation.ts";
import { laneLimits, laneShape, type MatchLane } from "../../core/src/generated/matchLane.ts";
import { pairValueScale } from "../../core/src/generated/pairValue.ts";
import { groupHostEligible } from "../../core/src/generated/groupHost.ts";
import { isMinor, memberReason } from "./filters.ts";
import { buildCircles, repeatTables, type Circle } from "./match/circles.ts";
import { compareText, type EntityId, type MatchProfile } from "./match/profile.ts";
import { mutualEdges, type MatchEdge } from "./match/search.ts";
import type { GroupStats, Role } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export interface ComposeOptions {
  pool: { id: MemberId; affinity: number }[];
  forced?: MemberId[];
  category: Category;
  minSize: number; maxSize: number;
  window: { start: number; end: number };
  preferredCity?: City; requireCity?: boolean;
  needHost: boolean;
  forcedRole?: Role;
  format?: "small_group" | "event";
  alternates: number;
}
interface ComposedGroup {
  primary: MemberId[]; alternates: MemberId[]; roles: Record<MemberId, Role>;
  stats: GroupStats; city: City;
  lane: MatchLane; entities: Record<MemberId, EntityId>;
}

export function groupLane(category: Category): MatchLane {
  return category === "romance" ? "Date" : category === "professional" ? "Intro" : "Friend";
}

export const formsGroups = (lane: MatchLane): boolean => laneShape(lane) === "Peers" && laneLimits(lane).circleMaximum > 0;

export function mfhgMemberUtility(sumOther: number, size: number, coordCost = 0): number {
  if (size < 2 || !Number.isFinite(sumOther)) return 0;
  const base = sumOther / (size - 1);
  const pen = Number.isFinite(coordCost) && coordCost > 0 ? coordCost : 0;
  return Math.max(0, Math.min(1, base - pen));
}

export function mfhgGeometricNsw(utilities: readonly number[]): number {
  if (!utilities.length) return 0;
  let logSum = 0;
  for (const u of utilities) logSum += Math.log(Math.max(1e-4, Math.min(1, Number.isFinite(u) ? u : 0)));
  return Math.exp(logSum / utilities.length);
}

interface PoolGraph {
  readonly lane: MatchLane;
  readonly profiles: ReadonlyMap<MemberId, MatchProfile>;
  readonly edges: readonly MatchEdge[];
  readonly edgesByEntity: ReadonlyMap<EntityId, readonly MatchEdge[]>;
  readonly pairs: readonly { readonly a: MemberId; readonly b: MemberId; readonly value: number }[];
  value(a: MemberId, b: MemberId): number | undefined;
  readonly incumbents: readonly (readonly EntityId[])[];
}

type PoolPairScore = (a: MatchProfile, b: MatchProfile, key: string) => number | undefined;

function scorePoolPairs(profiles: readonly MatchProfile[], score: PoolPairScore): MatchEdge[] {
  const edges: MatchEdge[] = [];
  for (const [i, first] of profiles.entries()) {
    for (let j = i + 1; j < profiles.length; j++) {
      const second = profiles[j]!;
      const [a, b] = compareText(first.id, second.id) < 0 ? [first, second] : [second, first];
      const key = pairKey(a.id, b.id);
      const value = score(a, b, key);
      if (value !== undefined) edges.push({ a: a.id, b: b.id, key, value });
    }
  }
  return edges.sort((x, y) => y.value - x.value || compareText(x.key, y.key));
}

export function poolGraph(w: World, lane: MatchLane, ids: readonly MemberId[], score?: PoolPairScore): PoolGraph {
  const profiles = new Map<MemberId, MatchProfile>();
  for (const id of ids) {
    const profile = w.match.profileIn(id, lane);
    if (profile) profiles.set(id, profile);
  }
  const profileList = [...profiles.values()];
  const memberOf = new Map(profileList.map(p => [p.id, p.memberId] as const));
  const edges = score
    ? scorePoolPairs(profileList, score)
    : mutualEdges(profileList.map(profile => ({ profile, result: w.match.candidates(profile) })))
      .filter(e => memberOf.has(e.a) && memberOf.has(e.b));
  const pairs = edges.map(e => ({ a: memberOf.get(e.a)!, b: memberOf.get(e.b)!, value: e.value }));
  const links = new Map<MemberId, Map<MemberId, number>>();
  const link = (x: MemberId, y: MemberId, value: number) => {
    const row = links.get(x);
    if (row) row.set(y, value); else links.set(x, new Map([[y, value]]));
  };
  for (const p of pairs) { link(p.a, p.b, p.value); link(p.b, p.a, p.value); }
  const edgesByEntity = new Map<EntityId, MatchEdge[]>();
  const addEdge = (id: EntityId, e: MatchEdge) => {
    let list = edgesByEntity.get(id);
    if (!list) { list = []; edgesByEntity.set(id, list); }
    list.push(e);
  };
  for (const e of edges) { addEdge(e.a, e); addEdge(e.b, e); }
  return {
    lane, profiles, edges, edgesByEntity, pairs, value: (a, b) => links.get(a)?.get(b), incumbents: repeatTables(w, id => profiles.get(id)),
  };
}

export interface GroupCircle { readonly members: readonly MemberId[]; readonly evidence: CircleEvidence; readonly limits: CircleLimits }

function circleLimits(lane: MatchLane, minimum: number, maximum: number): CircleLimits {
  const limits = laneLimits(lane);
  return { minimum, maximum: Math.min(maximum, limits.circleMaximum), pairFloor: limits.circlePairFloor, parityBand: limits.rules.parityBand };
}

export function poolCircles(graph: PoolGraph, forced: readonly MemberId[], minimum: number, maximum: number,
  rankCircle?: (circle: GroupCircle) => number | undefined): GroupCircle[] {
  if (!formsGroups(graph.lane)) return [];
  const limits = circleLimits(graph.lane, minimum, maximum);
  const forcedProfiles = forced.flatMap(id => { const p = graph.profiles.get(id); return p ? [p] : []; });
  if (forcedProfiles.length !== forced.length) return [];
  const open = [...graph.profiles].filter(([id]) => forced.includes(id) || forced.every(f => graph.value(f, id) !== undefined));
  const byEntity = new Map(open.map(([, p]) => [p.id, p] as const));
  const lane = laneLimits(graph.lane);
  const asGroup = (circle: Circle): GroupCircle => {
    const members = circle.members.map(id => byEntity.get(id)!.memberId);
    return { members: [...forced, ...members.filter(id => !forced.includes(id))], evidence: circle.evidence, limits };
  };
  const containsForced = (circle: Circle) => forcedProfiles.every(profile => circle.members.includes(profile.id));
  const buildLimits = { ...lane, circleMinimum: limits.minimum, circleMaximum: limits.maximum };
  const incumbents = graph.incumbents
    .map(ids => ids.filter(id => byEntity.has(id)))
    .filter(ids => forcedProfiles.every(profile => ids.includes(profile.id)));
  const subEdges = forced.length > 0 && byEntity.size < graph.profiles.size
    ? (() => {
        const seen = new Set<string>();
        const subset: MatchEdge[] = [];
        for (const entityId of byEntity.keys()) {
          for (const e of graph.edgesByEntity.get(entityId) ?? []) {
            if (!seen.has(e.key) && byEntity.has(e.a) && byEntity.has(e.b)) {
              seen.add(e.key);
              subset.push(e);
            }
          }
        }
        return subset;
      })()
    : graph.edges;
  return buildCircles(subEdges, byEntity, buildLimits, profile => profile.capacity, {
    rankCircle: rankCircle && (c => containsForced(c) ? rankCircle(asGroup(c)) : undefined), incumbents,
    forced: forcedProfiles.map(profile => profile.id),
  })
    .filter(containsForced)
    .map(asGroup);
}

export function pairCircle(graph: PoolGraph, a: MemberId, b: MemberId): GroupCircle | undefined {
  const pa = graph.profiles.get(a), pb = graph.profiles.get(b), value = graph.value(a, b);
  if (!pa || !pb || value === undefined || !formsGroups(graph.lane)) return undefined;
  const [low, high] = pa.standing < pb.standing || (pa.standing === pb.standing && pa.ordinal <= pb.ordinal) ? [pa, pb] : [pb, pa];
  return {
    members: [a, b],
    evidence: {
      size: 2, lowestPairValue: value, pairValueTotal: value, pairCount: 1,
      standingLow: low.standing, standingHigh: high.standing, uncertaintyTotal: low.uncertainty + high.uncertainty,
    },
    limits: circleLimits(graph.lane, 2, 2),
  };
}

export function chooseCircle(searching: Formation, circle: GroupCircle, hasHost: boolean): Formation {
  return step(searching, {
    type: "choosePrimary", members: [...circle.members], meetsMinimum: circle.members.length >= circle.limits.minimum,
    hasHost, circle: circle.evidence, circleLimits: circle.limits,
  });
}

export function leastMiseryUtility(fit: number, pairs: readonly number[]): number {
  const clamped = pairs.map(p => Math.max(0, Math.min(1, p)));
  const mean = mfhgMemberUtility(clamped.reduce((s, x) => s + x, 0), clamped.length + 1);
  return fit * (0.5 + 0.5 * mean);
}

export const circleKey = (members: readonly MemberId[]): string => [...members].sort(compareText).join(",");

interface Ranked { circle: GroupCircle; min: number; nsw: number; mean: number; city: City; hours: number; hasHost: boolean }

export function composeGroup(w: World, opts: ComposeOptions): ComposedGroup | null {
  const forced = opts.forced ?? [];
  const lane = groupLane(opts.category);
  const searching = step(initial, { type: "startSearch", forcedEligible: forced.every(id => !isMinor(w, id)), hostRequired: opts.needHost });
  if (searching.phase !== "Forming" || !formsGroups(lane)) return null;
  const pool = opts.pool.filter(p => poolEligible(!isMinor(w, p.id)));
  const affinity = new Map(pool.map(p => [p.id, p.affinity]));
  for (const f of forced) if (!affinity.has(f)) affinity.set(f, 0.5);
  const poolIds = pool.map(p => p.id).filter(id => !forced.includes(id));
  const hosts = new Set([...forced, ...poolIds].filter(id => groupHostEligible(w.get(id)?.isHost === true,
    forced.includes(id) && opts.forcedRole !== undefined && opts.forcedRole !== "host",
    memberReason(w, id, { category: opts.category, role: "host", format: opts.format ?? "small_group", timeSensitive: false }) === null)));
  if (opts.forcedRole === "host" && forced.some(id => !hosts.has(id))) return null;
  const graph = poolGraph(w, lane, [...forced, ...poolIds]);
  const pairOf = (a: MemberId, b: MemberId) => (graph.value(a, b) ?? 0) / pairValueScale;

  const rank = (circles: readonly GroupCircle[]): Ranked[] => circles.flatMap(circle => {
    const ids = [...circle.members];
    const ov = w.overlap(ids, opts.window.start, opts.window.end, opts.preferredCity);
    if (!groupLocationAllowed(!!ov, !!(opts.requireCity && opts.preferredCity), ov?.city === opts.preferredCity) || !ov) return [];
    const us = ids.map(id => leastMiseryUtility(Math.max(0, Math.min(1, affinity.get(id) ?? 0)), ids.filter(x => x !== id).map(x => pairOf(id, x))));
    let warmCount = 0;
    if (ids.length >= 3 && ids.every(id => !w.minors.has(id))) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (w.isWarm(ids[i]!, ids[j]!)) warmCount++;
    }
    const warmBonus = warmCount >= 1 && warmCount <= 2 ? 0.01 : 0;
    return [{
      circle,
      min: Math.min(...us),
      nsw: mfhgGeometricNsw(us) + warmBonus,
      mean: us.reduce((s, u) => s + u, 0) / us.length,
      city: ov.city,
      hours: ov.hours,
      hasHost: ids.some(id => hosts.has(id)),
    }];
  }).sort((x, y) => y.min - x.min || y.nsw - x.nsw || y.mean - x.mean || compareText(circleKey(x.circle.members), circleKey(y.circle.members)));
  const admit = (ranked: readonly Ranked[]): ComposedGroup | null => {
    for (const best of ranked) {
      let formation = chooseCircle(searching, best.circle, best.hasHost);
      if (formation.phase !== "PrimaryChosen") continue;
      const primary = formation.primary;
      const alternates = poolIds
        .flatMap(id => {
          const values = primary.map(p => graph.value(p, id));
          const known = values.flatMap(v => (v === undefined ? [] : [v]));
          const compatible = known.length === primary.length;
          const ov = compatible ? w.overlap([...primary, id], opts.window.start, opts.window.end, best.city) : null;
          const sameCityOverlap = !!ov && ov.city === best.city;
          if (!alternateAllowed(primary.includes(id), compatible, sameCityOverlap)) return [];
          return [{ id, compatible, sameCityOverlap, low: Math.min(...known), fit: affinity.get(id) ?? 0 }];
        })
        .sort((x, y) => y.low - x.low || y.fit - x.fit || compareText(x.id, y.id));
      const wanted = Math.max(0, Math.trunc(opts.alternates));
      formation = step(formation, { type: "openAlternates", alternateLimit: wanted });
      for (const alt of alternates) {
        if (formation.alternates.length >= wanted) break;
        const profile = graph.profiles.get(alt.id)!;
        const pairedWithReserved = formation.alternates.every(other => w.match.value(profile, graph.profiles.get(other)!) >= 0);
        formation = step(formation, { type: "reserveAlternate", member: alt.id, compatible: alt.compatible, sameCityOverlap: alt.sameCityOverlap, pairedWithReserved });
      }
      formation = step(formation, { type: "finishGroup" });

      const roles: Record<MemberId, Role> = {};
      let hostAssigned = opts.forcedRole === "host" && forced.length > 0;
      for (const id of primary) {
        if (opts.forcedRole && forced.includes(id)) roles[id] = opts.forcedRole;
        else if (!hostAssigned && hosts.has(id)) {
          roles[id] = "host"; hostAssigned = true;
        }
        else roles[id] = "guest";
      }
      let warm = 0;
      for (let i = 0; i < primary.length; i++) for (let j = i + 1; j < primary.length; j++) if (w.isWarm(primary[i]!, primary[j]!)) warm++;
      const { evidence } = best.circle;
      const stats: GroupStats = {
        avgPairwise: evidence.pairCount ? evidence.pairValueTotal / evidence.pairCount / pairValueScale : 0,
        minBest: Math.min(...primary.map(id => Math.max(...primary.filter(x => x !== id).map(x => pairOf(id, x))))),
        roleCoverage: best.hasHost ? 1 : 0,
        warmTies: warm,
        clusterDiversity: new Set(primary.map(id => w.get(id)!.cluster)).size / primary.length,
        overlapHours: best.hours,
      };
      return {
        primary, alternates: formation.alternates, roles, stats, city: best.city,
        lane, entities: Object.fromEntries(primary.map(id => [id, graph.profiles.get(id)!.id])),
      };
    }
    return null;
  };
  const group = admit(rank(poolCircles(graph, forced, opts.minSize, opts.maxSize)));
  if (group || !opts.needHost) return group;
  const hostProfiles = new Set<EntityId>();
  for (const h of hosts) {
    const p = graph.profiles.get(h);
    if (p) hostProfiles.add(p.id);
  }
  if (hostProfiles.size === 0) return null;
  const hostCircles = poolCircles(graph, forced, opts.minSize, opts.maxSize, c =>
    c.members.some(id => hosts.has(id)) ? c.evidence.lowestPairValue : undefined);
  return admit(rank(hostCircles));
}
