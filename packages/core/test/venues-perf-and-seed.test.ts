import { describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  CITY_IDS,
  chooseFairMidpoint,
  estimateTravelMinutes,
  findNeighborhood,
  getCity,
  registerCity,
  resolveCity,
  seedVenuesForCity,
  type CitySpec,
} from "../src/cities.ts";
import { km } from "../src/geo.ts";
import {
  fairMidpointCostScaled,
  fairMidpointNetCostScaled,
  isValidMidpoint,
  isWithinTravelLimit,
} from "../src/generated/venueSelection.ts";
import { fromLocal, localParts } from "../src/time.ts";
import type { LaunchCity, MemberVenuePrefs } from "../src/types.ts";
import { isVenueOpenAt, rankVenuesForMatch } from "../src/venues.ts";

function refNormText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s/-]+/g, " ").replace(/\s+/g, " ").trim();
}

function refFindNeighborhood(spec: CitySpec, area: string) {
  const q = refNormText(area);
  if (!q) return undefined;
  for (const n of spec.neighborhoods) {
    if (refNormText(n.name) === q || n.aliases.some(a => refNormText(a) === q)) return n;
  }
  for (const n of spec.neighborhoods) {
    const nn = refNormText(n.name);
    if ((nn && q.includes(nn)) || n.aliases.some(a => {
      const na = refNormText(a);
      return na.length >= 4 && q.includes(na);
    })) return n;
  }
  return undefined;
}

function refEstimateTravelMinutes(spec: CitySpec, fromArea: string, toArea: string): number {
  const a = refFindNeighborhood(spec, fromArea);
  const b = refFindNeighborhood(spec, toArea);
  if (!a || !b) {
    const nf = refNormText(fromArea);
    const nt = refNormText(toArea);
    if (nf && nf === nt) return 5;
    if (!a && !b) return 25;
    const pa = a ?? { lat: spec.center.lat, lng: spec.center.lng };
    const pb = b ?? { lat: spec.center.lat, lng: spec.center.lng };
    return Math.max(20, Math.round(spec.baseMinutes + km(pa, pb) / spec.kmPerMinute));
  }
  if (a.name === b.name) return 5;
  let barrier = 0;
  if (a.zone !== b.zone) {
    for (const br of spec.barriers) {
      if ((br.fromZone === a.zone && br.toZone === b.zone) || (br.fromZone === b.zone && br.toZone === a.zone)) {
        barrier = br.penaltyMinutes;
        break;
      }
    }
  }
  return Math.max(5, Math.round(spec.baseMinutes + km(a, b) / spec.kmPerMinute + barrier));
}

function refChooseFairMidpoint(spec: CitySpec, areas: string[], mode: "date" | "group" = "date") {
  if (areas.length === 0) return undefined;
  const baseLimit = mode === "group" ? spec.groupMaxMinutes : spec.dateMaxMinutes;
  for (const relax of [0, 5, 10]) {
    let best: ReturnType<typeof chooseFairMidpoint>;
    for (const candidate of spec.neighborhoods) {
      const times = areas.map(a => refEstimateTravelMinutes(spec, a, candidate.name));
      if (!isValidMidpoint(times, baseLimit, relax)) continue;
      const maxMin = Math.max(...times);
      const meanMin = Math.round(times.reduce((s, x) => s + x, 0) / times.length);
      if (!isWithinTravelLimit(maxMin, baseLimit + relax)) continue;
      const supplyBonus = Number.isFinite(candidate.hubSupply) ? Math.max(0, Math.round(candidate.hubSupply * 2)) : 0;
      const baseCost = fairMidpointCostScaled(maxMin, meanMin);
      const netCost = Math.max(0, fairMidpointNetCostScaled(maxMin, meanMin, supplyBonus));
      if (
        !best ||
        netCost < best.costScaled ||
        (netCost === best.costScaled && baseCost < fairMidpointCostScaled(best.maxMinutes, best.meanMinutes))
      ) {
        best = { neighborhood: candidate, maxMinutes: maxMin, meanMinutes: meanMin, costScaled: netCost, relaxedBy: relax };
      }
    }
    if (best) return best;
  }
  return undefined;
}

describe("seed venues, indexed midpoints, open-hours hoisting, and localParts", () => {
  test("every seed venue has numeric ageMin and enforces allAges=false on alcohol-centric/bar/age-restricted spots", () => {
    expect(ALL_SEED_VENUES.length).toBeGreaterThanOrEqual(75);
    for (const v of ALL_SEED_VENUES) {
      expect(typeof v.ageMin, `${v.id} ageMin`).toBe("number");
      expect(Number.isInteger(v.ageMin), `${v.id} ageMin integer`).toBe(true);
      expect(v.ageMin!, `${v.id} ageMin >= 0`).toBeGreaterThanOrEqual(0);
      expect(typeof v.allAges, `${v.id} allAges`).toBe("boolean");
      if (v.isAlcoholCentric || v.isBarOnly || (v.ageMin ?? 0) > 0) {
        expect(v.allAges, `${v.id} must have allAges=false`).toBe(false);
      }
    }
    for (const city of CITY_IDS) {
      const venues = seedVenuesForCity(city);
      expect(venues.length).toBeGreaterThanOrEqual(15);
      expect(venues.some(v => v.isAlcoholCentric === true && v.allAges === false)).toBe(true);
      expect(venues.some(v => v.allAges === true && v.ageMin === 0 && !v.isAlcoholCentric)).toBe(true);
    }
  });

  test("findNeighborhood, estimateTravelMinutes, resolveCity, and chooseFairMidpoint match reference across all 5 cities", () => {
    const cases: Array<{ city: LaunchCity; areas: string[]; mode: "date" | "group" }> = [
      { city: "sf", areas: ["Mission District", "North Beach"], mode: "date" },
      { city: "sf", areas: ["mission", "marina", "soma"], mode: "group" },
      { city: "sf", areas: ["living near valencia street", "Unknown Outer Sunset"], mode: "date" },
      { city: "nyc", areas: ["Williamsburg", "West Village"], mode: "date" },
      { city: "nyc", areas: ["park slope", "midtown", "east village"], mode: "group" },
      { city: "nyc", areas: ["near union square", "Nowhereville"], mode: "group" },
      { city: "la", areas: ["Santa Monica", "Silver Lake"], mode: "date" },
      { city: "la", areas: ["venice", "dtla", "weho"], mode: "group" },
      { city: "chicago", areas: ["Wicker Park / Bucktown", "Hyde Park"], mode: "date" },
      { city: "chicago", areas: ["west loop", "lincoln park", "fulton market"], mode: "group" },
      { city: "miami", areas: ["South Beach", "Brickell"], mode: "date" },
      { city: "miami", areas: ["coral gables", "wynwood", "sobe"], mode: "group" },
    ];

    for (const { city, areas, mode } of cases) {
      const spec = getCity(city)!;
      for (const area of areas) {
        expect(findNeighborhood(city, area)).toEqual(refFindNeighborhood(spec, area));
      }
      for (const candidate of spec.neighborhoods) {
        for (const area of areas) {
          expect(estimateTravelMinutes(city, area, candidate.name)).toBe(
            refEstimateTravelMinutes(spec, area, candidate.name)
          );
        }
      }
      expect(chooseFairMidpoint(city, areas, mode)).toEqual(refChooseFairMidpoint(spec, areas, mode));
    }

    expect(resolveCity("living in downtown chicago")).toBe("chicago");
    expect(resolveCity("sobe")).toBe("miami");
    expect(resolveCity("williamsburg")).toBe("nyc");
    expect(resolveCity("weho")).toBe("la");
    expect(resolveCity("bay area")).toBe("sf");

    // Re-registering a city refreshes its index cleanly.
    const sfSpec = getCity("sf")!;
    registerCity(sfSpec);
    expect(chooseFairMidpoint("sf", ["Mission District", "North Beach"], "date")).toEqual(
      refChooseFairMidpoint(sfSpec, ["Mission District", "North Beach"], "date")
    );
  });

  test("chooseFairMidpoint and neighborhood lookup handle all edge cases, tie-breaking, barriers, and registerCity updates", () => {
    // Unknown city & empty areas
    expect(chooseFairMidpoint("atlanta" as LaunchCity, ["Midtown"], "date")).toBeUndefined();
    expect(chooseFairMidpoint("sf", [], "date")).toBeUndefined();

    // Single area & duplicate areas pick the same neighborhood with 5m travel and 0 relaxation
    const single = chooseFairMidpoint("sf", ["Mission District"], "date");
    const dup = chooseFairMidpoint("sf", ["Mission District", "Mission District"], "date");
    expect(single).toBeDefined();
    expect(single!.neighborhood.name).toBe("Mission District");
    expect(single!.maxMinutes).toBe(5);
    expect(single!.meanMinutes).toBe(5);
    expect(single!.relaxedBy).toBe(0);
    expect(dup).toEqual(single);

    // Unknown area falls back to centerMinutes matching estimateTravelMinutes
    const unknownOnly = chooseFairMidpoint("sf", ["Totally Unknown Area"], "date");
    expect(unknownOnly).toBeDefined();
    const expectedToChosen = estimateTravelMinutes("sf", "Totally Unknown Area", unknownOnly!.neighborhood.name);
    expect(unknownOnly!.maxMinutes).toBe(expectedToChosen);
    expect(unknownOnly!.meanMinutes).toBe(expectedToChosen);

    // Cross-barrier refusal: LA 405 barrier refuses Santa Monica <-> Highland Park for date mode
    expect(chooseFairMidpoint("la", ["Santa Monica", "Highland Park"], "date")).toBeUndefined();

    // Miami causeway barrier: South Beach <-> Coral Gables date mode cannot ignore causeway penalty
    const miamiBarrier = chooseFairMidpoint("miami", ["South Beach", "Coral Gables"], "date");
    if (miamiBarrier) {
      expect(miamiBarrier.maxMinutes).toBeLessThanOrEqual(getCity("miami")!.dateMaxMinutes + 10);
      expect([0, 5, 10]).toContain(miamiBarrier.relaxedBy);
    }

    // Punctuation & empty-string normalization
    expect(findNeighborhood("nyc", "SoHo!")?.name).toBe("SoHo / Nolita");
    expect(findNeighborhood("nyc", "(Williamsburg)")?.name).toBe("Williamsburg");
    expect(findNeighborhood("nyc", "!!!")).toBeUndefined();
    expect(resolveCity("NYC!")).toBe("nyc");
    expect(resolveCity("SF?")).toBe("sf");
    expect(resolveCity("!!!")).toBeUndefined();

    // Synthetic edge cases via registerCity with guaranteed restore
    const origSf = getCity("sf")!;
    try {
      // 1. Zero-neighborhood city returns undefined cleanly
      registerCity({ ...origSf, neighborhoods: [] });
      expect(chooseFairMidpoint("sf", ["Mission District"], "date")).toBeUndefined();

      // 2. Non-negativity clamp, tie-breaking (netCost -> baseCost -> deterministic index),
      //    relaxation cap (+10 max), empty normName guard, and na.length >= 4 alias guard
      registerCity({
        ...origSf,
        baseMinutes: 5,
        kmPerMinute: 1,
        dateMaxMinutes: 10,
        groupMaxMinutes: 15,
        barriers: [],
        neighborhoods: [
          { name: "!!!", zone: "central", lat: 37.77, lng: -122.42, aliases: ["   a   "], hubSupply: 1 },
          { name: "Hub Alpha", zone: "central", lat: 37.77, lng: -122.42, aliases: ["alpha"], hubSupply: 50 },
          { name: "Hub Beta", zone: "central", lat: 37.77, lng: -122.42, aliases: ["beta"], hubSupply: 50 },
          { name: "Far Hub", zone: "central", lat: 37.99, lng: -122.42, aliases: ["farhub"], hubSupply: 5 },
        ],
      });

      // Empty normName ("!!!") and short trimmed alias ("   a   ") must NOT match arbitrary queries
      expect(findNeighborhood("sf", "random place a")).toBeUndefined();

      // High hubSupply clamps netCost to >= 0 (never negative) and breaks equal ties by index order
      const clamped = chooseFairMidpoint("sf", ["Hub Alpha"], "date");
      expect(clamped).toBeDefined();
      expect(clamped!.costScaled).toBe(0);
      expect(clamped!.neighborhood.name).toBe("Hub Alpha");

      // Tie-break: netCost equal, smaller baseCost wins over higher supplyBonus
      registerCity({
        ...origSf,
        baseMinutes: 5,
        kmPerMinute: 1,
        dateMaxMinutes: 20,
        barriers: [],
        neighborhoods: [
          // From Hub Origin: Dist=10km -> 15 min -> baseCost=150; supplyBonus=50*2=100 -> netCost=50
          { name: "High Supply Far", zone: "central", lat: 37.86, lng: -122.42, aliases: [], hubSupply: 50 },
          // From Hub Origin: same point -> 5 min -> baseCost=50; supplyBonus=0 -> netCost=50
          { name: "Hub Origin", zone: "central", lat: 37.77, lng: -122.42, aliases: [], hubSupply: 0 },
        ],
      });
      const tieBreak = chooseFairMidpoint("sf", ["Hub Origin"], "date");
      expect(tieBreak).toBeDefined();
      expect(tieBreak!.neighborhood.name).toBe("Hub Origin");
      expect(tieBreak!.costScaled).toBe(50);

      // Relaxation cap: baseLimit=10 -> max allowed is 20 (+10); if every candidate takes 21m, returns undefined
      registerCity({
        ...origSf,
        baseMinutes: 21,
        kmPerMinute: 1,
        dateMaxMinutes: 10,
        barriers: [],
        neighborhoods: [
          { name: "West Point", zone: "central", lat: 37.77, lng: -122.42, aliases: [], hubSupply: 5 },
          { name: "East Point", zone: "central", lat: 37.77, lng: -122.41, aliases: [], hubSupply: 5 },
        ],
      });
      // For two distinct neighborhoods with baseMinutes=21, both candidates have maxMin >= 21 > 10 + 10
      expect(chooseFairMidpoint("sf", ["West Point", "East Point"], "date")).toBeUndefined();
    } finally {
      registerCity(origSf);
    }
    expect(chooseFairMidpoint("sf", ["Mission District", "North Beach"], "date")).toEqual(
      refChooseFairMidpoint(origSf, ["Mission District", "North Beach"], "date")
    );
  });

  test("isVenueOpenAt with hoisted LocalParts matches unhoisted output across all 5 cities and keeps teenFriendAllowed fail-closed", () => {
    const timestamps = [
      Date.UTC(2026, 2, 8, 10, 30, 0), // US spring-forward DST Sunday
      Date.UTC(2026, 6, 15, 19, 0, 0), // Summer weekday evening
      Date.UTC(2026, 10, 1, 7, 15, 0), // US fall-back DST Sunday (past-midnight check)
      Date.UTC(2026, 10, 21, 5, 30, 0), // Late Friday/early Saturday past-midnight
    ];

    for (const city of CITY_IDS) {
      const spec = getCity(city)!;
      const venues = seedVenuesForCity(city);
      for (const ts of timestamps) {
        const hoisted = localParts(ts, spec.tz);
        const refFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: spec.tz,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          weekday: "short",
        });
        const refMap = Object.fromEntries(refFmt.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
        const refWd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(refMap.weekday!);
        expect(hoisted).toEqual({
          year: +refMap.year!,
          month: +refMap.month!,
          day: +refMap.day!,
          hour: +refMap.hour! % 24,
          minute: +refMap.minute!,
          weekday: refWd,
        });

        for (const v of venues) {
          for (const bufferMin of [90, 120]) {
            const withoutParts = isVenueOpenAt(v, spec.tz, ts, bufferMin);
            const withParts = isVenueOpenAt(v, spec.tz, ts, bufferMin, hoisted);
            expect(withParts).toEqual(withoutParts);
          }
        }
      }
    }

    // Verify fail-closed teenFriendAllowed default (false) in rankVenuesForMatch.
    const sfVenues = seedVenuesForCity("sf");
    const wedAfternoonSf = fromLocal(2026, 11, 18, 14, "America/Los_Angeles");
    const teenPrefs = (id: string): MemberVenuePrefs => ({
      memberId: id,
      age: 16,
      drinksAlcohol: false,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      maxBudgetTier: 2,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    });
    const blockedByDefault = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Mission District", "Hayes Valley"],
        members: [teenPrefs("t1"), teenPrefs("t2")],
        startMs: wedAfternoonSf,
        mode: "group",
      },
      wedAfternoonSf
    );
    expect(blockedByDefault).toEqual([]);

    const allowedWhenExplicit = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Mission District", "Hayes Valley"],
        members: [teenPrefs("t1"), teenPrefs("t2")],
        startMs: wedAfternoonSf,
        mode: "group",
        teenFriendAllowed: true,
      },
      wedAfternoonSf
    );
    expect(allowedWhenExplicit.length).toBeGreaterThan(0);
    expect(allowedWhenExplicit.every(c => c.venue.allAges === true && !c.venue.isAlcoholCentric)).toBe(true);
  });

  test("micro-benchmarks: midpoint (< 40 ms for 2k calls) and open-hours (< 60 ms for 15x2k calls)", () => {
    const midpointInputs: Array<{ city: LaunchCity; areas: string[]; mode: "date" | "group" }> = [
      { city: "sf", areas: ["Mission District", "North Beach"], mode: "date" },
      { city: "nyc", areas: ["Williamsburg", "West Village"], mode: "date" },
      { city: "la", areas: ["Santa Monica", "Arts District / DTLA"], mode: "group" },
      { city: "chicago", areas: ["West Loop / Fulton Market", "Hyde Park"], mode: "group" },
      { city: "miami", areas: ["South Beach", "Brickell"], mode: "date" },
    ];

    // Warmup
    for (let i = 0; i < 100; i++) {
      const inp = midpointInputs[i % midpointInputs.length]!;
      chooseFairMidpoint(inp.city, inp.areas, inp.mode);
    }

    const midStart = performance.now();
    let midHits = 0;
    for (let i = 0; i < 2000; i++) {
      const inp = midpointInputs[i % midpointInputs.length]!;
      if (chooseFairMidpoint(inp.city, inp.areas, inp.mode)) midHits++;
    }
    const midMs = performance.now() - midStart;
    expect(midHits).toBe(2000);
    expect(midMs).toBeLessThan(40);

    const sfVenues = seedVenuesForCity("sf").slice(0, 15);
    const tz = getCity("sf")!.tz;
    const startMs = fromLocal(2026, 11, 18, 14, tz);

    // Warmup
    for (let i = 0; i < 50; i++) {
      const parts = localParts(startMs, tz);
      for (const v of sfVenues) isVenueOpenAt(v, tz, startMs, 90, parts);
    }

    const openStart = performance.now();
    let openHits = 0;
    for (let i = 0; i < 2000; i++) {
      const parts = localParts(startMs, tz);
      for (let j = 0; j < sfVenues.length; j++) {
        if (isVenueOpenAt(sfVenues[j]!, tz, startMs, 90, parts).open) openHits++;
      }
    }
    const openMs = performance.now() - openStart;
    expect(openHits).toBeGreaterThan(0);
    expect(openMs).toBeLessThan(60);

    console.info(
      `[w1-core-db benchmark] chooseFairMidpoint (2000 calls): ${midMs.toFixed(2)} ms | isVenueOpenAt hoisted (15x2000 calls): ${openMs.toFixed(2)} ms`
    );
  });
});
