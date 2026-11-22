// Plan probe replies against the probe deadline, and the fallback when nobody is pending. A reply at
// or after the deadline must not count, must not become availability evidence and must not be
// acknowledged. The last reply closes an underfilled plan whether it is a yes or a no, and two
// accepting members of a group plan are asked again through a fresh partner plan, never booked as a pair.
import { describe, expect, test } from "vitest";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { friendsPack, FRIENDS_PLANS, type plans } from "@thenetwork/engine";
import { copy } from "../src/copy.ts";
import { Mini, START } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

async function friendsPartnerFixture(partner: boolean, bothAttended: boolean) {
  const ids = ["a", "b", "c", "d"];
  const w = new Mini(ids.map(climber), { app: "friends", pack: friendsPack, plansConfig: FRIENDS_PLANS, review: "human" });
  const now = w.clock.now();
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  const state = w.net.exportState();
  state.interactions.push({
    id: "friends_group_attended", kind: "group", category: "social", at: now - DAY, outcome: "completed",
    participants: bothAttended ? ids : ["a", "c", "d"],
  });
  w.net.importState(state);
  const invited = ids.slice(0, partner ? 2 : 3);
  const count = invited.length;
  const plan: plans.Plan = {
    id: "friends_partner_check", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited, alternates: [], partner,
    size: { min: count, target: count, max: count }, quorum: count, probeDeadline: now + 4 * DAY,
    score: 0.6, u: {}, familiar: {}, createdAt: now, category: partner ? "hobby" : "social",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  return { w, invited, item: w.net.reviewQueue()[0]! };
}

describe("plan probe replies", () => {
  test.each([false, true])("a weekly Friends pair books only a reviewed time both selected (changed availability: %s)", async unavailable => {
    const ids = ["a", "b"];
    const w = new Mini([...ids.map(id => ({ ...climber(id), area: "Astoria", interests: ["tennis"],
      wants: [{ objective: "find a regular tennis partner", category: "hobby" as const }] })),
      ...["c", "d", "e", "f"].map(id => ({ id, name: id, age: 30, area: "Astoria" }))],
    { app: "friends", pack: friendsPack, plansConfig: FRIENDS_PLANS, review: "human", plans: true, matchingEnabled: true });
    for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
      tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
    await w.onboard(...ids);
    const now = w.clock.now();
    const windows = [Date.UTC(2026, 9, 8, 23), Date.UTC(2026, 9, 9, 23), Date.UTC(2026, 9, 10, 14)]
      .map(start => ({ start, end: start + 2 * HOUR }));
    const state = w.net.exportState();
    state.interactions.push(...[["a", "c", "d"], ["b", "e", "f"]].map(participants => ({ id: `attended-${participants[0]}`, kind: "group" as const, category: "social" as const,
      at: now - DAY, outcome: "completed" as const, participants })));
    for (const member of state.members) member.stated = { windows, at: now, until: now + 7 * DAY };
    w.net.importState(state);

    await w.run(HOUR);
    const item = w.net.reviewQueue().find(item => item.origin === "planner")!;
    const reviewed = w.net.exportState().opps.find(opp => opp.id === item?.oppId)?.plan?.reviewedOptions;
    expect(reviewed).toHaveLength(3);
    expect(w.sent.filter(message => message.meta.type === "plan_probe")).toEqual([]);
    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    const probe = (id: string) => w.sent.find(message => message.to === id && message.meta.plan?.planId === item.oppId);
    expect(await w.runUntil(() => !!probe("a"), 20 * HOUR)).toBe(true);
    expect(probe("a")?.meta.plan?.options?.map(option => option.key)).toEqual(["a", "b", "c"]);
    expect(probe("a")?.body).toMatch(/A: .+\nB: .+\nC: /);
    await w.say("a", "yes");
    expect(probe("b")).toBeUndefined();
    await w.say("a", "A and C");
    w.restart();
    expect(await w.runUntil(() => !!probe("b"), 25 * HOUR)).toBe(true);
    expect(probe("b")?.meta.plan?.options?.map(option => option.key)).toEqual(["a", "c"]);
    await w.say("b", "B");
    expect(w.meetings).toEqual([]);
    const selected = reviewed![2]!;
    if (unavailable) {
      const changed = w.net.exportState();
      changed.members.find(member => member.id === "a")!.stated = { windows: [reviewed![0]!], at: w.clock.now(), until: now + 7 * DAY };
      w.net.importState(changed);
    }
    await w.say("b", "C");
    if (unavailable) {
      expect(w.meetings).toEqual([]);
      expect(w.net.exportState().opps.find(opp => opp.id === item.oppId)?.stage).toBe("closed");
    } else {
      expect(w.meetings).toMatchObject([{ at: selected.start, participants: ids }]);
      const booked = w.net.exportState().opps.find(opp => opp.id === item.oppId);
      expect(booked?.plan?.window).toEqual(selected);
      expect(booked?.planRun?.plan.window).toEqual(selected);
    }
  });

  test.each(["I'm free Sunday afternoon.", "Busy week, nothing free."])("a reviewed generic plan backfills a seat after %s", async reply => {
    const primary = ["a", "b", "c"];
    const ids = [...primary, "d"];
    const w = new Mini(ids.map(id => ({ ...climber(id), area: "Inwood" })), { review: "human", plans: false });
    await w.onboard(...ids);
    const now = w.clock.now();
    const start = Date.UTC(2026, 9, 10, 14);
    const window = { start, end: start + 4 * HOUR };
    const plan: plans.Plan = {
      id: "generic_reviewed_stated_window", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
      place: { name: "Inwood Hill Park", area: "Inwood" }, window, invited: primary, alternates: ["d"],
      partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: start - 30 * HOUR,
      score: 0.8, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    const initial = w.net.exportState();
    for (const member of initial.members) member.stated = { windows: [window], at: now, until: now + 7 * DAY };
    initial.members.find(member => member.id === "a")!.awaiting = { kind: "checkin", at: now };
    w.net.importState(initial);
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const item = w.net.reviewQueue()[0]!;
    expect(item.proposal.participants).toEqual(primary);
    w.clock.advance(MINUTE);
    await w.say("a", reply);
    const latest = w.net.exportState().members.find(member => member.id === "a")!.stated;
    expect(latest).toMatchObject({ at: w.clock.now(), until: w.clock.now() + 7 * DAY });
    if (reply.startsWith("I'm free")) {
      expect(latest?.windows).toHaveLength(1);
      expect(latest!.windows[0]!.start).toBeGreaterThan(window.end);
    } else expect(latest?.windows).toEqual([]);
    w.restart();

    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    await w.run(HOUR);
    const probes = w.sent.filter(message => message.meta.type === "plan_probe" && message.meta.plan?.planId === item.oppId);
    expect(probes.map(message => message.to)).not.toContain("a");
    expect(await w.runUntil(() => ["b", "c", "d"].every(id => w.probed(id)), DAY)).toBe(true);
    expect(w.sent.filter(message => message.meta.type === "plan_probe" && message.meta.plan?.planId === item.oppId)
      .map(message => message.to).sort()).toEqual(["b", "c", "d"]);
    expect(w.net.plansCounters.planNo).toBe(0);
    expect(w.meetings).toEqual([]);
    for (const id of ["b", "c", "d"]) await w.say(id, "Yes, that time works.");
    expect(w.meetings).toMatchObject([{ proposalId: item.oppId, participants: ["b", "c", "d"], at: start }]);
  });

  test("reviewed plan replies respect the deadline after a restart and allow booked late joins", async () => {
    // spec/planDecision.md, "Only a pending member can change an open plan"; spec/planDecision.md, "Booking requires a pending acceptance that meets quorum"
    const ids = ["a", "b", "c", "d", "e", "f"];
    const members = ids.map(id => ({ ...climber(id), area: "Prospect Heights", interests: ["coffee", "climbing"], wants: [] }));
    const failures: Record<string, unknown>[] = [];
    for (const seed of [1, 2, 3]) for (const mode of ["before", "at", "after", "booked-join"] as const) {
      const w = new Mini(members, { seed, review: "human", plans: true, matchingEnabled: true });
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

  test("a reviewed Friends plan skips a replacement whose Friend membership is no longer eligible", async () => {
    // spec/planDecision.md, "A Friends replacement needs a current pair value with every remaining member"
    const primary = ["a", "b", "c"];
    const ids = [...primary, "d", "e"];
    const w = new Mini(ids.map(climber), { app: "friends", pack: friendsPack, review: "human" });
    const now = w.clock.now();
    for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
    await w.onboard(...ids);
    const plan: plans.Plan = {
      id: "friends_reviewed_backfill", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: primary, alternates: ["d", "e"], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const item = w.net.reviewQueue()[0]!;
    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => primary.every(id => w.probed(id)), DAY)).toBe(true);
    await w.say("a", "yes");
    await w.say("b", "yes");
    const index = w.facets.findIndex(f => f.id === "d:verified");
    w.facets[index] = { ...w.facets[index]!, tags: ["verify:liveness:fail", "verify:age:pass"] };
    const mark = w.mark();
    await w.say("c", "no");

    expect(await w.runUntil(() => w.probed("e"), DAY)).toBe(true);
    expect(w.sent.slice(mark).filter(message => message.meta.type === "plan_probe")).toMatchObject([
      { to: "e", meta: { plan: { planId: item.oppId, size: 3 } } },
    ]);
    expect(w.net.exportState().opps.find(o => o.id === item.oppId)?.participants).toEqual([...primary, "e"]);
    await w.say("e", "yes");
    expect(w.meetings).toMatchObject([{ proposalId: item.oppId, participants: ["a", "b", "e"] }]);
  });

  test("a reviewed Friends plan books after its invitation uses the last discovery slot", async () => {
    // spec/planDecision.md, "An existing Friends plan can use the last discovery slot"
    const primary = ["a", "b", "c"];
    const history = [["a", "d", "e"], ["a", "f", "g"]];
    const ids = [...new Set([...primary, ...history.flat()])];
    const w = new Mini(ids.map(climber), { app: "friends", pack: friendsPack, review: "human" });
    const now = w.clock.now();
    for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
    await w.onboard(...ids);
    const plan: plans.Plan = {
      id: "friends_reviewed_last_slot", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: primary, alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const item = w.net.reviewQueue()[0]!;
    const state = w.net.exportState();
    const pending = state.opps.find(o => o.id === item.oppId)!;
    for (const [index, invited] of history.entries()) {
      state.opps.push({
        ...pending, id: `friends_previous_${index}`, createdAt: now - (index + 1) * DAY, stage: "done",
        participants: invited, contacted: invited, status: invited.map(id => [id, "yes"]), plan: { ...plan, invited },
        review: undefined, recorded: true,
      });
    }
    w.net.importState(state);
    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => primary.every(id => w.probed(id)), DAY)).toBe(true);
    w.restart();
    await w.say("a", "yes");
    await w.say("b", "yes");
    expect(w.meetings).toHaveLength(0);
    await w.say("c", "yes");
    expect(w.meetings).toMatchObject([{ proposalId: item.oppId, participants: primary }]);
  });

  test.each([false, true])("a smaller Friends plan checks both members before partner review (both attended: %s)", async bothAttended => {
    // spec/planDecision.md, "Both Friends activity partners need prior group attendance"
    const { w, invited, item } = await friendsPartnerFixture(false, bothAttended);
    const b = w.members.find(m => m.id === "b")!;
    b.prefs = { ...b.prefs, categoriesOptIn: ["social"] };
    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => invited.every(id => w.probed(id)), DAY)).toBe(true);
    await w.say("a", "yes");
    await w.say("b", "yes");
    await w.say("c", "no");

    const queue = w.net.reviewQueue();
    expect(w.meetings).toHaveLength(0);
    if (bothAttended) {
      expect(queue).toMatchObject([{ proposal: { participants: ["a", "b"], category: "social" } }]);
      expect(queue[0]?.oppId).not.toBe(item.oppId);
      expect(w.sent.filter(s => s.meta.plan?.planId === queue[0]?.oppId)).toEqual([]);
    } else {
      expect(queue).toEqual([]);
      expect(w.log("plan_fallback").at(-1)?.detail.kind).toBe("next_week");
    }
  });

  test.each(["first contact", "booking"])("a restored Friends partner plan rechecks both members before %s", async at => {
    // spec/planDecision.md, "Both Friends activity partners need prior group attendance"
    const { w, item } = await friendsPartnerFixture(true, at === "booking");
    w.restart();
    expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    if (at === "first contact") {
      await w.run(DAY);
      expect(w.sent.filter(s => s.meta.plan?.planId === item.oppId)).toEqual([]);
    } else {
      expect(await w.runUntil(() => w.probed("a"), DAY)).toBe(true);
      await w.say("a", "yes");
      expect(await w.runUntil(() => w.probed("b"), DAY)).toBe(true);
      const state = w.net.exportState();
      state.interactions.find(r => r.id === "friends_group_attended")!.participants = ["a", "c", "d"];
      w.net.importState(state);
      w.restart();
      await w.say("b", "yes");
    }
    expect(w.meetings).toHaveLength(0);
    expect(w.sent.filter(s => s.meta.type === "proposal" && s.meta.proposalId === item.oppId)).toEqual([]);
    expect(w.net.exportState().opps.find(o => o.id === item.oppId)?.stage).toBe("closed");
  });
});
