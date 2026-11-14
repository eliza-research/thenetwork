// A reset through HTTP must not project the old world's remaining events into its replacement.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import type { ControlCommand, ControlResult, ObsState } from "../src/types.ts";

test("reset drains a world waiting for a controlled member before replacing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-reset-drain-"));
  const token = "reset-drain-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const options = { seed: 1, personas: 24, days: 8, pushMs: 3_600_000, tickMs: 3_600_000 };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, game: options });
  const fresh = new GameSource({ ...options, seed: 2 });
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
  const control = (command: ControlCommand) => fetch(`${server.url}/api/control`, {
    method: "POST", headers, body: JSON.stringify(command),
  }).then(r => r.json() as Promise<ControlResult>);
  let step: Promise<ControlResult> | undefined;
  try {
    const game = await server.source() as GameSource;
    for (const m of (await state()).members) {
      const result = await control({ type: "takeover", memberId: m.id, on: true });
      if (!result.ok) throw Error(result.error);
    }
    step = control({ type: "step", ms: 7 * DAY });
    const deadline = performance.now() + 10_000;
    while (!(await state()).game?.prompts.length && performance.now() < deadline) await Bun.sleep(1);
    expect((await state()).game?.prompts.length).toBeGreaterThan(0);
    expect(await control({ type: "reset", seed: 2 })).toEqual({ ok: true });
    expect(await step).toEqual({ ok: true });
    await fresh.init();
    const actual = await state(), expected = fresh.state();
    expect({ now: actual.clock.now, members: actual.members, opportunities: actual.opportunities,
      messages: actual.stats.messages, runs: actual.engineRuns, channel: game.world.channel.all() }).toEqual({
      now: expected.clock.now, members: expected.members, opportunities: expected.opportunities,
      messages: expected.stats.messages, runs: expected.engineRuns, channel: fresh.world.channel.all(),
    });
    // The replacement must still be usable after its predecessor has settled.
    expect(await control({ type: "step", ms: DAY })).toEqual({ ok: true });
    await fresh.control({ type: "step", ms: DAY });
    expect(game.world.channel.all()).toEqual(fresh.world.channel.all());
  } finally {
    await server.stop();
    await step;
    await fresh.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
