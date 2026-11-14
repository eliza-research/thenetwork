// Real plan backfills carry an added participant, without a member to swap out.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("replacement and closed-probe rosters survive persistence", async () => {
  const game = new GameSource({ seed: 4, personas: 80, days: 21, network: "consent", review: "auto", city: "all", pushMs: HOUR, tickMs: HOUR });
  let sql: SQL | undefined, real: RealSource | undefined;
  try {
    await game.init();
    expect(await game.control({ type: "step", ms: 21 * DAY })).toMatchObject({ ok: true });
    const run = await game.world.complete();
    const changes = run.records.filter(r => r.type === "network_log" && r.kind === "probe_replaced");
    const backfills = changes.filter(r => r.type === "network_log" && !r.detail.out);
    expect(backfills.length).toBeGreaterThan(0);
    expect(changes.length).toBeGreaterThan(backfills.length); // Ordinary replacements are the control.
    const closures = run.records.filter(r => r.type === "network_log" && r.kind === "probe_closed");
    expect(closures.length).toBeGreaterThan(0);
    const ids = new Set([...changes, ...closures].map(r => r.type === "network_log" ? String(r.detail.oppId ?? r.detail.proposalId) : ""));
    const native = game.consent!.exportState().opps.filter(o => ids.has(o.id));
    expect(native.length).toBe(ids.size);
    expect(native.some(o => o.stage === "closed" && o.alternates.length > 0)).toBe(true);
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
