import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import {
  cachedOpsMetricsFresh, catalogScanOverdue, countSendOutcome, judgeDownRaises, judgeRateRaises, opsRoundDue, reportedSmsTotal, roundReport, turnWatchAlertKey, turnWatchLeads, turnWatchLevel, turnWatchRaises, type TurnWatchCondition,
} from "../../packages/core/src/generated/opsAlertDispatch.ts";
import {
  dispatchOperationsAlerts, type Alert, type AlertLevel, type AlertState, type AlertTx, type DispatchResult, type Notice,
} from "../../packages/core/src/vibe/opsAlertShell.js";
import { URGENT_REPORTS } from "../../packages/network/src/reports.ts";
import { splitNetworkId } from "../../packages/network/src/store.ts";
import { judgeModelOf } from "../../packages/core/src/llm.ts";
import { qualifiedJudge, readJudgeQualifications } from "../../packages/network/service/review-qualified.ts";
import { WAITING_STATUSES } from "../../packages/network/service/channel.ts";
import { budgetLines, costBudgetsFromEnv, dayOf, type BudgetLine, type CostApp, type CostBudgets, type CostLedger } from "../../packages/network/service/cost.ts";
import { BIAS_EVERY_MS } from "../../packages/network/service/bias.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import type { TurnWatchMetrics } from "../../packages/network/service/turn-watch.ts";
import { PHOTO_APPS } from "../../packages/platform/src/photos.ts";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const utcDayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
type Env = Record<string, string | undefined>;

export interface OpsConfig {
  env: string;
  build: string;
  webhookUrl?: string;
  webhookFormat: "json" | "slack";
  heartbeatUrl?: string;
  metricsToken?: string;
  tickLateMs: number;
  sendFailureRate: number;
  sendFailureMin: number;
  outboundBacklog: number;
  reviewBacklog: number;
  repeatMs: number;
  maxPostsPerHour: number;
  everyMs: number;
  budgets: CostBudgets;
  budgetWarnShare: number;
  judgeMayApproveRate: number | null;
}

const TOKEN_MIN = 32;

export function opsConfigFromEnv(e: Env, base: { env: string; build: string; deployed: boolean; warn?: (line: string) => void }): OpsConfig {
  const n = (k: string, dflt: number, o: { min?: number; max?: number } = {}) => {
    const v = e[k];
    if (v === undefined || v.trim() === "") return dflt;
    const x = Number(v);
    if (!Number.isFinite(x) || x < (o.min ?? 0) || x > (o.max ?? Number.MAX_SAFE_INTEGER)) throw new Error(`${k} must be a number${o.max !== undefined ? ` from ${o.min ?? 0} to ${o.max}` : " of 0 or more"} (got ${JSON.stringify(v)})`);
    return x;
  };
  const webhookUrl = e.ALERT_WEBHOOK_URL?.trim() || undefined;
  if (webhookUrl) {
    let u: URL;
    try { u = new URL(webhookUrl); } catch { throw new Error("ALERT_WEBHOOK_URL is not a URL"); }
    if (base.deployed && u.protocol !== "https:") throw new Error("ALERT_WEBHOOK_URL must be https when deployed");
  }
  const heartbeatUrl = e.OPS_HEARTBEAT_URL?.trim() || undefined;
  if (heartbeatUrl) {
    let u: URL;
    try { u = new URL(heartbeatUrl); } catch { throw new Error("OPS_HEARTBEAT_URL is not a URL"); }
    if (base.deployed && u.protocol !== "https:") throw new Error("OPS_HEARTBEAT_URL must be https when deployed");
  }
  const metricsToken = e.OPS_METRICS_TOKEN?.trim() || undefined;
  if (metricsToken && metricsToken.length < TOKEN_MIN) throw new Error(`OPS_METRICS_TOKEN must be at least ${TOKEN_MIN} characters`);
  const format = (e.ALERT_WEBHOOK_FORMAT?.trim() || "json").toLowerCase();
  if (format !== "json" && format !== "slack") throw new Error('ALERT_WEBHOOK_FORMAT must be "json" or "slack"');
  return {
    env: base.env, build: base.build, webhookUrl, webhookFormat: format, heartbeatUrl, metricsToken,
    tickLateMs: n("ALERT_TICK_LATE_MS", 15 * MIN, { min: MIN }),
    sendFailureRate: n("ALERT_SEND_FAILURE_RATE", 0.02, { max: 1 }),
    sendFailureMin: n("ALERT_SEND_FAILURE_MIN", 5),
    outboundBacklog: n("ALERT_OUTBOUND_BACKLOG", 50, { min: 1 }),
    reviewBacklog: n("ALERT_REVIEW_BACKLOG", 30, { min: 1 }),
    repeatMs: n("ALERT_REPEAT_MS", 6 * HOUR, { min: 5 * MIN }),
    maxPostsPerHour: n("ALERT_MAX_PER_HOUR", 12, { min: 1 }),
    everyMs: n("OPS_EVERY_MS", MIN, { min: 10_000 }),
    budgets: costBudgetsFromEnv(e),
    budgetWarnShare: n("COST_BUDGET_WARN_SHARE", 0.8, { max: 1 }),
    judgeMayApproveRate: qualifiedJudge(readJudgeQualifications(base.warn ?? (line => { throw new Error(line); })), judgeModelOf(e))?.mayApproveRate ?? null,
  };
}

export interface NetworkMetrics {
  network: string;
  app: string;
  lastTickAgoMs: number | null;
  backlog: { review: number; reviewOverdue: number; deferred: number; outboundWaiting: number };
  sends24h: { attempted: number; failed: number; refused: number; dryRun: number; smsFallback: number };
  reviewExpired24h: number;
  safety24h: { reports: number; urgentReports: number; minorAfterContact: number; holds: number; bans: number };
  smsByDay: { today: number; yesterday: number };
  safetySignalsWaiting?: number;
  biasAlerts24h?: number;
  biasReportAgoMs?: number | null;
  precision7d?: { decided: number; clean: number };
  judge24h?: JudgeCounts;
  judge7d?: JudgeCounts;
  error?: string;
}

export interface JudgeCounts { approved: number; held: number; cannotRun: number; minorApproved: number }

export interface LineMetrics {
  restricted: { action: string; since: number }[];
  leakReview: Record<string, number>;
}

export async function lineMetrics(sql: SQL): Promise<LineMetrics> {
  const restricted = ((await sql`select action, at from platform.line_safety where action <> 'none' order by at, action`) as { action: string; at: Date }[])
    .map(r => ({ action: r.action, since: new Date(r.at).getTime() }));
  const leak = (await sql`select app_id, count(*)::int as n from platform.outbound where status = 'parked_leak_review' group by app_id order by app_id`) as { app_id: string; n: number }[];
  return { restricted, leakReview: Object.fromEntries(leak.map(r => [r.app_id, r.n])) };
}

interface CatalogMetrics { lastScanAgeMs: number | null }

export async function catalogMetrics(sql: SQL, now: number): Promise<CatalogMetrics> {
  const [row] = await sql<{ checked_at: Date | null }[]>`select max(checked_at) as checked_at from network.public_event_imports`;
  return { lastScanAgeMs: row?.checked_at ? now - new Date(row.checked_at).getTime() : null };
}

export interface OpsMetrics {
  ok: true;
  at: number;
  env: string;
  build: string;
  uptimeMs: number;
  networks: NetworkMetrics[];
  line?: LineMetrics | { error: string };
  turns?: TurnWatchMetrics | { error: string };
  catalog?: CatalogMetrics | { error: string };
  cost: { day: string; totalUsd: number; byApp: Partial<Record<CostApp, number>>; budgets: BudgetLine[] } | { error: string };
  alerts?: { open: { key: string; level: AlertLevel; count: number }[]; postsLastHour: number };
}

export interface NetworkProbe {
  id: string;
  app: string;
  health(): Promise<{ lastTick: { stored: number | null; savedAt: number | null }; backlog: NetworkMetrics["backlog"] }>;
  since(t: number, dayStart: number): Promise<{ statuses: Record<string, number>; events: { type: string; action: string | null; n: number }[]; reports: { kind: string }[]; sms: { today: number; yesterday: number; last24h?: number }; safetySignals?: number; biasAlerts?: number; biasLastAt?: number | null; precision7d?: { decided: number; clean: number }; judge?: { day: JudgeCounts; week: JudgeCounts } }>;
}

export const PRECISION_MIN_DECIDED = 20;
export const PRECISION_TARGET = 0.8;

const FAILED = /^(failed|parked_error|undeliverable)/;
const REFUSED = /^(refused|suppressed|blocked|parked|dropped|expired)/;
const WAITING = new Set([...WAITING_STATUSES, "collected", "send_unknown"]);

export function sendOutcomes(statuses: Record<string, number>): NetworkMetrics["sends24h"] {
  const out = { attempted: 0, failed: 0, refused: 0, dryRun: 0, smsFallback: 0 };
  for (const [s, n] of Object.entries(statuses)) {
    if (!countSendOutcome(WAITING.has(s))) continue;
    if (s === "dry_run") out.dryRun += n;
    else if (FAILED.test(s)) { out.failed += n; out.attempted += n; }
    else if (REFUSED.test(s)) out.refused += n;
    else { out.attempted += n; if (s === "fell_back") out.smsFallback += n; }
  }
  return out;
}

export async function collectNetwork(p: NetworkProbe, now: number): Promise<NetworkMetrics> {
  const empty: NetworkMetrics = {
    network: p.id, app: p.app, lastTickAgoMs: null, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 },
    sends24h: { attempted: 0, failed: 0, refused: 0, dryRun: 0, smsFallback: 0 }, reviewExpired24h: 0,
    safety24h: { reports: 0, urgentReports: 0, minorAfterContact: 0, holds: 0, bans: 0 }, smsByDay: { today: 0, yesterday: 0 },
  };
  try {
    const [h, s] = await Promise.all([p.health(), p.since(now - DAY, utcDayStart(now))]);
    // spec/models/runtime_ops.md, tickLateSeen: staff and inbound saves do not advance the matcher heartbeat.
    const last = h.lastTick.stored ?? -Infinity;
    const ev = (type: string, action?: string) => s.events.filter(e => e.type === type && (action === undefined || e.action === action)).reduce((x, e) => x + e.n, 0);
    const sends24h = sendOutcomes(s.statuses);
    sends24h.smsFallback = reportedSmsTotal(s.sms.last24h !== undefined, s.sms.last24h ?? 0, sends24h.smsFallback);
    return {
      ...empty,
      lastTickAgoMs: Number.isFinite(last) ? Math.max(0, now - last) : null,
      backlog: { review: h.backlog.review, reviewOverdue: h.backlog.reviewOverdue, deferred: h.backlog.deferred, outboundWaiting: h.backlog.outboundWaiting },
      sends24h,
      reviewExpired24h: ev("review_expired"),
      safety24h: {
        reports: s.reports.length, urgentReports: s.reports.filter(r => URGENT_REPORTS.has(r.kind as never)).length,
        minorAfterContact: ev("minor_after_contact"), holds: ev("safety_action", "hold"), bans: ev("safety_action", "ban"),
      },
      smsByDay: { today: s.sms.today, yesterday: s.sms.yesterday },
      safetySignalsWaiting: s.safetySignals ?? 0,
      biasAlerts24h: s.biasAlerts ?? 0,
      ...(s.biasLastAt !== undefined ? { biasReportAgoMs: s.biasLastAt === null ? null : Math.max(0, now - s.biasLastAt) } : {}),
      ...(s.precision7d ? { precision7d: s.precision7d } : {}),
      ...(s.judge ? { judge24h: s.judge.day, judge7d: s.judge.week } : {}),
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message.slice(0, 200) };
  }
}

export function runtimeProbe(rt: {
  id: string; app: { id: string };
  health(): Promise<{ lastTick: { stored: number | null; savedAt: number | null }; backlog: NetworkMetrics["backlog"] }>;
  scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
}): NetworkProbe {
  const { city } = splitNetworkId(rt.id);
  return {
    id: rt.id, app: rt.app.id,
    health: () => rt.health(),
    since: (t, dayStart) => rt.scoped(async tx => {
      const at = new Date(t);
      const statuses = Object.fromEntries((await tx`select status, count(*)::int as n from network.messages
        where app_id = ${rt.app.id} and direction = 'outbound' and ts > ${at} group by status` as { status: string; n: number }[]).map(r => [r.status, r.n]));
      const events = (await tx`select type, payload->>'action' as action, count(*)::int as n from network.events
        where app_id = ${rt.app.id} and at > ${at} and type in ('review_expired', 'minor_after_contact', 'safety_action') group by 1, 2`) as { type: string; action: string | null; n: number }[];
      const reports = (await tx`select r->>'kind' as kind from network.network_state s, jsonb_array_elements(coalesce(s.state->'reports', '[]'::jsonb)) r
        where s.id = ${rt.id} and (r->>'at')::float8 > ${t}`) as { kind: string }[];
      const costWindow = new Date(dayStart - DAY);
      const [sms] = (await tx`with sms as (
          select o.sent_at as accepted_at
          from platform.outbound o join network.messages m on m.app_id = o.app_id and m.id = o.id
          where o.app_id = ${rt.app.id} and o.transport = 'sms' and o.sent_at >= ${costWindow}
            and m.direction = 'outbound'
          union all
          select coalesce(o.sent_at, m.ts) as accepted_at
          from network.messages m left join platform.outbound o on o.app_id = m.app_id and o.id = m.id
          where m.app_id = ${rt.app.id} and m.direction = 'outbound' and m.status = 'fell_back'
            and (o.sent_at is null or o.transport is null) and coalesce(o.sent_at, m.ts) >= ${costWindow}
        ) select count(*) filter (where accepted_at >= ${new Date(dayStart)})::int as today,
          count(*) filter (where accepted_at < ${new Date(dayStart)})::int as yesterday,
          count(*) filter (where accepted_at > ${at})::int as last24h
        from sms`) as { today: number; yesterday: number; last24h: number }[];
      // Counts only: a signal's evidence and a report's groups never leave the database here.
      const [sig] = (await tx`select count(*)::int as n from network.facets where app_id = ${rt.app.id} and status = 'proposed'
        and tags && ${tx.array(["signal:safety_concern"], "TEXT")}`) as { n: number }[];
      const [bias] = (await tx`select coalesce(sum(alerts) filter (where at > ${at}), 0)::int as n, max(at) as last
        from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id}`) as { n: number; last: Date | null }[];
      const biasLastAt = PHOTO_APPS.includes(rt.app.id as AppId) ? (bias?.last ? new Date(bias.last).getTime() : null) : undefined;
      const [prec] = (await tx`select count(*)::int as decided,
          count(*) filter (where r.decision = 'approve' and coalesce(jsonb_array_length(case when jsonb_typeof(r.edits) = 'array' then r.edits end), 0) = 0)::int as clean
        from network.review_items r join network.opportunities o on o.app_id = r.app_id and o.id = r.opportunity_id
        where r.app_id = ${rt.app.id} and o.city = ${city} and o.source = 'engine' and r.decision in ('approve', 'reject') and r.decided_at > ${new Date(t - 6 * DAY)}
          and r.reviewer is not null and ((r.decision = 'approve' and r.approver = 'staff') or r.decision = 'reject')`) as { decided: number; clean: number }[];
      const judged = (await tx`select e.at > ${at} as day,
          count(*) filter (where e.type = 'review_decision')::int as approved,
          count(*) filter (where e.type = 'review_decision' and exists (select 1 from network.events j where j.app_id = e.app_id and j.type = 'review_judgment'
            and j.object_id = e.object_id and j.payload->>'revision' = e.payload->>'revision' and j.payload->>'rubric' = 'minor'))::int as minor_approved,
          count(*) filter (where e.type = 'review_exception')::int as held,
          count(*) filter (where e.type = 'review_exception' and e.payload->>'verdict' = 'cannot_run')::int as cannot_run
        from network.events e join network.opportunities o on o.app_id = e.app_id and o.id = e.object_id
        where e.app_id = ${rt.app.id} and o.city = ${city} and e.at > ${new Date(t - 6 * DAY)}
          and (e.type = 'review_exception' or (e.type = 'review_decision' and e.payload->>'decision' = 'approve' and e.payload->>'approver' = 'judge')) group by 1`) as { day: boolean; approved: number; minor_approved: number; held: number; cannot_run: number }[];
      const counts = (rows: typeof judged): JudgeCounts => ({ approved: rows.reduce((x, r) => x + r.approved, 0), held: rows.reduce((x, r) => x + r.held, 0),
        cannotRun: rows.reduce((x, r) => x + r.cannot_run, 0), minorApproved: rows.reduce((x, r) => x + r.minor_approved, 0) });
      return { statuses, events, reports, sms: { today: sms?.today ?? 0, yesterday: sms?.yesterday ?? 0, last24h: sms?.last24h ?? 0 }, safetySignals: sig?.n ?? 0, biasAlerts: bias?.n ?? 0,
        ...(biasLastAt !== undefined ? { biasLastAt } : {}), precision7d: { decided: prec?.decided ?? 0, clean: prec?.clean ?? 0 }, judge: { day: counts(judged.filter(r => r.day)), week: counts(judged) } };
    }),
  };
}

export type { Alert, AlertLevel, AlertState, AlertTx, DispatchResult, Notice } from "../../packages/core/src/vibe/opsAlertShell.js";

const mins = (ms: number) => `${Math.round(ms / MIN)} min`;

interface UnreadAlertSources {
  networks: ReadonlySet<string>;
  line: boolean;
  cost: boolean;
  turns: boolean;
  catalog: boolean;
}

function alertSourceReadable(key: string, unread: UnreadAlertSources): boolean {
  if (key === "line_safety" || key.startsWith("leak_review:")) return !unread.line;
  if (key.startsWith("budget:")) return !unread.cost;
  if (key === "turn_unconfirmed" || key === "turn_unresolved" || key === "deliver_unknown") return !unread.turns;
  if (key === "catalog_stale") return !unread.catalog;
  if (key.startsWith("ops_read:")) return true;
  const separator = key.indexOf(":");
  return separator === -1 || !unread.networks.has(key.slice(separator + 1));
}

export function evaluate(m: Pick<OpsMetrics, "networks" | "cost"> & { uptimeMs?: number; line?: OpsMetrics["line"]; turns?: OpsMetrics["turns"]; catalog?: OpsMetrics["catalog"] }, c: Pick<OpsConfig, "tickLateMs" | "sendFailureRate" | "sendFailureMin" | "outboundBacklog" | "reviewBacklog" | "budgetWarnShare"> & Partial<Pick<OpsConfig, "judgeMayApproveRate">>): Alert[] {
  const out: Alert[] = [];
  const leading: Alert[] = [];
  if (m.turns && "error" in m.turns) out.push({ key: "turn_read", level: "warn", count: 1, text: `Could not read the shared-line turns: ${m.turns.error}` });
  else for (const t of m.turns?.conditions ?? []) {
    if (!turnWatchRaises(t.overdue)) continue;
    const alert: Alert = { key: turnWatchAlertKey(t.condition), level: turnWatchLevel(t.compliance) as AlertLevel, count: t.overdue, text: TURN_WATCH_TEXT[t.condition](t.overdue, t.compliance) };
    (turnWatchLeads(t.compliance) ? leading : out).push(alert);
  }
  for (const n of m.networks) {
    const id = n.network;
    if (n.error !== undefined) { out.push({ key: `ops_read:${id}`, level: "warn", count: 1, text: `Could not read ${id} for monitoring: ${n.error}` }); continue; }
    if (n.lastTickAgoMs === null ? (m.uptimeMs ?? Infinity) > c.tickLateMs : n.lastTickAgoMs > c.tickLateMs) {
      out.push({ key: `tick_late:${id}`, level: "bad", count: n.lastTickAgoMs === null ? 0 : Math.round(n.lastTickAgoMs / MIN), text: n.lastTickAgoMs === null ? `${id}: no tick stored yet` : `${id}: last tick ${mins(n.lastTickAgoMs)} ago (expected every minute)` });
    }
    const s = n.sends24h;
    if (s.failed >= c.sendFailureMin && s.attempted > 0 && s.failed / s.attempted >= c.sendFailureRate) {
      out.push({ key: `send_failures:${id}`, level: "bad", count: s.failed, text: `${id}: ${s.failed} of ${s.attempted} sends failed in 24 h (${Math.round((100 * s.failed) / s.attempted)}%; threshold ${Math.round(c.sendFailureRate * 100)}%)` });
    }
    const sla = n.backlog.reviewOverdue + n.reviewExpired24h;
    if (sla > 0) out.push({ key: `review_sla:${id}`, level: "bad", count: sla, bump: true, text: `${id}: review SLA missed: ${n.backlog.reviewOverdue} item(s) overdue now, ${n.reviewExpired24h} expired unsent in 24 h` });
    const f = n.safety24h;
    if (f.minorAfterContact > 0) out.push({ key: `safety_minor:${id}`, level: "bad", count: f.minorAfterContact, bump: true, text: `${id}: ${f.minorAfterContact} minor signal(s) after contact with an adult in 24 h: check the safety queue now` });
    if (f.reports > 0) out.push({ key: `safety_report:${id}`, level: f.urgentReports > 0 ? "bad" : "warn", count: f.reports, bump: true, text: `${id}: ${f.reports} report(s) in 24 h (${f.urgentReports} urgent)` });
    if (n.safetySignalsWaiting) out.push({ key: `safety_signal:${id}`, level: "bad", count: n.safetySignalsWaiting, bump: true, text: `${id}: ${n.safetySignalsWaiting} agent safety signal(s) wait for staff review (console: Safety, or GET /signals)` });
    if (n.biasAlerts24h) out.push({ key: `bias_report:${id}`, level: "warn", count: n.biasAlerts24h, bump: true, text: `${id}: the weekly bias monitor found ${n.biasAlerts24h} group outcome(s) under 0.8x (console: Metrics, bias monitor)` });
    const biasLate = BIAS_EVERY_MS + DAY;
    if (n.biasReportAgoMs !== undefined && (n.biasReportAgoMs === null ? (m.uptimeMs ?? Infinity) > biasLate : n.biasReportAgoMs > biasLate)) {
      out.push({ key: `bias_late:${id}`, level: "warn", count: n.biasReportAgoMs === null ? 0 : Math.floor(n.biasReportAgoMs / DAY), text: n.biasReportAgoMs === null ? `${id}: the weekly bias monitor has stored no report yet` : `${id}: the newest weekly bias monitor report is ${Math.floor(n.biasReportAgoMs / DAY)} days old (expected every 7 days; look for "[tick] after-tick work failed" in the log)` });
    }
    const p = n.precision7d;
    if (p && p.decided >= PRECISION_MIN_DECIDED && p.clean / p.decided < PRECISION_TARGET) {
      const pct = Math.round((100 * p.clean) / p.decided);
      out.push({ key: `precision:${id}`, level: "warn", count: pct, text: `${id}: shadow precision ${pct}% over 7 days (${p.clean} of ${p.decided} person decisions approved without edits; the gate is ${Math.round(PRECISION_TARGET * 100)}%)` });
    }
    const j = n.judge24h;
    if (j && judgeDownRaises(j.cannotRun)) out.push({ key: `review_judge_down:${id}`, level: "bad", count: j.cannotRun, bump: true, text: `review judge ${id}: ${j.held} held, ${j.cannotRun} cannot run in 24 h` });
    const q = c.judgeMayApproveRate ?? null;
    if (j && q !== null && judgeRateRaises(j.approved, j.held, true, Math.round(q * 10_000))) {
      const r = j.approved / (j.approved + j.held);
      out.push({ key: `review_judge_rate:${id}`, level: "warn", count: Math.round(100 * r), text: `review judge ${id}: approval rate ${r.toFixed(2)} above qualified ${q.toFixed(2)}` });
    }
    if (f.bans + f.holds > 0) out.push({ key: `safety_action:${id}`, level: "warn", count: f.bans + f.holds, bump: true, text: `${id}: ${f.bans} ban(s) and ${f.holds} hold(s) in 24 h` });
    if (n.backlog.outboundWaiting >= c.outboundBacklog) out.push({ key: `queue_outbound:${id}`, level: "warn", count: n.backlog.outboundWaiting, text: `${id}: ${n.backlog.outboundWaiting} message(s) waiting for delivery` });
    if (n.backlog.review >= c.reviewBacklog) out.push({ key: `queue_review:${id}`, level: "warn", count: n.backlog.review, text: `${id}: ${n.backlog.review} item(s) waiting for review` });
  }
  if (m.line && "error" in m.line) out.push({ key: "line_read", level: "warn", count: 1, text: `Could not read the shared line's state: ${m.line.error}` });
  else if (m.line) {
    const r = m.line.restricted;
    if (r.length) {
      const what = r.map(x => `"${x.action}" since ${new Date(x.since).toISOString().slice(0, 16)}Z`).join(", ");
      out.push({ key: "line_safety", level: "bad", count: r.length, text: `Blooio put the shared line under a safety action (${what}): new and agent texts wait; STOP and HELP still go. Check the Blooio dashboard.` });
    }
    for (const [app, n] of Object.entries(m.line.leakReview)) {
      if (n > 0) out.push({ key: `leak_review:${app}`, level: "warn", count: n, bump: true, text: `${app}: ${n} text(s) held for leak review wait for a person (console: held texts, or GET /queue/leak-review)` });
    }
  }
  if (m.catalog && "error" in m.catalog) out.push({ key: "catalog_read", level: "warn", count: 1, text: `Could not read the public event catalog: ${m.catalog.error}` });
  else if (m.catalog && catalogScanOverdue(m.catalog.lastScanAgeMs !== null, m.catalog.lastScanAgeMs ?? 0, m.uptimeMs ?? 0)) {
    const age = m.catalog.lastScanAgeMs;
    out.push({ key: "catalog_stale", level: "warn", count: age === null ? 0 : Math.floor(age / HOUR),
      text: age === null ? "The public event catalog has no successful scan since this process started a day ago: check the public_events tick lines" : `The public event catalog last refreshed ${Math.floor(age / HOUR)} h ago (expected every day): check the public_events tick lines` });
  }
  if ("error" in m.cost) out.push({ key: "cost_read", level: "warn", count: 1, text: `Could not read the cost ledger: ${m.cost.error}` });
  else for (const b of m.cost.budgets) {
    if (b.share < c.budgetWarnShare) continue;
    out.push({ key: `budget:${b.scope}`, level: b.share >= 1 ? "bad" : "warn", count: Math.round(b.share * 100), text: `Cost ${b.scope === "total" ? "for every app" : `for ${b.scope}`} today: $${b.usedUsd.toFixed(2)} of the $${b.budgetUsd.toFixed(2)} daily budget (${Math.round(b.share * 100)}%)` });
  }
  return [...leading, ...out];
}

const TURN_WATCH_TEXT: Record<TurnWatchCondition, (overdue: number, compliance: number) => string> = {
  RepliesUnconfirmed: (n, c) => `${n} handled shared-line turn(s) have replies the gateway never confirmed it sent, or a compliance reply it rejected (${c} with a STOP or compliance reply)`,
  TurnUnresolved: n => `${n} signed shared-line turn(s) stay unresolved; each may have been a STOP (console: resolve the turn, POST /inbound/resolve)`,
  DeliveryUnknown: (n, c) => `${n} queued delivery(ies) have an unknown acceptance and wait for a receipt lookup (${c} compliance)`,
};

export interface AlertStore {
  exclusive<T>(fn: (tx: AlertTx) => Promise<T>): Promise<T | undefined>;
}

export class MemoryAlertStore implements AlertStore {
  readonly states = new Map<string, AlertState>();
  readonly posts: { at: number; alerts: number; ok: boolean }[] = [];
  async exclusive<T>(fn: (tx: AlertTx) => Promise<T>) {
    return fn({
      load: async () => [...this.states.values()].map(s => ({ ...s })),
      save: async ss => { for (const s of ss) this.states.set(s.key, { ...s }); },
      postsSince: async t => this.posts.filter(p => p.at > t).length,
      recordPost: async (at, alerts, ok) => { this.posts.push({ at, alerts, ok }); },
    });
  }
}

export class PgAlertStore implements AlertStore {
  constructor(private sql: SQL) {}
  async exclusive<T>(fn: (tx: AlertTx) => Promise<T>): Promise<T | undefined> {
    return this.sql.begin(async tx => {
      const [got] = await tx`select pg_try_advisory_xact_lock(hashtext('thenetwork-ops-alerts')) as ok`;
      if (!got?.ok) return undefined;
      const ms = (v: unknown) => (v === null || v === undefined ? undefined : new Date(v as string).getTime());
      return fn({
        load: async () => ((await tx`select * from network.ops_alerts`) as any[]).map(r => ({
          key: r.key, level: r.level, count: r.count, text: r.text, open: r.open, firstAt: ms(r.first_at)!, lastAt: ms(r.last_at)!,
          lastSentAt: ms(r.last_sent_at), lastSentLevel: r.last_sent_level ?? undefined, lastSentCount: r.last_sent_count ?? undefined,
        })),
        save: async ss => {
          for (const s of ss) {
            await tx`insert into network.ops_alerts (key, level, count, text, open, first_at, last_at, last_sent_at, last_sent_level, last_sent_count)
              values (${s.key}, ${s.level}, ${s.count}, ${s.text.slice(0, 500)}, ${s.open}, ${new Date(s.firstAt)}, ${new Date(s.lastAt)},
                ${s.lastSentAt === undefined ? null : new Date(s.lastSentAt)}, ${s.lastSentLevel ?? null}, ${s.lastSentCount ?? null})
              on conflict (key) do update set level = excluded.level, count = excluded.count, text = excluded.text, open = excluded.open, first_at = excluded.first_at,
                last_at = excluded.last_at, last_sent_at = excluded.last_sent_at, last_sent_level = excluded.last_sent_level, last_sent_count = excluded.last_sent_count`;
          }
        },
        postsSince: async t => Number(((await tx`select count(*)::int as n from network.ops_alert_posts where at > ${new Date(t)}`) as any[])[0]?.n ?? 0),
        recordPost: async (at, alerts, ok) => { await tx`insert into network.ops_alert_posts (at, alerts, ok) values (${new Date(at)}, ${alerts}, ${ok})`; },
      });
    }) as Promise<T | undefined>;
  }
}

export class AlertDispatcher {
  constructor(private o: {
    store: AlertStore;
    post: (body: Record<string, unknown>) => Promise<boolean>;
    now: () => number;
    repeatMs: number;
    maxPostsPerHour: number;
    format: "json" | "slack";
    env: string;
    build: string;
  }) {}

  dispatch(current: Alert[], unread?: UnreadAlertSources): Promise<DispatchResult | undefined> {
    return this.o.store.exclusive(tx => dispatchOperationsAlerts(current, tx, {
      now: this.o.now(), repeatMs: this.o.repeatMs, maxPostsPerHour: this.o.maxPostsPerHour,
      sourceReadable: key => !unread || alertSourceReadable(key, unread),
      post: notices => this.o.post(this.body(notices)),
    }));
  }

  body(notices: Notice[]): Record<string, unknown> {
    const firing = notices.filter(n => n.state === "firing"), done = notices.filter(n => n.state === "resolved");
    const head = `[${this.o.env}] The Network: ${firing.length} alert(s)${done.length ? `, ${done.length} resolved` : ""}`;
    const lines = [...firing.map(n => `${n.level === "bad" ? "BAD" : "warn"}: ${n.text}`), ...done.map(n => `resolved: ${n.text}`)];
    const text = [head, ...lines].join("\n");
    return this.o.format === "slack" ? { text } : { text, source: "the-network-backend", env: this.o.env, build: this.o.build, alerts: notices };
  }
}

export function webhookPoster(url: string, fetchFn: typeof fetch = fetch): (body: Record<string, unknown>) => Promise<boolean> {
  return async body => {
    const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
    await r.arrayBuffer().catch(() => undefined);
    return r.ok;
  };
}

export interface OpsDeps {
  config: OpsConfig;
  probes: () => NetworkProbe[];
  line?: () => Promise<LineMetrics>;
  turns?: (now: number) => Promise<TurnWatchMetrics>;
  catalog?: (now: number) => Promise<CatalogMetrics>;
  cost?: Pick<CostLedger, "totals" | "accrue">;
  store: AlertStore;
  now: () => number;
  log: { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
  post?: (body: Record<string, unknown>) => Promise<boolean>;
  ping?: (url: string) => Promise<boolean>;
}

export function createOps(d: OpsDeps) {
  const c = d.config;
  const post = d.post ?? (c.webhookUrl ? webhookPoster(c.webhookUrl) : async (body: Record<string, unknown>) => {
    for (const a of (body.alerts as Notice[] | undefined) ?? []) d.log.warn("alert", { key: a.key, level: a.level, count: a.count, state: a.state, detail: a.text });
    return true;
  });
  const dispatcher = new AlertDispatcher({ store: d.store, post, now: d.now, repeatMs: c.repeatMs, maxPostsPerHour: c.maxPostsPerHour, format: c.webhookUrl ? c.webhookFormat : "json", env: c.env, build: c.build });
  const ping = d.ping ?? (async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok);
  let last: Omit<OpsMetrics, "alerts"> | undefined;
  const startedAt = d.now();
  let lastRound = -Infinity;
  let lastAlerts: OpsMetrics["alerts"];
  let judgeInfoDay = "";

  async function collect(accrue: boolean): Promise<Omit<OpsMetrics, "alerts">> {
    const now = d.now();
    const networks = await Promise.all(d.probes().map(p => collectNetwork(p, now)));
    const line: OpsMetrics["line"] = d.line ? await d.line().catch(e => ({ error: (e as Error).message.slice(0, 200) })) : undefined;
    const turns: OpsMetrics["turns"] = d.turns ? await d.turns(now).catch(e => ({ error: (e as Error).message.slice(0, 200) })) : undefined;
    const catalog: OpsMetrics["catalog"] = d.catalog ? await d.catalog(now).catch(e => ({ error: (e as Error).message.slice(0, 200) })) : undefined;
    let cost: OpsMetrics["cost"];
    try {
      const day = dayOf(now);
      if (d.cost && accrue) {
        for (const [k, at] of [["today", now], ["yesterday", utcDayStart(now) - 1]] as const) {
          const fallbacks: Partial<Record<AppId, number>> = {};
          for (const n of networks) fallbacks[n.app as AppId] = (fallbacks[n.app as AppId] ?? 0) + n.smsByDay[k];
          await d.cost.accrue(dayOf(at), fallbacks, k === "today");
        }
      }
      const byApp = d.cost ? await d.cost.totals(day) : {};
      const totalUsd = Math.round(Object.values(byApp).reduce((s, x) => s + (x ?? 0), 0) * 10_000) / 10_000;
      cost = { day, totalUsd, byApp, budgets: budgetLines(byApp, c.budgets) };
    } catch (e) { cost = { error: (e as Error).message.slice(0, 200) }; }
    last = { ok: true, at: now, env: c.env, build: c.build, uptimeMs: now - startedAt, networks, ...(line ? { line } : {}), ...(turns ? { turns } : {}), ...(catalog ? { catalog } : {}), cost };
    return last;
  }

  return {
    config: c,
    dispatcher,
    async metrics(): Promise<OpsMetrics> {
      const snapshot = last && cachedOpsMetricsFresh(d.now() - last.at) ? last : await collect(false);
      return lastAlerts ? { ...snapshot, alerts: lastAlerts } : snapshot;
    },
    async tick(): Promise<DispatchResult | undefined> {
      const now = d.now();
      if (!opsRoundDue(now - lastRound, c.everyMs)) return undefined;
      lastRound = now;
      const m = await collect(true);
      const today = dayOf(now);
      if (today !== judgeInfoDay) {
        judgeInfoDay = today;
        for (const n of m.networks) if (n.judge24h) d.log.info("review judge minor-rubric approvals in 24 h", { network: n.network, minorApproved: n.judge24h.minorApproved, approved: n.judge24h.approved });
      }
      const alerts = evaluate(m, c);
      const r = await dispatcher.dispatch(alerts, {
        networks: new Set(m.networks.filter(n => n.error !== undefined).map(n => n.network)),
        line: !!m.line && "error" in m.line,
        cost: "error" in m.cost,
        turns: !!m.turns && "error" in m.turns,
        catalog: !!m.catalog && "error" in m.catalog,
      });
      const report = roundReport(!!r?.notices.length, !!r?.posted, !!r?.ok, !!r?.held, !!c.heartbeatUrl);
      if (r) {
        lastAlerts = { open: r.open, postsLastHour: r.postsLastHour };
        if (report.logSummary) d.log.info("alerts", { notices: r.notices.length, posted: r.posted, ok: r.ok, held: r.held });
        if (report.logFailure) d.log.error("alert webhook failed", { notices: r.notices.length });
        if (report.logLimit) d.log.warn("alerts held by the rate limit", { held: r.held, maxPerHour: c.maxPostsPerHour });
      }
      if (report.pingHeartbeat && c.heartbeatUrl) await ping(c.heartbeatUrl).then(ok => { if (!ok) d.log.warn("heartbeat ping failed"); }, e => d.log.warn("heartbeat ping failed", { error: (e as Error).message }));
      return r;
    },
  };
}
export type Ops = ReturnType<typeof createOps>;
