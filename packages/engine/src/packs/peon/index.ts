// peonPack: peon.biz (hiring) as an AppPack. Local pilot only (PRD 40.6): candidate-first consent,
// unranked slates with must-have checkmarks, no scores to employers, pay range on every job,
// verified employers, current-employer blocking, an employer scam check, and a protected-attribute
// firewall (sealed attributes never enter a snapshot; proxies are never read).
// Design and results: docs/results/2026-10-08-peon-pack.md.
//
//   entities   candidates (members) and job seats (one member per open job, capacity = openings; schema.ts)
//   retrieval  two-way: candidate -> jobs and job -> candidates (generators.ts)
//   scoring    reciprocal, two-sided asymmetric: must-haves as floors x candidate wants (match.ts)
//   selection  congestion control per job (slate cap) and per candidate (3 roles a week) (selection.ts)
//   filters    pay range, verified employer, scam cue, location / remote, work authorization,
//              seniority band, credentials, excluded companies, no re-intro (rules.ts)
//   consent    application: the candidate opts in, the employer reviews a blind summary, then reveal
import { DAY } from "@thenetwork/core";
import { DEFAULT_ATTENTION, resolveConfig, type EngineConfigInput } from "../../config.ts";
import { harmonic } from "../../scoring.ts";
import type { AppPack, MemberConstraints } from "../../pack.ts";
import { LANE_ACTIVITY, LANE_LABEL, PEON_ASK_QUESTIONS, PEON_SAFE_FALLBACK, peonLeadBits, peonProbeText } from "./copy.ts";
import { PEON_GENERATORS } from "./generators.ts";
import { peonJudge } from "./judge.ts";
import { PEON_CANDIDATE_POST_RULES, PEON_CANDIDATE_PRE_RULES, PEON_MEMBER_RULES, PEON_PAIR_RULES, peonGeo } from "./rules.ts";
import { T } from "./schema.ts";
import { peonAdjust } from "./selection.ts";

export const PEON_PACK_VERSION = "peon-pack-0.1.0";

/**
 * Engine config for peon runs (pass it as `cfgIn`; the shared EngineConfig shape is unchanged).
 * Scores are the reciprocal match only: the Network's social terms (novelty, warm path, timing,
 * activation, load, repetition) are weighted 0. Candidates are in state "normal" (3 roles per 7
 * days); job seats are "open" (a weekly slate capped per job in selection.ts, not an interruption budget).
 */
export const PEON_ENGINE_CONFIG: EngineConfigInput = {
  cities: ["sf", "nyc"],
  budgets: {
    open: { limit: 1000, periodDays: 7 }, normal: { limit: 3, periodDays: 7 }, quiet: { limit: 1, periodDays: 7 },
    receiving: { limit: 3, periodDays: 7 }, paused: { limit: 0, periodDays: 7 },
  },
  contribution: { limit: 1000, periodDays: 7 },
  thresholds: { byState: { open: 0.12, normal: 0.12, quiet: 0.25, receiving: 0.12, paused: Infinity }, useByGenerator: false, exploration: 0.12 },
  floors: { fit: 0.2, mutualBenefit: 0.1, confidence: 0.3, maxSocialRisk: 0.8, judgeDimension: 0.25 },
  weights: { fit: 1, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0.2 },
  complementarity: { weight: 0 },
  exploration: { rate: 0, maxShare: 0.15 },
  selection: { maxProposalsPerCity: 5000, runLoadPenalty: 0, exposureFloorShare: 0, exposureDebtWeight: 0.03, exposureDebtCap: 3 },
  dispatch: { skipOpenOpportunities: false, billOnlySent: true },
  romance: { requireStatedPrefs: false },
  windowDays: 7,
  inviteTtlMs: 5 * DAY,
};

/** Excluded companies ride on the core's typed constraints (boundary facets, any scope). */
function peonConstraints(boundaries: readonly { tags: string[] }[]): MemberConstraints {
  return { dealbreakers: boundaries.flatMap(f => f.tags.filter(t => t.startsWith(T.exclude)).map(t => `company:${t.slice(T.exclude.length)}`)) };
}

export const peonPack: AppPack = {
  id: "peon",
  version: PEON_PACK_VERSION,
  ontology: {
    lanes: [{ id: "professional", label: LANE_LABEL.professional, optIn: "explicit", adultOnly: true }],
    roles: [{ id: "seeker", contributor: false }, { id: "provider", contributor: false }],
    kinds: [{ id: "intro", format: "listing", size: [2, 2] }],
    // Hiring has no contributor budget and no warm graph (a referral path is future work).
    contributorRoles: new Set(),
    warmEdges: new Set(),
    funnelProbe: { lane: "professional", role: "seeker" },
    objectives: [],
    objectivesFor: () => [],
    mutualPreferenceMatch: () => false,
    constraints: peonConstraints,
    isHost: () => false,
  },
  eligibility: {
    minMatchAge: 18,
    // Founder decision: 13-17 may join peon.biz (the personal agent), never matched, probed or slated.
    accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "personal agent (13-17)" }],
    memberRules: PEON_MEMBER_RULES,
    pairRules: PEON_PAIR_RULES,
    candidatePreRules: PEON_CANDIDATE_PRE_RULES,
    candidatePostRules: PEON_CANDIDATE_POST_RULES,
  },
  geo: peonGeo,
  generators: PEON_GENERATORS,
  retrieval: { channels: ["need", "tag"], directions: [{ from: "candidate", to: "job" }, { from: "job", to: "candidate" }] },
  scoring: {
    objective: "two_sided_asymmetric",
    aggregate: benefits => (benefits.length === 2 ? harmonic(benefits) : 0),
    novelty: () => 0,
  },
  selection: {
    adjust: (w, c, v, times) => peonAdjust(w, c, v, times),
    askQuestions: PEON_ASK_QUESTIONS,
  },
  consent: {
    default: {
      kind: "application", initiator: "seeker", reviewer: "provider",
      blindReview: ["name", "age", "zip", "grad_year", "employment_gaps", "photo", "pronouns", "school"],
      stages: ["candidate_probe", "candidate_yes", "employer_review", "employer_yes", "intro", "interview", "offer", "hire", "check_in_90d"],
    },
    byKind: {},
  },
  attention: {
    config: DEFAULT_ATTENTION,
    calibrator: { knots: [[0, 0.05], [0.5, 0.35], [1, 0.75]], byLane: {} },
    noWarmMentionLanes: ["professional"],
    probeAllowed: (_lane, othersCount) => othersCount === 1,
    laneActivity: LANE_ACTIVITY,
    probeText: (ctx, activity) => peonProbeText(ctx, activity),
  },
  judge: peonJudge,
  explain: {
    laneLabel: LANE_LABEL,
    facetPhrase: { skill: "has" },
    leadBits: (w, c, me) => peonLeadBits(w, c, me),
    safeFallback: PEON_SAFE_FALLBACK,
  },
  capital: {
    earn: ["employer_response_sla", "interview_attended", "hire_retained_90d"],
    lose: ["employer_ghosting", "interview_no_show", "scam_report", "fraud"],
    minorsExcluded: true,
  },
  metrics: {
    primary: ["hires", "interviews_per_hire", "retention_90d", "time_to_fill_days", "under_applied_filled"],
    // Official gates (adopted 2026-10-08; evaluated against the keyword job board and the oracle on
    // the same seeds by packages/worlds/src/peon/gates.ts officialGates). Ratios are pack / baseline.
    gates: [
      { metric: "hires_vs_keyword", op: ">=", value: 0.9, seeds: 4, blocking: true },
      { metric: "intros_vs_keyword", op: "<=", value: 0.2, seeds: 4, blocking: true },
      { metric: "hires_vs_oracle", op: ">=", value: 0.8, seeds: 4, blocking: true },
      { metric: "interviews_per_hire_vs_keyword", op: "<=", value: 0.75, seeds: 4, blocking: true },
      { metric: "retention_90d_minus_keyword", op: ">=", value: -0.02, seeds: 4, blocking: true },
      { metric: "under_applied_hires_vs_keyword", op: ">=", value: 0.9, seeds: 4, blocking: true },
      { metric: "gini_applications_per_job_minus_keyword", op: "<=", value: 0, seeds: 4, blocking: true },
      { metric: "impact_ratio_min_automated", op: ">=", value: 0.8, seeds: 4, blocking: true },
      { metric: "scam_reach_median_per_scam_employer", op: "<=", value: 1, seeds: 4, blocking: true },
      { metric: "minors_matched", op: "==", value: 0, seeds: 4, blocking: true },
      { metric: "unverified_employer_intros", op: "==", value: 0, seeds: 4, blocking: true },
      { metric: "jobs_without_pay_range_proposed", op: "==", value: 0, seeds: 4, blocking: true },
    ],
    unsafeClasses: ["minor", "scam_employer", "unverified_employer", "no_pay_range", "excluded_company"],
  },
  defaults: { engine: resolveConfig(PEON_ENGINE_CONFIG), attention: DEFAULT_ATTENTION },
};
