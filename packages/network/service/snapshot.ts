// The WorldSnapshot the Network reads (ctx.snapshot()), built from the `network` Postgres schema:
// members, facets, intents, presence, edges and the opportunities of the last 30 days. The
// production service (service.ts) and the Observatory's shadow engine runs (observatory
// src/sources/real.ts) use this one builder, so both see the same members. It never reads
// network.channel_identities (phones and emails).
import type { SQL } from "bun";
import { DAY, type Edge, type EdgeType, type Facet, type Intent, type Member, type Presence, type Proposal, type WorldSnapshot } from "@thenetwork/core";

const CORE_EDGES = new Set<EdgeType>(["invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again", "group_only", "avoid", "blocked"]);
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);

export function facetOf(r: any): Facet {
  return {
    id: r.id, memberId: r.member_id, kind: r.kind, value: r.value, tags: r.tags ?? [], scope: r.privacy_scope, provenance: r.provenance,
    confidence: r.confidence, validFrom: ms(r.valid_from), validTo: ms(r.valid_to), ...(r.source ? { source: r.source } : {}),
    ...(r.sensitive ? { sensitive: r.sensitive } : {}), confirmedByMember: r.status === "confirmed",
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

/** Which network a snapshot is for. Every query names the app; the city keeps members who live there or have presence there. */
export interface SnapshotScope { app: string; city?: string }

/**
 * The engine's and the Network's input at `now`, for one app (platform plan 2.4: nothing crosses apps).
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
    sql`select * from network.members where app_id = ${app} and account_status not in ('invited', 'removed') order by id`,
    sql`select * from network.facets where app_id = ${app} and status <> 'rejected' order by member_id, id`,
    sql`select * from network.intents where app_id = ${app} order by member_id, id`,
    sql`select * from network.presence where app_id = ${app} order by member_id, city, type`,
    sql`select * from network.edges where app_id = ${app} order by from_id, to_id, type`,
    sql`select * from network.opportunities where app_id = ${app} and created_at >= ${new Date(now - 30 * DAY)} order by created_at, id`,
    sql`select opportunity_id, member_id, role from network.participations where app_id = ${app} order by opportunity_id, member_id, role`,
    sql`select f.id as from_id, t.id as to_id, pb.at as created_at from platform.person_blocks pb
      join network.members f on f.person_id = pb.from_person and f.app_id = ${app}
      join network.members t on t.person_id = pb.to_person and t.app_id = ${app} order by f.id, t.id`,
  ]);
  // The city: members who live there, or have presence there.
  const joined = new Set((members as any[]).map(r => r.id as string));
  const inCity = (scope.city === undefined ? undefined
    : new Set([...(members as any[]).filter(r => r.home_city === scope.city).map(r => r.id as string), ...(presence as any[]).filter(r => r.city === scope.city).map(r => r.member_id as string)]));
  const keep = (id: string) => joined.has(id) && (!inCity || inCity.has(id));
  const partsBy = new Map<string, any[]>();
  for (const p of parts as any[]) { if (!partsBy.has(p.opportunity_id)) partsBy.set(p.opportunity_id, []); partsBy.get(p.opportunity_id)!.push(p); }
  return {
    now,
    // The account status rides along (the Network reads it): a paused or restricted account is never matched or contacted.
    members: (members as any[]).filter(r => keep(r.id)).map((r): Member & { accountStatus: string } => ({
      id: r.id, name: r.name, homeCity: r.home_city, state: r.opted_out ? "paused" : r.participation_state, prefs: r.prefs, accountStatus: r.account_status,
      // A missing age stays missing (undefined), never 0: 0 is a valid age under 13, and the Network
      // would decline the member and delete their data. Missing means unknown: treated as a minor and asked (network.md 6.3).
      ...(r.invited_by ? { invitedBy: r.invited_by } : {}), joinedAt: ms(r.joined_at) ?? 0, age: r.age ?? (undefined as unknown as number), unansweredProactive: r.unanswered_proactive,
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
}
