import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { ObsState } from "../src/types.ts";

test("negated cancellation keeps a takeover confirmation without masking a separate cancellation", async () => {
  for (const variant of [
    { text: "Yes, keep the plan; do not cancel it", intent: "accept", decision: "accept", plannedShow: true },
    { text: "Yes, please don't cancel it", intent: "accept", decision: "accept", plannedShow: true },
    { text: "cancel", intent: "flake_notice", decision: "none", plannedShow: false },
    { text: "Do not cancel the restaurant; I can't come", intent: "flake_notice", decision: "none", plannedShow: false },
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "obs-negated-cancel-"));
    const token = "local-negated-cancel-test-0000000000";
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const server = await createServer({ port: 0, development: false, token,
      staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
      game: { seed: 1, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url: undefined, service: false, pollMs: 3_600_000 },
    });
    const control = async (cmd: unknown) => {
      const response = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
      const result = await response.json();
      if (response.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
      return result;
    };
    const source = await server.source("game") as GameSource;
    let step: Promise<unknown> | undefined;
    try {
      await control({ type: "step", ms: 7 * DAY });
      for (const m of source.state().members.filter(m => m.joined && !m.minor))
        await control({ type: "takeover", memberId: m.id, on: true });
      let done = false, observed: unknown;
      step = control({ type: "step", ms: 4 * DAY }).finally(() => { done = true; });
      const deadline = performance.now() + 30_000;
      while (!done && !observed && performance.now() < deadline) {
        const state = await fetch(`${server.url}/api/state`, { headers }).then(r => r.json()) as ObsState;
        for (const prompt of state.game?.prompts ?? []) {
          const message = source.world.channel.messagesFor(prompt.memberId).find(m => m.id === prompt.messageId);
          if (message?.meta?.booked && prompt.proposalId) {
            const reply = await control({ type: "reply", promptId: prompt.id, text: variant.text });
            const memory = source.world.memories.get(prompt.memberId)?.proposals[prompt.proposalId];
            observed = { text: reply.data.text, intent: reply.data.intent, decision: reply.data.decision, plannedShow: memory?.plannedShow };
            break;
          }
          await control({ type: "reply", promptId: prompt.id, auto: true });
        }
        await Bun.sleep(1);
      }
      expect(observed).toEqual(variant);
    } finally {
      for (const memberId of source.state().game?.controlled ?? []) await control({ type: "takeover", memberId, on: false });
      await step;
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 120_000);
