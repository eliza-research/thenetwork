import { describe, expect, test } from "bun:test";
import type { City, Preferences } from "@thenetwork/core";
import type { EngineInput } from "@thenetwork/engine";
import { cellOfZip } from "../../engine/src/packs/slop/zips.ts";
import { planFirstDate, planFromInput, type SlopProfile } from "@thenetwork/engine";

function makeProfile(id: string, opts: Partial<SlopProfile> = {}): SlopProfile {
  return {
    id,
    age: 26,
    adult: true,
    optedIn: true,
    paused: false,
    homeMarket: "nyc",
    zip: "10001",
    cell: cellOfZip("10001"),
    maxMiles: 15,
    zipUnknown: false,
    seeks: ["woman"],
    is: "man",
    values: {},
    dealbreakers: [],
    interests: ["coffee"],
    shareableInterests: ["coffee"],
    interestFacet: new Map<string, string>(),
    activities: ["coffee"],
    free: ["fri_eve", "sat_eve"],
    wantsBody: [],
    safety: [],
    verification: [],
    silentAsks: [],
    openAsks: [],
    askCounts: {},
    visiting: [],
    history: {
      yes: 0,
      no: 0,
      silent: 0,
      dates: 0,
      noShows: 0,
      backouts: 0,
      givenMean: 0,
      given: 0,
      receivedMean: 0,
      received: 0,
      negativeFrom: 0,
      blockedBy: 0,
      attendedSlots: [],
      rated: [],
      ratedSelf: [],
      ratedBody: [],
    },
    ...opts,
  };
}

const defaultPrefs: Preferences = {
  romanceOptIn: true,
  categoriesOptIn: ["romance"],
  quietHours: [21, 9],
  formats: ["one_to_one"],
  maxTravelMinutes: 45,
  onlyWhenAsked: false,
};

describe("slop planFirstDate and planFromInput safety gates", () => {
  const markets: City[] = ["nyc"];

  test("planFirstDate returns valid plan for eligible adults in mutual market", () => {
    const a = makeProfile("a");
    const b = makeProfile("b");
    const plan = planFirstDate(a, b, markets);
    expect(plan).not.toBeNull();
    expect(plan?.first).toBe("a");
    expect(plan?.partner).toBe("b");
    expect(plan?.public).toBe(true);
  });

  test("planFirstDate disallows self-dating", () => {
    const a = makeProfile("a");
    expect(planFirstDate(a, a, markets)).toBeNull();
  });

  test("planFirstDate rejects minors and non-adults", () => {
    const adult = makeProfile("adult", { age: 25, adult: true });
    const minor = makeProfile("minor", { age: 17, adult: false });

    expect(planFirstDate(minor, adult, markets)).toBeNull();
    expect(planFirstDate(adult, minor, markets)).toBeNull();
  });

  test("planFirstDate rejects paused members or opted-out members", () => {
    const active = makeProfile("active");
    const paused = makeProfile("paused", { paused: true });
    const optedOut = makeProfile("optedOut", { optedIn: false });

    expect(planFirstDate(paused, active, markets)).toBeNull();
    expect(planFirstDate(active, paused, markets)).toBeNull();
    expect(planFirstDate(optedOut, active, markets)).toBeNull();
    expect(planFirstDate(active, optedOut, markets)).toBeNull();
  });

  test("planFromInput respects blocked edges between members", () => {
    const input: EngineInput = {
      now: 100_000,
      members: [
        { id: "a", name: "Alice", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 25, unansweredProactive: 0 },
        { id: "b", name: "Bob", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 27, unansweredProactive: 0 },
      ],
      facets: [
        { id: "f1", memberId: "a", kind: "preference", value: "", tags: ["romance:is:woman", "romance:seeks:man", "slop:zip:10001", "slop:max_miles:15"], scope: "shareable", provenance: "said", confidence: 1 },
        { id: "f2", memberId: "b", kind: "preference", tags: ["romance:is:man", "romance:seeks:woman", "slop:zip:10001", "slop:max_miles:15"], value: "", scope: "shareable", provenance: "said", confidence: 1 },
      ],
      intents: [],
      presence: [],
      edges: [
        { from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: 1000 },
      ],
      recentProposals: [],
    };

    expect(planFromInput(input, "a", "b", markets)).toBeNull();
    expect(planFromInput(input, "b", "a", markets)).toBeNull();
  });

  test("planFromInput respects active safety holds on either member", () => {
    const inputWithHold: EngineInput = {
      now: 100_000,
      members: [
        { id: "a", name: "Alice", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 25, unansweredProactive: 0 },
        { id: "b", name: "Bob", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 27, unansweredProactive: 0 },
      ],
      facets: [
        { id: "f1", memberId: "a", kind: "preference", value: "", tags: ["romance:is:woman", "romance:seeks:man", "slop:zip:10001", "slop:max_miles:15"], scope: "shareable", provenance: "said", confidence: 1 },
        { id: "f2", memberId: "b", kind: "preference", value: "", tags: ["romance:is:man", "romance:seeks:woman", "slop:zip:10001", "slop:max_miles:15"], scope: "shareable", provenance: "said", confidence: 1 },
      ],
      intents: [],
      presence: [],
      edges: [],
      safetyHolds: [
        { memberId: "b", from: 50_000, to: 150_000, reason: "investigation" },
      ],
      recentProposals: [],
    };

    expect(planFromInput(inputWithHold, "a", "b", markets)).toBeNull();

    // Expired safety hold should not block
    const inputWithExpiredHold: EngineInput = {
      ...inputWithHold,
      safetyHolds: [
        { memberId: "b", from: 10_000, to: 50_000, reason: "resolved" },
      ],
    };
    const validPlan = planFromInput(inputWithExpiredHold, "a", "b", markets);
    expect(validPlan).not.toBeNull();
    expect(validPlan?.first).toBe("a");
    expect(validPlan?.partner).toBe("b");
  });
});
