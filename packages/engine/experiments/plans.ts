// Plans experiment (docs/results/2026-10-08-plans.md). Baseline: the v1.2 engine plus attention v1.2
// (N3 with the booked-plan reveal, "(c)"; the attention results' HQ-c / Q-c arms, reproduced through
// the same harness network). Treatment: the same plus the planner (src/plans.ts) with availability
// capture. 8 seeds, 150 personas, 30 days, no LLM calls.
//
//   bun packages/engine/experiments/plans.ts                     # every variant, seeds 1-8
//   bun packages/engine/experiments/plans.ts --only "^P " --seeds 1,2
//   bun packages/engine/experiments/plans.ts --json /tmp/plans.json
//
// HARNESS ONLY: hidden truth is read to simulate personas (plan probe answers, check-in answers,
// standing availability, the post-plan answers) and to score outcomes (plansHarness.ts). The engine
// and the planner read only the snapshot and what the harness Network recorded.
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { activityById } from "../src/activities.ts";
import * as A from "../src/attention.ts";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, engineSupplyBudgets, plansConfigHash, resolveAttention, resolvePlans, type PlansConfigInput } from "../src/config.ts";
import type { AttentionItem, AttentionLedgerEntry, EngineInput, EngineProposal } from "../src/types.ts";
import { Rng as SimRng, hash32 } from "../../sim/src/rng.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import type { World as SimWorld } from "../../sim/src/world.ts";
import { gini, mean, outcomes, pct, runSim, table } from "./lib.ts";
import { DEFAULT_CAPTURE, checkInAnswer, crewOptIn, hiddenAvailability, optsInToCheckIn, planEnjoyment, planYesProb, statedStanding, syntheticVenues, type CaptureModel } from "./plansHarness.ts";
import { PlanNetwork } from "./plansNetwork.ts";

const args = parseArgs({ options: { only: { type: "string" }, seeds: { type: "string", default: "1,2,3,4,5,6,7,8" }, json: { type: "string" }, days: { type: "string", default: "30" } } }).values;
const SEEDS = args.seeds!.split(",").map(Number);
const DAYS = Number(args.days);

interface Variant { name: string; fixes: boolean; plans?: PlansConfigInput | false; capture?: Partial<CaptureModel>; noWindowPriming?: boolean }
/** Attention v1.2 "(c)": N3 (rolling 12:00 learned, probe first, partner in window, initial invites only, time options) + the booked-plan reveal. */
const QC = {
  mode: "attention" as const, lambdaScale: 0, partnerAnyCap: false, cadence: "rolling" as const, suppressAcks: true, requeueUnpicked: true, probes: true,
  sendTime: "learned" as const, sendWindowHours: 6, partnerInWindow: true, timeOptions: true, revealOptOut: true,
};
const SUPPLY = engineSupplyBudgets(resolveAttention());
export const VARIANTS: Variant[] = [
  { name: "B HQ-c baseline: v1.2 engine + attention v1.2 (c), fixes 1-3", fixes: true, plans: false },
  { name: "P HQ-c + planner, founder defaults (plan allowance 1/7d, crews after one great plan)", fixes: true, plans: {} },
  { name: "P-std P, standing availability only (no weekly check-in)", fixes: true, plans: {}, capture: { checkIn: { base: 0, slope: 0 } } },
  { name: "P-low P, low capture (check-in 10-25%, standing 25%)", fixes: true, plans: {}, capture: { checkIn: { base: 0.1, slope: 0.15 }, standing: 0.25 } },
  { name: "P-nofb P without fallbacks", fixes: true, plans: { fallback: { smaller: false, soloEvent: false, nextWeek: false } } },
  { name: "P-nofam P without the familiarity term", fixes: true, plans: { familiarity: { oneBonus: 0, cliquePenalty: 0 } } },
  { name: "P-lm0 P scored by the mean (no least misery)", fixes: true, plans: { minWeight: 0, minMemberU: 0 } },
  { name: "P-t35 P, plan threshold 0.35", fixes: true, plans: { threshold: 0.35, minMemberU: 0.35 } },
  { name: "P-nopair P without activity-partner plans", fixes: true, plans: { partnerPlans: false } },
  { name: "P-hold P, a yes holds the member until quorum", fixes: true, plans: { yesHolds: true } },
  { name: "P-np P without window priming (plan probes answered cold)", fixes: true, plans: {}, noWindowPriming: true },
  { name: "P-un P, plans only for members no intro is serving", fixes: true, plans: { unservedOnly: true } },
  { name: "P-crew2 P, crews only after 2 plans together (previous rule)", fixes: true, plans: { crews: { minPlans: 2 } } },
  { name: "P-shared P without the plan allowance (plan invites on the intro cap, as plans-v1.0.0)", fixes: true, plans: { allowance: { enabled: false } } },
  { name: "B0 Q-c baseline without fixes", fixes: false, plans: false },
  { name: "P0 Q-c + planner, without fixes", fixes: false, plans: {} },
];

// ---- simulator-fidelity fixes 1-3 of the attention results (copied from attention.ts, harness only) ----
function primeProbes(world: SimWorld, seed: number) {
  const W = world as any, oracle = world.oracle, orig = oracle.probe.bind(oracle);
  oracle.probe = (id, q) => {
    const now = world.clock.now();
    const asked = (W.memories.get(id)?.signals ?? []).some((sg: any) => sg.source === "ask" && sg.category === q.category && now - sg.at < 7 * DAY);
    if (!asked || !q.participants || q.participants.length < 2) return orig(id, q);
    const v = oracle.evaluatePrimed({ id: `probe:${q.key}`, kind: q.kind ?? "intro", participants: q.participants, city: q.city, window: { start: q.at, end: q.at }, category: q.category }, { [id]: "ask" });
    const yesProb = v.participants[id]?.acceptProb ?? 0;
    return { yesProb, yes: new SimRng(hash32(seed, "probe-primed", q.key, id)).next() < yesProb };
  };
}
function eventActor(get: () => SimWorld, seed: number) {
  return (memberId: MemberId, ev: { id: string; city: string; start: number; tags: string[] }) => {
    const o = get().oracle, p = o.persona(memberId);
    if (!p) return false;
    const r = o.probe(memberId, { key: `ev:${ev.id}`, category: "events", city: ev.city as any, at: ev.start });
    const like = ev.tags.some(t => p.hidden.interests.includes(t)) ? 1 : 0.2;
    return new SimRng(hash32(seed, "act", ev.id, memberId)).next() < r.yesProb * like * (1 - p.hidden.responsiveness.ignoreProb);
  };
}
function timeDependentAttendance(world: SimWorld, seed: number, free: (id: MemberId, t: number) => boolean, apply: boolean, counts: { meetings: number; seats: number; unavailable: number }) {
  const W = world as any, orig = W.scheduleMeeting.bind(W), seen = new Set<string>();
  W.scheduleMeeting = (m: { proposalId: string; participants: MemberId[]; at: number }) => {
    const id = orig(m);
    if (!seen.has(m.proposalId)) { seen.add(m.proposalId); counts.meetings++; }
    for (const pid of m.participants) {
      const k = `${m.proposalId}|${pid}`;
      if (seen.has(k)) continue;
      seen.add(k); counts.seats++;
      if (free(pid, m.at)) continue;
      counts.unavailable++;
      const pr = W.memories.get(pid)?.proposals?.[m.proposalId];
      if (apply && pr?.plannedShow && new SimRng(hash32(seed, "unavailable", m.proposalId, pid)).next() < 0.7) pr.plannedShow = false;
    }
    return id;
  };
}

export interface SeedRow {
  seed: number; metWorth: number; metWorthPairs: number; metWorthPlans: number; planValueSeats: number;
  interruptions: number; intPerMemberWeek: number; meetingsHeld: number; meetingsPerInterruption: number; metWorthPerInterruption: number;
  valueEvents: number; v14: number; noValueShare: number; giniValue: number; giniDelivered: number;
  firstValueFromPlan: number; membersWithValue: number;
  plans: number; probedPlans: number; booked: number; quorumRate: number; confirmedSeats: number; attendedSeats: number; planMeetings: number; planGood: number;
  minors: number; minorsInPlans: number; undisclosedMinorsInPlans: number; leaks: number; nameLeaks: number; overStateCap: number; quietHours: number; checkInQuiet: number; doubleBooked: number; overPlanAllowance: number; blooio4th: number; streakInterrupt: number; invariants: number; byRule: Record<string, number>;
  stats?: Record<string, unknown>;
}

export async function runSeed(v: Variant, seed: number): Promise<SeedRow> {
  let world!: SimWorld;
  let net!: PlanNetwork;
  const free = hiddenAvailability(() => world, seed);
  const capture: CaptureModel = { ...DEFAULT_CAPTURE, ...(v.capture ?? {}), checkIn: { ...DEFAULT_CAPTURE.checkIn, ...(v.capture?.checkIn ?? {}) } };
  const mcount = { meetings: 0, seats: 0, unavailable: 0 };
  const venues = syntheticVenues();
  const primedFor = (id: MemberId, t: number) => {
    if (v.noWindowPriming) return false;
    const st = net?.stated.get(id);
    return !!st && st.until > t && st.windows.some(x => x.start <= t && x.end > t);
  };
  const chooser = (memberId: MemberId, items: AttentionItem[], proposals: ReadonlyMap<string, EngineProposal>) => {
    let best = items[0]!, bestP = -1;
    for (const it of items) {
      const l = net.live.get(it.sourceProposalId!);
      let a: number;
      if (l) a = planYesProb(world.oracle, memberId, activityById.get(l.plan.activityId)!, l.plan.invited.length, l.plan.city, l.plan.window.start, 0, primedFor(memberId, l.plan.window.start));
      else {
        const p = proposals.get(it.sourceProposalId!)!;
        a = world.oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective }).participants[memberId]?.acceptProb ?? 0;
      }
      if (a > bestP) { best = it; bestP = a; }
    }
    return best.id;
  };
  const res = await runSim({
    seed, days: DAYS, cfg: SUPPLY, keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true },
    network: s => (net = new PlanNetwork({
      seed: s, randomIntros: false, ...QC, choose: chooser,
      ...(v.fixes ? { outsideWorld: true, actOnEvent: eventActor(() => world, seed), eventsAlone: false } : {}),
      hiddenFree: free,
      connectsCalendar: (id: MemberId) => new SimRng(hash32(seed, "calendar", id)).next() < 0.5,
      calendarShowsBusy: (id: MemberId, t: number) => new SimRng(hash32(seed, "calendar-recall", id, t)).next() < 0.85,
      plans: v.plans, venues,
      checkInOptIn: (id: MemberId) => optsInToCheckIn(world.oracle, seed, id, capture),
      checkInAnswer: (id: MemberId, slots: A.TimeSlot[]) => checkInAnswer(seed, id, slots, free, capture),
      standing: (id: MemberId, at: number) => statedStanding(world.oracle, seed, id, at, capture),
      crewOptIn: (id: MemberId, crew) => crewOptIn(world.oracle, seed, id, crew.id),
      planFeedback: (plan, going) => {
        const W = world as any;
        const attended = going.filter(id => W.memories.get(id)?.meetings?.[plan.id]?.showed);
        const e = planEnjoyment(world.oracle, seed, plan, attended);
        return { attended, positive: attended.length >= 2 ? attended.filter(id => (e[id] ?? 0) >= 0.6) : [] };
      },
    })),
    onWorld: w => {
      world = w;
      if (v.fixes) primeProbes(w, seed);
      timeDependentAttendance(w, seed, free, v.fixes, mcount);
      // HARNESS: anonymous plan probes are answered from the plan probe model (plansHarness.planYesProb), installed outermost.
      const oracle = w.oracle, orig = oracle.probe.bind(oracle);
      oracle.probe = (id, q) => {
        const l = net?.live.get(q.key);
        if (!l) return orig(id, q);
        const yesProb = planYesProb(oracle, id, activityById.get(l.plan.activityId)!, l.plan.invited.length, l.plan.city, l.plan.window.start, q.recentAsks ?? 0, primedFor(id, l.plan.window.start));
        return { yesProb, yes: new SimRng(hash32(seed, "plan-probe", q.key, id)).next() < yesProb };
      };
    },
    augment: input => net.engineView(input as EngineInput),
  });
  const m = res.metrics, recs = res.records as any[], start = res.start, end = res.end;
  const personas = new Map(res.personas.map(p => [p.id, p]));
  const joined = new Map<MemberId, number>(), optOut = new Map<MemberId, number>();
  const msgs: any[] = [], inbound = new Map<MemberId, number[]>();
  const deliveredTo = new Map<MemberId, number>();
  for (const r of recs) {
    if (r.type === "join") joined.set(r.memberId, r.t);
    else if (r.type === "opt_out") optOut.set(r.memberId, r.t);
    else if (r.type === "message") {
      const x = r.msg;
      if (x.direction === "inbound") { if (!inbound.has(x.memberId)) inbound.set(x.memberId, []); inbound.get(x.memberId)!.push(x.ts); continue; }
      if (x.system || x.status !== "delivered") continue;
      msgs.push(x);
      for (const pid of (x.meta?.attention?.items ?? []).filter((i: string) => !String(i).startsWith("ev:"))) { void pid; deliveredTo.set(x.memberId, (deliveredTo.get(x.memberId) ?? 0) + 1); }
    }
  }
  const ledger: AttentionLedgerEntry[] = [];
  const firstInboundAfter = (id: MemberId, t: number) => (inbound.get(id) ?? []).find(x => x > t);
  for (const x of msgs) if (x.meta?.proactive) {
    const rep = firstInboundAfter(x.memberId, x.ts);
    ledger.push({ messageId: x.id, memberId: x.memberId, at: x.ts, kind: x.meta?.attention?.kind ?? "probe", itemIds: x.meta?.attention?.items ?? [x.id], countsAgainstCap: true, ...(rep !== undefined ? { repliedAt: rep } : {}) });
  }
  const byMember = new Map<MemberId, AttentionLedgerEntry[]>();
  for (const e of ledger) { if (!byMember.has(e.memberId)) byMember.set(e.memberId, []); byMember.get(e.memberId)!.push(e); }
  const autoPauses: { memberId: MemberId; at: number }[] = [];
  for (const [id, es] of byMember) {
    let streak = 0;
    for (const e of es.sort((a, b) => a.at - b.at)) {
      const dl = e.at + 72 * HOUR;
      if (dl > end) break;
      if (e.repliedAt !== undefined && e.repliedAt <= dl) { streak = 0; continue; }
      if (++streak === 2) { autoPauses.push({ memberId: id, at: dl }); break; }
    }
  }
  // Value: every held meeting (>= 2 came) is a value event for each attendee; plans scored by the harness plan oracle.
  const planIds = net.planIds;
  const plansById = new Map([...net.live.values()].map(l => [l.plan.id, l]));
  const values: (A.ValueEvent & { plan: boolean })[] = [...(net.stats.eventValues ?? []).map(e => ({ ...e, plan: false }))];
  let metWorthPlans = 0, planValueSeats = 0, planMeetings = 0, attendedSeats = 0, meetingsHeld = 0, planGood = 0;
  for (const r of recs) if (r.type === "outcome") {
    const shows = Object.entries(r.attendance as Record<string, any>).filter(([, a]) => a.showed).map(([id]) => id);
    const isPlan = planIds.has(r.proposalId);
    if (isPlan) { planMeetings++; attendedSeats += shows.length; }
    if (shows.length < 2) continue;
    meetingsHeld++;
    for (const id of shows) values.push({ memberId: id, at: r.at, plan: isPlan });
    if (isPlan) {
      const l = plansById.get(r.proposalId)!;
      const e = planEnjoyment(res.oracle, seed, l.plan, shows);
      const es = shows.map(id => e[id] ?? 0);
      planValueSeats += es.filter(x => x >= 0.5).length;
      if (es.every(x => x >= 0.5)) metWorthPlans++;
      if (shows.length >= l.plan.size.min && mean(es) >= 0.55 && Math.min(...es) >= 0.4) planGood++;
    }
  }
  const metWorthPairs = outcomes(res.records).filter(o => o.held && o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5)).length;
  const adult = (id: MemberId) => { const p = personas.get(id); return !!p && p.public.claimedAge >= 18 && !p.hidden.adversarial; };
  const spans: A.MemberSpan[] = [...joined].map(([id, t]) => ({ id, joinedAt: t, adult: adult(id), leftAt: optOut.get(id), onlyWhenAskedAt: autoPauses.find(a => a.memberId === id)?.at }));
  const am = A.attentionMetrics({ ledger, members: spans, values, autoPauses, stops: [...optOut].map(([memberId, at]) => ({ memberId, at })), start, end });
  const adults = [...joined.keys()].filter(adult);
  const vcount = new Map<MemberId, number>();
  const first = new Map<MemberId, { at: number; plan: boolean }>();
  for (const e of values) {
    vcount.set(e.memberId, (vcount.get(e.memberId) ?? 0) + 1);
    const f = first.get(e.memberId);
    if (!f || e.at < f.at) first.set(e.memberId, { at: e.at, plan: e.plan });
  }
  const withValue = adults.filter(id => first.has(id));
  // Invariants.
  // Caps: the intro cap (state cap) over every interruption except plan invites sent under the plan
  // allowance; the plan allowance (1 per 7 days) over those.
  let overStateCap = 0, overPlanAllowance = 0;
  const pa = resolvePlans(v.plans || {}).allowance;
  for (const [id, es] of byMember) {
    const cap = personas.get(id)?.archetype === "busy_parent" ? DEFAULT_ATTENTION.caps.quiet : DEFAULT_ATTENTION.caps.normal;
    const over = (ts: number[], lim: number, days: number) => { ts.sort((a, b) => a - b); let n = 0; for (let i = 0; i < ts.length; i++) if (ts.filter(t => t <= ts[i]! && t > ts[i]! - days * DAY).length > lim) n++; return n; };
    overStateCap += over(es.filter(e => !net.planInviteIds.has(e.messageId)).map(e => e.at), cap.limit, cap.periodDays);
    overPlanAllowance += over(es.filter(e => net.planInviteIds.has(e.messageId)).map(e => e.at), pa.limit, pa.periodDays);
  }
  let streakInterrupt = 0, blooio4th = 0;
  const outstanding = new Map<MemberId, number>();
  const timeline = [...msgs.map(x => ({ t: x.ts, id: x.memberId, out: true, pro: !!x.meta?.proactive })), ...[...inbound].flatMap(([id, ts]) => ts.map(t => ({ t, id, out: false, pro: false })))].sort((a, b) => (a.t - b.t) || (a.out ? 1 : -1));
  for (const e of timeline) {
    if (!e.out) { outstanding.set(e.id, 0); continue; }
    const k = outstanding.get(e.id) ?? 0;
    if (e.pro && k >= 2) streakInterrupt++;
    if (k >= 3) blooio4th++;
    outstanding.set(e.id, k + 1);
  }
  // Declared minors (claimed age < 18) in any plan role: must be 0. Age-lying minors (claim 18+) are
  // informational, as the judge's undisclosedMinorProposals: they need age verification, not matching.
  // Double-booked seats: a member with two meetings scheduled less than 3 hours apart (any kind).
  const seatsByMember = new Map<MemberId, number[]>();
  const seen = new Set<string>();
  for (const r of recs) if (r.type === "meeting_scheduled") for (const id of r.participants as MemberId[]) {
    if (seen.has(`${r.proposalId}|${id}`)) continue;
    seen.add(`${r.proposalId}|${id}`);
    seatsByMember.set(id, [...(seatsByMember.get(id) ?? []), r.at]);
  }
  let doubleBooked = 0;
  for (const xs of seatsByMember.values()) { xs.sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) if (xs[i]! - xs[i - 1]! < 3 * HOUR) doubleBooked++; }
  let minorsInPlans = net.planStats.minorsInPlans, undisclosedMinorsInPlans = 0;
  for (const l of net.live.values()) for (const id of new Set([...l.plan.invited, ...l.plan.alternates, ...(l.plan.hostId ? [l.plan.hostId] : []), ...Object.keys(l.run.answers)])) {
    const p = personas.get(id);
    if (!p || p.public.claimedAge < 18) minorsInPlans++;
    else if (p.hidden.trueAge < 18) undisclosedMinorsInPlans++;
  }
  const ps = net.planStats;
  return {
    seed, metWorth: metWorthPairs + metWorthPlans, metWorthPairs, metWorthPlans, planValueSeats,
    interruptions: am.interruptions, intPerMemberWeek: am.interruptionsPerMemberWeek, meetingsHeld, meetingsPerInterruption: am.interruptions ? meetingsHeld / am.interruptions : 0,
    metWorthPerInterruption: am.interruptions ? (metWorthPairs + metWorthPlans) / am.interruptions : 0,
    valueEvents: am.valueEvents, v14: am.v14, noValueShare: adults.length ? 1 - withValue.length / adults.length : 0,
    giniValue: gini(adults.map(id => vcount.get(id) ?? 0)), giniDelivered: gini(adults.map(id => deliveredTo.get(id) ?? 0)),
    firstValueFromPlan: withValue.length ? withValue.filter(id => first.get(id)!.plan).length / withValue.length : 0, membersWithValue: withValue.length,
    plans: ps.plans, probedPlans: ps.probedPlans.size, booked: ps.booked, quorumRate: ps.probedPlans.size ? ps.booked / ps.probedPlans.size : 0,
    confirmedSeats: ps.confirmedSeats, attendedSeats, planMeetings, planGood,
    minors: m.safety.minorContacts, minorsInPlans, undisclosedMinorsInPlans, leaks: m.privacy.canaryLeaks, nameLeaks: ps.probeNameLeaks, overStateCap, quietHours: m.invariants.byRule.quiet_hours ?? 0,
    checkInQuiet: ps.checkInQuiet, doubleBooked, overPlanAllowance, blooio4th, streakInterrupt, invariants: m.invariants.total, byRule: m.invariants.byRule,
    stats: {
      ...Object.fromEntries(Object.entries(ps).map(([k, x]) => [k, x instanceof Set ? x.size : x])), crews: net.crews.length, crewSessions: ps.crewSessions,
      invariantExamples: m.invariants.examples,
      dupBodies: (() => { const last = new Map<string, any>(), out: string[] = []; for (const x of msgs) { const l = last.get(x.memberId); if (l && l.body === x.body && x.ts - l.ts < 600_000) out.push(`${x.meta?.type}: ${x.body} [${l.meta?.proposalId} ${new Date(l.ts).toISOString()} | ${x.meta?.proposalId} ${new Date(x.ts).toISOString()}]`); last.set(x.memberId, x); } return out; })(), seatsUnavailable: mcount.unavailable, seats: mcount.seats, funnel: net.stats.funnel, dropped: net.stats.dropped,
    },
  };
}

// ------------------------------------------------------------------ tables
export interface VariantRow { name: string; seeds: SeedRow[] }
const sd = (xs: number[]) => { const mu = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1)); };
const avg = (rs: SeedRow[], k: keyof SeedRow) => mean(rs.map(r => r[k] as number));
const sum = (rs: SeedRow[], k: keyof SeedRow) => rs.reduce((s, r) => s + (r[k] as number), 0);
const st = (rs: SeedRow[], k: string) => mean(rs.map(r => Number((r.stats as any)?.[k] ?? 0)));
/** Paired difference vs the first row with the same `fixes` (same seeds): mean ± SE. */
function paired(r: VariantRow, base: VariantRow | undefined, k: keyof SeedRow, scale = 1, dp = 1): string {
  if (!base || base === r) return "";
  const d = r.seeds.map((s, i) => ((s[k] as number) - (base.seeds[i]![k] as number)) * scale);
  return ` (${mean(d) >= 0 ? "+" : ""}${mean(d).toFixed(dp)} ± ${(sd(d) / Math.sqrt(d.length)).toFixed(dp)})`;
}
export function summaryTables(rows: VariantRow[]): string {
  const baseOf = (r: VariantRow) => rows.find(x => x.name.startsWith(r.name.includes("without fixes") ? "B0" : "B ")) ;
  const value = rows.map(r => {
    const mw = r.seeds.map(s => s.metWorth);
    return [r.name, `${mean(mw).toFixed(1)} ± ${(sd(mw) / Math.sqrt(mw.length)).toFixed(1)}${paired(r, baseOf(r), "metWorth")}`, mw.join(" "),
      `${avg(r.seeds, "metWorthPairs").toFixed(1)} / ${avg(r.seeds, "metWorthPlans").toFixed(1)}`,
      `${pct(avg(r.seeds, "v14"))}${paired(r, baseOf(r), "v14", 100)}`, `${pct(avg(r.seeds, "noValueShare"))}${paired(r, baseOf(r), "noValueShare", 100)}`,
      avg(r.seeds, "giniValue").toFixed(3), avg(r.seeds, "intPerMemberWeek").toFixed(2), avg(r.seeds, "meetingsPerInterruption").toFixed(3), avg(r.seeds, "metWorthPerInterruption").toFixed(3)];
  });
  const plans = rows.filter(r => sum(r.seeds, "plans") > 0).map(r => {
    const conf = sum(r.seeds, "confirmedSeats"), att = sum(r.seeds, "attendedSeats"), probed = sum(r.seeds, "probedPlans");
    return [r.name, avg(r.seeds, "plans").toFixed(1), avg(r.seeds, "probedPlans").toFixed(1), `${pct(probed ? sum(r.seeds, "booked") / probed : NaN)}`,
      avg(r.seeds, "planMeetings").toFixed(1), `${pct(conf ? att / conf : NaN)}`, `${pct(sum(r.seeds, "planMeetings") ? sum(r.seeds, "planGood") / sum(r.seeds, "planMeetings") : NaN)}`,
      avg(r.seeds, "planValueSeats").toFixed(1), pct(avg(r.seeds, "firstValueFromPlan")),
      `${st(r.seeds, "partnerPlans").toFixed(1)} / ${st(r.seeds, "eventPlans").toFixed(1)}`, `${st(r.seeds, "crews").toFixed(2)} / ${st(r.seeds, "crewSessions").toFixed(2)}`];
  });
  const flow = rows.filter(r => sum(r.seeds, "plans") > 0).map(r => {
    const fb = (k: string) => mean(r.seeds.map(s => Number((s.stats as any)?.fallbacks?.[k] ?? 0))).toFixed(1);
    return [r.name, st(r.seeds, "planYes").toFixed(1), st(r.seeds, "planNo").toFixed(1), st(r.seeds, "cantMakeTime").toFixed(1), st(r.seeds, "backfills").toFixed(1), st(r.seeds, "joins").toFixed(1),
      `${fb("smaller")} / ${fb("solo_event")} / ${fb("next_week")} / ${fb("none")}`, st(r.seeds, "backouts").toFixed(1),
      `${st(r.seeds, "checkInsSent").toFixed(0)} / ${st(r.seeds, "checkInAnswers").toFixed(0)}`, `${st(r.seeds, "standingMembers").toFixed(0)} / ${st(r.seeds, "statedMembers").toFixed(0)} / ${st(r.seeds, "demandMembers").toFixed(0)} / ${st(r.seeds, "plannedMembers").toFixed(0)}`];
  });
  const inv = rows.map(r => [r.name, sum(r.seeds, "minors"), `${sum(r.seeds, "minorsInPlans")} / ${sum(r.seeds, "undisclosedMinorsInPlans")}`, `${sum(r.seeds, "leaks")} / ${sum(r.seeds, "nameLeaks")}`, `${sum(r.seeds, "overStateCap")} / ${sum(r.seeds, "overPlanAllowance")}`,
    `${sum(r.seeds, "quietHours")} / ${sum(r.seeds, "checkInQuiet")}`, sum(r.seeds, "streakInterrupt"), sum(r.seeds, "blooio4th"), sum(r.seeds, "doubleBooked"),
    `${sum(r.seeds, "invariants")} ${JSON.stringify(r.seeds.reduce((o, s) => { for (const [k, x] of Object.entries(s.byRule)) o[k] = (o[k] ?? 0) + (x as number); return o; }, {} as Record<string, number>))}`]);
  return [
    "### Value (mean over seeds ± SE; in brackets: paired difference vs the baseline with the same fixes, ± SE)\n",
    table(["variant", "met + worthwhile /seed", "per seed", "pairs / plans", "V14", "no-value share (adults)", "Gini (value events)", "interruptions /member/wk", "meetings /interruption", "met+worthwhile /interruption"], value),
    "\n### Plans\n",
    table(["variant", "plans proposed /seed", "plans probed /seed", "quorum rate (booked / probed)", "plan meetings /seed", "attendance (came / confirmed seats)", "plan precision (good / held)", "plan value seats /seed", "first value from a plan", "partner / event plans /seed", "crews / crew sessions /seed"], plans),
    "\n### Plan funnel and capture (per seed)\n",
    table(["variant", "probe yes", "probe no or silent", "of which can't make the time", "backfills", "late joins", "fallbacks smaller / solo event / next week / none", "back-outs after reveal", "check-ins sent / answered", "members: standing / stated / with a window / planned"], flow),
    "\n### Invariants (summed over seeds)\n",
    table(["variant", "minor contacts", "declared minors in plans (any role) / age-lying minors (informational)", "canary leaks / names in plan probes", "over intro (state) cap / over plan allowance", "quiet-hour sends (judge / check-ins)", "interruptions with >= 2 outstanding", "outbound with >= 3 outstanding", "double-booked seats (< 3h apart)", "judge invariants"], inv),
  ].join("\n");
}

if (import.meta.main) {
  const only = args.only ? new RegExp(args.only, "i") : undefined;
  const rows: VariantRow[] = [];
  for (const v of VARIANTS) {
    if (only && !only.test(v.name)) continue;
    const t0 = performance.now();
    const seeds: SeedRow[] = [];
    for (const s of SEEDS) seeds.push(await runSeed(v, s));
    rows.push({ name: v.name, seeds });
    process.stderr.write(`${v.name}: ${Math.round(performance.now() - t0)}ms\n`);
  }
  console.log(`## Simulator (seeds ${SEEDS.join(",")}, 150 personas, ${DAYS} days, engine-v1.2.0, ${DEFAULT_ATTENTION.version}, ${DEFAULT_PLANS.version} (${plansConfigHash(resolvePlans())}), v1.2 snapshot, history fed)\n\n${summaryTables(rows)}`);
  if (args.json) await Bun.write(args.json, JSON.stringify(rows, null, 1));
}
