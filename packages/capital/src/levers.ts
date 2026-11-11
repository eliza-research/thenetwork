// Derived levers (design 2.5). Pure functions of ONE member's own entries. Nothing here reads
// another member's NC, and nothing here is an input to anyone else's ranking: the effort overlay
// only changes how much work the Network does for this member's own intents, and its engine part
// touches only judge-effort knobs (never weights, thresholds, budgets or exposure).
import type { EngineConfigInput } from "../../engine/src/config.ts";
import { DAY } from "../../core/src/clock.ts";
import { DEFAULT_CAPITAL, type CapitalConfig } from "./config.ts";
import { capacity, reachOf, tierOf } from "./credit.ts";
import type { LedgerEntry } from "./types.ts";

export type EffortTier = 0 | 1 | 2 | 3;

/** Network-side effort knobs (no engine change). */
export interface NetworkEffort {
  /** Concierge research depth: sources / candidate venues looked at per ask. */
  conciergeResearchDepth: number;
  /** A standing intent is re-searched at most once every N days (network.ts uses 3 today). */
  intentReSearchDays: number;
  /** Plan building: options the agent drafts before proposing a plan. */
  planBuildingOptions: number;
}

export interface EffortOverlay {
  tier: EffortTier;
  /** Relative AI spend vs the floor (1.0). Capped at the top tier. */
  effortIndex: number;
  /** Deep-partial engine config, applied ONLY when the engine serves this member's own intents. */
  engine: EngineConfigInput;
  network: NetworkEffort;
}

/** Engine keys an overlay may set. Anything else would be a ranking input and is forbidden. */
export const OVERLAY_ENGINE_KEYS = ["judge"] as const;

/**
 * Tier table (PRD 39.2.3: a high floor, diminishing returns at the top). Tier 0 is the floor every
 * member gets, raised above today's engine defaults (pass-2 judge on the top 12, not 10). Each tier
 * above adds less than the one before (+5%, +3%, +2% relative AI spend) and the top is capped at
 * +10% over the floor. The earlier table (1.00 / 1.12 / 1.20 / 1.25 over a floor at today's
 * defaults) gave high-NC members enough extra effort to widen the bottom/top-decile V14 gap by
 * about 0.016 on its own (docs/results/2026-10-08-network-capital.md, fairness gate).
 * The floor's network knobs stay at today's values (FLOOR_EFFORT in packages/network).
 */
export const EFFORT_TABLE: Record<EffortTier, Omit<EffortOverlay, "tier">> = {
  0: { effortIndex: 1.0, engine: { judge: { topK: 12, groupTopK: 3, deep: { enabled: false } } }, network: { conciergeResearchDepth: 3, intentReSearchDays: 3, planBuildingOptions: 3 } },
  1: { effortIndex: 1.05, engine: { judge: { topK: 12, groupTopK: 4, deep: { enabled: false } } }, network: { conciergeResearchDepth: 4, intentReSearchDays: 3, planBuildingOptions: 3 } },
  2: { effortIndex: 1.08, engine: { judge: { topK: 14, groupTopK: 4, deep: { enabled: false } } }, network: { conciergeResearchDepth: 4, intentReSearchDays: 2, planBuildingOptions: 4 } },
  3: { effortIndex: 1.1, engine: { judge: { topK: 14, groupTopK: 4, deep: { enabled: true, topK: 2 } } }, network: { conciergeResearchDepth: 5, intentReSearchDays: 2, planBuildingOptions: 4 } },
};

export const balanceOf = (entries: readonly LedgerEntry[], at = Infinity) => entries.reduce((s, e) => (e.t <= at ? s + e.amount : s), 0);

/**
 * Reversal conservation of one ledger, as a run-time check (the capital block): every `reverses` names
 * one entry of the same member, the amounts are equal and opposite, and no entry is reversed twice.
 * Returns what is wrong, empty when the ledger is well formed.
 */
export function ledgerProblems(entries: readonly LedgerEntry[]): string[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  const reversed = new Set<string>();
  const bad: string[] = [];
  for (const e of entries) {
    const id = e.provenance.reverses;
    if (!id || e.category !== "clawback") continue;
    const orig = byId.get(id);
    if (!orig) bad.push(`${e.id} reverses a missing entry ${id}`);
    else if (orig.member !== e.member) bad.push(`${e.id} reverses an entry of another member`);
    else if (e.amount !== -orig.amount) bad.push(`${e.id} does not cancel ${id}: ${e.amount} and ${orig.amount}`);
    if (reversed.has(id)) bad.push(`${id} is reversed twice`);
    reversed.add(id);
  }
  return bad;
}

export function effortTier(balance: number, cfg: CapitalConfig = DEFAULT_CAPITAL): EffortTier {
  const [a, b, c] = cfg.levers.effortThresholds;
  return tierOf(balance, a, b, c) as EffortTier;
}

export function effortOverlay(entries: readonly LedgerEntry[], at: number, cfg: CapitalConfig = DEFAULT_CAPITAL): EffortOverlay {
  const tier = effortTier(balanceOf(entries, at), cfg);
  const row = EFFORT_TABLE[tier];
  return { tier, effortIndex: row.effortIndex, engine: structuredClone(row.engine), network: { ...row.network } };
}

/**
 * `at` is the caller's Clock time and is required (capital-18): with no time, "now" used to be the
 * member's latest entry, so a member who went quiet after a penalty stayed locked forever.
 */
const recentPenalty = (entries: readonly LedgerEntry[], at: number, days: number) =>
  entries.some(e => (e.category === "abuse" || e.category === "fraud") && e.t <= at && at - e.t < days * DAY);

/** Invites per rolling period. Grows with vouches that worked out, shrinks after lost stakes, 0 after abuse or fraud. */
export function vouchCapacity(entries: readonly LedgerEntry[], at: number, cfg: CapitalConfig = DEFAULT_CAPITAL): number {
  const v = cfg.levers.vouch;
  if (recentPenalty(entries, at, v.abuseLockDays)) return 0;
  const reversed = new Set(entries.filter(e => e.provenance.reverses && e.t <= at).map(e => e.provenance.reverses!));
  const good = entries.filter(e => e.category === "vouch" && e.t <= at && !reversed.has(e.id)).length;
  const lost = entries.filter(e => e.category === "vouch_stake" && e.t <= at).length;
  return capacity(v, good, lost);
}

export interface OrganizingReach {
  /** Max people a member-started crew or plan may reach (invitees still opt in; their budgets still apply). */
  max: number;
  /**
   * Slots above the base that the Network must fill with members who have had the least recent
   * participation (exposure floor). Earned reach widens the network, not the organizer's circle:
   * without this, extra reach went to the most active members and widened the V14 gap
   * (docs/results/2026-10-08-network-capital.md, fairness gate).
   */
  reservedForLowExposure: number;
}

export function organizingReach(entries: readonly LedgerEntry[], at: number, cfg: CapitalConfig = DEFAULT_CAPITAL): OrganizingReach {
  const r = cfg.levers.reach;
  if (recentPenalty(entries, at, r.abuseLockDays)) return { max: r.afterAbuse, reservedForLowExposure: 0 };
  const reversed = new Set(entries.filter(e => e.provenance.reverses && e.t <= at).map(e => e.provenance.reverses!));
  const sessions = entries.filter(e => e.category === "organizing" && e.t <= at && !reversed.has(e.id)).length;
  return reachOf(r, sessions);
}
