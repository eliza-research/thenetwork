import type { SQL } from "../../core/src/runtime/postgres.ts";
import { km } from "../../core/src/geo.ts";
import {
  CITY_TZ,
  DAY,
  HOUR,
  MINUTE,
  defaultLocalSufficiencyThreshold,
  getCity,
  localParts,
  needsPreRecommendOpenCheck,
  rankVenuesForMatch,
  shouldFetchExternalVenues,
  type AppId,
  type City,
  type VenueCandidateResult,
  type VenueCategory,
  type VenueHoursSlot,
  type VenuePriceTier,
  type VenueRankRequest,
  type VenueRecord,
} from "../../core/src/index.ts";
import {
  applyVenueFeedbackPg,
  getCachedSearch,
  listVenues,
  putCachedSearch,
  upsertVenue,
} from "./venue-store.ts";

export interface VenueSearchQuery {
  city: City;
  neighborhood?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  categories?: VenueCategory[];
  maxPriceTier?: VenuePriceTier;
  limit?: number;
}

export interface VenueOpenStatusResult {
  venueId?: string;
  externalPlaceId?: string;
  status: "operational" | "closed_temporary" | "closed_permanent" | "unknown";
  isOpenNow?: boolean;
  hours?: VenueHoursSlot[];
  rating?: number;
  reviewCount?: number;
  checkedAt: number;
}

export interface VenueExternalProvider {
  readonly name: string;
  isConfigured(): boolean;
  searchVenues(query: VenueSearchQuery, nowMs?: number): Promise<VenueRecord[]>;
  verifyVenueOpen(venue: VenueRecord, nowMs?: number): Promise<VenueOpenStatusResult>;
}

const DEFAULT_HOURS: VenueHoursSlot[] = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({
  weekday,
  openMin: 9 * 60,
  closeMin: 21 * 60,
}));

function mapYelpPrice(price?: string): VenuePriceTier {
  if (!price) return 2;
  const len = price.trim().length;
  if (len <= 1) return 1;
  if (len === 2) return 2;
  if (len === 3) return 3;
  return 4;
}

function mapYelpCategory(categories: Array<{ alias?: string; title?: string }> = []): {
  category: VenueCategory;
  isBarOnly: boolean;
  alcoholOptional: boolean;
  ageMin: number;
} {
  const aliases = categories.map(c => (c.alias ?? "").toLowerCase());
  if (aliases.some(a => a.includes("food_court") || a.includes("foodhall"))) {
    return { category: "food_hall", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  }
  if (aliases.some(a => a.includes("coffee") || a.includes("cafe"))) {
    return { category: "coffee_shop", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  }
  if (aliases.some(a => a.includes("baker"))) {
    return { category: "bakery_cafe", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  }
  if (aliases.some(a => a.includes("book"))) {
    return { category: "bookstore_cafe", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  }
  if (aliases.some(a => a.includes("park"))) {
    return { category: "park", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  }
  if (aliases.some(a => a.includes("brewer"))) {
    return { category: "brewery", isBarOnly: false, alcoholOptional: true, ageMin: 21 };
  }
  if (aliases.some(a => a.includes("wine_bar"))) {
    return { category: "wine_bar", isBarOnly: false, alcoholOptional: true, ageMin: 21 };
  }
  if (aliases.some(a => a.includes("cocktail") || a === "bars" || a === "divebars")) {
    return { category: "cocktail_bar", isBarOnly: true, alcoholOptional: false, ageMin: 21 };
  }
  return { category: "diner", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
}

function parseHhmm(hhmm: string): number {
  const clean = hhmm.padStart(4, "0");
  return Number(clean.slice(0, 2)) * 60 + Number(clean.slice(2, 4));
}

function parseYelpHours(hoursList?: Array<{ open?: Array<{ day: number; start: string; end: string; is_overnight?: boolean }> }>): VenueHoursSlot[] {
  const open = hoursList?.[0]?.open;
  if (!open || open.length === 0) return DEFAULT_HOURS;
  return open.map(s => {
    const openMin = parseHhmm(s.start);
    let closeMin = parseHhmm(s.end);
    if (s.is_overnight || closeMin <= openMin) closeMin += 1440;
    return { weekday: s.day, openMin, closeMin };
  });
}

export class YelpFusionProvider implements VenueExternalProvider {
  readonly name = "yelp_fusion";
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: { apiKey?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; baseUrl?: string } = {}) {
    this.apiKey = (opts.apiKey ?? (opts.env ?? process.env).YELP_API_KEY)?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? "https://api.yelp.com/v3").replace(/\/$/, "");
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async searchVenues(query: VenueSearchQuery, nowMs = Date.now()): Promise<VenueRecord[]> {
    if (!this.apiKey) return [];
    const params = new URLSearchParams({
      latitude: String(query.lat),
      longitude: String(query.lng),
      radius: String(Math.min(40_000, Math.max(500, query.radiusMeters ?? 4000))),
      limit: String(Math.min(50, Math.max(1, query.limit ?? 20))),
      categories: "coffee,cafes,food_court,breweries,bookstores,parks,diners,wine_bars",
    });
    const res = await this.fetchImpl(`${this.baseUrl}/businesses/search?${params.toString()}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { businesses?: any[] };
    const citySpec = getCity(query.city);
    const defaultHood = query.neighborhood ?? citySpec?.neighborhoods[0]?.name ?? query.city;
    const out: VenueRecord[] = [];
    for (const b of data.businesses ?? []) {
      if (!b?.id || !b?.name || b.is_closed) continue;
      const cat = mapYelpCategory(b.categories);
      const lat = Number(b.coordinates?.latitude ?? query.lat);
      const lng = Number(b.coordinates?.longitude ?? query.lng);
      const address = Array.isArray(b.location?.display_address) ? b.location.display_address.join(", ") : String(b.location?.address1 ?? "");
      const rating = typeof b.rating === "number" ? b.rating : 4.2;
      const alpha = Math.max(2, Math.round(rating * 2));
      const beta = Math.max(1, Math.round((5 - rating) * 2) + 1);
      out.push({
        id: `yelp-${b.id}`,
        name: String(b.name),
        city: query.city,
        neighborhood: defaultHood,
        address,
        lat,
        lng,
        category: cat.category,
        public: true,
        status: "active",
        priceTier: mapYelpPrice(b.price),
        ageMin: cat.ageMin,
        isBarOnly: cat.isBarOnly,
        alcoholOptional: cat.alcoholOptional,
        servesVegetarian: true,
        servesVegan: cat.category === "coffee_shop" || cat.category === "food_hall" || cat.category === "park",
        wheelchairAccessible: true,
        separateChecks: true,
        walkInGroupCapacity: cat.category === "food_hall" || cat.category === "brewery" || cat.category === "park" ? 10 : 6,
        reservationRequired: false,
        noiseLevel: "conversational",
        liveMusicAtNight: false,
        indoor: cat.category !== "park",
        outdoor: cat.category === "park",
        weatherSensitive: cat.category === "park",
        arrivalLandmark: `At the main entrance of ${b.name}`,
        hours: parseYelpHours(b.hours),
        yelpRating: rating,
        externalPlaceId: String(b.id),
        source: "listing",
        lastVerifiedAt: nowMs,
        closureReports: 0,
        safetyScore: 9,
        transitScore: 4,
        personaPriors: { default: { alpha, beta } },
      });
    }
    return out;
  }

  async verifyVenueOpen(venue: VenueRecord, nowMs = Date.now()): Promise<VenueOpenStatusResult> {
    if (!this.apiKey || !venue.externalPlaceId) {
      return { venueId: venue.id, externalPlaceId: venue.externalPlaceId, status: "unknown", checkedAt: nowMs };
    }
    const res = await this.fetchImpl(`${this.baseUrl}/businesses/${encodeURIComponent(venue.externalPlaceId)}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
    });
    if (!res.ok) {
      return { venueId: venue.id, externalPlaceId: venue.externalPlaceId, status: "unknown", checkedAt: nowMs };
    }
    const b = (await res.json()) as any;
    const closed = Boolean(b.is_closed);
    return {
      venueId: venue.id,
      externalPlaceId: venue.externalPlaceId,
      status: closed ? "closed_permanent" : "operational",
      isOpenNow: typeof b.hours?.[0]?.is_open_now === "boolean" ? b.hours[0].is_open_now : !closed,
      hours: b.hours ? parseYelpHours(b.hours) : undefined,
      rating: typeof b.rating === "number" ? b.rating : undefined,
      reviewCount: typeof b.review_count === "number" ? b.review_count : undefined,
      checkedAt: nowMs,
    };
  }
}

const GOOGLE_DETAILS_FIELD_MASK = "businessStatus,currentOpeningHours";
const GOOGLE_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.priceLevel",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.types",
  "places.rating",
  "places.servesVegetarianFood",
  "places.accessibilityOptions",
  "places.outdoorSeating",
].join(",");

function mapGooglePrice(level?: string): VenuePriceTier {
  switch (level) {
    case "PRICE_LEVEL_FREE": return 0;
    case "PRICE_LEVEL_INEXPENSIVE": return 1;
    case "PRICE_LEVEL_MODERATE": return 2;
    case "PRICE_LEVEL_EXPENSIVE": return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE": return 4;
    default: return 2;
  }
}

function mapGoogleStatus(status?: string): VenueOpenStatusResult["status"] {
  switch (status) {
    case "OPERATIONAL": return "operational";
    case "CLOSED_TEMPORARILY": return "closed_temporary";
    case "CLOSED_PERMANENTLY": return "closed_permanent";
    default: return "unknown";
  }
}

function mapGoogleTypes(types: string[] = []): {
  category: VenueCategory;
  isBarOnly: boolean;
  alcoholOptional: boolean;
  ageMin: number;
} {
  const set = new Set(types.map(t => t.toLowerCase()));
  if (set.has("coffee_shop") || set.has("cafe")) return { category: "coffee_shop", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  if (set.has("bakery")) return { category: "bakery_cafe", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  if (set.has("book_store")) return { category: "bookstore_cafe", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  if (set.has("park")) return { category: "park", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
  if (set.has("brewery")) return { category: "brewery", isBarOnly: false, alcoholOptional: true, ageMin: 21 };
  if (set.has("wine_bar")) return { category: "wine_bar", isBarOnly: false, alcoholOptional: true, ageMin: 21 };
  if (set.has("bar") && !set.has("restaurant")) return { category: "cocktail_bar", isBarOnly: true, alcoholOptional: false, ageMin: 21 };
  return { category: "diner", isBarOnly: false, alcoholOptional: true, ageMin: 0 };
}

function parseGoogleHours(opening?: { periods?: Array<{ open?: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }> }): VenueHoursSlot[] {
  const periods = opening?.periods;
  if (!periods || periods.length === 0) return DEFAULT_HOURS;
  const out: VenueHoursSlot[] = [];
  for (const p of periods) {
    if (!p.open) continue;
    const weekday = (p.open.day + 6) % 7;
    const openMin = p.open.hour * 60 + (p.open.minute ?? 0);
    let closeMin = p.close ? p.close.hour * 60 + (p.close.minute ?? 0) : 23 * 60 + 59;
    if (p.close && (p.close.day !== p.open.day || closeMin <= openMin)) closeMin += 1440;
    out.push({ weekday, openMin, closeMin });
  }
  return out.length > 0 ? out : DEFAULT_HOURS;
}

export class GooglePlacesProvider implements VenueExternalProvider {
  readonly name = "google_places";
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: { apiKey?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; baseUrl?: string } = {}) {
    this.apiKey = (opts.apiKey ?? (opts.env ?? process.env).GOOGLE_PLACES_API_KEY)?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? "https://places.googleapis.com/v1").replace(/\/$/, "");
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async searchVenues(query: VenueSearchQuery, nowMs = Date.now()): Promise<VenueRecord[]> {
    if (!this.apiKey) return [];
    const res = await this.fetchImpl(`${this.baseUrl}/places:searchNearby`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
        "x-goog-fieldmask": GOOGLE_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ["cafe", "coffee_shop", "bakery", "park", "restaurant", "book_store"],
        maxResultCount: Math.min(20, Math.max(1, query.limit ?? 15)),
        locationRestriction: {
          circle: {
            center: { latitude: query.lat, longitude: query.lng },
            radius: Math.min(50_000, Math.max(500, query.radiusMeters ?? 4000)),
          },
        },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { places?: any[] };
    const citySpec = getCity(query.city);
    const defaultHood = query.neighborhood ?? citySpec?.neighborhoods[0]?.name ?? query.city;
    const geoExpiresAt = nowMs + 30 * DAY;
    const out: VenueRecord[] = [];
    for (const p of data.places ?? []) {
      const placeId = String(p?.id ?? "");
      const name = String(p?.displayName?.text ?? "");
      if (!placeId || !name) continue;
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      const cat = mapGoogleTypes(p.types);
      const rating = typeof p.rating === "number" ? p.rating : 4.3;
      const alpha = Math.max(2, Math.round(rating * 2));
      const beta = Math.max(1, Math.round((5 - rating) * 2) + 1);
      out.push({
        id: `gplaces-${placeId}`,
        name,
        city: query.city,
        neighborhood: defaultHood,
        address: String(p.formattedAddress ?? ""),
        lat: Number(p.location?.latitude ?? query.lat),
        lng: Number(p.location?.longitude ?? query.lng),
        category: cat.category,
        public: true,
        status: "active",
        priceTier: mapGooglePrice(p.priceLevel),
        ageMin: cat.ageMin,
        isBarOnly: cat.isBarOnly,
        alcoholOptional: cat.alcoholOptional,
        servesVegetarian: p.servesVegetarianFood !== false,
        servesVegan: cat.category === "coffee_shop" || cat.category === "park",
        wheelchairAccessible: p.accessibilityOptions?.wheelchairAccessibleEntrance !== false,
        separateChecks: true,
        walkInGroupCapacity: cat.category === "park" ? 12 : 6,
        reservationRequired: false,
        noiseLevel: "conversational",
        liveMusicAtNight: false,
        indoor: cat.category !== "park",
        outdoor: Boolean(p.outdoorSeating) || cat.category === "park",
        weatherSensitive: cat.category === "park",
        arrivalLandmark: `At the main entrance of ${name}`,
        hours: parseGoogleHours(p.currentOpeningHours),
        yelpRating: rating,
        externalPlaceId: placeId,
        source: "google_places",
        lastVerifiedAt: nowMs,
        geoExpiresAt,
        closureReports: 0,
        safetyScore: 9,
        transitScore: 4,
        personaPriors: { default: { alpha, beta } },
      });
    }
    return out;
  }

  async verifyVenueOpen(venue: VenueRecord, nowMs = Date.now()): Promise<VenueOpenStatusResult> {
    if (!this.apiKey || !venue.externalPlaceId) {
      return { venueId: venue.id, externalPlaceId: venue.externalPlaceId, status: "unknown", checkedAt: nowMs };
    }
    const res = await this.fetchImpl(`${this.baseUrl}/places/${encodeURIComponent(venue.externalPlaceId)}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": this.apiKey,
        "x-goog-fieldmask": GOOGLE_DETAILS_FIELD_MASK,
      },
    });
    if (!res.ok) {
      return { venueId: venue.id, externalPlaceId: venue.externalPlaceId, status: "unknown", checkedAt: nowMs };
    }
    const p = (await res.json()) as any;
    const status = mapGoogleStatus(p.businessStatus);
    return {
      venueId: venue.id,
      externalPlaceId: venue.externalPlaceId,
      status,
      isOpenNow: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : status === "operational",
      hours: p.currentOpeningHours ? parseGoogleHours(p.currentOpeningHours) : undefined,
      checkedAt: nowMs,
    };
  }
}

export interface SimulatedVenueProviderOptions {
  discoveredByCity?: Partial<Record<City, VenueRecord[]>>;
  closedStatuses?: Record<string, "operational" | "closed_temporary" | "closed_permanent">;
  hoursOverrides?: Record<string, VenueHoursSlot[]>;
  ratingOverrides?: Record<string, { rating: number; reviewCount?: number }>;
}

export class SimulatedVenueProvider implements VenueExternalProvider {
  readonly name = "simulated";
  searchCalls = 0;
  verifyCalls = 0;
  readonly searchLog: VenueSearchQuery[] = [];
  readonly verifyLog: string[] = [];

  private readonly discoveredByCity: Partial<Record<City, VenueRecord[]>>;
  private readonly closedStatuses: Map<string, "operational" | "closed_temporary" | "closed_permanent">;
  private readonly hoursOverrides: Map<string, VenueHoursSlot[]>;
  private readonly ratingOverrides: Map<string, { rating: number; reviewCount?: number }>;

  constructor(opts: SimulatedVenueProviderOptions = {}) {
    this.discoveredByCity = opts.discoveredByCity ?? {};
    this.closedStatuses = new Map(Object.entries(opts.closedStatuses ?? {}));
    this.hoursOverrides = new Map(Object.entries(opts.hoursOverrides ?? {}));
    this.ratingOverrides = new Map(Object.entries(opts.ratingOverrides ?? {}));
  }

  get totalCalls(): number {
    return this.searchCalls + this.verifyCalls;
  }

  isConfigured(): boolean {
    return true;
  }

  setClosedStatus(venueIdOrExternalId: string, status: "operational" | "closed_temporary" | "closed_permanent"): void {
    this.closedStatuses.set(venueIdOrExternalId, status);
  }

  resetCounters(): void {
    this.searchCalls = 0;
    this.verifyCalls = 0;
    this.searchLog.length = 0;
    this.verifyLog.length = 0;
  }

  async searchVenues(query: VenueSearchQuery, nowMs = Date.now()): Promise<VenueRecord[]> {
    this.searchCalls += 1;
    this.searchLog.push({ ...query });
    const list = this.discoveredByCity[query.city] ?? [];
    return list.map(v => ({
      ...v,
      lastVerifiedAt: nowMs,
      geoExpiresAt: v.source === "google_places" ? (v.geoExpiresAt ?? nowMs + 30 * DAY) : v.geoExpiresAt,
    }));
  }

  async verifyVenueOpen(venue: VenueRecord, nowMs = Date.now()): Promise<VenueOpenStatusResult> {
    this.verifyCalls += 1;
    this.verifyLog.push(venue.id);
    const status =
      this.closedStatuses.get(venue.id) ??
      (venue.externalPlaceId ? this.closedStatuses.get(venue.externalPlaceId) : undefined) ??
      "operational";
    const hours =
      this.hoursOverrides.get(venue.id) ??
      (venue.externalPlaceId ? this.hoursOverrides.get(venue.externalPlaceId) : undefined);
    const ratingInfo =
      this.ratingOverrides.get(venue.id) ??
      (venue.externalPlaceId ? this.ratingOverrides.get(venue.externalPlaceId) : undefined);
    return {
      venueId: venue.id,
      externalPlaceId: venue.externalPlaceId,
      status,
      isOpenNow: status === "operational",
      ...(hours ? { hours } : {}),
      ...(ratingInfo ? { rating: ratingInfo.rating, reviewCount: ratingInfo.reviewCount } : {}),
      checkedAt: nowMs,
    };
  }
}

export interface CompositeVenueProviderOptions {
  pool: SQL;
  providers?: VenueExternalProvider[];
  cacheTtlMs?: number;
  maxExternalSearchCalls?: number;
  sufficiencyThreshold?: number;
  now?: () => number;
}

export interface VenueDiscoveryResult {
  candidates: VenueCandidateResult[];
  localQualifiedBeforeFetch: number;
  fetchedExternal: boolean;
  cacheHit: boolean;
  externalSearchCalls: number;
  discoveredCount: number;
}

export interface VerifyOpenResult {
  ok: boolean;
  venue: VenueRecord;
  verifiedViaProvider: boolean;
  reason?: "closed_temporary" | "closed_permanent";
}

export interface VerifiedRecommendationResult {
  primary?: VenueCandidateResult;
  backup?: VenueCandidateResult;
  candidates: VenueCandidateResult[];
  cacheHit: boolean;
  externalSearchCalls: number;
  externalVerifyCalls: number;
  quarantinedIds: string[];
}

export class CompositeVenueProvider {
  private readonly pool: SQL;
  private readonly providers: VenueExternalProvider[];
  private readonly cacheTtlMs: number;
  private readonly maxExternalSearchCalls: number;
  private readonly sufficiencyThreshold: number;
  private readonly nowFn: () => number;
  private externalSearchCallsUsed = 0;

  constructor(opts: CompositeVenueProviderOptions) {
    this.pool = opts.pool;
    this.providers = opts.providers ?? [];
    this.cacheTtlMs = opts.cacheTtlMs ?? 24 * HOUR;
    this.maxExternalSearchCalls = opts.maxExternalSearchCalls ?? 100;
    this.sufficiencyThreshold = opts.sufficiencyThreshold ?? defaultLocalSufficiencyThreshold;
    this.nowFn = opts.now ?? Date.now;
  }

  private configuredProviders(): VenueExternalProvider[] {
    return this.providers.filter(p => p.isConfigured());
  }

  private buildCacheKey(request: VenueRankRequest): string {
    const areas = [...request.memberAreas].map(a => a.trim().toLowerCase()).sort().join(",");
    const maxBudget = request.members.length > 0 ? Math.min(...request.members.map(m => m.maxBudgetTier)) : 2;
    return `venues:${request.city}:${request.mode}:${maxBudget}:${areas || "any"}`;
  }

  async findAndRankVenues(request: VenueRankRequest, nowMs = this.nowFn()): Promise<VenueDiscoveryResult> {
    const localVenues = await listVenues(this.pool, { city: request.city, status: "active" });
    const localCandidates = rankVenuesForMatch(localVenues, request, nowMs);
    const localQualifiedBeforeFetch = localCandidates.length;
    const budgetRemaining = Math.max(0, this.maxExternalSearchCalls - this.externalSearchCallsUsed);

    if (budgetRemaining <= 0 || localQualifiedBeforeFetch >= this.sufficiencyThreshold || !shouldFetchExternalVenues(localQualifiedBeforeFetch)) {
      return {
        candidates: localCandidates,
        localQualifiedBeforeFetch,
        fetchedExternal: false,
        cacheHit: false,
        externalSearchCalls: 0,
        discoveredCount: 0,
      };
    }

    const cacheKey = this.buildCacheKey(request);
    const cached = await getCachedSearch(this.pool, cacheKey, nowMs);
    if (cached) {
      return {
        candidates: localCandidates,
        localQualifiedBeforeFetch,
        fetchedExternal: false,
        cacheHit: true,
        externalSearchCalls: 0,
        discoveredCount: 0,
      };
    }

    const activeProviders = this.configuredProviders();
    if (activeProviders.length === 0) {
      return {
        candidates: localCandidates,
        localQualifiedBeforeFetch,
        fetchedExternal: false,
        cacheHit: false,
        externalSearchCalls: 0,
        discoveredCount: 0,
      };
    }

    const citySpec = getCity(request.city);
    const center = citySpec?.center ?? { lat: 40.7359, lng: -73.9911 };
    const maxBudgetTier = (
      request.members.length > 0 ? Math.min(...request.members.map(m => m.maxBudgetTier)) : 2
    ) as VenuePriceTier;
    const query: VenueSearchQuery = {
      city: request.city,
      neighborhood: request.memberAreas[0],
      lat: center.lat,
      lng: center.lng,
      maxPriceTier: maxBudgetTier,
      limit: 20,
    };

    let externalSearchCalls = 0;
    const discovered: VenueRecord[] = [];
    let primaryProviderName = activeProviders[0]!.name;

    for (const provider of activeProviders) {
      if (this.externalSearchCallsUsed >= this.maxExternalSearchCalls) break;
      this.externalSearchCallsUsed += 1;
      externalSearchCalls += 1;
      primaryProviderName = provider.name;
      const found = await provider.searchVenues(query, nowMs);
      for (const v of found) {
        if (v.public === true && v.city === request.city) {
          await upsertVenue(this.pool, v);
          discovered.push(v);
        }
      }
      if (localQualifiedBeforeFetch + discovered.length >= this.sufficiencyThreshold) break;
    }

    await putCachedSearch(this.pool, {
      cacheKey,
      provider: primaryProviderName,
      city: request.city,
      payload: discovered.map(v => v.id),
      resultCount: discovered.length,
      fetchedAt: nowMs,
      expiresAt: nowMs + this.cacheTtlMs,
    });

    const refreshedVenues = await listVenues(this.pool, { city: request.city, status: "active" });
    const candidates = rankVenuesForMatch(refreshedVenues, request, nowMs);
    return {
      candidates,
      localQualifiedBeforeFetch,
      fetchedExternal: true,
      cacheHit: false,
      externalSearchCalls,
      discoveredCount: discovered.length,
    };
  }

  async verifyVenueOpenBeforeRecommend(
    venue: VenueRecord,
    opts: { appId?: AppId; nowMs?: number; isWeekendOrHoliday?: boolean; startMs?: number } = {},
  ): Promise<VerifyOpenResult> {
    const nowMs = opts.nowMs ?? this.nowFn();
    const tz = getCity(venue.city)?.tz ?? CITY_TZ[venue.city] ?? "America/New_York";
    const refMs = opts.startMs ?? nowMs;
    const isWeekendOrHoliday = opts.isWeekendOrHoliday ?? (localParts(refMs, tz).weekday >= 5);
    const ageHours = Math.floor((nowMs - venue.lastVerifiedAt) / (60 * MINUTE));

    if (!needsPreRecommendOpenCheck(ageHours, isWeekendOrHoliday)) {
      return { ok: true, venue, verifiedViaProvider: false };
    }

    const activeProviders = this.configuredProviders();
    if (activeProviders.length === 0) {
      return { ok: true, venue, verifiedViaProvider: false };
    }

    for (const provider of activeProviders) {
      const check = await provider.verifyVenueOpen(venue, nowMs);
      if (check.status === "unknown") continue;

      if (check.status === "closed_permanent" || check.status === "closed_temporary") {
        const providerCode = check.status === "closed_permanent" ? "ProviderPermanentClosed" : "ProviderTemporaryClosed";
        const fallbackStatus = check.status === "closed_permanent" ? "closed_permanent" : "closed_temporary";
        const updated = await applyVenueFeedbackPg(
          this.pool,
          opts.appId ?? "ntwrk",
          venue.id,
          [],
          {
            venueId: venue.id,
            memberId: "system:open_check",
            at: nowMs,
            outcome: "closed",
            reportedClosed: true,
            providerCode,
          },
          nowMs,
        );
        return {
          ok: false,
          venue: updated ?? { ...venue, status: fallbackStatus, lastVerifiedAt: nowMs },
          verifiedViaProvider: true,
          reason: check.status,
        };
      }

      const refreshed: VenueRecord = {
        ...venue,
        lastVerifiedAt: nowMs,
        ...(check.hours ? { hours: check.hours } : {}),
        ...(check.rating !== undefined ? { yelpRating: check.rating } : {}),
      };
      const saved = await upsertVenue(this.pool, refreshed, {
        ...(check.reviewCount !== undefined ? { yelpReviewCount: check.reviewCount } : {}),
      });
      return { ok: true, venue: saved, verifiedViaProvider: true };
    }

    return { ok: true, venue, verifiedViaProvider: false };
  }

  async pickVerifiedPrimaryAndBackup(
    request: VenueRankRequest,
    opts: { appId?: AppId; nowMs?: number } = {},
  ): Promise<VerifiedRecommendationResult> {
    const nowMs = opts.nowMs ?? this.nowFn();
    const discovery = await this.findAndRankVenues(request, nowMs);
    const tz = getCity(request.city)?.tz ?? CITY_TZ[request.city] ?? "America/New_York";
    const isWeekendOrHoliday = request.isWeekendOrHoliday ?? (localParts(request.startMs, tz).weekday >= 5);

    let externalVerifyCalls = 0;
    const quarantinedIds: string[] = [];
    const verifiedCandidates: VenueCandidateResult[] = [];

    let primary: VenueCandidateResult | undefined;
    const remaining: VenueCandidateResult[] = [];

    for (const cand of discovery.candidates) {
      if (!primary) {
        const v = await this.verifyVenueOpenBeforeRecommend(cand.venue, {
          appId: opts.appId,
          nowMs,
          isWeekendOrHoliday,
          startMs: request.startMs,
        });
        if (v.verifiedViaProvider) externalVerifyCalls += 1;
        if (!v.ok) {
          quarantinedIds.push(cand.venue.id);
          continue;
        }
        primary = { ...cand, venue: v.venue, needsOpenCheck: false };
        verifiedCandidates.push(primary);
      } else {
        remaining.push(cand);
      }
    }

    if (!primary) {
      return {
        candidates: [],
        cacheHit: discovery.cacheHit,
        externalSearchCalls: discovery.externalSearchCalls,
        externalVerifyCalls,
        quarantinedIds,
      };
    }

    const orderedBackups = [
      ...remaining.filter(c => km(primary!.venue, c.venue) <= 0.8 || c.venue.neighborhood === primary!.venue.neighborhood),
      ...remaining.filter(c => !(km(primary!.venue, c.venue) <= 0.8 || c.venue.neighborhood === primary!.venue.neighborhood)),
    ];

    let backup: VenueCandidateResult | undefined;
    for (const cand of orderedBackups) {
      if (!backup) {
        const v = await this.verifyVenueOpenBeforeRecommend(cand.venue, {
          appId: opts.appId,
          nowMs,
          isWeekendOrHoliday,
          startMs: request.startMs,
        });
        if (v.verifiedViaProvider) externalVerifyCalls += 1;
        if (!v.ok) {
          quarantinedIds.push(cand.venue.id);
          continue;
        }
        backup = { ...cand, venue: v.venue, needsOpenCheck: false };
        verifiedCandidates.push(backup);
      } else {
        verifiedCandidates.push(cand);
      }
    }

    return {
      primary,
      backup,
      candidates: verifiedCandidates,
      cacheHit: discovery.cacheHit,
      externalSearchCalls: discovery.externalSearchCalls,
      externalVerifyCalls,
      quarantinedIds,
    };
  }
}
