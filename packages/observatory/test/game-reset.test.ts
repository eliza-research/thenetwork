// Game mode reset (observatory game-world in docs/research/state-machines/observatory.md): a reset that
// arrives during a step. No Postgres.
import { afterEach, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";

const live: GameSource[] = [];
// A generated world: init() builds the new view without waiting on file reads.
async function game(seed: number) {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed, personas: 80 });
  live.push(g);
  await g.init();
  return g;
}
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

// SD-497 (observatory D18): reset did not wait for a running step. The old world kept running after init()
// made the new projector, and its records went into the new world's view.
test("a reset during a step gives the same state as a fresh world", async () => {
  const g = await game(1);
  // The player plays every adult member, so the step stops at the first question to one of them and waits.
  for (const m of g.state().members.filter(x => !x.minor)) await g.control({ type: "takeover", memberId: m.id, on: true });
  const step = g.control({ type: "step", ms: 4 * DAY });
  for (let i = 0; i < 600 && !g.state().clock.waitingForPlayer; i++) await Bun.sleep(50);
  expect(g.state().clock.waitingForPlayer).toBe(true);
  const reset = await g.control({ type: "reset", seed: 2 });
  expect(reset.ok).toBe(true);
  await step;
  const fresh = await game(2);
  const a = g.state(), b = fresh.state();
  expect(a.clock.now).toBe(b.clock.now);
  expect(a.stats.messages).toBe(b.stats.messages);
  expect(a.opportunities.length).toBe(b.opportunities.length);
}, 300_000);
