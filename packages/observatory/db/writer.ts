// Write The Network's data into the `network` schema (dev and staging only): from the synthetic
// dataset files, or from a whole simulated world (members, graph, every message, opportunity,
// participation, outcome, feedback, engine run and event). Real-world mode reads it back.
import type { SQL } from "bun";
import type { MemberId } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { DATA_DIR, readJsonl, type EdgeRecord, type FacetRecord, type IntentRecord, type MemberRecord, type PresenceRecord } from "../../../scripts/synthetic/common.ts";
import type { GameSource } from "../src/sources/game.ts";

type Row = Record<string, unknown>;
export interface NetworkRows {
  members: Row[]; channel_identities: Row[]; facets: Row[]; intents: Row[]; presence: Row[]; edges: Row[];
  opportunities: Row[]; participations: Row[]; messages: Row[]; feedback: Row[]; events: Row[]; matching_runs: Row[];
}
const TABLES: (keyof NetworkRows)[] = [
  "members", "channel_identities", "facets", "intents", "presence", "edges", "opportunities", "participations",
  "messages", "feedback", "events", "matching_runs",
];

const AREA_CODES = ["415", "628", "510", "212", "646", "917", "718", "347", "332", "929"];
const date = (ms: number | undefined) => (ms === undefined || ms === null ? null : new Date(ms));
/** Postgres array literal (Bun.SQL sends JS arrays as plain strings). */
export function pgArray(xs: string[]): string {
  return `{${xs.map(x => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
const empty = (): NetworkRows => ({
  members: [], channel_identities: [], facets: [], intents: [], presence: [], edges: [], opportunities: [],
  participations: [], messages: [], feedback: [], events: [], matching_runs: [],
});

/** Rows from the synthetic dataset's public files (hidden truth is never read). */
export async function rowsFromDataset(dir = DATA_DIR): Promise<NetworkRows> {
  const r = empty();
  for (const m of await readJsonl<MemberRecord>(`${dir}/members.jsonl`)) {
    const p = m.profile as Record<string, any>;
    r.members.push({
      id: m.id, name: m.name, home_city: m.homeCity, home_area: p?.neighborhood ?? null, account_status: "active",
      participation_state: m.state, opted_out: false, age: m.age, invited_by: m.invitedBy ?? null, community: null,
      occupation: p?.occupation ?? null, bio: p?.bio ?? null, prefs: m.prefs, unanswered_proactive: m.unansweredProactive,
      joined_at: date(m.joinedAt),
    });
    if (p?.contact?.phone) r.channel_identities.push({ member_id: m.id, channel: "sms", address: p.contact.phone, verified_at: date(m.joinedAt), is_primary: true });
    if (p?.contact?.email) r.channel_identities.push({ member_id: m.id, channel: "email", address: p.contact.email, verified_at: null, is_primary: false });
  }
  for (const f of await readJsonl<FacetRecord>(`${dir}/facets.jsonl`)) r.facets.push(facetRow(f));
  for (const i of await readJsonl<IntentRecord>(`${dir}/intents.jsonl`)) r.intents.push(intentRow(i));
  for (const p of await readJsonl<PresenceRecord>(`${dir}/presence.jsonl`)) r.presence.push(presenceRow(p));
  for (const e of await readJsonl<EdgeRecord>(`${dir}/edges.jsonl`)) r.edges.push({ from_id: e.from, to_id: e.to, type: e.type, strength: e.strength, explicit: e.explicit, created_at: date(e.createdAt) });
  return r;
}

function facetRow(f: FacetRecord | import("@thenetwork/core").Facet): Row {
  return {
    id: f.id, member_id: f.memberId, kind: f.kind, value: f.value, tags: pgArray(f.tags), privacy_scope: f.scope, provenance: f.provenance,
    source: f.source ?? null, confidence: f.confidence, status: f.confirmedByMember === false ? "proposed" : "confirmed", sensitive: f.sensitive ?? null,
    valid_from: date(f.validFrom), valid_to: date(f.validTo),
  };
}
function intentRow(i: IntentRecord | import("@thenetwork/core").Intent): Row {
  return {
    id: i.id, member_id: i.memberId, objective: i.objective, category: i.category, details: i.details ?? null, desired_people: i.desiredPeople ?? null,
    horizon_days: i.horizonDays, status: i.status, created_at: date(i.createdAt),
  };
}
function presenceRow(p: PresenceRecord | import("@thenetwork/core").Presence): Row {
  return { member_id: p.memberId, city: p.city, type: p.type, areas: pgArray(p.areas), from_at: date(p.from), to_at: date(p.to) };
}

/** Rows from a live game world: everything the simulation produced so far. */
export function rowsFromGame(g: GameSource): NetworkRows {
  const r = empty();
  const s = g.store, w = g.world;
  const snap = w.snapshot();
  const prefs = new Map(snap.members.map(m => [m.id, m]));
  const personas = new Map(w.personaList().map(p => [p.id, p]));
  for (const m of s.members.values()) {
    const p = personas.get(m.id);
    r.members.push({
      id: m.id, name: m.name, home_city: m.city, home_area: m.area ?? null,
      account_status: m.joined ? "active" : "invited",
      participation_state: m.state === "opted_out" || m.state === "not_joined" ? "normal" : m.state,
      opted_out: m.state === "opted_out", age: m.age ?? null, invited_by: m.invitedBy ?? null, community: m.community ?? null,
      occupation: m.occupation ?? null, bio: p?.public.bio ?? null, prefs: prefs.get(m.id)?.prefs ?? {},
      unanswered_proactive: prefs.get(m.id)?.unansweredProactive ?? 0, joined_at: date(m.joinedAt),
    });
    // Synthetic contact details (fictional 555 numbers), so PII scrubbing can be tested end to end.
    const i = r.members.length - 1, area = AREA_CODES[Math.floor(i / 100) % AREA_CODES.length];
    r.channel_identities.push({ member_id: m.id, channel: "sms", address: `+1-${area}-555-01${String(i % 100).padStart(2, "0")}`, verified_at: date(m.joinedAt), is_primary: true });
  }
  for (const f of snap.facets) r.facets.push(facetRow(f));
  for (const i of snap.intents) r.intents.push(intentRow(i));
  for (const p of snap.presence) r.presence.push(presenceRow(p));
  for (const e of s.edges.values()) r.edges.push({ from_id: e.from, to_id: e.to, type: e.type, strength: e.strength, explicit: e.origin === "graph", created_at: date(e.createdAt) });
  for (const o of s.opps.values()) {
    if (o.source === "shadow") continue;
    r.opportunities.push({
      id: o.id, kind: o.kind, state: o.state, source: o.source, generator: o.generator, category: o.category ?? null, city: o.city,
      objective: o.objective, score: o.score, components: o.components ?? null, explanations: o.explanations, exploration: o.exploration,
      window_start: null, window_end: null, meeting_at: date(o.meetingAt), reason: o.reason ?? null, run_id: o.runId ?? null,
      created_at: date(o.createdAt), updated_at: date(o.updatedAt),
    });
    for (const id of o.participants) r.participations.push({ opportunity_id: o.id, member_id: id, role: "participant", status: o.status[id] ?? "pending", enjoyment: o.enjoyment[id] ?? null, invited_at: null, responded_at: null });
    for (const id of o.alternates) if (!o.participants.includes(id)) r.participations.push({ opportunity_id: o.id, member_id: id, role: "alternate", status: "alternate", enjoyment: null, invited_at: null, responded_at: null });
  }
  for (const m of w.channel.all()) {
    r.messages.push({
      id: m.id, member_id: m.memberId, direction: m.direction, channel: m.channel, body: m.body, status: m.status,
      type: (m.meta?.type as string) ?? null, opportunity_id: (m.meta?.proposalId as string) ?? null, proactive: !!m.meta?.proactive,
      system: !!m.system, ts: date(m.ts),
    });
  }
  const opps = s.opps;
  for (const rec of w.records) {
    if (rec.type === "feedback") {
      const e = rec.proposalId ? opps.get(rec.proposalId)?.enjoyment[rec.memberId] : undefined;
      r.feedback.push({
        from_id: rec.memberId, opportunity_id: rec.proposalId ?? null, about_id: null,
        sentiment: e === undefined ? null : e >= 0.6 ? "positive" : e < 0.3 ? "negative" : "neutral",
        would_meet_again: e === undefined ? null : e >= 0.6, text: rec.text, at: date(rec.t),
      });
    }
    const ev = eventOf(rec);
    if (ev) r.events.push(ev);
  }
  for (const run of s.runs) r.matching_runs.push({ id: run.id, at: date(run.at), city: run.city ?? null, engine_version: run.engineVersion, proposals: run.proposals, wall_ms: run.wallMs, summary: run });
  return r;
}

/** Product events (32.19) from simulator records. Messages have their own table. */
export function eventOf(rec: RunRecord): Row | undefined {
  const at = date(rec.t);
  const ev = (actor_type: string, actor_id: string | null, type: string, object_type: string | null, object_id: string | null, payload: Record<string, unknown> = {}) =>
    ({ at, actor_type, actor_id, type, object_type, object_id, payload });
  switch (rec.type) {
    case "join": return ev("member", rec.memberId, "member_joined", "member", rec.memberId);
    case "proposal": return ev(rec.source === "engine" ? "engine" : rec.source === "player" ? "admin" : "agent", null, "opportunity_proposed", "opportunity", rec.proposal.id, { participants: rec.proposal.participants, kind: rec.proposal.kind, source: rec.source });
    case "decision":
      if (rec.messageType !== "proposal" || !["accept", "decline"].includes(rec.intent)) return undefined;
      return ev("member", rec.memberId, rec.intent === "accept" ? "member_accepted" : "member_declined", "opportunity", rec.proposalId ?? null);
    case "meeting_scheduled": return ev("agent", null, "meeting_scheduled", "opportunity", rec.proposalId, { participants: rec.participants, at: rec.at });
    case "outcome": return ev("sim", null, "interaction_occurred", "opportunity", rec.proposalId, { attendance: rec.attendance });
    case "feedback": return ev("member", rec.memberId, "feedback_given", "opportunity", rec.proposalId ?? null, { text: rec.text });
    case "block": return ev("member", rec.from, "member_blocked", "member", rec.to);
    case "opt_out": return ev("member", rec.memberId, "member_opted_out", "member", rec.memberId);
    case "adversarial_attempt": return ev("sim", rec.memberId, "safety_flag", "member", rec.memberId, { kind: rec.kind });
    case "invariant_violation": return ev("sim", rec.memberId ?? null, "invariant_violation", null, null, { rule: rec.rule, detail: rec.detail });
    default: return undefined;
  }
}

/** Write all rows in one transaction. `truncate` clears every network table first. */
export async function writeRows(sql: SQL, rows: NetworkRows, opts: { truncate?: boolean } = {}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await sql.begin(async tx => {
    await tx.unsafe("set local search_path to network");
    if (opts.truncate) await tx.unsafe(`truncate ${TABLES.map(t => `network.${t}`).join(", ")} restart identity cascade`);
    // Members first without invite lineage (it references other members), then the lineage.
    await insert(tx, "members", rows.members.map(m => ({ ...m, invited_by: null })));
    const lineage = rows.members.filter(m => m.invited_by);
    if (lineage.length) {
      await tx`update network.members m set invited_by = v.inv
        from (select unnest(${pgArray(lineage.map(m => String(m.id)))}::text[]) as id, unnest(${pgArray(lineage.map(m => String(m.invited_by)))}::text[]) as inv) v
        where m.id = v.id and exists (select 1 from network.members x where x.id = v.inv)`;
    }
    for (const t of TABLES) {
      if (t === "members") continue;
      let list = rows[t];
      if (t === "edges") list = dedupe(list, e => `${e.from_id}|${e.to_id}|${e.type}`);
      counts[t] = await insert(tx, t, list);
    }
    counts.members = rows.members.length;
  });
  return counts;
}

function dedupe(rows: Row[], key: (r: Row) => string) {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

async function insert(tx: SQL, table: string, rows: Row[], chunk = 500): Promise<number> {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await tx`insert into ${tx(table)} ${tx(part)}`;
  }
  return rows.length;
}

export type { MemberId };
