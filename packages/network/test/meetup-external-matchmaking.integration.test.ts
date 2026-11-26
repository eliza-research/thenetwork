// End-to-end Postgres-backed integration tests covering red-line venue & date/friend setup,
// Top-1 suggestion pivots, teen all-ages friend venues, Luma/Meetup/Partiful external events,
// per-city 2-persona matchmakers, dual-side external sourcing, RelayDesk panic exit & W3-232
// minorSignal, prospect PII purge + HMAC suppression, kill-switch failover, and peon firewall.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  CITY_TZ,
  CityMatchmakerRegistry,
  DAY,
  ExternalProspectCache,
  HOUR,
  LAUNCH_CITIES,
  MAX_SUGGESTION_PIVOTS,
  MINUTE,
  TopOneSuggestionFlow,
  applyVenueFeedback,
  attachPartifulUrl,
  buildLumaCreateEventRequest,
  buildMeetupCreateEventRequest,
  buildMeetupPollRsvpsRequest,
  buildPartifulEventKit,
  buildPostEventExternalInviteMessage,
  buildQualificationAgeRedLineScript,
  buildQualityGatedNetworkInviteScript,
  checkApproveExternalEventRsvp,
  checkExternalEventT24Quorum,
  checkInviteExternalEventAttendee,
  checkPublishExternalEvent,
  computeExternalApprovalCap,
  computeProspectHmacHash,
  containsUrlOrBrandSpam,
  evaluateAnchorFailover,
  evaluateBackupPivotV2,
  evaluateContactExternalProspect,
  evaluateReconsiderExternalProspect,
  evaluateVenueQuarantine,
  fromLocal,
  getCity,
  isAppAllowedToReadExternalProspects,
  isSanctionedSource,
  normalizeLumaWebhookEvent,
  normalizeMeetupRsvpPoll,
  personaStatusActive,
  personaStatusSuspended,
  prospectConsentFutureOptin,
  prospectConsentSingleOnly,
  prospectConsentSmsLogistics,
  rankVenuesForMatch,
  scrubPartifulTelecomCopy,
  transitionSourcingTicket,
  triggerPersonaKillSwitch,
  validateSmsCopyRules,
  verifyLumaWebhookSignature,
  type ExternalEventDraft,
  type ExternalSourcingTicket,
  type MemberVenuePrefs,
  type VenueRecord,
} from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { simulatedRelayClassifier } from "../../engine/src/relay.ts";
import { planFirstDate } from "../../engine/src/packs/slop/plan.ts";
import type { SlopProfile } from "../../engine/src/packs/slop/profile.ts";
import { dateActivity } from "../../engine/src/packs/slop/score.ts";
import { cellOfZip } from "../../engine/src/packs/slop/zips.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import {
  formatAnchorOrQuorumCancel,
  formatBackupVenuePivot,
  formatCrowdExpectation,
  formatTopOneVenueSuggestion,
  styleViolations,
} from "../src/copy.ts";
import { RelayDesk, type RelayHost, type RelayMatch, type RelayMember } from "../src/relay.ts";
import { Mini } from "./mini.ts";

const T = 120_000;
const WED_14_SF = fromLocal(2026, 11, 18, 14, CITY_TZ.sf);
const WED_20_SF = fromLocal(2026, 11, 18, 20, CITY_TZ.sf);
const HMAC_SECRET = "synthetic-test-hmac-secret-2026-only";

function adultPrefs(overrides: Partial<MemberVenuePrefs> = {}): MemberVenuePrefs {
  return {
    memberId: "m1",
    age: 29,
    drinksAlcohol: true,
    vegetarian: false,
    vegan: false,
    wheelchairNeeded: false,
    maxBudgetTier: 3,
    maxTravelMinutes: 45,
    visitedVenueIds: [],
    rejectedVenueIds: [],
    archetype: "foodie",
    ...overrides,
  };
}

function makeSlopProfile(overrides: Partial<SlopProfile> & { id: string }): SlopProfile {
  return {
    age: 29,
    adult: true,
    optedIn: true,
    paused: false,
    homeMarket: "sf",
    zip: "94110",
    cell: cellOfZip("94110"),
    zipUnknown: false,
    scope: { mode: "radius", miles: 10 },
    maxMiles: 10,
    is: "woman",
    seeks: ["man"],
    shownTo: ["man"],
    values: { drinking: "sometimes" },
    dealbreakers: [],
    interests: ["coffee", "books"],
    shareableInterests: ["coffee", "books"],
    activities: ["drinks", "coffee"],
    free: ["thu_eve", "sat_day", "sun_day"],
    wantsBody: [],
    safety: [],
    verification: [],
    silentAsks: [],
    openAsks: [],
    askCounts: {},
    visiting: [],
    interestFacet: new Map(),
    history: {
      yes: 0,
      no: 0,
      silent: 0,
      dates: 0,
      noShows: 0,
      backouts: 0,
      negativeFrom: 0,
      contextualBlocks: 0,
      attendedSlots: [],
      rated: [],
      ratedSelf: [],
      ratedBody: [],
    },
    ...overrides,
  };
}

async function signLumaWebhook(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function seedVenuesIntoPg(sql: SQL, venues: readonly VenueRecord[]): Promise<void> {
  for (const v of venues) {
    await sql`
      insert into platform.venues (
        id, city, neighborhood, name, address, lat, lon, is_public, all_ages,
        category, price_tier, age_min, is_bar_only, is_alcohol_centric, alcohol_optional,
        serves_vegetarian, serves_vegan, halal_friendly, kosher_friendly,
        gluten_free_friendly, severe_allergen_safe, wheelchair_accessible, is_smoke_free,
        separate_checks, walk_in_group_capacity, reservation_required, open_event_eligible,
        noise_level, live_music_at_night, indoor, outdoor, weather_sensitive,
        safety_score, transit_score, arrival_landmark, hours, hobbies, cuisine_tags,
        source, status, closure_reports, verified_open_at, persona_priors
      ) values (
        ${v.id}, ${v.city}, ${v.neighborhood}, ${v.name}, ${v.address}, ${v.lat}, ${v.lng},
        ${v.public}, ${v.allAges ?? (v.ageMin ?? 0) < 18}, ${v.category}, ${v.priceTier},
        ${v.ageMin ?? 0}, ${v.isBarOnly}, ${v.isAlcoholCentric ?? v.isBarOnly}, ${v.alcoholOptional},
        ${v.servesVegetarian}, ${v.servesVegan}, ${v.halalFriendly ?? false}, ${v.kosherFriendly ?? false},
        ${v.glutenFreeFriendly ?? false}, ${v.severeAllergenSafe ?? false}, ${v.wheelchairAccessible},
        ${v.isSmokeFree ?? true}, ${v.separateChecks}, ${v.walkInGroupCapacity},
        ${v.reservationRequired}, ${v.openEventEligible ?? false}, ${v.noiseLevel},
        ${v.liveMusicAtNight}, ${v.indoor}, ${v.outdoor}, ${v.weatherSensitive},
        ${v.safetyScore ?? 8}, ${v.transitScore ?? 4}, ${v.arrivalLandmark},
        ${JSON.stringify(v.hours)}::jsonb, ${JSON.stringify(v.hobbies ?? [])}::jsonb,
        ${JSON.stringify(v.cuisineTags ?? [])}::jsonb, ${v.source}, ${v.status},
        ${v.closureReports}, ${new Date(v.lastVerifiedAt)}, ${JSON.stringify(v.personaPriors)}::jsonb
      )
      on conflict (id) do nothing
    `;
  }
}

describe.skipIf(!pgAvailable)("Meetup Setup, External Events & Matchmakers Integration (PostgreSQL)", () => {
  let url = "";
  let sql: SQL;

  beforeAll(async () => {
    url = await migratedDb("meetup_ext_int");
    sql = new SQL({ url, max: 4 });
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
  }, T);

  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("red-line venue & date/friend setup, teen all-ages venues, Pokemon TCG hobby bias vs slop date vibe, Top-1 3-pivot bound & SMS style rules", async () => {
    // 1. strictSober excludes breweries/wine bars EVEN WHEN alcoholOptional === true.
    const sfVenues = ALL_SEED_VENUES.filter(v => v.city === "sf");
    const alcoholCentricWithOptional = sfVenues.filter(v => v.isAlcoholCentric && v.alcoholOptional);
    expect(alcoholCentricWithOptional.length).toBeGreaterThanOrEqual(2);

    const soberRanked = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [
          adultPrefs({ memberId: "s1", strictSober: true, drinksAlcohol: false }),
          adultPrefs({ memberId: "s2", drinksAlcohol: true }),
        ],
        startMs: WED_14_SF,
        mode: "date",
        app: "slop",
      },
      WED_14_SF
    );
    expect(soberRanked.length).toBeGreaterThan(0);
    expect(soberRanked.every(c => !c.venue.isBarOnly && !c.venue.isAlcoholCentric)).toBe(true);
    for (const ac of alcoholCentricWithOptional) {
      expect(soberRanked.some(c => c.venue.id === ac.id)).toBe(false);
    }

    // 2. dateActivity never returns "drinks" for sober / non-drinker; planFirstDate returns red-line-safe VenueRecord + backup.
    const soberA = makeSlopProfile({
      id: "m-sober-a",
      is: "woman",
      seeks: ["man"],
      values: { drinking: "sober" },
      dealbreakers: ["alcohol_boundary"],
      activities: ["drinks"],
    });
    const drinkerB = makeSlopProfile({
      id: "m-drinker-b",
      is: "man",
      seeks: ["woman"],
      shownTo: ["woman"],
      values: { drinking: "sometimes" },
      activities: ["drinks"],
    });
    expect(dateActivity(soberA, drinkerB)).not.toBe("drinks");
    const datePlan = planFirstDate(soberA, drinkerB, ["sf"], undefined, {
      city: "sf",
      venues: sfVenues,
      memberAreas: ["Hayes Valley", "Mission District"],
      startMs: WED_14_SF,
      nowMs: WED_14_SF,
    });
    expect(datePlan).not.toBeNull();
    expect(datePlan!.activity).not.toBe("drinks");
    expect(datePlan!.venue).not.toBe("a bar");
    expect(datePlan!.venueRecord).toBeDefined();
    expect(datePlan!.venueRecord!.isBarOnly).toBe(false);
    expect(datePlan!.venueRecord!.isAlcoholCentric).toBe(false);
    expect(datePlan!.backupVenue).toBeDefined();
    expect(datePlan!.backupVenue!.id).not.toBe(datePlan!.venueRecord!.id);

    // 3. halal, kosher, severeAllergen fail closed (unknown / false venues strictly excluded).
    const unknownDietVenue: VenueRecord = {
      ...sfVenues[0]!,
      id: "sf-unknown-diet-test",
      name: "Unknown Diet Spot",
      halalFriendly: undefined,
      kosherFriendly: undefined,
      severeAllergenSafe: undefined,
    };
    const dietPool = [...sfVenues, unknownDietVenue];
    for (const flag of ["halal", "kosher", "severeAllergen"] as const) {
      const ranked = rankVenuesForMatch(
        dietPool,
        {
          city: "sf",
          memberAreas: ["Hayes Valley", "Mission District"],
          members: [adultPrefs({ memberId: "d1", [flag]: true }), adultPrefs({ memberId: "d2" })],
          startMs: WED_14_SF,
          mode: "date",
        },
        WED_14_SF
      );
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked.some(c => c.venue.id === unknownDietVenue.id)).toBe(false);
      if (flag === "halal") expect(ranked.every(c => c.venue.halalFriendly === true)).toBe(true);
      if (flag === "kosher") expect(ranked.every(c => c.venue.kosherFriendly === true)).toBe(true);
      if (flag === "severeAllergen") expect(ranked.every(c => c.venue.severeAllergenSafe === true)).toBe(true);
    }

    // 4. After-dark safetyScore >= 7 & transitScore >= 3 hard floor, and daytimeOnly blocks evening slots.
    const unsafeNightVenue: VenueRecord = {
      ...sfVenues.find(v => v.id === "sf-sightglass-soma")!,
      id: "sf-unsafe-night-test",
      name: "Dim Alley Cafe",
      safetyScore: 5,
      transitScore: 2,
      hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 7 * 60, closeMin: 23 * 60 })),
    };
    const nightRanked = rankVenuesForMatch(
      [...sfVenues, unsafeNightVenue],
      {
        city: "sf",
        memberAreas: ["SoMa / Yerba Buena", "Hayes Valley"],
        members: [adultPrefs({ memberId: "n1" }), adultPrefs({ memberId: "n2" })],
        startMs: WED_20_SF,
        mode: "date",
      },
      WED_20_SF
    );
    expect(nightRanked.some(c => c.venue.id === unsafeNightVenue.id)).toBe(false);
    expect(nightRanked.every(c => (c.venue.safetyScore ?? 0) >= 7 && (c.venue.transitScore ?? 0) >= 3)).toBe(true);

    const daytimeOnlyNight = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [adultPrefs({ memberId: "dt1", daytimeOnly: true }), adultPrefs({ memberId: "dt2" })],
        startMs: WED_20_SF,
        mode: "date",
      },
      WED_20_SF
    );
    expect(daytimeOnlyNight).toHaveLength(0);

    // 5. teenFriendAllowed + allAges: allows teen friend groups (2..6) at all-ages non-bar places while blocking adult/bar/dating.
    const teen1 = adultPrefs({ memberId: "t1", age: 15, drinksAlcohol: false });
    const teen2 = adultPrefs({ memberId: "t2", age: 16, drinksAlcohol: false });
    const teenAllowed = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [teen1, teen2],
        startMs: WED_14_SF,
        mode: "group",
        app: "friends",
        teenFriendAllowed: true,
      },
      WED_14_SF
    );
    expect(teenAllowed.length).toBeGreaterThan(0);
    expect(teenAllowed.every(c => c.venue.allAges === true && !c.venue.isBarOnly && !c.venue.isAlcoholCentric && (c.venue.ageMin ?? 0) < 18)).toBe(true);

    // Blocked when teenFriendAllowed is false (e.g. unready/stopped or default slop), and slop planFirstDate blocks minors completely.
    const teenDisallowed = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [teen1, teen2],
        startMs: WED_14_SF,
        mode: "group",
        app: "friends",
        teenFriendAllowed: false,
      },
      WED_14_SF
    );
    expect(teenDisallowed).toHaveLength(0);

    const teenSlopVenues = rankVenuesForMatch(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [teen1, teen2],
        startMs: WED_14_SF,
        mode: "date",
        app: "slop",
      },
      WED_14_SF
    );
    expect(teenSlopVenues).toHaveLength(0);

    const minorSlopPlan = planFirstDate(
      makeSlopProfile({ id: "m-teen-16", age: 16, adult: false }),
      makeSlopProfile({ id: "m-adult-22", age: 22, adult: true, is: "man", seeks: ["woman"], shownTo: ["woman"] }),
      ["sf"],
      undefined,
      { city: "sf", venues: sfVenues, startMs: WED_14_SF, nowMs: WED_14_SF }
    );
    expect(minorSlopPlan).toBeNull();

    // 6. Pokemon TCG strong interest bias picks hobby LGS across ALL 5 launch cities for friends, while slop keeps classic date venues.
    for (const city of LAUNCH_CITIES) {
      const cityVenues = ALL_SEED_VENUES.filter(v => v.city === city);
      const lgs = cityVenues.find(v => v.category === "game_store" || v.category === "board_game_cafe")!;
      expect(lgs).toBeDefined();
      const startMs = fromLocal(2026, 11, 21, 14, getCity(city)!.tz); // Sat 14:00 local

      const friendsPick = rankVenuesForMatch(
        cityVenues,
        {
          city,
          memberAreas: [lgs.neighborhood, lgs.neighborhood],
          members: [
            adultPrefs({ memberId: `${city}-p1`, hobbies: ["pokemon_tcg"] }),
            adultPrefs({ memberId: `${city}-p2`, hobbies: ["pokemon_tcg"] }),
          ],
          startMs,
          mode: "group",
          app: "friends",
          targetHobbies: ["pokemon_tcg"],
        },
        startMs
      );
      expect(friendsPick[0]?.venue.category === "game_store" || friendsPick[0]?.venue.category === "board_game_cafe").toBe(true);

      const centralAreas = getCity(city)!.neighborhoods.slice(0, 2).map(n => n.name);
      const slopPick = rankVenuesForMatch(
        cityVenues,
        {
          city,
          memberAreas: centralAreas,
          members: [
            adultPrefs({ memberId: `${city}-d1`, hobbies: ["pokemon_tcg"], optedIntoActivityDates: false }),
            adultPrefs({ memberId: `${city}-d2`, hobbies: ["pokemon_tcg"], optedIntoActivityDates: false }),
          ],
          startMs,
          mode: "date",
          app: "slop",
        },
        startMs
      );
      expect(slopPick.length).toBeGreaterThan(0);
      expect(slopPick[0]!.venue.category).not.toBe("game_store");
    }

    // 7. ConsentNetwork.pickVenueWithRedLines honors member facets on ConsentNetwork.
    const mini = new Mini([
      { id: "m-rl-1", name: "Nadia", age: 28, area: "West Village", interests: ["coffee"] },
      { id: "m-rl-2", name: "Omar", age: 30, area: "East Village", interests: ["coffee"] },
    ]);
    mini.facets.push({
      id: "m-rl-1:redline:strict_sober",
      memberId: "m-rl-1",
      kind: "boundary",
      value: "strict_sober",
      tags: ["strict_sober", "halal"],
      scope: "agent_private",
      provenance: "said",
      confidence: 1,
    });
    await mini.onboard("m-rl-1", "m-rl-2");
    const nycStart = fromLocal(2026, 11, 18, 14, CITY_TZ.nyc);
    const netPick = mini.net.pickVenueWithRedLines(["m-rl-1", "m-rl-2"], nycStart, { city: "nyc", mode: "date" });
    expect(netPick.primary).toBeDefined();
    expect(netPick.primary!.venue.isAlcoholCentric).toBe(false);
    expect(netPick.primary!.venue.halalFriendly).toBe(true);

    // 8. TopOneSuggestionFlow bounds pivots to 3, records rejections to Postgres, never repeats rejected venues, and passes styleViolations (0).
    let flow = TopOneSuggestionFlow.proposeTopOne(
      sfVenues,
      {
        city: "sf",
        memberAreas: ["Hayes Valley", "Mission District"],
        members: [adultPrefs({ memberId: "p-top-1", maxBudgetTier: 3 }), adultPrefs({ memberId: "p-top-2", maxBudgetTier: 3 })],
        startMs: WED_14_SF,
        mode: "date",
        app: "slop",
      },
      WED_14_SF
    );
    expect(flow.action).toBe("propose_next");
    expect(flow.current).toBeDefined();
    expect(MAX_SUGGESTION_PIVOTS).toBe(3);

    const seenIds = new Set<string>([flow.current!.venue.id]);
    const generatedSms: string[] = [
      TopOneSuggestionFlow.buildTopOneCopy({ state: flow, whenLabel: "Thu 6pm", mode: "date", partnerFirstName: "Theo" }),
    ];

    const reasons = ["too_far", "wrong_vibe", "price"] as const;
    for (const reason of reasons) {
      const rejectedId = flow.current!.venue.id;
      await sql`
        insert into network.venue_rejections (app_id, member_id, venue_id, reason, rejected_at)
        values ('slop', 'p-top-1', ${rejectedId}, ${reason}, ${new Date(WED_14_SF)})
        on conflict (app_id, member_id, venue_id) do nothing
      `;
      flow = TopOneSuggestionFlow.rejectAndPivot(flow, reason);
      if (flow.current) {
        expect(seenIds.has(flow.current.venue.id)).toBe(false);
        seenIds.add(flow.current.venue.id);
      }
      generatedSms.push(
        TopOneSuggestionFlow.buildTopOneCopy({ state: flow, whenLabel: "Thu 6pm", mode: "date", partnerFirstName: "Theo" })
      );
    }

    expect(flow.pivotsUsed).toBe(3);
    expect(flow.action).toBe("ask_user_spot_or_pause");
    expect(flow.current).toBeUndefined();

    // Confirm all 3 rejected venues persisted in Postgres network.venue_rejections.
    const pgRej = (await sql`
      select venue_id from network.venue_rejections where app_id = 'slop' and member_id = 'p-top-1'
    `) as Array<{ venue_id: string }>;
    expect(pgRej).toHaveLength(3);

    // Every generated SMS & copy.ts formatter passes styleViolations with 0 violations.
    generatedSms.push(
      formatTopOneVenueSuggestion("Sightglass Coffee", "SoMa", "Thu 6pm", { partner: "Theo", pivot: 0 }),
      formatTopOneVenueSuggestion("Tartine Bakery", "Mission District", "Thu 6pm", { pivot: 1 }),
      formatTopOneVenueSuggestion("Blue Bottle", "Hayes Valley", "Thu 6pm", { pivot: 2 }),
      formatCrowdExpectation("network_curated"),
      formatCrowdExpectation("external_open", { interest: "Pokemon TCG", platforms: "Luma/Meetup" }),
      formatCrowdExpectation("external_open", { interest: "Pokemon TCG", sparseAnchor: true }),
      formatBackupVenuePivot("Sightglass Coffee", "Yerba Buena Gardens", "full", { landmark: "near the carousel" }),
      formatBackupVenuePivot("Sightglass Coffee", "Yerba Buena Gardens", "closed"),
      formatAnchorOrQuorumCancel("anchor_drop", { activity: "board games", when: "Sat 2pm" }),
      formatAnchorOrQuorumCancel("low_quorum", { activity: "board games", when: "Sat 2pm" }),
      formatAnchorOrQuorumCancel("co_anchor_promoted", { activity: "board games", when: "Sat 2pm", venue: "Gamescape" })
    );
    for (const msg of generatedSms) {
      expect(styleViolations(msg)).toEqual([]);
      expect(validateSmsCopyRules(msg)).toEqual([]);
    }
  }, T);

  test("impromptu external events (Luma/Meetup/Partiful): HMAC webhooks, telecom scrub, overbooking cap, anchor/quorum/failover, full-vs-closed pivot & quality-gated invite (PostgreSQL)", async () => {
    const startMs = WED_14_SF + 48 * HOUR;
    const endMs = startMs + 2 * HOUR;
    const baseDraft: ExternalEventDraft = {
      id: "ext-ev-luma-1",
      city: "sf",
      platform: "luma",
      source: "host_native",
      title: "SF Pokemon TCG Casual Table",
      interest: "pokemon_tcg",
      description: "Bring a casual deck or borrow one of ours for friendly games.",
      venueName: "Gamescape",
      venueAddress: "333 Divisadero St, San Francisco, CA",
      arrivalLandmark: "Back play tables near the counter",
      isPublicVenue: true,
      venueWalkInCapacity: 12,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      timezone: CITY_TZ.sf,
      anchorFirstName: "Maya",
      confirmedNetworkAnchors: 1,
      confirmedNetworkTotal: 2,
      targetRoomSize: 7,
      reviewApproved: true,
      allParticipantsAdult: true,
      hideGuestList: true,
      approvalRequired: true,
      externalCrowdDisclosed: true,
    };

    // 1. Overbooking cap clamped to min(15, venueWalkInCapacity).
    const cap = computeExternalApprovalCap(2, 12, 7);
    expect(cap).toBe(10);
    expect(2 + cap).toBeLessThanOrEqual(Math.min(15, 12));
    const clampedLarge = computeExternalApprovalCap(2, 30, 20);
    expect(2 + clampedLarge).toBeLessThanOrEqual(15);

    // 2. Publish gate via ConsentNetwork & checkPublishExternalEvent: anchor >= 1, reviewApproved, sanctioned, public, hidden guest list.
    const mini = new Mini([{ id: "anchor-1", name: "Maya", age: 29, area: "Williamsburg" }]);
    expect(isSanctionedSource("scraped")).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({ ...baseDraft, confirmedNetworkAnchors: 0 }).allowed).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({ ...baseDraft, reviewApproved: false }).allowed).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({ ...baseDraft, source: "scraped" }).allowed).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({ ...baseDraft, isPublicVenue: false }).allowed).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({ ...baseDraft, hideGuestList: false }).allowed).toBe(false);

    const publishRes = mini.net.evaluateExternalEventPublish(baseDraft);
    expect(publishRes.allowed).toBe(true);
    expect(publishRes.approvedExternalCap).toBe(10);

    // Persist published event in Postgres platform.external_events.
    await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, interest, description, venue_id, backup_venue_id,
         is_public, start_at, end_at, anchor_member_id, confirmed_network_anchors, confirmed_network_total,
         approved_external_cap, hide_guest_list, approval_required, external_crowd_disclosed,
         human_review_approved, status)
      values
        (${baseDraft.id}, 'sf', 'friends', 'host_native', 'luma', ${baseDraft.title}, ${baseDraft.interest},
         ${baseDraft.description}, 'sf-gamescape', 'sf-tartine-mission', true,
         ${new Date(startMs)}, ${new Date(endMs)}, 'anchor-1', 1, 2, ${publishRes.approvedExternalCap},
         true, true, true, true, 'published')
      on conflict (id) do nothing
    `;

    // 3. Luma Plus request + HMAC-SHA256 webhook signature verify (valid vs forged) + RSVP normalization.
    const lumaReq = buildLumaCreateEventRequest(baseDraft, "luma-test-key");
    expect(lumaReq.ok).toBe(true);
    if (lumaReq.ok) {
      expect(lumaReq.request.body.require_rsvp_approval).toBe(true);
      expect(lumaReq.request.body.show_guest_list).toBe(false);
      expect(lumaReq.request.body.capacity).toBe(12);
    }

    const webhookSecret = "whsec_luma_synthetic_secret";
    const adultWebhookObj = {
      type: "guest.registered",
      created_at: new Date(startMs - 30 * HOUR).toISOString(),
      data: {
        api_id: "gst-adult-1",
        event_api_id: "evt-luma-1",
        user_first_name: "Devon Brooks",
        approval_status: "pending_approval",
        registration_answers: [
          { question_id: "adult_18_plus", label: "18 or older?", answer: "Yes, 27" },
          { question_id: "interest_detail", label: "What are you into?", answer: "Standard Pokemon TCG deck" },
        ],
      },
    };
    const rawWebhook = JSON.stringify(adultWebhookObj);
    const validSig = await signLumaWebhook(webhookSecret, rawWebhook);
    expect(await verifyLumaWebhookSignature(webhookSecret, rawWebhook, validSig)).toBe(true);
    expect(await verifyLumaWebhookSignature(webhookSecret, `${rawWebhook} `, validSig)).toBe(false);
    expect(await verifyLumaWebhookSignature("wrong-secret", rawWebhook, validSig)).toBe(false);
    expect(await verifyLumaWebhookSignature(webhookSecret, rawWebhook, "sha256=deadbeef")).toBe(false);

    const normalizedAdult = normalizeLumaWebhookEvent(adultWebhookObj);
    expect(normalizedAdult.kind).toBe("rsvp");
    if (normalizedAdult.kind === "rsvp") {
      expect(normalizedAdult.firstName).toBe("Devon");
      expect(normalizedAdult.confirmedAdult18Plus).toBe(true);
      expect(normalizedAdult.answeredScreeningQuestion).toBe(true);
    }

    const normalizedMinor = normalizeLumaWebhookEvent({
      type: "guest.registered",
      created_at: new Date(startMs - 29 * HOUR).toISOString(),
      data: {
        api_id: "gst-minor-17",
        event_api_id: "evt-luma-1",
        user_first_name: "Teen",
        approval_status: "pending_approval",
        registration_answers: [
          { question_id: "adult_18_plus", label: "18 or older?", answer: "17" },
          { question_id: "interest_detail", label: "What are you into?", answer: "Pokemon cards" },
        ],
      },
    });
    expect(normalizedMinor.kind).toBe("rsvp");
    if (normalizedMinor.kind === "rsvp") {
      expect(normalizedMinor.confirmedAdult18Plus).toBe(false);
    }

    // 4. Meetup Pro GraphQL request & poll normalizer.
    const meetupCreate = buildMeetupCreateEventRequest(
      { ...baseDraft, platform: "meetup", source: "official_api" },
      "sf-tabletop-friends",
      "meetup-oauth-token"
    );
    expect(meetupCreate.ok).toBe(true);
    const pollReq = buildMeetupPollRsvpsRequest("meetup-ev-9", "meetup-oauth-token");
    expect(pollReq.headers.authorization).toBe("Bearer meetup-oauth-token");
    const pollNorm = normalizeMeetupRsvpPoll({
      data: {
        event: {
          id: "meetup-ev-9",
          status: "ACTIVE",
          rsvps: {
            edges: [
              {
                node: {
                  id: "r1",
                  status: "YES",
                  updated: new Date(startMs - 28 * HOUR).toISOString(),
                  member: { id: "mu-1", name: "Priya Shah" },
                  rsvpQuestionAnswer: { answer: "Yes 18+, bringing my Charizard deck!" },
                },
              },
            ],
          },
        },
      },
    });
    expect(pollNorm.eventExternalId).toBe("meetup-ev-9");
    expect(pollNorm.cancelled).toBe(false);
    expect(pollNorm.rsvps).toHaveLength(1);
    expect(pollNorm.rsvps[0]!.confirmedAdult18Plus).toBe(true);
    expect(pollNorm.rsvps[0]!.answeredScreeningQuestion).toBe(true);

    // 5. Partiful Event Kit + telecom copy scrubber stripping alcohol, cannabis, gambling & adult terms.
    const scrub = scrubPartifulTelecomCopy(
      "Happy hour brewery cocktails, 420 cannabis hangout, casino poker night, and adult-only hookups!"
    );
    expect(scrub.text.toLowerCase()).not.toMatch(/\b(happy hour|brewery|cocktails|420|cannabis|casino|poker|hookups)\b/);
    expect(scrub.scrubbedTerms.length).toBeGreaterThanOrEqual(4);

    const kitRes = buildPartifulEventKit({
      ...baseDraft,
      platform: "partiful",
      title: "Happy Hour Poker & Gamescape Hang",
      description: "Casual wine and beer hall meetup with poker tables.",
    });
    expect(kitRes.ok).toBe(true);
    if (kitRes.ok) {
      expect(kitRes.kit.requiredToggles.hideGuestList).toBe(true);
      expect(kitRes.kit.requiredToggles.approvalRequired).toBe(true);
      expect(kitRes.kit.title.toLowerCase()).not.toMatch(/\b(happy hour|poker)\b/);
      expect(kitRes.kit.description.toLowerCase()).not.toMatch(/\b(wine|beer hall|poker)\b/);
      const badAttach = attachPartifulUrl(kitRes.kit, "https://evil.example.com/e/12345");
      expect(badAttach.ok).toBe(false);
      const goodAttach = attachPartifulUrl(kitRes.kit, "https://partiful.com/e/AbCd1234");
      expect(goodAttach.ok).toBe(true);
    }

    // 6. T-24h low-quorum cancel & anchor-drop co-anchor failover vs clean cancel.
    expect(mini.net.evaluateExternalEventQuorum(0, 0, 5, 20)).toBe("cancel_no_anchor");
    expect(mini.net.evaluateExternalEventQuorum(1, 2, 2, 24)).toBe("cancel_low_quorum");
    expect(mini.net.evaluateExternalEventQuorum(1, 2, 4, 24)).toBe("go");
    expect(checkExternalEventT24Quorum(1, 2, 1, 30)).toBe("go");

    expect(
      evaluateAnchorFailover({
        confirmedAnchors: 0,
        backupNetworkMembers: 1,
        totalConfirmed: 4,
        hoursToStart: 12,
        approvedExternalRsvps: 3,
        totalNetworkMembers: 1,
      })
    ).toBe("promote_co_anchor");
    expect(
      evaluateAnchorFailover({
        confirmedAnchors: 0,
        backupNetworkMembers: 0,
        totalConfirmed: 4,
        hoursToStart: 12,
        approvedExternalRsvps: 4,
        totalNetworkMembers: 0,
      })
    ).toBe("cancel_cleanly");
    expect(
      evaluateAnchorFailover({
        confirmedAnchors: 1,
        backupNetworkMembers: 1,
        totalConfirmed: 2,
        hoursToStart: 20,
        approvedExternalRsvps: 1,
        totalNetworkMembers: 1,
      })
    ).toBe("cancel_low_quorum");

    // 7. venue_full backup pivot WITHOUT closure quarantine vs venue_closed WITH quarantine (persisted in Postgres).
    expect(evaluateBackupPivotV2(false, true, true, startMs - 10 * MINUTE, startMs, false)).toBe(true);
    expect(evaluateVenueQuarantine(false, true)).toBe(false);
    expect(evaluateBackupPivotV2(true, false, true, startMs - 10 * MINUTE, startMs, false)).toBe(true);
    expect(evaluateVenueQuarantine(true, false)).toBe(true);

    const gamescape = ALL_SEED_VENUES.find(v => v.id === "sf-gamescape")!;
    const afterClosed = applyVenueFeedback(
      gamescape,
      ["social"],
      { venueId: gamescape.id, memberId: "anchor-1", at: startMs, reportedClosed: true, outcome: "closed" },
      startMs
    );
    expect(afterClosed.status).toBe("suspect_closed");
    await sql`update platform.venues set status = ${afterClosed.status}, closure_reports = ${afterClosed.closureReports} where id = ${gamescape.id}`;
    const [pgVenue] = (await sql`select status, closure_reports from platform.venues where id = ${gamescape.id}`) as Array<{ status: string; closure_reports: number }>;
    expect(pgVenue!.status).toBe("suspect_closed");
    expect(pgVenue!.closure_reports).toBe(1);
    // Restore status for subsequent tests.
    await sql`update platform.venues set status = 'active', closure_reports = 0 where id = ${gamescape.id}`;

    // 8. 18+ minor rejection on external RSVP (both core gate and Postgres CHECK).
    expect(
      checkApproveExternalEventRsvp({
        attendeeAge: 17,
        banned: false,
        optedOut: false,
        held: false,
        currentApprovedExternal: 0,
        approvedExternalCap: 10,
        answeredScreeningQuestion: true,
      })
    ).toBe(false);
    expect(
      checkApproveExternalEventRsvp({
        attendeeAge: 27,
        banned: false,
        optedOut: false,
        held: false,
        currentApprovedExternal: 0,
        approvedExternalCap: 10,
        answeredScreeningQuestion: true,
      })
    ).toBe(true);

    await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-int-adult', ${baseDraft.id}, 'luma', 'gst-adult-1', 'Devon', 27, 'Pokemon TCG', 'attended')
      on conflict (id) do nothing
    `;
    const minorPgErr = await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-int-minor', ${baseDraft.id}, 'luma', 'gst-minor-17', 'Teen', 17, '17', 'pending_approval')
    `.then(() => "ok", e => String(e.message));
    expect(minorPgErr).not.toBe("ok");

    // 9. Quality-gated post-event invite ONLY after positive feedback + 0 safety flags + 0 prior invites.
    const baseInviteGate = {
      eventCompleted: true,
      networkFeedbackPositive: true,
      safetyFlag: false,
      attendeeAge: 27,
      optedOut: false,
      banned: false,
      alreadyMember: false,
      invitesSent: 0,
      safeFollowupWindow: true,
    };
    expect(checkInviteExternalEventAttendee({ ...baseInviteGate, networkFeedbackPositive: false })).toBe(false);
    expect(checkInviteExternalEventAttendee({ ...baseInviteGate, safetyFlag: true })).toBe(false);
    expect(checkInviteExternalEventAttendee({ ...baseInviteGate, invitesSent: 1 })).toBe(false);
    expect(checkInviteExternalEventAttendee(baseInviteGate)).toBe(true);

    const inviteMsg = buildPostEventExternalInviteMessage(baseInviteGate, {
      attendeeFirstName: "Devon",
      eventTitle: "SF Pokemon TCG Casual Table",
      venueName: "Gamescape",
      anchorFirstName: "Maya",
      inviteUrl: "https://friends.help/join/demo",
    });
    expect(inviteMsg.ok).toBe(true);
    if (inviteMsg.ok) {
      expect(validateSmsCopyRules(inviteMsg.text)).toEqual([]);
      await sql`
        update platform.external_event_rsvps
        set network_vouched = true, invite_attempts = 1, invited_at = ${new Date(endMs + 2 * HOUR)}
        where id = 'rsvp-int-adult'
      `;
    }
    const [rsvpRow] = (await sql`select invite_attempts, network_vouched from platform.external_event_rsvps where id = 'rsvp-int-adult'`) as Array<{ invite_attempts: number; network_vouched: boolean }>;
    expect(rsvpRow).toEqual({ invite_attempts: 1, network_vouched: true });
  }, T);

  test("2-persona matchmakers, dual-side sourcing, RelayDesk panic exit & W3-232 minorSignal, PII purge + HMAC suppression, kill-switch & peon RLS firewall (PostgreSQL)", async () => {
    // 1. All 10 launch personas across 5 cities match Postgres platform.matchmaker_personas.
    const registry = new CityMatchmakerRegistry();
    expect(registry.listAllMatchmakers()).toHaveLength(10);
    const pgPersonas = (await sql`select id, city, gender, first_name from platform.matchmaker_personas order by id`) as Array<{
      id: string;
      city: string;
      gender: string;
      first_name: string;
    }>;
    expect(pgPersonas).toHaveLength(10);
    for (const row of pgPersonas) {
      const p = registry.getPersonaById(row.id);
      expect(p).toBeDefined();
      expect(p!.city).toBe(row.city);
      expect(p!.gender).toBe(row.gender);
      expect(p!.firstName).toBe(row.first_name);
    }

    // 2. Deterministic gender routing + single-persona lock (both cache & Postgres UNIQUE(city, dedupe_hash)).
    const lockedPersona = registry.selectPersona({
      city: "sf",
      app: "slop",
      memberGender: "woman",
      targetProspectGender: "man",
      tieBreakSeed: "hinge:alex-sf-1",
    })!;
    expect(lockedPersona.id).toBe("sf-f");
    const siblingPersona = registry.getPersonaById("sf-m")!;

    const cache = new ExternalProspectCache(HMAC_SECRET);
    const up1 = await cache.upsertProspect({
      id: "ext-p-e2e-1",
      city: "sf",
      sourcePlatform: "hinge",
      assignedPersona: lockedPersona,
      platformHandleKey: "alex-sf-1",
      phoneE164: "+14155550191",
      firstName: "Alex Rivera",
      statedAge: 30,
      gender: "man",
      seeks: ["woman"],
      neighborhood: "Hayes Valley",
      rawFacets: {
        interest: "climbing",
        strict_sober: false,
        clef_score: 0.92,
        raw_html: "<html>should be stripped</html>",
      },
      consentState: "intro_single_only",
      nowMs: WED_14_SF,
    });
    expect(up1.ok).toBe(true);
    if (!up1.ok) throw new Error("expected upsert ok");
    expect(up1.record.firstName).toBe("Alex");
    expect(up1.record.facets).toEqual({ interest: "climbing", strict_sober: false });

    // Sibling persona hard-blocked by cache persona lock.
    const upSibling = await cache.upsertProspect({
      id: "ext-p-e2e-1-sib",
      city: "sf",
      sourcePlatform: "hinge",
      assignedPersona: siblingPersona,
      platformHandleKey: "alex-sf-1",
      firstName: "Alex",
      statedAge: 30,
      gender: "man",
      seeks: ["woman"],
      neighborhood: "Hayes Valley",
      rawFacets: {},
      consentState: "intro_single_only",
      nowMs: WED_14_SF + HOUR,
    });
    expect(upSibling.ok).toBe(false);
    if (!upSibling.ok) expect(upSibling.reason).toBe("persona_lock_conflict");

    // Mirror to Postgres platform.external_prospects.
    await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, phone_hash, first_name,
         stated_age, gender, seeks, neighborhood, facets, consent_state, expires_at)
      values
        (${up1.record.id}, 'sf', 'hinge', ${lockedPersona.id}, ${up1.record.dedupeHash},
         ${up1.record.phoneHash ?? null}, ${up1.record.firstName}, ${up1.record.statedAge},
         'man', '["woman"]'::jsonb, 'Hayes Valley', ${JSON.stringify(up1.record.facets)}::jsonb,
         'intro_single_only', ${new Date(up1.record.expiresAtMs)})
    `;

    // 3. Density-aware fallback via ConsentNetwork: dense stays in-network, sparse triggers external sourcing.
    const mini = new Mini([
      { id: "m-sparse", name: "Elena", age: 29, area: "West Village", romance: { is: "woman", seeks: ["man"] } },
      { id: "m-partner", name: "Sam", age: 31, area: "East Village", romance: { is: "man", seeks: ["woman"] } },
    ]);
    await mini.onboard("m-sparse", "m-partner");
    expect(mini.net.densityTierFor(10)).toBe("dense");
    expect(mini.net.densityTierFor(0)).toBe("sparse");
    expect(
      mini.net.canTriggerExternalSourcingFor("m-sparse", {
        eligibleLocalPairs: 4,
        topScoreScaled: 85,
        strongThresholdScaled: 70,
        externalScoutOptIn: true,
        activeSourcingTickets: 0,
      })
    ).toBe(false);
    expect(
      mini.net.canTriggerExternalSourcingFor("m-sparse", {
        eligibleLocalPairs: 0,
        topScoreScaled: 0,
        strongThresholdScaled: 70,
        externalScoutOptIn: true,
        activeSourcingTickets: 0,
      })
    ).toBe(true);

    // 4. Human review gate, URL/brand-spam guard, and 18+ fail-closed on external outreach.
    const baseContact = {
      statedAge: 30,
      reviewApproved: true,
      personaDisclosed: true,
      passedLeakAndClefGuard: true,
      optedOut: false,
      declined: false,
      suppressed: false,
      isSmsHandoff: false,
      hasLoggedOffAppConsent: false,
      personaStatus: personaStatusActive,
      dailyOutboundCount: 2,
      dailyOutboundCap: 10,
      evasionAttempt: false,
      memberHeld: false,
      prospectHeld: false,
      memberBanned: false,
      prospectBanned: false,
      personaMatchesLock: true,
      consentState: prospectConsentSingleOnly,
      cacheAgeDays: 1,
      draftText: "hey alex — i'm maya, a local matchmaker in sf. got someone great i'd love to introduce you to if you're interested!",
    };
    expect(evaluateContactExternalProspect(baseContact)).toBe(true);
    expect(evaluateContactExternalProspect({ ...baseContact, reviewApproved: false })).toBe(false);
    expect(evaluateContactExternalProspect({ ...baseContact, statedAge: 17 })).toBe(false);
    expect(containsUrlOrBrandSpam("Check out slop.date at https://ntwrk.party")).toBe(true);
    expect(
      evaluateContactExternalProspect({
        ...baseContact,
        draftText: "Join The Network at https://slop.date to meet my client!",
      })
    ).toBe(false);
    const qualScript = buildQualificationAgeRedLineScript();
    expect(styleViolations(qualScript)).toEqual([]);
    expect(validateSmsCopyRules(qualScript)).toEqual([]);
    expect(containsUrlOrBrandSpam(qualScript)).toBe(false);

    // 5. RelayDesk panic exit immediately halts canRelayArrivalSafe & RelayDesk.request; W3-232 minorSignal still fires cleanly.
    const minorSignals: Array<{ id: string; saysYounger: boolean }> = [];
    const panicExits: Array<{ id: string; matchIds: string[] }> = [];
    const sentRelays: Array<{ to: string; body: string }> = [];
    let relayNow = WED_14_SF - 10 * MINUTE;

    const relayMembers: Record<string, RelayMember> = {
      "r-alice": { id: "r-alice", firstName: "Alice", age: 29, optedOut: false, held: false, markedMinor: false },
      "r-bob": { id: "r-bob", firstName: "Bob", age: 31, optedOut: false, held: false, markedMinor: false },
      "r-charlie": { id: "r-charlie", firstName: "Charlie", age: 28, optedOut: false, held: false, markedMinor: false },
    };
    const relayMatches: RelayMatch[] = [
      { id: "match-ab", participants: ["r-alice", "r-bob"], acceptedBy: ["r-alice", "r-bob"], status: "mutual", negativeFeedback: false, at: relayNow - HOUR },
      { id: "match-ac", participants: ["r-alice", "r-charlie"], acceptedBy: ["r-alice", "r-charlie"], status: "mutual", negativeFeedback: false, at: relayNow - HOUR },
    ];
    const host: RelayHost = {
      app: "slop",
      now: () => relayNow,
      member: id => relayMembers[id],
      matchesOf: id => relayMatches.filter(m => m.participants.includes(id)),
      blocked: () => false,
      privateFacts: () => ({ forbidden: [], canaries: [] }),
      ratesPhotos: true,
      send: (to, body) => {
        sentRelays.push({ to, body });
        return "sent";
      },
      minorSignal: (id, saysYounger) => {
        minorSignals.push({ id, saysYounger });
        if (relayMembers[id]) relayMembers[id]!.markedMinor = true;
      },
      onPanicExit: (id, matchIds) => {
        panicExits.push({ id, matchIds });
      },
      severeBlock: () => {},
      classifierFailed: () => {},
    };
    const desk = new RelayDesk(host);

    // Before panic: arrival relay is allowed and clean message sends.
    expect(
      desk.canRelayArrivalSafe({
        matchId: "match-ab",
        senderId: "r-alice",
        recipientId: "r-bob",
        senderConfirmed: true,
        recipientConfirmed: true,
        startMs: WED_14_SF,
        alreadyMet: false,
        passedSafetyAndLeakCheck: true,
      })
    ).toBe(true);
    const cleanRelay = await desk.request(
      { itemId: "item-clean-1", from: "r-alice", kind: "text", matchId: "match-ab", text: "In a green coat by the espresso counter!" },
      { hook: simulatedRelayClassifier }
    );
    expect(cleanRelay.decision).toBe("sent");

    // Panic exit immediately halts canRelayArrivalSafe & RelayDesk.request!
    const panicRes = desk.triggerPanicExit("r-alice", "match-ab");
    expect(panicRes.haltedMatches).toContain("match-ab");
    expect(panicExits).toHaveLength(1);
    expect(
      desk.canRelayArrivalSafe({
        matchId: "match-ab",
        senderId: "r-alice",
        recipientId: "r-bob",
        senderConfirmed: true,
        recipientConfirmed: true,
        startMs: WED_14_SF,
        alreadyMet: false,
        passedSafetyAndLeakCheck: true,
      })
    ).toBe(false);
    const afterPanic = await desk.request(
      { itemId: "item-after-panic", from: "r-bob", kind: "text", matchId: "match-ab", text: "Where are you?" },
      { hook: simulatedRelayClassifier }
    );
    expect(afterPanic.decision).toBe("refused");
    expect(afterPanic.reason).toContain("stopped");

    // W3-232: minor self-disclosure on match-ac refuses delivery AND fires host.minorSignal immediately!
    const sentBeforeMinor = sentRelays.length;
    const minorDisclosure = await desk.request(
      { itemId: "item-minor-16", from: "r-charlie", kind: "text", matchId: "match-ac", text: "actually I am 16 years old, don't tell anyone" },
      { hook: simulatedRelayClassifier }
    );
    expect(minorDisclosure.decision).toBe("refused");
    expect(sentRelays.length).toBe(sentBeforeMinor);
    expect(minorSignals).toHaveLength(1);
    expect(minorSignals[0]!.id).toBe("r-charlie");

    // ConsentNetwork.relayPanicExit also works cleanly on booked ConsentNetwork match.
    const netPanic = mini.net.relayPanicExit("m-sparse", "opp-demo");
    expect(netPanic.haltedMatches).toContain("opp-demo");
    expect(mini.log("relay_panic_exit").length).toBeGreaterThanOrEqual(1);

    // 6. Underage & STOP immediately purge prospect PII leaving only keyed HMAC suppression tombstone.
    const underageUp = await cache.upsertProspect({
      id: "ext-p-underage",
      city: "sf",
      sourcePlatform: "hinge",
      assignedPersona: lockedPersona,
      platformHandleKey: "teen-sf-17",
      firstName: "Teen",
      statedAge: 17,
      gender: "man",
      seeks: ["woman"],
      neighborhood: "SoMa",
      rawFacets: {},
      consentState: "none",
      nowMs: WED_14_SF,
    });
    expect(underageUp.ok).toBe(false);
    if (!underageUp.ok) expect(cache.isSuppressed(underageUp.dedupeHash)).toBe(true);

    // STOP purge on up1.record removes PII row from both cache & Postgres, leaving only HMAC suppression tombstone.
    const tombstone = cache.purgeWithSuppression(up1.record.dedupeHash, "stopped", WED_14_SF + 2 * HOUR, true);
    expect(tombstone?.dedupeHash).toBe(up1.record.dedupeHash);
    expect(cache.getForApp("slop", up1.record.dedupeHash)).toBeUndefined();
    expect(cache.isSuppressed(up1.record.dedupeHash, up1.record.phoneHash)).toBe(true);

    await sql`delete from platform.external_prospects where dedupe_hash = ${up1.record.dedupeHash}`;
    await sql`
      insert into platform.external_prospect_suppressions (city, dedupe_hash, phone_hash, reason, permanent)
      values ('sf', ${up1.record.dedupeHash}, ${up1.record.phoneHash ?? null}, 'stopped', true)
      on conflict (city, dedupe_hash) do nothing
    `;
    const remainingPii = await sql`select id from platform.external_prospects where dedupe_hash = ${up1.record.dedupeHash}`;
    expect(remainingPii).toHaveLength(0);

    // 7. No cold reuse without intro_future_optin + 30d cooldown.
    const baseReconsider = {
      consentState: prospectConsentFutureOptin,
      cacheAgeDays: 40,
      daysSinceLastContact: 35,
      recontactCount: 0,
      statedAge: 30,
      optedOut: false,
      banned: false,
      redFlagged: false,
      personaMatchesLock: true,
      reviewApproved: true,
    };
    expect(evaluateReconsiderExternalProspect({ ...baseReconsider, consentState: prospectConsentSingleOnly })).toBe(false);
    expect(evaluateReconsiderExternalProspect({ ...baseReconsider, daysSinceLastContact: 15 })).toBe(false);
    expect(evaluateReconsiderExternalProspect({ ...baseReconsider, recontactCount: 2 })).toBe(false);
    expect(evaluateReconsiderExternalProspect(baseReconsider)).toBe(true);

    // 8. Kill-switch halts new outreach & fails over on-app leads while PRESERVING booked off-app SMS setups.
    const prospect2Hash = await computeProspectHmacHash(HMAC_SECRET, "hinge:jordan-sf-2");
    await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, consent_state, expires_at)
      values
        ('ext-p-booked', 'sf', 'hinge', 'sf-f', ${prospect2Hash}, 'Jordan', 31, 'man', 'sms_logistics_optin', ${new Date(WED_14_SF + 30 * DAY)})
      on conflict (id) do nothing
    `;

    const tickets: ExternalSourcingTicket[] = [
      {
        id: "tkt-on-app",
        city: "sf",
        app: "slop",
        memberId: "m-sparse",
        personaId: "sf-f",
        state: "member_probed",
        offAppSmsOptedIn: false,
        createdAtMs: WED_14_SF,
        updatedAtMs: WED_14_SF,
      },
      {
        id: "tkt-off-app-booked",
        city: "sf",
        app: "slop",
        memberId: "m-booked",
        personaId: "sf-f",
        prospectDedupeHash: prospect2Hash,
        state: "venue_verified_booked",
        offAppSmsOptedIn: true,
        venueId: "sf-sightglass-soma",
        createdAtMs: WED_14_SF,
        updatedAtMs: WED_14_SF,
      },
    ];

    const ks = triggerPersonaKillSwitch(registry, "sf-f", tickets, "verification_challenge", WED_14_SF + 3 * HOUR);
    expect(registry.getPersonaById("sf-f")!.status).toBe("suspended");
    expect(ks.preservedOffAppTicketIds).toEqual(["tkt-off-app-booked"]);
    expect(ks.failedOverOnAppTicketIds).toEqual(["tkt-on-app"]);
    expect(ks.memberNotices).toHaveLength(1);
    expect(
      evaluateContactExternalProspect({
        ...baseContact,
        personaStatus: personaStatusSuspended,
        consentState: prospectConsentSmsLogistics,
      })
    ).toBe(false);

    // Persist booked off-app ticket in Postgres.
    await sql`
      insert into platform.external_sourcing_tickets
        (id, city, app_id, member_id, prospect_id, prospect_dedupe_hash, assigned_persona_id, state, off_app_sms_opted_in, venue_id)
      values
        ('tkt-off-app-booked', 'sf', 'slop', 'm-booked', 'ext-p-booked', ${prospect2Hash}, 'sf-f', 'venue_verified_booked', true, 'sf-sightglass-soma')
      on conflict (id) do nothing
    `;

    // 9. Quality-gated Network invite ONLY after attended + positive/vouched member feedback + 0 safety flags.
    let bookedTicket: ExternalSourcingTicket = { ...tickets[1]!, state: "quality_gate" };
    const failedInvite = transitionSourcingTicket(bookedTicket, "warm_invite", WED_14_SF + 24 * HOUR, {
      inviteGateInput: {
        meetupCompleted: true,
        memberAttended: true,
        prospectAttended: false,
        safetyOrRedFlag: false,
        catfishOrAgeMismatch: false,
        memberQualityPositive: true,
        memberVouchedForOthers: false,
        statedAge: 31,
        optedOut: false,
        banned: false,
        alreadyMember: false,
        inviteAttempts: 0,
        safeFollowupWindow: true,
      },
    });
    expect(failedInvite.ok).toBe(false);

    const goodGate = {
      meetupCompleted: true,
      memberAttended: true,
      prospectAttended: true,
      safetyOrRedFlag: false,
      catfishOrAgeMismatch: false,
      memberQualityPositive: true,
      memberVouchedForOthers: true,
      statedAge: 31,
      optedOut: false,
      banned: false,
      alreadyMember: false,
      inviteAttempts: 0,
      safeFollowupWindow: true,
    };
    const passedInvite = transitionSourcingTicket(bookedTicket, "warm_invite", WED_14_SF + 24 * HOUR, {
      inviteGateInput: goodGate,
    });
    expect(passedInvite.ok).toBe(true);
    const inviteCopy = buildQualityGatedNetworkInviteScript(goodGate, {
      variant: "mutual_spark",
      memberFirstName: "Elena",
      cityName: "San Francisco",
    });
    expect(inviteCopy.ok).toBe(true);
    if (inviteCopy.ok) {
      expect(validateSmsCopyRules(inviteCopy.text)).toEqual([]);
    }

    // 10. peon cross-app firewall (core gate + cache + Postgres RLS).
    expect(isAppAllowedToReadExternalProspects("slop")).toBe(true);
    expect(isAppAllowedToReadExternalProspects("peon")).toBe(false);
    expect(isAppAllowedToReadExternalProspects("friends")).toBe(false);
    expect(cache.getForApp("peon", prospect2Hash)).toBeUndefined();

    const peonPgRows = await sql.begin(async tx => {
      await tx.unsafe("set local role platform_service");
      await tx`select set_config('app.current_app', 'peon', true)`;
      const p = await tx`select id from platform.external_prospects`;
      const t = await tx`select id from platform.external_sourcing_tickets`;
      const s = await tx`select dedupe_hash from platform.external_prospect_suppressions`;
      return p.length + t.length + s.length;
    });
    expect(peonPgRows).toBe(0);

    const slopPgRows = await sql.begin(async tx => {
      await tx.unsafe("set local role platform_service");
      await tx`select set_config('app.current_app', 'slop', true)`;
      const p = await tx`select id from platform.external_prospects`;
      const t = await tx`select id from platform.external_sourcing_tickets`;
      const s = await tx`select dedupe_hash from platform.external_prospect_suppressions`;
      return p.length + t.length + s.length;
    });
    expect(slopPgRows).toBeGreaterThanOrEqual(3);
  }, T);
});
