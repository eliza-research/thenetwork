// The backend's seven-day shadow precision counts person decisions on engine proposals only, the cohort
// of the console scorecard (upstream PR #459; PRD 32.8 precision gate, 34.6 shadow mode). Before the
// fix, a staff-composed proposal's approval counted as an engine decision: a false precision alert, or
// a hidden engine failure. The real GameSource with human review, the row writer, a migrated Postgres,
// and the production runtimeProbe on a NetworkService runtime; no SQL or service fakes.
import { afterAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR, SimClock } from "../../packages/core/src/index.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { rowsFromGame, writeRows } from "../../packages/observatory/db/writer.ts";
import { GameSource } from "../../packages/observatory/src/sources/game.ts";
import type { ControlCommand } from "../../packages/observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { collectNetwork, runtimeProbe } from "./ops.ts";

describe.skipIf(!pgAvailable)("ops precision (Postgres)", () => {
  afterAll(async () => { await dropTestDb(); });

  test("precision7d counts only person decisions on engine proposals", async () => {
    const g = new GameSource({ seed: 1, scenario: "spam_wave", review: "human", pushMs: HOUR, tickMs: HOUR });
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
});
