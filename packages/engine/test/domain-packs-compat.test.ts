import { describe, expect, test } from "vitest";
import {
  aestheticReadAllowed,
  BUSINESS_ENGINE_CONFIG,
  businessCapitalAllowed,
  businessPack,
  businessSeats,
  DATING_ENGINE_CONFIG,
  datingPack,
  datingProfiles,
  DEFAULT_FRIENDS_POLICY,
  DEFAULT_FRIENDSHIP_POLICY,
  FRIENDS_PLANS,
  FRIENDSHIP_PLANS,
  friendsPack,
  friendshipPack,
  humanVectorOf,
  localEmbed,
  makeDatingPack,
  makeSlopPack,
  PEON_ENGINE_CONFIG,
  peonCapitalAllowed,
  peonPack,
  peonSeats,
  planFriendsWeek,
  planFriendshipWeek,
  resolveConfig,
  SLOP_ENGINE_CONFIG,
  slopPack,
  slopProfiles,
  VERTICAL_KERNELS,
  verticalKernelFor,
  World,
} from "../src/index.ts";
import { candidateOf, jobOf } from "../src/packs/business/profile.ts";
import { BT, BUSINESS_JOB_INTENT, BUSINESS_SEARCH_INTENT, T } from "../src/packs/business/schema.ts";
import { appearanceFacet } from "../src/packs/dating/appearance.ts";
import { friendshipInfo } from "../src/packs/friendship/info.ts";
import * as friendsShim from "../src/packs/friends/index.ts";
import * as peonShim from "../src/packs/peon/index.ts";
import * as slopShim from "../src/packs/slop/index.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";

describe("generic domain packs and backward-compat shims", () => {
  test("exports both generic domain names and legacy aliases identically", () => {
    expect(datingPack).toBe(slopPack);
    expect(makeDatingPack).toBe(makeSlopPack);
    expect(DATING_ENGINE_CONFIG).toBe(SLOP_ENGINE_CONFIG);
    expect(datingProfiles).toBe(slopProfiles);

    expect(businessPack).toBe(peonPack);
    expect(BUSINESS_ENGINE_CONFIG).toBe(PEON_ENGINE_CONFIG);
    expect(businessSeats).toBe(peonSeats);
    expect(businessCapitalAllowed).toBe(peonCapitalAllowed);

    expect(friendshipPack).toBe(friendsPack);
    expect(FRIENDSHIP_PLANS).toBe(FRIENDS_PLANS);
    expect(DEFAULT_FRIENDSHIP_POLICY).toBe(DEFAULT_FRIENDS_POLICY);
    expect(planFriendshipWeek).toBe(planFriendsWeek);

    expect(slopShim.slopPack).toBe(datingPack);
    expect(peonShim.peonPack).toBe(businessPack);
    expect(friendsShim.friendsPack).toBe(friendshipPack);
  });

  test("vertical kernels and aesthetic/capital guards accept both generic and legacy domain identifiers", () => {
    expect(verticalKernelFor("dating")).toBe(VERTICAL_KERNELS.slop);
    expect(verticalKernelFor("slop")).toBe(VERTICAL_KERNELS.dating);
    expect(verticalKernelFor("business")).toBe(VERTICAL_KERNELS.peon);
    expect(verticalKernelFor("peon")).toBe(VERTICAL_KERNELS.business);
    expect(verticalKernelFor("friendship")).toBe(VERTICAL_KERNELS.friends);
    expect(verticalKernelFor("friends")).toBe(VERTICAL_KERNELS.friendship);

    expect(aestheticReadAllowed(true, 28)).toBe(true);
    expect(aestheticReadAllowed(false, 28)).toBe(false);
    expect(aestheticReadAllowed(true, 17)).toBe(false);

    expect(businessCapitalAllowed("domain_craft")).toBe(true);
    expect(businessCapitalAllowed("work_style")).toBe(true);
    expect(businessCapitalAllowed("economic")).toBe(false);
    expect(businessCapitalAllowed("aesthetic")).toBe(false);
  });

  test("dating profile reader accepts both dating:* and slop:* facet tags identically", () => {
    const legacy = emptyInput();
    const generic = emptyInput();
    for (const [inp, prefix] of [[legacy, "slop"], [generic, "dating"]] as const) {
      inp.members.push(baseMember("m1", { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }));
      inp.facets.push(facet("m1", 0, "preference", "Dating prefs", [
        "romance:is:woman",
        "romance:seeks:man",
        "romance:age:25-35",
        `${prefix}:zip:11222`,
        `${prefix}:max_miles:10`,
        `${prefix}:goal:long_term`,
        `${prefix}:dealbreaker:smoker`,
        `${prefix}:activity:coffee`,
        `${prefix}:free:fri_eve`,
      ], "agent_private"));
    }
    const pLegacy = datingProfiles(legacy).get("m1")!;
    const pGeneric = datingProfiles(generic).get("m1")!;
    expect(pGeneric.zip).toBe(pLegacy.zip);
    expect(pGeneric.maxMiles).toBe(pLegacy.maxMiles);
    expect(pGeneric.goal).toBe(pLegacy.goal);
    expect(pGeneric.dealbreakers).toEqual(pLegacy.dealbreakers);
    expect(pGeneric.activities).toEqual(pLegacy.activities);
    expect(pGeneric.free).toEqual(pLegacy.free);
  });

  test("business profile reader and LL 144 firewall accept business:* and peon:* while blocking proxies and appearance", () => {
    const legacy = emptyInput();
    const generic = emptyInput();
    const now = legacy.now;
    for (const [inp, tags, searchDetails, jobDetails] of [
      [legacy, T, "peon:search", "peon:job"],
      [generic, BT, BUSINESS_SEARCH_INTENT, BUSINESS_JOB_INTENT],
    ] as const) {
      inp.members.push(
        baseMember("cand1", { homeCity: "nyc", age: 29, prefs: { romanceOptIn: false, categoriesOptIn: ["professional"], formats: ["one_to_one"] } }),
        baseMember("job1", { homeCity: "nyc", age: 18, state: "open", prefs: { romanceOptIn: false, categoriesOptIn: ["professional"], formats: ["one_to_one"] } }),
      );
      inp.facets.push(
        facet("cand1", 0, "fact", "Candidate", [`${tags.entity}candidate`, `${tags.family}software_engineer`, `${tags.seniority}3`, `${tags.floor}150`, `${tags.mode}remote`, `${tags.auth}yes`], "matchable"),
        facet("cand1", 1, "skill", "TypeScript", [`${tags.skill}typescript:4`, `${tags.seniority}3`], "shareable"),
        facet("cand1", 2, "boundary", "Exclude employer", [`${tags.exclude}acme`], "agent_private"),
        facet("cand1", 3, "fact", "Zip proxy", [`${tags.proxy}zip:10001`], "agent_private"),
        facet("cand1", 4, "fact", "Dating leak attempt", ["dating:goal:casual", "slop:zip:10001"], "matchable"),
        appearanceFacet("cand1", { age: 29, ageVerified: true }, { face: 1.5, body: 1.2, overall: 1.4, confidence: 0.9, model: "test" }, now),
        facet("job1", 0, "fact", "Job", [`${tags.entity}job`, `${tags.company}beta`, tags.verified, `${tags.family}software_engineer`, `${tags.seniority}3`, `${tags.pay}140-180`, `${tags.mode}remote`, `${tags.openings}2`, `${tags.must}typescript:3`], "shareable"),
      );
      inp.intents.push(
        { id: "i-cand", memberId: "cand1", objective: "Find role", category: "professional", details: searchDetails, horizonDays: 30, status: "active", createdAt: now },
        { id: "i-job", memberId: "job1", objective: "Hire: Staff Eng", category: "professional", details: jobDetails, horizonDays: 30, status: "active", createdAt: now },
      );
    }

    const cfg = resolveConfig(BUSINESS_ENGINE_CONFIG);
    const wLegacy = new World(legacy, cfg, localEmbed, businessPack);
    const wGeneric = new World(generic, cfg, localEmbed, businessPack);

    const cLegacy = candidateOf(wLegacy, "cand1")!;
    const cGeneric = candidateOf(wGeneric, "cand1")!;
    expect(cGeneric.families).toEqual(cLegacy.families);
    expect(cGeneric.seniority).toBe(cLegacy.seniority);
    expect(cGeneric.floor).toBe(cLegacy.floor);
    expect([...cGeneric.excluded]).toEqual(["acme"]);
    expect(cGeneric.searching).toBe(true);

    const jLegacy = jobOf(wLegacy, "job1")!;
    const jGeneric = jobOf(wGeneric, "job1")!;
    expect(jGeneric.verified).toBe(true);
    expect(jGeneric.payMin).toBe(jLegacy.payMin);
    expect(jGeneric.payMax).toBe(jLegacy.payMax);
    expect(jGeneric.openings).toBe(2);

    const vecGeneric = humanVectorOf(wGeneric, "cand1")!;
    expect(vecGeneric.capital.aestheticSlopOnly).toBeUndefined();
    expect(vecGeneric.capital.economic.confidence).toBe(0);
    expect(vecGeneric.capital.cultural.embodied.confidence).toBe(0);
    expect(vecGeneric.capital.symbolic.publicityTier.confidence).toBe(0);
    expect(vecGeneric.capital.domainRungs.career?.value).toBe(6);
  });

  test("friendship info reader accepts both friendship:* and friends:* tags", () => {
    const input = emptyInput();
    input.members.push(baseMember("f1", { homeCity: "nyc" }));
    input.facets.push(facet("f1", 0, "preference", "Friend prefs", [
      "friendship:max_travel:25",
      "friendship:free:fri_eve",
      "friendship:energy:calm",
      "verify:age:pass",
      "verify:liveness:pass",
    ], "matchable"));
    const w = new World(input, resolveConfig({}), localEmbed, friendshipPack);
    const info = friendshipInfo(w).get("f1")!;
    expect(info.tolerance).toBe(25);
    expect(info.energy).toBe("calm");
    expect(info.verified).toBe(true);
    expect(info.standing.length).toBe(1);
  });
});
