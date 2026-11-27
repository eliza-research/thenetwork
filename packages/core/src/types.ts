import type { WorkIntroChannel } from "./generated/workIntroChannel.ts";

export type { WorkIntroChannel };

export type MemberId = string;
export const LAUNCH_CITIES = ["sf", "nyc", "la", "chicago", "miami"] as const;
export type City = (typeof LAUNCH_CITIES)[number];
export type LaunchCity = City;
/** Open city identifier for data-driven city expansion without widening exhaustive Record<City, ...> maps. */
export type CityId = string;
/** Per-city launch lifecycle status; only nyc defaults to active until staff flips another city live. */
export type CityLaunchStatus = "active" | "waitlist" | "planned";
export const isCity = (v: unknown): v is City =>
  typeof v === "string" && (LAUNCH_CITIES as readonly string[]).includes(v);
export const isLaunchCity = isCity;
export type NetworkCity = City;
export type ParticipationState = "open" | "normal" | "quiet" | "receiving" | "paused";
/**
 * The app a membership, fact or opportunity belongs to (PRD 40.3: one person, a membership per app).
 * Optional everywhere: absent means the single-app Network ("ntwrk"). Facts, names and contact
 * details learned in one app must never reach a message sent in another (judge: cross_app_leak).
 */
export const APP_IDS = ["ntwrk", "slop", "peon", "friends"] as const;
export type AppId = (typeof APP_IDS)[number];
export const isAppId = (v: unknown): v is AppId => typeof v === "string" && (APP_IDS as readonly string[]).includes(v);
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
  /** App the facet was learned in (absent = "ntwrk"). */
  app?: AppId;
}
export interface Intent {
  id: string; memberId: MemberId; objective: string; category: Category;
  details?: string; desiredPeople?: string; horizonDays: number;
  status: "active" | "paused" | "closed"; createdAt: number; embedding?: number[];
  /** The app that owns a verified, app-scoped intent. Legacy projections can omit it. */
  app?: AppId;
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
  /** Apps this person has a membership in (absent = ["ntwrk"]). */
  apps?: AppId[];
  birthKey?: number;
  birthExact?: boolean;
  ageConflict?: boolean;
  teenBarred?: boolean;
  teenHeld?: boolean;
  teenReady?: boolean;
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
  /** App the opportunity belongs to (absent = "ntwrk"). */
  app?: AppId;
}
export type OpportunityState =
  | "DRAFT" | "PROPOSED" | "IN_REVIEW" | "APPROVED" | "INVITING" | "PARTIALLY_ACCEPTED"
  | "MUTUALLY_ACCEPTED" | "QUORUM_MET" | "SCHEDULING" | "SCHEDULED" | "RESCHEDULE_REQUESTED"
  | "NEEDS_REPLACEMENT" | "IN_PROGRESS" | "COMPLETED" | "FEEDBACK_COLLECTED"
  | "REJECTED_IN_REVIEW" | "DECLINED" | "EXPIRED" | "QUORUM_FAILED" | "CANCELLED"
  | "SAFETY_HOLD" | "DISPUTED" | "ABANDONED";

/** An opportunity the Network already sent and that is still open (invite pending or meeting ahead). */
export interface OpenOpportunity {
  id: string; participants: MemberId[]; stage: "inviting" | "scheduled";
  /** Invite expiry or meeting time (epoch ms), if known. */
  until?: number;
}

/** A public event in the matching market. A published listing includes its actual public venue. */
export interface NetworkEvent {
  id: string; title: string; description?: string; city: City; area?: string;
  start: number; end: number; tags: string[]; category: Category; capacity?: number;
  riskTags?: string[];
  listing?: { url: string; venue: string; lat: number; lng: number };
}

export interface ReliabilityEvidence {
  readonly noShows: number;
  readonly completedSinceLastNoShow: number;
  readonly strikes?: number;
  readonly lateCancels4h?: number;
  readonly lateCancels24h?: number;
  readonly rescheduleChurn?: number;
  readonly resolved90d?: number;
  readonly completed90d?: number;
  readonly provisionalNoShow?: boolean;
}

export interface QualitySignals {
  readonly provenanceScore: number;
  readonly specificityScore: number;
  readonly hygieneScore: number;
  readonly completionScore: number;
  readonly voipOrPumping: boolean;
  readonly sybilFlagged: boolean;
  readonly chronicLowEffort: boolean;
  readonly unverifiedHype: boolean;
  readonly newcomerDays: number;
}

export interface VampireTelemetry {
  readonly introsReceived90d: number;
  readonly positiveCounterpartVotes90d: number;
  readonly asymmetricNegativeVotes90d: number;
  readonly pitchSignals90d: number;
  readonly distinctSelfPromoReports90d: number;
}

/** Snapshot the engine reads. Built from Postgres in production, from the simulator in tests. */
export interface WorldSnapshot {
  now: number; members: Member[]; facets: Facet[]; intents: Intent[];
  presence: Presence[]; edges: Edge[]; recentProposals: Proposal[];
  events?: NetworkEvent[];
  teenIntros?: boolean;
  qualityByMember?: Record<MemberId, QualitySignals>;
  vampireByMember?: Record<MemberId, VampireTelemetry>;
}

// ---- Five-city registry, curated venues, arrival coordination, follow-ups and work intros ----

export type VenueStatus = "active" | "suspect_closed" | "closed_temporary" | "closed_permanent";
export type ProviderClosureSignal = "ProviderOpen" | "ProviderTemporaryClosed" | "ProviderPermanentClosed";
export type VenueCategory =
  | "food_hall"
  | "coffee_shop"
  | "bakery_cafe"
  | "brewery"
  | "brewery_garden"
  | "park"
  | "waterfront_park"
  | "bookstore_cafe"
  | "diner"
  | "wine_bar"
  | "cocktail_bar"
  | "cocktail_lounge"
  | "cafe_tea_bar"
  | "wine_beer_patio"
  | "coffee_casual"
  | "game_store"
  | "board_game_cafe"
  | "climbing_gym"
  | "tea_house"
  | "museum_gallery"
  | "bowling_arcade"
  | "community_space"
  | "casual_bistro"
  | "dessert_cafe";
/** 0 = free, 1 = $, 2 = $$, 3 = $$$, 4 = $$$$. */
export type VenuePriceTier = 0 | 1 | 2 | 3 | 4;
export type VenueNoiseLevel = "quiet" | "conversational" | "lively" | "loud";
export type NoiseLevel = VenueNoiseLevel;
export type VenueFeedbackOutcome = "great" | "ok" | "too_loud" | "crowded" | "closed" | "bad_vibe" | "too_expensive";

/** Structured weekly opening slot. `weekday`: Monday = 0 ... Sunday = 6; minutes from local midnight (closeMin > 1440 = past midnight). */
export interface VenueHoursSlot {
  weekday: number;
  openMin: number;
  closeMin: number;
}

/** Beta distribution parameters for per-archetype venue taste learning. */
export interface VenuePersonaPrior {
  alpha: number;
  beta: number;
}

export type VenueSource = "curated" | "seed" | "google_places" | "places_api" | "overture" | "listing" | "bd_partner" | "member_suggested";

export interface VenueRecord {
  id: string;
  name: string;
  city: CityId;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  category: VenueCategory;
  /** Public third-party venues only; never private residences. */
  public: true;
  status: VenueStatus;
  priceTier: VenuePriceTier;
  ageMin?: number;
  /** All-ages mark for teenFriendAgeRule compliance (true only for non-bar, non-alcohol-centric places open at <= 13). */
  allAges?: boolean;
  isBarOnly: boolean;
  alcoholOptional: boolean;
  servesVegetarian: boolean;
  servesVegan: boolean;
  wheelchairAccessible: boolean;
  separateChecks: boolean;
  walkInGroupCapacity: number;
  reservationRequired: boolean;
  noiseLevel: VenueNoiseLevel;
  liveMusicAtNight: boolean;
  indoor: boolean;
  outdoor: boolean;
  weatherSensitive: boolean;
  arrivalLandmark: string;
  hours: VenueHoursSlot[];
  yelpRating?: number;
  externalPlaceId?: string;
  source: VenueSource;
  lastVerifiedAt: number;
  geoExpiresAt?: number;
  closureReports: number;
  quarantinedUntil?: number;
  safetyScore?: number;
  transitScore?: number;
  isAlcoholCentric?: boolean;
  halalFriendly?: boolean;
  kosherFriendly?: boolean;
  glutenFreeFriendly?: boolean;
  severeAllergenSafe?: boolean;
  isSmokeFree?: boolean;
  openEventEligible?: boolean;
  hobbies?: string[];
  cuisineTags?: string[];
  personaPriors: Record<string, VenuePersonaPrior>;
}

export interface VenueFeedbackReport {
  venueId: string;
  memberId: MemberId;
  at: number;
  outcome: VenueFeedbackOutcome;
  reportedClosed: boolean;
  providerCode?: ProviderClosureSignal;
  providerConfirmedStatus?: "operational" | "closed_temporary" | "closed_permanent";
}

export interface MemberVenuePrefs {
  memberId: MemberId;
  age: number;
  drinksAlcohol: boolean;
  strictSober?: boolean;
  vegetarian: boolean;
  vegan: boolean;
  halal?: boolean;
  kosher?: boolean;
  glutenFree?: boolean;
  severeAllergen?: boolean;
  wheelchairNeeded: boolean;
  lowWalking?: boolean;
  smokingFriendly?: boolean;
  smokeFree?: boolean;
  lowNoiseRequired?: boolean;
  daytimeOnly?: boolean;
  maxBudgetTier: VenuePriceTier;
  maxTravelMinutes?: number;
  visitedVenueIds: string[];
  rejectedVenueIds: string[];
  archetype?: string;
  hobbies?: string[];
  cuisinePrefs?: string[];
  optedIntoActivityDates?: boolean;
}

export interface VenueCandidateResult {
  venue: VenueRecord;
  score: number;
  rubricScore: number;
  budgetFitScore: number;
  personaScore: number;
  maxTravelMinutes: number;
  meanTravelMinutes: number;
  needsOpenCheck: boolean;
}

export type ArrivalState =
  | "en_route"
  | "late"
  | "arrived"
  | "seated"
  | "met"
  | "venue_closed"
  | "venue_full"
  | "cannot_find";
export type MeetupPhase = "before" | "pre_brief" | "active_arrival" | "closed";
export type NoShowAction = "wait" | "ping_late" | "notify_waiting" | "done";

export interface ArrivalUpdate {
  meetupId: string;
  memberId: MemberId;
  state: ArrivalState;
  at: number;
  etaMinutes?: number;
  safeOutfitCue?: string;
  spotLandmark?: string;
}

export interface FollowupSchedule {
  scheduledAt: number;
  localHour: number;
  localMinute: number;
  nextDay: boolean;
  reminderAt: number;
  maxReminders: number;
}

export interface WorkIntroState {
  introId: string;
  app: AppId;
  candidateId: MemberId;
  managerId: MemberId;
  candidateOptIn: boolean;
  managerOptIn: boolean;
  channel: WorkIntroChannel;
  emailSentAt?: number;
  videoSlotAt?: number;
  videoUrl?: string;
  followupDueAt?: number;
  completedAt?: number;
}

export interface CityZone {
  id: string;
  name: string;
}

export interface NeighborhoodSpec {
  name: string;
  zone: string;
  lat: number;
  lng: number;
  aliases: string[];
  /** Relative venue hub density (1..10) used as a tie-breaking supply bonus for fair midpoints. */
  hubSupply: number;
}

export type CityNeighborhood = NeighborhoodSpec;

export interface CityBarrier {
  fromZone: string;
  toZone: string;
  penaltyMinutes: number;
  reason: string;
}

export interface CitySpec {
  id: CityId;
  name: string;
  shortName: string;
  tz: string;
  country?: string;
  currency?: string;
  launchStatus?: CityLaunchStatus;
  primaryMode: "transit" | "car" | "hybrid";
  anchorZip: string;
  aliases: string[];
  center: { lat: number; lng: number };
  dateMaxMinutes: number;
  groupMaxMinutes: number;
  kmPerMinute: number;
  baseMinutes: number;
  zones: CityZone[];
  neighborhoods: NeighborhoodSpec[];
  barriers: CityBarrier[];
  seedVenues: VenueRecord[];
}

export type MeetingModality = "irl_venue" | "async_or_video" | "sanctioned_event";

export interface ConnectionOntologySpecLike {
  readonly id: string;
  readonly label?: string;
  readonly defaultCategory: Category;
  readonly defaultFormat: "one_to_one" | "small_group" | "event";
  readonly sizeRange: readonly [number, number];
  readonly defaultFreeAnchor: boolean;
  readonly requiresHighDiscretion: boolean;
  readonly adultOnly?: boolean;
}

export interface OutcomePolicyProfile {
  readonly app: AppId;
  readonly ontologyId: string;
  readonly modality: MeetingModality;
  readonly venueMode: "date" | "group" | "solo" | "professional";
  readonly adultOnly: boolean;
  readonly teenFriendEligible: boolean;
  readonly minGroupSize: number;
  readonly maxGroupSize: number;
  readonly maxBudgetTier?: VenuePriceTier;
  readonly lowNoiseRequired: boolean;
  readonly daytimeOnly: boolean;
  readonly alcoholExcluded: boolean;
  readonly aestheticReadAllowed: boolean;
  readonly peonCapitalAllowed: boolean;
  readonly externalProspectReadAllowed: boolean;
  readonly externalEventsAllowed: boolean;
  readonly followupCadence: "next_day_local" | "work_48h_90d";
  readonly firewallScope: AppId;
}
