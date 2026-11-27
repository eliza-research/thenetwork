#!/usr/bin/env -S node --import=tsx
import { parseArgs } from "node:util";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import {
  ALL_SEED_VENUES, CITIES, CITY_IDS, DAY, HOUR, MINUTE, groupVenueRubricScore, seedVenuesForCity, selectWorkIntroChannel,
  type City, type VenueRecord, type VenueStatus, type WorkIntroChannel,
} from "@thenetwork/core";
import { networkId, type AppId } from "../../../packages/platform/src/apps.ts";
import { GameSource } from "../src/sources/game.ts";
import { applySchema, DEV_PG_URL, devPgUp } from "../../../packages/db/dev-pg.ts";
import { pgArray, rowsFromDataset, rowsFromGame, writeRows, type NetworkRows } from "./writer.ts";

export function isLocalUrl(url: string): boolean {
  try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname); } catch { return false; }
}

function toDbVenueStatus(status: VenueStatus): string {
  switch (status) {
    case "SuspectClosed": return "suspect_closed";
    case "ClosedTemporary": return "closed_temporary";
    case "ClosedPermanent": return "closed_permanent";
    default: return "active";
  }
}

function toDbWorkChannel(ch: WorkIntroChannel): "warm_email" | "scheduled_video" | "relay_share" | undefined {
  switch (ch) {
    case "WarmEmail": return "warm_email";
    case "ScheduledVideo": return "scheduled_video";
    case "RelayShare": return "relay_share";
    default: return undefined;
  }
}

function computeScores(v: VenueRecord): { groupScore: number; dateScore: number } {
  const groupScore = groupVenueRubricScore(
    v.separateChecks,
    v.walkInGroupCapacity,
    v.noiseLevel,
    v.liveMusicAtNight,
    v.alcoholOptional,
    v.servesVegetarian,
    v.servesVegan,
    v.safetyScore ?? 8,
    v.indoor,
    v.weatherSensitive,
    v.arrivalLandmark.trim().length > 0,
    v.transitScore ?? 4
  );
  const romanticBoost = v.personaPriors.romantic ? 8 : 0;
  const noiseBoost = v.noiseLevel === "Conversational" ? 10 : v.noiseLevel === "Quiet" ? 8 : 3;
  const dateScore = Math.min(100, Math.max(45, Math.round((v.yelpRating ?? 4.3) * 17 + noiseBoost + romanticBoost)));
  return { groupScore, dateScore };
}

export async function upsertSeedVenues(sql: SQL, venues: readonly VenueRecord[] = ALL_SEED_VENUES): Promise<number> {
  let n = 0;
  await sql.begin(async tx => {
    for (const v of venues) {
      const { groupScore, dateScore } = computeScores(v);
      const priorsJson = JSON.stringify(v.personaPriors ?? {});
      const hoursJson = JSON.stringify(v.hours ?? []);
      const verifiedAt = new Date(v.lastVerifiedAt);
      const dbStatus = toDbVenueStatus(v.status);
      const dbNoise = v.noiseLevel.toLowerCase();
      await tx`
        insert into platform.venues (
          id, city, neighborhood, name, address, lat, lon, is_public, category, price_tier, age_min,
          is_bar_only, alcohol_optional, serves_vegetarian, serves_vegan, wheelchair_accessible,
          separate_checks, walk_in_group_capacity, reservation_required, noise_level, live_music_at_night,
          indoor, outdoor, weather_sensitive, arrival_landmark, hours, group_score, date_score,
          source, yelp_rating, status, closure_reports, verified_open_at, persona_priors, persona_stats, updated_at
        ) values (
          ${v.id}, ${v.city}, ${v.neighborhood}, ${v.name}, ${v.address}, ${v.lat}, ${v.lng}, true, ${v.category}, ${v.priceTier}, ${v.ageMin},
          ${v.isBarOnly}, ${v.alcoholOptional}, ${v.servesVegetarian}, ${v.servesVegan}, ${v.wheelchairAccessible},
          ${v.separateChecks}, ${v.walkInGroupCapacity}, ${v.reservationRequired}, ${dbNoise}, ${v.liveMusicAtNight},
          ${v.indoor}, ${v.outdoor}, ${v.weatherSensitive}, ${v.arrivalLandmark}, ${hoursJson}::jsonb, ${groupScore}, ${dateScore},
          ${v.source}, ${v.yelpRating ?? null}, ${dbStatus}, ${v.closureReports}, ${verifiedAt}, ${priorsJson}::jsonb, ${priorsJson}::jsonb, now()
        )
        on conflict (id) do update set
          city = excluded.city,
          neighborhood = excluded.neighborhood,
          name = excluded.name,
          address = excluded.address,
          lat = excluded.lat,
          lon = excluded.lon,
          category = excluded.category,
          price_tier = excluded.price_tier,
          age_min = excluded.age_min,
          is_bar_only = excluded.is_bar_only,
          alcohol_optional = excluded.alcohol_optional,
          serves_vegetarian = excluded.serves_vegetarian,
          serves_vegan = excluded.serves_vegan,
          wheelchair_accessible = excluded.wheelchair_accessible,
          separate_checks = excluded.separate_checks,
          walk_in_group_capacity = excluded.walk_in_group_capacity,
          reservation_required = excluded.reservation_required,
          noise_level = excluded.noise_level,
          live_music_at_night = excluded.live_music_at_night,
          indoor = excluded.indoor,
          outdoor = excluded.outdoor,
          weather_sensitive = excluded.weather_sensitive,
          arrival_landmark = excluded.arrival_landmark,
          hours = excluded.hours,
          group_score = excluded.group_score,
          date_score = excluded.date_score,
          source = excluded.source,
          yelp_rating = excluded.yelp_rating,
          verified_open_at = excluded.verified_open_at,
          persona_priors = excluded.persona_priors,
          updated_at = now()
      `;
      n++;
    }
  });
  return n;
}

export async function seedFromSim(url: string, opts: { days: number; seed: number; personas?: number; engine?: "engine-v1" | "random" | "off"; city?: City | "all" }) {
  const g = new GameSource({ seed: opts.seed, personas: opts.personas ?? 0, engine: opts.engine ?? "engine-v1", days: Math.max(opts.days, 1), city: opts.city ?? "nyc" });
  await g.init();
  await g.control({ type: "step", ms: opts.days * DAY });
  const rows = rowsFromGame(g);
  const sql = new SQL(url);
  const venues = await upsertSeedVenues(sql);
  const counts = await writeRows(sql, rows, { truncate: true });
  await sql.close();
  return { game: g, counts: { ...counts, venues } };
}

const CITY_AREA_CODES: Record<City, [string, string]> = {
  sf: ["415", "628"],
  nyc: ["212", "646"],
  la: ["310", "213"],
  chicago: ["312", "773"],
  miami: ["305", "786"],
};

const FIRST_NAMES = [
  "Maya", "Devon", "Elena", "Marcus", "Priya", "Julian", "Sofia", "Nolan", "Tessa", "Caleb",
  "Hana", "Mateo", "Chloe", "Darius", "Sienna", "Owen", "Nadia", "Lucas", "Amara", "Gabe",
  "Camila", "Ethan", "Zara", "Liam", "Aisha", "Ben", "Kira", "Rafael", "Mina", "Theo",
  "Leila", "Samir", "Claire", "Isaac", "Yuki", "Victor", "Rory", "Anika", "Diego", "Talia",
];
const LAST_NAMES = ["Chen", "Patel", "Rivera", "Brooks", "Kim", "Okafor", "Alvarez", "Mercer", "Nguyen", "Sato", "Reyes", "Lin", "Foster", "Cruz", "Shah", "Vargas", "Park", "Cole", "Diaz", "Keller"];
const OCCUPATIONS_SOCIAL = ["Product Designer", "Climate Researcher", "Architect", "Staff Engineer", "Documentary Editor", "Ceramicist", "Data Journalist", "Biotech PM", "Music Producer", "Urban Planner"];
const OCCUPATIONS_PEON_CANDIDATE = ["Senior ML Engineer", "Founding Product Designer", "Staff Backend Engineer", "Growth Lead", "Distributed Systems Engineer"];
const OCCUPATIONS_PEON_HIRING = ["VP Engineering", "CTO & Co-founder", "Head of Design", "Engineering Manager"];
const INTEREST_POOLS = [
  ["coffee", "architecture", "books"],
  ["running", "hiking", "food"],
  ["photography", "film", "museums"],
  ["cooking", "wine", "markets"],
  ["startups", "ai", "design"],
  ["live_music", "vinyl", "cycling"],
  ["chess", "writing", "tea"],
  ["climbing", "outdoors", "travel"],
];

const GROUP_CATEGORIES = new Set(["food_hall", "brewery", "brewery_garden", "park", "waterfront_park", "bookstore_cafe", "wine_beer_patio", "board_game_cafe", "community_space"]);
const DATE_CATEGORIES = new Set(["coffee_shop", "wine_bar", "bakery_cafe", "cocktail_lounge", "cafe_tea_bar", "diner", "coffee_casual", "tea_house", "casual_bistro", "dessert_cafe"]);

function emptyRows(app: AppId): NetworkRows {
  return {
    app,
    members: [], channel_identities: [], facets: [], intents: [], presence: [], edges: [], opportunities: [],
    participations: [], review_items: [], messages: [], feedback: [], events: [], matching_runs: [], requests: [], network_state: [],
    venue_visits: [], venue_rejections: [], meetup_arrivals: [], work_intros: [],
  };
}

function scoreComponents(fit: number) {
  return {
    fit, mutualBenefit: +(fit - 0.04).toFixed(2), warmPath: 0.25, novelty: 0.72, timingFit: 0.85,
    activationCost: 0.18, interruptionCost: 0.12, load: 0.1, repetition: 0, socialRisk: 0.05, confidence: 0.88,
  };
}

function makePhone(city: City, seq: number): string {
  const codes = CITY_AREA_CODES[city];
  const code = codes[Math.floor(seq / 90) % codes.length]!;
  const tail = String((seq % 90) + 10).padStart(2, "0");
  return `+1-${code}-555-01${tail}`;
}

export interface FiveCitiesCounts {
  venues: number;
  byApp: Record<AppId, Record<string, number>>;
  totals: {
    members: number;
    opportunities: number;
    venue_visits: number;
    venue_rejections: number;
    meetup_arrivals: number;
    work_intros: number;
    feedback: number;
  };
}

export async function seedFiveCities(url: string, opts: { seed?: number; truncate?: boolean } = {}): Promise<FiveCitiesCounts> {
  const truncate = opts.truncate ?? true;
  const now = Date.now();
  const sql = new SQL(url);
  const venuesCount = await upsertSeedVenues(sql, ALL_SEED_VENUES);

  const venueMetrics = new Map<string, { visits: number; likes: number; dislikes: number; stats: Record<string, { alpha: number; beta: number }> }>();
  for (const v of ALL_SEED_VENUES) {
    venueMetrics.set(v.id, {
      visits: 0, likes: 0, dislikes: 0,
      stats: JSON.parse(JSON.stringify(v.personaPriors ?? { default: { alpha: 8, beta: 2 } })),
    });
  }
  const bumpVenue = (venueId: string, sentiment: "positive" | "neutral" | "negative", archetype: string) => {
    const m = venueMetrics.get(venueId);
    if (!m) return;
    m.visits++;
    if (sentiment === "positive") m.likes++;
    else if (sentiment === "negative") m.dislikes++;
    for (const key of ["default", archetype]) {
      const cur = m.stats[key] ?? { alpha: 4, beta: 2 };
      cur.alpha += sentiment === "positive" ? 2 : sentiment === "neutral" ? 1 : 0;
      cur.beta += sentiment === "negative" ? 2 : sentiment === "neutral" ? 0.5 : 0;
      m.stats[key] = cur;
    }
  };

  const phoneSeq: Record<City, number> = { sf: 0, nyc: 0, la: 0, chicago: 0, miami: 0 };
  const appList: AppId[] = ["ntwrk", "friends", "slop", "peon"];
  const allRows: Record<AppId, NetworkRows> = {
    ntwrk: emptyRows("ntwrk"),
    friends: emptyRows("friends"),
    slop: emptyRows("slop"),
    peon: emptyRows("peon"),
  };

  let nameCursor = (opts.seed ?? 1) * 7;
  const nextName = () => {
    const first = FIRST_NAMES[nameCursor % FIRST_NAMES.length]!;
    const last = LAST_NAMES[Math.floor(nameCursor / 3) % LAST_NAMES.length]!;
    nameCursor++;
    return `${first} ${last}`;
  };

  for (let cIdx = 0; cIdx < CITY_IDS.length; cIdx++) {
    const city = CITY_IDS[cIdx]!;
    const spec = CITIES[city];
    const hoods = spec.neighborhoods;
    const cityVenues = seedVenuesForCity(city);
    const groupVenues = cityVenues.filter(v => GROUP_CATEGORIES.has(v.category) && v.walkInGroupCapacity >= 6);
    const dateVenues = cityVenues.filter(v => DATE_CATEGORIES.has(v.category));
    const pickGroup = (i: number) => groupVenues[i % groupVenues.length] ?? cityVenues[i % cityVenues.length]!;
    const pickDate = (i: number) => dateVenues[i % dateVenues.length] ?? cityVenues[i % cityVenues.length]!;
    const pickBackup = (primary: VenueRecord) =>
      cityVenues.find(v => v.id !== primary.id && v.neighborhood === primary.neighborhood && !v.isBarOnly)
      ?? cityVenues.find(v => v.id !== primary.id && !v.isBarOnly)
      ?? cityVenues[0]!;

    // 1. friends: impromptu 4-person group meetups across neighborhoods
    {
      const r = allRows.friends;
      const memberIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `friends-${city}-${String(i + 1).padStart(2, "0")}`;
        const name = nextName();
        const area = hoods[i % hoods.length]!.name;
        const age = 23 + ((cIdx * 3 + i * 2) % 14);
        const joinedAt = new Date(now - (28 - i * 2) * DAY);
        const interests = INTEREST_POOLS[(cIdx + i) % INTEREST_POOLS.length]!;
        memberIds.push(id);
        r.members.push({
          id, name, home_city: city, home_area: area, account_status: "active", participation_state: i === 9 ? "quiet" : "open",
          opted_out: false, age, invited_by: i > 0 ? memberIds[i - 1] : null, community: `${city}:${area}`,
          occupation: OCCUPATIONS_SOCIAL[(cIdx + i) % OCCUPATIONS_SOCIAL.length], bio: `${spec.shortName} local exploring ${area}.`,
          prefs: { categoriesOptIn: ["social", "events", "hobby"], quietHours: [22, 9], romanceOptIn: false, formats: ["small_group", "event"], maxTravelMinutes: spec.groupMaxMinutes, onlyWhenAsked: false },
          unanswered_proactive: 0, joined_at: joinedAt,
        });
        r.channel_identities.push({ member_id: id, channel: "sms", address: makePhone(city, phoneSeq[city]++), verified_at: joinedAt, is_primary: true });
        r.presence.push({ member_id: id, city, type: "home", areas: pgArray([area]), from_at: joinedAt, to_at: null });
        r.facets.push({
          id: `f-${id}-int`, member_id: id, kind: "interest", value: `Enjoys ${interests.join(", ")} around ${area}`,
          tags: pgArray(interests), privacy_scope: "shareable", provenance: "said", source: "chat", confidence: 0.9, status: "confirmed", sensitive: null, valid_from: joinedAt, valid_to: null,
        });
        r.intents.push({
          id: `i-${id}-grp`, member_id: id, objective: `Join an impromptu small group hangout in ${spec.name}`, category: "social",
          details: `Down for coffee, food halls, or parks near ${area}`, desired_people: "3-5 curious locals", horizon_days: 30, status: "active", created_at: joinedAt,
        });
      }
      const groupDefs = [
        { idx: 0, state: "FEEDBACK_COLLECTED", members: memberIds.slice(0, 4), offsetMs: -3 * DAY, primary: pickGroup(0), objective: `Impromptu ${spec.shortName} food hall & coffee hangout` },
        { idx: 1, state: "SCHEDULED", members: memberIds.slice(3, 7), offsetMs: 18 * HOUR, primary: pickGroup(1), objective: `Afternoon group meetup in ${spec.name}` },
        { idx: 2, state: "IN_REVIEW", members: memberIds.slice(6, 10), offsetMs: 3 * DAY, primary: pickGroup(2), objective: `Weekend neighborhood park & brewery group in ${spec.shortName}` },
      ];
      for (const g of groupDefs) {
        const oppId = `opp-friends-${city}-${g.idx + 1}`;
        const backup = pickBackup(g.primary);
        const meetingAt = new Date(now + g.offsetMs);
        const createdAt = new Date(now + g.offsetMs - 2 * DAY);
        const updatedAt = new Date(g.state === "FEEDBACK_COLLECTED" ? now - DAY : now - 2 * HOUR);
        const explanations = Object.fromEntries(g.members.map(mid => [mid, `Small ${spec.shortName} group gathering at ${g.primary.name} (${g.primary.neighborhood})`]));
        r.opportunities.push({
          id: oppId, kind: "group", state: g.state, source: "engine", generator: "friends_group_v1", category: "social", city,
          objective: g.objective, score: +(0.79 + g.idx * 0.04).toFixed(2), components: scoreComponents(0.84), explanations, exploration: g.idx === 2,
          window_start: new Date(now + g.offsetMs - 2 * HOUR), window_end: new Date(now + g.offsetMs + 2 * HOUR),
          meeting_at: g.state === "IN_REVIEW" ? null : meetingAt, reason: g.state === "IN_REVIEW" ? "waiting for review (nobody contacted)" : null,
          run_id: null, venue_id: g.primary.id, backup_venue_id: backup.id, work_intro_channel: null,
          followup_scheduled_at: g.state !== "IN_REVIEW" ? new Date(meetingAt.getTime() + 3 * HOUR) : null,
          followup_sent_at: g.state === "FEEDBACK_COLLECTED" ? new Date(meetingAt.getTime() + 3 * HOUR) : null,
          created_at: createdAt, updated_at: updatedAt,
        });
        r.review_items.push({
          opportunity_id: oppId, queued_at: createdAt, deadline: new Date(createdAt.getTime() + 24 * HOUR),
          decision: g.state === "IN_REVIEW" ? null : "approve", reason: null, note: g.state === "IN_REVIEW" ? null : "Good midpoint and walk-in group capacity",
          reviewer: g.state === "IN_REVIEW" ? null : "staff:seed", decided_at: g.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + HOUR),
          origin: "engine", seconds_spent: g.state === "IN_REVIEW" ? null : 24, edits: null, rerolls: 0, invalidated: null,
        });
        r.events.push({
          at: createdAt, actor_type: "agent", actor_id: null, type: "venue", object_type: "opportunity", object_id: oppId,
          payload: { oppId, venueId: g.primary.id, venue: g.primary.name, lat: g.primary.lat, lng: g.primary.lng, neighborhood: g.primary.neighborhood, backupVenueId: backup.id },
        });
        for (let k = 0; k < g.members.length; k++) {
          const mid = g.members[k]!;
          const pStatus = g.state === "FEEDBACK_COLLECTED" ? "attended" : g.state === "SCHEDULED" ? "confirmed" : "pending";
          r.participations.push({
            opportunity_id: oppId, member_id: mid, role: "participant", status: pStatus, booked_told: g.state !== "IN_REVIEW",
            enjoyment: g.state === "FEEDBACK_COLLECTED" ? +(0.78 + (k % 3) * 0.07).toFixed(2) : null,
            invited_at: g.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + 2 * HOUR),
            responded_at: g.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + 4 * HOUR),
          });
          if (g.state !== "IN_REVIEW") {
            r.messages.push({
              id: `msg-${oppId}-${k}`, member_id: mid, direction: "outbound", channel: "sms",
              body: `You're set for ${g.primary.name} (${g.primary.neighborhood}). Look for the group: ${g.primary.arrivalLandmark}. Backup nearby: ${backup.name}.`,
              status: "delivered", type: "proposal", opportunity_id: oppId, proactive: true, system: false, ts: new Date(createdAt.getTime() + 3 * HOUR),
            });
          }
          if (g.state === "FEEDBACK_COLLECTED") {
            const sentiment = k === 3 ? "neutral" : "positive";
            r.venue_visits!.push({
              id: `vv-${oppId}-${k}`, member_id: mid, venue_id: g.primary.id, opportunity_id: oppId,
              visited_at: meetingAt, sentiment, issues: JSON.stringify(k === 3 ? ["crowded"] : []), closed_report: false,
            });
            r.feedback.push({
              from_id: mid, opportunity_id: oppId, about_id: null, sentiment, would_meet_again: true,
              text: `${g.primary.name} worked smoothly for a group of four and separate checks were easy.`, at: new Date(meetingAt.getTime() + 4 * HOUR),
              venue_id: g.primary.id, venue_sentiment: sentiment === "positive" ? "great" : "ok", venue_closed_report: false, venue_issues: JSON.stringify(k === 3 ? ["crowded"] : []),
            });
            r.meetup_arrivals!.push({
              id: `arr-${oppId}-${k}`, opportunity_id: oppId, member_id: mid, state: "met", eta_mins: 0,
              safe_cue: "by the landmark table", backup_venue_id: null, updated_at: new Date(meetingAt.getTime() + 10 * MINUTE),
            });
            bumpVenue(g.primary.id, sentiment, "social");
          } else if (g.state === "SCHEDULED") {
            const arrState = k === 0 ? "seated" : k === 1 ? "arrived" : "en_route";
            r.meetup_arrivals!.push({
              id: `arr-${oppId}-${k}`, opportunity_id: oppId, member_id: mid, state: arrState, eta_mins: arrState === "en_route" ? 6 + k * 2 : 0,
              safe_cue: arrState === "seated" ? "patio table near the entrance" : "blue jacket", backup_venue_id: null, updated_at: new Date(now - (15 - k * 3) * MINUTE),
            });
          }
        }
        if (g.state === "FEEDBACK_COLLECTED") {
          for (let a = 0; a < g.members.length; a++) {
            for (let b = a + 1; b < g.members.length; b++) {
              r.edges.push({ from_id: g.members[a]!, to_id: g.members[b]!, type: "met", strength: 0.7, explicit: false, created_at: meetingAt });
              r.edges.push({ from_id: g.members[a]!, to_id: g.members[b]!, type: "enjoyed", strength: 0.85, explicit: false, created_at: meetingAt });
            }
          }
        }
      }
      r.network_state.push({
        id: networkId("friends", city), version: 1, saved_at: new Date(now),
        state: {
          matchingEnabled: true, deferred: [], trust: [], cases: [],
          counters: { reviewApproved: 2, reviewRejected: 0, reviewExpired: 0 },
          gateReasons: {},
          members: memberIds.map(id => ({ id, minor: false })),
        },
      });
    }

    // 2. slop: 1-on-1 adult dating encounters across neighborhoods
    {
      const r = allRows.slop;
      const memberIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        const id = `slop-${city}-${String(i + 1).padStart(2, "0")}`;
        const name = nextName();
        const area = hoods[(i + 1) % hoods.length]!.name;
        const age = 24 + ((cIdx * 2 + i * 2) % 12);
        const joinedAt = new Date(now - (22 - i * 2) * DAY);
        memberIds.push(id);
        r.members.push({
          id, name, home_city: city, home_area: area, account_status: "active", participation_state: "normal",
          opted_out: false, age, invited_by: null, community: `${city}:${area}`,
          occupation: OCCUPATIONS_SOCIAL[(cIdx * 2 + i) % OCCUPATIONS_SOCIAL.length], bio: `${spec.shortName} dating profile in ${area}.`,
          prefs: { categoriesOptIn: ["romance"], quietHours: [21, 9], romanceOptIn: true, formats: ["one_to_one"], maxTravelMinutes: spec.dateMaxMinutes, onlyWhenAsked: false },
          unanswered_proactive: 0, joined_at: joinedAt,
        });
        r.channel_identities.push({ member_id: id, channel: "sms", address: makePhone(city, phoneSeq[city]++), verified_at: joinedAt, is_primary: true });
        r.presence.push({ member_id: id, city, type: "home", areas: pgArray([area]), from_at: joinedAt, to_at: null });
        r.facets.push({
          id: `f-${id}-ver`, member_id: id, kind: "fact", value: "Age verified 18+", tags: pgArray(["verify:age:pass"]),
          privacy_scope: "agent_private", provenance: "connected_source", source: "chat", confidence: 1, status: "confirmed", sensitive: null, valid_from: joinedAt, valid_to: null,
        });
        r.facets.push({
          id: `f-${id}-act`, member_id: id, kind: "preference", value: `Coffee or wine first date near ${area}`, tags: pgArray(["activity:coffee", "activity:wine"]),
          privacy_scope: "matchable", provenance: "said", source: "chat", confidence: 0.9, status: "confirmed", sensitive: null, valid_from: joinedAt, valid_to: null,
        });
      }
      const dateDefs = [
        { idx: 0, state: "FEEDBACK_COLLECTED", pair: [memberIds[0]!, memberIds[1]!], offsetMs: -2 * DAY, primary: pickDate(0) },
        { idx: 1, state: "SCHEDULED", pair: [memberIds[2]!, memberIds[3]!], offsetMs: 12 * HOUR, primary: pickDate(1) },
        { idx: 2, state: "IN_REVIEW", pair: [memberIds[4]!, memberIds[5]!], offsetMs: 2 * DAY, primary: pickDate(2) },
      ];
      for (const d of dateDefs) {
        const oppId = `opp-slop-${city}-${d.idx + 1}`;
        const backup = pickBackup(d.primary);
        const meetingAt = new Date(now + d.offsetMs);
        const createdAt = new Date(now + d.offsetMs - 2 * DAY);
        const updatedAt = new Date(d.state === "FEEDBACK_COLLECTED" ? now - 16 * HOUR : now - HOUR);
        r.opportunities.push({
          id: oppId, kind: "intro", state: d.state, source: "engine", generator: "slop_date_v1", category: "romance", city,
          objective: `First date in ${spec.shortName} (${d.primary.neighborhood})`, score: +(0.82 + d.idx * 0.03).toFixed(2),
          components: scoreComponents(0.86),
          explanations: Object.fromEntries(d.pair.map(mid => [mid, `Conversational spot at ${d.primary.name} (${d.primary.neighborhood})`])),
          exploration: false, window_start: new Date(now + d.offsetMs - HOUR), window_end: new Date(now + d.offsetMs + 2 * HOUR),
          meeting_at: d.state === "IN_REVIEW" ? null : meetingAt, reason: d.state === "IN_REVIEW" ? "waiting for review (nobody contacted)" : null,
          run_id: null, venue_id: d.primary.id, backup_venue_id: backup.id, work_intro_channel: null,
          followup_scheduled_at: d.state !== "IN_REVIEW" ? new Date(meetingAt.getTime() + 14 * HOUR) : null,
          followup_sent_at: d.state === "FEEDBACK_COLLECTED" ? new Date(meetingAt.getTime() + 14 * HOUR) : null,
          created_at: createdAt, updated_at: updatedAt,
        });
        r.review_items.push({
          opportunity_id: oppId, queued_at: createdAt, deadline: new Date(createdAt.getTime() + 24 * HOUR),
          decision: d.state === "IN_REVIEW" ? null : "approve", reason: null, note: d.state === "IN_REVIEW" ? null : "Verified 18+, fair midpoint",
          reviewer: d.state === "IN_REVIEW" ? null : "staff:seed", decided_at: d.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + HOUR),
          origin: "engine", seconds_spent: d.state === "IN_REVIEW" ? null : 18, edits: null, rerolls: 0, invalidated: null,
        });
        r.events.push({
          at: createdAt, actor_type: "agent", actor_id: null, type: "venue", object_type: "opportunity", object_id: oppId,
          payload: { oppId, venueId: d.primary.id, venue: d.primary.name, lat: d.primary.lat, lng: d.primary.lng, neighborhood: d.primary.neighborhood, backupVenueId: backup.id },
        });
        for (let k = 0; k < d.pair.length; k++) {
          const mid = d.pair[k]!;
          r.participations.push({
            opportunity_id: oppId, member_id: mid, role: "participant",
            status: d.state === "FEEDBACK_COLLECTED" ? "attended" : d.state === "SCHEDULED" ? "confirmed" : "pending",
            booked_told: d.state !== "IN_REVIEW",
            enjoyment: d.state === "FEEDBACK_COLLECTED" ? 0.88 : null,
            invited_at: d.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + 2 * HOUR),
            responded_at: d.state === "IN_REVIEW" ? null : new Date(createdAt.getTime() + 3 * HOUR),
          });
          if (d.state === "FEEDBACK_COLLECTED") {
            r.venue_visits!.push({
              id: `vv-${oppId}-${k}`, member_id: mid, venue_id: d.primary.id, opportunity_id: oppId,
              visited_at: meetingAt, sentiment: "positive", issues: "[]", closed_report: false,
            });
            r.feedback.push({
              from_id: mid, opportunity_id: oppId, about_id: d.pair[1 - k]!, sentiment: "positive", would_meet_again: true,
              text: `Great conversation at ${d.primary.name}, calm vibe and easy landmark.`, at: new Date(meetingAt.getTime() + 15 * HOUR),
              venue_id: d.primary.id, venue_sentiment: "great", venue_closed_report: false, venue_issues: "[]",
            });
            r.meetup_arrivals!.push({
              id: `arr-${oppId}-${k}`, opportunity_id: oppId, member_id: mid, state: "met", eta_mins: 0,
              safe_cue: "near the front counter", backup_venue_id: null, updated_at: new Date(meetingAt.getTime() + 5 * MINUTE),
            });
            bumpVenue(d.primary.id, "positive", "romantic");
          } else if (d.state === "SCHEDULED") {
            r.meetup_arrivals!.push({
              id: `arr-${oppId}-${k}`, opportunity_id: oppId, member_id: mid, state: k === 0 ? "arrived" : "en_route",
              eta_mins: k === 0 ? 0 : 7, safe_cue: k === 0 ? "window table" : "green scarf", backup_venue_id: null,
              updated_at: new Date(now - (10 - k * 4) * MINUTE),
            });
          }
        }
        if (d.state === "FEEDBACK_COLLECTED") {
          r.edges.push({ from_id: d.pair[0]!, to_id: d.pair[1]!, type: "met", strength: 0.8, explicit: false, created_at: meetingAt });
          r.edges.push({ from_id: d.pair[0]!, to_id: d.pair[1]!, type: "would_interact_again", strength: 0.9, explicit: false, created_at: meetingAt });
        }
      }
      const rejectedVenue = cityVenues[cityVenues.length - 1]!;
      r.venue_rejections!.push({
        member_id: memberIds[6]!, venue_id: rejectedVenue.id, reason: "too_expensive", rejected_at: new Date(now - 5 * DAY),
      });
      r.network_state.push({
        id: networkId("slop", city), version: 1, saved_at: new Date(now),
        state: {
          matchingEnabled: true, deferred: [], trust: [], cases: [],
          counters: { reviewApproved: 2, reviewRejected: 0, reviewExpired: 0 },
          gateReasons: {},
          members: memberIds.map(id => ({ id, minor: false })),
        },
      });
    }

    // 3. peon: work intros with ZERO physical venues (warm_email, scheduled_video, relay_share)
    {
      const r = allRows.peon;
      const candidates: string[] = [];
      const managers: string[] = [];
      for (let i = 0; i < 8; i++) {
        const isMgr = i >= 5;
        const id = `peon-${city}-${isMgr ? "mgr" : "cand"}-${String(i + 1).padStart(2, "0")}`;
        const name = nextName();
        const area = hoods[(i + 2) % hoods.length]!.name;
        const age = 26 + ((cIdx * 3 + i * 2) % 16);
        const joinedAt = new Date(now - (20 - i) * DAY);
        const role = isMgr ? OCCUPATIONS_PEON_HIRING[i % OCCUPATIONS_PEON_HIRING.length]! : OCCUPATIONS_PEON_CANDIDATE[i % OCCUPATIONS_PEON_CANDIDATE.length]!;
        if (isMgr) managers.push(id); else candidates.push(id);
        r.members.push({
          id, name, home_city: city, home_area: area, account_status: "active", participation_state: "normal",
          opted_out: false, age, invited_by: null, community: `${city}:${isMgr ? "employers" : "talent"}`,
          occupation: role, bio: `${role} in ${spec.name} (${area}).`,
          prefs: { categoriesOptIn: ["professional"], quietHours: [20, 8], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 0, onlyWhenAsked: false },
          unanswered_proactive: 0, joined_at: joinedAt,
        });
        r.channel_identities.push({ member_id: id, channel: "sms", address: makePhone(city, phoneSeq[city]++), verified_at: joinedAt, is_primary: true });
        r.channel_identities.push({ member_id: id, channel: "email", address: `${id}@example.test`, verified_at: joinedAt, is_primary: false });
        r.presence.push({ member_id: id, city, type: "home", areas: pgArray([area]), from_at: joinedAt, to_at: null });
        r.facets.push({
          id: `f-${id}-role`, member_id: id, kind: isMgr ? "offer" : "skill", value: `${role} (${spec.shortName} / hybrid)`,
          tags: pgArray([isMgr ? "peon:entity:job" : "peon:entity:candidate", `market:${city}`, "mode:hybrid"]),
          privacy_scope: "matchable", provenance: "said", source: "chat", confidence: 0.95, status: "confirmed", sensitive: null, valid_from: joinedAt, valid_to: null,
        });
      }
      const introSpecs = [
        { idx: 0, cand: candidates[0]!, mgr: managers[0]!, candHasEmail: true, mgrHasEmail: true, mutualSlotConfirmed: false, wantsVideo: false, state: "COMPLETED", stage: "followed_up", offsetMs: -4 * DAY },
        { idx: 1, cand: candidates[1]!, mgr: managers[1]!, candHasEmail: true, mgrHasEmail: true, mutualSlotConfirmed: true, wantsVideo: true, state: "SCHEDULED", stage: "scheduled", offsetMs: 24 * HOUR },
        { idx: 2, cand: candidates[2]!, mgr: managers[2]!, candHasEmail: false, mgrHasEmail: false, mutualSlotConfirmed: false, wantsVideo: false, state: "MUTUALLY_ACCEPTED", stage: "introduced", offsetMs: 48 * HOUR },
      ];
      for (const w of introSpecs) {
        const chosen = selectWorkIntroChannel({
          candAge: 30, mgrAge: 36, candOptedIn: true, mgrOptedIn: true,
          candHasEmail: w.candHasEmail, mgrHasEmail: w.mgrHasEmail,
          mutualSlotConfirmed: w.mutualSlotConfirmed, wantsVideo: w.wantsVideo,
        });
        const channel = toDbWorkChannel(chosen);
        if (!channel) continue;
        const oppId = `opp-peon-${city}-${w.idx + 1}`;
        const createdAt = new Date(now + w.offsetMs - 3 * DAY);
        const introAt = new Date(now + w.offsetMs - 2 * DAY);
        const slotAt = channel === "scheduled_video" ? new Date(now + w.offsetMs) : null;
        const followupDue = new Date(introAt.getTime() + 72 * HOUR);
        const followupSent = w.stage === "followed_up" ? new Date(introAt.getTime() + 73 * HOUR) : null;
        r.opportunities.push({
          id: oppId, kind: "intro", state: w.state, source: "engine", generator: "peon_work_intro_v1", category: "professional", city,
          objective: `Work intro (${channel.replace(/_/g, " ")}) — ${spec.shortName} engineering role`, score: +(0.85 + w.idx * 0.03).toFixed(2),
          components: scoreComponents(0.89),
          explanations: {
            [w.cand]: `Warm ${channel.replace(/_/g, " ")} intro after double opt-in (no physical meetup required)`,
            [w.mgr]: `Vetted ${spec.shortName} candidate matched on skills & seniority`,
          },
          exploration: false, window_start: null, window_end: null,
          meeting_at: slotAt, reason: null, run_id: null,
          venue_id: null, backup_venue_id: null, work_intro_channel: channel,
          followup_scheduled_at: followupDue, followup_sent_at: followupSent,
          created_at: createdAt, updated_at: new Date(now - 2 * HOUR),
        });
        r.participations.push(
          { opportunity_id: oppId, member_id: w.cand, role: "participant", status: w.state === "COMPLETED" ? "attended" : "confirmed", booked_told: true, enjoyment: w.state === "COMPLETED" ? 0.9 : null, invited_at: createdAt, responded_at: introAt },
          { opportunity_id: oppId, member_id: w.mgr, role: "participant", status: w.state === "COMPLETED" ? "attended" : "confirmed", booked_told: true, enjoyment: w.state === "COMPLETED" ? 0.86 : null, invited_at: createdAt, responded_at: introAt },
        );
        r.review_items.push({
          opportunity_id: oppId, queued_at: createdAt, deadline: new Date(createdAt.getTime() + 24 * HOUR),
          decision: "approve", reason: null, note: `${channel} work intro (zero physical venue)`,
          reviewer: "staff:seed", decided_at: new Date(createdAt.getTime() + 30 * MINUTE),
          origin: "engine", seconds_spent: 15, edits: null, rerolls: 0, invalidated: null,
        });
        r.work_intros!.push({
          opportunity_id: oppId, channel, intro_sent_at: introAt,
          slot_confirmed_at: slotAt ? new Date(introAt.getTime() + 4 * HOUR) : null,
          meet_url: channel === "scheduled_video" ? `https://meet.ntwrk.party/peon/${oppId}` : null,
          followup_due_at: followupDue, followup_sent_at: followupSent, stage: w.stage, updated_at: new Date(now - HOUR),
        });
        r.edges.push({ from_id: w.cand, to_id: w.mgr, type: "introduced", strength: 0.75, explicit: false, created_at: introAt });
      }
      r.network_state.push({
        id: networkId("peon", city), version: 1, saved_at: new Date(now),
        state: {
          matchingEnabled: true, deferred: [], trust: [], cases: [],
          counters: { reviewApproved: 3, reviewRejected: 0, reviewExpired: 0 },
          gateReasons: {},
          members: [...candidates, ...managers].map(id => ({ id, minor: false })),
        },
      });
    }

    // 4. ntwrk: multi-city social/hobby intros + 1 single-player teen per city with zero adult contacts
    {
      const r = allRows.ntwrk;
      const memberIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const isMinorMember = i === 9;
        const id = `ntwrk-${city}-${String(i + 1).padStart(2, "0")}`;
        const name = nextName();
        const area = hoods[i % hoods.length]!.name;
        const age = isMinorMember ? 16 : 25 + ((cIdx * 4 + i * 3) % 18);
        const joinedAt = new Date(now - (30 - i * 2) * DAY);
        memberIds.push(id);
        r.members.push({
          id, name, home_city: city, home_area: area, account_status: "active", participation_state: isMinorMember ? "quiet" : "normal",
          opted_out: false, age, invited_by: i > 0 && !isMinorMember ? memberIds[i - 1] : null, community: `${city}:${area}`,
          occupation: isMinorMember ? "Student" : OCCUPATIONS_SOCIAL[(cIdx + i + 2) % OCCUPATIONS_SOCIAL.length],
          bio: isMinorMember ? `High school student in ${spec.name}.` : `Lives in ${area}, ${spec.name}.`,
          prefs: { categoriesOptIn: ["social", "hobby", "growth"], quietHours: [22, 9], romanceOptIn: false, formats: ["one_to_one", "small_group"], maxTravelMinutes: spec.dateMaxMinutes, onlyWhenAsked: false },
          unanswered_proactive: 0, joined_at: joinedAt,
        });
        r.channel_identities.push({ member_id: id, channel: "sms", address: makePhone(city, phoneSeq[city]++), verified_at: joinedAt, is_primary: true });
        r.presence.push({ member_id: id, city, type: "home", areas: pgArray([area]), from_at: joinedAt, to_at: null });
        const tags = INTEREST_POOLS[(cIdx * 2 + i) % INTEREST_POOLS.length]!;
        r.facets.push({
          id: `f-${id}-int`, member_id: id, kind: "interest", value: `Interested in ${tags.join(", ")}`,
          tags: pgArray(tags), privacy_scope: "shareable", provenance: "said", source: "chat", confidence: 0.88, status: "confirmed", sensitive: null, valid_from: joinedAt, valid_to: null,
        });
      }
      const ntwrkDefs = [
        { idx: 0, kind: "intro", state: "FEEDBACK_COLLECTED", members: [memberIds[0]!, memberIds[1]!], offsetMs: -5 * DAY, primary: pickDate(0) },
        { idx: 1, kind: "group", state: "SCHEDULED", members: [memberIds[2]!, memberIds[3]!, memberIds[4]!], offsetMs: 2 * DAY, primary: pickGroup(0) },
      ];
      for (const nd of ntwrkDefs) {
        const oppId = `opp-ntwrk-${city}-${nd.idx + 1}`;
        const backup = pickBackup(nd.primary);
        const meetingAt = new Date(now + nd.offsetMs);
        const createdAt = new Date(now + nd.offsetMs - 2 * DAY);
        r.opportunities.push({
          id: oppId, kind: nd.kind, state: nd.state, source: "engine", generator: "shared_interest", category: "hobby", city,
          objective: `${spec.shortName} ${nd.kind === "group" ? "hobby group" : "coffee intro"} at ${nd.primary.name}`,
          score: 0.83, components: scoreComponents(0.83),
          explanations: Object.fromEntries(nd.members.map(mid => [mid, `Shared interests in ${spec.name} near ${nd.primary.neighborhood}`])),
          exploration: false, window_start: new Date(now + nd.offsetMs - HOUR), window_end: new Date(now + nd.offsetMs + 2 * HOUR),
          meeting_at: meetingAt, reason: null, run_id: null, venue_id: nd.primary.id, backup_venue_id: backup.id, work_intro_channel: null,
          followup_scheduled_at: new Date(meetingAt.getTime() + 3 * HOUR),
          followup_sent_at: nd.state === "FEEDBACK_COLLECTED" ? new Date(meetingAt.getTime() + 3 * HOUR) : null,
          created_at: createdAt, updated_at: new Date(now - 3 * HOUR),
        });
        r.review_items.push({
          opportunity_id: oppId, queued_at: createdAt, deadline: new Date(createdAt.getTime() + 24 * HOUR),
          decision: "approve", reason: null, note: "Verified adults, public venue", reviewer: "staff:seed",
          decided_at: new Date(createdAt.getTime() + HOUR), origin: "engine", seconds_spent: 20, edits: null, rerolls: 0, invalidated: null,
        });
        r.events.push({
          at: createdAt, actor_type: "agent", actor_id: null, type: "venue", object_type: "opportunity", object_id: oppId,
          payload: { oppId, venueId: nd.primary.id, venue: nd.primary.name, lat: nd.primary.lat, lng: nd.primary.lng, neighborhood: nd.primary.neighborhood, backupVenueId: backup.id },
        });
        for (let k = 0; k < nd.members.length; k++) {
          const mid = nd.members[k]!;
          r.participations.push({
            opportunity_id: oppId, member_id: mid, role: "participant",
            status: nd.state === "FEEDBACK_COLLECTED" ? "attended" : "confirmed",
            booked_told: true,
            enjoyment: nd.state === "FEEDBACK_COLLECTED" ? 0.85 : null,
            invited_at: new Date(createdAt.getTime() + 2 * HOUR), responded_at: new Date(createdAt.getTime() + 4 * HOUR),
          });
          if (nd.state === "FEEDBACK_COLLECTED") {
            r.venue_visits!.push({
              id: `vv-${oppId}-${k}`, member_id: mid, venue_id: nd.primary.id, opportunity_id: oppId,
              visited_at: meetingAt, sentiment: "positive", issues: "[]", closed_report: false,
            });
            r.feedback.push({
              from_id: mid, opportunity_id: oppId, about_id: null, sentiment: "positive", would_meet_again: true,
              text: `Easy to meet at ${nd.primary.name} in ${nd.primary.neighborhood}.`, at: new Date(meetingAt.getTime() + 4 * HOUR),
              venue_id: nd.primary.id, venue_sentiment: "great", venue_closed_report: false, venue_issues: "[]",
            });
            r.meetup_arrivals!.push({
              id: `arr-${oppId}-${k}`, opportunity_id: oppId, member_id: mid, state: "met", eta_mins: 0,
              safe_cue: "by the landmark", backup_venue_id: null, updated_at: new Date(meetingAt.getTime() + 8 * MINUTE),
            });
            bumpVenue(nd.primary.id, "positive", "builder");
          }
        }
      }
      r.network_state.push({
        id: networkId("ntwrk", city), version: 1, saved_at: new Date(now),
        state: {
          matchingEnabled: true, deferred: [], trust: [], cases: [],
          counters: { reviewApproved: 2, reviewRejected: 0, reviewExpired: 0 },
          gateReasons: {},
          members: memberIds.map((id, idx) => ({ id, minor: idx === 9 })),
        },
      });
    }
  }

  const byApp = {} as Record<AppId, Record<string, number>>;
  for (let i = 0; i < appList.length; i++) {
    const app = appList[i]!;
    byApp[app] = await writeRows(sql, allRows[app], { app, truncate: truncate && i === 0 });
  }

  await sql.begin(async tx => {
    for (const [venueId, m] of venueMetrics) {
      if (m.visits === 0) continue;
      await tx`
        update platform.venues
        set visit_count = ${m.visits},
            overall_likes = ${m.likes},
            overall_dislikes = ${m.dislikes},
            persona_stats = ${JSON.stringify(m.stats)}::jsonb,
            updated_at = now()
        where id = ${venueId}
      `;
    }
  });

  await sql.close();
  const sum = (key: string) => appList.reduce((acc, a) => acc + (byApp[a][key] ?? 0), 0);
  return {
    venues: venuesCount,
    byApp,
    totals: {
      members: sum("members"),
      opportunities: sum("opportunities"),
      venue_visits: sum("venue_visits"),
      venue_rejections: sum("venue_rejections"),
      meetup_arrivals: sum("meetup_arrivals"),
      work_intros: sum("work_intros"),
      feedback: sum("feedback"),
    },
  };
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    url: { type: "string" }, "from-dataset": { type: "boolean", default: false }, "from-sim": { type: "boolean", default: false },
    "five-cities": { type: "boolean", default: false },
    days: { type: "string", default: "14" }, seed: { type: "string", default: "1" }, personas: { type: "string", default: "0" },
    engine: { type: "string", default: "engine-v1" }, "allow-remote": { type: "boolean", default: false },
  } });
  let url = a.url ?? process.env.NETWORK_DATABASE_URL;
  if (!url) url = await devPgUp();
  if (!isLocalUrl(url) && !a["allow-remote"]) { console.error(`refusing to write to non-local database ${new URL(url).hostname} (pass --allow-remote for staging)`); process.exit(1); }
  await applySchema(url);
  const t0 = performance.now();
  const fiveCities = a["five-cities"] || process.env.OBSERVATORY_SEED_MODE === "five-cities" || process.env.OBSERVATORY_FIVE_CITIES === "1";
  if (fiveCities) {
    const counts = await seedFiveCities(url, { seed: Number(a.seed), truncate: true });
    console.log(JSON.stringify({ url: url.replace(/\/\/[^@]*@/, "//"), source: `five-cities seed=${a.seed}`, counts, ms: Math.round(performance.now() - t0) }, null, 2));
  } else if (a["from-sim"]) {
    const { game, counts } = await seedFromSim(url, { days: Number(a.days), seed: Number(a.seed), personas: Number(a.personas), engine: a.engine as any });
    await game.dispose();
    console.log(JSON.stringify({ url: url.replace(/\/\/[^@]*@/, "//"), source: `sim seed=${a.seed} days=${a.days}`, counts, ms: Math.round(performance.now() - t0) }, null, 2));
  } else {
    const sql = new SQL(url);
    const venues = await upsertSeedVenues(sql);
    const counts = await writeRows(sql, await rowsFromDataset(), { truncate: true });
    await sql.close();
    console.log(JSON.stringify({ url: url.replace(/\/\/[^@]*@/, "//"), source: "synthetic dataset v1", counts: { ...counts, venues }, ms: Math.round(performance.now() - t0) }, null, 2));
  }
  process.exit(0);
}
export { DEV_PG_URL };
