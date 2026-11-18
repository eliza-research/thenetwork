import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { ControlCommand, ControlResult, ObsState } from "../src/types.ts";

test("a takeover cancellation with a curly apostrophe records notice in the native outcome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-takeover-cancel-"));
  const token = "local-takeover-cancel-test-0000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed: 7, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  const control = async (cmd: ControlCommand): Promise<ControlResult> => {
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
    if (response.status !== 200) throw Error(`Control HTTP ${response.status}`);
    return response.json() as Promise<ControlResult>;
  };
  const source = await server.source("game") as GameSource;
  let step: Promise<ControlResult> | undefined;
  try {
    expect(await control({ type: "step", ms: 7 * DAY })).toMatchObject({ ok: true });
    for (const m of source.state().members.filter(m => m.joined && !m.minor))
      await control({ type: "takeover", memberId: m.id, on: true });
    let done = false;
    step = control({ type: "step", ms: 4 * DAY }).finally(() => { done = true; });
    let observed: { reply: ControlResult; memberId: string; proposalId: string } | undefined;
    const deadline = performance.now() + 30_000;
    while (!done && !observed && performance.now() < deadline) {
      const state = await fetch(`${server.url}/api/state`, { headers }).then(r => r.json()) as ObsState;
      for (const prompt of state.game?.prompts ?? []) {
        const message = source.world.channel.messagesFor(prompt.memberId).find(m => m.id === prompt.messageId);
        if (message?.meta?.booked && prompt.proposalId) {
          const reply = await control({ type: "reply", promptId: prompt.id, text: "I can’t make it" });
          observed = { reply, memberId: prompt.memberId, proposalId: prompt.proposalId };
          break;
        }
        await control({ type: "reply", promptId: prompt.id, auto: true });
      }
      await Bun.sleep(1);
    }
    for (const memberId of source.state().game?.controlled ?? []) await source.control({ type: "takeover", memberId, on: false });
    await step;
    const outcome = source.world.records.find(r => r.type === "outcome" && r.proposalId === observed?.proposalId);
    const attendance = outcome?.type === "outcome" && observed ? outcome.attendance[observed.memberId] : undefined;
    expect({ reply: observed?.reply, attendance }).toMatchObject({
      reply: { ok: true, data: { intent: "flake_notice", decision: "none" } },
      attendance: { showed: false, cancelledWithNotice: true },
    });
  } finally {
    for (const memberId of source.state().game?.controlled ?? []) await source.control({ type: "takeover", memberId, on: false });
    await step;
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
