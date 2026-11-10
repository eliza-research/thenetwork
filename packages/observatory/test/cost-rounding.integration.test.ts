import { expect, test } from "bun:test";
import { SQL } from "bun";
import { CostLedger, PgCostSink } from "../../network/service/cost.ts";
import { CostView } from "../src/ops.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("cost summaries round completed totals and retain exact budget shares", async () => {
  const url = await testDb(), sql = new SQL({ url, max: 1 }), view = new CostView(() => url);
  const now = Date.UTC(2026, 9, 9, 15), day = "2026-10-09";
  const ledger = new CostLedger({ sink: new PgCostSink(sql), clock: { now: () => now } });
  try {
    for (const [kind, costUsd] of [["photo_rating", 0.000425], ["llm", 0.00002], ["other", 0.000035]] as const) {
      await ledger.record({ app: "slop", kind, costUsd, provider: "local", estimated: kind !== "llm" });
    }
    await ledger.record({ app: "shared", kind: "other", costUsd: 0.000035, provider: "local" });
    const env = { COST_BUDGET_DAILY_USD_SLOP: "0.0006", COST_BUDGET_DAILY_USD: "0.001" };
    const app = (await view.summary("slop", now, { env }))!;
    const every = (await view.summary("slop", now, { env, everyApp: true }))!;
    expect(app.days).toEqual([{ day, total: 0.0005, byKind: { llm: 0, other: 0.0001, photo_rating: 0.0004 } }]);
    expect(app.today).toEqual({ day, app: 0.0005, shared: 0 });
    expect(app.budgets[0]!.share).toBeCloseTo(0.8, 12);
    expect(app.budgets).toEqual(every.budgets.filter(b => b.scope === "slop"));
    expect({ quantities: app.quantities, estimatedShare: app.estimatedShare })
      .toEqual({ quantities: { llm: 1, other: 2, photo_rating: 1 }, estimatedShare: 0.9612 });
    expect(await ledger.totals(day)).toEqual({ slop: 0.00048, shared: 0.000035 });
  } finally { await view.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
