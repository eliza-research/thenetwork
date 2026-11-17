// The simulator judge reads a plan probe as a probe: it ties the message to its plan through
// PlanMeta.planId and flags a plan probe that names another invitee before anyone said yes
// (name_before_reveal). The real plan probes of the Network name nobody.
import { expect, test } from "vitest";
import { DAY, HOUR, type RunRecord } from "@thenetwork/core";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { Mini, START } from "./mini.ts";

const NAMES = ["Ada Lane", "Bev Stone", "Cyd Marsh", "Dov Reyes", "Eli Grant", "Fay Moore"];
const climbers = NAMES.map((name, i) => ({
  id: `m${i}`, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
}));

test("the judge flags a plan probe that names another invitee and passes the Network's own plan probes", async () => {
  const w = new Mini(climbers, { seed: 1, review: "human", plans: true, matchingEnabled: true });
  w.clock.set(START + 3 * DAY);
  await w.onboard(...climbers.map(c => c.id));
  await w.run(12 * HOUR);
  const item = w.net.reviewQueue().find(q => q.origin === "planner");
  expect(item).toBeDefined();
  expect(w.net.review(item!.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.sent.some(s => s.meta.type === "plan_probe"), DAY)).toBe(true);

  const personas: RunRecord[] = climbers.map(c => ({ t: 0, type: "persona", persona: {
    id: c.id, name: c.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [23, 7], romanceOptIn: false,
  } }));
  const messages = (body: (s: Mini["sent"][number]) => string): RunRecord[] => w.sent.map((s, i) => ({ t: s.t, type: "message", msg: {
    id: `o${i}`, ts: s.t, memberId: s.to, direction: "outbound", status: "delivered", body: body(s), meta: s.meta,
  } }));
  const named = (records: RunRecord[]) => computeMetrics([...personas, ...records]).invariants.byRule.name_before_reveal ?? 0;

  expect(named(messages(s => s.body))).toBe(0);
  const probe = w.sent.find(s => s.meta.type === "plan_probe")!;
  expect(probe.meta.plan?.planId).toBe(item!.oppId);
  const other = climbers.find(c => c.id !== probe.to)!;
  expect(named(messages(s => (s === probe ? `${s.body} ${other.name.split(" ")[0]} is coming too.` : s.body)))).toBe(1);
}, 120_000);
