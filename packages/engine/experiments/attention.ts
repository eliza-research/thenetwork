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
import { Rng as SimRng, hash32 } from "../../sim/src/rng.ts";
import { SNAPSHOT_FEATURES } from "../../sim/src/snapshot.ts";
import { localParts as simLocalParts } from "../../sim/src/time.ts";
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
  /**
   * Iteration 2 simulator-fidelity fixes, harness only: (1) ask priming for probes (a member who
   * recently asked for this kind of thing answers a specific probe as they would a named invite,
   * `oracle.evaluatePrimed`); (2) outside-world items: public events matching a member's stated
   * interests go into digests, and whether the member acts on one is decided offline.
   */
  fixes?: boolean | { priming?: boolean; events?: boolean; eventsAlone?: boolean; attendance?: boolean };
  /** Iteration 3: run with the current attention defaults (rolling 12:00, ...). Older variants are pinned to the iteration-2 digest config (ITER2). */
  iter3?: boolean;
  /**
   * Iteration 4, HARNESS ONLY: warm mentions. Members consent to being mentioned as a mutual (and to
   * their connection being mentioned) with p = 0.7; `warmLift` = how much a "friend of <mutual>" probe
   * raises the yes probability, P' = P + lift x (1 - P) (the simulator's probe model has no warm effect; 0 = as is).
   */
  warm?: { lift: number };
  /** undefined = the sim's own StubNetwork (today). */
  net?: Omit<AttentionNetOptions, "seed" | "randomIntros" | "choose"> & { choose?: "oracle" | "first" };
}
/** D1: the engine supplies up to cap x items per message; the attention layer enforces the interruption cap. */
const SUPPLY = engineSupplyBudgets(resolveAttention());
const NAMED = { mode: "attention" as const, choose: "oracle" as const };
/** A+rules: today's dispatch (items go out as they arrive, one per message, no price) with every hard send-time rule. */
const RULES = { ...NAMED, cadence: "immediate" as const, capOnly: true, partnerAnyCap: true, attention: { maxItems: { open: 1, normal: 1, quiet: 1, receiving: 1 } } };
const BEST = { ...NAMED, lambdaScale: 0, partnerAnyCap: true }; // iteration-2 search base: (a) + (b)
/** The iteration-1/2 founder defaults for digest slots (D2: weekly Thursday 18:00, Open Tue + Thu, Quiet monthly). Pinned for every pre-iteration-3 variant. */
const ITER2: AttentionConfigInput = { digest: { days: { open: [2, 4], normal: [4], quiet: [4], receiving: [4], paused: [] }, period: { open: "week", normal: "week", quiet: "month", receiving: "week", paused: "week" }, hour: 18 } };
/**
 * Iteration 3: the founder's decisions 1-4 on top of the iteration-2 best (G-J4: rolling slot, no
 * price, acknowledgements folded, unpicked items requeued): learned send time from 12:00, a 6-hour
 * send window, consent-first probes for everything, partner probes inside the partner's send window
 * within their cap, only initial invites on the cap, and time options from availability capture.
 */
const N3 = { ...BEST, cadence: "rolling" as const, suppressAcks: true, requeueUnpicked: true, probes: true, sendTime: "learned" as const, sendWindowHours: 6, partnerAnyCap: false, partnerInWindow: true, timeOptions: true };
const FIX3 = { priming: true, events: true, attendance: true };
/** Iteration 4: cheaper probe-first. (a) parallel probes, (b) opt-out reveal (booked plan), (c) = time options + (b) (the probe's yes carries the time). */
const Q_A = { ...N3, parallelProbes: true };
const Q_B = { ...N3, timeOptions: false, revealOptOut: true };
const Q_C = { ...N3, revealOptOut: true };
const Q_AC = { ...N3, parallelProbes: true, revealOptOut: true };
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
  // ---- iteration 2 (named items unless "probes") ----
  { name: "R A+rules: today's dispatch with every hard send-time rule", net: RULES },
  { name: "I1 B, no price (λ = 0, quality bar kept)", cfg: SUPPLY, net: { ...NAMED, lambdaScale: 0 } },
  { name: "I2 B, half price (λ x 0.5)", cfg: SUPPLY, net: { ...NAMED, lambdaScale: 0.5 } },
  { name: "I3 I1 + partner probes on any remaining cap", cfg: SUPPLY, net: BEST },
  { name: "I4 I2 + partner probes on any remaining cap", cfg: SUPPLY, net: { ...NAMED, lambdaScale: 0.5, partnerAnyCap: true } },
  { name: "I5 I3, twice-weekly digest", cfg: SUPPLY, net: { ...BEST, cadence: "twice" } },
  { name: "I6 I3, rolling (daily slot when something clears the bar)", cfg: SUPPLY, net: { ...BEST, cadence: "rolling" } },
  { name: "I7 I3, immediate (as items arrive, up to 3 batched)", cfg: SUPPLY, net: { ...BEST, cadence: "immediate" } },
  { name: "I8 I6, acknowledgements folded", cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true } },
  { name: "I9 I6, acknowledgements exempt from the streak", cfg: SUPPLY, net: { ...BEST, cadence: "rolling", ackExempt: true } },
  { name: "I10 I8, learned cadence (D11)", cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, learnedCadence: true } },
  { name: "I11 I8, engine supply unchanged", net: { ...BEST, cadence: "rolling", suppressAcks: true } },
  { name: "J1 R + acknowledgements folded", net: { ...RULES, suppressAcks: true } },
  { name: "J2 R + acknowledgements exempt from the streak", net: { ...RULES, ackExempt: true } },
  { name: "J3 I9 + unpicked items go back to the hold queue", cfg: SUPPLY, net: { ...BEST, cadence: "rolling", ackExempt: true, requeueUnpicked: true } },
  { name: "J4 I8 + unpicked items go back to the hold queue", cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  { name: "J5 immediate menus, no price, partner any cap, acks folded, requeue", cfg: SUPPLY, net: { ...BEST, cadence: "immediate", suppressAcks: true, requeueUnpicked: true } },
  { name: "F-J1 J1, fixes", fixes: true, net: { ...RULES, suppressAcks: true } },
  { name: "F-J4 J4, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  { name: "F-J4p J4 + consent-first probes, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, requeueUnpicked: true, probes: true } },
  { name: "F-J1p J1 + consent-first probes, fixes", fixes: true, net: { ...RULES, suppressAcks: true, probes: true } },
  // ---- the two fixes separately; events only as companions of a people item ----
  { name: "P-Rp A+rules with probes, priming fix only", fixes: { priming: true }, net: { ...RULES, probes: true } },
  { name: "P-J1p J1 + probes, priming fix only", fixes: { priming: true }, net: { ...RULES, suppressAcks: true, probes: true } },
  { name: "P-C C (probes), priming fix only", fixes: { priming: true }, cfg: SUPPLY, net: { mode: "attention", probes: true, choose: "oracle" } },
  { name: "P-I8p I8 + probes, priming fix only", fixes: { priming: true }, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, probes: true } },
  { name: "G-B B, both fixes, events only with a people item", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { mode: "attention", choose: "oracle" } },
  { name: "G-I8 I8, both fixes, events only with a people item", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true } },
  { name: "G-I8p I8 + probes, both fixes, events only with a people item", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, probes: true } },
  { name: "G-J4 J4, both fixes, events only with a people item", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  { name: "G-J4w G-J4 with the weekly Thursday digest (D2)", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, suppressAcks: true, requeueUnpicked: true } },
  { name: "G-J4λ G-J4 with the doc's shadow price", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, lambdaScale: 1, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  { name: "G-J4b G-J4 with partner probes on break-ins only (D4)", fixes: { priming: true, events: true }, cfg: SUPPLY, net: { ...BEST, partnerAnyCap: false, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  // ---- with the simulator fixes (ask-primed probes, outside-world event items) ----
  { name: "F-A v1.2 defaults, fixes", fixes: true },
  { name: "F-R A+rules, fixes", fixes: true, net: RULES },
  { name: "F-Rp A+rules with consent-first probes, fixes", fixes: true, net: { ...RULES, probes: true } },
  { name: "F-B B, fixes", fixes: true, cfg: SUPPLY, net: { mode: "attention", choose: "oracle" } },
  { name: "F-C C (probes), fixes", fixes: true, cfg: SUPPLY, net: { mode: "attention", probes: true, choose: "oracle" } },
  { name: "F-I3 I3, fixes", fixes: true, cfg: SUPPLY, net: BEST },
  { name: "F-I6 I6, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling" } },
  { name: "F-I8 I8, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true } },
  { name: "F-I8p I8 + consent-first probes, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, probes: true } },
  { name: "F-I10p I10 + consent-first probes, fixes", fixes: true, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, learnedCadence: true, probes: true } },
  // ---- iteration 3: founder decisions 1-4 ----
  { name: "N3 new defaults (decisions 1-4)", iter3: true, cfg: SUPPLY, net: N3 },
  { name: "N3na N3, availability capture off", iter3: true, cfg: SUPPLY, net: { ...N3, timeOptions: false } },
  { name: "H-R R, fixes 1-3", fixes: FIX3, net: RULES },
  { name: "H-J4 G-J4, fixes 1-3", fixes: FIX3, cfg: SUPPLY, net: { ...BEST, cadence: "rolling", suppressAcks: true, requeueUnpicked: true } },
  { name: "H-N3 N3, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: N3 },
  { name: "H-N3na N3, availability capture off, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: { ...N3, timeOptions: false } },
  { name: "H-N3f12 N3, fixed 12:00 send time (no learning), fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: { ...N3, sendTime: "fixed" } },
  { name: "H-N3f18 N3, fixed 18:00 send time, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: { ...N3, sendTime: "fixed", attention: { digest: { hour: 18 } } } },
  { name: "H-N3n N3 with named invites (no probes, so no time options), fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: { ...N3, probes: false } },
  { name: "H-N3λ N3 with the doc's shadow price, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: { ...N3, lambdaScale: 1 } },
  // ---- iteration 4: cheaper probe-first (anonymous until both say yes) ----
  { name: "Q-a N3 + parallel probes", iter3: true, cfg: SUPPLY, net: Q_A },
  { name: "Q-b N3 + opt-out reveal, no time options (time inferred)", iter3: true, cfg: SUPPLY, net: Q_B },
  { name: "Q-c N3 + opt-out reveal on the picked time (pre-commit)", iter3: true, cfg: SUPPLY, net: Q_C },
  { name: "Q-ac parallel + pre-commit", iter3: true, cfg: SUPPLY, net: Q_AC },
  { name: "Q-acw Q-ac + warm mentions (lift 0.3)", iter3: true, cfg: SUPPLY, net: Q_AC, warm: { lift: 0.3 } },
  { name: "Q-acw0 Q-ac + warm mentions (no lift)", iter3: true, cfg: SUPPLY, net: Q_AC, warm: { lift: 0 } },
  { name: "HQ-a N3 + parallel probes, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_A },
  { name: "HQ-b N3 + opt-out reveal, no time options, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_B },
  { name: "HQ-c N3 + pre-commit, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_C },
  { name: "HQ-ac parallel + pre-commit, fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_AC },
  { name: "HQ-acw HQ-ac + warm mentions (lift 0.3), fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_AC, warm: { lift: 0.3 } },
  { name: "HQ-acw0 HQ-ac + warm mentions (no lift), fixes 1-3", iter3: true, fixes: FIX3, cfg: SUPPLY, net: Q_AC, warm: { lift: 0 } },
];

// ------------------------------------------------------------------ per-seed run and metrics
export interface SeedRow {
  seed: number; proposals: number; precisionAll: number; delivered: number; precisionDelivered: number;
  metWorth: number; interruptions: number; interruptionsPerMemberWeek: number; itemsPerInterruption: number;
  valueEvents: number; valuePerInterruption: number; metWorthPerInterruption: number; unansweredRate: number;
  autoPausePer100MemberMonths: number; stops: number; stopPer1000: number; ttvMedian: number | null; v14: number;
  zeroAll: number; zeroDelivered: number; giniAll: number; giniDelivered: number; worthwhile: number;
  minors: number; leaks: number; invariants: number; byRule: Record<string, number>;
  overStateCap: number; quietHours: number; streakInterrupt: number; blooio4th: number; eventValues: number;
  /** Iteration 3: meetings scheduled, and participant-meetings at a time the participant was not (hidden) free. */
  meetings?: number; meetingSeats?: number; seatsUnavailable?: number;
  /** Iteration 4: reveals sent, and reveal recipients whose decision on the named plan was no (learned who, then backed out, said so or not). */
  reveals?: number; revealDeclines?: number;
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

/**
 * Fix 1 (harness only): `oracle.probe` with the same ask priming named invites get. A persona that
 * asked for this category in the last 7 days (its memory's "ask" signals) answers a specific probe
 * with `evaluatePrimed(..., "ask")`, as `decideProposal` does for a named proposal.
 */
function primeProbes(world: SimWorld, seed: number) {
  const W = world as any;
  const oracle = world.oracle;
  const orig = oracle.probe.bind(oracle);
  oracle.probe = (id, q) => {
    const now = world.clock.now();
    const mem = W.memories.get(id);
    const asked = (mem?.signals ?? []).some((sg: any) => sg.source === "ask" && sg.category === q.category && now - sg.at < 7 * DAY);
    if (!asked || !q.participants || q.participants.length < 2) return orig(id, q);
    const v = oracle.evaluatePrimed({ id: `probe:${q.key}`, kind: q.kind ?? "intro", participants: q.participants, city: q.city, window: { start: q.at, end: q.at }, category: q.category }, { [id]: "ask" });
    const yesProb = v.participants[id]?.acceptProb ?? 0;
    return { yesProb, yes: new SimRng(hash32(seed, "probe-primed", q.key, id)).next() < yesProb };
  };
}
/**
 * Fix 2 (harness only): does the member act on an event suggestion? P = (spare capacity x fatigue x
 * appetite for events x presence, `oracle.probe` without participants) x (1 if the event's tag is a
 * hidden interest, else 0.2) x (1 - the member's ignore probability: an unread text is not acted on).
 */
function eventActor(get: () => SimWorld, seed: number) {
  return (memberId: MemberId, ev: { id: string; city: string; start: number; tags: string[] }) => {
    const o = get().oracle;
    const p = o.persona(memberId);
    if (!p) return false;
    const r = o.probe(memberId, { key: `ev:${ev.id}`, category: "events", city: ev.city as any, at: ev.start });
    const like = ev.tags.some(t => p.hidden.interests.includes(t)) ? 1 : 0.2;
    const pr = r.yesProb * like * (1 - p.hidden.responsiveness.ignoreProb);
    return new SimRng(hash32(seed, "act", ev.id, memberId)).next() < pr;
  };
}

/**
 * HARNESS ONLY (iteration 3): hidden weekly availability from the persona's routine. A 2-hour slot
 * starting at t is free when it is between waking + 1h and bedtime; not on a day with a one-off
 * commitment (p = 0.15 per day); evenings (from 17:00): the persona's free evenings, plus 30% of
 * other weekend evenings; weekday daytime: outside the routine's busy blocks (work, school run) and
 * then half the time; weekend daytime: 60%. Draws are keyed by (seed, member, local date, part), so
 * the same slot is always free or always busy. Not visible to the engine or the Network.
 */
export function hiddenAvailability(get: () => SimWorld, seed: number) {
  return (id: MemberId, t: number): boolean => {
    const p = get().oracle.persona(id);
    if (!p) return false;
    const lp = simLocalParts(t, p.homeCity);
    const h = lp.hour + lp.minute / 60, d = lp.weekday;
    const { wake, sleep, busyBlocks, freeEvenings } = p.routine;
    const bed = sleep < 12 ? sleep + 24 : sleep;
    if (h < wake + 1 || h + 2 > bed) return false;
    const key = `${lp.year}-${lp.month}-${lp.day}`;
    const draw = (tag: string) => new SimRng(hash32(seed, "avail", tag, id, key)).next();
    if (draw("shock") < 0.15) return false;
    const weekend = d === 0 || d === 6;
    if (h >= 17) return freeEvenings.includes(d) || (weekend && draw("weekend-evening") < 0.3);
    if (!weekend) return !busyBlocks.some(([a, b]) => h < b && h + 2 > a) && draw("weekday-day") < 0.5;
    return draw(h < 12 ? "weekend-am" : "weekend-pm") < 0.6;
  };
}

/**
 * Fix 3 (harness only): time-dependent attendance. When a meeting is set at a time a participant is
 * not free (hiddenAvailability), they do not come with p = 0.7 (the other 30% rearrange). In the sim
 * without this fix the meeting time has no effect on attendance at all. Also counts, in every arm,
 * participant-meetings set at a time the participant was not free.
 */
function timeDependentAttendance(world: SimWorld, seed: number, free: (id: MemberId, t: number) => boolean, apply: boolean, counts: { meetings: number; seats: number; unavailable: number }) {
  const W = world as any;
  const orig = W.scheduleMeeting.bind(W);
  const seen = new Set<string>();
  W.scheduleMeeting = (m: { proposalId: string; participants: MemberId[]; at: number }) => {
    const id = orig(m);
    if (!seen.has(m.proposalId)) { seen.add(m.proposalId); counts.meetings++; }
    for (const pid of m.participants) {
      const k = `${m.proposalId}|${pid}`;
      if (seen.has(k)) continue;
      seen.add(k);
      counts.seats++;
      if (free(pid, m.at)) continue;
      counts.unavailable++;
      const pr = W.memories.get(pid)?.proposals?.[m.proposalId];
      if (apply && pr?.plannedShow && new SimRng(hash32(seed, "unavailable", m.proposalId, pid)).next() < 0.7) pr.plannedShow = false;
    }
    return id;
  };
}

/**
 * Iteration 4, HARNESS ONLY: a probe that named a consenting mutual ("a friend of Sam") is answered
 * yes with P' = P + lift x (1 - P). Wraps oracle.probe (after primeProbes).
 */
function warmProbes(world: SimWorld, net: () => AttentionNetwork | undefined, lift: number) {
  if (!lift) return;
  const oracle = world.oracle;
  const orig = oracle.probe.bind(oracle);
  oracle.probe = (id, q) => {
    const r = orig(id, q);
    if (!net()?.warmMentioned.has(`${q.key}|${id}`)) return r;
    const yesProb = r.yesProb + lift * (1 - r.yesProb);
    return { yesProb, yes: r.yes || new SimRng(hash32(seed0, "warm", q.key, id)).next() < (yesProb - r.yesProb) / Math.max(1e-9, 1 - r.yesProb) };
  };
}
let seed0 = 0;

export async function runSeed(v: Variant, seed: number): Promise<SeedRow> {
  seed0 = seed;
  const fx: { priming?: boolean; events?: boolean; eventsAlone?: boolean; attendance?: boolean } = v.fixes === true ? { priming: true, events: true, eventsAlone: true } : v.fixes ? { eventsAlone: false, ...v.fixes } : {};
  let world!: SimWorld;
  let net: AttentionNetwork | undefined;
  const free = hiddenAvailability(() => world, seed);
  const mcount = { meetings: 0, seats: 0, unavailable: 0 };
  // Pre-iteration-3 variants keep the iteration-2 digest config (the defaults moved to rolling 12:00).
  const attention = v.net && !v.iter3 ? { ...ITER2, ...(v.net.attention ?? {}) } : v.net?.attention;
  const res = await runSim({
    seed, cfg: v.cfg ?? {}, keepTraces: false, snapshot: { features: SNAPSHOT_FEATURES, records: true, asks: true },
    network: v.net ? s => (net = new AttentionNetwork({
      seed: s, randomIntros: false, ...v.net!,
      choose: v.net!.choose === "oracle" ? oracleChooser(() => world) : undefined,
      ...(attention ? { attention } : {}),
      ...(fx.events && v.net!.mode === "attention" ? { outsideWorld: true, actOnEvent: eventActor(() => world, seed), eventsAlone: fx.eventsAlone } : {}),
      ...(v.warm ? { warmConsent: (id: MemberId) => new SimRng(hash32(seed, "warm-consent", id)).next() < 0.7 } : {}),
      ...(v.net!.timeOptions ? {
        hiddenFree: free,
        connectsCalendar: (id: MemberId) => new SimRng(hash32(seed, "calendar", id)).next() < 0.5,
        calendarShowsBusy: (id: MemberId, t: number) => new SimRng(hash32(seed, "calendar-recall", id, t)).next() < 0.85,
      } : {}),
    })) : undefined,
    onWorld: w => { world = w; if (fx.priming) primeProbes(w, seed); if (v.warm) warmProbes(w, () => net, v.warm.lift); timeDependentAttendance(w, seed, free, !!fx.attendance, mcount); },
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
      for (const pid of items.filter(i => !String(i).startsWith("ev:"))) { delivered.add(pid); deliveredTo.set(x.memberId, (deliveredTo.get(x.memberId) ?? 0) + 1); }
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
  const values: A.ValueEvent[] = [...(net?.stats.eventValues ?? [])];
  const eventValues = net?.stats.eventValues.length ?? 0;
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
    overStateCap, quietHours: m.invariants.byRule.quiet_hours ?? 0, streakInterrupt, blooio4th, eventValues,
    meetings: mcount.meetings, meetingSeats: mcount.seats, seatsUnavailable: mcount.unavailable,
    ...(() => {
      const revealIds = new Set(msgs.filter(x => x.meta?.reveal).map(x => x.id));
      const ds = recs.filter(r => r.type === "decision" && revealIds.has(r.messageId));
      return { reveals: revealIds.size, revealDeclines: ds.filter(r => r.decision === "decline").length };
    })(),
    stats: net ? { ...net.stats, shownTo: undefined, shown: undefined, sendHourMembers: undefined, autoPauses: net.stats.autoPauses.length, ledger: net.ledger.length } : undefined,
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
      (avg(r.seeds, "ttvMedian") || NaN).toFixed(1), (avg(r.seeds, "eventValues") || 0).toFixed(1)];
  });
  const annoy = rows.map(r => [r.name, pct(avg(r.seeds, "unansweredRate")), avg(r.seeds, "autoPausePer100MemberMonths").toFixed(1), `${sum(r.seeds, "stops")} (${avg(r.seeds, "stopPer1000").toFixed(1)})`, pct(avg(r.seeds, "worthwhile"))]);
  const match = rows.map(r => [r.name, avg(r.seeds, "proposals").toFixed(0), pct(avg(r.seeds, "precisionAll")), avg(r.seeds, "delivered").toFixed(0), pct(avg(r.seeds, "precisionDelivered")),
    `${pct(avg(r.seeds, "zeroAll"))} / ${pct(avg(r.seeds, "zeroDelivered"))}`, `${avg(r.seeds, "giniAll").toFixed(3)} / ${avg(r.seeds, "giniDelivered").toFixed(3)}`]);
  const inv = rows.map(r => [r.name, sum(r.seeds, "minors"), sum(r.seeds, "leaks"), sum(r.seeds, "overStateCap"), sum(r.seeds, "quietHours"), sum(r.seeds, "streakInterrupt"), sum(r.seeds, "blooio4th"),
    `${sum(r.seeds, "invariants")} ${JSON.stringify(r.seeds.reduce((o, s) => { for (const [k, v] of Object.entries(s.byRule)) o[k] = (o[k] ?? 0) + (v as number); return o; }, {} as Record<string, number>))}`]);
  return [
    "### Value and interruptions (mean over seeds; met + worthwhile ± standard error)\n",
    table(["variant", "met + worthwhile /seed", "per seed", "interruptions /member/wk", "items /interruption", "met+worthwhile /interruption", "value events /interruption", "V14", "time to value (median days)", "event value events /seed"], value),
    "\n### Annoyance\n",
    table(["variant", "unanswered rate (72h)", "auto-pause /100 member-months", "STOP total (per 1,000 interruptions)", "persona worthwhile"], annoy),
    "\n### Match quality and spread (engine proposals / items actually delivered)\n",
    table(["variant", "engine proposals /seed", "precision (all proposals)", "proposals delivered /seed", "precision (delivered)", "no proposal: all / delivered", "Gini: all / delivered"], match),
    "\n### Meetings and time (iteration 3; hidden availability, harness only)\n",
    table(["variant", "meetings scheduled /seed", "seats at a time the member was not free", "probes with time options /seed", "no option fit (share of picks)", "meetings at a picked time /seed", "calendars connected /seed", "members whose send time moved /seed"], rows.map(r => {
      const st = (k: string) => mean(r.seeds.map(x => Number((x.stats as any)?.[k] ?? 0)));
      const seats = sum(r.seeds, "meetingSeats" as keyof SeedRow), un = sum(r.seeds, "seatsUnavailable" as keyof SeedRow);
      const picks = st("optionPicked") + st("optionNoneFit");
      return [r.name, (avg(r.seeds, "meetings" as keyof SeedRow) || 0).toFixed(1), seats ? pct(un / seats) : "-", st("probesWithOptions").toFixed(0), picks ? pct(st("optionNoneFit") / picks) : "-", st("timedMeetings").toFixed(1), st("calendarsConnected").toFixed(1), st("sendHourMoved").toFixed(0)];
    })),
    "\n### Consent-first cost and privacy (iteration 4)\n",
    table(["variant", "initial invites per meeting", "invites wasted /seed (opportunity died on the other's no or silence)", "of which the member had said yes", "reveals /seed", "learned who, then said no (share of reveals)", "explicit back-outs after an opt-out reveal /seed", "probes naming a mutual /seed"], rows.map(r => {
      const st = (k: string) => mean(r.seeds.map(x => Number((x.stats as any)?.[k] ?? 0)));
      const meet = avg(r.seeds, "meetings" as keyof SeedRow) || 0;
      const rv = sum(r.seeds, "reveals" as keyof SeedRow), rd = sum(r.seeds, "revealDeclines" as keyof SeedRow);
      return [r.name, meet ? (avg(r.seeds, "interruptions") / meet).toFixed(1) : "-", st("wastedInvites").toFixed(1), st("wastedYes").toFixed(1), (rv / r.seeds.length).toFixed(1), rv ? pct(rd / rv) : "-", st("backouts").toFixed(1), st("warmProbes").toFixed(1)];
    })),
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
