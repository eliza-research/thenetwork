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
  /** Invitees who said yes (engine-visible responsiveness history; v1.2 acceptance estimate). */
  acceptedBy?: MemberId[];
  /** Invitees who were asked but never answered before the invite expired. */
  noResponse?: MemberId[];
}
/** An opportunity the Network already sent and that is still open (invite pending or meeting ahead). */
export interface OpenOpportunity {
  id: string; participants: MemberId[]; stage: "inviting" | "scheduled";
  /** Invite expiry or meeting time (epoch ms), if known. */
  until?: number;
}
/** A question the agent asked a member instead of proposing (engine output "ask"; v1.2). */
export interface AskRecord {
  memberId: MemberId; at: number; reason: AskReason;
  /** When the member replied. An answered question is closed: the member is proposed normally again. */
  answeredAt?: number;
}
export type AskReason = "no_structured_want" | "few_facets" | "romance_prefs";
/**
 * Engine output "ask": a question to send to a member before proposing anyone to them, because
 * the engine cannot yet match them well (no structured want, too few matchable facets, or no
 * stated romance preferences). Text is a fixed template about the member's own profile; it never
 * names or describes another member.
 */
export interface EngineAsk {
  kind: "ask"; id: string; memberId: MemberId; reason: AskReason; question: string; createdAt: number;
  /** The romance intent the preferences are for (reason "romance_prefs"). */
  intentId?: string;
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
  /**
   * Opportunities already sent and still open (v1.2, config.dispatch.skipOpenOpportunities):
   * their participants are not proposed again until they close.
   */
  openOpportunities?: OpenOpportunity[];
  /**
   * Ids of `recentProposals` the Network recorded but never sent (v1.2, config.dispatch.billOnlySent):
   * they do not count against budgets and do not block the pair.
   */
  unsentProposalIds?: string[];
  /** Questions asked recently (v1.2, config.ask): a member is not asked again within the cooldown. */
  recentAsks?: AskRecord[];
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
  /** Structured risk markers (e.g. an event's riskTags): any entry makes the candidate high-risk. */
  riskFlags?: string[];
  /** Evidence quality when it does not come from facets (e.g. mutual feedback, graph position). */
  confidenceHint?: number;
}
export interface GroupStats { avgPairwise: number; minBest: number; roleCoverage: number; warmTies: number; clusterDiversity: number; overlapHours: number }

export interface JudgeVerdict {
  fit: number; mutualValue: number; capacityRealism: number; timing: number; socialComfort: number;
  redFlags: number; dealbreaker: boolean; dealbreakerReason?: string; certainty: number;
  /** Member-facing text per participant (shareable only; explain.ts re-checks it for leaks). */
  why: Record<MemberId, string>; model?: string;
  /** Pass-2 (judge-v2) fields. Internal only: never shown to members. Optional for older verdicts. */
  reasoning?: string; citedFacts?: { ref: string; field: string; fact: string }[];
  verdict?: "yes" | "no"; matchProbability?: number; reasoningFirst?: boolean;
}

export interface EngineProposal extends Proposal {
  category: Category; roles: Record<MemberId, Role>; expiresAt: number; anchor?: Anchor; via?: MemberId;
  safetyClass: SafetyClass; threshold: number; channels: string[]; judged: boolean;
  /** Off-policy logging: selector rank and probability this proposal was selected (1 for greedy picks). */
  selectorRank: number; selectionProbability: number;
  /**
   * Estimated P(each participant says yes), engine-visible data only (world.ts acceptanceOf).
   * Additive (attention budget, D13): the send-time layer orders items by E x sqrt(P_acc).
   */
  acceptance?: Record<MemberId, number>;
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
  /** v1.2: questions emitted this run, and members held back from proposals while a question is open. */
  asks?: number; askFirst?: number;
  /** Selected configurations withheld by the final policy guard (should always be absent). */
  rejectedAfterSelection?: Record<string, number>;
}
export interface MatchingRunLog {
  runId: string; seed: number; configHash: string; inputHash: string; now: number;
  engineVersion: string; embedModel: string; judgeModel?: string;
  funnel: FunnelLog;
  /** `complementarity`: the structured pair value blended into fit (absent when not applied). */
  scored: { key: string; generator: string; participants: MemberId[]; components: ScoreComponents; score: number; eligible: boolean; reason?: string; judged: boolean; complementarity?: number }[];
  /** Pass 2 (rubric judge) stats and verdicts, plus optional pass 1 (screen) and pass 3 (deep review). */
  judge: {
    calls: number; cacheHits: number; failures: number; verdicts: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[];
    screen?: { calls: number; cacheHits: number; failures: number; verdicts: { key: string; cacheKey: string; verdict: unknown; cached: boolean }[] };
    deep?: {
      calls: number; cacheHits: number; failures: number;
      verdicts: {
        key: string; verdict: "yes" | "no" | "insufficient_information"; matchProbability: number; rubric: Record<string, number>;
        /** Internal synthesis (redacted, truncated). Never shown to members. */
        reasoning: string; hardGate?: string;
        /** The one clarifying question for "insufficient_information" (only if it passed the leak gate). */
        question?: { memberId?: MemberId; question: string };
        memberFacingRejected: number;
      }[];
    };
  };
  proposalsByGenerator: Record<string, number>;
  fairness: FairnessMetrics;
  emptyStates: { intentId: string; memberId: MemberId; reason: string }[];
  timingsMs: Record<string, number>;
  /** Diagnostic only: unselected eligible pairs whose score beats what both members got. */
  blockingPairs: number;
  /** Updated exposure debt to persist for the next run. */
  exposureDebt: Record<MemberId, number>;
}

// ------------------------------------------------------------------------------------------------
// Attention budget data model (docs/design/2026-10-07-experience-design.md 1.2; engine-local first,
// proposed for promotion into core). Functions live in attention.ts.

export type ItemKind = "intro_probe" | "plan_probe" | "group_probe" | "event_suggestion" | "place_suggestion"
  | "help_ask" | "advice_route" | "profiling_question" | "reconfirm" | "worthwhile_check" | "nothing_yet";
export type Effort = "glance" | "reply" | "meet_short" | "meet_long" | "contribute";

/** One thing the Network could tell a member about. Several items can share one message (D1). */
export interface AttentionItem {
  id: string; memberId: MemberId; kind: ItemKind; category: Category;
  /** Engine proposal, plan, or concierge result this item comes from. */
  sourceProposalId?: string;
  /** Other members this item involves (empty for outside-world items and solo plans). Never shown before the reveal (D5). */
  others: MemberId[];
  /** true => human review before the first probe (under 1,000 members). */
  involvesMember: boolean;
  effort: Effort;
  /** Ê: calibrated P(worthwhile | it happens), 0..1. */
  enjoy: number;
  /** P̂acc: P(member says yes), 0..1. */
  accept: number;
  urgency: { expiresAt: number; bestBy?: number };
  createdAt: number; reviewState: "not_needed" | "pending" | "approved" | "rejected";
  /** Same opportunity re-proposed on a later engine run => same key (hold-queue dedupe). */
  key: string;
  /** Consent-first order (1.8): "first" = the member with the live want; "partner" = probed after the first said yes. */
  stage?: "first" | "partner";
  /** Expected value of information (profiling_question / reconfirm only; w_kind is capped by it). */
  evi?: number;
}

export type HoldReason = "cap" | "below_send_value" | "quiet_hours" | "awaiting_review" | "only_when_asked" | "digest_wait";
export interface HeldItem extends AttentionItem {
  heldReason: HoldReason;
  heldAt: number;
  /** Re-run eligibility (age, blocks, holds, open opportunities) before any send and at least this often. */
  revalidateAt: number;
}

/** Explicit cadence preferences, set by the member in plain language (F20). */
export interface CadencePrefs {
  mode: "digest" | "as_it_comes" | "only_when_great" | "only_when_asked";
  /** JavaScript weekdays (0 = Sunday); default [4] (Thursday). */
  digestDays: number[]; digestHour: number;
  /** Weekly slots, or monthly (the first matching weekday of the month; Quiet). */
  digestPeriod: "week" | "month";
  /** "more of X" 1.5, "less of Y" 0.5, off 0. */
  categoryWeight: Partial<Record<Category, number>>;
  maxItemsPerDigest: 1 | 2 | 3;
  /** D10: default false. */
  romanceInDigest: boolean;
  /**
   * An explicit member request for a different number of interruptions per period (D11). It can
   * lower the state cap or restore it, never exceed it.
   */
  capOverride?: number;
}

/** Learned, engine-visible only. Learning can only make the Network quieter (D11). */
export interface Responsiveness {
  replyRateByHour: number[];
  medianLatencyMin: number;
  acceptRate: { yes: number; n: number };
  /** Annoyance multiplier r in [0.5, 3] (1.3). */
  annoyance: number;
}

export type LedgerKind = "digest" | "break_in" | "probe" | "question" | "logistics" | "reply" | "notice" | "reengage";
export type ReplyKind = "pick" | "none" | "more" | "less" | "stop" | "tapback" | "other";
/** One per outbound message (1.2). */
export interface AttentionLedgerEntry {
  messageId: string; memberId: MemberId; at: number; kind: LedgerKind;
  itemIds: string[]; countsAgainstCap: boolean;
  repliedAt?: number; replyKind?: ReplyKind;
}
