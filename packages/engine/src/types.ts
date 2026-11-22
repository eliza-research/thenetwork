import type {
  Category, City, MemberId, OpenOpportunity, OpportunityKind, Proposal, ScoreComponents, WorldSnapshot,
} from "@thenetwork/core";

import type { LaneSide, MatchLane } from "../../core/src/generated/matchLane.ts";
import type { EntityId } from "./match/profile.ts";

export type { NetworkEvent } from "@thenetwork/core";
export interface SafetyHold { memberId: MemberId; from: number; to?: number; reason?: string }
export interface FeedbackRecord {
  id: string; from: MemberId; about: MemberId; opportunityId?: string; at: number;
  sentiment: "positive" | "neutral" | "negative"; wouldMeetAgain?: boolean;
  repeatConsent?: true;
  processed?: boolean;
}
type InteractionOutcome =
  | "pending" | "accepted" | "declined" | "expired" | "completed" | "cancelled" | "no_show";
export interface InteractionRecord {
  id: string; kind: OpportunityKind; category: Category; participants: MemberId[];
  at: number; outcome: InteractionOutcome; declinedBy?: MemberId[]; contributors?: MemberId[];
  acceptedBy?: MemberId[];
  noResponse?: MemberId[];
}
export type { OpenOpportunity } from "@thenetwork/core";
export interface AskRecord {
  memberId: MemberId; at: number; reason: AskReason;
  answeredAt?: number;
}
export type AskReason = "no_structured_want" | "few_facets" | "romance_prefs" | (string & {});
export interface EngineAsk {
  kind: "ask"; id: string; memberId: MemberId; reason: AskReason; question: string; createdAt: number;
  intentId?: string;
}
export interface ReliabilityEvidence { noShows: number; completedSinceLastNoShow: number }

export type RecentProposal = Proposal & { roles?: Record<MemberId, Role> };

export interface MemberStandingRow {
  readonly memberId: MemberId;
  readonly lane: MatchLane;
  readonly side: LaneSide;
  readonly value: number;
  readonly observedAt: number;
  readonly evidenceIds: readonly string[];
}

export interface EngineInput extends WorldSnapshot {
  recentProposals: RecentProposal[];
  memberStanding?: readonly MemberStandingRow[];
  standingIntentSearch?: string[];
  safetyHolds?: SafetyHold[];
  feedback?: FeedbackRecord[];
  interactions?: InteractionRecord[];
  idAliases?: Record<string, MemberId>;
  reliability?: Record<MemberId, ReliabilityEvidence>;
  categoryQuotas?: Record<MemberId, Partial<Record<Category, number>>>;
  exposureDebt?: Record<MemberId, number>;
  openOpportunities?: OpenOpportunity[];
  unsentProposalIds?: string[];
  recentAsks?: AskRecord[];
}

export type Role =
  | "initiator" | "seeker" | "provider" | "peer" | "helper" | "host" | "guest" | "newcomer"
  | "connector" | "attendee";
export const CONTRIBUTOR_ROLES: ReadonlySet<Role> = new Set<Role>(["provider", "helper", "host", "connector"]);
type SafetyClass = "low" | "medium";
export type Format = "one_to_one" | "small_group" | "event";

export interface Anchor { type: "intent" | "event" | "interest" | "interaction" | "gap" | "member"; id: string; label?: string }

export interface Candidate {
  key: string; kind: OpportunityKind; generator: string; category: Category;
  participants: MemberId[]; roles: Record<MemberId, Role>; format: Format;
  objective: string; anchor?: Anchor; via?: MemberId;
  preferredCity?: City; fixedWindow?: { start: number; end: number };
  city?: City; window?: { start: number; end: number };
  channels: Set<string>;
  evidence: Record<MemberId, string[]>;
  fit: number; benefit: Record<MemberId, number>;
  warm: number; alternates: MemberId[]; exploration: boolean; safetyClass: SafetyClass;
  timeSensitive: boolean; riskText: string; groupStats?: GroupStats;
  riskFlags?: string[];
  confidenceHint?: number;
  lane?: MatchLane;
  entities?: Record<MemberId, EntityId>;
  cofounderIntents?: Readonly<Record<MemberId, string>>;
}
export interface GroupStats { avgPairwise: number; minBest: number; roleCoverage: number; warmTies: number; clusterDiversity: number; overlapHours: number }

export interface JudgeVerdict {
  fit: number; mutualValue: number; capacityRealism: number; timing: number; socialComfort: number;
  redFlags: number; dealbreaker: boolean; dealbreakerReason?: string; certainty: number;
  why: Record<MemberId, string>; model?: string;
  reasoning?: string; citedFacts?: { ref: string; field: string; fact: string }[];
  verdict?: "yes" | "no"; matchProbability?: number; reasoningFirst?: boolean;
}

export interface EngineProposal extends Proposal {
  category: Category; roles: Record<MemberId, Role>; expiresAt: number; anchor?: Anchor; via?: MemberId;
  lane?: MatchLane; entities?: Candidate["entities"]; cofounderIntents?: Candidate["cofounderIntents"];
  safetyClass: SafetyClass; threshold: number; channels: string[]; judged: boolean;
  selectorRank: number; selectionProbability: number;
  acceptance?: Record<MemberId, number>;
}

export interface FairnessMetrics {
  eligibleMembers: number; membersWithProposal: number; zeroExposureShare: number;
  gini: number; top10Share: number; newcomerShare: number; newcomerCoverage: number;
  lowExposureCoverage: number; byCity: Record<string, number>; byInviterCluster: Record<string, number>;
  maxPerMember: number;
  lorenz: number[];
  viableCoverage: number;
}
interface FunnelLog {
  generated: number; byGenerator: Record<string, number>;
  memberFunnel: Record<string, number>;
  memberExclusions: Record<string, number>;
  rejectedBy: Record<string, number>; passedHardFilters: number; deduped: number;
  floorViolations: Record<string, number>; dealbreakers: number; belowThreshold: number;
  eligible: number; budgetSkips: number; selected: number; exploration: number;
  asks?: number; askFirst?: number;
  rejectedAfterSelection?: Record<string, number>;
}
export interface MatchingRunLog {
  runId: string; seed: number; configHash: string; inputHash: string; now: number;
  engineVersion: string; embedModel: string; judgeModel?: string;
  funnel: FunnelLog;
  scored: { key: string; generator: string; participants: MemberId[]; components: ScoreComponents; score: number; eligible: boolean; reason?: string; judged: boolean }[];
  judge: {
    calls: number; cacheHits: number; failures: number; verdicts: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[];
    screen?: { calls: number; cacheHits: number; failures: number; verdicts: { key: string; cacheKey: string; verdict: unknown; cached: boolean }[] };
    coverage?: { selected: number; judged: number };
    deep?: {
      calls: number; cacheHits: number; failures: number;
      verdicts: {
        key: string; verdict: "yes" | "no" | "insufficient_information"; matchProbability: number; rubric: Record<string, number>;
        reasoning: string; hardGate?: string;
        question?: { memberId?: MemberId; question: string };
        memberFacingRejected: number;
      }[];
    };
  };
  proposalsByGenerator: Record<string, number>;
  fairness: FairnessMetrics;
  emptyStates: { intentId: string; memberId: MemberId; reason: string }[];
  timingsMs: Record<string, number>;
  blockingPairs: number;
  exposureDebt: Record<MemberId, number>;
  search?: SearchTally;
  searchOutcomes?: SearchOutcome[];
}
export interface SearchTally {
  members: number; checks: number; touches: number; exact: number; budgeted: number; empty: number; largestUnseenBound: number;
  bounds?: number; checksAfterSettled?: number; boundViolations?: number; packBoundViolations?: number; classCapViolations?: number;
  touchClosed?: number; checkClosed?: number; memoHits?: number; refusals?: Record<string, number>;
}
export interface SearchOutcome { memberId: MemberId; lane: MatchLane; outcome: "empty" | "budgeted"; unseenBound: number }

export type ItemKind = "intro_probe" | "plan_probe" | "group_probe" | "event_suggestion" | "place_suggestion"
  | "help_ask" | "advice_route" | "profiling_question" | "reconfirm" | "worthwhile_check" | "nothing_yet";
export type Effort = "glance" | "reply" | "meet_short" | "meet_long" | "contribute";

export interface AttentionItem {
  id: string; memberId: MemberId; kind: ItemKind; category: Category;
  sourceProposalId?: string;
  others: MemberId[];
  involvesMember: boolean;
  effort: Effort;
  enjoy: number;
  accept: number;
  urgency: { expiresAt: number; bestBy?: number };
  createdAt: number; reviewState: "not_needed" | "pending" | "approved" | "rejected";
  key: string;
  stage?: "first" | "partner";
  evi?: number;
}

export type HoldReason = "cap" | "below_send_value" | "quiet_hours" | "awaiting_review" | "only_when_asked" | "digest_wait";
export interface HeldItem extends AttentionItem {
  heldReason: HoldReason;
  heldAt: number;
  revalidateAt: number;
}

export interface CadencePrefs {
  mode: "digest" | "as_it_comes" | "only_when_great" | "only_when_asked";
  digestDays: number[]; digestHour: number;
  digestPeriod: "week" | "month";
  categoryWeight: Partial<Record<Category, number>>;
  maxItemsPerDigest: 1 | 2 | 3;
  romanceInDigest: boolean;
  capOverride?: number;
  sendHours?: { weekday: number; weekend: number };
}

export interface Responsiveness {
  replyRateByHour: number[];
  medianLatencyMin: number;
  acceptRate: { yes: number; n: number };
  annoyance: number;
}

export type LedgerKind = "digest" | "break_in" | "probe" | "question" | "logistics" | "reply" | "notice" | "reengage";
type ReplyKind = "pick" | "none" | "more" | "less" | "stop" | "tapback" | "other";
export interface AttentionLedgerEntry {
  messageId: string; memberId: MemberId; at: number; kind: LedgerKind;
  itemIds: string[]; countsAgainstCap: boolean;
  repliedAt?: number; replyKind?: ReplyKind;
}
