// Game mode clock commands (observatory game-world in docs/research/state-machines/observatory.md):
// "step" and "speed" with no number. No Postgres.
import { afterEach, expect, test } from "bun:test";
import { GameSource } from "../src/sources/game.ts";
import type { ControlCommand } from "../src/types.ts";

const live: GameSource[] = [];
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

// SD-506 (observatory D30): a step with no `ms` advanced to Math.max(MINUTE, undefined) = NaN, and the
// scheduler ran the whole world in one call. A speed with no number set the clock speed to NaN.
test("step and speed with no number are refused and do not move the clock", async () => {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, personas: 80, days: 5 });
  live.push(g);
  await g.init();
  const before = { ...g.state().clock };
  for (const cmd of [{ type: "step" }, { type: "step", ms: "a day" }, { type: "speed" }, { type: "speed", speed: null }]) {
    const r = await g.control(cmd as unknown as ControlCommand);
    const after = g.state().clock;
    expect({ now: after.now, speed: after.speed }).toEqual({ now: before.now, speed: before.speed });
    expect(r.ok).toBe(false);
  }
}, 300_000);
