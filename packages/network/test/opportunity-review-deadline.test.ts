// A review item past its SLA deadline is never approved (PRD 32.8, docs/network.md 2: "It is never
// sent late"). The tick expires an item at its deadline, but the clock can pass the deadline before
// the next tick runs (the tick lock skips a tick, the service is busy). A reviewer who decides in that
// gap must be refused, and nobody the item names is contacted (SD-009). The real ConsentNetwork and
// engine on a SimClock (mini.ts), with human review.
import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("review deadline", () => {
  test("an approval after the deadline, before the tick expires the item, is refused and contacts nobody", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human" });
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.net.reviewQueue().some(x => x.oppId === id))).toBe(true);
    const item = w.net.reviewQueue().find(x => x.oppId === id)!;
    // The clock passes the deadline; no tick runs in between.
    w.clock.set(item.deadline + HOUR);
    const from = w.mark();
    const r = w.net.decide(id, "approve", { reviewer: "staff-1" });
    expect(r).toEqual({ ok: false, reason: "review_expired" });
    await w.run(2 * HOUR);
    expect([...w.to("a", from), ...w.to("b", from)]).toEqual([]);
    expect(w.log("review_decision")).toEqual([]);
    expect(w.log("review_expired").map(l => l.detail.oppId)).toEqual([id]);
  });
});
