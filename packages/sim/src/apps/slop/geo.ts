// Location for slop.date: home zip codes with their centroids, distances in miles, and the
// bucketed distances that are the only distances a member is ever shown.
//
// Privacy rule (research grounding, "location privacy"): the Network stores a zip centroid (or H3
// cells), never an address or a GPS fix, and shows a bucketed distance only. The table is slopPack's
// (packages/engine/src/packs/slop/zips.ts: US Census 2020 ZCTA gazetteer internal points for NYC's
// five boroughs, San Francisco and Greater Los Angeles; source and coverage documented there), so
// the world and the engine always agree. Personas draw their home zip from SIM_HOME_ZIPS (the
// original 53-zip table), which keeps seeded worlds unchanged as the lookup table grows.
import { SIM_HOME_ZIPS, ZIPS as ENGINE_ZIPS } from "@thenetwork/engine/src/packs/slop/zips.ts";

export type SlopCity = "sf" | "nyc" | "la";
export const SLOP_CITIES: readonly SlopCity[] = ["sf", "nyc", "la"];

export interface ZipInfo { zip: string; city: SlopCity; area: string; lat: number; lon: number }

export const ZIPS: readonly ZipInfo[] = ENGINE_ZIPS.map(z => ({ zip: z.zip, city: z.market as SlopCity, area: z.area, lat: z.lat, lon: z.lon }));

export const zipInfo = new Map(ZIPS.map(z => [z.zip, z]));
/** The home zips personas in `city` are drawn from (SIM_HOME_ZIPS, in their original order). */
export const zipsIn = (city: SlopCity): ZipInfo[] => SIM_HOME_ZIPS.map(z => zipInfo.get(z)!).filter(z => z.city === city);
/** Every known zip in `city` (the full lookup table). */
export const allZipsIn = (city: SlopCity): ZipInfo[] => ZIPS.filter(z => z.city === city);
/** The zip a visitor to `city` is assumed to meet in (downtown core); used for multi-city members and travelers. */
export const CITY_ANCHOR_ZIP: Record<SlopCity, string> = { sf: "94103", nyc: "10003", la: "90026" };

/** Great-circle distance in miles between two zip centroids (Infinity for an unknown zip). */
export function zipMiles(a: string, b: string): number {
  const A = zipInfo.get(a), B = zipInfo.get(b);
  if (!A || !B) return Infinity;
  if (a === b) return 0;
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (B.lat - A.lat) * rad, dLon = (B.lon - A.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type DistanceBucket = "under 2 mi" | "2-5 mi" | "5-10 mi" | "10-25 mi" | "25+ mi";
/** The only distance a member is shown. */
export function distanceBucket(miles: number): DistanceBucket {
  return miles < 2 ? "under 2 mi" : miles < 5 ? "2-5 mi" : miles < 10 ? "5-10 mi" : miles < 25 ? "10-25 mi" : "25+ mi";
}
