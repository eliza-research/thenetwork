import { setTimeout as waitForMs } from "node:timers/promises";
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";

const replies = [
  { text: "I can’t make it", cancelled: true },
  { text: "Yes, keep the plan; do not cancel it", cancelled: false },
  { text: "Yes, please don’t cancel it", cancelled: false },
  { text: "Yes, I’ll be there", cancelled: false },
  { text: "Do not cancel the restaurant; I can’t come", cancelled: true },
  { text: "Cancel this date", cancelled: true },
  { text: "Yes, cancel this date", cancelled: true },
  { text: "I have to cancel", cancelled: true },
  { text: "We don't need to cancel", cancelled: false, preservesPolicy: true },
  { text: "No, not my number", cancelled: false, preservesPolicy: true },
  { text: "Don’t give out my number - I'm not coming", cancelled: true },
];

async function runTakeover(text: string) {
  const game = new GameSource({
    seed: 1, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000,
  });
  await game.init();
  let step: ReturnType<GameSource["control"]> | undefined;
  try {
    expect(await game.control({ type: "step", ms: 7 * DAY })).toMatchObject({ ok: true });
    for (const member of game.state().members.filter(m => m.joined && !m.minor)) {
      await game.control({ type: "takeover", memberId: member.id, on: true });
    }

    let done = false;
    const stepEnd = game.world.clock.now() + 4 * DAY;
    step = game.control({ type: "step", ms: 4 * DAY }).finally(() => { done = true; });
    let selected: { memberId: string; proposalId: string; messageId: string; meetingAt: number } | undefined;
    let reply: Awaited<ReturnType<GameSource["control"]>> | undefined;
    while (!done) {
      if (selected && game.world.records.some(r => r.type === "outcome" && r.proposalId === selected!.proposalId && r.at === selected!.meetingAt)) break;
      for (const prompt of game.state().game?.prompts ?? []) {
        const msg = game.world.channel.messagesFor(prompt.memberId).find(m => m.id === prompt.messageId);
        const booking = msg?.meta?.booked;
        if (!selected && booking && prompt.proposalId && booking.at > prompt.at && booking.at <= stepEnd) {
          selected = {
            memberId: prompt.memberId, proposalId: prompt.proposalId, messageId: prompt.messageId, meetingAt: booking.at,
          };
          reply = await game.control({ type: "reply", promptId: prompt.id, text });
        } else if (selected && booking?.proposalId === selected.proposalId && booking.at === selected.meetingAt && prompt.memberId !== selected.memberId) {
          expect(await game.control({ type: "reply", promptId: prompt.id, text: "Yes, I’ll be there" })).toMatchObject({ ok: true });
        } else {
          await game.control({ type: "reply", promptId: prompt.id, auto: true });
        }
      }
      if (!done) await waitForMs(1);
    }
    if (!selected) throw new Error("The seeded world did not offer a booked plan for takeover.");

    for (const memberId of game.state().game?.controlled ?? []) {
      await game.control({ type: "takeover", memberId, on: false });
    }
    expect(await step).toMatchObject({ ok: true });
    const outcome = game.world.records.find(r => r.type === "outcome" && r.proposalId === selected.proposalId && r.at === selected.meetingAt);
    const attendance = outcome?.type === "outcome" ? outcome.attendance[selected.memberId] : undefined;
    const decision = game.world.records.find(r => r.type === "decision" && r.messageId === selected.messageId);
    return { reply, decision, attendance, selected };
  } finally {
    await game.dispose();
    await step;
  }
}

let policyControl: ReturnType<typeof runTakeover> | undefined;
test.each(replies)("records takeover attendance after '$text'", async ({ text, cancelled, preservesPolicy }) => {
  const { reply, decision, attendance, selected } = await runTakeover(text);
  const intent = cancelled ? "flake_notice" : "accept";
  expect({ reply, decision, attendance }).toMatchObject({
    reply: { ok: true, data: { text, intent } },
    decision: { intent, proposalId: selected.proposalId },
    attendance: { cancelledWithNotice: cancelled },
  });
  if (preservesPolicy) {
    const neutral = await (policyControl ??= runTakeover("I read the details"));
    expect(neutral.selected).toEqual(selected);
    expect(attendance).toEqual(neutral.attendance);
  } else {
    if (!cancelled) expect(attendance?.cancelledByNetwork).toBeUndefined();
    expect(attendance?.showed).toBe(!cancelled);
  }
}, 60_000);
