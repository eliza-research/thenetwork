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

/**
 * Where a facet came from (PRD 9.3, 32.5). "chat" = the member said it to the agent; "vouch" = an
 * inviter's vouch note; the rest are sources the member connected (OAuth, a profile URL they gave,
 * a pasted AI-memory summary) or public profiles OF THE MEMBER THEMSELVES that the Network found
 * with their consent and they confirmed. Never profiles of non-members (PRD 13.3, 27).
 */
export type SourceKind =
  | "chat" | "vouch" | "ai_memory" | "gmail" | "google_calendar" | "linkedin" | "x" | "instagram"
  | "github" | "strava" | "spotify" | "eventbrite" | "partiful" | "luma" | "personal_website";
/** Sensitive inference categories: always agent_private, never matchable or shareable. */
export type SensitiveCategory = "health" | "finances" | "religion" | "sexuality" | "relationship" | "children";

export interface Facet {
  id: string; memberId: MemberId; kind: FacetKind; value: string;
  tags: string[]; scope: PrivacyScope; provenance: Provenance; confidence: number;
  embedding?: number[]; validFrom?: number; validTo?: number;
  // ---- optional provenance detail (additive; absent on older data) ----
  /** Channel the facet came from. */
  source?: SourceKind;
  /** When the underlying evidence was observed (ms). now - observedAt = staleness. */
  observedAt?: number;
  /** true = derived/guessed from evidence; false = stated by the member (or a source field verbatim). */
  inferred?: boolean;
  /** The member reviewed and confirmed it ("What the Network knows about me"). */
  confirmedByMember?: boolean;
  /** Set on sensitive inferences; such facets are always scope agent_private. */
  sensitive?: SensitiveCategory;
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
/** How a source was linked: OAuth, a profile URL the member gave, a paste, or a found-and-confirmed public profile. */
export type SourceLink = "oauth" | "profile_url" | "paste" | "found_profile";
/**
 * connected / confirmed: active, produces facets. pending_confirmation: a found profile the member
 * has not confirmed yet (no facets). rejected: a found profile the member said is not them (a
 * namesake; nothing about it is kept). revoked: disconnected by the member (its facets are deleted).
 */
export type SourceStatus = "connected" | "confirmed" | "pending_confirmation" | "rejected" | "revoked";
export interface ConnectedSourceSummary {
  source: Exclude<SourceKind, "chat" | "vouch">;
  link: SourceLink;
  status: SourceStatus;
  /** Sources only ever describe the member themselves. */
  subject: "self";
  connectedAt: number;
  lastSyncAt?: number;
  /** Facets currently derived from this source (0 unless connected/confirmed). */
  observations: number;
}
export interface Member {
  id: MemberId; name: string; homeCity: City; state: ParticipationState;
  prefs: Preferences; invitedBy?: MemberId; joinedAt: number; age: number;
  unansweredProactive: number; // two-unanswered rule (F28)
  /** Consented sources (additive; absent on older data). */
  connectedSources?: ConnectedSourceSummary[];
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
  objective: string; category?: Category; city: City; window?: { start: number; end: number };
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
