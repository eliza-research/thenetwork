// A group plan whose quorum can no longer be reached falls back as soon as nobody is pending,
// whatever the order of the answers (engine recordPlanAnswer, plans ask 4.6: "when nobody is
// pending and quorum can no longer be reached -> fallback"). The last answer can be a yes.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function run(order: [string, string][]) {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
  await w.onboard("a", "b", "c");
  const now = w.clock.now();
  // A planner plan for three with quorum three and no alternates (the planner's own shape).
  const plan: plans.Plan = {
    id: "plan_order", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: ["a", "b", "c"], alternates: [], partner: false,
    size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  (w.net as any).submitPlan(plan, now);
  expect(await w.runUntil(() => order.every(([id]) => w.probed(id)), 2 * DAY)).toBe(true);
  const asked = w.clock.now();
  for (const [id, said] of order) await w.say(id, said);
  return { w, asked };
}

describe("plan quorum out of reach: the order of the answers does not matter", () => {
  test("no, then yes, yes: falls back at the last answer, not at the probe deadline", async () => {
    const { w, asked } = await run([["a", "no"], ["b", "yes"], ["c", "yes"]]);
    const fb = w.log("plan_fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0]!.t).toBe(asked);
  });

  test("yes, yes, then no: falls back at the last answer", async () => {
    const { w, asked } = await run([["b", "yes"], ["c", "yes"], ["a", "no"]]);
    const fb = w.log("plan_fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0]!.t).toBe(asked);
  });
});
