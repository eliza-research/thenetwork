// The monitor (critical path items 11 and 12; PRD 35.2, 36.3, 36.4, 37.3). Every 5 minutes it reads
// the database (and, when given, the liveness probe) and hands what is wrong to the alert dispatcher
// (alerts.ts), which sends each alert once and again every few hours while it lasts.
//
// It runs inside the backend with MONITOR=1 (deploy/backend/server.ts), on the service login (every
// read is app-scoped), or on its own: scripts/monitor.ts. Checks, per app unless said otherwise:
//  - liveness: the /healthz probe (when given);
//  - tick staleness per network: the stored state's last tick older than 10 minutes;
//  - outbound backlog: sends waiting for the sender (not quiet hours) for longer than 30 minutes;
//  - queue_alert events (the outbound queue's own alerts) in the last hour;
//  - send failures: Blooio failures over the sends it took in the last 24 hours (over 2%, 20+ sends);
//  - review items past their SLA, waiting longer than the app's SLA, or due within the hour;
//  - safety reports: urgent ones open over 1 hour, others over 24 hours, a minor report at once;
//    stuck opportunities (health.ts safetyAlerts, the same rule as the console);
//  - invariant violations: runs the invariant job (invariants.ts), then alerts on the last 24 hours;
//  - bias_report events (the weekly photo bias monitor): "alert" warns, "pause" is bad;
//  - spend at 80% and 100% of the daily and monthly budget (costs.ts; no budget set: no alert);
//  - the pilot pause thresholds over the last 7 days (observatory pilot.ts).
// A check that throws becomes its own alert (monitor_check_failed:<check>); the others still run.
import type { SQL } from "bun";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { safetyAlerts } from "../../observatory/src/health.ts";
import { loadPilotInput, pilotAlerts, pilotMetrics } from "../../observatory/src/pilot.ts";
import { slaHours } from "../../observatory/src/apps.ts";
import type { Alert, AlertDispatcher, SentAlert } from "./alerts.ts";
import { activeMembers, appIds, budgetFromEnv, costAlerts, costSummary, pricesFromEnv, rollupMessages, scopedTo, type Budget, type Prices } from "./costs.ts";
import { recentViolations, runInvariants } from "./invariants.ts";

export const MONITOR_INTERVAL_MS = 5 * MINUTE;
export const TICK_STALE_MS = 10 * MINUTE;
export const BACKLOG_AGE_MS = 30 * MINUTE;
export const FAILURE_RATE_WARN = 0.02;
export const FAILURE_RATE_BAD = 0.1;
export const FAILURE_MIN_N = 20;
/** Statuses that wait for the sender itself (not for quiet hours or a reply). */
const STUCK_WAITING = ["queued", "pending", "sending", "retry_scheduled"];

export interface MonitorOptions {
  sql: SQL;
  now: () => number;
  dispatcher: AlertDispatcher;
  log?: (line: string) => void;
  /** Apps to check (default every row of platform.apps). */
  apps?: string[];
  /** The liveness probe (/healthz). False or a throw: the backend is down. */
  healthz?: () => Promise<boolean>;
  /** Run the invariant job before checking (default true). */
  invariants?: boolean;
  budget?: Budget;
  prices?: Prices;
  /** Review SLA hours per app (default observatory apps.ts slaHours()). */
  sla?: Record<string, number>;
}

type Row = Record<string, any>;

/** Everything wrong right now, as alerts with stable keys. */
export async function checks(o: MonitorOptions): Promise<Alert[]> {
  const now = o.now();
  const out: Alert[] = [];
  const add = (a: Alert) => out.push(a);
  const guard = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { add({ key: `monitor_check_failed:${name}`, level: "warn", text: `Monitor check ${name} failed: ${(e as Error).message}` }); }
  };
  const apps = o.apps ?? await appIds(o.sql);
  const sla = o.sla ?? (slaHours() as Record<string, number>);

  if (o.healthz) await guard("healthz", async () => {
    const ok = await o.healthz!().catch(() => false);
    if (!ok) add({ key: "healthz_down", level: "bad", text: "The backend's /healthz does not answer 200" });
  });

  if (o.invariants !== false) await guard("invariants", async () => {
    const r = await runInvariants(o.sql, { now, apps });
    if (r.written.length) o.log?.(`[monitor] ${r.written.length} new invariant violation(s)`);
  });

  for (const app of apps) {
    await guard(`app:${app}`, () => scopedTo(o.sql, app, async tx => {
      // Tick staleness per network of this app.
      for (const r of await tx`select id, saved_at, (state->>'lastTick')::bigint as last_tick from network.network_state where app_id = ${app}` as Row[]) {
        const last = Number(r.last_tick) || new Date(r.saved_at).getTime();
        if (now - last > TICK_STALE_MS) add({ key: `tick_stale:${r.id}`, level: "bad", app, count: Math.round((now - last) / MINUTE), text: `${r.id}: no tick for ${Math.round((now - last) / MINUTE)} minutes` });
      }
      const [backlog] = await tx`select count(*)::int as n from network.messages where app_id = ${app} and direction = 'outbound'
        and status = any(${`{${STUCK_WAITING.join(",")}}`}::text[]) and ts < ${new Date(now - BACKLOG_AGE_MS)}` as Row[];
      if (backlog!.n) add({ key: `outbound_backlog:${app}`, level: "warn", app, count: backlog!.n, text: `${app}: ${backlog!.n} send(s) waiting for the sender for over 30 minutes` });

      for (const r of await tx`select payload->>'kind' as kind, payload->>'line' as line, count(*)::int as n, max(payload->>'detail') as detail from network.events
        where app_id = ${app} and type = 'queue_alert' and at >= ${new Date(now - HOUR)} and at <= ${new Date(now)} group by 1, 2` as Row[]) {
        // The address hash stays in the event; the alert names the kind and the line only.
        add({ key: `queue_alert:${app}:${r.kind ?? "unknown"}:${r.line ?? ""}`, level: "warn", app, count: r.n, text: `${app}: outbound queue alert ${r.kind ?? "unknown"}${r.line ? ` on ${r.line}` : ""} (${r.n} in the last hour)${r.detail ? `: ${String(r.detail).slice(0, 200)}` : ""}` });
      }

      const [f] = await tx`select count(*) filter (where status in ('accepted', 'sent', 'delivered', 'read', 'failed'))::int as handed, count(*) filter (where status = 'failed')::int as failed
        from network.messages where app_id = ${app} and direction = 'outbound' and ts >= ${new Date(now - DAY)} and ts <= ${new Date(now)}` as Row[];
      const rate = f!.handed ? f!.failed / f!.handed : 0;
      if (f!.handed >= FAILURE_MIN_N && rate > FAILURE_RATE_WARN)
        add({ key: `send_failures:${app}`, level: rate > FAILURE_RATE_BAD ? "bad" : "warn", app, count: f!.failed, text: `${app}: ${(rate * 100).toFixed(1)}% of sends failed in the last 24 h (${f!.failed} of ${f!.handed})` });

      const review = await tx`select queued_at, deadline from network.review_items where app_id = ${app} and decision is null` as Row[];
      const overdue = review.filter(r => new Date(r.deadline).getTime() <= now).length;
      const near = review.filter(r => { const d = new Date(r.deadline).getTime(); return d > now && d - now <= HOUR; }).length;
      const slaMs = (sla[app] ?? 12) * HOUR;
      const late = review.filter(r => now - new Date(r.queued_at).getTime() > slaMs && new Date(r.deadline).getTime() > now).length;
      if (overdue) add({ key: `review_overdue:${app}`, level: "bad", app, count: overdue, text: `${app}: ${overdue} review item(s) past their deadline` });
      if (late) add({ key: `review_sla:${app}`, level: "bad", app, count: late, text: `${app}: ${late} review item(s) waiting longer than the ${sla[app] ?? 12} h SLA` });
      if (near) add({ key: `review_near_sla:${app}`, level: "warn", app, count: near, text: `${app}: ${near} review item(s) due within 1 hour` });

      // Safety reports (the Network's stored state) and stuck opportunities: the console's rule.
      const reports = await tx`select r->>'kind' as kind, (r->>'at')::bigint as at, r->>'status' as status from network.network_state s,
        jsonb_array_elements(coalesce(s.state->'reports', '[]'::jsonb)) r where s.app_id = ${app}` as Row[];
      const opps = await tx`select state, created_at, meeting_at, source from network.opportunities where app_id = ${app} and state in ('PROPOSED', 'SCHEDULED')` as Row[];
      for (const a of safetyAlerts(now, reports.map(r => ({ kind: r.kind ?? "other", at: Number(r.at), status: r.status ?? "open" })),
        opps.map(r => ({ state: r.state, createdAt: new Date(r.created_at).getTime(), ...(r.meeting_at ? { meetingAt: new Date(r.meeting_at).getTime() } : {}), source: r.source }))))
        add({ key: `${a.key}:${app}`, level: a.level === "info" ? "warn" : a.level, app, count: a.count, text: `${app}: ${a.text}` });

      const [bias] = await tx`select payload, at from network.events where app_id = ${app} and type = 'bias_report' and at >= ${new Date(now - 8 * DAY)} order by at desc, id desc limit 1` as Row[];
      if (bias) {
        const p = (typeof bias.payload === "string" ? JSON.parse(bias.payload) : bias.payload) ?? {};
        if (p.action === "pause" || p.action === "alert")
          add({ key: `bias_report:${app}`, level: p.action === "pause" ? "bad" : "warn", app, text: `${app}: the photo bias monitor says ${p.action} (lowest group ${p.min_group ?? "?"} at ${p.ratio ?? "?"}x)` });
      }

      const pilot = pilotMetrics(await loadPilotInput(tx, app, now, { reports: reports.filter(r => r.at).map(r => ({ kind: r.kind ?? "other", at: Number(r.at) })) }));
      for (const a of pilotAlerts(app, pilot)) add({ key: `${a.key}:${app}`, level: "bad", app, count: a.count, text: a.text });
    }));
  }

  await guard("invariant_events", async () => {
    for (const v of await recentViolations(o.sql, now, DAY, apps))
      add({ key: `invariant:${v.app}:${v.rule}`, level: "bad", app: v.app, count: v.n, text: `${v.app}: ${v.n} invariant violation(s) in the last 24 h: ${v.rule.replace(/_/g, " ")}` });
  });

  await guard("costs", async () => {
    const prices = o.prices ?? pricesFromEnv();
    await rollupMessages(o.sql, now, prices);
    const s = await costSummary(o.sql, now, prices);
    for (const a of costAlerts(s, o.budget ?? budgetFromEnv())) add(a);
  });
  return out;
}

/** Cost per active member this month, per app (for the scorecard and the monitor's log line). */
export async function costPerMember(sql: SQL, now: number, prices: Prices = pricesFromEnv()): Promise<Record<string, { usd: number; members: number; perMember: number | null }>> {
  const s = await costSummary(sql, now, prices);
  const out: Record<string, { usd: number; members: number; perMember: number | null }> = {};
  for (const app of await appIds(sql)) {
    const members = await activeMembers(sql, app, now), usd = s.byApp[app]?.totalUsd ?? 0;
    out[app] = { usd, members, perMember: members ? Math.round((usd / members) * 1e4) / 1e4 : null };
  }
  return out;
}

/** The loop: checks() then dispatch, every intervalMs. One run at a time; stop() waits for the one in flight. */
export class Monitor {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<SentAlert[]>;
  constructor(private readonly o: MonitorOptions & { intervalMs?: number }) {}

  async runOnce(): Promise<SentAlert[]> {
    if (this.running) return this.running;
    this.running = (async () => {
      try { return await this.o.dispatcher.dispatch(await checks(this.o)); }
      catch (e) { this.o.log?.(`[monitor] run failed: ${(e as Error).message}`); return []; }
      finally { this.running = undefined; }
    })();
    return this.running;
  }

  start() {
    const first = this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.o.intervalMs ?? MONITOR_INTERVAL_MS);
    (this.timer as { unref?: () => void }).unref?.();
    return first;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
