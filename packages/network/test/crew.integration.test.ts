import { expect, test } from "vitest";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import { probeReplyReceiptKey } from "../src/network.ts";
import { Mini } from "./mini.ts";

const ids = ["a", "b", "c", "d", "e", "f"];
const members = ids.map(id => ({ id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Prospect Heights", interests: ["coffee", "climbing"] }));

test("a recurring crew needs the configured positive history or a stated recurring want", async () => {
  // spec/planDecision.md, "A crew offer needs enough positive responses"
  const failures = [];
  for (const seed of [1, 2, 3]) for (const scenario of ["default-one", "two-only-one", "two-complete", "two-insufficient-common", "two-recurring"] as const) {
    const minPlans = scenario === "default-one" ? 1 : 2;
    const rounds = scenario === "two-complete" || scenario === "two-insufficient-common" ? 2 : 1;
    const people = scenario === "two-recurring" ? members.map(member => ({
      ...member, wants: [{ objective: "Find a regular climbing partner", category: "hobby" as const }],
    })) : members;
    const w = new Mini(people, { seed, review: "human", plans: true, matchingEnabled: true, plansConfig: { crews: { minPlans } } });
    await w.onboard(...ids);
    const positives: string[][] = [];
    for (let round = 0; round < rounds; round++) {
      expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 14 * DAY)).toBe(true);
      const q = w.net.reviewQueue().find(q => q.origin === "planner")!;
      expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
      const plan = () => w.net.exportState().opps.find(o => o.id === q.oppId)!;
      for (let pick = 0; pick < ids.length && plan().stage === "probing"; pick++) {
        if (!await w.runUntil(() => ids.some(id => w.probed(id)), 4 * DAY)) break;
        for (const id of ids) if (w.probed(id)) await w.say(id, "yes");
      }
      const booked = plan();
      expect(booked.stage).toBe("scheduled");
      const going = booked.status.filter(([, status]) => status === "yes").map(([id]) => id);
      await w.run(booked.plan!.window.start + HOUR - w.clock.now());
      for (const id of going) await w.say(id, "Thanks for arranging this.");
      await w.run(3 * HOUR);
      for (const [index, id] of going.entries()) {
        const decline = scenario === "two-insufficient-common" && round === 1 && index >= 2;
        await w.say(id, decline ? "I came, but it was not for me. No, I would not do it again." : "We all came, it was great. I'd do it again.");
      }
      w.restart();
      positives.push(Object.entries(plan().post ?? {}).filter(([, p]) => p.came && p.again).map(([id]) => id));
    }
    const common = positives[0]!.filter(id => positives.every(p => p.includes(id))).length;
    const offers = w.log("crew_offered").length;
    const expected = scenario === "default-one" || scenario === "two-complete" || scenario === "two-recurring" ? 1 : 0;
    if (offers !== expected) failures.push({ seed, scenario, common, offers, expected });
  }
  expect(failures).toEqual([]);
});

test("opt-in follows acceptance of that member's exact open crew offer", async () => {
  const w = new Mini(members, { review: "human", plans: true, matchingEnabled: true });
  const receipts = new Map<string, InitialInviteReceipt>();
  const prompts = new Map<string, string>();
  const context = w.ctx();
  w.net.init({ ...context, send(member, body, opts) {
    const delivered = context.send(member, body, opts);
    const id = opts?.idempotencyKey ?? delivered.id;
    if (opts?.meta?.type === "crew_offer") prompts.set(member, id);
    else {
      const opp = opts?.meta?.type === "plan_probe" ? opts.meta.proposalId : undefined;
      const key = opp ? probeReplyReceiptKey(opp, member, { at: delivered.ts, probeReceiptId: id }) : id;
      receipts.set(key, { kind: "accepted", at: delivered.ts });
    }
    return { ...delivered, id };
  }, initialInviteReceipt: id => receipts.get(id) });

  await w.onboard(...ids);
  expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 14 * DAY)).toBe(true);
  const q = w.net.reviewQueue().find(q => q.origin === "planner")!;
  expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  await w.answerProbes(ids);
  const plan = w.net.exportState().opps.find(o => o.id === q.oppId)!;
  expect(plan.stage).toBe("scheduled");
  const going = plan.status.filter(([, status]) => status === "yes").map(([id]) => id);
  await w.run(plan.plan!.window.start + HOUR - w.clock.now());
  for (const id of going) await w.say(id, "Thanks for arranging this.");
  await w.run(3 * HOUR);
  for (const id of going) await w.say(id, "We all came, it was great. I'd do it again.");
  const member = going.findLast(id => prompts.has(id))!;
  const prompt = prompts.get(member)!;
  expect(prompt).toBeDefined();

  const otherPrompt = [...prompts.values()].find(id => id !== prompt);
  expect(otherPrompt).toBeDefined();
  receipts.set(otherPrompt!, { kind: "accepted", at: w.clock.now() });
  await w.say(member, "Yes, I'm in.");
  expect(w.log("crew_answer")).toHaveLength(0);
  w.clock.advance(1);
  const acceptedAt = w.clock.now();
  receipts.set(prompt, { kind: "accepted", at: acceptedAt });
  await w.net.onInbound({ id: "crew-before-receipt", memberId: member, body: "Yes, I'm in.", ts: acceptedAt, signedReceivedAt: acceptedAt - 1, channel: "sms" });
  expect(w.log("crew_answer")).toHaveLength(0);
  await w.say(member, "Yes, I'm in.");
  expect(w.log("crew_answer").map(row => row.detail)).toEqual([expect.objectContaining({ memberId: member, yes: true })]);
});
