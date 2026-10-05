// Idempotent outbound queue (PRD 32.2 network.outbound_messages).
//
// Guarantees:
//  - Same idempotency key + same payload => one record, one provider send (enqueue is a no-op on replay).
//  - Same key + different payload => IdempotencyConflictError (mirrors Blooio's 409).
//  - Every provider attempt reuses the record's provider idempotency key, so a retry after a lost response
//    cannot double-text the member.
//  - Opt-out is checked at dispatch time (not just enqueue), so a STOP that arrives while a message waits wins.
//  - Proactive messages respect quiet hours in the recipient's zone and are deferred, not dropped.
//  - Blooio conversation limits (429 conversation_*) hold the message until the recipient engages; they are
//    never retried on a timer (docs: messaging-safety).
//  - Terminal failure on the primary channel can fall back to another adapter (e.g. Twilio SMS) when allowed.
// Production: persist records in Postgres with a unique index on idempotency_key and use SELECT ... FOR UPDATE
// SKIP LOCKED for dispatch; this in-memory version keeps the same state machine.

import { DEFAULT_QUIET, isQuietAt, nextAllowedAt, type QuietWindow } from "./quiet-hours.ts";
import type { ConsentLedger } from "./keywords.ts";
import {
  ChannelSendError, type ChannelAdapter, type ChannelKind, type Clock, type DeliveryStatus, type StatusUpdate, type Transport,
} from "./types.ts";

export type MessageKind =
  | "reply"        // answer to a member's own message; quiet-hours exempt
  | "compliance"   // STOP/START/HELP confirmations; exempt from opt-out and quiet hours
  | "proactive"    // Network-initiated; quiet hours, consent, and rate limits apply
  | "transactional"; // reminders the member asked for; quiet hours apply, consent implied by request

export type RecordStatus =
  | "pending" | "sending" | "deferred_quiet_hours" | "held_awaiting_reply" | "retry_scheduled"
  | "accepted" | "sent" | "delivered" | "read"
  | "failed" | "suppressed_opt_out" | "suppressed_no_consent" | "blocked" | "fell_back";

const TERMINAL: RecordStatus[] = ["delivered", "read", "failed", "suppressed_opt_out", "suppressed_no_consent", "blocked", "fell_back"];
const PROVIDER_RANK: Record<string, number> = { accepted: 1, queued: 1, sent: 2, delivered: 3, read: 4 };

export interface EnqueueInput {
  idempotencyKey: string;
  channel: ChannelKind;
  to: string;
  from?: string;
  text: string;
  mediaUrls?: string[];
  kind: MessageKind;
  /** IANA zone of the recipient; required for proactive/transactional. */
  timeZone?: string;
  /** Network brief/template id for audit (network.outbound_messages.template_id). */
  briefId?: string;
  /** Allow fallback to `fallbackChannel` on terminal failure. */
  fallbackChannel?: ChannelKind;
  notBefore?: number;
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
  history: { at: number; status: RecordStatus; note?: string }[];
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) { super(`idempotency key reused with a different payload: ${key}`); this.name = "IdempotencyConflictError"; }
}

export interface QueueOptions {
  clock: Clock;
  adapters: Partial<Record<ChannelKind, ChannelAdapter>>;
  consent: ConsentLedger;
  quiet?: QuietWindow;
  /** Proactive sends require a recorded opt-in (PRD 36.1 "no proactive messages without consent"). Default true. */
  requireConsentForProactive?: boolean;
  /** Max sends of any kind to one recipient in a rolling hour (runaway-loop guard). Default 10. */
  perRecipientPerHour?: number;
  /** Max brand-new conversations per sender line per rolling day (Blooio guide: ~20-50/number/day). Default 20. */
  newChatsPerLinePerDay?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  onAlert?: (rec: OutboundRecord, reason: string) => void;
}

const HOUR = 3_600_000, DAY = 24 * HOUR;

function fingerprint(i: EnqueueInput): string {
  return JSON.stringify([i.channel, i.to, i.from ?? null, i.text, i.mediaUrls ?? [], i.kind]);
}

export class OutboundQueue {
  readonly records = new Map<string, OutboundRecord>(); // by idempotency key
  #byProviderId = new Map<string, OutboundRecord>();
  #fingerprints = new Map<string, string>();
  #sendLog: { to: string; at: number }[] = [];
  #newChatLog: { line: string; at: number }[] = [];
  #knownContacts = new Set<string>(); // channel:address that have engaged or been messaged
  #lineSafety = new Map<string, string>(); // line -> Blooio safety action
  #seq = 0;
  #draining = false;
  readonly o: Required<Omit<QueueOptions, "onAlert" | "adapters" | "consent" | "clock" | "quiet">> & QueueOptions;

  constructor(opts: QueueOptions) {
    this.o = {
      requireConsentForProactive: true, perRecipientPerHour: 10, newChatsPerLinePerDay: 20, maxAttempts: 6, baseBackoffMs: 30_000,
      ...opts,
    };
  }

  get #now() { return this.o.clock.now(); }

  enqueue(input: EnqueueInput): { record: OutboundRecord; deduped: boolean } {
    if (!input.idempotencyKey) throw new Error("idempotencyKey required");
    const existing = this.records.get(input.idempotencyKey);
    const fp = fingerprint(input);
    if (existing) {
      if (this.#fingerprints.get(input.idempotencyKey) !== fp) throw new IdempotencyConflictError(input.idempotencyKey);
      return { record: existing, deduped: true };
    }
    if ((input.kind === "proactive" || input.kind === "transactional") && !input.timeZone) {
      throw new Error("timeZone is required for proactive/transactional messages (quiet hours)");
    }
    const now = this.#now;
    const rec: OutboundRecord = {
      ...input,
      id: `ob_${++this.#seq}`,
      providerIdempotencyKey: `tn:${input.idempotencyKey}`,
      status: "pending",
      attempts: 0,
      nextAttemptAt: input.notBefore ?? now,
      createdAt: now,
      history: [{ at: now, status: "pending" }],
    };
    this.records.set(input.idempotencyKey, rec);
    this.#fingerprints.set(input.idempotencyKey, fp);
    return { record: rec, deduped: false };
  }

  #set(rec: OutboundRecord, status: RecordStatus, note?: string) {
    rec.status = status;
    rec.history.push({ at: this.#now, status, note });
  }

  /** Dispatch everything due. Safe to call concurrently (re-entrant calls are no-ops). */
  async drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      const due = [...this.records.values()]
        .filter((r) => (r.status === "pending" || r.status === "retry_scheduled" || r.status === "deferred_quiet_hours") && r.nextAttemptAt <= this.#now)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt);
      for (const rec of due) await this.#dispatch(rec);
    } finally {
      this.#draining = false;
    }
  }

  async #dispatch(rec: OutboundRecord): Promise<void> {
    const now = this.#now;
    const contactKey = `${rec.channel}:${rec.to.toLowerCase()}`;

    // 1. Consent (checked at dispatch so a STOP received while waiting wins).
    if (rec.kind !== "compliance" && this.o.consent.isOptedOut(rec.channel, rec.to)) {
      return this.#set(rec, "suppressed_opt_out");
    }
    if (rec.kind === "proactive" && this.o.requireConsentForProactive && !this.o.consent.hasConsent(rec.channel, rec.to)) {
      return this.#set(rec, "suppressed_no_consent");
    }

    // 2. Quiet hours in the recipient's zone.
    if ((rec.kind === "proactive" || rec.kind === "transactional") && rec.timeZone && isQuietAt(now, rec.timeZone, this.o.quiet ?? DEFAULT_QUIET)) {
      rec.nextAttemptAt = nextAllowedAt(now, rec.timeZone, this.o.quiet ?? DEFAULT_QUIET);
      return this.#set(rec, "deferred_quiet_hours", `until ${new Date(rec.nextAttemptAt).toISOString()}`);
    }

    // 3. Line safety state (from Blooio safety.state_changed webhooks).
    const lineAction = rec.from ? this.#lineSafety.get(rec.from) : undefined;
    const isNewChat = !this.#knownContacts.has(contactKey);
    if (lineAction === "review" || (lineAction && ["pause_new", "reply_only"].includes(lineAction) && isNewChat)) {
      rec.nextAttemptAt = now + HOUR;
      this.#set(rec, "retry_scheduled", `line safety action ${lineAction}`);
      this.o.onAlert?.(rec, `line_safety_${lineAction}`);
      return;
    }

    // 4. Rate limits.
    this.#sendLog = this.#sendLog.filter((e) => e.at > now - HOUR);
    if (rec.kind !== "compliance" && this.#sendLog.filter((e) => e.to === contactKey).length >= this.o.perRecipientPerHour) {
      rec.nextAttemptAt = now + 5 * 60_000;
      return this.#set(rec, "retry_scheduled", "per-recipient rate limit");
    }
    const line = rec.from ?? `${rec.channel}:default`;
    this.#newChatLog = this.#newChatLog.filter((e) => e.at > now - DAY);
    if (isNewChat && rec.kind === "proactive" && this.#newChatLog.filter((e) => e.line === line).length >= this.o.newChatsPerLinePerDay) {
      rec.nextAttemptAt = now + HOUR;
      return this.#set(rec, "retry_scheduled", "per-line new conversation cap");
    }

    const adapter = this.o.adapters[rec.channel];
    if (!adapter) return this.#fail(rec, { message: `no adapter for channel ${rec.channel}`, failure: "invalid" });

    // 5. Send.
    this.#set(rec, "sending");
    rec.attempts++;
    try {
      const receipt = await adapter.send({ from: rec.from, to: rec.to, text: rec.text, mediaUrls: rec.mediaUrls, idempotencyKey: rec.providerIdempotencyKey });
      rec.providerMessageId = receipt.providerMessageId;
      rec.chatId = receipt.chatId;
      rec.transport = receipt.transport;
      rec.sentAt = this.#now;
      this.#byProviderId.set(receipt.providerMessageId, rec);
      this.#sendLog.push({ to: contactKey, at: this.#now });
      if (isNewChat) this.#newChatLog.push({ line, at: this.#now });
      this.#knownContacts.add(contactKey);
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
          this.o.onAlert?.(rec, e.code ?? "blocked");
          if (this.#fallback(rec)) return;
          return this.#set(rec, "blocked", e.code);
        default:
          return this.#fail(rec, rec.lastError);
      }
    }
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
      timeZone: rec.timeZone, briefId: rec.briefId,
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

  /** Apply a delivery/read/failure webhook. Returns the record, or undefined if the id is not ours. */
  applyStatus(u: StatusUpdate): OutboundRecord | undefined {
    const rec = this.#byProviderId.get(u.providerMessageId);
    if (!rec) return undefined;
    if (u.transport) rec.transport = u.transport;
    if (u.status === "failed") rec.lastError = { code: u.errorCode, message: u.errorMessage ?? "failed" };
    this.#applyProviderStatus(rec, u.status);
    return rec;
  }

  /** Recipient engaged (message or reaction): release held messages and mark the contact known. */
  onRecipientEngaged(channel: ChannelKind, address: string): number {
    const key = `${channel}:${address.toLowerCase()}`;
    this.#knownContacts.add(key);
    let released = 0;
    for (const r of this.records.values()) {
      if (r.status === "held_awaiting_reply" && r.channel === channel && r.to.toLowerCase() === address.toLowerCase()) {
        r.nextAttemptAt = this.#now;
        this.#set(r, "pending", "recipient engaged");
        released++;
      }
    }
    return released;
  }

  setLineSafety(line: string, action: string | undefined) {
    if (!action || action === "none") this.#lineSafety.delete(line);
    else this.#lineSafety.set(line, action);
  }

  byProviderId(id: string) { return this.#byProviderId.get(id); }
  get(key: string) { return this.records.get(key); }
}
