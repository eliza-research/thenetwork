import {
  AnalyticsEngine,
  DAY,
  HOUR,
  K_ANONYMITY_FLOOR,
  SimClock,
  detectAnomalies,
  evaluateSafetyInvariants,
  exportScrubbedCsv,
  exportScrubbedJson,
  maskPii,
  resolveDesireLane,
  summarizeIntentDemand,
  type AnalyticsFilter,
  type AnomalyAlert,
  type AppId,
  type CohortMatrix,
  type DecryptedTrajectorySpan,
  type FunnelEvent,
  type FunnelResult,
  type IntentDemandSignal,
  type MemberLifecycleRecord,
  type OutreachHeatmap,
  type OutreachTelemetryRecord,
  type SafetyInvariantCounters,
  type SliceDimension,
  type SliceGranularity,
  type SliceMetric,
  type SliceQuery,
  type SliceResult,
  type TimeSeriesPoint,
  type TrajectoryManifestRow,
  type TrajectorySpan,
  type TrajectoryStorageDriver,
} from "@thenetwork/core";
import type { ObsState } from "./types.ts";

export interface ObservatoryTimeSeriesResponse {
  granularity: "hour" | "day" | "week";
  labels: string[];
  series: {
    visits: TimeSeriesPoint[];
    signups: TimeSeriesPoint[];
    proposals: TimeSeriesPoint[];
    meetings: TimeSeriesPoint[];
    messages: TimeSeriesPoint[];
    stops: TimeSeriesPoint[];
  };
}

export interface ObservatoryAnomaliesResponse {
  alerts: AnomalyAlert[];
  safety: SafetyInvariantCounters;
  intentDemand: IntentDemandSignal[];
}

export interface ObservatorySqlResult {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  truncated: boolean;
}

export interface ObservatoryTrajectoriesResponse {
  traces: TrajectoryManifestRow[];
  hotTail: TrajectorySpan[];
  driver: TrajectoryStorageDriver;
}

export interface ObservatoryTraceDetailResponse {
  traceId: string;
  manifest: TrajectoryManifestRow | null;
  spans: DecryptedTrajectorySpan[];
}

export interface MockTrafficEntry {
  seq: number;
  ts: number;
  service: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  sessionId?: string;
  chaosRuleId?: string;
}

export interface MockTrafficResponse {
  entries: MockTrafficEntry[];
  stats: {
    total: number;
    byService: Record<string, number>;
    byStatus: Record<string, number>;
  };
  baseUrl: string | null;
}

export interface AnalyticsBuildExtras {
  funnelEvents?: readonly FunnelEvent[];
  outreach?: readonly OutreachTelemetryRecord[];
  safety?: Partial<SafetyInvariantCounters>;
  nowMs?: number;
}

const VALID_METRICS = new Set<SliceMetric>([
  "site_visits",
  "verified_signups",
  "proposals",
  "irl_meetings",
  "retained_d30",
  "spend_cents",
  "outreach_sent",
  "stop_rate",
]);

const VALID_DIMENSIONS = new Set<SliceDimension>([
  "appId",
  "city",
  "desireLane",
  "channel",
  "campaignId",
  "ageBand",
  "entrySurface",
]);

export function normalizeSliceGranularity(raw: unknown): SliceGranularity {
  if (raw === "1h" || raw === "hour") return "hour";
  if (raw === "1w" || raw === "week") return "week";
  if (raw === "total") return "total";
  return "day";
}

export function normalizeTimeSeriesGranularity(raw: unknown): "hour" | "day" | "week" {
  if (raw === "1h" || raw === "hour") return "hour";
  if (raw === "1w" || raw === "week") return "week";
  return "day";
}

export function parseAnalyticsFilter(url: URL, appId: AppId): AnalyticsFilter {
  const sp = url.searchParams;
  const filter: AnalyticsFilter = { appId };
  const city = sp.get("city")?.trim().toLowerCase();
  if (city && city !== "all") filter.city = city;
  const desireLane = sp.get("desireLane")?.trim();
  if (desireLane && desireLane !== "all") filter.desireLane = desireLane;
  const channel = sp.get("channel")?.trim();
  if (channel && channel !== "all") filter.channel = channel;
  const campaignId = sp.get("campaignId")?.trim();
  if (campaignId && campaignId !== "all") filter.campaignId = campaignId;
  const entrySurface = sp.get("entrySurface")?.trim();
  if (entrySurface && entrySurface !== "all") filter.entrySurface = entrySurface;
  const ageBand = sp.get("ageBand")?.trim();
  if (ageBand === "18+" || ageBand === "13-17" || ageBand === "unknown") filter.ageBand = ageBand;
  const fromMs = Number(sp.get("fromMs"));
  if (Number.isFinite(fromMs) && fromMs > 0) filter.fromMs = fromMs;
  const toMs = Number(sp.get("toMs"));
  if (Number.isFinite(toMs) && toMs > 0) filter.toMs = toMs;
  return filter;
}

export function normalizeSliceQuery(raw: Record<string, unknown>, appId: AppId): { ok: true; query: SliceQuery } | { ok: false; error: string } {
  const metricRaw = typeof raw.metric === "string" ? raw.metric : "verified_signups";
  if (!VALID_METRICS.has(metricRaw as SliceMetric)) {
    return { ok: false, error: `unsupported metric "${metricRaw}"` };
  }
  const groupByRaw = Array.isArray(raw.groupBy)
    ? raw.groupBy
    : typeof raw.groupBy === "string" && raw.groupBy.trim() && raw.groupBy !== "none"
      ? [raw.groupBy.trim()]
      : [];
  const groupBy: SliceDimension[] = [];
  for (const item of groupByRaw) {
    if (typeof item === "string" && VALID_DIMENSIONS.has(item as SliceDimension)) {
      groupBy.push(item as SliceDimension);
    }
  }
  const rawFilter = raw.filter && typeof raw.filter === "object" ? (raw.filter as Record<string, unknown>) : {};
  const filter: AnalyticsFilter = {
    appId,
    ...(typeof rawFilter.city === "string" && rawFilter.city && rawFilter.city !== "all" ? { city: rawFilter.city } : {}),
    ...(typeof rawFilter.desireLane === "string" && rawFilter.desireLane && rawFilter.desireLane !== "all" ? { desireLane: rawFilter.desireLane } : {}),
    ...(typeof rawFilter.channel === "string" && rawFilter.channel && rawFilter.channel !== "all" ? { channel: rawFilter.channel } : {}),
    ...(typeof rawFilter.campaignId === "string" && rawFilter.campaignId ? { campaignId: rawFilter.campaignId } : {}),
    ...(rawFilter.ageBand === "18+" || rawFilter.ageBand === "13-17" || rawFilter.ageBand === "unknown" ? { ageBand: rawFilter.ageBand } : {}),
    ...(typeof rawFilter.fromMs === "number" && Number.isFinite(rawFilter.fromMs) ? { fromMs: rawFilter.fromMs } : {}),
    ...(typeof rawFilter.toMs === "number" && Number.isFinite(rawFilter.toMs) ? { toMs: rawFilter.toMs } : {}),
  };
  return {
    ok: true,
    query: {
      metric: metricRaw as SliceMetric,
      groupBy: groupBy.slice(0, 2),
      granularity: normalizeSliceGranularity(raw.granularity),
      filter,
    },
  };
}

export function buildAnalyticsEngineFromState(
  state: ObsState,
  appId: AppId,
  extras: AnalyticsBuildExtras = {},
): {
  engine: AnalyticsEngine;
  safety: SafetyInvariantCounters;
  intentDemand: IntentDemandSignal[];
} {
  const nowMs = extras.nowMs ?? state.clock.now;
  const clock = new SimClock(nowMs);
  const engine = new AnalyticsEngine({ clock, kFloor: K_ANONYMITY_FLOOR });

  const firstOppByMember = new Map<string, number>();
  const firstMeetingByMember = new Map<string, { at: number; enjoyment?: number }>();
  const activeDaysByMember = new Map<string, Set<number>>();
  const expiredByMember = new Map<string, number>();
  const cancelledByMember = new Map<string, number>();

  const events: FunnelEvent[] = [];
  const outreach: OutreachTelemetryRecord[] = [];
  let seq = 0;

  for (const o of state.opportunities) {
    if (o.source === "shadow") continue;
    const lane = resolveDesireLane({ appId, category: o.category, objective: o.objective });
    for (const memberId of o.participants) {
      const prevOpp = firstOppByMember.get(memberId);
      if (prevOpp === undefined || o.createdAt < prevOpp) firstOppByMember.set(memberId, o.createdAt);
      if (o.review?.decision === "expired") {
        expiredByMember.set(memberId, (expiredByMember.get(memberId) ?? 0) + 1);
      }
      if (o.booked?.cancelled?.[memberId]) {
        cancelledByMember.set(memberId, (cancelledByMember.get(memberId) ?? 0) + 1);
      }
      const member = state.members.find(m => m.id === memberId);
      const ageBand = member ? (member.ageUnknown ? "unknown" : member.minor ? "13-17" : "18+") : "unknown";
      events.push({
        eventId: `obs-prop-${++seq}`,
        occurredAt: o.createdAt,
        appId,
        city: o.city,
        stage: "first_proposal",
        actorKey: memberId,
        channel: member?.invitedBy ? "referral" : "organic",
        desireLane: lane,
        ageBand,
        isAdultVerified: ageBand === "18+",
      });
      const st = o.status[memberId];
      if (st === "attended" || o.state === "COMPLETED" || o.state === "FEEDBACK_COLLECTED") {
        const at = o.meetingAt ?? o.updatedAt;
        const enj = o.enjoyment[memberId];
        const prevMeet = firstMeetingByMember.get(memberId);
        if (!prevMeet || at < prevMeet.at) {
          firstMeetingByMember.set(memberId, { at, enjoyment: enj !== undefined ? enj * 5 : undefined });
        }
        events.push({
          eventId: `obs-meet-${++seq}`,
          occurredAt: at,
          appId,
          city: o.city,
          stage: "first_irl_meeting",
          actorKey: memberId,
          channel: member?.invitedBy ? "referral" : "organic",
          desireLane: lane,
          ageBand,
          isAdultVerified: ageBand === "18+",
          ...(enj !== undefined ? { enjoyment: enj * 5 } : {}),
        });
      }
    }
  }

  for (const item of state.feed) {
    const dt = new Date(item.t);
    const dow = (dt.getUTCDay() + 6) % 7;
    const hour = dt.getUTCHours();
    const firstMember = item.members?.[0] ? state.members.find(m => m.id === item.members![0]) : undefined;
    const city = firstMember?.city ?? "nyc";
    if (item.kind === "invite" || item.kind === "probe" || item.kind === "message" || item.kind === "proposal") {
      outreach.push({
        occurredAt: item.t,
        appId,
        city,
        channel: "sms",
        templateId: item.kind,
        personaId: appId,
        localDayOfWeek: dow,
        localHour: hour,
        sent: 1,
        delivered: 1,
        clicked: item.kind === "invite" ? 1 : 0,
        replied: item.kind === "message" ? 1 : 0,
        converted: 0,
        stopped: 0,
        bounced: 0,
        rateLimited429: 0,
      });
    } else if (item.kind === "accept" || item.kind === "meeting" || item.kind === "opt_out") {
      outreach.push({
        occurredAt: item.t,
        appId,
        city,
        channel: "sms",
        templateId: item.kind,
        personaId: appId,
        localDayOfWeek: dow,
        localHour: hour,
        sent: 1,
        delivered: 1,
        clicked: 0,
        replied: item.kind === "accept" ? 1 : 0,
        converted: item.kind === "meeting" ? 1 : 0,
        stopped: item.kind === "opt_out" ? 1 : 0,
        bounced: 0,
        rateLimited429: 0,
      });
    }
    if (item.members) {
      for (const mid of item.members) {
        const m = state.members.find(x => x.id === mid);
        if (!m?.joinedAt) continue;
        const deltaDay = Math.max(0, Math.floor((item.t - m.joinedAt) / DAY));
        const set = activeDaysByMember.get(mid) ?? new Set<number>();
        set.add(deltaDay);
        activeDaysByMember.set(mid, set);
      }
    }
  }

  const members: MemberLifecycleRecord[] = [];
  for (const m of state.members) {
    if (m.declined) continue;
    const joinedAt = m.joinedAt ?? state.clock.start;
    const ageBand = m.ageUnknown ? "unknown" : m.minor ? "13-17" : "18+";
    const channel = m.invitedBy ? "referral" : "organic";
    const desireLane = resolveDesireLane({ appId });
    const firstProposalAt = firstOppByMember.get(m.id);
    const firstMeet = firstMeetingByMember.get(m.id);

    if (m.joined) {
      events.push({
        eventId: `obs-visit-${++seq}`,
        occurredAt: Math.max(state.clock.start, joinedAt - HOUR),
        appId,
        city: m.city,
        stage: "site_visit",
        actorKey: m.id,
        channel,
        desireLane,
        ageBand,
        isAdultVerified: ageBand === "18+",
      });
      events.push({
        eventId: `obs-join-${++seq}`,
        occurredAt: joinedAt,
        appId,
        city: m.city,
        stage: "signup_verified",
        actorKey: m.id,
        channel,
        desireLane,
        ageBand,
        isAdultVerified: ageBand === "18+",
      });
      events.push({
        eventId: `obs-onb-${++seq}`,
        occurredAt: joinedAt + 10 * 60_000,
        appId,
        city: m.city,
        stage: "onboarding_completed",
        actorKey: m.id,
        channel,
        desireLane,
        ageBand,
        isAdultVerified: ageBand === "18+",
      });
    }

    const days = activeDaysByMember.get(m.id) ?? new Set<number>();
    days.add(0);
    if (m.counters.msgsIn > 0) days.add(1);
    if (m.counters.accepted > 0) days.add(3);
    if (m.counters.meetings > 0) {
      days.add(7);
      if (nowMs - joinedAt >= 14 * DAY) days.add(14);
      if (nowMs - joinedAt >= 30 * DAY && m.state !== "opted_out") {
        days.add(30);
        events.push({
          eventId: `obs-ret-${++seq}`,
          occurredAt: joinedAt + 30 * DAY,
          appId,
          city: m.city,
          stage: "retained_d30",
          actorKey: m.id,
          channel,
          desireLane,
          ageBand,
          isAdultVerified: ageBand === "18+",
        });
      }
    }

    members.push({
      memberKey: m.id,
      appId,
      city: m.city,
      joinedAt,
      ageBand,
      channel,
      desireLane,
      invitedByFriend: Boolean(m.invitedBy),
      onboardingComplete: m.joined,
      ...(firstProposalAt !== undefined ? { firstProposalAt } : {}),
      ...(firstMeet ? { firstMeetingAt: firstMeet.at, firstMeetingEnjoyment: firstMeet.enjoyment } : {}),
      activeDays: [...days].sort((a, b) => a - b),
      ...(m.state === "opted_out" ? { optedOutAt: nowMs } : {}),
      ...(m.counters.proactive >= 2 && m.counters.msgsIn === 0 ? { unansweredProactive: m.counters.proactive } : {}),
      reviewExpiredCount: expiredByMember.get(m.id) ?? 0,
      bookedCancelledCount: cancelledByMember.get(m.id) ?? 0,
    });
  }

  engine.ingestEvents(extras.funnelEvents?.length ? [...extras.funnelEvents, ...events] : events);
  engine.ingestMembers(members);
  engine.ingestOutreach(extras.outreach?.length ? [...extras.outreach, ...outreach] : outreach);

  const memberCity = new Map(state.members.map(m => [m.id, m.city]));
  const intentDemand = summarizeIntentDemand(
    (state.requests ?? []).map(r => ({
      appId,
      city: memberCity.get(r.memberId) ?? "nyc",
      category: r.category,
      objective: r.label,
      fulfilled: r.outcome === "fulfilled" || r.outcome === "booked" || r.outcome === "answered",
    })),
  );

  const safety: SafetyInvariantCounters = {
    canaryLeaks: extras.safety?.canaryLeaks ?? state.stats.judge?.canaryLeaks ?? 0,
    teenViolationContacts: extras.safety?.teenViolationContacts ?? state.stats.judge?.minorContacts ?? 0,
    crossAppLeaks: extras.safety?.crossAppLeaks ?? 0,
    unverifiedAdultPayouts: extras.safety?.unverifiedAdultPayouts ?? 0,
  };

  return { engine, safety, intentDemand };
}

function isoWeekStartLabel(ms: number): string {
  const date = new Date(ms);
  const offset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

export function computeTimeSeries(
  engine: AnalyticsEngine,
  state: ObsState,
  granularity: "hour" | "day" | "week",
  filter: AnalyticsFilter,
): ObservatoryTimeSeriesResponse {
  const toPoints = (metric: SliceMetric): Map<string, number> => {
    const res = engine.slice({ metric, granularity, filter });
    const map = new Map<string, number>();
    for (const row of res.rows) {
      map.set(row.bucket, (map.get(row.bucket) ?? 0) + row.value);
    }
    return map;
  };

  const visitsMap = toPoints("site_visits");
  const signupsMap = toPoints("verified_signups");
  const proposalsMap = toPoints("proposals");
  const meetingsMap = toPoints("irl_meetings");
  const messagesMap = toPoints("outreach_sent");
  const stopsMap = new Map<string, number>();
  const memberById = new Map(state.members.map(m => [m.id, m]));

  for (const item of state.feed) {
    if (item.kind !== "opt_out") continue;
    if (filter.fromMs !== undefined && item.t < filter.fromMs) continue;
    if (filter.toMs !== undefined && item.t > filter.toMs) continue;
    const m = item.members?.[0] ? memberById.get(item.members[0]) : undefined;
    if (filter.city && m && m.city !== filter.city) continue;
    if (filter.ageBand && m) {
      const band = m.ageUnknown ? "unknown" : m.minor ? "13-17" : "18+";
      if (band !== filter.ageBand) continue;
    }
    const iso = new Date(item.t).toISOString();
    const bucket = granularity === "hour"
      ? `${iso.slice(0, 13)}:00Z`
      : granularity === "week"
        ? isoWeekStartLabel(item.t)
        : iso.slice(0, 10);
    stopsMap.set(bucket, (stopsMap.get(bucket) ?? 0) + 1);
  }

  const labelSet = new Set<string>([
    ...visitsMap.keys(),
    ...signupsMap.keys(),
    ...proposalsMap.keys(),
    ...meetingsMap.keys(),
    ...messagesMap.keys(),
    ...stopsMap.keys(),
  ]);
  const labels = [...labelSet].sort();

  const build = (map: Map<string, number>): TimeSeriesPoint[] =>
    labels.map(label => {
      const parsed = Date.parse(label.length === 10 ? `${label}T00:00:00Z` : label);
      return {
        ts: Number.isFinite(parsed) ? parsed : state.clock.now,
        label,
        value: map.get(label) ?? 0,
      };
    });

  return {
    granularity,
    labels,
    series: {
      visits: build(visitsMap),
      signups: build(signupsMap),
      proposals: build(proposalsMap),
      meetings: build(meetingsMap),
      messages: build(messagesMap),
      stops: build(stopsMap),
    },
  };
}

export function computeAnomalies(
  seriesResp: ObservatoryTimeSeriesResponse,
  safety: SafetyInvariantCounters,
  intentDemand: IntentDemandSignal[],
  nowMs: number,
): ObservatoryAnomaliesResponse {
  const alerts: AnomalyAlert[] = [
    ...evaluateSafetyInvariants(safety, nowMs),
    ...detectAnomalies(seriesResp.series.signups, { metric: "verified_signups" }),
    ...detectAnomalies(seriesResp.series.meetings, { metric: "irl_meetings" }),
    ...detectAnomalies(seriesResp.series.messages, { metric: "outreach_sent" }),
    ...detectAnomalies(seriesResp.series.stops, { metric: "opt_out_stops" }),
  ];
  return { alerts, safety, intentDemand };
}

function isSliceResult(data: unknown): data is SliceResult {
  return Boolean(data && typeof data === "object" && "metric" in data && "groupBy" in data && Array.isArray((data as SliceResult).rows));
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : maskPii(String(value));
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function exportAnalyticsPayload(data: unknown, format: "json" | "csv"): { body: string; contentType: string } {
  if (isSliceResult(data)) {
    return format === "csv"
      ? { body: exportScrubbedCsv(data), contentType: "text/csv; charset=utf-8" }
      : { body: exportScrubbedJson(data), contentType: "application/json; charset=utf-8" };
  }
  if (format === "csv") {
    const sqlRes = data as ObservatorySqlResult;
    const cols = Array.isArray(sqlRes?.columns) ? sqlRes.columns : [];
    const rows = Array.isArray(sqlRes?.rows) ? sqlRes.rows : [];
    const lines = [cols.map(escapeCsvCell).join(",")];
    for (const r of rows) {
      lines.push(cols.map(c => escapeCsvCell(r[c])).join(","));
    }
    return { body: lines.join("\n"), contentType: "text/csv; charset=utf-8" };
  }
  return { body: JSON.stringify(data, null, 2), contentType: "application/json; charset=utf-8" };
}

export const ALLOWED_ANALYTICS_SQL_TABLES: ReadonlySet<string> = new Set([
  "analytics.funnel_daily",
  "analytics.outreach_hourly",
  "analytics.site_events",
  "analytics.trajectory_manifests",
]);

const FORBIDDEN_SQL_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|execute|exec|call|set|do|lock|vacuum|analyze|cluster|refresh|listen|notify|prepare|deallocate|discard|reset|checkpoint|merge|replace|attach|pragma|pg_sleep|current_setting|set_config|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink|information_schema|pg_catalog|trajectory_deks|wrapped_dek|channel_identities|staff_audit)\b/i;

const FORBIDDEN_SCHEMA_PREFIX = /\b(network|platform|public|marketing|pg_[a-z0-9_]+|information_schema)\s*\./i;

function stripSqlStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function extractCteNames(sanitizedSql: string): Set<string> {
  const ctes = new Set<string>();
  const re = /(?:with(?:\s+recursive)?|,)\s*([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sanitizedSql)) !== null) {
    if (m[1]) ctes.add(m[1].toLowerCase());
  }
  return ctes;
}

export function validateReadOnlyAnalyticsSql(rawSql: string): { ok: true; sql: string } | { ok: false; error: string; code: string } {
  const trimmed = rawSql.trim().replace(/;+\s*$/, "");
  if (!trimmed) return { ok: false, error: "SQL query is required", code: "empty_sql" };
  if (trimmed.length > 4000) return { ok: false, error: "SQL query exceeds 4000 characters", code: "sql_too_long" };
  if (trimmed.includes("--") || trimmed.includes("/*") || trimmed.includes("*/")) {
    return { ok: false, error: "SQL comments are not permitted in guarded analytics queries", code: "sql_comments_forbidden" };
  }
  if (trimmed.includes("\"") || trimmed.includes("`") || trimmed.includes("$")) {
    return { ok: false, error: "Quoted identifiers and dollar-quoted blocks are not permitted in guarded analytics SQL", code: "quoted_identifier_forbidden" };
  }
  const stripped = stripSqlStringLiterals(trimmed);
  if (stripped.includes(";")) {
    return { ok: false, error: "Only a single read-only SELECT statement is allowed", code: "multi_statement_forbidden" };
  }
  if (!/^(select|with)\b/i.test(stripped)) {
    return { ok: false, error: "Query must start with SELECT or WITH", code: "non_select_forbidden" };
  }
  if (FORBIDDEN_SQL_KEYWORDS.test(stripped)) {
    return { ok: false, error: "Mutating, administrative, or restricted SQL functions are blocked", code: "mutating_sql_forbidden" };
  }
  if (FORBIDDEN_SCHEMA_PREFIX.test(stripped)) {
    return { ok: false, error: "Only allowlisted analytics.* tables may be queried", code: "table_not_allowlisted" };
  }
  const analyticsRefRe = /\banalytics\s*\.\s*([a-z_][a-z0-9_]*)/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = analyticsRefRe.exec(stripped)) !== null) {
    const qualified = `analytics.${aMatch[1]!.toLowerCase()}`;
    if (!ALLOWED_ANALYTICS_SQL_TABLES.has(qualified)) {
      return {
        ok: false,
        error: `Table "${qualified}" is not in the read-only analytics allowlist (${[...ALLOWED_ANALYTICS_SQL_TABLES].join(", ")})`,
        code: "table_not_allowlisted",
      };
    }
  }
  const fromClauseRe = /\bfrom\s+((?:(?!\b(?:where|group|order|limit|having|union|intersect|except|join|left|right|inner|outer|full|cross|natural|window|offset|fetch)\b|[()]).)+)/gi;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = fromClauseRe.exec(stripped)) !== null) {
    if (fMatch[1]!.includes(",")) {
      return { ok: false, error: "Comma-separated FROM joins are not permitted; use explicit JOIN with allowlisted tables", code: "comma_join_forbidden" };
    }
  }
  const ctes = extractCteNames(stripped);
  const tableRefRe = /\b(?:from|join)\s+(?!\()([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  let match: RegExpExecArray | null;
  let tableCount = 0;
  while ((match = tableRefRe.exec(stripped)) !== null) {
    const ref = match[1]!.toLowerCase();
    if (ctes.has(ref)) continue;
    tableCount++;
    if (!ALLOWED_ANALYTICS_SQL_TABLES.has(ref)) {
      return {
        ok: false,
        error: `Table "${ref}" is not in the read-only analytics allowlist (${[...ALLOWED_ANALYTICS_SQL_TABLES].join(", ")})`,
        code: "table_not_allowlisted",
      };
    }
  }
  if (tableCount === 0) {
    return {
      ok: false,
      error: `Query must reference an allowlisted analytics table (${[...ALLOWED_ANALYTICS_SQL_TABLES].join(", ")})`,
      code: "table_not_allowlisted",
    };
  }
  return { ok: true, sql: trimmed };
}

export function scrubSqlRows(rows: Record<string, unknown>[], maxRows = 500): ObservatorySqlResult {
  const truncated = rows.length > maxRows;
  const sliced = truncated ? rows.slice(0, maxRows) : rows;
  const colSet = new Set<string>();
  for (const r of sliced) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const columns = [...colSet];
  const cleanRows = sliced.map(row => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const col of columns) {
      const val = row[col];
      if (val === null || val === undefined) out[col] = null;
      else if (typeof val === "boolean" || typeof val === "number") out[col] = val;
      else if (val instanceof Date) out[col] = val.toISOString();
      else if (typeof val === "string") out[col] = maskPii(val);
      else out[col] = maskPii(JSON.stringify(val));
    }
    return out;
  });
  return { columns, rows: cleanRows, truncated };
}

export function redactHotTailForRole(spans: readonly TrajectorySpan[], allowPayload: boolean): TrajectorySpan[] {
  return spans.map(span => {
    const { payload, personId: _p, isMinor, ...meta } = span;
    if (!allowPayload || isMinor) return meta;
    return payload !== undefined ? { ...meta, payload } : meta;
  });
}

export function redactTraceDetailForRole(
  spans: readonly DecryptedTrajectorySpan[],
  allowPayload: boolean,
): DecryptedTrajectorySpan[] {
  return spans.map(span => {
    const { payload, payloadPlain: _plain, ...rest } = span;
    const meta = { ...rest } as DecryptedTrajectorySpan & { personId?: unknown; isMinor?: unknown };
    delete meta.personId;
    delete meta.isMinor;
    if (!allowPayload || span.dekRef === "redacted" || span.payloadState === "redacted") {
      return { ...meta, payloadState: "redacted" };
    }
    if (span.payloadState === "shredded") {
      return { ...meta, payloadState: "shredded", payload: { status: "[crypto-shredded]" } };
    }
    return { ...meta, ...(payload !== undefined ? { payload } : {}) };
  });
}

export type { CohortMatrix, FunnelResult, OutreachHeatmap, SliceResult };
