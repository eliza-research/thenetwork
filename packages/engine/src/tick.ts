// Matcher ticks (Section 33.3, ME-010): one tick per city at a time, idempotent per tick id,
// and atomic: proposals are committed only after the whole run succeeds, so a crashed tick
// leaves nothing behind. In production the lock is a Postgres advisory lock and the commit is a
// transaction with a uniqueness constraint on (participants, objective) for active proposals.
import type { City, WorldSnapshot } from "@thenetwork/core";
import { configHash, resolveConfig, type EngineConfigInput } from "./config.ts";
import { runEngine, type EngineDeps, type EngineResult } from "./engine.ts";
import { sha256 } from "./rng.ts";
import type { EngineInput, EngineProposal } from "./types.ts";

export interface ProposalStore {
  /** Atomically commit all proposals of a tick (all or nothing). */
  commit(tickId: string, proposals: EngineProposal[]): void;
  hasTick(tickId: string): boolean;
  getTick(tickId: string): EngineProposal[] | undefined;
}

export class MemoryProposalStore implements ProposalStore {
  readonly ticks = new Map<string, EngineProposal[]>();
  readonly proposals = new Map<string, EngineProposal>();
  commit(tickId: string, proposals: EngineProposal[]) {
    if (this.ticks.has(tickId)) return;
    const staged = new Map(this.proposals);
    for (const p of proposals) {
      if (staged.has(p.id)) throw new Error(`duplicate proposal ${p.id}`);
      staged.set(p.id, p);
    }
    this.proposals.clear();
    for (const [k, v] of staged) this.proposals.set(k, v);
    this.ticks.set(tickId, proposals);
  }
  hasTick(t: string) { return this.ticks.has(t); }
  getTick(t: string) { return this.ticks.get(t); }
}

export class MatcherScheduler {
  private locks = new Set<City>();
  /** Proposals committed by this scheduler per hour bucket, across cities (shared budgets, engine-pipeline-5). */
  private committed = new Map<number, EngineProposal[]>();
  constructor(private store: ProposalStore) {}

  isLocked(city: City) { return this.locks.has(city); }

  /**
   * Tick id: city + hour bucket + seed + config hash (Soulmates idea: idempotent hour-bucketed
   * ids). The config hash is in the id so a tick re-run with a different config is a new tick
   * (engine-pipeline-22); `cfgHash` defaults to the default config's hash.
   */
  static tickId(city: City, now: number, seed: number, cfgHash = configHash(resolveConfig({}))) {
    return sha256(`${city}|${Math.floor(now / 3_600_000)}|${seed}|${cfgHash}`).slice(0, 16);
  }

  async tick(city: City, snapshot: WorldSnapshot | EngineInput, cfg: EngineConfigInput = {}, deps: EngineDeps = {}):
    Promise<{ status: "ran" | "skipped_locked" | "already_done"; tickId: string; result?: EngineResult; proposals: EngineProposal[] }> {
    const runCfg = { ...cfg, cities: [city] };
    const tickId = MatcherScheduler.tickId(city, snapshot.now, cfg.seed ?? 1, configHash(resolveConfig(runCfg)));
    if (this.locks.has(city)) return { status: "skipped_locked", tickId, proposals: [] };
    if (this.store.hasTick(tickId)) return { status: "already_done", tickId, proposals: this.store.getTick(tickId)! };
    this.locks.add(city);
    try {
      // Budgets are per member, not per market: proposals other cities' ticks committed in this
      // hour count as recent proposals, so a cross-city pair is not proposed (and billed) twice.
      const hour = Math.floor(snapshot.now / 3_600_000);
      for (const h of [...this.committed.keys()]) if (h < hour) this.committed.delete(h);
      const earlier = this.committed.get(hour) ?? [];
      const input = earlier.length ? { ...snapshot, recentProposals: [...(snapshot.recentProposals ?? []), ...earlier] } : snapshot;
      const result = await runEngine(input, runCfg, deps);
      // The same configuration found by another city's tick (same key and hour => same id) is
      // already committed: keep the first one.
      const seen = new Set(earlier.map(p => p.id));
      const proposals = result.proposals.filter(p => !seen.has(p.id));
      this.store.commit(tickId, proposals);
      this.committed.set(hour, [...earlier, ...proposals]);
      return { status: "ran", tickId, result, proposals };
    } finally {
      this.locks.delete(city);
    }
  }
}
