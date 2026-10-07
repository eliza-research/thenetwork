// Observatory view model: one shape for both modes (game = simulated world, real = Postgres), so
// every panel works in both. Game mode builds it event-sourced from simulator run records; real
// mode builds it from network.* rows. See docs/observatory.md.
import type {
  Category, City, EdgeType, Facet, Intent, MemberId, OpportunityKind, OpportunityState,
  ParticipationState, Presence, ScoreComponents,
} from "@thenetwork/core";
import type { OracleSummary } from "@thenetwork/judge";

export type Mode = "game" | "real";

export interface Capabilities {
  /** Time can be paused, played and stepped (simulated clock). */
  canStep: boolean;
  /** The player can act on the world (proposals, takeovers, god actions). */
  canIntervene: boolean;
  /** Hidden ground truth and the oracle exist (synthetic personas). */
  hiddenTruth: boolean;
  /** Nothing is ever written to the source. */
  readOnly: boolean;
}

export interface EnvInfo {
  mode: Mode;
  /** Banner text, e.g. "SIMULATION seed 1 · synthetic v1" or "PRODUCTION · read-only". */
  label: string;
  dataset: string;
  capabilities: Capabilities;
  /** Real mode: database host and name with credentials removed. */
  database?: string;
  /** Real mode: why the source is unavailable (no URL, connection failure). */
  error?: string;
  piiRevealed?: boolean;
}

export interface ClockInfo {
  now: number; start: number; end?: number; day: number;
  playing: boolean;
  /** Sim milliseconds per wall second. */
  speed: number;
  /** The world is blocked waiting for the player to answer as a member they control. */
  waitingForPlayer: boolean;
  /** An engine run is in progress (game mode) or a shadow run (real mode). */
  busy?: string;
}

export type MemberStatus = ParticipationState | "opted_out" | "not_joined";

export interface ObsMember {
  id: MemberId; name: string; city: City; area?: string; state: MemberStatus;
  joined: boolean; joinedAt?: number; minor: boolean; age?: number;
  invitedBy?: MemberId; community?: string; occupation?: string;
  counters: {
    msgsIn: number; msgsOut: number; proactive: number; proposals: number; accepted: number;
    meetings: number; enjoymentSum: number; enjoymentN: number;
  };
  /** Game mode: the player controls this persona. */
  controlled?: boolean;
  /** Trust and safety level (consent network). */
  trust?: "ok" | "watch" | "hold";
}

/** Hidden ground truth summary per member (game only; shown when the truth lens is on). */
export interface MemberTruth {
  archetype: string; adversarial?: string; trueAge: number; socialEnergy: number; flakiness: number;
  capacity: number; honesty: number; openness: number; romanceOptIn: boolean;
  desires: { text: string; category: Category; strength: number }[];
  interests: string[]; skills: string[]; boundaries: string[]; privateFact?: string;
  trips: { city: City; fromDay: number; toDay: number }[];
}

export type EdgeOrigin = "graph" | "learned";
export interface ObsEdge {
  id: string; from: MemberId; to: MemberId; type: EdgeType; strength: number; createdAt: number; origin: EdgeOrigin;
}

export type OppState = OpportunityState | "SKIPPED";
export type OppSource = "engine" | "player" | "network" | "scenario" | "shadow";
export type ParticipantStatus =
  | "checking" | "available" | "unavailable"
  | "pending" | "invited" | "accepted" | "declined" | "countered" | "ignored" | "expired" | "dropped"
  | "confirmed" | "attended" | "no_show" | "cancelled_with_notice";

export interface ObsOpportunity {
  id: string; kind: OpportunityKind; source: OppSource; generator: string; category?: Category; city: City;
  objective: string; score: number; components?: ScoreComponents; explanations: Record<MemberId, string>;
  exploration: boolean; participants: MemberId[]; alternates: MemberId[];
  state: OppState; reason?: string;
  status: Record<MemberId, ParticipantStatus>;
  enjoyment: Record<MemberId, number>;
  createdAt: number; updatedAt: number; meetingAt?: number;
  /** Game mode: what really would happen (the oracle). Hidden in the UI until resolved or the lens is on. */
  oracle?: OracleSummary;
  /** Engine run that produced it. */
  runId?: string;
  feedback?: { memberId: MemberId; text: string }[];
  /** Where they'll meet (public NYC venue). */
  venue?: { name: string; lat: number; lng: number };
  /** Where it came from in the consent network (engine, request, plans, second_encounter...). */
  origin?: string;
}

export type FeedKind =
  | "join" | "message" | "proposal" | "invite" | "accept" | "decline" | "meeting" | "outcome" | "feedback"
  | "block" | "opt_out" | "engine" | "adversarial" | "invariant" | "error" | "scenario" | "game" | "skip"
  | "probe" | "request" | "trust" | "growth";
export interface ObsFeedItem {
  seq: number; t: number; kind: FeedKind; text: string;
  members?: MemberId[]; opportunityId?: string; severity?: "info" | "good" | "warn" | "bad";
}

export interface EngineRunSummary {
  id: string; at: number; city?: City; engineVersion: string; proposals: number; wallMs: number;
  shadow?: boolean;
  funnel: {
    generated: number; passedHardFilters: number; deduped: number; eligible: number; belowThreshold: number;
    budgetSkips: number; selected: number; exploration: number; dealbreakers: number;
  };
  byGenerator: Record<string, number>;
  proposalsByGenerator: Record<string, number>;
  rejectedBy: Record<string, number>;
  memberFunnel: Record<string, number>;
  fairness: { gini: number; top10Share: number; zeroExposureShare: number; newcomerCoverage: number; viableCoverage: number; lorenz: number[]; membersWithProposal: number; eligibleMembers: number };
  emptyStates: number;
  emptyStatesByReason: Record<string, number>;
  timingsMs: Record<string, number>;
  /** Highest-scoring configurations considered (selected or not), for "why did the alternatives lose". */
  top: { key: string; generator: string; participants: MemberId[]; score: number; eligible: boolean; reason?: string; selected: boolean; components: ScoreComponents }[];
  proposalIds: string[];
}

export interface ObsStats {
  members: number; joined: number; byCity: Record<string, number>; byState: Record<string, number>;
  messages: number; inbound: number; outbound: number; proactive: number;
  proposals: number; proposalsBySource: Record<string, number>; oppsByState: Record<string, number>;
  invites: number; accepts: number; declines: number;
  meetingsScheduled: number; meetingsHeld: number; attended: number; noShows: number; cancelledWithNotice: number;
  enjoymentSum: number; enjoymentN: number;
  blocks: number; optOuts: number; adversarialAttempts: number; invariantViolations: number; errors: number;
  /** Game only: proposals the oracle says were truly compatible / unsafe. */
  compatible: number; unsafe: number; oracleJudged: number;
  edgesByType: Record<string, number>;
}

export interface ScoreLine {
  source: string; label: string; points: number; proposals: number; accepted: number; declined: number;
  meetings: number; showRate: number; meanEnjoyment: number; precision: number; unsafe: number; perProposal: number;
}
export interface Mission { id: string; title: string; description: string; done: boolean; progress: string; doneAt?: number }
export interface PlayerPrompt {
  id: string; memberId: MemberId; messageId: string; body: string; type?: string; proposalId?: string; at: number;
}
export interface GameState {
  sparksLeft: number; sparksPerDay: number; strikes: number; maxStrikes: number; over: boolean;
  lensUsed: boolean; peeks: number;
  engine: "engine-v1" | "random" | "off";
  scores: ScoreLine[];
  missions: Mission[];
  prompts: PlayerPrompt[];
  controlled: MemberId[];
}

export interface ObsState {
  env: EnvInfo;
  clock: ClockInfo;
  members: ObsMember[];
  edges: ObsEdge[];
  opportunities: ObsOpportunity[];
  feed: ObsFeedItem[];
  stats: ObsStats;
  engineRuns: EngineRunSummary[];
  game?: GameState;
  /** Game only: hidden truth per member (the UI shows it only with the truth lens on). */
  truth?: Record<MemberId, MemberTruth>;
  /** Consent network internals (game mode): the consent ladder, requests, trust, growth. */
  network?: NetworkInfo;
  version: number;
}

export interface NetworkInfo {
  kind: "consent" | "stub";
  counters: Record<string, number>;
  gateReasons: Record<string, number>;
  requests: { total: number; fulfilled: number; probing: number; waiting: number; plans: number };
  trust: { watch: number; hold: number };
  scenario?: { id: string; title: string; description: string };
}

/** Incremental update pushed over the WebSocket. */
export interface ObsDelta {
  version: number;
  env?: EnvInfo;
  clock: ClockInfo;
  members?: ObsMember[];
  edges?: ObsEdge[];
  opportunities?: ObsOpportunity[];
  removedOpportunities?: string[];
  feed?: ObsFeedItem[];
  stats?: ObsStats;
  engineRuns?: EngineRunSummary[];
  game?: GameState;
  network?: NetworkInfo;
  /** The client must refetch the full state (reset, mode switch). */
  reset?: boolean;
}

export interface ObsMessage {
  id: string; ts: number; direction: "inbound" | "outbound"; body: string; status: string;
  type?: string; proposalId?: string; proactive?: boolean; system?: boolean;
}

export interface MemberDetail {
  member: ObsMember;
  profile?: { bio?: string; occupation?: string; neighborhood?: string; pronouns?: string; availability?: string };
  facets: Facet[]; intents: Intent[]; presence: Presence[];
  edges: ObsEdge[];
  opportunities: ObsOpportunity[];
  messages: ObsMessage[];
  truth?: MemberTruth;
  /** Persona's private memory of proposals (game, truth lens): decision, plannedShow, enjoyment. */
  memory?: Record<string, { decision: string; plannedShow: boolean; enjoyment: number }>;
}

export interface OpportunityDetail {
  opportunity: ObsOpportunity;
  members: ObsMember[];
  messages: (ObsMessage & { memberId: MemberId })[];
  run?: EngineRunSummary;
}

export type ControlCommand =
  | { type: "play" } | { type: "pause" } | { type: "speed"; speed: number }
  | { type: "step"; ms: number }
  | { type: "propose"; participants: MemberId[]; category?: Category; objective?: string; why?: string }
  | { type: "takeover"; memberId: MemberId; on: boolean }
  | { type: "reply"; promptId: string; text?: string; auto?: boolean }
  | { type: "say"; memberId: MemberId; text: string }
  | { type: "god"; action: "go_silent" | "force_flake" | "opt_out"; memberId: MemberId }
  | { type: "peek"; participants: MemberId[] }
  | { type: "lens"; on: boolean }
  | { type: "reset"; seed?: number; engine?: GameState["engine"]; personas?: number; days?: number; network?: "consent" | "stub"; scenario?: string | null }
  | { type: "check_scenario" }
  | { type: "refresh" } | { type: "shadow_run"; city?: City };

export interface ControlResult { ok: boolean; error?: string; data?: unknown }
