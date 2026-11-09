import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { Lab, LAB_ARMS } from "../src/lab.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { ObsState } from "../src/types.ts";

test("game and lab runs honor app matching locks before dispatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-matching-"));
  const lab = new Lab({ dir: join(dir, "lab"), concurrency: 1 });
  let server: ObservatoryServer | undefined;
  try {
    const token = "local-matching-lock-0000000000000000";
    server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "server-lab") },
      game: { seed: 1, personas: 80, days: 14, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url: undefined, service: false, pollMs: 3_600_000 },
    });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const app of ["peon", "ntwrk"] as const) for (const engine of ["engine-v1", "random", "off"] as const) {
      const control = async (body: unknown) => {
        const res = await fetch(`${server!.url}/api/control?app=${app}`, { method: "POST", headers, body: JSON.stringify(body) });
        const result = await res.json() as { ok: boolean };
        if (res.status !== 200 || !result.ok) throw new Error(`Control failed: ${JSON.stringify(result)}`);
      };
      const state = () => fetch(`${server!.url}/api/state?app=${app}`, { headers }).then(r => r.json()) as Promise<ObsState>;
      await control({ type: "reset", network: "stub", engine });
      await control({ type: "step", ms: (engine === "off" ? 7 : 14) * DAY });
      if (engine === "off") {
        const pair = (await state()).members.filter(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out").slice(0, 2);
        await control({ type: "propose", participants: pair.map(m => m.id) });
        await control({ type: "step", ms: 7 * DAY });
      }
      const s = await state();
      if (app === "peon") expect(s.stats.invites).toBe(0);
      else expect(s.stats.invites).toBeGreaterThan(0);
      expect(s.env.matchingLocked === true).toBe(app === "peon");
      expect((await (await server.source("game", app)).config()).matchingEnabled).toBe(app !== "peon");
      expect(s.stats.judge).toMatchObject({ invariants: 0, canaryLeaks: 0, minorContacts: 0 });
    }
    for (const app of ["peon", "ntwrk"] as const) {
      const run = await lab.start({ app, arms: [...LAB_ARMS], seeds: [1], days: 7 }, "regression");
      const deadline = Date.now() + 90_000;
      let done = (await lab.get(run.id))!;
      while ((done.status === "queued" || done.status === "running") && Date.now() < deadline) {
        await Bun.sleep(25);
        done = (await lab.get(run.id))!;
      }
      expect({ status: done.status, error: done.error }).toEqual({ status: "done", error: undefined });
      expect(done.results.map(r => r.arm).sort()).toEqual([...LAB_ARMS].sort());
      for (const result of done.results) {
        expect(result).toMatchObject({ judgeInvariants: 0, canaryLeaks: 0, minorContacts: 0 });
        if (app === "peon") expect(result.meetings).toBe(0);
        else expect(result.meetings).toBeGreaterThan(0);
      }
      expect(JSON.parse(await readFile(done.file, "utf8")).results).toEqual(done.results);
    }
  } finally {
    await server?.stop();
    lab.dispose();
    const deadline = Date.now() + 10_000;
    while (lab.running && Date.now() < deadline) await Bun.sleep(10);
    if (lab.running) throw new Error("lab child did not stop");
    await rm(dir, { recursive: true, force: true });
  }
}, 210_000);
