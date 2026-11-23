// slopPack geo (AppPack.geo, kind "radius"): one city, several cities, or within X miles of a zip,
// holding BOTH ways (PRD 40.5). Members are placed on coarse cells snapped from their zip centroid
// (zips.ts); a visitor to another market is placed at that market's anchor cell. A pair can meet in a
// market both date in this week when the cell distance plus a safety margin is within BOTH members'
// limits: d <= min(rA, rB). Potential meeting windows use the shared presence intervals
// in those markets. Members only ever see a distance band ("2-5 mi").
import { sharedDatingMarket, withinMutualRadius, type City, type MemberId } from "@thenetwork/core";
import { cityBucketGeo, overlapInMarkets } from "../../geo.ts";
import type { GeoModel } from "../../pack.ts";
import type { World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import { cellIn, datingMarkets, slopProfiles, type SlopProfile } from "./profile.ts";
import { cellMiles } from "./zips.ts";

/** A member's distance limit in miles: radius scope, else their stated max, else the configured default (asks off). */
export function limitMiles(p: SlopProfile, o: SlopPackOptions): number | undefined {
  if (p.scope?.mode === "radius") return p.scope.miles;
  if (p.maxMiles !== undefined) return p.maxMiles;
  if (!o.asks) return o.unknownDefaults.maxMiles;
  return o.silentFallback.enabled && p.silentAsks.includes("distance") ? o.silentFallback.maxMiles : undefined;
}

/** Markets where a and b can meet inside both radii, best (closest) first, with the cell distance. */
export function mutualMarkets(a: SlopProfile, b: SlopProfile, o: SlopPackOptions, markets: readonly City[]): { market: City; miles: number }[] {
  const la = limitMiles(a, o), lb = limitMiles(b, o);
  if (la === undefined || lb === undefined) return [];
  const mb = datingMarkets(b);
  const out: { market: City; miles: number }[] = [];
  for (const m of datingMarkets(a)) {
    // spec/datingRadius.md, "A meeting market must be available to both members"
    if (!sharedDatingMarket(true, mb.includes(m), markets.includes(m))) continue;
    const d = cellMiles(cellIn(a, m), cellIn(b, m));
    // spec/datingRadius.md, "The distance and margin must fit both members' limits"
    if (withinMutualRadius(d, o.radiusMargin, la, lb)) out.push({ market: m, miles: d });
  }
  return out.sort((x, y) => (x.miles - y.miles) || (x.market < y.market ? -1 : 1));
}

export function makeRadiusGeo(o: SlopPackOptions): GeoModel {
  const prof = (w: World) => slopProfiles(w.input);
  return {
    markets: cfg => cfg.cities,
    location: (w, id, start, end) => cityBucketGeo.location(w, id, start, end),
    overlap(w, ids, start, end, preferred) {
      const profiles = prof(w);
      let markets = w.cfg.cities;
      for (let i = 0; i < ids.length - 1; i++) {
        const a = profiles.get(ids[i]!);
        for (let j = i + 1; j < ids.length; j++) {
          const b = profiles.get(ids[j]!);
          if (!a || !b) return null;
          const eligible = new Set(mutualMarkets(a, b, o, markets).map(entry => entry.market));
          markets = markets.filter(market => eligible.has(market));
          if (!markets.length) return null;
        }
      }
      return overlapInMarkets(w, ids, start, end, markets, preferred);
    },
    /** Same coarse cell (activation cost). */
    sharesArea(w: World, ids: MemberId[], market: City | undefined): boolean {
      if (!market || ids.length < 2) return false;
      const P = prof(w);
      const cells = ids.map(id => { const p = P.get(id); return p ? cellIn(p, market)?.id : undefined; });
      return !!cells[0] && cells.every(c => c === cells[0]);
    },
    /** Mutual radius (symmetric): some market both date in, inside both limits. */
    pairReason(w: World, a: MemberId, b: MemberId): string | null {
      const P = prof(w);
      const pa = P.get(a), pb = P.get(b);
      if (!pa || !pb) return "unknown_member";
      if (limitMiles(pa, o) === undefined || limitMiles(pb, o) === undefined) return "distance_unknown";
      return mutualMarkets(pa, pb, o, w.pack.geo.markets(w.cfg)).length ? null : "outside_radius";
    },
  };
}
