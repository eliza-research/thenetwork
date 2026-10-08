// Geo models (AppPack.geo). `cityBucketGeo` is the city-bucket model moved verbatim from world.ts
// (location / overlap) and scoring.ts (shared-area activation cost): members are in a city (home,
// routine, or a dated trip that overrides home) and can meet when they share enough hours in one
// run city. The Network and friends.help use it. A radius model (slop.date: within X miles of a zip
// or point, mutual radius) implements the same interface plus `pairReason` / `displayDistance`.
import type { City, MemberId, Presence } from "@thenetwork/core";
import { HOUR } from "@thenetwork/core";
import type { GeoModel } from "./pack.ts";
import { intersect, subtract, union, type Interval } from "./interval.ts";
import type { World } from "./world.ts";

export const cityBucketGeo: GeoModel = {
  kind: "city",
  markets: cfg => cfg.cities,
  tz: (market, cfg) => cfg.timezones[market],

  /** Where a member is during [start,end): city -> intervals. Temporary presence overrides home (ME-011). */
  location(w: World, id: MemberId, start: number, end: number): Map<City, Interval[]> {
    const mi = w.members.get(id);
    const out = new Map<City, Interval[]>();
    if (!mi) return out;
    const base = new Set<City>([mi.m.homeCity]);
    const dated: Presence[] = [];
    for (const p of mi.presence) {
      if (p.from === undefined && p.to === undefined && p.type !== "temporary") base.add(p.city);
      else dated.push(p);
    }
    for (const c of base) out.set(c, [[start, end]]);
    for (const p of dated) {
      const s = Math.max(start, p.from ?? start), e = Math.min(end, p.to ?? end);
      if (e <= s) continue;
      for (const [c, ivs] of out) if (c !== p.city) out.set(c, subtract(ivs, [s, e]));
      out.set(p.city, union([...(out.get(p.city) ?? []), [s, e]]));
    }
    for (const [c, ivs] of out) if (!ivs.length) out.delete(c);
    return out;
  },

  /** Common availability of all members in one city (prefers `preferred`, else largest overlap). */
  overlap(w: World, ids: MemberId[], start: number, end: number, preferred?: City): { city: City; intervals: Interval[]; hours: number } | null {
    const locs = ids.map(id => w.locationCached(id, start, end));
    let best: { city: City; intervals: Interval[]; hours: number } | null = null;
    for (const city of w.cfg.cities) {
      let ivs: Interval[] = [[start, end]];
      for (const l of locs) { ivs = intersect(ivs, l.get(city) ?? []); if (!ivs.length) break; }
      const hours = ivs.reduce((s, [a, b]) => s + (b - a), 0) / HOUR;
      const required = Math.min(w.cfg.minOverlapHours, ((end - start) / HOUR) * 0.99);
      if (hours <= 0 || hours < required) continue;
      const bonus = city === preferred ? 1e6 : 0;
      if (!best || hours + bonus > best.hours + (best.city === preferred ? 1e6 : 0)) best = { city, intervals: ivs, hours };
    }
    return best;
  },

  /** Activation cost input: every member lists one common area (neighbourhood) in the configuration's city. */
  sharesArea(w: World, ids: MemberId[], market: City | undefined): boolean {
    const areasOf = (id: MemberId) => new Set(w.get(id)!.presence.filter(p => p.city === market).flatMap(p => p.areas));
    const areaSets = ids.map(areasOf);
    return areaSets.length > 1 && [...areaSets[0]!].some(a => areaSets.every(s => s.has(a)));
  },
};
