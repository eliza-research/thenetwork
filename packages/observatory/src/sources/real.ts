// Real-world mode: the Network's Postgres `network` schema (db/schema.sql), read-only. Every
// connection runs with default_transaction_read_only=on and the adapter only issues SELECTs;
// channel_identities (phones, emails) is never read. Unless OBSERVATORY_REVEAL_PII=1 (local use
// only): names are "First L.", what members wrote (inbound messages, feedback) never leaves the
// database (only its length and time), the agent's texts are PII-scrubbed, and agent-private
// facets are withheld (audit P1-2). This connection never writes: review decisions, safety actions
// and the matching switch go to the Network service's staff API when NETWORK_SERVICE_URL and
// NETWORK_SERVICE_TOKEN are set (sources/service.ts), and are refused otherwise. "Shadow" engine runs
// build a WorldSnapshot from the database and run engine-v1 on it in memory; proposals are shown as
// ghosts and never written (PRD 34.6).
import { SQL } from "bun";
import {
  DAY, isMinor, validAge, type City, type EdgeType, type WorldSnapshot,
} from "@thenetwork/core";
import { OUTREACH, SIM_AUTO_REVIEWER } from "@thenetwork/network";
import { CONNECTION } from "@thenetwork/network";
import { facetOf, intentOf, loadSnapshot, presenceOf } from "@thenetwork/network/service/snapshot";
import { runEngineSummarized } from "../engineCapture.ts";
import { describe, onTimeline, requestLabel, type EventRow } from "../events.ts";
import { ALERT_WINDOW, growthStats, healthAlerts, hours, reportsFromCases, safetyInfo, scorecard, type MsgMeta } from "../health.ts";
import { appMonthCost, loadPilotInput, pilotAlerts, pilotMetrics } from "../pilot.ts";
import { memberFacets } from "../appProfile.ts";
import { displayName, scrubFacet, scrubText } from "../scrub.ts";
import { emptyCounters, Store, zeroCounts } from "../store.ts";
import type {
  BookedPlan, ConfigChange, ConfigInfo, ControlCommand, ControlResult, EngineRunSummary, EnvInfo, FeedKind, MemberDetail, MemberPhoto, MemberStatus, MemberTimeline, NetworkInfo,
  ObsDelta, ObsEdge, ObsFeedItem, ObsMember, ObsMessage, ObsOpportunity, ObsRequest, ObsState, OpportunityDetail, ParticipantStatus, ReviewInfo,
  SafetyAction, SafetyInfo, SearchHit, TimelineEntry,
} from "../types.ts";
import { appUrlEnv, DEFAULT_APP, MATCHING_OFF_TEXT, matchingAllowed, slaHours, type AppId } from "../apps.ts";
import { serviceAlerts, ServiceClient, serviceFromEnv, type ServiceConfig } from "./service.ts";
import { Listeners, searchPattern, snippet, type DataSource, type ViewOptions } from "./source.ts";

export interface RealOptions {
  url?: string;
  /** The app this source shows (default ntwrk). Every query keeps to its rows (app_id). */
  app?: AppId;
  /**
   * The app's own read login (a member of network_observatory_<app>, migration 0004): row-level
   * security keeps the connection to the app as well. Default: OBSERVATORY_DATABASE_URL_<APP>.
   * Without it the shared login reads with the app_id filter only.
   */
  appUrl?: string;
  /** Poll interval in ms (default 10000). */
  pollMs?: number;
  /** Show raw names and message text (local use only). */
  revealPii?: boolean;
  /** Push interval in ms (default 500). */
  pushMs?: number;
  /** The Network service for staff actions. Default: NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN. false: none (read-only). */
  service?: ServiceConfig | false;
}

/** The booked plan's opt-out window (the Network's OPT_OUT_HOURS, which it does not export; game mode reads it from SimMeta.booked). */
const BOOKED_OPT_OUT_HOURS = 48;
const SAID_YES = ["accepted", "countered", "confirmed", "attended", "no_show", "cancelled_with_notice"];
const HELD = ["COMPLETED", "FEEDBACK_COLLECTED"];
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);
export const HIDDEN_MESSAGE = "[member message hidden]";

/** How the Network treats a member's age at one moment (network.md 6.3). */
interface AgeState { minor: boolean; unknown: boolean }
/**
 * The Network's age state: the latest per member (its stored state, else its age events), each change
 * with its time (the events), and the availability opt-ins (calendar, weekly check-in).
 */
interface AgeInfo {
  latest: Map<string, AgeState>;
  changes: Map<string, (AgeState & { at: number })[]>;
  optIns: Map<string, { calendar?: boolean; weekly?: boolean }>;
}
const AGE_EVENTS = ["age_unknown", "age_resolved", "minor_signal", "age_conflict"];
/** A valid record age under 18 (core policy; a missing age is handled apart: unknown). */
const recordMinor = (age: number | null | undefined) => validAge(age) && isMinor(age);

/**
 * Whether the console treats a member as under 18. With the Network's view: its flag, or a record age
 * under 18. Without it: the record age, and a missing age fails closed (treated as under 18).
 */
export function ageView(recordAge: number | null, net?: AgeState): { minor: boolean; ageUnknown?: true } {
  if (net) return { minor: net.minor || recordMinor(recordAge), ...(net.unknown ? { ageUnknown: true as const } : {}) };
  return recordAge === null ? { minor: true, ageUnknown: true } : { minor: recordMinor(recordAge) };
}

/**
 * Was this member treated as under 18 at time t: a record age under 18, or the Network's age state
 * then. It agrees with ageView(): with no age event yet, the Network's stored view decides, else the
 * record age, and a missing age fails closed (audit observatory-19).
 */
export function minorAt(info: AgeInfo, id: string, recordAge: number | null | undefined, t: number): boolean {
  if (recordMinor(recordAge)) return true;
  let st: AgeState | undefined;
  for (const c of info.changes.get(id) ?? []) { if (c.at > t) break; st = c; }
  if (st) return st.minor;
  const stored = info.changes.has(id) ? undefined : info.latest.get(id);
  if (stored) return stored.minor;
  return !validAge(recordAge);
}

/** Why a database login may not serve the console, or undefined (audit observatory-9). */
export function loginProblem(r: { su: boolean; bypass: boolean; ro: string; inAppRole: boolean | null }, o: { local: boolean; isolation: "rls_role" | "app_filter"; app: string }): string | undefined {
  if (r.ro !== "on") return "the console's connection is not read-only";
  if (o.isolation === "rls_role" && r.inAppRole !== true) return `the app's read login is not a member of network_observatory_${o.app}`;
  if (!o.local && (r.su || r.bypass)) return "the console's login is a superuser or bypasses row-level security: use a network_observatory_<app> login";
  return undefined;
}

/**
 * The newest console row of each network (city) of one app, merged into one: lists are joined,
 * counters and gate reasons summed, deferred sends added up, and matching is on only where every
 * city has it on (audit observatory-11). Newest saved_at first.
 */
export function mergeStateRows(rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  if (rows.length <= 1) return rows[0];
  const parse = (v: unknown) => (typeof v === "string" && /^[[{]/.test(v.trim()) ? JSON.parse(v) : v);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rows[0]!)) {
    const vals = rows.map(r => parse(r[k]));
    if (k === "saved_at") out[k] = vals[0];
    else if (vals.every(v => Array.isArray(v) || v == null)) out[k] = vals.flatMap(v => (Array.isArray(v) ? v : []));
    else if (vals.every(v => typeof v === "number" || v == null)) out[k] = vals.reduce((a: number, v) => a + (typeof v === "number" ? v : 0), 0);
    else if (vals.every(v => typeof v === "boolean" || v == null)) out[k] = vals.every(v => v !== false);
    else if (vals.every(v => (v && typeof v === "object") || v == null)) {
      const sum: Record<string, number> = {};
      for (const v of vals) for (const [x, n] of Object.entries((v ?? {}) as Record<string, unknown>)) if (typeof n === "number") sum[x] = (sum[x] ?? 0) + n;
      out[k] = sum;
    } else out[k] = vals[0];
  }
  return out;
}

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
  /** The Network's stored state is in the database (read through network.network_state_console): what the console shows from it. */
  private netState?: { matchingEnabled: boolean; deferred: number; savedAt: number; trust: Map<string, "ok" | "watch" | "hold">; info: NetworkInfo };
  private networkDirty = false;
  /** OBSERVATORY_REVEAL_PII was set for a database that is not local, or not marked dev: refused (admin-console 4.4). */
  private revealRefused = false;
  /** The database login is not fit for the console (loginProblem): nothing is read. */
  private refused?: string;
  /** The Network service's staff API (review, safety, matching), when configured. */
  private service?: ServiceClient;
  /** A shadow run in progress (one at a time; audit observatory-22). */
  private shadowing?: Promise<ControlResult>;
  /** The Network's age state and opt-ins, from the last load. */
  private ages: AgeInfo = { latest: new Map(), changes: new Map(), optIns: new Map() };
  /** Record ages from the last load (minor contacts). */
  private recordAges = new Map<string, number | null>();

  readonly app: AppId;
  /** How rows are kept to the app: the app's read login (RLS) and the filter, or the filter only. */
  private isolation: "rls_role" | "app_filter";

  constructor(private opts: RealOptions = {}) {
    this.app = opts.app ?? DEFAULT_APP;
    const appUrl = opts.appUrl ?? process.env[appUrlEnv(this.app)];
    this.isolation = appUrl ? "rls_role" : "app_filter";
    this.url = appUrl ?? opts.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
    const want = opts.revealPii ?? process.env.OBSERVATORY_REVEAL_PII === "1";
    // The global reveal is for local databases only; staff use the per-member, audited reveal.
    // ... and a database that says it is a development one (platform.settings environment = dev), checked in init().
    this.reveal = want && !!this.url && isLocal(this.url);
    this.revealRefused = want && !this.reveal;
    const svc = opts.service === false ? undefined : opts.service ?? serviceFromEnv();
    if (svc) this.service = new ServiceClient({ ...svc, app: this.app });
    const now = Date.now();
    this.store = new Store(this.env(), { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  }

  private env(error?: string): EnvInfo {
    // OBSERVATORY_ENV_LABEL names the environment (e.g. STAGING); local databases say so.
    const where = process.env.OBSERVATORY_ENV_LABEL ?? (this.url && isLocal(this.url) ? "LOCAL DATABASE" : "PRODUCTION DATA");
    return {
      mode: "real", label: this.url ? `${where} · read-only${this.reveal ? " · PII REVEALED" : " · PII scrubbed"}${this.revealRefused ? " · OBSERVATORY_REVEAL_PII refused (database not local or not dev)" : ""}` : "REAL WORLD · not connected",
      dataset: "network schema", database: this.url ? redactUrl(this.url) : undefined, error: error ?? this.refused,
      capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true, staffActions: !!this.service }, piiRevealed: this.reveal,
      ...(this.service ? { service: this.service.url } : {}),
      app: this.app, appIsolation: this.isolation, ...(matchingAllowed(this.app) ? {} : { matchingLocked: true }),
    };
  }

  async init() {
    if (!this.url) { this.store.setEnv(this.env("No database configured. Set NETWORK_DATABASE_URL to the Network's Postgres (network schema).")); return; }
    this.sql = new SQL({ url: this.url, max: 4, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: `network-observatory-${this.app}`, statement_timeout: "20000" } });
    // The login is checked, not assumed: read-only, the app's role for an app login, and never a superuser outside this machine.
    try {
      const [who] = await this.sql`select r.rolsuper as su, r.rolbypassrls as bypass, current_setting('transaction_read_only') as ro,
          (select pg_has_role(current_user, oid, 'member') from pg_roles where rolname = ${`network_observatory_${this.app}`}) as in_app_role
        from pg_roles r where r.rolname = current_user` as any[];
      const why = loginProblem({ su: !!who?.su, bypass: !!who?.bypass, ro: String(who?.ro), inAppRole: who?.in_app_role ?? null }, { local: isLocal(this.url), isolation: this.isolation, app: this.app });
      if (why) { this.refused = `Refused: ${why}.`; await this.sql.close(); this.sql = undefined; this.store.setEnv(this.env()); return; }
    } catch (e) { this.store.setEnv(this.env(`Could not check the database login: ${(e as Error).message}`)); }
    if (this.reveal) {
      // The global reveal needs a development database as well as a local one (a tunnel to production also looks local).
      const env = await this.sql!`select value from platform.settings where key = 'environment'`.then((r: any[]) => r[0]?.value as string | undefined, () => undefined);
      if (env !== "dev") { this.reveal = false; this.revealRefused = true; }
    }
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

  private push() {
    const d = this.store.takeDelta();
    if (this.networkDirty && this.netState) { d.network = this.netState.info; this.networkDirty = false; }
    this.listeners.emit(d);
  }
  subscribe(fn: (d: ObsDelta) => void) { return this.listeners.add(fn); }

  state(): ObsState {
    this.tickClock();
    const s = this.store.snapshot();
    if (this.netState) s.network = this.netState.info;
    return s;
  }

  private tickClock() {
    const c = this.store.clock;
    c.now = Math.max(Date.now(), this.lastActivity);
    c.day = Math.floor((c.now - c.start) / DAY) + 1;
  }

  /**
   * This app's Network state, one console row per city merged into one (mergeStateRows): the app's
   * own view (migration 0005), else the shared view with the app's ids ('<app>:<city>'; a legacy id
   * with no ':' is ntwrk). Columns come from a fixed list in this file, never from a caller. A
   * database without either gives none.
   */
  private async stateRow(cols: string): Promise<any[]> {
    const sql = this.sql;
    if (!sql) return [];
    const view = `network.network_state_console_${this.app}`;
    const rows = await sql.unsafe(`select ${cols} from ${view} order by saved_at desc`).catch(() =>
      sql.unsafe(`select ${cols} from network.network_state_console where split_part(id, ':', 1) = $1 or ($1 = 'ntwrk' and position(':' in id) = 0) order by saved_at desc`, [this.app]).catch(() => []));
    const one = mergeStateRows(rows as Record<string, unknown>[]);
    return one ? [one] : [];
  }

  // ------------------------------------------------------------------ load
  private async load() {
    const sql = this.sql!;
    const s = this.store;
    const app = this.app;
    // A query with a parameter reads float4 ("real") columns in binary: 0.616 comes back as 0.6159999966.
    // Those columns are read through text (::text::float8), which gives the value as stored.
    const [members, msgAgg, partAgg, edges, opps, parts, runs, events, totals, reviews, ages, bookedMsgs, picksEv] = await Promise.all([
      sql`select id, name, home_city, home_area, account_status, participation_state, opted_out, age, invited_by, community, occupation, joined_at from network.members where app_id = ${app}`,
      sql`select member_id, count(*) filter (where direction = 'inbound')::int as msgs_in, count(*) filter (where direction = 'outbound')::int as msgs_out,
            count(*) filter (where direction = 'outbound' and proactive and status = 'delivered')::int as proactive
          from network.messages where app_id = ${app} and not system group by member_id`,
      sql`select p.member_id, count(*)::int as proposals,
            count(*) filter (where p.status = any(${`{${SAID_YES.join(",")}}`}::text[]))::int as accepted,
            count(*) filter (where p.status = 'attended')::int as meetings,
            coalesce(sum(p.enjoyment) filter (where p.status = 'attended' and o.state = any(${`{${HELD.join(",")}}`}::text[])), 0)::float8 as enjoyment_sum,
            count(*) filter (where p.status = 'attended' and o.state = any(${`{${HELD.join(",")}}`}::text[]))::int as enjoyment_n
          from network.participations p join network.opportunities o on o.app_id = p.app_id and o.id = p.opportunity_id
          where p.app_id = ${app} and p.role = 'participant' group by p.member_id`,
      sql`select from_id, to_id, type, strength::text::float8 as strength, explicit, created_at from network.edges where app_id = ${app}`,
      sql`select id, kind, state, source, generator, category, city, objective, score::text::float8 as score, components, explanations, exploration, meeting_at, reason, run_id, created_at, updated_at from network.opportunities where app_id = ${app}`,
      sql`select opportunity_id, member_id, role, status, enjoyment::text::float8 as enjoyment from network.participations where app_id = ${app}`,
      sql`select summary from network.matching_runs where app_id = ${app} order by at desc, id desc limit 40`,
      // Only types the feed shows: probes and refusals would push everything else out of the last 300.
      sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events where app_id = ${app} and type = any(${`{${FEED_TYPES.join(",")}}`}::text[]) order by at desc, id desc limit 300`,
      sql`select
            (select count(*) from network.messages where app_id = ${app} and not system)::int as messages,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'inbound')::int as inbound,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'outbound')::int as outbound,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'outbound' and proactive and status = 'delivered')::int as proactive,
            (select count(*) from network.messages where app_id = ${app} and direction = 'outbound' and type = 'proposal')::int as invites,
            (select count(*) from network.opportunities where app_id = ${app} and meeting_at is not null)::int as meetings_scheduled,
            (select count(*) from network.events where app_id = ${app} and type = 'member_blocked')::int as blocks,
            (select count(*) from network.events where app_id = ${app} and type = 'safety_flag')::int as adversarial,
            (select count(*) from network.events where app_id = ${app} and type = 'invariant_violation')::int as invariants,
            (select greatest(coalesce(max(ts), 'epoch'), (select coalesce(max(updated_at), 'epoch') from network.opportunities where app_id = ${app})) from network.messages where app_id = ${app}) as last_activity,
            (select min(joined_at) from network.members where app_id = ${app}) as first_join`,
      // Older databases may not have the review table (or its newer columns) yet: show what there is rather than fail.
      sql`select opportunity_id, queued_at, deadline, decision, reason, note, reviewer, decided_at, origin, seconds_spent::text::float8 as seconds_spent, edits, rerolls, invalidated from network.review_items where app_id = ${app}`
        .catch(() => sql`select opportunity_id, queued_at, deadline, decision, reason, note, reviewer, decided_at from network.review_items where app_id = ${app}`).catch(() => []),
      this.ageInfo(sql),
      // The booked plan: when it reached each member (the reveal), and who called it off.
      sql`select opportunity_id, member_id, min(ts) as ts from network.messages where app_id = ${app} and direction = 'outbound' and type = 'proposal' and opportunity_id is not null group by 1, 2`,
      // The time keys each member picked (the offered labels are in the message text only).
      sql`select at, type, payload from network.events where app_id = ${app} and type in ('probe_answer', 'time_answer', 'booked_cancelled') order by at, id`,
    ]);
    this.ages = ages;
    const reviewBy = new Map((reviews as any[]).map(r => [r.opportunity_id as string, r]));
    const t = totals[0]!;
    this.lastActivity = ms(t.last_activity) ?? 0;
    const start = ms(t.first_join);
    if (start) this.store.clock.start = Math.min(start, Date.now());
    this.tickClock();

    const msgBy = new Map(msgAgg.map((r: any) => [r.member_id, r]));
    const partBy = new Map(partAgg.map((r: any) => [r.member_id, r]));
    this.recordAges = new Map((members as any[]).map(r => [r.id as string, r.age as number | null]));
    for (const r of members as any[]) {
      const mm = msgBy.get(r.id) as any, pp = partBy.get(r.id) as any;
      const state: MemberStatus = r.opted_out ? "opted_out" : r.account_status === "invited" ? "not_joined" : r.participation_state;
      // A member declined at join (under 13) is stored as the id and 'removed' only: no name or city.
      const declined = r.account_status === "removed" && r.name === null;
      const age = declined ? { minor: true } : ageView(r.age, ages.latest.get(r.id));
      const opt = ages.optIns.get(r.id);
      const m: ObsMember = {
        id: r.id, name: declined ? "Declined member" : displayName(r.name, this.reveal), city: r.home_city as City, area: r.home_area ?? undefined, state,
        ...(declined ? { declined: true } : {}),
        joined: r.account_status !== "invited" && !declined, joinedAt: ms(r.joined_at), ...age, age: r.age ?? undefined,
        invitedBy: r.invited_by ?? undefined, community: r.community ?? (declined ? "declined" : undefined), occupation: r.occupation ?? undefined,
        ...(this.netState?.trust.get(r.id) ? { trust: this.netState.trust.get(r.id) } : {}),
        ...(opt?.calendar ? { calendar: true } : {}), ...(opt?.weekly ? { weekly: true } : {}),
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
    const told = new Map<string, Record<string, number>>(), times = new Map<string, NonNullable<ObsOpportunity["times"]>>(), cancelled = new Map<string, BookedPlan["cancelled"]>();
    for (const r of bookedMsgs as any[]) told.set(r.opportunity_id, { ...told.get(r.opportunity_id), [r.member_id]: ms(r.ts) ?? 0 });
    for (const e of picksEv as any[]) {
      const p = e.payload ?? {}, opp = p.oppId as string | undefined, id = p.memberId as string | undefined;
      if (!opp || !id) continue;
      if (e.type === "booked_cancelled") cancelled.set(opp, { ...cancelled.get(opp), [id]: { at: ms(e.at) ?? 0, told: !!p.told } });
      else if (Array.isArray(p.picked)) times.set(opp, { ...times.get(opp), [id]: { offered: [], picked: p.picked.map(String) } });
    }
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
      const rv = reviewBy.get(r.id);
      if (rv) o.review = this.reviewOf(rv);
      if (times.has(r.id)) o.times = times.get(r.id);
      if (o.meetingAt !== undefined && told.has(r.id)) o.booked = { at: o.meetingAt, optOutHours: BOOKED_OPT_OUT_HOURS, told: told.get(r.id)!, cancelled: cancelled.get(r.id) ?? {} };
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
    await this.loadNetwork(sql);
  }

  /**
   * How the Network treats each member's age (network.md 6.3) and their availability opt-ins: the
   * latest from its stored state (network.network_state_console), else from its events, the way the
   * game projector reads them; every change with its time from the events. A member the Network has
   * not seen yet has no entry: the record age decides.
   */
  private async ageInfo(sql: SQL): Promise<AgeInfo> {
    const info: AgeInfo = { latest: new Map(), changes: new Map(), optIns: new Map() };
    const [st, ev] = await Promise.all([
      this.stateRow("members"),
      sql`select at, type, payload from network.events where app_id = ${this.app} and type = any(${`{${[...AGE_EVENTS, "calendar_consent", "weekly_checkin_consent"].join(",")}}`}::text[]) order by at, id`.catch(() => []),
    ]);
    for (const e of ev as any[]) {
      const id = e.payload?.memberId as string | undefined;
      if (!id) continue;
      if (e.type === "calendar_consent" || e.type === "weekly_checkin_consent") {
        info.optIns.set(id, { ...info.optIns.get(id), [e.type === "calendar_consent" ? "calendar" : "weekly"]: e.payload.on !== false });
        continue;
      }
      const list = info.changes.get(id) ?? [];
      const cur = list.at(-1) ?? { minor: false, unknown: false };
      const next = e.type === "age_unknown" ? { minor: true, unknown: true } : e.type === "age_resolved" ? { minor: !!e.payload.minor, unknown: false } : { ...cur, minor: true };
      list.push({ at: ms(e.at) ?? 0, minor: next.minor, unknown: next.unknown });
      info.changes.set(id, list);
      info.latest.set(id, { minor: next.minor, unknown: next.unknown });
    }
    const raw = (st as any[])[0]?.members;
    const stored = (typeof raw === "string" ? JSON.parse(raw) : raw) as any[] | undefined;
    for (const m of stored ?? []) {
      if (typeof m?.id !== "string") continue;
      // A missing flag fails closed (treated as under 18).
      info.latest.set(m.id, { minor: m.minor !== false, unknown: !!m.ageUnknown });
      if (m.calendar !== undefined || m.weekly !== undefined) info.optIns.set(m.id, { calendar: !!m.calendar, weekly: !!m.weekly });
    }
    return info;
  }

  /**
   * Minor contacts (must be 0), as the judge counts them in game mode: outbound messages about an
   * opportunity (or a probe) while the recipient
   * or anyone in that opportunity was treated as under 18, by the record age or the Network's age
   * state at that moment; and, to a minor, a connection-type message or one that offers a connection.
   */
  private minorContacts(rows: { member_id: string; ts: Date | string; opportunity_id: string | null; type?: string | null; body?: string | null }[]): number {
    let n = 0;
    for (const r of rows) {
      const t = ms(r.ts) ?? 0;
      const minor = (id: string) => minorAt(this.ages, id, this.recordAges.get(id), t);
      const o = r.opportunity_id ? this.store.opps.get(r.opportunity_id) : undefined;
      const who = new Set([r.member_id, ...(o && o.source !== "shadow" ? o.participants : [])]);
      if ((r.opportunity_id || r.type === "probe") && [...who].some(minor)) { n++; continue; }
      // The judge's message rules too (judge metrics.ts): a connection-type message to a minor, or any
      // message to a minor that offers a connection ("Want me to see if anyone else is up for one?").
      if (minor(r.member_id) && (CONNECT_TYPES.has(r.type ?? "") || offersConnection(r.body ?? ""))) n++;
    }
    return n;
  }

  /**
   * The Network's stored state (read-only), requests, health alerts, the scorecard and growth. Every
   * part is optional: a database without these tables shows the rest.
   */
  private async loadNetwork(sql: SQL) {
    const s = this.store;
    const app = this.app;
    const now = this.store.clock.now, since = new Date(now - ALERT_WINDOW);
    const [st, reqs, msgs, ev24, evAll, contacts, lastRun, expired, service, reportRows] = await Promise.all([
      this.stateRow("saved_at, matching_enabled as matching, deferred, trust, counters, gate_reasons as gate"),
      sql`select id, member_id, kind, category, desire_id, outcome, tries, opportunity_id, created_at, fulfilled_at from network.requests where app_id = ${app} order by created_at desc`.catch(() => []),
      sql`select member_id, ts, direction, proactive, status from network.messages where app_id = ${app} and not system`,
      sql`select type, payload->>'reason' as reason, count(*)::int as n from network.events where app_id = ${app} and at >= ${since} and type in ('send_refused', 'guard_blocked') group by 1, 2`,
      sql`select type, actor_id, at, payload->>'from' as inviter, payload->>'newMemberId' as invitee, payload->>'rule' as rule from network.events
          where app_id = ${app} and type in ('member_opted_out', 'invite', 'growth_ask', 'invariant_violation')`,
      // Messages about an opportunity that went out (or would have, dry-run): not refused, held or blocked.
      // Every message that went out (or would have, dry-run): not refused, held or blocked. The text is read
      // here only to apply the judge's connection-offer rule; it never leaves this function.
      sql`select member_id, ts, opportunity_id, type, body from network.messages
          where app_id = ${app} and direction = 'outbound' and not system and status !~ '^(refused|suppressed|blocked|parked|held)'`,
      sql`select max(at) as at from network.matching_runs where app_id = ${app}`,
      sql`select count(*)::int as n from network.review_items where app_id = ${app} and decision = 'expired' and decided_at >= ${since}`.catch(() => [{ n: 0 }]),
      this.service?.health(),
      // Post-date reports for the overdue alerts and the pilot scorecard (the service's report store).
      this.service ? this.service.reports().then(r => ("error" in r ? undefined : r), () => undefined) : Promise.resolve(undefined),
    ]);
    // Network state (stored by the Network's PgStore).
    const row = (st as any[])[0];
    if (row) {
      const trust = new Map<string, "ok" | "watch" | "hold">(((typeof row.trust === "string" ? JSON.parse(row.trust) : row.trust) ?? []).map((t: any) => [t.id, t.level]));
      const counters = (typeof row.counters === "string" ? JSON.parse(row.counters) : row.counters) ?? {};
      const gate = (typeof row.gate === "string" ? JSON.parse(row.gate) : row.gate) ?? {};
      const open = [...s.opps.values()].filter(o => o.state === "IN_REVIEW").length;
      const reqRows = reqs as any[];
      const info: NetworkInfo = {
        kind: "consent", counters, gateReasons: gate, matchingEnabled: row.matching !== false,
        // The stored state never holds the review mode: production is always "human" (runbook-real 7.1).
        review: { mode: "human", queued: open, approved: counters.reviewApproved ?? 0, rejected: counters.reviewRejected ?? 0, expired: counters.reviewExpired ?? 0 },
        requests: {
          total: reqRows.filter(r => r.kind === "people").length, fulfilled: reqRows.filter(r => r.outcome === "fulfilled").length, probing: reqRows.filter(r => r.outcome === "probing").length,
          waiting: reqRows.filter(r => r.kind === "people" && r.outcome === "none").length, plans: reqRows.filter(r => r.kind === "plans").length,
        },
        trust: { watch: [...trust.values()].filter(l => l === "watch").length, hold: [...trust.values()].filter(l => l === "hold").length },
      };
      const prev = this.netState;
      this.netState = { matchingEnabled: row.matching !== false, deferred: row.deferred, savedAt: ms(row.saved_at) ?? 0, trust, info };
      if (!prev || JSON.stringify(prev.info) !== JSON.stringify(info)) this.networkDirty = true;
      for (const m of s.members.values()) {
        const level = trust.get(m.id) ?? (m.trust ? "ok" : undefined);
        if (level && m.trust !== level) { m.trust = level; s.touchMember(m.id); }
      }
    }
    // Requests (never the member's words: only what the classifier read).
    const requests: ObsRequest[] = (reqs as any[]).filter(r => s.members.has(r.member_id)).map(r => {
      const at = ms(r.created_at) ?? 0, done = ms(r.fulfilled_at);
      return {
        id: r.id, memberId: r.member_id, kind: r.kind, category: r.category ?? "social", label: requestLabel({ kind: r.kind, desireId: r.desire_id, category: r.category }),
        outcome: r.outcome ?? "open", tries: r.tries ?? 0, openedAt: at, ageHours: hours(now - at),
        ...(done !== undefined ? { fulfilledAt: done, hoursToFulfil: hours(done - at) } : {}), ...(r.opportunity_id ? { opportunityId: r.opportunity_id } : {}),
      };
    });
    s.setRequests(requests);
    // Health alerts.
    const refusals: Record<string, number> = {};
    let guardBlocked = 0;
    for (const r of ev24 as any[]) { if (r.type === "guard_blocked") guardBlocked += r.n; else refusals[r.reason ?? "unknown"] = (refusals[r.reason ?? "unknown"] ?? 0) + r.n; }
    const opps = [...s.opps.values()].filter(o => o.source !== "shadow");
    const all = evAll as any[];
    const leaks = all.filter(e => e.type === "invariant_violation" && /leak|canary/i.test(e.rule ?? "")).length;
    const minorContacts = this.minorContacts(contacts as any[]);
    const alerts = healthAlerts({
      now, start: this.store.clock.start, reviewOpen: opps.filter(o => o.state === "IN_REVIEW" && o.review).map(o => ({ deadline: o.review!.deadline, queuedAt: o.review!.queuedAt })),
      sla: { app: this.app, hours: slaHours()[this.app] }, matchingLocked: !matchingAllowed(this.app),
      reviewExpired: (expired as any[])[0]?.n ?? 0, deferred: this.netState?.deferred ?? null, refusals, guardBlocked,
      lastEngineRun: ms((lastRun as any[])[0]?.at), expectEngine: !!this.netState || s.runs.some(r => !r.shadow), matchingEnabled: this.netState?.matchingEnabled ?? matchingAllowed(this.app),
      invariants: s.counts.invariantViolations, canaryLeaks: leaks, minorContacts,
      ...(reportRows ? { reports: reportRows } : {}), opps: opps.map(o => ({ state: o.state, createdAt: o.createdAt, ...(o.meetingAt !== undefined ? { meetingAt: o.meetingAt } : {}), source: o.source })),
      extra: service ? serviceAlerts(service, Date.now()) : [],
    });
    // Scorecard and growth.
    const optOutAt = new Map<string, number>();
    for (const e of all) if (e.type === "member_opted_out" && e.actor_id) optOutAt.set(e.actor_id, ms(e.at) ?? 0);
    const inviteRows = all.filter(e => e.type === "invite");
    const inviters = new Set(inviteRows.map(e => e.inviter).filter(Boolean)).size;
    const invitees = new Set<string>(inviteRows.length ? inviteRows.map(e => e.invitee).filter(Boolean) : [...s.members.values()].filter(m => m.invitedBy).map(m => m.id));
    const members = [...s.members.values()];
    const messages: MsgMeta[] = (msgs as any[]).map(m => ({ memberId: m.member_id, ts: ms(m.ts) ?? 0, direction: m.direction, proactive: m.proactive, status: m.status }));
    const card = scorecard({
      now, start: this.store.clock.start, members, opps, messages, requests, optOutAt, invites: s.counts.invites, accepts: s.counts.accepts,
      reviewSeconds: opps.reduce((a, o) => a + (o.review?.secondsSpent ?? 0), 0), sentProposals: opps.filter(o => o.review?.decision === "approve" && !o.review.invalidated && o.review.reviewer !== SIM_AUTO_REVIEWER).length,
      inviters, minorContacts, leaks,
    });
    // The pilot gates (PRD 37.3) over the last 7 days, with an alert per pause threshold crossed.
    const pilot = pilotMetrics(await loadPilotInput(sql, app, now, {
      ...(reportRows ? { reports: reportRows.map(r => ({ at: r.at, kind: r.kind })) } : {}), cost: await appMonthCost(sql, app, now),
    }));
    card.push(...pilot);
    alerts.push(...pilotAlerts(app, pilot));
    const growth = growthStats({ members, opps, requests, invitees, invitesSent: inviteRows.length, growthAsks: all.filter(e => e.type === "growth_ask").length, inviters });
    s.setHealth({ alerts, scorecard: card, growth });
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
        feedback_given: ["feedback", this.reveal ? `${nm(e.actor_id)} gave feedback: "${String(p.text ?? "").slice(0, 90)}"` : `${nm(e.actor_id)} gave feedback`],
        member_blocked: ["block", `${nm(e.actor_id)} blocked ${nm(e.object_id)}`, "warn"],
        member_opted_out: ["opt_out", `${nm(e.actor_id)} opted out`, "warn"],
        safety_flag: ["adversarial", `Safety flag on ${nm(e.actor_id)}: ${String(p.kind ?? "").replace(/_/g, " ")}`, "bad"],
      };
      const net = NET_FEED[e.type];
      if (net) {
        const d = describe(e as EventRow, x => nm(x));
        this.store.pushFeed({ t: ms(e.at) ?? 0, kind: net, text: d.text, severity: d.severity, members: d.memberId ? [d.memberId] : ids.length ? ids : undefined, opportunityId: e.object_type === "opportunity" ? e.object_id : undefined });
        continue;
      }
      const m = map[e.type];
      if (!m) continue;
      this.store.pushFeed({ t: ms(e.at) ?? 0, kind: m[0], text: m[1], severity: m[2], members: ids.length ? ids : undefined, opportunityId: e.object_type === "opportunity" ? e.object_id : undefined });
    }
  }

  // ------------------------------------------------------------------ detail
  async member(id: string, opts: ViewOptions = {}): Promise<MemberDetail | undefined> {
    const m = this.store.member(id);
    if (!m || !this.sql) return undefined;
    const sql = this.sql;
    const rv = this.reveal || !!opts.reveal;
    const [prof, facets, intents, presence, msgs, fallbacks] = await Promise.all([
      sql`select name, bio, occupation, home_area from network.members where app_id = ${this.app} and id = ${id}`,
      sql`select * from network.facets where app_id = ${this.app} and member_id = ${id} order by kind, id`,
      sql`select * from network.intents where app_id = ${this.app} and member_id = ${id} order by created_at`,
      sql`select * from network.presence where app_id = ${this.app} and member_id = ${id}`,
      this.messages(id, rv),
      this.guardFallbacks(id),
    ]);
    const p = (prof as any[])[0] ?? {};
    return {
      member: rv && p.name ? { ...m, name: p.name } : m,
      profile: { bio: p.bio ? scrubText(p.bio, rv) : undefined, occupation: p.occupation ?? undefined, neighborhood: p.home_area ?? undefined },
      // Scores never; slop's dating facts only while revealed (checked on the raw tags, before scrubbing removes them).
      facets: memberFacets(this.app, (facets as any[]).map(facetOf), rv).map(f => scrubFacet(f, rv)),
      intents: (intents as any[]).map(i => ({ ...intentOf(i), objective: scrubText(i.objective, rv), details: i.details ? scrubText(i.details, rv) : undefined, desiredPeople: i.desired_people ? scrubText(i.desired_people, rv) : undefined })),
      presence: (presence as any[]).map(presenceOf),
      edges: [...this.store.edges.values()].filter(e => e.from === id || e.to === id),
      opportunities: [...this.store.opps.values()].filter(o => o.participants.includes(id)).sort((a, b) => b.createdAt - a.createdAt),
      messages: (msgs as any[]).map(r => this.messageOf(r, rv, fallbacks)),
    };
  }

  /** A member's messages. Unless revealed, inbound bodies are not selected at all (only their length). */
  private messages(id: string, rv: boolean) {
    const sql = this.sql!;
    return rv
      ? sql`select id, ts, direction, body, status, type, opportunity_id, proactive, system from network.messages where app_id = ${this.app} and member_id = ${id} order by ts, id limit 2000`
      : sql`select id, ts, direction, case when direction = 'inbound' then null else body end as body, length(body)::int as body_len, status, type, opportunity_id, proactive, system
            from network.messages where app_id = ${this.app} and member_id = ${id} order by ts, id limit 2000`;
  }

  /** Times (ms) at which the leak guard sent a generic version to this member (the timeline marks those messages). */
  private async guardFallbacks(id: string): Promise<Set<number> | undefined> {
    if (!this.netState) return undefined;
    const rows = await this.sql!`select at from network.events where app_id = ${this.app} and type = 'guard_blocked' and object_type = 'member' and object_id = ${id} and (payload->>'fallback')::boolean`;
    return new Set((rows as any[]).map(r => ms(r.at)!));
  }

  async timeline(id: string, opts: ViewOptions = {}): Promise<MemberTimeline | undefined> {
    const m = this.store.member(id);
    if (!m || !this.sql) return undefined;
    const sql = this.sql;
    const rv = this.reveal || !!opts.reveal;
    const theirs = new Set([...this.store.opps.values()].filter(o => o.source !== "shadow" && o.participants.includes(id)).map(o => o.id));
    const [msgs, events, fallbacks, pending] = await Promise.all([
      this.messages(id, rv),
      sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events
          where app_id = ${this.app} and (actor_id = ${id} or object_id = ${id} or payload->>'memberId' = ${id} or payload->'participants' ? ${id} or payload->'members' ? ${id}
             or (object_type = 'opportunity' and object_id = any(${`{${[...theirs].map(x => `"${x.replace(/"/g, "")}"`).join(",")}}`}::text[])))
          order by at, id limit 5000`,
      this.guardFallbacks(id),
      this.stateRow("deferred_sends").then(rows => rows.map(r => ({ d: (typeof r.deferred_sends === "string" ? JSON.parse(r.deferred_sends) : r.deferred_sends ?? []).filter((x: any) => x?.memberId === id) }))),
    ]);
    const name = (x: string) => this.store.member(x)?.name ?? x;
    const entries: TimelineEntry[] = [
      ...(msgs as any[]).map((r): TimelineEntry => { const message = this.messageOf(r, rv, fallbacks); return { t: message.ts, kind: "message", message }; }),
      ...(events as any[]).filter(e => onTimeline(e as EventRow, id, theirs)).map((e): TimelineEntry => ({ t: ms(e.at) ?? 0, kind: "event", event: describe(e as EventRow, name) })),
    ];
    // Stable: at the same instant, what the system did comes before the message it sent.
    entries.sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
    const d = (pending as any[])[0]?.d;
    const list = (typeof d === "string" ? JSON.parse(d) : d) ?? [];
    return {
      memberId: id, entries,
      pending: (list as any[]).map(x => ({ kind: String(x.kind), ...(x.type ? { type: x.type } : {}), ...(x.proposalId ? { opportunityId: x.proposalId } : {}) })),
    };
  }

  /** Unless PII is revealed, what a member wrote never leaves the database (the queries select only its length). */
  private messageOf(r: any, rv = this.reveal, fallbacks?: Set<number>): ObsMessage {
    const hidden = r.direction === "inbound" && !rv;
    const ts = ms(r.ts) ?? 0;
    // The consent Network checks every outbound text with the leak guard (its state is stored here).
    const guard = this.netState && r.direction === "outbound" && !r.system ? (fallbacks?.has(ts) ? "fallback" : "passed") : undefined;
    return {
      id: r.id, ts, direction: r.direction, body: hidden ? HIDDEN_MESSAGE : scrubText(r.body ?? "", rv), status: r.status,
      type: r.type ?? undefined, proposalId: r.opportunity_id ?? undefined, proactive: r.proactive, system: r.system,
      ...(hidden ? { hiddenLength: r.body_len ?? 0 } : {}), ...(guard ? { guard } : {}),
    };
  }

  private reviewOf(r: any): ReviewInfo {
    const edits = typeof r.edits === "string" ? JSON.parse(r.edits) : r.edits;
    return {
      queuedAt: ms(r.queued_at) ?? 0, deadline: ms(r.deadline) ?? 0, decision: r.decision ?? undefined, reason: r.reason ?? undefined,
      note: r.note ? scrubText(r.note, this.reveal) : undefined, reviewer: r.reviewer ?? undefined, decidedAt: ms(r.decided_at),
      ...(r.seconds_spent !== null && r.seconds_spent !== undefined ? { secondsSpent: Number(r.seconds_spent) } : {}),
      ...(Array.isArray(edits) && edits.length ? { edits } : {}),
      ...(r.rerolls ? { rerolls: Number(r.rerolls) } : {}),
      ...(r.invalidated ? { invalidated: r.invalidated } : {}),
    };
  }

  async opportunity(id: string): Promise<OpportunityDetail | undefined> {
    const o = this.store.opps.get(id);
    if (!o) return undefined;
    const sql = o.source !== "shadow" ? this.sql : undefined;
    const msgs = !sql ? [] : this.reveal
      ? await sql`select id, member_id, ts, direction, body, status, type, opportunity_id, proactive, system from network.messages where app_id = ${this.app} and opportunity_id = ${id} order by ts, id`
      : await sql`select id, member_id, ts, direction, case when direction = 'inbound' then null else body end as body, length(body)::int as body_len, status, type, opportunity_id, proactive, system
                  from network.messages where app_id = ${this.app} and opportunity_id = ${id} order by ts, id`;
    const events = !sql ? [] : await sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events
      where app_id = ${this.app} and object_type = 'opportunity' and object_id = ${id} order by at, id limit 2000`;
    const name = (x: string) => this.store.member(x)?.name ?? x;
    return {
      opportunity: o, members: o.participants.map(x => this.store.member(x)!).filter(Boolean),
      messages: (msgs as any[]).map(r => ({ ...this.messageOf(r), memberId: r.member_id })),
      run: o.runId ? this.store.runs.find(r => r.id === o.runId) : undefined,
      events: (events as any[]).map(e => describe(e as EventRow, name)),
    };
  }

  inOpenReview(memberId: string): boolean {
    for (const o of this.store.opps.values()) if (o.state === "IN_REVIEW" && o.participants.includes(memberId)) return true;
    return false;
  }

  /**
   * Safety cases: from the Network's stored state when it is here, else rebuilt from trust and
   * abuse events. Read-only: staff act through the Network admin API, not this console.
   */
  async safety(): Promise<SafetyInfo> {
    const sql = this.sql;
    const now = this.store.clock.now;
    const members = [...this.store.members.values()], opps = [...this.store.opps.values()];
    let cases: Parameters<typeof safetyInfo>[0]["cases"] = [];
    if (sql) {
      const st = await this.stateRow("cases");
      const raw = (st as any[])[0]?.cases;
      const stored = (typeof raw === "string" ? JSON.parse(raw) : raw) as any[] | undefined;
      if (stored) cases = stored.map(c => ({ ...c, level: this.netState?.trust.get(c.memberId) ?? c.level }));
      else {
        const ev = await sql`select at, type, payload from network.events where app_id = ${this.app} and type in ('trust', 'abuse', 'safety_action') order by at, id`;
        const by = new Map<string, (typeof cases)[number]>();
        for (const e of ev as any[]) {
          const p = e.payload ?? {}, id = p.memberId as string | undefined, at = ms(e.at) ?? 0;
          if (!id) continue;
          let c = by.get(id);
          if (!c) { c = { id: `ev-${id}`, memberId: id, opened: at, level: "ok", status: "open", events: [] }; by.set(id, c); }
          if (e.type === "abuse") for (const k of p.kinds ?? []) c.events.push({ at, kind: k, points: 0 });
          else if (e.type === "trust") { c.level = p.to; c.events.push({ at, kind: `trust_${p.to}`, points: 0 }); if (p.to === "hold") c.status = "held"; }
          else if (p.action === "lift_hold") c.status = "lifted";
          else if (p.action === "close_case") { c.status = "closed"; c.closedAt = at; c.closedBy = p.actor; }
        }
        cases = [...by.values()];
      }
    }
    const trust = this.netState?.trust ?? new Map(cases.map(c => [c.memberId, c.level]));
    // Post-date reports: the service's report store, else what the cases show (report_received after a date).
    const fromService = this.service ? await this.service.reports() : undefined;
    const reports = fromService && !("error" in fromService) ? fromService.filter(r => this.store.members.has(r.subjectId)) : reportsFromCases(cases, opps);
    return safetyInfo({
      now, cases, members, opps, canAct: !!this.service, canBan: !!this.service, reports,
      watch: [...trust].filter(([, l]) => l === "watch").map(([id]) => id), hold: [...trust].filter(([, l]) => l === "hold").map(([id]) => id),
    });
  }

  /** slop photos come from the Network service (the server already checked role, reason and age, and wrote the audit row). */
  async photos(memberId: string, actor: string, reason: string): Promise<{ ok: true; photos: MemberPhoto[] } | ControlResult> {
    if (!this.service) return { ok: false, code: "service_missing", error: "photos are kept by the Network service: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN" };
    return this.service.photos(actor, memberId, reason);
  }

  /** Through the Network service (its staff API), never this connection. Without it: refused. */
  async safetyAction(a: SafetyAction, actor: string): Promise<ControlResult> {
    if (!this.service) return { ok: false, error: "real-world mode is read-only: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN to act through the Network service", code: "read_only" };
    return this.afterAction(await this.service.safety(actor, a));
  }

  /** A staff action the service applied: read the database again so every viewer sees it. */
  private async afterAction(r: ControlResult): Promise<ControlResult> {
    if (r.ok || r.code === "not_in_review") { await this.loading; await this.reload(); this.push(); }
    return r;
  }

  async config(): Promise<ConfigInfo> {
    const sql = this.sql;
    const rows = sql ? await sql`select at, actor_id, type, payload from network.events where app_id = ${this.app} and type in ('matching_switch', 'review_mode') order by at, id` : [];
    const history: ConfigChange[] = [];
    const last: Record<string, string | boolean | null> = { matching: true, review_mode: "human" };
    for (const r of rows as any[]) {
      const key = r.type === "matching_switch" ? "matching" : "review_mode";
      const to = key === "matching" ? !!r.payload?.on : String(r.payload?.mode);
      if (last[key] === to) continue;
      history.push({ version: history.length + 1, at: ms(r.at) ?? 0, actor: String(r.payload?.actor ?? r.actor_id ?? "unknown"), key, from: last[key] ?? null, to });
      last[key] = to;
    }
    return {
      matchingEnabled: this.netState?.matchingEnabled ?? matchingAllowed(this.app), reviewMode: this.netState ? "human" : null, network: {},
      outreach: JSON.parse(JSON.stringify(OUTREACH)), history, canChange: !!this.service,
    };
  }

  /** Outbound agent messages (scrubbed unless revealed) and system events. Never what a member wrote. */
  async search(q: string, limit = 100): Promise<SearchHit[]> {
    const sql = this.sql;
    if (!sql) return [];
    const re = searchPattern(q);
    const like = `%${q.trim().replace(/[\\%_]/g, x => `\\${x}`)}%`;
    const [msgs, events] = await Promise.all([
      sql`select member_id, ts, body, type, opportunity_id from network.messages where app_id = ${this.app} and direction = 'outbound' and not system and body ilike ${like} order by ts desc limit ${limit}`,
      // Feedback events hold what a member wrote: never searched.
      sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events where app_id = ${this.app} and type <> 'feedback_given' order by at desc, id desc limit 5000`,
    ]);
    const name = (x: string) => this.store.member(x)?.name ?? x;
    const hits: SearchHit[] = [];
    for (const r of msgs as any[]) {
      if (!this.store.members.has(r.member_id)) continue;
      const text = scrubText(r.body, this.reveal);
      // The match must survive scrubbing: a phone number or email is not findable by searching for it.
      if (!re.test(text)) continue;
      hits.push({ memberId: r.member_id, memberName: name(r.member_id), t: ms(r.ts) ?? 0, kind: "message", snippet: snippet(text, re), ...(r.type ? { type: r.type } : {}), ...(r.opportunity_id ? { opportunityId: r.opportunity_id } : {}) });
    }
    for (const e of events as any[]) {
      if (hits.length >= limit * 2) break;
      const d = describe(e as EventRow, name);
      if (!d.memberId || !this.store.members.has(d.memberId) || !(re.test(d.text) || re.test(d.type))) continue;
      hits.push({ memberId: d.memberId, memberName: name(d.memberId), t: d.t, kind: "event", snippet: d.text, type: d.type, ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}) });
    }
    return hits.sort((a, b) => b.t - a.t).slice(0, limit);
  }

  // ------------------------------------------------------------------ controls
  async control(cmd: ControlCommand, actor = "unknown"): Promise<ControlResult> {
    try {
      if (cmd.type === "refresh") { await this.reload(); this.push(); return { ok: true }; }
      if (cmd.type === "shadow_run") {
        // One shadow run at a time: a second press waits for the first and gets its result.
        this.shadowing ??= this.shadowRun(cmd.city).finally(() => { this.shadowing = undefined; });
        return await this.shadowing;
      }
      // Staff actions go to the Network service, which runs the same checks as the Network (decide()).
      if (cmd.type === "matching" && cmd.on && !matchingAllowed(this.app)) return { ok: false, error: `${this.app}: ${MATCHING_OFF_TEXT}`, code: "matching_locked" };
      if (cmd.type === "review" || cmd.type === "matching") {
        if (!this.service) return { ok: false, error: `real-world mode is read-only: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN to send "${cmd.type}" to the Network service`, code: "read_only" };
        return this.afterAction(cmd.type === "review" ? await this.service.review(actor, cmd) : await this.service.matching(actor, cmd.on));
      }
      return { ok: false, error: `real-world mode is read-only: "${cmd.type}" is only available in game mode` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }

  /**
   * The engine's input, built from the database with the production service's builder
   * (packages/network/service/snapshot.ts). Under an app's read login, person-to-person blocks come
   * from the app's own view (platform.person_blocks_<app>, migration 0010): that login cannot read
   * the whole table.
   */
  async snapshot(): Promise<WorldSnapshot> {
    if (!this.sql) throw new Error("not connected");
    this.tickClock();
    return loadSnapshot(this.isolation === "rls_role" ? appBlocksSql(this.sql, this.app) : this.sql, this.store.clock.now, { app: this.app });
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

/** Network events shown in the real-mode feed (the text comes from describe()). */
const NET_FEED: Record<string, FeedKind> = {
  review_decision: "review", review_expired: "review", review_invalidated: "review", matching_switch: "config", trust: "trust",
  safety_action: "trust", abuse: "adversarial", guard_blocked: "guard", join_declined: "trust", minor_signal: "trust", age_unknown: "trust",
  age_resolved: "trust", age_conflict: "trust",
  // The rule only: an invariant's detail can name a canary.
  invariant_violation: "invariant",
};
/** Every event type the real-mode feed shows. */
const FEED_TYPES = [
  "member_joined", "opportunity_proposed", "member_accepted", "member_declined", "meeting_scheduled", "interaction_occurred", "feedback_given",
  "member_blocked", "member_opted_out", "safety_flag", ...Object.keys(NET_FEED),
];

/**
 * The SQL client for the snapshot builder under an app's read login: every reference to
 * platform.person_blocks reads the app's own view instead (blocks between two members of this app).
 * The builder's queries are otherwise passed through unchanged.
 */
export function appBlocksSql(sql: SQL, app: string): SQL {
  const view = `platform.person_blocks_${app.replace(/[^a-z]/g, "")}`;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.some(x => x.includes("platform.person_blocks"))) return (sql as any)(strings, ...values);
    const swapped = strings.map(x => x.replaceAll("platform.person_blocks", view));
    return (sql as any)(Object.assign(swapped, { raw: swapped }) as unknown as TemplateStringsArray, ...values);
  };
  return new Proxy(tag, { get: (_t, k) => { const v = (sql as any)[k]; return typeof v === "function" ? v.bind(sql) : v; } }) as unknown as SQL;
}

function upsertIfChanged<T extends { id: string }>(map: Map<string, T>, next: T, upsert: (x: T) => void) {
  const cur = map.get(next.id);
  if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) upsert(next);
}


/** Message types that connect a member to another member (judge metrics.ts CONNECT_TYPES): never sent to a minor. */
const CONNECT_TYPES = new Set(["probe", "proposal", "relay", "growth_ask", "scheduling", "reminder", "cancellation", "feedback_request", "confirmation"]);
/** A connection offer that is not negated, as the judge reads it ("I won't introduce you" is the minor notice). */
function offersConnection(text: string): boolean {
  for (const m of text.matchAll(new RegExp(CONNECTION.source, "gi"))) {
    if (!/\b(won'?t|will not|can'?t|cannot|never|not|no)\b[^.,;!?]*$/i.test(text.slice(Math.max(0, m.index! - 40), m.index!))) return true;
  }
  return false;
}
