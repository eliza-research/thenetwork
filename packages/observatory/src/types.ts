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
  /**
   * Review, safety and matching-switch actions are possible. Game mode: on the simulated world. Real
   * mode: through the Network service's staff API (NETWORK_SERVICE_URL); the database stays read-only.
   * Absent: same as !readOnly.
   */
  staffActions?: boolean;
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
  /** The API requires a staff token or a staff SSO session. */
  authRequired?: boolean;
  /** OBSERVATORY_REAL_ONLY=1 (production build): game mode, game controls and the lab are off on the server. */
  realOnly?: boolean;
  /** Real mode: the Network service that takes staff actions (its URL). */
  service?: string;
  /** The app this view shows (ntwrk, slop, peon, friends). */
  app?: string;
  /** Proactive matching cannot run for this app yet (its engine pack has not shipped). */
  matchingLocked?: boolean;
  /** Real mode: how rows are kept to this app: the app's own read login (row-level security), or a filter on app_id. */
  appIsolation?: "rls_role" | "app_filter";
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
  /** No valid age yet: treated as under 18 (minor is true) until they say (network.md 6.3). */
  ageUnknown?: boolean;
  invitedBy?: MemberId; community?: string; occupation?: string;
  counters: {
    msgsIn: number; msgsOut: number; proactive: number; proposals: number; accepted: number;
    meetings: number; enjoymentSum: number; enjoymentN: number;
  };
  /** Game mode: the player controls this persona. */
  controlled?: boolean;
  /** Trust and safety level (consent network). */
  trust?: "ok" | "watch" | "hold";
  /** Declined at join (under 13): the Network keeps nothing about them and never messages them again. */
  declined?: boolean;
  /** Said CALENDAR to the offer in their first booked plan: free/busy consent recorded (no calendar source yet). */
  calendar?: boolean;
  /** Said WEEKLY: gets "What's your week like?" on Sundays (never members aged 13-17). */
  weekly?: boolean;
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
  /** Human review (PRD 32.8): every proactive opportunity waits here before any member is contacted. */
  review?: ReviewInfo;
  /**
   * Hours since it was created (open) or from creation to its last change (closed). Computed when the
   * state or a delta is sent; the client can recompute it from createdAt and clock.now.
   */
  ageHours?: number;
  /** Game mode: when it entered its current state (time in state). Real mode: updatedAt. */
  stateSince?: number;
  /**
   * Times the probes offered each member and the keys they picked (attention v1.2). Labels are known in
   * game mode only (real mode stores the picks, not the message metadata). `picked` is absent while
   * they have not answered, and empty when none of the times fit.
   */
  times?: Record<MemberId, { offered: TimeChoice[]; picked?: string[] }>;
  /** The booked plan (the reveal with an opt-out): booked when everyone said yes; silence is a yes. */
  booked?: BookedPlan;
}

/** One offered time (SimMeta.timeOptions without the end). */
export interface TimeChoice { key: string; label: string; start: number }
/**
 * The booked plan. Each member may say "can't" within `optOutHours` of the plan reaching them (or
 * until the meeting, if sooner); after that silence counts as confirmed.
 */
export interface BookedPlan {
  at: number; optOutHours: number;
  /** When the plan reached each member. */
  told: Record<MemberId, number>;
  /** Who called it off, when, and whether they told us (a reply) or dropped out silently. */
  cancelled: Record<MemberId, { at: number; told: boolean }>;
}

/** PRD 32.8 reason codes for review decisions. */
export type ReviewReason = "weak_reason" | "privacy_risk" | "capacity_concern" | "wrong_timing" | "safety" | "tone" | "duplicate" | "other";
export const REVIEW_REASONS: readonly ReviewReason[] = ["weak_reason", "privacy_risk", "capacity_concern", "wrong_timing", "safety", "tone", "duplicate", "other"];
export interface ReviewInfo {
  queuedAt: number; deadline: number;
  decision?: "approve" | "reject" | "expired"; reason?: ReviewReason; note?: string; reviewer?: string; decidedAt?: number;
  /** Seconds reviewers spent on it, summed over decisions (a training label). */
  secondsSpent?: number;
  /** What a reviewer edited before approving ("objective", "explanation:<memberId>"). */
  edits?: string[];
  /** Times it was re-rolled (a participant swapped for an alternate). */
  rerolls?: number;
  /** Approved, but a gate failed on the re-check (e.g. "busy_elsewhere", "held", "matching_paused"): nobody was contacted. */
  invalidated?: string;
}
/** A reviewer's action (PRD 32.8). "edit" changes texts, then approves. "reroll" swaps a participant and keeps it waiting. */
export type ReviewDecision = "approve" | "reject" | "edit" | "reroll";

export type FeedKind =
  | "join" | "message" | "proposal" | "invite" | "accept" | "decline" | "meeting" | "outcome" | "feedback"
  | "block" | "opt_out" | "engine" | "adversarial" | "invariant" | "error" | "scenario" | "game" | "skip"
  | "probe" | "request" | "trust" | "growth" | "review" | "guard" | "config";
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
  /**
   * Game only: the judge scorer (@thenetwork/judge computeMetrics) over the run records, at most
   * once per sim hour. All three counts must stay 0.
   */
  judge?: JudgeStats;
  /** Health alerts (admin-console 3.10): SLA misses, backlog, refusals, matcher heartbeat, violations. Worst first. */
  alerts?: HealthAlert[];
  /** PRD 28.2 scorecard from the records (game) or the events and rows (real). */
  scorecard?: ScoreMetric[];
  /** Growth (PRD 32.15, 28.2): invites and invitee activation compared with seed members. */
  growth?: GrowthStats;
}

export interface HealthAlert {
  level: "info" | "warn" | "bad";
  /** Stable key, e.g. "review_sla_missed", "send_refused:budget", "matcher_heartbeat". */
  key: string;
  text: string;
  count: number;
}

export interface ScoreMetric {
  key: "worthwhile_interruption" | "opt_in" | "completion" | "repeat_edges" | "first_value_14d" | "attention_burden"
    | "reviewer_minutes" | "opt_outs" | "invite_rate" | "minors_contacted" | "leaks";
  label: string;
  /** null when there is nothing to measure yet. */
  value: number | null;
  unit: "share" | "count" | "per_member_week" | "minutes";
  /** Sample size (the denominator, or the count itself). */
  n: number;
  /** The PRD 28.2 target, when there is one. */
  target?: { op: ">=" | "<=" | "=="; value: number };
  /** value meets the target (undefined when there is no value or no target). */
  met?: boolean;
  /** How it is measured, in one sentence. */
  how: string;
}

export interface GrowthStats {
  invitesSent: number;
  inviteesJoined: number;
  growthAsks: number;
  /** Share of joined members who invited someone (PRD 28.2 target: at least 30%). */
  inviterShare: number | null;
  /** Everyone else (founding seed and members already in the Network when the period started). */
  seed: CohortActivation;
  /** Members who joined through an invite sent in the Network (game: this run; real: "invite" events, else invited_by). */
  invitees: CohortActivation;
}
/** Activated = joined and had a first meaningful outcome (attended a meeting, or a request was fulfilled or answered). */
export interface CohortActivation { members: number; joined: number; activated: number; rate: number | null }

export interface JudgeStats { invariants: number; canaryLeaks: number; minorContacts: number; byRule: Record<string, number>; at: number }

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
  /** Member requests (admin-console 3.8), newest first. Never the member's own words. */
  requests?: ObsRequest[];
  version: number;
}

/** A member request: what was asked for (a catalogue want or a category), never the member's words. */
export interface ObsRequest {
  id: string; memberId: MemberId; kind: "people" | "plans"; category: string;
  /** The want as the Network phrases it ("find a weekend tennis partner"), or "a social request". */
  label: string;
  /** "booked": the request became a booked plan (the Network's outcome since 2026-10-08). */
  outcome: "probing" | "fulfilled" | "booked" | "none" | "answered" | "open";
  tries: number; openedAt: number; ageHours: number;
  fulfilledAt?: number; hoursToFulfil?: number; opportunityId?: string;
}

export interface NetworkInfo {
  kind: "consent" | "stub";
  /** Review gate (PRD 32.8): "human" = a person approves each opportunity; "auto" = a simulated reviewer (sim only). */
  review: { mode: "human" | "auto"; queued: number; approved: number; rejected: number; expired: number };
  counters: Record<string, number>;
  gateReasons: Record<string, number>;
  requests: { total: number; fulfilled: number; probing: number; waiting: number; plans: number };
  trust: { watch: number; hold: number };
  scenario?: { id: string; title: string; description: string };
  /** The admin switch "proactive matching on in NYC" (admin-console 3.11). */
  matchingEnabled?: boolean;
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
  requests?: ObsRequest[];
  /** The client must refetch the full state (reset, mode switch). */
  reset?: boolean;
}

export interface ObsMessage {
  id: string; ts: number; direction: "inbound" | "outbound"; body: string; status: string;
  type?: string; proposalId?: string; proactive?: boolean; system?: boolean;
  /** Real mode: the member's own text is withheld (body is "[member message hidden]"); its length in characters. */
  hiddenLength?: number;
  /**
   * Consent Network outbound messages: the leak check result. "passed" = sent as written; "fallback" =
   * the guard stopped the first text and this generic version went out (gap 8).
   */
  guard?: "passed" | "fallback";
  /** Game mode: the times this message offered (a probe, the requester's time question, other times after "neither"). */
  timeOptions?: TimeChoice[];
  /** Game mode: this message is a booked plan (meeting time and the opt-out window). */
  booked?: { at: number; optOutHours: number };
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
  /** Admin and safety only: staff who opened this member (newest first, from the audit log). */
  staffAccess?: { actor: string; at: number; action: string }[];
  /** The caller has an active PII reveal for this member (real mode: names and the member's own text shown). */
  revealed?: { until: number };
}

export interface OpportunityDetail {
  opportunity: ObsOpportunity;
  members: ObsMember[];
  messages: (ObsMessage & { memberId: MemberId })[];
  run?: EngineRunSummary;
  /** Full event history of this opportunity, oldest first (gap 15). Never message text. */
  events: SystemEvent[];
}

/**
 * Something the system did (gap 6): a gate or review decision, a probe, a reveal, a deferral, a
 * refusal, a trust change, a leak-guard block (reasons only, never the text), an age event.
 */
export interface SystemEvent {
  t: number;
  /** The Network log kind or product event type ("review_decision", "probe_sent", "send_refused"...). */
  type: string;
  /** One line for staff. Never a member's words. */
  text: string;
  severity?: "info" | "good" | "warn" | "bad";
  memberId?: MemberId;
  opportunityId?: string;
  /** Small scalar facts (reason, decision, reviewer, kind...). Never message text. */
  detail?: Record<string, string | number | boolean | null>;
}

/** One row of a member perspective timeline (gap 6): a message, or what the system did, in time order. */
export type TimelineEntry =
  | { t: number; kind: "message"; message: ObsMessage }
  | { t: number; kind: "event"; event: SystemEvent };

export interface MemberTimeline {
  memberId: MemberId;
  entries: TimelineEntry[];
  /** Sends waiting for the member's sending window now (deferred; no time is recorded for when they were deferred). */
  pending: { kind: string; type?: string; opportunityId?: string }[];
  revealed?: { until: number };
}

// ---------------------------------------------------------------- staff, audit, PII reveal
/**
 * Staff roles (admin-console 4.1, platform plan 5.1). Each is held for one app or for every app
 * ("role@app", "role@*"). engineer: simulated worlds only (game mode, the lab). cross_app_safety: the
 * cross-app person view only, and only for every app ("@*").
 */
export type StaffRole = "admin" | "reviewer" | "safety" | "analyst" | "engineer" | "cross_app_safety";
export const STAFF_ROLES: readonly StaffRole[] = ["admin", "reviewer", "safety", "analyst", "engineer", "cross_app_safety"];
/** One role for one app ("ntwrk", "slop", ...) or for every app ("*"). */
export interface RoleGrant { role: StaffRole; app: string }
export interface StaffUser {
  /** An email (SSO), or "token:<role>#<hash prefix>" for a static token (the token itself is never shown). */
  id: string;
  /** Every role held, for any app (display). Checks use `grants`. */
  roles: StaffRole[];
  /** The roles with their app. A grant without an app ("email:role") is "role@*". */
  grants: RoleGrant[];
  via: "token" | "sso";
  /** SSO: when the Cloudflare Access token expires (ms). Sockets close then (they are re-checked on a timer too). */
  expiresAt?: number;
}

export interface AuditEntry {
  id?: string | number;
  /** Wall-clock time (ms). */
  at: number;
  actor: string;
  roles: StaffRole[];
  /** read_member, read_timeline, read_member_app, read_photos, read_opportunity, reveal, reveal_revoke, review, safety_*, config, control, search, lab_run, read_audit, mode, read_person, open_person_app. */
  action: string;
  targetType?: "member" | "opportunity" | "case" | "config" | "run" | "search" | "mode" | "person" | "report";
  /** The app the request was about (network.staff_audit.app_id). Absent: no app (a mode switch). */
  app?: string;
  targetId?: string;
  reason?: string;
  mode?: Mode;
  ok: boolean;
  detail?: Record<string, unknown>;
}

export interface RevealGrant { memberId: MemberId; reason: string; at: number; until: number }

// ---------------------------------------------------------------- safety console (gap 7)
export interface ObsSafetyCase {
  id: string; memberId: MemberId; memberName: string;
  level: "ok" | "watch" | "hold";
  status: "open" | "held" | "lifted" | "closed";
  opened: number; closedAt?: number; closedBy?: string;
  /** Trust events, never message text. */
  events: { at: number; kind: string; points: number; by?: MemberId }[];
  /** Harassment, money scams, contact extraction and holds are urgent (1 hour target); others 24 hours (PRD 36.3). */
  urgent: boolean;
  dueAt: number;
  overdue: boolean;
}
export interface SafetyInfo {
  /** Open, held and lifted cases first (urgent, then oldest), then closed ones. */
  cases: ObsSafetyCase[];
  watch: MemberId[]; hold: MemberId[];
  /**
   * Minor-safety view: members treated as under 18 (`members`: aged 13-17 or said so; `unknownAge`: no
   * valid age yet) and any open multi-person opportunity that names one of them (must be empty).
   */
  minors: { members: MemberId[]; unknownAge: MemberId[]; inOpportunities: { opportunityId: string; memberId: MemberId; state: string }[] };
  /** Actions are possible (game mode with the consent Network). Real mode is read-only. */
  canAct: boolean;
  /**
   * Reports a member made about someone they met (post-date reports: harassment, lying, ...), urgent
   * first. Real mode: the Network service's GET /safety/reports (docs/admin-console.md 3.7.1). Game
   * mode: report_received trust events between two members who met.
   */
  reports?: SafetyReport[];
  /** Hold and ban by phone or person need the Network service (real mode). */
  canBan?: boolean;
}
/** What a post-date report says happened. "other" when the reporter's words did not fit a kind. */
export type ReportKind = "harassment" | "lying" | "no_show" | "unsafe" | "scam" | "minor" | "other";
export interface SafetyReport {
  id: string;
  kind: ReportKind;
  /** The member who reported, and the member reported (this app's member ids). Never the reporter's words. */
  reporterId: MemberId; subjectId: MemberId;
  /** The date (opportunity) the report is about, when known. */
  opportunityId?: string;
  at: number;
  status: "open" | "held" | "banned" | "dismissed";
  /** Harassment, unsafe, scam and minor reports are urgent (1 hour target); others 24 hours (PRD 36.3). */
  urgent: boolean;
  dueAt: number;
  overdue: boolean;
  /** Earlier reports about the same subject (any reporter). */
  priorReports: number;
}
export type SafetyAction =
  | { action: "lift"; memberId: MemberId; note?: string }
  | { action: "close"; caseId: string; note?: string }
  /** Hold the person behind this member on every app (PRD 40.3: a safety removal holds the person everywhere). */
  | { action: "hold"; memberId: MemberId; note: string; reportId?: string }
  /** Ban by phone (the number can never join again) or by person (every phone of the person). PRD 40.5: ban by person, not by account. */
  | { action: "ban"; memberId: MemberId; by: "phone" | "person"; note: string; reportId?: string }
  | { action: "dismiss"; reportId: string; note: string };

// ---------------------------------------------------------------- configuration (gaps 10, 17)
export interface ConfigChange {
  version: number;
  /** Sim time (game) or wall time (real). */
  at: number;
  actor: string;
  key: "matching" | "review_mode";
  from: string | boolean | null;
  to: string | boolean;
}
export interface ConfigInfo {
  matchingEnabled: boolean;
  reviewMode: "human" | "auto" | null;
  /** Network options in force (read-only display). */
  network: Record<string, number | boolean | string | null>;
  /** The outreach numbers (packages/network/src/outreach.ts), read-only. */
  outreach: Record<string, unknown>;
  /** Every change, oldest first, numbered from 1. */
  history: ConfigChange[];
  canChange: boolean;
}

// ---------------------------------------------------------------- simulation lab (gap 12)
export type LabArm = "push_baseline" | "push_v2" | "consent";
export interface LabRequest {
  arms: LabArm[]; seeds: number[]; days: number;
  /** The app the run is for (default ntwrk). slop and peon run with matching off until their packs ship. */
  app?: string;
}
export interface LabArmResult {
  arm: string; seed: number;
  /** Share of proposals where every invited participant said yes. */
  everyoneYes: number | null;
  /** Invitation accept rate. */
  accept: number | null;
  meetings: number | null;
  /** Judge scorer counts (must be 0). null when the script did not report them. */
  judgeInvariants: number | null; canaryLeaks: number | null; minorContacts: number | null;
}
export interface LabRun {
  id: string; request: LabRequest; requestedBy: string;
  status: "queued" | "running" | "done" | "failed";
  createdAt: number; startedAt?: number; finishedAt?: number;
  /** One child process per seed; how many finished. */
  progress: { done: number; total: number };
  results: LabArmResult[];
  error?: string;
  /** Where the results are saved (runs/lab/<id>.json). */
  file: string;
}

// ---------------------------------------------------------------- run diff (gap 19)
export interface DiffNum { a: number; b: number; delta: number }
export interface RunDiff {
  a: { id: string; at: number; city?: City; engineVersion: string; proposals: number };
  b: { id: string; at: number; city?: City; engineVersion: string; proposals: number };
  funnel: Record<string, DiffNum>;
  byGenerator: Record<string, DiffNum>;
  proposalsByGenerator: Record<string, DiffNum>;
  rejectedBy: Record<string, DiffNum>;
  fairness: Record<string, DiffNum>;
  /** Top configurations (by participant set) in b but not a, in a but not b, and in both. */
  top: { added: EngineRunSummary["top"]; removed: EngineRunSummary["top"]; kept: number };
}

// ---------------------------------------------------------------- conversation search (gap 18)
export interface SearchHit {
  memberId: MemberId; memberName: string; t: number;
  /** Outbound agent message or a system event. Inbound member text is never searched. */
  kind: "message" | "event";
  snippet: string;
  type?: string; opportunityId?: string;
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
  | {
    /** reason: a PRD 32.8 code, or an app's own code (src/apps.ts APP_REASONS; the server maps it to its base code). */
    type: "review"; oppId: string; decision: ReviewDecision; reason?: ReviewReason; note?: string;
    /** Seconds the reviewer spent on the item (summed per item; a training label). */
    secondsSpent?: number;
    /** "edit": new explanation per participant (leak-checked for its recipient). */
    explanations?: Record<MemberId, string>;
    /** "edit": a new objective (leak-checked). */
    objective?: string;
    /** "reroll": the participant to swap for an alternate. */
    swapOut?: MemberId;
  }
  | { type: "review_mode"; mode: "human" | "auto" }
  /** Admin only: the "proactive matching on in NYC" switch. */
  | { type: "matching"; on: boolean }
  | { type: "refresh" } | { type: "shadow_run"; city?: City };

export interface ControlResult {
  ok: boolean; error?: string; data?: unknown;
  /** Machine-readable reason when refused or invalidated (e.g. "participant_minor", "busy_elsewhere", "matching_paused", "forbidden"). */
  code?: string;
}

// ---------------------------------------------------------------- per-app Member 360 (admin-console 3.3.1)
/** A slop dating preference as staff see it after a reveal. Never a score or rating of the member. */
export interface SlopPrefs {
  is?: string; seeks: string[]; ageRange?: [number, number];
  scope?: string; maxMiles?: number; goal?: string;
  values: Record<string, string>; dealbreakers: string[]; activities: string[]; free: string[];
  /** Verification results (verify:<check>:<pass|fail>). */
  verification: string[];
  /** Safety cues the agent noticed (safety:<cue>). */
  safety: string[];
}
export interface SlopProfile360 {
  app: "slop";
  /** Treated as an adult: a valid age of 18 or more, not flagged under 18 by the Network. */
  adult: boolean;
  /** Age verified (verify:age:pass). Photos need adult and verified. */
  ageVerified: boolean;
  /** Dating preferences are hidden until a safety or admin reveal for this member (audited). */
  prefs: { hidden: true; count: number } | { hidden: false; prefs: SlopPrefs };
  /** Who may see photos: never for members under 18; admin or safety with a typed reason for verified adults. */
  photos: "never_minor" | "needs_verification" | "reason_required";
}
export interface PeonProfile360 {
  app: "peon";
  entity: "candidate" | "job" | "unknown";
  /** Job seats: the role (title, family, seniority, pay range, work mode, market, openings, employer verified). Candidates: the families and modes they want. */
  roles: { title?: string; family?: string; seniority?: number; pay?: string; mode?: string; market?: string; openings?: number; verified?: boolean }[];
  /** Introductions (applications): one row per opportunity the member is in. */
  applications: { opportunityId: string; state: string; status?: string; at: number }[];
}
export type AppProfile360 = SlopProfile360 | PeonProfile360 | { app: string; none: true };
export interface MemberPhoto { id: string; url: string; expiresAt?: number }

// ---------------------------------------------------------------- four apps (platform plan section 5)
/** Health of one app for the "all" view: review backlog, SLA misses and send failures (last 24 h). */
export interface AppHealth {
  app: string;
  /** The app's data could be read (real mode: its database view; game mode: its world is running). */
  available: boolean;
  error?: string;
  members: number;
  reviewBacklog: number;
  /** Open items older than the app's SLA, plus items that expired unsent in the last 24 h. */
  slaMisses: number;
  slaHours: number;
  sendFailures: number;
  matching: "on" | "off" | "locked";
  /** The worst alert level of the app's own alerts. */
  worst?: "bad" | "warn" | "info";
}

/** The cross-app person view (cross_app_safety or admin only). No phone, no name. */
export interface PersonSummary {
  personId: string;
  lowestAge: number | null;
  createdAt: number;
  deletedAt?: number;
  memberships: { app: string; state: string; joinedAt?: number; leftAt?: number; review?: string; hold: boolean }[];
  /**
   * A hold on any app holds the person everywhere (plan 2.4 rule 5); here with the app that set it. A
   * hold from a private app (slop) shows as app "*" and level "restricted" only (PRD 40.3).
   */
  holds: { app: string; level: "hold" | "restricted" | "recycled_number" }[];
  /** Blocks; the origin app of a block made in a private app shows as "*". */
  blocks: { made: { person: string; originApp: string; at: number }[]; received: { person: string; originApp: string; at: number }[] };
  /**
   * Apps left out of `memberships` whatever the person's state (dating): open their panel with a typed
   * reason to learn whether there is a membership. The same list for every person, so it reveals nothing.
   */
  privateApps: string[];
}

/** One app's panel in the cross-app view: opened with a typed reason, audited before it is read. */
export interface PersonAppPanel {
  personId: string; app: string; memberId: string;
  state: string; trust: "ok" | "watch" | "hold"; joinedAt?: number;
  messages: { in: number; out: number; last?: number };
  opportunities: number;
  cases: { id: string; level: string; status: string; opened: number }[];
}
