// The backend's seven-day shadow precision counts person decisions on engine proposals only, the cohort
// of the console scorecard (upstream PR #459; PRD 32.8 precision gate, 34.6 shadow mode). Before the
// fix, a staff-composed proposal's approval counted as an engine decision: a false precision alert, or
// a hidden engine failure. The real GameSource with a judge that holds every item for staff, the row writer,
// a migrated Postgres, and the production runtimeProbe on a NetworkService runtime; no SQL or service fakes.
import { afterAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { rowsFromGame, writeRows } from "../../packages/observatory/db/writer.ts";
import { GameSource } from "../../packages/observatory/src/sources/game.ts";
import type { ControlCommand } from "../../packages/observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { collectNetwork, evaluate, runtimeProbe, type JudgeCounts, type NetworkMetrics } from "./ops.ts";

describe.skipIf(!pgAvailable)("ops precision (Postgres)", () => {
  afterAll(async () => { await dropTestDb(); });

  test("precision7d counts only person decisions on engine proposals", async () => {
    const g = new GameSource({ seed: 1, scenario: "spam_wave", judge: "hold-every-item", pushMs: HOUR, tickMs: HOUR });
    let sql: SQL | undefined, service: NetworkService | undefined;
    const control = async (cmd: ControlCommand) => {
      const r = await g.control(cmd, "reviewer@example.test");
      if (!r.ok) throw Error(r.error);
      return r;
    };
    try {
      await g.init();
      await control({ type: "step", ms: DAY });
      const engine = g.state().opportunities.find(o => o.source === "engine" && o.state === "IN_REVIEW")!;
      expect(engine).toBeDefined();
      await control({ type: "review", oppId: engine.id, decision: "reject", reason: "weak_reason", note: "Synthetic review of the generated proposal" });
      const url = await testDb();
      sql = new SQL(url);
      const clock = new SimClock(g.state().clock.now);
      service = new NetworkService({ url, clock, env: { PLATFORM_ENV: "dev" }, notify: false, log: () => {} });
      const probe = runtimeProbe(service.runtimes.get("ntwrk:nyc")!);
      const read = async () => {
        await writeRows(sql!, rowsFromGame(g), { truncate: true });
        const now = g.state().clock.now;
        clock.set(now);
        const result = await collectNetwork(probe, now);
        expect(result.error).toBeUndefined();
        return result.precision7d;
      };
      expect(await read()).toEqual({ decided: 1, clean: 0 });
      // A staff-composed (player) proposal, approved by a person: not an engine decision.
      const ids = g.state().members.filter(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out").slice(-2).map(m => m.id);
      const proposed = await control({ type: "propose", participants: ids });
      const id = (proposed.data as { id: string }).id;
      await control({ type: "step", ms: DAY });
      await control({ type: "review", oppId: id, decision: "approve", secondsSpent: 15 });
      expect(g.state().opportunities.find(o => o.id === id)).toMatchObject({ source: "player", review: { decision: "approve" } });
      expect(await read()).toEqual({ decided: 1, clean: 0 });
      // An engine proposal approved without an edit counts.
      const next = g.state().opportunities.find(o => o.source === "engine" && o.state === "IN_REVIEW")!;
      expect(next).toBeDefined();
      await control({ type: "review", oppId: next.id, decision: "approve", secondsSpent: 15 });
      expect(await read()).toEqual({ decided: 2, clean: 1 });
    } finally {
      await service?.close();
      await sql?.close();
      await g.dispose();
    }
  }, 180_000);

  test("the review judge alerts start above 10 cannot-run results in 24 h and at 20 decisions above the qualified rate plus 0.1", () => {
    const base: NetworkMetrics = {
      network: "ntwrk:nyc", app: "ntwrk", lastTickAgoMs: MINUTE, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 },
      sends24h: { attempted: 0, failed: 0, refused: 0, dryRun: 0, smsFallback: 0 }, reviewExpired24h: 0,
      safety24h: { reports: 0, urgentReports: 0, minorAfterContact: 0, holds: 0, bans: 0 }, smsByDay: { today: 0, yesterday: 0 },
    };
    const cfg = { tickLateMs: 15 * MINUTE, sendFailureRate: 0.02, sendFailureMin: 5, outboundBacklog: 50, reviewBacklog: 30, budgetWarnShare: 0.8 };
    const at = (j: JudgeCounts, judgeMayApproveRate: number | null) =>
      evaluate({ networks: [{ ...base, judge24h: j }], cost: { day: "2026-11-22", totalUsd: 0, byApp: {}, budgets: [] } }, { ...cfg, judgeMayApproveRate })
        .map(a => `${a.key}=${a.level}:${a.count}`);
    expect(at({ approved: 0, held: 10, cannotRun: 10, minorApproved: 0 }, null)).toEqual([]);
    expect(at({ approved: 0, held: 11, cannotRun: 11, minorApproved: 0 }, null)).toEqual(["review_judge_down:ntwrk:nyc=bad:11"]);
    expect(at({ approved: 19, held: 0, cannotRun: 0, minorApproved: 0 }, 0.5)).toEqual([]);
    expect(at({ approved: 20, held: 0, cannotRun: 0, minorApproved: 0 }, 0.5)).toEqual(["review_judge_rate:ntwrk:nyc=warn:100"]);
    expect(at({ approved: 12, held: 8, cannotRun: 0, minorApproved: 0 }, 0.5)).toEqual([]);
    expect(at({ approved: 13, held: 7, cannotRun: 0, minorApproved: 0 }, 0.5)).toEqual(["review_judge_rate:ntwrk:nyc=warn:65"]);
    expect(at({ approved: 20, held: 0, cannotRun: 0, minorApproved: 0 }, null)).toEqual([]);
  });
});
