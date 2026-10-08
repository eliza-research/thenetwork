// Zip centroids for slopPack's radius geo (slop.date: "within X miles of a zip"). PRD 40.5 / research
// "location privacy": the Network stores a zip, matches on a COARSE CELL derived from the zip
// centroid (never an address or a GPS fix), and shows distance only as a band ("2-5 mi").
//
// The table covers the three launch metros (approximate ZCTA centroids, US Census 2020 gazetteer,
// rounded to about 0.005 degrees; the same values as the slop world, packages/worlds/src/slop/geo.ts,
// and a test keeps them equal). Production swaps in a full zip table behind `zipCentroid`.
import type { City } from "@thenetwork/core";

export interface ZipCentroid { zip: string; market: City; area: string; lat: number; lon: number }

export const ZIPS: readonly ZipCentroid[] = [
  // San Francisco Bay Area
  { zip: "94102", market: "sf", area: "Tenderloin / Hayes Valley", lat: 37.7795, lon: -122.4193 },
  { zip: "94103", market: "sf", area: "SoMa", lat: 37.7726, lon: -122.4110 },
  { zip: "94107", market: "sf", area: "Potrero Hill / Dogpatch", lat: 37.7621, lon: -122.3971 },
  { zip: "94109", market: "sf", area: "Nob Hill / Polk Gulch", lat: 37.7929, lon: -122.4212 },
  { zip: "94110", market: "sf", area: "Mission / Bernal Heights", lat: 37.7485, lon: -122.4153 },
  { zip: "94114", market: "sf", area: "Castro / Noe Valley", lat: 37.7583, lon: -122.4351 },
  { zip: "94115", market: "sf", area: "Western Addition", lat: 37.7856, lon: -122.4370 },
  { zip: "94117", market: "sf", area: "Haight-Ashbury", lat: 37.7700, lon: -122.4447 },
  { zip: "94118", market: "sf", area: "Inner Richmond", lat: 37.7812, lon: -122.4614 },
  { zip: "94122", market: "sf", area: "Inner Sunset", lat: 37.7590, lon: -122.4848 },
  { zip: "94123", market: "sf", area: "Marina", lat: 37.8003, lon: -122.4383 },
  { zip: "94133", market: "sf", area: "North Beach", lat: 37.8002, lon: -122.4097 },
  { zip: "94612", market: "sf", area: "Downtown Oakland", lat: 37.8102, lon: -122.2697 },
  { zip: "94610", market: "sf", area: "Grand Lake, Oakland", lat: 37.8124, lon: -122.2405 },
  { zip: "94704", market: "sf", area: "Berkeley", lat: 37.8664, lon: -122.2573 },
  { zip: "94301", market: "sf", area: "Palo Alto", lat: 37.4442, lon: -122.1500 },
  { zip: "94040", market: "sf", area: "Mountain View", lat: 37.3800, lon: -122.0850 },
  // New York City metro
  { zip: "10001", market: "nyc", area: "Chelsea / Hudson Yards", lat: 40.7506, lon: -73.9972 },
  { zip: "10002", market: "nyc", area: "Lower East Side", lat: 40.7157, lon: -73.9863 },
  { zip: "10003", market: "nyc", area: "East Village", lat: 40.7318, lon: -73.9891 },
  { zip: "10011", market: "nyc", area: "Chelsea", lat: 40.7419, lon: -74.0007 },
  { zip: "10014", market: "nyc", area: "West Village", lat: 40.7340, lon: -74.0054 },
  { zip: "10016", market: "nyc", area: "Murray Hill", lat: 40.7452, lon: -73.9783 },
  { zip: "10023", market: "nyc", area: "Upper West Side", lat: 40.7764, lon: -73.9827 },
  { zip: "10025", market: "nyc", area: "Morningside / UWS", lat: 40.7987, lon: -73.9665 },
  { zip: "10027", market: "nyc", area: "Harlem", lat: 40.8115, lon: -73.9532 },
  { zip: "10028", market: "nyc", area: "Upper East Side", lat: 40.7764, lon: -73.9530 },
  { zip: "11201", market: "nyc", area: "Brooklyn Heights", lat: 40.6943, lon: -73.9903 },
  { zip: "11211", market: "nyc", area: "Williamsburg", lat: 40.7128, lon: -73.9530 },
  { zip: "11215", market: "nyc", area: "Park Slope", lat: 40.6681, lon: -73.9860 },
  { zip: "11216", market: "nyc", area: "Bed-Stuy", lat: 40.6806, lon: -73.9493 },
  { zip: "11222", market: "nyc", area: "Greenpoint", lat: 40.7290, lon: -73.9480 },
  { zip: "11238", market: "nyc", area: "Prospect Heights", lat: 40.6795, lon: -73.9636 },
  { zip: "11101", market: "nyc", area: "Long Island City", lat: 40.7440, lon: -73.9380 },
  { zip: "11375", market: "nyc", area: "Forest Hills", lat: 40.7210, lon: -73.8466 },
  { zip: "07302", market: "nyc", area: "Jersey City", lat: 40.7196, lon: -74.0460 },
  // Los Angeles metro
  { zip: "90004", market: "la", area: "Larchmont / Koreatown", lat: 34.0763, lon: -118.3089 },
  { zip: "90012", market: "la", area: "Chinatown / Civic Center", lat: 34.0614, lon: -118.2386 },
  { zip: "90013", market: "la", area: "Downtown LA", lat: 34.0448, lon: -118.2418 },
  { zip: "90026", market: "la", area: "Echo Park", lat: 34.0766, lon: -118.2646 },
  { zip: "90027", market: "la", area: "Los Feliz", lat: 34.1040, lon: -118.2930 },
  { zip: "90028", market: "la", area: "Hollywood", lat: 34.0996, lon: -118.3270 },
  { zip: "90034", market: "la", area: "Palms", lat: 34.0306, lon: -118.3995 },
  { zip: "90036", market: "la", area: "Mid-Wilshire / Fairfax", lat: 34.0700, lon: -118.3490 },
  { zip: "90039", market: "la", area: "Silver Lake / Atwater", lat: 34.1117, lon: -118.2610 },
  { zip: "90042", market: "la", area: "Highland Park", lat: 34.1148, lon: -118.1918 },
  { zip: "90046", market: "la", area: "West Hollywood", lat: 34.1075, lon: -118.3650 },
  { zip: "90066", market: "la", area: "Mar Vista", lat: 34.0030, lon: -118.4300 },
  { zip: "90291", market: "la", area: "Venice", lat: 33.9930, lon: -118.4630 },
  { zip: "90401", market: "la", area: "Santa Monica", lat: 34.0160, lon: -118.4930 },
  { zip: "91101", market: "la", area: "Pasadena", lat: 34.1468, lon: -118.1390 },
  { zip: "91601", market: "la", area: "North Hollywood", lat: 34.1680, lon: -118.3720 },
  { zip: "90802", market: "la", area: "Long Beach", lat: 33.7660, lon: -118.1930 },
];

const BY_ZIP = new Map(ZIPS.map(z => [z.zip, z]));
export const zipCentroid = (zip: string): ZipCentroid | undefined => BY_ZIP.get(zip);

/**
 * Where a visitor to a market is assumed to meet (downtown core), for multi-city members and travelers
 * whose own zip is in another market. Same convention as the slop world.
 */
export const MARKET_ANCHOR_ZIP: Record<City, string> = { sf: "94103", nyc: "10003", la: "90026" };

/** Coarse cell size in degrees (about 1.1 km north-south): the only location the matcher computes on. */
export const CELL_DEG = 0.01;
export interface Cell { id: string; lat: number; lon: number }
/** Snap a zip centroid to its coarse cell (cell centre). Undefined for an unknown zip. */
export function cellOfZip(zip: string): Cell | undefined {
  const z = BY_ZIP.get(zip);
  if (!z) return undefined;
  const i = Math.floor(z.lat / CELL_DEG), j = Math.floor(z.lon / CELL_DEG);
  return { id: `cell:${i}:${j}`, lat: (i + 0.5) * CELL_DEG, lon: (j + 0.5) * CELL_DEG };
}
/** Worst-case error of a cell-to-cell distance against the centroid distance, in miles (two half-diagonals). */
export const CELL_ERROR_MILES = 2 * 0.5 * Math.hypot(CELL_DEG * 69.0, CELL_DEG * 69.0 * Math.cos((34 * Math.PI) / 180));

/** Great-circle miles between two cells (Infinity when either is unknown). */
export function cellMiles(a: Cell | undefined, b: Cell | undefined): number {
  if (!a || !b) return Infinity;
  if (a.id === b.id) return 0;
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The only distance a member is ever shown: a band, never a number of miles or a coordinate. */
export type DistanceBand = "under 2 mi" | "2-5 mi" | "5-10 mi" | "10-25 mi" | "25+ mi";
export function distanceBand(miles: number): DistanceBand {
  return miles < 2 ? "under 2 mi" : miles < 5 ? "2-5 mi" : miles < 10 ? "5-10 mi" : miles < 25 ? "10-25 mi" : "25+ mi";
}
