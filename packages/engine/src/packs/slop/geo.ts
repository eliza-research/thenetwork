// slopPack geo (AppPack.geo, kind "radius"): one city, several cities, or within X miles of a zip,
// holding BOTH ways (PRD 40.5). Members are placed on coarse cells snapped from their zip centroid
// (zips.ts); a visitor to another market is placed at that market's anchor cell. A pair can meet in a
// market both date in this week when the cell distance plus a safety margin is within BOTH members'
// limits: d <= min(rA, rB). Time overlap (presence, trips, multi-city routines) is the core
// city-bucket model, unchanged. Members only ever see a distance band ("2-5 mi").
import type { City, MemberId } from "@thenetwork/core";
import { cityBucketGeo } from "../../geo.ts";
import type { GeoModel } from "../../pack.ts";
import type { World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import { cellIn, datingMarkets, slopProfiles, type SlopProfile } from "./profile.ts";
import { cellMiles, distanceBand } from "./zips.ts";

/** A member's distance limit in miles: radius scope, else their stated max, else the configured default (asks off). */
export function limitMiles(p: SlopProfile, o: SlopPackOptions): number | undefined {
  if (p.scope?.mode === "radius") return p.scope.miles;
  if (p.maxMiles !== undefined) return p.maxMiles;
  if (!o.asks) return o.unknownDefaults.maxMiles;
  return p.silentAsks.includes("distance") ? o.silentFallback.maxMiles : undefined;
}

/** Markets where a and b can meet inside both radii, best (closest) first, with the cell distance. */
export function mutualMarkets(a: SlopProfile, b: SlopProfile, o: SlopPackOptions, markets: readonly City[]): { market: City; miles: number }[] {
  const la = limitMiles(a, o), lb = limitMiles(b, o);
  if (la === undefined || lb === undefined) return [];
  const lim = Math.min(la, lb);
  const mb = datingMarkets(b);
  const out: { market: City; miles: number }[] = [];
  for (const m of datingMarkets(a)) {
    if (!mb.includes(m) || !markets.includes(m)) continue;
    const d = cellMiles(cellIn(a, m), cellIn(b, m));
    if (d + o.radiusMargin <= lim) out.push({ market: m, miles: d });
  }
  return out.sort((x, y) => (x.miles - y.miles) || (x.market < y.market ? -1 : 1));
}

export function makeRadiusGeo(o: SlopPackOptions): GeoModel {
  const prof = (w: World) => slopProfiles(w.input, w.canonical);
  return {
    kind: "radius",
    markets: cfg => cfg.cities,
    tz: (market, cfg) => cfg.timezones[market] ?? "UTC",
    location: (w, id, start, end) => cityBucketGeo.location(w, id, start, end),
    overlap: (w, ids, start, end, preferred) => cityBucketGeo.overlap(w, ids, start, end, preferred),
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
    displayDistance: km => distanceBand(km / 1.609344),
  };
}
