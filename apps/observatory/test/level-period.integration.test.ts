import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import type { ControlResult, ObsState } from "../src/types.ts";

test("reset with plans_buddy runs 3 days, the level's own period", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-level-period-"));
  const token = "level-period-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
  const days = (s: ObsState) => {
    expect(s.clock.end).toBeDefined();
    return (s.clock.end! - s.clock.start) / DAY;
  };
  const control = (body: unknown) => fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() as ControlResult }));
  try {
    const before = await state();
    expect(days(before)).toBe(60);
    const r = await control({ type: "reset", scenario: "plans_buddy", network: "consent" });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    const after = await state();
    expect(after.network?.scenario?.id).toBe("plans_buddy");
    expect(days(after)).toBe(3);
    const wave = await control({ type: "reset", scenario: "newcomer_wave", network: "consent" });
    expect(wave).toEqual({ status: 200, body: { ok: true } });
    const waveState = await state();
    expect(days(waveState)).toBe(7);
    const spam = await control({ type: "reset", scenario: "spam_wave", network: "consent" });
    expect(spam).toEqual({ status: 200, body: { ok: true } });
    const spamState = await state();
    expect(days(spamState)).toBe(4);
    const plain = await control({ type: "reset", scenario: null, network: "consent" });
    expect(plain).toEqual({ status: 200, body: { ok: true } });
    const plainState = await state();
    expect(plainState.network?.scenario).toBeUndefined();
    expect(days(plainState)).toBe(60);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
