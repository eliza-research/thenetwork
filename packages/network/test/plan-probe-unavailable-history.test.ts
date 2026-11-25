// A plan invitation known never to have gone out never reaches the opportunity
// History: the plan advance logs `plan_probe_unavailable` with the opportunity id
// (spec/planDispatch.md, "A terminal unsent invitation releases the exact pending
// seat" — not a decline or an unanswered invitation), but `NETWORK_EVENT_KINDS`
// does not list it, so `eventOf` drops the record. An expired invitation gets a
// `probe_answer` History row; an undelivered one leaves only the earlier
// "Probe sent" row, so staff cannot tell never-received from ignored.
import { describe, expect, test } from "vitest";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { describe as describeEvent, eventOf, type EventRow } from "../../../apps/observatory/src/events.ts";
import { probeReplyReceiptKey } from "../src/network.ts";
import { Mini } from "./mini.ts";

const climber = (id: string) => ({
  id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
});

/** The game-mode opportunity detail filter (apps/observatory/src/sources/game.ts). */
function inOpportunityHistory(row: EventRow | undefined, id: string) {
  return !!row && (row.object_type === "opportunity" ? row.object_id === id : row.payload?.oppId === id);
}

describe("plan_probe_unavailable reaches the opportunity History", () => {
  test("a plan invitation known not delivered is a History event", async () => {
    const ids = ["a", "c", "d"];
    const w = new Mini(ids.map(climber), { review: "human", plans: false });
    const receipts = new Map<string, InitialInviteReceipt>();
    let heldPlan: { id: string; at: number } | undefined;
    const context = w.ctx();
    w.net.init({ ...context, initialInviteReceipt: id => receipts.get(id), send: (id, body, opts) => {
      const delivered = context.send(id, body, opts);
      if (id === "a" && opts?.meta?.type === "plan_probe") heldPlan = { id: delivered.id, at: delivered.ts };
      else if (opts?.meta?.proactive) receipts.set(delivered.id, { kind: "accepted", at: delivered.ts });
      return delivered;
    } });
    await w.onboard(...ids);
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_probe_unavailable_history", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 5 * DAY, end: now + 5 * DAY + HOUR }, invited: ["a", "c", "d"], alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 8 * HOUR,
      score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
    };
    const item = (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): { id: string } }).submitPlan(plan, now);
    expect(w.net.review(item.id, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => heldPlan !== undefined, DAY)).toBe(true);
    receipts.set(heldPlan!.id, { kind: "not_sent" });
    receipts.set(probeReplyReceiptKey(item.id, "a", { at: heldPlan!.at, probeReceiptId: heldPlan!.id }), { kind: "not_sent" });
    await w.run(HOUR);
    const unavailable = w.log("plan_probe_unavailable");
    expect(unavailable.map(l => l.detail)).toEqual([{ oppId: item.id, memberId: "a", reason: "not_delivered" }]);
    expect(w.log("probe_answer").filter(l => l.detail.memberId === "a")).toEqual([]);
    expect(w.net.memberList().find(m => m.id === "a")?.unanswered).toBe(0);
    const row = eventOf({ t: unavailable[0]!.t, type: "network_log", kind: unavailable[0]!.kind, detail: unavailable[0]!.detail });
    expect(inOpportunityHistory(row, item.id)).toBe(true);
    expect(row!.object_type).toBe("opportunity");
    expect(describeEvent(row!, x => x).text).toMatch(/never went out/);
  }, 300_000);
});
