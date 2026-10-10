// Outbound channels for the production service (service.ts). The Network composes every message;
// a ChannelAdapter only delivers what the Network already decided to send.
//  - DryRunAdapter (the default): nothing leaves the machine. The service stores each send in
//    network.messages with status "dry_run", and the adapter logs one line (no message text).
//  - BlooioAdapter: the persisted queue (packages/blooio outbound-queue.ts, platform.outbound). The
//    runtime writes each send into the queue in the same transaction as the Network state; the queue
//    delivers after the commit, with the Network's send-time checks (consent, the recipient, the person
//    cap, the leak lists). It sends only when BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1 and the app's
//    own <APP>_LIVE_APPROVED=1 (founder approval per app; for ntwrk the last two are the same flag).
//    Otherwise every message is refused ("refused_not_approved") and the provider is never called.
import type { SQL } from "bun";
import type { MemberId } from "@thenetwork/core";
import { blooioRecipientPolicy, forbiddenProvider } from "../src/network.ts";
import { OutboundQueue, WAITING, type AppChecks, type MessageKind } from "../../blooio/src/outbound-queue.ts";
import type { Clock, ChannelAdapter as ProviderAdapter, StatusUpdate } from "../../blooio/src/types.ts";
import type { NetworkRuntime } from "./runtime.ts";
import { APPS } from "../../platform/src/apps.ts";

/** The apps' own domains: the Network's fixed copy names them ("you're in friends.help and peon.biz"), so the contact check allows them. */
const OWN_DOMAINS = Object.values(APPS).flatMap(a => [`https://${a.domain}`, `www.${a.domain}`, a.domain]);

/** One message the Network sent in a unit of work. `id` is the Network's idempotency key and the network.messages id. */
export interface Outbound {
  id: string;
  memberId: MemberId;
  /** The member's address (E.164 or Apple ID email) from the address book; undefined when there is none. */
  to?: string;
  body: string;
  /** HTTPS links to attachments (a photo). */
  mediaUrls?: string[];
  /** reply: an answer to the member's own message; compliance: STOP/HELP confirmations; proactive; transactional: everything else. */
  kind: MessageKind;
  type?: string;
  oppId?: string;
  proactive: boolean;
  system: boolean;
  ts: number;
  acceptedAt?: number;
}

/** Statuses that still wait for delivery (the queue's, and "queued" before the first drain). */
export const WAITING_STATUSES = ["queued", ...WAITING];

/** A message's delivery status now (network.messages.status). `app`: the app of the row (a receipt can be any app's). */
export interface Delivery { id: string; status: string; app?: string; memberId?: string }

export interface ChannelAdapter {
  readonly name: "dry_run" | "blooio" | "eliza_cloud";
  /** The status a send is stored with, in the same transaction as the Network state. */
  readonly storedStatus: string;
  /** Called once by the runtime that owns the adapter (the persisted queue needs its database and checks). */
  attach?(rt: NetworkRuntime): void;
  /**
   * A persisted adapter writes the unit's sends in the save transaction. Returns the status of each send
   * it did not queue (refused, no address). `forgotten`: members the unit forgets (their decline still goes).
   */
  enqueue?(tx: SQL, msgs: Outbound[], forgotten: ReadonlySet<MemberId>): Promise<Map<string, string>>;
  /** Deliver: a dry run returns the statuses of `msgs`; a persisted adapter drains its queue (msgs are already stored). */
  deliver(msgs: Outbound[]): Promise<Delivery[]>;
  /** Retry what waits (quiet hours, held until the member writes back). The service calls it on every tick. Returns changed statuses. */
  flush(): Promise<Delivery[]>;
  /** After a restart: rows a stopped worker held go back to the queue (sent again with the same provider key). */
  recover?(): Promise<number>;
  /** The person wrote (a message or a tapback) on the line: the streak resets and held messages can go. */
  engaged?(address: string): Promise<void>;
  /** A delivery receipt from the provider (any app on the line). */
  status?(u: StatusUpdate): Promise<Delivery | undefined>;
  /** Retention of the line's counters (addresses that are nobody's phone, idle for a day). */
  purge?(): Promise<number>;
  /** A line safety change from the provider. */
  lineSafety?(action: string | undefined, eventType?: string): Promise<void>;
  /**
   * A fixed text to someone who is not a member of this app (the invite-only reply, the join question,
   * an under-age decline, a keyword confirmation). The queue keeps the address and text only until the
   * row ends; the log line has no text.
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

/** Opportunity stages after which a waiting message about it is stale. */
const CLOSED_STAGES = new Set(["done", "closed"]);

export interface BlooioAdapterOptions {
  /** The provider (packages/blooio BlooioAdapter over a BlooioClient). The simulations pass a recording fake. */
  provider: ProviderAdapter;
  clock: Clock;
  /** The sending line (BLOOIO_FROM). Required: the queue's counters are per line. */
  from?: string;
  /** The app this adapter sends for (its live flag). Default "ntwrk". */
  app?: string;
  /** The network's city: its zone is the quiet-hours fallback. Default "nyc". */
  city?: string;
  /** Read for the live flags on every send. Default process.env. */
  env?: Record<string, string | undefined>;
  /**
   * Replaces the live flags. Accepted only with a provider whose kind is "sim" (a fake that cannot reach
   * Blooio): the pipeline simulation drives the real queue with it. Any real provider keeps the flags.
   */
  liveGate?: (app: string) => boolean;
  /** Queue limits (the per-line caps come from P3; defaults in outbound-queue.ts). Env: BLOOIO_LINE_DAILY_CAP, BLOOIO_LINE_NEW_CHATS_PER_DAY. */
  limits?: { perLinePerDay?: number; newChatsPerLinePerDay?: number; perRecipientPerHour?: number; baseBackoffMs?: number; leaseMs?: number };
  log?: (line: string) => void;
  /** Accepted for older callers and ignored: the runtime supplies the Network and the address book (attach). */
  net?: unknown;
  memberOf?: unknown;
}

/** Blooio behind the live flags, through the persisted queue (one queue object per app; one line lock for all). */
export class BlooioAdapter implements ChannelAdapter {
  readonly name: ChannelAdapter["name"] = "blooio";
  readonly storedStatus = "queued";
  readonly app: string;
  private readonly env: Record<string, string | undefined>;
  private readonly log: (line: string) => void;
  private readonly city: string;
  private readonly gate?: (app: string) => boolean;
  private q?: OutboundQueue;

  constructor(private readonly o: BlooioAdapterOptions) {
    this.env = o.env ?? process.env;
    this.log = o.log ?? console.log;
    this.app = o.app ?? "ntwrk";
    this.city = o.city ?? "nyc";
    if (!o.from) throw new Error("the Blooio adapter needs the sending line (BLOOIO_FROM)");
    if (o.liveGate && o.provider.kind !== "sim") throw new Error("liveGate is only for a simulated provider: a real provider always reads the live flags");
    this.gate = o.liveGate;
  }

  get live() { return this.gate ? this.gate(this.app) : liveSendAllowed(this.env, this.app); }
  private get flags() { return ["BLOOIO_ALLOW_SEND=1", "NTWRK_LIVE_APPROVED=1", ...(this.app === "ntwrk" ? [] : [`${liveFlag(this.app)}=1`])].join(", "); }

  /** The queue, after attach(). */
  get queue(): OutboundQueue {
    if (!this.q) throw new Error("BlooioAdapter is not attached to a network runtime");
    return this.q;
  }

  attach(rt: NetworkRuntime) {
    const policy = blooioRecipientPolicy(rt.net, rt.memberOf);
    const leaks = forbiddenProvider(rt.net, to => rt.memberOf(to));
    const num = (k: string) => { const v = Number(this.env[k]); return Number.isFinite(v) && v > 0 ? v : undefined; };
    const checks: AppChecks = {
      live: () => this.live,
      // A relayed item still goes after the date (the thread stays open for a week); a closed match stops it.
      stale: row => !!row.oppId && (row.id.startsWith("relay:") ? (rt.net.opps.get(row.oppId)?.stage ?? "closed") === "closed" : CLOSED_STAGES.has(rt.net.opps.get(row.oppId)?.stage ?? "")),
      optedOut: row => rt.optedOut(row.id, row.memberId as MemberId | undefined, row.to),
      recipient: (row, agentInitiated) => policy(row.to, { kind: row.kind, ...(row.oppId ? { briefId: row.oppId } : {}), agentInitiated }),
      // A number swap both members asked for (relay.ts) is the one contact the guard lets through, for that row only.
      leaks: row => { const from = rt.net.relayContactShareFrom(row.id), number = from && rt.addressOf(from); return number ? { ...leaks(row.to), allow: [number] } : leaks(row.to); },
      capTake: row => rt.capTake(row.id, row.memberId as MemberId),
      capRelease: row => rt.capRelease(row.id),
    };
    this.q = new OutboundQueue({
      sql: rt.db, clock: this.o.clock, provider: this.o.provider, line: this.o.from!, app: this.app, checks, instance: rt.instance,
      perLinePerDay: num("BLOOIO_LINE_DAILY_CAP"), newChatsPerLinePerDay: num("BLOOIO_LINE_NEW_CHATS_PER_DAY"), ...this.o.limits, leakAllow: OWN_DOMAINS,
      onAlert: (id, why) => this.log(`[blooio] alert ${why} on ${id} (${this.app})`),
    });
  }

  async enqueue(tx: SQL, msgs: Outbound[], forgotten: ReadonlySet<MemberId>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.live) {
      if (msgs.length) this.log(`[blooio] refused ${msgs.length} send(s): live sending needs ${this.flags}`);
      for (const m of msgs) out.set(m.id, "refused_not_approved");
      return out;
    }
    const go = msgs.filter(m => (m.to ? true : (out.set(m.id, "failed_no_address"), false)));
    await this.queue.enqueue(tx, go.map(m => ({
      // A member the unit forgets gets the one decline as a text to a non-member: nothing about them is kept.
      id: m.id, ...(forgotten.has(m.memberId) ? {} : { memberId: m.memberId }), to: m.to!, kind: m.kind, text: m.body,
      ...(m.mediaUrls?.length ? { mediaUrls: m.mediaUrls } : {}), ...(m.oppId ? { oppId: m.oppId } : {}), city: this.city,
    })));
    return out;
  }

  async deliver(_msgs: Outbound[]): Promise<Delivery[]> { return this.queue.drain(); }
  async flush(): Promise<Delivery[]> { return []; }
  recover() { return this.queue.recover(); }

  async direct(to: string, body: string, id: string): Promise<string> {
    if (!this.live) { this.log(`[blooio] refused a direct send: live sending needs ${this.flags}`); return "refused_not_approved"; }
    await this.queue.enqueue(this.queue.sql, [{ id, to, kind: "compliance", text: body, city: this.city }]);
    await this.queue.drain();
    return (await this.queue.statusOf(id)) ?? "failed";
  }

  async engaged(address: string) { await this.queue.inbound(address); }
  purge() { return this.queue.purge(); }
  status(u: StatusUpdate): Promise<Delivery | undefined> { return this.queue.applyStatus(u); }
  lineSafety(action: string | undefined, eventType?: string) { return this.queue.setLineSafety(action, eventType); }
}
