import { afterAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR, SimClock } from "../../packages/core/src/index.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { rowsFromGame, writeRows } from "../../apps/observatory/db/writer.ts";
import { GameSource } from "../../apps/observatory/src/sources/game.ts";
import type { ControlCommand } from "../../apps/observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../apps/observatory/test/pg.ts";
import { collectNetwork, evaluate, opsConfigFromEnv, runtimeProbe } from "./ops.ts";

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

  // spec/opsAlertDispatch.md, "The review judge alerts when it cannot run or approves above its qualified rate"
  test("judge24h comes from the stored review events, and the judge alerts start above 10 cannot-run results and at 20 decisions strictly above the qualified rate plus 0.1", async () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const url = await testDb();
    const sql = new SQL(url);
    const service = new NetworkService({ url, clock: new SimClock(now), env: { PLATFORM_ENV: "dev" }, notify: false, log: () => {} });
    let n = 0;
    const store = (count: number, type: "review_decision" | "review_exception", payload: Record<string, string | number>) => sql.begin(async tx => {
      await tx`select set_config('app.app_id', 'ntwrk', true)`;
      for (let i = 0; i < count; i++) {
        const id = `judge-opp-${++n}`;
        await tx`insert into network.opportunities (app_id, id, kind, state, source, city, objective) values ('ntwrk', ${id}, 'intro', 'IN_REVIEW', 'engine', 'nyc', 'friendship')`;
        await tx`insert into network.events (app_id, at, actor_type, type, object_type, object_id, payload)
          values ('ntwrk', ${new Date(now - HOUR)}, 'reviewer', ${type}, 'opportunity', ${id}, ${tx.json({ revision: 1, ...payload })})`;
      }
    });
    const approve = (count: number) => store(count, "review_decision", { decision: "approve", approver: "judge" });
    const hold = (count: number, verdict: "flag" | "cannot_run") => store(count, "review_exception", { verdict });
    try {
      const probe = runtimeProbe(service.runtimes.get("ntwrk:nyc")!);
      const config = opsConfigFromEnv({}, { env: "test", build: "test", deployed: false, warn: line => { throw new Error(line); } });
      const alerts = async (judgeMayApproveRate: number | null) => {
        const network = await collectNetwork(probe, now);
        expect(network.error).toBeUndefined();
        return evaluate({ networks: [network], cost: { day: "2026-11-22", totalUsd: 0, byApp: {}, budgets: [] } }, { ...config, judgeMayApproveRate })
          .filter(a => a.key.startsWith("review_judge")).map(a => `${a.key}=${a.level}:${a.count}`);
      };
      await approve(13);
      await hold(6, "flag");
      expect(await alerts(0.5)).toEqual([]);
      await approve(1);
      expect((await collectNetwork(probe, now)).judge24h).toEqual({ approved: 14, held: 6, cannotRun: 0, minorApproved: 0 });
      expect(await alerts(0.5)).toEqual(["review_judge_rate:ntwrk:nyc=warn:70"]);
      expect(await alerts(null)).toEqual([]);
      await approve(1);
      await hold(4, "flag");
      expect((await collectNetwork(probe, now)).judge24h).toEqual({ approved: 15, held: 10, cannotRun: 0, minorApproved: 0 });
      expect(await alerts(0.5)).toEqual([]);
      await approve(1);
      expect(await alerts(0.5)).toEqual(["review_judge_rate:ntwrk:nyc=warn:62"]);
      await hold(10, "cannot_run");
      expect(await alerts(0.5)).toEqual([]);
      await hold(1, "cannot_run");
      expect((await collectNetwork(probe, now)).judge24h).toEqual({ approved: 16, held: 21, cannotRun: 11, minorApproved: 0 });
      expect(await alerts(null)).toEqual(["review_judge_down:ntwrk:nyc=bad:11"]);
    } finally {
      await service.close();
      await sql.close();
    }
  }, 120_000);
});
