// Outbound channels for the production service (service.ts). The Network composes every message;
// a ChannelAdapter only delivers what the Network already decided to send.
//  - DryRunAdapter (the default): nothing leaves the machine. The service stores each send in
//    network.messages with status "dry_run", and the adapter logs one line (no message text).
//  - BlooioAdapter: the OutboundQueue (packages/blooio) with the Network's
//    send-time recipient checks (blooioRecipientPolicy) and leak lists (forbiddenProvider). It sends
//    only when BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1 and the app's own <APP>_LIVE_APPROVED=1
//    (founder approval per app; for ntwrk the last two are the same flag). Otherwise every message is
//    refused ("refused_not_approved") and the provider is never called.
import type { MemberId } from "@thenetwork/core";
import { blooioRecipientPolicy, forbiddenProvider, type ConsentNetwork } from "../src/network.ts";
import { ConsentLedger } from "../../blooio/src/keywords.ts";
import { OutboundQueue, type MessageKind } from "../../blooio/src/outbound-queue.ts";
import type { Clock, ChannelAdapter as ProviderAdapter, StatusUpdate } from "../../blooio/src/types.ts";

/** One message the Network sent in a unit of work. `id` is the Network's idempotency key and the network.messages id. */
export interface Outbound {
  id: string;
  memberId: MemberId;
  /** The member's address (E.164 or Apple ID email) from network.channel_identities; undefined when there is none. */
  to?: string;
  body: string;
  /** reply: an answer to the member's own message; compliance: STOP/HELP confirmations; proactive; transactional: everything else. */
  kind: MessageKind;
  type?: string;
  oppId?: string;
  proactive: boolean;
  system: boolean;
  ts: number;
}

/** Queue statuses that are not final: after a restart the service hands these rows to the adapter again (the provider key stops a second send). */
export const WAITING_STATUSES = ["queued", "pending", "sending", "deferred_quiet_hours", "held_awaiting_reply", "retry_scheduled"];

/** A message's delivery status now (network.messages.status). */
export interface Delivery { id: string; status: string }

export interface ChannelAdapter {
  readonly name: "dry_run" | "blooio";
  /** The status a send is stored with, in the same transaction as the Network state. */
  readonly storedStatus: string;
  /** Deliver sends that are already stored. Returns the status of each one. */
  deliver(msgs: Outbound[]): Promise<Delivery[]>;
  /** Retry what waits (quiet hours, held until the member writes back). The service calls it on every tick. Returns changed statuses. */
  flush(): Promise<Delivery[]>;
  /** The member wrote (a message or a tapback): held messages can go. */
  engaged?(address: string): void;
  /** STOP (true) or START (false) from this address. */
  optedOut?(address: string, out: boolean): void;
  /** A delivery receipt from the provider. */
  status?(u: StatusUpdate): Delivery | undefined;
  /** A line safety change from the provider. */
  lineSafety?(line: string, action: string | undefined): void;
  /**
   * A fixed text to someone who is not a member of this app (the invite-only reply, the join question,
   * an under-age decline, a keyword confirmation). Nothing about them is stored; the log line has no text.
   */
  direct(to: string, body: string, id: string): Promise<string>;
}

/** The app's own live flag: NTWRK_LIVE_APPROVED, SLOP_LIVE_APPROVED, ... */
export const liveFlag = (app: string) => `${app.toUpperCase()}_LIVE_APPROVED`;

/**
 * Live sends need BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1 (the founder's approval), and for an
 * app other than ntwrk its own <APP>_LIVE_APPROVED=1 too.
 */
export function liveSendAllowed(env: Record<string, string | undefined> = process.env, app = "ntwrk"): boolean {
  return env.BLOOIO_ALLOW_SEND === "1" && env.NTWRK_LIVE_APPROVED === "1" && env[liveFlag(app)] === "1";
}

/** Nothing leaves the machine. The service stores every send with status "dry_run". */
export class DryRunAdapter implements ChannelAdapter {
  readonly name = "dry_run" as const;
  readonly storedStatus = "dry_run";
  constructor(private log: (line: string) => void = console.log) {}
  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    // The text is in network.messages; the log line never holds it.
    for (const m of msgs) this.log(`[dry-run] ${m.kind} ${m.type ?? "message"} to ${m.memberId}${m.oppId ? ` (${m.oppId})` : ""}, ${m.body.length} chars, id ${m.id}`);
    return msgs.map(m => ({ id: m.id, status: "dry_run" }));
  }
  async flush(): Promise<Delivery[]> { return []; }
  async direct(_to: string, body: string, id: string): Promise<string> {
    this.log(`[dry-run] direct message to a non-member, ${body.length} chars, id ${id}`);
    return "dry_run";
  }
}

export interface BlooioAdapterOptions {
  net: ConsentNetwork;
  /** The provider (packages/blooio BlooioAdapter over a BlooioClient). Tests pass a fake. */
  provider: ProviderAdapter;
  clock: Clock;
  /** Address (as the queue normalizes it) to member id, from network.channel_identities. */
  memberOf: (address: string) => MemberId | undefined;
  /** The sending line (BLOOIO_FROM). */
  from?: string;
  /** The app this adapter sends for (its live flag). Default "ntwrk". */
  app?: string;
  /** The network's city, for the queue's per-city limits. Default "nyc". */
  city?: string;
  /** Read for the two live flags on every delivery. Default process.env. */
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

/**
 * The prototype's OutboundQueue behind the two live flags. The queue re-checks the recipient at
 * send time through the Network (blooioRecipientPolicy), runs the leak guard with the Network's
 * lists (forbiddenProvider), keeps quiet hours, the unanswered cap, rate limits and idempotency.
 * Joining the Network (a row in network.members) is the member's consent, so the queue does not
 * ask for a separate opt-in; STOP is recorded in its ledger and in the Network.
 */
export class BlooioAdapter implements ChannelAdapter {
  readonly name = "blooio" as const;
  readonly storedStatus = "queued";
  readonly queue: OutboundQueue;
  private ledger: ConsentLedger;
  private env: Record<string, string | undefined>;
  private log: (line: string) => void;
  readonly app: string;
  private city: string;
  /** Addresses that get one fixed non-member text (direct()): the recipient check lets that one compliance send through. */
  private strangers = new Set<string>();

  constructor(o: BlooioAdapterOptions) {
    this.env = o.env ?? process.env;
    this.log = o.log ?? console.log;
    this.app = o.app ?? "ntwrk";
    this.city = o.city ?? "nyc";
    this.ledger = new ConsentLedger(o.clock, "address");
    const ids = (to: string) => (to.startsWith("chat:") ? o.net.opps.get(to.slice(5))?.participants : o.memberOf(to));
    const members = blooioRecipientPolicy(o.net, o.memberOf);
    this.queue = new OutboundQueue({
      clock: o.clock, adapters: { blooio: o.provider }, consent: this.ledger, requireConsentForProactive: false,
      ...(o.from ? { defaultFrom: { blooio: o.from } } : {}),
      recipientPolicy: (to, ctx) => (ctx.kind === "compliance" && this.strangers.has(to) ? { ok: true } : members(to, ctx)),
      forbiddenProvider: forbiddenProvider(o.net, ids),
      onAlert: (r, why) => this.log(`[blooio] alert ${why} on ${r.idempotencyKey}`),
    });
  }

  get live() { return liveSendAllowed(this.env, this.app); }
  private get flags() { return ["BLOOIO_ALLOW_SEND=1", "NTWRK_LIVE_APPROVED=1", ...(this.app === "ntwrk" ? [] : [`${liveFlag(this.app)}=1`])].join(", "); }

  async direct(to: string, body: string, id: string): Promise<string> {
    if (!this.live) { this.log(`[blooio] refused a direct send: live sending needs ${this.flags}`); return "refused_not_approved"; }
    this.strangers.add(to);
    try {
      this.queue.enqueue({ idempotencyKey: id, channel: "blooio", to, text: body, kind: "compliance", city: this.city });
      await this.queue.drain();
      return this.queue.get(id)?.status ?? "failed";
    } finally { this.strangers.delete(to); }
  }

  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    if (!this.live) {
      if (msgs.length) this.log(`[blooio] refused ${msgs.length} send(s): live sending needs ${this.flags}`);
      return msgs.map(m => ({ id: m.id, status: "refused_not_approved" }));
    }
    const out: Delivery[] = [];
    for (const m of msgs) {
      if (!m.to) { out.push({ id: m.id, status: "failed_no_address" }); continue; }
      this.queue.enqueue({ idempotencyKey: m.id, channel: "blooio", to: m.to, text: m.body, kind: m.kind, city: this.city, ...(m.oppId ? { briefId: m.oppId } : {}) });
    }
    await this.queue.drain();
    for (const m of msgs) if (m.to) out.push({ id: m.id, status: this.queue.get(m.id)?.status ?? "failed" });
    return out;
  }

  async flush(): Promise<Delivery[]> {
    if (!this.live) return [];
    const before = new Map([...this.queue.records.values()].map(r => [r.idempotencyKey, r.status]));
    await this.queue.drain();
    return [...this.queue.records.values()].filter(r => before.get(r.idempotencyKey) !== r.status).map(r => ({ id: r.idempotencyKey, status: r.status }));
  }

  engaged(address: string) { this.queue.onRecipientEngaged("blooio", address); }
  optedOut(address: string, out: boolean) { this.ledger.record("blooio", address, out ? "opted_out" : "opted_in", out ? "keyword:STOP" : "keyword:START"); }
  status(u: StatusUpdate): Delivery | undefined { const r = this.queue.applyStatus(u); return r ? { id: r.idempotencyKey, status: r.status } : undefined; }
  lineSafety(line: string, action: string | undefined) { this.queue.setLineSafety(line, action); }
}
