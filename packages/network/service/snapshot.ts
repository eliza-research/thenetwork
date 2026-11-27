// The WorldSnapshot the Network reads (ctx.snapshot()), built from the `network` Postgres schema:
// members, facets, intents, presence, edges and the opportunities of the last 30 days. The
// production service (service.ts) and the Observatory's shadow engine runs (observatory
// src/sources/real.ts) use this one builder, so both see the same members. It never reads
// network.channel_identities (phones and emails).
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { ADULT_AGE, DAY, isAppId, temporaryPresenceWindow, type Edge, type EdgeType, type Facet, type Intent, type Member, type Presence, type Proposal, type ParticipationState, type WorldSnapshot } from "@thenetwork/core";

import { participationOverride, participationWindowModeKnown, validWindow, windowIsActive } from "../../core/src/generated/participationWindow.ts";
import { presenceWindowCurrentOrFuture } from "../../core/src/generated/travelPresence.ts";
import { durableStaffHoldSnapshotStatus, staffBanSnapshotStatus } from "../../core/src/generated/staffSafetyService.ts";
import type { SetStateRequest } from "../../core/src/svc/contract.ts";
import { peonSeats } from "@thenetwork/engine";
import { earliestDayKeyOf } from "../../core/src/birth-date.ts";
import { birthDateExact, effectiveAge, effectiveBirthKey, readingsConflict, type BirthReadings } from "../../core/src/generated/memberAge.ts";
import { mergeAgeReadings } from "../../core/src/generated/siteEnrollment.ts";
import { readPublicEvents } from "./public-events.ts";
import { teenFriendApp } from "../../core/src/generated/matchLane.ts";

/** Static SQL-only purpose fence for automated inputs; never interpolate a caller-provided identifier. */
export function automatedFacetPredicate(sql: SQL, memberJoin = false) {
  return memberJoin
    ? sql`(f.source is null or f.source not in ('gmail','google_calendar')) and f.id not like 'source-suggestion:%'`
    : sql`(source is null or source not in ('gmail','google_calendar')) and id not like 'source-suggestion:%'`;
}

/** Effective participation comes from the canonical member row and Clock only. */
export function effectiveParticipation(row: {participation_state: ParticipationState; participation_window?: unknown; opted_out?: boolean}, now: number): {
  state: ParticipationState; window: Pick<SetStateRequest,"state"|"from"|"until"|"note"> | null; active: boolean;
} {
  const raw = row.participation_window;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string,unknown> : null;
  const parseBound = (v: unknown) => v === null ? null : typeof v === "string" ? Date.parse(v) : NaN;
  const from = parseBound(value?.from);
  const until = parseBound(value?.until);
  const valid = value && typeof value.state === "string" && participationWindowModeKnown(value.state)
    && (from === null || Number.isFinite(from)) && (until === null || Number.isFinite(until))
    && (value.note === null || typeof value.note === "string")
    && validWindow(from !== null, until !== null, from ?? 0, until ?? 0);
  const window = valid ? value as unknown as Pick<SetStateRequest, "state" | "from" | "until" | "note"> : null;
  // spec/participationWindow.md, "A window starts inclusively and ends exclusively"
  const optedOut = !!row.opted_out;
  const active = windowIsActive(optedOut, window !== null, from !== null, until !== null, from ?? 0, until ?? 0, now);
  const override = participationOverride(optedOut, active, window?.state ?? "");
  const state = override === "KeepBase" ? row.participation_state
    : override === "UseNormal" ? "normal" : override === "UseQuiet" ? "quiet" : "paused";
  return { state, window, active };
}

interface BirthRow {
  ab_birth_date?: unknown; ab_birth_lower?: unknown; ab_birth_upper?: unknown; ab_birth_youngest?: unknown;
  ab_floor_birth_lower?: unknown; ab_floor_birth_upper?: unknown; ab_floor_birth_youngest?: unknown;
  ab_birth_exact?: unknown; ab_age_conflict?: unknown;
  ab_teen_pool_barred?: unknown; ab_teen_pool_held?: unknown; ab_signup_minor_cap?: number | null;
}

export interface AgeRow extends BirthRow { matching_age: unknown; age_missing?: unknown }

export const birthColumns = (sql: SQL) => sql`a.birth_date as ab_birth_date, a.birth_lower as ab_birth_lower, a.birth_upper as ab_birth_upper,
  a.birth_youngest as ab_birth_youngest, a.floor_birth_lower as ab_floor_birth_lower, a.floor_birth_upper as ab_floor_birth_upper,
  a.floor_birth_youngest as ab_floor_birth_youngest, a.signup_minor_cap as ab_signup_minor_cap`;

const consoleAgeColumns = (sql: SQL) => sql`a.birth_exact as ab_birth_exact, a.age_conflict as ab_age_conflict,
  a.signup_minor_cap as ab_signup_minor_cap`;

const readingOf = (lower: unknown, upper: unknown, youngest: unknown): BirthReadings | undefined =>
  upper === null || upper === undefined ? undefined : { lower: Number(lower), upper: Number(upper), youngest: Number(youngest) };

function readingsOf(r: BirthRow): BirthReadings | undefined {
  const person = readingOf(r.ab_birth_lower, r.ab_birth_upper, r.ab_birth_youngest);
  const floor = readingOf(r.ab_floor_birth_lower, r.ab_floor_birth_upper, r.ab_floor_birth_youngest);
  return floor ? mergeAgeReadings(person !== undefined, person ?? floor, floor) : person;
}

export function effectiveAgeOf(r: AgeRow, now: number): number | undefined {
  if (r.age_missing === true) return undefined;
  const readings = readingsOf(r);
  if (readings) {
    const age = effectiveAge(readings, earliestDayKeyOf(now));
    return r.ab_signup_minor_cap == null ? age : Math.min(age, r.ab_signup_minor_cap);
  }
  return r.matching_age === null || r.matching_age === undefined ? undefined : Number(r.matching_age);
}

export function birthFieldsOf(r: BirthRow, now: number): Pick<Member, "birthKey" | "birthExact" | "ageConflict" | "teenBarred" | "teenHeld"> & { age?: number } {
  const readings = readingsOf(r);
  if (!readings) {
    if (r.ab_birth_exact === undefined && r.ab_age_conflict === undefined) return {};
    return {
      birthExact: r.ab_birth_exact === true, ageConflict: r.ab_age_conflict === true,
      teenBarred: r.ab_teen_pool_barred === true, teenHeld: r.ab_teen_pool_held === true,
    };
  }
  const key = effectiveBirthKey(readings);
  const birthDate = r.ab_birth_date === null || r.ab_birth_date === undefined ? undefined : Number(r.ab_birth_date);
  return {
    age: effectiveAge(readings, earliestDayKeyOf(now)), birthKey: key,
    birthExact: birthDateExact(birthDate !== undefined, birthDate ?? 0, readings), ageConflict: readingsConflict(readings),
    teenBarred: r.ab_teen_pool_barred === true, teenHeld: r.ab_teen_pool_held === true,
  };
}

export async function effectiveAgesOf(tx: SQL, app: string, memberIds: readonly string[], now: number): Promise<Map<string, number | undefined>> {
  if (memberIds.length === 0) return new Map();
  await tx`select set_config('app.age_as_of', ${new Date(now).toISOString()}, true)`;
  const rows = await tx<(AgeRow & { member_id: string })[]>`select a.member_id, a.age as matching_age, ((m.age is null or p.id is null or p.lowest_age is null) and a.birth_date is null and not a.signup_age_observed) as age_missing,
      ${birthColumns(tx)}
    from platform.matching_ages a join network.members m on m.app_id=a.app_id and m.id=a.member_id
    left join platform.people p on p.id=m.person_id
    where a.app_id=${app} and a.member_id in ${tx([...new Set(memberIds)])}`;
  return new Map(rows.map(r => [String(r.member_id), effectiveAgeOf(r, now)]));
}

const CORE_EDGES = new Set<EdgeType>(["invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again", "group_only", "avoid", "blocked"]);
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);

/** Durable source-suggestion IDs identify accepted profile-learning purpose without changing privacy scope. */
export function facetOf(r: any): Facet & { learningPurpose?: "network_profile_learning_v1" } {
  return {
    id: r.id, memberId: r.member_id, kind: r.kind, value: r.value, tags: r.tags ?? [], scope: r.privacy_scope, provenance: r.provenance,
    confidence: r.confidence, validFrom: ms(r.valid_from), validTo: ms(r.valid_to), ...(r.source ? { source: r.source } : {}),
    ...(r.sensitive ? { sensitive: r.sensitive } : {}), ...(r.provenance === "inferred" ? { inferred: true } : {}),
    ...(isAppId(r.app_id) ? { app: r.app_id } : {}),
    ...(r.observed_at ? { observedAt: ms(r.observed_at) } : {}), confirmedByMember: r.status === "confirmed",
    ...(typeof r.id === "string" && r.id.startsWith("source-suggestion:") && ["gmail", "google_calendar"].includes(r.source)
      ? { learningPurpose: "network_profile_learning_v1" as const } : {}),
  };
}

export function intentOf(r: any): Intent {
  return {
    id: r.id, memberId: r.member_id, objective: r.objective, category: r.category, details: r.details ?? undefined,
    desiredPeople: r.desired_people ?? undefined, horizonDays: r.horizon_days, status: r.status, createdAt: ms(r.created_at) ?? 0,
    ...(isAppId(r.app_id) ? { app: r.app_id } : {}),
  };
}

export function presenceOf(r: any): Presence {
  return { memberId: r.member_id, city: r.city, type: r.type, areas: r.areas ?? [], ...(r.from_at ? { from: ms(r.from_at) } : {}), ...(r.to_at ? { to: ms(r.to_at) } : {}) };
}

interface SnapshotMemberRow extends AgeRow {
  id: string; name: string; home_city: Member["homeCity"]; prefs: Member["prefs"]; account_status: string; canonical_banned: boolean | null;
  safety_held: boolean | null; matured_signup: boolean; person_minor_signal_at: Date | null; invited_by: string | null; joined_at: Date | null;
  unanswered_proactive: number; participation_state: ParticipationState; participation_window: unknown; opted_out: boolean;
}

interface PairRow { from_id: string; to_id: string; created_at: Date }

/** App isolation always applies. Runtime conversation ownership names homeCities; other readers may use physical city/presence scope. */
export interface SnapshotScope { app: string; city?: string; homeCities?: readonly string[];
  /** Internal owned profile review only. Default snapshots feed matching/background work and exclude deferred Google intake. */
  purpose?: "profile_review";
  /** Network runtime only. Adds a boolean for a cleared signup restriction. */
  includeMaturedSignup?: boolean;
  /** Console roles read app-scoped views that omit raw birth_date and birth-range columns. */
  console?: boolean;
}

/**
 * The engine's and the Network's input at `now`, for one app (platform plan 2.4: nothing crosses apps).
 * Default facet input excludes deferred Google learning even after member acceptance; owned profile-review reads are explicit.
 * Every query filters by app_id. Members who are invited (not joined yet) or removed (declined at
 * join, or left) are left out. A missing age stays undefined, which the Network treats as unknown (a
 * minor until the member says otherwise). An opted-out member reads as "paused". Each member carries
 * `accountStatus`: the Network keeps a paused or restricted account out of matching and sends it only
 * replies and safety notices. Blocks are person to person: a block made on any app is a "blocked"
 * edge here when both people are members of this app (it says nothing about the other app).
 * Without a scope: The Network (ntwrk), every city (the Observatory's shadow runs).
 * Facets, intents and presence of members who are not joined (invited, removed) are left out too. Every
 * query has an ORDER BY, so the same rows give the same snapshot and the same engine run id
 * (audit engine-pipeline-17). The service calls it inside one app-scoped transaction (runtime.ts), so
 * a concurrent write is either fully in or fully out.
 */
export async function loadSnapshot(sql: SQL, now: number, scope: SnapshotScope = { app: "ntwrk" }): Promise<WorldSnapshot> {
  const app = scope.app;
  const [members, facets, intents, presence, edges, recent, parts, personBlocks, events, accepted, teenAvoid] = await Promise.all([
    sql<SnapshotMemberRow[]>`select m.*, a.age as matching_age, a.banned as canonical_banned, (a.staff_held or a.report_held) as safety_held, a.minor_signal_at as person_minor_signal_at,
      ${scope.console ? consoleAgeColumns(sql) : birthColumns(sql)}, a.teen_pool_barred as ab_teen_pool_barred, a.teen_pool_held as ab_teen_pool_held,
      ${scope.includeMaturedSignup ? sql`exists (select 1 from platform.signup_eligibility s where s.person_id=m.person_id and s.eligible_at <= ${new Date(now)})` : sql`false`} as matured_signup
      from network.members m
      left join platform.matching_ages a on a.app_id = m.app_id and a.member_id = m.id
      where m.app_id = ${app} and m.account_status not in ('invited', 'removed') order by m.id`,
    // Acceptance authorizes private intake, not matching or downstream automated use. Privacy scope is independent.
    scope.purpose === 'profile_review'
      ? sql`select * from network.facets where app_id = ${app} and status <> 'rejected' order by member_id, id`
      : sql`select * from network.facets where app_id = ${app} and status <> 'rejected'
          and ${automatedFacetPredicate(sql)} order by member_id, id`,
    sql`select * from network.intents where app_id = ${app} order by member_id, id`,
    sql`select * from network.presence where app_id = ${app} order by member_id, city, type`,
    sql`select * from network.edges where app_id = ${app} order by from_id, to_id, type`,
    sql`select * from network.opportunities where app_id = ${app} and created_at >= ${new Date(now - 30 * DAY)} order by created_at, id`,
    sql`select opportunity_id, member_id, role from network.participations where app_id = ${app} order by opportunity_id, member_id, role`,
    sql`select f.id as from_id, t.id as to_id, pb.at as created_at from platform.person_blocks pb
      join network.members f on f.person_id = pb.from_person and f.app_id = ${app}
      join network.members t on t.person_id = pb.to_person and t.app_id = ${app} order by f.id, t.id`,
    scope.purpose === "profile_review" ? [] : readPublicEvents(sql, now, scope.city),
    sql`select p.opportunity_id, p.member_id, o.created_at from network.participations p
      join network.opportunities o on o.id = p.opportunity_id and o.app_id = ${app}
      where p.app_id = ${app} and p.role = 'participant'
        and o.state in ('SCHEDULED', 'COMPLETED', 'CANCELLED')
        and p.status in ('accepted', 'confirmed', 'attended', 'no_show')
        and p.booked_told
      order by o.created_at, o.id, p.member_id`,
    teenFriendApp(app) ? sql<PairRow[]>`select a.from_id, a.to_id, a.at as created_at from platform.teen_pair_avoid_members a
      where a.app_id = ${app} order by a.from_id, a.to_id` : [],
  ]);
  // Runtime conversation ownership takes precedence; it never creates or changes physical presence.
  const joined = new Set(members.map(r => r.id as string));
  const matchingPresence = presence.map(presenceOf).filter(p => {
    if (p.type !== "temporary") return true;
    const trip = temporaryPresenceWindow(p);
    return trip !== undefined && presenceWindowCurrentOrFuture(trip, now);
  });
  const inCity = (scope.homeCities ? new Set(members.filter(r => scope.homeCities!.includes(r.home_city)).map(r => r.id as string)) : scope.city === undefined ? undefined
    : new Set([...members.filter(r => r.home_city === scope.city).map(r => r.id as string), ...matchingPresence.filter(p => p.city === scope.city).map(p => p.memberId)]));
  const keep = (id: string) => joined.has(id) && (!inCity || inCity.has(id));
  const partsBy = new Map<string, any[]>();
  for (const p of parts as any[]) { if (!partsBy.has(p.opportunity_id)) partsBy.set(p.opportunity_id, []); partsBy.get(p.opportunity_id)!.push(p); }
  const storedIntroduced = new Set((edges as any[]).filter(e => e.type === "introduced").map(e => [e.from_id, e.to_id].sort().join("|")));
  const acceptedBy = new Map<string, { group: string[]; createdAt: number }>();
  for (const r of accepted as any[]) {
    if (!acceptedBy.has(r.opportunity_id)) acceptedBy.set(r.opportunity_id, { group: [], createdAt: ms(r.created_at) ?? 0 });
    acceptedBy.get(r.opportunity_id)!.group.push(r.member_id);
  }
  const introducedEdges: Edge[] = [];
  const seenPairs = new Set<string>();
  for (const { group, createdAt } of acceptedBy.values()) {
    const kept = group.filter(keep);
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
      const [from, to] = [kept[i]!, kept[j]!].sort();
      const key = `${from}|${to}`;
      if (seenPairs.has(key) || storedIntroduced.has(key)) continue;
      seenPairs.add(key);
      introducedEdges.push({ from, to, type: "introduced", strength: 0.3, explicit: false, createdAt });
    }
  }
  const blockedEdgeKeys = new Set<string>();
  const invitedEdgeKeys = new Set<string>();
  for (const e of edges as any[]) {
    if (e.type === "blocked") blockedEdgeKeys.add(`${e.from_id}|${e.to_id}`);
    else if (e.type === "invited_by") invitedEdgeKeys.add(`${e.from_id}|${e.to_id}`);
  }
  const snap: WorldSnapshot = {
    now,
    ...(events.length ? { events } : {}),
    // The account status rides along (the Network reads it): a paused or restricted account is never matched and gets no
    // proactive message; replies to its own messages, compliance texts and safety notices still go (founder, 2026-10-11).
    members: members.filter(r => keep(r.id)).map((r): Member & { accountStatus: string; minorSignalAt?: number } => ({
      id: r.id, name: r.name, homeCity: r.home_city, state: effectiveParticipation(r,now).state, prefs: r.prefs,
      accountStatus: durableStaffHoldSnapshotStatus(staffBanSnapshotStatus(r.account_status, r.canonical_banned === true), r.safety_held === true),
      ...(isAppId(app) ? { apps: [app] } : {}),
      ...(r.person_minor_signal_at ? { minorSignalAt: ms(r.person_minor_signal_at)! } : {}),
      ...(r.matured_signup === true ? { maturedSignup: true } : {}),
      // A missing age stays missing (undefined), never 0: 0 is a valid age under 13, and the Network
      // would decline the member and delete their data. Missing means unknown: treated as a minor and asked (network.md 6.3).
      ...(r.invited_by ? { invitedBy: r.invited_by } : {}), joinedAt: ms(r.joined_at) ?? 0, unansweredProactive: r.unanswered_proactive,
      ...birthFieldsOf(r, now), age: effectiveAgeOf(r, now) as number,
    })),
    facets: (facets as any[]).filter(r => keep(r.member_id)).map(facetOf), intents: (intents as any[]).filter(r => keep(r.member_id)).map(intentOf),
    presence: matchingPresence.filter(p => keep(p.memberId)),
    edges: [
      ...(edges as any[]).filter(e => CORE_EDGES.has(e.type) && keep(e.from_id) && keep(e.to_id)).map((e): Edge => ({ from: e.from_id, to: e.to_id, type: e.type, strength: e.strength, explicit: e.explicit, createdAt: ms(e.created_at) ?? 0 })),
      ...(personBlocks as any[]).filter(e => keep(e.from_id) && keep(e.to_id) && !blockedEdgeKeys.has(`${e.from_id}|${e.to_id}`))
        .map((e): Edge => ({ from: e.from_id, to: e.to_id, type: "blocked", strength: 1, explicit: true, createdAt: ms(e.created_at) ?? 0 })),
      ...(members.filter(r => r.invited_by && keep(r.invited_by) && keep(r.id)
        && !invitedEdgeKeys.has(`${r.invited_by}|${r.id}`))
        .map((r): Edge => ({ from: r.invited_by!, to: r.id, type: "invited_by", strength: 0.7, explicit: true, createdAt: ms(r.joined_at) ?? 0 }))),
      ...introducedEdges,
      ...teenAvoid.filter(e => keep(e.from_id) && keep(e.to_id))
        .map((e): Edge => ({ from: e.from_id, to: e.to_id, type: "avoid", strength: 1, explicit: true, createdAt: ms(e.created_at) ?? 0 })),
    ],
    recentProposals: (recent as any[]).map((o): Proposal => ({
      id: o.id, kind: o.kind, participants: (partsBy.get(o.id) ?? []).filter(p => p.role === "participant").map(p => p.member_id),
      alternates: (partsBy.get(o.id) ?? []).filter(p => p.role === "alternate").map(p => p.member_id), objective: o.objective,
      category: o.category ?? undefined, city: o.city, score: o.score ?? 0, components: o.components ?? undefined, exploration: o.exploration,
      explanations: o.explanations ?? {}, generator: o.generator ?? o.source, createdAt: ms(o.created_at) ?? 0,
    })),
  };
  // peon: each job posting (a hiring manager's intent "peon:job ...") is a job seat with capacity =
  // openings (engine peonSeats). Read from the same rows, never stored twice. The pack hook keeps the
  // capacity left (packs.ts). Only adult managers get seats; nothing else changes for other apps.
  return app === "peon" ? peonSeats(snap) : snap;
}
