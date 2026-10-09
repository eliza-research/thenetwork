// The cost ledger (PRD 36.4; critical path item 12; migration 0015).
//  - Every LLM HTTP attempt the backend makes is one row of network.llm_usage: the process usage
//    observer in core llm.ts (setUsageObserver) hands each ResponseInfo here, the rows are buffered and
//    written in batches. Model, tokens, cost and latency only: never a prompt, a reply or a member id.
//  - Blooio messages per day come from network.messages (sends handed to Blooio), rolled into
//    network.usage_daily by rollupMessages(); Workers AI calls are counted by the caller (countUsage).
//  - costSummary() adds them up for today and this month (UTC), per app, with the prices from the
//    environment; costAlerts() compares that to the founder's budget (80% and 100%).
// Budgets and unit prices are founder numbers. Unset, there is no budget alert and the cost of that
// kind counts as 0 (the summary says the price is unknown).
import type { SQL } from "bun";
import { DAY, setUsageObserver, type ResponseInfo } from "@thenetwork/core";

/** Sends Blooio took (statuses of the outbound queue after the hand-over; "failed" was attempted and is billed). */
export const BLOOIO_HANDED = ["accepted", "sent", "delivered", "read", "failed"] as const;
export type UsageKind = "blooio_message" | "workers_ai_call";

export interface Prices {
  /** USD per Blooio message (BLOOIO_COST_PER_MESSAGE_USD). */
  blooioMessageUsd?: number;
  /** USD per Workers AI call (WORKERS_AI_COST_PER_CALL_USD). */
  workersAiCallUsd?: number;
}
export interface Budget {
  /** COST_BUDGET_DAILY_USD: all apps, one UTC day. */
  dailyUsd?: number;
  /** COST_BUDGET_MONTHLY_USD: all apps, one UTC month. */
  monthlyUsd?: number;
  /** COST_TARGET_PER_MEMBER_USD: the target cost per active member per month (scorecard). */
  perMemberMonthUsd?: number;
}

const num = (v: string | undefined) => { const n = v === undefined || v.trim() === "" ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
export function pricesFromEnv(env: Record<string, string | undefined> = process.env): Prices {
  return { blooioMessageUsd: num(env.BLOOIO_COST_PER_MESSAGE_USD), workersAiCallUsd: num(env.WORKERS_AI_COST_PER_CALL_USD) };
}
export function budgetFromEnv(env: Record<string, string | undefined> = process.env): Budget {
  return { dailyUsd: num(env.COST_BUDGET_DAILY_USD), monthlyUsd: num(env.COST_BUDGET_MONTHLY_USD), perMemberMonthUsd: num(env.COST_TARGET_PER_MEMBER_USD) };
}

/** The start of the UTC day and month of `now`. */
export function periodStarts(now: number): { day: number; month: number } {
  const d = new Date(now);
  return { day: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), month: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) };
}
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The LLM part of the ledger. install() makes it the process usage observer; record() can also be
 * called directly (a client's own onResponse). Rows wait in memory until flush() (every flushMs, and
 * on close()); a failed write keeps them for the next flush, up to maxBuffered rows.
 */
export class CostLedger {
  private buf: Record<string, unknown>[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private uninstall?: () => void;
  constructor(private readonly o: { sql: SQL; now?: () => number; log?: (s: string) => void; flushMs?: number; maxBuffered?: number; defaultApp?: string }) {}

  record(info: ResponseInfo, ctx: { purpose?: string; app?: string } = {}) {
    // An attempt that never reached a provider (no status, no tokens) cost nothing; it still shows as a failure.
    this.buf.push({
      at: new Date(this.o.now?.() ?? Date.now()), app_id: (ctx.app || this.o.defaultApp || "platform").slice(0, 32), purpose: (ctx.purpose || "other").slice(0, 64),
      model: String(info.model).slice(0, 128), ok: info.ok, tokens_in: info.usage.promptTokens | 0, tokens_out: info.usage.completionTokens | 0,
      cost_micro: Math.round(info.costMicro || 0), cost_known: info.costKnown, latency_ms: Math.round(info.latencyMs || 0),
    });
    const max = this.o.maxBuffered ?? 10_000;
    if (this.buf.length > max) this.buf.splice(0, this.buf.length - max);
  }

  get pending() { return this.buf.length; }

  async flush(): Promise<number> {
    const rows = this.buf.splice(0);
    if (!rows.length) return 0;
    try {
      for (let i = 0; i < rows.length; i += 500) await this.o.sql`insert into network.llm_usage ${this.o.sql(rows.slice(i, i + 500))}`;
      return rows.length;
    } catch (e) {
      this.buf.unshift(...rows);
      this.o.log?.(`[costs] llm_usage write failed, ${rows.length} row(s) kept: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Become the process usage observer and flush every flushMs (default 60 s). Returns the uninstall function. */
  install(): () => void {
    const prev = setUsageObserver((info, ctx) => this.record(info, ctx));
    this.timer = setInterval(() => void this.flush(), this.o.flushMs ?? 60_000);
    (this.timer as { unref?: () => void }).unref?.();
    this.uninstall = () => { setUsageObserver(prev); if (this.timer) clearInterval(this.timer); this.timer = undefined; };
    return this.uninstall;
  }

  async close() { this.uninstall?.(); await this.flush(); }
}

/** Add to a daily counter (a Workers AI call, or a Blooio message counted at the source). */
export async function countUsage(sql: SQL, o: { app: string; kind: UsageKind; at: number; n?: number; costMicro?: number }) {
  const n = o.n ?? 1, cost = Math.round(o.costMicro ?? 0);
  await sql`insert into network.usage_daily (day, app_id, kind, n, cost_micro) values (${isoDay(o.at)}::date, ${o.app}, ${o.kind}, ${n}, ${cost})
    on conflict (day, app_id, kind) do update set n = network.usage_daily.n + excluded.n, cost_micro = network.usage_daily.cost_micro + excluded.cost_micro`;
}

/** The apps on the platform (platform.apps). */
export async function appIds(sql: SQL): Promise<string[]> {
  return ((await sql`select id from platform.apps order by id`) as { id: string }[]).map(r => r.id);
}

/** An app-scoped transaction (row-level security under network_service shows this app's rows only). */
export function scopedTo<T>(sql: SQL, app: string, fn: (tx: SQL) => Promise<T>): Promise<T> {
  return sql.begin(async tx => { await tx`select set_config('app.app_id', ${app}, true)`; return fn(tx); }) as Promise<T>;
}

/**
 * Blooio messages of one UTC day per app, from network.messages (sends handed to Blooio), written as
 * that day's blooio_message counter (set, not added: running it again gives the same row).
 */
export async function rollupMessages(sql: SQL, at: number, prices: Prices = {}): Promise<Record<string, number>> {
  const { day } = periodStarts(at);
  const out: Record<string, number> = {};
  for (const app of await appIds(sql)) {
    const [r] = await scopedTo(sql, app, tx => tx`select count(*)::int as n from network.messages where app_id = ${app} and direction = 'outbound'
      and status = any(${`{${BLOOIO_HANDED.join(",")}}`}::text[]) and ts >= ${new Date(day)} and ts < ${new Date(day + DAY)}`);
    const n = (r as { n: number }).n;
    out[app] = n;
    const cost = Math.round(n * (prices.blooioMessageUsd ?? 0) * 1e6);
    if (n > 0) await sql`insert into network.usage_daily (day, app_id, kind, n, cost_micro) values (${isoDay(day)}::date, ${app}, 'blooio_message', ${n}, ${cost})
      on conflict (day, app_id, kind) do update set n = excluded.n, cost_micro = excluded.cost_micro`;
  }
  return out;
}

export interface CostPeriod { llmUsd: number; llmCalls: number; llmUnpriced: number; blooioMessages: number; blooioUsd: number; workersAiCalls: number; workersAiUsd: number; totalUsd: number }
export interface CostSummary {
  at: number;
  day: CostPeriod; month: CostPeriod;
  /** This month per app (LLM rows with no app are "platform"). */
  byApp: Record<string, CostPeriod>;
  /** Kinds whose price is not set (their cost counts as 0). */
  unpriced: UsageKind[];
}
const zero = (): CostPeriod => ({ llmUsd: 0, llmCalls: 0, llmUnpriced: 0, blooioMessages: 0, blooioUsd: 0, workersAiCalls: 0, workersAiUsd: 0, totalUsd: 0 });
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Spend today and this month (UTC), from network.llm_usage and network.usage_daily. */
export async function costSummary(sql: SQL, now: number, prices: Prices = {}): Promise<CostSummary> {
  const { day, month } = periodStarts(now);
  const [llm, daily] = await Promise.all([
    sql`select app_id, at >= ${new Date(day)} as today, count(*)::int as calls, coalesce(sum(cost_micro), 0)::bigint as micro,
        count(*) filter (where not cost_known and (tokens_in > 0 or tokens_out > 0))::int as unpriced
        from network.llm_usage where at >= ${new Date(month)} and at <= ${new Date(now)} group by 1, 2`,
    sql`select app_id, day = ${isoDay(day)}::date as today, kind, sum(n)::int as n, sum(cost_micro)::bigint as micro
        from network.usage_daily where day >= ${isoDay(month)}::date and day <= ${isoDay(now)}::date group by 1, 2, 3`,
  ]);
  const out: CostSummary = { at: now, day: zero(), month: zero(), byApp: {}, unpriced: [] };
  const add = (p: CostPeriod, f: (p: CostPeriod) => void) => f(p);
  const targets = (app: string, today: boolean) => [out.month, (out.byApp[app] ??= zero()), ...(today ? [out.day] : [])];
  for (const r of llm as any[]) for (const p of targets(r.app_id, r.today)) add(p, p => { p.llmCalls += r.calls; p.llmUsd += Number(r.micro) / 1e6; p.llmUnpriced += r.unpriced; });
  for (const r of daily as any[]) for (const p of targets(r.app_id, r.today)) add(p, p => {
    // A counter written without a price (cost 0) is priced here when the price is known.
    if (r.kind === "blooio_message") { p.blooioMessages += r.n; p.blooioUsd += Number(r.micro) > 0 ? Number(r.micro) / 1e6 : r.n * (prices.blooioMessageUsd ?? 0); }
    else { p.workersAiCalls += r.n; p.workersAiUsd += Number(r.micro) > 0 ? Number(r.micro) / 1e6 : r.n * (prices.workersAiCallUsd ?? 0); }
  });
  for (const p of [out.day, out.month, ...Object.values(out.byApp)]) {
    p.llmUsd = r6(p.llmUsd); p.blooioUsd = r6(p.blooioUsd); p.workersAiUsd = r6(p.workersAiUsd);
    p.totalUsd = r6(p.llmUsd + p.blooioUsd + p.workersAiUsd);
  }
  if (prices.blooioMessageUsd === undefined) out.unpriced.push("blooio_message");
  if (prices.workersAiCallUsd === undefined) out.unpriced.push("workers_ai_call");
  return out;
}

export interface CostAlert { level: "warn" | "bad"; key: string; text: string; count: number }

/** 80% (warn) and 100% (bad) of the daily and monthly budget. No budget set: no alert. */
export function costAlerts(s: CostSummary, b: Budget): CostAlert[] {
  const out: CostAlert[] = [];
  const check = (period: "daily" | "monthly", spent: number, budget: number | undefined) => {
    if (budget === undefined || budget <= 0) return;
    const share = spent / budget, pct = Math.round(share * 100);
    if (share >= 1) out.push({ level: "bad", key: `cost_${period}_100`, count: pct, text: `Spend is at ${pct}% of the ${period} budget ($${spent.toFixed(2)} of $${budget.toFixed(2)})` });
    else if (share >= 0.8) out.push({ level: "warn", key: `cost_${period}_80`, count: pct, text: `Spend is at ${pct}% of the ${period} budget ($${spent.toFixed(2)} of $${budget.toFixed(2)})` });
  };
  check("daily", s.day.totalUsd, b.dailyUsd);
  check("monthly", s.month.totalUsd, b.monthlyUsd);
  return out;
}

/** Members of an app who sent a message in the last 30 days (the "active member" of cost per active member). */
export async function activeMembers(sql: SQL, app: string, now: number): Promise<number> {
  const [r] = await scopedTo(sql, app, tx => tx`select count(distinct member_id)::int as n from network.messages
    where app_id = ${app} and direction = 'inbound' and ts >= ${new Date(now - 30 * DAY)} and ts <= ${new Date(now)}`);
  return (r as { n: number }).n;
}
