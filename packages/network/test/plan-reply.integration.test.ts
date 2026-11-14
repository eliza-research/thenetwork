import { expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini, START } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

test("reviewed plan replies respect the deadline after a restart and allow booked late joins", async () => {
  // spec/planDecision.md, "Booking requires a pending acceptance that meets quorum"
  const ids = ["a", "b", "c", "d", "e", "f"];
  const failures = [];
  for (const seed of [1, 2, 3]) for (const mode of ["before", "at", "after", "booked-join"] as const) {
    const w = new Mini(ids.map(climber), { seed, review: "human", plans: true, matchingEnabled: true });
    w.clock.set(START + 3 * DAY);
    await w.onboard(...ids);
    await w.run(HOUR);
    const q = w.net.reviewQueue()[0]!;
    expect(q?.origin).toBe("planner");
    expect(w.sent.filter(s => s.meta.type === "plan_probe")).toEqual([]);
    await w.run(11 * HOUR);
    expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => ids.every(id => w.probed(id)), DAY)).toBe(true);
    await w.say("a", "yes");
    await w.say("b", "yes");
    if (mode === "booked-join") await w.say("c", "yes");
    w.restart();
    const lookup = () => w.net.exportState().opps.find(o => o.id === q.oppId)!;
    const deadline = lookup().plan!.probeDeadline;
    await w.run(deadline - w.clock.now() - MINUTE);
    await w.net.tick(w.clock.now());
    w.clock.set(deadline + (mode === "before" ? -1 : mode === "at" ? 0 : 1));
    const id = mode === "booked-join" ? "d" : "c";
    const count = () => w.net.exportState().plans!.counters.planYes;
    const before = { meetings: w.meetings.length, accepted: count(), messages: w.sent.length, logs: w.logs.length };
    await w.say(id, "yes");
    const closed = mode === "at" || mode === "after";
    const o = lookup();
    const report = {
      seed, mode, stage: o.stage, answer: o.planRun!.answers[id], meetings: w.meetings.length - before.meetings,
      accepted: count() - before.accepted,
      acknowledged: w.sent.slice(before.messages).some(s => s.to === id && s.body.includes("I'll tell you once enough")),
      logged: w.logs.slice(before.logs).some(l => l.kind === "probe_answer" && l.detail.memberId === id),
    };
    if (closed
      ? report.stage !== "closed" || report.answer !== "pending" || report.meetings !== 0 || report.accepted !== 0 || report.acknowledged || report.logged
      : report.stage !== "scheduled" || report.answer !== "yes" || report.meetings !== 1 || report.accepted !== 1 || !report.logged) failures.push(report);
  }
  expect(failures).toEqual([]);
});

test("a plan with no pending members falls back regardless of which reply comes last", async () => {
  // spec/planDecision.md, "An unanswered plan closes when its deadline passes"
  const ids = ["a", "b", "c"];
  for (const order of [["a", "b", "c"], ["b", "c", "a"]]) {
    const w = new Mini(ids.map(climber), { review: "human" });
    await w.onboard(...ids);
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_order", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ids, alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
    };
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const original = w.net.reviewQueue()[0]!;
    expect(w.net.review(original.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => ids.every(id => w.probed(id)), 2 * DAY)).toBe(true);
    for (const id of order.slice(0, -1)) await w.say(id, id === "a" ? "no" : "yes");
    expect(w.log("plan_fallback")).toEqual([]);
    await w.say(order[2]!, order[2] === "a" ? "no" : "yes");
    expect(w.log("plan_fallback").map(log => log.t)).toEqual([w.clock.now()]);
    expect(w.meetings).toEqual([]);
    // spec/planDecision.md, "Two acceptances for a group require new partner consent"
    const partner = w.net.reviewQueue().find(item => item.oppId !== original.oppId)!;
    expect(w.net.exportState().opps.find(o => o.id === partner.oppId)?.plan).toMatchObject({ partner: true, invited: ["b", "c"] });
  }
});
