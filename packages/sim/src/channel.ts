// Simulated SMS/iMessage channel: an in-memory message bus that behaves like the real
// gateway (PRD 32.2, 34.2 "Channel gateway"): timestamps from the Clock, carrier-level
// STOP/START/HELP keywords, outbound idempotency, seeded delivery failures, and a
// per-recipient log. The Network under test talks to members only through this.
import { HELP_TEXT, KEYWORDS, keywordKey, STOP_CONFIRMATION, type Clock, type MemberId } from "@thenetwork/core";
import { Rng } from "@thenetwork/core";

export type ChannelKind = "imessage" | "sms";
export type Direction = "outbound" | "inbound";
export type DeliveryStatus = "delivered" | "suppressed_opted_out" | "failed" | "duplicate";
export type Keyword = "STOP" | "START" | "HELP";

/**
 * Optional simulator-only annotation that a Network implementation MAY attach to outbound
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
  probe?: { key: string; category: import("@thenetwork/core").Category; participants?: MemberId[]; kind?: import("@thenetwork/core").OpportunityKind; window?: { start: number; end: number } };
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
  plan?: import("./plans.ts").PlanMeta;
  /** Outbound only, on a "crew_offer": the crew being offered. The persona opts in ("yes") or out. */
  crew?: { crewId: string; activity?: string };
  [k: string]: unknown;
}

/** One concrete time a message offers (SimMeta.timeOptions). */
export interface TimeOption { key: string; start: number; end: number; label: string }

/** An outside-world item (event or place) carried by an outbound message (SimMeta.items). */
export interface SimItem { key: string; label?: string; category?: import("@thenetwork/core").Category; tags?: string[] }
/** One option of a menu (SimMeta.menu). */
export interface MenuOption { key: string; label: string; category?: import("@thenetwork/core").Category; proposalId?: string }
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

export interface ChannelOptions { failureRate?: number; seed?: number | string }

// The keyword table and the compliance copy are core's (packages/core/src/replies.ts).
const STOP_WORDS = new Set<string>([...KEYWORDS.stop, ...KEYWORDS.stopAll]);
const START_WORDS = new Set<string>(KEYWORDS.start);
const HELP_WORDS = new Set<string>(KEYWORDS.help);

export { HELP_TEXT, STOP_CONFIRMATION };

export function detectKeyword(body: string): Keyword | undefined {
  const t = keywordKey(body);
  if (STOP_WORDS.has(t)) return "STOP";
  if (START_WORDS.has(t)) return "START";
  if (HELP_WORDS.has(t)) return "HELP";
  return undefined;
}

export class SimChannel {
  private seq = 0;
  private log: SimMessage[] = [];
  private byMember = new Map<MemberId, SimMessage[]>();
  private optedOut = new Set<MemberId>();
  private kinds = new Map<MemberId, ChannelKind>();
  private sentKeys = new Map<string, SimMessage>();
  private rng: Rng;
  private memberListeners: ((m: SimMessage) => void)[] = [];
  private networkListeners: ((m: SimMessage) => void)[] = [];

  constructor(private clock: Clock, private opts: ChannelOptions = {}) {
    this.rng = new Rng(`channel:${opts.seed ?? 0}`);
  }

  register(memberId: MemberId, kind: ChannelKind = "imessage") { this.kinds.set(memberId, kind); }
  isOptedOut(memberId: MemberId) { return this.optedOut.has(memberId); }

  /** Subscribe to messages delivered to member phones (the persona side). */
  onDeliverToMember(cb: (m: SimMessage) => void) { this.memberListeners.push(cb); }
  /** Subscribe to inbound messages reaching the Network webhook. */
  onInboundToNetwork(cb: (m: SimMessage) => void) { this.networkListeners.push(cb); }

  private record(m: SimMessage) {
    this.log.push(m);
    const arr = this.byMember.get(m.memberId) ?? [];
    arr.push(m);
    this.byMember.set(m.memberId, arr);
  }
  private nextId(prefix: string) { return `${prefix}${(++this.seq).toString().padStart(6, "0")}`; }

  /** Network -> member. Idempotent per idempotencyKey; suppressed after STOP. */
  send(to: MemberId, body: string, opts: { meta?: SimMeta; idempotencyKey?: string } = {}): SimMessage {
    if (opts.idempotencyKey) {
      const prev = this.sentKeys.get(opts.idempotencyKey);
      if (prev) return { ...prev, status: "duplicate" };
    }
    let status: DeliveryStatus = "delivered";
    if (this.optedOut.has(to)) status = "suppressed_opted_out";
    else if (this.opts.failureRate && this.rng.next() < this.opts.failureRate) status = "failed";
    const m: SimMessage = {
      id: this.nextId("o"), ts: this.clock.now(), direction: "outbound", channel: this.kinds.get(to) ?? "imessage",
      from: "network", to, memberId: to, body, status, idempotencyKey: opts.idempotencyKey, meta: opts.meta,
    };
    this.record(m);
    if (opts.idempotencyKey) this.sentKeys.set(opts.idempotencyKey, m);
    if (status === "delivered") for (const cb of this.memberListeners) cb(m);
    return m;
  }

  /**
   * Member -> network. Handles carrier keywords before forwarding to the webhook. With `reaction`, the
   * message is a tapback: it carries meta.reaction and is never a keyword.
   */
  receive(from: MemberId, body: string, opts: { reaction?: Reaction } = {}): SimMessage {
    const keyword = opts.reaction ? undefined : detectKeyword(body);
    const m: SimMessage = {
      id: this.nextId("i"), ts: this.clock.now(), direction: "inbound", channel: this.kinds.get(from) ?? "imessage",
      from, to: "network", memberId: from, body, status: "delivered", keyword,
    };
    if (opts.reaction) m.meta = { reaction: opts.reaction };
    this.record(m);
    if (keyword === "STOP") {
      this.optedOut.add(from);
      this.systemReply(from, STOP_CONFIRMATION);
    } else if (keyword === "START") {
      this.optedOut.delete(from);
      this.systemReply(from, "You're resubscribed to The Network. Reply STOP to opt out.");
    } else if (keyword === "HELP") {
      this.systemReply(from, HELP_TEXT);
    }
    // The Network still sees keyword messages (to update state), like a real webhook.
    for (const cb of this.networkListeners) cb(m);
    return m;
  }

  private systemReply(to: MemberId, body: string) {
    const m: SimMessage = {
      id: this.nextId("s"), ts: this.clock.now(), direction: "outbound", channel: this.kinds.get(to) ?? "imessage",
      from: "carrier", to, memberId: to, body, status: "delivered", system: true, meta: { type: "system" },
    };
    this.record(m);
    for (const cb of this.memberListeners) cb(m);
  }

  messagesFor(memberId: MemberId): SimMessage[] { return this.byMember.get(memberId)?.slice() ?? []; }
  all(): SimMessage[] { return this.log.slice(); }
}
