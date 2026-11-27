import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { ALL_SEED_VENUES, CITY_IDS, DAY, getCity, type City } from "@thenetwork/core";
import { seedFiveCities } from "../db/seed.ts";
import { rowsFromGame } from "../db/writer.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import type { ObsCitySummary, ObsVenue } from "../src/types.ts";
import { areaLatLng, cityDayStart, memberGeoPoint, zoneOfArea, zonesForCity } from "../web/store.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 180_000;
const TOKEN = "five-city-test-token-0123456789abcdef";
const AUTH = { authorization: `Bearer ${TOKEN}` };

describe("Observatory five-city helpers and GameSource", () => {
  test("cityDayStart uses each launch city's timezone (NYC stays default)", () => {
    const sample = Date.parse("2026-07-14T12:00:00Z");
    expect(cityDayStart(sample)).toBe(Date.parse("2026-07-14T04:00:00Z"));
    expect(cityDayStart(sample, "nyc")).toBe(Date.parse("2026-07-14T04:00:00Z"));
    expect(cityDayStart(sample, "miami")).toBe(Date.parse("2026-07-14T04:00:00Z"));
    expect(cityDayStart(sample, "chicago")).toBe(Date.parse("2026-07-14T05:00:00Z"));
    expect(cityDayStart(sample, "sf")).toBe(Date.parse("2026-07-14T07:00:00Z"));
    expect(cityDayStart(sample, "la")).toBe(Date.parse("2026-07-14T07:00:00Z"));
  });

  test("zones, neighborhoods and jittered points resolve across all 5 cities", () => {
    for (const city of CITY_IDS) {
      const spec = getCity(city)!;
      const zones = zonesForCity(city);
      expect(zones.length).toBeGreaterThanOrEqual(4);
      const hood = spec.neighborhoods[0]!;
      expect(zoneOfArea(hood.name, city)).toBeTruthy();
      const center = areaLatLng(city, hood.name);
      expect(center).toEqual({ lat: hood.lat, lng: hood.lng });
      const pt = memberGeoPoint(`m-${city}`, city, hood.name);
      expect(Math.abs(pt.lat - hood.lat)).toBeLessThan(0.02);
      expect(Math.abs(pt.lng - hood.lng)).toBeLessThan(0.02);
    }
  });

  test("GameSource supports single launch cities (e.g. chicago) and rowsFromGame uses actual city network id", async () => {
    const g = new GameSource({ seed: 3, personas: 12, days: 2, city: "chicago", pushMs: 3_600_000, tickMs: 3_600_000 });
    await g.init();
    try {
      expect(g.selectedCity()).toBe("chicago");
      expect(g.cities()).toEqual(["chicago"]);
      const cities = await g.loadCities();
      expect(cities.map(c => c.id).sort()).toEqual([...CITY_IDS].sort());
      expect(cities.find(c => c.id === "chicago")?.memberCount).toBe(12);
      const chiVenues = await g.loadVenues("chicago");
      expect(chiVenues.length).toBeGreaterThanOrEqual(12);
      expect(chiVenues.every(v => v.city === "chicago")).toBe(true);
      await g.control({ type: "step", ms: DAY });
      const rows = rowsFromGame(g);
      expect(rows.network_state.map(r => r.id)).toEqual(["ntwrk:chicago"]);
    } finally {
      await g.dispose();
    }
  }, T);
});

describe.skipIf(!pgAvailable)("Observatory five-city seed, RealSource, roles and HTTP endpoints", () => {
  let url: string;
  let sql: SQL;
  let dir: string;
  let obs: ObservatoryServer;
  const sources: RealSource[] = [];

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await seedFiveCities(url, { seed: 1, truncate: true });
    dir = await mkdtemp(join(tmpdir(), "obs-five-cities-"));
    obs = await createServer({
      port: 0, development: false, token: TOKEN, mode: "real",
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: false },
    });
  }, T);

  afterAll(async () => {
    for (const s of sources) await s.dispose();
    await obs?.stop();
    await sql?.close();
    await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("console roles can select platform.venues and platform.cities but not platform.venue_api_cache", async () => {
    const as = <R = any>(role: string, q: (tx: SQL) => Promise<R>) =>
      sql.begin(async tx => { await tx.unsafe(`set local role ${role}`); return q(tx); })
        .then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e: String((e as Error).message) }));
    for (const role of ["network_observatory", "network_observatory_ntwrk", "network_observatory_slop", "network_observatory_peon", "network_observatory_friends"]) {
      const venues = await as(role, tx => tx`select count(*)::int as n from platform.venues`);
      expect([role, venues]).toEqual([role, { ok: true, v: [{ n: ALL_SEED_VENUES.length }] }]);
      const cities = await as(role, tx => tx`select count(*)::int as n from platform.cities`);
      expect([role, cities]).toEqual([role, { ok: true, v: [{ n: CITY_IDS.length }] }]);
      const cache = await as(role, tx => tx`select 1 from platform.venue_api_cache`);
      expect(cache.ok).toBe(false);
    }
  });

  test("seedFiveCities populates all 5 cities, 4 apps, venues, arrivals, visits, rejections, work intros, and zero teen adult contacts", async () => {
    const venueRows = await sql<{ city: City; n: number; visited: number }[]>`
      select city, count(*)::int as n, count(*) filter (where visit_count > 0)::int as visited
      from platform.venues group by city order by city`;
    expect(venueRows.map(r => r.city).sort()).toEqual([...CITY_IDS].sort());
    expect(venueRows.reduce((a, r) => a + r.n, 0)).toBe(ALL_SEED_VENUES.length);
    expect(venueRows.every(r => r.visited > 0)).toBe(true);

    const adultVenues = await sql<{ id: string; age_min: number; all_ages: boolean; is_alcohol_centric: boolean; safety_score: number; transit_score: number }[]>`
      select id, age_min, all_ages, is_alcohol_centric, safety_score, transit_score
      from platform.venues
      where age_min >= 21 or is_bar_only = true or category in ('brewery', 'brewery_garden', 'wine_bar', 'cocktail_bar', 'cocktail_lounge', 'wine_beer_patio')`;
    expect(adultVenues.length).toBeGreaterThan(0);
    expect(adultVenues.every(v => v.all_ages === false && v.is_alcohol_centric === true)).toBe(true);

    const visits = (await sql<{ n: number }[]>`select count(*)::int as n from network.venue_visits`)[0]!.n;
    const rejections = (await sql<{ n: number }[]>`select count(*)::int as n from network.venue_rejections`)[0]!.n;
    const arrivals = (await sql<{ n: number }[]>`select count(*)::int as n from network.meetup_arrivals`)[0]!.n;
    const workIntros = await sql<{ channel: string; n: number }[]>`select channel, count(*)::int as n from network.work_intros group by channel order by channel`;
    expect(visits).toBeGreaterThan(0);
    expect(rejections).toBe(5);
    expect(arrivals).toBeGreaterThan(0);
    expect(workIntros).toEqual([
      { channel: "relay_share", n: 5 },
      { channel: "scheduled_video", n: 5 },
      { channel: "warm_email", n: 5 },
    ]);

    const openApp = async (app: "ntwrk" | "friends" | "slop" | "peon") => {
      const r = new RealSource({ url, app, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
      sources.push(r);
      await r.init();
      return r;
    };

    const [ntwrk, friends, slop, peon] = await Promise.all([
      openApp("ntwrk"), openApp("friends"), openApp("slop"), openApp("peon"),
    ]);

    for (const [app, src] of [["ntwrk", ntwrk], ["friends", friends], ["slop", slop], ["peon", peon]] as const) {
      const st = src.state();
      expect(st.env.error).toBeUndefined();
      expect(Object.keys(st.stats.byCity).sort()).toEqual([...CITY_IDS].sort());
      // PII scrubbed by default ("First L.")
      expect(st.members.every(m => /^\S+( \S\.)?$/.test(m.name))).toBe(true);
      const cityList = await src.loadCities();
      expect(cityList.length).toBe(5);
      for (const c of cityList) {
        expect([app, c.id, c.memberCount > 0, c.opportunityCount > 0, c.venueCount >= 12]).toEqual([app, c.id, true, true, true]);
      }
    }

    // friends, slop, ntwrk opportunities have primary + backup venues
    for (const src of [friends, slop, ntwrk]) {
      const opps = src.state().opportunities;
      expect(opps.length).toBeGreaterThanOrEqual(10);
      expect(opps.every(o => !!o.venue?.id && !!o.backupVenue?.id)).toBe(true);
    }

    // peon work intros have ZERO physical venues and all 3 workIntroChannels
    const peonOpps = peon.state().opportunities;
    expect(peonOpps.length).toBe(15);
    expect(peonOpps.every(o => o.venue === undefined && o.backupVenue === undefined)).toBe(true);
    expect(new Set(peonOpps.map(o => o.workIntroChannel))).toEqual(new Set(["WarmEmail", "ScheduledVideo", "RelayShare"]));

    // ntwrk teen single-player members: 1 per city, 0 opportunities, 0 adult contacts
    const ntwrkState = ntwrk.state();
    const teens = ntwrkState.members.filter(m => m.minor);
    expect(teens.length).toBe(5);
    expect(new Set(teens.map(t => t.city))).toEqual(new Set(CITY_IDS));
    const teenIds = new Set(teens.map(t => t.id));
    expect(ntwrkState.opportunities.some(o => o.participants.some(id => teenIds.has(id)))).toBe(false);
    const minorMetric = ntwrkState.stats.scorecard?.find(m => m.key === "minors_contacted");
    expect(minorMetric?.value).toBe(0);
  }, T);

  test("GET /api/cities and GET /api/venues enforce auth, filter by city, and return 400 on unknown city", async () => {
    expect((await fetch(`${obs.url}/api/cities`)).status).toBe(401);
    expect((await fetch(`${obs.url}/api/venues`)).status).toBe(401);

    const citiesRes = await fetch(`${obs.url}/api/cities?app=friends`, { headers: AUTH });
    expect(citiesRes.status).toBe(200);
    const { cities } = await citiesRes.json() as { cities: ObsCitySummary[] };
    expect(cities.map(c => c.id).sort()).toEqual([...CITY_IDS].sort());
    expect(cities.every(c => c.memberCount === 10 && c.opportunityCount === 3 && c.venueCount >= 12)).toBe(true);

    const allVenuesRes = await fetch(`${obs.url}/api/venues?app=friends`, { headers: AUTH });
    expect(allVenuesRes.status).toBe(200);
    const allVenues = await allVenuesRes.json() as { city: string; venues: ObsVenue[] };
    expect(allVenues.city).toBe("all");
    expect(allVenues.venues.length).toBe(ALL_SEED_VENUES.length);

    const miamiRes = await fetch(`${obs.url}/api/venues?app=friends&city=miami`, { headers: AUTH });
    expect(miamiRes.status).toBe(200);
    const miami = await miamiRes.json() as { city: string; venues: ObsVenue[] };
    expect(miami.city).toBe("miami");
    expect(miami.venues.length).toBeGreaterThanOrEqual(12);
    expect(miami.venues.every(v => v.city === "miami" && v.status === "active" && v.groupScore > 0)).toBe(true);

    const badRes = await fetch(`${obs.url}/api/venues?city=atlantis`, { headers: AUTH });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ code: "unknown_city" });
  }, T);
});
