// One Blooio line for every app (founder decision 2, PRD 40.3): one OutboundQueue per line, shared by every
// app's runtime. Each record names its app; the per-line new-conversation cap, the unanswered streaks and the
// reply window are per line and per address across apps, and any inbound from an address engages it for
// every app. The queue's state is durable through its QueueStore (packages/blooio pg-queue-store.ts).
//
// Who may send (README.md in this folder has the matrix):
//  - an app's own sends (everything the Network composes, and join asks to non-members): BLOOIO_ALLOW_SEND=1
//    and that app's <APP>_LIVE_APPROVED=1;
//  - the line's system replies (HELP, STOP/START confirmations, the "leave <app>" confirmation, the short "not
//    open yet" for a keyword of an app that is not live): BLOOIO_ALLOW_SEND=1 and at least one app live.
// In "dry_run" mode the provider is a recording fake and BLOOIO_ALLOW_SEND is not needed: the apps in
// QUEUE_DRY_RUN_APPS (default every app) count as live, so the whole queue runs before any live send.
import { createHmac } from "node:crypto";
import type { MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { blooioRecipientPolicy, forbiddenProvider, type ConsentNetwork } from "../src/network.ts";
import { ConsentLedger } from "../../blooio/src/ledger.ts";
import {
  DEFAULT_MAX_UNANSWERED, DEFAULT_REENGAGE_AFTER_MS, OutboundQueue,
  type EnqueueInput, type ForbiddenProvider, type OutboundRecord, type QueueAlert, type QueueOptions, type QueueStore, type RecipientPolicy,
} from "../../blooio/src/outbound-queue.ts";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import type { Clock, ChannelAdapter as ProviderAdapter, StatusUpdate } from "../../blooio/src/types.ts";
import { APP_IDS } from "../../platform/src/apps.ts";

export type LineMode = "live" | "dry_run";
type Env = Record<string, string | undefined>;

/** The app's own live flag: NTWRK_LIVE_APPROVED, SLOP_LIVE_APPROVED, ... */
export const liveFlag = (app: string) => `${app.toUpperCase()}_LIVE_APPROVED`;

/** The apps a dry run treats as live (QUEUE_DRY_RUN_APPS: a comma list, or "*" / unset for every app). */
export function dryRunApps(env: Env): Set<string> | "all" {
  const v = env.QUEUE_DRY_RUN_APPS?.trim();
  if (!v || v === "*") return "all";
  return new Set(v.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * May this app send its own messages on the line? Live: BLOOIO_ALLOW_SEND=1 and <APP>_LIVE_APPROVED=1 (no other
 * app's flag). Dry run: the app is in QUEUE_DRY_RUN_APPS (default every app).
 */
export function appApproved(env: Env, app: string, mode: LineMode = "live"): boolean {
  if (mode === "dry_run") { const apps = dryRunApps(env); return apps === "all" || apps.has(app); }
  return env.BLOOIO_ALLOW_SEND === "1" && env[liveFlag(app)] === "1";
}

/** May the line send its system replies (HELP, STOP/START, leave, "not open yet")? When at least one app may send. */
export function lineApproved(env: Env, mode: LineMode = "live", apps: readonly string[] = APP_IDS): boolean {
  return apps.some(a => appApproved(env, a, mode));
}

/** The short reply to a keyword of an app that is not live on the line yet (no join starts, nothing is stored). */
export const notOpenText = (name: string, domain: string) => `${name} (${domain}) isn't open yet. Nothing was saved. Reply HELP for help or STOP to stop.`;

/** A waiting send older than this is not sent (as runtime.ts WAITING_TTL_*: proactive 24 h, the rest 3 days). */
const MAX_WAIT_PROACTIVE_MS = DAY;
const MAX_WAIT_MS = 3 * DAY;

/** Queue defaults the environment may override: QUEUE_MAX_UNANSWERED, QUEUE_REENGAGE_AFTER_DAYS. */
export function queueDefaults(env: Env): Pick<QueueOptions, "maxUnansweredForInterruption" | "reengageAfterMs"> {
  const int = (name: string, dflt: number) => {
    const v = env[name];
    if (v === undefined || v === "") return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number (got ${JSON.stringify(v)})`);
    return n;
  };
  return {
    maxUnansweredForInterruption: int("QUEUE_MAX_UNANSWERED", DEFAULT_MAX_UNANSWERED),
    reengageAfterMs: int("QUEUE_REENGAGE_AFTER_DAYS", DEFAULT_REENGAGE_AFTER_MS / DAY) * DAY,
  };
}

/** The send-time checks of one app on the line. */
export interface AppHooks { policy: RecipientPolicy; forbidden: ForbiddenProvider }

export interface SharedLineOptions {
  /** The provider: packages/blooio BlooioAdapter over a BlooioClient (live), or a recording fake (dry run). */
  provider: ProviderAdapter;
  clock: Clock;
  /** The sending line (BLOOIO_FROM). Line-safety events with no line apply to it. */
  from?: string;
  mode?: LineMode;
  /** Read for the live flags on every send. Default process.env. */
  env?: Env;
  log?: (line: string) => void;
  /** Durable queue state (default: memory only). */
  store?: QueueStore;
  /** The key for address hashes (PLATFORM_HASH_KEY). Counters and alerts never hold a number. */
  hashKey?: string;
  /** Extra queue options (tests: caps). */
  queue?: Partial<Omit<QueueOptions, "clock" | "adapters" | "consent" | "store">>;
}

/** What one app's adapter sees of the shared queue: its own records, enqueued with its app id. */
export interface AppQueue {
  readonly app: string;
  enqueue(input: EnqueueInput): { record: OutboundRecord; deduped: boolean };
  drain(): Promise<void>;
  get(key: string): OutboundRecord | undefined;
}

export class SharedLine {
  readonly queue: OutboundQueue;
  readonly mode: LineMode;
  readonly from?: string;
  private readonly env: Env;
  private readonly log: (line: string) => void;
  private readonly hashKey: string;
  private readonly hooks = new Map<string, AppHooks>();
  /** STOP is per app (a global stop reaches every app's adapter); the queue reads both at dispatch. */
  private readonly optOuts = new Map<string, ConsentLedger>();
  private readonly clock: Clock;
  /** Status changes per app since that app last took them. */
  private readonly changes = new Map<string, Map<string, string>>();
  private alerts: Promise<void> = Promise.resolve();
  private started?: Promise<void>;

  constructor(o: SharedLineOptions) {
    this.mode = o.mode ?? "live";
    this.env = o.env ?? process.env;
    this.log = o.log ?? console.log;
    this.clock = o.clock;
    this.from = o.from ? normalizeAddress(o.from) : undefined;
    this.hashKey = o.hashKey ?? "dev-only-platform-hash-key";
    this.queue = new OutboundQueue({
      clock: o.clock, adapters: { blooio: o.provider }, requireConsentForProactive: false,
      // Joining an app (network.members) is the member's consent; STOP is recorded here and in the platform ledger.
      consent: { isOptedOut: (ch, a, app) => (app ? !!this.optOuts.get(app)?.isOptedOut(ch, a) : false), hasConsent: () => true },
      ...(this.from ? { defaultFrom: { blooio: this.from } } : {}),
      ...queueDefaults(this.env),
      ...o.queue,
      store: o.store,
      addressKey: a => this.hash(a),
      recipientPolicy: (to, ctx) => {
        const h = ctx.app ? this.hooks.get(ctx.app) : undefined;
        return h ? h.policy(to, ctx) : { ok: false, reason: "unknown_app" };
      },
      forbiddenProvider: (to, m) => {
        const h = m.app ? this.hooks.get(m.app) : undefined;
        return h ? h.forbidden(to, m) : {};
      },
      sendable: rec => (rec.kind === "compliance" && rec.briefId === SYSTEM ? this.systemApproved : !!rec.app && this.approved(rec.app)),
      maxAgeMs: rec => (rec.kind === "compliance" ? undefined : rec.kind === "proactive" ? MAX_WAIT_PROACTIVE_MS : MAX_WAIT_MS),
      onChange: rec => { if (rec.app) this.changesOf(rec.app).set(rec.idempotencyKey, rec.status); },
      onAlert: (rec, why) => {
        this.log(`[blooio] alert ${why} on ${rec.idempotencyKey}`);
        this.alert({ kind: why, line: rec.from ?? null, addressHash: rec.to ? this.hash(normalizeAddress(rec.to)) : null, ...(rec.app ? { app: rec.app } : {}), detail: { key: rec.idempotencyKey, status: rec.status, messageKind: rec.kind } });
      },
    });
  }

  /** A keyed hash of a normalized address: the queue's counter key and the alerts' address_hash. */
  hash(address: string): string {
    return createHmac("sha256", this.hashKey).update(`queue:${address}`).digest("hex").slice(0, 32);
  }

  /** Load the stored state once (before the service delivers what a restart left waiting). */
  start(): Promise<void> { return (this.started ??= this.queue.start().then(() => { this.prunedAt = this.clock.now(); })); }

  /** The send-time checks of an app's network (its member store and leak lists). */
  register(app: string, net: ConsentNetwork, memberOf: (address: string) => MemberId | undefined) {
    const ids = (to: string) => (to.startsWith("chat:") ? net.opps.get(to.slice(5))?.participants : memberOf(to));
    this.registerHooks(app, { policy: blooioRecipientPolicy(net, memberOf), forbidden: forbiddenProvider(net, ids) });
  }
  registerHooks(app: string, h: AppHooks) { this.hooks.set(app, h); }

  /** This app may send its own messages now. */
  approved(app: string): boolean { return appApproved(this.env, app, this.mode); }
  /** The line may send its system replies now (some app may send). */
  get systemApproved(): boolean { return lineApproved(this.env, this.mode, [...new Set([...APP_IDS, ...this.hooks.keys()])]); }

  /** The flags this app still needs, for a log line. */
  needs(app: string): string {
    if (this.mode === "dry_run") return `QUEUE_DRY_RUN_APPS to include ${app}`;
    return ["BLOOIO_ALLOW_SEND=1", `${liveFlag(app)}=1`].join(", ");
  }

  private changesOf(app: string) {
    let m = this.changes.get(app);
    if (!m) { m = new Map(); this.changes.set(app, m); }
    return m;
  }

  /** The status changes of this app's records since it last asked (then forgets them). */
  takeChanges(app: string, except?: Set<string>): { id: string; status: string }[] {
    const m = this.changes.get(app);
    if (!m) return [];
    this.changes.delete(app);
    return [...m].filter(([id]) => !except?.has(id)).map(([id, status]) => ({ id, status }));
  }

  /** One app's view of the queue: enqueue names the app; a stored record with the same key wins (after a restart the kind may be recomputed). */
  forApp(app: string): AppQueue {
    const q = this.queue;
    return {
      app,
      enqueue: input => {
        const existing = q.get(input.idempotencyKey);
        if (existing && existing.app === app) return { record: existing, deduped: true };
        return q.enqueue({ ...input, app });
      },
      drain: () => this.drain(),
      get: key => { const r = q.get(key); return r && r.app === app ? r : undefined; },
    };
  }

  /** Dispatch what is due, write the state and the alerts. Once a day, prune what is past its retention. */
  async drain(): Promise<void> {
    await this.queue.drain();
    const now = this.clock.now();
    if (this.prunedAt === undefined || now - this.prunedAt >= DAY) {
      this.prunedAt = now;
      await this.queue.prune().catch(e => this.log(`[blooio] queue prune failed: ${(e as Error).message}`));
    }
    await this.settleAlerts();
  }
  private prunedAt?: number;

  /**
   * A system reply on the line (HELP, STOP/START, leave, "not open yet"): allowed whenever some app may send.
   * Recorded under the app it is about. Returns the record's status.
   */
  async system(app: string, to: string, body: string, id: string): Promise<string> {
    if (!this.systemApproved) { this.log(`[blooio] refused a system reply: no app may send on the line`); return "refused_not_approved"; }
    const existing = this.queue.get(id);
    if (!existing) this.queue.enqueue({ idempotencyKey: id, channel: "blooio", to, text: body, kind: "compliance", briefId: SYSTEM, app });
    await this.drain();
    return this.queue.get(id)?.status ?? "failed";
  }

  /**
   * Someone wrote on the line: their conversation is engaged for every app (held messages go on the next drain,
   * replies are replies). `viaAssistant`: they acted through their own assistant, not in the thread, so only the
   * reply window opens. The service calls it once per line (ChannelAdapter.shared).
   */
  async engaged(address: string, o: { viaAssistant?: boolean } = {}): Promise<void> {
    const a = normalizeAddress(address);
    if (o.viaAssistant) this.queue.noteInbound(a);
    else this.queue.onRecipientEngaged("blooio", a);
    await this.queue.flush();
  }

  /** STOP (true) or START (false) from this address for one app. */
  optedOut(app: string, address: string, out: boolean) {
    let l = this.optOuts.get(app);
    if (!l) { l = new ConsentLedger(this.clock, "address"); this.optOuts.set(app, l); }
    l.record("blooio", address, out ? "opted_out" : "opted_in", out ? "keyword:STOP" : "keyword:START");
  }

  /** A delivery receipt: the record (any app) and its stored row. */
  async status(u: StatusUpdate): Promise<OutboundRecord | undefined> {
    const r = this.queue.applyStatus(u);
    if (r) await this.queue.flush();
    return r;
  }

  /**
   * A Blooio safety change. An event that names no line applies to this line (BLOOIO_FROM), else to every line:
   * it fails closed. Written to the store and as a queue_alert. Returns the line it applied to.
   */
  async lineSafety(line: string | undefined, action: string | undefined, detail: Record<string, unknown> = {}): Promise<string> {
    const l = this.queue.setLineSafety(line, action);
    await this.queue.flush();
    this.alert({ kind: "line_safety", line: l, addressHash: null, detail: { ...detail, action: action ?? "none", lineNamed: !!line?.trim() } });
    await this.settleAlerts();
    return l;
  }

  private alert(a: Omit<QueueAlert, "at">) {
    const full: QueueAlert = { ...a, at: this.clock.now() };
    this.alerts = this.alerts.then(() => this.queue.store.alert?.(full)).catch(e => this.log(`[blooio] queue alert not stored: ${(e as Error).message}`));
  }

  /** Wait for the alerts written so far. */
  settleAlerts(): Promise<void> { return this.alerts; }
}

/** briefId of the line's own system replies (the queue's sendable check reads it). */
const SYSTEM = "line:system";
