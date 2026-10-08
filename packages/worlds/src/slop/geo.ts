// Location for slop.date: home zip codes with their centroids, distances in miles, and the
// bucketed distances that are the only distances a member is ever shown.
//
// Privacy rule (research grounding, "location privacy"): the Network stores a zip centroid (or H3
// cells), never an address or a GPS fix, and shows a bucketed distance only. Centroids below are
// approximate ZCTA centroids (US Census 2020 gazetteer, rounded to about 0.005 degrees, under
// 1 km), hand-entered for the three launch metros.

export type SlopCity = "sf" | "nyc" | "la";
export const SLOP_CITIES: readonly SlopCity[] = ["sf", "nyc", "la"];

export interface ZipInfo { zip: string; city: SlopCity; area: string; lat: number; lon: number }

export const ZIPS: readonly ZipInfo[] = [
  // San Francisco Bay Area
  { zip: "94102", city: "sf", area: "Tenderloin / Hayes Valley", lat: 37.7795, lon: -122.4193 },
  { zip: "94103", city: "sf", area: "SoMa", lat: 37.7726, lon: -122.4110 },
  { zip: "94107", city: "sf", area: "Potrero Hill / Dogpatch", lat: 37.7621, lon: -122.3971 },
  { zip: "94109", city: "sf", area: "Nob Hill / Polk Gulch", lat: 37.7929, lon: -122.4212 },
  { zip: "94110", city: "sf", area: "Mission / Bernal Heights", lat: 37.7485, lon: -122.4153 },
  { zip: "94114", city: "sf", area: "Castro / Noe Valley", lat: 37.7583, lon: -122.4351 },
  { zip: "94115", city: "sf", area: "Western Addition", lat: 37.7856, lon: -122.4370 },
  { zip: "94117", city: "sf", area: "Haight-Ashbury", lat: 37.7700, lon: -122.4447 },
  { zip: "94118", city: "sf", area: "Inner Richmond", lat: 37.7812, lon: -122.4614 },
  { zip: "94122", city: "sf", area: "Inner Sunset", lat: 37.7590, lon: -122.4848 },
  { zip: "94123", city: "sf", area: "Marina", lat: 37.8003, lon: -122.4383 },
  { zip: "94133", city: "sf", area: "North Beach", lat: 37.8002, lon: -122.4097 },
  { zip: "94612", city: "sf", area: "Downtown Oakland", lat: 37.8102, lon: -122.2697 },
  { zip: "94610", city: "sf", area: "Grand Lake, Oakland", lat: 37.8124, lon: -122.2405 },
  { zip: "94704", city: "sf", area: "Berkeley", lat: 37.8664, lon: -122.2573 },
  { zip: "94301", city: "sf", area: "Palo Alto", lat: 37.4442, lon: -122.1500 },
  { zip: "94040", city: "sf", area: "Mountain View", lat: 37.3800, lon: -122.0850 },
  // New York City metro
  { zip: "10001", city: "nyc", area: "Chelsea / Hudson Yards", lat: 40.7506, lon: -73.9972 },
  { zip: "10002", city: "nyc", area: "Lower East Side", lat: 40.7157, lon: -73.9863 },
  { zip: "10003", city: "nyc", area: "East Village", lat: 40.7318, lon: -73.9891 },
  { zip: "10011", city: "nyc", area: "Chelsea", lat: 40.7419, lon: -74.0007 },
  { zip: "10014", city: "nyc", area: "West Village", lat: 40.7340, lon: -74.0054 },
  { zip: "10016", city: "nyc", area: "Murray Hill", lat: 40.7452, lon: -73.9783 },
  { zip: "10023", city: "nyc", area: "Upper West Side", lat: 40.7764, lon: -73.9827 },
  { zip: "10025", city: "nyc", area: "Morningside / UWS", lat: 40.7987, lon: -73.9665 },
  { zip: "10027", city: "nyc", area: "Harlem", lat: 40.8115, lon: -73.9532 },
  { zip: "10028", city: "nyc", area: "Upper East Side", lat: 40.7764, lon: -73.9530 },
  { zip: "11201", city: "nyc", area: "Brooklyn Heights", lat: 40.6943, lon: -73.9903 },
  { zip: "11211", city: "nyc", area: "Williamsburg", lat: 40.7128, lon: -73.9530 },
  { zip: "11215", city: "nyc", area: "Park Slope", lat: 40.6681, lon: -73.9860 },
  { zip: "11216", city: "nyc", area: "Bed-Stuy", lat: 40.6806, lon: -73.9493 },
  { zip: "11222", city: "nyc", area: "Greenpoint", lat: 40.7290, lon: -73.9480 },
  { zip: "11238", city: "nyc", area: "Prospect Heights", lat: 40.6795, lon: -73.9636 },
  { zip: "11101", city: "nyc", area: "Long Island City", lat: 40.7440, lon: -73.9380 },
  { zip: "11375", city: "nyc", area: "Forest Hills", lat: 40.7210, lon: -73.8466 },
  { zip: "07302", city: "nyc", area: "Jersey City", lat: 40.7196, lon: -74.0460 },
  // Los Angeles metro
  { zip: "90004", city: "la", area: "Larchmont / Koreatown", lat: 34.0763, lon: -118.3089 },
  { zip: "90012", city: "la", area: "Chinatown / Civic Center", lat: 34.0614, lon: -118.2386 },
  { zip: "90013", city: "la", area: "Downtown LA", lat: 34.0448, lon: -118.2418 },
  { zip: "90026", city: "la", area: "Echo Park", lat: 34.0766, lon: -118.2646 },
  { zip: "90027", city: "la", area: "Los Feliz", lat: 34.1040, lon: -118.2930 },
  { zip: "90028", city: "la", area: "Hollywood", lat: 34.0996, lon: -118.3270 },
  { zip: "90034", city: "la", area: "Palms", lat: 34.0306, lon: -118.3995 },
  { zip: "90036", city: "la", area: "Mid-Wilshire / Fairfax", lat: 34.0700, lon: -118.3490 },
  { zip: "90039", city: "la", area: "Silver Lake / Atwater", lat: 34.1117, lon: -118.2610 },
  { zip: "90042", city: "la", area: "Highland Park", lat: 34.1148, lon: -118.1918 },
  { zip: "90046", city: "la", area: "West Hollywood", lat: 34.1075, lon: -118.3650 },
  { zip: "90066", city: "la", area: "Mar Vista", lat: 34.0030, lon: -118.4300 },
  { zip: "90291", city: "la", area: "Venice", lat: 33.9930, lon: -118.4630 },
  { zip: "90401", city: "la", area: "Santa Monica", lat: 34.0160, lon: -118.4930 },
  { zip: "91101", city: "la", area: "Pasadena", lat: 34.1468, lon: -118.1390 },
  { zip: "91601", city: "la", area: "North Hollywood", lat: 34.1680, lon: -118.3720 },
  { zip: "90802", city: "la", area: "Long Beach", lat: 33.7660, lon: -118.1930 },
];

export const zipInfo = new Map(ZIPS.map(z => [z.zip, z]));
export const zipsIn = (city: SlopCity): ZipInfo[] => ZIPS.filter(z => z.city === city);
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
