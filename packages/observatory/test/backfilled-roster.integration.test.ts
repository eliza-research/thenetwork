// Real plan backfills carry an added participant, without a member to swap out.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("plan backfills and replacements retain the Network roster through persistence", async () => {
  const game = new GameSource({ seed: 4, personas: 80, days: 7, network: "consent", review: "auto", city: "all", pushMs: HOUR, tickMs: HOUR });
  let sql: SQL | undefined, real: RealSource | undefined;
  try {
    await game.init();
    expect(await game.control({ type: "step", ms: 7 * DAY })).toMatchObject({ ok: true });
    const run = await game.world.complete();
    const changes = run.records.filter(r => r.type === "network_log" && r.kind === "probe_replaced");
    const backfills = changes.filter(r => r.type === "network_log" && !r.detail.out);
    expect(backfills.length).toBeGreaterThan(0);
    expect(changes.length).toBeGreaterThan(backfills.length); // Ordinary replacements are the control.
    const ids = new Set(changes.map(r => r.type === "network_log" ? String(r.detail.oppId) : ""));
    const native = game.consent!.exportState().opps.filter(o => ids.has(o.id));
    expect(native.length).toBe(ids.size);
    const url = await testDb();
    sql = new SQL(url);
    await writeRows(sql, rowsFromGame(game), { truncate: true });
    real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
    await real.init();
    expect(real.state().env.error).toBeUndefined();
    const expected = native.map(o => ({ id: o.id, participants: [...o.participants].sort(), alternates: [...o.alternates].sort() })).sort((a, b) => a.id.localeCompare(b.id));
    const projected = [game.state(), real.state()].map(s => ({
      mode: s.env.mode,
      rosters: s.opportunities.filter(o => ids.has(o.id)).map(o => ({ id: o.id, participants: [...o.participants].sort(), alternates: [...o.alternates].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    }));
    expect(projected).toEqual(projected.map(({ mode }) => ({ mode, rosters: expected })));
  } finally {
    await real?.dispose();
    await game.dispose();
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
