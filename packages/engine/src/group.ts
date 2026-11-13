// Group composer (Sections 14.6, 33.7): beam search over candidates for a 3-6 person group,
// maximising average pairwise compatibility, a minimum pairwise floor, role coverage, one to two
// existing warm ties (not a closed clique), cluster diversity and availability intersection.
// Produces a primary group plus ranked alternates for quorum backfill.
import type { Category, City, MemberId } from "@thenetwork/core";
import { HOUR } from "@thenetwork/core";
import {
  alternateAllowed, extensionAllowed, groupFitAllowed, groupLocationAllowed, initial, poolEligible, primaryAllowed, step,
} from "../../core/src/generated/groupFormation.ts";
import { cosine } from "./embed.ts";
import { isMinor, memberReason, pairReason } from "./filters.ts";
import type { GroupStats, Role } from "./types.ts";
import type { World } from "./world.ts";

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
  beamWidth: number; minPairwise: number; alternates: number;
}
export interface ComposedGroup {
  primary: MemberId[]; alternates: MemberId[]; roles: Record<MemberId, Role>;
  stats: GroupStats; score: number; city: City;
}

interface State { ids: MemberId[]; score: number; stats: GroupStats; city: City }

export function makeCompat(w: World, category: Category) {
  const cache = new Map<string, number>();
  return (a: MemberId, b: MemberId): number => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = cache.get(k);
    if (v === undefined) {
      if (pairReason(w, a, b, category)) v = -Infinity;
      else {
        const ma = w.get(a)!, mb = w.get(b)!;
        const shared = [...ma.tags].filter(t => mb.tags.has(t)).length;
        v = 0.5 * cosine(ma.profileEmb, mb.profileEmb) + 0.4 * cosine(ma.desireEmb, mb.desireEmb) + Math.min(0.2, 0.07 * shared);
      }
      cache.set(k, v);
    }
    return v;
  };
}

export function evaluateGroup(w: World, ids: MemberId[], opts: ComposeOptions, compat: (a: MemberId, b: MemberId) => number, affinity: Map<MemberId, number>):
  { score: number; stats: GroupStats; city: City } | null {
  let sum = 0, n = 0, warm = 0;
  const best = new Map<MemberId, number>();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const c = compat(ids[i]!, ids[j]!);
    if (c === -Infinity) return null;
    sum += c; n++;
    if (w.isWarm(ids[i]!, ids[j]!)) warm++;
    best.set(ids[i]!, Math.max(best.get(ids[i]!) ?? -1, c));
    best.set(ids[j]!, Math.max(best.get(ids[j]!) ?? -1, c));
  }
  const ov = w.overlap(ids, opts.window.start, opts.window.end, opts.preferredCity);
  if (!groupLocationAllowed(!!ov, !!(opts.requireCity && opts.preferredCity), ov?.city === opts.preferredCity)) return null;
  const overlap = ov!;
  const minBest = ids.length > 1 ? Math.min(...ids.map(id => best.get(id) ?? 0)) : 1;
  if (!groupFitAllowed(ids.length > 1, minBest < opts.minPairwise)) return null;
  const avgPairwise = n ? sum / n : 0.5;
  const hasHost = ids.some(id => w.get(id)!.isHost);
  const roleCoverage = opts.needHost ? (hasHost ? 1 : 0) : (hasHost ? 1 : 0.7);
  const warmScore = warm === 0 ? 0.3 : warm <= 2 ? 1 : Math.max(0, 1 - 0.25 * (warm - 2));
  const clusters = new Set(ids.map(id => w.get(id)!.cluster));
  const clusterDiversity = clusters.size / ids.length;
  const windowHours = Math.max(1, (opts.window.end - opts.window.start) / HOUR);
  const availability = Math.min(1, overlap.hours / Math.min(windowHours, 24));
  const aff = ids.reduce((s, id) => s + (affinity.get(id) ?? 0), 0) / ids.length;
  const score = 0.3 * avgPairwise + 0.15 * minBest + 0.15 * roleCoverage + 0.15 * warmScore + 0.1 * clusterDiversity + 0.25 * aff + 0.1 * availability;
  return { score, city: overlap.city, stats: { avgPairwise, minBest, roleCoverage, warmTies: warm, clusterDiversity, overlapHours: overlap.hours } };
}

export function composeGroup(w: World, opts: ComposeOptions): ComposedGroup | null {
  // spec/groupFormation.md, "Only eligible adults enter the group search"
  const forced = opts.forced ?? [];
  let formation = step(initial, { type: "startSearch", forcedEligible: forced.every(id => !isMinor(w, id)), hostRequired: opts.needHost });
  if (formation.phase !== "Forming") return null;
  opts = { ...opts, pool: opts.pool.filter(p => poolEligible(!isMinor(w, p.id))) };
  const compat = makeCompat(w, opts.category);
  const affinity = new Map(opts.pool.map(p => [p.id, p.affinity]));
  for (const f of forced) if (!affinity.has(f)) affinity.set(f, 0.5);
  const poolIds = opts.pool.map(p => p.id).filter(id => !forced.includes(id));
  const key = (ids: MemberId[]) => [...ids].sort().join(",");

  let beam: State[] = [];
  if (forced.length) {
    const ev = forced.length > 1 ? evaluateGroup(w, forced, opts, compat, affinity) : { score: 0, stats: undefined as any, city: opts.preferredCity ?? w.get(forced[0]!)!.m.homeCity };
    if (!ev) return null;
    beam = [{ ids: [...forced], score: ev.score, stats: ev.stats, city: ev.city }];
  } else {
    const seeds = [...poolIds].sort((a, b) => {
      const ha = opts.needHost && w.get(a)!.isHost ? 1 : 0, hb = opts.needHost && w.get(b)!.isHost ? 1 : 0;
      return (hb - ha) || ((affinity.get(b)! - affinity.get(a)!)) || (a < b ? -1 : 1);
    }).slice(0, opts.beamWidth);
    beam = seeds.map(id => ({ ids: [id], score: affinity.get(id)!, stats: undefined as any, city: w.get(id)!.m.homeCity }));
  }

  const complete: State[] = [];
  const seen = new Set<string>();
  for (let size = beam[0]?.ids.length ?? 0; size < opts.maxSize && beam.length; size++) {
    const next: State[] = [];
    for (const st of beam) {
      for (const id of poolIds) {
        const alreadyIncluded = st.ids.includes(id);
        if (!extensionAllowed(alreadyIncluded, !alreadyIncluded && st.ids.every(x => compat(x, id) !== -Infinity))) continue;
        const ids = [...st.ids, id];
        const k = key(ids);
        if (seen.has(k)) continue;
        seen.add(k);
        const ev = evaluateGroup(w, ids, opts, compat, affinity);
        if (!ev) continue;
        next.push({ ids, score: ev.score, stats: ev.stats, city: ev.city });
      }
    }
    next.sort((a, b) => (b.score - a.score) || (key(a.ids) < key(b.ids) ? -1 : 1));
    beam = next.slice(0, opts.beamWidth);
    for (const st of beam) if (st.ids.length >= opts.minSize) complete.push(st);
  }
  if (!complete.length) return null;
  // Small preference for fuller groups (quorum resilience), capped by maxSize.
  complete.sort((a, b) => ((b.score + 0.015 * b.ids.length) - (a.score + 0.015 * a.ids.length)) || (key(a.ids) < key(b.ids) ? -1 : 1));
  // spec/groupFormation.md, "A primary group has a common place and meets its requirements"
  const bestState = complete.find(s => primaryAllowed(formation, s.ids.length >= opts.minSize, s.stats.roleCoverage >= 1));
  if (!bestState) return null;
  formation = step(formation, { type: "choosePrimary", members: bestState.ids,
    meetsMinimum: bestState.ids.length >= opts.minSize, hasHost: bestState.stats.roleCoverage >= 1 });
  const primary = formation.primary;
  // Alternates: compatible with everyone, available, ranked by fit to the group + anchor.
  // spec/groupFormation.md, "An alternate can join the primary group in its city"
  const ranked = poolIds.filter(id => !primary.includes(id))
    .map(id => {
      const cs = primary.map(p => compat(p, id));
      const compatible = cs.every(c => c !== -Infinity);
      const ov = compatible ? w.overlap([...primary, id], opts.window.start, opts.window.end, bestState.city) : null;
      if (!alternateAllowed(false, compatible, !!ov && ov.city === bestState.city)) return null;
      return { id, s: cs.reduce((a, b) => a + b, 0) / cs.length + (affinity.get(id) ?? 0) };
    })
    .filter((x): x is { id: MemberId; s: number } => !!x)
    .sort((a, b) => (b.s - a.s) || (a.id < b.id ? -1 : 1));
  // Preserve Array.slice's negative and fractional limit behavior for custom engine configs.
  const limit = opts.alternates === undefined ? ranked.length : Math.trunc(opts.alternates) || 0;
  const alternateLimit = limit < 0 ? Math.max(0, ranked.length + limit) : Math.min(limit, ranked.length);
  formation = step(formation, { type: "openAlternates", alternateLimit });
  for (let i = 0; i < alternateLimit; i++) {
    formation = step(formation, { type: "reserveAlternate", member: ranked[i]!.id });
  }
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
  return { primary, alternates: formation.alternates, roles, stats: bestState.stats, score: bestState.score, city: bestState.city };
}
