import { SQL } from "../../../../packages/core/src/runtime/postgres.ts";
import { heldMeetingMinimum, observatoryMeetingHeld, observatoryProposalCounts } from "../../../../packages/core/src/generated/observatoryRoster.ts";
import { consoleBookingReceiptCurrent, consoleDeliveryEvidenceAllowed, consoleDeliveryGuard, consolePreparedBodyWithheld, type ConsoleDeliveryGuard } from "../../../../packages/core/src/generated/consoleMemberView.ts";
import { confirmationWindowHours } from "../../../../packages/core/src/generated/meetingSettlement.ts";
import {
  ALL_SEED_VENUES, canBeMatched, CITY_IDS, DAY, earliestDayKeyOf, getCity, groupVenueRubricScore, isCity, isMinor, latestDayKeyOf, listCities, seedVenuesForCity, validAge,
  type AgeSide, type City, type EdgeType, type VenuePriceTier, type VenueRecord, type VenueStatus, type WorkIntroChannel, type WorldSnapshot,
} from "@thenetwork/core";
import { ageOnDay } from "../../../../packages/core/src/generated/memberAge.ts";
import { groupAgeAllowed, teenReady, teenRosterSizeAllowed } from "../../../../packages/core/src/generated/friendIntroAge.ts";
import { teenFriendApp, teenFriendCategory, teenGenerator } from "../../../../packages/core/src/generated/matchLane.ts";
import { JUDGE_VERDICTS } from "@thenetwork/engine/src/reviewJudge.ts";
import { copy, OUTREACH, teenMeetingEndOf } from "@thenetwork/network";
import { CONNECTION } from "@thenetwork/network";
import { facetOf, intentOf, loadSnapshot, presenceOf } from "@thenetwork/network/service/snapshot";
import { confirmedProactiveDeliveryStatuses } from "../../../../packages/core/src/generated/consolePanels.ts";
import { runEngineSummarized, storedRunSummary, type StoredRunSummary } from "../engineCapture.ts";
import { describe, onTimeline, requestLabel, type EventRow } from "../events.ts";
import { ALERT_WINDOW, growthStats, healthAlerts, hours, reportsFromCases, safetyInfo, scorecard, type MsgMeta } from "../health.ts";
import { memberFacets } from "../appProfile.ts";
import { ACCEPTED_PARTICIPATION_STATUSES, countsAsAcceptance } from "../projector.ts";
import { displayName, scrubFacet, scrubText } from "../scrub.ts";
import { edgeId, emptyCounters, Store, zeroCounts } from "../store.ts";
import type {
  BiasReportView, HeldQueue, HeldText, BookedPlan, ConfigChange, ConfigInfo, ControlCommand, ControlResult, DeliveryReason, EngineRunSummary, EnvInfo, FeedKind, MemberDetail, MemberPhoto, MemberStatus, MemberTimeline, NetworkInfo,
  ObsCitySummary, ObsDelta, ObsEdge, ObsFeedItem, ObsMember, ObsMessage, ObsOpportunity, ObsRequest, ObsState, ObsVenue, OpportunityDetail, ParticipantStatus, ReviewInfo,
  HealthAlert, SafetyAction, SafetyInfo, SearchHit, TimelineEntry,
} from "../types.ts";
import { APP_TO_DOMAIN, appUrlEnv, DEFAULT_APP, DOMAIN_IDS, inferDomain, isDomainId, slaHours, type AppId, type DomainId } from "../apps.ts";
import { serviceAlerts, ServiceClient, serviceFromEnv, type ServiceConfig } from "./service.ts";
import type { GatheringRequest } from "../gatherings.ts";
import type { StaffStepForward } from "../staffSteps.ts";
import { staffSearchHitVisible } from "../../../../packages/core/src/generated/staffSearch.ts";
import { staffHistoryHasEarlier, staffHistoryPageSize } from "../../../../packages/core/src/generated/staffHistory.ts";
import { Listeners, searchPattern, snippet, type DataSource, type HistoryCursor, type ViewOptions } from "./source.ts";

export interface RealOptions {
  url?: string;
  app?: AppId;
  appUrl?: string;
  pollMs?: number;
  revealPii?: boolean;
  pushMs?: number;
  service?: ServiceConfig | false;
}

const HELD = ["COMPLETED", "FEEDBACK_COLLECTED"];
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);
export const HIDDEN_MESSAGE = "[member message hidden]";

interface MessageEvidenceKey { id: string; member_id: string; direction: string; system: boolean; status: string }
interface HistoryRow { id: string; history_at: string }
type MessageHistoryRow = MessageEvidenceKey & HistoryRow;
type EventHistoryRow = EventRow & HistoryRow;

function historyPage<Row extends HistoryRow>(rows: Row[], membersEvents = false) {
  const page = rows.slice(0, staffHistoryPageSize(membersEvents));
  const oldest = page.at(-1);
  const before = oldest && staffHistoryHasEarlier(rows.length, membersEvents)
    ? Buffer.from(JSON.stringify([oldest.history_at, oldest.id])).toString("base64url") : undefined;
  return { rows: page.reverse(), before };
}
interface DeliveryEvidence {
  app_id: AppId; member_id: string; message_id: string; status: string | null; reason: DeliveryReason | null;
  leak_stopped: boolean; staff_released: boolean; attempted: boolean;
}
interface BookingReceiptView {
  app_id: AppId; opportunity_id: string; member_id: string; booking_at: Date; received_at: Date;
}
interface ParticipationRow {
  opportunity_id: string; member_id: string; role: string; status: ParticipantStatus; enjoyment: number | null;
  reviewed: boolean; approved: boolean; invalidated: boolean; published: boolean;
}
const guardLabel: Record<ConsoleDeliveryGuard, ObsMessage["guard"]> = {
  DeliveryGuardUnrecorded: undefined, DeliveryGuardBlocked: "blocked", DeliveryGuardReleased: "released", DeliveryGuardChecked: "passed",
};

function deliveryOf(app: AppId, row: MessageEvidenceKey, evidence?: DeliveryEvidence) {
  const record = evidence && consoleDeliveryEvidenceAllowed(evidence.app_id === app, evidence.member_id === row.member_id,
    evidence.message_id === row.id, row.direction === "outbound" && row.system === false) ? evidence : undefined;
  const check = consoleDeliveryGuard(!!record, record?.leak_stopped === true, record?.staff_released === true, record?.attempted === true);
  const status = record?.status ?? row.status;
  const withheld = row.direction === "outbound" && consolePreparedBodyWithheld(check, status === "parked_leak_review" || status === "dropped_leak_review");
  return { guard: guardLabel[check], status, withheld, reason: record?.reason };
}

interface AgeState { minor: boolean; unknown: boolean }
interface AgeInfo {
  latest: Map<string, AgeState>;
  changes: Map<string, (AgeState & { at: number })[]>;
  optIns: Map<string, { calendar?: boolean; weekly?: boolean }>;
  teenHistory: Map<string, TeenEvent[]>;
  flags: Map<string, TeenFlags>;
}
interface TeenFlags { minorSignal: boolean; minorReported: boolean; olderReported: boolean; ageConflict: boolean; ageUnknown: boolean }

interface TeenSwitchRow { at: number; on: boolean }
interface TeenAgeRow {
  birthKey?: number; birthExact?: boolean; ageConflict?: boolean; teenBarred?: boolean;
  minorSignal?: boolean; minorReported?: boolean; olderReported?: boolean;
}
interface TeenEvent { at: number; kind: "signal" | "cleared" | "reported" | "older" | "conflict" | "unknown" | "resolved" }
interface TeenEvidence {
  app: AppId; readable: boolean; problem?: string; switches: TeenSwitchRow[];
  members: ReadonlyMap<string, TeenAgeRow>; history: ReadonlyMap<string, readonly TeenEvent[]>;
}
interface TeenFlagsAt { signal: boolean; reported: boolean; older: boolean; conflict: boolean; unknown: boolean }

function teenFlagsAt(history: readonly TeenEvent[], t: number): TeenFlagsAt {
  const f: TeenFlagsAt = { signal: false, reported: false, older: false, conflict: false, unknown: false };
  for (const e of history) {
    if (e.at > t) break;
    if (e.kind === "signal") f.signal = true;
    else if (e.kind === "cleared") { f.signal = false; f.reported = false; f.conflict = false; }
    else if (e.kind === "reported") f.reported = true;
    else if (e.kind === "older") f.older = true;
    else if (e.kind === "conflict") f.conflict = true;
    else if (e.kind === "unknown") f.unknown = true;
    else f.unknown = false;
  }
  return f;
}

function teenSwitchOnAt(rows: readonly TeenSwitchRow[], t: number): boolean {
  let on = true;
  for (const r of rows) { if (r.at > t) break; on = r.on; }
  return on;
}

function teenReadyAt(e: TeenEvidence, id: string, t: number, atT: boolean): { ready: boolean; adultClear: boolean } {
  const m = e.members.get(id);
  if (!m) return { ready: false, adultClear: false };
  const h = teenFlagsAt(e.history.get(id) ?? [], atT ? t : Infinity);
  const conflict = h.conflict || h.unknown || (!atT && m.ageConflict === true);
  const signal = h.signal || (!atT && m.minorSignal === true);
  const reported = h.reported || (!atT && m.minorReported === true);
  const older = h.older || (!atT && m.olderReported === true);
  const ready = teenReady(m.birthExact === true, conflict, signal, reported, older, m.teenBarred === true);
  const adultClear = !conflict && !signal && !reported;
  return { ready, adultClear };
}

function teenSideAt(e: TeenEvidence, id: string, t: number, atT: boolean): AgeSide {
  const m = e.members.get(id);
  if (!m || m.birthKey === undefined) return { adult: false, ready: false, birthKey: 0 };
  const { ready, adultClear } = teenReadyAt(e, id, t, atT);
  const adult = canBeMatched(ageOnDay(m.birthKey, earliestDayKeyOf(t))) && adultClear;
  return { adult, ready, birthKey: m.birthKey };
}

async function teenRuleHeldAt(e: TeenEvidence, sql: SQL, oppId: string, ids: readonly string[], category: string | undefined, t: number, until = t): Promise<boolean> {
  if (!e.readable || !teenRosterSizeAllowed(true, ids.length) || category === undefined) return false;
  if (!teenSwitchOnAt(e.switches, t)) return false;
  const lane = teenFriendCategory(e.app, category);
  if (!lane) return false;
  const minDay = earliestDayKeyOf(t), maxDay = latestDayKeyOf(Math.max(t, until));
  if (ids.every(id => e.members.get(id)?.birthKey !== undefined)) {
    const side = (id: string, atT: boolean): AgeSide => teenSideAt(e, id, t, atT);
    return groupAgeAllowed(true, lane, minDay, maxDay, ids.map(id => side(id, true)))
      && groupAgeAllowed(true, lane, minDay, maxDay, ids.map(id => side(id, false)));
  }
  for (const atT of [true, false]) {
    const readyIds = ids.filter(id => teenReadyAt(e, id, t, atT).ready);
    const adultClearIds = ids.filter(id => teenReadyAt(e, id, t, atT).adultClear);
    const [row] = await sql<{ ok: boolean }[]>`select platform.console_teen_roster_allowed(
      ${e.app}, ${oppId}, ${sql.array(ids, "TEXT")}, ${minDay}, ${maxDay},
      ${sql.array(readyIds, "TEXT")}, ${sql.array(adultClearIds, "TEXT")}) as ok`;
    if (row?.ok !== true) return false;
  }
  return true;
}

const TEEN_NOTICE_TYPES = new Set(["info", "cancellation"]);

function teenScopeNoticeAt(e: TeenEvidence, memberId: string, body: string, t: number, others: readonly string[]): boolean {
  if (!e.readable || !teenFriendApp(e.app) || !teenSwitchOnAt(e.switches, t) || !body.includes(copy.minorTeenFriends)) return false;
  const rest = body.split(copy.minorTeenFriends).join(" ");
  if (offersConnection(rest) || namesAny(rest, others)) return false;
  return teenReadyAt(e, memberId, t, true).ready && teenReadyAt(e, memberId, t, false).ready;
}

function namesAny(body: string, others: readonly string[]): boolean {
  return others.some(name => name.length >= 2 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body));
}

function teenNoticeNamesNobody(body: string, type: string | null | undefined, others: readonly string[]): boolean {
  if (!TEEN_NOTICE_TYPES.has(type ?? "") || offersConnection(body)) return false;
  return !namesAny(body, others);
}
const AGE_EVENTS = ["age_unknown", "age_resolved", "minor_signal", "age_conflict"];
const TEEN_EVENTS = ["safety_action", "minor_reported", "teen_age_contradicted"];
const recordMinor = (age: number | null | undefined) => validAge(age) && isMinor(age);

function teenEventKind(type: string, action: unknown): TeenEvent["kind"] | undefined {
  if (type === "minor_signal") return "signal";
  if (type === "safety_action") return action === "clear_teen_doubt" || action === "clear_minor_signal" ? "cleared" : action === "older_than_stated" ? "older" : undefined;
  if (type === "minor_reported") return "reported";
  if (type === "teen_age_contradicted") return "older";
  if (type === "age_conflict") return "conflict";
  if (type === "age_unknown") return "unknown";
  if (type === "age_resolved") return "resolved";
  return undefined;
}

export function ageView(recordAge: number | null, net?: AgeState): { minor: boolean; ageUnknown?: true } {
  if (net) return { minor: net.minor || recordMinor(recordAge), ...(net.unknown ? { ageUnknown: true as const } : {}) };
  return recordAge === null ? { minor: true, ageUnknown: true } : { minor: recordMinor(recordAge) };
}

export function minorAt(info: Pick<AgeInfo, "latest" | "changes">, id: string, recordAge: number | null | undefined, t: number): boolean {
  if (recordMinor(recordAge)) return true;
  let st: AgeState | undefined;
  for (const c of info.changes.get(id) ?? []) { if (c.at > t) break; st = c; }
  if (st) return st.minor;
  const stored = info.changes.has(id) ? undefined : info.latest.get(id);
  if (stored) return stored.minor;
  return !validAge(recordAge);
}

export function loginProblem(r: { su: boolean; bypass: boolean; ro: string; inAppRole: boolean | null }, o: { local: boolean; isolation: "rls_role" | "app_filter"; app: string }): string | undefined {
  if (r.ro !== "on") return "the console's connection is not read-only";
  if (o.isolation === "rls_role" && r.inAppRole !== true) return `the app's read login is not a member of network_observatory_${o.app}`;
  if (!o.local && (r.su || r.bypass)) return "the console's login is a superuser or bypasses row-level security: use a network_observatory_<app> login";
  return undefined;
}

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
  private unchecked?: SQL;
  private listeners = new Listeners<ObsDelta>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private reveal: boolean;
  private url?: string;
  private loading: Promise<void> | null = null;
  private lastActivity = 0;
  private shadowIds = new Set<string>();
  private shadowRuns: EngineRunSummary[] = [];
  private netState?: { matchingEnabled: boolean; deferred: number; savedAt: number; trust: Map<string, "ok" | "watch" | "hold">; info: NetworkInfo };
  private networkDirty = false;
  private serviceMatchingAllowed?: boolean;
  private revealRefused = false;
  private refused?: string;
  private service?: ServiceClient;
  private shadowing?: Promise<ControlResult>;
  private ages: AgeInfo = { latest: new Map(), changes: new Map(), optIns: new Map(), teenHistory: new Map(), flags: new Map() };
  private recordAges = new Map<string, number | null>();
  private firstNames = new Map<string, string>();

  readonly app: AppId;
  private isolation: "rls_role" | "app_filter";

  constructor(private opts: RealOptions = {}) {
    this.app = opts.app ?? DEFAULT_APP;
    const appUrl = opts.appUrl ?? process.env[appUrlEnv(this.app)];
    this.isolation = appUrl ? "rls_role" : "app_filter";
    this.url = appUrl ?? opts.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
    const want = opts.revealPii ?? process.env.OBSERVATORY_REVEAL_PII === "1";
    this.reveal = want && !!this.url && isLocal(this.url);
    this.revealRefused = want && !this.reveal;
    const svc = opts.service === false ? undefined : opts.service ?? serviceFromEnv();
    if (svc) this.service = new ServiceClient({ ...svc, app: this.app });
    const now = Date.now();
    this.store = new Store(this.env(), { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  }

  private env(error?: string): EnvInfo {
    const where = process.env.OBSERVATORY_ENV_LABEL ?? (this.url && isLocal(this.url) ? "LOCAL DATABASE" : "PRODUCTION DATA");
    return {
      mode: "real", label: this.url ? `${where} · read-only${this.reveal ? " · PII REVEALED" : " · PII scrubbed"}${this.revealRefused ? " · OBSERVATORY_REVEAL_PII refused (database not local or not dev)" : ""}` : "REAL WORLD · not connected",
      dataset: "network schema", database: this.url ? redactUrl(this.url) : undefined, error: error ?? this.refused,
      capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true, staffActions: !!this.service }, piiRevealed: this.reveal,
      ...(this.service ? { service: this.service.url } : {}),
      app: this.app, appIsolation: this.isolation, ...(this.serviceMatchingAllowed === false ? { matchingLocked: true } : {}),
    };
  }

  async init() {
    if (!this.url) { this.store.setEnv(this.env("No database configured. Set NETWORK_DATABASE_URL to the Network's Postgres (network schema).")); return; }
    this.unchecked = new SQL({ url: this.url, max: 4, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: `network-observatory-${this.app}`, statement_timeout: "20000" } });
    await this.refresh();
    if (!this.sql && !this.unchecked) return;
    this.timers.push(setInterval(() => { this.reload(); }, this.opts.pollMs ?? 10_000));
    this.timers.push(setInterval(() => this.push(), this.opts.pushMs ?? 500));
  }

  private async checkLogin(): Promise<boolean> {
    const sql = this.unchecked;
    if (!sql || !this.url) return false;
    let who: { su?: boolean; bypass?: boolean; ro?: unknown; in_app_role?: boolean | null } | undefined;
    try {
      [who] = await sql<{ su: boolean; bypass: boolean; ro: string; in_app_role: boolean | null }[]>`select r.rolsuper as su, r.rolbypassrls as bypass, pg_catalog.current_setting('transaction_read_only') as ro,
          (select pg_catalog.pg_has_role(current_user, a.oid, 'member') from pg_catalog.pg_roles a where a.rolname = ${`network_observatory_${this.app}`}) as in_app_role
        from pg_catalog.pg_roles r where r.rolname = current_user`;
    } catch (e) {
      this.store.setEnv(this.env(`Refused: could not check the database login: ${(e as Error).message}. Could not check the database login, so the console reads nothing until the next poll checks it again.`));
      return false;
    }
    this.unchecked = undefined;
    const why = loginProblem({ su: !!who?.su, bypass: !!who?.bypass, ro: String(who?.ro), inAppRole: who?.in_app_role ?? null }, { local: isLocal(this.url), isolation: this.isolation, app: this.app });
    if (why) {
      this.refused = `Refused: ${why}.`;
      for (const t of this.timers) clearInterval(t);
      this.timers = [];
      await sql.close();
      this.store.setEnv(this.env());
      return false;
    }
    if (this.reveal) {
      const env = await sql`select value from platform.settings where key = 'environment'`.then((r: any[]) => r[0]?.value as string | undefined, () => undefined);
      if (env !== "dev") { this.reveal = false; this.revealRefused = true; }
    }
    this.sql = sql;
    this.store.setEnv(this.env());
    return true;
  }

  private async refresh() {
    if (!this.sql && !(await this.checkLogin())) return;
    try {
      await this.load();
      const env = this.env();
      if (JSON.stringify(env) !== JSON.stringify(this.store.env)) this.store.setEnv(env);
    } catch (e) {
      this.store.setEnv(this.env(`Read failed: ${(e as Error).message}`));
    }
  }

  async dispose() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.sql?.close();
    await this.unchecked?.close();
  }

  private reload() {
    if (this.loading || (!this.sql && !this.unchecked)) return this.loading ?? Promise.resolve();
    this.loading = this.refresh().finally(() => { this.loading = null; });
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

  private async stateRow(cols: string): Promise<any[]> {
    const sql = this.sql;
    if (!sql) return [];
    const missing = (e: unknown) => { if ((e as { errno?: string }).errno !== "42P01" && (e as { code?: string }).code !== "42P01") throw e; };
    const view = `network.network_state_console_${this.app}`;
    const rows = await sql.unsafe(`select ${cols} from ${view} order by saved_at desc`).catch(e => {
      missing(e);
      return sql.unsafe(`select ${cols} from network.network_state_console where split_part(id, ':', 1) = $1 or ($1 = 'ntwrk' and position(':' in id) = 0) order by saved_at desc`, [this.app]).catch(e2 => { missing(e2); return []; });
    });
    const one = mergeStateRows(rows as Record<string, unknown>[]);
    return one ? [one] : [];
  }

  private async load() {
    const sql = this.sql!;
    const s = this.store;
    const app = this.app;
    const [members, msgAgg, partAgg, edges, opps, parts, runs, events, totals, reviews, ages, bookedMsgs, picksEv, dbVenues, venueEvs, memberDomainRows, intentDomains] = await Promise.all([
      sql`select id, name, home_city, home_area, account_status, participation_state, opted_out, age, invited_by, community, occupation, joined_at from network.members where app_id = ${app}`,
      sql`select member_id, count(*) filter (where direction = 'inbound')::int as msgs_in, count(*) filter (where direction = 'outbound')::int as msgs_out,
            count(*) filter (where direction = 'outbound' and proactive and status in ${sql(confirmedProactiveDeliveryStatuses)})::int as proactive
          from network.messages where app_id = ${app} and not system group by member_id`,
      sql`with held as (
            select o.id from network.opportunities o
            join network.participations a on a.app_id = o.app_id and a.opportunity_id = o.id
            where o.app_id = ${app} and o.source <> 'shadow' and o.state = any(${`{${HELD.join(",")}}`}::text[])
              and a.role = 'participant' and a.status = 'attended'
            group by o.id having count(*) >= ${heldMeetingMinimum}
          )
          select p.member_id,
            count(*) filter (where p.status = any(${`{${ACCEPTED_PARTICIPATION_STATUSES.join(",")}}`}::text[]))::int as accepted,
            count(*) filter (where p.status = 'attended' and h.id is not null)::int as meetings,
            coalesce(sum(p.enjoyment) filter (where p.status = 'attended' and h.id is not null), 0)::float8 as enjoyment_sum,
            count(p.enjoyment) filter (where p.status = 'attended' and h.id is not null)::int as enjoyment_n
          from network.participations p left join held h on h.id = p.opportunity_id
          where p.app_id = ${app} and p.role = 'participant' group by p.member_id`,
      sql<{ from_id: string; to_id: string; type: EdgeType; strength: number; explicit: boolean; created_at: Date | string | null }[]>`select from_id, to_id, type, strength::text::float8 as strength, explicit, created_at from network.edges where app_id = ${app} order by from_id, to_id, type`,
      sql`select id, kind, state, source, generator, category, city, objective, score::text::float8 as score, components, explanations, exploration, meeting_at, reason, run_id, venue_id, backup_venue_id, work_intro_channel, created_at, updated_at from network.opportunities where app_id = ${app}`
        .catch(() => sql`select id, kind, state, source, generator, category, city, objective, score::text::float8 as score, components, explanations, exploration, meeting_at, reason, run_id, created_at, updated_at from network.opportunities where app_id = ${app}`),
      sql<ParticipationRow[]>`select p.opportunity_id,p.member_id,p.role,p.status,p.enjoyment::text::float8 as enjoyment,
        rv.opportunity_id is not null as reviewed, coalesce(rv.decision='approve',false) as approved, rv.invalidated is not null as invalidated,
        case when p.role='participant' and rv.decision='approve' and rv.invalidated is not null then exists (
          select 1 from network.messages m
          left join network.${sql(`outbound_evidence_${app}`)} e on e.app_id=m.app_id and e.member_id=m.member_id and e.message_id=m.id
          where m.app_id=p.app_id and m.opportunity_id=p.opportunity_id and m.member_id=p.member_id
            and m.direction='outbound' and not m.system and m.type in ('probe','plan_probe','proposal')
            and (e.reason='accepted_by_provider' or e.status in ('delivered','read')
              or (e.message_id is null and m.status='delivered'))
        ) else false end as published
        from network.participations p
        left join network.review_items rv on rv.app_id=p.app_id and rv.opportunity_id=p.opportunity_id
        where p.app_id=${app}`,
      sql<{ summary: StoredRunSummary }[]>`select summary from network.matching_runs where app_id = ${app} order by at desc, id desc limit 40`,
      // Only types the feed shows: probes and refusals would push everything else out of the last 300.
      sql`select id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events where app_id = ${app} and type = any(${`{${FEED_TYPES.join(",")}}`}::text[]) order by at desc, id desc limit 300`,
      sql`select
            (select count(*) from network.messages where app_id = ${app} and not system)::int as messages,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'inbound')::int as inbound,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'outbound')::int as outbound,
            (select count(*) from network.messages where app_id = ${app} and not system and direction = 'outbound' and proactive and status in ${sql(confirmedProactiveDeliveryStatuses)})::int as proactive,
            (select count(*) from network.messages where app_id = ${app} and direction = 'outbound' and type = 'proposal')::int as invites,
            (select count(*) from network.opportunities where app_id = ${app} and meeting_at is not null)::int as meetings_scheduled,
            (select count(*) from network.events where app_id = ${app} and type = 'member_blocked')::int as blocks,
            (select count(*) from network.events where app_id = ${app} and type = 'safety_flag')::int as adversarial,
            (select count(*) from network.events where app_id = ${app} and type = 'invariant_violation')::int as invariants,
            (select greatest(coalesce(max(ts), 'epoch'), (select coalesce(max(updated_at), 'epoch') from network.opportunities where app_id = ${app})) from network.messages where app_id = ${app}) as last_activity,
            (select min(joined_at) from network.members where app_id = ${app}) as first_join`,
      sql`select r.opportunity_id, r.queued_at, r.deadline, r.decision, r.reason, r.note, r.reviewer, r.decided_at, r.origin, r.seconds_spent::text::float8 as seconds_spent,
        r.edits, r.rerolls, r.invalidated, r.approver, r.exception_reason, r.judge_verdict,
        (select j.explanation from network.review_judgments j where j.app_id = r.app_id and j.opportunity_id = r.opportunity_id and j.revision = r.rerolls
          and j.status = 'decided' and j.reason = r.exception_reason and j.verdict = r.judge_verdict and j.verdict <> 'approve'
          order by j.decided_at desc limit 1) as judge_explanation
        from network.review_items r where r.app_id = ${app}`,
      this.ageInfo(sql),
      sql.unsafe<BookingReceiptView[]>(`select app_id, opportunity_id, member_id, booking_at, received_at
        from network.booking_receipts_${app} where app_id=$1`, [app]),
      // The time keys each member picked (the offered labels are in the message text only).
      sql`select at, type, payload from network.events where app_id = ${app} and type in ('probe_answer', 'time_answer', 'booked_cancelled') order by at, id`,
      sql`select id, city, neighborhood, name, lat, lon, arrival_landmark, status, category, price_tier from platform.venues`.catch(() => null),
      sql`select object_id, payload from network.events where app_id = ${app} and type = 'venue' order by at asc, id asc`.catch(() => []),
      sql<{ member_id: string; domain: string }[]>`select m.id as member_id, d.domain from network.members m join platform.member_domains d on d.person_id = m.person_id where m.app_id = ${app} and d.enabled = true`.catch(() => []),
      sql<{ member_id: string; category: string }[]>`select distinct member_id, category from network.intents where app_id = ${app}`.catch(() => []),
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
    const proposals = new Map<string, number>(), partsBy = new Map<string, ParticipationRow[]>();
    for (const p of parts) {
      const group = partsBy.get(p.opportunity_id) ?? [];
      group.push(p);
      partsBy.set(p.opportunity_id, group);
      if (p.role === "participant" && observatoryProposalCounts(p.reviewed, p.approved, p.invalidated, p.published)) {
        proposals.set(p.member_id, (proposals.get(p.member_id) ?? 0) + 1);
      }
    }
    const domainsByMember = new Map<string, Set<DomainId>>();
    const addDom = (memberId: string, d: DomainId) => {
      let set = domainsByMember.get(memberId);
      if (!set) { set = new Set<DomainId>(); domainsByMember.set(memberId, set); }
      set.add(d);
    };
    const appDomain = APP_TO_DOMAIN[app];
    for (const r of memberDomainRows as { member_id: string; domain: string }[]) {
      if (isDomainId(r.domain)) addDom(r.member_id, r.domain);
    }
    for (const r of intentDomains as { member_id: string; category: string }[]) {
      addDom(r.member_id, inferDomain({ app, category: r.category }));
    }
    for (const r of opps as any[]) {
      const oppDom = inferDomain({ app, category: r.category ?? undefined, generator: r.generator ?? r.source, workIntroChannel: toCoreWorkIntroChannel(r.work_intro_channel) });
      for (const p of partsBy.get(r.id) ?? []) if (p.role === "participant") addDom(p.member_id, oppDom);
    }
    this.recordAges = new Map((members as any[]).map(r => [r.id as string, r.age as number | null]));
    const liveMembers = new Set<string>();
    this.firstNames = new Map();
    for (const r of members as any[]) {
      liveMembers.add(r.id as string);
      if (typeof r.name === "string") this.firstNames.set(r.id, r.name.trim().split(/\s+/)[0]!);
      const mm = msgBy.get(r.id) as any, pp = partBy.get(r.id) as any;
      const state: MemberStatus = r.opted_out ? "opted_out" : r.account_status === "invited" ? "not_joined" : r.participation_state;
      const declined = r.account_status === "removed" && r.name === null;
      const age = declined ? { minor: true } : ageView(r.age, ages.latest.get(r.id));
      const opt = ages.optIns.get(r.id);
      const domSet = domainsByMember.get(r.id);
      if (appDomain) { if (domSet) domSet.add(appDomain); }
      const domains: DomainId[] = domSet?.size ? DOMAIN_IDS.filter(d => domSet.has(d)) : [appDomain ?? "friendship"];
      const m: ObsMember = {
        id: r.id, name: declined ? "Declined member" : displayName(r.name, this.reveal), city: r.home_city as City, area: r.home_area ?? undefined, state,
        ...(declined ? { declined: true } : {}),
        joined: r.account_status !== "invited" && !declined, joinedAt: ms(r.joined_at), ...age, age: r.age ?? undefined,
        invitedBy: r.invited_by ?? undefined, community: r.community ?? (declined ? "declined" : undefined), occupation: r.occupation ?? undefined,
        ...(this.netState?.trust.get(r.id) ? { trust: this.netState.trust.get(r.id) } : {}),
        ...(opt?.calendar ? { calendar: true } : {}), ...(opt?.weekly ? { weekly: true } : {}),
        domains, sourceApp: app,
        counters: {
          ...emptyCounters(), msgsIn: mm?.msgs_in ?? 0, msgsOut: mm?.msgs_out ?? 0, proactive: mm?.proactive ?? 0,
          proposals: proposals.get(r.id) ?? 0, accepted: pp?.accepted ?? 0, meetings: pp?.meetings ?? 0,
          enjoymentSum: pp?.enjoyment_sum ?? 0, enjoymentN: pp?.enjoyment_n ?? 0,
        },
      };
      upsertIfChanged(s.members, m, x => s.upsertMember(x));
    }
    for (const id of [...s.members.keys()]) if (!liveMembers.has(id)) s.removeMember(id);
    const currentEdges = new Map<string, ObsEdge>();
    for (const r of edges as any[]) {
      if (!s.members.has(r.from_id) || !s.members.has(r.to_id)) continue;
      const id = edgeId(r.type, r.from_id, r.to_id);
      const edge: ObsEdge = { id, from: r.from_id, to: r.to_id, type: r.type as EdgeType,
        strength: r.strength, createdAt: ms(r.created_at) ?? 0, origin: r.explicit ? "graph" : "learned" };
      const prior = currentEdges.get(id);
      if (!prior || edge.strength > prior.strength || (edge.strength === prior.strength && edge.createdAt > prior.createdAt)) {
        currentEdges.set(id, edge);
      }
    }
    for (const r of members as any[]) {
      if (!r.invited_by) continue;
      const invitee = s.members.get(r.id);
      if (!invitee?.joined || !s.members.has(r.invited_by)) continue;
      const id = edgeId("invited_by", r.invited_by, r.id);
      const edge: ObsEdge = { id, from: r.invited_by, to: r.id, type: "invited_by",
        strength: 0.7, createdAt: ms(r.joined_at) ?? 0, origin: "graph" };
      const prior = currentEdges.get(id);
      if (!prior || edge.strength > prior.strength || (edge.strength === prior.strength && edge.createdAt > prior.createdAt)) {
        currentEdges.set(id, edge);
      }
    }
    s.replaceEdges(currentEdges);
    const receipts = new Map<string, BookingReceiptView[]>();
    for (const receipt of bookedMsgs) {
      const group = receipts.get(receipt.opportunity_id) ?? [];
      group.push(receipt);
      receipts.set(receipt.opportunity_id, group);
    }
    const times = new Map<string, NonNullable<ObsOpportunity["times"]>>(), cancelled = new Map<string, BookedPlan["cancelled"]>();
    for (const e of picksEv as any[]) {
      const p = e.payload ?? {}, opp = p.oppId as string | undefined, id = p.memberId as string | undefined;
      if (!opp || !id) continue;
      if (e.type === "booked_cancelled") cancelled.set(opp, { ...cancelled.get(opp), [id]: { at: ms(e.at) ?? 0, told: !!p.told } });
      else if (Array.isArray(p.picked)) times.set(opp, { ...times.get(opp), [id]: { offered: [], picked: p.picked.map(String) } });
    }
    const venueById = new Map<string, NonNullable<ObsOpportunity["venue"]>>();
    for (const v of ALL_SEED_VENUES) {
      venueById.set(v.id, {
        id: v.id, name: v.name, lat: v.lat, lng: v.lng, neighborhood: v.neighborhood,
        ...(v.arrivalLandmark ? { arrivalLandmark: v.arrivalLandmark } : {}),
        status: v.status, category: v.category, priceTier: v.priceTier,
      });
    }
    for (const v of (dbVenues as any[] | null) ?? []) {
      venueById.set(String(v.id), {
        id: String(v.id), name: String(v.name), lat: Number(v.lat), lng: Number(v.lon),
        neighborhood: v.neighborhood ? String(v.neighborhood) : undefined,
        ...(v.arrival_landmark ? { arrivalLandmark: String(v.arrival_landmark) } : {}),
        status: toCoreVenueStatus(v.status), category: String(v.category), priceTier: Number(v.price_tier) as VenuePriceTier,
      });
    }
    const venueEvByOpp = new Map<string, NonNullable<ObsOpportunity["venue"]>>();
    for (const e of venueEvs as any[]) {
      const p = e.payload ?? {};
      const oppId = (p.oppId ?? e.object_id) as string | undefined;
      const lat = Number(p.lat), lng = Number(p.lng ?? p.lon);
      if (oppId && typeof p.venue === "string" && Number.isFinite(lat) && Number.isFinite(lng)) {
        venueEvByOpp.set(oppId, {
          ...(typeof p.venueId === "string" ? { id: p.venueId } : {}),
          name: p.venue, lat, lng,
          ...(typeof p.neighborhood === "string" ? { neighborhood: p.neighborhood } : {}),
        });
      }
    }
    for (const r of opps as any[]) {
      const ps = partsBy.get(r.id) ?? [];
      const participants = ps.filter(p => p.role === "participant").map(p => p.member_id);
      const primaryVenue = (r.venue_id ? venueById.get(String(r.venue_id)) : undefined) ?? venueEvByOpp.get(r.id);
      const backupRaw = r.backup_venue_id ? venueById.get(String(r.backup_venue_id)) : undefined;
      const backupVenue = backupRaw ? {
        id: backupRaw.id, name: backupRaw.name, lat: backupRaw.lat, lng: backupRaw.lng,
        ...(backupRaw.neighborhood ? { neighborhood: backupRaw.neighborhood } : {}),
        ...(backupRaw.arrivalLandmark ? { arrivalLandmark: backupRaw.arrivalLandmark } : {}),
        ...(backupRaw.status ? { status: backupRaw.status } : {}),
      } : undefined;
      const workIntroChannel = toCoreWorkIntroChannel(r.work_intro_channel);
      const citySpec = isCity(r.city) ? getCity(r.city) : undefined;
      const domain = inferDomain({ app, category: r.category ?? undefined, generator: r.generator ?? r.source, workIntroChannel });
      const o: ObsOpportunity = {
        id: r.id, kind: r.kind, source: r.source, generator: r.generator ?? r.source, category: r.category ?? undefined, city: r.city, domain, sourceApp: app,
        objective: scrubText(r.objective, this.reveal), score: r.score ?? 0, components: r.components ?? undefined,
        explanations: Object.fromEntries(Object.entries(r.explanations ?? {}).map(([k, v]) => [k, scrubText(String(v), this.reveal)])),
        exploration: r.exploration, participants, alternates: ps.filter(p => p.role === "alternate").map(p => p.member_id),
        state: r.state, reason: r.reason ?? undefined,
        status: Object.fromEntries(ps.filter(p => p.role === "participant").map(p => [p.member_id, p.status])),
        enjoyment: Object.fromEntries(ps.flatMap(p => p.status === "attended" && p.enjoyment !== null ? [[p.member_id, p.enjoyment] as const] : [])),
        createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0, meetingAt: ms(r.meeting_at), runId: r.run_id ?? undefined,
        ...(primaryVenue ? { venue: primaryVenue } : {}),
        ...(backupVenue ? { backupVenue } : {}),
        ...(workIntroChannel ? { workIntroChannel } : {}),
        ...(citySpec ? { cityInfo: { name: citySpec.name, shortName: citySpec.shortName, tz: citySpec.tz } } : {}),
      };
      const rv = reviewBy.get(r.id);
      if (rv) {
        o.review = this.reviewOf(rv);
        o.origin = rv.origin ?? undefined;
      }
      if (times.has(r.id)) o.times = times.get(r.id);
      const told: BookedPlan["told"] = {};
      for (const receipt of receipts.get(o.id) ?? []) {
        const receivedAt = ms(receipt.received_at) ?? -1;
        if (consoleBookingReceiptCurrent(receipt.app_id === app && ms(receipt.booking_at) === o.meetingAt,
          o.participants.includes(receipt.member_id), true, receivedAt, s.clock.now)) told[receipt.member_id] = receivedAt;
      }
      const calledOff = cancelled.get(o.id);
      if (o.meetingAt !== undefined && (Object.keys(told).length || calledOff)) {
        o.booked = { at: o.meetingAt, optOutHours: confirmationWindowHours, told, cancelled: calledOff ?? {} };
      }
      upsertIfChanged(s.opps, o, x => s.upsertOpp(x));
    }
    const dbOpps = new Set((opps as any[]).map(r => r.id as string));
    for (const o of [...s.opps.values()]) if (o.source !== "shadow" && !dbOpps.has(o.id)) s.removeOpp(o.id);
    const dbRuns = runs.map(r => storedRunSummary(r.summary)).reverse();
    const allRuns = [...dbRuns, ...this.shadowRuns];
    if (JSON.stringify(allRuns.map(r => r.id)) !== JSON.stringify(s.runs.map(r => r.id))) { s.runs.length = 0; for (const r of allRuns) s.addRun(r); }

    const c = zeroCounts();
    c.messages = t.messages; c.inbound = t.inbound; c.outbound = t.outbound; c.proactive = t.proactive; c.invites = t.invites;
    c.meetingsScheduled = t.meetings_scheduled; c.blocks = t.blocks; c.adversarialAttempts = t.adversarial; c.invariantViolations = t.invariants;
    for (const o of s.opps.values()) {
      if (o.source === "shadow") continue;
      const held = HELD.includes(o.state) && observatoryMeetingHeld(o.participants.filter(id => o.status[id] === "attended").length);
      if (held) c.meetingsHeld++;
      for (const id of o.participants) {
        const st = o.status[id];
        if (countsAsAcceptance(st)) c.accepts++;
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

  private async ageInfo(sql: SQL): Promise<AgeInfo> {
    const info: AgeInfo = { latest: new Map(), changes: new Map(), optIns: new Map(), teenHistory: new Map(), flags: new Map() };
    const [st, ev] = await Promise.all([
      this.stateRow("members"),
      sql`select at, type, payload from network.events where app_id = ${this.app} and type = any(${`{${[...AGE_EVENTS, ...TEEN_EVENTS, "calendar_consent", "weekly_checkin_consent"].join(",")}}`}::text[]) order by at, id`,
    ]);
    for (const e of ev as any[]) {
      const id = e.payload?.memberId as string | undefined;
      if (!id) continue;
      if (e.type === "calendar_consent" || e.type === "weekly_checkin_consent") {
        info.optIns.set(id, { ...info.optIns.get(id), [e.type === "calendar_consent" ? "calendar" : "weekly"]: e.payload.on !== false });
        continue;
      }
      const kind = teenEventKind(e.type, e.payload?.action);
      if (kind) info.teenHistory.set(id, [...(info.teenHistory.get(id) ?? []), { at: ms(e.at) ?? 0, kind }]);
      if (!AGE_EVENTS.includes(e.type)) continue;
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
      info.latest.set(m.id, { minor: m.minor !== false, unknown: !!m.ageUnknown });
      info.flags.set(m.id, { minorSignal: m.minorSignal === true, minorReported: m.minorReported === true, olderReported: m.olderReported === true, ageConflict: m.ageConflict === true, ageUnknown: m.ageUnknown === true });
      if (m.calendar !== undefined || m.weekly !== undefined) info.optIns.set(m.id, { calendar: !!m.calendar, weekly: !!m.weekly });
    }
    return info;
  }

  private async minorContacts(sql: SQL, rows: { member_id: string; ts: Date | string; opportunity_id: string | null; type?: string | null; body?: string | null }[]): Promise<{ n: number; teenProblem?: string }> {
    const counted: { t: number; memberId: string; body: string; type: string | null; o?: ObsOpportunity; scopeNotice?: true }[] = [];
    for (const r of rows) {
      const t = ms(r.ts) ?? 0;
      const minor = (id: string) => minorAt(this.ages, id, this.recordAges.get(id), t);
      const o = r.opportunity_id ? this.store.opps.get(r.opportunity_id) : undefined;
      const who = new Set([r.member_id, ...(o && o.source !== "shadow" ? o.participants : [])]);
      const row = { t, memberId: r.member_id, body: r.body ?? "", type: r.type ?? null, ...(o && o.source !== "shadow" ? { o } : {}) };
      if ((r.opportunity_id || r.type === "probe") && [...who].some(minor)) { counted.push(row); continue; }
      if (minor(r.member_id) && (CONNECT_TYPES.has(r.type ?? "") || offersConnection(r.body ?? ""))) counted.push(CONNECT_TYPES.has(r.type ?? "") ? row : { ...row, scopeNotice: true });
    }
    const teenItem = (o?: ObsOpportunity): o is ObsOpportunity => !!o && o.category !== undefined && teenFriendCategory(this.app, o.category) && teenGenerator(this.app, o.generator);
    if (!counted.some(c => teenItem(c.o) || c.scopeNotice)) return { n: counted.length };
    const evidence = await this.teenEvidence(sql);
    const held = new Set<string>();
    let n = 0;
    for (const c of [...counted].sort((a, b) => a.t - b.t)) {
      if (c.scopeNotice && teenScopeNoticeAt(evidence, c.memberId, c.body, c.t, [...this.firstNames].flatMap(([id, name]) => id === c.memberId || name.toLowerCase() === this.firstNames.get(c.memberId)?.toLowerCase() ? [] : [name]))) continue;
      if (!teenItem(c.o)) { n++; continue; }
      const roster = [...new Set([...c.o.participants, ...c.o.alternates, c.memberId])];
      const until = teenMeetingEndOf(c.o.meetingAt !== undefined ? { meetingAt: c.o.meetingAt } : {}, c.t);
      if (await teenRuleHeldAt(evidence, sql, c.o.id, roster, c.o.category, c.t, until)) { held.add(c.o.id); continue; }
      const others = roster.filter(id => id !== c.memberId).flatMap(id => this.firstNames.get(id) ?? []);
      if (held.has(c.o.id) && teenNoticeNamesNobody(c.body, c.type, others)) continue;
      n++;
    }
    return { n, ...(evidence.problem !== undefined ? { teenProblem: evidence.problem } : {}) };
  }

  private async teenEvidence(sql: SQL): Promise<TeenEvidence> {
    const app = this.app;
    let events: { at: Date | string; payload: unknown }[], snap: WorldSnapshot;
    try {
      [events, snap] = await Promise.all([
        sql<{ at: Date | string; payload: unknown }[]>`select at, payload from network.events where app_id = ${app} and type = 'teen_intros_switch' order by at, id`,
        this.snapshot(),
      ]);
    } catch (e) {
      return { app, readable: false, problem: (e as Error).message, switches: [], members: new Map(), history: new Map() };
    }
    const detail = (d: unknown) => (typeof d === "string" ? JSON.parse(d) : d ?? {}) as Record<string, unknown>;
    const switches: TeenSwitchRow[] = events.map(r => ({ at: ms(r.at) ?? 0, on: detail(r.payload).on === true }));
    const members = new Map<string, TeenAgeRow>();
    for (const m of snap.members) {
      const f = this.ages.flags.get(m.id);
      members.set(m.id, {
        ...(m.birthKey !== undefined ? { birthKey: m.birthKey } : {}), birthExact: m.birthExact === true,
        ageConflict: m.ageConflict === true || f?.ageConflict === true || f?.ageUnknown === true,
        teenBarred: m.teenBarred === true,
        minorSignal: f?.minorSignal === true, minorReported: f?.minorReported === true, olderReported: f?.olderReported === true,
      });
    }
    return { app, readable: true, switches, members, history: this.ages.teenHistory };
  }

  private async loadNetwork(sql: SQL) {
    const s = this.store;
    const app = this.app;
    const now = this.store.clock.now, since = new Date(now - ALERT_WINDOW);
    const [st, reqs, msgs, ev24, evAll, contacts, lastRun, expired, service, survey] = await Promise.all([
      this.stateRow("saved_at, matching_enabled as matching, deferred, trust, counters, gate_reasons as gate"),
      sql`select id, member_id, kind, category, desire_id, outcome, tries, opportunity_id, created_at, fulfilled_at from network.requests where app_id = ${app} order by created_at desc`.catch(() => []),
      sql`select member_id, ts, direction, proactive, status from network.messages where app_id = ${app} and not system`,
      sql`select type, payload->>'reason' as reason, count(*)::int as n from network.events where app_id = ${app} and at >= ${since} and type in ('send_refused', 'guard_blocked') group by 1, 2`,
      sql`select type, actor_id, at, payload->>'from' as inviter, payload->>'newMemberId' as invitee, payload->>'rule' as rule from network.events
          where app_id = ${app} and type in ('invite', 'growth_ask', 'invariant_violation')`,
      // Messages about an opportunity that went out (or would have, dry-run): not refused, held or blocked.
      // Every message that went out (or would have, dry-run): not refused, held or blocked. The text is read
      // here only to apply the judge's connection-offer rule; it never leaves this function.
      sql<{ member_id: string; ts: Date | string; opportunity_id: string | null; type: string | null; body: string | null }[]>`select member_id, ts, opportunity_id, type, body from network.messages
          where app_id = ${app} and direction = 'outbound' and not system and status !~ '^(refused|suppressed|blocked|parked|held)'`,
      sql<{ at: Date | string | null }[]>`select max(at) as at from network.matching_runs where app_id = ${app}`,
      sql`select count(*)::int as n from network.review_items where app_id = ${app} and decision = 'expired' and decided_at >= ${since}`.catch(() => [{ n: 0 }]),
      this.service?.health(),
      sql<{ yes: number; total: number }[]>`select count(*) filter(where payload->>'worthwhile'='true')::int as yes,count(*)::int as total
        from network.events where app_id=${app} and type='interruption_feedback' and payload->>'worthwhile' in ('true','false')`,
    ]);
    this.serviceMatchingAllowed = service && !("error" in service) ? service.matchingAllowed : undefined;
    const row = (st as any[])[0];
    if (row) {
      const trust = new Map<string, "ok" | "watch" | "hold">(((typeof row.trust === "string" ? JSON.parse(row.trust) : row.trust) ?? []).map((t: any) => [t.id, t.level]));
      const counters = (typeof row.counters === "string" ? JSON.parse(row.counters) : row.counters) ?? {};
      const gate = (typeof row.gate === "string" ? JSON.parse(row.gate) : row.gate) ?? {};
      const open = [...s.opps.values()].filter(o => o.state === "IN_REVIEW").length;
      const reqRows = reqs as any[];
      const info: NetworkInfo = {
        kind: "consent", counters, gateReasons: gate, matchingEnabled: row.matching !== false,
        review: { queued: open, approved: counters.reviewApproved ?? 0, rejected: counters.reviewRejected ?? 0, expired: counters.reviewExpired ?? 0 },
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
    const requests: ObsRequest[] = (reqs as any[]).filter(r => s.members.has(r.member_id)).map(r => {
      const at = ms(r.created_at) ?? 0, done = ms(r.fulfilled_at);
      return {
        id: r.id, memberId: r.member_id, kind: r.kind, category: r.category ?? "social", label: requestLabel({ kind: r.kind, desireId: r.desire_id, category: r.category }),
        outcome: r.outcome ?? "open", tries: r.tries ?? 0, openedAt: at, ageHours: hours(now - at),
        domain: inferDomain({ app, category: r.category ?? "social" }),
        ...(done !== undefined ? { fulfilledAt: done, hoursToFulfil: hours(done - at) } : {}), ...(r.opportunity_id ? { opportunityId: r.opportunity_id } : {}),
      };
    });
    s.setRequests(requests);
    const refusals: Record<string, number> = {};
    let guardBlocked = 0;
    for (const r of ev24 as any[]) { if (r.type === "guard_blocked") guardBlocked += r.n; else refusals[r.reason ?? "unknown"] = (refusals[r.reason ?? "unknown"] ?? 0) + r.n; }
    const opps = [...s.opps.values()].filter(o => o.source !== "shadow");
    const all = evAll as any[];
    const leaks = all.filter(e => e.type === "invariant_violation" && /leak|canary/i.test(e.rule ?? "")).length;
    const { n: minorContacts, teenProblem } = await this.minorContacts(sql, contacts);
    const teenAlert: HealthAlert[] = teenProblem === undefined ? [] : [{ level: "bad", key: "teen_evidence_unreadable", count: 1,
      text: `Teen evidence unreadable: ${teenProblem}. Every teen friendship contact counts as a minor contact until it can be read.` }];
    const alerts = healthAlerts({
      now, start: this.store.clock.start, reviewOpen: opps.filter(o => o.state === "IN_REVIEW" && o.review?.exceptionReason).map(o => ({ deadline: o.review!.deadline, queuedAt: o.review!.queuedAt })),
      sla: { app: this.app, hours: slaHours()[this.app] }, matchingLocked: this.serviceMatchingAllowed === false,
      reviewExpired: (expired as any[])[0]?.n ?? 0, deferred: this.netState?.deferred ?? null, refusals, guardBlocked,
      lastEngineRun: ms(lastRun[0]?.at), expectEngine: !!this.netState || s.runs.some(r => !r.shadow), matchingEnabled: this.netState?.matchingEnabled ?? false,
      invariants: s.counts.invariantViolations, canaryLeaks: leaks, minorContacts,
      extra: [...teenAlert, ...(service ? serviceAlerts(service, Date.now()) : [])],
    });
    // Scorecard and growth.
    const inviteRows = all.filter(e => e.type === "invite");
    const inviters = new Set(inviteRows.map(e => e.inviter).filter(Boolean)).size;
    const invitees = new Set<string>(inviteRows.length ? inviteRows.map(e => e.invitee).filter(Boolean) : [...s.members.values()].filter(m => m.invitedBy).map(m => m.id));
    const members = [...s.members.values()];
    const messages: MsgMeta[] = (msgs as any[]).map(m => ({ memberId: m.member_id, ts: ms(m.ts) ?? 0, direction: m.direction, proactive: m.proactive, status: m.status }));
    const card = scorecard({
      now, start: this.store.clock.start, members, opps, messages, requests, invites: s.counts.invites, accepts: s.counts.accepts,
      reviewSeconds: opps.reduce((a, o) => a + (o.review?.secondsSpent ?? 0), 0), sentProposals: opps.filter(o => o.review?.decision === "approve" && !o.review.invalidated).length,
      inviters, minorContacts, leaks, worthwhileAnswers: survey[0] ?? { yes: 0, total: 0 },
    });
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
      const appDom = APP_TO_DOMAIN[this.app];
      const net = NET_FEED[e.type];
      if (net) {
        const d = describe(e as EventRow, x => nm(x));
        this.store.pushFeed({ t: ms(e.at) ?? 0, kind: net, text: d.text, severity: d.severity, members: d.memberId ? [d.memberId] : ids.length ? ids : undefined, opportunityId: e.object_type === "opportunity" ? e.object_id : undefined, ...(appDom ? { domain: appDom } : {}) });
        continue;
      }
      const m = map[e.type];
      if (!m) continue;
      this.store.pushFeed({ t: ms(e.at) ?? 0, kind: m[0], text: m[1], severity: m[2], members: ids.length ? ids : undefined, opportunityId: e.object_type === "opportunity" ? e.object_id : undefined, ...(appDom ? { domain: appDom } : {}) });
    }
  }

  async member(id: string, opts: ViewOptions = {}): Promise<MemberDetail | undefined> {
    const m = this.store.member(id);
    if (!m || !this.sql) return undefined;
    const sql = this.sql;
    const rv = this.reveal || !!opts.reveal;
    const [prof, facets, intents, presence, messages] = await Promise.all([
      sql`select name, bio, occupation, home_area from network.members where app_id = ${this.app} and id = ${id}`,
      sql`select * from network.facets where app_id = ${this.app} and member_id = ${id} order by kind, id`,
      sql`select * from network.intents where app_id = ${this.app} and member_id = ${id} order by created_at`,
      sql`select * from network.presence where app_id = ${this.app} and member_id = ${id}`,
      this.messages(id, rv, "member", opts.historyBefore?.messages),
    ]);
    const evidence = await this.deliveryEvidence(messages.rows);
    const p = (prof as any[])[0] ?? {};
    return {
      member: rv && p.name ? { ...m, name: p.name } : m,
      profile: { bio: p.bio ? scrubText(p.bio, rv) : undefined, occupation: p.occupation ?? undefined, neighborhood: p.home_area ?? undefined },
      facets: memberFacets(this.app, (facets as any[]).map(facetOf), rv).map(f => scrubFacet(f, rv)),
      intents: (intents as any[]).map(i => ({ ...intentOf(i), objective: scrubText(i.objective, rv), details: i.details ? scrubText(i.details, rv) : undefined, desiredPeople: i.desired_people ? scrubText(i.desired_people, rv) : undefined })),
      presence: (presence as any[]).map(presenceOf),
      edges: [...this.store.edges.values()].filter(e => e.from === id || e.to === id),
      opportunities: [...this.store.opps.values()].filter(o => o.participants.includes(id)).sort((a, b) => b.createdAt - a.createdAt),
      messages: messages.rows.map(r => this.messageOf(r, rv, evidence.get(r.id))),
      ...(messages.before ? { historyBefore: { messages: messages.before } } : {}),
    };
  }

  /** A member's messages. Unless revealed, inbound bodies are not selected at all (only their length). */
  private async messages(id: string, rv: boolean, scope: "member" | "opportunity", before?: HistoryCursor) {
    const sql = this.sql!;
    return historyPage(await sql<MessageHistoryRow[]>`select id, member_id, ts, direction, status, type, opportunity_id, proactive, system,
      to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as history_at,
      ${rv ? sql`body` : sql`case when direction = 'inbound' then null else body end as body, length(body)::int as body_len`}
      from network.messages where app_id = ${this.app}
      and ${scope === "member" ? sql`member_id = ${id}` : sql`opportunity_id = ${id}`}
      ${before ? sql`and (ts, id) < (${before.at}::timestamptz, ${before.id})` : sql``}
      order by ts desc, id desc limit ${staffHistoryPageSize(false) + 1}`);
  }

  private async deliveryEvidence(messages: MessageEvidenceKey[]): Promise<Map<string, DeliveryEvidence>> {
    const sql = this.sql;
    const ids = messages.filter(row => row.direction === "outbound" && !row.system).map(row => row.id);
    if (!sql || !ids.length) return new Map();
    const rows = await sql<DeliveryEvidence[]>`select app_id,member_id,message_id,status,reason,leak_stopped,staff_released,attempted
      from network.${sql(`outbound_evidence_${this.app}`)} where app_id=${this.app} and message_id in ${sql(ids)}`;
    return new Map(rows.map(row => [row.message_id, row]));
  }

  async timeline(id: string, opts: ViewOptions = {}): Promise<MemberTimeline | undefined> {
    const m = this.store.member(id);
    if (!m || !this.sql) return undefined;
    const sql = this.sql;
    const rv = this.reveal || !!opts.reveal;
    const theirs = new Set([...this.store.opps.values()].filter(o => o.source !== "shadow" && o.participants.includes(id)).map(o => o.id));
    // Include every member reference that onTimeline may use, including members replaced in earlier rosters.
    const before = opts.historyBefore?.events;
    const [messages, rows, pending] = await Promise.all([
      this.messages(id, rv, "member", opts.historyBefore?.messages),
      sql<EventHistoryRow[]>`select id::text as id, at, actor_type, actor_id, type, object_type, object_id, payload,
          to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as history_at from network.events
          where app_id = ${this.app} and (actor_id = ${id} or object_id = ${id}
             or ${id} in (payload->>'memberId', payload->>'from', payload->>'newMemberId', payload->>'out', payload->>'in', payload->>'target', payload->>'by')
             or payload->'participants' ? ${id} or payload->'members' ? ${id} or payload->'attendance' ? ${id}
             or (object_type = 'opportunity' and object_id = any(${sql.array([...theirs], "text")})))
          ${before ? sql`and (at, network.events.id) < (${before.at}::timestamptz, ${before.id}::bigint)` : sql``}
          order by at desc, network.events.id desc limit ${staffHistoryPageSize(true) + 1}`,
      this.stateRow("deferred_sends").then(rows => rows.map(r => ({ d: (typeof r.deferred_sends === "string" ? JSON.parse(r.deferred_sends) : r.deferred_sends ?? []).filter((x: any) => x?.memberId === id) }))),
    ]);
    const events = historyPage(rows, true);
    const evidence = await this.deliveryEvidence(messages.rows);
    const name = (x: string) => this.store.member(x)?.name ?? x;
    const entries: TimelineEntry[] = [
      ...messages.rows.map((r): TimelineEntry => { const message = this.messageOf(r, rv, evidence.get(r.id)); return { t: message.ts, kind: "message", message }; }),
      ...events.rows.filter(e => onTimeline(e, id, theirs)).map((e): TimelineEntry => ({ t: ms(e.at as Date | string) ?? 0, kind: "event", event: describe(e, name) })),
    ];
    entries.sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
    const d = (pending as any[])[0]?.d;
    const list = (typeof d === "string" ? JSON.parse(d) : d) ?? [];
    return {
      memberId: id, entries,
      ...(messages.before || events.before ? { historyBefore: { messages: messages.before, events: events.before } } : {}),
      pending: (list as any[]).map(x => ({ kind: String(x.kind), ...(x.type ? { type: x.type } : {}), ...(x.proposalId ? { opportunityId: x.proposalId } : {}) })),
    };
  }

  private messageOf(r: any, rv = this.reveal, evidence?: DeliveryEvidence): ObsMessage {
    const hidden = r.direction === "inbound" && !rv;
    const ts = ms(r.ts) ?? 0;
    const { guard, status, withheld, reason } = deliveryOf(this.app, r, evidence);
    const body = withheld ? "[outbound message withheld]" : hidden ? HIDDEN_MESSAGE : scrubText(r.body ?? "", rv);
    return {
      id: r.id, ts, direction: r.direction, body, status,
      type: r.type ?? undefined, proposalId: r.opportunity_id ?? undefined, proactive: r.proactive, system: r.system,
      ...(hidden ? { hiddenLength: r.body_len ?? 0 } : {}), ...(guard ? { guard } : {}), ...(reason ? { deliveryReason: reason } : {}),
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
      ...(r.approver === "judge" || r.approver === "staff" ? { approver: r.approver } : {}),
      ...(typeof r.exception_reason === "string" && r.exception_reason ? { exceptionReason: r.exception_reason } : {}),
      ...((JUDGE_VERDICTS as readonly unknown[]).includes(r.judge_verdict) ? { judgeVerdict: r.judge_verdict } : {}),
      ...(typeof r.judge_explanation === "string" && r.judge_explanation ? { judgeExplanation: scrubText(r.judge_explanation.slice(0, 1200), this.reveal) } : {}),
    };
  }

  async opportunity(id: string, opts: ViewOptions = {}): Promise<OpportunityDetail | undefined> {
    const o = this.store.opps.get(id);
    if (!o) return undefined;
    const sql = o.source !== "shadow" ? this.sql : undefined;
    const before = opts.historyBefore?.events;
    const [messages, rows] = sql ? await Promise.all([
      this.messages(id, this.reveal, "opportunity", opts.historyBefore?.messages),
      sql<EventHistoryRow[]>`select id::text as id, at, actor_type, actor_id, type, object_type, object_id, payload,
        to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as history_at from network.events
        where app_id = ${this.app} and object_type = 'opportunity' and object_id = ${id}
        ${before ? sql`and (at, network.events.id) < (${before.at}::timestamptz, ${before.id}::bigint)` : sql``}
        order by at desc, network.events.id desc limit ${staffHistoryPageSize(false) + 1}`,
    ]) : [{ rows: [] as MessageHistoryRow[], before: undefined }, []];
    const events = historyPage(rows);
    const evidence = await this.deliveryEvidence(messages.rows);
    const name = (x: string) => this.store.member(x)?.name ?? x;
    return {
      opportunity: o, members: o.participants.map(x => this.store.member(x)!).filter(Boolean),
      messages: messages.rows.map(r => ({ ...this.messageOf(r, this.reveal, evidence.get(r.id)), memberId: r.member_id })),
      run: o.runId ? this.store.runs.find(r => r.id === o.runId) : undefined,
      events: events.rows.map(e => describe(e, name)),
      ...(messages.before || events.before ? { historyBefore: { messages: messages.before, events: events.before } } : {}),
    };
  }

  inOpenReview(memberId: string): boolean {
    for (const o of this.store.opps.values()) if (o.state === "IN_REVIEW" && o.review?.exceptionReason && o.participants.includes(memberId)) return true;
    return false;
  }

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
    const fromService = this.service ? await this.service.reports() : undefined;
    const reports = fromService && !("error" in fromService) ? fromService.filter(r => this.store.members.has(r.subjectId)) : reportsFromCases(cases, opps);
    return safetyInfo({
      now, cases, members, opps, canAct: !!this.service, canBan: !!this.service, reports,
      watch: [...trust].filter(([, l]) => l === "watch").map(([id]) => id), hold: [...trust].filter(([, l]) => l === "hold").map(([id]) => id),
    });
  }

  async photos(memberId: string, actor: string, reason: string): Promise<{ ok: true; photos: MemberPhoto[] } | ControlResult> {
    if (!this.service) return { ok: false, code: "service_missing", error: "photos are kept by the Network service: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN" };
    return this.service.photos(actor, memberId, reason);
  }

  async bias(actor: string): Promise<{ ok: true; reports: BiasReportView[] } | { ok: false; error: string }> {
    if (!this.service) return { ok: false, error: "the bias monitor runs in the Network service: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN" };
    return this.service.bias(actor);
  }

  async held(queue: HeldQueue, actor: string): Promise<{ ok: true; items: HeldText[] } | { ok: false; code: string; error: string }> {
    if (!this.service) return { ok: false, code: "not_available", error: "held texts are kept by the Network service: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN" };
    const r = await this.service.held(actor, queue);
    if (!r.ok) return r;
    const minors = new Set(this.state().members.filter(m => m.minor || m.ageUnknown).map(m => m.id));
    return { ok: true, items: r.items.map(x => (x.memberId && minors.has(x.memberId) && x.text !== undefined ? (({ text: _t, ...rest }) => ({ ...rest, textHidden: "minor" as const }))(x) : x)) };
  }

  async heldPhoto(id:string,actor:string,reason:string):Promise<Response> {
    if(!this.service)return Response.json({error:"The Network photo service is unavailable."},{status:404});
    return this.service.heldPhoto(actor,id,reason);
  }

  async heldDecision(queue: HeldQueue, id: string, decision: "release" | "reject", reason: string, actor: string, photoReviewToken?:string): Promise<ControlResult> {
    if (!this.service) return { ok: false, error: "real-world mode is read-only: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN to act through the Network service", code: "read_only" };
    return this.afterAction(await this.service.heldDecision(actor, queue, id, decision, reason, photoReviewToken));
  }

  async safetyAction(a: SafetyAction, actor: string): Promise<ControlResult> {
    if (!this.service) return { ok: false, error: "real-world mode is read-only: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN to act through the Network service", code: "read_only" };
    return this.afterAction(await this.service.safety(actor, a));
  }

  staffStepForward(): StaffStepForward | undefined {
    const service = this.service;
    return service ? (actor, method, path, body) => service.staffStep(actor, method, path, body) : undefined;
  }

  get gatheringServiceAvailable() { return this.service !== undefined; }

  monthlyGatherings(actor: string, request: GatheringRequest) {
    return this.service?.monthlyGatherings(actor, request);
  }

  reviewPlanPreview(actor: string, id: string, revision: number) {
    return this.service?.reviewPlanPreview(actor, id, revision);
  }

  reviewProbePreview(actor: string, id: string, revision: number) {
    return this.service?.reviewProbePreview(actor, id, revision);
  }

  private async afterAction(r: ControlResult): Promise<ControlResult> {
    await this.loading; await this.reload(); this.push();
    return r;
  }

  async config(): Promise<ConfigInfo> {
    const sql = this.sql;
    const rows = sql ? await sql`select at, actor_id, type, payload from network.events where app_id = ${this.app} and type = 'matching_switch' order by at, id` : [];
    const history: ConfigChange[] = [];
    let last = true;
    for (const r of rows as any[]) {
      const to = !!r.payload?.on;
      if (last === to) continue;
      history.push({ version: history.length + 1, at: ms(r.at) ?? 0, actor: String(r.payload?.actor ?? r.actor_id ?? "unknown"), key: "matching", from: last, to });
      last = to;
    }
    const now = this.store.clock.now;
    const open = [...this.store.opps.values()].filter(o => o.state === "IN_REVIEW" && o.review);
    const held = open.filter(o => o.review!.exceptionReason);
    return {
      matchingEnabled: this.netState?.matchingEnabled ?? false, network: {},
      reviewJudge: this.netState ? { awaiting: open.length - held.length, exceptions: held.length, exceptionsOverdue: held.filter(o => now >= o.review!.deadline).length } : null,
      outreach: JSON.parse(JSON.stringify(OUTREACH)), history, canChange: !!this.service,
    };
  }

  async search(q: string, limit = 100): Promise<SearchHit[]> {
    const sql = this.sql;
    if (!sql || limit <= 0) return [];
    const re = searchPattern(q);
    const like = `%${q.trim().replace(/[\\%_]/g, x => `\\${x}`)}%`;
    const batch = Math.max(100, Math.min(limit, 250));
    const name = (id: string) => this.store.member(id)?.name ?? id;
    type Cursor = { id: string; cursor_at: string };
    type MessageRow = MessageEvidenceKey & Cursor & { ts: Date; body: string; type: string | null; opportunity_id: string | null };

    // Read bounded pages in database order. Apply the result limit after the visibility and scrub checks.
    const collect = async <Row extends Cursor>(
      page: (before?: Cursor) => Promise<Row[]>,
      project: (rows: Row[]) => SearchHit[] | Promise<SearchHit[]>,
    ): Promise<SearchHit[]> => {
      const hits: SearchHit[] = [];
      let before: Cursor | undefined;
      while (hits.length < limit) {
        const rows = await page(before);
        hits.push(...await project(rows));
        if (rows.length < batch) break;
        before = rows.at(-1);
      }
      return hits.slice(0, limit);
    };
    const [messages, events] = await Promise.all([
      collect(
        before => sql<MessageRow[]>`select id, member_id, ts, ts::text as cursor_at, direction, status, system, body, type, opportunity_id
          from network.messages where app_id = ${this.app} and direction = 'outbound' and not system and coalesce(type, '') <> 'relay' and body ilike ${like}
          ${before ? sql`and (ts, id) < (${before.cursor_at}::timestamptz, ${before.id})` : sql``}
          order by ts desc, id desc limit ${batch}`,
        async rows => {
          const evidence = await this.deliveryEvidence(rows);
          const hits: SearchHit[] = [];
          for (const row of rows) {
            const readable = !deliveryOf(this.app, row, evidence.get(row.id)).withheld;
            if (!readable || !this.store.members.has(row.member_id)) continue;
            const rendered = scrubText(row.body, this.reveal);
            if (!staffSearchHitVisible(readable, re.test(rendered))) continue;
            hits.push({ memberId: row.member_id, memberName: name(row.member_id), t: ms(row.ts) ?? 0,
              kind: "message", snippet: snippet(rendered, re), ...(row.type ? { type: row.type } : {}),
              ...(row.opportunity_id ? { opportunityId: row.opportunity_id } : {}) });
          }
          return hits;
        },
      ),
      collect(
        before => sql<(EventRow & Cursor)[]>`select e.id::text as id, e.at, e.at::text as cursor_at, e.actor_type, e.actor_id, e.type, e.object_type, e.object_id, e.payload
          from network.events e where e.app_id = ${this.app} and e.type <> 'feedback_given'
          ${before ? sql`and (e.at, e.id) < (${before.cursor_at}::timestamptz, ${before.id}::bigint)` : sql``}
          order by e.at desc, e.id desc limit ${batch}`,
        rows => {
          const hits: SearchHit[] = [];
          for (const row of rows) {
            const d = describe(row, name);
            if (!d.memberId || !staffSearchHitVisible(this.store.members.has(d.memberId), re.test(d.text) || re.test(d.type))) continue;
            hits.push({ memberId: d.memberId, memberName: name(d.memberId), t: d.t, kind: "event", snippet: d.text,
              type: d.type, ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}) });
          }
          return hits;
        },
      ),
    ]);
    return [...messages, ...events].sort((a, b) => b.t - a.t).slice(0, limit);
  }

  async loadVenues(city?: City): Promise<ObsVenue[]> {
    const sql = this.sql;
    if (sql) {
      const rows = await (city
        ? sql`select id, city, neighborhood, name, address, lat, lon, category, price_tier, status, yelp_rating, yelp_review_count,
                     group_score, date_score, visit_count, overall_likes, overall_dislikes, closure_reports, arrival_landmark,
                     persona_priors, persona_stats, source, verified_open_at
              from platform.venues where city = ${city} order by group_score desc, name asc`
        : sql`select id, city, neighborhood, name, address, lat, lon, category, price_tier, status, yelp_rating, yelp_review_count,
                     group_score, date_score, visit_count, overall_likes, overall_dislikes, closure_reports, arrival_landmark,
                     persona_priors, persona_stats, source, verified_open_at
              from platform.venues order by city asc, group_score desc, name asc`
      ).catch(() => null);
      if (rows) return (rows as any[]).map(obsVenueFromRow);
    }
    const list = city ? seedVenuesForCity(city) : ALL_SEED_VENUES;
    return list.map(obsVenueFromSeed);
  }

  async loadCities(): Promise<ObsCitySummary[]> {
    const sql = this.sql;
    const memberCounts = new Map<string, number>();
    const oppCounts = new Map<string, number>();
    const venueCounts = new Map<string, { total: number; active: number }>();
    let dbCities: { id: string; name: string; tz: string }[] | null = null;
    if (sql) {
      const [cRows, mRows, oRows, vRows] = await Promise.all([
        sql`select id, name, tz from platform.cities order by id`.catch(() => null),
        sql`select home_city as city, count(*)::int as n from network.members where app_id = ${this.app} and account_status <> 'removed' and home_city is not null group by home_city`.catch(() => []),
        sql`select city, count(*)::int as n from network.opportunities where app_id = ${this.app} group by city`.catch(() => []),
        sql`select city, count(*)::int as total, count(*) filter (where status = 'active')::int as active from platform.venues group by city`.catch(() => null),
      ]);
      if (cRows) dbCities = cRows as { id: string; name: string; tz: string }[];
      for (const r of mRows as any[]) memberCounts.set(String(r.city), Number(r.n));
      for (const r of oRows as any[]) oppCounts.set(String(r.city), Number(r.n));
      if (vRows) for (const r of vRows as any[]) venueCounts.set(String(r.city), { total: Number(r.total), active: Number(r.active) });
    } else {
      for (const m of this.store.members.values()) if (!m.declined) memberCounts.set(m.city, (memberCounts.get(m.city) ?? 0) + 1);
      for (const o of this.store.opps.values()) if (o.source !== "shadow") oppCounts.set(o.city, (oppCounts.get(o.city) ?? 0) + 1);
    }
    const coreSpecs = listCities();
    const seen = new Set<string>();
    const out: ObsCitySummary[] = [];
    const byDb = new Map((dbCities ?? []).map(c => [c.id, c]));
    for (const spec of coreSpecs) {
      seen.add(spec.id);
      const db = byDb.get(spec.id);
      const vc = venueCounts.get(spec.id);
      const fallbackVenues = seedVenuesForCity(spec.id);
      out.push({
        id: spec.id,
        name: db?.name ?? spec.name,
        shortName: spec.shortName,
        tz: db?.tz ?? spec.tz,
        center: { ...spec.center },
        primaryMode: spec.primaryMode,
        zones: spec.zones.map(z => ({ id: z.id, name: z.name })),
        neighborhoodCount: spec.neighborhoods.length,
        memberCount: memberCounts.get(spec.id) ?? 0,
        opportunityCount: oppCounts.get(spec.id) ?? 0,
        venueCount: vc ? vc.total : (sql ? 0 : fallbackVenues.length),
        activeVenueCount: vc ? vc.active : (sql ? 0 : fallbackVenues.filter(v => v.status === "active").length),
      });
    }
    for (const c of dbCities ?? []) {
      if (seen.has(c.id) || !isCity(c.id)) continue;
      const spec = getCity(c.id);
      const vc = venueCounts.get(c.id);
      out.push({
        id: c.id,
        name: c.name,
        shortName: spec?.shortName ?? c.id.toUpperCase(),
        tz: c.tz,
        center: spec ? { ...spec.center } : { lat: 0, lng: 0 },
        primaryMode: spec?.primaryMode ?? "hybrid",
        zones: spec?.zones.map(z => ({ id: z.id, name: z.name })) ?? [],
        neighborhoodCount: spec?.neighborhoods.length ?? 0,
        memberCount: memberCounts.get(c.id) ?? 0,
        opportunityCount: oppCounts.get(c.id) ?? 0,
        venueCount: vc?.total ?? 0,
        activeVenueCount: vc?.active ?? 0,
      });
    }
    return out;
  }

  async control(cmd: ControlCommand, actor = "unknown"): Promise<ControlResult> {
    try {
      if (cmd.type === "refresh") { await this.reload(); this.push(); return { ok: true }; }
      if (cmd.type === "shadow_run") {
        this.shadowing ??= this.shadowRun(cmd.city).finally(() => { this.shadowing = undefined; });
        return await this.shadowing;
      }
      if (cmd.type === "review" || cmd.type === "matching") {
        if (!this.service) return { ok: false, error: `real-world mode is read-only: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN to send "${cmd.type}" to the Network service`, code: "read_only" };
        return this.afterAction(cmd.type === "review" ? await this.service.review(actor, cmd) : await this.service.matching(actor, cmd.on));
      }
      return { ok: false, error: `real-world mode is read-only: "${cmd.type}" is only available in game mode` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }

  async snapshot(): Promise<WorldSnapshot> {
    if (!this.sql) throw new Error("not connected");
    this.tickClock();
    return loadSnapshot(this.isolation === "rls_role" ? appSnapshotSql(this.sql, this.app) : this.sql, this.store.clock.now, { app: this.app, console: this.isolation === "rls_role" });
  }

  private async shadowRun(city?: City): Promise<ControlResult> {
    const snap = await this.snapshot();
    this.store.clock.busy = "shadow engine run";
    this.push();
    try {
      for (const id of this.shadowIds) this.store.removeOpp(id);
      this.shadowIds.clear();
      this.shadowRuns = [];
      const present = [...new Set([...this.store.members.values()].map(m => m.city).filter(isCity))];
      const cities: City[] = city ? [city] : present.length ? present : [...CITY_IDS];
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

const NET_FEED: Record<string, FeedKind> = {
  review_decision: "review", review_expired: "review", review_invalidated: "review", matching_switch: "config", trust: "trust",
  safety_action: "trust", abuse: "adversarial", guard_blocked: "guard", join_declined: "trust", minor_signal: "trust", age_unknown: "trust",
  age_resolved: "trust", age_conflict: "trust",
  invariant_violation: "invariant",
};
const FEED_TYPES = [
  "member_joined", "opportunity_proposed", "member_accepted", "member_declined", "meeting_scheduled", "interaction_occurred", "feedback_given",
  "member_blocked", "member_opted_out", "safety_flag", ...Object.keys(NET_FEED),
];

const APP_VIEWS = ["platform.person_blocks", "platform.matching_ages", "platform.teen_pair_avoid_members"];

export function appSnapshotSql(sql: SQL, app: string): SQL {
  const suffix = app.replace(/[^a-z]/g, "");
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.some(x => APP_VIEWS.some(v => x.includes(v)))) return (sql as any)(strings, ...values);
    const swapped = strings.map(x => APP_VIEWS.reduce((q, v) => q.replaceAll(v, `${v}_${suffix}`), x));
    const raw = Object.freeze([...swapped]);
    const rebuilt = Object.freeze(Object.defineProperty([...swapped], "raw", { value: raw, enumerable: false })) as unknown as TemplateStringsArray;
    return (sql as any)(rebuilt, ...values);
  };
  return new Proxy(tag, { get: (_t, k) => { const v = (sql as any)[k]; return typeof v === "function" ? v.bind(sql) : v; } }) as unknown as SQL;
}

export function toCoreVenueStatus(raw: unknown): VenueStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "suspect_closed":
    case "suspectclosed":
      return "suspect_closed";
    case "closed_temporary":
    case "closedtemporary":
      return "closed_temporary";
    case "closed_permanent":
    case "closedpermanent":
      return "closed_permanent";
    default:
      return "active";
  }
}

export function toCoreWorkIntroChannel(raw: unknown): WorkIntroChannel | undefined {
  switch (String(raw ?? "").toLowerCase()) {
    case "warm_email":
    case "warmemail":
      return "WarmEmail";
    case "scheduled_video":
    case "scheduledvideo":
      return "ScheduledVideo";
    case "relay_share":
    case "relayshare":
      return "RelayShare";
    case "no_channel":
    case "nochannel":
      return "NoChannel";
    default:
      return undefined;
  }
}

function parsePersonaStats(raw: unknown, fallback?: unknown): Record<string, { alpha: number; beta: number }> {
  const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : v);
  const obj = parse(raw);
  const src = obj && typeof obj === "object" && Object.keys(obj as object).length ? obj : parse(fallback);
  if (!src || typeof src !== "object") return {};
  const out: Record<string, { alpha: number; beta: number }> = {};
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (v && typeof v === "object" && typeof (v as any).alpha === "number" && typeof (v as any).beta === "number") {
      out[k] = { alpha: (v as any).alpha, beta: (v as any).beta };
    }
  }
  return out;
}

export function obsVenueFromRow(r: any): ObsVenue {
  return {
    id: String(r.id),
    city: r.city as City,
    neighborhood: String(r.neighborhood ?? ""),
    name: String(r.name),
    address: String(r.address ?? ""),
    lat: Number(r.lat),
    lng: Number(r.lon),
    category: String(r.category),
    priceTier: Number(r.price_tier ?? 2) as VenuePriceTier,
    status: toCoreVenueStatus(r.status),
    ...(r.yelp_rating != null ? { yelpRating: Number(r.yelp_rating) } : {}),
    ...(r.yelp_review_count != null ? { yelpReviewCount: Number(r.yelp_review_count) } : {}),
    groupScore: Number(r.group_score ?? 70),
    dateScore: Number(r.date_score ?? 70),
    visitCount: Number(r.visit_count ?? 0),
    overallLikes: Number(r.overall_likes ?? 0),
    overallDislikes: Number(r.overall_dislikes ?? 0),
    closureReports: Number(r.closure_reports ?? 0),
    arrivalLandmark: String(r.arrival_landmark ?? ""),
    personaStats: parsePersonaStats(r.persona_stats, r.persona_priors),
    ...(r.source ? { source: String(r.source) } : {}),
    ...(r.verified_open_at ? { verifiedOpenAt: ms(r.verified_open_at) } : {}),
  };
}

export function obsVenueFromSeed(v: VenueRecord): ObsVenue {
  const groupScore = groupVenueRubricScore({
    separateChecks: v.separateChecks,
    walkInCapacity: v.walkInGroupCapacity,
    noiseLevel: v.noiseLevel,
    liveMusicAtNight: v.liveMusicAtNight,
    alcoholOptional: v.alcoholOptional,
    servesVegetarian: v.servesVegetarian,
    servesVegan: v.servesVegan,
    safetyScore: v.safetyScore ?? 8,
    indoor: v.indoor,
    weatherSensitive: v.weatherSensitive,
    hasArrivalLandmark: v.arrivalLandmark.trim().length > 0,
    transitScore: v.transitScore ?? 4,
  });
  const dateScore = Math.min(100, Math.max(40, Math.round((v.yelpRating ?? 4.3) * 18 + (v.noiseLevel === "conversational" ? 12 : 4))));
  return {
    id: v.id,
    city: v.city,
    neighborhood: v.neighborhood,
    name: v.name,
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    category: v.category,
    priceTier: v.priceTier,
    status: v.status,
    ...(v.yelpRating != null ? { yelpRating: v.yelpRating } : {}),
    groupScore,
    dateScore,
    visitCount: 0,
    overallLikes: 0,
    overallDislikes: 0,
    closureReports: v.closureReports,
    arrivalLandmark: v.arrivalLandmark,
    personaStats: parsePersonaStats(v.personaPriors),
    source: v.source,
    verifiedOpenAt: v.lastVerifiedAt,
  };
}

function upsertIfChanged<T extends { id: string }>(map: Map<string, T>, next: T, upsert: (x: T) => void) {
  const cur = map.get(next.id);
  if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) upsert(next);
}


const CONNECT_TYPES = new Set(["probe", "proposal", "relay", "growth_ask", "scheduling", "reminder", "cancellation", "feedback_request", "confirmation"]);
function offersConnection(text: string): boolean {
  for (const m of text.matchAll(new RegExp(CONNECTION.source, "gi"))) {
    if (!/\b(won'?t|will not|can'?t|cannot|never|not|no)\b[^.,;!?]*$/i.test(text.slice(Math.max(0, m.index! - 40), m.index!))) return true;
  }
  return false;
}
