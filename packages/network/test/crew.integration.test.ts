import { expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("a recurring crew needs the configured number of plans with the same members saying yes", async () => {
  // spec/planDecision.md, "A crew offer needs enough positive responses"
  const ids = ["a", "b", "c", "d", "e", "f"];
  const members = ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
  }));
  const failures = [];
  for (const seed of [1, 2, 3]) for (const scenario of ["default-one", "two-only-one", "two-complete", "two-insufficient-common"] as const) {
    const minPlans = scenario === "default-one" ? 1 : 2;
    const rounds = scenario === "two-complete" || scenario === "two-insufficient-common" ? 2 : 1;
    const w = new Mini(members, { seed, review: "human", plans: true, matchingEnabled: true, plansConfig: { crews: { minPlans } } });
    await w.onboard(...ids);
    const positives: string[][] = [];
    for (let round = 0; round < rounds; round++) {
      expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 14 * DAY)).toBe(true);
      const q = w.net.reviewQueue().find(q => q.origin === "planner")!;
      expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
      const plan = () => w.net.exportState().opps.find(o => o.id === q.oppId)!;
      for (let pick = 0; pick < ids.length && plan().stage === "probing"; pick++) {
        if (!await w.runUntil(() => ids.some(id => w.probed(id)), 4 * DAY)) break;
        for (const id of ids) if (w.probed(id)) await w.say(id, "yes");
      }
      const booked = plan();
      expect(booked.stage).toBe("scheduled");
      const going = booked.status.filter(([, status]) => status === "yes").map(([id]) => id);
      await w.run(booked.plan!.window.start + 4 * HOUR - w.clock.now());
      for (const id of going) {
        const decline = scenario === "two-insufficient-common" && round === 1 && id === going[0];
        await w.say(id, decline ? "I came, but it was not for me. No, I would not do it again." : "We all came, it was great. I'd do it again.");
      }
      w.restart();
      positives.push(Object.entries(plan().post ?? {}).filter(([, p]) => p.came && p.again).map(([id]) => id));
    }
    const common = positives[0]!.filter(id => positives.every(p => p.includes(id))).length;
    const offers = w.log("crew_offered").length;
    const expected = scenario === "default-one" || scenario === "two-complete" ? 1 : 0;
    if (offers !== expected) failures.push({ seed, scenario, common, offers, expected });
  }
  expect(failures).toEqual([]);
});
