import { expect, test } from "vitest";
import type { InitialInviteReceipt } from "@thenetwork/core";
import { gatheringRepeatOppId, gatheringRepeatProbeKey, type GatheringRepeatSource } from "../src/network.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem, type InlineReviewJudge } from "../../engine/src/reviewJudge.ts";

const source: GatheringRepeatSource = {
  gatheringId: "79defc40-f749-4a7c-b39f-9eb86279d2b9", revision: 1, groupReviewId: "884bda9d-50c9-4261-999b-bed198b7ad39",
  members: ["a", "b"], consentVersion: "2".repeat(64),
};

async function world(judge?: InlineReviewJudge) {
  const w = new Mini([
    { id: "a", name: "Ari Birch", age: 30, area: "Greenpoint" },
    { id: "b", name: "Bea Cedar", age: 31, area: "Greenpoint" },
  ], { ...(judge ? { inlineJudge: judge } : {}), probes: false, growth: false });
  await w.onboard(...source.members);
  for (const member of source.members) w.net.noteGatheringFollowupReply(member);
  return w;
}

// spec/gatheringRepeat.md, "Review and each new reply are separate from the earlier mutual choice"
test("a gathering pair is approved by the review judge and needs fresh responses to independently delivered probes", async () => {
  const w = await world();
  const receipts = new Map<string, InitialInviteReceipt>();
  const ctx = w.ctx();
  w.net.init({ ...ctx, send(member, body, opts) {
    const result = ctx.send(member, body, opts);
    return { ...result, id: opts?.idempotencyKey ?? result.id };
  }, initialInviteReceipt: id => receipts.get(id) });
  const id = gatheringRepeatOppId(source);
  const before = w.mark();
  const matching = (member: string) => w.to(member, before).filter(msg => msg.meta.probe?.key === id);
  const pairCopy: GatheringRepeatSource = { ...source, members: ["b", "a"] };
  w.net.setGatheringRepeatSources([source, pairCopy]);
  w.net.queueGatheringRepeats();
  w.net.queueGatheringRepeats();
  expect(w.net.exportState().opps.filter(opp => opp.id === id && opp.stage === "review")).toHaveLength(1);
  expect(w.sent).toHaveLength(before);
  expect(w.net.decide(id, "approve", { reviewer: "staff", revision: 0 })).toMatchObject({ ok: false, reason: "not_held_for_staff" });
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.find(opp => opp.id === id)?.review).toMatchObject({ decision: "approve", approver: "judge", reviewer: "sim_review_judge" });
  expect(w.meetings).toHaveLength(0);

  expect(await w.runUntil(() => source.members.some(member => matching(member).length > 0))).toBe(true);
  const first = source.members.find(member => matching(member).length > 0)!;
  const second = source.members.find(member => member !== first)!;
  expect(matching(second)).toHaveLength(0);
  expect(matching(first)[0]!.body).not.toMatch(/\b(?:ari|bea|gathering|reference)\b/i);
  const answer = (member: string) => matching(member)[0]!.meta.timeOptions?.length ? "option A" : "yes";
  await w.say(first, answer(first));
  expect(matching(second)).toHaveLength(0);
  expect(w.net.exportState().opps.find(opp => opp.id === id)?.primed).toEqual([]);
  receipts.set(gatheringRepeatProbeKey(id, first), { kind: "accepted", at: w.clock.now() });
  await w.say(first, answer(first));
  expect(await w.runUntil(() => matching(second).length > 0)).toBe(true);
  expect(w.meetings).toHaveLength(0);
  expect(matching(second)[0]!.body).not.toMatch(/\b(?:ari|bea|gathering|reference)\b/i);
  receipts.set(gatheringRepeatProbeKey(id, second), { kind: "accepted", at: w.clock.now() });
  await w.say(second, answer(second));
  expect(w.meetings.map(meeting => meeting.proposalId)).toEqual([id]);
  w.net.setGatheringRepeatSources([]);
  w.net.queueGatheringRepeats();
  expect(w.net.exportState().opps.find(opp => opp.id === id)?.stage).toBe("scheduled");
});

test("a held gathering pair keeps its fixed pair for staff", async () => {
  const w = await world(holdEveryItem.inline);
  const id = gatheringRepeatOppId(source);
  w.net.setGatheringRepeatSources([source]);
  w.net.queueGatheringRepeats();
  await w.net.tick(w.clock.now());
  expect(w.net.reviewQueue().find(row => row.oppId === id)?.exception).toMatchObject({ verdict: "flag" });
  expect(w.net.decide(id, "reroll", { reviewer: "staff", revision: 0 })).toMatchObject({ ok: false, reason: "gathering_repeat_fixed_pair" });
  expect(w.net.decide(id, "edit", { reviewer: "staff", revision: 0, objective: "Meet the member from the gathering" })).toMatchObject({ ok: false, reason: "gathering_repeat_fixed_pair" });
});

// spec/gatheringRepeat.md, "A current exact mutual choice can enter review once per gathering pair"
test("a changed gathering consent version is refused after restart and cannot create a second review for the pair", async () => {
  const w = await world(holdEveryItem.inline);
  const id = gatheringRepeatOppId(source);
  w.net.setGatheringRepeatSources([source]);
  w.net.queueGatheringRepeats();
  await w.net.tick(w.clock.now());
  expect(w.net.reviewQueue().map(row => row.oppId)).toContain(id);
  w.restart();
  const before = w.mark();
  const changed = { ...source, consentVersion: "3".repeat(64) };
  const state = w.net.exportState();
  w.net.setGatheringRepeatSources([changed]);
  w.net.importState(state);
  expect(w.net.decide(id, "approve", { reviewer: "staff", revision: 0 })).toMatchObject({ ok: false, reason: "repeat_no_longer_available" });
  w.net.queueGatheringRepeats();
  expect(w.net.reviewQueue().map(row => row.oppId)).not.toContain(id);
  expect(w.net.exportState().opps.filter(opp => opp.id === id)).toHaveLength(1);
  expect(w.mark()).toBe(before);
});
