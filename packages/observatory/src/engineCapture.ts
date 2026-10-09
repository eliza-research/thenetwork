// engine-v1 for the observatory: the same runEngine the simulator adapter uses, but every run's
// MatchingRunLog is summarized for the run inspector (funnel, generators, rejections, fairness,
// top configurations and why they lost) and each proposal is linked to its run.
import { isMinor, validAge, type City, type MemberId, type WorldSnapshot } from "@thenetwork/core";
import { runEngine, type EngineInput, type EngineProposal, type MatchingRunLog } from "@thenetwork/engine";
import { appWiring } from "../../network/service/packs.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { Engine } from "@thenetwork/core";
import type { EngineRunSummary } from "./types.ts";

const TOP_N = 30;

export function summarizeRun(log: MatchingRunLog, proposals: EngineProposal[], opts: { at: number; city?: City; wallMs: number; shadow?: boolean }): EngineRunSummary {
  const f = log.funnel;
  const chosen = new Set(proposals.map(p => [...p.participants].sort().join(",")));
  const top = [...log.scored].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, TOP_N).map(s => ({
    key: s.key, generator: s.generator, participants: s.participants as MemberId[], score: s.score, eligible: s.eligible,
    reason: s.reason, selected: chosen.has([...s.participants].sort().join(",")), components: s.components,
  }));
  const emptyStatesByReason: Record<string, number> = {};
  for (const e of log.emptyStates) emptyStatesByReason[e.reason] = (emptyStatesByReason[e.reason] ?? 0) + 1;
  const fair = log.fairness;
  return {
    id: `${opts.shadow ? "shadow-" : ""}${log.runId}${opts.city ? `-${opts.city}` : ""}`, at: opts.at, city: opts.city, engineVersion: log.engineVersion,
    proposals: proposals.length, wallMs: opts.wallMs, shadow: opts.shadow,
    funnel: {
      generated: f.generated, passedHardFilters: f.passedHardFilters, deduped: f.deduped, eligible: f.eligible,
      belowThreshold: f.belowThreshold, budgetSkips: f.budgetSkips, selected: f.selected, exploration: f.exploration, dealbreakers: f.dealbreakers,
    },
    byGenerator: { ...f.byGenerator }, proposalsByGenerator: { ...log.proposalsByGenerator }, rejectedBy: { ...f.rejectedBy },
    memberFunnel: { ...f.memberFunnel },
    fairness: {
      gini: fair.gini, top10Share: fair.top10Share, zeroExposureShare: fair.zeroExposureShare, newcomerCoverage: fair.newcomerCoverage,
      viableCoverage: fair.viableCoverage, lorenz: [...fair.lorenz], membersWithProposal: fair.membersWithProposal, eligibleMembers: fair.eligibleMembers,
    },
    emptyStates: log.emptyStates.length, emptyStatesByReason, timingsMs: { ...log.timingsMs }, top,
    proposalIds: proposals.map(p => p.id),
  };
}

/**
 * An app's engine input from a snapshot, as the Network builds it for a pack (ConsentNetwork.packInput):
 * adults only (a valid age of 18 or more), with everything about anyone else left out, then the pack's
 * own fields (AppHooks.engineInput). The Network also leaves out members with a minor signal; the
 * console's snapshot does not carry those, so its shadow runs are a little wider than production's.
 */
export function appEngineInput(snapshot: WorldSnapshot, app: AppId): EngineInput {
  const w = appWiring(app);
  const input = snapshot as unknown as EngineInput;
  if (!w.pack) return input;
  const adult = new Set(input.members.filter(m => validAge(m.age) && !isMinor(m.age)).map(m => m.id));
  const both = (a: MemberId, b: MemberId) => adult.has(a) && adult.has(b);
  const out: EngineInput = {
    ...input, members: input.members.filter(m => adult.has(m.id)), facets: input.facets.filter(f => adult.has(f.memberId)),
    intents: input.intents.filter(i => adult.has(i.memberId)), presence: input.presence.filter(p => adult.has(p.memberId)),
    edges: input.edges.filter(e => both(e.from, e.to)), recentProposals: (input.recentProposals ?? []).filter(p => p.participants.every(id => adult.has(id))),
    safetyHolds: (input.safetyHolds ?? []).filter(h => adult.has(h.memberId)),
  };
  return w.hooks?.engineInput?.(out) ?? out;
}

/**
 * Run engine-v1 once on a snapshot (optionally one city) and summarize it. With `app`, the app's pack,
 * hooks and engine config (service/packs.ts appWiring): the run the Network would make for that app.
 */
export async function runEngineSummarized(snapshot: WorldSnapshot, opts: { seed: number; city?: City; shadow?: boolean; app?: AppId }) {
  const t0 = performance.now();
  const w = opts.app ? appWiring(opts.app) : undefined;
  const input = opts.app ? appEngineInput(snapshot, opts.app) : snapshot;
  const cfg = { ...w?.engine, seed: opts.seed, ...(opts.city ? { cities: [opts.city] } : {}), judge: { ...(w?.engine?.judge ?? {}), enabled: false } };
  const { proposals, runLog } = await runEngine(input, w ? cfg : opts.city ? { seed: opts.seed, cities: [opts.city] } : { seed: opts.seed }, w?.pack ? { pack: w.pack } : {});
  const mine = opts.city ? proposals.filter(p => p.city === opts.city) : proposals;
  const summary = summarizeRun(runLog, mine, { at: snapshot.now, city: opts.city, wallMs: Math.round(performance.now() - t0), shadow: opts.shadow });
  return { proposals: mine, runLog, summary };
}

/** Simulator Engine that records a summary of every run. */
export class CapturingEngine implements Engine {
  readonly name = "engine-v1";
  /** proposal id -> run summary id */
  readonly runOf = new Map<string, string>();
  constructor(private onRun: (s: EngineRunSummary) => void, private onStart?: (city?: City) => void) {}
  async propose(snapshot: WorldSnapshot, opts?: { city?: City; seed?: number | string }) {
    this.onStart?.(opts?.city);
    const seed = typeof opts?.seed === "number" ? opts.seed : 1;
    const { proposals, summary } = await runEngineSummarized(snapshot, { seed, city: opts?.city });
    for (const p of proposals) this.runOf.set(p.id, summary.id);
    this.onRun(summary);
    return proposals;
  }
}
