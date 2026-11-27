import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  DAY,
  HOUR,
  LAUNCH_CITIES,
  fromLocal,
  type VenueRecord,
} from "@thenetwork/core";
import { fileAt } from "../../core/src/runtime/files.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { migrate } from "../../db/migrate.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const WED_14_SF = fromLocal(2026, 11, 18, 14, "America/Los_Angeles");

async function bulkSeedVenuesIntoPg(sql: SQL, venues: readonly VenueRecord[]): Promise<void> {
  const rows = venues.map(v => {
    const isAlcoholCentric = v.isAlcoholCentric ?? v.isBarOnly;
    const ageMin = v.ageMin ?? (v.allAges ? 0 : v.isBarOnly || isAlcoholCentric ? 21 : 18);
    const allAges =
      v.allAges === true && ageMin <= 13 && !v.isBarOnly && !isAlcoholCentric && v.alcoholOptional;
    return {
      id: v.id,
      city: v.city,
      neighborhood: v.neighborhood,
      name: v.name,
      address: v.address,
      lat: v.lat,
      lon: v.lng,
      is_public: v.public,
      all_ages: allAges,
      category: v.category,
      price_tier: v.priceTier,
      age_min: ageMin,
      is_bar_only: v.isBarOnly,
      is_alcohol_centric: isAlcoholCentric,
      alcohol_optional: v.alcoholOptional,
      serves_vegetarian: v.servesVegetarian,
      serves_vegan: v.servesVegan,
      halal_friendly: v.halalFriendly ?? false,
      kosher_friendly: v.kosherFriendly ?? false,
      gluten_free_friendly: v.glutenFreeFriendly ?? false,
      severe_allergen_safe: v.severeAllergenSafe ?? false,
      wheelchair_accessible: v.wheelchairAccessible,
      is_smoke_free: v.isSmokeFree ?? true,
      separate_checks: v.separateChecks,
      walk_in_group_capacity: v.walkInGroupCapacity,
      reservation_required: v.reservationRequired,
      open_event_eligible: v.openEventEligible ?? false,
      noise_level: v.noiseLevel,
      live_music_at_night: v.liveMusicAtNight,
      indoor: v.indoor,
      outdoor: v.outdoor,
      weather_sensitive: v.weatherSensitive,
      safety_score: v.safetyScore ?? 8,
      transit_score: v.transitScore ?? 4,
      arrival_landmark: v.arrivalLandmark,
      hours: v.hours,
      hobbies: v.hobbies ?? [],
      cuisine_tags: v.cuisineTags ?? [],
      source: v.source,
      status: v.status,
      closure_reports: v.closureReports,
      verified_open_at: new Date(v.lastVerifiedAt).toISOString(),
      persona_priors: v.personaPriors,
    };
  });

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
    )
    select
      x.id, x.city, x.neighborhood, x.name, x.address, x.lat, x.lon, x.is_public, x.all_ages,
      x.category, x.price_tier, x.age_min, x.is_bar_only, x.is_alcohol_centric, x.alcohol_optional,
      x.serves_vegetarian, x.serves_vegan, x.halal_friendly, x.kosher_friendly,
      x.gluten_free_friendly, x.severe_allergen_safe, x.wheelchair_accessible, x.is_smoke_free,
      x.separate_checks, x.walk_in_group_capacity, x.reservation_required, x.open_event_eligible,
      x.noise_level, x.live_music_at_night, x.indoor, x.outdoor, x.weather_sensitive,
      x.safety_score, x.transit_score, x.arrival_landmark, x.hours, x.hobbies, x.cuisine_tags,
      x.source, x.status, x.closure_reports, x.verified_open_at, x.persona_priors
    from jsonb_to_recordset(${sql.json(rows as unknown as Parameters<SQL["json"]>[0])}) as x(
      id text,
      city text,
      neighborhood text,
      name text,
      address text,
      lat double precision,
      lon double precision,
      is_public boolean,
      all_ages boolean,
      category text,
      price_tier smallint,
      age_min smallint,
      is_bar_only boolean,
      is_alcohol_centric boolean,
      alcohol_optional boolean,
      serves_vegetarian boolean,
      serves_vegan boolean,
      halal_friendly boolean,
      kosher_friendly boolean,
      gluten_free_friendly boolean,
      severe_allergen_safe boolean,
      wheelchair_accessible boolean,
      is_smoke_free boolean,
      separate_checks boolean,
      walk_in_group_capacity smallint,
      reservation_required boolean,
      open_event_eligible boolean,
      noise_level text,
      live_music_at_night boolean,
      indoor boolean,
      outdoor boolean,
      weather_sensitive boolean,
      safety_score smallint,
      transit_score smallint,
      arrival_landmark text,
      hours jsonb,
      hobbies jsonb,
      cuisine_tags jsonb,
      source text,
      status text,
      closure_reports integer,
      verified_open_at timestamptz,
      persona_priors jsonb
    )
    on conflict (id) do update set
      status = excluded.status,
      verified_open_at = excluded.verified_open_at
  `;
}

describe.skipIf(!pgAvailable)("0098+0100 five-city venues, external events, matchmakers, suppression bridge & slop-only RLS (PostgreSQL)", () => {
  let url = "";
  let sql: SQL;

  beforeAll(async () => {
    url = await migratedDb("meetup_venues_ext");
    sql = new SQL({ url, max: 4 });
    expect(ALL_SEED_VENUES).toHaveLength(75);
    await bulkSeedVenuesIntoPg(sql, ALL_SEED_VENUES);
  }, T);

  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("0001..0101 migrates cleanly and idempotently; verifies city launch_status, 20 app-city networks, 10 personas (no throttled), and 75 bulk-seeded venues", async () => {
    // Re-running migrate on the same DB proves idempotency of 0098..0101.
    await migrate(url, { lockTimeout: "5s" });

    const cities = (await sql`
      select id, launch_status from platform.cities order by id
    `) as Array<{ id: string; launch_status: string }>;
    expect(cities).toEqual([
      { id: "chicago", launch_status: "waitlist" },
      { id: "la", launch_status: "waitlist" },
      { id: "miami", launch_status: "waitlist" },
      { id: "nyc", launch_status: "active" },
      { id: "sf", launch_status: "waitlist" },
    ]);

    const badLaunchStatus = await sql`
      update platform.cities set launch_status = 'beta' where id = 'sf'
    `.then(() => "ok", e => String(e.message));
    expect(badLaunchStatus).not.toBe("ok");

    const networks = (await sql`select id, matching_enabled from platform.networks order by id`) as Array<{
      id: string;
      matching_enabled: boolean;
    }>;
    expect(networks.map(r => `${r.id}:${r.matching_enabled}`)).toEqual([
      "friends:chicago:false", "friends:la:false", "friends:miami:false", "friends:nyc:true", "friends:sf:false",
      "ntwrk:chicago:false", "ntwrk:la:false", "ntwrk:miami:false", "ntwrk:nyc:true", "ntwrk:sf:false",
      "peon:chicago:false", "peon:la:false", "peon:miami:false", "peon:nyc:true", "peon:sf:false",
      "slop:chicago:false", "slop:la:false", "slop:miami:false", "slop:nyc:true", "slop:sf:false",
    ]);

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

    const dupPersonaErr = await sql`
      insert into platform.matchmaker_personas
        (id, city, gender, first_name, tz, bio_disclosure)
      values
        ('sf-f-dup', 'sf', 'female', 'Dup', 'America/Los_Angeles', 'Local matchmaker in SF.')
    `.then(() => "ok", e => String(e.message));
    expect(dupPersonaErr).not.toBe("ok");

    const botErr = await sql`
      update platform.matchmaker_personas set human_operated = false where id = 'sf-f'
    `.then(() => "ok", e => String(e.message));
    expect(botErr).not.toBe("ok");

    const throttledErr = await sql`
      update platform.matchmaker_personas set status = 'throttled' where id = 'sf-f'
    `.then(() => "ok", e => String(e.message));
    expect(throttledErr).not.toBe("ok");

    await sql`update platform.matchmaker_personas set status = 'degraded' where id = 'sf-f'`;
    await sql`update platform.matchmaker_personas set status = 'active' where id = 'sf-f'`;

    const allCount = (await sql`select count(*)::int as c from platform.venues`) as Array<{ c: number }>;
    expect(allCount[0]!.c).toBe(75);
    for (const city of LAUNCH_CITIES) {
      const rows = (await sql`
        select id, category from platform.venues where city = ${city} order by id
      `) as Array<{ id: string; category: string }>;
      expect(rows).toHaveLength(15);
      expect(rows.some(r => r.category === "game_store" || r.category === "board_game_cafe")).toBe(true);
    }
  }, T);

  test("platform.venues enforces all_ages default false, venues_all_ages_policy_check, venues_source_check, and is_public=true", async () => {
    const [defaultRow] = (await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, category, price_tier)
      values
        ('sf-default-all-ages', 'sf', 'Mission District', 'Default Cafe', 37.76, -122.42, true, 'cafe', 1)
      returning all_ages
    `) as Array<{ all_ages: boolean }>;
    expect(defaultRow!.all_ages).toBe(false);
    await sql`delete from platform.venues where id = 'sf-default-all-ages'`;

    const badAgeMin = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, all_ages, age_min, category, price_tier)
      values
        ('sf-bad-all-ages-21', 'sf', 'Mission District', 'Age 21 Spot', 37.76, -122.42, true, true, 21, 'cafe', 1)
    `.then(() => "ok", e => String(e.message));
    expect(badAgeMin).toContain("venues_all_ages_policy_check");

    const badBarOnly = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, all_ages, age_min, is_bar_only, category, price_tier)
      values
        ('sf-bad-all-ages-bar', 'sf', 'Mission District', 'Bar Only Spot', 37.76, -122.42, true, true, 0, true, 'bar', 2)
    `.then(() => "ok", e => String(e.message));
    expect(badBarOnly).toContain("venues_all_ages_policy_check");

    const badAlcoholCentric = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, all_ages, age_min, is_alcohol_centric, category, price_tier)
      values
        ('sf-bad-all-ages-alc', 'sf', 'Mission District', 'Brewery Spot', 37.76, -122.42, true, true, 0, true, 'brewery', 2)
    `.then(() => "ok", e => String(e.message));
    expect(badAlcoholCentric).toContain("venues_all_ages_policy_check");

    const badNotOptional = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, all_ages, age_min, alcohol_optional, category, price_tier)
      values
        ('sf-bad-all-ages-opt', 'sf', 'Mission District', 'Mandatory Drinks', 37.76, -122.42, true, true, 0, false, 'cafe', 1)
    `.then(() => "ok", e => String(e.message));
    expect(badNotOptional).toContain("venues_all_ages_policy_check");

    const badSource = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, category, price_tier, source)
      values
        ('sf-bad-source', 'sf', 'Mission District', 'Scraped Cafe', 37.76, -122.42, true, 'cafe', 1, 'scraped')
    `.then(() => "ok", e => String(e.message));
    expect(badSource).toContain("venues_source_check");

    await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, category, price_tier, source)
      values
        ('sf-good-source', 'sf', 'Mission District', 'Places Cafe', 37.76, -122.42, true, 'cafe', 1, 'places_api')
    `;
    await sql`delete from platform.venues where id = 'sf-good-source'`;

    const privateVenueErr = await sql`
      insert into platform.venues
        (id, city, neighborhood, name, lat, lon, is_public, category, price_tier)
      values
        ('sf-private-home', 'sf', 'Mission District', 'Private Apt', 37.76, -122.42, false, 'community_space', 0)
    `.then(() => "ok", e => String(e.message));
    expect(privateVenueErr).not.toBe("ok");
  }, T);

  test("platform.venue_concurrent_holds replaces dropped network.venue_concurrent_holds with cross-app visibility and denies network_observatory*", async () => {
    const [dropped] = (await sql`
      select to_regclass('network.venue_concurrent_holds') as rel
    `) as Array<{ rel: string | null }>;
    expect(dropped!.rel).toBeNull();

    const wStart = new Date(WED_14_SF);
    const wEnd = new Date(WED_14_SF + 2 * HOUR);
    const overlapStart = new Date(WED_14_SF + HOUR);
    const overlapEnd = new Date(WED_14_SF + 3 * HOUR);
    const disjointStart = new Date(WED_14_SF + 4 * HOUR);
    const disjointEnd = new Date(WED_14_SF + 6 * HOUR);

    await sql`
      insert into platform.venue_concurrent_holds
        (id, app_id, venue_id, opportunity_id, window_start, window_end, headcount, status)
      values
        ('hold-a', 'friends', 'sf-gamescape', 'opp-f1', ${wStart}, ${wEnd}, 4, 'active'),
        ('hold-b', 'friends', 'sf-gamescape', 'opp-f2', ${overlapStart}, ${overlapEnd}, 3, 'active'),
        ('hold-c', 'friends', 'sf-gamescape', 'opp-f3', ${wStart}, ${wEnd}, 5, 'released'),
        ('hold-d', 'friends', 'sf-gamescape', 'opp-f4', ${disjointStart}, ${disjointEnd}, 4, 'active'),
        ('hold-e', 'slop',    'sf-gamescape', 'opp-s1', ${wStart}, ${wEnd}, 2, 'active')
    `;

    const readOverlapAs = (role: "platform_service" | "network_service", appId: string) =>
      sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select set_config('app.app_id', ${appId}, true), set_config('app.current_app', ${appId}, true)`;
        const [r] = (await tx`
          select coalesce(sum(headcount), 0)::int as headcount
          from platform.venue_concurrent_holds
          where venue_id = 'sf-gamescape'
            and status = 'active'
            and window_start < ${wEnd}
            and window_end > ${wStart}
        `) as Array<{ headcount: number }>;
        return r!.headcount;
      });

    expect(await readOverlapAs("network_service", "friends")).toBe(9);
    expect(await readOverlapAs("network_service", "slop")).toBe(9);
    expect(await readOverlapAs("platform_service", "peon")).toBe(9);

    const obsRoles = (await sql`
      select rolname from pg_roles where rolname like 'network_observatory%' order by rolname
    `) as Array<{ rolname: string }>;
    expect(obsRoles.map(r => r.rolname)).toContain("network_observatory");
    expect(obsRoles.map(r => r.rolname)).toContain("network_observatory_slop");
    expect(obsRoles.map(r => r.rolname)).toContain("network_observatory_cross_app");

    for (const { rolname } of obsRoles) {
      const err = await sql.begin(async tx => {
        await tx.unsafe(`set local role ${rolname}`);
        await tx`select count(*) from platform.venue_concurrent_holds`;
      }).then(() => "ok", e => String(e.message));
      expect([rolname, err]).toEqual([rolname, expect.stringContaining("permission denied")]);
    }
  }, T);

  test("platform.external_events enforces review_approved, external_events_publish_gate_check, sanctioned source, public venue, cap <= 15, and RSVP/arrival checks", async () => {
    const cols = ((await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'platform' and table_name = 'external_events'
    `) as Array<{ column_name: string }>).map(r => r.column_name);
    expect(cols).toContain("review_approved");
    expect(cols).not.toContain("human_review_approved");

    const startAt = new Date(WED_14_SF + 24 * HOUR);
    const endAt = new Date(WED_14_SF + 26 * HOUR);

    await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, interest, venue_id, is_public,
         start_at, end_at, confirmed_network_anchors, confirmed_network_total,
         approved_external_cap, hide_guest_list, approval_required, external_crowd_disclosed,
         review_approved, status)
      values
        ('ext-ev-valid-1', 'sf', 'friends', 'host_native', 'luma', 'SF Pokemon TCG Meetup',
         'pokemon_tcg', 'sf-gamescape', true, ${startAt}, ${endAt}, 1, 2, 10, true, true, true, true, 'published')
      on conflict (id) do nothing
    `;

    const unreviewedPubErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at,
         confirmed_network_anchors, approved_external_cap, external_crowd_disclosed, review_approved, status)
      values
        ('ext-ev-unreviewed', 'sf', 'friends', 'host_native', 'luma', 'Unreviewed', 'sf-gamescape', true,
         ${startAt}, ${endAt}, 1, 6, true, false, 'published')
    `.then(() => "ok", e => String(e.message));
    expect(unreviewedPubErr).toContain("external_events_publish_gate_check");

    const noAnchorPubErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at,
         confirmed_network_anchors, approved_external_cap, external_crowd_disclosed, review_approved, status)
      values
        ('ext-ev-no-anchor', 'sf', 'friends', 'host_native', 'luma', 'No Anchor', 'sf-gamescape', true,
         ${startAt}, ${endAt}, 0, 6, true, true, 'published')
    `.then(() => "ok", e => String(e.message));
    expect(noAnchorPubErr).toContain("external_events_publish_gate_check");

    const undisclosedPubErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at,
         confirmed_network_anchors, approved_external_cap, external_crowd_disclosed, review_approved, status)
      values
        ('ext-ev-undisclosed', 'sf', 'friends', 'host_native', 'luma', 'Undisclosed', 'sf-gamescape', true,
         ${startAt}, ${endAt}, 1, 6, false, true, 'active')
    `.then(() => "ok", e => String(e.message));
    expect(undisclosedPubErr).toContain("external_events_publish_gate_check");

    const scrapedErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-scraped', 'sf', 'friends', 'scraped', 'luma', 'Scraped Event', 'sf-gamescape', true, ${startAt}, ${endAt}, 6)
    `.then(() => "ok", e => String(e.message));
    expect(scrapedErr).not.toBe("ok");

    const nonPublicErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-private', 'sf', 'friends', 'host_native', 'partiful', 'House Party', 'sf-gamescape', false, ${startAt}, ${endAt}, 6)
    `.then(() => "ok", e => String(e.message));
    expect(nonPublicErr).not.toBe("ok");

    const capErr = await sql`
      insert into platform.external_events
        (id, city, app_id, source, platform, title, venue_id, is_public, start_at, end_at, approved_external_cap)
      values
        ('ext-ev-cap-16', 'sf', 'friends', 'official_api', 'meetup', 'Too Big', 'sf-gamescape', true, ${startAt}, ${endAt}, 16)
    `.then(() => "ok", e => String(e.message));
    expect(capErr).not.toBe("ok");

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

    await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-adult-ok', 'ext-ev-valid-1', 'luma', 'guest-28', 'Maya', 28, 'Yes 18+, love Pokemon TCG', 'approved')
    `;

    const minorRsvpErr = await sql`
      insert into platform.external_event_rsvps
        (id, event_id, platform, guest_external_id, first_name, stated_age, screening_answer, status)
      values
        ('rsvp-minor-17', 'ext-ev-valid-1', 'luma', 'guest-17', 'Teen', 17, '17', 'pending_approval')
    `.then(() => "ok", e => String(e.message));
    expect(minorRsvpErr).not.toBe("ok");

    const inviteCapErr = await sql`
      update platform.external_event_rsvps set invite_attempts = 2 where id = 'rsvp-adult-ok'
    `.then(() => "ok", e => String(e.message));
    expect(inviteCapErr).not.toBe("ok");

    const expiresAt = new Date(WED_14_SF + 30 * DAY);
    const minorProspectErr = await sql`
      insert into platform.external_prospects
        (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, expires_at)
      values
        ('ext-p-minor-17', 'sf', 'hinge', 'sf-f', 'hmac_minor_17_test', 'Junior', 17, 'man', ${expiresAt})
    `.then(() => "ok", e => String(e.message));
    expect(minorProspectErr).not.toBe("ok");

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

    const arrivalAt = new Date(WED_14_SF);
    await sql`
      insert into network.meetup_arrivals
        (id, app_id, opportunity_id, member_id, state, updated_at)
      values
        ('ma-ok-1', 'slop', 'opp-ma-1', 'm-ma-1', 'en_route', ${arrivalAt})
    `;
    const dupArrivalErr = await sql`
      insert into network.meetup_arrivals
        (id, app_id, opportunity_id, member_id, state, updated_at)
      values
        ('ma-dup-1', 'slop', 'opp-ma-1', 'm-ma-1', 'arrived', ${arrivalAt})
    `.then(() => "ok", e => String(e.message));
    expect(dupArrivalErr).toContain("meetup_arrivals_app_opp_member_key");

    const badArrivalState = await sql`
      insert into network.meetup_arrivals
        (id, app_id, opportunity_id, member_id, state, updated_at)
      values
        ('ma-bad-state', 'slop', 'opp-ma-2', 'm-ma-1', 'teleported', ${arrivalAt})
    `.then(() => "ok", e => String(e.message));
    expect(badArrivalState).toContain("meetup_arrivals_state_check");

    const badArrivalBackup = await sql`
      insert into network.meetup_arrivals
        (id, app_id, opportunity_id, member_id, state, backup_venue_id, updated_at)
      values
        ('ma-bad-fk', 'slop', 'opp-ma-3', 'm-ma-1', 'venue_full', 'nonexistent-venue', ${arrivalAt})
    `.then(() => "ok", e => String(e.message));
    expect(badArrivalBackup).toContain("meetup_arrivals_backup_venue_id_fkey");
  }, T);

  test("platform.external_prospect_suppressions enforces global PK (dedupe_hash)", async () => {
    const [pk] = (await sql`
      select array_agg(a.attname order by k.ord) as cols
      from pg_constraint c
      join unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'platform.external_prospect_suppressions'::regclass
        and c.contype = 'p'
      group by c.conname
    `) as Array<{ cols: string[] }>;
    expect(pk!.cols).toEqual(["dedupe_hash"]);

    await sql`
      insert into platform.external_prospect_suppressions (city, dedupe_hash, reason, permanent)
      values ('sf', 'hmac_global_pk_1', 'stopped', true)
    `;

    const crossCityDupErr = await sql`
      insert into platform.external_prospect_suppressions (city, dedupe_hash, reason, permanent)
      values ('nyc', 'hmac_global_pk_1', 'stopped', true)
    `.then(() => "ok", e => String(e.message));
    expect(crossCityDupErr).toContain("external_prospect_suppressions_pkey");
  }, T);

  test("platform.is_suppressed_phone_hash works before and after apps/marketing/db/schema.sql and denies EXECUTE to network_observatory*", async () => {
    const futureUntil = new Date(Date.now() + 14 * DAY);
    const pastUntil = new Date(Date.now() - DAY);

    await sql`
      insert into platform.external_prospect_suppressions
        (city, dedupe_hash, phone_hash, reason, suppress_until, permanent)
      values
        ('nyc', 'dedupe_ph_perm',    'ph_perm_1',    'stopped', null,           true),
        ('nyc', 'dedupe_ph_active',  'ph_active_1',  'expired', ${futureUntil}, false),
        ('nyc', 'dedupe_ph_expired', 'ph_expired_1', 'expired', ${pastUntil},   false)
      on conflict (dedupe_hash) do nothing
    `;

    const checkSuppressed = async (hash: string) => {
      const [row] = (await sql`select platform.is_suppressed_phone_hash(${hash}) as s`) as Array<{ s: boolean }>;
      return row!.s;
    };

    // Before marketing schema exists: function must succeed without marketing.humans.
    await sql`drop schema if exists marketing cascade`;
    const [beforeReg] = (await sql`select to_regclass('marketing.humans') as rel`) as Array<{ rel: string | null }>;
    expect(beforeReg!.rel).toBeNull();

    expect(await checkSuppressed("ph_perm_1")).toBe(true);
    expect(await checkSuppressed("ph_active_1")).toBe(true);
    expect(await checkSuppressed("ph_expired_1")).toBe(false);
    expect(await checkSuppressed("ph_clean_1")).toBe(false);
    expect(await checkSuppressed("")).toBe(false);

    // Apply apps/marketing/db/schema.sql and verify both tables combine cleanly.
    const marketingSchemaSql = await fileAt(new URL("../../../apps/marketing/db/schema.sql", import.meta.url)).text();
    await sql.unsafe(marketingSchemaSql);

    const [afterReg] = (await sql`select to_regclass('marketing.humans') as rel`) as Array<{ rel: string | null }>;
    expect(afterReg!.rel).not.toBeNull();

    await sql`
      insert into marketing.humans
        (contact_key, display_name, role, source_channel, city, phone_hash, stopped, banned)
      values
        ('mkt-stopped-1', 'Stopped Human', 'community', 'other', 'nyc', 'ph_mkt_stopped_1', true,  false),
        ('mkt-banned-1',  'Banned Human',  'community', 'other', 'nyc', 'ph_mkt_banned_1',  false, true),
        ('mkt-clean-1',   'Clean Human',   'community', 'other', 'nyc', 'ph_mkt_clean_1',   false, false)
      on conflict (contact_key) do nothing
    `;

    expect(await checkSuppressed("ph_perm_1")).toBe(true);
    expect(await checkSuppressed("ph_active_1")).toBe(true);
    expect(await checkSuppressed("ph_expired_1")).toBe(false);
    expect(await checkSuppressed("ph_mkt_stopped_1")).toBe(true);
    expect(await checkSuppressed("ph_mkt_banned_1")).toBe(true);
    expect(await checkSuppressed("ph_mkt_clean_1")).toBe(false);
    expect(await checkSuppressed("ph_clean_1")).toBe(false);

    // platform_service & network_service can execute (SECURITY DEFINER boolean-only), even under peon app context.
    for (const role of ["platform_service", "network_service"] as const) {
      const ok = await sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select set_config('app.current_app', 'peon', true), set_config('app.app_id', 'peon', true)`;
        const [row] = (await tx`select platform.is_suppressed_phone_hash('ph_perm_1') as s`) as Array<{ s: boolean }>;
        return row!.s;
      });
      expect(ok).toBe(true);
    }

    // network_observatory* roles are denied EXECUTE.
    const obsRoles = (await sql`
      select rolname from pg_roles where rolname like 'network_observatory%' order by rolname
    `) as Array<{ rolname: string }>;
    for (const { rolname } of obsRoles) {
      const err = await sql.begin(async tx => {
        await tx.unsafe(`set local role ${rolname}`);
        await tx`select platform.is_suppressed_phone_hash('ph_perm_1')`;
      }).then(() => "ok", e => String(e.message));
      expect([rolname, err]).toEqual([rolname, expect.stringContaining("permission denied")]);
    }
  }, T);

  test("strict fail-closed slop-only RLS on external_prospects, external_sourcing_tickets, and external_prospect_suppressions", async () => {
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
      on conflict (dedupe_hash) do nothing
    `;

    const queryAs = (
      role: "platform_service" | "network_service",
      gucs: { currentApp?: string; appId?: string }
    ) =>
      sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        if (gucs.currentApp !== undefined) {
          await tx`select set_config('app.current_app', ${gucs.currentApp}, true)`;
        }
        if (gucs.appId !== undefined) {
          await tx`select set_config('app.app_id', ${gucs.appId}, true)`;
        }
        const prospects = await tx`select id from platform.external_prospects`;
        const tickets = await tx`select id from platform.external_sourcing_tickets`;
        const suppressions = await tx`select dedupe_hash from platform.external_prospect_suppressions`;
        return {
          prospects: prospects.length,
          tickets: tickets.length,
          suppressions: suppressions.length,
        };
      });

    const writeAs = (
      role: "platform_service" | "network_service",
      gucs: { currentApp?: string; appId?: string },
      table: "external_prospects" | "external_sourcing_tickets" | "external_prospect_suppressions",
      tag: string
    ) =>
      sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        if (gucs.currentApp !== undefined) {
          await tx`select set_config('app.current_app', ${gucs.currentApp}, true)`;
        }
        if (gucs.appId !== undefined) {
          await tx`select set_config('app.app_id', ${gucs.appId}, true)`;
        }
        if (table === "external_prospects") {
          await tx`
            insert into platform.external_prospects
              (id, city, source_platform, assigned_persona_id, dedupe_hash, first_name, stated_age, gender, expires_at)
            values
              (${`fw-w-${tag}`}, 'sf', 'hinge', 'sf-f', ${`hmac_w_${tag}`}, 'WriteTest', 29, 'man', ${expiresAt})
          `;
        } else if (table === "external_sourcing_tickets") {
          await tx`
            insert into platform.external_sourcing_tickets
              (id, city, app_id, member_id, assigned_persona_id, state)
            values
              (${`fw-tw-${tag}`}, 'sf', 'slop', 'm-slop-w', 'sf-f', 'scouting')
          `;
        } else {
          await tx`
            insert into platform.external_prospect_suppressions
              (city, dedupe_hash, reason, permanent)
            values
              ('sf', ${`hmac_sw_${tag}`}, 'stopped', true)
          `;
        }
      }).then(() => "ok", e => String(e.message));

    // slop reads AND writes on both platform_service and network_service.
    for (const [role, gucs, tag] of [
      ["platform_service", { currentApp: "slop" }, "ps_slop"],
      ["network_service", { appId: "slop" }, "ns_slop"],
    ] as const) {
      const counts = await queryAs(role, gucs);
      expect(counts.prospects).toBeGreaterThanOrEqual(1);
      expect(counts.tickets).toBeGreaterThanOrEqual(1);
      expect(counts.suppressions).toBeGreaterThanOrEqual(1);

      expect(await writeAs(role, gucs, "external_prospects", tag)).toBe("ok");
      expect(await writeAs(role, gucs, "external_sourcing_tickets", tag)).toBe("ok");
      expect(await writeAs(role, gucs, "external_prospect_suppressions", tag)).toBe("ok");
    }

    // peon, friends, ntwrk, unset, and mismatched dual-GUC sessions ALL see 0 rows and CANNOT write.
    const blockedCases: Array<[
      "platform_service" | "network_service",
      { currentApp?: string; appId?: string },
      string,
    ]> = [
      ["platform_service", { currentApp: "peon" }, "ps_peon"],
      ["platform_service", { currentApp: "friends" }, "ps_friends"],
      ["platform_service", { currentApp: "ntwrk" }, "ps_ntwrk"],
      ["platform_service", {}, "ps_unset"],
      ["platform_service", { currentApp: "slop", appId: "peon" }, "ps_mismatch"],
      ["network_service", { appId: "peon" }, "ns_peon"],
      ["network_service", { appId: "friends" }, "ns_friends"],
      ["network_service", { appId: "ntwrk" }, "ns_ntwrk"],
      ["network_service", {}, "ns_unset"],
      ["network_service", { currentApp: "friends", appId: "slop" }, "ns_mismatch"],
    ];

    for (const [role, gucs, tag] of blockedCases) {
      expect([tag, await queryAs(role, gucs)]).toEqual([
        tag,
        { prospects: 0, tickets: 0, suppressions: 0 },
      ]);
      for (const table of [
        "external_prospects",
        "external_sourcing_tickets",
        "external_prospect_suppressions",
      ] as const) {
        expect([tag, table, await writeAs(role, gucs, table, `${tag}_${table}`)]).toEqual([
          tag,
          table,
          expect.stringContaining("row-level security"),
        ]);
      }
    }
  }, T);
});
