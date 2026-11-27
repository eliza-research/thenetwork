import {
  ALL_SEED_VENUES,
  CITIES,
  CITY_IDS,
  CITY_TZ,
  DAY,
  HOUR,
  MINUTE,
  Rng,
  SimClock,
  fromLocal,
  getCity,
  hash32,
  localParts,
  type AppId,
  type Category,
  type City,
  type Edge,
  type Facet,
  type Intent,
  type Member,
  type MemberId,
  type MemberVenuePrefs,
  type NetworkContext,
  type Presence,
  type Proposal,
  type ProviderClosureSignal,
  type SimMessage,
  type SimMeta,
  type VenuePriceTier,
  type VenueRecord,
} from "@thenetwork/core";
import { ConsentNetwork, type ExternalVenueProvider, type NetworkOptions } from "../../network/src/index.ts";
import { SimulatedVenueProvider as PlatformSimulatedVenueProvider } from "../../platform/src/venue-provider.ts";
import { FIRST_NAMES, LAST_NAMES } from "./taxonomy.ts";

export const FIVE_CITY_EPOCH = Date.UTC(2026, 10, 26, 12, 0, 0);

export interface FiveCityMember {
  id: MemberId;
  name: string;
  firstName: string;
  city: City;
  neighborhood: string;
  age: number;
  isMinor: boolean;
  archetype: string;
  maxBudgetTier: VenuePriceTier;
  drinksAlcohol: boolean;
  vegetarian: boolean;
  vegan: boolean;
  wheelchairNeeded: boolean;
  email?: string;
  apps: AppId[];
  canary: string;
  privateDisclosure: string;
  visitedVenueIds: string[];
  rejectedVenueIds: string[];
  dailyProactiveCount: number;
  stoppedAll: boolean;
  leftApps: AppId[];
}

export interface ImpromptuEvent {
  id: string;
  city: City;
  title: string;
  neighborhood: string;
  venueId: string;
  startMs: number;
  endMs: number;
  maxAttendees: number;
  alcoholOptional: boolean;
  priceTier: VenuePriceTier;
}

export interface ConversationTurn {
  atMs: number;
  atLabel: string;
  from: string;
  to: string;
  app: AppId;
  text: string;
  tag?: string;
}

export interface ScenarioCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface FiveCityScenarioResult {
  id: string;
  title: string;
  city: City | "multi";
  app: AppId;
  kind: "happy" | "unhappy";
  pass: boolean;
  checks: ScenarioCheck[];
  transcript: ConversationTurn[];
  summary: string;
}

export interface FiveCityPopulationSummary {
  totalMembers: number;
  adults: number;
  minors: number;
  byCity: Record<City, number>;
  curatedVenues: number;
  impromptuEvents: number;
  eventsByCity: Record<City, number>;
}

export interface FiveCityInvariantCounts {
  canaryLeaks: number;
  minorContacts: number;
  minorBarRecs: number;
  teenAdultContact: number;
  teenGapContact: number;
  teenLaneContact: number;
  teenUnreadyContact: number;
  teenSwitchOffContact: number;
  teenRelayContact: number;
  teenGroupContact: number;
  teenPlaceContact: number;
  peonPhysicalVenues: number;
  visitedOrRejectedRepeats: number;
  nonDrinkerBarRecs: number;
  quietHourViolations: number;
  dailyCapViolations: number;
  externalApiCallsAfterSufficiency: number;
  unsolicitedVideoInvites: number;
  blockedOrHeldSafetyItems: number;
}

export interface FiveCitySuiteResult {
  seed: number;
  population: FiveCityPopulationSummary;
  scenarios: FiveCityScenarioResult[];
  passedScenarios: number;
  totalScenarios: number;
  invariants: FiveCityInvariantCounts;
}

const ARCHETYPES = [
  "foodie",
  "builder",
  "creative",
  "social",
  "romantic",
  "outdoorsy",
  "intellectual",
  "upscale",
  "budget",
  "nightowl",
] as const;

const DISCLOSURES = [
  "quietly interviewing for a new VP role",
  "recovering from burnout leave this fall",
  "in early alcohol recovery and avoids bars",
  "managing a private family health issue",
  "going through an amicable separation",
] as const;

const EVENT_TEMPLATES: readonly { title: string; categories: string[]; hour: number; durationH: number }[] = [
  { title: "Food Hall Supper Club", categories: ["food_hall", "diner"], hour: 18, durationH: 2 },
  { title: "Morning Espresso & Sketch Walk", categories: ["coffee_shop", "bakery_cafe", "cafe_tea_bar"], hour: 10, durationH: 2 },
  { title: "Bookstore & Indie Ideas Table", categories: ["bookstore_cafe", "coffee_shop"], hour: 14, durationH: 2 },
  { title: "Waterfront Park Golden-Hour Stroll", categories: ["waterfront_park", "park"], hour: 16, durationH: 2 },
  { title: "Casual Games & Community Table", categories: ["board_game_cafe", "tea_house", "food_hall"], hour: 17, durationH: 2 },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const TZ_ABBR: Record<City, string> = {
  sf: "PST",
  la: "PST",
  chicago: "CST",
  nyc: "EST",
  miami: "EST",
};

export function formatLocalTime(ms: number, city: City): string {
  const p = localParts(ms, CITY_TZ[city]);
  const dow = WEEKDAYS[p.weekday] ?? "Day";
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${dow} ${hh}:${mm} ${TZ_ABBR[city]}`;
}

export function cloneSeedVenues(): VenueRecord[] {
  return ALL_SEED_VENUES.map(v => ({
    ...v,
    hours: v.hours.map(h => ({ ...h })),
    personaPriors: Object.fromEntries(
      Object.entries(v.personaPriors).map(([k, p]) => [k, { alpha: p.alpha, beta: p.beta }])
    ),
  }));
}

export function buildExternalVenuePool(): Record<City, VenueRecord[]> {
  const makeExtra = (
    city: City,
    idx: number,
    name: string,
    neighborhood: string,
    category: VenueRecord["category"],
    priceTier: VenuePriceTier
  ): VenueRecord => {
    const spec = getCity(city)!;
    const hood = spec.neighborhoods.find(n => n.name === neighborhood) ?? spec.neighborhoods[0]!;
    return {
      id: `${city}-ext-${idx}`,
      name,
      city,
      neighborhood: hood.name,
      address: `${100 + idx * 17} Main St, ${spec.name}`,
      lat: hood.lat + idx * 0.0007,
      lng: hood.lng - idx * 0.0005,
      category,
      public: true,
      status: "active",
      priceTier,
      ageMin: 0,
      isBarOnly: false,
      alcoholOptional: true,
      servesVegetarian: true,
      servesVegan: true,
      wheelchairAccessible: true,
      separateChecks: true,
      walkInGroupCapacity: 10,
      reservationRequired: false,
      noiseLevel: "conversational",
      liveMusicAtNight: false,
      indoor: true,
      outdoor: true,
      weatherSensitive: false,
      arrivalLandmark: `Inside the front entrance of ${name}`,
      hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 8 * 60, closeMin: 22 * 60 })),
      source: "google_places",
      lastVerifiedAt: FIVE_CITY_EPOCH,
      closureReports: 0,
      yelpRating: 4.5,
      safetyScore: 9,
      transitScore: 4,
      personaPriors: { default: { alpha: 9, beta: 2 }, foodie: { alpha: 9, beta: 2 }, social: { alpha: 9, beta: 2 } },
    };
  };

  return {
    sf: [
      makeExtra("sf", 1, "Ritual Coffee Roasters (Valencia)", "Mission District", "coffee_shop", 1),
      makeExtra("sf", 2, "Manny's Civic Cafe", "Mission District", "bookstore_cafe", 2),
      makeExtra("sf", 3, "Souvla (Hayes Valley)", "Hayes Valley", "diner", 2),
      makeExtra("sf", 4, "Blue Bottle Kiosk (Hayes)", "Hayes Valley", "coffee_shop", 1),
      makeExtra("sf", 5, "Spark Social SF", "SoMa / Yerba Buena", "food_hall", 2),
      makeExtra("sf", 6, "SPRO Coffee Lab", "Mission District", "coffee_shop", 2),
      makeExtra("sf", 7, "Dandelion Chocolate Cafe", "Mission District", "bakery_cafe", 2),
      makeExtra("sf", 8, "Andytown Coffee Roasters", "Embarcadero / FiDi", "coffee_shop", 1),
    ],
    nyc: [
      makeExtra("nyc", 1, "Pier 57 Market 57", "Chelsea / Meatpacking", "food_hall", 2),
      makeExtra("nyc", 2, "Essex Market", "Lower East Side", "food_hall", 2),
      makeExtra("nyc", 3, "Chelsea Market", "Chelsea / Meatpacking", "food_hall", 2),
      makeExtra("nyc", 4, "La Cabra Bakery", "East Village", "bakery_cafe", 2),
      makeExtra("nyc", 5, "Abraco Coffee", "East Village", "coffee_shop", 1),
      makeExtra("nyc", 6, "Book Club Bar", "East Village", "bookstore_cafe", 2),
      makeExtra("nyc", 7, "Urban Hawker", "Midtown West / Hudson Yards", "food_hall", 2),
      makeExtra("nyc", 8, "Time Out Market New York", "Financial District / Seaport", "food_hall", 2),
    ],
    la: [
      makeExtra("la", 1, "Platform Culver Courtyard", "Culver City", "food_hall", 2),
      makeExtra("la", 2, "Go Get Em Tiger (Culver)", "Culver City", "coffee_shop", 1),
      makeExtra("la", 3, "Maru Coffee (Arts District)", "Arts District / DTLA", "coffee_shop", 2),
      makeExtra("la", 4, "Smorgasburg LA", "Arts District / DTLA", "food_hall", 2),
      makeExtra("la", 5, "Kumquat Coffee", "Highland Park", "coffee_shop", 1),
      makeExtra("la", 6, "Dinosaur Coffee", "Silver Lake", "coffee_shop", 1),
      makeExtra("la", 7, "Alchemist Coffee Project", "Koreatown", "coffee_shop", 2),
      makeExtra("la", 8, "Demitasse Santa Monica", "Santa Monica", "coffee_shop", 1),
    ],
    chicago: [
      makeExtra("chicago", 1, "Sawada Coffee", "West Loop / Fulton Market", "coffee_shop", 1),
      makeExtra("chicago", 2, "Metric Coffee Cafe", "West Loop / Fulton Market", "coffee_shop", 1),
      makeExtra("chicago", 3, "Revival Food Hall", "The Loop", "food_hall", 2),
      makeExtra("chicago", 4, "Aster Hall", "River North", "food_hall", 2),
      makeExtra("chicago", 5, "Intelligentsia Millennium Park", "The Loop", "coffee_shop", 2),
      makeExtra("chicago", 6, "Gaslight Coffee Roasters", "Logan Square", "coffee_shop", 1),
      makeExtra("chicago", 7, "Kibbitznest Books & Brews", "Lincoln Park", "bookstore_cafe", 2),
      makeExtra("chicago", 8, "Plein Air Cafe", "Hyde Park", "bakery_cafe", 2),
    ],
    miami: [
      makeExtra("miami", 1, "The Oasis Wynwood Courtyard", "Wynwood", "food_hall", 2),
      makeExtra("miami", 2, "Smorgasburg Miami", "Wynwood", "food_hall", 2),
      makeExtra("miami", 3, "Vice City Bean", "Downtown / Arts & Entertainment", "coffee_shop", 1),
      makeExtra("miami", 4, "Suite Habana Cafe", "Wynwood", "coffee_shop", 1),
      makeExtra("miami", 5, "Zak the Baker", "Wynwood", "bakery_cafe", 2),
      makeExtra("miami", 6, "Pura Vida Brickell", "Brickell", "bakery_cafe", 2),
      makeExtra("miami", 7, "Oti Cafe Brickell", "Brickell", "coffee_shop", 1),
      makeExtra("miami", 8, "Julia & Henry's Food Hall", "Downtown / Arts & Entertainment", "food_hall", 2),
    ],
  };
}

export class SimVenueProvider implements ExternalVenueProvider {
  readonly platformProvider: PlatformSimulatedVenueProvider;
  private readonly extraPool: Record<City, VenueRecord[]>;

  constructor() {
    this.extraPool = buildExternalVenuePool();
    this.platformProvider = new PlatformSimulatedVenueProvider({
      discoveredByCity: this.extraPool,
    });
  }

  get searchCalls(): number {
    return this.platformProvider.searchCalls;
  }

  get openCheckCalls(): number {
    return this.platformProvider.verifyCalls;
  }

  setVenueStatus(venueId: string, status: ProviderClosureSignal): void {
    const mapped =
      status === "ProviderPermanentClosed"
        ? "closed_permanent"
        : status === "ProviderTemporaryClosed"
          ? "closed_temporary"
          : "operational";
    this.platformProvider.setClosedStatus(venueId, mapped);
  }

  async checkOpen(venue: VenueRecord, nowMs: number): Promise<ProviderClosureSignal> {
    const res = await this.platformProvider.verifyVenueOpen(venue, nowMs);
    if (res.status === "closed_permanent") return "ProviderPermanentClosed";
    if (res.status === "closed_temporary") return "ProviderTemporaryClosed";
    return "ProviderOpen";
  }

  async search(city: City, area: string, nowMs: number): Promise<VenueRecord[]> {
    const spec = getCity(city)!;
    const found = await this.platformProvider.searchVenues(
      { city, neighborhood: area, lat: spec.center.lat, lng: spec.center.lng, limit: 8 },
      nowMs
    );
    return found.map(v => ({
      ...v,
      lastVerifiedAt: nowMs,
      hours: v.hours.map(h => ({ ...h })),
      personaPriors: Object.fromEntries(Object.entries(v.personaPriors).map(([k, p]) => [k, { ...p }])),
    }));
  }

  verifyUserMention(city: City, name: string, neighborhood: string, nowMs: number): VenueRecord {
    const spec = getCity(city)!;
    const hood =
      spec.neighborhoods.find(n => n.name.toLowerCase() === neighborhood.toLowerCase()) ??
      spec.neighborhoods[0]!;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      id: `${city}-mention-${slug}`,
      name,
      city,
      neighborhood: hood.name,
      address: `2390 NW 2nd Ave, ${spec.name}`,
      lat: hood.lat,
      lng: hood.lng,
      category: "coffee_shop",
      public: true,
      status: "active",
      priceTier: 2,
      ageMin: 0,
      isBarOnly: false,
      alcoholOptional: true,
      servesVegetarian: true,
      servesVegan: true,
      wheelchairAccessible: true,
      separateChecks: true,
      walkInGroupCapacity: 8,
      reservationRequired: false,
      noiseLevel: "conversational",
      liveMusicAtNight: false,
      indoor: true,
      outdoor: true,
      weatherSensitive: false,
      arrivalLandmark: `By the main espresso bar inside ${name}`,
      hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 7 * 60, closeMin: 21 * 60 })),
      source: "listing",
      externalPlaceId: `mention:${city}:${slug}`,
      lastVerifiedAt: nowMs,
      closureReports: 0,
      yelpRating: 4.7,
      safetyScore: 9,
      transitScore: 4,
      personaPriors: {
        default: { alpha: 10, beta: 2 },
        creative: { alpha: 11, beta: 1 },
        foodie: { alpha: 10, beta: 2 },
      },
    };
  }
}

export function toVenuePrefs(m: FiveCityMember): MemberVenuePrefs {
  return {
    memberId: m.id,
    age: m.age,
    maxBudgetTier: m.maxBudgetTier,
    drinksAlcohol: m.drinksAlcohol,
    vegetarian: m.vegetarian,
    vegan: m.vegan,
    wheelchairNeeded: m.wheelchairNeeded,
    visitedVenueIds: [...m.visitedVenueIds],
    rejectedVenueIds: [...m.rejectedVenueIds],
    archetype: m.archetype,
  };
}

export function generateFiveCityPopulation(seed = 42, perCity = 30): {
  members: FiveCityMember[];
  venues: VenueRecord[];
  events: ImpromptuEvent[];
  summary: FiveCityPopulationSummary;
} {
  const root = new Rng(hash32("five-city-suite", seed));
  const members: FiveCityMember[] = [];
  const venues = cloneSeedVenues();
  const events: ImpromptuEvent[] = [];
  const byCity: Record<City, number> = { sf: 0, nyc: 0, la: 0, chicago: 0, miami: 0 };
  const eventsByCity: Record<City, number> = { sf: 0, nyc: 0, la: 0, chicago: 0, miami: 0 };

  for (const city of CITY_IDS) {
    const cr = root.fork("city", city);
    const spec = CITIES[city];
    const cityVenues = venues.filter(v => v.city === city);

    for (let i = 0; i < perCity; i++) {
      const r = cr.fork("member", i);
      const isMinor = i < 3;
      const age = isMinor ? 13 + (i % 5) : r.int(22, 49);
      const firstName = FIRST_NAMES[(i * 7 + CITY_IDS.indexOf(city) * 11) % FIRST_NAMES.length]!;
      const lastName = LAST_NAMES[(i * 5 + CITY_IDS.indexOf(city) * 3) % LAST_NAMES.length]!;
      const hood = spec.neighborhoods[i % spec.neighborhoods.length]!;
      const archetype = ARCHETYPES[i % ARCHETYPES.length]!;
      const maxBudgetTier = (
        isMinor ? 1 : r.weighted<VenuePriceTier>([[1, 0.25], [2, 0.4], [3, 0.22], [4, 0.13]])
      ) as VenuePriceTier;
      const drinksAlcohol = isMinor ? false : r.bool(0.75);
      const vegan = r.bool(0.14);
      const vegetarian = vegan || r.bool(0.22);
      const wheelchairNeeded = i % 15 === 4;
      const email =
        i % 6 === 0
          ? undefined
          : `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${city}${i}@example.test`;
      const id = `${city}-u${String(i + 1).padStart(2, "0")}`;
      const canary = `CNRY-${city.toUpperCase()}-${hash32(seed, id).toString(36).slice(0, 6).toUpperCase()}`;
      const apps: AppId[] = isMinor ? ["ntwrk", "friends"] : ["ntwrk", "slop", "friends", "peon"];

      members.push({
        id,
        name: `${firstName} ${lastName}`,
        firstName,
        city,
        neighborhood: hood.name,
        age,
        isMinor,
        archetype,
        maxBudgetTier,
        drinksAlcohol,
        vegetarian,
        vegan,
        wheelchairNeeded,
        email,
        apps,
        canary,
        privateDisclosure: `${DISCLOSURES[i % DISCLOSURES.length]} (ref ${canary})`,
        visitedVenueIds: [],
        rejectedVenueIds: [],
        dailyProactiveCount: 0,
        stoppedAll: false,
        leftApps: [],
      });
      byCity[city]++;
    }

    const tz = CITY_TZ[city];
    EVENT_TEMPLATES.forEach((tpl, idx) => {
      const venue =
        cityVenues.find(v => tpl.categories.includes(v.category) && !v.isBarOnly && v.ageMin <= 13) ??
        cityVenues.find(v => !v.isBarOnly)!;
      const day = 27 + (idx % 4);
      const startMs = fromLocal(2026, 11, day, tpl.hour, tz);
      events.push({
        id: `ev-${city}-${idx + 1}`,
        city,
        title: `${spec.shortName} ${tpl.title}`,
        neighborhood: venue.neighborhood,
        venueId: venue.id,
        startMs,
        endMs: startMs + tpl.durationH * HOUR,
        maxAttendees: Math.min(6, Math.max(4, venue.walkInGroupCapacity)),
        alcoholOptional: venue.alcoholOptional,
        priceTier: venue.priceTier,
      });
      eventsByCity[city]++;
    });
  }

  const adults = members.filter(m => !m.isMinor).length;
  const minors = members.length - adults;
  return {
    members,
    venues,
    events,
    summary: {
      totalMembers: members.length,
      adults,
      minors,
      byCity,
      curatedVenues: venues.length,
      impromptuEvents: events.length,
      eventsByCity,
    },
  };
}

export interface RecordedMessage {
  t: number;
  to: MemberId;
  body: string;
  meta: SimMeta;
}

export interface RecordedMeeting {
  proposalId: string;
  participants: MemberId[];
  city: City;
  at: number;
  kind?: string;
}

export class LiveConsentHarness {
  readonly clock: SimClock;
  readonly app: AppId;
  readonly city: City;
  readonly sent: RecordedMessage[] = [];
  readonly logs: { t: number; kind: string; detail: Record<string, unknown> }[] = [];
  readonly meetings: RecordedMeeting[] = [];
  readonly proposals: Proposal[] = [];
  readonly transcript: ConversationTurn[] = [];
  readonly members: Member[] = [];
  readonly facets: Facet[] = [];
  readonly intents: Intent[] = [];
  readonly presence: Presence[] = [];
  readonly edges: Edge[] = [];
  net: ConsentNetwork;
  private readonly memberNames = new Map<MemberId, string>();
  private readonly opts: NetworkOptions;
  private readonly snapshotTransform?: (snap: ReturnType<NetworkContext["snapshot"]>) => ReturnType<NetworkContext["snapshot"]>;
  private seq = 0;

  constructor(cfg: {
    app: AppId;
    city: City;
    startMs: number;
    networkOptions: NetworkOptions;
    snapshotTransform?: (snap: ReturnType<NetworkContext["snapshot"]>) => ReturnType<NetworkContext["snapshot"]>;
  }) {
    this.app = cfg.app;
    this.city = cfg.city;
    this.clock = new SimClock(cfg.startMs);
    this.opts = cfg.networkOptions;
    this.snapshotTransform = cfg.snapshotTransform;
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
  }

  restart(): void {
    const json = JSON.stringify(this.net.exportState());
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
    this.net.importState(JSON.parse(json));
  }

  addMember(
    m: FiveCityMember,
    extra: {
      categoriesOptIn?: Category[];
      romanceOptIn?: boolean;
      romance?: { is: "woman" | "man" | "nonbinary"; seeks: ("woman" | "man" | "nonbinary")[] };
      verified?: boolean;
      quietHours?: [number, number];
      extraFacets?: Omit<Facet, "id" | "memberId">[];
      extraIntents?: Omit<Intent, "memberId">[];
      extraPresence?: Omit<Presence, "memberId">[];
      state?: Member["state"];
    } = {}
  ): void {
    const now = this.clock.now();
    this.memberNames.set(m.id, m.firstName);
    const categories: Category[] =
      extra.categoriesOptIn ??
      (this.app === "slop"
        ? ["romance"]
        : this.app === "peon"
          ? ["professional"]
          : this.app === "friends"
            ? ["social", "hobby"]
            : ["social", "hobby", "professional"]);
    const romanceOptIn = !m.isMinor && (extra.romanceOptIn ?? this.app === "slop");
    this.members.push({
      id: m.id,
      name: m.name,
      homeCity: m.city,
      state: extra.state ?? "normal",
      joinedAt: now - 10 * DAY,
      age: m.age,
      unansweredProactive: 0,
      prefs: {
        categoriesOptIn: m.isMinor ? ["social"] : categories,
        quietHours: extra.quietHours ?? [22, 8],
        romanceOptIn,
        formats: this.app === "friends" ? ["small_group", "one_to_one"] : ["one_to_one"],
        maxTravelMinutes: 45,
        onlyWhenAsked: false,
      },
      apps: [...m.apps],
    });
    this.presence.push({
      memberId: m.id,
      city: m.city,
      type: "home",
      areas: [m.neighborhood],
    });
    for (const p of extra.extraPresence ?? []) {
      this.presence.push({ ...p, memberId: m.id });
    }
    const addFacet = (
      fid: string,
      kind: Facet["kind"],
      value: string,
      tags: string[],
      scope: Facet["scope"] = "matchable"
    ) => {
      this.facets.push({
        id: `${m.id}-${fid}`,
        memberId: m.id,
        kind,
        value,
        tags,
        scope,
        provenance: "said",
        confidence: 0.9,
        validFrom: now - 10 * DAY,
        source: "chat",
        confirmedByMember: true,
      });
    };
    addFacet("disclosure", "fact", m.privateDisclosure, [], "agent_private");
    addFacet("archetype", "interest", m.archetype, [m.archetype], "shareable");
    if (!m.isMinor && extra.verified !== false) {
      addFacet("verified", "fact", "Verified", ["verify:liveness:pass", "verify:age:pass"], "agent_private");
    }
    if (romanceOptIn) {
      const idx = this.members.length;
      const rom = extra.romance ?? (idx % 2 === 1 ? { is: "woman" as const, seeks: ["man" as const] } : { is: "man" as const, seeks: ["woman" as const] });
      addFacet(
        "romance",
        "boundary",
        "romance preferences",
        [`romance:is:${rom.is}`, ...rom.seeks.map(g => `romance:seeks:${g}`), "romance:age:18-99"],
        "agent_private"
      );
    }
    if (!m.drinksAlcohol) addFacet("nondrinker", "preference", "does not drink alcohol", ["no_alcohol", "non_drinker"], "agent_private");
    if (m.vegan) addFacet("vegan", "preference", "vegan", ["diet:vegan"], "agent_private");
    if (m.vegetarian) addFacet("veg", "preference", "vegetarian", ["diet:vegetarian"], "agent_private");
    if (m.wheelchairNeeded) addFacet("wheelchair", "preference", "wheelchair accessible venues", ["access:wheelchair"], "agent_private");
    addFacet("budget", "preference", `budget tier ${m.maxBudgetTier}`, [`venue:budget:${m.maxBudgetTier}`], "agent_private");
    if (m.email) addFacet("email", "fact", `email ${m.email}`, [`work:email:${m.email}`], "agent_private");

    extra.extraFacets?.forEach((f, idx) => {
      this.facets.push({ ...f, id: `${m.id}-x${idx}`, memberId: m.id });
    });
    extra.extraIntents?.forEach(intent => {
      this.intents.push({ ...intent, memberId: m.id });
    });
  }

  private ctx(): NetworkContext {
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        const meta = o?.meta ?? {};
        this.sent.push({ t, to: memberId, body, meta });
        this.transcript.push({
          atMs: t,
          atLabel: formatLocalTime(t, this.city),
          from: "Eliza",
          to: this.memberNames.get(memberId) ?? memberId,
          app: this.app,
          text: body,
          tag: typeof meta.type === "string" ? meta.type : undefined,
        });
        return {
          id: `o${++this.seq}`,
          ts: t,
          direction: "outbound",
          channel: "sms",
          from: "network",
          to: memberId,
          memberId,
          body,
          status: "delivered",
          meta,
        } satisfies SimMessage;
      },
      snapshot: () => {
        const base = {
          now: this.clock.now(),
          members: [...this.members],
          facets: [...this.facets],
          intents: [...this.intents],
          presence: [...this.presence],
          edges: [...this.edges],
          recentProposals: [...this.proposals],
        };
        return this.snapshotTransform ? this.snapshotTransform(base) : base;
      },
      recordProposal: p => {
        this.proposals.push(p);
      },
      recordMeeting: m => {
        this.meetings.push({
          proposalId: m.proposalId,
          participants: [...m.participants],
          city: m.city,
          at: m.at,
          kind: m.kind,
        });
        return `mt${this.meetings.length}`;
      },
      recordBlock: () => {},
      log: (kind, detail) => {
        this.logs.push({ t: this.clock.now(), kind, detail });
      },
    };
  }

  async say(id: MemberId, body: string, tag?: string, keyword?: "STOP" | "START" | "HELP"): Promise<"handled" | "open"> {
    const t = this.clock.now();
    this.transcript.push({
      atMs: t,
      atLabel: formatLocalTime(t, this.city),
      from: this.memberNames.get(id) ?? id,
      to: "Eliza",
      app: this.app,
      text: body,
      ...(tag ? { tag } : {}),
    });
    const res = await this.net.onInbound({
      id: `i${++this.seq}`,
      memberId: id,
      body,
      ts: t,
      channel: "sms",
      ...(keyword ? { keyword } : {}),
    });
    this.clock.advance(MINUTE);
    return res;
  }

  async onboard(...ids: MemberId[]): Promise<void> {
    const replies =
      this.app === "peon"
        ? ["hi!", "Work, mostly.", "Weekday evenings.", "One-on-one is good."]
        : this.app === "friends"
          ? ["hi!", "Meeting new friends.", "Weekends and evenings.", "Small groups are great."]
          : ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];
    for (const id of ids) {
      for (const text of replies) {
        await this.say(id, text);
      }
    }
  }

  propose(
    participants: MemberId[],
    o: { category?: Category; objective?: string; alternates?: MemberId[]; explanations?: Record<MemberId, string>; startMs?: number; endMs?: number } = {}
  ): string {
    const now = this.clock.now();
    const id = `${this.app}-${this.city}-${++this.seq}`;
    const p: Proposal = {
      id,
      kind: participants.length > 2 ? "group" : "intro",
      participants,
      alternates: o.alternates ?? [],
      objective: o.objective ?? (this.app === "peon" ? "Work introduction" : "a casual meetup"),
      category:
        o.category ??
        (this.app === "slop" ? "romance" : this.app === "peon" ? "professional" : "social"),
      city: this.city,
      window: { start: o.startMs ?? now + DAY, end: o.endMs ?? now + 5 * DAY },
      score: 0.75,
      exploration: false,
      explanations: o.explanations ?? {},
      generator: "player",
      createdAt: now,
      components: {
        fit: 0,
        mutualBenefit: 0,
        warmPath: 0,
        novelty: 0,
        timingFit: 0,
        activationCost: 0,
        interruptionCost: 0,
        load: 0,
        repetition: 0,
        socialRisk: 0,
        confidence: 0,
      },
    };
    this.net.submitProposal(p);
    return id;
  }

  probed(id: MemberId): boolean {
    return this.net.memberList().find(m => m.id === id)?.awaiting?.kind === "probe";
  }

  async answerProbes(
    ids: MemberId[],
    answer: (id: MemberId) => string = () => "yes",
    maxMs = 4 * DAY,
    oppId?: string
  ): Promise<void> {
    const bookedBefore = this.meetings.length;
    const isBooked = () =>
      (oppId ? this.opp(oppId)?.stage === "scheduled" : false) || this.meetings.length > bookedBefore;
    for (let i = 0; i < 16 && !isBooked(); i++) {
      const anyProbed = await this.runUntil(() => isBooked() || ids.some(id => this.probed(id)), maxMs, HOUR);
      if (isBooked() || !anyProbed) return;
      for (const id of ids) {
        if (this.probed(id)) {
          await this.say(id, answer(id));
        }
      }
      if (isBooked()) return;
    }
  }

  log(kind: string) {
    return this.logs.filter(l => l.kind === kind);
  }

  submitProposal(p: Proposal): void {
    this.net.submitProposal(p);
  }

  approvePendingReviews(reviewer = "sim_staff"): string[] {
    const approved: string[] = [];
    for (const q of this.net.reviewQueue()) {
      if (this.net.review(q.oppId, "approve", { reviewer, revision: q.revision })) {
        approved.push(q.oppId);
      }
    }
    return approved;
  }

  async advanceTo(targetMs: number, stepMs = 15 * MINUTE): Promise<void> {
    while (this.clock.now() < targetMs) {
      const next = Math.min(targetMs, this.clock.now() + stepMs);
      this.clock.advance(next - this.clock.now());
      await this.net.tick(this.clock.now());
    }
  }

  async run(ms: number, stepMs = HOUR): Promise<void> {
    await this.advanceTo(this.clock.now() + ms, stepMs);
  }

  async runUntil(done: () => boolean, maxMs = 3 * DAY, stepMs = 15 * MINUTE): Promise<boolean> {
    const end = this.clock.now() + maxMs;
    while (!done() && this.clock.now() < end) {
      const next = Math.min(end, this.clock.now() + stepMs);
      this.clock.advance(next - this.clock.now());
      await this.net.tick(this.clock.now());
    }
    return done();
  }

  mark(): number {
    return this.sent.length;
  }

  to(id: MemberId, from = 0): RecordedMessage[] {
    return this.sent.slice(from).filter(s => s.to === id);
  }

  opp(id: string) {
    return this.net.exportState().opps.find(o => o.id === id);
  }

  probedFor(id: MemberId, oppId: string): boolean {
    const m = this.net.memberList().find(x => x.id === id);
    return m?.awaiting?.kind === "probe" && m.awaiting.oppId === oppId;
  }

  scanCanaries(involved: readonly FiveCityMember[]): number {
    let leaks = 0;
    for (const msg of this.sent) {
      for (const m of involved) {
        if (msg.to !== m.id && msg.body.includes(m.canary)) leaks++;
      }
    }
    return leaks;
  }
}

export function formatTranscripts(res: FiveCitySuiteResult): string {
  const lines: string[] = [];
  lines.push(`=== 5-City & Realistic Conversation-Script Suite (seed=${res.seed}) ===`);
  lines.push(
    `Population: ${res.population.totalMembers} members (${res.population.adults} adults, ${res.population.minors} minors) across ${CITY_IDS.join("/")}, ` +
      `${res.population.curatedVenues} curated venues, ${res.population.impromptuEvents} impromptu events`
  );
  lines.push(`Result: ${res.passedScenarios}/${res.totalScenarios} scenarios PASS\n`);

  for (const s of res.scenarios) {
    lines.push(`[${s.pass ? "PASS" : "FAIL"}] ${s.id} (${s.city.toUpperCase()} / ${s.app} / ${s.kind}): ${s.title}`);
    lines.push(`  Summary: ${s.summary}`);
    for (const turn of s.transcript) {
      const tag = turn.tag ? ` [${turn.tag}]` : "";
      lines.push(`  ${turn.atLabel} | ${turn.from} -> ${turn.to} (${turn.app})${tag}: ${turn.text}`);
    }
    for (const c of s.checks) {
      lines.push(`    ${c.pass ? "ok" : "FAIL"} - ${c.name} (${c.detail})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
