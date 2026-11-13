// A real booked refusal must remove the acceptance from the same member's activity count.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("booked refusals remove member acceptances in game and persisted state", async () => {
  const yes = new Set(["accepted", "countered", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
  const results: { timeAware: boolean; mode: string; counts: [string, number][]; expected: [string, number][] }[] = [];
  let sql: SQL | undefined;
  try {
    const url = await testDb();
    sql = new SQL(url);
    for (const timeAware of [false, true]) {
      const game = new GameSource({ seed: 4, personas: 80, days: 21, network: "consent", review: "auto", city: "all", timeAware, pushMs: 3_600_000, tickMs: 3_600_000 });
      const real = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
      try {
        await game.init();
        expect(await game.control({ type: "step", ms: 21 * DAY })).toMatchObject({ ok: true });
        const run = await game.world.complete();
        const state = game.state();
        if (timeAware) {
          const refusals = run.records.filter(r => r.type === "decision" && r.intent === "booked_cancel");
          expect(refusals.length).toBeGreaterThan(0);
          expect(refusals.every(r => r.type === "decision" && state.opportunities.some(o => o.id === r.proposalId && o.status[r.memberId] === "declined"))).toBe(true);
        }
        const expected = new Map<string, number>();
        for (const o of state.opportunities.filter(o => o.source !== "shadow")) {
          for (const id of o.participants) if (yes.has(o.status[id]!)) expected.set(id, (expected.get(id) ?? 0) + 1);
        }
        const total = [...expected.values()].reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(0); // Positive acceptances must remain, including in the control world.
        await writeRows(sql, rowsFromGame(game), { truncate: true });
        await real.init();
        const persisted = real.state();
        expect(persisted.env.error).toBeUndefined();
        expect([state.stats.accepts, persisted.stats.accepts]).toEqual([total, total]);
        for (const s of [state, persisted]) results.push({
          timeAware, mode: s.env.mode,
          counts: s.members.map(m => [m.id, m.counters.accepted]),
          expected: s.members.map(m => [m.id, expected.get(m.id) ?? 0]),
        });
      } finally {
        await real.dispose();
        await game.dispose();
      }
    }
    expect(results.map(({ expected, ...r }) => r))
      .toEqual(results.map(({ counts, expected, ...r }) => ({ ...r, counts: expected })));
  } finally {
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
