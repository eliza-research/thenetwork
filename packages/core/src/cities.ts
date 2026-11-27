// Modular 5-city geographic registry (sf, nyc, la, chicago, miami) + 75 verified seed venues
// (including hobby-native LGS, board-game cafes, climbing gyms, tea houses, and museums).
// Adding city #6+ is a single registerCity(spec) call. Core travel bounds and minimax+mean
// midpoint costs delegate to the Vibespec-proved generated/venueSelection.ts.

import { km, type LatLng } from "./geo.ts";
import { fairMidpointCostScaled, fairMidpointNetCostScaled, isValidMidpoint } from "./generated/venueSelection.ts";
import type { CityBarrier, CityNeighborhood, CitySpec, CityZone, LaunchCity, NeighborhoodSpec, VenueHoursSlot, VenuePersonaPrior, VenueRecord } from "./types.ts";

export type { CityBarrier, CityNeighborhood, CitySpec, CityZone, LaunchCity, NeighborhoodSpec };

export interface FairMidpointResult {
  neighborhood: CityNeighborhood;
  maxMinutes: number;
  meanMinutes: number;
  costScaled: number;
  relaxedBy: number;
}

const SEED_VERIFIED_AT = Date.UTC(2026, 10, 26, 12, 0, 0);

function dailyHours(openMin: number, closeMin: number): VenueHoursSlot[] {
  return [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin, closeMin }));
}

function splitHours(wkOpen: number, wkClose: number, weOpen: number, weClose: number): VenueHoursSlot[] {
  return [0, 1, 2, 3, 4, 5, 6].map(weekday =>
    weekday >= 5 ? { weekday, openMin: weOpen, closeMin: weClose } : { weekday, openMin: wkOpen, closeMin: wkClose }
  );
}

function defaultPriors(rating: number, overrides: Record<string, VenuePersonaPrior> = {}): Record<string, VenuePersonaPrior> {
  const alpha = Math.max(2, Math.round(rating * 2));
  const beta = Math.max(1, Math.round((5 - rating) * 2) + 1);
  return { default: { alpha, beta }, ...overrides };
}

type SeedInput = Omit<VenueRecord, "public" | "status" | "source" | "lastVerifiedAt" | "closureReports" | "personaPriors"> & {
  personaPriors?: Record<string, VenuePersonaPrior>;
};

const ALCOHOL_CENTRIC_CATEGORIES = new Set<VenueRecord["category"]>([
  "brewery",
  "brewery_garden",
  "wine_bar",
  "cocktail_bar",
  "cocktail_lounge",
  "wine_beer_patio",
]);

const OPEN_EVENT_CATEGORIES = new Set<VenueRecord["category"]>([
  "food_hall",
  "park",
  "waterfront_park",
  "game_store",
  "board_game_cafe",
  "climbing_gym",
  "community_space",
  "museum_gallery",
  "bowling_arcade",
  "brewery",
  "brewery_garden",
]);

function seedVenue(v: SeedInput): VenueRecord {
  const { personaPriors, ...rest } = v;
  const ageMin = v.ageMin ?? 0;
  const isAlcoholCentric = v.isAlcoholCentric ?? (v.isBarOnly || ALCOHOL_CENTRIC_CATEGORIES.has(v.category));
  const openEventEligible =
    v.openEventEligible ??
    (v.walkInGroupCapacity >= 10 && !v.reservationRequired && OPEN_EVENT_CATEGORIES.has(v.category));
  const allAges = !v.isBarOnly && !isAlcoholCentric && ageMin <= 0 ? (v.allAges ?? true) : false;
  return {
    ...rest,
    ageMin,
    public: true,
    status: "active",
    source: "curated",
    lastVerifiedAt: SEED_VERIFIED_AT,
    closureReports: 0,
    allAges,
    isAlcoholCentric,
    isSmokeFree: v.isSmokeFree ?? true,
    openEventEligible,
    personaPriors: defaultPriors(v.yelpRating ?? 4.3, personaPriors),
  };
}

// ---- 1. San Francisco (sf) ----

const SF_SPEC: CitySpec = {
  id: "sf",
  name: "San Francisco",
  shortName: "SF",
  tz: "America/Los_Angeles",
  primaryMode: "hybrid",
  anchorZip: "94102",
  aliases: ["sf", "san francisco", "bay area", "san fran"],
  center: { lat: 37.7749, lng: -122.4194 },
  dateMaxMinutes: 25,
  groupMaxMinutes: 35,
  kmPerMinute: 0.25,
  baseMinutes: 8,
  zones: [
    { id: "central", name: "Central SF" },
    { id: "east_waterfront", name: "Waterfront & SoMa" },
    { id: "north_hills", name: "Northern Hills & Marina" },
    { id: "south_east", name: "Mission, Castro & Potrero" },
    { id: "east_bay", name: "East Bay" },
  ],
  neighborhoods: [
    { name: "Mission District", zone: "south_east", lat: 37.7599, lng: -122.4148, aliases: ["mission", "the mission", "valencia", "dolores"], hubSupply: 9 },
    { name: "Hayes Valley", zone: "central", lat: 37.7764, lng: -122.4243, aliases: ["hayes", "civic center"], hubSupply: 9 },
    { name: "SoMa / Yerba Buena", zone: "east_waterfront", lat: 37.7785, lng: -122.4056, aliases: ["soma", "yerba buena", "south of market", "mission bay"], hubSupply: 8 },
    { name: "Embarcadero / FiDi", zone: "east_waterfront", lat: 37.7955, lng: -122.3937, aliases: ["embarcadero", "fidi", "financial district", "ferry building", "downtown sf"], hubSupply: 10 },
    { name: "North Beach", zone: "north_hills", lat: 37.8005, lng: -122.4091, aliases: ["north beach", "telegraph hill", "chinatown sf"], hubSupply: 8 },
    { name: "Marina / Cow Hollow", zone: "north_hills", lat: 37.8015, lng: -122.4368, aliases: ["marina", "cow hollow", "presidio", "crissy field", "pac heights"], hubSupply: 7 },
    { name: "Russian Hill / Polk", zone: "north_hills", lat: 37.7960, lng: -122.4218, aliases: ["russian hill", "polk", "polk gulch", "nob hill"], hubSupply: 7 },
    { name: "Lower Haight / Duboce", zone: "central", lat: 37.7719, lng: -122.4310, aliases: ["lower haight", "duboce", "duboce triangle", "alamo square", "nopa", "haight"], hubSupply: 7 },
    { name: "Castro / Noe Valley", zone: "south_east", lat: 37.7609, lng: -122.4350, aliases: ["castro", "noe valley", "noe"], hubSupply: 7 },
    { name: "Potrero Hill / Dogpatch", zone: "south_east", lat: 37.7577, lng: -122.3924, aliases: ["potrero", "potrero hill", "dogpatch"], hubSupply: 6 },
  ],
  barriers: [
    { fromZone: "north_hills", toZone: "south_east", penaltyMinutes: 10, reason: "SF hills & crosstown Muni slowness" },
    { fromZone: "north_hills", toZone: "central", penaltyMinutes: 5, reason: "Steep hills" },
    { fromZone: "central", toZone: "east_bay", penaltyMinutes: 25, reason: "Bay Bridge crossing" },
    { fromZone: "east_waterfront", toZone: "east_bay", penaltyMinutes: 25, reason: "Bay Bridge crossing" },
    { fromZone: "north_hills", toZone: "east_bay", penaltyMinutes: 25, reason: "Bay Bridge crossing" },
    { fromZone: "south_east", toZone: "east_bay", penaltyMinutes: 25, reason: "Bay Bridge crossing" },
  ],
  seedVenues: [
    seedVenue({
      id: "sf-ferry-building", name: "Ferry Building Marketplace", city: "sf", neighborhood: "Embarcadero / FiDi",
      address: "1 Ferry Building, San Francisco, CA 94111", lat: 37.7955, lng: -122.3937, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the main nave under the Ferry Building central clock archway",
      hours: dailyHours(7 * 60, 20 * 60), yelpRating: 4.5, safetyScore: 10, transitScore: 5,
      halalFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, openEventEligible: true,
      cuisineTags: ["artisan", "california", "seafood", "bakery", "coffee"],
      personaPriors: { foodie: { alpha: 9, beta: 2 }, builder: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "sf-sightglass-soma", name: "Sightglass Coffee (7th St Flagship)", city: "sf", neighborhood: "SoMa / Yerba Buena",
      address: "270 7th St, San Francisco, CA 94103", lat: 37.7769, lng: -122.4085, category: "coffee_shop",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the main roasting-floor espresso bar straight ahead from the 7th St entrance",
      hours: dailyHours(7 * 60, 17 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 4,
      personaPriors: { builder: { alpha: 9, beta: 2 }, creative: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "sf-tartine-mission", name: "Tartine Bakery", city: "sf", neighborhood: "Mission District",
      address: "600 Guerrero St, San Francisco, CA 94110", lat: 37.7614, lng: -122.4241, category: "bakery_cafe",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Under the corner awning at 18th & Guerrero St",
      hours: dailyHours(7 * 60 + 30, 17 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 4,
      personaPriors: { foodie: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-saint-frank", name: "Saint Frank Coffee", city: "sf", neighborhood: "Russian Hill / Polk",
      address: "2340 Polk St, San Francisco, CA 94109", lat: 37.7985, lng: -122.4220, category: "coffee_shop",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the front Polk St window bench near the pastry counter",
      hours: dailyHours(7 * 60, 17 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 4,
      personaPriors: { creative: { alpha: 9, beta: 2 }, minimalist: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-reveille-north-beach", name: "Réveille Coffee Co. (North Beach)", city: "sf", neighborhood: "North Beach",
      address: "200 Columbus Ave, San Francisco, CA 94133", lat: 37.7972, lng: -122.4055, category: "coffee_shop",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "At the Columbus Ave sidewalk corner patio tables",
      hours: dailyHours(7 * 60, 17 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 4,
    }),
    seedVenue({
      id: "sf-biergarten-hayes", name: "Biergarten", city: "sf", neighborhood: "Hayes Valley",
      address: "424 Octavia St, San Francisco, CA 94102", lat: 37.7762, lng: -122.4244, category: "brewery_garden",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "Just inside the Octavia St wooden garden entrance gate",
      hours: splitHours(15 * 60, 21 * 60, 11 * 60 + 30, 21 * 60), yelpRating: 4.3, safetyScore: 9, transitScore: 5,
      personaPriors: { social: { alpha: 9, beta: 2 }, outdoorsy: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "sf-cellarmaker-mission", name: "Cellarmaker Brewing Co. (Mission)", city: "sf", neighborhood: "Mission District",
      address: "3193 Mission St, San Francisco, CA 94110", lat: 37.7460, lng: -122.4193, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the main taproom counter just inside the Mission St entrance",
      hours: splitHours(16 * 60, 22 * 60, 12 * 60, 23 * 60), yelpRating: 4.5, safetyScore: 8, transitScore: 4,
      personaPriors: { social: { alpha: 8, beta: 2 }, foodie: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "sf-dolores-park", name: "Mission Dolores Park", city: "sf", neighborhood: "Mission District",
      address: "Dolores St & 19th St, San Francisco, CA 94114", lat: 37.7596, lng: -122.4269, category: "park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "At the 19th & Dolores St J-Church pedestrian bridge overlook",
      hours: dailyHours(6 * 60, 21 * 60), yelpRating: 4.6, safetyScore: 8, transitScore: 5,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "sf-crissy-tunnel-tops", name: "Crissy Field / Presidio Tunnel Tops", city: "sf", neighborhood: "Marina / Cow Hollow",
      address: "210 Lincoln Blvd, San Francisco, CA 94129", lat: 37.8027, lng: -122.4581, category: "waterfront_park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "By the Presidio Tunnel Tops main Golden Gate overlook benches",
      hours: dailyHours(6 * 60, 21 * 60), yelpRating: 4.8, safetyScore: 10, transitScore: 3,
      personaPriors: { outdoorsy: { alpha: 10, beta: 1 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "sf-arlequin-hayes", name: "Arlequin Wine Merchant & Patio", city: "sf", neighborhood: "Hayes Valley",
      address: "384 Hayes St, San Francisco, CA 94102", lat: 37.7768, lng: -122.4225, category: "wine_bar",
      priceTier: 3, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "At the back courtyard patio entrance behind the Hayes St wine shop",
      hours: dailyHours(12 * 60, 21 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 5,
      personaPriors: { romantic: { alpha: 9, beta: 2 }, foodie: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "sf-elixir-mission", name: "Elixir", city: "sf", neighborhood: "Mission District",
      address: "3200 16th St, San Francisco, CA 94103", lat: 37.7648, lng: -122.4241, category: "cocktail_bar",
      priceTier: 2, ageMin: 21, isBarOnly: true, alcoholOptional: false, servesVegetarian: false, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the front antique wooden bar inside the 16th & Guerrero St corner door",
      hours: dailyHours(14 * 60, 26 * 60), yelpRating: 4.4, safetyScore: 8, transitScore: 5,
      personaPriors: { nightowl: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-view-lounge", name: "The View Lounge", city: "sf", neighborhood: "SoMa / Yerba Buena",
      address: "780 Mission St, 39th Floor, San Francisco, CA 94103", lat: 37.7850, lng: -122.4041, category: "cocktail_lounge",
      priceTier: 4, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: false, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the 39th-floor elevator foyer facing the panoramic arched window",
      hours: dailyHours(16 * 60, 24 * 60), yelpRating: 4.4, safetyScore: 10, transitScore: 5,
      personaPriors: { romantic: { alpha: 10, beta: 1 }, upscale: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-gamescape", name: "Gamescape", city: "sf", neighborhood: "Lower Haight / Duboce",
      address: "333 Divisadero St, San Francisco, CA 94117", lat: 37.7726, lng: -122.4375, category: "game_store",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the Divisadero St front entrance by the open-play card tables",
      hours: splitHours(11 * 60, 21 * 60, 11 * 60, 20 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      hobbies: ["pokemon_tcg", "mtg", "board_games", "tabletop", "tcg"],
      personaPriors: { nerd: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-dogpatch-boulders", name: "Dogpatch Boulders", city: "sf", neighborhood: "Potrero Hill / Dogpatch",
      address: "2573 3rd St, San Francisco, CA 94107", lat: 37.7568, lng: -122.3883, category: "climbing_gym",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the 3rd St front check-in desk beside the seating benches",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      hobbies: ["bouldering", "climbing", "fitness"],
      personaPriors: { outdoorsy: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "sf-asha-tea-house", name: "Asha Tea House", city: "sf", neighborhood: "Embarcadero / FiDi",
      address: "17 Kearny St, San Francisco, CA 94108", lat: 37.7882, lng: -122.4036, category: "tea_house",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, openEventEligible: false, reservationRequired: false,
      noiseLevel: "quiet", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "At the Kearny St front window tables next to the loose-leaf tea bar",
      hours: dailyHours(10 * 60, 20 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 5,
      hobbies: ["tea", "reading", "chess", "quiet_chat"], cuisineTags: ["tea", "matcha", "taiwanese"],
      personaPriors: { creative: { alpha: 9, beta: 2 }, romantic: { alpha: 9, beta: 2 }, intellectual: { alpha: 9, beta: 2 } },
    }),
  ],
};

// ---- 2. New York City (nyc) ----

const NYC_SPEC: CitySpec = {
  id: "nyc",
  name: "New York City",
  shortName: "NYC",
  tz: "America/New_York",
  primaryMode: "transit",
  anchorZip: "10003",
  aliases: ["nyc", "new york", "new york city", "manhattan", "brooklyn", "queens", "bronx"],
  center: { lat: 40.7359, lng: -73.9911 },
  dateMaxMinutes: 25,
  groupMaxMinutes: 35,
  kmPerMinute: 0.28,
  baseMinutes: 8,
  zones: [
    { id: "manhattan_core", name: "Midtown & Flatiron" },
    { id: "manhattan_lower", name: "Downtown & Villages" },
    { id: "brooklyn_north", name: "North Brooklyn" },
    { id: "brooklyn_south", name: "Brownstone Brooklyn" },
    { id: "queens", name: "Queens" },
    { id: "bronx", name: "Bronx" },
    { id: "staten_island", name: "Staten Island" },
  ],
  neighborhoods: [
    { name: "Flatiron / Union Square", zone: "manhattan_core", lat: 40.7359, lng: -73.9911, aliases: ["flatiron", "union square", "gramercy", "nomad"], hubSupply: 10 },
    { name: "West Village", zone: "manhattan_lower", lat: 40.7336, lng: -74.0027, aliases: ["west village", "greenwich village", "bleecker"], hubSupply: 9 },
    { name: "East Village", zone: "manhattan_lower", lat: 40.7265, lng: -73.9815, aliases: ["east village", "alphabet city", "st marks", "astor place"], hubSupply: 9 },
    { name: "Lower East Side", zone: "manhattan_lower", lat: 40.7150, lng: -73.9843, aliases: ["les", "lower east side", "chinatown", "two bridges"], hubSupply: 8 },
    { name: "SoHo / Nolita", zone: "manhattan_lower", lat: 40.7233, lng: -74.0030, aliases: ["soho", "nolita", "noho", "tribeca", "little italy"], hubSupply: 9 },
    { name: "Chelsea / Meatpacking", zone: "manhattan_core", lat: 40.7465, lng: -74.0014, aliases: ["chelsea", "meatpacking", "high line", "little island"], hubSupply: 8 },
    { name: "Midtown West / Hudson Yards", zone: "manhattan_core", lat: 40.7527, lng: -73.9935, aliases: ["midtown", "midtown west", "hudson yards", "hells kitchen", "penn station", "moynihan", "rockefeller"], hubSupply: 9 },
    { name: "Financial District / Seaport", zone: "manhattan_lower", lat: 40.7075, lng: -74.0089, aliases: ["fidi", "financial district", "seaport", "battery park", "battery park city", "wall street"], hubSupply: 9 },
    { name: "Williamsburg", zone: "brooklyn_north", lat: 40.7143, lng: -73.9573, aliases: ["williamsburg", "greenpoint", "bushwick", "domino"], hubSupply: 9 },
    { name: "Gowanus / Park Slope", zone: "brooklyn_south", lat: 40.6733, lng: -73.9882, aliases: ["gowanus", "park slope", "carroll gardens", "cobble hill", "boerum hill", "fort greene", "prospect heights"], hubSupply: 8 },
  ],
  barriers: [
    { fromZone: "manhattan_core", toZone: "brooklyn_north", penaltyMinutes: 12, reason: "East River crossing" },
    { fromZone: "manhattan_core", toZone: "brooklyn_south", penaltyMinutes: 14, reason: "East River & Brooklyn transfer" },
    { fromZone: "manhattan_lower", toZone: "brooklyn_north", penaltyMinutes: 10, reason: "East River crossing" },
    { fromZone: "manhattan_lower", toZone: "brooklyn_south", penaltyMinutes: 12, reason: "East River crossing" },
    { fromZone: "brooklyn_north", toZone: "brooklyn_south", penaltyMinutes: 12, reason: "G-train / outer-borough diagonal" },
    { fromZone: "manhattan_core", toZone: "staten_island", penaltyMinutes: 25, reason: "Staten Island Ferry" },
    { fromZone: "manhattan_lower", toZone: "staten_island", penaltyMinutes: 25, reason: "Staten Island Ferry" },
    { fromZone: "brooklyn_north", toZone: "staten_island", penaltyMinutes: 25, reason: "Staten Island Ferry" },
    { fromZone: "brooklyn_south", toZone: "staten_island", penaltyMinutes: 25, reason: "Staten Island Ferry" },
  ],
  seedVenues: [
    seedVenue({
      id: "nyc-moynihan-food-hall", name: "Moynihan Train Hall Food Hall", city: "nyc", neighborhood: "Midtown West / Hudson Yards",
      address: "421 8th Ave, New York, NY 10001", lat: 40.7517, lng: -73.9960, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the central circular bar inside the Moynihan Food Hall atrium",
      hours: dailyHours(8 * 60, 22 * 60), yelpRating: 4.4, safetyScore: 10, transitScore: 5,
      halalFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, openEventEligible: true,
      cuisineTags: ["food_hall", "american", "mediterranean", "ramen", "coffee"],
    }),
    seedVenue({
      id: "nyc-eataly-flatiron", name: "Eataly Flatiron", city: "nyc", neighborhood: "Flatiron / Union Square",
      address: "200 5th Ave, New York, NY 10010", lat: 40.7421, lng: -73.9899, category: "food_hall",
      priceTier: 3, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Just inside the 5th Ave main entrance beside the Lavazza espresso bar",
      hours: dailyHours(8 * 60, 22 * 60), yelpRating: 4.3, safetyScore: 10, transitScore: 5,
      personaPriors: { foodie: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-le-district", name: "Le District", city: "nyc", neighborhood: "Financial District / Seaport",
      address: "225 Liberty St, New York, NY 10281", lat: 40.7130, lng: -74.0154, category: "food_hall",
      priceTier: 3, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the Brookfield Place waterfront entrance next to the pastry counter",
      hours: dailyHours(8 * 60, 21 * 60), yelpRating: 4.3, safetyScore: 10, transitScore: 5,
    }),
    seedVenue({
      id: "nyc-conwell-coffee", name: "Conwell Coffee Hall", city: "nyc", neighborhood: "Financial District / Seaport",
      address: "6 Hanover St, New York, NY 10005", lat: 40.7048, lng: -74.0094, category: "coffee_shop",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the grand banking hall directly in front of the central espresso counter",
      hours: dailyHours(7 * 60 + 30, 19 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 5,
      personaPriors: { creative: { alpha: 9, beta: 2 }, builder: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-devocion-williamsburg", name: "Devoción (Williamsburg)", city: "nyc", neighborhood: "Williamsburg",
      address: "69 Grand St, Brooklyn, NY 11249", lat: 40.7161, lng: -73.9647, category: "coffee_shop",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Under the living plant wall in the sunlit skylight atrium",
      hours: dailyHours(8 * 60, 19 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 4,
      personaPriors: { creative: { alpha: 9, beta: 2 }, romantic: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-threes-brewing", name: "Threes Brewing", city: "nyc", neighborhood: "Gowanus / Park Slope",
      address: "333 Douglass St, Brooklyn, NY 11217", lat: 40.6799, lng: -73.9822, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the main taproom bar near the archway to the back yard patio",
      hours: splitHours(12 * 60, 23 * 60, 11 * 60, 24 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 4,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-other-half-rockefeller", name: "Other Half Brewing (Rockefeller Center)", city: "nyc", neighborhood: "Midtown West / Hudson Yards",
      address: "30 Rockefeller Plaza, Concourse, New York, NY 10112", lat: 40.7587, lng: -73.9787, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the Rockefeller Center taproom entrance beside the rink plaza",
      hours: dailyHours(12 * 60, 22 * 60), yelpRating: 4.5, safetyScore: 10, transitScore: 5,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-domino-park", name: "Domino Park", city: "nyc", neighborhood: "Williamsburg",
      address: "15 River St, Brooklyn, NY 11249", lat: 40.7155, lng: -73.9673, category: "waterfront_park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "By the elevated artifact walkway stairs next to Tacocina",
      hours: dailyHours(6 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "nyc-high-line-little-island", name: "The High Line / Little Island", city: "nyc", neighborhood: "Chelsea / Meatpacking",
      address: "Pier 55 at Hudson River Park, New York, NY 10014", lat: 40.7421, lng: -74.0103, category: "park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "At the Little Island south bridge entry plaza on Pier 55",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 4,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "nyc-mcnally-jackson-seaport", name: "McNally Jackson Seaport (Bookstore & Cafe)", city: "nyc", neighborhood: "Financial District / Seaport",
      address: "4 Fulton St, New York, NY 10038", lat: 40.7068, lng: -74.0033, category: "bookstore_cafe",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "At the upstairs cafe bar overlooking the cobblestones on Fulton St",
      hours: dailyHours(10 * 60, 21 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 5,
      personaPriors: { intellectual: { alpha: 10, beta: 1 }, creative: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-veselka-ev", name: "Veselka", city: "nyc", neighborhood: "East Village",
      address: "144 2nd Ave, New York, NY 10003", lat: 40.7290, lng: -73.9871, category: "diner",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Outside the 9th St & 2nd Ave corner entrance by the Veselka neon sign",
      hours: dailyHours(8 * 60, 23 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 5,
      personaPriors: { foodie: { alpha: 9, beta: 2 }, social: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-overstory-fidi", name: "Overstory", city: "nyc", neighborhood: "Financial District / Seaport",
      address: "70 Pine St, 64th Floor, New York, NY 10005", lat: 40.7064, lng: -74.0077, category: "cocktail_lounge",
      priceTier: 4, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: false, walkInGroupCapacity: 2, reservationRequired: true,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "At the 70 Pine St Art Deco lobby elevator host desk",
      hours: dailyHours(17 * 60, 24 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      personaPriors: { romantic: { alpha: 10, beta: 1 }, upscale: { alpha: 10, beta: 1 } },
    }),
    seedVenue({
      id: "nyc-hex-and-co-union", name: "Hex & Co. (Union Square)", city: "nyc", neighborhood: "Flatiron / Union Square",
      address: "801 Broadway, New York, NY 10003", lat: 40.7327, lng: -73.9914, category: "board_game_cafe",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Just inside the Broadway entrance beside the wall-to-wall game library",
      hours: splitHours(12 * 60, 23 * 60, 11 * 60, 23 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 5,
      hobbies: ["pokemon_tcg", "mtg", "board_games", "tabletop", "tcg", "chess"],
      cuisineTags: ["cafe", "snacks", "coffee", "tea"],
      personaPriors: { nerd: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-vital-williamsburg", name: "VITAL Climbing Gym (Brooklyn)", city: "nyc", neighborhood: "Williamsburg",
      address: "221 N 14th St, Brooklyn, NY 11249", lat: 40.7220, lng: -73.9554, category: "climbing_gym",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the N 14th St lobby beside the front check-in counter",
      hours: dailyHours(7 * 60, 23 * 60), yelpRating: 4.8, safetyScore: 9, transitScore: 4,
      hobbies: ["bouldering", "climbing", "fitness"],
      personaPriors: { outdoorsy: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "nyc-te-company-wv", name: "Té Company", city: "nyc", neighborhood: "West Village",
      address: "163 W 10th St, New York, NY 10014", lat: 40.7341, lng: -74.0018, category: "tea_house",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, openEventEligible: false, reservationRequired: false,
      noiseLevel: "quiet", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Down the short W 10th St garden steps right inside the tearoom counter",
      hours: dailyHours(12 * 60, 20 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      hobbies: ["tea", "reading", "quiet_chat"], cuisineTags: ["tea", "oolong", "taiwanese", "pastry"],
      personaPriors: { romantic: { alpha: 10, beta: 1 }, creative: { alpha: 9, beta: 2 }, intellectual: { alpha: 9, beta: 2 } },
    }),
  ],
};

// ---- 3. Los Angeles (la) ----

const LA_SPEC: CitySpec = {
  id: "la",
  name: "Los Angeles",
  shortName: "LA",
  tz: "America/Los_Angeles",
  primaryMode: "car",
  anchorZip: "90013",
  aliases: ["la", "los angeles", "socal", "dtla", "hollywood", "santa monica", "silver lake"],
  center: { lat: 34.0522, lng: -118.2437 },
  dateMaxMinutes: 35,
  groupMaxMinutes: 45,
  kmPerMinute: 0.42,
  baseMinutes: 10,
  zones: [
    { id: "dtla_east", name: "DTLA & Eastside" },
    { id: "central_la", name: "Central LA & WeHo" },
    { id: "westside", name: "Westside & Beach" },
    { id: "northeast_la", name: "Northeast LA" },
  ],
  neighborhoods: [
    { name: "Arts District / DTLA", zone: "dtla_east", lat: 34.0407, lng: -118.2351, aliases: ["arts district", "dtla", "downtown la", "chinatown", "little tokyo"], hubSupply: 10 },
    { name: "Silver Lake", zone: "dtla_east", lat: 34.0869, lng: -118.2702, aliases: ["silver lake", "silverlake"], hubSupply: 8 },
    { name: "Echo Park", zone: "dtla_east", lat: 34.0782, lng: -118.2606, aliases: ["echo park"], hubSupply: 8 },
    { name: "Los Feliz", zone: "dtla_east", lat: 34.1063, lng: -118.2879, aliases: ["los feliz", "griffith park"], hubSupply: 8 },
    { name: "Koreatown", zone: "central_la", lat: 34.0579, lng: -118.3009, aliases: ["koreatown", "ktown", "mid-wilshire"], hubSupply: 9 },
    { name: "West Hollywood / Fairfax", zone: "central_la", lat: 34.0850, lng: -118.3617, aliases: ["west hollywood", "weho", "fairfax", "melrose", "beverly grove"], hubSupply: 9 },
    { name: "Culver City", zone: "westside", lat: 34.0211, lng: -118.3965, aliases: ["culver city", "culver", "palms"], hubSupply: 9 },
    { name: "Santa Monica", zone: "westside", lat: 34.0195, lng: -118.4912, aliases: ["santa monica", "westside", "brentwood"], hubSupply: 8 },
    { name: "Venice / Abbot Kinney", zone: "westside", lat: 33.9912, lng: -118.4695, aliases: ["venice", "abbot kinney", "mar vista", "marina del rey"], hubSupply: 8 },
    { name: "Highland Park", zone: "northeast_la", lat: 34.1130, lng: -118.1912, aliases: ["highland park", "nela", "eagle rock", "pasadena"], hubSupply: 7 },
  ],
  barriers: [
    { fromZone: "westside", toZone: "dtla_east", penaltyMinutes: 20, reason: "The 405 / Sepulveda Pass & Westside-Eastside rush hour" },
    { fromZone: "westside", toZone: "northeast_la", penaltyMinutes: 22, reason: "405 + crosstown freeway congestion" },
    { fromZone: "westside", toZone: "central_la", penaltyMinutes: 12, reason: "405 / Westside bottleneck" },
  ],
  seedVenues: [
    seedVenue({
      id: "la-grand-central-market", name: "Grand Central Market", city: "la", neighborhood: "Arts District / DTLA",
      address: "317 S Broadway, Los Angeles, CA 90013", lat: 34.0508, lng: -118.2487, category: "food_hall",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the Broadway entrance under the neon Grand Central Market arch",
      hours: dailyHours(8 * 60, 21 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 5,
      halalFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, openEventEligible: true,
      cuisineTags: ["food_hall", "tacos", "ramen", "coffee", "bakery"],
      personaPriors: { foodie: { alpha: 10, beta: 1 }, budget: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-citizens-public-market", name: "Citizens Public Market", city: "la", neighborhood: "Culver City",
      address: "9355 Culver Blvd, Culver City, CA 90232", lat: 34.0235, lng: -118.3935, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "At the main courtyard plaza fountain off Culver Blvd",
      hours: dailyHours(11 * 60, 22 * 60), yelpRating: 4.5, safetyScore: 10, transitScore: 4,
    }),
    seedVenue({
      id: "la-verve-arts-district", name: "Verve Coffee Roasters (Mateo St)", city: "la", neighborhood: "Arts District / DTLA",
      address: "500 Mateo St, Los Angeles, CA 90013", lat: 34.0412, lng: -118.2329, category: "coffee_shop",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the shaded outdoor patio deck along Mateo St",
      hours: dailyHours(7 * 60, 18 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 3,
      personaPriors: { creative: { alpha: 9, beta: 2 }, builder: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-steep-chinatown", name: "Steep LA", city: "la", neighborhood: "Arts District / DTLA",
      address: "970 N Broadway #112, Los Angeles, CA 90012", lat: 34.0658, lng: -118.2367, category: "cafe_tea_bar",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "In the Mandarin Plaza courtyard right outside Steep's tea bar window",
      hours: splitHours(11 * 60, 22 * 60, 11 * 60, 23 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      personaPriors: { creative: { alpha: 9, beta: 2 }, romantic: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-arts-district-brewing", name: "Arts District Brewing Co.", city: "la", neighborhood: "Arts District / DTLA",
      address: "828 Traction Ave, Los Angeles, CA 90013", lat: 34.0439, lng: -118.2351, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 14, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the Traction Ave main entrance by the long communal tables",
      hours: splitHours(15 * 60, 23 * 60, 12 * 60, 24 * 60), yelpRating: 4.3, safetyScore: 9, transitScore: 3,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-homage-brewing", name: "Homage Brewing", city: "la", neighborhood: "Arts District / DTLA",
      address: "1219 N Main St, Los Angeles, CA 90012", lat: 34.0672, lng: -118.2314, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the main taproom bar near the sunlit back patio doors",
      hours: splitHours(15 * 60, 23 * 60, 12 * 60, 23 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 3,
      personaPriors: { social: { alpha: 9, beta: 2 }, creative: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "la-stories-echo-park", name: "Stories Books & Cafe", city: "la", neighborhood: "Echo Park",
      address: "1716 Sunset Blvd, Los Angeles, CA 90026", lat: 34.0771, lng: -118.2586, category: "bookstore_cafe",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Out on the tree-shaded back patio behind the bookstore",
      hours: dailyHours(9 * 60, 21 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 3,
      personaPriors: { intellectual: { alpha: 10, beta: 1 }, creative: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-village-well-culver", name: "Village Well Books & Coffee", city: "la", neighborhood: "Culver City",
      address: "9900 Culver Blvd, Culver City, CA 90232", lat: 34.0209, lng: -118.3976, category: "bookstore_cafe",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the indoor coffee counter at the front of the bookstore",
      hours: dailyHours(8 * 60, 20 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 4,
      personaPriors: { intellectual: { alpha: 10, beta: 1 } },
    }),
    seedVenue({
      id: "la-silver-lake-meadow", name: "Silver Lake Meadow / Reservoir", city: "la", neighborhood: "Silver Lake",
      address: "2300 Silver Lake Blvd, Los Angeles, CA 90039", lat: 34.0933, lng: -118.2624, category: "park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "At the Silver Lake Meadow main gate on Silver Lake Blvd",
      hours: dailyHours(6 * 60, 21 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 3,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "la-original-pantry", name: "The Original Pantry Cafe", city: "la", neighborhood: "Arts District / DTLA",
      address: "877 S Figueroa St, Los Angeles, CA 90017", lat: 34.0462, lng: -118.2638, category: "diner",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Outside the Figueroa & 9th St corner entrance under the vintage marquee",
      hours: [
        { weekday: 0, openMin: 7 * 60, closeMin: 21 * 60 },
        { weekday: 1, openMin: 7 * 60, closeMin: 21 * 60 },
        { weekday: 2, openMin: 7 * 60, closeMin: 21 * 60 },
        { weekday: 3, openMin: 7 * 60, closeMin: 21 * 60 },
        { weekday: 4, openMin: 7 * 60, closeMin: 23 * 60 },
        { weekday: 5, openMin: 7 * 60, closeMin: 23 * 60 },
        { weekday: 6, openMin: 7 * 60, closeMin: 21 * 60 },
      ],
      yelpRating: 4.4, safetyScore: 9, transitScore: 4,
    }),
    seedVenue({
      id: "la-block-party-hlp", name: "Block Party", city: "la", neighborhood: "Highland Park",
      address: "5052 York Blvd, Los Angeles, CA 90042", lat: 34.1211, lng: -118.2063, category: "wine_beer_patio",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "At the back string-lit patio entrance through the main bar",
      hours: splitHours(16 * 60, 23 * 60, 13 * 60, 24 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 3,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-mirate-los-feliz", name: "Mírate", city: "la", neighborhood: "Los Feliz",
      address: "1712 N Vermont Ave, Los Angeles, CA 90027", lat: 34.1021, lng: -118.2917, category: "cocktail_lounge",
      priceTier: 4, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: false, walkInGroupCapacity: 2, reservationRequired: true,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the Vermont Ave host stand under the skylit indoor tree",
      hours: dailyHours(17 * 60, 23 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 3,
      personaPriors: { romantic: { alpha: 10, beta: 1 }, upscale: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-geeky-teas-games", name: "Geeky Teas & Games", city: "la", neighborhood: "Los Feliz",
      address: "900 W Alameda Ave, Burbank, CA 91506", lat: 34.1561, lng: -118.3168, category: "game_store",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Just inside the front tea counter beside the open tabletop play room",
      hours: dailyHours(11 * 60, 22 * 60), yelpRating: 4.8, safetyScore: 10, transitScore: 3,
      hobbies: ["pokemon_tcg", "mtg", "board_games", "tabletop", "tcg", "tea"],
      cuisineTags: ["tea", "snacks"],
      personaPriors: { nerd: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-boulders-arts-district", name: "LA Boulders", city: "la", neighborhood: "Arts District / DTLA",
      address: "1375 E 6th St, Los Angeles, CA 90021", lat: 34.0398, lng: -118.2314, category: "climbing_gym",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the E 6th St lobby check-in counter next to the lounge tables",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 3,
      hobbies: ["bouldering", "climbing", "fitness"],
      personaPriors: { outdoorsy: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "la-tea-master-matcha", name: "Tea Master Matcha Cafe", city: "la", neighborhood: "Arts District / DTLA",
      address: "450 E 2nd St, Los Angeles, CA 90012", lat: 34.0488, lng: -118.2392, category: "tea_house",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, openEventEligible: false, reservationRequired: false,
      noiseLevel: "quiet", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Outside the Little Tokyo Plaza courtyard benches beside the Tea Master window",
      hours: dailyHours(11 * 60, 20 * 60), yelpRating: 4.8, safetyScore: 9, transitScore: 4,
      hobbies: ["tea", "reading", "quiet_chat"], cuisineTags: ["japanese", "matcha", "tea", "dessert"],
      personaPriors: { romantic: { alpha: 9, beta: 2 }, foodie: { alpha: 9, beta: 2 } },
    }),
  ],
};

// ---- 4. Chicago (chicago) ----

const CHICAGO_SPEC: CitySpec = {
  id: "chicago",
  name: "Chicago",
  shortName: "CHI",
  tz: "America/Chicago",
  primaryMode: "transit",
  anchorZip: "60607",
  aliases: ["chicago", "chi", "chicagoland", "windy city", "the loop", "west loop", "wicker park", "logan square"],
  center: { lat: 41.8819, lng: -87.6278 },
  dateMaxMinutes: 30,
  groupMaxMinutes: 40,
  kmPerMinute: 0.30,
  baseMinutes: 8,
  zones: [
    { id: "loop_core", name: "Loop, West Loop & River North" },
    { id: "northwest_blue", name: "Blue Line (Wicker Park / Logan Square)" },
    { id: "north_red", name: "Red/Brown Line (Lincoln Park / Lakeview / Uptown)" },
    { id: "south_side", name: "South Side (Hyde Park)" },
  ],
  neighborhoods: [
    { name: "The Loop", zone: "loop_core", lat: 41.8819, lng: -87.6278, aliases: ["loop", "the loop", "downtown chicago", "millennium park", "riverwalk"], hubSupply: 10 },
    { name: "West Loop / Fulton Market", zone: "loop_core", lat: 41.8863, lng: -87.6518, aliases: ["west loop", "fulton market", "ogilvie", "greektown"], hubSupply: 10 },
    { name: "River North", zone: "loop_core", lat: 41.8924, lng: -87.6341, aliases: ["river north", "mag mile", "streeterville", "gold coast"], hubSupply: 9 },
    { name: "Wicker Park / Bucktown", zone: "northwest_blue", lat: 41.9088, lng: -87.6796, aliases: ["wicker park", "bucktown", "ukrainian village", "west town", "the 606"], hubSupply: 9 },
    { name: "Logan Square", zone: "northwest_blue", lat: 41.9231, lng: -87.7093, aliases: ["logan square", "avondale", "humboldt park"], hubSupply: 8 },
    { name: "Lincoln Park", zone: "north_red", lat: 41.9214, lng: -87.6513, aliases: ["lincoln park", "old town", "depaul"], hubSupply: 8 },
    { name: "Lakeview", zone: "north_red", lat: 41.9436, lng: -87.6584, aliases: ["lakeview", "wrigleyville", "boystown", "southport", "north center"], hubSupply: 8 },
    { name: "Uptown", zone: "north_red", lat: 41.9655, lng: -87.6585, aliases: ["uptown", "andersonville", "edgewater", "ravenswood", "balmoral"], hubSupply: 7 },
    { name: "Hyde Park", zone: "south_side", lat: 41.7943, lng: -87.5907, aliases: ["hyde park", "uchicago", "kenwood"], hubSupply: 7 },
  ],
  barriers: [
    { fromZone: "northwest_blue", toZone: "north_red", penaltyMinutes: 15, reason: "Diagonal CTA L transfer (Blue <-> Red/Brown)" },
    { fromZone: "south_side", toZone: "northwest_blue", penaltyMinutes: 18, reason: "South Side to Blue Line Loop transfer" },
    { fromZone: "south_side", toZone: "north_red", penaltyMinutes: 16, reason: "Cross-city South to North transit" },
  ],
  seedVenues: [
    seedVenue({
      id: "chi-timeout-market", name: "Time Out Market Chicago", city: "chicago", neighborhood: "West Loop / Fulton Market",
      address: "916 W Fulton Market, Chicago, IL 60607", lat: 41.8867, lng: -87.6502, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 14, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the Fulton Market main entrance beside the central ground-floor bar",
      hours: dailyHours(11 * 60, 22 * 60), yelpRating: 4.4, safetyScore: 10, transitScore: 5,
      halalFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, openEventEligible: true,
      cuisineTags: ["food_hall", "american", "ramen", "mediterranean", "dessert"],
      personaPriors: { foodie: { alpha: 9, beta: 2 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "chi-french-market", name: "Chicago French Market", city: "chicago", neighborhood: "West Loop / Fulton Market",
      address: "131 N Clinton St, Chicago, IL 60661", lat: 41.8842, lng: -87.6410, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the main seating tables inside the Clinton St entrance",
      hours: splitHours(8 * 60, 19 * 60, 9 * 60, 17 * 60), yelpRating: 4.5, safetyScore: 10, transitScore: 5,
    }),
    seedVenue({
      id: "chi-starbucks-reserve", name: "Starbucks Reserve Roastery", city: "chicago", neighborhood: "River North",
      address: "646 N Michigan Ave, Chicago, IL 60611", lat: 41.8944, lng: -87.6246, category: "coffee_shop",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "On the 2nd-floor Princi bakery level right at the top of the curved escalator",
      hours: dailyHours(7 * 60, 21 * 60), yelpRating: 4.5, safetyScore: 10, transitScore: 5,
    }),
    seedVenue({
      id: "chi-wormhole-coffee", name: "Wormhole Coffee", city: "chicago", neighborhood: "Wicker Park / Bucktown",
      address: "1462 N Milwaukee Ave, Chicago, IL 60622", lat: 41.9082, lng: -87.6746, category: "coffee_shop",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside right next to the DeLorean display near the front counter",
      hours: dailyHours(7 * 60, 18 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 5,
      personaPriors: { creative: { alpha: 9, beta: 2 }, nerd: { alpha: 10, beta: 1 } },
    }),
    seedVenue({
      id: "chi-dark-matter-star", name: "Dark Matter Coffee (Star Lounge)", city: "chicago", neighborhood: "Wicker Park / Bucktown",
      address: "2521 W Chicago Ave, Chicago, IL 60622", lat: 41.8957, lng: -87.6901, category: "coffee_shop",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the main espresso counter inside the Chicago Ave entrance",
      hours: dailyHours(7 * 60, 17 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 4,
    }),
    seedVenue({
      id: "chi-pilot-project", name: "Pilot Project Brewing", city: "chicago", neighborhood: "Logan Square",
      address: "2140 N Milwaukee Ave, Chicago, IL 60647", lat: 41.9203, lng: -87.6929, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the Milwaukee Ave taproom near the tasting bar",
      hours: splitHours(12 * 60, 22 * 60, 11 * 60, 23 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 5,
      personaPriors: { social: { alpha: 9, beta: 2 }, builder: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "chi-half-acre-balmoral", name: "Half Acre Beer Company (Balmoral)", city: "chicago", neighborhood: "Uptown",
      address: "2050 W Balmoral Ave, Chicago, IL 60625", lat: 41.9797, lng: -87.6812, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the main taproom entrance off Balmoral Ave next to the beer garden gate",
      hours: splitHours(15 * 60, 22 * 60, 12 * 60, 22 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 4,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "chi-riverwalk", name: "Chicago Riverwalk", city: "chicago", neighborhood: "The Loop",
      address: "Chicago Riverwalk at Michigan Ave, Chicago, IL 60601", lat: 41.8884, lng: -87.6244, category: "waterfront_park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "At the bottom of the southwest Michigan Ave Bridge staircase on the Riverwalk",
      hours: dailyHours(6 * 60, 23 * 60), yelpRating: 4.8, safetyScore: 10, transitScore: 5,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "chi-millennium-park", name: "Millennium Park / The 606", city: "chicago", neighborhood: "The Loop",
      address: "201 E Randolph St, Chicago, IL 60602", lat: 41.8826, lng: -87.6226, category: "park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "By the north steps of Cloud Gate Plaza facing Michigan Ave",
      hours: dailyHours(6 * 60, 23 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "chi-good-funk-loop", name: "Good Funk", city: "chicago", neighborhood: "The Loop",
      address: "83 N Wacker Dr, Chicago, IL 60606", lat: 41.8832, lng: -87.6371, category: "wine_bar",
      priceTier: 3, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Just inside the Wacker Dr front window tables next to the wine shelf",
      hours: dailyHours(16 * 60, 23 * 60), yelpRating: 4.6, safetyScore: 10, transitScore: 5,
      personaPriors: { romantic: { alpha: 9, beta: 2 }, foodie: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "chi-valois-hyde-park", name: "Valois Restaurant", city: "chicago", neighborhood: "Hyde Park",
      address: "1518 E 53rd St, Chicago, IL 60615", lat: 41.7996, lng: -87.5886, category: "diner",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the 53rd St entrance beside the cafeteria line rail",
      hours: dailyHours(7 * 60, 20 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 4,
      personaPriors: { budget: { alpha: 9, beta: 1 }, intellectual: { alpha: 8, beta: 2 } },
    }),
    seedVenue({
      id: "chi-kumiko-west-loop", name: "Kumiko", city: "chicago", neighborhood: "West Loop / Fulton Market",
      address: "630 W Lake St, Chicago, IL 60661", lat: 41.8856, lng: -87.6442, category: "cocktail_lounge",
      priceTier: 4, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: false, walkInGroupCapacity: 2, reservationRequired: true,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "At the wooden Lake St front host vestibule",
      hours: dailyHours(17 * 60, 24 * 60), yelpRating: 4.8, safetyScore: 10, transitScore: 5,
      personaPriors: { romantic: { alpha: 10, beta: 1 }, upscale: { alpha: 10, beta: 1 } },
    }),
    seedVenue({
      id: "chi-dice-dojo", name: "Chicagoland Games Dice Dojo", city: "chicago", neighborhood: "Uptown",
      address: "5550 N Broadway, Chicago, IL 60640", lat: 41.9830, lng: -87.6601, category: "game_store",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the N Broadway entrance by the main open-play game room tables",
      hours: splitHours(12 * 60, 22 * 60, 11 * 60, 22 * 60), yelpRating: 4.8, safetyScore: 9, transitScore: 5,
      hobbies: ["pokemon_tcg", "mtg", "board_games", "tabletop", "tcg"],
      personaPriors: { nerd: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "chi-snakes-and-lattes", name: "Snakes & Lattes Chicago", city: "chicago", neighborhood: "Wicker Park / Bucktown",
      address: "1965 N Milwaukee Ave, Chicago, IL 60647", lat: 41.9175, lng: -87.6873, category: "board_game_cafe",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 14, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "By the Milwaukee Ave host counter facing the board-game wall",
      hours: dailyHours(11 * 60, 23 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 5,
      hobbies: ["board_games", "pokemon_tcg", "tabletop", "chess"], cuisineTags: ["cafe", "coffee", "tea", "casual"],
      personaPriors: { nerd: { alpha: 9, beta: 2 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "chi-first-ascent-loop", name: "First Ascent Block 37", city: "chicago", neighborhood: "The Loop",
      address: "108 N State St, Chicago, IL 60602", lat: 41.8837, lng: -87.6281, category: "climbing_gym",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "At the 4th-floor Block 37 climbing gym front check-in desk",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      hobbies: ["bouldering", "climbing", "fitness"],
      personaPriors: { outdoorsy: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
  ],
};

// ---- 5. Miami (miami) ----

const MIAMI_SPEC: CitySpec = {
  id: "miami",
  name: "Miami",
  shortName: "MIA",
  tz: "America/New_York",
  primaryMode: "car",
  anchorZip: "33131",
  aliases: ["miami", "mia", "south beach", "sobe", "miami beach", "brickell", "wynwood", "coral gables"],
  center: { lat: 25.7781, lng: -80.1918 },
  dateMaxMinutes: 35,
  groupMaxMinutes: 45,
  kmPerMinute: 0.40,
  baseMinutes: 10,
  zones: [
    { id: "mainland_core", name: "Brickell & Downtown" },
    { id: "mainland_north", name: "Wynwood & Design District" },
    { id: "mainland_south", name: "Grove, Gables & Little Havana" },
    { id: "beach", name: "Miami Beach (SoBe / Mid-Beach)" },
  ],
  neighborhoods: [
    { name: "Brickell", zone: "mainland_core", lat: 25.7617, lng: -80.1918, aliases: ["brickell", "brickell key", "underline"], hubSupply: 10 },
    { name: "Downtown / Arts & Entertainment", zone: "mainland_core", lat: 25.7781, lng: -80.1867, aliases: ["downtown miami", "downtown", "arts district miami", "bayfront", "museum park"], hubSupply: 9 },
    { name: "Wynwood", zone: "mainland_north", lat: 25.8007, lng: -80.1995, aliases: ["wynwood", "edgewater"], hubSupply: 10 },
    { name: "Design District / Midtown", zone: "mainland_north", lat: 25.8126, lng: -80.1920, aliases: ["design district", "midtown miami", "midtown"], hubSupply: 8 },
    { name: "Coconut Grove", zone: "mainland_south", lat: 25.7271, lng: -80.2416, aliases: ["coconut grove", "the grove", "grove"], hubSupply: 8 },
    { name: "Coral Gables", zone: "mainland_south", lat: 25.7498, lng: -80.2610, aliases: ["coral gables", "gables", "miracle mile"], hubSupply: 8 },
    { name: "Little Havana", zone: "mainland_south", lat: 25.7655, lng: -80.2194, aliases: ["little havana", "calle ocho"], hubSupply: 7 },
    { name: "South Beach", zone: "beach", lat: 25.7826, lng: -80.1304, aliases: ["south beach", "sobe", "lincoln road", "miami beach"], hubSupply: 9 },
    { name: "Mid-Beach", zone: "beach", lat: 25.8130, lng: -80.1230, aliases: ["mid-beach", "mid beach", "faena"], hubSupply: 7 },
  ],
  barriers: [
    { fromZone: "beach", toZone: "mainland_core", penaltyMinutes: 18, reason: "MacArthur / Venetian Causeway traffic" },
    { fromZone: "beach", toZone: "mainland_north", penaltyMinutes: 18, reason: "Julia Tuttle / Venetian Causeway traffic" },
    { fromZone: "beach", toZone: "mainland_south", penaltyMinutes: 24, reason: "Causeway + I-95 congestion" },
    { fromZone: "mainland_north", toZone: "mainland_south", penaltyMinutes: 12, reason: "I-95 / US-1 corridor congestion" },
  ],
  seedVenues: [
    seedVenue({
      id: "mia-1800-lucky", name: "1-800-Lucky", city: "miami", neighborhood: "Wynwood",
      address: "143 NW 23rd St, Miami, FL 33127", lat: 25.7995, lng: -80.1980, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 14, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Just past the record-shop entrance by the main indoor bar",
      hours: dailyHours(12 * 60, 24 * 60), yelpRating: 4.4, safetyScore: 9, transitScore: 3,
      halalFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, openEventEligible: true,
      cuisineTags: ["food_hall", "asian", "ramen", "sushi", "dessert"],
      personaPriors: { foodie: { alpha: 9, beta: 2 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-south-beach-food-hall", name: "South Beach Food Hall", city: "miami", neighborhood: "South Beach",
      address: "1601 Drexel Ave, Miami Beach, FL 33139", lat: 25.7903, lng: -80.1322, category: "food_hall",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the Drexel Ave main entrance beside the central bar island",
      hours: dailyHours(11 * 60, 22 * 60), yelpRating: 4.3, safetyScore: 9, transitScore: 4,
    }),
    seedVenue({
      id: "mia-all-day", name: "All Day", city: "miami", neighborhood: "Downtown / Arts & Entertainment",
      address: "1035 N Miami Ave, Miami, FL 33136", lat: 25.7844, lng: -80.1932, category: "coffee_shop",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the bright front espresso counter off N Miami Ave",
      hours: dailyHours(7 * 60 + 30, 17 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      personaPriors: { creative: { alpha: 9, beta: 2 }, builder: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-versailles-ventanita", name: "Versailles Bakery / Ventanita", city: "miami", neighborhood: "Little Havana",
      address: "3501 SW 8th St, Miami, FL 33135", lat: 25.7649, lng: -80.2524, category: "coffee_casual",
      priceTier: 1, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the covered bakery sidewalk tables right next to the Calle Ocho ventanita",
      hours: dailyHours(8 * 60, 22 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 3,
      personaPriors: { foodie: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "mia-veza-sur", name: "Veza Sur Brewing Co.", city: "miami", neighborhood: "Wynwood",
      address: "55 NW 25th St, Miami, FL 33127", lat: 25.8012, lng: -80.1959, category: "brewery",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 14, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the shaded front patio archway off NW 25th St",
      hours: splitHours(14 * 60, 23 * 60, 12 * 60, 24 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 3,
      personaPriors: { social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-books-and-books", name: "Books & Books (Coral Gables Flagship)", city: "miami", neighborhood: "Coral Gables",
      address: "265 Aragon Ave, Coral Gables, FL 33134", lat: 25.7506, lng: -80.2591, category: "bookstore_cafe",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 10, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "In the central courtyard cafe right past the Aragon Ave bookstore archway",
      hours: dailyHours(10 * 60, 21 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 3,
      personaPriors: { intellectual: { alpha: 10, beta: 1 }, creative: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-ferre-park", name: "Maurice A. Ferré Park (Museum Park)", city: "miami", neighborhood: "Downtown / Arts & Entertainment",
      address: "1075 Biscayne Blvd, Miami, FL 33132", lat: 25.7851, lng: -80.1862, category: "waterfront_park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "Under the shaded PAMM waterfront porch overhang facing Biscayne Bay",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 5,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "mia-the-underline", name: "The Underline (Brickell Backyard)", city: "miami", neighborhood: "Brickell",
      address: "SW 8th St & SW 1st Ave, Miami, FL 33130", lat: 25.7662, lng: -80.1951, category: "park",
      priceTier: 0, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: false, outdoor: true, weatherSensitive: true,
      arrivalLandmark: "By the Brickell Backyard Sound Stage promenade steps under the Metrorail",
      hours: dailyHours(7 * 60, 22 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 5,
      personaPriors: { outdoorsy: { alpha: 9, beta: 2 }, budget: { alpha: 9, beta: 1 } },
    }),
    seedVenue({
      id: "mia-barcelona-wynwood", name: "Barcelona Wine Bar", city: "miami", neighborhood: "Wynwood",
      address: "260 NW 27th St, Miami, FL 33127", lat: 25.8022, lng: -80.2006, category: "wine_bar",
      priceTier: 3, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 4, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "By the NW 27th St front courtyard host entrance",
      hours: dailyHours(16 * 60, 24 * 60), yelpRating: 4.6, safetyScore: 9, transitScore: 3,
      personaPriors: { romantic: { alpha: 9, beta: 2 }, foodie: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-big-pink", name: "Big Pink", city: "miami", neighborhood: "South Beach",
      address: "157 Collins Ave, Miami Beach, FL 33139", lat: 25.7706, lng: -80.1325, category: "diner",
      priceTier: 2, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 8, reservationRequired: false,
      noiseLevel: "lively", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Outside the Collins Ave covered patio corner by the pink neon sign",
      hours: dailyHours(8 * 60, 24 * 60), yelpRating: 4.2, safetyScore: 9, transitScore: 4,
    }),
    seedVenue({
      id: "mia-broken-shaker", name: "The Broken Shaker (Freehand)", city: "miami", neighborhood: "Mid-Beach",
      address: "2727 Indian Creek Dr, Miami Beach, FL 33140", lat: 25.8041, lng: -80.1264, category: "cocktail_lounge",
      priceTier: 3, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 6, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Just inside the Freehand poolside garden gate facing the main cocktail bar",
      hours: dailyHours(17 * 60, 25 * 60), yelpRating: 4.5, safetyScore: 9, transitScore: 3,
      personaPriors: { romantic: { alpha: 9, beta: 2 }, creative: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-viceversa", name: "ViceVersa (The Elser)", city: "miami", neighborhood: "Downtown / Arts & Entertainment",
      address: "398 NE 5th St, Miami, FL 33132", lat: 25.7793, lng: -80.1879, category: "cocktail_lounge",
      priceTier: 4, ageMin: 21, isBarOnly: false, alcoholOptional: true, servesVegetarian: true, servesVegan: false,
      wheelchairAccessible: true, separateChecks: false, walkInGroupCapacity: 2, reservationRequired: true,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside The Elser hotel lobby at the ViceVersa aperitivo bar entrance",
      hours: dailyHours(17 * 60, 24 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      personaPriors: { romantic: { alpha: 10, beta: 1 }, upscale: { alpha: 10, beta: 1 } },
    }),
    seedVenue({
      id: "mia-pro-play-games", name: "Pro-Play Games", city: "miami", neighborhood: "Coral Gables",
      address: "10680 SW 40th St, Miami, FL 33165", lat: 25.7332, lng: -80.2640, category: "game_store",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 15, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: false, weatherSensitive: false,
      arrivalLandmark: "Inside the main entrance beside the open tabletop play tables",
      hours: dailyHours(12 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 3,
      hobbies: ["pokemon_tcg", "mtg", "board_games", "tabletop", "tcg"],
      personaPriors: { nerd: { alpha: 10, beta: 1 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-tea-and-poets", name: "Tea & Poets", city: "miami", neighborhood: "Coconut Grove",
      address: "5701 Sunset Dr, South Miami, FL 33143", lat: 25.7043, lng: -80.2865, category: "tea_house",
      priceTier: 1, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, openEventEligible: true, reservationRequired: false,
      noiseLevel: "conversational", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Inside the main tea lounge beside the front loose-leaf tea counter",
      hours: dailyHours(11 * 60, 22 * 60), yelpRating: 4.7, safetyScore: 9, transitScore: 4,
      hobbies: ["tea", "board_games", "reading", "poetry", "chess"], cuisineTags: ["tea", "matcha", "boba", "dessert"],
      personaPriors: { creative: { alpha: 10, beta: 1 }, romantic: { alpha: 9, beta: 2 }, social: { alpha: 9, beta: 2 } },
    }),
    seedVenue({
      id: "mia-pamm-gallery", name: "Pérez Art Museum Miami (PAMM)", city: "miami", neighborhood: "Downtown / Arts & Entertainment",
      address: "1103 Biscayne Blvd, Miami, FL 33132", lat: 25.7859, lng: -80.1860, category: "museum_gallery",
      priceTier: 2, isBarOnly: false, isAlcoholCentric: false, alcoholOptional: true, servesVegetarian: true, servesVegan: true,
      halalFriendly: true, kosherFriendly: true, glutenFreeFriendly: true, severeAllergenSafe: true, isSmokeFree: true,
      wheelchairAccessible: true, separateChecks: true, walkInGroupCapacity: 12, openEventEligible: true, reservationRequired: false,
      noiseLevel: "quiet", liveMusicAtNight: false, indoor: true, outdoor: true, weatherSensitive: false,
      arrivalLandmark: "Under the hanging gardens porch overlooking Biscayne Bay beside the main entrance",
      hours: dailyHours(11 * 60, 21 * 60), yelpRating: 4.7, safetyScore: 10, transitScore: 5,
      hobbies: ["art", "museums", "photography", "quiet_chat"], cuisineTags: ["cafe", "mediterranean"],
      personaPriors: { creative: { alpha: 10, beta: 1 }, romantic: { alpha: 10, beta: 1 }, intellectual: { alpha: 9, beta: 2 } },
    }),
  ],
};

// ---- Registry & Pre-Indexed Lookup Tables ----

function normText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s/-]+/g, " ").replace(/\s+/g, " ").trim();
}

interface NeighborhoodSubstringEntry {
  normName: string;
  normAliases: string[];
  neighborhood: CityNeighborhood;
}

interface CityIndex {
  spec: CitySpec;
  normName: string;
  normShortName: string;
  normAliasSet: Set<string>;
  longNormAliases: string[];
  byExactName: Map<string, CityNeighborhood>;
  byNormArea: Map<string, CityNeighborhood>;
  substringEntries: NeighborhoodSubstringEntry[];
  barriers: Map<string, number>;
  neighborhoodIdx: Map<CityNeighborhood, number>;
  pairMinutes: Int32Array;
  centerMinutes: Int32Array;
  centerToCenterMinutes: number;
}

function buildCityIndex(spec: CitySpec): CityIndex {
  const normName = normText(spec.name);
  const normShortName = normText(spec.shortName);
  const normAliasSet = new Set<string>();
  const longNormAliases: string[] = [];
  for (const a of spec.aliases) {
    const na = normText(a);
    if (!na) continue;
    normAliasSet.add(na);
    if (na.length >= 4) longNormAliases.push(na);
  }

  const byNormArea = new Map<string, CityNeighborhood>();
  const substringEntries: NeighborhoodSubstringEntry[] = [];
  const neighborhoodIdx = new Map<CityNeighborhood, number>();
  const n = spec.neighborhoods.length;

  for (let i = 0; i < n; i++) {
    const hood = spec.neighborhoods[i]!;
    neighborhoodIdx.set(hood, i);
    const nn = normText(hood.name);
    if (nn && !byNormArea.has(nn)) byNormArea.set(nn, hood);
    const normAliases: string[] = [];
    for (const a of hood.aliases) {
      const na = normText(a);
      if (na && !byNormArea.has(na)) byNormArea.set(na, hood);
      if (na.length >= 4) normAliases.push(na);
    }
    substringEntries.push({ normName: nn, normAliases, neighborhood: hood });
  }

  const byExactName = new Map<string, CityNeighborhood>();
  for (const hood of spec.neighborhoods) {
    if (byNormArea.get(normText(hood.name)) === hood) {
      byExactName.set(hood.name, hood);
    }
  }

  const barriers = new Map<string, number>();
  for (const b of spec.barriers) {
    const k1 = `${b.fromZone}\0${b.toZone}`;
    const k2 = `${b.toZone}\0${b.fromZone}`;
    if (!barriers.has(k1)) barriers.set(k1, b.penaltyMinutes);
    if (!barriers.has(k2)) barriers.set(k2, b.penaltyMinutes);
  }

  const pairMinutes = new Int32Array(n * n);
  const centerMinutes = new Int32Array(n);
  const centerToCenterMinutes = Math.max(5, Math.round(spec.baseMinutes));
  for (let i = 0; i < n; i++) {
    const a = spec.neighborhoods[i]!;
    centerMinutes[i] = Math.max(5, Math.round(spec.baseMinutes + km(spec.center, a) / spec.kmPerMinute));
    for (let j = 0; j < n; j++) {
      const b = spec.neighborhoods[j]!;
      if (a.name === b.name) {
        pairMinutes[i * n + j] = 5;
      } else {
        const barrier = a.zone === b.zone ? 0 : (barriers.get(`${a.zone}\0${b.zone}`) ?? 0);
        pairMinutes[i * n + j] = Math.max(5, Math.round(spec.baseMinutes + km(a, b) / spec.kmPerMinute + barrier));
      }
    }
  }

  return {
    spec,
    normName,
    normShortName,
    normAliasSet,
    longNormAliases,
    byExactName,
    byNormArea,
    substringEntries,
    barriers,
    neighborhoodIdx,
    pairMinutes,
    centerMinutes,
    centerToCenterMinutes,
  };
}

const registry = new Map<string, CitySpec>([
  [SF_SPEC.id, SF_SPEC],
  [NYC_SPEC.id, NYC_SPEC],
  [LA_SPEC.id, LA_SPEC],
  [CHICAGO_SPEC.id, CHICAGO_SPEC],
  [MIAMI_SPEC.id, MIAMI_SPEC],
]);

const indexRegistry = new Map<string, CityIndex>([
  [SF_SPEC.id, buildCityIndex(SF_SPEC)],
  [NYC_SPEC.id, buildCityIndex(NYC_SPEC)],
  [LA_SPEC.id, buildCityIndex(LA_SPEC)],
  [CHICAGO_SPEC.id, buildCityIndex(CHICAGO_SPEC)],
  [MIAMI_SPEC.id, buildCityIndex(MIAMI_SPEC)],
]);

export const CITIES: Record<LaunchCity, CitySpec> = {
  sf: SF_SPEC,
  nyc: NYC_SPEC,
  la: LA_SPEC,
  chicago: CHICAGO_SPEC,
  miami: MIAMI_SPEC,
};

export const CITY_IDS: readonly LaunchCity[] = ["sf", "nyc", "la", "chicago", "miami"];

function getCityIndex(id: LaunchCity | string): CityIndex | undefined {
  return indexRegistry.get(id) ?? indexRegistry.get(id.trim().toLowerCase());
}

/** Register a new city spec (or override an existing one) so expanding to city #6+ is a single call. */
export function registerCity(spec: CitySpec): void {
  registry.set(spec.id, spec);
  indexRegistry.set(spec.id, buildCityIndex(spec));
  (CITIES as Record<string, CitySpec>)[spec.id] = spec;
}

export function getCity(id: LaunchCity | string): CitySpec | undefined {
  return registry.get(id) ?? registry.get(id.trim().toLowerCase());
}

export function listCities(): CitySpec[] {
  return [...registry.values()];
}

export function seedVenuesForCity(city: LaunchCity): VenueRecord[] {
  return [...(getCity(city)?.seedVenues ?? [])];
}

export const ALL_SEED_VENUES: readonly VenueRecord[] = listCities().flatMap(c => c.seedVenues);

function findNeighborhoodInIndex(idx: CityIndex, area: string): CityNeighborhood | undefined {
  const exact = idx.byExactName.get(area);
  if (exact) return exact;
  const q = normText(area);
  if (!q) return undefined;
  const hit = idx.byNormArea.get(q);
  if (hit) return hit;
  for (let i = 0; i < idx.substringEntries.length; i++) {
    const entry = idx.substringEntries[i]!;
    if (entry.normName && q.includes(entry.normName)) return entry.neighborhood;
    for (let j = 0; j < entry.normAliases.length; j++) {
      if (q.includes(entry.normAliases[j]!)) return entry.neighborhood;
    }
  }
  return undefined;
}

/** Resolve free-form city text, abbreviation, or neighborhood name to a registered City id. */
export function resolveCity(text: string): LaunchCity | undefined {
  const q = normText(text);
  if (!q) return undefined;
  if (registry.has(q)) return q as LaunchCity;
  for (const idx of indexRegistry.values()) {
    if (idx.normName === q || idx.normShortName === q || idx.normAliasSet.has(q)) return idx.spec.id;
  }
  for (const idx of indexRegistry.values()) {
    if (idx.byNormArea.has(q)) return idx.spec.id;
  }
  for (const idx of indexRegistry.values()) {
    if (idx.normName && q.includes(idx.normName)) return idx.spec.id;
    for (let i = 0; i < idx.longNormAliases.length; i++) {
      if (q.includes(idx.longNormAliases[i]!)) return idx.spec.id;
    }
  }
  return undefined;
}

/** Resolve a neighborhood name or alias within a city; returns undefined if unknown. */
export function findNeighborhood(city: LaunchCity, area: string): CityNeighborhood | undefined {
  const idx = getCityIndex(city);
  if (!idx) return undefined;
  return findNeighborhoodInIndex(idx, area);
}

function estimateTravelInIndex(
  idx: CityIndex,
  a: CityNeighborhood | undefined,
  b: CityNeighborhood | undefined
): number {
  const n = idx.spec.neighborhoods.length;
  if (!a || !b) {
    if (a) {
      const ai = idx.neighborhoodIdx.get(a);
      if (ai !== undefined) return idx.centerMinutes[ai]!;
    }
    if (b) {
      const bi = idx.neighborhoodIdx.get(b);
      if (bi !== undefined) return idx.centerMinutes[bi]!;
    }
    return idx.centerToCenterMinutes;
  }
  const ai = idx.neighborhoodIdx.get(a);
  const bi = idx.neighborhoodIdx.get(b);
  if (ai !== undefined && bi !== undefined) {
    return idx.pairMinutes[ai * n + bi]!;
  }
  if (a.name === b.name) return 5;
  const dist = km(a, b);
  const barrier = a.zone === b.zone ? 0 : (idx.barriers.get(`${a.zone}\0${b.zone}`) ?? 0);
  return Math.max(5, Math.round(idx.spec.baseMinutes + dist / idx.spec.kmPerMinute + barrier));
}

/**
 * Estimate door-to-door travel minutes between two areas in a city, incorporating
 * haversine distance, primary mode speed, and geographic barrier penalties.
 */
export function estimateTravelMinutes(city: LaunchCity, fromArea: string, toArea: string): number {
  const idx = getCityIndex(city);
  if (!idx) return 30;
  const a = findNeighborhoodInIndex(idx, fromArea);
  const b = findNeighborhoodInIndex(idx, toArea);
  return estimateTravelInIndex(idx, a, b);
}

/**
 * Discrete neighborhood minimax + efficiency midpoint selection.
 * Delegates travel-limit validation and integer-scaled cost (6*max + 4*mean) to proved venueSelection.ts.
 * Relaxes limit in +5m steps up to +10m if no strict candidate exists; returns undefined if none fits.
 */
export function chooseFairMidpoint(
  city: LaunchCity,
  areas: string[],
  mode: "date" | "group" = "date"
): FairMidpointResult | undefined {
  const idx = getCityIndex(city);
  if (!idx || areas.length === 0 || idx.spec.neighborhoods.length === 0) return undefined;
  const { spec } = idx;
  const baseLimit = mode === "group" ? spec.groupMaxMinutes : spec.dateMaxMinutes;

  const nAreas = areas.length;
  const resolvedIdx = new Int32Array(nAreas);
  for (let i = 0; i < nAreas; i++) {
    const hood = findNeighborhoodInIndex(idx, areas[i]!);
    resolvedIdx[i] = hood ? (idx.neighborhoodIdx.get(hood) ?? -1) : -1;
  }

  const candidates = spec.neighborhoods;
  const nCandidates = candidates.length;
  const pairMinutes = idx.pairMinutes;
  const centerMinutes = idx.centerMinutes;
  const candidateTimes: number[][] = new Array(nCandidates);
  const candidateMax = new Int32Array(nCandidates);
  const candidateMean = new Int32Array(nCandidates);

  for (let c = 0; c < nCandidates; c++) {
    const times: number[] = new Array(nAreas);
    let maxMin = 0;
    let sum = 0;
    const cCenter = centerMinutes[c]!;
    for (let i = 0; i < nAreas; i++) {
      const ai = resolvedIdx[i]!;
      const t = ai >= 0 ? pairMinutes[ai * nCandidates + c]! : cCenter;
      times[i] = t;
      if (t > maxMin) maxMin = t;
      sum += t;
    }
    candidateTimes[c] = times;
    candidateMax[c] = maxMin;
    candidateMean[c] = Math.round(sum / nAreas);
  }

  for (const relax of [0, 5, 10]) {
    let best: FairMidpointResult | undefined;
    let bestBaseCost = 0;
    for (let c = 0; c < nCandidates; c++) {
      const times = candidateTimes[c]!;
      if (!isValidMidpoint(times, baseLimit, relax)) continue;
      const maxMin = candidateMax[c]!;
      const candidate = candidates[c]!;
      const meanMin = candidateMean[c]!;
      const supplyBonus = Number.isFinite(candidate.hubSupply) ? Math.max(0, Math.round(candidate.hubSupply * 2)) : 0;
      const baseCost = fairMidpointCostScaled(maxMin, meanMin);
      const netCost = Math.max(0, fairMidpointNetCostScaled(maxMin, meanMin, supplyBonus));
      if (
        !best ||
        netCost < best.costScaled ||
        (netCost === best.costScaled && baseCost < bestBaseCost)
      ) {
        best = {
          neighborhood: candidate,
          maxMinutes: maxMin,
          meanMinutes: meanMin,
          costScaled: netCost,
          relaxedBy: relax,
        };
        bestBaseCost = baseCost;
      }
    }
    if (best) return best;
  }
  return undefined;
}
