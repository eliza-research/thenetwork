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
//  - Founder/Blooio conversation rules are enforced before every send (audit P1-7): at most 3 unanswered messages
//    per conversation, then exactly one re-engagement after 14 days of silence, reset only by an inbound message;
//    and a per-line daily cap on brand-new conversations for agent-initiated sends.
//  - An optional `recipientPolicy` re-checks the recipient (paused, blocked, safety hold, minor, opted out in the
//    member store) at send time, not just at enqueue (audit P1-5). It fails closed if it throws.
//  - All addresses are normalized to E.164 (phones) before any check, so formatting variants share one state.
//  - One bad record never stops the drain: an unexpected error parks that record and alerts.
//  - Blooio conversation limits (429 conversation_*) hold the message until the recipient engages; they are
//    never retried on a timer (docs: messaging-safety).
//  - Terminal failure on the primary channel can fall back to another adapter (e.g. Twilio SMS) when allowed.
// Production: persist records in Postgres with a unique index on idempotency_key and use SELECT ... FOR UPDATE
// SKIP LOCKED for dispatch; this in-memory version keeps the same state machine.

import { DEFAULT_QUIET, isQuietAt, isValidTimeZone, nextAllowedAt, resolveTimeZone, type QuietWindow } from "./quiet-hours.ts";
import type { ConsentLedger } from "./keywords.ts";
import { normalizeAddress } from "./phone.ts";
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
  ctx: { kind: MessageKind; channel: ChannelKind; briefId?: string; agentInitiated: boolean },
) => RecipientCheck | Promise<RecipientCheck>;

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
  | "parked_invalid_timezone" | "parked_error";

const TERMINAL: RecordStatus[] = [
  "delivered", "read", "failed", "suppressed_opt_out", "suppressed_no_consent", "suppressed_ineligible", "blocked", "fell_back",
  "parked_invalid_timezone", "parked_error",
];
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
  /** Max brand-new agent-initiated conversations per sender line per rolling day (Blooio: ~20-50/number/day). Default 20. */
  newChatsPerLinePerDay?: number;
  /** Max messages sent into one conversation without an inbound reply (Blooio/founder rule). Default 3. */
  maxUnansweredPerConversation?: number;
  /** After this long since our last send, one agent-initiated re-engagement is allowed past the cap. Default 14 days. */
  reengageAfterMs?: number;
  /** Sender line per channel when a record has no `from`, so line safety and per-line caps always have a line. */
  defaultFrom?: Partial<Record<ChannelKind, string>>;
  /** Send-time recipient eligibility (paused/blocked/held/minor/opted out). Strongly recommended for live use. */
  recipientPolicy?: RecipientPolicy;
  maxAttempts?: number;
  baseBackoffMs?: number;
  onAlert?: (rec: OutboundRecord, reason: string) => void;
}

const HOUR = 3_600_000, DAY = 24 * HOUR;

export const DEFAULT_MAX_UNANSWERED = 3;
export const DEFAULT_REENGAGE_AFTER_MS = 14 * DAY;

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
  #contacts = new Map<string, ContactState>(); // channel:address -> unanswered/re-engagement counters
  #lineSafety = new Map<string, string>(); // line -> Blooio safety action
  #seq = 0;
  #draining = false;
  readonly o: Required<Omit<QueueOptions, "onAlert" | "adapters" | "consent" | "clock" | "quiet" | "defaultFrom" | "recipientPolicy">> & QueueOptions;

  constructor(opts: QueueOptions) {
    this.o = {
      requireConsentForProactive: true, perRecipientPerHour: 10, newChatsPerLinePerDay: 20, maxAttempts: 6, baseBackoffMs: 30_000,
      maxUnansweredPerConversation: DEFAULT_MAX_UNANSWERED, reengageAfterMs: DEFAULT_REENGAGE_AFTER_MS,
      ...opts,
    };
  }

  #contactKey(channel: ChannelKind, address: string) { return `${channel}:${normalizeAddress(address)}`; }

  #contact(key: string): ContactState {
    let c = this.#contacts.get(key);
    if (!c) { c = { unanswered: 0, reengagementUsed: false }; this.#contacts.set(key, c); }
    return c;
  }

  get #now() { return this.o.clock.now(); }

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
  }

  /** Dispatch everything due. Safe to call concurrently (re-entrant calls are no-ops). */
  async drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
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
      }
    } finally {
      this.#draining = false;
    }
  }

  async #dispatch(rec: OutboundRecord): Promise<void> {
    const now = this.#now;
    const contactKey = this.#contactKey(rec.channel, rec.to);
    const agent = isAgentInitiated(rec.kind);

    // 1. Consent (checked at dispatch so a STOP received while waiting wins).
    if (rec.kind !== "compliance" && this.o.consent.isOptedOut(rec.channel, rec.to)) {
      return this.#set(rec, "suppressed_opt_out");
    }
    if (rec.kind === "proactive" && this.o.requireConsentForProactive && !this.o.consent.hasConsent(rec.channel, rec.to)) {
      return this.#set(rec, "suppressed_no_consent");
    }

    // 2. Recipient eligibility at send time (paused, blocked, held, minor, opted out in the member store).
    if (rec.kind !== "compliance" && this.o.recipientPolicy) {
      let check: RecipientCheck;
      try {
        check = await this.o.recipientPolicy(rec.to, { kind: rec.kind, channel: rec.channel, briefId: rec.briefId, agentInitiated: agent });
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

    // 4. Conversation rules: max N unanswered, then one re-engagement after 14 days of silence.
    let reengagement = false;
    if (rec.kind !== "compliance") {
      const c = this.#contact(contactKey);
      if (c.unanswered >= this.o.maxUnansweredPerConversation) {
        const quietFor = c.lastOutboundAt === undefined ? Infinity : now - c.lastOutboundAt;
        if (agent && !c.reengagementUsed && quietFor >= this.o.reengageAfterMs) {
          reengagement = true;
        } else {
          return this.#set(rec, "held_awaiting_reply", c.reengagementUsed ? "unanswered_cap: re-engagement already used" : "unanswered_cap");
        }
      }
    }

    // 5. Line safety state (from Blooio safety.state_changed webhooks).
    const line = rec.from ?? `${rec.channel}:default`;
    const lineAction = this.#lineSafety.get(line);
    const isNewChat = !this.#knownContacts.has(contactKey);
    if (lineAction === "review" || (lineAction && ["pause_new", "reply_only"].includes(lineAction) && isNewChat)) {
      rec.nextAttemptAt = now + HOUR;
      this.#set(rec, "retry_scheduled", `line safety action ${lineAction}`);
      this.o.onAlert?.(rec, `line_safety_${lineAction}`);
      return;
    }

    // 6. Rate limits.
    this.#sendLog = this.#sendLog.filter((e) => e.at > now - HOUR);
    if (rec.kind !== "compliance" && this.#sendLog.filter((e) => e.to === contactKey).length >= this.o.perRecipientPerHour) {
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
      if (rec.kind !== "compliance") {
        const c = this.#contact(contactKey);
        c.unanswered++;
        c.lastOutboundAt = this.#now;
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
      timeZone: rec.timeZone, city: rec.city, briefId: rec.briefId,
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

  /**
   * Recipient engaged (message or reaction): reset the unanswered counter and the re-engagement allowance,
   * release held messages and mark the contact known.
   */
  onRecipientEngaged(channel: ChannelKind, address: string): number {
    const to = normalizeAddress(address);
    const key = `${channel}:${to}`;
    this.#knownContacts.add(key);
    const c = this.#contact(key);
    c.unanswered = 0;
    c.reengagementUsed = false;
    c.lastInboundAt = this.#now;
    let released = 0;
    for (const r of this.records.values()) {
      if (r.status === "held_awaiting_reply" && r.channel === channel && r.to === to) {
        r.nextAttemptAt = this.#now;
        this.#set(r, "pending", "recipient engaged");
        released++;
      }
    }
    return released;
  }

  setLineSafety(line: string, action: string | undefined) {
    const l = normalizeAddress(line);
    if (!action || action === "none") this.#lineSafety.delete(l);
    else this.#lineSafety.set(l, action);
  }

  /** Read-only view of a conversation's counters (for tests and the admin console). */
  contactState(channel: ChannelKind, address: string): Readonly<ContactState> | undefined {
    return this.#contacts.get(this.#contactKey(channel, address));
  }

  byProviderId(id: string) { return this.#byProviderId.get(id); }
  get(key: string) { return this.records.get(key); }
}
