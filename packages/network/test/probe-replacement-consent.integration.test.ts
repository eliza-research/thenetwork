import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem, simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")];
const probesTo = (w: Mini, id: string, from = 0) => w.to(id, from).filter(s => s.meta.type === "probe" || s.meta.type === "plan_probe");

test.each(["yes", "no"])("a member who agreed is asked again about the replacement before any reveal (answer again: %s)", async again => {
  const w = new Mini(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed(second!))).toBe(true);
  const mark = w.mark();
  await w.say(second!, "no");

  expect(await w.runUntil(() => w.probed(first!) || w.probed("c"))).toBe(true);
  expect(w.probed(first!)).toBe(true);
  expect(probesTo(w, first!, mark)).toHaveLength(1);
  expect(probesTo(w, "c", mark)).toEqual([]);
  expect(w.meetings).toEqual([]);
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c", askedAgain: [first] });

  await w.say(first!, again);
  if (again === "no") {
    await w.run(2 * DAY);
    expect(w.meetings).toEqual([]);
    expect(w.to("c", mark).some(s => /Ana|Ben/.test(s.body))).toBe(false);
    return;
  }
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  expect(w.meetings).toEqual([]);
  await w.say("c", "yes");
  expect(w.meetings).toMatchObject([{ participants: expect.arrayContaining([first, "c"]) }]);
});

test("an activity-partner plan asks the first member again before its alternate partner", async () => {
  const w = new Mini(people, { inlineJudge: holdEveryItem.inline });
  await w.onboard("a", "b", "c");
  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "partner_backfill", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ["a", "b"], alternates: ["c"], partner: true,
    size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"), 2 * DAY)).toBe(true);
  const mark = w.mark();
  await w.say("b", "no");

  expect(await w.runUntil(() => w.probed("a") || w.probed("c"), 2 * DAY)).toBe(true);
  expect(w.probed("a")).toBe(true);
  expect(probesTo(w, "c", mark)).toEqual([]);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("c"), 2 * DAY)).toBe(true);
  expect(w.meetings).toEqual([]);
  await w.say("c", "yes");
  expect(w.meetings).toMatchObject([{ proposalId: item.oppId, participants: expect.arrayContaining(["a", "c"]) }]);
});

test("a probe still waiting for its answer is sent again when the other member is replaced", async () => {
  const w = new Mini(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  expect(w.probed(second!)).toBe(false);
  const mark = w.mark();
  await w.net.onInbound({ id: "stop-before-turn", memberId: second!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });

  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c", askedAgain: [first] });
  expect(probesTo(w, first!, mark)).toHaveLength(1);
  expect(probesTo(w, "c", mark)).toEqual([]);
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  expect(w.meetings).toEqual([]);
  await w.say("c", "yes");
  expect(w.meetings).toMatchObject([{ participants: expect.arrayContaining([first, "c"]) }]);
});

test("a member asked again who stops before the new probe still counts as told when found to be a minor", async () => {
  const w = new Mini([...people, climber("d", "Dev Rao")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c", "d");
  const id = w.propose(["a", "b"], { alternates: ["c", "d"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed(second!))).toBe(true);
  await w.until(23);
  const mark = w.mark();
  await w.say(second!, "no");
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c", askedAgain: [first] });
  expect(probesTo(w, first!, mark)).toEqual([]);
  await w.net.onInbound({ id: "stop-after-reask", memberId: first!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: first, in: "d" });
  await w.say(first!, "I'm 16, is that ok?");
  expect(w.log("minor_signal").map(l => l.detail.memberId)).toEqual([first]);
  expect(w.net.exportState().opps.find(o => o.id === id)).toMatchObject({ stage: "closed", closedReason: "minors policy", minorKnew: true });
});

test("an answer to a probe that a replacement voided hears once that the plan changed and counts as nothing", async () => {
  const w = new Mini(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.until(23);
  expect(w.probed(first!)).toBe(true);
  const mark = w.mark();
  await w.net.onInbound({ id: "stop-at-night", memberId: second!, body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  expect(w.log("probe_replaced").at(-1)?.detail).toMatchObject({ out: second, in: "c", askedAgain: [first] });
  expect(probesTo(w, first!, mark)).toEqual([]);

  const answers = w.log("probe_answer").length;
  const turn = await w.net.onInbound({ id: "yes-to-voided", memberId: first!, body: "Yes I'm in!", ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(first!, mark).map(s => s.body)).toEqual([copy.probeVoided]);
  expect(w.log("late_probe_answer").at(-1)?.detail).toMatchObject({ memberId: first, voided: true });
  expect(w.log("probe_answer")).toHaveLength(answers);

  const again = w.mark();
  expect(await w.net.onInbound({ id: "yes-to-voided-again", memberId: first!, body: "yes", ts: w.clock.now(), channel: "sms" })).toBe("handled");
  expect(w.to(first!, again)).toEqual([]);
  expect(w.log("probe_answer")).toHaveLength(answers);

  expect(await w.runUntil(() => w.probed(first!), DAY)).toBe(true);
  expect(probesTo(w, "c", mark)).toEqual([]);
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  expect(w.meetings).toEqual([]);
  await w.say("c", "yes");
  expect(w.meetings).toMatchObject([{ participants: expect.arrayContaining([first, "c"]) }]);
});

test("the reviewer reads the probe and introduction words that each reviewed alternate would bring", async () => {
  const w = new Mini(people, { inlineJudge: holdEveryItem.inline });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.net.reviewQueue().length > 0)).toBe(true);
  const item = w.net.reviewQueue()[0]!;
  const preview = w.net.reviewProbePreview(item.oppId, item.revision)!;
  expect(preview.replacements.map(r => [r.alternate, r.replaces]).sort()).toEqual([["c", "a"], ["c", "b"]]);
  for (const r of preview.replacements) {
    const stays = r.replaces === "a" ? "b" : "a";
    expect(r.probes.map(p => p.memberId).sort()).toEqual([stays, "c"].sort());
    const display = (id: string) => w.net.memberList().find(m => m.id === id)!.display;
    expect(r.probes.find(p => p.memberId === stays)!.reveal.text).toContain(display("c"));
    expect(r.probes.find(p => p.memberId === "c")!.reveal.text).toContain(display(stays));
    for (const p of r.probes) expect(p.reveal.text).not.toContain(display(r.replaces));
  }

  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed(second!))).toBe(true);
  const mark = w.mark();
  await w.say(second!, "no");
  const entry = preview.replacements.find(r => r.replaces === second)!;
  expect(await w.runUntil(() => w.probed(first!))).toBe(true);
  const reasked = probesTo(w, first!, mark).map(s => s.body);
  expect(reasked).toHaveLength(1);
  expect(reasked[0]!.endsWith(entry.probes.find(p => p.memberId === first)!.text!)).toBe(true);
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  const alternateProbe = probesTo(w, "c", mark).map(s => s.body);
  expect(alternateProbe).toHaveLength(1);
  expect(alternateProbe[0]!.endsWith(entry.probes.find(p => p.memberId === "c")!.text!)).toBe(true);
});

test("a group plan backfill skips an alternate who would change the words that the others heard", async () => {
  const sharer = (id: string, name: string, interests: string[]) => ({ ...climber(id, name), interests, shareable: true });
  const w = new Mini([sharer("a", "Ana Diaz", ["climbing"]), sharer("b", "Ben Ito", ["climbing"]), sharer("c", "Cleo Park", ["climbing"]),
    sharer("d", "Dev Rao", ["climbing"]), sharer("e", "Eli Moss", ["hiking"]), sharer("f", "Fay Lund", ["climbing"])], { inlineJudge: holdEveryItem.inline });
  await w.onboard("a", "b", "c", "d", "e", "f");
  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "group_backfill", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ["a", "b", "c", "d"], alternates: ["e", "f"], partner: false,
    size: { min: 4, target: 4, max: 4 }, quorum: 4, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
  expect(probesTo(w, "a")[0]!.body).toContain("into climbing");
  await w.say("a", "yes");
  const mark = w.mark();
  await w.say("d", "no");
  expect(await w.runUntil(() => w.probed("e") || w.probed("f"), 2 * DAY)).toBe(true);
  expect(w.probed("f")).toBe(true);
  expect(probesTo(w, "e", mark)).toEqual([]);
  expect(probesTo(w, "f", mark)[0]!.body).toContain("into climbing");
});
