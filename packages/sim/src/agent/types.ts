// Persona agent contract. A persona agent receives messages from "the Network agent" (via
// the simulated channel) and decides how its persona responds. Decisions come from hidden
// ground truth plus seeded randomness (policy.ts); the words come from either templates
// (deterministic) or an LLM playing the persona (llmAgent.ts).
import type { MemberId, Proposal } from "@thenetwork/core";
import type { Reaction, SimMessage, SimMeta, TimeOption } from "../channel.ts";
import type { Oracle } from "../oracle.ts";
import type { Persona } from "../persona.ts";
import type { Rng } from "../rng.ts";

export type Decision = "accept" | "decline" | "counter" | "none";
export type MessageType = NonNullable<SimMeta["type"]>;

/** What the persona does with one inbound message. */
export type Intent =
  | "join" | "answer_question" | "accept" | "decline" | "counter" | "confirm_schedule"
  | "flake_notice" | "ack" | "feedback" | "opt_out" | "relay_reply" | "ignore"
  /** Answers to consent-first probes and growth asks. */
  | "probe_yes" | "probe_no" | "invite_friend"
  /** A tapback on the message (PolicyOptions.reactions): an answer without typed text. */
  | "react"
  /** Answers to a menu (SimMeta.menu): one option's key, or "none". */
  | "menu_pick" | "menu_none"
  /** A booked plan (SimMeta.booked) or a scheduled time the persona cannot make: "can't make it" (PolicyOptions.timeAware). */
  | "booked_cancel"
  /** Plans (PolicyOptions.plans): picked plan options, none, "can't make that time", a check-in answer, a crew answer. */
  | "plan_pick" | "plan_none" | "plan_cant" | "checkin_answer" | "crew_yes" | "crew_no";

export interface PersonaMemory {
  joined: boolean;
  joinedAt?: number;
  optedOut: boolean;
  disclosed: boolean;
  questionsAnswered: number;
  proposals: Record<string, {
    decision: Decision; plannedShow: boolean; enjoyment: number; others: MemberId[]; at?: number;
    /** The persona learned the meeting time and it clashes with its week (PolicyOptions.timeAware). */
    timeConflict?: boolean;
    category?: import("@thenetwork/core").Category; decidedAt?: number;
  }>;
  meetings: Record<string, { at: number; showed: boolean; enjoyment: number; others: MemberId[]; cancelledWithNotice: boolean; othersShowed: MemberId[] }>;
  proactiveReceived: number[];
  blocked: MemberId[];
  /** Scenario hook: persona stops replying from this time on. */
  silentFrom?: number;
  /** Scenario hook: persona will flake on the next group meeting (morning-of notice). */
  forceFlake?: "notice" | "no_show";
  /** Names of people the Network most recently proposed (for adversarial follow-ups). */
  recentMatches: MemberId[];
  /**
   * Fresh signals of wanting something now: the persona asked for it, or said yes to a probe.
   * A primed persona judges a matching invitation on fit, not on spare capacity (oracle.primedAccept).
   */
  signals?: { category: import("@thenetwork/core").Category; at: number; source: "ask" | "probe"; key?: string }[];
  /** Friends this persona has invited (growth). */
  invited?: string[];
  /** Plans the persona was probed for (PolicyOptions.plans): its answer, and later whether it would do it again. */
  plans?: Record<string, { at: number; picks: string[]; primed: boolean; activity?: string; area?: string; again?: boolean }>;
  /** Windows the persona said it is free for in its latest weekly check-in answer (until `until`). */
  stated?: { windows: { start: number; end: number }[]; at: number; until: number };
  /** The one-time weekly check-in offer was seen (and answered WEEKLY when `on`). */
  weekly?: { offeredAt: number; on: boolean };
  /** Crew offers answered (crewId -> opted in). */
  crews?: Record<string, boolean>;
  /** Trust in the Network, 1 = full (PolicyOptions.qualityChurn only). Bad or unsafe intros lower it. */
  trust?: number;
}

export const newMemory = (): PersonaMemory => ({
  joined: false, optedOut: false, disclosed: false, questionsAnswered: 0, proposals: {}, meetings: {},
  proactiveReceived: [], blocked: [], recentMatches: [], signals: [], invited: [],
});

export interface PersonaContext {
  persona: Persona;
  memory: PersonaMemory;
  now: number;
  /** The run seed (keys hidden availability, PolicyOptions.timeAware). Default 0. */
  seed?: number | string;
  /** Seeded stream for this decision. */
  rng: Rng;
  oracle: Oracle;
  /** All messages exchanged with this persona so far (oldest first). */
  history: SimMessage[];
  lookupProposal(id: string): Proposal | undefined;
  personaById(id: MemberId): Persona | undefined;
  /** Find personas mentioned by name ("Sam Chen", "Sam C.", unique first name) in text. */
  personasMentioned(text: string): Persona[];
}

export interface PolicyDecision {
  intent: Intent;
  messageType: MessageType;
  decision: Decision;
  proposalId?: string;
  participants?: MemberId[];
  /** Reply delay in ms (from the persona's latency distribution and routine). */
  delayMs: number;
  /** Persona's private judgment: was this message worth sending? (proactive messages only) */
  worthwhile?: boolean;
  /** Share the agent-private disclosure in this reply. */
  disclose?: boolean;
  /** For feedback replies. */
  feedback?: { showed: boolean; enjoyment: number; othersShowed: boolean; wouldMeetAgain: boolean; withNames: string[];
    /** The question was "Would you do this again?" after a plan (PolicyOptions.plans): answered with planAgainText. */
    plan?: boolean };
  /** Gut feeling passed to the LLM voice ("you'd probably enjoy this"). */
  inclination?: { enjoyment: number; acceptProb: number };
  /** Persona will also block these members (block abusers, bad meetings). */
  block?: MemberId[];
  /** intent "react": the tapback the channel delivers as an inbound message (SimMeta.reaction). */
  reaction?: Reaction;
  /** Menu answers: the chosen option key, or "none". */
  menuChoice?: string;
  /**
   * Answer to offered times (SimMeta.timeOptions, PolicyOptions.timeAware): the keys of the options the
   * persona is free for (empty = none fit), and the options as offered (for the words).
   */
  timeAnswer?: { picks: string[]; options: TimeOption[] };
  /** Plans: the picked option keys of a plan probe (with the options as offered), or the stated windows of a check-in. */
  planAnswer?: { picks: string[]; options: { key: string; label: string }[] };
  checkIn?: { windows: { start: number; end: number }[]; city: import("@thenetwork/core").City };
  /** Extra messages the persona sends on its own after this one (e.g. "WEEKLY" to the check-in offer). Sent even when it ignores the message. */
  followUps?: { text: string; delayMs: number }[];
}

export interface AgentReply extends PolicyDecision {
  action: "reply" | "ignore";
  text?: string;
}

export interface Initiative {
  text: string;
  kind: "ask" | "travel" | "adversarial" | "block" | "chat";
  adversarial?: string;
  block?: MemberId[];
}

export interface PersonaAgent {
  readonly mode: "policy" | "llm";
  respond(ctx: PersonaContext, msg: SimMessage): Promise<AgentReply>;
  /** Unsolicited message the persona sends at a routine-derived time (or undefined). */
  initiative(ctx: PersonaContext): Promise<Initiative | undefined>;
  /** First message when accepting the invite. */
  joinMessage(ctx: PersonaContext): Promise<string>;
}
