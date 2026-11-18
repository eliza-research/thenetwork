// Repeated STOP/START must not turn an earlier rejected interruption into a positive one.
import { expect, setSystemTime, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("worthwhile interruptions retain every STOP window in game and database modes", async () => {
  const url = await testDb(), sql = new SQL(url);
  const game = new GameSource({ seed: 4, personas: 80, days: 21, network: "consent", engine: "off", pushMs: HOUR, tickMs: HOUR });
  try {
    await game.init();
    const step = async (ms: number) => {
      const result = await game.control({ type: "step", ms });
      if (!result.ok) throw Error(result.error);
    };
    await step(8 * DAY);
    const now = game.world.clock.now();
    const first = game.world.channel.all().find(m => m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && m.ts < now && now - m.ts < DAY && !game.world.channel.isOptedOut(m.memberId));
    expect(first).toBeDefined();
    const memberId = first!.memberId;
    const say = async (text: string) => {
      const result = await game.control({ type: "say", memberId, text });
      if (!result.ok) throw Error(result.error);
    };
    const observations: unknown[] = [], expected: unknown[] = [];
    const snapshot = async (phase: string, reverseEvents = false) => {
      const state = game.state(), rows = rowsFromGame(game);
      // Calculate from the complete recorded windows, independently of either source's scorecard input.
      const messages = game.world.channel.all().filter(m => !m.system);
      const rejected = new Set<string>(), answered = new Set<string>();
      for (const r of game.world.records) if (r.type === "opt_out") {
        for (const m of messages) if (m.memberId === r.memberId && r.t >= m.ts && r.t <= m.ts + 72 * HOUR) rejected.add(m.id);
      }
      for (const reply of messages) if (reply.direction === "inbound") {
        for (const m of messages) if (m.memberId === reply.memberId && reply.ts > m.ts && reply.ts <= m.ts + 72 * HOUR) answered.add(m.id);
      }
      const eligible = messages.filter(m => m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && (state.clock.now - m.ts >= 72 * HOUR || answered.has(m.id)));
      const good = eligible.filter(m => answered.has(m.id) && !rejected.has(m.id)).length;
      const score = { value: Math.round(good / eligible.length * 1000) / 1000, n: eligible.length };
      if (reverseEvents) rows.events.reverse(); // Database row order must not choose which STOP counts.
      await writeRows(sql, rows, { truncate: true });
      setSystemTime(new Date(state.clock.now));
      const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
      try {
        await real.init();
        if (real.state().env.error) throw Error(real.state().env.error);
        for (const view of [state, real.state()]) {
          const metric = view.stats.scorecard!.find(x => x.key === "worthwhile_interruption")!;
          observations.push({ phase, mode: view.env.mode, value: metric.value, n: metric.n });
          expected.push({ phase, mode: view.env.mode, ...score });
        }
      } finally { await real.dispose(); setSystemTime(); }
    };
    await say("STOP"); await step(HOUR); await snapshot("first STOP");
    await step(4 * DAY); await say("START");
    const resumedAt = game.world.clock.now();
    const next = () => game.world.channel.all().find(m => m.memberId === memberId && m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && m.ts > resumedAt);
    for (let i = 0; i < 7 * 24 && !next(); i++) await step(HOUR);
    expect(next()).toBeDefined();
    await snapshot("resumed and contacted again");
    await say("STOP"); await step(HOUR);
    const stops = game.world.records.filter(r => r.type === "opt_out" && r.memberId === memberId);
    expect(stops).toHaveLength(2);
    expect(stops[1]!.t - stops[0]!.t).toBeGreaterThan(72 * HOUR);
    await snapshot("second STOP");
    await snapshot("second STOP, reversed event insertion");
    expect(observations).toEqual(expected);
  } finally {
    setSystemTime(); await game.dispose(); await sql.close(); await dropTestDb();
  }
}, 120_000);
