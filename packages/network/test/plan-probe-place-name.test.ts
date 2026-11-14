// A plan probe names no member (PRD D5). Its public place can share a word with a member's name:
// "Prospect Park" and Dee Park, "Maria Hernandez Park" and Maria. That word is the place, so the
// other invitees still get their probe; before, every one of them was dropped and the plan died.
import { expect, test } from "bun:test";
import { buildWorld, localEmbed, plans, resolveConfig } from "@thenetwork/engine";
import { randomWorld } from "../../engine/src/testkit.ts";
import { PLAN_VENUES } from "../src/plans.ts";

const NY = "America/New_York";

test("an invitee whose name shares a word with the venue does not drop the others' probes", () => {
  const input = randomWorld({ members: 40, seed: 7, minors: false, canaries: false });
  input.members[2]!.name = "Dee Park";
  const w = buildWorld(input, resolveConfig({}), localEmbed);
  const ids = input.members.slice(0, 3).map(m => m.id);
  const run = plans.ACTIVITIES.find(a => a.id === "group_run")!;
  const parks = PLAN_VENUES.filter(v => /\bPark\b/.test(v.name));
  expect(parks.length).toBeGreaterThan(10);
  for (const v of parks) {
    const plan: plans.Plan = {
      id: `p-${v.id}`, city: "nyc", activityId: run.id, venueId: v.id, place: { name: v.name, area: v.area },
      window: { start: Date.UTC(2026, 9, 10, 15), end: Date.UTC(2026, 9, 10, 17) }, invited: ids, alternates: [], partner: false,
      size: { min: 3, target: 3, max: 6 }, quorum: 3, probeDeadline: Date.UTC(2026, 9, 9), score: 0.5, u: {}, familiar: {}, createdAt: 0, category: "social",
    };
    for (const me of ids.slice(0, 2)) {
      const text = plans.buildPlanProbe(w, plan, me, NY);
      expect(text, v.name).toContain(v.name);
      expect(text!).not.toMatch(/\bDee\b/);
    }
  }
});
