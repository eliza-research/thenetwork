// A late yes updates a real group booking without accepting again for the confirmed members.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import type { ControlCommand, ControlResult, ObsState } from "../src/types.ts";

test("HTTP group bookings count each accepting member once when late members join", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-late-group-"));
  const token = "late-group-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, days: 12, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 } });
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
  const control = async (command: ControlCommand) => {
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(command) });
    const body = await response.json() as ControlResult;
    if (response.status !== 200 || !body.ok) throw Error(JSON.stringify(body));
    return body;
  };
  try {
    await control({ type: "step", ms: 7 * DAY });
    const members = (await state()).members.filter(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out").slice(0, 6);
    expect(members).toHaveLength(6);
    for (const m of members) await control({ type: "takeover", memberId: m.id, on: true });
    await control({ type: "propose", participants: members.map(m => m.id) });
    let done = false;
    const step = control({ type: "step", ms: DAY }).finally(() => { done = true; });
    const deadline = performance.now() + 10_000;
    while (!done && performance.now() < deadline) {
      const prompt = (await state()).game?.prompts[0];
      if (prompt) await control({ type: "reply", promptId: prompt.id, text: "yes" });
      else await Bun.sleep(1);
    }
    if (!done) throw Error("Group step did not finish");
    await step;
    const result = await state();
    expect(result.opportunities.map(o => ({ state: o.state, statuses: Object.values(o.status) })))
      .toEqual([{ state: "SCHEDULED", statuses: Array(6).fill("confirmed") }]);
    expect({ accepts: result.stats.accepts, invites: result.stats.invites, meetings: result.stats.meetingsScheduled,
      optIn: result.stats.scorecard?.find(s => s.key === "opt_in")?.value })
      .toEqual({ accepts: 6, invites: 6, meetings: 1, optIn: 1 });
    expect(result.members.filter(m => members.some(p => p.id === m.id)).map(m => m.counters.accepted)).toEqual(Array(6).fill(1));
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
