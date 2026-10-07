// Attention budget experiment (docs/results/2026-10-07-attention-budget.md). Compares today's
// behaviour (engine-v1.2.0 defaults, the sim's stub network: one item per interruption, sent as
// soon as the engine proposes it) with the Phase 1 attention budget (src/attention.ts): hold
// queue, weekly digests of up to 3 items, break-ins, the shadow price, and consent-first probes.
//
//   bun packages/engine/experiments/attention.ts                   # every variant, seeds 1-8
//   bun packages/engine/experiments/attention.ts --seeds 1,2 --only "probes"
//   bun packages/engine/experiments/attention.ts --fit             # Ê calibration on seeds 101-104
//   bun packages/engine/experiments/attention.ts --json /tmp/att.json
//
// No LLM calls. The engine reads only the snapshot. The oracle is used OFFLINE in this harness
// only: to score outcomes, and to simulate which digest item a member picks (attentionNetwork.ts).
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import * as A from "../src/attention.ts";
import { DEFAULT_ATTENTION, engineSupplyBudgets, resolveAttention, type AttentionConfigInput, type EngineConfigInput } from "../src/config.ts";
import type { AttentionItem, AttentionLedgerEntry, EngineInput, EngineProposal } from "../src/types.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import type { World as SimWorld } from "../../sim/src/world.ts";
import { AttentionNetwork, type AttentionNetOptions } from "./attentionNetwork.ts";
import { gini, mean, outcomes, pct, runSim, table } from "./lib.ts";

const args = parseArgs({ options: {
  only: { type: "string" }, seeds: { type: "string", default: "1,2,3,4,5,6,7,8" }, json: { type: "string" }, fit: { type: "boolean", default: false },
  /** Comma-separated JSON files from earlier runs (--json): print their tables in VARIANTS order. */
  merge: { type: "string" }, "no-baseline": { type: "boolean", default: false },
} }).values;
const SEEDS = args.seeds!.split(",").map(Number);

export interface Variant {
  name: string; cfg?: EngineConfigInput;
  /** undefined = the sim's own StubNetwork (today). */
  net?: Omit<AttentionNetOptions, "seed" | "randomIntros" | "choose"> & { choose?: "oracle" | "first" };
}
/** D1: the engine supplies up to cap x items per message; the attention layer enforces the interruption cap. */
const SUPPLY = engineSupplyBudgets(resolveAttention());
export const VARIANTS: Variant[] = [
  { name: "A v1.2 defaults (stub network: one item per interruption)" },
  { name: "A' v1.2 via the harness network (must equal A)", net: { mode: "v12" } },
  { name: "B attention budget + digest + hold queue (founder defaults)", cfg: SUPPLY, net: { mode: "attention", choose: "oracle" } },
  { name: "C B + consent-first probes (full Phase 1)", cfg: SUPPLY, net: { mode: "attention", probes: true, choose: "oracle" } },
  { name: "B1 B, one item per message (no menu)", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", attention: { maxItems: { open: 1, normal: 1, quiet: 1, receiving: 1 } } } },
  { name: "B2 B, cap only (no price, no quality bar)", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", capOnly: true } },
  { name: "B3 B, member takes the top-V item (no oracle choice)", cfg: SUPPLY, net: { mode: "attention", choose: "first" } },
  { name: "B4 B, partner probes wait up to 7 days (next digest)", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", attention: { expiry: { partnerProbeDays: 7 } } } },
  { name: "B5 B, engine supply budget unchanged (2 proposals /7d)", net: { mode: "attention", choose: "oracle" } },
  { name: "D1 B, partner probes may use any remaining cap", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", partnerAnyCap: true } },
  { name: "D2 D1, cap only (no price, no quality bar)", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", partnerAnyCap: true, capOnly: true } },
  { name: "D3 C, partner probes any remaining cap, cap only", cfg: SUPPLY, net: { mode: "attention", probes: true, choose: "oracle", partnerAnyCap: true, capOnly: true } },
  { name: "E1 D1, no separate acknowledgement messages", cfg: SUPPLY, net: { mode: "attention", choose: "oracle", partnerAnyCap: true, suppressAcks: true } },
];

// ------------------------------------------------------------------ per-seed run and metrics
export interface SeedRow {
  seed: number; proposals: number; precisionAll: number; delivered: number; precisionDelivered: number;
  metWorth: number; interruptions: number; interruptionsPerMemberWeek: number; itemsPerInterruption: number;
  valueEvents: number; valuePerInterruption: number; metWorthPerInterruption: number; unansweredRate: number;
  autoPausePer100MemberMonths: number; stops: number; stopPer1000: number; ttvMedian: number | null; v14: number;
  zeroAll: number; zeroDelivered: number; giniAll: number; giniDelivered: number; worthwhile: number;
  minors: number; leaks: number; invariants: number; byRule: Record<string, number>;
  overStateCap: number; quietHours: number; streakInterrupt: number; blooio4th: number;
  stats?: Record<string, unknown>;
}

function oracleChooser(get: () => SimWorld) {
  return (memberId: MemberId, items: AttentionItem[], proposals: ReadonlyMap<string, EngineProposal>) => {
    let best = items[0]!, bestP = -1;
    for (const it of items) {
      const p = proposals.get(it.sourceProposalId!)!;
      const v = get().oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective });
      const a = v.participants[memberId]?.acceptProb ?? 0;
      if (a > bestP) { best = it; bestP = a; }
    }
    return best.id;
  };
}

export async function runSeed(v: Variant, seed: number): Promise<SeedRow> {
  let world!: SimWorld;
  let net: AttentionNetwork | undefined;
  const res = await runSim({
    seed, cfg: v.cfg ?? {}, keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true },
    network: v.net ? s => (net = new AttentionNetwork({
      seed: s, randomIntros: false, ...v.net!,
      choose: v.net!.choose === "oracle" ? oracleChooser(() => world) : undefined,
    })) : undefined,
    onWorld: w => { world = w; },
    augment: input => (net ? net.engineView(input as EngineInput) : input),
  });
  const m = res.metrics;
  const recs = res.records as any[];
  const start = res.start, end = res.end;
  const personas = new Map(res.personas.map(p => [p.id, p]));
  const joined = new Map<MemberId, number>();
  const optOut = new Map<MemberId, number>();
  const props = new Map<string, any>();
  const delivered = new Set<string>();
  const deliveredTo = new Map<MemberId, number>();
  const msgs: any[] = [];
  const inbound = new Map<MemberId, number[]>();
  for (const r of recs) {
    if (r.type === "join") joined.set(r.memberId, r.t);
    else if (r.type === "opt_out") optOut.set(r.memberId, r.t);
    else if (r.type === "proposal") props.set(r.proposal.id, r);
    else if (r.type === "message") {
      const x = r.msg;
      if (x.direction === "inbound") { if (!inbound.has(x.memberId)) inbound.set(x.memberId, []); inbound.get(x.memberId)!.push(x.ts); continue; }
      if (x.system || x.status !== "delivered") continue;
      msgs.push(x);
      const items: string[] = x.meta?.attention?.items ?? (x.meta?.type === "proposal" && x.meta?.proactive && x.meta?.proposalId ? [x.meta.proposalId] : []);
      for (const pid of items) { delivered.add(pid); deliveredTo.set(x.memberId, (deliveredTo.get(x.memberId) ?? 0) + 1); }
    }
  }
  // Interruption ledger, built the same way for both arms from what was actually sent.
  const ledger: AttentionLedgerEntry[] = [];
  const firstInboundAfter = (id: MemberId, t: number) => (inbound.get(id) ?? []).find(x => x > t);
  for (const x of msgs) if (x.meta?.proactive) {
    const items: string[] = x.meta?.attention?.items ?? [x.meta?.proposalId ?? x.id];
    const rep = firstInboundAfter(x.memberId, x.ts);
    ledger.push({ messageId: x.id, memberId: x.memberId, at: x.ts, kind: x.meta?.attention?.kind ?? "probe", itemIds: items, countsAgainstCap: true, ...(rep !== undefined ? { repliedAt: rep } : {}) });
  }
  // Auto-pause: the second consecutive interruption left unanswered past 72h.
  const autoPauses: { memberId: MemberId; at: number }[] = [];
  const byMember = new Map<MemberId, AttentionLedgerEntry[]>();
  for (const e of ledger) { if (!byMember.has(e.memberId)) byMember.set(e.memberId, []); byMember.get(e.memberId)!.push(e); }
  for (const [id, es] of byMember) {
    let streak = 0;
    for (const e of es.sort((a, b) => a.at - b.at)) {
      const dl = e.at + 72 * HOUR;
      if (dl > end) break;
      if (e.repliedAt !== undefined && e.repliedAt <= dl) { streak = 0; continue; }
      if (++streak === 2) { autoPauses.push({ memberId: id, at: dl }); break; }
    }
  }
  // Value events (3.3): attended a meeting that was held. Met + worthwhile: everyone who came enjoyed it.
  const outs = outcomes(res.records);
  const values: A.ValueEvent[] = [];
  for (const r of recs) if (r.type === "outcome") {
    const shows = Object.entries(r.attendance as Record<string, any>).filter(([, a]) => a.showed);
    if (shows.length >= 2) for (const [id] of shows) values.push({ memberId: id, at: r.at });
  }
  const metWorth = outs.filter(o => o.held && o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5)).length;
  const adult = (id: MemberId) => { const p = personas.get(id); return !!p && p.public.claimedAge >= 18 && !p.hidden.adversarial; };
  const spans: A.MemberSpan[] = [...joined].map(([id, t]) => ({ id, joinedAt: t, adult: adult(id), leftAt: optOut.get(id), onlyWhenAskedAt: autoPauses.find(a => a.memberId === id)?.at }));
  const am = A.attentionMetrics({ ledger, members: spans, values, autoPauses, stops: [...optOut].map(([memberId, at]) => ({ memberId, at })), start, end });
  // Invariants beyond the judge's: per-state cap (Normal 2/7d, Quiet 1/30d), interruptions sent with
  // >= 2 outbound outstanding (the design's Blooio reservation), any outbound with >= 3 outstanding.
  let overStateCap = 0;
  for (const [id, es] of byMember) {
    const quiet = personas.get(id)?.archetype === "busy_parent";
    const cap = quiet ? DEFAULT_ATTENTION.caps.quiet : DEFAULT_ATTENTION.caps.normal;
    const ts = es.map(e => e.at).sort((a, b) => a - b);
    for (let i = 0; i < ts.length; i++) if (ts.filter(t => t <= ts[i]! && t > ts[i]! - cap.periodDays * DAY).length > cap.limit) overStateCap++;
  }
  let streakInterrupt = 0, blooio4th = 0;
  const outstanding = new Map<MemberId, number>();
  const timeline = [...msgs.map(x => ({ t: x.ts, id: x.memberId, out: true, pro: !!x.meta?.proactive })),
    ...[...inbound].flatMap(([id, ts]) => ts.map(t => ({ t, id, out: false, pro: false })))].sort((a, b) => (a.t - b.t) || (a.out ? 1 : -1));
  for (const e of timeline) {
    if (!e.out) { outstanding.set(e.id, 0); continue; }
    const k = outstanding.get(e.id) ?? 0;
    if (e.pro && k >= 2) streakInterrupt++;
    if (k >= 3) blooio4th++;
    outstanding.set(e.id, k + 1);
  }
  const deliveredProps = [...delivered].map(id => props.get(id)).filter(Boolean);
  const eligibleAdults = [...joined.keys()].filter(adult);
  const counts = eligibleAdults.map(id => deliveredTo.get(id) ?? 0);
  return {
    seed, proposals: m.proposals.total, precisionAll: m.proposals.precision, delivered: deliveredProps.length,
    precisionDelivered: mean(deliveredProps.map(r => (r.oracle.compatible ? 1 : 0))),
    metWorth, interruptions: am.interruptions, interruptionsPerMemberWeek: am.interruptionsPerMemberWeek, itemsPerInterruption: am.itemsPerInterruption,
    valueEvents: am.valueEvents, valuePerInterruption: am.valuePerInterruption, metWorthPerInterruption: am.interruptions ? metWorth / am.interruptions : 0,
    unansweredRate: am.unansweredRate, autoPausePer100MemberMonths: am.autoPausePer100MemberMonths, stops: optOut.size, stopPer1000: am.stopPer1000,
    ttvMedian: am.timeToValueDaysMedian, v14: am.v14, zeroAll: m.fairness.zeroProposalShare, giniAll: m.fairness.gini,
    zeroDelivered: counts.length ? counts.filter(c => c === 0).length / counts.length : 0, giniDelivered: gini(counts), worthwhile: m.experience.worthwhileRate,
    minors: m.safety.minorContacts, leaks: m.privacy.canaryLeaks, invariants: m.invariants.total, byRule: m.invariants.byRule,
    overStateCap, quietHours: m.invariants.byRule.quiet_hours ?? 0, streakInterrupt, blooio4th,
    stats: net ? { ...net.stats, shownTo: undefined, shown: undefined, autoPauses: net.stats.autoPauses.length, ledger: net.ledger.length } : undefined,
  };
}

export interface VariantRow { name: string; seeds: SeedRow[] }
const avg = (rs: SeedRow[], k: keyof SeedRow) => mean(rs.map(r => r[k] as number).filter(x => x !== null && Number.isFinite(x)));
const sum = (rs: SeedRow[], k: keyof SeedRow) => rs.reduce((s, r) => s + (r[k] as number), 0);
const sd = (xs: number[]) => { const mu = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1)); };

export function summaryTables(rows: VariantRow[]): string {
  const base = rows[0]?.seeds;
  const d = (x: number, b: number | undefined, scale = 1, dp = 1) => (b === undefined || !Number.isFinite(b) ? "" : ` (${x - b >= 0 ? "+" : ""}${((x - b) * scale).toFixed(dp)})`);
  const value = rows.map(r => {
    const mw = r.seeds.map(s => s.metWorth);
    return [r.name, `${mean(mw).toFixed(1)} ± ${(sd(mw) / Math.sqrt(mw.length)).toFixed(1)}${r === rows[0] ? "" : d(mean(mw), base ? avg(base, "metWorth") : undefined)}`,
      mw.join(" "), avg(r.seeds, "interruptionsPerMemberWeek").toFixed(2), avg(r.seeds, "itemsPerInterruption").toFixed(2),
      avg(r.seeds, "metWorthPerInterruption").toFixed(3), avg(r.seeds, "valuePerInterruption").toFixed(3), pct(avg(r.seeds, "v14")),
      (avg(r.seeds, "ttvMedian") || NaN).toFixed(1)];
  });
  const annoy = rows.map(r => [r.name, pct(avg(r.seeds, "unansweredRate")), avg(r.seeds, "autoPausePer100MemberMonths").toFixed(1), `${sum(r.seeds, "stops")} (${avg(r.seeds, "stopPer1000").toFixed(1)})`, pct(avg(r.seeds, "worthwhile"))]);
  const match = rows.map(r => [r.name, avg(r.seeds, "proposals").toFixed(0), pct(avg(r.seeds, "precisionAll")), avg(r.seeds, "delivered").toFixed(0), pct(avg(r.seeds, "precisionDelivered")),
    `${pct(avg(r.seeds, "zeroAll"))} / ${pct(avg(r.seeds, "zeroDelivered"))}`, `${avg(r.seeds, "giniAll").toFixed(3)} / ${avg(r.seeds, "giniDelivered").toFixed(3)}`]);
  const inv = rows.map(r => [r.name, sum(r.seeds, "minors"), sum(r.seeds, "leaks"), sum(r.seeds, "overStateCap"), sum(r.seeds, "quietHours"), sum(r.seeds, "streakInterrupt"), sum(r.seeds, "blooio4th"),
    `${sum(r.seeds, "invariants")} ${JSON.stringify(r.seeds.reduce((o, s) => { for (const [k, v] of Object.entries(s.byRule)) o[k] = (o[k] ?? 0) + (v as number); return o; }, {} as Record<string, number>))}`]);
  return [
    "### Value and interruptions (mean over seeds; met + worthwhile ± standard error)\n",
    table(["variant", "met + worthwhile /seed", "per seed", "interruptions /member/wk", "items /interruption", "met+worthwhile /interruption", "value events /interruption", "V14", "time to value (median days)"], value),
    "\n### Annoyance\n",
    table(["variant", "unanswered rate (72h)", "auto-pause /100 member-months", "STOP total (per 1,000 interruptions)", "persona worthwhile"], annoy),
    "\n### Match quality and spread (engine proposals / items actually delivered)\n",
    table(["variant", "engine proposals /seed", "precision (all proposals)", "proposals delivered /seed", "precision (delivered)", "no proposal: all / delivered", "Gini: all / delivered"], match),
    "\n### Invariants (summed over seeds)\n",
    table(["variant", "minor contacts", "canary leaks", "over state cap", "quiet-hour sends", "interruptions with >= 2 outstanding", "outbound with >= 3 outstanding (Blooio 4th)", "judge invariants"], inv),
  ].join("\n");
}

// ------------------------------------------------------------------ Ê calibration fit (--fit)
/** Pool-adjacent-violators over (x, y) bins; returns non-decreasing knots. */
export function pav(points: { x: number; y: number }[], bins = 10): [number, number][] {
  const s = [...points].sort((a, b) => a.x - b.x);
  const per = Math.ceil(s.length / bins);
  const blocks: { x: number; y: number; n: number }[] = [];
  for (let i = 0; i < s.length; i += per) {
    const b = s.slice(i, i + per);
    blocks.push({ x: mean(b.map(p => p.x)), y: mean(b.map(p => p.y)), n: b.length });
  }
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i]!.y < blocks[i - 1]!.y) {
      const a = blocks[i - 1]!, b = blocks[i]!;
      const n = a.n + b.n;
      blocks.splice(i - 1, 2, { x: (a.x * a.n + b.x * b.n) / n, y: (a.y * a.n + b.y * b.n) / n, n });
      i = Math.max(0, i - 2);
    }
  }
  return blocks.map(b => [Math.round(b.x * 1000) / 1000, Math.round(b.y * 1000) / 1000]);
}

async function fit() {
  const pts: { x: number; y: number; c: string }[] = [];
  for (const seed of [101, 102, 103, 104]) {
    const res = await runSim({ seed, keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true } });
    const props = new Map<string, any>(), msgProp = new Map<string, string>();
    for (const r of res.records as any[]) {
      if (r.type === "proposal") props.set(r.proposal.id, r.proposal);
      else if (r.type === "message" && r.msg.meta?.proposalId) msgProp.set(r.msg.id, r.msg.meta.proposalId);
      else if (r.type === "judgment") {
        const p = props.get(msgProp.get(r.messageId) ?? "");
        if (p) pts.push({ x: p.score, y: r.worthwhile ? 1 : 0, c: p.category ?? "social" });
      }
    }
    process.stderr.write(`fit seed ${seed}: ${pts.length} labels\n`);
  }
  console.log(`n=${pts.length}, base rate ${pct(mean(pts.map(p => p.y)))}`);
  console.log("pooled knots:", JSON.stringify(pav(pts)));
  const cats = [...new Set(pts.map(p => p.c))];
  for (const c of cats) { const xs = pts.filter(p => p.c === c); console.log(`${c} (n=${xs.length}, rate ${pct(mean(xs.map(p => p.y)))}):`, JSON.stringify(pav(xs, Math.min(10, Math.max(2, Math.floor(xs.length / 40)))))); }
}

if (import.meta.main) {
  if (args.fit) { await fit(); process.exit(0); }
  if (args.merge) {
    const all: VariantRow[] = [];
    for (const f of args.merge.split(",")) all.push(...(await Bun.file(f).json() as VariantRow[]));
    const order = new Map(VARIANTS.map((v, i) => [v.name, i]));
    const rows = [...new Map(all.map(r => [r.name, r])).values()].sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
    console.log(`## Simulator (seeds ${rows[0]!.seeds.map(s => s.seed).join(",")}, 150 personas, 30 days, engine-v1.2.0 defaults, v1.2 snapshot, history fed)\n\n${summaryTables(rows)}`);
    process.exit(0);
  }
  const only = args.only ? new RegExp(args.only, "i") : undefined;
  const rows: VariantRow[] = [];
  for (const v of VARIANTS) {
    if (only && !only.test(v.name) && (args["no-baseline"] || !v.name.startsWith("A "))) continue;
    const t0 = performance.now();
    const seeds: SeedRow[] = [];
    for (const s of SEEDS) seeds.push(await runSeed(v, s));
    rows.push({ name: v.name, seeds });
    process.stderr.write(`${v.name}: ${Math.round(performance.now() - t0)}ms\n`);
  }
  console.log(`## Simulator (seeds ${SEEDS.join(",")}, 150 personas, 30 days, engine-v1.2.0 defaults, v1.2 snapshot, history fed)\n\n${summaryTables(rows)}`);
  if (args.json) await Bun.write(args.json, JSON.stringify(rows, null, 1));
}
