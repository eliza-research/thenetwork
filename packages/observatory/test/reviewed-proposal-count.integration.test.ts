// Review holds must not become member proposal activity after a game is persisted.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("persisted member proposals respect the real review lifecycle", async () => {
  let sql: SQL | undefined;
  const comparisons: { phase: string; game: [string, number][]; real: [string, number][] }[] = [];
  try {
    const url = await testDb();
    sql = new SQL(url);
    const snapshot = async (game: GameSource, phase: string) => {
      const state = game.state();
      await writeRows(sql!, rowsFromGame(game), { truncate: true });
      const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
      try {
        await real.init();
        const persisted = real.state();
        expect(persisted.env.error).toBeUndefined();
        expect(persisted.stats.proposals).toBe(state.stats.proposals); // Keep the whole review inventory.
        const counts = (s: typeof state): [string, number][] => s.members
          .map(m => [m.id, m.counters.proposals] as [string, number]).sort(([a], [b]) => a.localeCompare(b));
        comparisons.push({ phase, game: counts(state), real: counts(persisted) });
      } finally { await real.dispose(); }
    };
    for (const network of ["consent", "stub"] as const) {
      const game = new GameSource({ seed: 4, personas: 80, days: 14, network, review: "human", city: "all", pushMs: HOUR, tickMs: HOUR });
      try {
        await game.init();
        if (network === "consent") {
          for (let h = 0; h < 14 * 24 && game.state().opportunities.filter(o => o.state === "IN_REVIEW").length < 2; h++) {
            await game.control({ type: "step", ms: HOUR });
          }
          const queued = game.state().opportunities.filter(o => o.state === "IN_REVIEW");
          expect(queued.length).toBeGreaterThanOrEqual(2);
          expect(game.state().members.every(m => m.counters.proposals === 0)).toBe(true);
          await snapshot(game, "pending");
          expect(await game.control({ type: "review", oppId: queued[0]!.id, decision: "reject", reason: "weak_reason", note: "Synthetic fixture" })).toMatchObject({ ok: true });
          expect(await game.control({ type: "review", oppId: queued[1]!.id, decision: "approve" })).toMatchObject({ ok: true });
          expect(game.state().members.reduce((n, m) => n + m.counters.proposals, 0)).toBe(queued[1]!.participants.length);
          await snapshot(game, "decided");
          await game.control({ type: "step", ms: 2 * DAY });
          expect(game.state().opportunities.some(o => o.review?.decision === "expired")).toBe(true);
          await snapshot(game, "expired");
        } else {
          await game.control({ type: "step", ms: 7 * DAY });
          expect(game.state().members.some(m => m.counters.proposals > 0)).toBe(true);
          expect(game.state().opportunities.every(o => !o.review)).toBe(true);
          await snapshot(game, "no review control");
        }
      } finally { await game.dispose(); }
    }
    expect(comparisons.map(({ phase, real }) => ({ phase, counts: real })))
      .toEqual(comparisons.map(({ phase, game }) => ({ phase, counts: game })));
  } finally {
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
