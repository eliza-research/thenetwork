// The WorldSnapshot the Network reads (ctx.snapshot()), built from the `network` Postgres schema:
// members, facets, intents, presence, edges and the opportunities of the last 30 days. The
// production service (service.ts) and the Observatory's shadow engine runs (observatory
// src/sources/real.ts) use this one builder, so both see the same members. It never reads
// network.channel_identities (phones and emails).
import type { SQL } from "bun";
import { DAY, type Edge, type EdgeType, type Facet, type Intent, type Member, type Presence, type Proposal, type ParticipationState, type WorldSnapshot } from "@thenetwork/core";

import type { SetStateRequest } from "../../core/src/svc/contract.ts";
import { peonSeats } from "@thenetwork/engine";
import { effectiveState, windowActive } from "./decisions.ts";

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
  const validDate = (v:unknown) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
  const valid = value && ["open","busy","traveling","paused"].includes(value.state as string)
    && validDate(value.from) && validDate(value.until) && (value.note === null || typeof value.note === "string")
    && (value.from === null || value.until === null || Date.parse(value.from as string)<Date.parse(value.until as string));
  const window = valid ? value as unknown as Pick<SetStateRequest,"state"|"from"|"until"|"note"> : null;
  const optedOut = !!row.opted_out;
  const active = windowActive({optedOut, hasWindow: !!window, hasFrom: !!window && window.from !== null, fromMs: window?.from ? Date.parse(window.from) : 0,
    hasUntil: !!window && window.until !== null, untilMs: window?.until ? Date.parse(window.until) : 0, now});
  return {state: effectiveState(optedOut, active, window?.state ?? "open", row.participation_state), window, active};
}

const CORE_EDGES = new Set<EdgeType>(["invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again", "group_only", "avoid", "blocked"]);
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);

/** Durable source-suggestion IDs identify accepted profile-learning purpose without changing privacy scope. */
export function facetOf(r: any): Facet & { learningPurpose?: "network_profile_learning_v1" } {
  return {
    id: r.id, memberId: r.member_id, kind: r.kind, value: r.value, tags: r.tags ?? [], scope: r.privacy_scope, provenance: r.provenance,
    confidence: r.confidence, validFrom: ms(r.valid_from), validTo: ms(r.valid_to), ...(r.source ? { source: r.source } : {}),
    ...(r.sensitive ? { sensitive: r.sensitive } : {}), ...(r.provenance === "inferred" ? { inferred: true } : {}),
    ...(r.observed_at ? { observedAt: ms(r.observed_at) } : {}), confirmedByMember: r.status === "confirmed",
    ...(typeof r.id === "string" && r.id.startsWith("source-suggestion:") && ["gmail", "google_calendar"].includes(r.source)
      ? { learningPurpose: "network_profile_learning_v1" as const } : {}),
  };
}

export function intentOf(r: any): Intent {
  return {
    id: r.id, memberId: r.member_id, objective: r.objective, category: r.category, details: r.details ?? undefined,
    desiredPeople: r.desired_people ?? undefined, horizonDays: r.horizon_days, status: r.status, createdAt: ms(r.created_at) ?? 0,
  };
}

export function presenceOf(r: any): Presence {
  return { memberId: r.member_id, city: r.city, type: r.type, areas: r.areas ?? [], ...(r.from_at ? { from: ms(r.from_at) } : {}), ...(r.to_at ? { to: ms(r.to_at) } : {}) };
}

/** App isolation always applies. Runtime conversation ownership names homeCities; other readers may use physical city/presence scope. */
export interface SnapshotScope { app: string; city?: string; homeCities?: readonly string[];
  /** Internal owned profile review only. Default snapshots feed matching/background work and exclude deferred Google intake. */
  purpose?: "profile_review";
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
  const [members, facets, intents, presence, edges, recent, parts, personBlocks] = await Promise.all([
    sql`select m.*, a.age as matching_age from network.members m
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
  ]);
  // Runtime conversation ownership takes precedence; it never creates or changes physical presence.
  const joined = new Set((members as any[]).map(r => r.id as string));
  const inCity = (scope.homeCities ? new Set((members as any[]).filter(r => scope.homeCities!.includes(r.home_city)).map(r => r.id as string)) : scope.city === undefined ? undefined
    : new Set([...(members as any[]).filter(r => r.home_city === scope.city).map(r => r.id as string), ...(presence as any[]).filter(r => r.city === scope.city).map(r => r.member_id as string)]));
  const keep = (id: string) => joined.has(id) && (!inCity || inCity.has(id));
  const partsBy = new Map<string, any[]>();
  for (const p of parts as any[]) { if (!partsBy.has(p.opportunity_id)) partsBy.set(p.opportunity_id, []); partsBy.get(p.opportunity_id)!.push(p); }
  const snap: WorldSnapshot = {
    now,
    // The account status rides along (the Network reads it): a paused or restricted account is never matched and gets no
    // proactive message; replies to its own messages, compliance texts and safety notices still go (founder, 2026-10-11).
    members: (members as any[]).filter(r => keep(r.id)).map((r): Member & { accountStatus: string } => ({
      id: r.id, name: r.name, homeCity: r.home_city, state: effectiveParticipation(r,now).state, prefs: r.prefs, accountStatus: r.account_status,
      // A missing age stays missing (undefined), never 0: 0 is a valid age under 13, and the Network
      // would decline the member and delete their data. Missing means unknown: treated as a minor and asked (network.md 6.3).
      ...(r.invited_by ? { invitedBy: r.invited_by } : {}), joinedAt: ms(r.joined_at) ?? 0, age: r.matching_age ?? (undefined as unknown as number), unansweredProactive: r.unanswered_proactive,
    })),
    facets: (facets as any[]).filter(r => keep(r.member_id)).map(facetOf), intents: (intents as any[]).filter(r => keep(r.member_id)).map(intentOf),
    presence: (presence as any[]).filter(r => keep(r.member_id)).map(presenceOf),
    edges: [
      ...(edges as any[]).filter(e => CORE_EDGES.has(e.type) && keep(e.from_id) && keep(e.to_id)).map((e): Edge => ({ from: e.from_id, to: e.to_id, type: e.type, strength: e.strength, explicit: e.explicit, createdAt: ms(e.created_at) ?? 0 })),
      ...(personBlocks as any[]).filter(e => keep(e.from_id) && keep(e.to_id) && !(edges as any[]).some(x => x.type === "blocked" && x.from_id === e.from_id && x.to_id === e.to_id))
        .map((e): Edge => ({ from: e.from_id, to: e.to_id, type: "blocked", strength: 1, explicit: true, createdAt: ms(e.created_at) ?? 0 })),
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
