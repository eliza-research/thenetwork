// A late answer to an expired one-to-one probe (audit OPP19). Before the fix, a short "yep" after the
// response window was dropped without a reply, and "yes I'm in" opened a model turn with no
// matching item, so the member could believe the introduction was going ahead. Now the member hears
// once that the invitation ended and nothing was shared; nothing counts as consent.
// spec/probeReply.md, "A late answer to an expired probe hears once that the invitation ended"
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test.each(["yep", "Yes I'm in!", "no thanks"])("a late %s hears once that the invitation ended", async late => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const id = w.probed("a") ? "a" : "b";
  const oppId = w.net.memberList().find(m => m.id === id)!.awaiting!.oppId!;
  expect(await w.runUntil(() => !w.probed(id), 50 * HOUR)).toBe(true);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === id).map(l => l.detail.expired)).toEqual([true]);

  const mark = w.mark();
  const turn = await w.net.onInbound({ id: "late-1", memberId: id, body: late, ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(id, mark).map(s => s.body)).toEqual([copy.probeEnded]);
  expect(w.log("late_probe_answer")).toMatchObject([{ detail: { oppId, memberId: id } }]);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === id)).toHaveLength(1);
  expect(w.meetings).toEqual([]);

  // Once only: a second reply while that answer is still the latest message gets no new answer and
  // opens no model turn about the expired probe.
  const again = w.mark();
  const second = await w.net.onInbound({ id: "late-2", memberId: id, body: late, ts: w.clock.now(), channel: "sms" });
  expect(second).toBe("handled");
  expect(w.to(id, again)).toEqual([]);
  expect(w.log("late_probe_answer")).toHaveLength(1);
  expect(w.log("late_probe_answer_again")).toMatchObject([{ detail: { oppId, memberId: id } }]);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === id)).toHaveLength(1);
});

test("a late answer to an expired plan invitation hears once that the invitation ended", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human" });
  await w.onboard("a", "b");
  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "late_partner", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ["a", "b"], alternates: [], partner: true,
    size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
  expect(await w.runUntil(() => !w.probed("a"), 50 * HOUR)).toBe(true);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "a").map(l => l.detail.expired)).toEqual([true]);

  const mark = w.mark();
  const turn = await w.net.onInbound({ id: "late-plan", memberId: "a", body: "Yes I'm in!", ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to("a", mark).map(s => s.body)).toEqual([copy.probeEnded]);
  expect(w.log("late_probe_answer")).toMatchObject([{ detail: { oppId: item.oppId, memberId: "a" } }]);
  expect(w.meetings).toEqual([]);
});

test("an answer to a probe whose opportunity closed hears once that the invitation ended", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  const oppId = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  expect(w.probed(second!)).toBe(false);
  const mark = w.mark();
  await w.net.onInbound({ id: "stop-before-turn", memberId: second!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.net.exportState().opps.find(o => o.id.endsWith(oppId) || o.id === oppId)).toMatchObject({ stage: "closed" });
  expect(w.to(first!, mark)).toEqual([]);
  expect(w.probed(first!)).toBe(false);

  const answers = w.log("probe_answer").length;
  const turn = await w.net.onInbound({ id: "yes-after-close", memberId: first!, body: "Yes I'm in!", ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(first!, mark).map(s => s.body)).toEqual([copy.probeEnded]);
  expect(w.log("late_probe_answer").at(-1)?.detail).toMatchObject({ memberId: first, voided: false });
  expect(w.log("probe_answer")).toHaveLength(answers);

  const again = w.mark();
  expect(await w.net.onInbound({ id: "yes-after-close-again", memberId: first!, body: "yes", ts: w.clock.now(), channel: "sms" })).toBe("handled");
  expect(w.to(first!, again)).toEqual([]);
  expect(w.log("probe_answer")).toHaveLength(answers);
  expect(w.meetings).toEqual([]);
});

test("an answer received just before a replacement voided the probe hears that the plan changed", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")], { review: "auto" });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.until(23);
  expect(w.probed(first!)).toBe(true);
  const receivedAt = w.clock.now();
  w.clock.advance(1000);
  const mark = w.mark();
  await w.net.onInbound({ id: "stop-at-night", memberId: second!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c", askedAgain: [first] });

  const answers = w.log("probe_answer").length;
  const turn = await w.net.onInbound({ id: "yes-before-void", memberId: first!, body: "Yes I'm in!", ts: receivedAt, signedReceivedAt: receivedAt, channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(first!, mark).map(s => s.body)).toEqual([copy.probeVoided]);
  expect(w.log("probe_answer")).toHaveLength(answers);
});

test("a voided probe whose opportunity then closes hears that the invitation ended", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")], { review: "auto" });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.until(23);
  const mark = w.mark();
  await w.net.onInbound({ id: "stop-second", memberId: second!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c" });
  await w.net.onInbound({ id: "stop-alternate", memberId: "c", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.to(first!, mark)).toEqual([]);

  const turn = await w.net.onInbound({ id: "yes-after-both", memberId: first!, body: "Yes I'm in!", ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(first!, mark).map(s => s.body)).toEqual([copy.probeEnded]);
});
