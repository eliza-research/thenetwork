import { describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  CITY_TZ,
  DAY,
  HOUR,
  LAUNCH_CITIES,
  MINUTE,
  computeFollowupTimestamp,
  evaluateFollowupSend,
  type City,
  type VenueRecord,
} from "@thenetwork/core";
import {
  friendsKit,
  plans,
  planFirstDate,
  SLOP_ENGINE_CONFIG,
  PEON_ENGINE_CONFIG,
  type SlopProfile,
} from "@thenetwork/engine";
import { extractSlopProfile } from "../../engine/src/packs/slop/extract.ts";
import { SIM_HOME_ZIPS, ZIPS } from "../../engine/src/packs/slop/zips.ts";
import {
  MeetupCoordinator,
  VenueManager,
  feedbackOf,
  meetingSpot,
  nearbyVenues,
  parseArrivalText,
  planVenuesForCity,
  sanitizeArrivalCue,
  whenPhrase,
  type ExternalVenueProvider,
  type MeetupCoordHost,
} from "../src/index.ts";
import { cofounderConsentMarker } from "../../core/src/generated/cofounderDispatch.ts";
import { cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { parsePosting, postingFacts, postingFromFacts } from "../src/jobs.ts";
import { localDateParts, tzForCity } from "../src/outreach.ts";
import { appWiring, slopVenue } from "../service/packs.ts";
import { CONVERSATION_CITIES } from "../service/service.ts";
import { Mini, START } from "./mini.ts";

describe("five-city engine and network support", () => {
  test("all five launch cities are wired across service, packs, timezones, and zips", () => {
    expect([...CONVERSATION_CITIES]).toEqual([...LAUNCH_CITIES]);
    expect(SLOP_ENGINE_CONFIG.cities).toEqual([...LAUNCH_CITIES]);
    expect(PEON_ENGINE_CONFIG.cities).toEqual([...LAUNCH_CITIES]);
    expect(SIM_HOME_ZIPS.slice(0, 5)).toEqual(["94102", "94103", "94107", "94109", "94110"]);
    expect(ZIPS.find(z => z.zip === "60607")?.market).toBe("chicago");
    expect(ZIPS.find(z => z.zip === "33131")?.market).toBe("miami");

    for (const city of LAUNCH_CITIES) {
      expect(tzForCity(city)).toBe(CITY_TZ[city]);
      const wiring = appWiring("slop", city);
      expect(wiring.pack?.id).toBe("slop");
      expect(planVenuesForCity(city).length).toBeGreaterThan(0);
      expect(friendsKit.cityNeighborhoods(city).length).toBeGreaterThan(0);
      expect(friendsKit.cityVenues(city, plans.ACTIVITIES).length).toBeGreaterThan(0);
    }
  });

  test("Chicago and Miami slop extraction, non-drinker date planning, and venues", () => {
    const chi = extractSlopProfile(["I live in West Loop, zip 60607, I don't drink, looking for women."]);
    expect(chi.location?.value.zip).toBe("60607");
    expect(chi.values?.drinking?.value).toBe("never");

    const mia = extractSlopProfile(["I'm in Brickell 33131, Miami, into coffee and running."]);
    expect(mia.location?.value.zip).toBe("33131");

    const emptyHist = {
      yes: 0, no: 0, silent: 0, dates: 0, noShows: 0, backouts: 0, negativeFrom: 0, contextualBlocks: 0,
      attendedSlots: [], rated: [], ratedSelf: [], ratedBody: [],
    };
    const nonDrinkerA: SlopProfile = {
      id: "a",
      age: 29,
      adult: true,
      optedIn: true,
      paused: false,
      zip: "60607",
      homeMarket: "chicago",
      cell: { id: "60607", lat: 41.885, lon: -87.647 },
      zipUnknown: false,
      is: "woman",
      seeks: ["man"],
      shownTo: ["man"],
      ageRange: [25, 36],
      maxMiles: 10,
      goal: "long_term",
      values: { drinking: "never", smoking: "never" },
      dealbreakers: [],
      interests: ["coffee", "food"],
      shareableInterests: ["coffee"],
      activities: ["coffee", "drinks"],
      free: ["thu_eve", "sat_day"],
      wantsBody: [],
      safety: [],
      verification: ["liveness"],
      silentAsks: [],
      openAsks: [],
      askCounts: {},
      visiting: [],
      interestFacet: new Map(),
      history: emptyHist,
    };
    const drinkerB: SlopProfile = {
      ...nonDrinkerA,
      id: "b",
      is: "man",
      seeks: ["woman"],
      shownTo: ["woman"],
      values: { drinking: "often", smoking: "never" },
    };
    const datePlan = planFirstDate(nonDrinkerA, drinkerB, ["chicago"]);
    expect(datePlan).not.toBeNull();
    expect(datePlan!.activity).not.toBe("drinks");
    expect(datePlan!.venue).not.toContain("bar");

    const vChi = slopVenue([{ lat: 41.885, lon: -87.647 }], "drinks", Date.UTC(2026, 9, 8, 23), "chicago", { nonDrinker: true });
    expect(vChi).toBeDefined();
    expect(vChi?.timeZone).toBe(CITY_TZ.chicago);
    const vRec = ALL_SEED_VENUES.find(v => v.id === vChi?.id);
    expect(vRec?.isBarOnly).toBe(false);
    expect(vRec?.alcoholOptional).toBe(true);
  });

  test("peon postings preserve city across all five markets", () => {
    const parsed = parsePosting("We're hiring a product designer, level 2, 2 openings, $110k-$140k, hybrid in West Loop, Chicago. Must have Figma level 2");
    expect(parsed.city).toBe("chicago");
    const facts = postingFacts({
      id: "p-chi-1",
      managerId: "hm1",
      title: "product designer",
      family: "designer",
      seniority: 2,
      openings: 2,
      payMin: 110,
      payMax: 140,
      mode: "hybrid",
      city: "chicago",
      area: "West Loop",
      must: [{ skill: "figma", level: 2 }],
      nice: [],
      sponsors: false,
      status: "active",
      createdAt: START,
      updatedAt: START,
    });
    const restored = postingFromFacts(facts.intent, facts.facets);
    expect(restored.city).toBe("chicago");
  });

  test("whenPhrase and localDateParts honor the member city timezone", () => {
    // 2026-10-08 23:30 UTC is 19:30 EDT (NYC) and 16:30 PDT (LA) and 18:30 CDT (Chicago)
    const ts = Date.UTC(2026, 9, 8, 23, 30);
    expect(localDateParts(ts, CITY_TZ.nyc).hour).toBe(19.5);
    expect(localDateParts(ts, CITY_TZ.chicago).hour).toBe(18.5);
    expect(localDateParts(ts, CITY_TZ.la).hour).toBe(16.5);
    expect(whenPhrase(ts, CITY_TZ.la)).toMatch(/4:30\s*pm/i);
    expect(whenPhrase(ts, CITY_TZ.nyc)).toMatch(/7:30\s*pm/i);
  });

  test("mounted Chicago network uses Chicago venues and city metadata", async () => {
    const w = new Mini([], { city: "chicago", engine: { cities: ["chicago"] } });
    for (const [id, name, area] of [["c1", "Maya Lin", "West Loop"], ["c2", "Owen Park", "River North"]] as const) {
      w.members.push({
        id,
        name,
        homeCity: "chicago",
        state: "normal",
        joinedAt: w.clock.now(),
        age: 29,
        unansweredProactive: 0,
        prefs: {
          categoriesOptIn: ["social", "hobby", "events"],
          quietHours: [22, 8],
          romanceOptIn: false,
          formats: ["one_to_one", "small_group", "event"],
          maxTravelMinutes: 45,
          onlyWhenAsked: false,
        },
      });
      w.presence.push({ memberId: id, city: "chicago", type: "home", areas: [area] });
    }
    await w.onboard("c1", "c2");
    expect(w.net.inCity("c1", w.clock.now(), w.clock.now() + DAY, "chicago")).toBe(true);
    const spot = meetingSpot(["West Loop", "River North"], "social", ["coffee"], false, "chicago");
    expect(ALL_SEED_VENUES.some(v => v.id === spot.venue.id && v.city === "chicago")).toBe(true);
    const near = nearbyVenues("West Loop", ["coffee"], 2, new Set(), "chicago", true);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every(v => v.allAges)).toBe(true);
  });
});

describe("VenueManager intelligence", () => {
  const mPrefs = (
    memberId: string,
    opts: { age?: number; drinksAlcohol?: boolean; maxBudgetTier?: 1 | 2 | 3 | 4; visitedVenueIds?: string[]; rejectedVenueIds?: string[] } = {},
  ) => ({
    memberId,
    age: opts.age ?? 29,
    drinksAlcohol: opts.drinksAlcohol ?? true,
    vegetarian: false,
    vegan: false,
    wheelchairNeeded: false,
    maxBudgetTier: opts.maxBudgetTier ?? (4 as const),
    visitedVenueIds: opts.visitedVenueIds ?? [],
    rejectedVenueIds: opts.rejectedVenueIds ?? [],
  });

  test("seeds all 5 cities, enforces history/non-drinker/budget/teen rules, and persists state", () => {
    const vm = new VenueManager();
    for (const city of LAUNCH_CITIES) {
      expect(vm.listVenues(city).length).toBeGreaterThanOrEqual(15);
    }

    // 2026-10-08 12:00 local daytime slot (19:00 UTC = 12:00 PDT / 14:00 CDT / 15:00 EDT)
    const daytimeMs = Date.UTC(2026, 9, 8, 19, 0);

    // Never pick a bar for a non-drinker
    const nd = vm.pickForMatch({
      city: "sf",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["Mission", "Hayes Valley"],
      members: [mPrefs("m1", { drinksAlcohol: false }), mPrefs("m2", { drinksAlcohol: true })],
    }, START);
    expect(nd.primary).toBeDefined();
    expect(nd.primary?.venue.isBarOnly).toBe(false);
    expect(nd.primary?.venue.alcoholOptional).toBe(true);
    expect(nd.backup?.venue.id).not.toBe(nd.primary?.venue.id);

    // Respect lowest budget tier in the group
    const budget = vm.pickForMatch({
      city: "la",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["Silver Lake", "Echo Park"],
      members: [mPrefs("m1", { maxBudgetTier: 1 }), mPrefs("m2", { maxBudgetTier: 4 })],
    }, START);
    expect(budget.primary).toBeDefined();
    expect(budget.primary!.venue.priceTier).toBeLessThanOrEqual(1);

    // Teen friend plans use all-ages public venues only
    const teen = vm.pickForMatch({
      city: "miami",
      mode: "group",
      startMs: daytimeMs,
      memberAreas: ["Brickell", "Wynwood"],
      members: [mPrefs("t1", { age: 16, drinksAlcohol: false }), mPrefs("t2", { age: 17, drinksAlcohol: false })],
      teenFriendAllowed: true,
    }, START);
    expect(teen.primary).toBeDefined();
    expect(teen.primary!.venue.ageMin).toBe(0);
    expect(teen.primary!.venue.public).toBe(true);
    expect(teen.primary!.venue.isBarOnly).toBe(false);

    // Never pick visited or rejected venues
    const firstId = nd.primary!.venue.id;
    vm.recordVisit("m1", firstId);
    const second = vm.pickForMatch({
      city: "sf",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["Mission", "Hayes Valley"],
      members: [mPrefs("m1", { drinksAlcohol: false }), mPrefs("m2", { drinksAlcohol: true })],
    }, START);
    expect(second.primary?.venue.id).not.toBe(firstId);

    const secondId = second.primary!.venue.id;
    vm.recordRejection("m2", secondId);
    const third = vm.pickForMatch({
      city: "sf",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["Mission", "Hayes Valley"],
      members: [mPrefs("m1", { drinksAlcohol: false }), mPrefs("m2", { drinksAlcohol: true })],
    }, START);
    expect(third.primary?.venue.id).not.toBe(firstId);
    expect(third.primary?.venue.id).not.toBe(secondId);

    // Immediate quarantine on closure report + persistence across export/import
    const targetId = third.primary!.venue.id;
    vm.quarantineVenue(targetId, "m1", START);
    expect(vm.getVenue(targetId)?.status).toBe("suspect_closed");
    const afterQuarantine = vm.pickForMatch({
      city: "sf",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["Mission", "Hayes Valley"],
      members: [mPrefs("m1", { drinksAlcohol: false }), mPrefs("m2", { drinksAlcohol: true })],
    }, START);
    expect(afterQuarantine.primary?.venue.id).not.toBe(targetId);

    // Organic mention grows the catalog
    const added = vm.recordOrganicMention("sf", "Tartine Manufactory", "Mission", START);
    expect(added.source).toBe("listing");
    expect(vm.getVenue(added.id)?.name).toBe("Tartine Manufactory");

    const restored = new VenueManager();
    restored.importState(vm.exportState());
    expect(restored.getVenue(targetId)?.status).toBe("suspect_closed");
    expect(restored.getVenue(added.id)?.name).toBe("Tartine Manufactory");
    expect(restored.excludedIdsFor(["m1", "m2"]).has(firstId)).toBe(true);
    expect(restored.excludedIdsFor(["m1", "m2"]).has(secondId)).toBe(true);
  });

  test("obeys shouldFetchExternalVenues cutoff and pre-recommendation open check", async () => {
    let discoverCalls = 0;
    let statusCalls = 0;
    const daytimeMs = Date.UTC(2026, 9, 8, 19, 0);
    const provider: ExternalVenueProvider = {
      async search(city, area) {
        discoverCalls++;
        const template = ALL_SEED_VENUES.find(v => v.city === city && !v.isBarOnly)!;
        const synthetic: VenueRecord = {
          ...template,
          id: `ext-${city}-1`,
          name: "External Garden Cafe",
          neighborhood: area || template.neighborhood,
          source: "google_places",
          lastVerifiedAt: START,
        };
        return [synthetic];
      },
      async checkOpen(venue) {
        statusCalls++;
        return venue.id.endsWith("cafe") ? "ProviderPermanentClosed" : "ProviderOpen";
      },
    };

    const vm = new VenueManager({ provider });
    // >= 10 local venues qualify in NYC -> ZERO external search calls
    const plenty = await vm.pickForMatchAsync({
      city: "nyc",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["East Village", "SoHo"],
      members: [mPrefs("u1"), mPrefs("u2")],
    }, START + 10 * DAY);
    expect(discoverCalls).toBe(0);
    expect(statusCalls).toBeGreaterThan(0);
    expect(plenty.primary).toBeDefined();

    // Mark most local venues visited so < 10 qualify -> external search IS called
    const allNyc = vm.listVenues("nyc").map(v => v.id);
    const excludeMost = allNyc.slice(0, allNyc.length - 3);
    const scarce = await vm.pickForMatchAsync({
      city: "nyc",
      mode: "date",
      startMs: daytimeMs,
      memberAreas: ["East Village", "SoHo"],
      members: [mPrefs("u1", { visitedVenueIds: excludeMost }), mPrefs("u2")],
    }, START + 10 * DAY);
    expect(discoverCalls).toBe(1);
    expect(scarce.primary).toBeDefined();
  });
});

describe("feedback extraction and follow-up scheduling", () => {
  test("feedbackOf extracts venue issues, closure, sentiment, organic mention, and notInterested", () => {
    const closed = feedbackOf("We showed up and the place was permanently closed, so we went to Sightglass Coffee instead.");
    expect(closed.venue?.venueClosed).toBe(true);
    expect(closed.venue?.mentionedVenue).toBe("Sightglass Coffee");

    const loud = feedbackOf("Great person, though the spot was way too loud and way too expensive. Not interested in going back.");
    expect(loud.venue?.venueIssues).toContain("too_loud");
    expect(loud.venue?.venueIssues).toContain("too_expensive");
    expect(loud.notInterested).toBe(true);

    const goodSpot = feedbackOf("Awesome hangout! Loved the venue and great vibe.");
    expect(goodSpot.venue?.venueSentiment).toBe("liked");
  });

  test("computeFollowupTimestamp defers evening events to next morning and evaluateFollowupSend enforces caps", () => {
    // 2026-10-08 15:00 NYC (19:00 UTC) -> same-day +2h = 17:00 NYC
    const dayEnd = Date.UTC(2026, 9, 8, 19, 0);
    const daySched = computeFollowupTimestamp(dayEnd, CITY_TZ.nyc);
    expect(daySched.nextDay).toBe(false);
    expect(daySched.localHour).toBe(17);

    // 2026-10-08 20:00 Chicago (01:00 UTC next day) -> defers to next morning 09:00 Chicago
    const eveEnd = Date.UTC(2026, 9, 9, 1, 0);
    const eveSched = computeFollowupTimestamp(eveEnd, CITY_TZ.chicago);
    expect(eveSched.nextDay).toBe(true);
    expect(eveSched.localHour).toBe(9);

    expect(evaluateFollowupSend({ optedOut: false, isQuietHours: false, dailyProactiveCount: 2, remindersSent: 0 })).toBe(true);
    expect(evaluateFollowupSend({ optedOut: false, isQuietHours: false, dailyProactiveCount: 3, remindersSent: 0 })).toBe(false);
    expect(evaluateFollowupSend({ optedOut: false, isQuietHours: true, dailyProactiveCount: 0, remindersSent: 0 })).toBe(false);
  });
});

describe("MeetupCoordinator on-site arrival and safety", () => {
  function makeHost(parties: Record<string, { firstName: string; lastName?: string; age?: number; optedOut?: boolean }>) {
    const vm = new VenueManager();
    const sent: { to: string; body: string; kind: string }[] = [];
    const host: MeetupCoordHost = {
      venues: vm,
      ratesPhotos: false,
      party: (_meetupId, id) => {
        const p = parties[id];
        return p ? { id, firstName: p.firstName, lastName: p.lastName, age: p.age, optedOut: !!p.optedOut, confirmed: true } : undefined;
      },
      blocked: () => false,
      privateFacts: () => ({ forbidden: [{ text: "SECRET_CANARY", owner: "a" }], canaries: ["SECRET_CANARY"] }),
      send: (to, body, opts) => {
        sent.push({ to, body, kind: opts.kind });
      },
    };
    return { vm, sent, coord: new MeetupCoordinator(host) };
  }

  test("strips PII and last names while keeping safe outfit and landmark cues", () => {
    const cleaned = sanitizeArrivalCue(
      "I'm at the back patio wearing a red jacket, call me at 415-555-0199 or maya@example.com — Maya Chen",
      ["Chen"],
    );
    expect(cleaned).not.toContain("415-555-0199");
    expect(cleaned).not.toContain("maya@example.com");
    expect(cleaned).not.toContain("Chen");

    const parsed = parseArrivalText("I'm here in a blue jacket near the corner table, text 212-555-0199", ["Smith"]);
    expect(parsed?.state).toBe("arrived");
    expect(parsed?.safeOutfitCue).toBe("blue jacket");
    expect(parsed?.spotLandmark).toContain("corner table");
  });

  test("sends T-75m brief, relays 1-on-1 immediately, pivots on closure, runs no-show guard, and blocks minor relays", () => {
    const startMs = START + 2 * HOUR;
    const sfVenues = ALL_SEED_VENUES.filter(v => v.city === "sf");
    const primary = sfVenues[0]!;
    const backup = sfVenues[1]!;

    const { vm, sent, coord } = makeHost({
      a: { firstName: "Ana", lastName: "Diaz", age: 29 },
      b: { firstName: "Ben", lastName: "Ito", age: 31 },
    });
    coord.registerMeetup({
      meetupId: "m-1",
      app: "ntwrk",
      city: "sf",
      startMs,
      participants: ["a", "b"],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
    });

    // T-75m pre-brief
    const briefTick = coord.tick(startMs - 75 * MINUTE);
    expect(briefTick.preBriefs).toEqual(["m-1"]);
    const briefs = sent.filter(s => s.kind === "pre_brief");
    expect(briefs).toHaveLength(2);
    expect(briefs[0]!.body).toContain(primary.name);
    expect(briefs[0]!.body).toContain(backup.name);

    // 1-on-1 immediate arrival relay (strips phone & last name)
    const arr = coord.handleInbound("a", "I'm here wearing a green coat at the front patio! Call 415-555-0199 Ana Diaz", startMs - 5 * MINUTE);
    expect(arr.handled).toBe(true);
    expect(arr.relayedTo).toEqual(["b"]);
    const relayMsg = sent.find(s => s.kind === "arrival_relay" && s.to === "b");
    expect(relayMsg?.body).toContain("green coat");
    expect(relayMsg?.body).not.toContain("415-555-0199");
    expect(relayMsg?.body).not.toContain("Diaz");

    // Canary or RELAY_RULES violation in rawBody is blocked even with arrival cues
    const canaryBlocked = coord.handleInbound("a", "I'm here by the front patio, btw SECRET_CANARY", startMs - 4 * MINUTE);
    expect(canaryBlocked.relayedTo).toEqual([]);
    const scamBlocked = coord.handleInbound("a", "I'm here, please venmo me $50 right now", startMs - 3 * MINUTE);
    expect(scamBlocked.relayedTo).toEqual([]);

    // No-show guard: T+12m ping late member, T+18m notify waiting member
    const t12 = coord.tick(startMs + 13 * MINUTE);
    expect(t12.noShowPings).toEqual(["m-1"]);
    expect(sent.some(s => s.kind === "no_show_ping" && s.to === "b")).toBe(true);

    const t18 = coord.tick(startMs + 19 * MINUTE);
    expect(t18.waitingNotices).toEqual(["m-1"]);
    expect(sent.some(s => s.kind === "waiting_notice" && s.to === "a")).toBe(true);

    // Surprise closure quarantines primary and pivots to backup
    const closeRes = coord.handleInbound("a", "The cafe is closed today!", startMs + 20 * MINUTE);
    expect(closeRes.pivotedToVenueId).toBe(backup.id);
    expect(vm.getVenue(primary.id)?.status).toBe("suspect_closed");
    expect(sent.filter(s => s.kind === "backup_pivot").length).toBe(2);

    // Met closes the window immediately
    const metRes = coord.handleInbound("b", "Found each other, we met up!", startMs + 25 * MINUTE);
    expect(metRes.handled).toBe(true);
    expect(coord.getMeetup("m-1")?.met).toBe(true);
    expect(coord.getMeetup("m-1")?.closed).toBe(true);

    // T+45m window expiration closes an unmet meetup on tick
    coord.registerMeetup({
      meetupId: "m-timeout",
      app: "ntwrk",
      city: "sf",
      startMs,
      participants: ["a", "b"],
      primaryVenueId: primary.id,
    });
    const closedTick = coord.tick(startMs + 46 * MINUTE);
    expect(closedTick.closed).toEqual(["m-timeout"]);

    // Minor meetup: zero briefs and zero arrival relays
    const minorHost = makeHost({
      t1: { firstName: "Sam", age: 16 },
      t2: { firstName: "Alex", age: 17 },
    });
    minorHost.coord.registerMeetup({
      meetupId: "m-teen",
      app: "friends",
      city: "nyc",
      startMs,
      participants: ["t1", "t2"],
      primaryVenueId: ALL_SEED_VENUES[0]!.id,
    });
    minorHost.coord.tick(startMs - 75 * MINUTE);
    minorHost.coord.handleInbound("t1", "I'm here wearing a red jacket", startMs - 5 * MINUTE);
    expect(minorHost.sent).toHaveLength(0);
  });

  test("groups of 3-6 send a debounced digest instead of immediate per-message spam", () => {
    const startMs = START + 2 * HOUR;
    const { sent, coord } = makeHost({
      a: { firstName: "Ana", age: 29 },
      b: { firstName: "Ben", age: 31 },
      c: { firstName: "Cara", age: 28 },
    });
    coord.registerMeetup({
      meetupId: "g-1",
      app: "friends",
      city: "nyc",
      startMs,
      participants: ["a", "b", "c"],
      primaryVenueId: ALL_SEED_VENUES[0]!.id,
    });
    const r1 = coord.handleInbound("a", "I'm here at the front patio", startMs - 10 * MINUTE);
    expect(r1.handled).toBe(true);
    expect(r1.relayedTo).toEqual([]);
    expect(sent.filter(s => s.kind === "arrival_relay")).toHaveLength(0);

    coord.handleInbound("b", "On my way, 10 min out", startMs - 9 * MINUTE);
    const flushed = coord.tick(startMs - 7 * MINUTE);
    expect(flushed.digestsFlushed).toEqual(["g-1"]);
    const relays = sent.filter(s => s.kind === "arrival_relay");
    expect(relays.length).toBeGreaterThanOrEqual(2);
    expect(relays.find(s => s.to === "c")?.body).toContain("Ana");
    expect(relays.find(s => s.to === "c")?.body).toContain("Ben");
  });

  test("ConsentNetwork delivers pre_brief and backup_pivot containing curated public venue street addresses without guard_blocked", async () => {
    const w = new Mini([], { city: "sf", engine: { cities: ["sf"] }, arrivalBriefs: true });
    for (const [id, name, area] of [["s1", "Ana Diaz", "Mission"], ["s2", "Ben Ito", "Hayes Valley"]] as const) {
      w.members.push({
        id,
        name,
        homeCity: "sf",
        state: "normal",
        joinedAt: w.clock.now(),
        age: 30,
        unansweredProactive: 0,
        prefs: {
          categoriesOptIn: ["social", "hobby"],
          quietHours: [23, 7],
          romanceOptIn: false,
          formats: ["one_to_one"],
          maxTravelMinutes: 45,
          onlyWhenAsked: false,
        },
      });
      w.presence.push({ memberId: id, city: "sf", type: "home", areas: [area] });
    }
    await w.onboard("s1", "s2");

    const oppId = w.propose(["s1", "s2"], { category: "social", objective: "Coffee hangout" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["s1", "s2"]);
    const opp = w.net.opps.get(oppId)!;
    expect(opp.stage).toBe("scheduled");
    expect(opp.meetingAt).toBeDefined();
    expect(opp.backupVenueId).toBeDefined();

    // Advance into T-75m PreBrief window -> pre_brief delivered with venue street address and 0 guard_blocked
    const preBriefAt = opp.meetingAt! - 70 * MINUTE;
    w.clock.set(preBriefAt);
    await w.net.tick(w.clock.now());
    const briefs = w.sent.filter(s => s.meta.proposalId === oppId && s.meta.type === "reminder" && /Heads up for/i.test(s.body));
    expect(briefs).toHaveLength(2);
    expect(w.log("guard_blocked")).toHaveLength(0);

    // Surprise closure in ActiveArrival -> backup_pivot delivered to both with backup venue street address and 0 guard_blocked
    w.clock.set(opp.meetingAt! - 15 * MINUTE);
    await w.say("s2", "On my way!");
    w.clock.set(opp.meetingAt! - 10 * MINUTE);
    await w.say("s1", "The cafe is closed today!");
    const pivots = w.sent.filter(s => s.meta.proposalId === oppId && s.meta.type === "info" && /Quick pivot:/i.test(s.body));
    expect(pivots).toHaveLength(2);
    expect(w.log("guard_blocked")).toHaveLength(0);
  });
});

describe("peon work-intro regression (no physical venues or meetings)", () => {
  test("Cofounder and peon professional intros never pick a venue, pick WarmEmail/RelayShare/Video channels, and run T+72h bounce + T+7d outcome check-ins", async () => {
    const emails: Record<string, string> = { a: "ana@example.com", b: "ben@example.com" };
    const w = new Mini(
      [
        { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["startups", "ai"], skills: ["typescript"], quietHours: [23, 7] },
        { id: "b", name: "Ben Ito", age: 33, area: "SoHo", interests: ["startups", "ai"], skills: ["product"], quietHours: [23, 7] },
      ],
      {
        app: "peon",
        workIntroEmailOf: id => emails[id],
      },
    );
    await w.onboard("a", "b");
    w.intents.push(
      { id: "cf-a", memberId: "a", app: "peon", objective: cofounderIntentObjective, category: "professional", details: cofounderConsentMarker, horizonDays: 60, status: "active", createdAt: w.clock.now() },
      { id: "cf-b", memberId: "b", app: "peon", objective: cofounderIntentObjective, category: "professional", details: cofounderConsentMarker, horizonDays: 60, status: "active", createdAt: w.clock.now() },
    );

    const oppId = w.propose(["a", "b"], { category: "professional", objective: "Cofounder intro" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    const opp = w.net.opps.get(oppId)!;
    opp.lane = "Cofounder";
    opp.cofounderIntents = { a: "cf-a", b: "cf-b" };
    await w.answerProbes(["a", "b"]);

    expect(opp.stage).toBe("scheduled");
    // Core regression assertions: NEVER a physical venue or "venue" log event!
    expect(opp.venue).toBeUndefined();
    expect(opp.venueId).toBeUndefined();
    expect(opp.venueArea).toBeUndefined();
    expect(w.log("venue")).toHaveLength(0);
    expect(opp.workIntro?.channel).toBe("WarmEmail");
    expect(w.log("work_intro")).toHaveLength(1);

    const reveals = w.sent.filter(s => s.meta.type === "proposal" && s.meta.proposalId === oppId);
    expect(reveals).toHaveLength(2);
    for (const r of reveals) {
      expect(r.body).toMatch(/email intro/i);
      expect(r.body).not.toMatch(/\b(bar|cafe|coffee shop|park|you're both set)\b/i);
    }

    // T+72h bounce check
    await w.run(73 * HOUR);
    expect(opp.workBounceSent).toBe(true);
    expect(w.log("work_intro_bounce_check")).toHaveLength(1);
    const bounces = w.sent.filter(s => s.meta.proposalId === oppId && /come through|connect|intro/i.test(s.body) && s.meta.type === "info");
    expect(bounces.length).toBeGreaterThanOrEqual(2);
    await w.say("a", "Yes, got the email!");
    await w.say("b", "Yes, connected over email!");

    // T+7d outcome check-in
    await w.run(4 * DAY + 2 * HOUR);
    expect(opp.stage).toBe("done");
    expect(w.log("work_intro_outcome_checkin")).toHaveLength(1);
    const checkins = w.sent.filter(s => s.meta.proposalId === oppId && s.meta.type === "feedback_request");
    expect(checkins).toHaveLength(2);
  });

  test("peon work intro without emails falls back to RelayShare (never a venue) and ScheduledVideo requires mutual slot", async () => {
    const w = new Mini(
      [
        { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["startups"], quietHours: [23, 7] },
        { id: "b", name: "Ben Ito", age: 33, area: "SoHo", interests: ["startups"], quietHours: [23, 7] },
      ],
      { app: "peon" },
    );
    await w.onboard("a", "b");

    const oppId = w.propose(["a", "b"], { category: "professional", objective: "Engineering role intro" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    const opp = w.net.opps.get(oppId)!;
    await w.answerProbes(["a", "b"]);

    expect(opp.stage).toBe("scheduled");
    expect(opp.venue).toBeUndefined();
    expect(opp.venueId).toBeUndefined();
    expect(w.log("venue")).toHaveLength(0);
    expect(opp.workIntro?.channel).toBe("RelayShare");

    // ScheduledVideo requires mutual slot confirmation (still zero physical venue)
    const wVid = new Mini(
      [
        { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["startups", "video"], quietHours: [23, 7] },
        { id: "b", name: "Ben Ito", age: 33, area: "SoHo", interests: ["startups", "video"], quietHours: [23, 7] },
      ],
      { app: "peon" },
    );
    await wVid.onboard("a", "b");
    const vidOppId = wVid.propose(["a", "b"], { category: "professional", objective: "Video intro" });
    await wVid.runUntil(() => wVid.net.opps.has(vidOppId), 2 * DAY);
    const vidOpp = wVid.net.opps.get(vidOppId)!;
    await wVid.answerProbes(["a", "b"], () => "a works");
    expect(vidOpp.stage).toBe("scheduled");
    expect(vidOpp.venue).toBeUndefined();
    expect(vidOpp.venueId).toBeUndefined();
    expect(wVid.log("venue")).toHaveLength(0);
    expect(vidOpp.workIntro?.channel).toBe("ScheduledVideo");
    expect(vidOpp.workIntro?.videoSlotAt).toBeDefined();
  });
});
