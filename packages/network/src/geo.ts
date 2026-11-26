// New York City geography for The Network (NYC is the launch city). Neighborhood centroids and
// real public venues (approximate WGS84 coordinates), a transit-time estimate, and meeting-spot
// selection. Venues are public places (parks, libraries, plazas, markets): the MVP suggests where
// to meet but never books, and never uses anyone's home (PRD 32.12, 17.5).
import { ADULT_AGE, type Category, type City } from "@thenetwork/core";
import { km, type Borough, type LatLng } from "@thenetwork/core/src/geo.ts";
import { teenActivityOffered, teenFriendMinAge } from "../../core/src/generated/friendIntroAge.ts";
export { km, type Borough, type LatLng };

export interface Neighborhood extends LatLng { name: string; borough: Borough }
export interface Venue extends LatLng {
  id: string; name: string; neighborhood: string; borough: Borough;
  kind: "park" | "library" | "plaza" | "market" | "museum" | "waterfront" | "courts" | "cafe_district" | "rec_center";
  tags: string[];
  allAges: boolean; adultPlans: boolean;
  bookingUrl?: string;
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

export interface CityNeighborhood extends LatLng { name: string }
const S = (name: string, lat: number, lng: number): CityNeighborhood => ({ name, lat, lng });
export const SF_NEIGHBORHOODS: CityNeighborhood[] = [
  S("Bayview", 37.7289, -122.3828), S("Bernal Heights", 37.7485, -122.4153),
  S("Castro", 37.7583, -122.4351), S("Chinatown", 37.792, -122.4086),
  S("Cole Valley", 37.7656, -122.45), S("Cow Hollow", 37.7982, -122.437),
  S("Dogpatch", 37.7621, -122.3971), S("Duboce Triangle", 37.7683, -122.4316),
  S("Embarcadero", 37.7994, -122.3984), S("Excelsior", 37.7204, -122.4429),
  S("Financial District", 37.7914, -122.4021), S("Glen Park", 37.7459, -122.4415),
  S("Haight-Ashbury", 37.77, -122.4447), S("Hayes Valley", 37.7795, -122.4193),
  S("Inner Richmond", 37.7812, -122.4614), S("Inner Sunset", 37.759, -122.4848),
  S("Japantown", 37.7853, -122.4299), S("Lake Merced", 37.7222, -122.4841),
  S("Lower Haight", 37.7713, -122.4377), S("Marina", 37.8003, -122.4383),
  S("Mission", 37.7485, -122.4153), S("Mission Bay", 37.7699, -122.387),
  S("Mission Dolores", 37.762, -122.427), S("NoPa", 37.7757, -122.436),
  S("Nob Hill", 37.7929, -122.4212), S("Noe Valley", 37.7583, -122.4351),
  S("North Beach", 37.8002, -122.4097), S("Outer Richmond", 37.7768, -122.4947),
  S("Outer Sunset", 37.7454, -122.4861), S("Pacific Heights", 37.7925, -122.435),
  S("Portola", 37.7247, -122.4027), S("Potrero Hill", 37.7621, -122.3971),
  S("Presidio", 37.7973, -122.4645), S("Rincon Hill", 37.7896, -122.3931),
  S("Russian Hill", 37.8007, -122.4232), S("SoMa", 37.7726, -122.411),
  S("Tenderloin", 37.7795, -122.4193), S("Visitacion Valley", 37.721, -122.4136),
  S("West Portal", 37.736, -122.4572), S("Western Addition", 37.7856, -122.437),
  S("San Antonio, Oakland", 37.7919, -122.2453), S("West Oakland", 37.8072, -122.3015),
  S("Temescal, Oakland", 37.8344, -122.2644), S("Grand Lake, Oakland", 37.8124, -122.2405),
  S("Piedmont Ave", 37.8293, -122.2035), S("Downtown Oakland", 37.8102, -122.2697),
  S("Rockridge, Oakland", 37.8448, -122.2386), S("Alameda", 37.7738, -122.2781),
  S("94505", 37.8713, -121.597), S("West Berkeley", 37.8658, -122.2863),
  S("South Berkeley", 37.8639, -122.2756), S("Berkeley", 37.8664, -122.2573),
  S("Claremont", 37.8652, -122.2382), S("North Berkeley", 37.8792, -122.2668),
  S("San Mateo", 37.5769, -122.3169), S("Redwood City", 37.4933, -122.1956),
  S("Palo Alto", 37.4442, -122.15), S("Mountain View", 37.38, -122.085),
];
export const SF_NEIGHBORHOOD = new Map(SF_NEIGHBORHOODS.map(n => [n.name, n]));

/** City centers, used only when a member's area is unknown in its own city (right city, never another city's default). */
export const CITY_CENTER: Record<Exclude<City, "nyc">, LatLng> = {
  sf: { lat: 37.7749, lng: -122.4194 },
  la: { lat: 34.0522, lng: -118.2437 },
};

const V = (id: string, name: string, neighborhood: string, kind: Venue["kind"], lat: number, lng: number, tags: string[],
  ages: { allAges: boolean; adultPlans: boolean }, bookingUrl?: string): Venue =>
  ({ id, name, neighborhood, borough: NEIGHBORHOOD.get(neighborhood)?.borough ?? "Manhattan", kind, lat, lng, tags, allAges: ages.allAges, adultPlans: ages.adultPlans, ...(bookingUrl ? { bookingUrl } : {}) });
const EVERYONE = { allAges: true, adultPlans: true };
const TEEN_PLANS_ONLY = { allAges: true, adultPlans: false };
export const VENUES: Venue[] = [
  V("prospect-long-meadow", "Prospect Park, Long Meadow", "Park Slope", "park", 40.6602, -73.969, ["outdoors", "running", "picnic", "walk", "social"], EVERYONE),
  V("grand-army-greenmarket", "Grand Army Plaza Greenmarket", "Prospect Heights", "market", 40.6741, -73.97, ["food", "cooking", "market", "social"], EVERYONE),
  V("bpl-central", "Brooklyn Public Library, Central", "Prospect Heights", "library", 40.6724, -73.9682, ["books", "quiet", "writing", "study", "professional"], EVERYONE),
  V("brooklyn-museum", "Brooklyn Museum", "Prospect Heights", "museum", 40.6712, -73.9636, ["arts", "museums", "film"], EVERYONE, "https://secure.brooklynmuseum.org/"),
  V("mccarren-park", "McCarren Park", "Williamsburg", "park", 40.7206, -73.9518, ["running", "sports", "outdoors", "social"], EVERYONE),
  V("domino-park", "Domino Park", "Williamsburg", "waterfront", 40.7145, -73.9686, ["outdoors", "walk", "social", "photography"], EVERYONE),
  V("transmitter-park", "Transmitter Park", "Greenpoint", "waterfront", 40.7273, -73.9606, ["outdoors", "walk", "quiet"], EVERYONE),
  V("maria-hernandez", "Maria Hernandez Park", "Bushwick", "park", 40.7034, -73.9235, ["outdoors", "social", "sports"], EVERYONE),
  V("fort-greene-park", "Fort Greene Park", "Fort Greene", "park", 40.6912, -73.9755, ["outdoors", "walk", "running", "social"], EVERYONE),
  V("bbp-pier-2", "Brooklyn Bridge Park, Pier 2", "DUMBO", "courts", 40.699, -73.999, ["sports", "basketball", "outdoors", "tennis"], EVERYONE),
  V("red-hook-fields", "Red Hook Ball Fields", "Red Hook", "courts", 40.6775, -74.0055, ["sports", "food", "outdoors"], EVERYONE),
  V("sunset-park", "Sunset Park (the park)", "Sunset Park", "park", 40.6487, -74.004, ["outdoors", "walk", "photography"], EVERYONE),
  V("shore-road", "Shore Road Park", "Bay Ridge", "waterfront", 40.6253, -74.0384, ["running", "cycling", "walk"], EVERYONE),
  V("central-sheep-meadow", "Central Park, Sheep Meadow", "Upper West Side", "park", 40.7718, -73.975, ["outdoors", "picnic", "social", "walk"], EVERYONE),
  V("central-reservoir", "Central Park Reservoir loop", "Upper East Side", "park", 40.7856, -73.9626, ["running", "outdoors"], EVERYONE),
  V("riverside-park", "Riverside Park", "Upper West Side", "park", 40.801, -73.972, ["running", "cycling", "walk", "parents"], EVERYONE),
  V("carl-schurz", "Carl Schurz Park", "Upper East Side", "park", 40.7754, -73.9433, ["quiet", "walk", "parents"], EVERYONE),
  V("bryant-park", "Bryant Park", "Midtown", "plaza", 40.7536, -73.9832, ["chess", "cowork", "social", "professional"], EVERYONE),
  V("nypl-schwarzman", "NYPL Stephen A. Schwarzman Building", "Midtown", "library", 40.7532, -73.9822, ["books", "quiet", "writing", "study"], EVERYONE),
  V("washington-square", "Washington Square Park", "West Village", "park", 40.7308, -73.9973, ["music", "chess", "social", "arts"], EVERYONE),
  V("union-square-greenmarket", "Union Square Greenmarket", "Flatiron", "market", 40.7359, -73.9911, ["food", "cooking", "market"], EVERYONE),
  V("tompkins-square", "Tompkins Square Park", "East Village", "park", 40.7265, -73.9817, ["social", "dogs", "outdoors"], EVERYONE),
  V("high-line", "The High Line at Gansevoort", "Chelsea", "park", 40.7398, -74.008, ["walk", "arts", "photography", "outdoors"], EVERYONE),
  V("chelsea-market", "Chelsea Market", "Chelsea", "market", 40.7424, -74.006, ["food", "cooking", "social"], EVERYONE),
  V("pier-45", "Hudson River Park, Pier 45", "West Village", "waterfront", 40.7339, -74.0118, ["running", "outdoors", "sailing", "walk"], EVERYONE),
  V("seward-park", "Seward Park", "Lower East Side", "park", 40.7145, -73.9888, ["parents", "outdoors", "social"], EVERYONE),
  V("columbus-park", "Columbus Park", "Chinatown", "park", 40.7154, -73.9997, ["chess", "social", "outdoors"], EVERYONE),
  V("battery-park", "The Battery", "Financial District", "waterfront", 40.7033, -74.017, ["walk", "outdoors", "sailing"], EVERYONE),
  V("marcus-garvey", "Marcus Garvey Park", "Harlem", "park", 40.8045, -73.9439, ["music", "outdoors", "social"], EVERYONE),
  V("fort-tryon", "Fort Tryon Park", "Washington Heights", "park", 40.8649, -73.9319, ["walk", "outdoors", "photography"], EVERYONE),
  V("inwood-hill", "Inwood Hill Park", "Inwood", "park", 40.8723, -73.9264, ["hiking", "outdoors"], EVERYONE),
  V("astoria-park", "Astoria Park", "Astoria", "park", 40.7794, -73.9221, ["running", "tennis", "outdoors", "social"], EVERYONE),
  V("socrates-sculpture", "Socrates Sculpture Park", "Astoria", "park", 40.7685, -73.9367, ["arts", "outdoors"], EVERYONE),
  V("gantry-plaza", "Gantry Plaza State Park", "Long Island City", "waterfront", 40.7454, -73.9584, ["walk", "photography", "outdoors"], EVERYONE),
  V("flushing-meadows", "Flushing Meadows Corona Park", "Flushing", "park", 40.74, -73.8407, ["sports", "tennis", "cycling", "outdoors"], EVERYONE),
  V("travers-park", "Travers Park", "Jackson Heights", "park", 40.7553, -73.8869, ["food", "market", "parents", "social"], EVERYONE),
  V("van-cortlandt", "Van Cortlandt Park", "Riverdale", "park", 40.8977, -73.8987, ["running", "hiking", "outdoors"], EVERYONE),
  V("st-marys-park", "St. Mary's Park", "Mott Haven", "park", 40.8105, -73.9149, ["outdoors", "social", "parents"], EVERYONE),
  V("snug-harbor", "Snug Harbor", "St. George", "park", 40.6437, -74.1027, ["arts", "gardens", "walk"], EVERYONE),
  V("governors-island", "Governors Island", "Financial District", "park", 40.6895, -74.0168, ["cycling", "outdoors", "picnic", "arts"], EVERYONE),
  V("carroll-park", "Carroll Park", "Carroll Gardens", "park", 40.6811, -73.9956, ["outdoors", "sports", "social", "parents"], EVERYONE),
  V("herbert-von-king", "Herbert Von King Park", "Bed-Stuy", "park", 40.6898, -73.9466, ["outdoors", "sports", "social", "walk"], EVERYONE),
  V("brower-park", "Brower Park", "Crown Heights", "park", 40.6739, -73.9437, ["outdoors", "sports", "social", "parents"], EVERYONE),
  V("cortelyou-road", "Cortelyou Road", "Flatbush", "cafe_district", 40.6409, -73.9639, ["food", "social", "walk"], EVERYONE),
  V("washington-market-park", "Washington Market Park", "Tribeca", "park", 40.717, -74.0116, ["outdoors", "walk", "social", "parents"], EVERYONE),
  V("hudson-pier-26", "Hudson River Park, Pier 26", "Tribeca", "waterfront", 40.7211, -74.0135, ["outdoors", "walk", "sports", "social"], EVERYONE),
  V("stone-street", "Stone Street", "Financial District", "cafe_district", 40.7044, -74.0102, ["food", "social", "walk"], EVERYONE),
  V("foley-square", "Foley Square", "Chinatown", "plaza", 40.7144, -74.0031, ["walk", "social", "professional"], EVERYONE),
  V("jefferson-market-library", "Jefferson Market Library", "West Village", "library", 40.7346, -73.9992, ["books", "quiet", "writing", "study"], EVERYONE),
  V("dewitt-clinton-park", "DeWitt Clinton Park", "Hell's Kitchen", "park", 40.7682, -73.9943, ["outdoors", "sports", "social", "walk"], EVERYONE),
  V("stuyvesant-square", "Stuyvesant Square Park", "Gramercy", "park", 40.7338, -73.9844, ["outdoors", "walk", "quiet", "dogs"], EVERYONE),
  V("tudor-city-greens", "Tudor City Greens", "Murray Hill", "park", 40.7488, -73.9709, ["outdoors", "quiet", "walk"], EVERYONE),
  V("thomas-jefferson-park", "Thomas Jefferson Park", "East Harlem", "park", 40.7932, -73.9355, ["outdoors", "sports", "running", "social"], EVERYONE),
  V("museum-city-ny", "Museum of the City of New York", "East Harlem", "museum", 40.7925, -73.9518, ["arts", "museums", "photography"], EVERYONE),
  V("morningside-park", "Morningside Park", "Harlem", "park", 40.806, -73.9587, ["outdoors", "walk", "running", "social"], EVERYONE),
  V("lou-lodati-park", "Lou Lodati Park", "Sunnyside", "park", 40.7463, -73.9212, ["outdoors", "walk", "social", "parents"], EVERYONE),
  V("grover-cleveland-park", "Grover Cleveland Park", "Ridgewood", "park", 40.7108, -73.9112, ["outdoors", "sports", "walk", "social"], EVERYONE),
  V("queens-museum", "Queens Museum", "Flushing", "museum", 40.7459, -73.8467, ["arts", "museums", "photography"], EVERYONE),
  V("bronx-museum", "Bronx Museum of the Arts", "Mott Haven", "museum", 40.8311, -73.9199, ["arts", "museums", "social"], EVERYONE),
  V("macombs-dam-park", "Macombs Dam Park", "Mott Haven", "courts", 40.8274, -73.9285, ["sports", "basketball", "outdoors"], EVERYONE),
  V("clove-lakes-park", "Clove Lakes Park", "St. George", "park", 40.6187, -74.1128, ["outdoors", "walk", "running", "picnic"], EVERYONE),
  V("st-johns-rec", "St. John's Recreation Center", "Crown Heights", "rec_center", 40.6694, -73.9422, ["sports", "basketball", "tennis", "games"], TEEN_PLANS_ONLY),
  V("chelsea-rec", "Chelsea Recreation Center", "Chelsea", "rec_center", 40.7465, -74.0014, ["sports", "basketball", "tennis", "games"], TEEN_PLANS_ONLY),
  V("hansborough-rec", "Hansborough Recreation Center", "Harlem", "rec_center", 40.8116, -73.9465, ["sports", "basketball", "tennis", "games"], TEEN_PLANS_ONLY),
  V("al-oerter-rec", "Al Oerter Recreation Center", "Flushing", "rec_center", 40.7675, -73.8331, ["sports", "basketball", "tennis", "games"], TEEN_PLANS_ONLY),
  V("bpl-williamsburgh", "Brooklyn Public Library, Williamsburgh", "Williamsburg", "library", 40.7081, -73.9571, ["books", "games"], TEEN_PLANS_ONLY),
  V("nypl-jefferson-market", "NYPL Jefferson Market Library", "West Village", "library", 40.7358, -74.0036, ["books", "games"], TEEN_PLANS_ONLY),
  V("amnh", "American Museum of Natural History", "Upper West Side", "museum", 40.787, -73.9754, ["museums", "arts"], TEEN_PLANS_ONLY),
  V("moving-image", "Museum of the Moving Image", "Astoria", "museum", 40.7644, -73.9235, ["museums", "arts"], TEEN_PLANS_ONLY),
  V("smith-street-cafes", "Smith Street cafes", "Carroll Gardens", "cafe_district", 40.6795, -73.9991, ["food", "coffee"], TEEN_PLANS_ONLY),
  V("bedford-avenue-cafes", "Bedford Avenue cafes", "Williamsburg", "cafe_district", 40.7173, -73.9569, ["food", "coffee"], TEEN_PLANS_ONLY),
  V("vesuvio-playground", "Vesuvio Playground", "SoHo", "park", 40.725, -74.0026, ["sports", "outdoors", "social"], EVERYONE),
];

export const venueAgeMin = (v: Pick<Venue, "allAges">): number => (v.allAges ? teenFriendMinAge : ADULT_AGE);

/** Interest/category tags -> venue tags they suit. */
const TAG_HINTS: Record<string, string[]> = {
  climbing: ["sports"], running: ["running"], hiking: ["hiking", "walk"], cycling: ["cycling"], tennis: ["tennis", "sports"],
  basketball: ["basketball", "sports"], chess: ["chess"], cooking: ["food", "cooking"], wine: ["food"], film: ["film", "arts"],
  photography: ["photography"], ceramics: ["arts"], arts: ["arts"], rock_music: ["music"], live_music: ["music"], jazz: ["music"],
  writing: ["writing", "quiet"], books: ["books"], startups: ["professional", "cowork"], ai: ["professional", "cowork"],
  climate_tech: ["professional"], parenting: ["parents"], sailing: ["sailing"], volunteering: ["social"],
  social: ["social"], professional: ["professional", "cowork"], romance: ["walk"], hobby: ["outdoors"], help: [], growth: ["quiet"], events: ["social"],
};

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
export function meetingSpot(areasIn: (string | undefined)[], category: Category | undefined, tags: string[] = [], rosterHasMinor = false): { venue: Venue; minutes: Record<string, number>; worst: number } {
  // Unknown areas are left out (never a default); with none known, the most central public places win.
  const known = areasIn.filter((a): a is string => !!a && NEIGHBORHOOD.has(a));
  const areas = known.length ? known : ["Midtown"];
  const homes = areas.map(neighborhood);
  const want = new Set([...(category ? TAG_HINTS[category] ?? [] : []), ...tags.flatMap(t => TAG_HINTS[t] ?? [t])]);
  let best: { venue: Venue; minutes: Record<string, number>; worst: number; cost: number } | undefined;
  for (const v of VENUES.filter(x => teenActivityOffered(rosterHasMinor, x.allAges, x.adultPlans))) {
    const mins = homes.map(h => travelMinutes(h, v));
    const worst = Math.max(...mins);
    const match = v.tags.filter(t => want.has(t)).length;
    const cost = worst - 9 * Math.min(2, match);
    if (!best || cost < best.cost) best = { venue: v, minutes: Object.fromEntries(homes.map((h, i) => [areas[i] ?? h.name, mins[i]!])), worst, cost };
  }
  return { venue: best!.venue, minutes: best!.minutes, worst: best!.worst };
}

/** Public suggestions near an area for a concierge answer (no people involved). Unknown area: by fit only, nearest to the center. */
export function nearbyVenues(area: string | undefined, tags: string[] = [], n = 3, exclude: ReadonlySet<string> = new Set()): Venue[] {
  const home = neighborhood(area && NEIGHBORHOOD.has(area) ? area : "Midtown");
  const want = new Set(tags.flatMap(t => TAG_HINTS[t] ?? [t]));
  return VENUES.filter(v => v.adultPlans && !exclude.has(v.id))
    .map(v => ({ v, s: travelMinutes(home, v) - 5 * Math.min(2, v.tags.filter(t => want.has(t)).length) }))
    .sort((a, b) => a.s - b.s).slice(0, n).map(x => x.v);
}

function sfNeighborhood(area: string): CityNeighborhood | undefined {
  const exact = SF_NEIGHBORHOOD.get(area);
  if (exact) return exact;
  for (const part of area.split(" / ")) {
    const hit = SF_NEIGHBORHOOD.get(part.trim());
    if (hit) return hit;
  }
  return undefined;
}

/** Deterministic jitter so members in one neighborhood don't sit on one point (map display). */
export function memberPoint(memberId: string, area: string | undefined, city?: City): LatLng {
  let c: LatLng;
  if (city === "sf") c = (area && sfNeighborhood(area)) || CITY_CENTER.sf;
  else if (city === "la") c = CITY_CENTER.la;
  else c = neighborhood(area);
  let h = 2166136261;
  for (let i = 0; i < memberId.length; i++) { h ^= memberId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2, r = 0.0025 + (((h >>> 12) % 1000) / 1000) * 0.006;
  return { lat: c.lat + Math.sin(a) * r, lng: c.lng + Math.cos(a) * r * 1.3 };
}
