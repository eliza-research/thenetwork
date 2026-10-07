// End-to-end invariants of the attention budget send path in the simulator (harness network,
// experiments/attentionNetwork.ts): a short run, deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { DEFAULT_ATTENTION, engineSupplyBudgets } from "../src/config.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import { AttentionNetwork } from "../experiments/attentionNetwork.ts";
import { runSim } from "../experiments/lib.ts";

async function run(probes: boolean) {
  let net!: AttentionNetwork;
  const res = await runSim({
    seed: 3, personas: 80, days: 14, cfg: engineSupplyBudgets(), keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true },
    network: s => (net = new AttentionNetwork({ seed: s, randomIntros: false, mode: "attention", probes })),
    augment: input => net.engineView(input as any),
  });
  return { res, net };
}

for (const probes of [false, true]) {
  describe(`attention send path in the simulator (${probes ? "consent-first probes" : "named items"})`, () => {
    test("0 minor contacts, 0 canary leaks, 0 quiet-hour sends, 0 over-cap, 0 interruptions past the Blooio reservation; digests <= 3 items; romance alone", async () => {
      const { res, net } = await run(probes);
      const m = res.metrics;
      expect(m.safety.minorContacts).toBe(0);
      expect(m.privacy.canaryLeaks).toBe(0);
      expect(m.invariants.byRule.quiet_hours ?? 0).toBe(0);
      expect(m.invariants.byRule.over_budget ?? 0).toBe(0);
      expect(m.invariants.byRule.two_unanswered ?? 0).toBe(0);
      expect(net.stats.selfOverCap).toBe(0);
      expect(net.stats.selfQuiet).toBe(0);
      const personas = new Map(res.personas.map(p => [p.id, p]));
      const out = new Map<string, number>();
      const pro = new Map<string, number[]>();
      const recs = (res.records as any[]).filter(r => r.type === "message" && !r.msg.system && r.msg.status === "delivered");
      let interruptions = 0;
      for (const r of recs) {
        const x = r.msg;
        if (x.direction === "inbound") { out.set(x.memberId, 0); continue; }
        const k = out.get(x.memberId) ?? 0;
        if (x.meta?.proactive) {
          interruptions++;
          expect(k).toBeLessThanOrEqual(DEFAULT_ATTENTION.blooio.interruptMaxOutstanding);
          const items: string[] = x.meta.attention?.items ?? [];
          expect(items.length).toBeGreaterThanOrEqual(1);
          expect(items.length).toBeLessThanOrEqual(3);
          const cats = items.map(id => res.records.find((q: any) => q.type === "proposal" && q.proposal.id === id) as any).map(q => q.proposal.category);
          if (cats.includes("romance")) expect(cats.length).toBe(1);
          const cap = personas.get(x.memberId)?.archetype === "busy_parent" ? DEFAULT_ATTENTION.caps.quiet : DEFAULT_ATTENTION.caps.normal;
          const ts = [...(pro.get(x.memberId) ?? []), x.ts].filter(t => x.ts - t < cap.periodDays * DAY);
          expect(ts.length).toBeLessThanOrEqual(cap.limit);
          pro.set(x.memberId, ts);
          if (probes && items.length) for (const id of items) {
            const p: any = res.records.find((q: any) => q.type === "proposal" && q.proposal.id === id);
            for (const other of p.proposal.participants.filter((y: string) => y !== x.memberId)) {
              const name = personas.get(other)!.name;
              for (const part of name.split(" ")) expect(x.body.includes(part)).toBe(false);
            }
          }
        } else if (x.meta?.type !== "onboarding") expect(k).toBeLessThanOrEqual(DEFAULT_ATTENTION.blooio.logisticsMaxOutstanding);
        out.set(x.memberId, k + 1);
      }
      expect(interruptions).toBeGreaterThan(10);
      expect(net.ledger.filter(e => e.countsAgainstCap).length).toBe(interruptions);
      void HOUR;
    }, 120_000);
  });
}
