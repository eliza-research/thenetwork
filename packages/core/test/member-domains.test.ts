// spec/memberDomains.md, "Each brand maps to its default set of domains"
// spec/memberDomains.md, "Age determines which domains a member may enable"
// spec/memberDomains.md, "Photos apply only to adult dating and the business firewall applies only to business"
// spec/consoleNavigation.md, "The filter bar dims the filters that do not apply to the open tab"

import { describe, expect, test } from "vitest";
import {
  APP_TO_DOMAIN,
  BRAND_DEFAULT_DOMAINS,
  CityMatchmakerRegistry,
  DOMAIN_IDS,
  DOMAIN_LABELS,
  DOMAIN_TO_APP,
  ExternalProspectCache,
  appToCoreCode,
  brandDefaultDomains,
  buildQualityGatedNetworkInviteScript,
  canEnableDomain,
  defaultDomainsForJoin,
  domainAllowedForAge,
  domainAllowsPhotos,
  domainRequiresBusinessFirewall,
  evaluateDensityTier,
  isAppAllowedToReadExternalProspects,
  isBusinessDomain,
  isDatingDomain,
  isDomainId,
  isFriendshipDomain,
  mapOntologyToOutcomePolicy,
  matchmakerAppFriends,
  matchmakerAppNtwrk,
  matchmakerAppPeon,
  matchmakerAppSlop,
  rankVenuesForMatch,
  seedVenuesForCity,
  toDomainId,
  type ConnectionOntologySpecLike,
  type MemberDomain,
  type MemberDomainBrand,
  type MemberVenuePrefs,
} from "../src/index.ts";
import { filterApplies, filterDimmed, type DrawerTab } from "../src/generated/consoleNavigation.ts";

describe("memberDomains generated decisions", () => {
  test("brandDefaultDomains maps each brand to its default domain set", () => {
    expect(brandDefaultDomains("SlopBrand")).toEqual(["Dating"]);
    expect(brandDefaultDomains("PeonBrand")).toEqual(["Business"]);
    expect(brandDefaultDomains("FriendsBrand")).toEqual(["Friendship"]);
    expect(new Set(brandDefaultDomains("NtwrkBrand"))).toEqual(new Set(["Dating", "Friendship", "Business"]));
  });

  test("under-13 members get empty defaults and cannot enable any domain", () => {
    const brands: MemberDomainBrand[] = ["NtwrkBrand", "SlopBrand", "PeonBrand", "FriendsBrand"];
    const domains: MemberDomain[] = ["Dating", "Friendship", "Business"];
    for (const age of [-1, 0, 12]) {
      for (const brand of brands) {
        expect(defaultDomainsForJoin(brand, age)).toEqual([]);
      }
      for (const domain of domains) {
        expect(domainAllowedForAge(domain, age)).toBe(false);
        expect(canEnableDomain(domain, age, false, false)).toBe(false);
        expect(domainAllowsPhotos(domain, age)).toBe(false);
      }
    }
  });

  test("minors aged 13-17 can only enable Friendship and never Dating, Business, or photos", () => {
    for (const age of [13, 15, 17]) {
      expect(domainAllowedForAge("Friendship", age)).toBe(true);
      expect(domainAllowedForAge("Dating", age)).toBe(false);
      expect(domainAllowedForAge("Business", age)).toBe(false);

      expect(canEnableDomain("Friendship", age, false, false)).toBe(true);
      expect(canEnableDomain("Friendship", age, true, false)).toBe(false);
      expect(canEnableDomain("Friendship", age, false, true)).toBe(false);
      expect(canEnableDomain("Dating", age, false, false)).toBe(false);
      expect(canEnableDomain("Business", age, false, false)).toBe(false);

      expect(defaultDomainsForJoin("NtwrkBrand", age)).toEqual(["Friendship"]);
      expect(defaultDomainsForJoin("FriendsBrand", age)).toEqual(["Friendship"]);
      expect(defaultDomainsForJoin("SlopBrand", age)).toEqual([]);
      expect(defaultDomainsForJoin("PeonBrand", age)).toEqual([]);

      expect(domainAllowsPhotos("Dating", age)).toBe(false);
      expect(domainAllowsPhotos("Friendship", age)).toBe(false);
      expect(domainAllowsPhotos("Business", age)).toBe(false);
    }
  });

  test("adults 18+ can enable all domains unless banned or held, and photos apply only to adult Dating", () => {
    for (const age of [18, 29, 65]) {
      expect(new Set(defaultDomainsForJoin("NtwrkBrand", age))).toEqual(new Set(["Dating", "Friendship", "Business"]));
      expect(defaultDomainsForJoin("SlopBrand", age)).toEqual(["Dating"]);
      expect(defaultDomainsForJoin("PeonBrand", age)).toEqual(["Business"]);
      expect(defaultDomainsForJoin("FriendsBrand", age)).toEqual(["Friendship"]);

      for (const domain of ["Dating", "Friendship", "Business"] as const) {
        expect(canEnableDomain(domain, age, false, false)).toBe(true);
        expect(canEnableDomain(domain, age, true, false)).toBe(false);
        expect(canEnableDomain(domain, age, false, true)).toBe(false);
      }

      expect(domainAllowsPhotos("Dating", age)).toBe(true);
      expect(domainAllowsPhotos("Friendship", age)).toBe(false);
      expect(domainAllowsPhotos("Business", age)).toBe(false);
    }
  });

  test("business firewall applies strictly to Business", () => {
    expect(domainRequiresBusinessFirewall("Business")).toBe(true);
    expect(domainRequiresBusinessFirewall("Dating")).toBe(false);
    expect(domainRequiresBusinessFirewall("Friendship")).toBe(false);
  });
});

describe("core domain types and helpers", () => {
  test("DOMAIN_IDS, labels, mappings, and guards work for both DomainId and legacy AppId", () => {
    expect(DOMAIN_IDS).toEqual(["dating", "friendship", "business"]);
    expect(DOMAIN_LABELS).toEqual({ dating: "Dating", friendship: "Friendship", business: "Business" });
    expect(DOMAIN_TO_APP).toEqual({ dating: "slop", friendship: "friends", business: "peon" });
    expect(APP_TO_DOMAIN).toEqual({ slop: "dating", friends: "friendship", peon: "business", ntwrk: null });
    expect(BRAND_DEFAULT_DOMAINS).toEqual({
      slop: ["dating"],
      peon: ["business"],
      friends: ["friendship"],
      ntwrk: ["dating", "friendship", "business"],
    });

    expect(isDomainId("dating")).toBe(true);
    expect(isDomainId("friendship")).toBe(true);
    expect(isDomainId("business")).toBe(true);
    expect(isDomainId("slop")).toBe(false);
    expect(isDomainId(42)).toBe(false);

    expect(toDomainId("dating")).toBe("dating");
    expect(toDomainId("slop")).toBe("dating");
    expect(toDomainId("friendship")).toBe("friendship");
    expect(toDomainId("friends")).toBe("friendship");
    expect(toDomainId("business")).toBe("business");
    expect(toDomainId("peon")).toBe("business");
    expect(toDomainId("ntwrk")).toBeUndefined();

    expect(isDatingDomain("dating")).toBe(true);
    expect(isDatingDomain("slop")).toBe(true);
    expect(isDatingDomain("friends")).toBe(false);

    expect(isBusinessDomain("business")).toBe(true);
    expect(isBusinessDomain("peon")).toBe(true);
    expect(isBusinessDomain("dating")).toBe(false);

    expect(isFriendshipDomain("friendship")).toBe(true);
    expect(isFriendshipDomain("friends")).toBe(true);
    expect(isFriendshipDomain("peon")).toBe(false);
  });

  test("venues and externalMatchmaker accept DomainId and legacy AppId seamlessly", async () => {
    expect(appToCoreCode("dating")).toBe(matchmakerAppSlop);
    expect(appToCoreCode("slop")).toBe(matchmakerAppSlop);
    expect(appToCoreCode("business")).toBe(matchmakerAppPeon);
    expect(appToCoreCode("peon")).toBe(matchmakerAppPeon);
    expect(appToCoreCode("friendship")).toBe(matchmakerAppFriends);
    expect(appToCoreCode("friends")).toBe(matchmakerAppFriends);
    expect(appToCoreCode("ntwrk")).toBe(matchmakerAppNtwrk);

    expect(isAppAllowedToReadExternalProspects("dating")).toBe(isAppAllowedToReadExternalProspects("slop"));
    expect(isAppAllowedToReadExternalProspects("business")).toBe(isAppAllowedToReadExternalProspects("peon"));
    expect(isAppAllowedToReadExternalProspects("friendship")).toBe(isAppAllowedToReadExternalProspects("friends"));

    const registry = new CityMatchmakerRegistry();
    const pSlop = registry.selectPersona({
      city: "nyc",
      app: "slop",
      memberGender: "woman",
      targetProspectGender: "man",
      tieBreakSeed: "seed-1",
    });
    const pDating = registry.selectPersona({
      city: "nyc",
      app: "dating",
      memberGender: "woman",
      targetProspectGender: "man",
      tieBreakSeed: "seed-1",
    });
    expect(pDating?.id).toBe(pSlop?.id);

    const cache = new ExternalProspectCache("unit-test-hmac-secret-0123456789");
    const upserted = await cache.upsertProspect({
      id: "ext-1",
      city: "nyc",
      sourcePlatform: "hinge",
      assignedPersona: pSlop!,
      platformHandleKey: "handle-1",
      firstName: "Alex",
      statedAge: 28,
      gender: "man",
      seeks: ["woman"],
      neighborhood: "Flatiron",
      rawFacets: { interest: "coffee" },
      consentState: "intro_single_only",
      nowMs: 1_700_000_000_000,
    });
    expect(upserted.ok).toBe(true);
    if (upserted.ok) {
      expect(cache.getForApp("dating", upserted.record.dedupeHash)?.id).toBe("ext-1");
      expect(cache.getForApp("business", upserted.record.dedupeHash)).toBeUndefined();
    }

    const validInviteGate = {
      meetupCompleted: true,
      memberAttended: true,
      prospectAttended: true,
      safetyOrRedFlag: false,
      catfishOrAgeMismatch: false,
      memberQualityPositive: true,
      memberVouchedForOthers: true,
      statedAge: 28,
      optedOut: false,
      banned: false,
      alreadyMember: false,
      inviteAttempts: 0,
      safeFollowupWindow: true,
    };
    const inviteFriends = buildQualityGatedNetworkInviteScript(
      validInviteGate,
      { variant: "mutual_spark", app: "friendship", memberFirstName: "Maya", cityName: "NYC" }
    );
    const inviteLegacy = buildQualityGatedNetworkInviteScript(
      validInviteGate,
      { variant: "mutual_spark", app: "friends", memberFirstName: "Maya", cityName: "NYC" }
    );
    expect(inviteFriends.ok).toBe(true);
    expect(inviteFriends).toEqual(inviteLegacy);

    const workOntology: ConnectionOntologySpecLike = {
      id: "work_hiring",
      defaultCategory: "professional",
      defaultFormat: "one_to_one",
      sizeRange: [2, 2],
      defaultFreeAnchor: false,
      requiresHighDiscretion: true,
    };
    expect(mapOntologyToOutcomePolicy("business", workOntology)).toEqual(
      mapOntologyToOutcomePolicy("peon", workOntology)
    );

    const datingOntology: ConnectionOntologySpecLike = {
      id: "dating",
      defaultCategory: "romance",
      defaultFormat: "one_to_one",
      sizeRange: [2, 2],
      defaultFreeAnchor: false,
      requiresHighDiscretion: false,
    };
    expect(mapOntologyToOutcomePolicy("dating", datingOntology)).toEqual(
      mapOntologyToOutcomePolicy("slop", datingOntology)
    );

    const friendsOntology: ConnectionOntologySpecLike = {
      id: "friendship",
      defaultCategory: "social",
      defaultFormat: "small_group",
      sizeRange: [2, 6],
      defaultFreeAnchor: false,
      requiresHighDiscretion: false,
    };
    expect(mapOntologyToOutcomePolicy("friendship", friendsOntology, { hasMinor: true })).toEqual(
      mapOntologyToOutcomePolicy("friends", friendsOntology, { hasMinor: true })
    );

    expect(evaluateDensityTier("friendship", 5)).toBe(evaluateDensityTier("friends", 5));
    expect(evaluateDensityTier("dating", 5)).toBe(evaluateDensityTier("slop", 5));

    const venues = seedVenuesForCity("nyc");
    const prefs: MemberVenuePrefs[] = [
      {
        memberId: "m1",
        age: 29,
        drinksAlcohol: true,
        vegetarian: false,
        vegan: false,
        wheelchairNeeded: false,
        maxBudgetTier: 3,
        visitedVenueIds: [],
        rejectedVenueIds: [],
      },
    ];
    const startMs = Date.UTC(2026, 10, 18, 18, 0, 0);
    const rankedPeon = rankVenuesForMatch(venues, { city: "nyc", memberAreas: ["Flatiron"], members: prefs, startMs, mode: "date", app: "peon" }, startMs);
    const rankedBiz = rankVenuesForMatch(venues, { city: "nyc", memberAreas: ["Flatiron"], members: prefs, startMs, mode: "date", domain: "business" }, startMs);
    expect(rankedBiz.map(r => r.venue.id)).toEqual(rankedPeon.map(r => r.venue.id));
  });
});

describe("consoleNavigation DomainsKey filter rules", () => {
  test("DomainsKey applies to data tabs and is dimmed on tool tabs", () => {
    const activeTabs: DrawerTab[] = ["ReviewTab", "FeedTab", "PipelineTab", "SafetyTab", "RequestsTab", "MetricsTab", "EngineTab"];
    const dimmedTabs: DrawerTab[] = ["LabTab", "ConfigTab", "GameTab"];

    for (const tab of activeTabs) {
      expect(filterApplies(tab, "DomainsKey")).toBe(true);
      expect(filterDimmed(true, tab, "DomainsKey")).toBe(false);
    }
    for (const tab of dimmedTabs) {
      expect(filterApplies(tab, "DomainsKey")).toBe(false);
      expect(filterDimmed(true, tab, "DomainsKey")).toBe(true);
      expect(filterDimmed(false, tab, "DomainsKey")).toBe(false);
    }
  });
});
