import { randomUUID } from "node:crypto";
import {
  ALCOHOL_CENTRIC_CATEGORIES,
  canBeMatched,
  detectExternalPromptInjection,
  externalEventSourceCode,
  isBusinessDomain,
  isDatingDomain,
  isFriendshipDomain,
  isMinor,
  parseAdult18PlusAnswer,
  sanitizeProspectFacets,
  type AppId,
  type CityLaunchStatus,
  type ExternalEventSource,
  type ExternalProspectConsentState,
  type ExternalProspectPlatform,
  type ExternalRsvpStatus,
  type ExternalSourcingState,
  type MatchmakerPersona,
  type MemberGender,
  type PersonaGender,
  type PersonaHealthStatus,
  type VenueCategory,
  type VenueHoursSlot,
  type VenueNoiseLevel,
  type VenuePersonaPrior,
  type VenuePriceTier,
  type VenueRecord,
  type VenueSource,
  type VenueStatus,
} from "@thenetwork/core";
import {
  canApproveExternalEventRsvp,
  canPublishExternalEvent,
  computeApprovedExternalCap,
  evaluateExternalEventT24Quorum,
  externalEventMaxHeadcount,
  isSanctionedExternalEventSource,
} from "../../core/src/generated/externalEventBridge.ts";
import {
  canReadExternalProspectInApp,
  matchmakerAppFriends,
  matchmakerAppNtwrk,
  matchmakerAppPeon,
  matchmakerAppSlop,
} from "../../core/src/generated/externalMatchmaker.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";

export type ExternalEventDbPlatform = "luma" | "meetup" | "partiful" | "internal";
export type ExternalEventStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "active"
  | "completed"
  | "cancelled_no_anchor"
  | "cancelled_low_quorum"
  | "cancelled";

export type ExternalEventRsvpDbStatus =
  | "pending_approval"
  | "approved"
  | "waitlist"
  | "declined"
  | "attended"
  | "no_show"
  | "cancelled";

export type MeetupArrivalState =
  | "en_route"
  | "late"
  | "arrived"
  | "seated"
  | "met"
  | "venue_closed"
  | "venue_full"
  | "cannot_find"
  | "panic_exit"
  | "cancelled";

export type SuppressionReason =
  | "stopped"
  | "declined"
  | "blocked"
  | "deletion_requested"
  | "underage"
  | "red_flag"
  | "expired"
  | "no_show";

export interface MemberVenueHistory {
  visitedVenueIds: string[];
  rejectedVenueIds: string[];
}

export interface ReserveVenueConcurrentHoldInput {
  id?: string;
  venueId: string;
  appId: AppId;
  opportunityId: string;
  headcount: number;
  windowStart: number;
  windowEnd: number;
}

export interface ReserveVenueConcurrentHoldResult {
  ok: boolean;
  id?: string;
  reason?: "venue_unavailable" | "capacity_exceeded" | "invalid_window";
  currentHeadcount: number;
  capacity: number;
}

export interface UpsertExternalEventInput {
  id: string;
  city: string;
  appId?: AppId;
  source: ExternalEventSource;
  platform: ExternalEventDbPlatform;
  externalEventId?: string | null;
  externalUrl?: string | null;
  title: string;
  interest?: string;
  description?: string;
  venueId: string;
  backupVenueId?: string | null;
  isPublic?: boolean;
  startAt: number;
  endAt: number;
  anchorMemberId?: string | null;
  confirmedNetworkAnchors?: number;
  confirmedNetworkTotal?: number;
  approvedExternalCap?: number;
  hideGuestList?: boolean;
  approvalRequired?: boolean;
  externalCrowdDisclosed?: boolean;
  reviewApproved?: boolean;
  reviewItemId?: string | null;
  status?: ExternalEventStatus;
}

export interface StoredExternalEvent {
  id: string;
  city: string;
  appId: AppId;
  source: ExternalEventSource;
  platform: ExternalEventDbPlatform;
  externalEventId: string | null;
  externalUrl: string | null;
  title: string;
  interest: string;
  description: string;
  venueId: string;
  backupVenueId: string | null;
  isPublic: boolean;
  startAt: number;
  endAt: number;
  anchorMemberId: string | null;
  confirmedNetworkAnchors: number;
  confirmedNetworkTotal: number;
  approvedExternalCap: number;
  hideGuestList: boolean;
  approvalRequired: boolean;
  externalCrowdDisclosed: boolean;
  reviewApproved: boolean;
  reviewItemId: string | null;
  status: ExternalEventStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RecordExternalEventRsvpInput {
  id?: string;
  eventId: string;
  platform: ExternalEventDbPlatform;
  guestExternalId: string;
  firstName?: string;
  statedAge?: number;
  confirmedAdult18Plus?: boolean;
  answeredScreeningQuestion?: boolean;
  screeningAnswer?: string;
  banned?: boolean;
  optedOut?: boolean;
  held?: boolean;
  requestedStatus?: ExternalRsvpStatus;
  nowMs?: number;
}

export interface StoredExternalEventRsvp {
  id: string;
  eventId: string;
  platform: ExternalEventDbPlatform;
  guestExternalId: string;
  firstName: string;
  statedAge: number;
  screeningAnswer: string;
  status: ExternalEventRsvpDbStatus;
  networkVouched: boolean;
  safetyFlag: boolean;
  inviteAttempts: number;
  invitedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RecordExternalEventRsvpResult {
  ok: boolean;
  approved: boolean;
  status: ExternalEventRsvpDbStatus;
  reason?: string;
  rsvp?: StoredExternalEventRsvp;
}

export interface T24QuorumSweepResult {
  checked: number;
  cancelledNoAnchor: string[];
  cancelledLowQuorum: string[];
  kept: string[];
}

export interface UpsertExternalProspectInput {
  id?: string;
  city: string;
  sourcePlatform: ExternalProspectPlatform;
  assignedPersonaId: string;
  dedupeHash: string;
  phoneHash?: string | null;
  firstName?: string;
  statedAge: number;
  gender?: MemberGender;
  seeks?: MemberGender[];
  neighborhood?: string;
  facets?: Record<string, unknown>;
  consentState?: ExternalProspectConsentState;
  recontactCount?: number;
  inviteAttempts?: number;
  expiresAt: number;
  convertedMemberId?: string | null;
  held?: boolean;
  redFlagged?: boolean;
  nowMs?: number;
}

export interface UpsertExternalProspectResult {
  ok: boolean;
  id?: string;
  reason?: "forbidden_app" | "underage" | "suppressed" | "red_flagged";
}

export interface UpsertSourcingTicketInput {
  id: string;
  city: string;
  appId?: "slop" | "friends";
  memberId: string;
  prospectId?: string | null;
  prospectDedupeHash?: string | null;
  assignedPersonaId: string;
  reviewItemId?: string | null;
  bookedOpportunityId?: string | null;
  state: ExternalSourcingState;
  offAppSmsOptedIn?: boolean;
  venueId?: string | null;
  closedReason?: string | null;
  nowMs?: number;
}

export interface CityReadinessEntry {
  city: string;
  name: string;
  tz: string;
  launchStatus: CityLaunchStatus;
  activeVenues: number;
  allAgesVenues: number;
  activeMatchmakers: number;
  suspendedMatchmakers: number;
  publishedExternalEvents: number;
  activeNetworks: string[];
}

export interface MeetupArrivalInput {
  id?: string;
  opportunityId: string;
  memberId: string;
  state: MeetupArrivalState;
  etaMins?: number | null;
  safeCue?: string;
  backupVenueId?: string | null;
  updatedAt: number;
}

const VALID_VENUE_STATUSES = new Set<VenueStatus>(["active", "suspect_closed", "closed_temporary", "closed_permanent"]);
const VALID_PERSONA_STATUSES = new Set<PersonaHealthStatus>(["active", "degraded", "suspended"]);

function appCodeOf(appId: AppId): number {
  if (isDatingDomain(appId)) return matchmakerAppSlop;
  if (isBusinessDomain(appId)) return matchmakerAppPeon;
  if (isFriendshipDomain(appId)) return matchmakerAppFriends;
  return matchmakerAppNtwrk;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function toMs(value: Date | string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return value;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

async function inTx<T>(sql: SQL, run: (tx: SQL) => Promise<T>): Promise<T> {
  if (typeof (sql as { begin?: unknown }).begin === "function") {
    return sql.begin(run);
  }
  return run(sql);
}

async function withAppScope<T>(sql: SQL, appId: AppId, run: (tx: SQL) => Promise<T>): Promise<T> {
  return inTx(sql, async tx => {
    await tx`select set_config('app.app_id', ${appId}, true), set_config('app.current_app', ${appId}, true)`;
    return run(tx);
  });
}

function mapVenueRow(row: Record<string, any>): VenueRecord {
  const category = row.category as VenueCategory;
  const isAlcoholCentric = row.is_alcohol_centric === true || ALCOHOL_CENTRIC_CATEGORIES.has(category);
  return {
    id: String(row.id),
    name: String(row.name),
    city: String(row.city),
    neighborhood: String(row.neighborhood),
    address: String(row.address ?? ""),
    lat: Number(row.lat),
    lng: Number(row.lon),
    category,
    public: true,
    status: (VALID_VENUE_STATUSES.has(row.status) ? row.status : "active") as VenueStatus,
    priceTier: Number(row.price_tier) as VenuePriceTier,
    ageMin: Number(row.age_min),
    allAges: row.all_ages === true,
    isBarOnly: row.is_bar_only === true,
    isAlcoholCentric,
    alcoholOptional: row.alcohol_optional !== false,
    servesVegetarian: row.serves_vegetarian !== false,
    servesVegan: row.serves_vegan === true,
    halalFriendly: row.halal_friendly === true,
    kosherFriendly: row.kosher_friendly === true,
    glutenFreeFriendly: row.gluten_free_friendly === true,
    severeAllergenSafe: row.severe_allergen_safe === true,
    wheelchairAccessible: row.wheelchair_accessible !== false,
    isSmokeFree: row.is_smoke_free !== false,
    separateChecks: row.separate_checks !== false,
    walkInGroupCapacity: Number(row.walk_in_group_capacity),
    reservationRequired: row.reservation_required === true,
    openEventEligible: row.open_event_eligible === true,
    noiseLevel: (row.noise_level ?? "conversational") as VenueNoiseLevel,
    liveMusicAtNight: row.live_music_at_night === true,
    indoor: row.indoor !== false,
    outdoor: row.outdoor === true,
    weatherSensitive: row.weather_sensitive === true,
    safetyScore: Number(row.safety_score ?? 8),
    transitScore: Number(row.transit_score ?? 4),
    arrivalLandmark: String(row.arrival_landmark ?? ""),
    hours: parseJson<VenueHoursSlot[]>(row.hours, []),
    hobbies: parseJson<string[]>(row.hobbies, []),
    cuisineTags: parseJson<string[]>(row.cuisine_tags, []),
    source: (row.source ?? "curated") as VenueSource,
    ...(row.yelp_rating != null ? { yelpRating: Number(row.yelp_rating) } : {}),
    ...(row.google_place_id ? { externalPlaceId: String(row.google_place_id) } : {}),
    lastVerifiedAt: toMs(row.verified_open_at ?? row.updated_at),
    ...(row.geo_expires_at ? { geoExpiresAt: toMs(row.geo_expires_at) } : {}),
    ...(row.recheck_after ? { quarantinedUntil: toMs(row.recheck_after) } : {}),
    closureReports: Number(row.closure_reports ?? 0),
    personaPriors: parseJson<Record<string, VenuePersonaPrior>>(row.persona_priors, {}),
  };
}

function mapExternalEventRow(row: Record<string, any>): StoredExternalEvent {
  return {
    id: String(row.id),
    city: String(row.city),
    appId: row.app_id as AppId,
    source: row.source as ExternalEventSource,
    platform: row.platform as ExternalEventDbPlatform,
    externalEventId: row.external_event_id ? String(row.external_event_id) : null,
    externalUrl: row.external_url ? String(row.external_url) : null,
    title: String(row.title),
    interest: String(row.interest ?? ""),
    description: String(row.description ?? ""),
    venueId: String(row.venue_id),
    backupVenueId: row.backup_venue_id ? String(row.backup_venue_id) : null,
    isPublic: row.is_public === true,
    startAt: toMs(row.start_at),
    endAt: toMs(row.end_at),
    anchorMemberId: row.anchor_member_id ? String(row.anchor_member_id) : null,
    confirmedNetworkAnchors: Number(row.confirmed_network_anchors ?? 0),
    confirmedNetworkTotal: Number(row.confirmed_network_total ?? 0),
    approvedExternalCap: Number(row.approved_external_cap ?? 0),
    hideGuestList: row.hide_guest_list !== false,
    approvalRequired: row.approval_required !== false,
    externalCrowdDisclosed: row.external_crowd_disclosed === true,
    reviewApproved: row.review_approved === true,
    reviewItemId: row.review_item_id ? String(row.review_item_id) : null,
    status: row.status as ExternalEventStatus,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

function mapExternalEventRsvpRow(row: Record<string, any>): StoredExternalEventRsvp {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    platform: row.platform as ExternalEventDbPlatform,
    guestExternalId: String(row.guest_external_id),
    firstName: String(row.first_name ?? ""),
    statedAge: Number(row.stated_age),
    screeningAnswer: String(row.screening_answer ?? ""),
    status: row.status as ExternalEventRsvpDbStatus,
    networkVouched: row.network_vouched === true,
    safetyFlag: row.safety_flag === true,
    inviteAttempts: Number(row.invite_attempts ?? 0),
    invitedAt: row.invited_at ? toMs(row.invited_at) : null,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

function mapMatchmakerPersonaRow(row: Record<string, any>): MatchmakerPersona {
  return {
    id: String(row.id),
    city: String(row.city),
    gender: row.gender as PersonaGender,
    firstName: String(row.first_name),
    tz: String(row.tz),
    hubs: parseJson<string[]>(row.hubs, []),
    verticals: parseJson<("slop" | "friends")[]>(row.verticals, ["slop", "friends"]),
    humanOperated: true,
    bioDisclosure: String(row.bio_disclosure),
    status: row.status as PersonaHealthStatus,
    dailyOutboundCap: Number(row.daily_outbound_cap ?? 10),
    dailyOutboundCount: Number(row.daily_outbound_count ?? 0),
    rollingChatsCount: Number(row.rolling_chats_count ?? 0),
    rollingUnmatchesCount: Number(row.rolling_unmatches_count ?? 0),
    ...(row.kill_switch_reason ? { suspendedReason: String(row.kill_switch_reason) } : {}),
  };
}

// ============================================================================ Venues

export async function listActiveVenues(sql: SQL, city: string): Promise<VenueRecord[]> {
  const normalized = city.trim().toLowerCase();
  const rows = await sql`
    select *
    from platform.venues
    where city = ${normalized} and status = 'active' and is_public = true
    order by id
  `;
  return rows.map(mapVenueRow);
}

export async function listVenues(sql: SQL, city?: string, status?: VenueStatus): Promise<VenueRecord[]> {
  const normalizedCity = city?.trim().toLowerCase();
  const rows = await sql`
    select *
    from platform.venues
    where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      and (${status ?? null}::text is null or status = ${status ?? null})
    order by city, id
  `;
  return rows.map(mapVenueRow);
}

export async function upsertVenue(sql: SQL, venue: VenueRecord): Promise<VenueRecord> {
  const isAlcoholCentric = venue.isAlcoholCentric ?? ALCOHOL_CENTRIC_CATEGORIES.has(venue.category);
  const ageMin = venue.ageMin ?? (venue.allAges ? 0 : venue.isBarOnly || isAlcoholCentric ? 21 : 18);
  const allAges = venue.allAges === true && ageMin <= 13 && !venue.isBarOnly && !isAlcoholCentric && venue.alcoholOptional;
  const verifiedAt = venue.lastVerifiedAt > 0 ? new Date(venue.lastVerifiedAt) : null;
  const geoExpiresAt = venue.geoExpiresAt !== undefined ? new Date(venue.geoExpiresAt) : null;
  const recheckAfter = venue.quarantinedUntil !== undefined ? new Date(venue.quarantinedUntil) : null;
  const [row] = await sql`
    insert into platform.venues (
      id, city, neighborhood, name, address, lat, lon,
      is_public, all_ages, category, price_tier, age_min,
      is_bar_only, is_alcohol_centric, alcohol_optional,
      serves_vegetarian, serves_vegan, halal_friendly, kosher_friendly,
      gluten_free_friendly, severe_allergen_safe, wheelchair_accessible,
      is_smoke_free, separate_checks, walk_in_group_capacity,
      reservation_required, open_event_eligible, noise_level,
      live_music_at_night, indoor, outdoor, weather_sensitive,
      safety_score, transit_score, arrival_landmark,
      hours, hobbies, cuisine_tags, source, yelp_rating, google_place_id,
      status, closure_reports, verified_open_at, geo_expires_at, recheck_after,
      persona_priors, updated_at
    ) values (
      ${venue.id}, ${venue.city.trim().toLowerCase()}, ${venue.neighborhood}, ${venue.name}, ${venue.address},
      ${venue.lat}, ${venue.lng},
      true, ${allAges}, ${venue.category}, ${venue.priceTier}, ${ageMin},
      ${venue.isBarOnly}, ${isAlcoholCentric}, ${venue.alcoholOptional},
      ${venue.servesVegetarian}, ${venue.servesVegan}, ${venue.halalFriendly === true}, ${venue.kosherFriendly === true},
      ${venue.glutenFreeFriendly === true}, ${venue.severeAllergenSafe === true}, ${venue.wheelchairAccessible},
      ${venue.isSmokeFree !== false}, ${venue.separateChecks}, ${venue.walkInGroupCapacity},
      ${venue.reservationRequired}, ${venue.openEventEligible === true}, ${venue.noiseLevel},
      ${venue.liveMusicAtNight}, ${venue.indoor}, ${venue.outdoor}, ${venue.weatherSensitive},
      ${venue.safetyScore ?? 8}, ${venue.transitScore ?? 4}, ${venue.arrivalLandmark},
      ${JSON.stringify(venue.hours ?? [])}::jsonb,
      ${JSON.stringify(venue.hobbies ?? [])}::jsonb,
      ${JSON.stringify(venue.cuisineTags ?? [])}::jsonb,
      ${venue.source}, ${venue.yelpRating ?? null}, ${venue.externalPlaceId ?? null},
      ${venue.status}, ${venue.closureReports ?? 0}, ${verifiedAt}, ${geoExpiresAt}, ${recheckAfter},
      ${JSON.stringify(venue.personaPriors ?? {})}::jsonb, now()
    )
    on conflict (id) do update set
      city = excluded.city,
      neighborhood = excluded.neighborhood,
      name = excluded.name,
      address = excluded.address,
      lat = excluded.lat,
      lon = excluded.lon,
      all_ages = excluded.all_ages,
      category = excluded.category,
      price_tier = excluded.price_tier,
      age_min = excluded.age_min,
      is_bar_only = excluded.is_bar_only,
      is_alcohol_centric = excluded.is_alcohol_centric,
      alcohol_optional = excluded.alcohol_optional,
      serves_vegetarian = excluded.serves_vegetarian,
      serves_vegan = excluded.serves_vegan,
      halal_friendly = excluded.halal_friendly,
      kosher_friendly = excluded.kosher_friendly,
      gluten_free_friendly = excluded.gluten_free_friendly,
      severe_allergen_safe = excluded.severe_allergen_safe,
      wheelchair_accessible = excluded.wheelchair_accessible,
      is_smoke_free = excluded.is_smoke_free,
      separate_checks = excluded.separate_checks,
      walk_in_group_capacity = excluded.walk_in_group_capacity,
      reservation_required = excluded.reservation_required,
      open_event_eligible = excluded.open_event_eligible,
      noise_level = excluded.noise_level,
      live_music_at_night = excluded.live_music_at_night,
      indoor = excluded.indoor,
      outdoor = excluded.outdoor,
      weather_sensitive = excluded.weather_sensitive,
      safety_score = excluded.safety_score,
      transit_score = excluded.transit_score,
      arrival_landmark = excluded.arrival_landmark,
      hours = excluded.hours,
      hobbies = excluded.hobbies,
      cuisine_tags = excluded.cuisine_tags,
      source = excluded.source,
      yelp_rating = excluded.yelp_rating,
      google_place_id = excluded.google_place_id,
      status = excluded.status,
      closure_reports = excluded.closure_reports,
      verified_open_at = coalesce(excluded.verified_open_at, platform.venues.verified_open_at),
      geo_expires_at = excluded.geo_expires_at,
      recheck_after = excluded.recheck_after,
      persona_priors = excluded.persona_priors,
      updated_at = now()
    returning *
  `;
  return mapVenueRow(row!);
}

export async function updateVenueStatus(
  sql: SQL,
  venueId: string,
  status: VenueStatus,
  reason?: string
): Promise<{ venue: VenueRecord; reason?: string } | null> {
  if (!VALID_VENUE_STATUSES.has(status)) {
    throw new Error(`Invalid venue status: ${status}`);
  }
  const bumpClosure = status === "suspect_closed" || status === "closed_temporary" || status === "closed_permanent";
  const [row] = await sql`
    update platform.venues
    set status = ${status},
        closure_reports = case when ${bumpClosure} then closure_reports + 1 else closure_reports end,
        recheck_after = case when ${status === "active"} then null else recheck_after end,
        updated_at = now()
    where id = ${venueId}
    returning *
  `;
  if (!row) return null;
  return { venue: mapVenueRow(row), ...(reason ? { reason } : {}) };
}

export async function recordVenueVisit(
  sql: SQL,
  appId: AppId,
  venueId: string,
  memberId: string,
  opportunityId: string | null,
  visitedAt: number,
  opts?: { id?: string; sentiment?: string; issues?: string[]; closedReport?: boolean }
): Promise<{ id: string }> {
  const id = opts?.id ?? `vv_${randomUUID()}`;
  await withAppScope(sql, appId, async tx => {
    await tx`
      insert into network.venue_visits
        (id, app_id, member_id, venue_id, opportunity_id, visited_at, sentiment, issues, closed_report)
      values (
        ${id}, ${appId}, ${memberId}, ${venueId}, ${opportunityId},
        ${new Date(visitedAt)}, ${opts?.sentiment ?? null},
        ${JSON.stringify(opts?.issues ?? [])}::jsonb, ${opts?.closedReport === true}
      )
      on conflict (id) do nothing
    `;
    await tx`
      update platform.venues
      set visit_count = visit_count + 1,
          closure_reports = case when ${opts?.closedReport === true} then closure_reports + 1 else closure_reports end,
          updated_at = now()
      where id = ${venueId}
    `;
  });
  return { id };
}

export async function recordVenueRejection(
  sql: SQL,
  appId: AppId,
  venueId: string,
  memberId: string,
  reason: string,
  rejectedAt: number
): Promise<void> {
  await withAppScope(sql, appId, async tx => {
    await tx`
      insert into network.venue_rejections (app_id, member_id, venue_id, reason, rejected_at)
      values (${appId}, ${memberId}, ${venueId}, ${reason}, ${new Date(rejectedAt)})
      on conflict (app_id, member_id, venue_id) do update set
        reason = excluded.reason,
        rejected_at = excluded.rejected_at
    `;
  });
}

export async function listMemberVenueHistory(
  sql: SQL,
  appId: AppId,
  memberIds: readonly string[]
): Promise<Map<string, MemberVenueHistory>> {
  const out = new Map<string, MemberVenueHistory>();
  for (const id of memberIds) out.set(id, { visitedVenueIds: [], rejectedVenueIds: [] });
  if (!memberIds.length) return out;
  const uniqueIds = [...new Set(memberIds)];
  await withAppScope(sql, appId, async tx => {
    const [visits, rejections] = await Promise.all([
      tx<{ member_id: string; venue_id: string }[]>`
        select distinct member_id, venue_id
        from network.venue_visits
        where app_id = ${appId} and member_id = any(${tx.array(uniqueIds, "TEXT")})
      `,
      tx<{ member_id: string; venue_id: string }[]>`
        select member_id, venue_id
        from network.venue_rejections
        where app_id = ${appId} and member_id = any(${tx.array(uniqueIds, "TEXT")})
      `,
    ]);
    for (const r of visits) {
      const entry = out.get(r.member_id);
      if (entry && !entry.visitedVenueIds.includes(r.venue_id)) entry.visitedVenueIds.push(r.venue_id);
    }
    for (const r of rejections) {
      const entry = out.get(r.member_id);
      if (entry && !entry.rejectedVenueIds.includes(r.venue_id)) entry.rejectedVenueIds.push(r.venue_id);
    }
  });
  return out;
}

export async function reserveVenueConcurrentHold(
  sql: SQL,
  input: ReserveVenueConcurrentHoldInput
): Promise<ReserveVenueConcurrentHoldResult> {
  if (!Number.isSafeInteger(input.headcount) || input.headcount <= 0 || input.windowEnd <= input.windowStart) {
    return { ok: false, reason: "invalid_window", currentHeadcount: 0, capacity: 0 };
  }
  const holdId = input.id ?? `hold:${input.appId}:${input.opportunityId}:${input.venueId}`;
  return inTx(sql, async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${`venue_hold:${input.venueId}`}))`;
    const [venue] = await tx<{ status: string; walk_in_group_capacity: number }[]>`
      select status, walk_in_group_capacity
      from platform.venues
      where id = ${input.venueId}
    `;
    if (!venue || venue.status !== "active") {
      return { ok: false, reason: "venue_unavailable", currentHeadcount: 0, capacity: 0 };
    }
    const capacity = Number(venue.walk_in_group_capacity);
    const [agg] = await tx<{ total: number }[]>`
      select coalesce(sum(headcount), 0)::int as total
      from platform.venue_concurrent_holds
      where venue_id = ${input.venueId}
        and status = 'active'
        and window_start < ${new Date(input.windowEnd)}
        and window_end > ${new Date(input.windowStart)}
        and id <> ${holdId}
    `;
    const existing = Number(agg?.total ?? 0);
    if (existing + input.headcount > capacity) {
      return { ok: false, reason: "capacity_exceeded", currentHeadcount: existing, capacity };
    }
    await tx`
      insert into platform.venue_concurrent_holds
        (id, app_id, venue_id, opportunity_id, window_start, window_end, headcount, status, updated_at)
      values (
        ${holdId}, ${input.appId}, ${input.venueId}, ${input.opportunityId},
        ${new Date(input.windowStart)}, ${new Date(input.windowEnd)}, ${input.headcount}, 'active', now()
      )
      on conflict (id) do update set
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        headcount = excluded.headcount,
        status = 'active',
        updated_at = now()
    `;
    return { ok: true, id: holdId, currentHeadcount: existing + input.headcount, capacity };
  });
}

export async function releaseVenueConcurrentHold(sql: SQL, opportunityId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update platform.venue_concurrent_holds
    set status = 'released', updated_at = now()
    where opportunity_id = ${opportunityId} and status = 'active'
    returning id
  `;
  return rows.length;
}

export async function releaseExpiredVenueHolds(sql: SQL, nowMs: number): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update platform.venue_concurrent_holds
    set status = 'completed', updated_at = ${new Date(nowMs)}
    where status = 'active' and window_end <= ${new Date(nowMs)}
    returning id
  `;
  return rows.length;
}

export async function activeVenueConcurrentHeadcount(
  sql: SQL,
  venueId: string,
  windowStart: number,
  windowEnd: number
): Promise<number> {
  const [row] = await sql<{ total: number }[]>`
    select coalesce(sum(headcount), 0)::int as total
    from platform.venue_concurrent_holds
    where venue_id = ${venueId}
      and status = 'active'
      and window_start < ${new Date(windowEnd)}
      and window_end > ${new Date(windowStart)}
  `;
  return Number(row?.total ?? 0);
}

export async function activeVenueConcurrentHeadcounts(
  sql: SQL,
  venueIds: readonly string[],
  windowStart: number,
  windowEnd: number
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!venueIds.length) return out;
  const rows = await sql<{ venue_id: string; total: number }[]>`
    select venue_id, coalesce(sum(headcount), 0)::int as total
    from platform.venue_concurrent_holds
    where venue_id = any(${sql.array([...new Set(venueIds)], "TEXT")})
      and status = 'active'
      and window_start < ${new Date(windowEnd)}
      and window_end > ${new Date(windowStart)}
    group by venue_id
  `;
  for (const r of rows) out[r.venue_id] = Number(r.total);
  return out;
}

export async function upsertMeetupArrival(
  sql: SQL,
  appId: AppId,
  arrival: MeetupArrivalInput
): Promise<{ id: string }> {
  const id = arrival.id ?? `ma_${randomUUID()}`;
  const rowId = await withAppScope(sql, appId, async tx => {
    const [row] = await tx<{ id: string }[]>`
      insert into network.meetup_arrivals
        (id, app_id, opportunity_id, member_id, state, eta_mins, safe_cue, backup_venue_id, updated_at)
      values (
        ${id}, ${appId}, ${arrival.opportunityId}, ${arrival.memberId},
        ${arrival.state}, ${arrival.etaMins ?? null}, ${arrival.safeCue ?? ""},
        ${arrival.backupVenueId ?? null}, ${new Date(arrival.updatedAt)}
      )
      on conflict (app_id, opportunity_id, member_id) do update set
        state = excluded.state,
        eta_mins = excluded.eta_mins,
        safe_cue = excluded.safe_cue,
        backup_venue_id = excluded.backup_venue_id,
        updated_at = excluded.updated_at
      returning id
    `;
    return row!.id;
  });
  return { id: rowId };
}

// ============================================================================ External Events

export async function listExternalEvents(
  sql: SQL,
  city?: string,
  status?: ExternalEventStatus
): Promise<StoredExternalEvent[]> {
  const normalizedCity = city?.trim().toLowerCase();
  const rows = await sql`
    select *
    from platform.external_events
    where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      and (${status ?? null}::text is null or status = ${status ?? null})
    order by start_at asc, id asc
  `;
  return rows.map(mapExternalEventRow);
}

export async function findExternalEventByExternalId(
  sql: SQL,
  platform: ExternalEventDbPlatform,
  externalEventId: string
): Promise<StoredExternalEvent | null> {
  const [row] = await sql`
    select *
    from platform.external_events
    where platform = ${platform} and external_event_id = ${externalEventId}
    limit 1
  `;
  return row ? mapExternalEventRow(row) : null;
}

export async function upsertExternalEvent(
  sql: SQL,
  event: UpsertExternalEventInput
): Promise<StoredExternalEvent> {
  if (!isSanctionedExternalEventSource(externalEventSourceCode(event.source))) {
    throw new Error(`Unsanctioned external event source: ${event.source}`);
  }
  if (detectExternalPromptInjection(event.title) || detectExternalPromptInjection(event.description ?? "")) {
    throw new Error("External event text failed prompt-injection check");
  }
  const status: ExternalEventStatus = event.status ?? "draft";
  const [row] = await sql`
    insert into platform.external_events (
      id, city, app_id, source, platform, external_event_id, external_url,
      title, interest, description, venue_id, backup_venue_id, is_public,
      start_at, end_at, anchor_member_id, confirmed_network_anchors,
      confirmed_network_total, approved_external_cap, hide_guest_list,
      approval_required, external_crowd_disclosed, review_approved,
      review_item_id, status, updated_at
    ) values (
      ${event.id}, ${event.city.trim().toLowerCase()}, ${event.appId ?? "friends"}, ${event.source}, ${event.platform},
      ${event.externalEventId ?? null}, ${event.externalUrl ?? null},
      ${event.title}, ${event.interest ?? ""}, ${event.description ?? ""},
      ${event.venueId}, ${event.backupVenueId ?? null}, true,
      ${new Date(event.startAt)}, ${new Date(event.endAt)}, ${event.anchorMemberId ?? null},
      ${event.confirmedNetworkAnchors ?? 0}, ${event.confirmedNetworkTotal ?? 0},
      ${event.approvedExternalCap ?? 0}, true, true,
      ${event.externalCrowdDisclosed === true}, ${event.reviewApproved === true},
      ${event.reviewItemId ?? null}, ${status}, now()
    )
    on conflict (id) do update set
      city = excluded.city,
      app_id = excluded.app_id,
      source = excluded.source,
      platform = excluded.platform,
      external_event_id = coalesce(excluded.external_event_id, platform.external_events.external_event_id),
      external_url = coalesce(excluded.external_url, platform.external_events.external_url),
      title = excluded.title,
      interest = excluded.interest,
      description = excluded.description,
      venue_id = excluded.venue_id,
      backup_venue_id = excluded.backup_venue_id,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      anchor_member_id = excluded.anchor_member_id,
      confirmed_network_anchors = excluded.confirmed_network_anchors,
      confirmed_network_total = excluded.confirmed_network_total,
      approved_external_cap = excluded.approved_external_cap,
      external_crowd_disclosed = excluded.external_crowd_disclosed,
      review_approved = excluded.review_approved,
      review_item_id = coalesce(excluded.review_item_id, platform.external_events.review_item_id),
      status = excluded.status,
      updated_at = now()
    returning *
  `;
  return mapExternalEventRow(row!);
}

export async function reviewExternalEvent(
  sql: SQL,
  eventId: string,
  approved: boolean,
  reviewer: string
): Promise<{ event: StoredExternalEvent; reviewer: string } | null> {
  const [row] = await sql`
    update platform.external_events
    set review_approved = ${approved},
        status = case
          when ${!approved} and status in ('draft', 'pending_review') then 'cancelled'
          else status
        end,
        updated_at = now()
    where id = ${eventId}
    returning *
  `;
  if (!row) return null;
  return { event: mapExternalEventRow(row), reviewer };
}

export async function publishExternalEvent(
  sql: SQL,
  eventId: string,
  clockMs: number
): Promise<{ ok: true; event: StoredExternalEvent } | { ok: false; reason: string }> {
  return inTx(sql, async tx => {
    const [row] = await tx`
      select e.*, v.is_public as venue_is_public, v.walk_in_group_capacity as venue_cap, v.status as venue_status
      from platform.external_events e
      join platform.venues v on v.id = e.venue_id
      where e.id = ${eventId}
      for update of e
    `;
    if (!row) return { ok: false, reason: "not_found" };
    const sourceSanctioned = isSanctionedExternalEventSource(externalEventSourceCode(row.source as ExternalEventSource));
    const venueWalkInCapacity = Number(row.venue_cap);
    const confirmedNetworkAnchors = Number(row.confirmed_network_anchors);
    const confirmedNetworkTotal = Math.max(Number(row.confirmed_network_total), confirmedNetworkAnchors);
    const targetRoomSize = Math.min(venueWalkInCapacity, externalEventMaxHeadcount);
    const computedCap = computeApprovedExternalCap(confirmedNetworkTotal, venueWalkInCapacity, targetRoomSize);
    const approvedExternalCap =
      Number(row.approved_external_cap) > 0
        ? Math.min(Number(row.approved_external_cap), computedCap)
        : computedCap;
    const plannedTotal = Math.max(confirmedNetworkTotal + approvedExternalCap, confirmedNetworkAnchors);
    const allowed = canPublishExternalEvent({
      confirmedNetworkAnchors,
      reviewApproved: row.review_approved === true,
      allParticipantsAdult: true,
      isPublicVenue: row.is_public === true && row.venue_is_public === true && row.venue_status === "active",
      sourceSanctioned,
      hideGuestList: row.hide_guest_list === true,
      approvalRequired: row.approval_required === true,
      externalCrowdDisclosed: row.external_crowd_disclosed === true,
      plannedTotal,
      venueWalkInCapacity,
    });
    if (!allowed) return { ok: false, reason: "publish_gate_rejected" };
    const [updated] = await tx`
      update platform.external_events
      set status = 'published',
          confirmed_network_total = ${confirmedNetworkTotal},
          approved_external_cap = ${approvedExternalCap},
          updated_at = ${new Date(clockMs)}
      where id = ${eventId}
      returning *
    `;
    return { ok: true, event: mapExternalEventRow(updated!) };
  });
}

export async function recordExternalEventRsvp(
  sql: SQL,
  rsvp: RecordExternalEventRsvpInput
): Promise<RecordExternalEventRsvpResult> {
  const screeningAnswer = (rsvp.screeningAnswer ?? "").trim().slice(0, 500);
  const injection = screeningAnswer ? detectExternalPromptInjection(screeningAnswer) : null;
  const statedAge =
    typeof rsvp.statedAge === "number" && Number.isInteger(rsvp.statedAge)
      ? rsvp.statedAge
      : rsvp.confirmedAdult18Plus === true
        ? 18
        : 0;
  const adultVerified =
    !injection &&
    canBeMatched(statedAge) &&
    !isMinor(statedAge) &&
    statedAge <= 120 &&
    (rsvp.confirmedAdult18Plus ?? parseAdult18PlusAnswer(statedAge));
  if (!adultVerified) {
    return { ok: false, approved: false, status: "declined", reason: injection ? "prompt_injection" : "underage_or_unverified" };
  }

  return inTx(sql, async tx => {
    const [event] = await tx<{ id: string; status: string; approved_external_cap: number }[]>`
      select id, status, approved_external_cap
      from platform.external_events
      where id = ${rsvp.eventId}
      for update
    `;
    if (!event) {
      return { ok: false, approved: false, status: "declined", reason: "event_not_found" };
    }
    if (event.status !== "published" && event.status !== "active") {
      return { ok: false, approved: false, status: "declined", reason: "event_not_open" };
    }
    const [countRow] = await tx<{ n: number }[]>`
      select count(*)::int as n
      from platform.external_event_rsvps
      where event_id = ${rsvp.eventId}
        and status = 'approved'
        and guest_external_id <> ${rsvp.guestExternalId}
    `;
    const currentApprovedExternal = Number(countRow?.n ?? 0);
    const answeredScreeningQuestion = rsvp.answeredScreeningQuestion ?? screeningAnswer.length >= 2;
    const canApprove = canApproveExternalEventRsvp({
      attendeeAge: statedAge,
      banned: rsvp.banned === true,
      optedOut: rsvp.optedOut === true,
      held: rsvp.held === true,
      currentApprovedExternal,
      approvedExternalCap: Number(event.approved_external_cap),
      answeredScreeningQuestion,
    });

    let finalStatus: ExternalEventRsvpDbStatus;
    if (rsvp.banned || rsvp.optedOut || rsvp.held || rsvp.requestedStatus === "declined") {
      finalStatus = "declined";
    } else if (canApprove) {
      finalStatus = "approved";
    } else if (currentApprovedExternal >= Number(event.approved_external_cap)) {
      finalStatus = "waitlist";
    } else {
      finalStatus = "pending_approval";
    }

    const rsvpId = rsvp.id ?? `rsvp_${randomUUID()}`;
    const updatedAt = rsvp.nowMs !== undefined ? new Date(rsvp.nowMs) : null;
    const [saved] = await tx`
      insert into platform.external_event_rsvps (
        id, event_id, platform, guest_external_id, first_name, stated_age,
        screening_answer, status, updated_at
      ) values (
        ${rsvpId}, ${rsvp.eventId}, ${rsvp.platform}, ${rsvp.guestExternalId},
        ${(rsvp.firstName ?? "").slice(0, 80)}, ${statedAge}, ${screeningAnswer},
        ${finalStatus}, coalesce(${updatedAt}::timestamptz, now())
      )
      on conflict (event_id, guest_external_id) do update set
        first_name = excluded.first_name,
        stated_age = excluded.stated_age,
        screening_answer = excluded.screening_answer,
        status = excluded.status,
        updated_at = coalesce(${updatedAt}::timestamptz, now())
      returning *
    `;
    return {
      ok: true,
      approved: finalStatus === "approved",
      status: finalStatus,
      rsvp: mapExternalEventRsvpRow(saved!),
    };
  });
}

export async function sweepExternalEventT24Quorum(
  sql: SQL,
  clockMs: number
): Promise<T24QuorumSweepResult> {
  const cancelledNoAnchor: string[] = [];
  const cancelledLowQuorum: string[] = [];
  const kept: string[] = [];

  await inTx(sql, async tx => {
    const events = await tx<{
      id: string;
      start_at: Date;
      confirmed_network_anchors: number;
      confirmed_network_total: number;
      approved_external_rsvps: number;
    }[]>`
      select e.id, e.start_at, e.confirmed_network_anchors, e.confirmed_network_total,
             coalesce(count(r.id) filter (where r.status = 'approved'), 0)::int as approved_external_rsvps
      from platform.external_events e
      left join platform.external_event_rsvps r on r.event_id = e.id
      where e.status in ('published', 'active') and e.start_at > ${new Date(clockMs)}
      group by e.id
      order by e.start_at asc, e.id asc
    `;
    for (const ev of events) {
      const hoursToStart = Math.floor((ev.start_at.getTime() - clockMs) / 3_600_000);
      const decision = evaluateExternalEventT24Quorum(
        Number(ev.confirmed_network_anchors),
        Number(ev.confirmed_network_total),
        Number(ev.approved_external_rsvps),
        hoursToStart
      );
      if (decision === "cancel_no_anchor") {
        await tx`
          update platform.external_events
          set status = 'cancelled_no_anchor', updated_at = ${new Date(clockMs)}
          where id = ${ev.id}
        `;
        cancelledNoAnchor.push(ev.id);
      } else if (decision === "cancel_low_quorum") {
        await tx`
          update platform.external_events
          set status = 'cancelled_low_quorum', updated_at = ${new Date(clockMs)}
          where id = ${ev.id}
        `;
        cancelledLowQuorum.push(ev.id);
      } else {
        kept.push(ev.id);
      }
    }
  });

  return {
    checked: cancelledNoAnchor.length + cancelledLowQuorum.length + kept.length,
    cancelledNoAnchor,
    cancelledLowQuorum,
    kept,
  };
}

// ============================================================================ Matchmakers & Prospects

export async function listMatchmakerPersonas(
  sql: SQL,
  city?: string,
  appId?: AppId
): Promise<MatchmakerPersona[]> {
  if (appId && isBusinessDomain(appId)) {
    throw new Error("forbidden: matchmaker personas are unavailable on peon");
  }
  const normalizedCity = city?.trim().toLowerCase();
  const rows = await sql`
    select *
    from platform.matchmaker_personas
    where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
    order by city, gender
  `;
  return rows.map(mapMatchmakerPersonaRow);
}

export async function updateMatchmakerPersonaStatus(
  sql: SQL,
  personaId: string,
  status: PersonaHealthStatus,
  reason?: string,
  appId?: AppId
): Promise<{ persona: MatchmakerPersona; preservedOffAppTickets: number } | null> {
  if (appId && isBusinessDomain(appId)) {
    throw new Error("forbidden: matchmaker personas cannot be modified from peon");
  }
  if (!VALID_PERSONA_STATUSES.has(status)) {
    throw new Error(`Invalid matchmaker persona status: ${status}`);
  }
  return inTx(sql, async tx => {
    const [row] = await tx`
      update platform.matchmaker_personas
      set status = ${status},
          kill_switch_reason = case
            when ${status === "suspended"} then coalesce(${reason ?? null}, 'staff_kill_switch')
            when ${status === "active"} then null
            else coalesce(${reason ?? null}, kill_switch_reason)
          end,
          kill_switch_at = case
            when ${status === "suspended"} then now()
            when ${status === "active"} then null
            else kill_switch_at
          end,
          updated_at = now()
      where id = ${personaId}
      returning *
    `;
    if (!row) return null;
    let preservedOffAppTickets = 0;
    if (status === "suspended") {
      await tx`select set_config('app.app_id', 'slop', true), set_config('app.current_app', 'slop', true)`;
      const preserved = await tx<{ id: string }[]>`
        select id
        from platform.external_sourcing_tickets
        where assigned_persona_id = ${personaId}
          and off_app_sms_opted_in = true
          and state not in ('closed', 'completed')
      `;
      preservedOffAppTickets = preserved.length;
    }
    return { persona: mapMatchmakerPersonaRow(row), preservedOffAppTickets };
  });
}

export async function isPhoneHashSuppressed(sql: SQL, phoneHash: string | null | undefined): Promise<boolean> {
  if (!phoneHash || !phoneHash.trim()) return false;
  const [row] = await sql<{ suppressed: boolean }[]>`
    select platform.is_suppressed_phone_hash(${phoneHash.trim()}) as suppressed
  `;
  return row?.suppressed === true;
}

export async function suppressExternalProspect(
  sql: SQL,
  dedupeHash: string,
  phoneHash: string | null | undefined,
  city: string,
  reason: SuppressionReason,
  suppressUntil?: number | null
): Promise<void> {
  const permanent = suppressUntil === undefined || suppressUntil === null;
  const normalizedCity = city.trim().toLowerCase();
  const normalizedPhoneHash = phoneHash?.trim() || null;
  await withAppScope(sql, "slop", async tx => {
    await tx`
      insert into platform.external_prospect_suppressions
        (city, dedupe_hash, phone_hash, reason, suppress_until, permanent)
      values (
        ${normalizedCity}, ${dedupeHash}, ${normalizedPhoneHash}, ${reason},
        ${permanent ? null : new Date(suppressUntil)}, ${permanent}
      )
      on conflict (dedupe_hash) do update set
        city = excluded.city,
        phone_hash = coalesce(excluded.phone_hash, platform.external_prospect_suppressions.phone_hash),
        reason = case when platform.external_prospect_suppressions.permanent then platform.external_prospect_suppressions.reason else excluded.reason end,
        permanent = platform.external_prospect_suppressions.permanent or excluded.permanent,
        suppress_until = case
          when platform.external_prospect_suppressions.permanent or excluded.permanent then null
          else greatest(coalesce(platform.external_prospect_suppressions.suppress_until, excluded.suppress_until), excluded.suppress_until)
        end
    `;
    await tx`
      delete from platform.external_prospects
      where dedupe_hash = ${dedupeHash}
         or (${normalizedPhoneHash}::text is not null and phone_hash = ${normalizedPhoneHash})
    `;
  });
}

export async function upsertExternalProspect(
  sql: SQL,
  appId: AppId,
  prospect: UpsertExternalProspectInput
): Promise<UpsertExternalProspectResult> {
  if (!canReadExternalProspectInApp(appCodeOf(appId))) {
    return { ok: false, reason: "forbidden_app" };
  }
  const normalizedCity = prospect.city.trim().toLowerCase();
  const normalizedPhoneHash = prospect.phoneHash?.trim() || null;

  if (!canBeMatched(prospect.statedAge) || isMinor(prospect.statedAge) || prospect.statedAge > 120) {
    await suppressExternalProspect(sql, prospect.dedupeHash, normalizedPhoneHash, normalizedCity, "underage", null);
    return { ok: false, reason: "underage" };
  }
  if (prospect.redFlagged || prospect.consentState === "stopped" || prospect.consentState === "declined" || prospect.consentState === "banned") {
    const reason: SuppressionReason =
      prospect.redFlagged ? "red_flag" : prospect.consentState === "declined" ? "declined" : "stopped";
    await suppressExternalProspect(sql, prospect.dedupeHash, normalizedPhoneHash, normalizedCity, reason, null);
    return { ok: false, reason: prospect.redFlagged ? "red_flagged" : "suppressed" };
  }
  if (normalizedPhoneHash && (await isPhoneHashSuppressed(sql, normalizedPhoneHash))) {
    return { ok: false, reason: "suppressed" };
  }

  return withAppScope(sql, "slop", async tx => {
    const nowRef = prospect.nowMs !== undefined ? new Date(prospect.nowMs) : null;
    const [existingSuppression] = await tx<{ dedupe_hash: string }[]>`
      select dedupe_hash
      from platform.external_prospect_suppressions
      where dedupe_hash = ${prospect.dedupeHash}
        and (permanent or (suppress_until is not null and suppress_until > coalesce(${nowRef}::timestamptz, now())))
      limit 1
    `;
    if (existingSuppression) {
      return { ok: false, reason: "suppressed" };
    }
    const cleanFacets = sanitizeProspectFacets(prospect.facets ?? {});
    const id = prospect.id ?? `ep_${randomUUID()}`;
    const [saved] = await tx<{ id: string }[]>`
      insert into platform.external_prospects (
        id, city, source_platform, assigned_persona_id, dedupe_hash, phone_hash,
        first_name, stated_age, gender, seeks, neighborhood, facets,
        consent_state, recontact_count, invite_attempts, expires_at,
        converted_member_id, held, red_flagged, updated_at
      ) values (
        ${id}, ${normalizedCity}, ${prospect.sourcePlatform}, ${prospect.assignedPersonaId},
        ${prospect.dedupeHash}, ${normalizedPhoneHash},
        ${(prospect.firstName ?? "").slice(0, 80)}, ${prospect.statedAge},
        ${prospect.gender ?? "unknown"}, ${JSON.stringify(prospect.seeks ?? [])}::jsonb,
        ${(prospect.neighborhood ?? "").slice(0, 120)}, ${JSON.stringify(cleanFacets)}::jsonb,
        ${prospect.consentState ?? "none"}, ${prospect.recontactCount ?? 0},
        ${prospect.inviteAttempts ?? 0}, ${new Date(prospect.expiresAt)},
        ${prospect.convertedMemberId ?? null}, ${prospect.held === true}, false,
        coalesce(${nowRef}::timestamptz, now())
      )
      on conflict (city, dedupe_hash) do update set
        phone_hash = coalesce(excluded.phone_hash, platform.external_prospects.phone_hash),
        first_name = excluded.first_name,
        stated_age = excluded.stated_age,
        gender = excluded.gender,
        seeks = excluded.seeks,
        neighborhood = excluded.neighborhood,
        facets = excluded.facets,
        consent_state = excluded.consent_state,
        recontact_count = excluded.recontact_count,
        invite_attempts = excluded.invite_attempts,
        expires_at = excluded.expires_at,
        converted_member_id = coalesce(excluded.converted_member_id, platform.external_prospects.converted_member_id),
        held = excluded.held,
        updated_at = coalesce(${nowRef}::timestamptz, now())
      returning id
    `;
    return { ok: true, id: saved!.id };
  });
}

export async function purgeExpiredProspects(
  sql: SQL,
  nowMs: number
): Promise<{ purgedProspects: number; purgedTombstones: number }> {
  const nowDate = new Date(nowMs);
  const ttlSuppressionUntil = new Date(nowMs + 30 * 86_400_000);
  return withAppScope(sql, "slop", async tx => {
    const expired = await tx<{
      id: string;
      city: string;
      dedupe_hash: string;
      phone_hash: string | null;
      consent_state: ExternalProspectConsentState;
      red_flagged: boolean;
    }[]>`
      select id, city, dedupe_hash, phone_hash, consent_state, red_flagged
      from platform.external_prospects
      where converted_member_id is null
        and (
          expires_at <= ${nowDate}
          or red_flagged = true
          or consent_state in ('declined', 'stopped', 'banned')
        )
    `;
    for (const row of expired) {
      const permanent = row.red_flagged || row.consent_state === "declined" || row.consent_state === "stopped" || row.consent_state === "banned";
      const reason: SuppressionReason = row.red_flagged
        ? "red_flag"
        : row.consent_state === "declined"
          ? "declined"
          : row.consent_state === "stopped" || row.consent_state === "banned"
            ? "stopped"
            : "expired";
      await tx`
        insert into platform.external_prospect_suppressions
          (city, dedupe_hash, phone_hash, reason, suppress_until, permanent)
        values (
          ${row.city}, ${row.dedupe_hash}, ${row.phone_hash}, ${reason},
          ${permanent ? null : ttlSuppressionUntil}, ${permanent}
        )
        on conflict (dedupe_hash) do update set
          phone_hash = coalesce(excluded.phone_hash, platform.external_prospect_suppressions.phone_hash),
          permanent = platform.external_prospect_suppressions.permanent or excluded.permanent,
          suppress_until = case
            when platform.external_prospect_suppressions.permanent or excluded.permanent then null
            else greatest(coalesce(platform.external_prospect_suppressions.suppress_until, excluded.suppress_until), excluded.suppress_until)
          end
      `;
    }
    let purgedProspects = 0;
    if (expired.length) {
      const ids = expired.map(r => r.id);
      const deleted = await tx<{ id: string }[]>`
        delete from platform.external_prospects
        where id = any(${tx.array(ids, "TEXT")})
        returning id
      `;
      purgedProspects = deleted.length;
    }
    const deletedTombstones = await tx<{ dedupe_hash: string }[]>`
      delete from platform.external_prospect_suppressions
      where permanent = false and suppress_until is not null and suppress_until <= ${nowDate}
      returning dedupe_hash
    `;
    return { purgedProspects, purgedTombstones: deletedTombstones.length };
  });
}

export async function upsertSourcingTicket(
  sql: SQL,
  appId: AppId,
  ticket: UpsertSourcingTicketInput
): Promise<{ ok: true; id: string } | { ok: false; reason: "forbidden_app" }> {
  if (!canReadExternalProspectInApp(appCodeOf(appId))) {
    return { ok: false, reason: "forbidden_app" };
  }
  const normalizedCity = ticket.city.trim().toLowerCase();
  const nowRef = ticket.nowMs !== undefined ? new Date(ticket.nowMs) : null;
  const savedId = await withAppScope(sql, "slop", async tx => {
    const [row] = await tx<{ id: string }[]>`
      insert into platform.external_sourcing_tickets (
        id, city, app_id, member_id, prospect_id, prospect_dedupe_hash,
        assigned_persona_id, review_item_id, booked_opportunity_id,
        state, off_app_sms_opted_in, venue_id, closed_reason, updated_at
      ) values (
        ${ticket.id}, ${normalizedCity}, ${ticket.appId ?? "slop"}, ${ticket.memberId},
        ${ticket.prospectId ?? null}, ${ticket.prospectDedupeHash ?? null},
        ${ticket.assignedPersonaId}, ${ticket.reviewItemId ?? null}, ${ticket.bookedOpportunityId ?? null},
        ${ticket.state}, ${ticket.offAppSmsOptedIn === true}, ${ticket.venueId ?? null},
        ${ticket.closedReason ?? null}, coalesce(${nowRef}::timestamptz, now())
      )
      on conflict (id) do update set
        prospect_id = coalesce(excluded.prospect_id, platform.external_sourcing_tickets.prospect_id),
        prospect_dedupe_hash = coalesce(excluded.prospect_dedupe_hash, platform.external_sourcing_tickets.prospect_dedupe_hash),
        assigned_persona_id = excluded.assigned_persona_id,
        review_item_id = coalesce(excluded.review_item_id, platform.external_sourcing_tickets.review_item_id),
        booked_opportunity_id = coalesce(excluded.booked_opportunity_id, platform.external_sourcing_tickets.booked_opportunity_id),
        state = excluded.state,
        off_app_sms_opted_in = excluded.off_app_sms_opted_in,
        venue_id = coalesce(excluded.venue_id, platform.external_sourcing_tickets.venue_id),
        closed_reason = excluded.closed_reason,
        updated_at = coalesce(${nowRef}::timestamptz, now())
      returning id
    `;
    return row!.id;
  });
  return { ok: true, id: savedId };
}

export async function cityReadinessSnapshot(
  sql: SQL,
  city?: string
): Promise<CityReadinessEntry[]> {
  const normalizedCity = city?.trim().toLowerCase();
  const [cities, venueCounts, personaCounts, eventCounts, networkRows] = await Promise.all([
    sql<{ id: string; name: string; tz: string; launch_status: CityLaunchStatus }[]>`
      select id, name, tz, launch_status
      from platform.cities
      where (${normalizedCity ?? null}::text is null or id = ${normalizedCity ?? null})
      order by id
    `,
    sql<{ city: string; active_venues: number; all_ages_venues: number }[]>`
      select city,
             count(*) filter (where status = 'active')::int as active_venues,
             count(*) filter (where status = 'active' and all_ages = true)::int as all_ages_venues
      from platform.venues
      where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      group by city
    `,
    sql<{ city: string; active_personas: number; suspended_personas: number }[]>`
      select city,
             count(*) filter (where status = 'active')::int as active_personas,
             count(*) filter (where status = 'suspended')::int as suspended_personas
      from platform.matchmaker_personas
      where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      group by city
    `,
    sql<{ city: string; published_events: number }[]>`
      select city,
             count(*) filter (where status in ('published', 'active'))::int as published_events
      from platform.external_events
      where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      group by city
    `,
    sql<{ city: string; id: string }[]>`
      select city, id
      from platform.networks
      where (${normalizedCity ?? null}::text is null or city = ${normalizedCity ?? null})
      order by id
    `,
  ]);

  const venuesByCity = new Map(venueCounts.map(r => [r.city, r]));
  const personasByCity = new Map(personaCounts.map(r => [r.city, r]));
  const eventsByCity = new Map(eventCounts.map(r => [r.city, Number(r.published_events)]));
  const networksByCity = new Map<string, string[]>();
  for (const r of networkRows) {
    const list = networksByCity.get(r.city) ?? [];
    list.push(r.id);
    networksByCity.set(r.city, list);
  }

  return cities.map(c => ({
    city: c.id,
    name: c.name,
    tz: c.tz,
    launchStatus: c.launch_status,
    activeVenues: Number(venuesByCity.get(c.id)?.active_venues ?? 0),
    allAgesVenues: Number(venuesByCity.get(c.id)?.all_ages_venues ?? 0),
    activeMatchmakers: Number(personasByCity.get(c.id)?.active_personas ?? 0),
    suspendedMatchmakers: Number(personasByCity.get(c.id)?.suspended_personas ?? 0),
    publishedExternalEvents: eventsByCity.get(c.id) ?? 0,
    activeNetworks: networksByCity.get(c.id) ?? [],
  }));
}

export class PgMeetupStore {
  constructor(readonly sql: SQL) {}

  listActiveVenues(city: string) {
    return listActiveVenues(this.sql, city);
  }
  listVenues(city?: string, status?: VenueStatus) {
    return listVenues(this.sql, city, status);
  }
  upsertVenue(venue: VenueRecord) {
    return upsertVenue(this.sql, venue);
  }
  updateVenueStatus(venueId: string, status: VenueStatus, reason?: string) {
    return updateVenueStatus(this.sql, venueId, status, reason);
  }
  recordVenueVisit(
    appId: AppId,
    venueId: string,
    memberId: string,
    opportunityId: string | null,
    visitedAt: number,
    opts?: { id?: string; sentiment?: string; issues?: string[]; closedReport?: boolean }
  ) {
    return recordVenueVisit(this.sql, appId, venueId, memberId, opportunityId, visitedAt, opts);
  }
  recordVenueRejection(appId: AppId, venueId: string, memberId: string, reason: string, rejectedAt: number) {
    return recordVenueRejection(this.sql, appId, venueId, memberId, reason, rejectedAt);
  }
  listMemberVenueHistory(appId: AppId, memberIds: readonly string[]) {
    return listMemberVenueHistory(this.sql, appId, memberIds);
  }
  reserveVenueConcurrentHold(input: ReserveVenueConcurrentHoldInput) {
    return reserveVenueConcurrentHold(this.sql, input);
  }
  releaseVenueConcurrentHold(opportunityId: string) {
    return releaseVenueConcurrentHold(this.sql, opportunityId);
  }
  releaseExpiredVenueHolds(nowMs: number) {
    return releaseExpiredVenueHolds(this.sql, nowMs);
  }
  activeVenueConcurrentHeadcount(venueId: string, windowStart: number, windowEnd: number) {
    return activeVenueConcurrentHeadcount(this.sql, venueId, windowStart, windowEnd);
  }
  activeVenueConcurrentHeadcounts(venueIds: readonly string[], windowStart: number, windowEnd: number) {
    return activeVenueConcurrentHeadcounts(this.sql, venueIds, windowStart, windowEnd);
  }
  upsertMeetupArrival(appId: AppId, arrival: MeetupArrivalInput) {
    return upsertMeetupArrival(this.sql, appId, arrival);
  }
  listExternalEvents(city?: string, status?: ExternalEventStatus) {
    return listExternalEvents(this.sql, city, status);
  }
  findExternalEventByExternalId(platform: ExternalEventDbPlatform, externalEventId: string) {
    return findExternalEventByExternalId(this.sql, platform, externalEventId);
  }
  upsertExternalEvent(event: UpsertExternalEventInput) {
    return upsertExternalEvent(this.sql, event);
  }
  reviewExternalEvent(eventId: string, approved: boolean, reviewer: string) {
    return reviewExternalEvent(this.sql, eventId, approved, reviewer);
  }
  publishExternalEvent(eventId: string, clockMs: number) {
    return publishExternalEvent(this.sql, eventId, clockMs);
  }
  recordExternalEventRsvp(rsvp: RecordExternalEventRsvpInput) {
    return recordExternalEventRsvp(this.sql, rsvp);
  }
  sweepExternalEventT24Quorum(clockMs: number) {
    return sweepExternalEventT24Quorum(this.sql, clockMs);
  }
  listMatchmakerPersonas(city?: string, appId?: AppId) {
    return listMatchmakerPersonas(this.sql, city, appId);
  }
  updateMatchmakerPersonaStatus(personaId: string, status: PersonaHealthStatus, reason?: string, appId?: AppId) {
    return updateMatchmakerPersonaStatus(this.sql, personaId, status, reason, appId);
  }
  upsertExternalProspect(appId: AppId, prospect: UpsertExternalProspectInput) {
    return upsertExternalProspect(this.sql, appId, prospect);
  }
  suppressExternalProspect(
    dedupeHash: string,
    phoneHash: string | null | undefined,
    city: string,
    reason: SuppressionReason,
    suppressUntil?: number | null
  ) {
    return suppressExternalProspect(this.sql, dedupeHash, phoneHash, city, reason, suppressUntil);
  }
  isPhoneHashSuppressed(phoneHash: string | null | undefined) {
    return isPhoneHashSuppressed(this.sql, phoneHash);
  }
  purgeExpiredProspects(nowMs: number) {
    return purgeExpiredProspects(this.sql, nowMs);
  }
  upsertSourcingTicket(appId: AppId, ticket: UpsertSourcingTicketInput) {
    return upsertSourcingTicket(this.sql, appId, ticket);
  }
  cityReadinessSnapshot(city?: string) {
    return cityReadinessSnapshot(this.sql, city);
  }
}
