// peonPack: peon.biz (hiring) as an AppPack. Local pilot only (PRD 40.6): candidate-first consent,
// unranked slates with must-have checkmarks, no scores to employers, pay range on every job,
// verified employers, current-employer blocking, an employer scam check, and a protected-attribute
// firewall (sealed attributes never enter a snapshot; proxies are never read).
// Design and results: docs/results/2026-10-08-peon-pack.md.
//
//   entities   candidates (members) and job seats (one member per open job, capacity = openings; schema.ts)
//              (the service builds seats from job postings and keeps their capacity: seats.ts)
//   matching   Hire (seat Offering, candidate Seeking) and Cofounder (two Peers with current
//              explicit goals) use the generic match core (match.ts, cofounder.ts)
//   search     the bounded search both ways (generators.ts)
//   selection  the pack refusal: a slate cap per job, the lane's weekly capacity per candidate (selection.ts)
//   filters    pay range, verified employer, scam cue, location / remote, work authorization,
//              credentials, excluded companies, no re-intro (rules.ts)
//   consent    application: the candidate opts in, the employer reviews a blind summary, then reveal
import { DAY } from "@thenetwork/core";
import { DEFAULT_ATTENTION, type EngineConfigInput } from "../../config.ts";
import type { AppPack, MemberConstraints } from "../../pack.ts";
import { LANE_ACTIVITY, PEON_ASK_QUESTIONS, PEON_SAFE_FALLBACK, peonLeadBits, peonProbeText } from "./copy.ts";
import { PEON_GENERATORS } from "./generators.ts";
import { peonJudge } from "./judge.ts";
import { peonVectors } from "./match.ts";
import { PEON_CANDIDATE_POST_RULES, PEON_CANDIDATE_PRE_RULES, PEON_MEMBER_RULES, PEON_PAIR_RULES, peonGeo } from "./rules.ts";
import { T } from "./schema.ts";
import { peonAllows, SLATE } from "./selection.ts";

/** The pack version carries the slate tuning (selection.ts SLATE), so a tuning change changes it. */
export const PEON_PACK_VERSION = `peon-pack-0.4.0+slate.${Object.values(SLATE).join(".")}`;

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
    lanes: [{ id: "professional", minors: "never" }],
    // Hiring has no contributor budget and no warm graph (a referral path is future work).
    contributorRoles: new Set(),
    warmEdges: new Set(),
    funnelProbe: { lane: "professional", role: "seeker" },
    objectives: [],
    objectivesFor: () => [],
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
  vectors: peonVectors,
  scoring: {
    novelty: () => 0,
  },
  selection: {
    adjust: (w, c, v, times) => (peonAllows(w, c, times) ? v : -Infinity),
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
    noWarmMentionLanes: ["professional"],
    probeAllowed: (_lane, othersCount) => othersCount === 1,
    laneActivity: LANE_ACTIVITY,
    probeText: (_ctx, activity) => peonProbeText(activity),
  },
  judge: peonJudge,
  explain: {
    facetPhrase: { skill: "has" },
    leadBits: (w, c, me) => peonLeadBits(w, c, me),
    safeFallback: PEON_SAFE_FALLBACK,
    publicWords: ["verified", "employer", "hiring", "only", "never"],
  },
};
