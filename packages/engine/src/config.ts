// Engine configuration. Every number here is a hand-tuned v1 default (Section 33.11) and is
// covered by the config hash logged with each run (ME-004). Thresholds are applied (ME-009).
import type { Category, City, ParticipationState } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { sha256, stableStringify } from "./rng.ts";
import type { Effort, ItemKind } from "./types.ts";

export const ENGINE_VERSION = "engine-v1.2.0";

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
    /** Category floors: the effective threshold is max(state, category). */
    byCategory: Partial<Record<Category, number>>;
    /**
     * v1.2: category thresholds that replace the state threshold, so they can LOWER it as well as
     * raise it. A participant in a stricter-than-Normal state (Quiet, Paused) still keeps their
     * stricter bar. Takes precedence over `byCategory` for that category. Applied only when
     * `useCategoryOverride` is true.
     */
    categoryOverride: Partial<Record<Category, number>>;
    useCategoryOverride: boolean;
    /** v1.2: per-generator thresholds, same override rule; applied only when `useByGenerator`. */
    byGenerator: Partial<Record<GeneratorName, number>>;
    useByGenerator: boolean;
    exploration: number;
  };
  floors: { fit: number; mutualBenefit: number; confidence: number; maxSocialRisk: number; judgeDimension: number };
  weights: Weights;
  retrieval: { topK: number; exposureFloorK: number; lowExposureMax: number; minSim: number; warmMinSim: number; poolSim: number };
  /**
   * Structured needs -> offers complementarity (complementarity.ts). `weight` blends it into
   * fit and each side's benefit: x' = (1 - weight) x + weight * structured; 0 turns it off.
   * `overlap` / `need` / `give` weigh a side's benefit (interest overlap; the other member meets
   * my want; I meet theirs). `retrievalChannel` adds members whose skills / offers / pools meet
   * an intent (satisfaction >= `channelMin`) to that intent's candidates, even below minSim.
   */
  complementarity: { weight: number; overlap: number; need: number; give: number; retrievalChannel: boolean; channelMin: number };
  generators: Record<GeneratorName, boolean>;
  /**
   * v1.2 dispatch awareness. `skipOpenOpportunities`: members in an opportunity that was sent and
   * is still open (input.openOpportunities) are not selected. `billOnlySent`: proposals the Network
   * never sent (input.unsentProposalIds) do not count against budgets or block the pair.
   */
  dispatch: { skipOpenOpportunities: boolean; billOnlySent: boolean };
  /**
   * v1.2: members state personal-growth wants ("learn to sail", "try ceramics") with category
   * "growth", but the engine reserves "growth" for growing the Network and every intent generator
   * skips it. When true, such intents are matched as "hobby" (taxonomy.ts isPersonalGrowth) and
   * stating one counts as opting in to hobby matching.
   */
  personalGrowthAsHobby: boolean;
  /**
   * v1.2 acceptance estimate (world.ts acceptanceOf): P(member says yes) from engine-visible data
   * only. Selection orders eligible candidates by adjusted score x (product of P)^exponent; the
   * threshold still applies to the score itself. exponent 0 = off.
   */
  acceptance: { exponent: number; prior: number; strength: number; signals: boolean };
  /**
   * v1.2 "ask before proposing": adults the engine cannot match well yet (no structured want, or
   * fewer than `minFacets` matchable facets) get an EngineAsk; thin profiles are held back from
   * proposals while the question is open (`cooldownDays`, input.recentAsks), members with no
   * structured want too with `holdNoWant`.
   */
  ask: { enabled: boolean; minFacets: number; cooldownDays: number; holdNoWant: boolean };
  /** v1.2: romance proposals only when both members stated romance preferences (else ask for them). */
  romance: { requireStatedPrefs: boolean };
  maxPerIntent: number;
  group: {
    minSize: number; maxSize: number; beamWidth: number; poolSize: number; minPairwise: number;
    maxAnchorsPerCity: number; alternates: number; minThemeMembers: number;
  };
  exploration: { rate: number; maxShare: number };
  judge: {
    /** Pass 2 (rubric judge, judge.ts) on the top configurations. */
    enabled: boolean; topK: number; groupTopK: number; ttlMs: number; maxTokens: number; weight: number; concurrency: number;
    /** A pass-2 verdict of "no" makes the configuration ineligible ("judge_reject"), like a dealbreaker. */
    verdictGates: boolean;
    /**
     * Pass-2 input: "compact" = the scrubbed profile (judge-v2.1); "deep" = pass 3's context minus
     * private context (judge-v3). See docs/results/2026-10-07-judge-v2.md.
     */
    pass2Context: "compact" | "deep";
    /** Pass 1 (screen, judgeScreen.ts): a cheap look at more candidates; pass 2 then sees only survivors. */
    screen: { enabled: boolean; topK: number; groupTopK: number; maxTokens: number };
    /** Pass 3 (deep review, judgeDeep.ts) on the best survivors of passes 1-2. Can only remove candidates. */
    deep: { enabled: boolean; topK: number; maxTokens: number };
  };
  selection: { maxProposalsPerCity: number; runLoadPenalty: number; exposureFloorShare: number; exposureDebtWeight: number; exposureDebtCap: number };
  inviteTtlMs: number; sameDayInviteTtlMs: number;
  newcomerDays: number;
  emptyStateDays: number;
  highRiskTerms: string[];
  highRiskPatterns: string[];
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
    // Values from docs/research/2026-10-07-match-failures-and-diversity.md (score calibration by
    // category; per-generator thresholds for the structural levers).
    categoryOverride: { professional: 0.38, romance: 0.45, hobby: 0.26 },
    useCategoryOverride: false,
    byGenerator: { event_anchor: 0.4, group_composer: 0.4 },
    // On in v1.2: with events and shareable interests in the snapshot, event pairs and theme
    // groups at the state threshold ran at 29.7% precision (8 sim seeds); at 0.40, 38.2%.
    useByGenerator: true,
    exploration: 0.15,
  },
  floors: { fit: 0.12, mutualBenefit: 0.08, confidence: 0.3, maxSocialRisk: 0.8, judgeDimension: 0.25 },
  // warmPath 0.3 -> 0.2 (2026-10, synthetic v1 review). A warm tie is credited twice: through
  // this component (warmPathValue never drops below 0.3 and peaks at 1.0) and through the graph
  // channel raising retrieval agreement in Confidence. At 0.3 warm_path took 122 of 221
  // proposals with the lowest mean fit of any intent generator (0.51), spending members'
  // 2-per-week budgets ahead of better-fitting cold intros. At 0.2: warm_path 94/217, mean
  // selected fit 0.559 -> 0.583. There is no per-generator cap by design; the exploration slice
  // (13-14%) and exposure debt were checked and behave as specified.
  weights: {
    fit: 1.0, mutualBenefit: 0.8, warmPath: 0.2, novelty: 0.2, timingFit: 0.3,
    activationCost: 0.25, interruptionCost: 0.2, load: 0.4, repetition: 0.4, socialRisk: 0.4,
  },
  retrieval: { topK: 50, exposureFloorK: 10, lowExposureMax: 1, minSim: 0.2, warmMinSim: 0.15, poolSim: 0.4 },
  // Complementarity (2026-10-06, docs/results/2026-10-06-liveness-complementarity.md). Inside the
  // engine's own candidate set the embedding-based score picked good pairs at 24-28% against a 22%
  // base rate, while a structured needs -> offers score reached 46-47% (PoC). weight 0.5 gives the
  // structured evidence the same say as the semantic evidence rather than replacing it: semantic
  // fit still carries free-text wants outside the taxonomy, and the term is neutral (not applied)
  // for members with no structured profile. Side weights: what I get (need 0.55) dominates, then
  // shared interests (0.35), then the pleasure of helping (0.1), the same ordering as the reasons
  // members give for a good intro. Sensitivity: weights 0.25-0.75 in the results doc.
  complementarity: { weight: 0.5, overlap: 0.35, need: 0.55, give: 0.1, retrievalChannel: false, channelMin: 0.85 },
  generators: Object.fromEntries(GENERATOR_NAMES.map(g => [g, true])) as Record<GeneratorName, boolean>,
  // v1.2 defaults (docs/results/2026-10-07-engine-v1.2.md, 8 sim seeds, history fed). On: dispatch
  // awareness (met + worthwhile +5.1 per seed on the v1.2 snapshot), personal growth as hobby
  // (recall +1.9 points, a bug fix), the romance preference gate (no cost when preferences are
  // stated; blind romance ran at 3-18% precision). Off (measured, no significant win): the
  // acceptance ordering, category overrides, "ask before proposing" (also needs the Network to
  // send asks and report answers), and Normal 3/week (over-budget sends; PRD 32.9 says 2).
  dispatch: { skipOpenOpportunities: true, billOnlySent: true },
  personalGrowthAsHobby: true,
  acceptance: { exponent: 0, prior: 0.45, strength: 2, signals: false },
  // holdNoWant true: synthetic tick-1 precision 41.1% vs 34.2% when no-want members stay matchable.
  ask: { enabled: false, minFacets: 3, cooldownDays: 14, holdNoWant: true },
  romance: { requireStatedPrefs: true },
  maxPerIntent: 4,
  group: { minSize: 3, maxSize: 6, beamWidth: 8, poolSize: 24, minPairwise: 0.05, maxAnchorsPerCity: 8, alternates: 3, minThemeMembers: 4 },
  exploration: { rate: 0.125, maxShare: 0.15 },
  // Passes 1 and 3 are off by default (evaluated in docs/results/2026-10-06-judge-passes.md);
  // turning them on changes which candidates survive and adds LLM calls. Pass 2 reads pass 3's
  // context ("deep", judge-v3) since 2026-10-07: on the held-out test split it beat the compact
  // input by +8.6 pp accuracy with the hard gate (p < 0.001) and had lower Brier
  // (docs/results/2026-10-07-judge-v2.md). Passes 1 and 3 keep their v2 prompts (v3 did not win on test).
  judge: {
    enabled: true, topK: 10, groupTopK: 3, ttlMs: 7 * DAY, maxTokens: 2500, weight: 0.4, concurrency: 4, verdictGates: true, pass2Context: "deep",
    screen: { enabled: false, topK: 30, groupTopK: 6, maxTokens: 2500 },
    deep: { enabled: false, topK: 6, maxTokens: 6000 },
  },
  selection: { maxProposalsPerCity: 120, runLoadPenalty: 0.08, exposureFloorShare: 0.25, exposureDebtWeight: 0.05, exposureDebtCap: 3 },
  inviteTtlMs: 48 * HOUR, sameDayInviteTtlMs: 3 * HOUR,
  newcomerDays: 14,
  emptyStateDays: 10,
  // High-risk vocabulary (F14/F15 safety rules). Matched on whole words (with plurals), so
  // "kids" never fires on "kid-friendly"... unless a rule below says so. Kept deliberately
  // small: generic words about children, money or health are handled by the context rules in
  // `highRiskPatterns`, because members routinely write "parents with young kids", "lend a
  // hand" or "loan a drum pad" (the v1 list rejected 404 synthetic candidates on such text).
  highRiskTerms: ["childcare", "child care", "babysit", "babysitter", "babysitting", "nanny", "playdate", "play date",
    "custody", "minors", "underage", "medical", "nursing", "clinical", "medication", "prescription",
    "drug", "weed", "cannabis", "substance", "home hosted", "therapy", "cash"],
  // Context rules (case-insensitive regex sources, applied to text with "_" read as a space):
  // children only count when someone would care for, supervise, transport or teach them, or a
  // service is offered to them; lending only when it is money.
  highRiskPatterns: [
    "\\b(watch(ing)?|sit(ting)?|look(ing)? after|care for|caring for|supervis\\w*|pick(ing)? up|drop(ping)? off|driv(e|ing)|tutor\\w*|mentor\\w*|coach\\w*|teach\\w*|alone with)\\b(\\W+\\w+){0,3}?\\W+(my |our |your |their |the |a )?(kids?|child|children|minors?|teens?|teenagers?|toddlers?|bab(y|ies)|sons?|daughters?)\\b",
    "\\b(for|to) (\\w+ )?(little |young |small )?(kids|children|toddlers|teens|teenagers|minors)\\b(?!')",
    "\\bunder (the age of )?1[0-7]\\b",
    "\\b(lend|lending|loan|loans|borrow|borrowing)\\b(\\W+\\w+){0,3}?\\W+(money|cash|dollars|rent|funds?|\\$)",
    "\\$\\s?\\d+\\s?(loan|cash)\\b", "\\b(personal|payday) loans?\\b",
  ],
  homeEntryTerms: ["home", "apartment", "house", "move", "moving", "couch", "furniture", "my place"],
};

/**
 * Named configurations measured in docs/results/2026-10-07-engine-v1.2.md.
 * - `v1_1`: engine-v1.1.0 behaviour (every v1.2 flag off).
 * - `comboD`: COMBO D of docs/research/2026-10-07-match-failures-and-diversity.md: dispatch-aware,
 *   Normal 3/week, category overrides, personal growth as hobby, romance preference gate. Not the
 *   default: Normal 3/week produced over-budget sends (3+ proactive messages in 7 days) in the
 *   simulator, because invitations go out after the proposal is created; PRD 32.9 says 2/week.
 */
export const PRESETS: Record<"v1_1" | "comboD", EngineConfigInput> = {
  v1_1: {
    dispatch: { skipOpenOpportunities: false, billOnlySent: false }, personalGrowthAsHobby: false,
    thresholds: { useCategoryOverride: false, useByGenerator: false }, acceptance: { exponent: 0 },
    ask: { enabled: false }, romance: { requireStatedPrefs: false },
  },
  comboD: {
    dispatch: { skipOpenOpportunities: true, billOnlySent: true }, personalGrowthAsHobby: true,
    thresholds: { useCategoryOverride: true }, budgets: { normal: { limit: 3, periodDays: 7 } }, romance: { requireStatedPrefs: true },
  },
};

// ------------------------------------------------------------------------------------------------
// Attention budget (docs/design/2026-10-07-experience-design.md section 1, Phase 1; founder
// defaults D1-D18). A send-time layer used by attention.ts; it is NOT part of EngineConfig, so
// runEngine's behaviour and config hash are unchanged. It has its own hash (attentionConfigHash).
// Weekdays are JavaScript getDay() numbers (0 = Sunday, 4 = Thursday), as in the design doc.

export interface AttentionConfig {
  version: string;
  /** D1: interruptions (messages the Network starts), not opportunities, per rolling period. */
  caps: Record<ParticipationState, { limit: number; periodDays: number }>;
  /** D4: single-item break-ins outside the digest, within the cap. */
  breakIns: Record<ParticipationState, { limit: number; periodDays: number }>;
  /** Shadow price base lambda_state (1.3). Paused = Infinity. */
  lambda: Record<ParticipationState, number>;
  /** Items per message (1.7). */
  maxItems: Record<ParticipationState, number>;
  /** At most this many items per message that involve another member (1.3). */
  maxMemberItems: number;
  /** theta_bar (1.5): the best item's calibrated enjoyment must clear this, per state. */
  qualityBar: Record<ParticipationState, number>;
  /** Quiet members get items with E >= this only (1.7); only_when_great members too (1.5). */
  quietMinEnjoy: number; onlyWhenGreatMinEnjoy: number;
  /** D2: digest slots per state (JS weekdays), local hour, weekly or monthly (first matching weekday). */
  digest: { days: Record<ParticipationState, number[]>; period: Record<ParticipationState, "week" | "month">; hour: number; spreadMinutes: number };
  /** D4: a break-in needs V >= valueRatio x the member's median digest-item V (defaultMedianValue before any digest). */
  breakIn: { valueRatio: number; defaultMedianValue: number };
  /** u_i(t): items that expire before the next digest slot. */
  urgencyBoost: number;
  /** w_kind (1.3). profiling_question / reconfirm use min(weight, item.evi). */
  kindWeight: Record<ItemKind, number>;
  /** e per effort class (1.3 table). */
  effortCost: Record<Effort, number>;
  /** D13: V uses acceptance^exponent (0.5 = square root). `acceptancePrior` when no estimate exists. */
  acceptanceExponent: number; acceptancePrior: number;
  /** Hold queue (1.6). replaceMargin: hysteresis for replacing a held item with the same key (6.2). */
  hold: { capacity: number; replaceMargin: number; dismissDays: number; revalidateHours: number };
  /** Hold expiry (1.6). partnerProbeDays: a partner probe after the first member said yes. */
  expiry: { introProbeDays: number; partnerProbeDays: number; groupProbeDays: number; profilingDays: number; placeDays: number; eventLeadHours: number };
  /** r_m (1.3): learned annoyance multiplier. */
  annoyance: { min: number; max: number; less: number; unanswered: number; positive: number; halfLifeDays: number; fastPickHours: number; unansweredHours: number };
  /** D9: members aged 13-17. */
  minors: { cap: { limit: number; periodDays: number }; maxItems: number; breakIns: number; quietHours: [number, number]; schoolNights: number[]; allowedKinds: ItemKind[] };
  /** First 14 days (1.7). */
  newcomer: { days: number; lambda: number; breakIns: number };
  /** 1.9 / D6: Blooio coupling. */
  blooio: { interruptMaxOutstanding: number; logisticsMaxOutstanding: number; reengageAfterDays: number; reengagePercentile: number };
  /** D10: romance items share a digest only if the member allows it. */
  romanceInDigest: boolean;
  /** V14 (3.3). */
  v14: { windowDays: number; minTenureDays: number };
}

const perState = <T>(open: T, normal: T, quiet: T, receiving: T, paused: T): Record<ParticipationState, T> => ({ open, normal, quiet, receiving, paused });

export const DEFAULT_ATTENTION: AttentionConfig = {
  version: "attention-v1.0.0",
  caps: perState({ limit: 4, periodDays: 7 }, { limit: 2, periodDays: 7 }, { limit: 1, periodDays: 30 }, { limit: 2, periodDays: 7 }, { limit: 0, periodDays: 7 }),
  breakIns: perState({ limit: 2, periodDays: 7 }, { limit: 1, periodDays: 7 }, { limit: 0, periodDays: 30 }, { limit: 1, periodDays: 7 }, { limit: 0, periodDays: 7 }),
  lambda: perState(0.15, 0.25, 0.5, 0.25, Infinity),
  maxItems: perState(3, 3, 2, 2, 0),
  maxMemberItems: 2,
  qualityBar: perState(0.22, 0.3, 0.42, 0.3, Infinity),
  quietMinEnjoy: 0.6, onlyWhenGreatMinEnjoy: 0.6,
  digest: { days: perState([2, 4], [4], [4], [4], []), period: perState("week", "week", "month", "week", "week"), hour: 18, spreadMinutes: 120 },
  breakIn: { valueRatio: 1.5, defaultMedianValue: 0.25 },
  urgencyBoost: 1.3,
  kindWeight: {
    intro_probe: 1, plan_probe: 1, group_probe: 1, event_suggestion: 0.7, place_suggestion: 0.5, help_ask: 0.6,
    advice_route: 0.4, profiling_question: 0.5, reconfirm: 0.5, worthwhile_check: 0.3, nothing_yet: 0.2,
  },
  effortCost: { glance: 0.1, reply: 0.2, meet_short: 0.4, meet_long: 0.6, contribute: 0.8 },
  acceptanceExponent: 0.5, acceptancePrior: 0.45,
  hold: { capacity: 10, replaceMargin: 0.1, dismissDays: 30, revalidateHours: 24 },
  expiry: { introProbeDays: 14, partnerProbeDays: 2, groupProbeDays: 14, profilingDays: 30, placeDays: 7, eventLeadHours: 24 },
  annoyance: { min: 0.5, max: 3, less: 1.5, unanswered: 1.25, positive: 0.8, halfLifeDays: 30, fastPickHours: 2, unansweredHours: 72 },
  minors: {
    cap: { limit: 1, periodDays: 7 }, maxItems: 2, breakIns: 0, quietHours: [20, 8],
    // Evenings before a school day: Sunday-Thursday (the morning after is Monday-Friday).
    schoolNights: [0, 1, 2, 3, 4],
    allowedKinds: ["event_suggestion", "place_suggestion", "plan_probe"],
  },
  newcomer: { days: 14, lambda: 0.2, breakIns: 1 },
  blooio: { interruptMaxOutstanding: 1, logisticsMaxOutstanding: 2, reengageAfterDays: 30, reengagePercentile: 0.75 },
  romanceInDigest: false,
  v14: { windowDays: 14, minTenureDays: 14 },
};

export type AttentionConfigInput = DeepPartial<AttentionConfig>;
export function resolveAttention(input: AttentionConfigInput = {}): AttentionConfig {
  const cfg = merge(DEFAULT_ATTENTION, input);
  for (const s of Object.keys(cfg.caps) as ParticipationState[]) {
    if (cfg.breakIns[s].limit > cfg.caps[s].limit) throw new Error(`attention.breakIns.${s} must be within the cap (D4)`);
    if (cfg.maxItems[s] > 3) throw new Error("attention.maxItems is at most 3 (D1)");
  }
  return cfg;
}
/**
 * D1: with the attention layer on, the interruption cap lives at send time (attention.ts), so the
 * engine's per-member proposal budget becomes a SUPPLY limit: cap x items per message (Normal
 * 2 x 3 = 6 per 7 days). Pass the result as engine config overrides; DEFAULT_CONFIG is unchanged.
 */
export function engineSupplyBudgets(att: AttentionConfig = DEFAULT_ATTENTION): EngineConfigInput {
  const out: Partial<Record<ParticipationState, { limit: number; periodDays: number }>> = {};
  for (const st of Object.keys(att.caps) as ParticipationState[]) out[st] = { limit: att.caps[st].limit * Math.max(1, att.maxItems[st]), periodDays: att.caps[st].periodDays };
  return { budgets: out };
}
export function attentionConfigHash(cfg: AttentionConfig): string {
  return sha256(stableStringify(JSON.parse(JSON.stringify(cfg, (_k, v) => (v === Infinity ? "Infinity" : v))))).slice(0, 16);
}

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
