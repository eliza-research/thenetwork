// NC defaults. Tuned in packages/capital/experiments/run.ts (90 simulated days, 8 seeds);
// numbers and trade-offs in docs/results/2026-10-08-network-capital.md.
import type { EarnCategory } from "./types.ts";

export interface CapitalConfig {
  /** Base credit per earn event, before anti-gaming multipliers. */
  credit: {
    vouch: number; attendance: number; feedback: number; help: number; organizing: number;
    needs_answered: number; review: number;
  };
  /** Penalty sizes (positive numbers; written with sign -1). */
  penalty: { vouchStake: number; noShow: number; ghosting: number; abuse: number; fraud: number };
  vouch: {
    /** Invitee must get value within this many days of joining for the voucher to earn credit. */
    valueWindowDays: number;
    /** Serious confirmed abuse by the invitee within this many days of joining costs the stake. */
    stakeWindowDays: number;
  };
  flake: {
    /** Cancelling at least this long before the start is free. */
    cancelCutoffHours: number;
    /** No-shows forgiven per rolling window (PRD 15.2: one). */
    forgivenNoShows: number;
    forgivenessWindowDays: number;
  };
  organizing: { minAttendees: number };
  antiGaming: {
    /** Credit x pairDecay^k, k = earlier credits with the same counterpart inside pairWindowDays (mean over counterparts). */
    pairDecay: number; pairWindowDays: number;
    /** Pair window for member-controlled credits (help, needs, member-started plans): the pair chose to interact. */
    controlledPairWindowDays: number;
    /** Credit x 1 / (1 + n / softN[c]), n = earlier credits of category c inside periodDays. */
    categorySoftN: Record<EarnCategory, number>;
    periodDays: number;
    /** Hard cap on positive NC earned per rolling period. */
    periodCap: number;
  };
  detection: {
    windowDays: number;
    /** Reciprocal ring: at least this many confirmed credits in the window ... */
    ringMinCredits: number;
    /** ... with at least this share confirmed by members the member confirms back (within 2 hops) ... */
    ringShare: number;
    /** ... and that reciprocal set no larger than this. */
    ringMaxSize: number;
    /** Staged meetup: this many member-started plans with the same people, verified only by each other. */
    stagedRepeat: number;
  };
  levers: {
    /** NC thresholds for effort tiers 1, 2, 3. Tier 0 (the floor) is everyone else, including negative NC. */
    effortThresholds: [number, number, number];
    vouch: { base: number; perGood: number; maxBonus: number; perLost: number; max: number; periodDays: number; abuseLockDays: number };
    reach: { base: number; perSessions: number; step: number; max: number; afterAbuse: number; abuseLockDays: number };
  };
}

export const DEFAULT_CAPITAL: CapitalConfig = {
  credit: { vouch: 10, attendance: 2, feedback: 0.5, help: 3, organizing: 4, needs_answered: 3, review: 1 },
  penalty: { vouchStake: 10, noShow: 3, ghosting: 2, abuse: 20, fraud: 10 },
  vouch: { valueWindowDays: 30, stakeWindowDays: 90 },
  flake: { cancelCutoffHours: 4, forgivenNoShows: 1, forgivenessWindowDays: 90 },
  organizing: { minAttendees: 2 },
  antiGaming: {
    pairDecay: 0.5, pairWindowDays: 30, controlledPairWindowDays: 90,
    categorySoftN: { vouch: 3, attendance: 8, help: 6, organizing: 6, needs_answered: 4, review: 20 },
    periodDays: 30, periodCap: 40,
  },
  detection: { windowDays: 30, ringMinCredits: 5, ringShare: 0.6, ringMaxSize: 6, stagedRepeat: 3 },
  levers: {
    effortThresholds: [15, 45, 120],
    vouch: { base: 2, perGood: 1, maxBonus: 3, perLost: 2, max: 5, periodDays: 30, abuseLockDays: 90 },
    reach: { base: 8, perSessions: 3, step: 2, max: 16, afterAbuse: 4, abuseLockDays: 90 },
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type CapitalConfigInput = DeepPartial<CapitalConfig>;

function merge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = merge(out[k], v);
  return out as T;
}

export const resolveCapital = (input: CapitalConfigInput = {}): CapitalConfig => merge(DEFAULT_CAPITAL, input);
