import { expect, test, vi } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { spawnProcess } from "../../core/src/runtime/process.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DAY, type RunRecord } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../../observatory/db/writer.ts";
import { createServer, type ObservatoryServer } from "../../observatory/src/server.ts";
import type { GameSource } from "../../observatory/src/sources/game.ts";
import type { ObsState } from "../../observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { runArm } from "../harness/experiment.ts";

test.skipIf(!pgAvailable)("experiment and Observatory reports measure proactive messages over observed member time", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("consent", { days: 14, seed: 1, onRecords: r => records = r });
  const end = records.find(r => r.type === "run_end")!.simEnd;
  const joins = records.filter(r => r.type === "join");
  const proactive = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proactive && r.msg.status === "delivered").length;
  const memberMinutes = joins.reduce((sum, r) => sum + (end - r.t) / 60_000, 0);

  expect(joins.length).toBeGreaterThan(0);
  expect(proactive).toBeGreaterThan(0);
  expect(memberMinutes).toBeLessThan(joins.length * 14 * 24 * 60);
  expect(result.proactivePerMemberWeek).toBe(Math.round(proactive * 10_080_000 / memberMinutes) / 1000);

  const dir = await mkdtemp(join(tmpdir(), "experiment-exposure-"));
  let server: ObservatoryServer | undefined;
  let sql: SQL | undefined;
  try {
    const url = await testDb();
    const token = "local-experiment-exposure-0000000000";
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    server = await createServer({ port: 0, token, development: false, staffRolesUrl: false, peopleUrl: false,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      game: { seed: 1, days: 7, personas: 80, network: "stub", engine: "engine-v1", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 },
    });
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers,
      body: JSON.stringify({ type: "step", ms: 7 * DAY }) });
    expect((await response.json()).ok).toBe(true);
    const state = () => fetch(`${server!.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
    const gs = await state();
    const game = await server.source("game") as GameSource;
    const gameJoins = game.world.records.filter(r => r.type === "join");
    const minutes = gameJoins.reduce((sum, r) => sum + (gs.clock.now - r.t) / 60_000, 0);
    const delivered = game.world.channel.all().filter(m => !m.system && m.direction === "outbound" && m.meta?.proactive && m.status === "delivered").length;
    expect(delivered).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(gameJoins.length * 7 * 24 * 60);
    const expected = delivered * 10_080 / minutes;

    sql = new SQL(url);
    await writeRows(sql, rowsFromGame(game), { truncate: true });
    await sql.close(); sql = undefined;
    vi.setSystemTime(new Date(gs.clock.now));
    const switched = await fetch(`${server.url}/api/mode`, { method: "POST", headers, body: JSON.stringify({ mode: "real" }) });
    expect((await switched.json()).ok).toBe(true);
    const rs = await state();
    expect(rs.env.error).toBeUndefined();
    const p = spawnProcess([process.execPath, "--import", "tsx", "--conditions", "eliza-source", "packages/observatory/src/report.ts",
      "--days", "7", "--seed", "1", "--personas", "80", "--network", "stub"],
      { cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if (exit !== 0) throw new Error(stderr);
    const report = JSON.parse(stdout);
    const rate = (s: ObsState) => s.stats.scorecard!.find(m => m.key === "attention_burden")!.value;
    expect(rate(gs)).toBeCloseTo(expected, 3);
    expect(rate(rs)).toBeCloseTo(expected, 3);
    expect(report.people.proactivePerMemberPerWeek).toBeCloseTo(expected, 3);
  } finally {
    try { await server?.stop(); await sql?.close(); await dropTestDb(); }
    finally {
      vi.useRealTimers();
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary directory");
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 120_000);
