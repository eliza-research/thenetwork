// engine-v1 for the observatory: the same runEngine the simulator adapter uses, but every run's
// MatchingRunLog is summarized for the run inspector (funnel, generators, rejections, fairness,
// top configurations and why they lost) and each proposal is linked to its run.
import type { City, MemberId, WorldSnapshot } from "@thenetwork/core";
import { runEngine, type EngineProposal, type MatchingRunLog } from "@thenetwork/engine";
import type { Engine } from "@thenetwork/sim";
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

/** Run engine-v1 once on a snapshot (optionally one city) and summarize it. */
export async function runEngineSummarized(snapshot: WorldSnapshot, opts: { seed: number; city?: City; shadow?: boolean }) {
  const t0 = performance.now();
  const { proposals, runLog } = await runEngine(snapshot, opts.city ? { seed: opts.seed, cities: [opts.city] } : { seed: opts.seed });
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
