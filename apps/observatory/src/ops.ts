// The console's cost panel (mvp-plan item 12; docs/deploy.md section 7.3). It reads network.cost_ledger
// (migration 0020) through the app's own read login (OBSERVATORY_DATABASE_URL_<APP>, else the shared
// login), read-only. Row-level security shows each app's read role its own rows and the shared ones
// (the line). The budgets are the backend's COST_BUDGET_DAILY_USD[_<APP>]: set the same values on the
// console service. Real mode only: game mode has no costs.
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { budgetLines, costBudgetsFromEnv, dayOf, type BudgetLine, type CostApp } from "../../../packages/network/service/cost.ts";
import { appUrlEnv, type AppId } from "./apps.ts";
import { peopleUrl } from "./people.ts";

export interface CostDay { day: string; total: number; byKind: Record<string, number> }
export interface LlmTelemetrySummary {
  calls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitRate: number;
  fallbacks: number;
  regrows: number;
  latencyMs: { avg: number; p50: number; p95: number; max: number } | null;
}
export interface CostSummary {
  app: AppId;
  /** Newest first, the last `days` UTC days that have rows. */
  days: CostDay[];
  today: { day: string; app: number; shared: number };
  /** The budgets set on this service (COST_BUDGET_DAILY_USD for every app is shown only to admin@*). */
  budgets: BudgetLine[];
  /** Share of the period's cost that is an estimate (a fixed rate, not a provider's own price). */
  estimatedShare: number;
  /** Quantities in the period by kind: codes sent, photos rated, LLM calls, SMS, line-days. */
  quantities: Record<string, number>;
  llm: LlmTelemetrySummary;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export class CostView {
  private pools = new Map<string, SQL>();
  constructor(
    private urlFor: (app: AppId) => string | undefined = app => process.env[appUrlEnv(app)] ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL,
    private everyAppUrl: () => string | undefined = () => peopleUrl(),
  ) {}

  private sql(url: string | undefined): SQL | undefined {
    if (!url) return undefined;
    let s = this.pools.get(url);
    if (!s) {
      s = new SQL({ url, max: 1, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory-cost", statement_timeout: "10000" } });
      this.pools.set(url, s);
    }
    return s;
  }

  /** The app's cost by day and kind for the last `days` days, and today's use of each budget. `everyApp`: the caller may see the total budget. */
  async summary(app: AppId, now: number, o: { days?: number; everyApp?: boolean; env?: Record<string, string | undefined> } = {}): Promise<CostSummary | undefined> {
    const sql = this.sql(this.urlFor(app));
    if (!sql) return undefined;
    const days = Math.min(90, Math.max(1, o.days ?? 14));
    const from = dayOf(now - (days - 1) * 86_400_000), today = dayOf(now);
    const rows = await sql`select day::text as day, app_id, kind, sum(cost_usd)::float8 as usd, sum(quantity)::float8 as qty, sum(case when estimated then cost_usd else 0 end)::float8 as est
      from network.cost_ledger where day >= ${from}::date and app_id in (${app}, 'shared') group by 1, 2, 3 order by 1 desc, 2, 3` as { day: string; app_id: string; kind: string; usd: number; qty: number; est: number }[];
    const byDay = new Map<string, CostDay>();
    const quantities: Record<string, number> = {};
    let total = 0, est = 0;
    const todayUse = { day: today, app: 0, shared: 0 };
    for (const r of rows) {
      const d = byDay.get(r.day) ?? { day: r.day, total: 0, byKind: {} };
      d.total += r.usd;
      d.byKind[r.kind] = (d.byKind[r.kind] ?? 0) + r.usd;
      byDay.set(r.day, d);
      quantities[r.kind] = (quantities[r.kind] ?? 0) + r.qty;
      total += r.usd; est += r.est;
      if (r.day === today) { if (r.app_id === "shared") todayUse.shared += r.usd; else todayUse.app += r.usd; }
    }
    // Today's totals for the budget lines: this app (and the shared line) only; the total budget needs every app's rows.
    const b = costBudgetsFromEnv(o.env ?? process.env);
    let totals: Partial<Record<CostApp, number>> = { [app]: todayUse.app, shared: todayUse.shared };
    const every = o.everyApp && b.daily !== undefined ? this.sql(this.everyAppUrl()) : undefined;
    if (every) {
      const all = await every`select app_id, sum(cost_usd)::float8 as usd from network.cost_ledger where day = ${today}::date group by 1` as { app_id: CostApp; usd: number }[];
      totals = Object.fromEntries(all.map(r => [r.app_id, r.usd]));
    }
    const budgets = budgetLines(totals, { daily: every ? b.daily : undefined, byApp: { ...(b.byApp[app] !== undefined ? { [app]: b.byApp[app] } : {}) } });
    const llmRows = await sql`select
      count(*)::int as calls,
      coalesce(sum(case when (detail->>'promptTokens') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'promptTokens')::double precision end), 0)::float8 as prompt_tokens,
      coalesce(sum(case when (detail->>'cachedPromptTokens') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'cachedPromptTokens')::double precision end), 0)::float8 as cached_prompt_tokens,
      coalesce(sum(case when (detail->>'cacheWriteTokens') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'cacheWriteTokens')::double precision end), 0)::float8 as cache_write_tokens,
      coalesce(sum(case when (detail->>'completionTokens') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'completionTokens')::double precision end), 0)::float8 as completion_tokens,
      coalesce(sum(case when (detail->>'reasoningTokens') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'reasoningTokens')::double precision end), 0)::float8 as reasoning_tokens,
      coalesce(sum(case when (detail->>'fallbackCount') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'fallbackCount')::double precision end), 0)::float8 as fallbacks,
      coalesce(sum(case when (detail->>'regrows') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'regrows')::double precision end), 0)::float8 as regrows,
      avg(case when (detail->>'latencyMs') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'latencyMs')::double precision end)::float8 as avg_latency_ms,
      percentile_cont(0.5) within group (order by (detail->>'latencyMs')::double precision)
        filter (where (detail->>'latencyMs') ~ '^[0-9]+(\.[0-9]+)?$')::float8 as p50_latency_ms,
      percentile_cont(0.95) within group (order by (detail->>'latencyMs')::double precision)
        filter (where (detail->>'latencyMs') ~ '^[0-9]+(\.[0-9]+)?$')::float8 as p95_latency_ms,
      max(case when (detail->>'latencyMs') ~ '^[0-9]+(\.[0-9]+)?$' then (detail->>'latencyMs')::double precision end)::float8 as max_latency_ms
      from network.cost_ledger where day >= ${from}::date and app_id in (${app}, 'shared') and kind = 'llm'` as {
        calls: number; prompt_tokens: number; cached_prompt_tokens: number; cache_write_tokens: number;
        completion_tokens: number; reasoning_tokens: number; fallbacks: number; regrows: number;
        avg_latency_ms: number | null; p50_latency_ms: number | null; p95_latency_ms: number | null; max_latency_ms: number | null;
      }[];
    const lm = llmRows[0];
    const promptTokens = Number(lm?.prompt_tokens ?? 0);
    const cachedPromptTokens = Number(lm?.cached_prompt_tokens ?? 0);
    const avgLatency = lm?.avg_latency_ms ?? null;
    const llm: LlmTelemetrySummary = {
      calls: Number(lm?.calls ?? 0),
      promptTokens,
      cachedPromptTokens,
      cacheWriteTokens: Number(lm?.cache_write_tokens ?? 0),
      completionTokens: Number(lm?.completion_tokens ?? 0),
      reasoningTokens: Number(lm?.reasoning_tokens ?? 0),
      cacheHitRate: promptTokens > 0 ? r4(cachedPromptTokens / promptTokens) : 0,
      fallbacks: Number(lm?.fallbacks ?? 0),
      regrows: Number(lm?.regrows ?? 0),
      latencyMs: avgLatency !== null ? {
        avg: Math.round(avgLatency),
        p50: Math.round(lm?.p50_latency_ms ?? avgLatency),
        p95: Math.round(lm?.p95_latency_ms ?? avgLatency),
        max: Math.round(lm?.max_latency_ms ?? avgLatency),
      } : null,
    };
    // Round for display only after aggregation and budget shares use the unrounded totals.
    for (const d of byDay.values()) {
      d.total = r4(d.total);
      for (const kind of Object.keys(d.byKind)) d.byKind[kind] = r4(d.byKind[kind]!);
    }
    todayUse.app = r4(todayUse.app); todayUse.shared = r4(todayUse.shared);
    return { app, days: [...byDay.values()], today: todayUse, budgets, estimatedShare: total > 0 ? r4(est / total) : 0, quantities, llm };
  }

  async close() { for (const s of this.pools.values()) await s.close().catch(() => {}); this.pools.clear(); }
}
