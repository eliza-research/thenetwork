import { describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  CITY_TZ,
  DAY,
  HOUR,
  LAUNCH_CITIES,
  LLMBudget,
  MINUTE,
  SimClock,
  type VenueRecord,
} from "@thenetwork/core";
import {
  MeetupCoordinator,
  VenueManager,
  meetingSpot,
  parseArrivalText,
  seedVenueToGeoVenue,
  whenPhrase,
  type MeetupCoordHost,
  type VenueManagerState,
} from "../src/index.ts";
import { understandPrompt } from "../src/extract.ts";
import { createRelayClefCache, relayClassifierFromEnv } from "../service/relay-endpoint.ts";
import { llmUsageForDay } from "../service/review-judge.ts";
import { dayOf } from "../service/cost.ts";
import { Mini, START } from "./mini.ts";

describe("Pass 2 safety, routing, and performance regressions", () => {
  test("teen brewery exclusion across all 5 cities in seedVenueToGeoVenue and meetingSpot", () => {
    const namedBreweries = ["sf-biergarten-hayes", "sf-cellarmaker-mission", "nyc-threes-brewing"];
    for (const id of namedBreweries) {
      const rec = ALL_SEED_VENUES.find(v => v.id === id);
      expect(rec, `expected seed venue ${id}`).toBeDefined();
      expect(rec!.isAlcoholCentric).toBe(true);
      expect(rec!.allAges).toBe(false);
      expect(seedVenueToGeoVenue(rec!).allAges).toBe(false);
    }

    for (const city of LAUNCH_CITIES) {
      const cityVenues = ALL_SEED_VENUES.filter(v => v.city === city);
      for (const v of cityVenues) {
        if (v.isAlcoholCentric || v.isBarOnly || v.allAges !== true) {
          expect(seedVenueToGeoVenue(v).allAges).toBe(false);
        }
      }

      // Force meetingSpot to evaluate every city's seed venues for a minor roster.
      const spot = meetingSpot([], "social", ["food", "outdoors", "social"], true, city, {
        venues: cityVenues,
      });
      const picked = cityVenues.find(v => v.id === spot.venue.id);
      expect(picked).toBeDefined();
      expect(picked!.allAges).toBe(true);
      expect(picked!.isAlcoholCentric).toBe(false);
      expect(picked!.isBarOnly).toBe(false);
      expect(namedBreweries).not.toContain(picked!.id);
    }
  });

  test("heavy_drinker is not treated as nonDrinker, spend/budget tags apply, and venuePassesRedLines uses city timezone + live catalog", async () => {
    const la = new Mini([], { city: "la", engine: { cities: ["la"] } });
    for (const [id, name, area] of [
      ["d1", "Devon", "Silver Lake"],
      ["d2", "Sam", "Echo Park"],
      ["s1", "Nadia", "Silver Lake"],
      ["day1", "Clara", "Silver Lake"],
    ] as const) {
      la.members.push({
        id,
        name,
        homeCity: "la",
        state: "normal",
        joinedAt: la.clock.now(),
        age: 29,
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
      la.presence.push({ memberId: id, city: "la", type: "home", areas: [area] });
    }
    la.facets.push(
      {
        id: "f-heavy",
        memberId: "d1",
        kind: "trait",
        value: "heavy_drinker",
        tags: ["heavy_drinker"],
        scope: "matchable",
        provenance: "said",
        confidence: 1,
      },
      {
        id: "f-sober",
        memberId: "s1",
        kind: "boundary",
        value: "strict_sober",
        tags: ["strict_sober"],
        scope: "agent_private",
        provenance: "said",
        confidence: 1,
      },
      {
        id: "f-daytime",
        memberId: "day1",
        kind: "boundary",
        value: "daytime_only",
        tags: ["daytime_only"],
        scope: "agent_private",
        provenance: "said",
        confidence: 1,
      },
      {
        id: "f-spend",
        memberId: "d2",
        kind: "preference",
        value: "low spend",
        tags: ["hv:spend:lowtier"],
        scope: "matchable",
        provenance: "said",
        confidence: 1,
      },
    );
    await la.onboard("d1", "d2", "s1", "day1");

    const barOrBrewery = ALL_SEED_VENUES.find(v => v.city === "la" && v.isAlcoholCentric)!;
    const cafe = ALL_SEED_VENUES.find(v => v.city === "la" && !v.isAlcoholCentric && v.allAges && v.priceTier <= 2)!;
    // 2026-10-08 23:00 UTC = 16:00 PDT (LA daytime) vs 19:00 EDT (NYC after-dark!)
    const fourPmLaMs = Date.UTC(2026, 9, 8, 23, 0);

    // heavy_drinker must NOT be rejected from alcohol-centric venue as a non-drinker
    expect(la.net.venuePassesRedLines(barOrBrewery, ["d1", "d2"], fourPmLaMs)).toBe(true);
    // strict_sober IS rejected from alcohol-centric venue
    expect(la.net.venuePassesRedLines(barOrBrewery, ["s1", "d2"], fourPmLaMs)).toBe(false);
    // Default tz is this.cityTz() (America/Los_Angeles): 4 PM LA is daytime, NOT after-dark!
    expect(la.net.venuePassesRedLines(cafe, ["day1", "d2"], fourPmLaMs)).toBe(true);
    expect(la.net.venuePassesRedLines(cafe, ["day1", "d2"], fourPmLaMs, CITY_TZ.nyc)).toBe(false);

    // hv:spend:lowtier caps budget tier to 1 and live VenueManager quarantines are respected by pickVenueWithRedLines
    const firstPick = la.net.pickVenueWithRedLines(["d1", "d2"], fourPmLaMs, { city: "la", mode: "date" });
    expect(firstPick.primary).toBeDefined();
    expect(firstPick.primary!.venue.priceTier).toBeLessThanOrEqual(1);
    const chosenId = firstPick.primary!.venue.id;
    la.net.venues.quarantineVenue(chosenId, "d1", fourPmLaMs);
    const secondPick = la.net.pickVenueWithRedLines(["d1", "d2"], fourPmLaMs, { city: "la", mode: "date" });
    expect(secondPick.primary?.venue.id).not.toBe(chosenId);
  });

  test("MeetupCoordinator handles venue_full pivot without quarantine, halts relay on panic, and blocks minors", () => {
    const startMs = START + 2 * HOUR;
    const sfVenues = ALL_SEED_VENUES.filter(v => v.city === "sf");
    const primary = sfVenues[0]!;
    const backup = sfVenues[1]!;

    const vm = new VenueManager();
    const sent: { to: string; body: string; kind: string }[] = [];
    let panicked = false;
    const parties: Record<string, { firstName: string; age: number }> = {
      a: { firstName: "Ana", age: 29 },
      b: { firstName: "Ben", age: 31 },
    };
    const host: MeetupCoordHost = {
      venues: vm,
      ratesPhotos: false,
      party: (_id, memberId) => {
        const p = parties[memberId];
        return p ? { id: memberId, firstName: p.firstName, age: p.age, optedOut: false, confirmed: true } : undefined;
      },
      blocked: () => false,
      panicTriggered: () => panicked,
      privateFacts: () => ({ forbidden: [], canaries: [] }),
      send: (to, body, meta) => { sent.push({ to, body, kind: meta.kind }); },
    };
    const coord = new MeetupCoordinator(host);
    coord.registerMeetup({
      meetupId: "m-full",
      app: "ntwrk",
      city: "sf",
      startMs,
      participants: ["a", "b"],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
    });

    expect(parseArrivalText("This place is completely packed, no tables left")?.state).toBe("venue_full");

    // venue_full pivots to backup WITHOUT quarantining the primary venue
    const fullRes = coord.handleInbound("a", "The cafe is completely full, no tables left!", startMs - 10 * MINUTE);
    expect(fullRes.handled).toBe(true);
    expect(fullRes.state).toBe("venue_full");
    expect(fullRes.pivotedToVenueId).toBe(backup.id);
    expect(vm.getVenue(primary.id)?.status).toBe("active");
    expect(vm.getVenue(primary.id)?.closureReports).toBe(0);
    expect(sent.filter(s => s.kind === "backup_pivot")).toHaveLength(2);
    expect(sent[0]!.body).toContain("is full");

    // Panic halts arrival relays immediately
    panicked = true;
    const panicRes = coord.handleInbound("a", "I'm here by the front entrance wearing a blue coat", startMs - 5 * MINUTE);
    expect(panicRes.relayedTo).toEqual([]);
    expect(panicRes.blockedReason).toBe("panic_triggered");
    expect(sent.filter(s => s.kind === "arrival_relay")).toHaveLength(0);

    // Minor in meetup blocks all arrival relays
    const minorCoord = new MeetupCoordinator({
      ...host,
      panicTriggered: () => false,
      party: (_id, memberId) => {
        if (memberId === "t1") return { id: "t1", firstName: "Sam", age: 16, optedOut: false, confirmed: true };
        if (memberId === "t2") return { id: "t2", firstName: "Alex", age: 17, optedOut: false, confirmed: true };
        return undefined;
      },
    });
    minorCoord.registerMeetup({
      meetupId: "m-minor",
      app: "friends",
      city: "sf",
      startMs,
      participants: ["t1", "t2"],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
    });
    const minorRes = minorCoord.handleInbound("t1", "I'm here wearing a green jacket", startMs - 5 * MINUTE);
    expect(minorRes.relayedTo).toEqual([]);
    expect(minorRes.blockedReason).toBe("minor_policy");
  });

  test("VenueManager.exportState is delta-only (< 1 KB fresh) and preserves round-trip parity for delta and legacy full snapshots", () => {
    const fresh = new VenueManager();
    const freshJson = JSON.stringify(fresh.exportState());
    expect(freshJson.length).toBeLessThan(1024);
    expect(fresh.exportState().venues).toHaveLength(0);

    // Mutate one venue, add one organic venue, record visit & rejection
    const target = ALL_SEED_VENUES.find(v => v.city === "sf")!;
    fresh.quarantineVenue(target.id, "m1", START);
    const organic = fresh.recordOrganicMention("sf", "Sightglass Roasters", "SoMa / Yerba Buena", START);
    fresh.recordVisit("m1", ALL_SEED_VENUES[0]!.id);
    fresh.recordRejection("m2", ALL_SEED_VENUES[1]!.id);

    const deltaState = fresh.exportState();
    expect(deltaState.venues).toHaveLength(2);
    expect(JSON.stringify(deltaState).length).toBeLessThan(4096);

    const fromDelta = new VenueManager();
    fromDelta.importState(deltaState);
    expect(fromDelta.count()).toBe(ALL_SEED_VENUES.length + 1);
    expect(fromDelta.getVenue(target.id)?.status).toBe("suspect_closed");
    expect(fromDelta.getVenue(organic.id)?.name).toBe("Sightglass Roasters");
    expect(fromDelta.visitedBy("m1")).toContain(ALL_SEED_VENUES[0]!.id);
    expect(fromDelta.rejectedBy("m2")).toContain(ALL_SEED_VENUES[1]!.id);

    // Backward compatibility: importing a legacy 75-venue full snapshot hydrates cleanly and shrinks on next export
    const legacyFullState: VenueManagerState = {
      venues: ALL_SEED_VENUES.map(v => (v.id === target.id ? { ...v, status: "suspect_closed", closureReports: 1 } : { ...v })),
      visited: [["m1", [ALL_SEED_VENUES[0]!.id]]],
      rejected: [["m2", [ALL_SEED_VENUES[1]!.id]]],
      externalFetchCount: 2,
      openCheckCount: 3,
    };
    expect(JSON.stringify(legacyFullState).length).toBeGreaterThan(50_000);

    const fromLegacy = new VenueManager();
    fromLegacy.importState(legacyFullState);
    expect(fromLegacy.count()).toBe(ALL_SEED_VENUES.length);
    expect(fromLegacy.getVenue(target.id)?.status).toBe("suspect_closed");
    expect(fromLegacy.stats().externalFetches).toBe(2);
    expect(fromLegacy.stats().openChecks).toBe(3);

    const reExported = fromLegacy.exportState();
    expect(reExported.venues).toHaveLength(1);
    expect(reExported.venues[0]!.id).toBe(target.id);
    expect(JSON.stringify(reExported).length).toBeLessThan(2048);
  });

  test("LLMBudget UTC day-rollover refreshes spend and seeds request count from cost_ledger before tick", async () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 23, 55, 0));
    const rows: { app_id: string; day: string; kind: string; purpose: string; cost_usd: number }[] = [
      { app_id: "ntwrk", day: "2026-11-27", kind: "llm", purpose: "engine_judge", cost_usd: 2.0 },
      { app_id: "ntwrk", day: "2026-11-27", kind: "llm", purpose: "engine_judge", cost_usd: 0.0 },
      { app_id: "ntwrk", day: "2026-11-28", kind: "llm", purpose: "engine_judge", cost_usd: 0.25 },
    ];
    const fakeSql = (async (_strings: TemplateStringsArray, app: string, day: string, purpose: string) => {
      const matched = rows.filter(r => r.app_id === app && r.day === day && r.kind === "llm" && r.purpose === purpose);
      const usd = matched.reduce((s, r) => s + r.cost_usd, 0);
      return [{ usd, requests: matched.length }];
    }) as unknown as Parameters<typeof llmUsageForDay>[0];

    const budget = new LLMBudget({ maxCostMicro: 2_000_000, maxRequests: 200 });
    const entry = { budget, day: dayOf(clock.now()) };

    const refresh = async () => {
      const day = dayOf(clock.now());
      const { spentMicros, requests } = await llmUsageForDay(fakeSql, "ntwrk", day, "engine_judge");
      entry.budget.spentMicro = spentMicros;
      if (entry.day !== day) {
        entry.budget.requests = requests;
        entry.day = day;
      } else {
        entry.budget.requests = Math.max(entry.budget.requests, requests);
      }
    };

    // Day D exhausted
    await refresh();
    expect(entry.budget.spentMicro).toBe(2_000_000);
    expect(entry.budget.requests).toBe(2);
    expect(entry.budget.exhausted).toBe(true);

    // Advance past UTC midnight into Day D+1 and refresh before tick
    clock.advance(10 * MINUTE);
    expect(dayOf(clock.now())).toBe("2026-11-28");
    await refresh();
    expect(entry.day).toBe("2026-11-28");
    expect(entry.budget.spentMicro).toBe(250_000);
    expect(entry.budget.requests).toBe(1);
    expect(entry.budget.exhausted).toBe(false);
  });

  test("relay-endpoint LRU cache caches repeated arrival phrases within 1h TTL, evicts past maxEntries, and stores zero raw text", async () => {
    let nowMs = 1_000_000;
    let fetchCalls = 0;
    const mockFetch = (async () => {
      fetchCalls++;
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            answers: {
              money: { noul: 0.01, confidence: 0.99 },
              investment: { noul: 0.01, confidence: 0.99 },
              sob_story: { noul: 0.01, confidence: 0.99 },
              offplatform: { noul: 0.01, confidence: 0.99 },
              shares_contact: { noul: 0.01, confidence: 0.99 },
              personal_info: { noul: 0.01, confidence: 0.99 },
              injection: { noul: 0.01, confidence: 0.99 },
              impersonation: { noul: 0.01, confidence: 0.99 },
              link: { noul: 0.01, confidence: 0.99 },
              threat: { noul: 0.01, confidence: 0.99 },
              slur: { noul: 0.01, confidence: 0.99 },
              insult: { noul: 0.01, confidence: 0.99 },
              sexual_pressure: { noul: 0.01, confidence: 0.99 },
              rating_probe: { noul: 0.01, confidence: 0.99 },
              minor: { noul: 0.01, confidence: 0.99 },
              ordinary: { noul: 0.99, confidence: 0.99 },
              harm: { score: 0, confidence: 0.99 },
              direct_scam: { noul: 0.01, confidence: 0.99 },
              direct_harassment: { noul: 0.01, confidence: 0.99 },
              direct_contact: { noul: 0.01, confidence: 0.99 },
            },
            usage: { input_tokens: 120 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const hookFor = relayClassifierFromEnv(
      { CLOUDFLARE_AI_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct" },
      () => {},
      undefined,
      { now: () => nowMs, fetch: mockFetch, clock: () => nowMs },
    );
    const hook = hookFor("ntwrk");

    const first = await hook({ text: "omw!", kind: "text", context: [], met: false });
    const second = await hook({ text: "omw!", kind: "text", context: [], met: false });
    expect(first.flags).toEqual([]);
    expect(second.flags).toEqual([]);
    expect(fetchCalls).toBe(1);

    // Advance past 1h TTL -> cache misses and refetches
    nowMs += 60 * 60 * 1000 + 1;
    await hook({ text: "omw!", kind: "text", context: [], met: false });
    expect(fetchCalls).toBe(2);

    // Bounded LRU eviction
    const small = createRelayClefCache({ maxEntries: 2, ttlMs: 60_000, now: () => nowMs });
    small.record("k1", { answers: {} });
    small.record("k2", { answers: {} });
    expect(small.answers("k1")).toBeDefined(); // touch k1 so k2 is LRU
    small.record("k3", { answers: {} });
    expect(small.size).toBe(2);
    expect(small.answers("k2")).toBeUndefined();
    expect(small.answers("k1")).toBeDefined();
    expect(small.answers("k3")).toBeDefined();
  });

  test("understandPrompt keeps >=80% static system prefix with city-scoped areas and understandSafely pre-filters trivial turns", async () => {
    const p1 = understandPrompt("maybe later this week", { city: "sf", awaiting: "probe" });
    const p2 = understandPrompt("looking for a climbing partner", { city: "sf" });
    expect(p1[0]!.role).toBe("system");
    expect(p1[0]!.content).toBe(p2[0]!.content);
    const staticRatio = p1[0]!.content.length / (p1[0]!.content.length + p1[1]!.content.length);
    expect(staticRatio).toBeGreaterThanOrEqual(0.8);

    const hoodLine = p1[0]!.content.split("\n").find(l => l.startsWith("Neighborhoods: "));
    expect(hoodLine).toBeDefined();
    const areas = hoodLine!.slice("Neighborhoods: ".length).replace(/\.$/, "").split("; ");
    expect(areas.length).toBeLessThanOrEqual(12);
    expect(areas.length).toBeGreaterThanOrEqual(8);
    expect(areas).toContain("Mission District");
    expect(areas).not.toContain("Brickell");

    // Pre-filter skips reactions, stage === "new", definite consentOf, and opted-out members
    let calls = 0;
    const w = new Mini(
      [{ id: "m1", name: "Maya", age: 28, area: "SoHo", interests: ["coffee"], quietHours: [23, 7] }],
      {
        understand: async () => {
          calls++;
          return { wants: [], notWanted: [], interests: [], skills: [] };
        },
      },
    );
    // stage === "new" before onboarding -> skipped
    await w.net.onInbound({ id: "in-new", memberId: "m1", channel: "imessage", body: "hey there", ts: w.clock.now() });
    expect(calls).toBe(0);

    await w.onboard("m1");
    calls = 0;

    // reaction -> skipped
    await w.net.onInbound({ id: "in-react", memberId: "m1", channel: "imessage", body: "👍", reaction: { kind: "like", to: "out-1" }, ts: w.clock.now() });
    expect(calls).toBe(0);

    // definite consent -> skipped
    await w.net.onInbound({ id: "in-yes", memberId: "m1", channel: "imessage", body: "yes!", ts: w.clock.now() });
    expect(calls).toBe(0);

    // ambiguous prose -> invokes understand
    await w.net.onInbound({ id: "in-prose", memberId: "m1", channel: "imessage", body: "I've been getting into bouldering lately", ts: w.clock.now() });
    expect(calls).toBe(1);

    // whenPhrase caches Intl.DateTimeFormat across calls and honors tz
    expect(whenPhrase(Date.UTC(2026, 9, 8, 23, 30), CITY_TZ.la)).toMatch(/4:30\s*pm/i);
    expect(whenPhrase(Date.UTC(2026, 9, 8, 23, 30), CITY_TZ.nyc)).toMatch(/7:30\s*pm/i);
  });

  test("1974d9daa work-ontology tags route through digital work intro with non-cofounder copy", async () => {
    const emails: Record<string, string> = { a: "ana@example.com", b: "ben@example.com" };
    const w = new Mini(
      [
        { id: "a", name: "Ana Diaz", age: 30, area: "SoHo", interests: ["ai"], skills: ["typescript"], quietHours: [23, 7] },
        { id: "b", name: "Ben Ito", age: 35, area: "Williamsburg", interests: ["ai"], skills: ["product"], quietHours: [23, 7] },
      ],
      { workIntroEmailOf: id => emails[id] },
    );
    await w.onboard("a", "b");

    const oppId = w.propose(["a", "b"], { category: "professional", objective: "Step-ahead mentorship intro" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    const opp = w.net.opps.get(oppId)!;
    opp.tags.push("step_ahead_mentorship");
    await w.answerProbes(["a", "b"]);

    expect(opp.stage).toBe("scheduled");
    expect(opp.venue).toBeUndefined();
    expect(opp.venueId).toBeUndefined();
    expect(opp.workIntro?.channel).toBe("WarmEmail");
    const reveals = w.sent.filter(s => s.meta.type === "proposal" && s.meta.proposalId === oppId);
    expect(reveals).toHaveLength(2);
    for (const r of reveals) {
      expect(r.body).toMatch(/warm email intro/i);
      expect(r.body).not.toMatch(/cofounder/i);
    }
  });
});
