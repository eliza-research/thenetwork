// End-to-end invariants of the attention budget send path in the simulator (harness network,
// experiments/attentionNetwork.ts): a short run, deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { DEFAULT_ATTENTION, engineSupplyBudgets } from "../src/config.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import { AttentionNetwork } from "../experiments/attentionNetwork.ts";
import { runSim } from "../experiments/lib.ts";

type Cfg = { name: string; probes: boolean; iter2?: boolean; iter3?: boolean };
async function run(c: Cfg) {
  let net!: AttentionNetwork;
  const res = await runSim({
    seed: 3, personas: 80, days: 14, cfg: engineSupplyBudgets(), keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true },
    gen: c.iter2 ? { minorShare: 0.1 } : undefined,
    network: s => (net = new AttentionNetwork({
      seed: s, randomIntros: false, mode: "attention", probes: c.probes,
      ...(c.iter2 ? { cadence: "rolling" as const, lambdaScale: 0, partnerAnyCap: true, suppressAcks: true, outsideWorld: true, actOnEvent: () => false } : {}),
      // Iteration 3 (founder decisions 1-4): learned send time, partner probes in the partner's send window, time options.
      ...(c.iter3 ? {
        cadence: "rolling" as const, lambdaScale: 0, suppressAcks: true, requeueUnpicked: true, outsideWorld: true, eventsAlone: false, actOnEvent: () => false,
        sendTime: "learned" as const, sendWindowHours: 6, partnerInWindow: true, timeOptions: true,
        hiddenFree: (_id: string, t: number) => new Date(t).getUTCHours() % 2 === 0, connectsCalendar: () => true,
      } : {}),
    })),
    augment: input => net.engineView(input as any),
  });
  return { res, net };
}

const CFGS: Cfg[] = [
  { name: "named items", probes: false },
  { name: "consent-first probes", probes: true },
  { name: "iteration 2: rolling, no price, partner on any cap, acks folded, events, probes", probes: true, iter2: true },
  { name: "iteration 3: learned send time, partner in window, time options, probes", probes: true, iter3: true },
];
for (const c of CFGS) {
  const probes = c.probes;
  describe(`attention send path in the simulator (${c.name})`, () => {
    test("0 minor contacts, 0 canary leaks, 0 quiet-hour sends, 0 over-cap, 0 interruptions past the Blooio reservation; digests <= 3 items; romance alone", async () => {
      const { res, net } = await run(c);
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
      let interruptions = 0, minorMsgs = 0;
      for (const r of recs) {
        const x = r.msg;
        if (x.direction === "inbound") { out.set(x.memberId, 0); continue; }
        const k = out.get(x.memberId) ?? 0;
        if (x.meta?.proactive) {
          interruptions++;
          expect(k).toBeLessThanOrEqual(DEFAULT_ATTENTION.blooio.interruptMaxOutstanding);
          const all: string[] = x.meta.attention?.items ?? [];
          expect(all.length).toBeGreaterThanOrEqual(1);
          expect(all.length).toBeLessThanOrEqual(3);
          const items = all.filter(id => !id.startsWith("ev:"));
          const minor = (personas.get(x.memberId)?.public.claimedAge ?? 30) < 18;
          if (minor) {
            minorMsgs++;
            // D9: events only, 1 per 7 days, at most 2 items, never on a school night after 20:00.
            expect(items.length).toBe(0);
            expect(all.length).toBeLessThanOrEqual(2);
            const lp = new Date(x.ts).toLocaleString("en-US", { timeZone: personas.get(x.memberId)!.homeCity === "sf" ? "America/Los_Angeles" : "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" });
            const [wd, hh] = lp.split(" ");
            const h = Number(hh);
            if (h >= 20) expect(["Fri", "Sat"].includes(wd!.replace(",", ""))).toBe(true);
            if (h < 8) expect(["Sat", "Sun"].includes(wd!.replace(",", ""))).toBe(true);
          }
          const cats = items.map(id => res.records.find((q: any) => q.type === "proposal" && q.proposal.id === id) as any).map(q => q.proposal.category);
          if (cats.includes("romance")) expect(cats.length).toBe(1);
          const isMinor = (personas.get(x.memberId)?.public.claimedAge ?? 30) < 18;
          const cap = isMinor ? DEFAULT_ATTENTION.minors.cap : personas.get(x.memberId)?.archetype === "busy_parent" ? DEFAULT_ATTENTION.caps.quiet : DEFAULT_ATTENTION.caps.normal;
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
      if (c.iter2) { expect(net.stats.eventsShown).toBeGreaterThan(0); expect(minorMsgs).toBeGreaterThan(0); }
      if (c.iter3) {
        // Probes carry 2-3 concrete times; a meeting set from them is at a time everyone picked.
        expect(net.stats.probesWithOptions).toBeGreaterThan(0);
        expect(recs.some(r => r.msg.meta?.type === "probe" && / or (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d+(am|pm)/.test(r.msg.body))).toBe(true);
        for (const r of recs) if (r.msg.meta?.type === "scheduling" && r.msg.meta?.meetingAt && net.stats.timedMeetings + net.stats.untimedMeetings > 0) expect(r.msg.meta.meetingAt).toBeGreaterThan(r.msg.ts);
      }
      expect(net.ledger.filter(e => e.countsAgainstCap).length).toBe(interruptions);
      void HOUR;
    }, 120_000);
  });
}
