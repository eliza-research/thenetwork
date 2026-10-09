// The contract between a Network implementation and its environment: the message types on the
// channel (SMS / iMessage), what the Network receives, and the context it acts through. Production
// (packages/network/service) and the simulator (packages/sim) both implement NetworkContext; the
// Network may only reach members through ctx.send and only read the public snapshot.
import type { Clock } from "./clock.ts";
import type { Category, City, MemberId, OpportunityKind, Proposal, WorldSnapshot } from "./types.ts";

export type ChannelKind = "imessage" | "sms";
export type Direction = "outbound" | "inbound";
export type DeliveryStatus = "delivered" | "suppressed_opted_out" | "failed" | "duplicate";
export type Keyword = "STOP" | "START" | "HELP";

/**
 * Annotation that a Network implementation MAY attach to outbound
 * messages (e.g. which proposal an invitation is about). Persona agents use it when
 * present; otherwise they infer intent from the text. Never shown to LLM personas verbatim.
 */
export interface SimMeta {
  type?: "onboarding" | "question" | "proposal" | "scheduling" | "reminder" | "feedback_request"
    | "relay" | "info" | "confirmation" | "cancellation" | "system"
    /** Single-player answer or public suggestion (e.g. for members under 18). */
    | "concierge"
    /** Anonymous availability/interest check before any person is revealed (consent-first). */
    | "probe"
    /** Ask to invite someone (growth). */
    | "growth_ask"
    /** Anonymous, time-specific plan probe (SimMeta.plan; plans v1.1). Personas read it with PolicyOptions.plans. */
    | "plan_probe"
    /** The weekly "What's your week like?" check-in (also recognised by its text on a "question"). */
    | "checkin"
    /** "Want to make this a weekly thing?" after a plan (SimMeta.crew). */
    | "crew_offer";
  proposalId?: string;
  participants?: MemberId[];
  /** Counts toward the interruption budget / two-unanswered rule. */
  proactive?: boolean;
  /** First proactive contact to this member (opt-out language required). */
  firstContact?: boolean;
  /** Meeting time if this message schedules one. */
  meetingAt?: number;
  /** For relay messages: the original sender. */
  relayFrom?: MemberId;
  /** For probes: the category and a stable key for the opportunity being checked. */
  probe?: { key: string; category: Category; participants?: MemberId[]; kind?: OpportunityKind; window?: { start: number; end: number } };
  /**
   * Outbound only. Outside-world items the message offers (events, places), usually on a "concierge"
   * or "info" message. `tags` are interest tags (taxonomy INTERESTS); persona agents with reactions on
   * (PolicyOptions.reactions) judge their interest in the message from them. Nobody else is involved.
   */
  items?: SimItem[];
  /**
   * Outbound only. A numbered choice ("Reply 1, 2 or none"). The persona answers with the `key` of the
   * option it prefers, "none", or ignores the message. An option with a `proposalId` is a named
   * invitation: the persona judges it with the oracle as it judges a proposal, and picking it is a yes
   * to that proposal. Persona agents read a menu whenever it is present (no option needed).
   */
  menu?: { options: MenuOption[] };
  /**
   * Inbound only (set by the channel). This inbound message is a tapback on outbound message `to`, not
   * typed text. The body still carries an emoji ("👍", "❤️"), so a Network that reads only the body
   * sees a short acknowledgement. Either way, it is an answer: the member engaged.
   */
  reaction?: Reaction;
  /**
   * Outbound only. Concrete times the message offers (2-3 options, keys "a", "b", "c"; label in the
   * member's local time, e.g. "Thursday 7pm"). The member answers in free text ("Thursday works", "the
   * first", "either", "a or b", "neither works this week"); the Network parses the answer into the set of
   * picked keys (empty = neither). Personas read it only with PolicyOptions.timeAware.
   */
  timeOptions?: TimeOption[];
  /**
   * Outbound only. This message is a booked-plan reveal: the meeting is booked at `at`, and silence for
   * `optOutHours` (48) counts as confirmed. A reply with "can't" or "cancel" cancels it. Personas read it
   * only with PolicyOptions.timeAware.
   */
  booked?: { proposalId: string; at: number; optOutHours: number };
  /**
   * Outbound only, on a "plan_probe" (and optionally on the plan's "feedback_request"). The plan the
   * probe describes: activity, time window, size, area, and numbered options ("Reply 1, 2 or both").
   * The persona answers with the keys it picks ("1 and 2", "the first two"), "none", or "can't make that
   * time". Personas read it only with PolicyOptions.plans.
   */
  plan?: PlanMeta;
  /** Outbound only, on a "crew_offer": the crew being offered. The persona opts in ("yes") or out. */
  crew?: { crewId: string; activity?: string };
  [k: string]: unknown;
}

/** One concrete time a message offers (SimMeta.timeOptions). */
export interface TimeOption { key: string; start: number; end: number; label: string }

/** An outside-world item (event or place) carried by an outbound message (SimMeta.items). */
export interface SimItem { key: string; label?: string; category?: Category; tags?: string[] }
/** One option of a menu (SimMeta.menu). */
export interface MenuOption { key: string; label: string; category?: Category; proposalId?: string }
/** A tapback (iMessage reaction; Blooio "+love"/"+like") on an outbound message. */
export interface Reaction { kind: "love" | "like"; to: string }
/** Body text the channel delivers for a tapback. */
export const REACTION_TEXT: Record<Reaction["kind"], string> = { love: "❤️", like: "👍" };

export interface SimMessage {
  id: string; ts: number; direction: Direction; channel: ChannelKind;
  /** For outbound: "network"; for inbound: the member id. */
  from: string; to: string; memberId: MemberId;
  body: string; status: DeliveryStatus; keyword?: Keyword;
  /** True for carrier/gateway auto-replies (STOP confirmation, HELP text). */
  system?: boolean;
  idempotencyKey?: string; meta?: SimMeta;
}

/** An inbound webhook payload as the Network sees it. */
export interface InboundMessage {
  id: string; memberId: MemberId; body: string; ts: number; channel: ChannelKind; keyword?: Keyword;
  /** A tapback on an outbound message (SimMeta.reaction); `body` then carries the emoji. Never a keyword. */
  reaction?: Reaction;
  /**
   * Where the text came from: the member's own thread ("text", the default) or a profile their AI
   * assistant sent through the MCP server's submit_profile ("mcp"). An "mcp" text is learned as a
   * profile; it never answers a question the Network asked in the thread.
   */
  source?: "mcp" | "text";
}

export interface MeetingReport {
  proposalId: string; participants: MemberId[]; at: number; city: City; kind?: string;
}

export interface NetworkContext {
  clock: Clock;
  /**
   * Send an outbound message to a member through the simulated channel. `reply`: the Network sends
   * it as a direct answer to the member's own message (a delivery queue may send it at once, past
   * quiet hours and conversation caps). The Network decides this; a context never guesses it.
   */
  send(memberId: MemberId, body: string, opts?: { meta?: SimMeta; idempotencyKey?: string; reply?: boolean }): SimMessage;
  /**
   * Public view of joined members in core types, as a perfect onboarding/extraction would
   * capture it (stated interests, intents, presence, boundaries and private disclosures
   * as agent_private facets). Hidden truth is never included.
   */
  snapshot(): WorldSnapshot;
  /** Sim hook: the Network created a proposal (logged and scored against the oracle). */
  recordProposal(p: Proposal, source?: "network" | "engine" | "scenario" | "player"): void;
  /** Sim hook: a meeting was confirmed; the world will decide attendance and outcomes. */
  recordMeeting(m: MeetingReport): string;
  /** Sim hook: a member blocked another (also visible in later snapshots as an edge). */
  recordBlock(from: MemberId, to: MemberId): void;
  /** Free-form structured log line. */
  log(type: string, detail: Record<string, unknown>): void;
  /**
   * Growth: a member invited a friend (by first name). The world creates that person, who joins
   * later if they accept. Returns the new member id, or undefined when the world has no factory.
   */
  invite?(inviterId: MemberId, friendName: string): MemberId | undefined;
}

export interface NetworkUnderTest {
  readonly name: string;
  init(ctx: NetworkContext): void | Promise<void>;
  /** Called for every inbound member message (including STOP/HELP keyword messages). */
  onInbound(msg: InboundMessage): void | Promise<void>;
  /** Called on every engine/job tick (default hourly sim time). Drain due jobs here. */
  tick(now: number): void | Promise<void>;
  /** Hand the Network proposals from an external Engine or a scenario script for dispatch. */
  submitProposal?(p: Proposal): void | Promise<void>;
}

/**
 * Matching engine contract (implemented by packages/engine; injected, never imported here).
 * Pure function of the snapshot: same snapshot + config + seed => same proposals (ME-004).
 */
export interface Engine {
  readonly name: string;
  propose(snapshot: WorldSnapshot, opts?: { city?: City; seed?: number | string }): Proposal[] | Promise<Proposal[]>;
}

export interface PlanOption { key: string; label: string; start?: number; end?: number; activity?: string; proposalId?: string }

/** What a plan probe carries (SimMeta.plan). Names nobody: activity, time, place, size. */
export interface PlanMeta {
  planId: string;
  /** Activity id (engine packs/network/activities.ts, e.g. "bouldering") or its label ("an easy group run"). */
  activity: string;
  options?: PlanOption[];
  window?: { start: number; end: number };
  /** Number of people in the plan (the probe says "with 3 others"). Default 4. */
  size?: number;
  /** Neighbourhood of the public place. */
  area?: string;
}
