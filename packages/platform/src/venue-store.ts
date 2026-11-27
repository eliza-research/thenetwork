import { randomUUID } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import {
  ALL_SEED_VENUES,
  applyVenueFeedback,
  groupVenueRubricScore,
  type AppId,
  type ArrivalState,
  type City,
  type CityId,
  type NoiseLevel,
  type VenueCategory,
  type VenueFeedbackReport,
  type VenueHoursSlot,
  type VenuePersonaPrior,
  type VenuePriceTier,
  type VenueRecord,
  type VenueStatus,
  type WorkIntroChannel,
} from "../../core/src/index.ts";

type Row = Record<string, any>;

const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());
const ts = (v: number | null | undefined): Date | null => (v === null || v === undefined ? null : new Date(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
};

const STATUS_TO_DB: Record<VenueStatus, string> = {
  active: "active",
  suspect_closed: "suspect_closed",
  closed_temporary: "closed_temporary",
  closed_permanent: "closed_permanent",
};

const STATUS_FROM_DB: Record<string, VenueStatus> = {
  active: "active",
  suspect_closed: "suspect_closed",
  closed_temporary: "closed_temporary",
  closed_permanent: "closed_permanent",
};

const NOISE_TO_DB: Record<NoiseLevel, string> = {
  quiet: "quiet",
  conversational: "conversational",
  lively: "lively",
  loud: "loud",
};

const NOISE_FROM_DB: Record<string, NoiseLevel> = {
  quiet: "quiet",
  conversational: "conversational",
  lively: "lively",
  loud: "loud",
};

export type PersistedWorkIntroChannel = "warm_email" | "scheduled_video" | "relay_share";
export type WorkIntroChannelValue = PersistedWorkIntroChannel | Exclude<WorkIntroChannel, "NoChannel">;

const WORK_CHANNEL_TO_DB: Record<WorkIntroChannelValue, PersistedWorkIntroChannel> = {
  warm_email: "warm_email",
  scheduled_video: "scheduled_video",
  relay_share: "relay_share",
  WarmEmail: "warm_email",
  ScheduledVideo: "scheduled_video",
  RelayShare: "relay_share",
};

export function venueStatusToDb(status: VenueStatus): string {
  return STATUS_TO_DB[status] ?? "active";
}

export function venueStatusFromDb(raw: unknown): VenueStatus {
  const key = String(raw ?? "active");
  return STATUS_FROM_DB[key] ?? "active";
}

export function noiseLevelToDb(noise: NoiseLevel): string {
  return NOISE_TO_DB[noise] ?? "conversational";
}

export function noiseLevelFromDb(raw: unknown): NoiseLevel {
  const key = String(raw ?? "conversational");
  return NOISE_FROM_DB[key] ?? "conversational";
}

export function workIntroChannelToDb(channel: WorkIntroChannelValue): PersistedWorkIntroChannel {
  return WORK_CHANNEL_TO_DB[channel];
}

async function withApp<T>(pool: SQL, appId: AppId, fn: (tx: SQL) => Promise<T>): Promise<T> {
  if (typeof (pool as any).begin === "function") {
    return pool.begin(async tx => {
      await tx`select set_config('app.app_id', ${appId}, true)`;
      return fn(tx);
    });
  }
  await pool`select set_config('app.app_id', ${appId}, true)`;
  return fn(pool);
}

async function withTx<T>(pool: SQL, fn: (tx: SQL) => Promise<T>): Promise<T> {
  if (typeof (pool as any).begin === "function") {
    return pool.begin(async tx => fn(tx));
  }
  return fn(pool);
}

export interface VenueListFilter {
  city?: CityId;
  neighborhood?: string;
  status?: VenueStatus | VenueStatus[];
  maxPriceTier?: VenuePriceTier;
  category?: VenueCategory;
  limit?: number;
}

export interface VenueExtraMeta {
  yelpId?: string | null;
  yelpReviewCount?: number | null;
  googlePlaceId?: string | null;
  groupScore?: number;
  dateScore?: number;
  personaStats?: Record<string, VenuePersonaPrior>;
  overallLikes?: number;
  overallDislikes?: number;
  visitCount?: number;
}

export interface VenueCacheEntry {
  cacheKey: string;
  provider: string;
  city: CityId;
  payload: unknown;
  resultCount: number;
  fetchedAt: number;
  expiresAt: number;
}

export interface VenueVisitInput {
  id?: string;
  memberId: string;
  venueId: string;
  opportunityId?: string | null;
  visitedAt: number;
  sentiment?: string | null;
  issues?: string[];
  closedReport?: boolean;
}

export interface VenueVisitRecord {
  id: string;
  appId: AppId;
  memberId: string;
  venueId: string;
  opportunityId: string | null;
  visitedAt: number;
  sentiment: string | null;
  issues: string[];
  closedReport: boolean;
}

export interface VenueRejectionInput {
  memberId: string;
  venueId: string;
  reason?: string;
  rejectedAt: number;
}

export interface MeetupArrivalInput {
  id?: string;
  opportunityId: string;
  memberId: string;
  state: ArrivalState;
  etaMins?: number | null;
  safeCue?: string;
  backupVenueId?: string | null;
  updatedAt: number;
}

export interface MeetupArrivalRecord {
  id: string;
  appId: AppId;
  opportunityId: string;
  memberId: string;
  state: ArrivalState;
  etaMins: number | null;
  safeCue: string;
  backupVenueId: string | null;
  updatedAt: number;
}

export interface WorkIntroRecordInput {
  opportunityId: string;
  channel: WorkIntroChannelValue;
  introSentAt?: number | null;
  slotConfirmedAt?: number | null;
  meetUrl?: string | null;
  followupDueAt?: number | null;
  followupSentAt?: number | null;
  stage?: string;
  updatedAt?: number;
}

export interface WorkIntroRecord {
  opportunityId: string;
  appId: AppId;
  channel: PersistedWorkIntroChannel;
  introSentAt: number | null;
  slotConfirmedAt: number | null;
  meetUrl: string | null;
  followupDueAt: number | null;
  followupSentAt: number | null;
  stage: string;
  updatedAt: number;
}

function computeDefaultGroupScore(v: VenueRecord): number {
  return groupVenueRubricScore({
    separateChecks: v.separateChecks,
    walkInCapacity: v.walkInGroupCapacity,
    noiseLevel: v.noiseLevel,
    liveMusicAtNight: v.liveMusicAtNight,
    alcoholOptional: v.alcoholOptional,
    servesVegetarian: v.servesVegetarian,
    servesVegan: v.servesVegan,
    safetyScore: v.safetyScore ?? 9,
    indoor: v.indoor,
    weatherSensitive: v.weatherSensitive,
    hasArrivalLandmark: v.arrivalLandmark.trim().length > 0,
    transitScore: v.transitScore ?? 4,
  });
}

function rowToVenue(r: Row): VenueRecord {
  const ageMin = Number(r.age_min ?? 0);
  const externalPlaceId = (r.google_place_id ?? r.yelp_id ?? undefined) as string | undefined;
  const lastVerifiedAt = ms(r.verified_open_at) ?? ms(r.updated_at) ?? ms(r.created_at) ?? 0;
  const geoExpiresAt = ms(r.geo_expires_at) ?? undefined;
  const quarantinedUntil = ms(r.recheck_after) ?? undefined;
  return {
    id: String(r.id),
    name: String(r.name),
    city: r.city as City,
    neighborhood: String(r.neighborhood),
    address: String(r.address ?? ""),
    lat: Number(r.lat),
    lng: Number(r.lon),
    category: r.category as VenueCategory,
    public: true,
    status: venueStatusFromDb(r.status),
    priceTier: Number(r.price_tier) as VenuePriceTier,
    ageMin,
    isBarOnly: Boolean(r.is_bar_only),
    alcoholOptional: Boolean(r.alcohol_optional),
    servesVegetarian: Boolean(r.serves_vegetarian),
    servesVegan: Boolean(r.serves_vegan),
    wheelchairAccessible: Boolean(r.wheelchair_accessible),
    separateChecks: Boolean(r.separate_checks),
    walkInGroupCapacity: Number(r.walk_in_group_capacity),
    reservationRequired: Boolean(r.reservation_required),
    noiseLevel: noiseLevelFromDb(r.noise_level),
    liveMusicAtNight: Boolean(r.live_music_at_night),
    indoor: Boolean(r.indoor),
    outdoor: Boolean(r.outdoor),
    weatherSensitive: Boolean(r.weather_sensitive),
    arrivalLandmark: String(r.arrival_landmark ?? ""),
    hours: json<VenueHoursSlot[]>(r.hours, []),
    ...(r.yelp_rating !== null && r.yelp_rating !== undefined ? { yelpRating: Number(r.yelp_rating) } : {}),
    ...(externalPlaceId ? { externalPlaceId } : {}),
    source: r.source as VenueRecord["source"],
    lastVerifiedAt,
    ...(geoExpiresAt !== undefined ? { geoExpiresAt } : {}),
    closureReports: Number(r.closure_reports ?? 0),
    ...(quarantinedUntil !== undefined ? { quarantinedUntil } : {}),
    safetyScore: 9,
    transitScore: 4,
    personaPriors: json<Record<string, VenuePersonaPrior>>(r.persona_priors, {}),
  };
}

function rowToCache(r: Row): VenueCacheEntry {
  return {
    cacheKey: String(r.cache_key),
    provider: String(r.provider),
    city: r.city as City,
    payload: json<unknown>(r.payload, null),
    resultCount: Number(r.result_count ?? 0),
    fetchedAt: ms(r.fetched_at)!,
    expiresAt: ms(r.expires_at)!,
  };
}

function rowToVisit(r: Row): VenueVisitRecord {
  return {
    id: String(r.id),
    appId: r.app_id as AppId,
    memberId: String(r.member_id),
    venueId: String(r.venue_id),
    opportunityId: r.opportunity_id ?? null,
    visitedAt: ms(r.visited_at)!,
    sentiment: r.sentiment ?? null,
    issues: json<string[]>(r.issues, []),
    closedReport: Boolean(r.closed_report),
  };
}

function rowToArrival(r: Row): MeetupArrivalRecord {
  return {
    id: String(r.id),
    appId: r.app_id as AppId,
    opportunityId: String(r.opportunity_id),
    memberId: String(r.member_id),
    state: r.state as ArrivalState,
    etaMins: r.eta_mins === null || r.eta_mins === undefined ? null : Number(r.eta_mins),
    safeCue: String(r.safe_cue ?? ""),
    backupVenueId: r.backup_venue_id ?? null,
    updatedAt: ms(r.updated_at)!,
  };
}

function rowToWorkIntro(r: Row): WorkIntroRecord {
  return {
    opportunityId: String(r.opportunity_id),
    appId: r.app_id as AppId,
    channel: r.channel as PersistedWorkIntroChannel,
    introSentAt: ms(r.intro_sent_at),
    slotConfirmedAt: ms(r.slot_confirmed_at),
    meetUrl: r.meet_url ?? null,
    followupDueAt: ms(r.followup_due_at),
    followupSentAt: ms(r.followup_sent_at),
    stage: String(r.stage),
    updatedAt: ms(r.updated_at)!,
  };
}

export async function seedCuratedVenues(pool: SQL): Promise<{ seeded: number }> {
  return withTx(pool, async tx => {
    for (const v of ALL_SEED_VENUES) {
      const groupScore = computeDefaultGroupScore(v);
      const dateScore = Math.min(100, Math.max(0, Math.round((v.yelpRating ?? 4.3) * 20)));
      const hoursJson = JSON.stringify(v.hours);
      const priorsJson = JSON.stringify(v.personaPriors);
      const ageMin = v.ageMin ?? (v.isBarOnly || v.isAlcoholCentric ? 21 : 0);
      await tx`
        insert into platform.venues (
          id, city, neighborhood, name, address, lat, lon, is_public, category, price_tier,
          age_min, is_bar_only, alcohol_optional, serves_vegetarian, serves_vegan,
          wheelchair_accessible, separate_checks, walk_in_group_capacity, reservation_required,
          noise_level, live_music_at_night, indoor, outdoor, weather_sensitive, arrival_landmark,
          hours, group_score, date_score, source, yelp_rating, status, closure_reports,
          verified_open_at, geo_expires_at, recheck_after, persona_priors, persona_stats
        ) values (
          ${v.id}, ${v.city}, ${v.neighborhood}, ${v.name}, ${v.address}, ${v.lat}, ${v.lng},
          true, ${v.category}, ${v.priceTier}, ${ageMin}, ${v.isBarOnly}, ${v.alcoholOptional},
          ${v.servesVegetarian}, ${v.servesVegan}, ${v.wheelchairAccessible}, ${v.separateChecks},
          ${v.walkInGroupCapacity}, ${v.reservationRequired}, ${noiseLevelToDb(v.noiseLevel)}, ${v.liveMusicAtNight},
          ${v.indoor}, ${v.outdoor}, ${v.weatherSensitive}, ${v.arrivalLandmark},
          ${hoursJson}::jsonb, ${groupScore}, ${dateScore}, ${v.source}, ${v.yelpRating ?? null},
          ${venueStatusToDb(v.status)}, ${v.closureReports}, ${ts(v.lastVerifiedAt)}, ${ts(v.geoExpiresAt)},
          ${ts(v.quarantinedUntil)}, ${priorsJson}::jsonb, ${priorsJson}::jsonb
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
          yelp_rating = coalesce(platform.venues.yelp_rating, excluded.yelp_rating),
          updated_at = now()
      `;
    }
    return { seeded: ALL_SEED_VENUES.length };
  });
}

export async function getVenue(pool: SQL, id: string): Promise<VenueRecord | undefined> {
  const [r] = await pool`select * from platform.venues where id = ${id}`;
  return r ? rowToVenue(r) : undefined;
}

export async function listVenues(pool: SQL, filter: VenueListFilter = {}): Promise<VenueRecord[]> {
  const statuses = filter.status === undefined
    ? null
    : (Array.isArray(filter.status) ? filter.status : [filter.status]).map(venueStatusToDb);
  const limit = filter.limit ?? 1000;
  const rows = await pool`
    select * from platform.venues
    where (${filter.city ?? null}::text is null or city = ${filter.city ?? null})
      and (${filter.neighborhood ?? null}::text is null or neighborhood = ${filter.neighborhood ?? null})
      and (${statuses === null}::boolean or status = any(${pool.array(statuses ?? [], "TEXT")}))
      and (${filter.maxPriceTier ?? null}::smallint is null or price_tier <= ${filter.maxPriceTier ?? null})
      and (${filter.category ?? null}::text is null or category = ${filter.category ?? null})
    order by id
    limit ${limit}
  `;
  return (rows as Row[]).map(rowToVenue);
}

export async function upsertVenue(pool: SQL, venue: VenueRecord, extra: VenueExtraMeta = {}): Promise<VenueRecord> {
  if (venue.public !== true) {
    throw new Error("Only public third-party venues may be stored in platform.venues");
  }
  const googlePlaceId = extra.googlePlaceId ?? (venue.source === "google_places" ? (venue.externalPlaceId ?? null) : null);
  const yelpId = extra.yelpId ?? (venue.source === "listing" && venue.externalPlaceId ? venue.externalPlaceId : null);
  const groupScore = extra.groupScore ?? computeDefaultGroupScore(venue);
  const dateScore = extra.dateScore ?? Math.min(100, Math.max(0, Math.round((venue.yelpRating ?? 4.3) * 20)));
  const hoursJson = JSON.stringify(venue.hours);
  const priorsJson = JSON.stringify(venue.personaPriors ?? {});
  const statsJson = JSON.stringify(extra.personaStats ?? venue.personaPriors ?? {});

  const ageMin = venue.ageMin ?? (venue.isBarOnly || venue.isAlcoholCentric ? 21 : 0);
  const [r] = await pool`
    insert into platform.venues (
      id, city, neighborhood, name, address, lat, lon, is_public, category, price_tier,
      age_min, is_bar_only, alcohol_optional, serves_vegetarian, serves_vegan,
      wheelchair_accessible, separate_checks, walk_in_group_capacity, reservation_required,
      noise_level, live_music_at_night, indoor, outdoor, weather_sensitive, arrival_landmark,
      hours, group_score, date_score, source, yelp_id, yelp_rating, yelp_review_count,
      google_place_id, status, closure_reports, verified_open_at, geo_expires_at,
      recheck_after, persona_priors, persona_stats, overall_likes, overall_dislikes, visit_count,
      updated_at
    ) values (
      ${venue.id}, ${venue.city}, ${venue.neighborhood}, ${venue.name}, ${venue.address},
      ${venue.lat}, ${venue.lng}, true, ${venue.category}, ${venue.priceTier},
      ${ageMin}, ${venue.isBarOnly}, ${venue.alcoholOptional},
      ${venue.servesVegetarian}, ${venue.servesVegan}, ${venue.wheelchairAccessible},
      ${venue.separateChecks}, ${venue.walkInGroupCapacity}, ${venue.reservationRequired},
      ${noiseLevelToDb(venue.noiseLevel)}, ${venue.liveMusicAtNight}, ${venue.indoor}, ${venue.outdoor},
      ${venue.weatherSensitive}, ${venue.arrivalLandmark}, ${hoursJson}::jsonb,
      ${groupScore}, ${dateScore}, ${venue.source}, ${yelpId}, ${venue.yelpRating ?? null},
      ${extra.yelpReviewCount ?? null}, ${googlePlaceId}, ${venueStatusToDb(venue.status)}, ${venue.closureReports},
      ${ts(venue.lastVerifiedAt)}, ${ts(venue.geoExpiresAt)}, ${ts(venue.quarantinedUntil)},
      ${priorsJson}::jsonb, ${statsJson}::jsonb, ${extra.overallLikes ?? 0},
      ${extra.overallDislikes ?? 0}, ${extra.visitCount ?? 0}, now()
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
      yelp_id = coalesce(excluded.yelp_id, platform.venues.yelp_id),
      yelp_rating = coalesce(excluded.yelp_rating, platform.venues.yelp_rating),
      yelp_review_count = coalesce(excluded.yelp_review_count, platform.venues.yelp_review_count),
      google_place_id = coalesce(excluded.google_place_id, platform.venues.google_place_id),
      status = excluded.status,
      closure_reports = excluded.closure_reports,
      verified_open_at = coalesce(excluded.verified_open_at, platform.venues.verified_open_at),
      geo_expires_at = coalesce(excluded.geo_expires_at, platform.venues.geo_expires_at),
      recheck_after = excluded.recheck_after,
      persona_priors = excluded.persona_priors,
      persona_stats = excluded.persona_stats,
      updated_at = now()
    returning *
  `;
  return rowToVenue(r!);
}

export async function getCachedSearch(pool: SQL, cacheKey: string, nowMs = Date.now()): Promise<VenueCacheEntry | undefined> {
  const [r] = await pool`
    select * from platform.venue_api_cache
    where cache_key = ${cacheKey} and expires_at > ${ts(nowMs)}
  `;
  return r ? rowToCache(r) : undefined;
}

export async function putCachedSearch(pool: SQL, entry: VenueCacheEntry): Promise<void> {
  const payloadJson = JSON.stringify(entry.payload);
  await pool`
    insert into platform.venue_api_cache (cache_key, provider, city, payload, result_count, fetched_at, expires_at)
    values (${entry.cacheKey}, ${entry.provider}, ${entry.city}, ${payloadJson}::jsonb, ${entry.resultCount}, ${ts(entry.fetchedAt)}, ${ts(entry.expiresAt)})
    on conflict (cache_key) do update set
      provider = excluded.provider,
      city = excluded.city,
      payload = excluded.payload,
      result_count = excluded.result_count,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `;
}

export async function recordVenueVisit(pool: SQL, appId: AppId, visit: VenueVisitInput): Promise<VenueVisitRecord> {
  const id = visit.id ?? `visit_${randomUUID()}`;
  const issuesJson = JSON.stringify(visit.issues ?? []);
  return withApp(pool, appId, async tx => {
    const [r] = await tx`
      insert into network.venue_visits (
        id, app_id, member_id, venue_id, opportunity_id, visited_at, sentiment, issues, closed_report
      ) values (
        ${id}, ${appId}, ${visit.memberId}, ${visit.venueId}, ${visit.opportunityId ?? null},
        ${ts(visit.visitedAt)}, ${visit.sentiment ?? null}, ${issuesJson}::jsonb, ${Boolean(visit.closedReport)}
      )
      returning *
    `;
    await tx`
      update platform.venues set visit_count = visit_count + 1, updated_at = now()
      where id = ${visit.venueId}
    `;
    return rowToVisit(r!);
  });
}

export async function listVisitedVenueIds(pool: SQL, appId: AppId, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  return withApp(pool, appId, async tx => {
    const rows = await tx`
      select distinct venue_id from network.venue_visits
      where app_id = ${appId} and member_id = any(${tx.array(memberIds, "TEXT")})
      order by venue_id
    `;
    return (rows as Row[]).map(r => String(r.venue_id));
  });
}

export async function recordVenueRejection(pool: SQL, appId: AppId, rejection: VenueRejectionInput): Promise<void> {
  await withApp(pool, appId, async tx => {
    await tx`
      insert into network.venue_rejections (app_id, member_id, venue_id, reason, rejected_at)
      values (${appId}, ${rejection.memberId}, ${rejection.venueId}, ${rejection.reason ?? ""}, ${ts(rejection.rejectedAt)})
      on conflict (app_id, member_id, venue_id) do update set
        reason = excluded.reason,
        rejected_at = excluded.rejected_at
    `;
  });
}

export async function listRejectedVenueIds(pool: SQL, appId: AppId, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  return withApp(pool, appId, async tx => {
    const rows = await tx`
      select distinct venue_id from network.venue_rejections
      where app_id = ${appId} and member_id = any(${tx.array(memberIds, "TEXT")})
      order by venue_id
    `;
    return (rows as Row[]).map(r => String(r.venue_id));
  });
}

export async function applyVenueFeedbackPg(
  pool: SQL,
  _appId: AppId,
  venueId: string,
  memberArchetypes: string[],
  feedback: VenueFeedbackReport,
  nowMs = Date.now(),
): Promise<VenueRecord | undefined> {
  return withTx(pool, async tx => {
    const [cur] = await tx`select * from platform.venues where id = ${venueId} for update`;
    if (!cur) return undefined;
    const current = rowToVenue(cur);
    const updated = applyVenueFeedback(current, memberArchetypes, feedback, nowMs);
    const likeDelta = feedback.outcome === "great" || feedback.outcome === "ok" ? 1 : 0;
    const dislikeDelta =
      feedback.outcome === "closed" ||
      feedback.outcome === "too_loud" ||
      feedback.outcome === "crowded" ||
      feedback.outcome === "bad_vibe" ||
      feedback.outcome === "too_expensive"
        ? 1
        : 0;
    const priorsJson = JSON.stringify(updated.personaPriors);
    const [saved] = await tx`
      update platform.venues set
        status = ${venueStatusToDb(updated.status)},
        closure_reports = ${updated.closureReports},
        recheck_after = ${ts(updated.quarantinedUntil)},
        verified_open_at = ${ts(updated.lastVerifiedAt)},
        persona_priors = ${priorsJson}::jsonb,
        persona_stats = ${priorsJson}::jsonb,
        overall_likes = overall_likes + ${likeDelta},
        overall_dislikes = overall_dislikes + ${dislikeDelta},
        updated_at = now()
      where id = ${venueId}
      returning *
    `;
    return saved ? rowToVenue(saved) : undefined;
  });
}

export async function upsertMeetupArrival(
  pool: SQL,
  appId: AppId,
  arrival: MeetupArrivalInput,
): Promise<MeetupArrivalRecord> {
  const id = arrival.id ?? `${arrival.opportunityId}:${arrival.memberId}`;
  return withApp(pool, appId, async tx => {
    const [r] = await tx`
      insert into network.meetup_arrivals (
        id, app_id, opportunity_id, member_id, state, eta_mins, safe_cue, backup_venue_id, updated_at
      ) values (
        ${id}, ${appId}, ${arrival.opportunityId}, ${arrival.memberId}, ${arrival.state},
        ${arrival.etaMins ?? null}, ${arrival.safeCue ?? ""}, ${arrival.backupVenueId ?? null},
        ${ts(arrival.updatedAt)}
      )
      on conflict (id) do update set
        state = excluded.state,
        eta_mins = excluded.eta_mins,
        safe_cue = excluded.safe_cue,
        backup_venue_id = excluded.backup_venue_id,
        updated_at = excluded.updated_at
      returning *
    `;
    return rowToArrival(r!);
  });
}

export async function listMeetupArrivals(
  pool: SQL,
  appId: AppId,
  opportunityId: string,
): Promise<MeetupArrivalRecord[]> {
  return withApp(pool, appId, async tx => {
    const rows = await tx`
      select * from network.meetup_arrivals
      where app_id = ${appId} and opportunity_id = ${opportunityId}
      order by updated_at asc, id asc
    `;
    return (rows as Row[]).map(rowToArrival);
  });
}

export async function upsertWorkIntro(
  pool: SQL,
  appId: AppId,
  intro: WorkIntroRecordInput,
): Promise<WorkIntroRecord> {
  const updatedAt = intro.updatedAt ?? Date.now();
  const channel = workIntroChannelToDb(intro.channel);
  return withApp(pool, appId, async tx => {
    const [r] = await tx`
      insert into network.work_intros (
        opportunity_id, app_id, channel, intro_sent_at, slot_confirmed_at,
        meet_url, followup_due_at, followup_sent_at, stage, updated_at
      ) values (
        ${intro.opportunityId}, ${appId}, ${channel}, ${ts(intro.introSentAt)},
        ${ts(intro.slotConfirmedAt)}, ${intro.meetUrl ?? null}, ${ts(intro.followupDueAt)},
        ${ts(intro.followupSentAt)}, ${intro.stage ?? "introduced"}, ${ts(updatedAt)}
      )
      on conflict (opportunity_id) do update set
        channel = excluded.channel,
        intro_sent_at = coalesce(excluded.intro_sent_at, network.work_intros.intro_sent_at),
        slot_confirmed_at = coalesce(excluded.slot_confirmed_at, network.work_intros.slot_confirmed_at),
        meet_url = coalesce(excluded.meet_url, network.work_intros.meet_url),
        followup_due_at = coalesce(excluded.followup_due_at, network.work_intros.followup_due_at),
        followup_sent_at = coalesce(excluded.followup_sent_at, network.work_intros.followup_sent_at),
        stage = excluded.stage,
        updated_at = excluded.updated_at
      returning *
    `;
    return rowToWorkIntro(r!);
  });
}

export async function getWorkIntro(
  pool: SQL,
  appId: AppId,
  opportunityId: string,
): Promise<WorkIntroRecord | undefined> {
  return withApp(pool, appId, async tx => {
    const [r] = await tx`
      select * from network.work_intros
      where app_id = ${appId} and opportunity_id = ${opportunityId}
    `;
    return r ? rowToWorkIntro(r) : undefined;
  });
}

export class PgVenueStore {
  readonly sql: SQL;
  private readonly owned: boolean;

  constructor(db: string | SQL) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }

  async close(): Promise<void> {
    if (this.owned) await this.sql.close();
  }

  seedCuratedVenues() { return seedCuratedVenues(this.sql); }
  getVenue(id: string) { return getVenue(this.sql, id); }
  listVenues(filter?: VenueListFilter) { return listVenues(this.sql, filter); }
  upsertVenue(venue: VenueRecord, extra?: VenueExtraMeta) { return upsertVenue(this.sql, venue, extra); }
  getCachedSearch(cacheKey: string, nowMs?: number) { return getCachedSearch(this.sql, cacheKey, nowMs); }
  putCachedSearch(entry: VenueCacheEntry) { return putCachedSearch(this.sql, entry); }
  recordVenueVisit(appId: AppId, visit: VenueVisitInput) { return recordVenueVisit(this.sql, appId, visit); }
  listVisitedVenueIds(appId: AppId, memberIds: string[]) { return listVisitedVenueIds(this.sql, appId, memberIds); }
  recordVenueRejection(appId: AppId, rejection: VenueRejectionInput) { return recordVenueRejection(this.sql, appId, rejection); }
  listRejectedVenueIds(appId: AppId, memberIds: string[]) { return listRejectedVenueIds(this.sql, appId, memberIds); }
  applyVenueFeedback(appId: AppId, venueId: string, memberArchetypes: string[], feedback: VenueFeedbackReport, nowMs?: number) {
    return applyVenueFeedbackPg(this.sql, appId, venueId, memberArchetypes, feedback, nowMs);
  }
  upsertMeetupArrival(appId: AppId, arrival: MeetupArrivalInput) { return upsertMeetupArrival(this.sql, appId, arrival); }
  listMeetupArrivals(appId: AppId, opportunityId: string) { return listMeetupArrivals(this.sql, appId, opportunityId); }
  upsertWorkIntro(appId: AppId, intro: WorkIntroRecordInput) { return upsertWorkIntro(this.sql, appId, intro); }
  getWorkIntro(appId: AppId, opportunityId: string) { return getWorkIntro(this.sql, appId, opportunityId); }
}
