// Idempotent outbound queue (PRD 32.2 network.outbound_messages).
//
// Guarantees:
//  - Same idempotency key + same payload => one record, one provider send (enqueue is a no-op on replay).
//  - Same key + different payload => IdempotencyConflictError (mirrors Blooio's 409).
//  - Every provider attempt reuses the record's provider idempotency key, so a retry after a lost response
//    cannot double-text the member.
//  - Opt-out is checked at dispatch time (not just enqueue), so a STOP that arrives while a message waits wins.
//  - Every agent-initiated message (anything except a direct reply or a compliance confirmation) respects quiet
//    hours in the recipient's zone and is deferred, not dropped. An invalid zone parks that one record; it never
//    wedges the queue (audit P1-10).
//  - Founder/Blooio conversation rules are enforced before every send (audit P1-7, PRD 41.4): an interruption (any
//    agent-initiated kind) goes only while at most 1 message is unanswered; no send but compliance once 3 are
//    unanswered (Blooio's limit); exactly one re-engagement after 30 days of silence, reset only by an inbound
//    message; and a per-line daily cap on brand-new conversations for agent-initiated sends.
//  - An optional `recipientPolicy` re-checks the recipient (paused, blocked, safety hold, minor, opted out in the
//    member store) at send time, not just at enqueue (audit P1-5). It fails closed if it throws.
//  - All addresses are normalized to E.164 (phones) before any check, so formatting variants share one state.
//  - One bad record never stops the drain: an unexpected error parks that record and alerts.
//  - Blooio conversation limits (429 conversation_*) hold the message until the recipient engages; they are
//    never retried on a timer (docs: messaging-safety).
//  - Terminal failure on the primary channel can fall back to another adapter (e.g. Twilio SMS) when allowed.
//    A policy block ("blocked": line safety, opted out, emergency number) never falls back (plugin-prototypes-16).
//  - A "reply" must answer an inbound from that person within `replyWindowMs`; otherwise it is not sent, because
//    the caller's word alone must not skip quiet hours and proactive consent (plugin-prototypes-14).
//  - A `chat:<id>` group send checks every participant's opt-out and consent through `groupParticipants`; with
//    no resolver it is not sent (plugin-prototypes-13).
//  - A reply_only line holds every agent-initiated send; a record with no sender line gets the strictest safety
//    action of any line (plugin-prototypes-15).
//  - The shared leak guard (packages/core/src/guard.ts findLeaks) runs right before every provider send (PRD
//    28.5, 32.14). An injectable `forbiddenProvider` supplies the recipient-specific lists (other members'
//    private facts, private vocabulary, canaries); without one, contact patterns and canary shapes are still
//    checked. A hit blocks the send, records only hashed reasons, and parks the message for human review.
//  - State survives a restart through a `QueueStore` (records, per-line send counters, per-contact unanswered and
//    re-engagement state, line safety, the last inbound per address). `InMemoryQueueStore` is the default;
//    `PgQueueStore` (pg-queue-store.ts, migration 0014) keeps it in Postgres. `start()` loads it, `flush()` writes
//    what changed (drain flushes after every send). A store keeps the text and the address only while a record
//    waits or is parked for leak review; counters key on `addressKey` (a keyed hash in the service).
//  - Final records are pruned after 30 days (`prune`), so the records map does not grow without bound.
// One process owns a line's queue (the backend builds one per line); dispatch is not shared across processes.

import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_QUIET, isQuietAt, isValidTimeZone, nextAllowedAt, resolveTimeZone, type QuietWindow } from "./quiet-hours.ts";
import { normalizeAddress } from "./phone.ts";
import { DAY, HOUR } from "../../core/src/clock.ts";
import { LeakGuard } from "../../core/src/guard.ts";
import {
  ChannelSendError, type ChannelAdapter, type ChannelKind, type Clock, type DeliveryStatus, type StatusUpdate, type Transport,
} from "./types.ts";

export type MessageKind =
  | "reply"        // answer to a member's own message; quiet-hours exempt
  | "compliance"   // STOP/START/HELP confirmations; exempt from opt-out and quiet hours
  | "proactive"    // Network-initiated; quiet hours, consent, and rate limits apply
  | "transactional"; // reminders the member asked for; quiet hours apply, consent implied by request

/**
 * Everything the Network starts on its own (proactive intros, reminders, nudges, feedback asks, scheduling) is
 * agent-initiated. Only direct replies to a member's own message and STOP/HELP/START confirmations are not.
 * Any kind added later defaults to agent-initiated, so it gets quiet hours and the conversation caps.
 */
export function isAgentInitiated(kind: MessageKind): boolean {
  return kind !== "reply" && kind !== "compliance";
}

/** Result of a send-time eligibility check on the recipient. */
export type RecipientCheck = { ok: true } | { ok: false; reason: string };
/**
 * Send-time eligibility hook (member store lookup). Return `{ ok: false, reason }` for a recipient who is paused
 * (for agent-initiated kinds), blocked, on safety hold, a minor (for intro/group content), or opted out in the
 * member store. For a `chat:<id>` group target, check every participant. Throwing is treated as ineligible.
 */
export type RecipientPolicy = (
  to: string,
  ctx: { kind: MessageKind; channel: ChannelKind; briefId?: string; agentInitiated: boolean; app?: string },
) => RecipientCheck | Promise<RecipientCheck>;

/**
 * What must not appear in a message to this recipient, from the Network's member store. Every field is
 * optional. `forbidden` = other members' agent-private facts (whole or 4-word runs); `facts` = the same kind of
 * strings, additionally matched on fragments, leetspeak and reordering; `fuzzy: true` treats every forbidden
 * string as a fact; `privateVocab` = words that must never appear; `canaries` = privacy canary tokens;
 * `publicPhrases` = the Network's own public vocabulary, cut out of facts before matching. Exclude the
 * recipient's own facts. See LeakOptions in packages/core/src/guard.ts.
 */
export interface LeakSources {
  forbidden?: string[];
  privateVocab?: string[];
  canaries?: string[];
  facts?: string[];
  fuzzy?: boolean;
  publicPhrases?: string[];
  /** Links this recipient's app may name (its own settings pages), on top of `leakAllow`. */
  allow?: string[];
}
/** The message being checked (the provider may key its lists on the brief or kind). */
export interface LeakCheckMessage {
  idempotencyKey: string;
  text: string;
  kind: MessageKind;
  channel: ChannelKind;
  briefId?: string;
  /** The app the record was sent for (one queue serves every app on a line). */
  app?: string;
}
/**
 * Supplies the leak lists for one send. Called at dispatch, right before the provider send, so it sees the
 * current member store. `recipient` is the normalized address (E.164, Apple ID email, or `chat:<id>` for a group,
 * in which case cover every participant). Throwing parks the message (fails closed).
 */
export type ForbiddenProvider = (recipient: string, message: LeakCheckMessage) => LeakSources | Promise<LeakSources>;

/** Per-conversation counters used for the unanswered cap and the single re-engagement. */
export interface ContactState {
  unanswered: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  reengagementUsed: boolean;
}

export type RecordStatus =
  | "pending" | "sending" | "deferred_quiet_hours" | "held_awaiting_reply" | "retry_scheduled"
  | "accepted" | "sent" | "delivered" | "read"
  | "failed" | "suppressed_opt_out" | "suppressed_no_consent" | "suppressed_ineligible" | "blocked" | "fell_back"
  | "parked_invalid_timezone" | "parked_error" | "parked_leak_review" | "dropped_after_review" | "expired";

const TERMINAL: RecordStatus[] = [
  "delivered", "read", "failed", "suppressed_opt_out", "suppressed_no_consent", "suppressed_ineligible", "blocked", "fell_back",
  "parked_invalid_timezone", "parked_error", "parked_leak_review", "dropped_after_review", "expired",
];
/** Statuses that may still be sent (or still get a receipt): the store keeps their text and address. */
export const WAITING: RecordStatus[] = ["pending", "sending", "deferred_quiet_hours", "held_awaiting_reply", "retry_scheduled"];
/** True when the store must keep the record's text and address: it may still be sent, or a reviewer must read it. */
export const keepsContent = (s: RecordStatus) => WAITING.includes(s) || s === "parked_leak_review";
const PROVIDER_RANK: Record<string, number> = { accepted: 1, queued: 1, sent: 2, delivered: 3, read: 4 };

export interface EnqueueInput {
  idempotencyKey: string;
  channel: ChannelKind;
  to: string;
  from?: string;
  text: string;
  mediaUrls?: string[];
  kind: MessageKind;
  /** IANA zone of the recipient; required (or `city`) for agent-initiated kinds. Validated at enqueue. */
  timeZone?: string;
  /** Member's city (e.g. "sf"); its zone is the fallback when `timeZone` is missing or invalid. */
  city?: string;
  /** Network brief/template id for audit (network.outbound_messages.template_id). */
  briefId?: string;
  /** Allow fallback to `fallbackChannel` on terminal failure. */
  fallbackChannel?: ChannelKind;
  notBefore?: number;
  /** The app this message is for. One queue serves every app on a line; the policy hooks get it. */
  app?: string;
}

export interface OutboundRecord extends EnqueueInput {
  id: string;
  providerIdempotencyKey: string;
  status: RecordStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  providerMessageId?: string;
  chatId?: string;
  transport?: Transport;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  lastError?: { failure?: string; status?: number; code?: string; message: string };
  fallbackRecordId?: string;
  /** Hashed leak-guard reasons (e.g. "forbidden:1a2b3c4d", "contact:phone") when parked for leak review. */
  leakReasons?: string[];
  /** A reviewer approved this exact text after a leak block: later dispatches (and retries) skip the leak check. */
  leakReviewApproved?: boolean;
  history: { at: number; status: RecordStatus; note?: string }[];
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) { super(`idempotency key reused with a different payload: ${key}`); this.name = "IdempotencyConflictError"; }
}

/** What the queue reads from a consent ledger. `ConsentLedger` fits; a line shared by apps passes the app too. */
export interface ConsentView {
  isOptedOut(channel: ChannelKind, address: string, app?: string): boolean;
  hasConsent(channel: ChannelKind, address: string, app?: string): boolean;
}

// ------------------------------------------------------------------ the store

/** One send the line made: the per-recipient hourly cap and the per-line new-conversation cap count these. */
export interface StoredSend { line: string; addressKey: string; at: number; newChat: boolean }
/** Per-conversation counters. `key` is `${channel}:${addressKey}`; `known`: the contact engaged or was messaged. */
export interface StoredContact { key: string; state: ContactState; known: boolean }
/** A record, the hash of what was enqueued (an idempotent replay must match it) and its address key (empty once the address is dropped). */
export interface StoredRecord { record: OutboundRecord; fingerprint: string; addressKey?: string }
/** Everything a store gives back on start. */
export interface QueueSnapshot {
  records: StoredRecord[];
  sends: StoredSend[];
  contacts: StoredContact[];
  lineSafety: { line: string; action: string }[];
  /** Last inbound per address key (the reply window). */
  inbound: { addressKey: string; at: number }[];
}
/** One flush: everything that changed since the last one. An absent `action` clears the line's safety state. */
export interface QueueWrite {
  records: StoredRecord[];
  sends: StoredSend[];
  contacts: StoredContact[];
  lineSafety: { line: string; action?: string }[];
  inbound: { addressKey: string; at: number }[];
}
/** Cut-off times for prune: final records, send counters, inbound times and idle contacts older than these go. */
export interface PruneBefore { records: number; sends: number; inbound: number; contacts: number }
/** A queue alert for the operators (the service writes them as network.events rows of type 'queue_alert'). */
export interface QueueAlert { kind: string; line: string | null; addressHash: string | null; app?: string; detail: Record<string, unknown>; at: number }

/**
 * Durable queue state. `write` gets one batch per flush and must be durable before it resolves (throw on
 * failure). A record whose status no longer `keepsContent` is stored without its text and address.
 */
export interface QueueStore {
  load(): QueueSnapshot | Promise<QueueSnapshot>;
  write(batch: QueueWrite): void | Promise<void>;
  /** Remove what is older than the cut-offs. Never a waiting record or one parked for leak review. Returns rows removed. */
  prune(before: PruneBefore): number | Promise<number>;
  alert?(a: QueueAlert): void | Promise<void>;
}

/** What a store keeps of a record: no text or address once it is final (parked for leak review keeps both). */
export function storedForm(rec: OutboundRecord): OutboundRecord {
  const copy: OutboundRecord = structuredClone(rec);
  if (!keepsContent(rec.status)) { copy.text = ""; copy.to = ""; if (copy.mediaUrls) copy.mediaUrls = []; }
  return copy;
}

const isPrunable = (r: OutboundRecord, before: number) => r.createdAt < before && !WAITING.includes(r.status) && r.status !== "parked_leak_review";

/** The default store: plain memory, with the same rules as the Postgres store (tests restart a queue on it). */
export class InMemoryQueueStore implements QueueStore {
  readonly records = new Map<string, StoredRecord>();
  sends: StoredSend[] = [];
  readonly contacts = new Map<string, StoredContact>();
  readonly lineSafety = new Map<string, string>();
  readonly inbound = new Map<string, number>();
  readonly alerts: QueueAlert[] = [];

  load(): QueueSnapshot {
    return {
      records: [...this.records.values()].map(r => structuredClone(r)),
      sends: this.sends.map(s => ({ ...s })),
      contacts: [...this.contacts.values()].map(c => structuredClone(c)),
      lineSafety: [...this.lineSafety].map(([line, action]) => ({ line, action })),
      inbound: [...this.inbound].map(([addressKey, at]) => ({ addressKey, at })),
    };
  }

  write(b: QueueWrite): void {
    for (const r of b.records) this.records.set(r.record.idempotencyKey, { record: storedForm(r.record), fingerprint: r.fingerprint, addressKey: r.addressKey || this.records.get(r.record.idempotencyKey)?.addressKey });
    this.sends.push(...b.sends.map(s => ({ ...s })));
    for (const c of b.contacts) this.contacts.set(c.key, structuredClone(c));
    for (const l of b.lineSafety) { if (l.action) this.lineSafety.set(l.line, l.action); else this.lineSafety.delete(l.line); }
    for (const i of b.inbound) this.inbound.set(i.addressKey, Math.max(i.at, this.inbound.get(i.addressKey) ?? 0));
  }

  prune(p: PruneBefore): number {
    let n = 0;
    for (const [k, r] of this.records) if (isPrunable(r.record, p.records)) { this.records.delete(k); n++; }
    const before = this.sends.length;
    this.sends = this.sends.filter(s => s.at >= p.sends);
    n += before - this.sends.length;
    for (const [k, at] of this.inbound) if (at < p.inbound) { this.inbound.delete(k); n++; }
    for (const [k, c] of this.contacts) if (Math.max(c.state.lastInboundAt ?? 0, c.state.lastOutboundAt ?? 0) < p.contacts) { this.contacts.delete(k); n++; }
    return n;
  }

  alert(a: QueueAlert) { this.alerts.push(a); }
}

export interface QueueOptions {
  clock: Clock;
  adapters: Partial<Record<ChannelKind, ChannelAdapter>>;
  consent: ConsentView;
  quiet?: QuietWindow;
  /** Proactive sends require a recorded opt-in (PRD 36.1 "no proactive messages without consent"). Default true. */
  requireConsentForProactive?: boolean;
  /** Max sends of any kind to one recipient in a rolling hour (runaway-loop guard). Default 10. */
  perRecipientPerHour?: number;
  /** Max brand-new agent-initiated conversations per sender line per rolling day (Blooio: ~20-50/number/day). Default 20. */
  newChatsPerLinePerDay?: number;
  /** No send but compliance once this many messages are unanswered in a conversation (Blooio's limit). Default 3. */
  maxUnansweredPerConversation?: number;
  /** An interruption (agent-initiated) goes only while at most this many are unanswered (PRD 41.4). Replies are exempt. Default 1. */
  maxUnansweredForInterruption?: number;
  /** After this long since our last send, one agent-initiated re-engagement is allowed past the caps. Default 30 days. */
  reengageAfterMs?: number;
  /** Sender line per channel when a record has no `from`, so line safety and per-line caps always have a line. */
  defaultFrom?: Partial<Record<ChannelKind, string>>;
  /** Send-time recipient eligibility (paused/blocked/held/minor/opted out). Strongly recommended for live use. */
  recipientPolicy?: RecipientPolicy;
  /** Recipient-specific leak lists (other members' private facts, vocabulary, canaries). Strongly recommended for live use. */
  forbiddenProvider?: ForbiddenProvider;
  /**
   * Participants of a `chat:<id>` group target (normalized or raw addresses). Group sends other than compliance
   * are suppressed without it, and when it throws or returns no one.
   */
  groupParticipants?: (chatTarget: string) => string[] | Promise<string[]>;
  /** A "reply" must follow an inbound from the same person within this window. Default 1 hour. */
  replyWindowMs?: number;
  /** Text the Network may include verbatim (its own HELP/STOP copy); removed before the contact-pattern checks. */
  leakAllow?: string[];
  maxAttempts?: number;
  baseBackoffMs?: number;
  onAlert?: (rec: OutboundRecord, reason: string) => void;
  /** Durable state (default: InMemoryQueueStore). */
  store?: QueueStore;
  /** The key counters use for an address (the service passes a keyed hash). Default: the normalized address. */
  addressKey?: (normalized: string) => string;
  /** A waiting record older than this (from its creation) is not sent: it ends "expired". Default: no limit. */
  maxAgeMs?: (rec: OutboundRecord) => number | undefined;
  /** Called after every status change (the service collects them per app). */
  onChange?: (rec: OutboundRecord) => void;
  /** Checked first at dispatch: false ends the record "suppressed_ineligible" (not_approved). The service reads its live flags here. */
  sendable?: (rec: OutboundRecord) => boolean;
}

/** PRD 41.4: an interruption only while at most one message is unanswered. */
export const DEFAULT_MAX_UNANSWERED = 1;
/** Blooio's limit: three unanswered messages per conversation. */
export const BLOOIO_MAX_UNANSWERED = 3;
/** PRD 41.4: the single re-engagement after 30 or more days. */
export const DEFAULT_REENGAGE_AFTER_MS = 30 * DAY;
/** Final records stay this long (receipts, replays, the console), then prune() removes them. */
export const RECORD_RETENTION_MS = 30 * DAY;
/** A contact with no traffic for this long is forgotten (its next message counts as a new conversation again). */
export const CONTACT_RETENTION_MS = 180 * DAY;
/** The wildcard line: a safety action whose event named no line and no default line is configured (fail closed). */
export const ANY_LINE = "*";

function fingerprint(i: EnqueueInput): string {
  return createHash("sha256").update(JSON.stringify([i.channel, i.to, i.from ?? null, i.text, i.mediaUrls ?? [], i.kind])).digest("hex");
}

export class OutboundQueue {
  readonly records = new Map<string, OutboundRecord>(); // by idempotency key
  #byProviderId = new Map<string, OutboundRecord>();
  #fingerprints = new Map<string, string>();
  #sendLog: { to: string; at: number }[] = []; // to: address key
  #newChatLog: { line: string; at: number }[] = [];
  #knownContacts = new Set<string>(); // channel:addressKey that have engaged or been messaged
  #contacts = new Map<string, ContactState>(); // channel:addressKey -> unanswered/re-engagement counters
  #lineSafety = new Map<string, string>(); // line (or ANY_LINE) -> Blooio safety action
  #lastInbound = new Map<string, number>(); // address key (any channel) -> last inbound time
  // What changed since the last flush.
  #dirty = new Set<OutboundRecord>();
  #dirtyContacts = new Set<string>();
  #dirtySends: StoredSend[] = [];
  #dirtyLines = new Map<string, string | undefined>();
  #dirtyInbound = new Set<string>();
  #flushing: Promise<void> = Promise.resolve();
  #draining = false;
  readonly store: QueueStore;
  readonly o: Required<Omit<QueueOptions, "onAlert" | "adapters" | "consent" | "clock" | "quiet" | "defaultFrom" | "recipientPolicy" | "forbiddenProvider" | "leakAllow" | "groupParticipants" | "store" | "addressKey" | "maxAgeMs" | "onChange" | "sendable">> & QueueOptions;

  constructor(opts: QueueOptions) {
    this.o = {
      requireConsentForProactive: true, perRecipientPerHour: 10, newChatsPerLinePerDay: 20, maxAttempts: 6, baseBackoffMs: 30_000,
      maxUnansweredPerConversation: BLOOIO_MAX_UNANSWERED, maxUnansweredForInterruption: DEFAULT_MAX_UNANSWERED,
      reengageAfterMs: DEFAULT_REENGAGE_AFTER_MS, replyWindowMs: HOUR,
      ...opts,
    };
    this.store = opts.store ?? new InMemoryQueueStore();
  }

  /** The counters' key for an address (normalized first). */
  #key(address: string) { const a = normalizeAddress(address); return this.o.addressKey ? this.o.addressKey(a) : a; }
  #contactKey(channel: ChannelKind, address: string) { return `${channel}:${this.#key(address)}`; }

  #contact(key: string): ContactState {
    let c = this.#contacts.get(key);
    if (!c) { c = { unanswered: 0, reengagementUsed: false }; this.#contacts.set(key, c); }
    this.#dirtyContacts.add(key);
    return c;
  }

  get #now() { return this.o.clock.now(); }

  /**
   * Load the stored state (call once, before the first enqueue or drain): waiting and recent records, the send
   * counters of the last day, the contacts, line safety and the last inbound times. Then prune what is too old.
   */
  async start(): Promise<void> {
    const s = await this.store.load();
    const now = this.#now;
    for (const { record, fingerprint: fp } of s.records) {
      const rec: OutboundRecord = { ...record, history: record.history ?? [] };
      this.records.set(rec.idempotencyKey, rec);
      this.#fingerprints.set(rec.idempotencyKey, fp);
      if (rec.providerMessageId) this.#byProviderId.set(rec.providerMessageId, rec);
    }
    for (const e of s.sends) {
      if (e.at > now - HOUR) this.#sendLog.push({ to: e.addressKey, at: e.at });
      if (e.newChat && e.at > now - DAY) this.#newChatLog.push({ line: e.line, at: e.at });
    }
    for (const c of s.contacts) {
      this.#contacts.set(c.key, { ...c.state });
      if (c.known) this.#knownContacts.add(c.key);
    }
    for (const l of s.lineSafety) this.#lineSafety.set(l.line, l.action);
    for (const i of s.inbound) this.#lastInbound.set(i.addressKey, i.at);
    await this.prune();
  }

  /** Write everything that changed since the last flush (one batch). Concurrent calls run one after the other. */
  flush(): Promise<void> {
    const run = this.#flushing.then(() => this.#write());
    this.#flushing = run.catch(() => {});
    return run;
  }

  async #write() {
    if (!this.#dirty.size && !this.#dirtyContacts.size && !this.#dirtySends.length && !this.#dirtyLines.size && !this.#dirtyInbound.size) return;
    const batch: QueueWrite = {
      records: [...this.#dirty].map(r => ({ record: r, fingerprint: this.#fingerprints.get(r.idempotencyKey) ?? "", addressKey: r.to ? this.#key(r.to) : "" })),
      sends: this.#dirtySends,
      contacts: [...this.#dirtyContacts].map(key => ({ key, state: { ...(this.#contacts.get(key) ?? { unanswered: 0, reengagementUsed: false }) }, known: this.#knownContacts.has(key) })),
      lineSafety: [...this.#dirtyLines].map(([line, action]) => ({ line, ...(action ? { action } : {}) })),
      inbound: [...this.#dirtyInbound].map(addressKey => ({ addressKey, at: this.#lastInbound.get(addressKey) ?? 0 })),
    };
    this.#dirty = new Set(); this.#dirtyContacts = new Set(); this.#dirtySends = []; this.#dirtyLines = new Map(); this.#dirtyInbound = new Set();
    try {
      await this.store.write(batch);
    } catch (err) {
      // Not written: keep it dirty for the next flush (newer changes to the same rows win), then report.
      for (const r of batch.records) this.#dirty.add(r.record);
      for (const c of batch.contacts) this.#dirtyContacts.add(c.key);
      this.#dirtySends.unshift(...batch.sends);
      for (const l of batch.lineSafety) if (!this.#dirtyLines.has(l.line)) this.#dirtyLines.set(l.line, l.action);
      for (const i of batch.inbound) this.#dirtyInbound.add(i.addressKey);
      throw err;
    }
  }

  /**
   * Drop final records older than RECORD_RETENTION_MS (never a waiting record or one parked for leak review),
   * old send counters, inbound times and idle contacts, here and in the store. Returns the records removed here.
   */
  async prune(): Promise<number> {
    const now = this.#now;
    const before: PruneBefore = { records: now - RECORD_RETENTION_MS, sends: now - 2 * DAY, inbound: now - 2 * DAY, contacts: now - CONTACT_RETENTION_MS };
    let n = 0;
    for (const [k, r] of this.records) {
      if (!isPrunable(r, before.records) || this.#dirty.has(r)) continue;
      this.records.delete(k);
      this.#fingerprints.delete(k);
      if (r.providerMessageId) this.#byProviderId.delete(r.providerMessageId);
      n++;
    }
    this.#sendLog = this.#sendLog.filter(e => e.at > now - HOUR);
    this.#newChatLog = this.#newChatLog.filter(e => e.at > now - DAY);
    for (const [k, at] of this.#lastInbound) if (at < before.inbound && !this.#dirtyInbound.has(k)) this.#lastInbound.delete(k);
    for (const [k, c] of this.#contacts) {
      if (Math.max(c.lastInboundAt ?? 0, c.lastOutboundAt ?? 0) < before.contacts && !this.#dirtyContacts.has(k)) { this.#contacts.delete(k); this.#knownContacts.delete(k); }
    }
    await this.flush();
    await this.store.prune(before);
    return n;
  }

  enqueue(raw: EnqueueInput): { record: OutboundRecord; deduped: boolean } {
    if (!raw.idempotencyKey) throw new Error("idempotencyKey required");
    const from = raw.from ?? this.o.defaultFrom?.[raw.channel];
    const input: EnqueueInput = { ...raw, to: normalizeAddress(raw.to), ...(from ? { from: normalizeAddress(from) } : {}) };
    const existing = this.records.get(input.idempotencyKey);
    const fp = fingerprint(input);
    if (existing) {
      if (this.#fingerprints.get(input.idempotencyKey) !== fp) throw new IdempotencyConflictError(input.idempotencyKey);
      return { record: existing, deduped: true };
    }
    const agent = isAgentInitiated(input.kind);
    if (agent && !input.timeZone && !input.city) {
      throw new Error("timeZone (or city) is required for agent-initiated messages (quiet hours)");
    }
    const now = this.#now;
    // Validate the zone now so a bad value can never throw inside dispatch (audit P1-10).
    const zone = agent ? resolveTimeZone(input.timeZone, input.city) : input.timeZone;
    const rec: OutboundRecord = {
      ...input,
      id: `ob_${randomUUID()}`,
      providerIdempotencyKey: `tn:${input.idempotencyKey}`,
      status: "pending",
      attempts: 0,
      nextAttemptAt: input.notBefore ?? now,
      createdAt: now,
      history: [{ at: now, status: "pending" }],
    };
    this.records.set(input.idempotencyKey, rec);
    this.#fingerprints.set(input.idempotencyKey, fp);
    this.#dirty.add(rec);
    if (agent && !zone) {
      this.#set(rec, "parked_invalid_timezone", `unusable time zone ${JSON.stringify(input.timeZone ?? null)}`);
      this.o.onAlert?.(rec, "invalid_timezone");
    } else if (agent && zone !== input.timeZone) {
      rec.timeZone = zone!;
      rec.history.push({ at: now, status: "pending", note: `time zone from city ${input.city}` });
    }
    return { record: rec, deduped: false };
  }

  #set(rec: OutboundRecord, status: RecordStatus, note?: string) {
    rec.status = status;
    rec.history.push({ at: this.#now, status, note });
    this.#dirty.add(rec);
    this.o.onChange?.(rec);
  }

  /** Dispatch everything due, then write the state. Safe to call concurrently (re-entrant calls are no-ops). */
  async drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    let writeError: unknown;
    try {
      const due = [...this.records.values()]
        .filter((r) => (r.status === "pending" || r.status === "retry_scheduled" || r.status === "deferred_quiet_hours") && r.nextAttemptAt <= this.#now)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt);
      for (const rec of due) {
        try {
          await this.#dispatch(rec);
        } catch (err) {
          // Never let one record wedge the queue: park it for a human and keep draining.
          rec.lastError = { message: err instanceof Error ? err.message : String(err) };
          this.#set(rec, "parked_error", rec.lastError.message);
          this.o.onAlert?.(rec, "dispatch_error");
        }
        // Written after each record, so a crash loses at most one send's bookkeeping. A store error does not
        // stop the drain (the provider key makes a resend after a restart safe); it is thrown at the end.
        try { await this.flush(); } catch (err) { writeError ??= err; }
      }
    } finally {
      this.#draining = false;
    }
    if (writeError) throw writeError;
    await this.flush();
  }

  async #dispatch(rec: OutboundRecord): Promise<void> {
    const now = this.#now;
    const contactKey = this.#contactKey(rec.channel, rec.to);
    const agent = isAgentInitiated(rec.kind);

    // 0. Still approved to send (a live flag may be off since it was queued), and not too old to send (a restart
    // after a long outage; the service stores these as expired too).
    if (this.o.sendable && !this.o.sendable(rec)) return this.#set(rec, "suppressed_ineligible", "not_approved");
    const maxAge = this.o.maxAgeMs?.(rec);
    if (maxAge !== undefined && now - rec.createdAt > maxAge) return this.#set(rec, "expired", "waited too long");

    // 1. Consent (checked at dispatch so a STOP received while waiting wins). A group is checked per participant.
    let people = [rec.to];
    if (rec.kind !== "compliance" && rec.to.startsWith("chat:")) {
      if (!this.o.groupParticipants) return this.#set(rec, "suppressed_ineligible", "group send without a participant resolver");
      try {
        people = (await this.o.groupParticipants(rec.to)).map(normalizeAddress);
      } catch (err) {
        return this.#set(rec, "suppressed_ineligible", `participant resolver error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!people.length) return this.#set(rec, "suppressed_ineligible", "group has no known participants");
    }
    if (rec.kind !== "compliance" && people.some((p) => this.o.consent.isOptedOut(rec.channel, p, rec.app))) {
      return this.#set(rec, "suppressed_opt_out", people.length > 1 ? "a group participant opted out" : undefined);
    }
    if (rec.kind === "proactive" && this.o.requireConsentForProactive && !people.every((p) => this.o.consent.hasConsent(rec.channel, p, rec.app))) {
      return this.#set(rec, "suppressed_no_consent");
    }
    // A reply must answer something the person (or the group) sent recently.
    if (rec.kind === "reply") {
      const last = this.#lastInbound.get(this.#key(rec.to));
      if (last === undefined || now - last > this.o.replyWindowMs) {
        this.o.onAlert?.(rec, "reply_without_recent_inbound");
        return this.#set(rec, "suppressed_ineligible", "reply without a recent inbound");
      }
    }

    // 2. Recipient eligibility at send time (paused, blocked, held, minor, opted out in the member store).
    if (rec.kind !== "compliance" && this.o.recipientPolicy) {
      let check: RecipientCheck;
      try {
        check = await this.o.recipientPolicy(rec.to, { kind: rec.kind, channel: rec.channel, briefId: rec.briefId, agentInitiated: agent, ...(rec.app ? { app: rec.app } : {}) });
      } catch (err) {
        check = { ok: false, reason: `policy_error: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!check.ok) return this.#set(rec, "suppressed_ineligible", check.reason);
    }

    // 3. Quiet hours in the recipient's zone, for every agent-initiated kind.
    if (agent) {
      if (!isValidTimeZone(rec.timeZone)) {
        this.o.onAlert?.(rec, "invalid_timezone");
        return this.#set(rec, "parked_invalid_timezone", `unusable time zone ${JSON.stringify(rec.timeZone ?? null)}`);
      }
      const quiet = this.o.quiet ?? DEFAULT_QUIET;
      if (isQuietAt(now, rec.timeZone, quiet)) {
        rec.nextAttemptAt = nextAllowedAt(now, rec.timeZone, quiet);
        return this.#set(rec, "deferred_quiet_hours", `until ${new Date(rec.nextAttemptAt).toISOString()}`);
      }
    }

    // 4. Conversation rules (PRD 41.4): an interruption only while at most N (1) are unanswered; nothing but
    // compliance once Blooio's limit (3) is unanswered; one re-engagement after 30 days of silence.
    let reengagement = false;
    if (rec.kind !== "compliance") {
      const c = this.#contacts.get(contactKey) ?? { unanswered: 0, reengagementUsed: false };
      const over = c.unanswered >= this.o.maxUnansweredPerConversation || (agent && c.unanswered > this.o.maxUnansweredForInterruption);
      if (over) {
        const quietFor = c.lastOutboundAt === undefined ? Infinity : now - c.lastOutboundAt;
        if (agent && !c.reengagementUsed && quietFor >= this.o.reengageAfterMs) {
          reengagement = true;
        } else {
          return this.#set(rec, "held_awaiting_reply", c.reengagementUsed ? "unanswered_cap: re-engagement already used" : "unanswered_cap");
        }
      }
    }

    // 5. Line safety state (from Blooio safety.state_changed webhooks). An event that named no line holds every line.
    // With no sender line the provider picks one, so the strictest action of any line applies (fail closed).
    const line = rec.from ?? `${rec.channel}:default`;
    const lineAction = rec.from ? strictest([this.#lineSafety.get(line), this.#lineSafety.get(ANY_LINE)]) : strictest([...this.#lineSafety.values()]);
    const isNewChat = !this.#knownContacts.has(contactKey);
    if (lineAction === "review" || (lineAction === "reply_only" && (agent || isNewChat)) || (lineAction === "pause_new" && isNewChat)) {
      rec.nextAttemptAt = now + HOUR;
      this.#set(rec, "retry_scheduled", `line safety action ${lineAction}`);
      this.o.onAlert?.(rec, `line_safety_${lineAction}`);
      return;
    }

    // 6. Rate limits.
    // Per person across channels, so a fallback channel cannot double the cap.
    const toKey = this.#key(rec.to);
    this.#sendLog = this.#sendLog.filter((e) => e.at > now - HOUR);
    if (rec.kind !== "compliance" && this.#sendLog.filter((e) => e.to === toKey).length >= this.o.perRecipientPerHour) {
      rec.nextAttemptAt = now + 5 * 60_000;
      return this.#set(rec, "retry_scheduled", "per-recipient rate limit");
    }
    this.#newChatLog = this.#newChatLog.filter((e) => e.at > now - DAY);
    if (isNewChat && agent && this.#newChatLog.filter((e) => e.line === line).length >= this.o.newChatsPerLinePerDay) {
      rec.nextAttemptAt = now + HOUR;
      return this.#set(rec, "retry_scheduled", "per-line new conversation cap");
    }

    const adapter = this.o.adapters[rec.channel];
    if (!adapter) return this.#fail(rec, { message: `no adapter for channel ${rec.channel}`, failure: "invalid" });

    // 7. Leak guard, immediately before the send (after every hold/defer, so it sees the current lists).
    if (!rec.leakReviewApproved) {
      const reasons = await this.#leakReasons(rec);
      if (reasons.length) {
        rec.leakReasons = reasons;
        // Only hashed labels reach the history and the alert: never the message text or the matched value.
        this.#set(rec, "parked_leak_review", `leak: ${reasons.join(",")}`);
        this.o.onAlert?.(rec, "leak_blocked");
        return;
      }
    }

    // 8. Send.
    this.#set(rec, "sending");
    rec.attempts++;
    try {
      const receipt = await adapter.send({ from: rec.from, to: rec.to, text: rec.text, mediaUrls: rec.mediaUrls, idempotencyKey: rec.providerIdempotencyKey });
      const at = this.#now;
      rec.providerMessageId = receipt.providerMessageId;
      rec.chatId = receipt.chatId;
      rec.transport = receipt.transport;
      rec.sentAt = at;
      this.#byProviderId.set(receipt.providerMessageId, rec);
      this.#sendLog.push({ to: toKey, at });
      if (isNewChat) this.#newChatLog.push({ line, at });
      this.#dirtySends.push({ line, addressKey: toKey, at, newChat: isNewChat });
      this.#knownContacts.add(contactKey);
      const c = this.#contact(contactKey);
      if (rec.kind !== "compliance") {
        c.unanswered++;
        c.lastOutboundAt = at;
        if (reengagement) c.reengagementUsed = true;
      }
      this.#applyProviderStatus(rec, receipt.status === "queued" ? "accepted" : receipt.status, receipt.replayed ? "idempotent replay" : undefined);
    } catch (err) {
      const e = err instanceof ChannelSendError ? err : new ChannelSendError(err instanceof Error ? err.message : String(err), "retryable");
      rec.lastError = { failure: e.failure, status: e.status, code: e.code, message: e.message };
      switch (e.failure) {
        case "retryable": {
          if (rec.attempts >= this.o.maxAttempts) return this.#fail(rec, rec.lastError);
          const backoff = e.retryAfterMs ?? Math.min(this.o.baseBackoffMs * 2 ** (rec.attempts - 1), 30 * 60_000);
          rec.nextAttemptAt = this.#now + backoff;
          return this.#set(rec, "retry_scheduled", e.code ?? e.message);
        }
        case "await_recipient":
          return this.#set(rec, "held_awaiting_reply", e.code);
        case "blocked":
          // A policy block must not be routed around on another channel.
          this.o.onAlert?.(rec, e.code ?? "blocked");
          return this.#set(rec, "blocked", e.code);
        default:
          return this.#fail(rec, rec.lastError);
      }
    }
  }

  /** Leak-guard reasons for this record (empty = clean). Fails closed: a provider error is a reason. */
  async #leakReasons(rec: OutboundRecord): Promise<string[]> {
    let src: LeakSources = {};
    if (this.o.forbiddenProvider) {
      try {
        src = await this.o.forbiddenProvider(rec.to, { idempotencyKey: rec.idempotencyKey, text: rec.text, kind: rec.kind, channel: rec.channel, briefId: rec.briefId, ...(rec.app ? { app: rec.app } : {}) });
      } catch {
        return ["leak_check_error"];
      }
    }
    const guard = new LeakGuard({
      ...src,
      canaryShapes: true,
      allow: [...(this.o.leakAllow ?? []), ...(src.allow ?? [])],
      // STOP/HELP/START confirmations are the Network's fixed copy (which may carry its own contact details);
      // blocking them would break compliance. They still get the forbidden and canary checks.
      contacts: rec.kind !== "compliance",
    });
    return guard.check(rec.text);
  }

  /** Messages parked by the leak guard, waiting for a human (they survive a restart). */
  leakReviewQueue(): OutboundRecord[] {
    return [...this.records.values()].filter((r) => r.status === "parked_leak_review");
  }

  /**
   * Resolve a leak-guard park. "approve" re-queues the same text (a record's text never changes) and skips the
   * leak check for it from then on; every other pre-send check still runs; "drop" ends the record. Returns false if the record is not parked.
   */
  resolveLeakReview(idempotencyKey: string, decision: "approve" | "drop", reviewer?: string): boolean {
    const rec = this.records.get(idempotencyKey);
    if (!rec || rec.status !== "parked_leak_review") return false;
    const who = reviewer ? ` by ${reviewer}` : "";
    if (decision === "drop") {
      this.#set(rec, "dropped_after_review", `leak review: dropped${who}`);
      return true;
    }
    rec.leakReviewApproved = true;
    rec.nextAttemptAt = this.#now;
    this.#set(rec, "pending", `leak review: approved${who}`);
    return true;
  }

  #fail(rec: OutboundRecord, error: OutboundRecord["lastError"]) {
    rec.lastError = error;
    if (this.#fallback(rec)) return;
    this.#set(rec, "failed", error?.code ?? error?.message);
  }

  /** Enqueue a copy on the fallback channel (same consent/quiet rules apply). Returns true if it did. */
  #fallback(rec: OutboundRecord): boolean {
    if (!rec.fallbackChannel || rec.fallbackChannel === rec.channel || !this.o.adapters[rec.fallbackChannel]) return false;
    const { record } = this.enqueue({
      idempotencyKey: `${rec.idempotencyKey}:fallback:${rec.fallbackChannel}`,
      channel: rec.fallbackChannel, to: rec.to, text: rec.text, mediaUrls: rec.mediaUrls, kind: rec.kind,
      timeZone: rec.timeZone, city: rec.city, briefId: rec.briefId, ...(rec.app ? { app: rec.app } : {}),
    });
    rec.fallbackRecordId = record.id;
    this.#set(rec, "fell_back", `-> ${rec.fallbackChannel}`);
    return true;
  }

  #applyProviderStatus(rec: OutboundRecord, status: DeliveryStatus | "accepted", note?: string) {
    if (status === "failed") {
      if (!["sending", "accepted", "sent"].includes(rec.status)) return; // late failure after delivery: ignore
      return this.#fail(rec, rec.lastError ?? { message: "provider reported failure" });
    }
    if (TERMINAL.includes(rec.status) && !(rec.status === "delivered" && status === "read")) return;
    const cur = PROVIDER_RANK[rec.status] ?? 0;
    if ((PROVIDER_RANK[status] ?? 0) <= cur) return; // never regress (webhooks can arrive out of order)
    if (status === "delivered") rec.deliveredAt = this.#now;
    if (status === "read") { rec.readAt = this.#now; rec.deliveredAt ??= this.#now; }
    this.#set(rec, status as RecordStatus, note);
  }

  /**
   * Apply a delivery/read/failure webhook. Returns the record, or undefined if the id is not ours. Records sent
   * before a restart are loaded by start(), so their receipts update the stored row too (call flush()).
   */
  applyStatus(u: StatusUpdate): OutboundRecord | undefined {
    const rec = this.#byProviderId.get(u.providerMessageId);
    if (!rec) return undefined;
    if (u.transport) rec.transport = u.transport;
    if (u.status === "failed") rec.lastError = { code: u.errorCode, message: u.errorMessage ?? "failed" };
    this.#dirty.add(rec);
    this.#applyProviderStatus(rec, u.status);
    return rec;
  }

  /**
   * Recipient engaged (message or reaction): reset the unanswered counter and the re-engagement allowance,
   * release held messages and mark the contact known. Call flush() to make it durable.
   */
  onRecipientEngaged(channel: ChannelKind, address: string): number {
    const to = normalizeAddress(address);
    const key = this.#contactKey(channel, to);
    const now = this.#now;
    this.#knownContacts.add(key);
    this.#lastInbound.set(this.#key(to), now);
    this.#dirtyInbound.add(this.#key(to));
    const c = this.#contact(key);
    c.unanswered = 0;
    c.reengagementUsed = false;
    c.lastInboundAt = now;
    let released = 0;
    for (const r of this.records.values()) {
      if (r.status === "held_awaiting_reply" && r.channel === channel && r.to === to) {
        r.nextAttemptAt = now;
        this.#set(r, "pending", "recipient engaged");
        released++;
      }
    }
    return released;
  }

  /**
   * Opens the reply window for an address without engaging the conversation (the person acted somewhere else,
   * e.g. through their own assistant): replies to them are replies, but nothing is released and no counter resets.
   */
  noteInbound(address: string): void {
    const k = this.#key(address);
    this.#lastInbound.set(k, this.#now);
    this.#dirtyInbound.add(k);
  }

  /**
   * A Blooio safety action for a line. With no line, the queue's default line for Blooio takes it, else every
   * line (ANY_LINE): an event that names no line must never be stored where it does not apply. Call flush().
   */
  setLineSafety(line: string | undefined, action: string | undefined) {
    const named = line?.trim();
    const l = named ? normalizeAddress(named) : this.o.defaultFrom?.blooio ? normalizeAddress(this.o.defaultFrom.blooio) : ANY_LINE;
    if (!action || action === "none") this.#lineSafety.delete(l);
    else this.#lineSafety.set(l, action);
    this.#dirtyLines.set(l, !action || action === "none" ? undefined : action);
    return l;
  }

  /** The safety action that applies to a line now (its own or the any-line one), or undefined. */
  lineSafety(line: string): string | undefined {
    return strictest([this.#lineSafety.get(normalizeAddress(line)), this.#lineSafety.get(ANY_LINE)]);
  }

  /** Read-only view of a conversation's counters (for tests and the admin console). */
  contactState(channel: ChannelKind, address: string): Readonly<ContactState> | undefined {
    return this.#contacts.get(this.#contactKey(channel, address));
  }

  /** Brand-new conversations this line started in the last day (the per-line cap counts these). */
  newChats(line: string): number {
    const l = normalizeAddress(line), now = this.#now;
    return this.#newChatLog.filter(e => e.line === l && e.at > now - DAY).length;
  }

  byProviderId(id: string) { return this.#byProviderId.get(id); }
  get(key: string) { return this.records.get(key); }
}

/** The strictest of several Blooio safety actions (review, then reply_only, then pause_new, then anything else). */
function strictest(actions: (string | undefined)[]): string | undefined {
  const set = new Set(actions.filter((a): a is string => !!a));
  return ["review", "reply_only", "pause_new"].find((a) => set.has(a)) ?? [...set][0];
}
