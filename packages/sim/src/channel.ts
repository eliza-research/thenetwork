// Simulated SMS/iMessage channel: an in-memory message bus that behaves like the real
// gateway (PRD 32.2, 34.2 "Channel gateway"): timestamps from the Clock, carrier-level
// STOP/START/HELP keywords, outbound idempotency, seeded delivery failures, and a
// per-recipient log. The Network under test talks to members only through this.
import type { Clock, MemberId } from "@thenetwork/core";
import { Rng } from "./rng.ts";

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
    | "growth_ask";
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
  [k: string]: unknown;
}

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

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES START"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export const STOP_CONFIRMATION = "You're unsubscribed from The Network and won't get more messages here. Reply START to resume.";
export const HELP_TEXT = "The Network: an invite-only AI that connects you with people. Reply STOP to opt out. Msg&data rates may apply.";

export function detectKeyword(body: string): Keyword | undefined {
  const t = body.trim().toUpperCase().replace(/[.!]+$/, "");
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

  /** Member -> network. Handles carrier keywords before forwarding to the webhook. */
  receive(from: MemberId, body: string): SimMessage {
    const keyword = detectKeyword(body);
    const m: SimMessage = {
      id: this.nextId("i"), ts: this.clock.now(), direction: "inbound", channel: this.kinds.get(from) ?? "imessage",
      from, to: "network", memberId: from, body, status: "delivered", keyword,
    };
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
