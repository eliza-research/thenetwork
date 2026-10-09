// The console's cost panel (mvp-plan item 12; docs/deploy.md section 7.3). It reads network.cost_ledger
// (migration 0020) through the app's own read login (OBSERVATORY_DATABASE_URL_<APP>, else the shared
// login), read-only. Row-level security shows each app's read role its own rows and the shared ones
// (the line). The budgets are the backend's COST_BUDGET_DAILY_USD[_<APP>]: set the same values on the
// console service. Real mode only: game mode has no costs.
import { SQL } from "bun";
import { budgetLines, costBudgetsFromEnv, dayOf, type BudgetLine, type CostApp } from "../../network/service/cost.ts";
import { appUrlEnv, type AppId } from "./apps.ts";

export interface CostDay { day: string; total: number; byKind: Record<string, number> }
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
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export class CostView {
  private pools = new Map<string, SQL>();
  constructor(private urlFor: (app: AppId) => string | undefined = app => process.env[appUrlEnv(app)] ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL) {}

  private sql(app: AppId): SQL | undefined {
    const url = this.urlFor(app);
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
    const sql = this.sql(app);
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
      d.total = r4(d.total + r.usd);
      d.byKind[r.kind] = r4((d.byKind[r.kind] ?? 0) + r.usd);
      byDay.set(r.day, d);
      quantities[r.kind] = (quantities[r.kind] ?? 0) + r.qty;
      total += r.usd; est += r.est;
      if (r.day === today) { if (r.app_id === "shared") todayUse.shared = r4(todayUse.shared + r.usd); else todayUse.app = r4(todayUse.app + r.usd); }
    }
    // Today's totals for the budget lines: this app (and the shared line) only; the total budget needs every app's rows.
    const b = costBudgetsFromEnv(o.env ?? process.env);
    let totals: Partial<Record<CostApp, number>> = { [app]: todayUse.app, shared: todayUse.shared };
    if (o.everyApp && b.daily !== undefined) {
      const all = await sql`select app_id, sum(cost_usd)::float8 as usd from network.cost_ledger where day = ${today}::date group by 1` as { app_id: CostApp; usd: number }[];
      totals = Object.fromEntries(all.map(r => [r.app_id, r.usd]));
    }
    const budgets = budgetLines(totals, { daily: o.everyApp ? b.daily : undefined, byApp: { ...(b.byApp[app] !== undefined ? { [app]: b.byApp[app] } : {}) } });
    return { app, days: [...byDay.values()], today: todayUse, budgets, estimatedShare: total > 0 ? r4(est / total) : 0, quantities };
  }

  async close() { for (const s of this.pools.values()) await s.close().catch(() => {}); this.pools.clear(); }
}
