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
export type CityCurrency = "USD" | "GBP" | (string & {});
export type CityLaunchConfig = CityPack;

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

export const CITY_CONFIGS: Readonly<Record<SupportedCity, CityLaunchConfig>> = {
  nyc: requireCityPack("nyc"),
  sf: requireCityPack("sf"),
  la: requireCityPack("la"),
  chicago: requireCityPack("chicago"),
  miami: requireCityPack("miami"),
  austin: requireCityPack("austin"),
  london: requireCityPack("london"),
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
    return requireCityPack("nyc");
  }
  return requireCityPack(city);
}

export function listCityConfigs(): readonly CityLaunchConfig[] {
  return listCityPacks();
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
