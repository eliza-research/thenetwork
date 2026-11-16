// Plan probe replies against the probe deadline, and the fallback when nobody is pending. A reply at
// or after the deadline must not count, must not become availability evidence and must not be
// acknowledged. The last reply closes an underfilled plan whether it is a yes or a no, and two
// accepting members of a group plan are asked again through a fresh partner plan, never booked as a pair.
import { describe, expect, test } from "vitest";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { copy } from "../src/copy.ts";
import { Mini, START } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("plan probe replies", () => {
  test("reviewed plan replies respect the deadline after a restart and allow booked late joins", async () => {
    // spec/planDecision.md, "Only a pending member can change an open plan"; spec/planDecision.md, "Booking requires a pending acceptance that meets quorum"
    const ids = ["a", "b", "c", "d", "e", "f"];
    const failures: Record<string, unknown>[] = [];
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
      // The late reply must reach an open probe, so that the "at" and "after" cases run the deadline step.
      const open = { probed: w.probed(id), stage: lookup().planRun!.stage };
      if (!open.probed || open.stage !== (mode === "booked-join" ? "booked" : "probing")) failures.push({ seed, mode, open });
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
  }, 600_000);

  test("a plan with no pending members falls back whichever reply comes last, and two acceptances are asked again as a pair", async () => {
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
      // spec/planDecision.md, "Two acceptances for a group require new partner consent"; spec/planDecision.md, "A group plan never books two members directly"
      const partner = w.net.reviewQueue().find(item => item.oppId !== original.oppId)!;
      expect(w.net.exportState().opps.find(o => o.id === partner.oppId)?.plan).toMatchObject({ partner: true, invited: ["b", "c"] });
    }
  }, 300_000);

  test("a smaller group that keeps two seats after a booking conflict is asked again as a pair, counted as one fallback", async () => {
    // spec/planDecision.md, "A group plan never books two members directly"
    const ids = ["a", "b", "c", "d", "x"];
    const w = new Mini(ids.map(climber), { review: "human" });
    await w.onboard(...ids);
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_group", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR }, invited: ["a", "b", "c", "d"], alternates: [],
      partner: false, size: { min: 3, target: 4, max: 4 }, quorum: 4, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {},
      createdAt: now, category: "hobby",
    };
    // The group plan: a, b and c accept; d has not answered yet.
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const group = w.net.reviewQueue()[0]!.oppId;
    expect(w.net.review(group, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
    for (const id of ["a", "b", "c"]) await w.say(id, "yes");
    // A separately reviewed introduction can book while c waits for the plan's quorum.
    const competing = w.propose(["c", "x"]);
    expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === competing), DAY)).toBe(true);
    expect(w.net.review(competing, "approve", { reviewer: "sim_staff" })).toBe(true);
    await w.answerProbes(["c", "x"], () => "yes", 8 * HOUR);
    expect(w.meetings).toMatchObject([{ proposalId: competing, participants: ["c", "x"] }]);
    expect(Math.abs(w.meetings[0]!.at - plan.window.start)).toBeLessThan(4 * HOUR);
    const fallbacks = () => w.net.exportState().plans!.counters.planFallbacks;
    const before = { fallbacks: fallbacks(), meetings: w.meetings.length };
    expect(w.probed("d")).toBe(true);
    await w.say("d", "no");
    expect(w.log("plan_conflict").map(l => l.detail)).toEqual([{ oppId: group, memberId: "c" }]);
    expect(w.log("plan_fallback").filter(l => l.detail.oppId === group).length).toBe(1);
    expect(fallbacks() - before.fallbacks).toBe(1);
    expect(w.meetings.length).toBe(before.meetings);
    expect(w.net.exportState().opps.find(o => o.id === group)?.stage).toBe("closed");
    const partner = w.net.reviewQueue().find(item => item.oppId !== group)!;
    expect(w.net.exportState().opps.find(o => o.id === partner.oppId)?.plan).toMatchObject({ partner: true, invited: ["a", "b"] });
    expect(w.net.memberList().find(m => m.id === "c")?.note?.text).toBe(copy.planNotTogether);
  }, 300_000);
});
