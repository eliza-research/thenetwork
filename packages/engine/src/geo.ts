// Geo models (AppPack.geo). `cityBucketGeo` is the city-bucket model moved verbatim from world.ts
// (location / overlap) and scoring.ts (shared-area activation cost): members are in a city (home,
// routine, or a dated trip that overrides home) and can meet when they share enough hours in one
// run city. The Network and friends.help use it. A radius model (slop.date: within X miles of a zip
// or point, mutual radius) implements the same interface plus `pairReason`.
import type { City, MemberId, Presence } from "@thenetwork/core";
import { HOUR, temporaryPresenceWindow } from "@thenetwork/core";
import { presenceWindowsOverlap, presenceWindowValid } from "../../core/src/generated/travelPresence.ts";
import type { GeoModel, GeoOverlap } from "./pack.ts";
import { intersect, subtract, union, type Interval } from "./interval.ts";
import type { World } from "./world.ts";

export const cityBucketGeo: GeoModel = {
  markets: cfg => cfg.cities,

  /** Where a member is during [start,end): city -> intervals. Temporary presence overrides home (ME-011). */
  location(w: World, id: MemberId, start: number, end: number): Map<City, Interval[]> {
    const mi = w.members.get(id);
    const out = new Map<City, Interval[]>();
    const requested = { from: start, to: end };
    if (!mi || !presenceWindowValid(requested)) return out;
    const base = new Set<City>([mi.m.homeCity]);
    const dated: Presence[] = [];
    for (const p of mi.presence) {
      if (p.from === undefined && p.to === undefined && p.type !== "temporary") base.add(p.city);
      else dated.push(p);
    }
    for (const c of base) out.set(c, [[start, end]]);
    for (const p of dated) {
      const available = p.type === "temporary" ? temporaryPresenceWindow(p) : { from: p.from ?? start, to: p.to ?? end };
      if (!available || !presenceWindowsOverlap(available, requested)) continue;
      const s = Math.max(start, available.from), e = Math.min(end, available.to);
      for (const [c, ivs] of out) if (c !== p.city) out.set(c, subtract(ivs, [s, e]));
      out.set(p.city, union([...(out.get(p.city) ?? []), [s, e]]));
    }
    for (const [c, ivs] of out) if (!ivs.length) out.delete(c);
    return out;
  },

  /** Common availability of all members in one city (prefers `preferred`, else largest overlap). */
  overlap: (w, ids, start, end, preferred) => overlapInMarkets(w, ids, start, end, w.cfg.cities, preferred),

  /** Activation cost input: every member lists one common area (neighbourhood) in the configuration's city. */
  sharesArea(w: World, ids: MemberId[], market: City | undefined): boolean {
    const areasOf = (id: MemberId) => new Set(w.get(id)!.presence.filter(p => p.city === market).flatMap(p => p.areas));
    const areaSets = ids.map(areasOf);
    return areaSets.length > 1 && [...areaSets[0]!].some(a => areaSets.every(s => s.has(a)));
  },
};

/** Find shared presence within the markets the pack permits for this proposal. */
export function overlapInMarkets(w: World, ids: MemberId[], start: number, end: number, markets: readonly City[], preferred?: City): GeoOverlap | null {
  if (markets.length === 0) return null;
  const locs = ids.map(id => w.locationCached(id, start, end));
  const required = Math.min(w.cfg.minOverlapHours, ((end - start) / HOUR) * 0.99);
  let best: GeoOverlap | null = null;
  for (const city of markets) {
    let ivs: Interval[] = [[start, end]];
    for (const l of locs) { ivs = intersect(ivs, l.get(city) ?? []); if (!ivs.length) break; }
    const hours = ivs.reduce((s, [a, b]) => s + (b - a), 0) / HOUR;
    if (hours <= 0 || hours < required) continue;
    const bonus = city === preferred ? 1e6 : 0;
    if (!best || hours + bonus > best.hours + (best.city === preferred ? 1e6 : 0)) best = { city, intervals: ivs, hours };
  }
  return best;
}
