#!/usr/bin/env bun
// Compare Networks on the NYC world (the 250 synthetic NYC members, plus friends they invite):
//   push baseline : StubNetwork + engine-v1 (what we had)
//   push v2       : ConsentNetwork with probes and gates off
//   consent       : ConsentNetwork (probes, selective gates, requests, safety, growth)
//   bun run packages/network/harness/experiment.ts --days 21 --seed 1 [--only consent] [--live-asks] [--time-aware] [--primed-met 0.96 --primed-partial 0.82]
// Consent arms use the simulated reviewer (review "auto"): every opportunity is still queued and
// approved before any member is contacted, so the run log shows the review step.
// --live-asks: personas ask only for wants that are still live in hidden truth (sim PolicyOptions).
// --time-aware: personas answer offered times and booked plans from a hidden week, and attendance
// depends on the meeting time (sim PolicyOptions.timeAware and WorldOptions.timeAware).
// --plans off: the Network's planner and plan lane off (default on). --sim-plans on|off: personas
// answer plan probes, the weekly check-in and crew offers, and plan meetings use the plan oracle
// (sim WorldOptions.plans); default on when the Network runs plans. --capital: an NC ledger records
// every event and the Network reads the levers from it (default: events are counted, levers off).
// Every arm reports the judge's scores (computeMetrics) too, so the Observatory lab can call this.
import { parseArgs } from "node:util";
import { DAY } from "@thenetwork/core";
import { computeMetrics, type RunRecord } from "@thenetwork/judge";
import { PolicyPersonaAgent, PRIMED_MODEL, StubNetwork, World, type NetworkUnderTest, type Persona } from "@thenetwork/sim";
import { loadPersonas } from "../../../scripts/synthetic/load.ts";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { createEngine } from "../../sim/engines/engine-v1.ts";
import { friendFactory } from "./growth.ts";
import { ConsentNetwork, type NetworkOptions } from "../src/network.ts";
import { capitalWiring } from "../src/capital.ts";
import { OUTREACH } from "../src/outreach.ts";

export interface ArmResult {
  arm: string; days: number; members: number; joinedEnd: number;
  proposals: number; invitations: number; inviteYes: number; inviteAcceptRate: number;
  proposalsAllYes: number; proposalAllYesRate: number; meetingsHeld: number; meanEnjoyment: number; enjoyedShare: number;
  precision: number; unsafe: number; proactivePerMemberWeek: number; optOuts: number;
  probes?: number; probeYesRate?: number; requests?: number; requestFulfillRate?: number; requestMedianHours?: number | null;
  abuseHandled?: number; holds?: number; adversarialInProposals: number; invitesSent?: number; newMembersJoined: number;
  /** Honest members wrongly flagged / restricted (must be 0) and bad actors caught. */
  falseFlags?: number; falseRestricted?: number; adversariesRestricted?: string;
  gate?: Record<string, number>; counters?: Record<string, number>;
  /** Plans v1.1 (consent arms): the Network's plan counters and the checks on plan sends (all must hold). */
  plans?: Record<string, number> & {
    planMeetingsHeld: number; planMeetingsEnjoyed: number; maxPlanInvites7d: number; maxIntroInvites7d: number;
    namesBeforeBooking: number; minorsInPlans: number; revealsBeforeQuorum: number;
  };
  /** Network capital: ledger events emitted by type, and (with --capital) the ledger's entries and rejected events. */
  capital?: { events: Record<string, number>; entries?: number; rejected?: number; members?: number; fraudQueued?: number };
  /** The judge on the same records (computeMetrics): safety gates that must stay 0. */
  judge: { invariants: number; byRule: Record<string, number>; canaryLeaks: number; minorContacts: number };
  /**
   * PRD 28.2 scorecard proxies from the simulated run: worthwhile-interruption rate (persona-judged
   * initial invites), opt-in (probe yes rate), completion (show rate of booked seats), and the share
   * of members who joined in the first week with a first good meeting within 14 days of joining.
   */
  scorecard: { worthwhile: number; optIn: number | null; completion: number; firstOutcome14d: number };
}

export async function nycPersonas(dir = DATA_DIR): Promise<Persona[]> {
  return (await loadPersonas(dir)).filter(p => p.homeCity === "nyc");
}

export async function runArm(arm: "push_baseline" | "push_v2" | "consent", o: { days: number; seed: number; network?: NetworkOptions; liveAsks?: boolean; timeAware?: boolean; simPlans?: boolean; capital?: boolean }): Promise<ArmResult> {
  const personas = await nycPersonas();
  const manifest = await Bun.file(`${DATA_DIR}/manifest.json`).json();
  const start = manifest.snapshotNow as number;
  const cap = arm === "consent" && o.capital ? capitalWiring() : undefined;
  const consent = arm === "push_baseline" ? undefined : new ConsentNetwork({
    seed: o.seed, review: "auto", ...(arm === "push_v2" ? { probes: false, selective: false, growth: false, plans: false } : {}), ...o.network,
    ...(cap ? { onLedger: cap.onLedger, capital: cap.capital } : {}),
  });
  const simPlans = o.simPlans ?? (arm === "consent" && o.network?.plans !== false);
  const network: NetworkUnderTest = consent ?? new StubNetwork({ seed: o.seed, randomIntros: false });
  const records: RunRecord[] = [];
  const w = new World({
    seed: o.seed, personas, days: o.days, start, writeLog: false, network, agent: new PolicyPersonaAgent(start, { liveAsksOnly: o.liveAsks ?? false, ...(o.timeAware ? { timeAware: true } : {}), ...(simPlans ? { plans: true } : {}) }),
    ...(o.timeAware ? { timeAware: true } : {}), ...(simPlans ? { plans: true } : {}),
    engine: consent ? undefined : wrapNycOnly(createEngine()), spawnFriend: friendFactory({ seed: o.seed }), onRecord: r => records.push(r),
  });
  await w.begin();
  await w.advanceTo(w.end);
  await w.complete();
  const res = summarize(arm, o.days, records, w, consent);
  if (consent) res.capital = { events: { ...consent.ledgerCounts }, ...(cap ? { entries: cap.ledger.all().length, rejected: cap.rejected(), fraudQueued: consent.fraudItems().length } : {}) };
  return res;
}

function wrapNycOnly(e: ReturnType<typeof createEngine>) {
  return { name: e.name, propose: (s: Parameters<typeof e.propose>[0], opts?: Parameters<typeof e.propose>[1]) => (opts?.city === "sf" ? [] : e.propose(s, opts)) };
}

export function summarize(arm: string, days: number, records: RunRecord[], w: World, consent?: ConsentNetwork): ArmResult {
  const personas = new Map(w.personaList().map(p => [p.id, p]));
  const props = records.filter((r): r is Extract<RunRecord, { type: "proposal" }> => r.type === "proposal" && r.source !== "scenario");
  const propIds = new Set(props.map(p => p.proposal.id));
  // Invitations = proposal messages; yes = decisions to accept them.
  const invites = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.type === "proposal" && propIds.has(String(r.msg.meta?.proposalId)));
  const decisions = records.filter((r): r is Extract<RunRecord, { type: "decision" }> => r.type === "decision" && r.messageType === "proposal" && !!r.proposalId && propIds.has(r.proposalId));
  const yesBy = new Map<string, Set<string>>(), noBy = new Map<string, Set<string>>();
  // A booked plan (the reveal with an opt-out) counts the member's own decision: silence is a yes,
  // a decliner who stays silent is still a no. Other invitations count the words they sent.
  const bookedMsgs = new Set(invites.filter(r => r.type === "message" && r.msg.meta?.booked).map(r => (r as Extract<RunRecord, { type: "message" }>).msg.id));
  for (const d of decisions) {
    const said = bookedMsgs.has(d.messageId) && d.decision && d.decision !== "none" ? d.decision : d.intent;
    const m = said === "accept" || said === "counter" ? yesBy : said === "decline" || said === "booked_cancel" ? noBy : undefined;
    if (!m) continue;
    if (!m.has(d.proposalId!)) m.set(d.proposalId!, new Set());
    m.get(d.proposalId!)!.add(d.memberId);
  }
  const inviteYes = [...yesBy.values()].reduce((s, x) => s + x.size, 0);
  // A proposal is "all yes" when every invited participant accepted (groups: at least 3 and nobody declined... we count strict all-yes).
  let allYes = 0;
  for (const p of props) {
    const invited = new Set(invites.filter(r => r.type === "message" && r.msg.meta?.proposalId === p.proposal.id).map(r => (r as any).msg.memberId as string));
    if (invited.size >= 2 && [...invited].every(id => yesBy.get(p.proposal.id)?.has(id))) allYes++;
  }
  const outcomes = records.filter((r): r is Extract<RunRecord, { type: "outcome" }> => r.type === "outcome");
  let held = 0, enjSum = 0, enjN = 0, enjoyed = 0;
  for (const o of outcomes) {
    const showed = Object.values(o.attendance).filter(a => a.showed);
    if (showed.length < 2) continue;
    held++;
    for (const a of showed) { enjSum += a.enjoyment; enjN++; }
    if (Math.min(...showed.map(a => a.enjoyment)) >= 0.6) enjoyed++;
  }
  const compatible = props.filter(p => p.oracle.compatible).length;
  const unsafe = props.filter(p => p.oracle.unsafe).length;
  const adversarialIn = props.filter(p => p.proposal.participants.some(id => personas.get(id)?.hidden.adversarial)).length;
  const proactive = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proactive && r.msg.status === "delivered").length;
  const joined = records.filter(r => r.type === "join").length;
  const initial = new Set(records.filter(r => r.type === "persona" && r.persona.joinDay <= 0).map(r => (r as any).persona.id));
  const newJoined = records.filter(r => r.type === "join" && !initial.has(r.memberId)).length;
  const optOuts = records.filter(r => r.type === "opt_out").length;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const res: ArmResult = {
    arm, days, members: personas.size, joinedEnd: joined,
    proposals: props.length, invitations: invites.length, inviteYes, inviteAcceptRate: r3(inviteYes / Math.max(1, invites.length)),
    proposalsAllYes: allYes, proposalAllYesRate: r3(allYes / Math.max(1, props.length)),
    meetingsHeld: held, meanEnjoyment: r3(enjSum / Math.max(1, enjN)), enjoyedShare: r3(enjoyed / Math.max(1, held)),
    precision: r3(compatible / Math.max(1, props.length)), unsafe, adversarialInProposals: adversarialIn,
    proactivePerMemberWeek: r3(proactive / Math.max(1, joined) / (days / 7)), optOuts, newMembersJoined: newJoined,
    judge: { invariants: 0, byRule: {}, canaryLeaks: 0, minorContacts: 0 }, scorecard: { worthwhile: 0, optIn: null, completion: 0, firstOutcome14d: 0 },
  };
  const jm = computeMetrics(records, consent ? { weeklyBudget: OUTREACH.maxPerWeek } : {});
  res.judge = { invariants: jm.invariants.total, byRule: jm.invariants.byRule, canaryLeaks: jm.privacy.canaryLeaks, minorContacts: jm.safety.minorContacts };
  const joinAt = new Map(records.filter((r): r is Extract<RunRecord, { type: "join" }> => r.type === "join").map(r => [r.memberId, r.t]));
  const runStart = records.find(r => r.type === "run_start")?.t ?? 0;
  const firstGood = new Map<string, number>();
  for (const o of outcomes) for (const [id, a] of Object.entries(o.attendance)) if (a.showed && a.enjoyment >= 0.6 && !firstGood.has(id)) firstGood.set(id, o.at);
  const early = [...joinAt].filter(([, t]) => t - runStart <= 7 * DAY);
  res.scorecard = {
    worthwhile: jm.experience.worthwhileRate, optIn: null, completion: jm.meetings.showRate,
    firstOutcome14d: r3(early.filter(([id, t]) => (firstGood.get(id) ?? Infinity) - t <= 14 * DAY).length / Math.max(1, early.length)),
  };
  if (consent) {
    const c = consent.counters;
    const fulfilled = consent.requests.filter(r => r.kind === "people" && r.outcome === "fulfilled");
    const hours = fulfilled.map(r => (r.fulfilledAt! - r.at) / 3_600_000).sort((a, b) => a - b);
    const people = consent.requests.filter(r => r.kind === "people");
    res.scorecard.optIn = r3(c.probeYes / Math.max(1, c.probeYes + c.probeNo + c.probeExpired));
    Object.assign(res, {
      probes: c.probesSent, probeYesRate: res.scorecard.optIn,
      requests: people.length, requestFulfillRate: r3(fulfilled.length / Math.max(1, people.length)),
      requestMedianHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]!) : null,
      abuseHandled: c.abuse, holds: c.holds, invitesSent: c.invitesSent, gate: consent.gateReasons, counters: { ...c },
      falseFlags: records.filter(r => r.type === "network_log" && r.kind === "abuse" && !personas.get(String(r.detail.memberId))?.hidden.adversarial).length,
      falseRestricted: [...consent.trust.all()].filter(([id, t]) => t.level !== "ok" && !personas.get(id)?.hidden.adversarial && !t.events.some(e => e.kind === "block_abuse")).length,
      plans: planChecks(records, consent, personas),
      adversariesRestricted: (() => {
        const adv = [...personas.values()].filter(p => p.hidden.adversarial && ["spammer", "scammer", "harasser", "prompt_injector"].includes(p.hidden.adversarial) && records.some(r => r.type === "join" && r.memberId === p.id));
        return `${adv.filter(p => consent.trust.level(p.id) !== "ok").length}/${adv.length}`;
      })(),
    });
  }
  return res;
}

/**
 * Plans v1.1 checks on a run (judge-style; plans iteration 1, ask 10): no member under 18 in any plan
 * role, no other invitee named in a plan message before the plan was booked, reveals only after
 * quorum, at most 1 plan invite per member per 7 days on the plan allowance and the intro cap unchanged.
 */
export function planChecks(records: RunRecord[], consent: ConsentNetwork, personas: Map<string, Persona>): NonNullable<ArmResult["plans"]> {
  type Msg = Extract<RunRecord, { type: "message" }>;
  const out = records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "outbound" && r.msg.status === "delivered");
  const minor = (id: string) => { const p = personas.get(id); return !p || p.hidden.trueAge < 18 || p.public.claimedAge < 18; };
  const planOpps = [...consent.opps.values()].filter(o => o.plan);
  const minorsInPlans = planOpps.filter(o => [...o.participants, ...o.alternates, ...(o.plan!.hostId ? [o.plan!.hostId] : [])].some(minor)).length;
  // Names before booking: a plan probe that carries any other invitee's first or last name.
  const bookedAt = new Map<string, number>();
  for (const r of records) if (r.type === "network_log" && r.kind === "plan_booked") bookedAt.set(String(r.detail.oppId), r.t);
  let namesBeforeBooking = 0, revealsBeforeQuorum = 0;
  for (const m of out) {
    const meta = m.msg.meta as { type?: string; plan?: { planId: string }; proposalId?: string; booked?: unknown } | undefined;
    if (meta?.type === "plan_probe" && meta.plan) {
      const o = consent.opps.get(meta.plan.planId);
      const words = new Set(` ${m.msg.body.toLowerCase().replace(/[^\p{L}]+/gu, " ")} `.split(" ").filter(Boolean));
      for (const id of [...(o?.participants ?? []), ...(o?.alternates ?? [])]) if (id !== m.msg.memberId && (personas.get(id)?.name ?? "").toLowerCase().split(/\s+/).some(w => w.length >= 3 && words.has(w))) namesBeforeBooking++;
    }
    if (meta?.booked && meta.proposalId && consent.opps.get(meta.proposalId)?.plan && !(m.msg.ts >= (bookedAt.get(meta.proposalId) ?? Infinity))) revealsBeforeQuorum++;
  }
  const per = (pred: (m: Msg) => boolean) => {
    const by = new Map<string, number[]>();
    for (const m of out.filter(m => m.msg.meta?.proactive && pred(m))) by.set(m.msg.memberId, [...(by.get(m.msg.memberId) ?? []), m.msg.ts]);
    let max = 0;
    for (const ts of by.values()) for (const t of ts) max = Math.max(max, ts.filter(x => x > t - 7 * DAY && x <= t).length);
    return max;
  };
  const outcomes = records.filter((r): r is Extract<RunRecord, { type: "outcome" }> => r.type === "outcome" && !!consent.opps.get(r.proposalId)?.plan);
  const held = outcomes.filter(o => Object.values(o.attendance).filter(a => a.showed).length >= 2);
  const enjoyed = held.filter(o => { const s = Object.values(o.attendance).filter(a => a.showed); return Math.min(...s.map(a => a.enjoyment)) >= 0.5; });
  return {
    ...consent.plansCounters, planMeetingsHeld: held.length, planMeetingsEnjoyed: enjoyed.length,
    maxPlanInvites7d: per(m => !!m.msg.meta?.planInvite), maxIntroInvites7d: per(m => !m.msg.meta?.planInvite),
    namesBeforeBooking, minorsInPlans, revealsBeforeQuorum,
  };
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    days: { type: "string", default: "21" }, seed: { type: "string", default: "1" }, only: { type: "string" },
    "live-asks": { type: "boolean", default: false }, "time-aware": { type: "boolean", default: false },
    "primed-met": { type: "string" }, "primed-partial": { type: "string" }, "primed-identity": { type: "string" }, "max-new": { type: "string" },
    plans: { type: "string", default: "on" }, "sim-plans": { type: "string" }, capital: { type: "boolean", default: false },
  } });
  if (a["primed-met"]) PRIMED_MODEL.met = Number(a["primed-met"]);
  if (a["primed-partial"]) PRIMED_MODEL.partial = Number(a["primed-partial"]);
  if (a["primed-identity"]) PRIMED_MODEL.identity = Number(a["primed-identity"]);
  const arms = (a.only ? a.only.split(",") : ["push_baseline", "push_v2", "consent"]) as ("push_baseline" | "push_v2" | "consent")[];
  const out: ArmResult[] = [];
  for (const arm of arms) {
    const t0 = performance.now();
    const network: NetworkOptions = { ...(a["max-new"] ? { maxNewPerDay: Number(a["max-new"]) } : {}), ...(a.plans === "off" ? { plans: false } : {}) };
    const r = await runArm(arm, {
      days: Number(a.days), seed: Number(a.seed), liveAsks: a["live-asks"], timeAware: a["time-aware"], network, capital: a.capital,
      ...(a["sim-plans"] ? { simPlans: a["sim-plans"] === "on" } : {}),
    });
    out.push(r);
    process.stderr.write(`${arm}: ${Math.round(performance.now() - t0)}ms\n`);
  }
  console.log(JSON.stringify({ primedModel: PRIMED_MODEL, liveAsks: a["live-asks"], timeAware: a["time-aware"], plans: a.plans, simPlans: a["sim-plans"] ?? "default", capital: a.capital, results: out }, null, 2));
  process.exit(0);
}
