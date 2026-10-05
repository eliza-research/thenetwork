// Shared domain contract (PRD Sections 13.1, 32.4, 32.10, 33). Keep small and generic.
export type MemberId = string;
export type City = "sf" | "nyc";
export type ParticipationState = "open" | "normal" | "quiet" | "receiving" | "paused";
export type PrivacyScope = "agent_private" | "matchable" | "shareable" | "opportunity_specific";
export type Provenance = "said" | "connected_source" | "inferred" | "vouched";
export type FacetKind =
  | "interest" | "skill" | "offer" | "desire" | "goal" | "boundary"
  | "trait" | "fact" | "resource" | "preference" | "availability_pattern";
export type Category = "social" | "professional" | "romance" | "hobby" | "help" | "events" | "growth";

export interface Facet {
  id: string; memberId: MemberId; kind: FacetKind; value: string;
  tags: string[]; scope: PrivacyScope; provenance: Provenance; confidence: number;
  embedding?: number[]; validFrom?: number; validTo?: number;
}
export interface Intent {
  id: string; memberId: MemberId; objective: string; category: Category;
  details?: string; desiredPeople?: string; horizonDays: number;
  status: "active" | "paused" | "closed"; createdAt: number; embedding?: number[];
}
export interface Presence {
  memberId: MemberId; city: City; type: "home" | "routine" | "temporary";
  areas: string[]; // neighborhood names or H3 cells
  from?: number; to?: number;
}
export interface Preferences {
  categoriesOptIn: Category[]; quietHours: [number, number]; // local hours [start,end)
  romanceOptIn: boolean; formats: ("one_to_one" | "small_group" | "event")[];
  maxTravelMinutes: number; onlyWhenAsked: boolean;
}
export interface Member {
  id: MemberId; name: string; homeCity: City; state: ParticipationState;
  prefs: Preferences; invitedBy?: MemberId; joinedAt: number; age: number;
  unansweredProactive: number; // two-unanswered rule (F28)
}
export type EdgeType =
  | "invited_by" | "vouched_for" | "knows" | "met" | "introduced" | "helped" | "hosted"
  | "enjoyed" | "would_interact_again" | "group_only" | "avoid" | "blocked";
export interface Edge {
  from: MemberId; to: MemberId; type: EdgeType; strength: number;
  explicit: boolean; createdAt: number;
}
export type OpportunityKind =
  | "intro" | "group" | "event_coattend" | "help" | "member_intro"
  | "newcomer_welcome" | "network_growth" | "second_encounter" | "expansion";
export interface ScoreComponents {
  fit: number; mutualBenefit: number; warmPath: number; novelty: number; timingFit: number;
  activationCost: number; interruptionCost: number; load: number; repetition: number;
  socialRisk: number; confidence: number;
}
export interface Proposal {
  id: string; kind: OpportunityKind; participants: MemberId[]; alternates: MemberId[];
  objective: string; city: City; window?: { start: number; end: number };
  score: number; components: ScoreComponents; exploration: boolean;
  explanations: Record<MemberId, string>; // shareable reasons only
  generator: string; createdAt: number;
}
export type OpportunityState =
  | "DRAFT" | "PROPOSED" | "IN_REVIEW" | "APPROVED" | "INVITING" | "PARTIALLY_ACCEPTED"
  | "MUTUALLY_ACCEPTED" | "QUORUM_MET" | "SCHEDULING" | "SCHEDULED" | "RESCHEDULE_REQUESTED"
  | "NEEDS_REPLACEMENT" | "IN_PROGRESS" | "COMPLETED" | "FEEDBACK_COLLECTED"
  | "REJECTED_IN_REVIEW" | "DECLINED" | "EXPIRED" | "QUORUM_FAILED" | "CANCELLED"
  | "SAFETY_HOLD" | "DISPUTED" | "ABANDONED";

/** Snapshot the engine reads. Built from Postgres in production, from the simulator in tests. */
export interface WorldSnapshot {
  now: number; members: Member[]; facets: Facet[]; intents: Intent[];
  presence: Presence[]; edges: Edge[]; recentProposals: Proposal[];
}
