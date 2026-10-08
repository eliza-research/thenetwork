// New York City geography for The Network (NYC is the launch city). Neighborhood centroids and
// real public venues (approximate WGS84 coordinates), a transit-time estimate, and meeting-spot
// selection. Venues are public places (parks, libraries, plazas, markets): the MVP suggests where
// to meet but never books, and never uses anyone's home (PRD 32.12, 17.5).
import type { Category } from "@thenetwork/core";

export type Borough = "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";
export interface LatLng { lat: number; lng: number }
export interface Neighborhood extends LatLng { name: string; borough: Borough }
export interface Venue extends LatLng {
  id: string; name: string; neighborhood: string; borough: Borough;
  kind: "park" | "library" | "plaza" | "market" | "museum" | "waterfront" | "courts" | "cafe_district";
  tags: string[];
}

const N = (name: string, borough: Borough, lat: number, lng: number): Neighborhood => ({ name, borough, lat, lng });
export const NEIGHBORHOODS: Neighborhood[] = [
  N("Financial District", "Manhattan", 40.7075, -74.0113), N("Tribeca", "Manhattan", 40.7163, -74.0086),
  N("Chinatown", "Manhattan", 40.7158, -73.997), N("Lower East Side", "Manhattan", 40.715, -73.9843),
  N("SoHo", "Manhattan", 40.7233, -74.003), N("East Village", "Manhattan", 40.7265, -73.9815),
  N("West Village", "Manhattan", 40.7358, -74.0036), N("Gramercy", "Manhattan", 40.7368, -73.9845),
  N("Flatiron", "Manhattan", 40.7401, -73.9903), N("Chelsea", "Manhattan", 40.7465, -74.0014),
  N("Murray Hill", "Manhattan", 40.7479, -73.9757), N("Midtown", "Manhattan", 40.7549, -73.984),
  N("Hell's Kitchen", "Manhattan", 40.7638, -73.9918), N("Upper West Side", "Manhattan", 40.787, -73.9754),
  N("Upper East Side", "Manhattan", 40.7736, -73.9566), N("East Harlem", "Manhattan", 40.7957, -73.9389),
  N("Harlem", "Manhattan", 40.8116, -73.9465), N("Washington Heights", "Manhattan", 40.8417, -73.9394),
  N("Inwood", "Manhattan", 40.8677, -73.9212),
  N("DUMBO", "Brooklyn", 40.7033, -73.9881), N("Williamsburg", "Brooklyn", 40.7081, -73.9571),
  N("Greenpoint", "Brooklyn", 40.73, -73.954), N("Bushwick", "Brooklyn", 40.6958, -73.9171),
  N("Bed-Stuy", "Brooklyn", 40.6872, -73.9418), N("Fort Greene", "Brooklyn", 40.6892, -73.9742),
  N("Prospect Heights", "Brooklyn", 40.6775, -73.9692), N("Crown Heights", "Brooklyn", 40.6694, -73.9422),
  N("Park Slope", "Brooklyn", 40.671, -73.9814), N("Carroll Gardens", "Brooklyn", 40.6795, -73.9991),
  N("Red Hook", "Brooklyn", 40.6734, -74.0083), N("Sunset Park", "Brooklyn", 40.6455, -74.0124),
  N("Flatbush", "Brooklyn", 40.6409, -73.9624), N("Bay Ridge", "Brooklyn", 40.6264, -74.0299),
  N("Astoria", "Queens", 40.7644, -73.9235), N("Long Island City", "Queens", 40.7447, -73.9485),
  N("Sunnyside", "Queens", 40.7433, -73.9196), N("Ridgewood", "Queens", 40.7043, -73.9018),
  N("Jackson Heights", "Queens", 40.7557, -73.8831), N("Flushing", "Queens", 40.7675, -73.8331),
  N("Mott Haven", "Bronx", 40.8091, -73.9229), N("Riverdale", "Bronx", 40.89, -73.9126),
  N("St. George", "Staten Island", 40.6437, -74.0736),
];
export const NEIGHBORHOOD = new Map(NEIGHBORHOODS.map(n => [n.name, n]));

const V = (id: string, name: string, neighborhood: string, kind: Venue["kind"], lat: number, lng: number, tags: string[]): Venue =>
  ({ id, name, neighborhood, borough: NEIGHBORHOOD.get(neighborhood)?.borough ?? "Manhattan", kind, lat, lng, tags });
export const VENUES: Venue[] = [
  V("prospect-long-meadow", "Prospect Park, Long Meadow", "Park Slope", "park", 40.6602, -73.969, ["outdoors", "running", "picnic", "walk", "social"]),
  V("grand-army-greenmarket", "Grand Army Plaza Greenmarket", "Prospect Heights", "market", 40.6741, -73.97, ["food", "cooking", "market", "social"]),
  V("bpl-central", "Brooklyn Public Library, Central", "Prospect Heights", "library", 40.6724, -73.9682, ["books", "quiet", "writing", "study", "professional"]),
  V("brooklyn-museum", "Brooklyn Museum", "Prospect Heights", "museum", 40.6712, -73.9636, ["arts", "museums", "film"]),
  V("mccarren-park", "McCarren Park", "Williamsburg", "park", 40.7206, -73.9518, ["running", "sports", "outdoors", "social"]),
  V("domino-park", "Domino Park", "Williamsburg", "waterfront", 40.7145, -73.9686, ["outdoors", "walk", "social", "photography"]),
  V("transmitter-park", "Transmitter Park", "Greenpoint", "waterfront", 40.7273, -73.9606, ["outdoors", "walk", "quiet"]),
  V("maria-hernandez", "Maria Hernandez Park", "Bushwick", "park", 40.7034, -73.9235, ["outdoors", "social", "sports"]),
  V("fort-greene-park", "Fort Greene Park", "Fort Greene", "park", 40.6912, -73.9755, ["outdoors", "walk", "running", "social"]),
  V("bbp-pier-2", "Brooklyn Bridge Park, Pier 2", "DUMBO", "courts", 40.699, -73.999, ["sports", "basketball", "outdoors", "tennis"]),
  V("red-hook-fields", "Red Hook Ball Fields", "Red Hook", "courts", 40.6775, -74.0055, ["sports", "food", "outdoors"]),
  V("sunset-park", "Sunset Park (the park)", "Sunset Park", "park", 40.6487, -74.004, ["outdoors", "walk", "photography"]),
  V("shore-road", "Shore Road Park", "Bay Ridge", "waterfront", 40.6253, -74.0384, ["running", "cycling", "walk"]),
  V("central-sheep-meadow", "Central Park, Sheep Meadow", "Upper West Side", "park", 40.7718, -73.975, ["outdoors", "picnic", "social", "walk"]),
  V("central-reservoir", "Central Park Reservoir loop", "Upper East Side", "park", 40.7856, -73.9626, ["running", "outdoors"]),
  V("riverside-park", "Riverside Park", "Upper West Side", "park", 40.801, -73.972, ["running", "cycling", "walk", "parents"]),
  V("carl-schurz", "Carl Schurz Park", "Upper East Side", "park", 40.7754, -73.9433, ["quiet", "walk", "parents"]),
  V("bryant-park", "Bryant Park", "Midtown", "plaza", 40.7536, -73.9832, ["chess", "cowork", "social", "professional"]),
  V("nypl-schwarzman", "NYPL Stephen A. Schwarzman Building", "Midtown", "library", 40.7532, -73.9822, ["books", "quiet", "writing", "study"]),
  V("washington-square", "Washington Square Park", "West Village", "park", 40.7308, -73.9973, ["music", "chess", "social", "arts"]),
  V("union-square-greenmarket", "Union Square Greenmarket", "Flatiron", "market", 40.7359, -73.9911, ["food", "cooking", "market"]),
  V("tompkins-square", "Tompkins Square Park", "East Village", "park", 40.7265, -73.9817, ["social", "dogs", "outdoors"]),
  V("high-line", "The High Line at Gansevoort", "Chelsea", "park", 40.7398, -74.008, ["walk", "arts", "photography", "outdoors"]),
  V("chelsea-market", "Chelsea Market", "Chelsea", "market", 40.7424, -74.006, ["food", "cooking", "social"]),
  V("pier-45", "Hudson River Park, Pier 45", "West Village", "waterfront", 40.7339, -74.0118, ["running", "outdoors", "sailing", "walk"]),
  V("seward-park", "Seward Park", "Lower East Side", "park", 40.7145, -73.9888, ["parents", "outdoors", "social"]),
  V("columbus-park", "Columbus Park", "Chinatown", "park", 40.7154, -73.9997, ["chess", "social", "outdoors"]),
  V("battery-park", "The Battery", "Financial District", "waterfront", 40.7033, -74.017, ["walk", "outdoors", "sailing"]),
  V("marcus-garvey", "Marcus Garvey Park", "Harlem", "park", 40.8045, -73.9439, ["music", "outdoors", "social"]),
  V("fort-tryon", "Fort Tryon Park", "Washington Heights", "park", 40.8649, -73.9319, ["walk", "outdoors", "photography"]),
  V("inwood-hill", "Inwood Hill Park", "Inwood", "park", 40.8723, -73.9264, ["hiking", "outdoors"]),
  V("astoria-park", "Astoria Park", "Astoria", "park", 40.7794, -73.9221, ["running", "tennis", "outdoors", "social"]),
  V("socrates-sculpture", "Socrates Sculpture Park", "Astoria", "park", 40.7685, -73.9367, ["arts", "outdoors"]),
  V("gantry-plaza", "Gantry Plaza State Park", "Long Island City", "waterfront", 40.7454, -73.9584, ["walk", "photography", "outdoors"]),
  V("flushing-meadows", "Flushing Meadows Corona Park", "Flushing", "park", 40.74, -73.8407, ["sports", "tennis", "cycling", "outdoors"]),
  V("travers-park", "Travers Park", "Jackson Heights", "park", 40.7553, -73.8869, ["food", "market", "parents", "social"]),
  V("van-cortlandt", "Van Cortlandt Park", "Riverdale", "park", 40.8977, -73.8987, ["running", "hiking", "outdoors"]),
  V("st-marys-park", "St. Mary's Park", "Mott Haven", "park", 40.8105, -73.9149, ["outdoors", "social", "parents"]),
  V("snug-harbor", "Snug Harbor", "St. George", "park", 40.6437, -74.1027, ["arts", "gardens", "walk"]),
  V("governors-island", "Governors Island", "Financial District", "park", 40.6895, -74.0168, ["cycling", "outdoors", "picnic", "arts"]),
];

/** Interest/category tags -> venue tags they suit. */
const TAG_HINTS: Record<string, string[]> = {
  climbing: ["sports"], running: ["running"], hiking: ["hiking", "walk"], cycling: ["cycling"], tennis: ["tennis", "sports"],
  basketball: ["basketball", "sports"], chess: ["chess"], cooking: ["food", "cooking"], wine: ["food"], film: ["film", "arts"],
  photography: ["photography"], ceramics: ["arts"], arts: ["arts"], rock_music: ["music"], live_music: ["music"], jazz: ["music"],
  writing: ["writing", "quiet"], books: ["books"], startups: ["professional", "cowork"], ai: ["professional", "cowork"],
  climate_tech: ["professional"], parenting: ["parents"], sailing: ["sailing"], volunteering: ["social"],
  social: ["social"], professional: ["professional", "cowork"], romance: ["walk"], hobby: ["outdoors"], help: [], growth: ["quiet"], events: ["social"],
};

const R = 6371;
export function km(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Door-to-door minutes, roughly: walking under 1.2 km; otherwise subway-ish (8 min overhead plus
 * 3.2 min/km), plus 12 minutes for a borough change that isn't Manhattan<->Brooklyn/Queens, and
 * the Staten Island ferry penalty. Good enough to rank; never shown as a promise.
 */
export function travelMinutes(a: Neighborhood | Venue, b: Neighborhood | Venue): number {
  const d = km(a, b);
  if (d < 1.2) return Math.round(d * 12);
  let m = 8 + 3.2 * d;
  if (a.borough !== b.borough) {
    const pair = [a.borough, b.borough].sort().join("|");
    if (!["Brooklyn|Manhattan", "Manhattan|Queens"].includes(pair)) m += 12;
    if (a.borough === "Staten Island" || b.borough === "Staten Island") m += 20;
  }
  return Math.round(m);
}

export function neighborhood(name: string | undefined): Neighborhood {
  return (name && NEIGHBORHOOD.get(name)) || NEIGHBORHOOD.get("Midtown")!;
}

/**
 * A public place that suits the activity and keeps everyone's trip short: minimizes the worst
 * travel time over participants (fairness), with a bonus for matching tags.
 */
export function meetingSpot(areas: string[], category: Category | undefined, tags: string[] = []): { venue: Venue; minutes: Record<string, number>; worst: number } {
  const homes = areas.map(neighborhood);
  const want = new Set([...(category ? TAG_HINTS[category] ?? [] : []), ...tags.flatMap(t => TAG_HINTS[t] ?? [t])]);
  let best: { venue: Venue; minutes: Record<string, number>; worst: number; cost: number } | undefined;
  for (const v of VENUES) {
    const mins = homes.map(h => travelMinutes(h, v));
    const worst = Math.max(...mins);
    const match = v.tags.filter(t => want.has(t)).length;
    const cost = worst - 9 * Math.min(2, match);
    if (!best || cost < best.cost) best = { venue: v, minutes: Object.fromEntries(homes.map((h, i) => [areas[i] ?? h.name, mins[i]!])), worst, cost };
  }
  return { venue: best!.venue, minutes: best!.minutes, worst: best!.worst };
}

/** Public suggestions near an area for a concierge answer (no people involved). */
export function nearbyVenues(area: string, tags: string[] = [], n = 3, exclude: ReadonlySet<string> = new Set()): Venue[] {
  const home = neighborhood(area);
  const want = new Set(tags.flatMap(t => TAG_HINTS[t] ?? [t]));
  return VENUES.filter(v => !exclude.has(v.id))
    .map(v => ({ v, s: travelMinutes(home, v) - 5 * Math.min(2, v.tags.filter(t => want.has(t)).length) }))
    .sort((a, b) => a.s - b.s).slice(0, n).map(x => x.v);
}

/** Deterministic jitter so members in one neighborhood don't sit on one point (map display). */
export function memberPoint(memberId: string, area: string | undefined): LatLng {
  const c = neighborhood(area);
  let h = 2166136261;
  for (let i = 0; i < memberId.length; i++) { h ^= memberId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2, r = 0.0025 + (((h >>> 12) % 1000) / 1000) * 0.006;
  return { lat: c.lat + Math.sin(a) * r, lng: c.lng + Math.cos(a) * r * 1.3 };
}
