import { getCity, LAUNCH_CITIES } from "@thenetwork/core";
import {
  CITY_LAUNCH_STAGES,
  UnknownCityError,
  evaluateCityStageReadiness,
  getCityPack,
  listCityPacks,
  registerCityPack,
  requireCityPack,
  setCityPackStage,
  type CityBudgetDefaults,
  type CityCode,
  type CityCorridor,
  type CityDiscoveryEndpoints,
  type CityLaunchStage,
  type CityLegalRules,
  type CityNeighborhoodPattern,
  type CityPack,
  type CityReadinessGates,
  type CityStageMetrics,
  type CityStageReadinessResult,
  type CityVendorAgency,
  type CityVendorPlatform,
  type CityVendorPrinter,
  type CityVendorSeed,
  type LaborClassification,
  type OpenDataConnectorSpec,
} from "./city-registry.ts";

import type { BrandAppId } from "./types.ts";

const LAUNCH_CITY_SET = new Set<string>(LAUNCH_CITIES);

export const SUPPORTED_CITIES = [
  "nyc",
  "sf",
  "la",
  "chicago",
  "miami",
  "austin",
  "london",
] as const;

export type SupportedCity = (typeof SUPPORTED_CITIES)[number];
export type CityId = string;
export type CityLaunchStatus = "active" | "waitlist" | "planned";
export type CityDensityTier = "sparse" | "medium" | "dense";
export type CityCurrency = "USD" | "GBP" | (string & {});
export type CityLaunchConfig = CityPack & { readonly launchStatus: CityLaunchStatus };

export {
  CITY_LAUNCH_STAGES,
  UnknownCityError,
  evaluateCityStageReadiness,
  getCityPack,
  listCityPacks,
  registerCityPack,
  requireCityPack,
  setCityPackStage,
  type CityBudgetDefaults,
  type CityCode,
  type CityCorridor,
  type CityDiscoveryEndpoints,
  type CityLaunchStage,
  type CityLegalRules,
  type CityNeighborhoodPattern,
  type CityPack,
  type CityReadinessGates,
  type CityStageMetrics,
  type CityStageReadinessResult,
  type CityVendorAgency,
  type CityVendorPlatform,
  type CityVendorPrinter,
  type CityVendorSeed,
  type LaborClassification,
  type OpenDataConnectorSpec,
};

export interface CityHiringComplianceInput {
  readonly city: string;
  readonly role:
    | "street_fliering"
    | "event_activation"
    | "creator_video"
    | "agency_booking"
    | "rentahuman_courier";
  readonly contractorMode: "1099_direct" | "w2_agency" | "creator_direct";
  readonly boroughLicenceRef?: string | null;
}

export interface CityHiringComplianceResult {
  readonly allowed: boolean;
  readonly city: CityCode;
  readonly reasons: readonly string[];
  readonly requiredNotice: string;
}

export interface CityActivationReadiness {
  readonly city: CityCode;
  readonly ready: boolean;
  readonly isPrimaryLaunch: boolean;
  readonly platformActive: boolean;
  readonly stage: CityLaunchStage;
  readonly verifiedStage2Adults: number;
  readonly requiredAdults: number;
  readonly signedVenues: number;
  readonly requiredVenues: number;
  readonly blockers: readonly string[];
}

export interface CityDensitySnapshot {
  readonly city: CityId;
  readonly appId: BrandAppId;
  readonly qualifiedAdultCount: number;
  readonly densityTier: CityDensityTier;
  readonly activeVenueCount: number;
  readonly observedAt?: string;
}

export interface CityExpansionTrackMultipliers {
  readonly bd_venue: number;
  readonly event_activation: number;
  readonly street_fliering: number;
  readonly organic_play: number;
}

export interface CityDensityIntakeResult {
  readonly city: CityId;
  readonly supported: boolean;
  readonly appId: BrandAppId;
  readonly launchStatus: CityLaunchStatus;
  readonly densityTier: CityDensityTier;
  readonly qualifiedAdultCount: number;
  readonly activeVenueCount: number;
  readonly expansionReadiness: CityActivationReadiness | null;
  readonly readyForExpansion: boolean;
  readonly blockers: readonly string[];
  readonly trackMultipliers: CityExpansionTrackMultipliers;
  readonly recommendExternalActivation: boolean;
  readonly observedAt: string | null;
}

const LAUNCH_STATUS_BY_CITY: Readonly<Record<SupportedCity, CityLaunchStatus>> = {
  nyc: "active",
  sf: "waitlist",
  la: "waitlist",
  chicago: "waitlist",
  miami: "waitlist",
  austin: "planned",
  london: "planned",
};

function withLaunchStatus(pack: CityPack): CityLaunchConfig {
  const code = pack.code as SupportedCity;
  const launchStatus: CityLaunchStatus = Object.hasOwn(LAUNCH_STATUS_BY_CITY, code)
    ? LAUNCH_STATUS_BY_CITY[code]
    : pack.platformActive
      ? "active"
      : pack.stage === "waitlist_kindling" || pack.stage === "liquidity_seeding"
        ? "waitlist"
        : "planned";
  const core = LAUNCH_CITY_SET.has(pack.code) ? getCity(pack.code) : undefined;
  return {
    ...pack,
    ...(core ? { label: core.name, timezone: core.tz } : {}),
    launchStatus,
  };
}

export const CITY_CONFIGS: Readonly<Record<SupportedCity, CityLaunchConfig>> = {
  nyc: withLaunchStatus(requireCityPack("nyc")),
  sf: withLaunchStatus(requireCityPack("sf")),
  la: withLaunchStatus(requireCityPack("la")),
  chicago: withLaunchStatus(requireCityPack("chicago")),
  miami: withLaunchStatus(requireCityPack("miami")),
  austin: withLaunchStatus(requireCityPack("austin")),
  london: withLaunchStatus(requireCityPack("london")),
};

export function isSupportedCity(city: string): city is SupportedCity {
  const normalized = city.trim().toLowerCase();
  return getCityPack(normalized) !== undefined;
}

export function normalizeCityCode(
  city: string | undefined | null,
  defaultCity: CityCode = "nyc",
): CityCode {
  if (!city || city.trim().length === 0) {
    return requireCityPack(defaultCity).code;
  }
  return requireCityPack(city).code;
}

export function getCityConfig(city: string | undefined | null): CityLaunchConfig {
  if (!city || city.trim().length === 0) {
    return withLaunchStatus(requireCityPack("nyc"));
  }
  return withLaunchStatus(requireCityPack(city));
}

export function marketingCityTimezone(city: CityId | undefined | null): string | undefined {
  if (!city) return undefined;
  const normalized = city.trim().toLowerCase();
  return isSupportedCity(normalized) ? CITY_CONFIGS[normalized].timezone : undefined;
}

export function listCityConfigs(): readonly CityLaunchConfig[] {
  return listCityPacks().map(withLaunchStatus);
}

export function detectCityNeighborhood(
  city: string,
  text: string,
): string | undefined {
  const config = getCityConfig(city);
  const hay = text.toLowerCase();
  for (const entry of config.neighborhoodPatterns) {
    if (entry.patterns.some((p) => hay.includes(p))) {
      return entry.label;
    }
  }
  return undefined;
}

export function matchesCityTransitOrLocality(
  city: string,
  replyText: string,
): boolean {
  const config = getCityConfig(city);
  const lower = replyText.toLowerCase();
  if (lower.includes(config.code) || lower.includes(config.label.toLowerCase())) {
    return true;
  }
  return config.transitKeywords.some((kw) => lower.includes(kw));
}

export function checkCityHiringCompliance(
  input: CityHiringComplianceInput,
): CityHiringComplianceResult {
  const config = requireCityPack(input.city);
  const reasons: string[] = [];

  const isHourlyFieldRole =
    input.role === "street_fliering" || input.role === "event_activation";

  if (
    isHourlyFieldRole &&
    config.legal.w2RequiredForStreetTeams &&
    input.contractorMode === "1099_direct"
  ) {
    reasons.push(
      `${config.label} requires W-2/PAYE agency staffing for hourly ${input.role} (${config.legal.laborClassification}); direct 1099 hiring is blocked.`,
    );
  }

  if (
    input.role === "street_fliering" &&
    config.legal.flierLicenceRequired &&
    (!input.boroughLicenceRef || input.boroughLicenceRef.trim().length < 3)
  ) {
    reasons.push(
      `${config.label} requires an active borough Free Printed Matter Distribution Licence reference before dispatching street fliering.`,
    );
  }

  const requiredNotice = [
    config.legal.antiPostingRule,
    config.legal.transitExclusionRule,
    config.legal.freelanceStatute,
  ].join(" ");

  return {
    allowed: reasons.length === 0,
    city: config.code,
    reasons,
    requiredNotice,
  };
}

export function canActivateCityExpansion(
  city: string,
  verifiedStage2Adults: number,
  signedVenues: number,
): CityActivationReadiness {
  const config = requireCityPack(city);
  const adults = Math.max(0, Math.floor(verifiedStage2Adults));
  const venues = Math.max(0, Math.floor(signedVenues));
  const blockers: string[] = [];

  if (!config.isPrimaryLaunch) {
    if (adults < config.activationWaitlistMinAdults) {
      blockers.push(
        `Waitlist threshold unmet: ${adults}/${config.activationWaitlistMinAdults} verified 18+ Stage-2 adults in ${config.label}.`,
      );
    }
    if (venues < config.activationMinSignedVenues) {
      blockers.push(
        `Venue readiness unmet: ${venues}/${config.activationMinSignedVenues} signed partner venues in ${config.label}.`,
      );
    }
  }

  return {
    city: config.code,
    ready: blockers.length === 0,
    isPrimaryLaunch: config.isPrimaryLaunch,
    platformActive: config.platformActive,
    stage: config.stage,
    verifiedStage2Adults: adults,
    requiredAdults: config.activationWaitlistMinAdults,
    signedVenues: venues,
    requiredVenues: config.activationMinSignedVenues,
    blockers,
  };
}

const VALID_BRAND_APPS: ReadonlySet<BrandAppId> = new Set(["slop", "peon", "friends", "ntwrk"]);
const VALID_DENSITY_TIERS: ReadonlySet<CityDensityTier> = new Set(["sparse", "medium", "dense"]);

function sanitizeNonNegativeInt(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function deriveDensityTierFallback(qualifiedAdultCount: number): CityDensityTier {
  if (qualifiedAdultCount >= 150) return "dense";
  if (qualifiedAdultCount >= 30) return "medium";
  return "sparse";
}

function trackMultipliersForTier(
  densityTier: CityDensityTier,
  supported: boolean,
): CityExpansionTrackMultipliers {
  if (!supported) {
    return {
      bd_venue: 0,
      event_activation: 0,
      street_fliering: 0,
      organic_play: 0,
    };
  }
  if (densityTier === "sparse") {
    return {
      bd_venue: 1.5,
      event_activation: 1.5,
      street_fliering: 1.15,
      organic_play: 1.0,
    };
  }
  if (densityTier === "medium") {
    return {
      bd_venue: 1.25,
      event_activation: 1.25,
      street_fliering: 1.05,
      organic_play: 1.0,
    };
  }
  return {
    bd_venue: 0.9,
    event_activation: 0.85,
    street_fliering: 1.0,
    organic_play: 1.15,
  };
}

export function applyCityDensitySnapshot(
  snapshot: CityDensitySnapshot,
): CityDensityIntakeResult {
  const rawCity = typeof snapshot.city === "string" ? snapshot.city.trim().toLowerCase() : "";
  const supported = rawCity.length > 0 && isSupportedCity(rawCity);
  const appId: BrandAppId = VALID_BRAND_APPS.has(snapshot.appId) ? snapshot.appId : "ntwrk";
  const qualifiedAdultCount = sanitizeNonNegativeInt(snapshot.qualifiedAdultCount);
  const activeVenueCount = sanitizeNonNegativeInt(snapshot.activeVenueCount);
  const densityTier: CityDensityTier = VALID_DENSITY_TIERS.has(snapshot.densityTier)
    ? snapshot.densityTier
    : deriveDensityTierFallback(qualifiedAdultCount);
  const observedAt =
    typeof snapshot.observedAt === "string" && Number.isFinite(Date.parse(snapshot.observedAt))
      ? new Date(Date.parse(snapshot.observedAt)).toISOString()
      : null;

  if (!supported) {
    const cityLabel = rawCity || "unknown";
    return {
      city: cityLabel,
      supported: false,
      appId,
      launchStatus: "planned",
      densityTier,
      qualifiedAdultCount,
      activeVenueCount,
      expansionReadiness: null,
      readyForExpansion: false,
      blockers: [`City "${cityLabel}" is not registered in the marketing launch registry.`],
      trackMultipliers: trackMultipliersForTier(densityTier, false),
      recommendExternalActivation: false,
      observedAt,
    };
  }

  const config = CITY_CONFIGS[rawCity];
  const expansionReadiness = canActivateCityExpansion(
    config.code,
    qualifiedAdultCount,
    activeVenueCount,
  );

  return {
    city: config.code,
    supported: true,
    appId,
    launchStatus: config.launchStatus,
    densityTier,
    qualifiedAdultCount,
    activeVenueCount,
    expansionReadiness,
    readyForExpansion: expansionReadiness.ready,
    blockers: expansionReadiness.blockers,
    trackMultipliers: trackMultipliersForTier(densityTier, true),
    recommendExternalActivation: densityTier !== "dense",
    observedAt,
  };
}

export function canActivateCityExpansionFromSnapshot(
  snapshot: CityDensitySnapshot,
): CityActivationReadiness | null {
  return applyCityDensitySnapshot(snapshot).expansionReadiness;
}
