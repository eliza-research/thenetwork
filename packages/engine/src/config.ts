// Engine configuration. Every number here is a hand-tuned v1 default (Section 33.11) and is
// covered by the config hash logged with each run (ME-004). Thresholds are applied (ME-009).
import type { Category, City, ParticipationState } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { sha256, stableStringify } from "./rng.ts";

export const ENGINE_VERSION = "engine-v1.0.0";

export const GENERATOR_NAMES = [
  "intent_to_capability", "complementary_intents", "shared_intent_pooling", "event_anchor",
  "warm_path", "help_request", "group_composer", "second_encounter", "newcomer_welcome",
  "network_growth", "expansion",
] as const;
export type GeneratorName = typeof GENERATOR_NAMES[number];

export interface Weights {
  fit: number; mutualBenefit: number; warmPath: number; novelty: number; timingFit: number;
  activationCost: number; interruptionCost: number; load: number; repetition: number; socialRisk: number;
}

export interface EngineConfig {
  seed: number;
  cities: City[];
  timezones: Record<City, string>;
  windowDays: number;
  minOverlapHours: number;
  ageMin: number;
  /** Proactive proposals per member per rolling period (32.9 budgets; ME-002). */
  budgets: Record<ParticipationState, { limit: number; periodDays: number }>;
  /** Contributor asks (helper/provider/host/connector) per rolling period (15.4). */
  contribution: { limit: number; periodDays: number };
  cooldowns: {
    pairDeclinedDays: number; negativeFeedbackDays: number; categoryDeclineDays: number;
    activeProposalDays: number;
  };
  /** Members who are 'only when I ask' may still be the initiator of an intent this fresh. */
  askedRecencyDays: number;
  thresholds: {
    byState: Record<ParticipationState, number>;
    byCategory: Partial<Record<Category, number>>;
    exploration: number;
  };
  floors: { fit: number; mutualBenefit: number; confidence: number; maxSocialRisk: number; judgeDimension: number };
  weights: Weights;
  retrieval: { topK: number; exposureFloorK: number; lowExposureMax: number; minSim: number; warmMinSim: number; poolSim: number };
  generators: Record<GeneratorName, boolean>;
  maxPerIntent: number;
  group: {
    minSize: number; maxSize: number; beamWidth: number; poolSize: number; minPairwise: number;
    maxAnchorsPerCity: number; alternates: number; minThemeMembers: number;
  };
  exploration: { rate: number; maxShare: number };
  judge: { enabled: boolean; topK: number; groupTopK: number; ttlMs: number; maxTokens: number; weight: number; concurrency: number };
  selection: { maxProposalsPerCity: number; runLoadPenalty: number; exposureFloorShare: number; exposureDebtWeight: number; exposureDebtCap: number };
  inviteTtlMs: number; sameDayInviteTtlMs: number;
  newcomerDays: number;
  emptyStateDays: number;
  highRiskTerms: string[];
  homeEntryTerms: string[];
}

export const DEFAULT_CONFIG: EngineConfig = {
  seed: 1,
  cities: ["sf", "nyc"],
  timezones: { sf: "America/Los_Angeles", nyc: "America/New_York" },
  windowDays: 7,
  minOverlapHours: 3,
  ageMin: 18,
  budgets: {
    open: { limit: 4, periodDays: 7 },
    normal: { limit: 2, periodDays: 7 },
    quiet: { limit: 1, periodDays: 30 },
    receiving: { limit: 2, periodDays: 7 },
    paused: { limit: 0, periodDays: 7 },
  },
  contribution: { limit: 2, periodDays: 14 },
  cooldowns: { pairDeclinedDays: 30, negativeFeedbackDays: 90, categoryDeclineDays: 7, activeProposalDays: 7 },
  askedRecencyDays: 3,
  thresholds: {
    byState: { open: 0.22, normal: 0.3, quiet: 0.42, receiving: 0.3, paused: Infinity },
    byCategory: { romance: 0.35, help: 0.25, growth: 0.2 },
    exploration: 0.15,
  },
  floors: { fit: 0.12, mutualBenefit: 0.08, confidence: 0.3, maxSocialRisk: 0.8, judgeDimension: 0.25 },
  weights: {
    fit: 1.0, mutualBenefit: 0.8, warmPath: 0.3, novelty: 0.2, timingFit: 0.3,
    activationCost: 0.25, interruptionCost: 0.2, load: 0.4, repetition: 0.4, socialRisk: 0.4,
  },
  retrieval: { topK: 50, exposureFloorK: 10, lowExposureMax: 1, minSim: 0.2, warmMinSim: 0.15, poolSim: 0.4 },
  generators: Object.fromEntries(GENERATOR_NAMES.map(g => [g, true])) as Record<GeneratorName, boolean>,
  maxPerIntent: 4,
  group: { minSize: 3, maxSize: 6, beamWidth: 8, poolSize: 24, minPairwise: 0.05, maxAnchorsPerCity: 8, alternates: 3, minThemeMembers: 4 },
  exploration: { rate: 0.125, maxShare: 0.15 },
  judge: { enabled: true, topK: 10, groupTopK: 3, ttlMs: 7 * DAY, maxTokens: 2500, weight: 0.4, concurrency: 4 },
  selection: { maxProposalsPerCity: 120, runLoadPenalty: 0.08, exposureFloorShare: 0.25, exposureDebtWeight: 0.05, exposureDebtCap: 3 },
  inviteTtlMs: 48 * HOUR, sameDayInviteTtlMs: 3 * HOUR,
  newcomerDays: 14,
  emptyStateDays: 10,
  highRiskTerms: ["childcare", "babysit", "babysitting", "minor", "minors", "kid", "kids", "child", "children",
    "medical", "nursing", "clinical", "medication", "loan", "lend", "cash", "custody", "drug", "drugs",
    "weed", "substance", "home_hosted", "therapy"],
  homeEntryTerms: ["home", "apartment", "house", "move", "moving", "couch", "furniture", "my place"],
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type EngineConfigInput = DeepPartial<EngineConfig>;

function merge<T>(base: T, over: any): T {
  if (over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over as T;
  const out: any = { ...base };
  for (const k of Object.keys(over)) out[k] = merge((base as any)[k], over[k]);
  return out;
}

export function resolveConfig(input: EngineConfigInput = {}): EngineConfig {
  const cfg = merge(DEFAULT_CONFIG, input);
  if (cfg.exploration.rate < 0 || cfg.exploration.rate > cfg.exploration.maxShare)
    throw new Error(`exploration.rate must be within [0, maxShare=${cfg.exploration.maxShare}]`);
  if (cfg.group.minSize < 3 || cfg.group.maxSize > 6 || cfg.group.minSize > cfg.group.maxSize)
    throw new Error("group size must be within 3..6 (Section 33.4)");
  return cfg;
}

export function configHash(cfg: EngineConfig): string {
  // Infinity is not JSON; stringify it explicitly.
  return sha256(stableStringify(JSON.parse(JSON.stringify(cfg, (_k, v) => (v === Infinity ? "Infinity" : v))))).slice(0, 16);
}
