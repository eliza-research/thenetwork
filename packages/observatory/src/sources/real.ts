// Real-world mode: the Network's Postgres `network` schema (db/schema.sql), read-only. Every
// connection runs with default_transaction_read_only=on and the adapter only issues SELECTs;
// channel_identities (phones, emails) is never read; names and free text are PII-scrubbed unless
// OBSERVATORY_REVEAL_PII=1. "Shadow" engine runs build a WorldSnapshot from the database and run
// engine-v1 on it in memory; proposals are shown as ghosts and never written (PRD 34.6).
import { SQL } from "bun";
import {
  DAY, type City, type Edge, type EdgeType, type Facet, type Intent, type Member, type Presence, type Proposal, type WorldSnapshot,
} from "@thenetwork/core";
import { runEngineSummarized } from "../engineCapture.ts";
import { displayName, scrubFacet, scrubText } from "../scrub.ts";
import { emptyCounters, Store, zeroCounts } from "../store.ts";
import type {
  ControlCommand, ControlResult, EngineRunSummary, EnvInfo, FeedKind, MemberDetail, MemberStatus, ObsDelta, ObsEdge, ObsFeedItem,
  ObsMember, ObsMessage, ObsOpportunity, ObsState, OpportunityDetail, ParticipantStatus,
} from "../types.ts";
import { Listeners, type DataSource } from "./source.ts";

export interface RealOptions {
  url?: string;
  /** Poll interval in ms (default 10000). */
  pollMs?: number;
  /** Show raw names and message text (local use only). */
  revealPii?: boolean;
  /** Push interval in ms (default 500). */
  pushMs?: number;
}

const CORE_EDGES = new Set<EdgeType>(["invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again", "group_only", "avoid", "blocked"]);
const SAID_YES = ["accepted", "countered", "confirmed", "attended", "no_show", "cancelled_with_notice"];
const HELD = ["COMPLETED", "FEEDBACK_COLLECTED"];
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);

const isLocal = (url: string) => { try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname); } catch { return false; } };

export function redactUrl(url: string): string {
  try { const u = new URL(url); return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`; } catch { return "(invalid url)"; }
}

export class RealSource implements DataSource {
  readonly mode = "real" as const;
  readonly store: Store;
  private sql?: SQL;
  private listeners = new Listeners<ObsDelta>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private reveal: boolean;
  private url?: string;
  private loading: Promise<void> | null = null;
  private lastActivity = 0;
  private shadowIds = new Set<string>();
  private shadowRuns: EngineRunSummary[] = [];

  constructor(private opts: RealOptions = {}) {
    this.url = opts.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
    this.reveal = opts.revealPii ?? process.env.OBSERVATORY_REVEAL_PII === "1";
    const now = Date.now();
    this.store = new Store(this.env(), { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  }

  private env(error?: string): EnvInfo {
    // OBSERVATORY_ENV_LABEL names the environment (e.g. STAGING); local databases say so.
    const where = process.env.OBSERVATORY_ENV_LABEL ?? (this.url && isLocal(this.url) ? "LOCAL DATABASE" : "PRODUCTION DATA");
    return {
      mode: "real", label: this.url ? `${where} · read-only${this.reveal ? " · PII REVEALED" : " · PII scrubbed"}` : "REAL WORLD · not connected",
      dataset: "network schema", database: this.url ? redactUrl(this.url) : undefined, error,
      capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true }, piiRevealed: this.reveal,
    };
  }

  async init() {
    if (!this.url) { this.store.setEnv(this.env("No database configured. Set NETWORK_DATABASE_URL to the Network's Postgres (network schema).")); return; }
    this.sql = new SQL({ url: this.url, max: 4, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory", statement_timeout: "20000" } });
    try {
      await this.load();
      this.store.setEnv(this.env());
    } catch (e) {
      this.store.setEnv(this.env(`Could not read the network schema: ${(e as Error).message}`));
    }
    this.timers.push(setInterval(() => { this.reload(); }, this.opts.pollMs ?? 10_000));
    this.timers.push(setInterval(() => this.push(), this.opts.pushMs ?? 500));
  }

  async dispose() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.sql?.close();
  }

  private reload() {
    if (this.loading || !this.sql) return this.loading ?? Promise.resolve();
    this.loading = this.load()
      .then(() => { if (this.store.env.error) this.store.setEnv(this.env()); })
      .catch(e => { this.store.setEnv(this.env(`Read failed: ${(e as Error).message}`)); })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  private push() { this.listeners.emit(this.store.takeDelta()); }
  subscribe(fn: (d: ObsDelta) => void) { return this.listeners.add(fn); }

  state(): ObsState { this.tickClock(); return this.store.snapshot(); }

  private tickClock() {
    const c = this.store.clock;
    c.now = Math.max(Date.now(), this.lastActivity);
    c.day = Math.floor((c.now - c.start) / DAY) + 1;
  }

  // ------------------------------------------------------------------ load
  private async load() {
    const sql = this.sql!;
    const s = this.store;
    const [members, msgAgg, partAgg, edges, opps, parts, runs, events, totals] = await Promise.all([
      sql`select id, name, home_city, home_area, account_status, participation_state, opted_out, age, invited_by, community, occupation, joined_at from network.members`,
      sql`select member_id, count(*) filter (where direction = 'inbound')::int as msgs_in, count(*) filter (where direction = 'outbound')::int as msgs_out,
            count(*) filter (where direction = 'outbound' and proactive and status = 'delivered')::int as proactive
          from network.messages where not system group by member_id`,
      sql`select p.member_id, count(*)::int as proposals,
            count(*) filter (where p.status = any(${`{${SAID_YES.join(",")}}`}::text[]))::int as accepted,
            count(*) filter (where p.status = 'attended')::int as meetings,
            coalesce(sum(p.enjoyment) filter (where p.status = 'attended' and o.state = any(${`{${HELD.join(",")}}`}::text[])), 0)::float8 as enjoyment_sum,
            count(*) filter (where p.status = 'attended' and o.state = any(${`{${HELD.join(",")}}`}::text[]))::int as enjoyment_n
          from network.participations p join network.opportunities o on o.id = p.opportunity_id
          where p.role = 'participant' group by p.member_id`,
      sql`select from_id, to_id, type, strength, explicit, created_at from network.edges`,
      sql`select id, kind, state, source, generator, category, city, objective, score, components, explanations, exploration, meeting_at, reason, run_id, created_at, updated_at from network.opportunities`,
      sql`select opportunity_id, member_id, role, status, enjoyment from network.participations`,
      sql`select summary from network.matching_runs order by at desc, id desc limit 40`,
      sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events order by at desc, id desc limit 300`,
      sql`select
            (select count(*) from network.messages where not system)::int as messages,
            (select count(*) from network.messages where not system and direction = 'inbound')::int as inbound,
            (select count(*) from network.messages where not system and direction = 'outbound')::int as outbound,
            (select count(*) from network.messages where not system and direction = 'outbound' and proactive and status = 'delivered')::int as proactive,
            (select count(*) from network.messages where direction = 'outbound' and type = 'proposal')::int as invites,
            (select count(*) from network.opportunities where meeting_at is not null)::int as meetings_scheduled,
            (select count(*) from network.events where type = 'member_blocked')::int as blocks,
            (select count(*) from network.events where type = 'safety_flag')::int as adversarial,
            (select count(*) from network.events where type = 'invariant_violation')::int as invariants,
            (select greatest(coalesce(max(ts), 'epoch'), (select coalesce(max(updated_at), 'epoch') from network.opportunities)) from network.messages) as last_activity,
            (select min(joined_at) from network.members) as first_join`,
    ]);
    const t = totals[0]!;
    this.lastActivity = ms(t.last_activity) ?? 0;
    const start = ms(t.first_join);
    if (start) this.store.clock.start = Math.min(start, Date.now());
    this.tickClock();

    const msgBy = new Map(msgAgg.map((r: any) => [r.member_id, r]));
    const partBy = new Map(partAgg.map((r: any) => [r.member_id, r]));
    for (const r of members as any[]) {
      const mm = msgBy.get(r.id) as any, pp = partBy.get(r.id) as any;
      const state: MemberStatus = r.opted_out ? "opted_out" : r.account_status === "invited" ? "not_joined" : r.participation_state;
      const m: ObsMember = {
        id: r.id, name: displayName(r.name, this.reveal), city: r.home_city as City, area: r.home_area ?? undefined, state,
        joined: r.account_status !== "invited", joinedAt: ms(r.joined_at), minor: r.age === null || r.age < 18, age: r.age ?? undefined,
        invitedBy: r.invited_by ?? undefined, community: r.community ?? undefined, occupation: r.occupation ?? undefined,
        counters: {
          ...emptyCounters(), msgsIn: mm?.msgs_in ?? 0, msgsOut: mm?.msgs_out ?? 0, proactive: mm?.proactive ?? 0,
          proposals: pp?.proposals ?? 0, accepted: pp?.accepted ?? 0, meetings: pp?.meetings ?? 0,
          enjoymentSum: pp?.enjoyment_sum ?? 0, enjoymentN: pp?.enjoyment_n ?? 0,
        },
      };
      upsertIfChanged(s.members, m, x => s.upsertMember(x));
    }
    for (const r of edges as any[]) {
      if (!s.members.has(r.from_id) || !s.members.has(r.to_id)) continue;
      const e = { from: r.from_id, to: r.to_id, type: r.type as EdgeType, strength: r.strength, createdAt: ms(r.created_at) ?? 0, origin: (r.explicit ? "graph" : "learned") as ObsEdge["origin"] };
      s.addEdge(e);
    }
    const partsBy = new Map<string, any[]>();
    for (const p of parts as any[]) { if (!partsBy.has(p.opportunity_id)) partsBy.set(p.opportunity_id, []); partsBy.get(p.opportunity_id)!.push(p); }
    for (const r of opps as any[]) {
      const ps = partsBy.get(r.id) ?? [];
      const participants = ps.filter(p => p.role === "participant").map(p => p.member_id);
      const o: ObsOpportunity = {
        id: r.id, kind: r.kind, source: r.source, generator: r.generator ?? r.source, category: r.category ?? undefined, city: r.city,
        objective: scrubText(r.objective, this.reveal), score: r.score ?? 0, components: r.components ?? undefined,
        explanations: Object.fromEntries(Object.entries(r.explanations ?? {}).map(([k, v]) => [k, scrubText(String(v), this.reveal)])),
        exploration: r.exploration, participants, alternates: ps.filter(p => p.role === "alternate").map(p => p.member_id),
        state: r.state, reason: r.reason ?? undefined,
        status: Object.fromEntries(ps.filter(p => p.role === "participant").map(p => [p.member_id, p.status as ParticipantStatus])),
        enjoyment: Object.fromEntries(ps.filter(p => p.enjoyment !== null && p.status === "attended").map(p => [p.member_id, p.enjoyment])),
        createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0, meetingAt: ms(r.meeting_at), runId: r.run_id ?? undefined,
      };
      upsertIfChanged(s.opps, o, x => s.upsertOpp(x));
    }
    const dbRuns = (runs as any[]).map(r => r.summary as EngineRunSummary).reverse();
    const allRuns = [...dbRuns, ...this.shadowRuns];
    if (JSON.stringify(allRuns.map(r => r.id)) !== JSON.stringify(s.runs.map(r => r.id))) { s.runs.length = 0; for (const r of allRuns) s.addRun(r); }

    // Counters: everything the stats panel needs, computed in SQL.
    const c = zeroCounts();
    c.messages = t.messages; c.inbound = t.inbound; c.outbound = t.outbound; c.proactive = t.proactive; c.invites = t.invites;
    c.meetingsScheduled = t.meetings_scheduled; c.blocks = t.blocks; c.adversarialAttempts = t.adversarial; c.invariantViolations = t.invariants;
    for (const o of s.opps.values()) {
      if (o.source === "shadow") continue;
      const held = HELD.includes(o.state);
      if (held) c.meetingsHeld++;
      for (const id of o.participants) {
        const st = o.status[id];
        if (st && SAID_YES.includes(st)) c.accepts++;
        if (st === "declined") c.declines++;
        if (st === "attended") { c.attended++; if (held && o.enjoyment[id] !== undefined) { c.enjoymentSum += o.enjoyment[id]!; c.enjoymentN++; } }
        if (st === "no_show") c.noShows++;
        if (st === "cancelled_with_notice") c.cancelledWithNotice++;
      }
    }
    c.optOuts = [...s.members.values()].filter(m => m.state === "opted_out").length;
    s.counts = c;
    this.loadFeed(events as any[]);
  }

  private feedSeen = new Set<string>();
  private loadFeed(events: any[]) {
    const nm = (id?: string | null) => (id ? this.store.member(id)?.name.split(" ")[0] ?? id : "someone");
    for (const e of [...events].reverse()) {
      const key = String(e.id);
      if (this.feedSeen.has(key)) continue;
      this.feedSeen.add(key);
      const p = e.payload ?? {};
      const ids: string[] = p.participants ?? (e.actor_id ? [e.actor_id] : []);
      const map: Record<string, [FeedKind, string, ObsFeedItem["severity"]?]> = {
        member_joined: ["join", `${nm(e.actor_id)} joined the Network`],
        opportunity_proposed: ["proposal", `${p.source ?? "engine"} proposed ${String(p.kind ?? "an opportunity").replace(/_/g, " ")}: ${(p.participants ?? []).map(nm).join(" & ")}`],
        member_accepted: ["accept", `${nm(e.actor_id)} said yes`, "good"],
        member_declined: ["decline", `${nm(e.actor_id)} passed`],
        meeting_scheduled: ["meeting", `Meeting set: ${(p.participants ?? []).map(nm).join(" & ")}`, "good"],
        interaction_occurred: ["outcome", `Meeting happened (${Object.values(p.attendance ?? {}).filter((a: any) => a.showed).length} showed)`, "good"],
        feedback_given: ["feedback", `${nm(e.actor_id)} gave feedback: "${scrubText(String(p.text ?? ""), this.reveal).slice(0, 90)}"`],
        member_blocked: ["block", `${nm(e.actor_id)} blocked ${nm(e.object_id)}`, "warn"],
        member_opted_out: ["opt_out", `${nm(e.actor_id)} opted out`, "warn"],
        safety_flag: ["adversarial", `Safety flag on ${nm(e.actor_id)}: ${String(p.kind ?? "").replace(/_/g, " ")}`, "bad"],
        invariant_violation: ["invariant", `Invariant ${p.rule}: ${p.detail}`, "bad"],
      };
      const m = map[e.type];
      if (!m) continue;
      this.store.pushFeed({ t: ms(e.at) ?? 0, kind: m[0], text: m[1], severity: m[2], members: ids.length ? ids : undefined, opportunityId: e.object_type === "opportunity" ? e.object_id : undefined });
    }
  }

  // ------------------------------------------------------------------ detail
  async member(id: string): Promise<MemberDetail | undefined> {
    const m = this.store.member(id);
    if (!m || !this.sql) return undefined;
    const sql = this.sql;
    const [prof, facets, intents, presence, msgs] = await Promise.all([
      sql`select bio, occupation, home_area from network.members where id = ${id}`,
      sql`select * from network.facets where member_id = ${id} order by kind, id`,
      sql`select * from network.intents where member_id = ${id} order by created_at`,
      sql`select * from network.presence where member_id = ${id}`,
      sql`select id, ts, direction, body, status, type, opportunity_id, proactive, system from network.messages where member_id = ${id} order by ts, id limit 2000`,
    ]);
    const p = (prof as any[])[0] ?? {};
    return {
      member: m,
      profile: { bio: p.bio ? scrubText(p.bio, this.reveal) : undefined, occupation: p.occupation ?? undefined, neighborhood: p.home_area ?? undefined },
      facets: (facets as any[]).map(f => scrubFacet(facetOf(f), this.reveal)),
      intents: (intents as any[]).map(i => ({ ...intentOf(i), objective: scrubText(i.objective, this.reveal), details: i.details ? scrubText(i.details, this.reveal) : undefined, desiredPeople: i.desired_people ? scrubText(i.desired_people, this.reveal) : undefined })),
      presence: (presence as any[]).map(presenceOf),
      edges: [...this.store.edges.values()].filter(e => e.from === id || e.to === id),
      opportunities: [...this.store.opps.values()].filter(o => o.participants.includes(id)).sort((a, b) => b.createdAt - a.createdAt),
      messages: (msgs as any[]).map(r => this.messageOf(r)),
    };
  }

  private messageOf(r: any): ObsMessage {
    return { id: r.id, ts: ms(r.ts) ?? 0, direction: r.direction, body: scrubText(r.body, this.reveal), status: r.status, type: r.type ?? undefined, proposalId: r.opportunity_id ?? undefined, proactive: r.proactive, system: r.system };
  }

  async opportunity(id: string): Promise<OpportunityDetail | undefined> {
    const o = this.store.opps.get(id);
    if (!o) return undefined;
    const msgs = this.sql && o.source !== "shadow"
      ? await this.sql`select id, member_id, ts, direction, body, status, type, opportunity_id, proactive, system from network.messages where opportunity_id = ${id} order by ts, id`
      : [];
    return {
      opportunity: o, members: o.participants.map(x => this.store.member(x)!).filter(Boolean),
      messages: (msgs as any[]).map(r => ({ ...this.messageOf(r), memberId: r.member_id })),
      run: o.runId ? this.store.runs.find(r => r.id === o.runId) : undefined,
    };
  }

  // ------------------------------------------------------------------ controls
  async control(cmd: ControlCommand): Promise<ControlResult> {
    try {
      if (cmd.type === "refresh") { await this.reload(); this.push(); return { ok: true }; }
      if (cmd.type === "shadow_run") return await this.shadowRun(cmd.city);
      return { ok: false, error: `real-world mode is read-only: "${cmd.type}" is only available in game mode` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }

  /** The engine's input, built from the database exactly as the matcher service would. */
  async snapshot(): Promise<WorldSnapshot> {
    const sql = this.sql;
    if (!sql) throw new Error("not connected");
    const [members, facets, intents, presence, edges, recent, parts] = await Promise.all([
      sql`select * from network.members where account_status <> 'invited'`,
      sql`select * from network.facets where status <> 'rejected'`,
      sql`select * from network.intents`,
      sql`select * from network.presence`,
      sql`select * from network.edges`,
      sql`select * from network.opportunities where created_at >= ${new Date(this.store.clock.now - 30 * DAY)}`,
      sql`select opportunity_id, member_id, role from network.participations`,
    ]);
    this.tickClock();
    const now = this.store.clock.now;
    const partsBy = new Map<string, any[]>();
    for (const p of parts as any[]) { if (!partsBy.has(p.opportunity_id)) partsBy.set(p.opportunity_id, []); partsBy.get(p.opportunity_id)!.push(p); }
    return {
      now,
      members: (members as any[]).map((r): Member => ({
        id: r.id, name: r.name, homeCity: r.home_city, state: r.opted_out ? "paused" : r.participation_state, prefs: r.prefs,
        ...(r.invited_by ? { invitedBy: r.invited_by } : {}), joinedAt: ms(r.joined_at) ?? 0, age: r.age ?? 0, unansweredProactive: r.unanswered_proactive,
      })),
      facets: (facets as any[]).map(facetOf), intents: (intents as any[]).map(intentOf), presence: (presence as any[]).map(presenceOf),
      edges: (edges as any[]).filter(e => CORE_EDGES.has(e.type)).map((e): Edge => ({ from: e.from_id, to: e.to_id, type: e.type, strength: e.strength, explicit: e.explicit, createdAt: ms(e.created_at) ?? 0 })),
      recentProposals: (recent as any[]).map((o): Proposal => ({
        id: o.id, kind: o.kind, participants: (partsBy.get(o.id) ?? []).filter(p => p.role === "participant").map(p => p.member_id),
        alternates: (partsBy.get(o.id) ?? []).filter(p => p.role === "alternate").map(p => p.member_id), objective: o.objective,
        category: o.category ?? undefined, city: o.city, score: o.score ?? 0, components: o.components ?? undefined, exploration: o.exploration,
        explanations: o.explanations ?? {}, generator: o.generator ?? o.source, createdAt: ms(o.created_at) ?? 0,
      })),
    };
  }

  private async shadowRun(city?: City): Promise<ControlResult> {
    const snap = await this.snapshot();
    this.store.clock.busy = "shadow engine run";
    this.push();
    try {
      for (const id of this.shadowIds) this.store.removeOpp(id);
      this.shadowIds.clear();
      this.shadowRuns = [];
      const cities: City[] = city ? [city] : ["sf", "nyc"];
      let total = 0;
      for (const c of cities) {
        const { proposals, summary } = await runEngineSummarized(snap, { seed: 1, city: c, shadow: true });
        this.shadowRuns.push(summary);
        this.store.addRun(summary);
        for (const p of proposals) {
          const id = `shadow:${p.id}`;
          this.shadowIds.add(id);
          total++;
          this.store.upsertOpp({
            id, kind: p.kind, source: "shadow", generator: p.generator, category: p.category, city: p.city, objective: scrubText(p.objective, this.reveal),
            score: p.score, components: p.components, explanations: Object.fromEntries(Object.entries(p.explanations).map(([k, v]) => [k, scrubText(v, this.reveal)])),
            exploration: p.exploration, participants: p.participants, alternates: p.alternates, state: "PROPOSED",
            status: Object.fromEntries(p.participants.map(x => [x, "pending" as ParticipantStatus])), enjoyment: {},
            createdAt: snap.now, updatedAt: snap.now, runId: summary.id,
          });
        }
      }
      this.store.pushFeed({ t: snap.now, kind: "engine", text: `Shadow run (engine-v1, nothing sent): ${total} proposals for ${cities.map(c => c.toUpperCase()).join(" + ")}` });
      return { ok: true, data: { proposals: total } };
    } finally {
      this.store.clock.busy = undefined;
      this.push();
    }
  }
}

function upsertIfChanged<T extends { id: string }>(map: Map<string, T>, next: T, upsert: (x: T) => void) {
  const cur = map.get(next.id);
  if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) upsert(next);
}

function facetOf(r: any): Facet {
  return {
    id: r.id, memberId: r.member_id, kind: r.kind, value: r.value, tags: r.tags ?? [], scope: r.privacy_scope, provenance: r.provenance,
    confidence: r.confidence, validFrom: ms(r.valid_from), validTo: ms(r.valid_to), ...(r.source ? { source: r.source } : {}),
    ...(r.sensitive ? { sensitive: r.sensitive } : {}), confirmedByMember: r.status === "confirmed",
  };
}
function intentOf(r: any): Intent {
  return {
    id: r.id, memberId: r.member_id, objective: r.objective, category: r.category, details: r.details ?? undefined,
    desiredPeople: r.desired_people ?? undefined, horizonDays: r.horizon_days, status: r.status, createdAt: ms(r.created_at) ?? 0,
  };
}
function presenceOf(r: any): Presence {
  return { memberId: r.member_id, city: r.city, type: r.type, areas: r.areas ?? [], ...(r.from_at ? { from: ms(r.from_at) } : {}), ...(r.to_at ? { to: ms(r.to_at) } : {}) };
}
