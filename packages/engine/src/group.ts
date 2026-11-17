// Group composer (Sections 14.6, 33.7): the coherent circles of a candidate pool, built by the one
// circle builder (match/circles.ts) from the lane's bounded search edges, ranked by least misery and
// admitted through the generated groupFormation machine. Produces a primary group plus ranked
// alternates for quorum backfill.
import type { Category, City, MemberId } from "@thenetwork/core";
import {
  alternateAllowed, groupLocationAllowed, initial, poolEligible, step,
  type CircleEvidence, type CircleLimits, type Formation,
} from "../../core/src/generated/groupFormation.ts";
import { laneLimits, laneShape, type MatchLane } from "../../core/src/generated/matchLane.ts";
import { pairValueScale } from "../../core/src/generated/pairValue.ts";
import { isMinor, memberReason } from "./filters.ts";
import { buildCircles } from "./match/circles.ts";
import { compareText, type EntityId, type MatchProfile } from "./match/profile.ts";
import { mutualEdges, type MatchEdge } from "./match/search.ts";
import type { GroupStats, Role } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export interface ComposeOptions {
  /** Ordered candidate pool (already member-eligible), with anchor affinity per member. */
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
export interface ComposedGroup {
  primary: MemberId[]; alternates: MemberId[]; roles: Record<MemberId, Role>;
  stats: GroupStats; city: City;
  lane: MatchLane; entities: Record<MemberId, EntityId>;
}

/** The lane a group or plan category forms circles in. */
export function groupLane(category: Category): MatchLane {
  return category === "romance" ? "Date" : category === "professional" ? "Intro" : "Friend";
}

/** Only a Peers lane with a circle maximum forms groups: never romance, never a two-sided lane. */
export const formsGroups = (lane: MatchLane): boolean => laneShape(lane) === "Peers" && laneLimits(lane).circleMaximum > 0;

/** A pool's lane profiles and eligible edges. */
export interface PoolGraph {
  readonly lane: MatchLane;
  readonly profiles: ReadonlyMap<MemberId, MatchProfile>;
  readonly edges: readonly MatchEdge[];
  /** Member pairs of `edges`, best value first. */
  readonly pairs: readonly { readonly a: MemberId; readonly b: MemberId; readonly value: number }[];
  /** The value of an edge in this pool. */
  value(a: MemberId, b: MemberId): number | undefined;
}

type PoolPairScore = (a: MatchProfile, b: MatchProfile, key: string) => number | undefined;

/** Check each unordered pair in a pool whose size is bounded by its caller. */
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

/** Use bounded discovery searches, or score the pairs directly when a caller has a bounded slot pool. */
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
  return { lane, profiles, edges, pairs, value: (a, b) => links.get(a)?.get(b) };
}

/** A circle of pool members with the evidence and limits that admit it (spec/groupFormation.md). */
export interface GroupCircle { readonly members: readonly MemberId[]; readonly evidence: CircleEvidence; readonly limits: CircleLimits }

// spec/groupFormation.md, "A primary circle values every pair and keeps a narrow standing spread":
// a caller of its own size passes its own minimum and maximum.
function circleLimits(lane: MatchLane, minimum: number, maximum: number): CircleLimits {
  const limits = laneLimits(lane);
  return { minimum, maximum: Math.min(maximum, limits.circleMaximum), pairFloor: limits.circlePairFloor, parityBand: limits.rules.parityBand };
}

/** Coherent circles of `minimum`..`maximum` pool members that contain every forced member; disjoint, deterministic. */
export function poolCircles(graph: PoolGraph, forced: readonly MemberId[], minimum: number, maximum: number): GroupCircle[] {
  if (!formsGroups(graph.lane)) return [];
  const limits = circleLimits(graph.lane, minimum, maximum);
  const forcedProfiles = forced.flatMap(id => { const p = graph.profiles.get(id); return p ? [p] : []; });
  if (forcedProfiles.length !== forced.length) return [];
  const open = [...graph.profiles].filter(([id]) => forced.includes(id) || forced.every(f => graph.value(f, id) !== undefined));
  const byEntity = new Map(open.map(([, p]) => [p.id, p] as const));
  const lane = laneLimits(graph.lane);
  const circles = buildCircles(graph.edges, byEntity,
    { ...lane, circleMinimum: limits.minimum, circleMaximum: limits.maximum }, profile => profile.capacity);
  return circles
    .filter(c => forcedProfiles.every(f => c.members.includes(f.id)))
    .map(c => {
      const members = c.members.map(id => byEntity.get(id)!.memberId);
      return { members: [...forced, ...members.filter(id => !forced.includes(id))], evidence: c.evidence, limits };
    });
}

/** The pair of two pool members as a circle of two (an activity-partner plan), when they share an edge. */
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

/** spec/groupFormation.md, "A primary group has a common place and meets its requirements": choose the circle. */
export function chooseCircle(searching: Formation, circle: GroupCircle, hasHost: boolean): Formation {
  return step(searching, {
    type: "choosePrimary", members: [...circle.members], meetsMinimum: circle.members.length >= circle.limits.minimum,
    hasHost, circle: circle.evidence, circleLimits: circle.limits,
  });
}

/** u_i = fit_i x (0.5 + 0.5 x mean_j pair(i, j)), each pair clamped to [0, 1]: the least-misery member utility. */
export function leastMiseryUtility(fit: number, pairs: readonly number[]): number {
  const clamped = pairs.map(p => Math.max(0, Math.min(1, p)));
  const mean = clamped.length ? clamped.reduce((s, x) => s + x, 0) / clamped.length : 0;
  return fit * (0.5 + 0.5 * mean);
}

/** The order-free key of a circle's members: sorted ids, comma-joined. */
export const circleKey = (members: readonly MemberId[]): string => [...members].sort(compareText).join(",");

interface Ranked { circle: GroupCircle; min: number; mean: number; city: City; hours: number; hasHost: boolean }

export function composeGroup(w: World, opts: ComposeOptions): ComposedGroup | null {
  // spec/groupFormation.md, "Only eligible adults enter the group search"
  const forced = opts.forced ?? [];
  const lane = groupLane(opts.category);
  const searching = step(initial, { type: "startSearch", forcedEligible: forced.every(id => !isMinor(w, id)), hostRequired: opts.needHost });
  if (searching.phase !== "Forming" || !formsGroups(lane)) return null;
  const pool = opts.pool.filter(p => poolEligible(!isMinor(w, p.id)));
  const affinity = new Map(pool.map(p => [p.id, p.affinity]));
  for (const f of forced) if (!affinity.has(f)) affinity.set(f, 0.5);
  const poolIds = pool.map(p => p.id).filter(id => !forced.includes(id));
  const graph = poolGraph(w, lane, [...forced, ...poolIds]);
  const pairOf = (a: MemberId, b: MemberId) => (graph.value(a, b) ?? 0) / pairValueScale;

  const rank = (circles: readonly GroupCircle[]): Ranked[] => circles.flatMap(circle => {
    const ids = [...circle.members];
    const ov = w.overlap(ids, opts.window.start, opts.window.end, opts.preferredCity);
    if (!groupLocationAllowed(!!ov, !!(opts.requireCity && opts.preferredCity), ov?.city === opts.preferredCity) || !ov) return [];
    const us = ids.map(id => leastMiseryUtility(Math.max(0, Math.min(1, affinity.get(id) ?? 0)), ids.filter(x => x !== id).map(x => pairOf(id, x))));
    return [{
      circle, min: Math.min(...us), mean: us.reduce((s, u) => s + u, 0) / us.length,
      city: ov.city, hours: ov.hours, hasHost: ids.some(id => w.get(id)!.isHost),
    }];
  }).sort((x, y) => y.min - x.min || y.mean - x.mean || compareText(circleKey(x.circle.members), circleKey(y.circle.members)));
  const admit = (ranked: readonly Ranked[]): ComposedGroup | null => {
    for (const best of ranked) {
      let formation = chooseCircle(searching, best.circle, best.hasHost);
      if (formation.phase !== "PrimaryChosen") continue;
      const primary = formation.primary;
      // spec/groupFormation.md, "An alternate can join the primary group in its city"
      const alternates = poolIds
        .flatMap(id => {
          const values = primary.map(p => graph.value(p, id));
          const known = values.flatMap(v => (v === undefined ? [] : [v]));
          const compatible = known.length === primary.length;
          const ov = compatible ? w.overlap([...primary, id], opts.window.start, opts.window.end, best.city) : null;
          if (!alternateAllowed(primary.includes(id), compatible, !!ov && ov.city === best.city)) return [];
          return [{ id, low: Math.min(...known), fit: affinity.get(id) ?? 0 }];
        })
        .sort((x, y) => y.low - x.low || y.fit - x.fit || compareText(x.id, y.id));
      // In that order, an alternate is kept only with a pair value (the one pair gate) with every
      // alternate kept before it, so any backfill values every pair (spec/groupFormation.md).
      const wanted = Math.max(0, Math.trunc(opts.alternates));
      const kept: MemberId[] = [];
      for (const alt of alternates) {
        if (kept.length >= wanted) break;
        const profile = graph.profiles.get(alt.id)!;
        if (kept.every(other => w.match.value(profile, graph.profiles.get(other)!) >= 0)) kept.push(alt.id);
      }
      formation = step(formation, { type: "openAlternates", alternateLimit: kept.length });
      for (const id of kept) formation = step(formation, { type: "reserveAlternate", member: id });
      formation = step(formation, { type: "finishGroup" });

      const roles: Record<MemberId, Role> = {};
      let hostAssigned = false;
      for (const id of primary) {
        if (opts.forcedRole && forced.includes(id)) roles[id] = opts.forcedRole;
        else if (!hostAssigned && w.get(id)!.isHost && !memberReason(w, id, { category: opts.category, role: "host", format: opts.format ?? "small_group", timeSensitive: false })) {
          roles[id] = "host"; hostAssigned = true;
        }
        else roles[id] = "guest";
      }
      let warm = 0;
      for (let i = 0; i < primary.length; i++) for (let j = i + 1; j < primary.length; j++) if (w.isWarm(primary[i], primary[j])) warm++;
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
  // Each member lands in at most one circle, so when no circle without a host can serve, try again
  // with each pool host forced in, in pool order (each call stays within the pool's search edges).
  const group = admit(rank(poolCircles(graph, forced, opts.minSize, opts.maxSize)));
  if (group || !opts.needHost) return group;
  for (const host of poolIds) {
    if (!w.get(host)!.isHost) continue;
    const hosted = admit(rank(poolCircles(graph, [...forced, host], opts.minSize, opts.maxSize)));
    if (hosted) return hosted;
  }
  return null;
}
