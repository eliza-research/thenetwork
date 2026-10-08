// Simulated SMS/iMessage channel: an in-memory message bus that behaves like the real
// gateway (PRD 32.2, 34.2 "Channel gateway"): timestamps from the Clock, carrier-level
// STOP/START/HELP keywords, outbound idempotency, seeded delivery failures, and a
// per-recipient log. The Network under test talks to members only through this.
import { HELP_TEXT, KEYWORDS, keywordKey, STOP_CONFIRMATION, type Clock, type MemberId } from "@thenetwork/core";
import { Rng } from "@thenetwork/core";

export type { ChannelKind, DeliveryStatus, Direction, Keyword, MenuOption, Reaction, SimItem, SimMessage, SimMeta, TimeOption } from "@thenetwork/core";
export { REACTION_TEXT } from "@thenetwork/core";
import type { ChannelKind, DeliveryStatus, Keyword, Reaction, SimMessage, SimMeta } from "@thenetwork/core";

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
