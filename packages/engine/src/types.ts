// Engine-local extensions of the shared contract (packages/core). These are proposed for
// promotion into core (see README "Proposed core changes").
import type {
  Category, City, MemberId, OpportunityKind, Proposal, ScoreComponents, WorldSnapshot,
} from "@thenetwork/core";

export interface NetworkEvent {
  id: string; title: string; description?: string; city: City; area?: string;
  start: number; end: number; tags: string[]; category: Category; capacity?: number;
  riskTags?: string[];
}
export interface SafetyHold { memberId: MemberId; from: number; to?: number; reason?: string }
export interface FeedbackRecord {
  id: string; from: MemberId; about: MemberId; opportunityId?: string; at: number;
  sentiment: "positive" | "neutral" | "negative"; wouldMeetAgain?: boolean;
  /** Pitfall guard (ME-006): processing feedback must not end its cooldown effect. */
  processed?: boolean;
}
export type InteractionOutcome =
  | "pending" | "accepted" | "declined" | "expired" | "completed" | "cancelled" | "no_show";
/** A past opportunity and how it ended (from the opportunity workflow / event log). */
export interface InteractionRecord {
  id: string; kind: OpportunityKind; category: Category; participants: MemberId[];
  at: number; outcome: InteractionOutcome; declinedBy?: MemberId[]; contributors?: MemberId[];
}
export interface ReliabilityEvidence { noShows: number; completedSinceLastNoShow: number }

/** What the engine reads: the core snapshot plus optional extension fields. */
export interface EngineInput extends WorldSnapshot {
  events?: NetworkEvent[];
  safetyHolds?: SafetyHold[];
  feedback?: FeedbackRecord[];
  interactions?: InteractionRecord[];
  /** Alternate identifiers (phone, channel, legacy ids) -> canonical member id (ME-006). */
  idAliases?: Record<string, MemberId>;
  reliability?: Record<MemberId, ReliabilityEvidence>;
  /** Member-set per-category quotas, proposals per 30 days (Section 15.4). */
  categoryQuotas?: Record<MemberId, Partial<Record<Category, number>>>;
  /**
   * Amortized exposure debt carried between runs (cumulative estimated relevance minus
   * cumulative proposals). The run log returns the updated values to persist.
   */
  exposureDebt?: Record<MemberId, number>;
}

export type Role =
  | "initiator" | "seeker" | "provider" | "peer" | "helper" | "host" | "guest" | "newcomer"
  | "connector" | "attendee";
export const CONTRIBUTOR_ROLES: ReadonlySet<Role> = new Set<Role>(["provider", "helper", "host", "connector"]);
export type SafetyClass = "low" | "medium";
export type Format = "one_to_one" | "small_group" | "event";

export interface Anchor { type: "intent" | "event" | "interest" | "interaction" | "gap" | "member"; id: string; label?: string }

/** Internal candidate configuration before filtering/scoring. */
export interface Candidate {
  key: string; kind: OpportunityKind; generator: string; category: Category;
  participants: MemberId[]; roles: Record<MemberId, Role>; format: Format;
  objective: string; anchor?: Anchor; via?: MemberId;
  preferredCity?: City; fixedWindow?: { start: number; end: number };
  city?: City; window?: { start: number; end: number };
  channels: Set<string>;
  /** Facet ids (any scope) that drove the match, per participant. Explanations re-filter to shareable. */
  evidence: Record<MemberId, string[]>;
  fit: number; benefit: Record<MemberId, number>;
  warm: number; alternates: MemberId[]; exploration: boolean; safetyClass: SafetyClass;
  timeSensitive: boolean; riskText: string; groupStats?: GroupStats;
  /** Evidence quality when it does not come from facets (e.g. mutual feedback, graph position). */
  confidenceHint?: number;
}
export interface GroupStats { avgPairwise: number; minBest: number; roleCoverage: number; warmTies: number; clusterDiversity: number; overlapHours: number }

export interface JudgeVerdict {
  fit: number; mutualValue: number; capacityRealism: number; timing: number; socialComfort: number;
  redFlags: number; dealbreaker: boolean; dealbreakerReason?: string; certainty: number;
  why: Record<MemberId, string>; model?: string;
}

export interface EngineProposal extends Proposal {
  category: Category; roles: Record<MemberId, Role>; expiresAt: number; anchor?: Anchor; via?: MemberId;
  safetyClass: SafetyClass; threshold: number; channels: string[]; judged: boolean;
  /** Off-policy logging: selector rank and probability this proposal was selected (1 for greedy picks). */
  selectorRank: number; selectionProbability: number;
}

export interface FairnessMetrics {
  eligibleMembers: number; membersWithProposal: number; zeroExposureShare: number;
  gini: number; top10Share: number; newcomerShare: number; newcomerCoverage: number;
  lowExposureCoverage: number; byCity: Record<string, number>; byInviterCluster: Record<string, number>;
  maxPerMember: number;
  /** Lorenz curve of proposal exposure: cumulative share held by the bottom 10%, 20%, ... 100%. */
  lorenz: number[];
  /** Share of eligible members with at least one viable (eligible, above-threshold) candidate. */
  viableCoverage: number;
}
export interface FunnelLog {
  generated: number; byGenerator: Record<string, number>;
  /** Members by first failing member-level filter (generic social/peer check), once per member. */
  memberFunnel: Record<string, number>;
  /** Member-level exclusions counted per retrieval pass (one member can count many times). */
  memberExclusions: Record<string, number>;
  rejectedBy: Record<string, number>; passedHardFilters: number; deduped: number;
  floorViolations: Record<string, number>; dealbreakers: number; belowThreshold: number;
  eligible: number; budgetSkips: number; selected: number; exploration: number;
}
export interface MatchingRunLog {
  runId: string; seed: number; configHash: string; inputHash: string; now: number;
  engineVersion: string; embedModel: string; judgeModel?: string;
  funnel: FunnelLog;
  scored: { key: string; generator: string; participants: MemberId[]; components: ScoreComponents; score: number; eligible: boolean; reason?: string; judged: boolean }[];
  judge: { calls: number; cacheHits: number; failures: number; verdicts: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[] };
  proposalsByGenerator: Record<string, number>;
  fairness: FairnessMetrics;
  emptyStates: { intentId: string; memberId: MemberId; reason: string }[];
  timingsMs: Record<string, number>;
  /** Diagnostic only: unselected eligible pairs whose score beats what both members got. */
  blockingPairs: number;
  /** Updated exposure debt to persist for the next run. */
  exposureDebt: Record<MemberId, number>;
}
