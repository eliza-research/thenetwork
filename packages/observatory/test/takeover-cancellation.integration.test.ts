import { setTimeout as waitForMs } from "node:timers/promises";
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";

test.each([
  { text: "I can’t make it", cancelled: true },
  { text: "Yes, keep the plan; do not cancel it", cancelled: false },
  { text: "Yes, please don’t cancel it", cancelled: false },
  { text: "Yes, I’ll be there", cancelled: false },
  { text: "Do not cancel the restaurant; I can’t come", cancelled: true },
  { text: "Cancel this date", cancelled: true },
  { text: "I have to cancel", cancelled: true },
  { text: "We don't need to cancel", cancelled: false },
  { text: "No, not my number", cancelled: false },
  { text: "Don’t give out my number - I'm not coming", cancelled: true },
])("records takeover attendance after '$text'", async ({ text, cancelled }) => {
  const game = new GameSource({
    seed: 7, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000,
  });
  await game.init();
  let step: ReturnType<GameSource["control"]> | undefined;
  try {
    expect(await game.control({ type: "step", ms: 7 * DAY })).toMatchObject({ ok: true });
    for (const member of game.state().members.filter(m => m.joined && !m.minor)) {
      await game.control({ type: "takeover", memberId: member.id, on: true });
    }

    let done = false;
    step = game.control({ type: "step", ms: 4 * DAY }).finally(() => { done = true; });
    const deadline = performance.now() + 15_000;
    let selected: { memberId: string; proposalId: string; messageId: string; meetingAt: number } | undefined;
    let reply: Awaited<ReturnType<GameSource["control"]>> | undefined;
    while (!selected && !done && performance.now() < deadline) {
      for (const prompt of game.state().game?.prompts ?? []) {
        const msg = game.world.channel.messagesFor(prompt.memberId).find(m => m.id === prompt.messageId);
        if (msg?.meta?.booked && prompt.proposalId) {
          selected = {
            memberId: prompt.memberId, proposalId: prompt.proposalId, messageId: prompt.messageId, meetingAt: msg.meta.booked.at,
          };
          reply = await game.control({ type: "reply", promptId: prompt.id, text });
          break;
        }
        await game.control({ type: "reply", promptId: prompt.id, auto: true });
      }
      if (!selected && !done) await waitForMs(1);
    }
    if (!selected) throw new Error("The seeded world did not offer a booked plan for takeover.");

    for (const memberId of game.state().game?.controlled ?? []) {
      await game.control({ type: "takeover", memberId, on: false });
    }
    expect(await step).toMatchObject({ ok: true });
    const remaining = selected.meetingAt - game.world.clock.now();
    if (remaining > 0) expect(await game.control({ type: "step", ms: remaining + 1 })).toMatchObject({ ok: true });
    const outcome = game.world.records.find(r => r.type === "outcome" && r.proposalId === selected.proposalId);
    const attendance = outcome?.type === "outcome" ? outcome.attendance[selected.memberId] : undefined;
    const decision = game.world.records.find(r => r.type === "decision" && r.messageId === selected.messageId);
    const intent = cancelled ? "flake_notice" : "accept";
    expect({ reply, decision, attendance }).toMatchObject({
      reply: { ok: true, data: { text, intent } },
      decision: { intent, proposalId: selected.proposalId },
      attendance: { showed: !cancelled, cancelledWithNotice: cancelled },
    });
  } finally {
    await game.dispose();
    await step;
  }
}, 60_000);
