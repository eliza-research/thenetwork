// A yes-sayer dropped at booking for a double-booking never reaches the opportunity
// History: bookPlan logs `plan_conflict` with the opportunity id (docs/network.md 6.4,
// "Anyone booked elsewhere within 4 hours is dropped first"), but `NETWORK_EVENT_KINDS`
// does not list it, so `eventOf` drops the record. The member hears only that the plan
// did not come together (never why), and staff see the member's "available" probe answer
// followed by a close with no row saying the member was left out at booking.
import { describe, expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { describe as describeEvent, eventOf, type EventRow } from "../../../apps/observatory/src/events.ts";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

/** The game-mode opportunity detail filter (apps/observatory/src/sources/game.ts). */
function inOpportunityHistory(row: EventRow | undefined, id: string) {
  return !!row && (row.object_type === "opportunity" ? row.object_id === id : row.payload?.oppId === id);
}

describe("plan_conflict reaches the opportunity History", () => {
  test("a yes-sayer dropped for a double-booking is a History event", async () => {
    const ids = ["a", "b", "c", "d", "x"];
    const w = new Mini(ids.map(climber), { review: "human" });
    await w.onboard(...ids);
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_group_conflict_history", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR }, invited: ["a", "b", "c", "d"], alternates: [],
      partner: false, size: { min: 3, target: 4, max: 4 }, quorum: 4, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {},
      createdAt: now, category: "hobby",
    };
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    const group = w.net.reviewQueue()[0]!.oppId;
    expect(w.net.review(group, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
    for (const id of ["a", "b", "c"]) await w.say(id, "yes");
    const competing = w.propose(["c", "x"]);
    expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === competing), DAY)).toBe(true);
    expect(w.net.review(competing, "approve", { reviewer: "sim_staff" })).toBe(true);
    await w.answerProbes(["c", "x"], () => "yes", 8 * HOUR);
    expect(w.meetings).toMatchObject([{ proposalId: competing, participants: ["c", "x"] }]);
    expect(Math.abs(w.meetings[0]!.at - plan.window.start)).toBeLessThan(4 * HOUR);
    await w.say("d", "no");
    const conflicts = w.log("plan_conflict");
    expect(conflicts.map(l => l.detail)).toEqual([{ oppId: group, memberId: "c" }]);
    expect(w.net.memberList().find(m => m.id === "c")?.note?.text).toBe(copy.planNotTogether);
    const row = eventOf({ t: conflicts[0]!.t, type: "network_log", kind: conflicts[0]!.kind, detail: conflicts[0]!.detail });
    expect(inOpportunityHistory(row, group)).toBe(true);
    expect(row!.object_type).toBe("opportunity");
    expect(describeEvent(row!, x => x).text).toMatch(/left out at booking/);
  }, 300_000);
});
