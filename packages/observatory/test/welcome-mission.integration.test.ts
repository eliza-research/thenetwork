import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { ObsState } from "../src/types.ts";

test("Welcome wagon uses the member's age in the network when the meeting happened", async () => {
  for (const variant of [
    { day: 7, dayZero: true, done: true },
    { day: 40, dayZero: false, done: false },
    { day: 7, dayZero: false, done: true },
    { day: 40, dayZero: true, done: false },
    { day: 28, dayZero: false, done: true },
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "obs-welcome-mission-"));
    const token = "local-welcome-mission-0000000000000000";
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const server = await createServer({ port: 0, development: false, token,
      staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
      game: { seed: 1, personas: 80, days: 60, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url: undefined, service: false, pollMs: 3_600_000 },
    });
    const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json()) as Promise<ObsState>;
    const control = async (cmd: unknown) => {
      const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
      const result = await r.json();
      if (r.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
      return result;
    };
    let step: Promise<unknown> | undefined;
    try {
      await control({ type: "step", ms: variant.day * DAY });
      const initial = await state();
      const members = initial.members.filter(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out"
        && m.joinedAt !== undefined && (variant.dayZero ? m.joinedAt < initial.clock.start + DAY : m.joinedAt >= initial.clock.start + DAY)).slice(0, 2);
      if (members.length !== 2) throw Error("Insufficient joined adults");
      const ids = members.map(m => m.id);
      for (const memberId of ids) await control({ type: "takeover", memberId, on: true });
      const pid = (await control({ type: "propose", participants: ids })).data.id;
      let done = false;
      step = control({ type: "step", ms: 5 * DAY }).finally(() => { done = true; });
      const deadline = performance.now() + 30_000;
      while (!done && performance.now() < deadline) {
        for (const prompt of (await state()).game?.prompts ?? [])
          await control({ type: "reply", promptId: prompt.id, ...(prompt.proposalId === pid ? { text: "yes" } : { auto: true }) });
        await Bun.sleep(1);
      }
      if (!done) throw Error("Step did not complete");
      await step;
      const s = await state(), o = s.opportunities.find(o => o.id === pid)!;
      expect({ state: o.state, attended: ids.map(id => o.status[id]),
        welcome: s.game!.missions.find(m => m.id === "welcome_wagon")!.done })
        .toEqual({ state: "FEEDBACK_COLLECTED", attended: ["attended", "attended"], welcome: variant.done });
    } finally {
      for (const memberId of (await state()).game?.controlled ?? []) await control({ type: "takeover", memberId, on: false });
      await step;
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 120_000);
