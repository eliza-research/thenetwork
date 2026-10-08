// friends.help geography: New York City neighborhoods, a transit-time estimate and venue choice.
//
// Location unit. NYC has 262 Neighborhood Tabulation Areas (NTAs, 2020; docs/research/
// 2026-10-08-domain-research.md C2 "NYC specifics"). This table is a hand-entered subset of 93
// NTA-level neighborhoods (approximate centroids, WGS84) that covers all five boroughs; each carries
// a planning zone (a cluster of nearby neighborhoods the planner pools within) and a subway access
// overhead in minutes (walk to a station plus the wait; larger in transit deserts). A production
// table would be the full NTA list with a precomputed OpenTripPlanner / r5 NTA-to-NTA matrix on the
// MTA GTFS for weekday-evening and weekend-day windows (domain research C2); prototypes/
// poc-travel-time validated cell-level heuristics for walking, cycling and driving, not transit.
//
// Transit estimate (engine-visible, never shown as a promise): walking under 1 km; otherwise both
// access overheads + 4 min wait + 2.2 min/km + a borough-crossing penalty (Manhattan to Brooklyn or
// Queens is direct; Brooklyn-Queens +6; Bronx to Brooklyn or Queens +12; Staten Island adds the
// ferry, +25). Venues are chosen to minimize the group's LONGEST trip, not the average (fairer to the
// outer boroughs; domain research C4). Copied in spirit from packages/network/src/geo.ts
// (travelMinutes, meetingSpot), which the engine cannot import.
import type { MemberId } from "@thenetwork/core";
import type { Venue } from "../network/activities.ts";

export type Borough = "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";
export const BOROUGHS: readonly Borough[] = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

export interface Neighborhood {
  /** Stable slug (an NTA stand-in). */
  id: string; name: string; borough: Borough; lat: number; lng: number;
  /** Planning zone: nearby neighborhoods pooled together by the planner. */
  zone: string;
  /** Relative weight of adults 18-44 living here (sampling weight in the simulator; not used by matching). */
  weight: number;
  /** Minutes from a door here to a moving train (walk + wait). */
  access: number;
}

const N = (name: string, borough: Borough, lat: number, lng: number, zone: string, weight: number, access: number): Neighborhood =>
  ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), name, borough, lat, lng, zone, weight, access });

export const NEIGHBORHOODS: readonly Neighborhood[] = [
  // Manhattan
  N("Financial District", "Manhattan", 40.7075, -74.0113, "lower_manhattan", 2, 5), N("Tribeca", "Manhattan", 40.7163, -74.0086, "lower_manhattan", 1, 5),
  N("Battery Park City", "Manhattan", 40.711, -74.016, "lower_manhattan", 1, 7), N("Chinatown", "Manhattan", 40.7158, -73.997, "lower_manhattan", 2, 5),
  N("Lower East Side", "Manhattan", 40.715, -73.9843, "lower_manhattan", 3, 6), N("SoHo", "Manhattan", 40.7233, -74.003, "lower_manhattan", 1, 5),
  N("East Village", "Manhattan", 40.7265, -73.9815, "village", 4, 7), N("West Village", "Manhattan", 40.7358, -74.0036, "village", 3, 5),
  N("Stuyvesant Town", "Manhattan", 40.7316, -73.978, "village", 2, 8), N("Gramercy", "Manhattan", 40.7368, -73.9845, "village", 2, 5),
  N("Chelsea", "Manhattan", 40.7465, -74.0014, "village", 3, 5), N("Murray Hill", "Manhattan", 40.7479, -73.9757, "midtown", 3, 6),
  N("Midtown", "Manhattan", 40.7549, -73.984, "midtown", 2, 4), N("Hell's Kitchen", "Manhattan", 40.7638, -73.9918, "midtown", 4, 6),
  N("Roosevelt Island", "Manhattan", 40.761, -73.951, "midtown", 0.5, 8), N("Upper West Side", "Manhattan", 40.787, -73.9754, "upper_manhattan_ws", 5, 5),
  N("Morningside Heights", "Manhattan", 40.81, -73.962, "upper_manhattan_ws", 2, 6), N("Upper East Side", "Manhattan", 40.7736, -73.9566, "upper_east", 6, 6),
  N("East Harlem", "Manhattan", 40.7957, -73.9389, "upper_east", 3, 7), N("Harlem", "Manhattan", 40.8116, -73.9465, "harlem", 4, 6),
  N("Hamilton Heights", "Manhattan", 40.825, -73.949, "harlem", 2, 6), N("Washington Heights", "Manhattan", 40.8417, -73.9394, "harlem", 4, 7),
  N("Inwood", "Manhattan", 40.8677, -73.9212, "harlem", 2, 8),
  // Brooklyn
  N("Williamsburg", "Brooklyn", 40.7081, -73.9571, "north_brooklyn", 6, 6), N("Greenpoint", "Brooklyn", 40.73, -73.954, "north_brooklyn", 3, 8),
  N("Bushwick", "Brooklyn", 40.6958, -73.9171, "north_brooklyn", 5, 7), N("Ridgewood", "Queens", 40.7043, -73.9018, "north_brooklyn", 3, 8),
  N("Brooklyn Heights", "Brooklyn", 40.696, -73.995, "brownstone", 2, 5), N("Downtown Brooklyn", "Brooklyn", 40.693, -73.987, "brownstone", 2, 4),
  N("Fort Greene", "Brooklyn", 40.6892, -73.9742, "brownstone", 3, 6), N("Carroll Gardens", "Brooklyn", 40.6795, -73.9991, "brownstone", 2, 6),
  N("Gowanus", "Brooklyn", 40.673, -73.99, "brownstone", 1, 6), N("Park Slope", "Brooklyn", 40.671, -73.9814, "brownstone", 4, 6),
  N("Red Hook", "Brooklyn", 40.6734, -74.0083, "brownstone", 1, 14), N("Windsor Terrace", "Brooklyn", 40.6535, -73.976, "brownstone", 1.5, 8),
  N("Bedford-Stuyvesant", "Brooklyn", 40.6872, -73.9418, "central_brooklyn", 6, 7), N("Prospect Heights", "Brooklyn", 40.6775, -73.9692, "central_brooklyn", 2, 6),
  N("Crown Heights", "Brooklyn", 40.6694, -73.9422, "central_brooklyn", 5, 7), N("Brownsville", "Brooklyn", 40.663, -73.91, "east_brooklyn", 1.5, 10),
  N("East New York", "Brooklyn", 40.667, -73.882, "east_brooklyn", 2, 11), N("Canarsie", "Brooklyn", 40.64, -73.9, "east_brooklyn", 2, 14),
  N("East Flatbush", "Brooklyn", 40.648, -73.93, "flatbush", 2.5, 11), N("Flatbush", "Brooklyn", 40.6409, -73.9624, "flatbush", 4, 7),
  N("Ditmas Park", "Brooklyn", 40.636, -73.962, "flatbush", 2, 8), N("Kensington", "Brooklyn", 40.642, -73.979, "flatbush", 1.5, 8),
  N("Sunset Park", "Brooklyn", 40.6455, -74.0124, "south_brooklyn", 3, 7), N("Bay Ridge", "Brooklyn", 40.6264, -74.0299, "south_brooklyn", 3, 9),
  N("Bensonhurst", "Brooklyn", 40.604, -73.996, "south_brooklyn", 2.5, 10), N("Borough Park", "Brooklyn", 40.634, -73.993, "south_brooklyn", 1.5, 9),
  N("Sheepshead Bay", "Brooklyn", 40.59, -73.95, "south_shore_brooklyn", 2, 10), N("Brighton Beach", "Brooklyn", 40.578, -73.961, "south_shore_brooklyn", 2, 10),
  N("Midwood", "Brooklyn", 40.62, -73.958, "south_shore_brooklyn", 1.5, 9),
  // Queens
  N("Astoria", "Queens", 40.7644, -73.9235, "west_queens", 6, 7), N("Long Island City", "Queens", 40.7447, -73.9485, "west_queens", 4, 5),
  N("Sunnyside", "Queens", 40.7433, -73.9196, "west_queens", 3, 7), N("Woodside", "Queens", 40.745, -73.903, "west_queens", 2, 7),
  N("Jackson Heights", "Queens", 40.7557, -73.8831, "central_queens", 4, 7), N("Elmhurst", "Queens", 40.736, -73.878, "central_queens", 3, 8),
  N("Corona", "Queens", 40.747, -73.86, "central_queens", 2.5, 9), N("Maspeth", "Queens", 40.723, -73.912, "central_queens", 1.5, 12),
  N("Forest Hills", "Queens", 40.718, -73.845, "south_queens", 3, 8), N("Rego Park", "Queens", 40.726, -73.862, "south_queens", 2, 8),
  N("Kew Gardens", "Queens", 40.709, -73.83, "south_queens", 1, 9), N("Richmond Hill", "Queens", 40.698, -73.831, "south_queens", 2, 11),
  N("Jamaica", "Queens", 40.702, -73.79, "south_queens", 3, 10), N("Ozone Park", "Queens", 40.676, -73.843, "south_queens", 2, 12),
  N("Flushing", "Queens", 40.7675, -73.8331, "east_queens", 4, 8), N("Bayside", "Queens", 40.768, -73.777, "east_queens", 2, 16),
  N("Fresh Meadows", "Queens", 40.734, -73.79, "east_queens", 1.5, 16), N("Queens Village", "Queens", 40.718, -73.745, "east_queens", 1.5, 16),
  N("Far Rockaway", "Queens", 40.605, -73.755, "rockaway", 1.5, 16), N("Rockaway Beach", "Queens", 40.586, -73.815, "rockaway", 1, 18),
  // The Bronx
  N("Mott Haven", "Bronx", 40.8091, -73.9229, "south_bronx", 3, 7), N("Concourse", "Bronx", 40.83, -73.92, "south_bronx", 3, 7),
  N("Highbridge", "Bronx", 40.839, -73.926, "south_bronx", 1.5, 8), N("Hunts Point", "Bronx", 40.815, -73.885, "south_bronx", 1, 10),
  N("Fordham", "Bronx", 40.861, -73.89, "west_bronx", 3, 8), N("Kingsbridge", "Bronx", 40.878, -73.903, "west_bronx", 2, 9),
  N("Riverdale", "Bronx", 40.89, -73.9126, "west_bronx", 1.5, 12), N("Belmont", "Bronx", 40.855, -73.886, "west_bronx", 1.5, 9),
  N("Parkchester", "Bronx", 40.837, -73.86, "east_bronx", 2, 9), N("Soundview", "Bronx", 40.825, -73.868, "east_bronx", 1.5, 11),
  N("Morris Park", "Bronx", 40.852, -73.86, "east_bronx", 1.5, 12), N("Pelham Bay", "Bronx", 40.85, -73.83, "east_bronx", 1, 12),
  N("Co-op City", "Bronx", 40.874, -73.829, "east_bronx", 1.5, 18), N("Williamsbridge", "Bronx", 40.878, -73.862, "east_bronx", 1.5, 10),
  // Staten Island
  N("St. George", "Staten Island", 40.6437, -74.0736, "staten_island", 1.5, 8), N("Stapleton", "Staten Island", 40.627, -74.077, "staten_island", 1, 10),
  N("Port Richmond", "Staten Island", 40.633, -74.135, "staten_island", 1, 18), N("New Springville", "Staten Island", 40.594, -74.163, "staten_island", 1, 20),
  N("New Dorp", "Staten Island", 40.573, -74.117, "staten_island", 1, 18), N("Great Kills", "Staten Island", 40.554, -74.151, "staten_island", 1, 20),
  N("Tottenville", "Staten Island", 40.509, -74.239, "staten_island", 0.5, 22),
];
export const NEIGHBORHOOD: ReadonlyMap<string, Neighborhood> = new Map(NEIGHBORHOODS.map(n => [n.id, n]));
export const NEIGHBORHOOD_BY_NAME: ReadonlyMap<string, Neighborhood> = new Map(NEIGHBORHOODS.map(n => [n.name.toLowerCase(), n]));
export const ZONES: readonly string[] = [...new Set(NEIGHBORHOODS.map(n => n.zone))];

/** Neighborhood by id or (case-insensitive) name. */
export function hood(x: string | undefined): Neighborhood | undefined {
  if (!x) return undefined;
  return NEIGHBORHOOD.get(x) ?? NEIGHBORHOOD_BY_NAME.get(x.toLowerCase());
}

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const CROSS: Record<string, number> = {
  "Brooklyn|Manhattan": 0, "Manhattan|Queens": 0, "Bronx|Manhattan": 0, "Brooklyn|Queens": 6, "Bronx|Queens": 12, "Bronx|Brooklyn": 12,
};

/**
 * Estimated door-to-door transit minutes between two neighborhoods (symmetric). Walking under 1 km
 * (13 min/km); otherwise both access overheads + 4 min wait + 2.2 min/km + the borough-crossing
 * penalty; Staten Island to anywhere else adds the ferry (+25).
 */
export function transitMinutes(a: Neighborhood, b: Neighborhood): number {
  if (a.id === b.id) return Math.round(Math.min(12, a.access));
  const d = km(a, b);
  if (d < 1) return Math.round(d * 13);
  let m = a.access + b.access + 4 + 2.2 * d;
  if (a.borough !== b.borough) {
    const pair = [a.borough, b.borough].sort().join("|");
    if (a.borough === "Staten Island" || b.borough === "Staten Island") m += 25;
    else m += CROSS[pair] ?? 10;
  }
  return Math.round(Math.min(m, d * 13 + 5)); // never worse than walking it
}

/** Bucketed copy for a trip ("about 20 min"). Never a promise, never an exact distance. */
export function displayMinutes(min: number): string {
  if (min <= 10) return "a short walk";
  if (min <= 20) return "about 15-20 min";
  if (min <= 30) return "about 25-30 min";
  if (min <= 45) return "about 40 min";
  return "over 45 min";
}

// ------------------------------------------------------------------------------------------------
// Venues (public places only; MVP: never a home, no money through the Network)

/** Activities friends.help plans (network ACTIVITIES minus work-flavoured ones: friendship forms in leisure, Hall 2018). */
export const FRIENDS_EXCLUDED_ACTIVITIES: ReadonlySet<string> = new Set(["tech_meetup"]);

const FAMILY_DENSITY: Record<string, number> = { food: 0.7, ideas: 0.6, play: 0.55, active: 0.45, wellness: 0.4, music: 0.3, arts: 0.35, civic: 0.45, tech: 0 };
const HOURS: Record<string, { weekday: [number, number]; weekend: [number, number] }> = {
  outdoor: { weekday: [7, 21], weekend: [7, 20] }, indoor: { weekday: [9, 23], weekend: [9, 23] },
};
const h32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * A synthetic public venue table: for each (activity, neighborhood) a venue exists with a density by
 * activity family (cafes and parks are everywhere; climbing gyms are not). Deterministic. Venue
 * names are generic descriptions ("a board game cafe in Astoria"), never a home.
 */
export function nycVenues(activities: readonly { id: string; family: string; label: string; setting: string; ageMin: number; costTier: 0 | 1 | 2 | 3 }[]): Venue[] {
  const out: Venue[] = [];
  for (const a of activities) {
    if (FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)) continue;
    const dens = FAMILY_DENSITY[a.family] ?? 0.4;
    for (const n of NEIGHBORHOODS) {
      // Hubs (weight >= 3) always have the common families; density otherwise.
      const p = Math.min(0.95, dens * (n.weight >= 3 ? 1.5 : 1));
      if ((h32(`${a.id}|${n.id}`) % 1000) / 1000 >= p) continue;
      out.push({
        id: `v_${a.id}_${n.id}`, city: "nyc", area: n.name, name: `${a.label.replace(/^(a|an) /, "")} spot in ${n.name}`,
        activities: [a.id], priceTier: a.costTier, ageMin: a.ageMin, hours: HOURS[a.setting === "outdoor" ? "outdoor" : "indoor"]!,
        public: true, source: "curated",
      });
    }
  }
  return out;
}

/**
 * The venue for a group: among venues offering the activity, minimize the LONGEST estimated trip
 * from members' home neighborhoods (ties: the lower mean, then id). Returns the per-member minutes.
 */
export function chooseVenue(venues: readonly Venue[], homes: ReadonlyMap<MemberId, Neighborhood>, ok: (v: Venue) => boolean = () => true):
  { venue: Venue; minutes: Record<MemberId, number>; worst: number; mean: number } | undefined {
  let best: { venue: Venue; minutes: Record<MemberId, number>; worst: number; mean: number } | undefined;
  for (const v of venues) {
    if (!ok(v)) continue;
    const at = hood(v.area);
    if (!at) continue;
    const minutes: Record<MemberId, number> = {};
    let worst = 0, sum = 0;
    for (const [id, h] of homes) { const m = transitMinutes(h, at); minutes[id] = m; worst = Math.max(worst, m); sum += m; }
    const mean = homes.size ? sum / homes.size : 0;
    if (!best || worst < best.worst || (worst === best.worst && (mean < best.mean || (mean === best.mean && v.id < best.venue.id)))) best = { venue: v, minutes, worst, mean };
  }
  return best;
}
