import type { Facet } from "./types.ts";

export const VENUE_RED_LINE_TAGS = [
  "strict_sober",
  "non_drinker",
  "alcohol_optional",
  "halal",
  "kosher",
  "gluten_free",
  "severe_allergen",
  "wheelchair",
  "low_walking",
  "low_noise",
  "daytime_only",
  "women_only",
  "all_ages",
] as const;

export type VenueRedLineTag = (typeof VENUE_RED_LINE_TAGS)[number];

export const STRICT_SOBER_TOKENS: ReadonlySet<string> = new Set([
  "strict_sober",
  "sober",
  "recovery",
  "no_alcohol",
  "alcohol_free",
  "alcohol_boundary",
  "sobriety_wellness",
  "dealbreaker:alcohol",
]);

export const NON_DRINKER_TOKENS: ReadonlySet<string> = new Set([
  "non_drinker",
  "nondrinker",
  "slop:drinking:never",
  "slop:drinking:none",
  "drinking:never",
  "drinking:none",
  "alcohol:none",
  ...STRICT_SOBER_TOKENS,
]);

export const DRINKING_VALUE_NON_DRINKER_TOKENS: ReadonlySet<string> = new Set([
  "never",
  "none",
  "non_drinker",
  "nondrinker",
  ...STRICT_SOBER_TOKENS,
]);

export const ALCOHOL_OPTIONAL_TOKENS: ReadonlySet<string> = new Set([
  "alcohol_optional",
  "low_alcohol",
  "sober_curious",
  "mocktail_friendly",
]);

export const VEGETARIAN_TOKENS: ReadonlySet<string> = new Set([
  "vegetarian",
]);

export const VEGAN_TOKENS: ReadonlySet<string> = new Set([
  "vegan",
]);

export const HALAL_TOKENS: ReadonlySet<string> = new Set([
  "halal",
]);

export const KOSHER_TOKENS: ReadonlySet<string> = new Set([
  "kosher",
]);

export const GLUTEN_FREE_TOKENS: ReadonlySet<string> = new Set([
  "gluten_free",
  "celiac",
]);

export const SEVERE_ALLERGEN_TOKENS: ReadonlySet<string> = new Set([
  "severe_allergen",
  "nut_allergy",
  "peanut_allergy",
  "shellfish_allergy",
]);

export const WHEELCHAIR_TOKENS: ReadonlySet<string> = new Set([
  "wheelchair",
  "wheelchair_accessible",
]);

export const LOW_WALKING_TOKENS: ReadonlySet<string> = new Set([
  "low_walking",
  "mobility",
  "no_hiking",
  ...WHEELCHAIR_TOKENS,
]);

export const SMOKE_FREE_TOKENS: ReadonlySet<string> = new Set([
  "smoke_free",
  "non_smoker",
  "slop:dealbreaker:smoker",
]);

export const LOW_NOISE_TOKENS: ReadonlySet<string> = new Set([
  "low_noise",
  "quiet_only",
  "hearing_accessible",
]);

export const DAYTIME_ONLY_TOKENS: ReadonlySet<string> = new Set([
  "daytime_only",
  "daytime",
  "no_after_dark",
]);

export const WOMEN_ONLY_TOKENS: ReadonlySet<string> = new Set([
  "women_only",
]);

export const ALL_AGES_TOKENS: ReadonlySet<string> = new Set([
  "all_ages",
  "all_ages_only",
]);

export interface MemberRedLines {
  readonly strictSober: boolean;
  readonly nonDrinker: boolean;
  readonly alcoholOptional: boolean;
  readonly vegetarian: boolean;
  readonly vegan: boolean;
  readonly halal: boolean;
  readonly kosher: boolean;
  readonly glutenFree: boolean;
  readonly severeAllergen: boolean;
  readonly wheelchairNeeded: boolean;
  readonly lowWalking: boolean;
  readonly smokeFree: boolean;
  readonly lowNoiseRequired: boolean;
  readonly daytimeOnly: boolean;
  readonly womenOnly: boolean;
  readonly allAgesOnly: boolean;
  readonly hasVenueRedLines: boolean;
}

function matchesTokenSet(allTokens: ReadonlySet<string>, needles: ReadonlySet<string>): boolean {
  for (const needle of needles) {
    if (allTokens.has(needle)) return true;
  }
  for (const token of allTokens) {
    const colon = token.lastIndexOf(":");
    if (colon >= 0 && needles.has(token.slice(colon + 1))) return true;
  }
  return false;
}

export function extractMemberRedLines(
  facets: readonly Pick<Facet, "tags" | "value">[],
  extraTokens: readonly string[] = [],
): MemberRedLines {
  const allTokens = new Set<string>();
  for (const f of facets) {
    for (const t of f.tags) {
      const low = t.trim().toLowerCase();
      if (low) allTokens.add(low);
    }
    const v = f.value.trim().toLowerCase();
    if (v) allTokens.add(v);
  }
  for (const raw of extraTokens) {
    const low = raw.trim().toLowerCase();
    if (low) allTokens.add(low);
  }

  const strictSober = matchesTokenSet(allTokens, STRICT_SOBER_TOKENS);
  const nonDrinker = strictSober || matchesTokenSet(allTokens, NON_DRINKER_TOKENS);
  const alcoholOptional = nonDrinker || matchesTokenSet(allTokens, ALCOHOL_OPTIONAL_TOKENS);
  const vegetarian = matchesTokenSet(allTokens, VEGETARIAN_TOKENS);
  const vegan = matchesTokenSet(allTokens, VEGAN_TOKENS);
  const halal = matchesTokenSet(allTokens, HALAL_TOKENS);
  const kosher = matchesTokenSet(allTokens, KOSHER_TOKENS);
  const glutenFree = matchesTokenSet(allTokens, GLUTEN_FREE_TOKENS);
  const severeAllergen = matchesTokenSet(allTokens, SEVERE_ALLERGEN_TOKENS);
  const wheelchairNeeded = matchesTokenSet(allTokens, WHEELCHAIR_TOKENS);
  const lowWalking = wheelchairNeeded || matchesTokenSet(allTokens, LOW_WALKING_TOKENS);
  const smokeFree = matchesTokenSet(allTokens, SMOKE_FREE_TOKENS);
  const lowNoiseRequired = matchesTokenSet(allTokens, LOW_NOISE_TOKENS);
  const daytimeOnly = matchesTokenSet(allTokens, DAYTIME_ONLY_TOKENS);
  const womenOnly = matchesTokenSet(allTokens, WOMEN_ONLY_TOKENS);
  const allAgesOnly = matchesTokenSet(allTokens, ALL_AGES_TOKENS);
  const hasVenueRedLines =
    strictSober
    || nonDrinker
    || alcoholOptional
    || vegetarian
    || vegan
    || halal
    || kosher
    || glutenFree
    || severeAllergen
    || wheelchairNeeded
    || lowWalking
    || smokeFree
    || lowNoiseRequired
    || daytimeOnly
    || womenOnly
    || allAgesOnly;

  return {
    strictSober,
    nonDrinker,
    alcoholOptional,
    vegetarian,
    vegan,
    halal,
    kosher,
    glutenFree,
    severeAllergen,
    wheelchairNeeded,
    lowWalking,
    smokeFree,
    lowNoiseRequired,
    daytimeOnly,
    womenOnly,
    allAgesOnly,
    hasVenueRedLines,
  };
}
