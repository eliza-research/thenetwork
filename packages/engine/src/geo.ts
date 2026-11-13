// Geo models (AppPack.geo). `cityBucketGeo` is the city-bucket model moved verbatim from world.ts
// (location / overlap) and scoring.ts (shared-area activation cost): members are in a city (home,
// routine, or a dated trip that overrides home) and can meet when they share enough hours in one
// run city. The Network and friends.help use it. A radius model (slop.date: within X miles of a zip
// or point, mutual radius) implements the same interface plus `pairReason` / `displayDistance`.
import type { City, MemberId, Presence, Proposal } from "@thenetwork/core";
import { HOUR } from "@thenetwork/core";
import type { GeoModel } from "./pack.ts";
import { intersect, subtract, union, type Interval } from "./interval.ts";
import type { World } from "./world.ts";

export const cityBucketGeo: GeoModel = {
  kind: "city",
  markets: cfg => cfg.cities,
  tz: (market, cfg) => cfg.timezones[market] ?? "UTC",

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

  /** Activation cost input: all members can be in one area at the same time inside the meeting window. */
  sharesArea(w: World, ids: MemberId[], market: City | undefined, window?: Proposal["window"]): boolean {
    if (ids.length < 2) return false;
    const start = window?.start ?? w.now, end = window?.end ?? start + 1;
    const areasOf = (id: MemberId) => {
      const areas = new Map<string, Interval[]>(), dated: Presence[] = [];
      const add = (p: Presence, s: number, e: number) => {
        if (p.city === market) for (const area of p.areas) areas.set(area, union([...(areas.get(area) ?? []), [s, e]]));
      };
      for (const p of w.get(id)!.presence) {
        if (p.from === undefined && p.to === undefined && p.type !== "temporary") add(p, start, end);
        else dated.push(p);
      }
      for (const p of dated) {
        const s = Math.max(start, p.from ?? start), e = Math.min(end, p.to ?? end);
        if (e <= s) continue;
        // A dated visit overrides home/routine areas during that interval, including within one city.
        for (const [area, intervals] of areas) areas.set(area, subtract(intervals, [s, e]));
        add(p, s, e);
      }
      return areas;
    };
    const locations = ids.map(areasOf);
    for (const [area, intervals] of locations[0]!) {
      let common = intervals;
      for (const location of locations.slice(1)) common = intersect(common, location.get(area) ?? []);
      if (common.length) return true;
    }
    return false;
  },
};
