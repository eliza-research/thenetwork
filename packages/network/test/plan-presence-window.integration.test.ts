import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini, START } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const NAMES = ["Ada Lane", "Bev Stone", "Cyd Marsh", "Dov Reyes", "Eli Grant", "Fay Moore"];
const climbers = NAMES.map((name, i) => ({
  id: `m${i}`, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
}));

function climbPlan(overrides: Partial<plans.Plan>): plans.Plan {
  return {
    id: "presence-window-climb", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: START + 6 * DAY, end: START + 6 * DAY + 2 * HOUR }, invited: climbers.map(c => c.id), alternates: [],
    partner: false, size: { min: 3, target: 6, max: 6 }, quorum: 3, probeDeadline: START + 4 * DAY,
    score: 0.6, u: {}, familiar: {}, createdAt: START, category: "hobby", ...overrides,
  };
}

async function approvePlan(w: Mini, plan: plans.Plan): Promise<string> {
  (w.net as unknown as { submitPlan(plan: plans.Plan, now: number): void }).submitPlan(plan, w.clock.now());
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  return item.oppId;
}

test("a plan invitation uses presence during the plan interval, not continuous presence before it", async () => {
  // spec/planDispatch.md, "A missing seat or an absence rules out the invitation";
  // spec/travelPresence.md, "Use my travel dates for matching"
  const w = new Mini(climbers, { seed: 1, inlineJudge: holdEveryItem.inline });
  await w.onboard(...climbers.map(c => c.id));
  const window = { start: START + 6 * DAY, end: START + 6 * DAY + 2 * HOUR };
  w.presence.push(
    { memberId: "m0", city: "chicago", type: "temporary", areas: [], from: START + DAY, to: START + 3 * DAY },
    { memberId: "m1", city: "chicago", type: "temporary", areas: [], from: window.start - HOUR, to: window.end + HOUR },
  );
  const oppId = await approvePlan(w, climbPlan({ window }));
  expect(await w.runUntil(() => w.sent.some(s => s.meta.type === "plan_probe"), DAY)).toBe(true);

  const probes = w.sent.filter(s => s.meta.type === "plan_probe" && s.meta.plan?.planId === oppId);
  expect(probes.map(s => s.to)).toContain("m0");
  expect(probes.map(s => s.to)).not.toContain("m1");
  const opp = w.net.exportState().opps.find(o => o.id === oppId)!;
  expect(opp.planRun?.answers.m0).toBe("pending");
  expect(opp.planRun?.answers.m1).toBe("no");
}, 120_000);

test("a member away until the probe deadline does not hold the seat from an alternate", async () => {
  // spec/planDispatch.md, "A missing seat or an absence rules out the invitation";
  // spec/travelPresence.md, "Use my travel dates for matching"
  const w = new Mini(climbers, { seed: 1, inlineJudge: holdEveryItem.inline });
  await w.onboard("m0", "m1", "m2", "m3", "m4");
  w.presence.push({ memberId: "m0", city: "chicago", type: "temporary", areas: [], from: START - DAY, to: START + 5 * DAY });
  const oppId = await approvePlan(w, climbPlan({ invited: ["m0", "m1", "m2"], alternates: ["m3", "m4"], size: { min: 3, target: 3, max: 3 } }));
  await w.answerProbes(["m0", "m1", "m2", "m3", "m4"]);

  const probes = w.sent.filter(s => s.meta.type === "plan_probe" && s.meta.plan?.planId === oppId);
  expect(probes.map(s => s.to)).not.toContain("m0");
  expect(probes.map(s => s.to)).toContain("m3");
  const opp = w.net.exportState().opps.find(o => o.id === oppId)!;
  expect(opp.planRun?.answers.m0).toBe("no");
  expect(opp.planRun?.answers.m3).toBe("yes");
  expect(w.meetings.length).toBe(1);
}, 120_000);
