// The review SLA is a real deadline (PRD 32.8): a queued item that missed it expires unsent at the
// next tick — and a review decision that arrives after the deadline (before the next tick) must not
// approve and contact members either. Mini drives the real ConsentNetwork on a SimClock.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const person = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function queuedItem() {
  const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito")], { review: "human" });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.runUntil(() => w.net.reviewQueue().length > 0, 2 * DAY); // the batch window queues it for review
  const q = w.net.reviewQueue();
  expect(q.map(x => x.proposal.id)).toEqual([id]);
  return { w, id, deadline: q[0]!.deadline };
}

describe("the review SLA deadline", () => {
  test("a decision before the deadline approves and probes go out", async () => {
    const { w, id } = await queuedItem();
    expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
    await w.runUntil(() => ["a", "b"].some(x => w.probed(x)));
    expect(["a", "b"].some(x => w.probed(x))).toBe(true);
  });

  test("a decision after the deadline does not approve: the item expires unsent", async () => {
    const { w, id, deadline } = await queuedItem();
    // Past the deadline, before the next tick: no advance() has run for it yet.
    w.clock.set(deadline + 60_000);
    const before = w.mark();
    expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: false, reason: "review_expired" });
    expect(w.net.reviewQueue()).toEqual([]);
    expect((w.net as any).counters.reviewExpired).toBe(1);
    expect(w.sent.length).toBe(before);
    // The saved state says expired, not approved.
    const st = w.net.exportState();
    const o = st.opps.find(x => x.id === id)!;
    expect(o.review!.decision).toBe("expired");
  });
});
