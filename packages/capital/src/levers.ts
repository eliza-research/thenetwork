// Derived levers (design 2.5). Pure functions of ONE member's own entries. Nothing here reads
// another member's NC, and nothing here is an input to anyone else's ranking: the effort overlay
// only changes how much work the Network does for this member's own intents, and its engine part
// touches only judge-effort knobs (never weights, thresholds, budgets or exposure).
import type { EngineConfigInput } from "../../engine/src/config.ts";
import { DAY } from "../../core/src/clock.ts";
import { DEFAULT_CAPITAL, type CapitalConfig } from "./config.ts";
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
 * Tier table. Tier 0 is the floor every member gets (today's engine defaults: pass-2 judge on the
 * top 10, re-search every 3 days). The top is capped and each tier adds less than the one before.
 */
export const EFFORT_TABLE: Record<EffortTier, Omit<EffortOverlay, "tier">> = {
  0: { effortIndex: 1.0, engine: { judge: { topK: 10, groupTopK: 3, deep: { enabled: false } } }, network: { conciergeResearchDepth: 3, intentReSearchDays: 3, planBuildingOptions: 3 } },
  1: { effortIndex: 1.12, engine: { judge: { topK: 12, groupTopK: 3, deep: { enabled: false } } }, network: { conciergeResearchDepth: 4, intentReSearchDays: 3, planBuildingOptions: 3 } },
  2: { effortIndex: 1.2, engine: { judge: { topK: 12, groupTopK: 4, deep: { enabled: true, topK: 3 } } }, network: { conciergeResearchDepth: 4, intentReSearchDays: 2, planBuildingOptions: 4 } },
  3: { effortIndex: 1.25, engine: { judge: { topK: 14, groupTopK: 4, deep: { enabled: true, topK: 4 } } }, network: { conciergeResearchDepth: 5, intentReSearchDays: 2, planBuildingOptions: 4 } },
};

export const balanceOf = (entries: readonly LedgerEntry[], at = Infinity) => entries.reduce((s, e) => (e.t <= at ? s + e.amount : s), 0);

export function effortTier(balance: number, cfg: CapitalConfig = DEFAULT_CAPITAL): EffortTier {
  const [a, b, c] = cfg.levers.effortThresholds;
  return balance >= c ? 3 : balance >= b ? 2 : balance >= a ? 1 : 0;
}

export function effortOverlay(entries: readonly LedgerEntry[], at = Infinity, cfg: CapitalConfig = DEFAULT_CAPITAL): EffortOverlay {
  const tier = effortTier(balanceOf(entries, at), cfg);
  const row = EFFORT_TABLE[tier];
  return { tier, effortIndex: row.effortIndex, engine: structuredClone(row.engine), network: { ...row.network } };
}

/** `at` = Infinity means "now" = the latest entry. */
const recentPenalty = (entries: readonly LedgerEntry[], at: number, days: number) => {
  const now = Number.isFinite(at) ? at : entries.reduce((m, e) => Math.max(m, e.t), -Infinity);
  return entries.some(e => (e.category === "abuse" || e.category === "fraud") && e.t <= now && now - e.t < days * DAY);
};

/** Invites per rolling period. Grows with vouches that worked out, shrinks after lost stakes, 0 after abuse or fraud. */
export function vouchCapacity(entries: readonly LedgerEntry[], at = Infinity, cfg: CapitalConfig = DEFAULT_CAPITAL): number {
  const v = cfg.levers.vouch;
  if (recentPenalty(entries, at, v.abuseLockDays)) return 0;
  const reversed = new Set(entries.filter(e => e.provenance.reverses && e.t <= at).map(e => e.provenance.reverses!));
  const good = entries.filter(e => e.category === "vouch" && e.t <= at && !reversed.has(e.id)).length;
  const lost = entries.filter(e => e.category === "vouch_stake" && e.t <= at).length;
  return Math.max(0, Math.min(v.max, v.base + Math.min(v.maxBonus, good * v.perGood) - lost * v.perLost));
}

/** Max people a member-started crew or plan may reach (invitees still opt in; their budgets still apply). */
export function organizingReach(entries: readonly LedgerEntry[], at = Infinity, cfg: CapitalConfig = DEFAULT_CAPITAL): number {
  const r = cfg.levers.reach;
  if (recentPenalty(entries, at, r.abuseLockDays)) return r.afterAbuse;
  const reversed = new Set(entries.filter(e => e.provenance.reverses && e.t <= at).map(e => e.provenance.reverses!));
  const sessions = entries.filter(e => e.category === "organizing" && e.t <= at && !reversed.has(e.id)).length;
  return Math.min(r.max, r.base + Math.floor(sessions / r.perSessions) * r.step);
}
