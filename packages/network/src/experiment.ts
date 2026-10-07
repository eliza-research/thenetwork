#!/usr/bin/env bun
// Compare Networks on the NYC world (the 250 synthetic NYC members, plus friends they invite):
//   push baseline : StubNetwork + engine-v1 (what we had)
//   push v2       : ConsentNetwork with probes and gates off
//   consent       : ConsentNetwork (probes, selective gates, requests, safety, growth)
//   bun run packages/network/src/experiment.ts --days 21 --seed 1 [--only consent] [--primed-met 0.96 --primed-partial 0.82]
import { parseArgs } from "node:util";
import { DAY } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { PolicyPersonaAgent, PRIMED_MODEL, StubNetwork, World, type NetworkUnderTest, type Persona } from "@thenetwork/sim";
import { loadPersonas } from "../../../scripts/synthetic/load.ts";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { createEngine } from "../../sim/engines/engine-v1.ts";
import { friendFactory } from "./growth.ts";
import { ConsentNetwork, type NetworkOptions } from "./network.ts";

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
}

export async function nycPersonas(dir = DATA_DIR): Promise<Persona[]> {
  return (await loadPersonas(dir)).filter(p => p.homeCity === "nyc");
}

export async function runArm(arm: "push_baseline" | "push_v2" | "consent", o: { days: number; seed: number; network?: NetworkOptions }): Promise<ArmResult> {
  const personas = await nycPersonas();
  const manifest = await Bun.file(`${DATA_DIR}/manifest.json`).json();
  const start = manifest.snapshotNow as number;
  const consent = arm === "push_baseline" ? undefined : new ConsentNetwork({
    seed: o.seed, ...(arm === "push_v2" ? { probes: false, selective: false, growth: false } : {}), ...o.network,
  });
  const network: NetworkUnderTest = consent ?? new StubNetwork({ seed: o.seed, randomIntros: false });
  const records: RunRecord[] = [];
  const w = new World({
    seed: o.seed, personas, days: o.days, start, writeLog: false, network, agent: new PolicyPersonaAgent(start),
    engine: consent ? undefined : wrapNycOnly(createEngine()), spawnFriend: friendFactory({ seed: o.seed }), onRecord: r => records.push(r),
  });
  await w.begin();
  await w.advanceTo(w.end);
  await w.complete();
  return summarize(arm, o.days, records, w, consent);
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
  for (const d of decisions) {
    const m = d.intent === "accept" || d.intent === "counter" ? yesBy : d.intent === "decline" ? noBy : undefined;
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
  };
  if (consent) {
    const c = consent.counters;
    const fulfilled = consent.requests.filter(r => r.kind === "people" && r.outcome === "fulfilled");
    const hours = fulfilled.map(r => (r.fulfilledAt! - r.at) / 3_600_000).sort((a, b) => a - b);
    const people = consent.requests.filter(r => r.kind === "people");
    Object.assign(res, {
      probes: c.probesSent, probeYesRate: r3(c.probeYes / Math.max(1, c.probeYes + c.probeNo + c.probeExpired)),
      requests: people.length, requestFulfillRate: r3(fulfilled.length / Math.max(1, people.length)),
      requestMedianHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]!) : null,
      abuseHandled: c.abuse, holds: c.holds, invitesSent: c.invitesSent, gate: consent.gateReasons, counters: { ...c },
      falseFlags: records.filter(r => r.type === "network_log" && r.kind === "abuse" && !personas.get(String(r.detail.memberId))?.hidden.adversarial).length,
      falseRestricted: [...consent.trust.all()].filter(([id, t]) => t.level !== "ok" && !personas.get(id)?.hidden.adversarial && !t.events.some(e => e.kind === "block_abuse")).length,
      adversariesRestricted: (() => {
        const adv = [...personas.values()].filter(p => p.hidden.adversarial && ["spammer", "scammer", "harasser", "prompt_injector"].includes(p.hidden.adversarial) && records.some(r => r.type === "join" && r.memberId === p.id));
        return `${adv.filter(p => consent.trust.level(p.id) !== "ok").length}/${adv.length}`;
      })(),
    });
  }
  return res;
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    days: { type: "string", default: "21" }, seed: { type: "string", default: "1" }, only: { type: "string" },
    "primed-met": { type: "string" }, "primed-partial": { type: "string" }, "primed-identity": { type: "string" }, "max-new": { type: "string" },
  } });
  if (a["primed-met"]) PRIMED_MODEL.met = Number(a["primed-met"]);
  if (a["primed-partial"]) PRIMED_MODEL.partial = Number(a["primed-partial"]);
  if (a["primed-identity"]) PRIMED_MODEL.identity = Number(a["primed-identity"]);
  const arms = (a.only ? a.only.split(",") : ["push_baseline", "push_v2", "consent"]) as ("push_baseline" | "push_v2" | "consent")[];
  const out: ArmResult[] = [];
  for (const arm of arms) {
    const t0 = performance.now();
    const r = await runArm(arm, { days: Number(a.days), seed: Number(a.seed), network: a["max-new"] ? { maxNewPerDay: Number(a["max-new"]) } : undefined });
    out.push(r);
    process.stderr.write(`${arm}: ${Math.round(performance.now() - t0)}ms\n`);
  }
  console.log(JSON.stringify({ primedModel: PRIMED_MODEL, results: out }, null, 2));
  process.exit(0);
}
