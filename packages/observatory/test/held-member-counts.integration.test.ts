// The HTTP state must count people who actually met, not people left alone by a no-show.
// Outcomes come from a real 30-day simulated world; no attendance is fabricated.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { ObsState } from "../src/types.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("member meeting counts agree with held outcomes in game and persisted API state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-held-meetings-"));
  const token = "held-meetings-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}` };
  let obs: ObservatoryServer | undefined;
  let sql: SQL | undefined;
  try {
    const url = await testDb();
    obs = await createServer({
      port: 0, development: false, token,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      game: { seed: 4, personas: 80, days: 30, engine: "random", network: "stub", city: "all", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url, pollMs: 3_600_000, service: false },
    });
    const step = await fetch(obs.url + "/api/control", {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type: "step", ms: 30 * DAY }),
    });
    expect(step.status).toBe(200);
    expect(await step.json()).toMatchObject({ ok: true });
    const game = await obs.source() as GameSource;
    const result = await game.world.complete();
    const counts = new Map<string, number>();
    let held = 0, solo = 0;
    for (const r of result.records) {
      if (r.type !== "outcome") continue;
      const attendees = Object.entries(r.attendance).filter(([, a]) => a.showed).map(([id]) => id);
      if (attendees.length === 1) solo++;
      if (attendees.length < 2) continue;
      held++;
      for (const id of attendees) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(held).toBeGreaterThan(0);
    expect(solo).toBeGreaterThan(0);
    const response = await fetch(obs.url + "/api/state", { headers });
    expect(response.status).toBe(200);
    const gameState = await response.json() as ObsState;
    sql = new SQL(url);
    await writeRows(sql, rowsFromGame(game), { truncate: true });
    await obs.setMode("real");
    const persisted = await fetch(obs.url + "/api/state", { headers });
    expect(persisted.status).toBe(200);
    const states = [gameState, await persisted.json() as ObsState];
    expect(states.map(s => s.stats.meetingsHeld)).toEqual([held, held]);
    expect(states.map(s => s.members.map(m => [m.id, m.counters.meetings])))
      .toEqual(states.map(s => s.members.map(m => [m.id, counts.get(m.id) ?? 0])));
  } finally {
    await obs?.stop();
    await sql?.close();
    await dropTestDb();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
