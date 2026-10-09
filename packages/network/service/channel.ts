// Outbound channels for the production service (service.ts). The Network composes every message;
// a ChannelAdapter only delivers what the Network already decided to send.
//  - DryRunAdapter (the default): nothing leaves the machine. The service stores each send in
//    network.messages with status "dry_run", and the adapter logs one line (no message text).
//  - BlooioAdapter: one app's view of the line's shared OutboundQueue (shared-line.ts; packages/blooio)
//    with the Network's send-time recipient checks (blooioRecipientPolicy) and leak lists
//    (forbiddenProvider). An app's own sends need BLOOIO_ALLOW_SEND=1 and its <APP>_LIVE_APPROVED=1
//    (founder approval per app); otherwise they are refused ("refused_not_approved") and the provider
//    is never called. The line's system replies (HELP, STOP/START, leave, "not open yet") need
//    BLOOIO_ALLOW_SEND=1 and at least one app live. In the queue dry run (SharedLine mode "dry_run")
//    the provider is a recording fake and QUEUE_DRY_RUN_APPS stands in for the flags.
import type { MemberId } from "@thenetwork/core";
import type { ConsentNetwork } from "../src/network.ts";
import { type MessageKind } from "../../blooio/src/outbound-queue.ts";
import type { Clock, ChannelAdapter as ProviderAdapter, StatusUpdate } from "../../blooio/src/types.ts";
import { appApproved, liveFlag, SharedLine, type AppQueue } from "./shared-line.ts";

export { liveFlag, SharedLine };

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
  /** A photo of this member may ride on the send (a slop probe, SLOP_PROBE_PHOTO): the service checks it and sets mediaUrls, or drops it. */
  photoOf?: MemberId;
  /** Media to send with the text: at most one short-lived signed link to an approved photo. Not stored with the message. */
  mediaUrls?: string[];
}

/** Queue statuses that are not final: after a restart the service hands these rows to the adapter again (the provider key stops a second send). */
export const WAITING_STATUSES = ["queued", "pending", "sending", "deferred_quiet_hours", "held_awaiting_reply", "retry_scheduled"];

/** A message's delivery status now (network.messages.status). */
export interface Delivery { id: string; status: string }

/** A message parked by the leak guard, for staff (GET /queue/leak-review). */
export interface LeakItem { id: string; app?: string; kind: string; to: string; text: string; reasons: string[]; createdAt: number }

export interface ChannelAdapter {
  readonly name: "dry_run" | "blooio" | "queue_dry_run";
  /** The status a send is stored with, in the same transaction as the Network state. */
  readonly storedStatus: string;
  /** Deliver sends that are already stored. Returns the status of each one. */
  deliver(msgs: Outbound[]): Promise<Delivery[]>;
  /** Retry what waits (quiet hours, held until the member writes back). The service calls it on every tick. Returns changed statuses. */
  flush(): Promise<Delivery[]>;
  /** False when this app may not send its own messages (its live flag is off). Undefined: it may. */
  readonly live?: boolean;
  /** The line this adapter shares with other apps (the service calls line-wide hooks once per line). */
  readonly shared?: object;
  /** Someone wrote (a message or a tapback): held messages can go. `viaAssistant`: through their own assistant, not the thread. */
  engaged?(address: string, o?: { viaAssistant?: boolean }): void | Promise<void>;
  /** STOP (true) or START (false) from this address. */
  optedOut?(address: string, out: boolean): void;
  /** A delivery receipt from the provider: the status of this app's message, else undefined. */
  status?(u: StatusUpdate): Delivery | undefined | Promise<Delivery | undefined>;
  /** A line safety change from the provider. No line: the configured line (fail closed). */
  lineSafety?(line: string | undefined, action: string | undefined, detail?: Record<string, unknown>): void | Promise<void>;
  /**
   * A fixed text to someone who is not a member of this app (the invite-only reply, the join question,
   * an under-age decline, a keyword confirmation). Nothing about them is stored; the log line has no text.
   * `system`: a line reply (HELP, STOP, leave, "not open yet") that goes whenever any app may send.
   */
  direct(to: string, body: string, id: string, o?: { system?: boolean }): Promise<string>;
  /** Messages of this app parked by the leak guard. */
  leakReview?(): LeakItem[];
  /** Release (send after the other checks) or drop a parked message. Returns its new status, or undefined if it is not parked here. */
  resolveLeakReview?(id: string, decision: "release" | "drop", reviewer: string): Promise<string | undefined>;
}

/** Live sends of an app need BLOOIO_ALLOW_SEND=1 and its own <APP>_LIVE_APPROVED=1 (founder approval per app). */
export function liveSendAllowed(env: Record<string, string | undefined> = process.env, app = "ntwrk"): boolean {
  return appApproved(env, app, "live");
}

/** Nothing leaves the machine. The service stores every send with status "dry_run". */
export class DryRunAdapter implements ChannelAdapter {
  readonly name = "dry_run" as const;
  readonly storedStatus = "dry_run";
  constructor(private log: (line: string) => void = console.log) {}
  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    // The text is in network.messages; the log line never holds it.
    for (const m of msgs) this.log(`[dry-run] ${m.kind} ${m.type ?? "message"} to ${m.memberId}${m.oppId ? ` (${m.oppId})` : ""}, ${m.body.length} chars${m.mediaUrls?.length ? `, ${m.mediaUrls.length} photo` : ""}, id ${m.id}`);
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
  /** The line's shared queue (one per line, built once). Without it the adapter builds a line of its own over `provider`. */
  line?: SharedLine;
  /** The provider (packages/blooio BlooioAdapter over a BlooioClient). Tests pass a fake. Not used with `line`. */
  provider?: ProviderAdapter;
  clock: Clock;
  /** Address (as the queue normalizes it) to member id, from network.channel_identities. */
  memberOf: (address: string) => MemberId | undefined;
  /** The sending line (BLOOIO_FROM). Not used with `line`. */
  from?: string;
  /** The app this adapter sends for (its live flag). Default "ntwrk". */
  app?: string;
  /** The network's city, for the queue's per-city limits. Default "nyc". */
  city?: string;
  /** Read for the live flags on every delivery. Default process.env. Not used with `line`. */
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

/**
 * One app's sends on the line's shared OutboundQueue. The queue re-checks the recipient at send time
 * through this app's Network (blooioRecipientPolicy), runs the leak guard with its lists
 * (forbiddenProvider), keeps quiet hours, the unanswered caps, rate limits and idempotency, per line
 * and address across apps. Joining an app (a row in network.members) is the member's consent, so the
 * queue does not ask for a separate opt-in; STOP is recorded in the line's ledger and in the Network.
 */
export class BlooioAdapter implements ChannelAdapter {
  readonly name: "blooio" | "queue_dry_run";
  readonly storedStatus = "queued";
  readonly queue: AppQueue;
  readonly line: SharedLine;
  private log: (line: string) => void;
  readonly app: string;
  private city: string;

  constructor(o: BlooioAdapterOptions) {
    this.log = o.log ?? console.log;
    this.app = o.app ?? "ntwrk";
    this.city = o.city ?? "nyc";
    if (!o.line && !o.provider) throw new Error("BlooioAdapter needs a line or a provider");
    this.line = o.line ?? new SharedLine({ provider: o.provider!, clock: o.clock, from: o.from, env: o.env, log: this.log });
    this.line.register(this.app, o.net, o.memberOf);
    this.queue = this.line.forApp(this.app);
    this.name = this.line.mode === "dry_run" ? "queue_dry_run" : "blooio";
  }

  get shared() { return this.line; }
  get live() { return this.line.approved(this.app); }

  async direct(to: string, body: string, id: string, o: { system?: boolean } = {}): Promise<string> {
    if (o.system) return this.line.system(this.app, to, body, id);
    if (!this.live) { this.log(`[blooio] refused a direct send: ${this.app} needs ${this.line.needs(this.app)}`); return "refused_not_approved"; }
    if (!this.queue.get(id)) this.queue.enqueue({ idempotencyKey: id, channel: "blooio", to, text: body, kind: "compliance", city: this.city });
    await this.queue.drain();
    return this.queue.get(id)?.status ?? "failed";
  }

  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    const out: Delivery[] = [];
    const go: Outbound[] = [];
    let refused = 0;
    for (const m of msgs) {
      // A keyword confirmation (STOP, START, HELP) is the line's reply: it goes whenever any app may send.
      if (m.kind === "compliance" && m.system) {
        out.push({ id: m.id, status: m.to ? await this.line.system(this.app, m.to, m.body, m.id) : "failed_no_address" });
        continue;
      }
      if (!this.live) { refused++; out.push({ id: m.id, status: "refused_not_approved" }); continue; }
      if (!m.to) { out.push({ id: m.id, status: "failed_no_address" }); continue; }
      this.queue.enqueue({ idempotencyKey: m.id, channel: "blooio", to: m.to, text: m.body, kind: m.kind, city: this.city, ...(m.oppId ? { briefId: m.oppId } : {}), ...(m.mediaUrls?.length ? { mediaUrls: m.mediaUrls } : {}) });
      go.push(m);
    }
    if (refused) this.log(`[blooio] refused ${refused} send(s): ${this.app} needs ${this.line.needs(this.app)}`);
    if (go.length) await this.queue.drain();
    for (const m of go) out.push({ id: m.id, status: this.queue.get(m.id)?.status ?? "failed" });
    // Returned here; the next flush() need not report them again.
    this.line.takeChanges(this.app, new Set(out.map(d => d.id))).forEach(d => this.pending.set(d.id, d.status));
    return out;
  }
  /** Changes of other records seen while delivering, reported by the next flush(). */
  private pending = new Map<string, string>();

  async flush(): Promise<Delivery[]> {
    await this.line.drain();
    const changed = new Map(this.pending);
    this.pending.clear();
    for (const d of this.line.takeChanges(this.app)) changed.set(d.id, d.status);
    return [...changed].map(([id, status]) => ({ id, status }));
  }

  engaged(address: string, o?: { viaAssistant?: boolean }) { return this.line.engaged(address, o); }
  optedOut(address: string, out: boolean) { this.line.optedOut(this.app, address, out); }
  async status(u: StatusUpdate): Promise<Delivery | undefined> {
    // One line, several apps: only the app that sent it stores the status.
    if (this.line.queue.byProviderId(u.providerMessageId)?.app !== this.app) return undefined;
    const r = await this.line.status(u);
    return r ? { id: r.idempotencyKey, status: r.status } : undefined;
  }
  async lineSafety(line: string | undefined, action: string | undefined, detail?: Record<string, unknown>) { await this.line.lineSafety(line, action, detail); }

  leakReview(): LeakItem[] {
    return this.line.queue.leakReviewQueue().filter(r => r.app === this.app)
      .map(r => ({ id: r.idempotencyKey, app: r.app, kind: r.kind, to: r.to, text: r.text, reasons: r.leakReasons ?? [], createdAt: r.createdAt }));
  }

  async resolveLeakReview(id: string, decision: "release" | "drop", reviewer: string): Promise<string | undefined> {
    const r = this.line.queue.get(id);
    if (!r || r.app !== this.app || !this.line.queue.resolveLeakReview(id, decision === "release" ? "approve" : "drop", reviewer)) return undefined;
    await this.line.drain();
    this.line.takeChanges(this.app, new Set([id])).forEach(d => this.pending.set(d.id, d.status));
    return this.line.queue.get(id)?.status;
  }
}
