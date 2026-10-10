// Monitoring, alerts and cost checks for the shared backend (docs/deploy.md section 7; mvp-plan items 11 and 12).
//
//   collect()      one snapshot per network: the last stored tick, the review and send queues, the
//                  sends of the last 24 h by outcome, review SLA misses, safety events (reports, minor
//                  signals after contact, holds, bans, agent safety signals waiting for staff, bias
//                  monitor alerts of the last 24 h); and today's cost per app against the budgets.
//                  Counts and network ids only: never a member id, a phone number or a text.
//   evaluate()     the snapshot as alerts (key, level, count, text).
//   AlertDispatcher  dedupe and a rate limit, with its state in network.ops_alerts (a restart or a
//                  second replica does not send again): an alert is posted when it starts, when it gets
//                  worse (warn to bad, or more safety events), every ALERT_REPEAT_MS while it lasts, and
//                  once when it ends. All alerts of one round go in one POST; at most ALERT_MAX_PER_HOUR
//                  posts an hour. Without ALERT_WEBHOOK_URL the alerts are log lines ("alert").
//   createOps()    the runner the backend calls in its tick (backend.ts) and for GET /ops/metrics.
//
// The webhook body is JSON: { text, source, env, build, alerts: [{ key, level, count, text, state }] }.
// `text` alone is what a Slack incoming webhook shows; ALERT_WEBHOOK_FORMAT=slack sends only { text }.
import type { SQL } from "bun";
import { URGENT_REPORTS } from "../../packages/network/src/reports.ts";
import { SIM_AUTO_REVIEWER } from "../../packages/network/src/network.ts";
import { budgetLines, costBudgetsFromEnv, dayOf, type BudgetLine, type CostApp, type CostBudgets, type CostLedger } from "../../packages/network/service/cost.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** The start of the UTC day of a time (the cost ledger's day). */
export const utcDayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
type Env = Record<string, string | undefined>;

// ------------------------------------------------------------------ config

export interface OpsConfig {
  env: string;
  build: string;
  /** Generic JSON POST target (a Slack incoming webhook works). Undefined: alerts are log lines only. */
  webhookUrl?: string;
  webhookFormat: "json" | "slack";
  /** A dead man's switch (for example a Better Stack or healthchecks.io heartbeat URL): GET after each good round. */
  heartbeatUrl?: string;
  /** Bearer token for GET /ops/metrics. Undefined: the route answers 404. */
  metricsToken?: string;
  /** No network tick stored for this long is an alert (default 15 min). */
  tickLateMs: number;
  /** Send failures in 24 h: alert at this share of attempted sends ... */
  sendFailureRate: number;
  /** ... and at least this many failures. */
  sendFailureMin: number;
  /** Messages waiting for delivery at once. */
  outboundBacklog: number;
  /** Review items waiting at once. */
  reviewBacklog: number;
  /** An alert that lasts is posted again after this long. */
  repeatMs: number;
  maxPostsPerHour: number;
  /** How often the ops round runs inside the backend tick (default 60 s). */
  everyMs: number;
  budgets: CostBudgets;
  /** Budget share for a warning (default 0.8; 1.0 or more is bad). */
  budgetWarnShare: number;
}

const TOKEN_MIN = 32;

export function opsConfigFromEnv(e: Env, base: { env: string; build: string; deployed: boolean }): OpsConfig {
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
  if (heartbeatUrl && base.deployed && !heartbeatUrl.startsWith("https://")) throw new Error("OPS_HEARTBEAT_URL must be https when deployed");
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
  };
}

// ------------------------------------------------------------------ metrics

export interface NetworkMetrics {
  network: string;
  app: string;
  /** Since the last tick any instance stored for this network (null: never). */
  lastTickAgoMs: number | null;
  backlog: { review: number; reviewOverdue: number; deferred: number; outboundWaiting: number };
  /** Outbound messages of the last 24 h by outcome. attempted = handed to the provider (sent, delivered, failed...). */
  sends24h: { attempted: number; failed: number; refused: number; dryRun: number; smsFallback: number };
  /** Review items that expired unsent in the last 24 h (the SLA was missed). */
  reviewExpired24h: number;
  safety24h: { reports: number; urgentReports: number; minorAfterContact: number; holds: number; bans: number };
  /** Outbound messages stored as fell_back (sent by SMS) on this UTC day and the day before. */
  smsByDay: { today: number; yesterday: number };
  /** Agent safety_concern signals (POST /internal/signals) waiting for a person in GET /signals: the safety alert. */
  safetySignalsWaiting?: number;
  /** Groups under 0.8x in bias monitor reports written in the last 24 h (service.ts afterTick; weekly). */
  biasAlerts24h?: number;
  /**
   * Shadow precision of the last 7 days (PRD 32.8 precision gate, 34.6 shadow mode): review items a person
   * decided (approve or reject; the simulated reviewer left out) and those approved without an edit.
   */
  precision7d?: { decided: number; clean: number };
  /** The network could not be read (the rest of the row is zeros). */
  error?: string;
}

export interface OpsMetrics {
  ok: true;
  at: number;
  env: string;
  build: string;
  /** Since this process's ops runner started (a network with no stored tick is late only after tickLateMs of uptime). */
  uptimeMs: number;
  networks: NetworkMetrics[];
  cost: { day: string; totalUsd: number; byApp: Partial<Record<CostApp, number>>; budgets: BudgetLine[] } | { error: string };
  alerts?: { open: { key: string; level: AlertLevel; count: number }[]; postsLastHour: number };
}

/** What one network's probe answers (production: a NetworkRuntime and its SQL; the simulation: a fake). */
export interface NetworkProbe {
  id: string;
  app: string;
  health(): Promise<{ lastTick: { stored: number | null; savedAt: number | null }; backlog: NetworkMetrics["backlog"] }>;
  /**
   * Rows since a time: outbound statuses, event counts (type and action), report rows from the stored
   * state, and the SMS fallbacks of the UTC day that starts at `dayStart` and of the day before (the cost accruals).
   */
  since(t: number, dayStart: number): Promise<{ statuses: Record<string, number>; events: { type: string; action: string | null; n: number }[]; reports: { kind: string }[]; sms: { today: number; yesterday: number }; safetySignals?: number; biasAlerts?: number; precision7d?: { decided: number; clean: number } }>;
}

/** Below this many person decisions in 7 days the precision is not alerted on (too few to read). */
export const PRECISION_MIN_DECIDED = 20;
/** The precision gate (PRD 32.8): reviewer approval without edits at least 80%. */
export const PRECISION_TARGET = 0.8;

/** Final outcomes of a send that reached (or tried to reach) the provider. */
const FAILED = /^(failed|parked_error|undeliverable)/;
const REFUSED = /^(refused|suppressed|blocked|parked|dropped|expired)/;
const WAITING = new Set(["queued", "pending", "sending", "deferred_quiet_hours", "held_awaiting_reply", "retry_scheduled"]);

export function sendOutcomes(statuses: Record<string, number>): NetworkMetrics["sends24h"] {
  const out = { attempted: 0, failed: 0, refused: 0, dryRun: 0, smsFallback: 0 };
  for (const [s, n] of Object.entries(statuses)) {
    if (s === "dry_run") out.dryRun += n;
    else if (FAILED.test(s)) { out.failed += n; out.attempted += n; }
    else if (REFUSED.test(s)) out.refused += n;
    else if (WAITING.has(s)) continue;
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
    const last = Math.max(h.lastTick.stored ?? -Infinity, h.lastTick.savedAt ?? -Infinity);
    const ev = (type: string, action?: string) => s.events.filter(e => e.type === type && (action === undefined || e.action === action)).reduce((x, e) => x + e.n, 0);
    return {
      ...empty,
      lastTickAgoMs: Number.isFinite(last) ? Math.max(0, now - last) : null,
      backlog: { review: h.backlog.review, reviewOverdue: h.backlog.reviewOverdue, deferred: h.backlog.deferred, outboundWaiting: h.backlog.outboundWaiting },
      sends24h: sendOutcomes(s.statuses),
      reviewExpired24h: ev("review_expired"),
      safety24h: {
        reports: s.reports.length, urgentReports: s.reports.filter(r => URGENT_REPORTS.has(r.kind as never)).length,
        minorAfterContact: ev("minor_after_contact"), holds: ev("safety_action", "hold"), bans: ev("safety_action", "ban"),
      },
      smsByDay: s.sms,
      safetySignalsWaiting: s.safetySignals ?? 0,
      biasAlerts24h: s.biasAlerts ?? 0,
      ...(s.precision7d ? { precision7d: s.precision7d } : {}),
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message.slice(0, 200) };
  }
}

/** The probe of one service runtime: its health() and three app-scoped reads (row-level security: one app per transaction). */
export function runtimeProbe(rt: {
  id: string; app: { id: string };
  health(): Promise<{ lastTick: { stored: number | null; savedAt: number | null }; backlog: NetworkMetrics["backlog"] }>;
  scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
}): NetworkProbe {
  return {
    id: rt.id, app: rt.app.id,
    health: () => rt.health(),
    since: (t, dayStart) => rt.scoped(async tx => {
      const at = new Date(t);
      const statuses = Object.fromEntries((await tx`select status, count(*)::int as n from network.messages
        where app_id = ${rt.app.id} and direction = 'outbound' and ts > ${at} group by status` as { status: string; n: number }[]).map(r => [r.status, r.n]));
      const events = (await tx`select type, payload->>'action' as action, count(*)::int as n from network.events
        where app_id = ${rt.app.id} and at > ${at} and type in ('review_expired', 'minor_after_contact', 'safety_action') group by 1, 2`) as { type: string; action: string | null; n: number }[];
      // Reports live in the stored state (ids and a kind only); `at` is epoch ms.
      const reports = (await tx`select r->>'kind' as kind from network.network_state s, jsonb_array_elements(coalesce(s.state->'reports', '[]'::jsonb)) r
        where s.id = ${rt.id} and (r->>'at')::float8 > ${t}`) as { kind: string }[];
      const [sms] = (await tx`select count(*) filter (where ts >= ${new Date(dayStart)})::int as today, count(*) filter (where ts < ${new Date(dayStart)})::int as yesterday
        from network.messages where app_id = ${rt.app.id} and direction = 'outbound' and status = 'fell_back' and ts >= ${new Date(dayStart - DAY)}`) as { today: number; yesterday: number }[];
      // Counts only: a signal's evidence and a report's groups never leave the database here.
      const [sig] = (await tx`select count(*)::int as n from network.facets where app_id = ${rt.app.id} and status = 'proposed'
        and tags && ${tx.array(["signal:safety_concern"], "TEXT")}`) as { n: number }[];
      const [bias] = (await tx`select coalesce(sum(alerts), 0)::int as n from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id} and at > ${at}`) as { n: number }[];
      // Shadow precision: person decisions of the last 7 days (an edit before approving is not "without edits").
      const [prec] = (await tx`select count(*)::int as decided,
          count(*) filter (where decision = 'approve' and coalesce(jsonb_array_length(case when jsonb_typeof(edits) = 'array' then edits end), 0) = 0)::int as clean
        from network.review_items where app_id = ${rt.app.id} and decision in ('approve', 'reject') and decided_at > ${new Date(t - 6 * DAY)}
          and reviewer is not null and reviewer <> ${SIM_AUTO_REVIEWER}`) as { decided: number; clean: number }[];
      return { statuses, events, reports, sms: { today: sms?.today ?? 0, yesterday: sms?.yesterday ?? 0 }, safetySignals: sig?.n ?? 0, biasAlerts: bias?.n ?? 0,
        precision7d: { decided: prec?.decided ?? 0, clean: prec?.clean ?? 0 } };
    }),
  };
}

// ------------------------------------------------------------------ alerts

export type AlertLevel = "warn" | "bad";
export interface Alert {
  key: string; level: AlertLevel; count: number; text: string;
  /** Post again when the count goes up (new safety events), not only on a level change. */
  bump?: boolean;
}

const mins = (ms: number) => `${Math.round(ms / MIN)} min`;

/** The snapshot as alerts. Pure: the same snapshot gives the same alerts. */
export function evaluate(m: Pick<OpsMetrics, "networks" | "cost"> & { uptimeMs?: number }, c: Pick<OpsConfig, "tickLateMs" | "sendFailureRate" | "sendFailureMin" | "outboundBacklog" | "reviewBacklog" | "budgetWarnShare">): Alert[] {
  const out: Alert[] = [];
  for (const n of m.networks) {
    const id = n.network;
    if (n.error) { out.push({ key: `ops_read:${id}`, level: "warn", count: 1, text: `Could not read ${id} for monitoring: ${n.error}` }); continue; }
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
    const p = n.precision7d;
    if (p && p.decided >= PRECISION_MIN_DECIDED && p.clean / p.decided < PRECISION_TARGET) {
      const pct = Math.round((100 * p.clean) / p.decided);
      out.push({ key: `precision:${id}`, level: "warn", count: pct, text: `${id}: shadow precision ${pct}% over 7 days (${p.clean} of ${p.decided} person decisions approved without edits; the gate is ${Math.round(PRECISION_TARGET * 100)}%)` });
    }
    if (f.bans + f.holds > 0) out.push({ key: `safety_action:${id}`, level: "warn", count: f.bans + f.holds, bump: true, text: `${id}: ${f.bans} ban(s) and ${f.holds} hold(s) in 24 h` });
    if (n.backlog.outboundWaiting >= c.outboundBacklog) out.push({ key: `queue_outbound:${id}`, level: "warn", count: n.backlog.outboundWaiting, text: `${id}: ${n.backlog.outboundWaiting} message(s) waiting for delivery` });
    if (n.backlog.review >= c.reviewBacklog) out.push({ key: `queue_review:${id}`, level: "warn", count: n.backlog.review, text: `${id}: ${n.backlog.review} item(s) waiting for review` });
  }
  if ("error" in m.cost) out.push({ key: "cost_read", level: "warn", count: 1, text: `Could not read the cost ledger: ${m.cost.error}` });
  else for (const b of m.cost.budgets) {
    if (b.share < c.budgetWarnShare) continue;
    out.push({ key: `budget:${b.scope}`, level: b.share >= 1 ? "bad" : "warn", count: Math.round(b.share * 100), text: `Cost ${b.scope === "total" ? "for every app" : `for ${b.scope}`} today: $${b.usedUsd.toFixed(2)} of the $${b.budgetUsd.toFixed(2)} daily budget (${Math.round(b.share * 100)}%)` });
  }
  return out;
}

// ------------------------------------------------------------------ the dispatcher

export interface AlertState {
  key: string; level: AlertLevel; count: number; text: string; open: boolean; firstAt: number; lastAt: number;
  lastSentAt?: number; lastSentLevel?: AlertLevel; lastSentCount?: number;
}
export interface AlertTx {
  load(): Promise<AlertState[]>;
  save(states: AlertState[]): Promise<void>;
  postsSince(t: number): Promise<number>;
  recordPost(at: number, alerts: number, ok: boolean): Promise<void>;
}
export interface AlertStore {
  /** Run `fn` while no other replica runs it; undefined when another one holds the lock. */
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

/** network.ops_alerts and network.ops_alert_posts (migration 0020), under a transaction-level advisory lock. */
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

export interface Notice { key: string; level: AlertLevel; count: number; text: string; state: "firing" | "resolved" }
export interface DispatchResult { notices: Notice[]; posted: boolean; ok: boolean; held: number; open: { key: string; level: AlertLevel; count: number }[]; postsLastHour: number }

const RANK: Record<AlertLevel, number> = { warn: 1, bad: 2 };

export class AlertDispatcher {
  constructor(private o: {
    store: AlertStore;
    /** Deliver one body; true when the target took it (2xx). */
    post: (body: Record<string, unknown>) => Promise<boolean>;
    now: () => number;
    repeatMs: number;
    maxPostsPerHour: number;
    format: "json" | "slack";
    env: string;
    build: string;
  }) {}

  /** One round: compare the current alerts with the stored ones, post what is new, worse, due again or resolved. Undefined: another replica runs it. */
  dispatch(current: Alert[]): Promise<DispatchResult | undefined> {
    return this.o.store.exclusive(async tx => {
      const now = this.o.now();
      const states = new Map((await tx.load()).map(s => [s.key, s]));
      const notices: Notice[] = [];
      const firing: AlertState[] = [];
      const seen = new Set<string>();
      for (const a of current) {
        seen.add(a.key);
        const prev = states.get(a.key);
        const s: AlertState = prev?.open
          ? { ...prev, level: a.level, count: a.count, text: a.text, lastAt: now }
          : { key: a.key, level: a.level, count: a.count, text: a.text, open: true, firstAt: now, lastAt: now };
        const due = s.lastSentAt === undefined
          || RANK[a.level] > RANK[s.lastSentLevel ?? "warn"]
          || (!!a.bump && a.count > (s.lastSentCount ?? 0))
          || now - s.lastSentAt >= this.o.repeatMs;
        states.set(a.key, s);
        if (due) { notices.push({ key: a.key, level: a.level, count: a.count, text: a.text, state: "firing" }); firing.push(s); }
      }
      const resolved: AlertState[] = [];
      for (const s of states.values()) {
        if (!s.open || seen.has(s.key)) continue;
        // Never posted (it started and ended between rate-limited rounds): close it quietly.
        if (s.lastSentAt === undefined) { s.open = false; continue; }
        resolved.push(s);
        notices.push({ key: s.key, level: s.level, count: s.count, text: s.text, state: "resolved" });
      }
      let posted = false, ok = false, held = 0;
      let postsLastHour = await tx.postsSince(now - HOUR);
      if (notices.length) {
        if (postsLastHour >= this.o.maxPostsPerHour) held = notices.length;
        else {
          posted = true;
          ok = await this.o.post(this.body(notices)).catch(() => false);
          await tx.recordPost(now, notices.length, ok);
          postsLastHour++;
          if (ok) {
            for (const s of firing) { s.lastSentAt = now; s.lastSentLevel = s.level; s.lastSentCount = s.count; }
            for (const s of resolved) s.open = false;
          }
        }
      }
      await tx.save([...states.values()]);
      const open = [...states.values()].filter(s => s.open).map(s => ({ key: s.key, level: s.level, count: s.count }));
      return { notices, posted, ok, held, open, postsLastHour };
    });
  }

  body(notices: Notice[]): Record<string, unknown> {
    const firing = notices.filter(n => n.state === "firing"), done = notices.filter(n => n.state === "resolved");
    const head = `[${this.o.env}] The Network: ${firing.length} alert(s)${done.length ? `, ${done.length} resolved` : ""}`;
    const lines = [...firing.map(n => `${n.level === "bad" ? "BAD" : "warn"}: ${n.text}`), ...done.map(n => `resolved: ${n.text}`)];
    const text = [head, ...lines].join("\n");
    return this.o.format === "slack" ? { text } : { text, source: "the-network-backend", env: this.o.env, build: this.o.build, alerts: notices };
  }
}

/** A JSON POST with a 5 s timeout: true on 2xx. The URL is never logged (it is a secret for Slack). */
export function webhookPoster(url: string, fetchFn: typeof fetch = fetch): (body: Record<string, unknown>) => Promise<boolean> {
  return async body => {
    const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
    await r.arrayBuffer().catch(() => undefined);
    return r.ok;
  };
}

// ------------------------------------------------------------------ the runner

export interface OpsDeps {
  config: OpsConfig;
  probes: () => NetworkProbe[];
  cost?: Pick<CostLedger, "totals" | "accrue">;
  store: AlertStore;
  now: () => number;
  log: { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
  /** Overrides the webhook (the simulation passes a fake; no real call). */
  post?: (body: Record<string, unknown>) => Promise<boolean>;
  /** The heartbeat GET (default fetch with a 5 s timeout). */
  ping?: (url: string) => Promise<boolean>;
}

export function createOps(d: OpsDeps) {
  const c = d.config;
  const post = d.post ?? (c.webhookUrl ? webhookPoster(c.webhookUrl) : async (body: Record<string, unknown>) => {
    // No webhook: one log line per notice, so the host's log alerts can pick them up.
    for (const a of (body.alerts as Notice[] | undefined) ?? []) d.log.warn("alert", { key: a.key, level: a.level, count: a.count, state: a.state, detail: a.text });
    return true;
  });
  const dispatcher = new AlertDispatcher({ store: d.store, post, now: d.now, repeatMs: c.repeatMs, maxPostsPerHour: c.maxPostsPerHour, format: c.webhookUrl ? c.webhookFormat : "json", env: c.env, build: c.build });
  const ping = d.ping ?? (async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok);
  let last: { at: number; metrics: OpsMetrics } | undefined;
  const startedAt = d.now();
  let lastRound = -Infinity;
  let lastAlerts: OpsMetrics["alerts"];

  /** One snapshot. `accrue`: write the daily accruals first (the ops round does; GET /ops/metrics only reads). */
  async function collect(accrue: boolean): Promise<OpsMetrics> {
    const now = d.now();
    const networks = await Promise.all(d.probes().map(p => collectNetwork(p, now)));
    let cost: OpsMetrics["cost"];
    try {
      const day = dayOf(now);
      if (d.cost && accrue) {
        // Today's and yesterday's rows (yesterday's SMS count is final once its day has ended).
        for (const [k, at] of [["today", now], ["yesterday", utcDayStart(now) - 1]] as const) {
          const fallbacks: Partial<Record<AppId, number>> = {};
          for (const n of networks) fallbacks[n.app as AppId] = (fallbacks[n.app as AppId] ?? 0) + n.smsByDay[k];
          // The line accrues for today only: a first boot does not charge the day before.
          await d.cost.accrue(dayOf(at), fallbacks, k === "today");
        }
      }
      const byApp = d.cost ? await d.cost.totals(day) : {};
      const totalUsd = Math.round(Object.values(byApp).reduce((s, x) => s + (x ?? 0), 0) * 10_000) / 10_000;
      cost = { day, totalUsd, byApp, budgets: budgetLines(byApp, c.budgets) };
    } catch (e) { cost = { error: (e as Error).message.slice(0, 200) }; }
    const m: OpsMetrics = { ok: true, at: now, env: c.env, build: c.build, uptimeMs: now - startedAt, networks, cost, ...(lastAlerts ? { alerts: lastAlerts } : {}) };
    last = { at: now, metrics: m };
    return m;
  }

  return {
    config: c,
    dispatcher,
    /** The snapshot for GET /ops/metrics: at most one collection every 15 s. */
    async metrics(): Promise<OpsMetrics> {
      if (last && d.now() - last.at < 15_000) return last.metrics;
      return collect(false);
    },
    /** One round (called from the backend tick; runs at most every OPS_EVERY_MS): collect, alert, heartbeat. */
    async tick(): Promise<DispatchResult | undefined> {
      const now = d.now();
      if (now - lastRound < c.everyMs) return undefined;
      lastRound = now;
      const m = await collect(true);
      const alerts = evaluate(m, c);
      const r = await dispatcher.dispatch(alerts);
      if (r) {
        lastAlerts = { open: r.open, postsLastHour: r.postsLastHour };
        if (r.notices.length) d.log.info("alerts", { notices: r.notices.length, posted: r.posted, ok: r.ok, held: r.held });
        if (r.posted && !r.ok) d.log.error("alert webhook failed", { notices: r.notices.length });
        if (r.held) d.log.warn("alerts held by the rate limit", { held: r.held, maxPerHour: c.maxPostsPerHour });
      }
      if (c.heartbeatUrl) await ping(c.heartbeatUrl).then(ok => { if (!ok) d.log.warn("heartbeat ping failed"); }, e => d.log.warn("heartbeat ping failed", { error: (e as Error).message }));
      return r;
    },
  };
}
export type Ops = ReturnType<typeof createOps>;
