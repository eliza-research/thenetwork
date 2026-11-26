// Real Postgres integration tests for migration 0098 (5 launch cities, 20 networks,
// 75 curated venues, 10 matchmaker personas, external_events / external_event_rsvps /
// external_prospects / external_sourcing_tickets / external_prospect_suppressions,
// venue_concurrent_holds, and RLS crossAppScoreFirewall).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  DAY,
  HOUR,
  LAUNCH_CITIES,
  fromLocal,
  type VenueRecord,
} from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { migrate } from "../../db/migrate.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const WED_14_SF = fromLocal(2026, 11, 18, 14, "America/Los_Angeles");

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
      on conflict (id) do update set
        status = excluded.status,
        verified_open_at = excluded.verified_open_at
    `;
  }
}

describe.skipIf(!pgAvailable)("0098 five-city venues, external events, matchmakers & RLS firewall (PostgreSQL)", () => {
  let url = "";
  let sql: SQL;

  beforeAll(async () => {
    url = await migratedDb("meetup_venues_ext");
    sql = new SQL({ url, max: 4 });
  }, T);

  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("0001..0098 migrates cleanly and idempotently; seeds 5 launch cities, preserves 4 nyc networks, seeds 10 matchmaker personas, and 75 venues (15/city)", async () => {
    // Re-running migrate on the same DB proves idempotency of 0098.
    await migrate(url, { lockTimeout: "5s" });

    const cities = ((await sql`select id from platform.cities order by id`) as Array<{ id: string }>).map(r => r.id);
    expect(cities).toEqual(["chicago", "la", "miami", "nyc", "sf"]);

    const networks = ((await sql`select id from platform.networks order by id`) as Array<{ id: string }>).map(r => r.id);
    expect(networks).toEqual(["friends:nyc", "ntwrk:nyc", "peon:nyc", "slop:nyc"]);

    const personas = (await sql`
      select id, city, gender, first_name, human_operated, status, daily_outbound_cap
      from platform.matchmaker_personas
      order by city, gender
    `) as Array<{
      id: string;
      city: string;
      gender: string;
      first_name: string;
      human_operated: boolean;
      status: string;
      daily_outbound_cap: number;
    }>;
    expect(personas).toHaveLength(10);
    for (const city of LAUNCH_CITIES) {
      const pair = personas.filter(p => p.city === city);
      expect(pair).toHaveLength(2);
      expect(pair.map(p => p.gender).sort()).toEqual(["female", "male"]);
      expect(pair.every(p => p.human_operated === true && p.status === "active" && p.daily_outbound_cap === 10)).toBe(true);
    }

    // UNIQUE (city, gender) rejects a duplicate city+gender persona.
    const dupPersonaErr = await sql`
      insert into platform.matchmaker_personas
        (id, city, gender, first_name, tz, bio_disclosure)
      values
        ('sf-f-dup', 'sf', 'female', 'Dup', 'America/Los_Angeles', 'Local matchmaker in SF.')
    `.then(() => "ok", e => String(e.message));
    expect(dupPersonaErr).not.toBe("ok");

    // CHECK (human_operated = true) rejects automated bot persona.
    const botErr = await sql`
      update platform.matchmaker_personas set human_operated = false where id = 'sf-f'
    `.then(() => "ok", e => String(e.message));
    expect(botErr).not.toBe("ok");

    // Seed all 75 curated venues (15 per city) and verify hobby-native LGS venues exist in every launch city.
    expect(ALL_SEED_VENUES).toHaveLength(75);
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
    const allCount = (await sql`select count(*)::int as c from platform.venues`) as Array<{ c: number }>;
    expect(allCount[0]!.c).toBe(75);

    for (const city of LAUNCH_CITIES) {
      const rows = (await sql`
        select id, category from platform.venues where city = ${city} order by id
      `) as Array<{ id: string; category: string }>;
      expect(rows).toHaveLength(15);
      expect(rows.some(r => r.category === "game_store" || r.category === "board_game_cafe")).toBe(true);
    }

    // CHECK (is_public = true) rejects private home venues in platform.venues.
    const privateVenueErr = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, category, price_tier)
      values
        ('sf-private-home', 'sf', 'Mission District', 'Private Apt', 37.76, -122.42, false, 'community_space', 0)
    `.then(() => "ok", e => String(e.message));
    expect(privateVenueErr).not.toBe("ok");
  }, T);

  test("platform.external_events rejects source='scraped', is_public=false, approved_external_cap > 15, and unhidden/ungated listings", async () => {
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
    const startAt = new Date(WED_14_SF + 24 * HOUR);
    const endAt = new Date(WED_14_SF + 26 * HOUR);

    // Valid sanctioned public event succeeds.
    await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, interest, venue_id, is_public,
         start_at, end_at, confirmed_network_anchors, confirmed_network_total,
         approved_external_cap, hide_guest_list, approval_required, external_crowd_disclosed,
         human_review_approved, status)
      values
        ('ext-ev-valid-1', 'sf', 'friends', 'host_native', 'luma', 'SF Pokemon TCG Meetup',
         'pokemon_tcg', 'sf-gamescape', true, ${startAt}, ${endAt}, 1, 2, 10, true, true, true, true, 'published')
      on conflict (id) do nothing
    `;

    // Rejects source = 'scraped'.
    const scrapedErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-scraped', 'sf', 'friends', 'scraped', 'luma', 'Scraped Event', 'sf-gamescape', true, ${startAt}, ${endAt}, 6)
    `.then(() => "ok", e => String(e.message));
    expect(scrapedErr).not.toBe("ok");

    // Rejects is_public = false.
    const nonPublicErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-private', 'sf', 'friends', 'host_native', 'partiful', 'House Party', 'sf-gamescape', false, ${startAt}, ${endAt}, 6)
    `.then(() => "ok", e => String(e.message));
    expect(nonPublicErr).not.toBe("ok");

    // Rejects approved_external_cap > 15.
    const capErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-cap-16', 'sf', 'friends', 'official_api', 'meetup', 'Too Big', 'sf-gamescape', true, ${startAt}, ${endAt}, 16)
    `.then(() => "ok", e => String(e.message));
    expect(capErr).not.toBe("ok");

    // Rejects hide_guest_list = false and approval_required = false.
    const hideErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap, hide_guest_list)
      values
        ('ext-ev-open-guests', 'sf', 'friends', 'host_native', 'luma', 'Open List', 'sf-gamescape', true, ${startAt}, ${endAt}, 5, false)
    `.then(() => "ok", e => String(e.message));
    expect(hideErr).not.toBe("ok");

    const approvalErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap, approval_required)
      values
        ('ext-ev-no-approval', 'sf', 'friends', 'host_native', 'luma', 'Unscreened', 'sf-gamescape', true, ${startAt}, ${endAt}, 5, false)
    `.then(() => "ok", e => String(e.message));
    expect(approvalErr).not.toBe("ok");
  }, T);

  test("external_event_rsvps & external_prospects enforce stated_age 18..120 (rejects 17) and UNIQUE(city, dedupe_hash) singlePersonaPerProspect", async () => {
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
    const startAt = new Date(WED_14_SF + 48 * HOUR);
    const endAt = new Date(WED_14_SF + 50 * HOUR);

    await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-rsvp-check', 'nyc', 'friends', 'official_api', 'luma', 'NYC Tabletop Night', 'nyc-hex-and-co-union', true, ${startAt}, ${endAt}, 8)
      on conflict (id) do nothing
    `;

    // Adult RSVP succeeds; age 17 and age 121 fail CHECK; invite_attempts = 2 fails CHECK.
    await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-adult-ok', 'ext-ev-rsvp-check', 'luma', 'guest-28', 'Maya', 28, 'Yes 18+, love Pokemon TCG', 'approved')
    `;

    const minorRsvpErr = await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-minor-17', 'ext-ev-rsvp-check', 'luma', 'guest-17', 'Teen', 17, '17', 'pending_approval')
    `.then(() => "ok", e => String(e.message));
    expect(minorRsvpErr).not.toBe("ok");

    const overMaxRsvpErr = await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-age-121', 'ext-ev-rsvp-check', 'luma', 'guest-121', 'Old', 121, '121', 'pending_approval')
    `.then(() => "ok", e => String(e.message));
    expect(overMaxRsvpErr).not.toBe("ok");

    const inviteCapErr = await sql`
      update platform.external_event_rsvps set invite_attempts = 2 where id = 'rsvp-adult-ok'
    `.then(() => "ok", e => String(e.message));
    expect(inviteCapErr).not.toBe("ok");

    // external_prospects: rejects age 17.
    const expiresAt = new Date(WED_14_SF + 30 * DAY);
    const minorProspectErr = await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, expires_at)
      values
        ('ext-p-minor-17', 'sf', 'hinge', 'sf-f', 'hmac_minor_17_test', 'Junior', 17, 'man', ${expiresAt})
    `.then(() => "ok", e => String(e.message));
    expect(minorProspectErr).not.toBe("ok");

    // external_prospects: enforces UNIQUE (city, dedupe_hash) so sibling persona cannot contact same prospect.
    await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, consent_state, expires_at)
      values
        ('ext-p-lock-1', 'sf', 'hinge', 'sf-f', 'hmac_unique_lock_1', 'Alex', 29, 'man', 'intro_single_only', ${expiresAt})
    `;
    const siblingErr = await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, consent_state, expires_at)
      values
        ('ext-p-lock-2', 'sf', 'hinge', 'sf-m', 'hmac_unique_lock_1', 'Alex', 29, 'man', 'intro_single_only', ${expiresAt})
    `.then(() => "ok", e => String(e.message));
    expect(siblingErr).not.toBe("ok");
  }, T);

  test("network.venue_concurrent_holds stores and queries overlapping 2h window headcounts under app-scoped RLS", async () => {
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
    const wStart = new Date(WED_14_SF);
    const wEnd = new Date(WED_14_SF + 2 * HOUR);
    const overlapStart = new Date(WED_14_SF + HOUR);
    const overlapEnd = new Date(WED_14_SF + 3 * HOUR);
    const disjointStart = new Date(WED_14_SF + 4 * HOUR);
    const disjointEnd = new Date(WED_14_SF + 6 * HOUR);

    await sql`
      insert into network.venue_concurrent_holds
        (id, app_id, venue_id, opportunity_id, window_start, window_end, headcount, status)
      values
        ('hold-a', 'friends', 'sf-gamescape', 'opp-f1', ${wStart}, ${wEnd}, 4, 'active'),
        ('hold-b', 'friends', 'sf-gamescape', 'opp-f2', ${overlapStart}, ${overlapEnd}, 3, 'active'),
        ('hold-c', 'friends', 'sf-gamescape', 'opp-f3', ${wStart}, ${wEnd}, 5, 'released'),
        ('hold-d', 'friends', 'sf-gamescape', 'opp-f4', ${disjointStart}, ${disjointEnd}, 4, 'active'),
        ('hold-e', 'slop',    'sf-gamescape', 'opp-s1', ${wStart}, ${wEnd}, 2, 'active')
    `;

    // Cross-app overlapping active headcount in [wStart, wEnd): 4 + 3 + 2 = 9.
    const [totalRow] = (await sql`
      select coalesce(sum(headcount), 0)::int as headcount
      from network.venue_concurrent_holds
      where venue_id = 'sf-gamescape'
        and status = 'active'
        and window_start < ${wEnd}
        and window_end > ${wStart}
    `) as Array<{ headcount: number }>;
    expect(totalRow!.headcount).toBe(9);

    // App-scoped RLS under non-superuser network_service: friends sees 4 + 3 = 7, slop sees 2.
    const readAppOverlap = (appId: string) =>
      sql.begin(async tx => {
        await tx.unsafe("set local role network_service");
        await tx`select set_config('app.app_id', ${appId}, true)`;
        const [r] = (await tx`
          select coalesce(sum(headcount), 0)::int as headcount
          from network.venue_concurrent_holds
          where venue_id = 'sf-gamescape'
            and status = 'active'
            and window_start < ${wEnd}
            and window_end > ${wStart}
        `) as Array<{ headcount: number }>;
        return r!.headcount;
      });
    expect(await readAppOverlap("friends")).toBe(7);
    expect(await readAppOverlap("slop")).toBe(2);
  }, T);

  test("RLS crossAppScoreFirewall: slop reads external prospect tables while peon (app.current_app or app.app_id) sees 0 rows and cannot write", async () => {
    await seedVenuesIntoPg(sql, ALL_SEED_VENUES);
    const expiresAt = new Date(WED_14_SF + 30 * DAY);

    await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, consent_state, expires_at)
      values
        ('fw-p-1', 'sf', 'hinge', 'sf-f', 'hmac_fw_p_1', 'Jordan', 30, 'man', 'intro_single_only', ${expiresAt})
      on conflict (id) do nothing
    `;
    await sql`
      insert into platform.external_sourcing_tickets
        (id, city, app_id, member_id, prospect_id, prospect_dedupe_hash, assigned_persona_id, state)
      values
        ('fw-t-1', 'sf', 'slop', 'm-slop-1', 'fw-p-1', 'hmac_fw_p_1', 'sf-f', 'scouting')
      on conflict (id) do nothing
    `;
    await sql`
      insert into platform.external_prospect_suppressions
        (city, dedupe_hash, reason, permanent)
      values
        ('sf', 'hmac_fw_supp_1', 'stopped', true)
      on conflict (city, dedupe_hash) do nothing
    `;

    const queryAs = (role: "platform_service" | "network_service", guc: "app.current_app" | "app.app_id", appVal: string) =>
      sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select set_config(${guc}, ${appVal}, true)`;
        const prospects = await tx`select id from platform.external_prospects`;
        const tickets = await tx`select id from platform.external_sourcing_tickets`;
        const suppressions = await tx`select dedupe_hash from platform.external_prospect_suppressions`;
        return {
          prospects: prospects.length,
          tickets: tickets.length,
          suppressions: suppressions.length,
        };
      });

    // platform_service with app.current_app = 'slop' reads all 3 tables.
    const slopCounts = await queryAs("platform_service", "app.current_app", "slop");
    expect(slopCounts.prospects).toBeGreaterThanOrEqual(1);
    expect(slopCounts.tickets).toBeGreaterThanOrEqual(1);
    expect(slopCounts.suppressions).toBeGreaterThanOrEqual(1);

    // platform_service with app.current_app = 'peon' sees 0 rows across all 3 tables.
    expect(await queryAs("platform_service", "app.current_app", "peon")).toEqual({
      prospects: 0,
      tickets: 0,
      suppressions: 0,
    });

    // network_service with app.app_id = 'peon' ALSO sees 0 rows across all 3 tables.
    expect(await queryAs("network_service", "app.app_id", "peon")).toEqual({
      prospects: 0,
      tickets: 0,
      suppressions: 0,
    });

    // peon write attempt fails RLS check.
    const peonInsertErr = await sql.begin(async tx => {
      await tx.unsafe("set local role platform_service");
      await tx`select set_config('app.current_app', 'peon', true)`;
      await tx`
        insert into platform.external_prospects
          (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, expires_at)
        values
          ('fw-p-peon', 'sf', 'hinge', 'sf-f', 'hmac_fw_peon', 'Blocked', 29, 'man', ${expiresAt})
      `;
    }).then(() => "ok", e => String(e.message));
    expect(peonInsertErr).toContain("row-level security");
  }, T);
});
