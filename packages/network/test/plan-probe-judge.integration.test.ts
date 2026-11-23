import { expect, test } from "vitest";
import { DAY, HOUR, type RunRecord } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { Mini, START } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const NAMES = ["Ada Lane", "Bev Stone", "Cyd Marsh", "Dov Reyes", "Eli Grant", "Fay Moore"];
const climbers = NAMES.map((name, i) => ({
  id: `m${i}`, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
}));

test("the judge requires review and anonymity for a plan probe", async () => {
  // spec/reviewedGroupJourney.md, "Review comes before anonymous contact"
  const w = new Mini(climbers, { seed: 1, inlineJudge: holdEveryItem.inline });
  await w.onboard(...climbers.map(c => c.id));
  const plan: plans.Plan = {
    id: "reviewed-climb", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: START + 6 * DAY, end: START + 6 * DAY + 2 * HOUR }, invited: climbers.map(c => c.id), alternates: [],
    partner: false, size: { min: 3, target: 6, max: 6 }, quorum: 3, probeDeadline: START + 4 * DAY,
    score: 0.6, u: {}, familiar: {}, createdAt: START, category: "hobby",
  };
  (w.net as unknown as { submitPlan(plan: plans.Plan, now: number): void }).submitPlan(plan, w.clock.now());
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.review(item.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.sent.some(s => s.meta.type === "plan_probe"), DAY)).toBe(true);

  const personas: RunRecord[] = climbers.map(c => ({ t: 0, type: "persona", persona: {
    id: c.id, name: c.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [23, 7], romanceOptIn: false,
  } }));
  const messages = (body: (s: Mini["sent"][number]) => string): Extract<RunRecord, { type: "message" }>[] => w.sent.map((s, i) => ({ t: s.t, type: "message", msg: {
    id: `o${i}`, ts: s.t, memberId: s.to, direction: "outbound", status: "delivered", body: body(s), meta: s.meta,
  } }));
  const named = (records: RunRecord[]) => computeMetrics([...personas, ...records]).invariants.byRule.name_before_reveal ?? 0;

  expect(named(messages(s => s.body))).toBe(0);
  const probe = w.sent.find(s => s.meta.type === "plan_probe")!;
  expect(probe.meta.plan?.planId).toBe(item.oppId);
  const other = climbers.find(c => c.id !== probe.to)!;
  expect(named(messages(s => (s === probe ? `${s.body} ${other.name.split(" ")[0]} is coming too.` : s.body)))).toBe(1);

  const first = messages(s => s.body).find(r => r.msg.meta?.type === "plan_probe")!;
  const canonical = { ...first, msg: { ...first.msg, meta: { ...first.msg.meta, proposalId: undefined } } };
  const approval = w.log("review_decision").find(r => r.detail.oppId === item.oppId)!;
  const unreviewed = (records: RunRecord[]) => computeMetrics([...personas, ...records], { requireReview: true }).invariants.byRule.unreviewed_contact ?? 0;
  expect(unreviewed([canonical])).toBe(1);
  expect(unreviewed([{ ...approval, type: "network_log" }, canonical])).toBe(0);
}, 120_000);
