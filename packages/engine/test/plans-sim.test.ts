// End-to-end invariants of the planner in the simulator (harness network experiments/plansNetwork.ts
// on top of the attention-v1.2 harness): a short run, deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import type { MemberId } from "@thenetwork/core";
import { engineSupplyBudgets } from "../src/config.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import type { World as SimWorld } from "../../sim/src/world.ts";
import { runSim } from "../experiments/lib.ts";
import { DEFAULT_CAPTURE, checkInAnswer, hiddenAvailability, optsInToCheckIn, statedStanding, syntheticVenues } from "../experiments/plansHarness.ts";
import { PlanNetwork } from "../experiments/plansNetwork.ts";

describe("planner in the simulator (attention v1.2 (c) + plans)", () => {
  test("plans are proposed and probed; 0 minors in any plan role, 0 leaks, 0 names before quorum, 0 quiet-hour or over-cap sends", async () => {
    let net!: PlanNetwork;
    let world!: SimWorld;
    const seed = 5;
    const free = hiddenAvailability(() => world, seed);
    const res = await runSim({
      seed, personas: 90, days: 16, cfg: engineSupplyBudgets(), keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true }, gen: { minorShare: 0.1 },
      network: s => (net = new PlanNetwork({
        seed: s, randomIntros: false, mode: "attention", probes: true, lambdaScale: 0, cadence: "rolling", suppressAcks: true, requeueUnpicked: true,
        sendTime: "learned", sendWindowHours: 6, partnerInWindow: true, timeOptions: true, revealOptOut: true, hiddenFree: free,
        plans: {}, venues: syntheticVenues(),
        checkInOptIn: (id: MemberId) => optsInToCheckIn(world.oracle, seed, id, DEFAULT_CAPTURE),
        checkInAnswer: (id: MemberId, slots) => checkInAnswer(seed, id, slots, free, DEFAULT_CAPTURE),
        standing: (id: MemberId, at: number) => statedStanding(world.oracle, seed, id, at, DEFAULT_CAPTURE),
        planFeedback: (_plan, going) => ({ attended: going, positive: going }),
      })),
      onWorld: w => { world = w; },
      augment: input => net.engineView(input as any),
    });
    const m = res.metrics;
    expect(net.planStats.plans).toBeGreaterThan(0);
    expect(net.planStats.probedPlans.size).toBeGreaterThan(0);
    expect(net.planStats.checkInsSent).toBeGreaterThan(0);
    expect(m.safety.minorContacts).toBe(0);
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.invariants.byRule.quiet_hours ?? 0).toBe(0);
    expect(m.invariants.byRule.over_budget ?? 0).toBe(0);
    expect(net.stats.selfOverCap).toBe(0);
    expect(net.stats.selfQuiet).toBe(0);
    expect(net.planStats.checkInQuiet).toBe(0);
    expect(net.planStats.minorsInPlans).toBe(0);
    // The plan allowance: plan invites in their own lane, at most 1 per member per 7 days; the intro cap (2/7d) holds without them.
    expect(net.planStats.allowanceInvites).toBeGreaterThan(0);
    const byMember = new Map<string, { plan: number[]; intro: number[] }>();
    for (const e of net.ledger) {
      if (!e.countsAgainstCap) continue;
      const x = byMember.get(e.memberId) ?? { plan: [], intro: [] };
      (net.planInviteIds.has(e.messageId) ? x.plan : x.intro).push(e.at);
      byMember.set(e.memberId, x);
    }
    const maxIn7 = (ts: number[]) => Math.max(0, ...ts.map(t => ts.filter(u => u <= t && u > t - 7 * 86_400_000).length));
    for (const x of byMember.values()) { expect(maxIn7(x.plan)).toBeLessThanOrEqual(1); expect(maxIn7(x.intro)).toBeLessThanOrEqual(2); }
    expect(net.planStats.probeNameLeaks).toBe(0);
    const declared = new Map(res.personas.map(p => [p.id, p.public.claimedAge]));
    for (const l of net.live.values()) {
      expect(l.plan.category).not.toBe("romance");
      for (const id of [...l.plan.invited, ...l.plan.alternates, ...Object.keys(l.run.answers)]) expect(declared.get(id)!).toBeGreaterThanOrEqual(18);
      // Booked only at quorum, and only members who said yes are in it.
      if (l.bookedAt !== undefined) for (const id of l.going) expect(l.run.answers[id]).toBe("yes");
    }
    // Nobody is named in a message about a plan before that plan was booked.
    const bookedAt = new Map([...net.live].filter(([, l]) => l.bookedAt !== undefined).map(([id, l]) => [id, l.bookedAt!]));
    for (const r of res.records as any[]) {
      if (r.type !== "message" || r.msg.direction !== "outbound" || r.msg.status !== "delivered") continue;
      const pid = r.msg.meta?.probe?.key ?? r.msg.meta?.proposalId;
      if (!pid || !net.planIds.has(pid)) continue;
      const l = net.live.get(pid)!;
      const others = Object.keys(l.run.answers).filter(x => x !== r.msg.memberId);
      if (bookedAt.has(pid) && r.msg.ts >= bookedAt.get(pid)!) continue;
      for (const o of others) { const first = res.personas.find(p => p.id === o)!.name.split(" ")[0]!; expect(r.msg.body).not.toMatch(new RegExp(`\\b${first}\\b`)); }
    }
  }, 120_000);
});
