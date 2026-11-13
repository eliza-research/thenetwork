import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { ControlCommand, ObsState } from "../src/types.ts";

test("game state refreshes health and requests after recorded actions within the same hour", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-health-refresh-"));
  const token = "local-game-health-refresh-0000000000", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 7, personas: 30, days: 5, engine: "off", network: "consent", pushMs: HOUR, tickMs: HOUR },
  });
  const state = async () => (await (await fetch(`${server.url}/api/state`, { headers })).json()) as ObsState;
  const control = async (body: ControlCommand) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  };
  const off = (s: ObsState) => s.stats.alerts?.some(a => a.key === "matching_off") ?? false;
  try {
    const initial = await state();
    expect(off(initial)).toBe(false);
    await control({ type: "matching", on: false });
    const stopped = await state();
    expect(stopped.clock.now).toBe(initial.clock.now);
    expect(stopped.network?.matchingEnabled).toBe(false);
    expect(off(stopped)).toBe(true);
    await control({ type: "matching", on: true });
    const resumed = await state();
    expect(resumed.clock.now).toBe(initial.clock.now);
    expect(off(resumed)).toBe(false);
    await control({ type: "step", ms: 2 * DAY });
    const before = await state(), source = await server.source("game") as GameSource;
    const member = before.members.find(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out");
    expect(member).toBeDefined();
    const count = source.requestList().length;
    await control({ type: "say", memberId: member!.id, text: "Any plans for this weekend?" });
    const after = await state();
    expect(after.clock.now).toBe(before.clock.now);
    expect(source.requestList()).toHaveLength(count + 1);
    expect(after.requests).toEqual(source.requestList());
  } finally {
    await server.stop();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !dir.includes("obs-health-refresh-")) throw Error("Unexpected temporary directory");
    await rm(dir, { recursive: true, force: true });
  }
});
