// A yes answers one probe about one arrangement (audit OPP18). Before the fix, a member who said yes
// kept that yes when the other person declined and a reviewed alternate replaced them: the alternate
// said yes and the two were introduced by first name, although the first member was never asked
// about the alternate. The same held for an activity-partner plan whose partner was backfilled.
// spec/probeDispatch.md, "A replacement asks again every member who heard about the earlier roster" and
// "Nobody is introduced without a yes to the current roster"
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")];
const probesTo = (w: Mini, id: string, from = 0) => w.to(id, from).filter(s => s.meta.type === "probe" || s.meta.type === "plan_probe");

test.each(["yes", "no"])("a member who agreed is asked again about the replacement before any reveal (answer again: %s)", async again => {
  const w = new Mini(people, { review: "auto" });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed(second!))).toBe(true);
  const mark = w.mark();
  await w.say(second!, "no");

  // The member who agreed gets a new probe about the new arrangement first; the alternate waits.
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
  const w = new Mini(people, { review: "human" });
  await w.onboard("a", "b", "c");
  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "partner_backfill", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ["a", "b"], alternates: ["c"], partner: true,
    size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
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
  // The first member's probe described the second member. The second member stops before their turn;
  // a yes to the old probe must not introduce the first member to the alternate.
  const w = new Mini(people, { review: "auto" });
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
  // A re-ask must not erase the record that the member heard about the opportunity: the minors policy
  // reads it (spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person").
  const w = new Mini([...people, climber("d", "Dev Rao")], { review: "auto" });
  await w.onboard("a", "b", "c", "d");
  const id = w.propose(["a", "b"], { alternates: ["c", "d"] });
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const [first, second] = w.probed("a") ? ["a", "b"] : ["b", "a"];
  await w.say(first!, "yes");
  expect(await w.runUntil(() => w.probed(second!))).toBe(true);
  // At 23:00 the new probe to the member asked again waits for the end of their quiet hours.
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
