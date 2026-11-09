import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { ObsState } from "../src/types.ts";

test("a member counteroffer earns no acceptance credit in the Observatory", async () => {
  for (const variant of [
    { text: "How about next week?", intent: "counter", status: "countered", state: "INVITING", accepted: 0, points: 0 },
    { text: "yes", intent: "accept", status: "accepted", state: "PARTIALLY_ACCEPTED", accepted: 1, points: 10 },
    { text: "no", intent: "decline", status: "declined", state: "DECLINED", accepted: 0, points: -2 },
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), "obs-counter-acceptance-"));
    const token = "local-counter-acceptance-000000000";
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const server = await createServer({ port: 0, development: false, token,
      staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
      game: { seed: 1, personas: 80, days: 14, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
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
      await control({ type: "step", ms: 7 * DAY });
      const ids = (await state()).members.filter(m => m.joined && !m.minor && !m.declined && m.state !== "opted_out")
        .slice(0, 2).map(m => m.id);
      for (const memberId of ids) await control({ type: "takeover", memberId, on: true });
      const pid = (await control({ type: "propose", participants: ids })).data.id as string;
      let done = false, checked = false;
      step = control({ type: "step", ms: 2 * DAY }).finally(() => { done = true; });
      const deadline = performance.now() + 30_000;
      while (!done && performance.now() < deadline) {
        const prompt = (await state()).game?.prompts[0];
        if (prompt) {
          if (prompt.proposalId === pid) {
            const reply = await control({ type: "reply", promptId: prompt.id, text: variant.text });
            const s = await state(), opp = s.opportunities.find(o => o.id === pid)!;
            const score = s.game!.scores.find(x => x.source === "player")!;
            expect({ text: variant.text, intent: reply.data.intent, status: opp.status[prompt.memberId], state: opp.state,
              accepts: s.stats.accepts, memberAccepted: s.members.find(m => m.id === prompt.memberId)!.counters.accepted,
              scoreAccepted: score.accepted, points: score.points,
              firstSpark: s.game!.missions.find(m => m.id === "first_spark")!.done })
              .toEqual({ text: variant.text, intent: variant.intent, status: variant.status, state: variant.state,
                accepts: variant.accepted, memberAccepted: variant.accepted, scoreAccepted: variant.accepted,
                points: variant.points, firstSpark: variant.accepted > 0 });
            checked = true;
            break;
          }
          await control({ type: "reply", promptId: prompt.id, auto: true });
        }
        await Bun.sleep(1);
      }
      if (!checked) throw Error("No target proposal prompt");
    } finally {
      for (const memberId of (await state()).game?.controlled ?? []) await control({ type: "takeover", memberId, on: false });
      await step;
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 120_000);
