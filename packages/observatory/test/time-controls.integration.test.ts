// Malformed HTTP time controls must not run the simulation or poison its play-loop speed.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import type { ControlResult, ObsState } from "../src/types.ts";

test("HTTP time controls reject nonnumeric fields without changing the world", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-time-controls-"));
  const token = "time-controls-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, days: 2, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
  const control = async (body: unknown) => {
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers,
      body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as ControlResult };
  };
  try {
    const before = await state(), results = [];
    for (const type of ["step", "speed"] as const) for (const value of [undefined, null, "NaN", "60000", {}, [], true]) {
      const field = type === "step" ? "ms" : "speed";
      results.push(await control({ type, [field]: value }));
    }
    // JSON permits an exponent whose JavaScript numeric value is not finite.
    results.push(await control('{"type":"step","ms":1e999}'), await control('{"type":"speed","speed":1e999}'));
    expect(results.map(r => [r.status, r.body.ok])).toEqual(Array.from({ length: 16 }, () => [409, false]));
    expect(await state()).toEqual(before);
    // Existing numeric clamping and fractional durations stay supported.
    const speeds = [];
    for (const speed of [0, -1, 1.25 * HOUR, 8 * DAY]) {
      const r = await control({ type: "speed", speed });
      speeds.push([r.status, (await state()).clock.speed]);
    }
    expect(speeds).toEqual([[200, MINUTE], [200, MINUTE], [200, 1.25 * HOUR], [200, 7 * DAY]]);
    const steps = [];
    for (const ms of [0, -1, 1.25 * HOUR]) {
      const start = (await state()).clock.now;
      const r = await control({ type: "step", ms });
      steps.push([r.status, (await state()).clock.now - start]);
    }
    expect(steps).toEqual([[200, MINUTE], [200, MINUTE], [200, 1.25 * HOUR]]);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
