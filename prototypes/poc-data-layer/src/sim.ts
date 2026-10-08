// Fix 4: sim-facing insert helpers. Expected duplicates are absorbed with ON CONFLICT DO NOTHING ... RETURNING
// instead of raising 23505, so a long PGlite simulation never accumulates caught SQL errors (PGlite 0.5.8 wedges
// after ~1.5k-3k of them; see repro/). Each helper returns the new row's key, or null when it already existed.
import type { Db } from "./db";
import { pgArray } from "./suite";

const one = async (rows: Promise<{ id: string }[]>) => (await rows)[0]?.id ?? null;

export const simInsertMember = (db: Db, m: { id?: string; name: string; home_city: "sf" | "nyc"; invited_by?: string | null;
  phone?: string | null; email?: string | null }) =>
  one(db.q(`INSERT INTO network.members (id, name, home_city, invited_by, phone, email)
            VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4::uuid, $5, $6)
            ON CONFLICT (id) DO NOTHING RETURNING id::text AS id`,
    [m.id ?? null, m.name, m.home_city, m.invited_by ?? null, m.phone ?? null, m.email ?? null]));

/** The unique partial index is the arbiter: an active opportunity for the same set + objective returns null. */
export const simInsertOpportunity = (db: Db, o: { kind: string; city: string; objective: string; objectiveHash: string;
  participants: string[]; state?: string }) =>
  one(db.q(`INSERT INTO network.opportunities (kind, city, objective, objective_hash, participants, state)
            VALUES ($1, $2, $3, $4, $5::uuid[], $6)
            ON CONFLICT (participant_key, objective_hash) WHERE network.is_active_state(state) DO NOTHING
            RETURNING id::text AS id`,
    [o.kind, o.city, o.objective, o.objectiveHash, pgArray(o.participants), o.state ?? "PROPOSED"]));

export const simInsertParticipation = (db: Db, opportunityId: string, memberId: string, state = "invited") =>
  one(db.q(`INSERT INTO network.participations (opportunity_id, member_id, state) VALUES ($1, $2, $3)
            ON CONFLICT (opportunity_id, member_id) DO NOTHING RETURNING member_id::text AS id`, [opportunityId, memberId, state]));

export const simInsertEdge = (db: Db, from: string, to: string, type: string, evidence: string | null = null) =>
  one(db.q(`INSERT INTO network.edges (from_id, to_id, type, evidence) VALUES ($1, $2, $3, $4)
            ON CONFLICT (from_id, to_id, type) DO NOTHING RETURNING to_id::text AS id`, [from, to, type, evidence]));

export const simEnqueueJob = (db: Db, j: { type: string; payload: unknown; idempotencyKey: string; memberIds?: string[]; dueAt?: string }) =>
  one(db.q(`INSERT INTO network.jobs (type, payload, idempotency_key, member_ids, due_at)
            VALUES ($1, $2::text::jsonb, $3, $4::uuid[], coalesce($5::timestamptz, now()))
            ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text AS id`,
    [j.type, JSON.stringify(j.payload), j.idempotencyKey, pgArray(j.memberIds ?? []), j.dueAt ?? null]));

export const simInsertOutbound = (db: Db, m: { memberId: string; channel: string; to: string; body: string; idempotencyKey: string; mentions?: string[] }) =>
  one(db.q(`INSERT INTO network.outbound_messages (member_id, channel, to_address, body, mentions, idempotency_key)
            VALUES ($1, $2, $3, $4, $5::uuid[], $6)
            ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text AS id`,
    [m.memberId, m.channel, m.to, m.body, pgArray(m.mentions ?? []), m.idempotencyKey]));
