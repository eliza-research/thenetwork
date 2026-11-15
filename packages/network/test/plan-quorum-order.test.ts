// spec/planDecision.md, "An unanswered plan closes when its deadline passes": a group plan whose quorum
// can no longer be reached falls back as soon as nobody is pending, whatever the order of the answers.
// The last answer can be a yes. "Only a pending member can change an open plan": the first member's yes
// to a partner plan still asks the partner, and does not close the plan.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function world() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
  await w.onboard("a", "b", "c");
  return w;
}

// A planner group plan (three, quorum three, no alternates) or a partner plan (two, quorum two).
function plan(w: Mini, partner: boolean): plans.Plan {
  const now = w.clock.now();
  return {
    id: partner ? "plan_partner" : "plan_order", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 6 * DAY, end: now + 6 * DAY + 2 * HOUR }, invited: partner ? ["a", "b"] : ["a", "b", "c"], alternates: [], partner,
    size: partner ? { min: 2, target: 2, max: 2 } : { min: 3, target: 3, max: 3 }, quorum: partner ? 2 : 3,
    probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
}

async function groupRun(order: [string, string][]) {
  const w = await world();
  (w.net as any).submitPlan(plan(w, false), w.clock.now());
  expect(await w.runUntil(() => order.every(([id]) => w.probed(id)), 2 * DAY)).toBe(true);
  const asked = w.clock.now();
  for (const [id, said] of order) await w.say(id, said);
  return { w, asked };
}

describe("plan quorum out of reach: the order of the answers does not matter", () => {
  const orders: [string, string][][] = [
    [["a", "no"], ["b", "yes"], ["c", "yes"]],
    [["b", "yes"], ["a", "no"], ["c", "yes"]],
    [["b", "yes"], ["c", "yes"], ["a", "no"]],
  ];
  for (const order of orders) {
    test(`${order.map(([, said]) => said).join(", ")}: falls back at the last answer, not at the probe deadline`, async () => {
      const { w, asked } = await groupRun(order);
      const fb = w.log("plan_fallback");
      expect(fb).toHaveLength(1);
      expect(fb[0]!.t).toBe(asked);
    });
  }
});

describe("partner plan: the first member's yes asks the partner", () => {
  test("the first yes probes the second member and does not fall back", async () => {
    const w = await world();
    (w.net as any).submitPlan(plan(w, true), w.clock.now());
    expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
    expect(w.probed("b")).toBe(false);
    await w.say("a", "yes");
    expect(w.log("plan_fallback")).toHaveLength(0);
    expect(await w.runUntil(() => w.probed("b"), 2 * DAY)).toBe(true);
    expect(w.log("plan_fallback")).toHaveLength(0);
  });
});
