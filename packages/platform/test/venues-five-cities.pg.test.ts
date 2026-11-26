import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import {
  ALL_SEED_VENUES,
  DAY,
  HOUR,
  LAUNCH_CITIES,
  fromLocal,
  rankVenuesForMatch,
  type City,
  type MemberVenuePrefs,
  type VenueRankRequest,
  type VenueRecord,
} from "../../core/src/index.ts";
import { homeCityOf, parseHome, parseJoin } from "../src/accounts.ts";
import { APPS } from "../src/apps.ts";
import {
  applyVenueFeedbackPg,
  getCachedSearch,
  getVenue,
  getWorkIntro,
  listMeetupArrivals,
  listRejectedVenueIds,
  listVenues,
  listVisitedVenueIds,
  recordVenueRejection,
  recordVenueVisit,
  seedCuratedVenues,
  upsertMeetupArrival,
  upsertVenue,
  upsertWorkIntro,
} from "../src/venue-store.ts";
import {
  CompositeVenueProvider,
  GooglePlacesProvider,
  SimulatedVenueProvider,
  YelpFusionProvider,
} from "../src/venue-provider.ts";
import { checkArgs, toolDefs } from "../../mcp/src/tools.ts";
import { defaultApps } from "../../mcp/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });

const WED_14_SF = fromLocal(2026, 11, 18, 14, "America/Los_Angeles");
const WED_14_CHI = fromLocal(2026, 11, 18, 14, "America/Chicago");
const SAT_15_SF = fromLocal(2026, 11, 21, 15, "America/Los_Angeles");

function adultPrefs(overrides: Partial<MemberVenuePrefs> = {}): MemberVenuePrefs {
  return {
    memberId: "m1",
    age: 29,
    drinksAlcohol: true,
    vegetarian: false,
    vegan: false,
    wheelchairNeeded: false,
    maxBudgetTier: 4,
    maxTravelMinutes: 45,
    visitedVenueIds: [],
    rejectedVenueIds: [],
    archetype: "foodie",
    ...overrides,
  };
}

describe("5-city platform & MCP validation (offline)", () => {
  test("platform homeCityOf, parseHome, parseJoin and MCP prepare_signup accept all 5 launch cities", () => {
    for (const c of LAUNCH_CITIES) {
      expect(homeCityOf(c)).toBe(c);
      expect(parseHome({ homeCity: c, neighborhood: "Central" })).toEqual({ homeCity: c, neighborhood: "Central" });
      const joined = parseJoin({
        firstName: "Ari",
        age: 28,
        homeCity: c,
        consent: { sms: true, version: APPS.friends.consent.version },
      });
      expect(joined?.homeCity).toBe(c);
    }
    expect(homeCityOf("Los Angeles")).toBe("la");
    expect(homeCityOf("Chicago")).toBe("chicago");
    expect(homeCityOf("Miami")).toBe("miami");
    expect(homeCityOf("Seattle")).toBeUndefined();
    expect(parseHome({ homeCity: "chicago", neighborhood: "Miami" })).toBeUndefined();

    const apps = defaultApps();
    const friendsDef = toolDefs(apps, "full", apps.friends, apps.friends).find(t => t.name === "prepare_signup")!;
    expect((friendsDef.inputSchema as any).properties.homeCity.enum).toEqual([...LAUNCH_CITIES]);
    for (const c of LAUNCH_CITIES) {
      const ok = checkArgs("prepare_signup", { firstName: "Ari", homeCity: c }, ["friends"], apps.friends);
      expect(ok).toEqual({ ok: true, app: "friends", draft: { firstName: "Ari", homeCity: c } });
    }
    const bad = checkArgs("prepare_signup", { firstName: "Ari", homeCity: "boston" }, ["friends"], apps.friends);
    expect(bad.ok).toBe(false);
  });

  test("YelpFusionProvider & GooglePlacesProvider never fire without keys and parse mock payloads cleanly", async () => {
    let calls = 0;
    const mockFetch = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;

    const yelpOff = new YelpFusionProvider({ apiKey: "", env: {}, fetchImpl: mockFetch });
    const gOff = new GooglePlacesProvider({ apiKey: "", env: {}, fetchImpl: mockFetch });
    expect(yelpOff.isConfigured()).toBe(false);
    expect(gOff.isConfigured()).toBe(false);
    expect(await yelpOff.searchVenues({ city: "chicago", lat: 41.88, lng: -87.63 })).toEqual([]);
    expect((await yelpOff.verifyVenueOpen(ALL_SEED_VENUES[0]!)).status).toBe("unknown");
    expect(await gOff.searchVenues({ city: "miami", lat: 25.77, lng: -80.19 })).toEqual([]);
    expect((await gOff.verifyVenueOpen(ALL_SEED_VENUES[0]!)).status).toBe("unknown");
    expect(calls).toBe(0);

    const nowMs = Date.UTC(2026, 10, 26, 16, 0, 0);
    let capturedFieldMask = "";
    const gFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      capturedFieldMask = headers.get("x-goog-fieldmask") ?? "";
      const u = String(url);
      if (u.includes("searchNearby")) {
        return new Response(JSON.stringify({
          places: [{
            id: "ChIJ-miami-test-1",
            displayName: { text: "Panther Coffee Wynwood" },
            formattedAddress: "2390 NW 2nd Ave, Miami, FL 33127",
            location: { latitude: 25.8001, longitude: -80.1991 },
            priceLevel: "PRICE_LEVEL_INEXPENSIVE",
            businessStatus: "OPERATIONAL",
            types: ["coffee_shop", "cafe"],
            rating: 4.6,
            servesVegetarianFood: true,
            accessibilityOptions: { wheelchairAccessibleEntrance: true },
            outdoorSeating: true,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        businessStatus: "CLOSED_TEMPORARILY",
        currentOpeningHours: { openNow: false },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const gOn = new GooglePlacesProvider({ apiKey: "test-g-key", fetchImpl: gFetch });
    const found = await gOn.searchVenues({ city: "miami", neighborhood: "Wynwood", lat: 25.8, lng: -80.199 }, nowMs);
    expect(found).toHaveLength(1);
    expect(found[0]!.source).toBe("google_places");
    expect(found[0]!.geoExpiresAt).toBe(nowMs + 30 * DAY);

    const check = await gOn.verifyVenueOpen(found[0]!, nowMs);
    expect(capturedFieldMask).toBe("businessStatus,currentOpeningHours");
    expect(check.status).toBe("closed_temporary");

    const yFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/businesses/search")) {
        return new Response(JSON.stringify({
          businesses: [{
            id: "yelp-chi-1",
            name: "Sawada Coffee",
            coordinates: { latitude: 41.8836, longitude: -87.6486 },
            location: { display_address: ["112 N Green St", "Chicago, IL 60607"] },
            rating: 4.5,
            review_count: 850,
            price: "$$",
            is_closed: false,
            categories: [{ alias: "coffee", title: "Coffee & Tea" }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "yelp-chi-1", is_closed: true, rating: 4.5, review_count: 850 }), { status: 200 });
    }) as unknown as typeof fetch;

    const yOn = new YelpFusionProvider({ apiKey: "test-y-key", fetchImpl: yFetch });
    const yFound = await yOn.searchVenues({ city: "chicago", neighborhood: "West Loop / Fulton Market", lat: 41.886, lng: -87.651 }, nowMs);
    expect(yFound).toHaveLength(1);
    expect(yFound[0]!.priceTier).toBe(2);
    expect((await yOn.verifyVenueOpen(yFound[0]!, nowMs)).status).toBe("closed_permanent");
  });
});

describe.skipIf(!pgAvailable)("5-city venues, sufficiency cutoff, open checks, feedback & RLS (Postgres)", () => {
  let sql: SQL;

  beforeAll(async () => {
    const url = await migratedDb("venues5c");
    urls.push(url);
    sql = new SQL({ url, max: 4 });
  }, T);

  afterAll(async () => {
    await sql?.close();
  });

  test("5 cities & 20 networks seeded; all curated venues seed cleanly and idempotently", async () => {
    const cities = (await sql`select id from platform.cities order by id`).map((r: any) => r.id);
    expect(cities).toEqual(["chicago", "la", "miami", "nyc", "sf"]);

    const networks = await sql`select id from platform.networks order by id`;
    expect(networks).toHaveLength(20);

    const expectedTotal = ALL_SEED_VENUES.length;
    expect(expectedTotal).toBeGreaterThanOrEqual(60);

    const first = await seedCuratedVenues(sql);
    expect(first.seeded).toBe(expectedTotal);
    const second = await seedCuratedVenues(sql);
    expect(second.seeded).toBe(expectedTotal);

    const all = await listVenues(sql);
    expect(all).toHaveLength(expectedTotal);
    for (const c of LAUNCH_CITIES) {
      const expectedPerCity = ALL_SEED_VENUES.filter(v => v.city === c).length;
      const perCity = await listVenues(sql, { city: c });
      expect(perCity).toHaveLength(expectedPerCity);
      expect(perCity.length).toBeGreaterThanOrEqual(12);
    }
  }, T);

  test("sufficiency cutoff: >= 10 local matches makes ZERO external calls; < 10 discovers, caches & grows local catalog", async () => {
    await seedCuratedVenues(sql);
    const nowMs = WED_14_SF;
    await sql`update platform.venues set verified_open_at = ${new Date(nowMs)} where city = 'sf'`;

    const extraLocal: VenueRecord[] = [1, 2, 3, 4, 5].map(i => ({
      ...ALL_SEED_VENUES.find(v => v.id === "sf-sightglass-soma")!,
      id: `sf-extra-local-${i}`,
      name: `Local SF Cafe ${i}`,
      neighborhood: "Hayes Valley",
      lastVerifiedAt: nowMs,
      hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 7 * 60, closeMin: 22 * 60 })),
    }));
    for (const v of extraLocal) await upsertVenue(sql, v);

    const discoveredChi: VenueRecord[] = [1, 2, 3].map(i => ({
      id: `sim-chi-budget-${i}`,
      name: `Budget Loop Coffee ${i}`,
      city: "chicago" as City,
      neighborhood: "The Loop",
      address: `${100 + i} S State St, Chicago, IL 60603`,
      lat: 41.8805,
      lng: -87.6278,
      category: "coffee_shop",
      public: true,
      status: "Active",
      priceTier: 1,
      ageMin: 0,
      isBarOnly: false,
      alcoholOptional: true,
      servesVegetarian: true,
      servesVegan: true,
      wheelchairAccessible: true,
      separateChecks: true,
      walkInGroupCapacity: 8,
      reservationRequired: false,
      noiseLevel: "Conversational",
      liveMusicAtNight: false,
      indoor: true,
      outdoor: false,
      weatherSensitive: false,
      arrivalLandmark: `By the front counter of Budget Loop Coffee ${i}`,
      hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 7 * 60, closeMin: 21 * 60 })),
      yelpRating: 4.7,
      externalPlaceId: `sim-ext-chi-${i}`,
      source: "google_places",
      lastVerifiedAt: WED_14_CHI,
      closureReports: 0,
      safetyScore: 9,
      transitScore: 5,
      personaPriors: { default: { alpha: 9, beta: 2 }, budget: { alpha: 10, beta: 1 } },
    }));

    const simProvider = new SimulatedVenueProvider({ discoveredByCity: { chicago: discoveredChi } });
    const composite = new CompositeVenueProvider({ pool: sql, providers: [simProvider], now: () => nowMs });

    const sfRequest: VenueRankRequest = {
      city: "sf",
      memberAreas: ["Hayes Valley", "Mission District"],
      members: [adultPrefs({ memberId: "u1" }), adultPrefs({ memberId: "u2" })],
      startMs: WED_14_SF,
      mode: "date",
    };
    const sfRes = await composite.findAndRankVenues(sfRequest, nowMs);
    expect(sfRes.localQualifiedBeforeFetch).toBeGreaterThanOrEqual(10);
    expect(sfRes.fetchedExternal).toBe(false);
    expect(sfRes.externalSearchCalls).toBe(0);
    expect(simProvider.searchCalls).toBe(0);

    const chiRequest: VenueRankRequest = {
      city: "chicago",
      memberAreas: ["The Loop", "West Loop / Fulton Market"],
      members: [
        adultPrefs({ memberId: "c1", maxBudgetTier: 1, archetype: "budget" }),
        adultPrefs({ memberId: "c2", maxBudgetTier: 1, archetype: "budget" }),
      ],
      startMs: WED_14_CHI,
      mode: "date",
    };
    const chiRes1 = await composite.findAndRankVenues(chiRequest, WED_14_CHI);
    expect(chiRes1.localQualifiedBeforeFetch).toBeLessThan(10);
    expect(chiRes1.fetchedExternal).toBe(true);
    expect(chiRes1.cacheHit).toBe(false);
    expect(chiRes1.externalSearchCalls).toBe(1);
    expect(chiRes1.discoveredCount).toBe(3);
    expect(simProvider.searchCalls).toBe(1);

    const persisted = await getVenue(sql, "sim-chi-budget-1");
    expect(persisted?.name).toBe("Budget Loop Coffee 1");
    expect(persisted?.geoExpiresAt).toBe(WED_14_CHI + 30 * DAY);

    const cacheRow = await getCachedSearch(sql, "venues:chicago:date:1:the loop,west loop / fulton market", WED_14_CHI + HOUR);
    expect(cacheRow?.resultCount).toBe(3);

    const chiRes2 = await composite.findAndRankVenues(chiRequest, WED_14_CHI + HOUR);
    expect(chiRes2.cacheHit).toBe(true);
    expect(chiRes2.externalSearchCalls).toBe(0);
    expect(simProvider.searchCalls).toBe(1);
  }, T);

  test("pre-recommendation open verification: stale closed venue is quarantined immediately and falls back to next open venue", async () => {
    await seedCuratedVenues(sql);
    const nowMs = SAT_15_SF;
    await sql`update platform.venues set verified_open_at = ${new Date(nowMs - 10 * HOUR)}, status = 'active', closure_reports = 0 where city = 'sf'`;

    const sfRequest: VenueRankRequest = {
      city: "sf",
      memberAreas: ["Hayes Valley", "SoMa / Yerba Buena"],
      members: [adultPrefs({ memberId: "d1" }), adultPrefs({ memberId: "d2" })],
      startMs: SAT_15_SF,
      mode: "date",
    };
    const beforeVenues = await listVenues(sql, { city: "sf", status: "Active" });
    const beforeRanked = rankVenuesForMatch(beforeVenues, sfRequest, nowMs);
    expect(beforeRanked.length).toBeGreaterThanOrEqual(2);
    const topId = beforeRanked[0]!.venue.id;
    const secondId = beforeRanked[1]!.venue.id;

    const simProvider = new SimulatedVenueProvider({
      closedStatuses: { [topId]: "closed_permanent" },
    });
    const composite = new CompositeVenueProvider({ pool: sql, providers: [simProvider], now: () => nowMs });

    const rec = await composite.pickVerifiedPrimaryAndBackup(sfRequest, { appId: "slop", nowMs });
    expect(rec.quarantinedIds).toContain(topId);
    expect(rec.primary?.venue.id).toBe(secondId);
    expect(rec.backup).toBeDefined();
    expect(rec.externalVerifyCalls).toBeGreaterThanOrEqual(2);

    const quarantined = await getVenue(sql, topId);
    expect(quarantined?.status).toBe("ClosedPermanent");

    simProvider.resetCounters();
    const rec2 = await composite.pickVerifiedPrimaryAndBackup(sfRequest, { appId: "slop", nowMs: nowMs + HOUR });
    expect(rec2.primary?.venue.id).toBe(secondId);
    expect(rec2.quarantinedIds).toEqual([]);
    expect(simProvider.verifyCalls).toBe(0);
  }, T);

  test("user closure feedback quarantines immediately (SuspectClosed -> ClosedPermanent) and persona taste learning persists", async () => {
    await seedCuratedVenues(sql);
    const nowMs = WED_14_CHI;
    const targetId = "chi-timeout-market";
    await sql`update platform.venues set status = 'active', closure_reports = 0, verified_open_at = ${new Date(nowMs)} where id = ${targetId}`;

    const after1 = await applyVenueFeedbackPg(
      sql,
      "friends",
      targetId,
      ["foodie"],
      { venueId: targetId, memberId: "m1", at: nowMs, outcome: "closed", reportedClosed: true },
      nowMs,
    );
    expect(after1?.status).toBe("SuspectClosed");
    expect(after1?.closureReports).toBe(1);
    expect(after1?.quarantinedUntil).toBe(nowMs + 7 * DAY);

    const activeChi = await listVenues(sql, { city: "chicago" });
    const rankedAfter1 = rankVenuesForMatch(activeChi, {
      city: "chicago",
      memberAreas: ["West Loop / Fulton Market"],
      members: [adultPrefs({ memberId: "m2" })],
      startMs: WED_14_CHI,
      mode: "date",
    }, nowMs);
    expect(rankedAfter1.some(c => c.venue.id === targetId)).toBe(false);

    const after2 = await applyVenueFeedbackPg(
      sql,
      "friends",
      targetId,
      ["foodie"],
      { venueId: targetId, memberId: "m2", at: nowMs + HOUR, outcome: "closed", reportedClosed: true },
      nowMs + HOUR,
    );
    expect(after2?.status).toBe("ClosedPermanent");
    expect(after2?.closureReports).toBe(2);

    const learnId = "chi-wormhole-coffee";
    const beforeLearn = (await getVenue(sql, learnId))!;
    const prevCreativeAlpha = beforeLearn.personaPriors.creative?.alpha ?? beforeLearn.personaPriors.default?.alpha ?? 4;
    const afterGreat = await applyVenueFeedbackPg(
      sql,
      "slop",
      learnId,
      ["creative"],
      { venueId: learnId, memberId: "m3", at: nowMs, outcome: "great", reportedClosed: false },
      nowMs,
    );
    expect(afterGreat?.personaPriors.creative?.alpha).toBe(prevCreativeAlpha + 2);
    const [statsRow] = await sql`select overall_likes, overall_dislikes, persona_stats from platform.venues where id = ${learnId}`;
    const personaStats = typeof statsRow.persona_stats === "string" ? JSON.parse(statsRow.persona_stats) : statsRow.persona_stats;
    expect(Number(statsRow.overall_likes)).toBeGreaterThanOrEqual(1);
    expect(personaStats.creative.alpha).toBe(prevCreativeAlpha + 2);
  }, T);

  test("hard exclusions: non-drinker bar exclusion, visited & rejected exclusion, and price ceiling ($ vs $$$$)", async () => {
    await seedCuratedVenues(sql);
    const nowMs = WED_14_SF;
    await sql`update platform.venues set status = 'active', closure_reports = 0, verified_open_at = ${new Date(nowMs)} where city = 'sf'`;

    const sfVenues = await listVenues(sql, { city: "sf", status: "Active" });

    const drinkerRanked = rankVenuesForMatch(sfVenues, {
      city: "sf",
      memberAreas: ["Mission District"],
      members: [adultPrefs({ memberId: "d1", drinksAlcohol: true }), adultPrefs({ memberId: "d2", drinksAlcohol: true })],
      startMs: fromLocal(2026, 11, 18, 17, "America/Los_Angeles"),
      mode: "date",
    }, nowMs);
    expect(drinkerRanked.some(c => c.venue.id === "sf-elixir-mission")).toBe(true);

    const nonDrinkerRanked = rankVenuesForMatch(sfVenues, {
      city: "sf",
      memberAreas: ["Mission District"],
      members: [adultPrefs({ memberId: "d1", drinksAlcohol: true }), adultPrefs({ memberId: "d2", drinksAlcohol: false })],
      startMs: fromLocal(2026, 11, 18, 17, "America/Los_Angeles"),
      mode: "date",
    }, nowMs);
    expect(nonDrinkerRanked.some(c => c.venue.id === "sf-elixir-mission")).toBe(false);

    await recordVenueVisit(sql, "slop", { memberId: "m-vis", venueId: "sf-ferry-building", visitedAt: nowMs - DAY, sentiment: "great" });
    await recordVenueRejection(sql, "slop", { memberId: "m-rej", venueId: "sf-sightglass-soma", reason: "too far", rejectedAt: nowMs - DAY });

    const visited = await listVisitedVenueIds(sql, "slop", ["m-vis", "m-rej"]);
    const rejected = await listRejectedVenueIds(sql, "slop", ["m-vis", "m-rej"]);
    expect(visited).toEqual(["sf-ferry-building"]);
    expect(rejected).toEqual(["sf-sightglass-soma"]);

    const historyFiltered = rankVenuesForMatch(sfVenues, {
      city: "sf",
      memberAreas: ["SoMa / Yerba Buena"],
      members: [
        adultPrefs({ memberId: "m-vis", visitedVenueIds: visited, rejectedVenueIds: [] }),
        adultPrefs({ memberId: "m-rej", visitedVenueIds: [], rejectedVenueIds: rejected }),
      ],
      startMs: WED_14_SF,
      mode: "date",
    }, nowMs);
    expect(historyFiltered.some(c => c.venue.id === "sf-ferry-building")).toBe(false);
    expect(historyFiltered.some(c => c.venue.id === "sf-sightglass-soma")).toBe(false);

    const eveningSf = fromLocal(2026, 11, 18, 18, "America/Los_Angeles");
    const budget1 = rankVenuesForMatch(sfVenues, {
      city: "sf",
      memberAreas: ["SoMa / Yerba Buena"],
      members: [adultPrefs({ memberId: "b1", maxBudgetTier: 1 }), adultPrefs({ memberId: "b2", maxBudgetTier: 4 })],
      startMs: eveningSf,
      mode: "date",
    }, nowMs);
    expect(budget1.every(c => c.venue.priceTier <= 1)).toBe(true);
    expect(budget1.some(c => c.venue.id === "sf-view-lounge")).toBe(false);

    const budget4 = rankVenuesForMatch(sfVenues, {
      city: "sf",
      memberAreas: ["SoMa / Yerba Buena"],
      members: [adultPrefs({ memberId: "b1", maxBudgetTier: 4 }), adultPrefs({ memberId: "b2", maxBudgetTier: 4 })],
      startMs: eveningSf,
      mode: "date",
    }, nowMs);
    expect(budget4.some(c => c.venue.id === "sf-view-lounge")).toBe(true);
  }, T);

  test("RLS isolation across slop, friends, and peon on venue_visits, venue_rejections, meetup_arrivals, and work_intros", async () => {
    await seedCuratedVenues(sql);
    const nowMs = WED_14_SF;

    await recordVenueVisit(sql, "slop", { id: "rls-visit-slop", memberId: "s1", venueId: "nyc-devocion-williamsburg", visitedAt: nowMs });
    await recordVenueVisit(sql, "friends", { id: "rls-visit-friends", memberId: "f1", venueId: "nyc-domino-park", visitedAt: nowMs });

    await recordVenueRejection(sql, "slop", { memberId: "s1", venueId: "nyc-veselka-ev", reason: "crowded", rejectedAt: nowMs });
    await recordVenueRejection(sql, "friends", { memberId: "f1", venueId: "nyc-eataly-flatiron", reason: "loud", rejectedAt: nowMs });

    await upsertMeetupArrival(sql, "slop", {
      id: "arr-slop-1", opportunityId: "opp-slop-1", memberId: "s1", state: "en_route", etaMins: 7, safeCue: "green jacket", updatedAt: nowMs,
    });
    await upsertMeetupArrival(sql, "friends", {
      id: "arr-friends-1", opportunityId: "opp-friends-1", memberId: "f1", state: "arrived", safeCue: "by the archway", backupVenueId: "nyc-conwell-coffee", updatedAt: nowMs,
    });

    await upsertWorkIntro(sql, "peon", {
      opportunityId: "opp-peon-1",
      channel: "warm_email",
      introSentAt: nowMs,
      followupDueAt: nowMs + 3 * DAY,
      stage: "introduced",
      updatedAt: nowMs,
    });
    await upsertWorkIntro(sql, "ntwrk", {
      opportunityId: "opp-ntwrk-1",
      channel: "ScheduledVideo",
      slotConfirmedAt: nowMs,
      meetUrl: "https://meet.example.com/abc",
      stage: "scheduled",
      updatedAt: nowMs,
    });

    expect((await listMeetupArrivals(sql, "friends", "opp-friends-1")).map(a => a.id)).toEqual(["arr-friends-1"]);
    expect(await listMeetupArrivals(sql, "slop", "opp-friends-1")).toEqual([]);
    expect((await getWorkIntro(sql, "peon", "opp-peon-1"))?.channel).toBe("warm_email");
    expect((await getWorkIntro(sql, "ntwrk", "opp-ntwrk-1"))?.channel).toBe("scheduled_video");
    expect(await getWorkIntro(sql, "slop", "opp-peon-1")).toBeUndefined();

    const asRole = (role: string, app: string | undefined, fn: (tx: SQL) => Promise<any>): Promise<any> =>
      sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        if (app) await tx`select set_config('app.app_id', ${app}, true)`;
        return fn(tx);
      });

    expect((await asRole("network_service", "slop", tx => tx`select id from network.venue_visits`)).map((r: any) => r.id)).toContain("rls-visit-slop");
    expect((await asRole("network_service", "slop", tx => tx`select id from network.venue_visits`)).map((r: any) => r.id)).not.toContain("rls-visit-friends");
    expect((await asRole("network_service", "friends", tx => tx`select venue_id from network.venue_rejections`)).map((r: any) => r.venue_id)).toEqual(["nyc-eataly-flatiron"]);
    expect((await asRole("network_service", "friends", tx => tx`select id from network.meetup_arrivals`)).map((r: any) => r.id)).toEqual(["arr-friends-1"]);
    expect((await asRole("network_service", "peon", tx => tx`select opportunity_id from network.work_intros`)).map((r: any) => r.opportunity_id)).toEqual(["opp-peon-1"]);
    expect((await asRole("network_service", "slop", tx => tx`select opportunity_id from network.work_intros`))).toEqual([]);

    const crossWriteErr = await asRole("network_service", "slop", tx =>
      tx`insert into network.work_intros (opportunity_id, app_id, channel) values ('opp-bad', 'peon', 'warm_email')`,
    ).then(() => "ok", e => String(e.message));
    expect(crossWriteErr).toContain("row-level security");

    expect((await asRole("network_observatory_peon", undefined, tx => tx`select opportunity_id from network.work_intros`)).map((r: any) => r.opportunity_id)).toEqual(["opp-peon-1"]);
    expect((await asRole("network_observatory_slop", undefined, tx => tx`select opportunity_id from network.work_intros`))).toEqual([]);
    expect((await asRole("network_observatory_friends", undefined, tx => tx`select id from network.meetup_arrivals`)).map((r: any) => r.id)).toEqual(["arr-friends-1"]);

    expect((await asRole("network_observatory_friends", undefined, tx => tx`select count(*)::int as n from platform.venues`))[0].n).toBeGreaterThanOrEqual(60);
    const cacheReadErr = await asRole("network_observatory_friends", undefined, tx => tx`select 1 from platform.venue_api_cache`).then(() => "ok", e => String(e.message));
    expect(cacheReadErr).toContain("permission denied");
  }, T);
});
