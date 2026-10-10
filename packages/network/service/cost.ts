// The cost ledger (mvp-plan item 12; docs/deploy.md section 7.3). What the backend spends, estimated
// per event, per app and per day, in network.cost_ledger (migration 0020). The service wraps the
// paid calls it makes with this module; the backend's ops tick adds the daily accruals and checks the
// budgets (deploy/backend/ops.ts).
//
//   kind           what is counted                                   price (USD, env override)
//   otp_verify     one Twilio Verify code sent (a phone login)        0.058   COST_TWILIO_VERIFY_USD
//   photo_rating   one Clef rating try, per photo sent (up to 4)       0.000425 COST_CLEF_PHOTO_USD (0.0017 for a member's 4 photos)
//   llm            one LLM HTTP attempt (core onResponse costMicro)   the provider's own price (Surplus reports it)
//   other          one relay Clef classifier call to Workers AI       COST_CLEF_RELAY_USD per call, else the engine's list price
//                  (provider workers_ai, detail.purpose             per input token (relayClefCost: clef-flash 0.09 USD per M)
//                  "relay_classifier"; relayClefEvent)
//   sms_fallback   one outbound message stored as fell_back (SMS)     0.0083  COST_SMS_USD
//   blooio_line    one line for one day                              COST_BLOOIO_LINE_MONTHLY_USD / 30 (no default: from the contract)
//
// Rows hold codes and counts only: never a member id, a phone number or text. A write failure is
// logged and never fails the call it measures. Network code reads time from the Clock only.
//
// The relay classifier rows use kind "other": migration 0020 allows only the kinds below in its check
// constraint, and a dedicated `workers_ai_call` kind needs a new migration (the observatory owns them).
//
// LLM calls: the service has no production LLM client today. It never builds defaultLLM() or
// llmUnderstand (the ConsentNetwork's `understand` is unset, so member texts are read by the offline
// rules), and slop onboarding uses the engine's rule reader `extractSlopProfile` (no LLM reader). The
// member conversation runs in Eliza, upstream. A service-side client added later must pass
// `ledger.llmHooks(app, purpose)` with the real app and purpose (for example "understand",
// "slop_onboarding"); packages/network/test/cost.integration.test.ts checks the row it writes.
import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import type { Clock } from "@thenetwork/core";
import type { ClientOptions, ResponseInfo } from "@thenetwork/core";
import type { AppId, AppInfo } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { retryParts, withRetry, type PhotoRater } from "../../platform/src/photos.ts";
import { estimateRelayClefTokens, relayClefCost, type RelayClefEvent } from "../../engine/src/relayClef.ts";

export type CostKind = "llm" | "photo_rating" | "otp_verify" | "blooio_line" | "sms_fallback" | "other";
/** An app, or "shared" for a cost no single app owns (the line). */
export type CostApp = AppId | "shared";

export interface CostRow {
  id: string; app: CostApp; day: string; at: number; kind: CostKind; provider: string;
  quantity: number; unitCostUsd: number | null; costUsd: number; estimated: boolean; detail: Record<string, string | number | boolean>;
}

export interface CostRates {
  twilioVerifyUsd: number;
  clefPhotoUsd: number;
  smsUsd: number;
  /** One Blooio line for a month. Undefined: not accrued (the price is not known yet). */
  blooioLineMonthlyUsd?: number;
  blooioLines: number;
  /** One relay Clef classifier call. Undefined: priced per input token at the engine's list price for the model. */
  clefRelayUsd?: number;
}

export const DEFAULT_RATES: CostRates = { twilioVerifyUsd: 0.058, clefPhotoUsd: 0.0017 / 4, smsUsd: 0.0083, blooioLines: 1 };
const DAYS_PER_MONTH = 30;

type Env = Record<string, string | undefined>;
const num = (env: Env, k: string): number | undefined => {
  const v = env[k];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a number of US dollars, 0 or more (got ${JSON.stringify(v)})`);
  return n;
};

/** The prices, with the COST_* overrides. */
export function costRatesFromEnv(env: Env = process.env): CostRates {
  return {
    twilioVerifyUsd: num(env, "COST_TWILIO_VERIFY_USD") ?? DEFAULT_RATES.twilioVerifyUsd,
    clefPhotoUsd: num(env, "COST_CLEF_PHOTO_USD") ?? DEFAULT_RATES.clefPhotoUsd,
    smsUsd: num(env, "COST_SMS_USD") ?? DEFAULT_RATES.smsUsd,
    blooioLineMonthlyUsd: num(env, "COST_BLOOIO_LINE_MONTHLY_USD"),
    blooioLines: num(env, "COST_BLOOIO_LINES") ?? DEFAULT_RATES.blooioLines,
    clefRelayUsd: num(env, "COST_CLEF_RELAY_USD"),
  };
}

/** Daily budgets: COST_BUDGET_DAILY_USD for everything, COST_BUDGET_DAILY_USD_<APP> per app (optional). */
export interface CostBudgets { daily?: number; byApp: Partial<Record<CostApp, number>> }
export function costBudgetsFromEnv(env: Env = process.env, apps: readonly string[] = ["ntwrk", "slop", "peon", "friends", "shared"]): CostBudgets {
  const byApp: Partial<Record<CostApp, number>> = {};
  for (const a of apps) { const v = num(env, `COST_BUDGET_DAILY_USD_${a.toUpperCase()}`); if (v !== undefined) byApp[a as CostApp] = v; }
  return { daily: num(env, "COST_BUDGET_DAILY_USD"), byApp };
}

/** The ledger's day: the UTC date of a time (YYYY-MM-DD). */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Where rows go: Postgres in the service, an array in the simulation. */
export interface CostSink {
  /** Insert rows; a row whose id exists is replaced (daily accruals are written again each tick). */
  write(rows: CostRow[]): Promise<void>;
  /** Total per app for one day. */
  totals(day: string): Promise<Partial<Record<CostApp, number>>>;
}

export class MemoryCostSink implements CostSink {
  readonly rows = new Map<string, CostRow>();
  async write(rows: CostRow[]) { for (const r of rows) this.rows.set(r.id, r); }
  async totals(day: string) {
    const out: Partial<Record<CostApp, number>> = {};
    for (const r of this.rows.values()) if (r.day === day) out[r.app] = (out[r.app] ?? 0) + r.costUsd;
    return out;
  }
}

/** network.cost_ledger (migration 0020). The service login writes it (row-level security: network_service sees every row). */
export class PgCostSink implements CostSink {
  constructor(private sql: SQL) {}
  async write(rows: CostRow[]) {
    for (const r of rows) {
      await this.sql`insert into network.cost_ledger (id, app_id, day, at, kind, provider, quantity, unit_cost_usd, cost_usd, estimated, detail)
        values (${r.id}, ${r.app}, ${r.day}, ${new Date(r.at)}, ${r.kind}, ${r.provider}, ${r.quantity}, ${r.unitCostUsd}, ${r.costUsd}, ${r.estimated}, ${r.detail}::jsonb)
        on conflict (id) do update set at = excluded.at, quantity = excluded.quantity, unit_cost_usd = excluded.unit_cost_usd, cost_usd = excluded.cost_usd, detail = excluded.detail`;
    }
  }
  async totals(day: string) {
    const out: Partial<Record<CostApp, number>> = {};
    for (const r of await this.sql`select app_id, sum(cost_usd)::float8 as usd from network.cost_ledger where day = ${day} group by app_id` as { app_id: CostApp; usd: number }[]) out[r.app_id] = r.usd;
    return out;
  }
}

export interface CostEvent {
  app: CostApp; kind: CostKind; provider: string; costUsd: number;
  quantity?: number; unitCostUsd?: number; estimated?: boolean; detail?: CostRow["detail"];
}

export class CostLedger {
  readonly rates: CostRates;
  private readonly log: (line: string) => void;
  constructor(private o: { sink: CostSink; clock: Clock; rates?: CostRates; log?: (line: string) => void }) {
    this.rates = o.rates ?? DEFAULT_RATES;
    this.log = o.log ?? (() => {});
  }

  /** One costed event. Never throws: a failed write is logged. */
  async record(e: CostEvent): Promise<void> {
    const at = this.o.clock.now();
    const row: CostRow = {
      id: `cost_${randomUUID()}`, app: e.app, day: dayOf(at), at, kind: e.kind, provider: e.provider,
      quantity: e.quantity ?? 1, unitCostUsd: e.unitCostUsd ?? null, costUsd: Math.max(0, e.costUsd), estimated: e.estimated ?? true, detail: e.detail ?? {},
    };
    await this.o.sink.write([row]).catch(err => this.log(`[cost] a ${e.kind} row was not written: ${(err as Error).message}`));
  }

  /** The OTP provider, with one otp_verify row per code sent by Twilio Verify (the dev console provider costs nothing). */
  meterOtp(p: OtpProvider): OtpProvider {
    if (!p.name.startsWith("twilio")) return p;
    const ledger = this;
    return {
      name: p.name,
      async send(e164: string, app: AppInfo) {
        const r = await p.send(e164, app);
        // Not awaited: the row's write never changes how long a login request takes (no enumeration by time).
        void ledger.record({ app: app.id, kind: "otp_verify", provider: p.name, costUsd: ledger.rates.twilioVerifyUsd, unitCostUsd: ledger.rates.twilioVerifyUsd });
        return r;
      },
      ...(p.check ? { check: (e164: string, code: string, ref?: string | null) => p.check!(e164, code, ref) } : {}),
    };
  }

  /**
   * The appearance rater, with one photo_rating row per rater call that reached the model, each try
   * counted on its own (a rater wrapped in withRetry is metered inside the retry, so three tries are
   * three rows): the price of one photo times the photos sent (Clef: 0.0017 USD for a member's 4
   * photos). A refusal (null: not a verified adult) reached nothing and costs nothing; an error is counted.
   */
  meterRater(r: PhotoRater, app: AppId = "slop"): PhotoRater {
    if (r.id === "none") return r;
    const parts = retryParts(r);
    if (parts) return withRetry(this.meterRater(parts.inner, app), parts.options);
    const ledger = this;
    return {
      id: r.id,
      async rate(subject, photos) {
        let charged = true;
        try { const s = await r.rate(subject, photos); charged = s !== null; return s; }
        finally {
          if (charged) {
            const n = Math.max(1, photos.length), unit = ledger.rates.clefPhotoUsd;
            await ledger.record({ app, kind: "photo_rating", provider: r.id, quantity: n, unitCostUsd: unit, costUsd: unit * n });
          }
        }
      },
    };
  }

  /**
   * The relay classifier's telemetry (engine relayClef.ts `onEvent`) for one app: one row per Clef call
   * that went to Workers AI ("ok", and "error" or "timeout", which may still be billed). A cached answer
   * or a miss made no call and costs nothing. The event never carries text; the row holds the model,
   * the outcome and the token count only.
   */
  relayClefEvent(app: CostApp): (e: RelayClefEvent) => void {
    return e => {
      if (e.outcome !== "ok" && e.outcome !== "error" && e.outcome !== "timeout") return;
      const unit = this.rates.clefRelayUsd ?? relayClefCost(e.inputTokens ?? estimateRelayClefTokens(""), e.model);
      void this.record({
        app, kind: "other", provider: "workers_ai", costUsd: unit, unitCostUsd: unit,
        detail: { purpose: "relay_classifier", model: e.model, outcome: e.outcome, ...(e.inputTokens ? { inputTokens: e.inputTokens } : {}) },
      });
    };
  }

  /**
   * Hooks for a core LLM client (defaultLLM(ledger.llmHooks(app, "understand"))): one llm row per
   * HTTP attempt that the provider priced. Attempts with no cost (a timeout, a 5xx) write nothing.
   */
  llmHooks(app: CostApp, purpose: string): Pick<ClientOptions, "onResponse"> {
    return {
      onResponse: (i: ResponseInfo) => {
        if (!(i.costMicro > 0)) return;
        void this.record({
          app, kind: "llm", provider: new URL(i.baseUrl).hostname, costUsd: i.costMicro / 1e6, estimated: !i.costKnown,
          detail: { purpose, model: i.model, promptTokens: i.usage.promptTokens, completionTokens: i.usage.completionTokens, attempt: i.attempt },
        });
      },
    };
  }

  /**
   * The daily accruals for one day: the Blooio line(s) (unless `line` is false) and the SMS fallbacks
   * per app. Written with fixed ids, so the ops tick can write them again (the counts grow during the day).
   */
  async accrue(day: string, smsFallbacks: Partial<Record<AppId, number>>, line = true): Promise<CostRow[]> {
    const at = this.o.clock.now();
    const rows: CostRow[] = [];
    const monthly = this.rates.blooioLineMonthlyUsd;
    if (line && monthly !== undefined && this.rates.blooioLines > 0) {
      const unit = monthly / DAYS_PER_MONTH;
      rows.push({ id: `blooio_line:${day}`, app: "shared", day, at, kind: "blooio_line", provider: "blooio", quantity: this.rates.blooioLines, unitCostUsd: unit, costUsd: unit * this.rates.blooioLines, estimated: true, detail: { monthlyUsd: monthly } });
    }
    for (const [app, n] of Object.entries(smsFallbacks) as [AppId, number][]) {
      if (!n) continue;
      rows.push({ id: `sms_fallback:${app}:${day}`, app, day, at, kind: "sms_fallback", provider: "blooio_sms", quantity: n, unitCostUsd: this.rates.smsUsd, costUsd: n * this.rates.smsUsd, estimated: true, detail: {} });
    }
    if (rows.length) await this.o.sink.write(rows).catch(err => this.log(`[cost] daily accrual for ${day} not written: ${(err as Error).message}`));
    return rows;
  }

  totals(day: string) { return this.o.sink.totals(day); }
}

export interface BudgetLine { scope: CostApp | "total"; usedUsd: number; budgetUsd: number; share: number }

/** Each budget that is set, with what the day used so far. */
export function budgetLines(totals: Partial<Record<CostApp, number>>, b: CostBudgets): BudgetLine[] {
  const out: BudgetLine[] = [];
  const used = (x: number) => Math.round(x * 10_000) / 10_000;
  const total = Object.values(totals).reduce((s, x) => s + (x ?? 0), 0);
  if (b.daily !== undefined && b.daily > 0) out.push({ scope: "total", usedUsd: used(total), budgetUsd: b.daily, share: total / b.daily });
  for (const [app, budget] of Object.entries(b.byApp) as [CostApp, number][]) {
    if (!(budget > 0)) continue;
    const u = totals[app] ?? 0;
    out.push({ scope: app, usedUsd: used(u), budgetUsd: budget, share: u / budget });
  }
  return out;
}
