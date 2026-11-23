// The persisted outbound queue for one Blooio line (PRD 32.2 network.outbound_messages; migration 0015,
// platform.outbound). One queue object serves one app on the line; every app on the shared line uses
// the same tables and the same line lock, so the line's counters hold for all apps together.
//
// Guarantees:
//  - enqueue() writes in the caller's transaction (the unit of work that changed the Network state), so a
//    message exists exactly when the state change that made it exists.
//  - The row id is the idempotency key. The provider gets "tn:<id>" on every attempt, so a retry after a
//    lost response, or a resend after a crash, cannot text the person twice (Blooio replays the original).
//    The same id with other content is an IdempotencyConflictError (Blooio answers 409 for that).
//  - drain() runs under one Postgres advisory lock per line. Before each provider call the row is "sending"
//    with a lease. recover() hands rows whose lease ran out (the worker stopped) back to the queue; they go
//    through every check again and are sent with the same key.
//  - More than one worker: every replica may run drain(). The per-line advisory lock lets one drain run at a
//    time; a row is claimed with a conditional update to "sending" plus a lease (status unchanged, no lease),
//    so a second worker that read the same row finds it claimed and skips it, and a worker that stopped
//    mid-send leaves a lease that recover() reclaims. The provider key stays "tn:<id>" on every attempt.
//  - Provider errors: retryable ones back off (30 s, doubling, at most 30 min) and fail after 6 attempts;
//    Blooio conversation limits hold the row until the person writes; number-level blocks end it (blocked).
//  - Delivery receipts (Blooio webhooks) move a row to delivered, read or failed. Statuses never go back.
//  - A row to someone who is not a member keeps the address and the text only until it ends.
import { createHash } from "node:crypto";
import {
  consentPolicy, conversationPolicy, dispatchFailurePolicy, duePolicy, holdForReply, lineCaps, linePolicy, livePolicy, personPolicy,
  quietPolicy, recipientPolicy, replyPolicy, textPolicy,
} from "../../core/src/generated/outboundAdmission.ts";
import { controlQuietHoursValid } from "../../core/src/generated/participationControls.ts";
import {
  acceptanceEndsRow, acceptanceRecordsSend, gatewayReceiptApplies, gatewayReplyPhase, gatewayReplySendTime, returnsPersonSlot, step as stepReceipt, type FailureKind, type ReceiptPhase,
} from "../../core/src/generated/outboundReceipt.ts";
import { receiptAccepted, receiptFinal, receiptMessageStatus } from "../../core/src/generated/turnReceipt.ts";
import { settleClaimedSend, type SendDisposition } from "../../core/src/vibe/outboundReceiptShell.js";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE } from "../../core/src/clock.ts";
import { LeakGuard } from "../../core/src/guard.ts";
import { normalizeAddress } from "./phone.ts";
import { DEFAULT_QUIET, isQuietAt, isValidTimeZone, nextAllowedAt, resolveTimeZone, type QuietWindow } from "./quiet-hours.ts";
import { ChannelSendError, type ChannelAdapter, type Clock, type FailureClass, type StatusUpdate, type SendRequest, type SendReceipt } from "./types.ts";

export type MessageKind =
  | "reply"          // the answer to the member's own message; quiet-hours exempt
  | "compliance"     // STOP/START/HELP confirmations and declines; exempt from the opt-out and quiet hours
  | "proactive"      // Network-initiated; quiet hours, consent, the person cap and the line caps apply
  | "transactional"; // everything else the Network starts (reminders, scheduling); quiet hours apply

/** Everything except a direct reply and a compliance text is agent-initiated (any new kind is too). */
export function isAgentInitiated(kind: MessageKind): boolean {
  return kind !== "reply" && kind !== "compliance";
}

export type RecipientCheck = { ok: true } | { ok: false; reason: string };
export type ClaimCheck = RecipientCheck | { ok: false; reason: string; retryAt: number };

/** What must not appear in a message to this recipient (see LeakOptions in packages/core/src/guard.ts). */
export interface LeakSources {
  /** Exact, complete tokens authorized for this row's contact check. */
  contactAllow?: readonly string[];
  forbidden?: string[];
  privateVocab?: string[];
  canaries?: string[];
  facts?: string[];
  fuzzy?: boolean;
  publicPhrases?: string[];
  /** Text this one message may carry verbatim, added to the queue's own allow list (a number two matched members agreed to swap). */
  allow?: string[];
}

/** One message to enqueue. `id` is the idempotency key (network.messages id, or the id of a fixed text). */
export interface EnqueueInput {
  id: string;
  memberId?: string;
  to: string;
  kind: MessageKind;
  text: string;
  /** HTTPS links to attachments (photos). Blooio fetches them. */
  mediaUrls?: string[];
  oppId?: string;
  timeZone?: string;
  /** The member's city: its zone is the fallback for quiet hours. */
  city?: string;
}

/** A queued row as the checks see it. */
export interface QueueRow {
  id: string;
  app: string;
  memberId?: string;
  line: string;
  to: string;
  kind: MessageKind;
  text: string;
  mediaUrls: string[];
  oppId?: string;
  timeZone: string;
  status: string;
  attempts: number;
  createdAt: number;
  inDoubt: boolean;
  personCap: boolean;
  newConversation: boolean;
  reengagement: boolean;
  /** Staff released this row from leak review (migration 0032): the leak guard does not park it again. */
  leakReleased?: boolean;
}

/** A status a row moved to. Rows with a member also update network.messages (the runtime stores it). */
export interface StatusChange { id: string; app: string; memberId?: string; status: string }

interface MemberDeliverySettings {
  id: string;
  person_id: string | null;
  account_status: string;
  safety_held: boolean;
  opted_out: boolean;
  quiet_hours: unknown;
  time_zone: string | null;
}

/** What the app (the Network runtime) checks for its own rows. Every hook fails closed when it throws. */
export interface AppChecks {
  live(): boolean;
  /** True when the message is about something that closed (it is stored as expired). */
  stale?(row: QueueRow): boolean | Promise<boolean>;
  /** True when the consent ledger or the member's own flag says the person opted out of this app. */
  optedOut?(row: QueueRow): boolean | Promise<boolean>;
  /** The recipient at send time: paused, blocked, held, a minor for content about others. */
  recipient?(row: QueueRow, agentInitiated: boolean): RecipientCheck | Promise<RecipientCheck>;
  /** The leak lists for this recipient (never their own facts). */
  leaks?(row: QueueRow): LeakSources | Promise<LeakSources>;
  /** Close a blocked private payload without retaining its content for staff review. */
  privatePayload?(row: QueueRow): boolean;
  /** Take a slot of the person's daily cap of proactive messages. False: the cap refuses it. */
  capTake?(row: QueueRow): Promise<boolean>;
  /** Give the slot back (the message did not go out). */
  capRelease?(row: QueueRow): Promise<void>;
  /** Acquire app-owned row fences before the shared person/member fences, in this transaction. SQL only; no remote I/O. */
  lockAdmission?(row: QueueRow, tx: SQL): Promise<void>;
  /**
   * The app's last word, inside the admission transaction after every asynchronous gate (app.app_id is
   * set; short row locks only, no remote I/O). A refused claim ends suppressed or waits for its retry time.
   * A throw parks the row.
   * The Network checks a relayed item's match and both members here (runtime.ts relayAdmission).
   */
  admit?(row: QueueRow, tx: SQL): Promise<ClaimCheck>;
  /** Commit app-owned attempt evidence only if this transaction claimed the outbound row. */
  claimed?(row: QueueRow, tx: SQL): Promise<void>;
}

export interface QueueOptions {
  sql: SQL;
  clock: Clock;
  /** The provider (BlooioAdapter over BlooioClient; a recording fake in the simulations). */
  provider: ChannelAdapter;
  /** The sending line (E.164). */
  line: string;
  /** The app whose rows this queue enqueues and drains. */
  app: string;
  checks: AppChecks;
  /** The worker's name on its leases. */
  instance?: string;
  quiet?: QuietWindow;
  /** Sends of any kind to one recipient in a rolling hour (runaway-loop guard). Default 10. */
  perRecipientPerHour?: number;
  /** Agent-initiated sends from the line in a rolling day (prototype P3 measures the real number). Default 200. */
  perLinePerDay?: number;
  /** Brand-new conversations from the line in a rolling day (Blooio: about 20-50 a number). Default 20. */
  newChatsPerLinePerDay?: number;
  /** Messages into one conversation without an answer. Default 3. */
  maxUnanswered?: number;
  /** After this long since our last send, one re-engagement may pass the unanswered cap. Default 14 days. */
  reengageAfterMs?: number;
  /** A "reply" must follow an inbound message from the person within this window. Default 1 hour. */
  replyWindowMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** How long a provider call may hold a row before recover() takes it back. Default 5 minutes. */
  leaseMs?: number;
  /**
   * A row whose provider acceptance stays unknown (unknown_acceptance: the worker stopped mid-call, or the
   * provider timed out) and that no receipt lookup resolves within this long after it became unknown ends as
   * failed_unknown, with an alert. Default 6 hours. The clock starts at the failed call (next_attempt_at),
   * not at enqueue: a text that waited out quiet hours still gets its lookups.
   */
  unknownTtlMs?: number;
  /** A proactive row older than this is never sent (expired). Default 24 h. Any other row: 3 days. */
  ttlProactiveMs?: number;
  ttlMs?: number;
  /** The leak guard reads the new text with the texts sent to the same address in this window (core-14). Default 24 h. */
  threadWindowMs?: number;
  /** At most this many earlier texts join the thread check (LeakGuard.checkThread reads 5 in all). Default 4. */
  threadSize?: number;
  /** The Network's own fixed copy that may carry its contact details (removed before the contact checks). */
  leakAllow?: string[];
  onAlert?: (id: string, reason: string) => void;
}

class ClaimedSendWriteError extends Error {
  constructor(cause: unknown) {
    super("The admitted send outcome could not be stored", { cause });
  }
}

export class IdempotencyConflictError extends Error {
  constructor(id: string) { super(`outbound id reused with other content: ${id}`); this.name = "IdempotencyConflictError"; }
}

/** Statuses that still wait for the worker (the console's backlog). */
export const WAITING = ["pending", "retry_scheduled", "deferred_quiet_hours", "held_awaiting_reply", "sending", "unknown_acceptance"];
export const GATEWAY_WAITING = ["collected", "send_unknown"];
export type TurnReceiptOutcome = "accepted" | "unknown" | "rejected";
export function gatewayReceiptMoves(outcome: TurnReceiptOutcome): string[] {
  return [...GATEWAY_WAITING, "failed_unknown"].filter(status => gatewayReceiptApplies(status, outcome));
}
const DUE = ["pending", "retry_scheduled", "deferred_quiet_hours"];
const FAILURE_KIND = {
  unknown: "UnknownResult", retryable: "Retryable", await_recipient: "NeedReply", blocked: "BlockedNumber",
  invalid: "TerminalError", auth: "TerminalError",
} as const satisfies Record<FailureClass, FailureKind>;
function receiptPhase(status: string): ReceiptPhase {
  switch (status) {
    case "sending": return "Sending";
    case "accepted": return "ProviderAccepted";
    case "queued": return "QueuedBeforeAcceptance";
    case "sent": return "ProviderSent";
    case "delivered": return "ProviderDelivered";
    case "read": return "ProviderRead";
    case "failed": return "ProviderFailed";
    case "unknown_acceptance": return "AcceptanceUnknown";
    default: return "OutsideReceipt";
  }
}
const ACCEPTED_STATUS = {
  ProviderAccepted: "accepted", ProviderSent: "sent", ProviderDelivered: "delivered", ProviderRead: "read", ProviderFailed: "failed",
} as const;
/** Statuses that did not go out: their person-cap slot goes back. */
export const NOT_SENT = /^(refused|suppressed|blocked|parked|failed(?!_unknown)|expired|dropped)/;

const fingerprint = (to: string, text: string, media: string[], kind: string) =>
  createHash("sha256").update(JSON.stringify([to, text, media, kind])).digest("hex");
const ms = (v: unknown) => (v == null ? undefined : new Date(v as string).getTime());

/** One drain at a time per line and connection pool (the advisory lock covers other pools and processes). */
const lineChains = new WeakMap<object, Map<string, Promise<unknown>>>();

export class OutboundQueue {
  readonly line: string;
  readonly app: string;
  private readonly o: QueueOptions;
  private readonly instance: string;

  constructor(o: QueueOptions) {
    this.o = o;
    this.line = normalizeAddress(o.line);
    this.app = o.app;
    this.instance = o.instance ?? `pid-${process.pid}`;
  }

  get sql() { return this.o.sql; }
  private get now() { return this.o.clock.now(); }
  private opt<K extends keyof QueueOptions>(k: K, d: NonNullable<QueueOptions[K]>): NonNullable<QueueOptions[K]> { return (this.o[k] ?? d) as NonNullable<QueueOptions[K]>; }

  /** Write rows in the caller's transaction. A replay of the same id and content is a no-op. */
  async enqueue(tx: SQL, items: EnqueueInput[]): Promise<void> {
    const now = new Date(this.now);
    for (const i of items) {
      const to = normalizeAddress(i.to);
      const media = i.mediaUrls ?? [];
      if (media.length > 10 || media.some(u => !/^https:\/\/[^\s]+$/.test(u))) throw new Error(`outbound ${i.id}: attachments must be at most 10 https links`);
      const agent = isAgentInitiated(i.kind);
      const zone = resolveTimeZone(i.timeZone, i.city);
      const fp = fingerprint(to, i.text, media, i.kind);
      // An agent-initiated message whose local time cannot be computed is parked, never sent at night.
      const status = agent && !zone ? "parked_invalid_timezone" : "pending";
      const row = {
        id: i.id, app_id: this.app, member_id: i.memberId ?? null, line: this.line, to_address: to, kind: i.kind, body: i.text,
        media_urls: tx.array(media, "TEXT"), fingerprint: fp, opportunity_id: i.oppId ?? null, time_zone: zone ?? "UTC", status,
        next_attempt_at: now, created_at: now, updated_at: now, ended_at: status === "pending" ? null : now,
      };
      const wrote = await tx`insert into platform.outbound ${tx(row)} on conflict (id) do nothing returning id`;
      if (wrote.length) {
        if (status !== "pending") this.o.onAlert?.(i.id, "invalid_timezone");
        continue;
      }
      const [old] = await tx`select fingerprint from platform.outbound where id = ${i.id}`;
      if (old?.fingerprint !== fp) throw new IdempotencyConflictError(i.id);
    }
  }

  /** Run `fn` holding this line's lock (one drainer per line across apps and processes). */
  private async withLine<T>(fn: () => Promise<T>): Promise<T> {
    let chains = lineChains.get(this.sql);
    if (!chains) lineChains.set(this.sql, (chains = new Map()));
    const prev = chains.get(this.line) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const conn = await this.sql.reserve();
      const key = `blooio-line:${this.line}`;
      try {
        await conn`select pg_advisory_lock(hashtext(${key}))`;
        try { return await fn(); } finally { await conn`select pg_advisory_unlock(hashtext(${key}))`; }
      } finally { conn.release(); }
    });
    chains.set(this.line, run);
    return run;
  }

  /** Rows of this app whose lease ran out while "sending" (the worker stopped): back to the queue, sent again with the same key. */
  async recover(): Promise<number> {
    const recoveredStatus = this.o.provider.receipt ? 'unknown_acceptance' : 'retry_scheduled';
    const rows = await this.sql`update platform.outbound set status = ${recoveredStatus}, in_doubt = true, lease_owner = null, lease_until = null,
      next_attempt_at = ${new Date(this.now)}, updated_at = ${new Date(this.now)}, note = 'recovered after the worker stopped'
      where app_id = ${this.app} and line = ${this.line} and status = 'sending' and lease_until < ${new Date(this.now)} returning id`;
    if (rows.length) for (const r of rows as any[]) this.o.onAlert?.(r.id, "recovered_in_doubt");
    return rows.length;
  }

  /** Deliver every due row of this app. Returns the status changes (for network.messages). */
  async drain(): Promise<StatusChange[]> {
    // Every drain reclaims rows whose lease ran out (a replica that died mid-send), not only a runtime that starts.
    await this.recover();
    const receipts = await this.reconcileUnknown();
    return this.withLine(async () => {
      const changes: StatusChange[] = [...receipts, ...await this.expireHeld()];
      const rows = await this.sql`select * from platform.outbound where app_id = ${this.app} and line = ${this.line}
        and status = any(${this.sql.array([...DUE], "TEXT")}) and next_attempt_at <= ${new Date(this.now)} order by next_attempt_at, created_at, id`;
      for (const r of rows as any[]) {
        const row = this.rowOf(r);
        let c: StatusChange | undefined;
        try {
          c = await this.dispatch(row);
        } catch (e) {
          if (e instanceof ClaimedSendWriteError) {
            // A provider call may have succeeded. Retain the lease and payload for recovery.
            this.o.onAlert?.(row.id, "claimed_outcome_write_failed");
            continue;
          }
          const error = (e as Error).message.slice(0, 500), from = [row.status];
          const [r] = await this.sql`update platform.outbound set attempts = attempts + 1, last_error = ${error}
            where id = ${row.id} and status = any(${this.sql.array([...from], "TEXT")}) returning attempts`;
          if (r) {
            const tries = Number(r.attempts);
            c = dispatchFailurePolicy(tries < this.opt("maxAttempts", 6)) === "ParkDispatch"
              ? await this.end(row, "parked_error", error, undefined, from)
              : await this.wait(row, "retry_scheduled", this.now + this.backoff(tries), "dispatch error", from);
          }
          this.o.onAlert?.(row.id, "dispatch_error");
        }
        if (c) changes.push(c);
      }
      return changes;
    });
  }

  private rowOf(r: any): QueueRow {
    return {
      id: r.id, app: r.app_id, memberId: r.member_id ?? undefined, line: r.line, to: r.to_address, kind: r.kind, text: r.body ?? "",
      mediaUrls: r.media_urls ?? [], oppId: r.opportunity_id ?? undefined, timeZone: r.time_zone, status: r.status, attempts: r.attempts,
      createdAt: ms(r.created_at)!, inDoubt: r.in_doubt, personCap: r.person_cap, newConversation: r.new_conversation, reengagement: r.reengagement,
      ...(r.leak_released_by ? { leakReleased: true } : {}),
    };
  }

  /** Held rows past their time are expired (they are not due, so drain() would never see them). */
  private async expireHeld(): Promise<StatusChange[]> {
    const now = this.now;
    const rows = await this.sql`select * from platform.outbound where app_id = ${this.app} and line = ${this.line} and status = 'held_awaiting_reply'
      and created_at < ${new Date(now - Math.min(this.opt("ttlProactiveMs", DAY), this.opt("ttlMs", 3 * DAY)))}`;
    const out: StatusChange[] = [];
    for (const r of rows as any[]) {
      const row = this.rowOf(r);
      if (this.tooOld(row)) out.push(await this.end(row, "expired", "held past its time"));
    }
    return out;
  }

  private tooOld(row: QueueRow) {
    const age = this.now - row.createdAt;
    return age > this.opt("ttlMs", 3 * DAY) || (row.kind === "proactive" && age > this.opt("ttlProactiveMs", DAY));
  }

  /** A row ends (nothing more will happen to it). A row to a non-member keeps no address and no text. */
  private async end(row: QueueRow, status: string, note?: string, error?: string): Promise<StatusChange>;
  private async end(row: QueueRow, status: string, note: string | undefined, error: string | undefined, from: readonly string[]): Promise<StatusChange | undefined>;
  private async end(row: QueueRow, status: string, note?: string, error?: string, from?: readonly string[]): Promise<StatusChange | undefined> {
    const now = new Date(this.now);
    // A text parked for leak review keeps its text and address until staff decide (a drop ends it and clears them).
    const keep = status === "parked_leak_review";
    const wrote = await this.sql`update platform.outbound set status = ${status}, note = ${note ?? null}, last_error = coalesce(${error ?? null}, last_error), ended_at = ${now}, updated_at = ${now},
      lease_owner = null, lease_until = null,
      to_address = case when member_id is null and ${!keep} then null else to_address end, body = case when member_id is null and ${!keep} then null else body end
      where id = ${row.id} ${from ? this.sql`and status = any(${this.sql.array([...from], "TEXT")})` : this.sql``} returning id`;
    if (!wrote.length) return undefined;
    if (row.personCap && NOT_SENT.test(status)) await this.o.checks.capRelease?.(row).catch(() => {});
    return { id: row.id, app: row.app, memberId: row.memberId, status };
  }

  /** The row waits (not an end): a later drain tries again at `at`. */
  private async wait(row: QueueRow, status: string, at: number, note: string): Promise<StatusChange>;
  private async wait(row: QueueRow, status: string, at: number, note: string, from: readonly string[]): Promise<StatusChange | undefined>;
  private async wait(row: QueueRow, status: string, at: number, note: string, from?: readonly string[]): Promise<StatusChange | undefined> {
    const wrote = await this.sql`update platform.outbound set status = ${status}, next_attempt_at = ${new Date(at)}, note = ${note}, updated_at = ${new Date(this.now)}, lease_owner = null, lease_until = null
      where id = ${row.id} ${from ? this.sql`and status = any(${this.sql.array([...from], "TEXT")})` : this.sql``} returning id`;
    if (!wrote.length) return undefined;
    return { id: row.id, app: row.app, memberId: row.memberId, status };
  }

  private backoff(tries: number): number {
    return Math.min(this.opt("baseBackoffMs", 30_000) * 2 ** (tries - 1), 30 * MINUTE);
  }

  private async hold(row: QueueRow, note: string, seenInbound: unknown, written = false): Promise<StatusChange> {
    const held = written ? { id: row.id, app: row.app, memberId: row.memberId, status: "held_awaiting_reply" }
      : await this.wait(row, "held_awaiting_reply", this.now, note);
    const now = await this.conversation(row.to);
    if (holdForReply(ms(now?.last_inbound_at) !== ms(seenInbound)) === "AwaitingReply") return held;
    const at = new Date(this.now);
    const [r] = await this.sql`update platform.outbound set status = 'pending', next_attempt_at = ${at}, updated_at = ${at}, note = 'recipient engaged'
      where id = ${row.id} and status = 'held_awaiting_reply' returning status`;
    return r ? { ...held, status: "pending" } : held;
  }

  private async guarded<T>(fn: () => T | Promise<T>, failed: T): Promise<T> {
    try { return await fn(); } catch { return failed; }
  }

  private async conversation(address: string) {
    const [c] = await this.sql`select * from platform.line_conversations where line = ${this.line} and address = ${address}`;
    return c as { unanswered: number; reengagement_used: boolean; last_outbound_at: unknown; last_inbound_at: unknown } | undefined;
  }

  private async memberDeliverySettings(tx: SQL, row: QueueRow, lock = false): Promise<MemberDeliverySettings | undefined> {
    if (!row.memberId) return;
    const [member] = await tx<MemberDeliverySettings[]>`select member.id,member.person_id,member.account_status,member.opted_out,
      coalesce(authority.staff_held or authority.report_held,false) as safety_held,
      member.prefs->'quietHours' as quiet_hours,city.tz as time_zone
      from network.members member left join platform.cities city on city.id=member.home_city
      left join platform.matching_ages authority on authority.app_id=member.app_id and authority.member_id=member.id
      where member.app_id=${row.app} and member.id=${row.memberId} ${lock ? tx`for update of member` : tx``}`;
    return member;
  }

  private quietTiming(row: QueueRow, member: MemberDeliverySettings | undefined, now: number) {
    if (!isAgentInitiated(row.kind)) return { kind: "open" } as const;
    const zone = isValidTimeZone(member?.time_zone) ? member.time_zone : row.timeZone;
    const validZone = isValidTimeZone(zone);
    const saved = member?.quiet_hours;
    const quiet = Array.isArray(saved) && saved.length === 2 && saved.every(Number.isInteger) && controlQuietHoursValid(saved[0], saved[1])
      ? { startHour: saved[0], endHour: saved[1] } : this.o.quiet ?? DEFAULT_QUIET;
    const decision = quietPolicy(true, validZone, validZone && isQuietAt(now, zone, quiet));
    if (decision === "InvalidZone") return { kind: "invalid_zone" } as const;
    if (decision === "QuietHours") return { kind: "quiet", until: nextAllowedAt(now, zone, quiet) } as const;
    return { kind: "open" } as const;
  }

  private async dispatch(row: QueueRow): Promise<StatusChange> {
    const now = this.now;
    const c = this.o.checks;
    const agent = isAgentInitiated(row.kind);
    const compliance = row.kind === "compliance";

    const stale = this.tooOld(row) || await (c.stale?.(row) ?? false);
    if (duePolicy(stale) === "Expired") return this.end(row, "expired");
    if (livePolicy(await this.guarded(() => c.live(), false)) === "DryRunLine") return this.end(row, "refused_not_approved");
    if (!compliance) {
      if (consentPolicy(compliance, await this.guarded(() => c.optedOut?.(row) ?? false, true)) === "OptedOut") return this.end(row, "refused_opted_out");
      const check = await this.guarded<RecipientCheck>(() => c.recipient?.(row, agent) ?? { ok: true }, { ok: false, reason: "recipient_check_error" });
      if (recipientPolicy(compliance, check.ok) === "RecipientIneligible") return this.end(row, "suppressed_ineligible", check.ok ? undefined : check.reason);
    }
    const conv = await this.conversation(row.to);
    // spec/outboundAdmission.md, "Replies, quiet hours and unanswered messages limit when a send can go out"
    const last = ms(conv?.last_inbound_at);
    if (replyPolicy(row.kind === "reply", last !== undefined && !(now - last > this.opt("replyWindowMs", HOUR))) === "ReplyTooOld") {
      this.o.onAlert?.(row.id, "reply_without_recent_inbound");
      return this.end(row, "suppressed_ineligible", "reply without a recent inbound");
    }
    if (agent) {
      const member = row.memberId ? await this.sql.begin(async tx => {
        await tx`select set_config('app.app_id',${row.app},true)`;
        return this.memberDeliverySettings(tx, row);
      }) : undefined;
      const timing = this.quietTiming(row, member, now);
      if (timing.kind === "invalid_zone") return this.end(row, "parked_invalid_timezone");
      if (timing.kind === "quiet") return this.wait(row, "deferred_quiet_hours", timing.until, "quiet hours");
    }
    const quietFor = now - (ms(conv?.last_outbound_at) ?? -Infinity);
    const conversation = conversationPolicy(compliance, !!conv && conv.unanswered >= this.opt("maxUnanswered", 3),
      agent, !!conv?.reengagement_used, quietFor >= this.opt("reengageAfterMs", 14 * DAY));
    if (conversation.decision === "AwaitingReply") {
      return this.hold(row, conv?.reengagement_used ? "unanswered cap: re-engagement used" : "unanswered cap", conv?.last_inbound_at);
    }
    // spec/outboundAdmission.md, "Apply line controls and sending caps before checking the text"
    const isNew = !conv;
    const [safety] = await this.sql`select action from platform.line_safety where line = ${this.line}`;
    const action = safety?.action as string | undefined;
    if (linePolicy(action ?? "", agent, isNew) === "LinePaused") {
      this.o.onAlert?.(row.id, `line_safety_${action}`);
      return this.wait(row, "retry_scheduled", now + HOUR, `line safety ${action}`);
    }
    if (!compliance) {
      const [counts] = await this.sql`select
        count(*) filter (where to_address = ${row.to} and sent_at > ${new Date(now - HOUR)})::int as recipient,
        count(*) filter (where kind in ('proactive', 'transactional') and sent_at > ${new Date(now - DAY)})::int as line,
        count(*) filter (where new_conversation and sent_at > ${new Date(now - DAY)})::int as new_chats
        from platform.outbound where line = ${this.line} and sent_at > ${new Date(now - DAY)}`;
      const decision = lineCaps(compliance, agent, isNew, counts.recipient >= this.opt("perRecipientPerHour", 10),
        counts.line >= this.opt("perLinePerDay", 200), counts.new_chats >= this.opt("newChatsPerLinePerDay", 20));
      if (decision === "RecipientCap") return this.wait(row, "retry_scheduled", now + 5 * MINUTE, "per-recipient hourly cap");
      if (decision === "LineCap") return this.wait(row, "retry_scheduled", now + HOUR, "per-line daily cap");
      if (decision === "NewConversationCap") return this.wait(row, "retry_scheduled", now + HOUR, "per-line new conversation cap");
    }
    // 9. The person cap (proactive only, at send time; a redelivered id is never counted twice).
    if (row.kind === "proactive" && c.capTake) {
      if (personPolicy(await this.guarded(() => c.capTake!(row), false)) === "PersonCap") return this.end(row, "refused_person_cap");
      if (!row.personCap) { row.personCap = true; await this.sql`update platform.outbound set person_cap = true where id = ${row.id}`; }
    }
    // 10. The leak guard, right before the send: only hashed labels are stored, never the text or the match.
    // A row staff released from leak review (releaseLeak) is not parked again for the same text.
    const leaks = row.leakReleased ? [] : await this.leakReasons(row);
    if (textPolicy(leaks.length > 0) === "LeakReview") {
      this.o.onAlert?.(row.id, "leak_blocked");
      if (c.privatePayload?.(row)) return this.end(row, "dropped_leak_review", "private payload refused");
      return this.end(row, "parked_leak_review", `leak: ${leaks.join(",")}`);
    }
    return this.send(row, isNew, conversation.reengage, conv?.last_inbound_at);
  }

  private async leakReasons(row: QueueRow, db: SQL = this.sql, contactAllow?: readonly string[]): Promise<string[]> {
    let src: LeakSources = {};
    if (this.o.checks.leaks) {
      try { src = await this.o.checks.leaks(row); } catch { return ["leak_check_error"]; }
    }
    const own = row.memberId ?? row.to;
    const reasons = new LeakGuard({ ...src, canaryShapes: true, allow: [...(this.o.leakAllow ?? []), ...(src.allow ?? [])], contacts: row.kind !== "compliance" })
      .check(row.text, { exceptOwner: own, contactAllow: [...(src.contactAllow ?? []), ...(contactAllow ?? [])] });
    // core-14: the new text together with the recent thread to this address (any app on the line), so a
    // value split across messages ("212 555" then "0102") is caught. The generic contact patterns run on
    // the new text alone (two ordinary messages joined can look like a number); another member's own
    // values, facts and canaries run on the thread. A fixed compliance text is never held for its thread.
    if (row.kind === "compliance") return reasons;
    const recent = await this.threadOf(row, db);
    if (!recent.length) return reasons;
    const thread = new LeakGuard({ ...src, canaryShapes: true, allow: [...(this.o.leakAllow ?? []), ...(src.allow ?? [])], contacts: false }).checkThread([...recent, row.text], { exceptOwner: own });
    return [...new Set([...reasons, ...thread.map(r => `thread:${r}`)])];
  }

  /** The texts that went to this address on this line in the last `threadWindowMs`, oldest first (at most `threadSize`). */
  private async threadOf(row: QueueRow, db: SQL = this.sql): Promise<string[]> {
    const rows = await db`select body from platform.outbound where line = ${this.line} and to_address = ${row.to} and id <> ${row.id}
      and body is not null and sent_at is not null and sent_at > ${new Date(this.now - this.opt("threadWindowMs", DAY))}
      order by sent_at desc, id desc limit ${this.opt("threadSize", 4)}`;
    return (rows as any[]).map(r => String(r.body)).reverse();
  }

  private async send(row: QueueRow, isNew: boolean, reengagement: boolean, seenInbound: unknown): Promise<StatusChange> {
    const admission = await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id',${this.app},true)`;
      await this.o.checks.lockAdmission?.(row, tx);
      let member: MemberDeliverySettings | undefined;
      if (row.memberId) {
        await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
          where member.app_id=${row.app} and member.id=${row.memberId} order by person.id for update of person`;
        member = await this.memberDeliverySettings(tx, row, true);
        if (!member || member.account_status==='removed' || member.account_status==='invited') return "dropped_forgotten";
        if (row.kind==="proactive" && (member.account_status!=="active" || member.safety_held)) return "suppressed_ineligible";
        if (this.o.provider.receipt) {
          const [binding] = await tx`select membership.member_id from platform.memberships membership
            join platform.people person on person.id=membership.person_id and person.deleted_at is null
            join platform.phone_identities phone on phone.person_id=person.id and phone.e164=${row.to} and phone.hold is null
            where membership.person_id=${member.person_id} and membership.app_id=${row.app} and membership.member_id=${row.memberId}
            and membership.state not in ('removed','invited')
            and (${row.kind!=="proactive"} or (membership.state='active' and membership.review is null))
            for share of membership,phone`;
          if (!binding) return "dropped_forgotten";
        }
        if (row.kind!=="compliance" && member.opted_out) return "refused_opted_out";
      }
      if (consentPolicy(row.kind==="compliance", await this.guarded(()=>this.o.checks.optedOut?.(row)??false,true))==="OptedOut") return "refused_opted_out";
      const decision = await this.o.checks.admit?.(row, tx);
      const start = this.now;
      const pending = tx`id=${row.id} and app_id=${row.app} and line=${this.line} and status=${row.status} and lease_until is null
        and to_address=${row.to} and body=${row.text} and fingerprint=${fingerprint(row.to,row.text,row.mediaUrls,row.kind)}`;
      if (decision?.ok === false) {
        if (!("retryAt" in decision)) return { kind: "ended", ended: "suppressed_ineligible", note: decision.reason } as const;
        const deferred = await tx`update platform.outbound set status='retry_scheduled',next_attempt_at=${new Date(decision.retryAt)},
          note=${decision.reason},updated_at=${new Date(start)},person_cap=false where ${pending} returning id`;
        if (deferred.length) return "retry_scheduled";
      } else {
        const timing = this.quietTiming(row, member, start);
        if (timing.kind === "invalid_zone") return "parked_invalid_timezone";
        if (timing.kind === "quiet") {
          const deferred = await tx`update platform.outbound set status='deferred_quiet_hours',next_attempt_at=${new Date(timing.until)},
            note='quiet hours',updated_at=${new Date(start)},person_cap=false where ${pending} returning id`;
          if (deferred.length) return "deferred_quiet_hours";
        } else {
          const claimed = await tx`update platform.outbound set status='sending',attempts=attempts+1,lease_owner=${this.instance},
            lease_until=${new Date(start+this.opt("leaseMs",5*MINUTE))},updated_at=${new Date(start)},new_conversation=${isNew},reengagement=${reengagement}
            where ${pending} returning id`;
          if (claimed.length) {
            await this.o.checks.claimed?.(row, tx);
            return "admitted";
          }
        }
      }
      const [now] = await tx`select status,lease_until from platform.outbound where id=${row.id}`;
      if (now && (now.status!==row.status || now.lease_until!==null)) return { kind: "busy", busy: String(now.status) } as const;
      return "dropped_forgotten";
    });
    if (typeof admission==="object") {
      if (admission.kind === "busy") return {id:row.id,app:row.app,memberId:row.memberId,status:admission.busy};
      return this.end(row, admission.ended, admission.note);
    }
    if (admission === "deferred_quiet_hours" || admission === "retry_scheduled") {
      if (row.personCap) await this.o.checks.capRelease?.(row).catch(() => {});
      return { id: row.id, app: row.app, memberId: row.memberId, status: admission };
    }
    if (admission!=="admitted") return this.end(row,admission);
    const attempts = row.attempts + 1;
    try {
      return await settleClaimedSend(attempts < this.opt("maxAttempts", 6), {
        send: () => this.o.provider.send(this.request(row)),
        saveReceipt: receipt => this.acceptReceipt({ ...row, newConversation: isNew, reengagement }, receipt),
        classifyError: cause => {
          const error = cause instanceof ChannelSendError ? cause : new ChannelSendError(
            cause instanceof Error ? cause.message : String(cause), "retryable",
          );
          return { kind: FAILURE_KIND[error.failure], error };
        },
        unrecordedReceipt: () => new ChannelSendError("Provider response could not be recorded", "unknown"),
        saveDisposition: (phase, error) => this.recordClaimedFailure(row, attempts, phase, error, seenInbound),
      });
    } catch (error) {
      throw new ClaimedSendWriteError(error);
    }
  }

  private async recordClaimedFailure(row: QueueRow, attempts: number, phase: SendDisposition, e: ChannelSendError, seenInbound: unknown): Promise<StatusChange> {
    const error = `${e.failure}${e.status ? ` ${e.status}` : ""}${e.code ? ` ${e.code}` : ""}: ${e.message}`.slice(0, 500);
    const now = this.now;
    let status: string, note: string | undefined, alert: string | undefined;
    let nextAttemptAt = now, terminal = false;
    switch (phase) {
      case "AcceptanceUnknown":
        status = "unknown_acceptance";
        note = "provider acceptance unresolved; receipt lookup only";
        break;
      case "RetryScheduled":
        status = "retry_scheduled";
        nextAttemptAt += e.retryAfterMs ?? this.backoff(attempts);
        note = e.code ?? "retry";
        break;
      case "WaitingForReply":
        status = "held_awaiting_reply";
        note = e.code ?? "conversation limit";
        break;
      case "ProviderBlocked":
        status = "blocked";
        note = e.code;
        alert = e.code ?? "blocked";
        terminal = true;
        break;
      case "ProviderFailed":
        status = "failed";
        note = e.failure === "retryable" ? "retries used up" : e.code;
        alert = e.failure === "retryable" ? "send_failed" : `send_${e.failure}`;
        terminal = true;
        break;
    }
    const wrote = await this.sql`update platform.outbound set status = ${status}, note = ${note ?? null}, last_error = ${error},
      in_doubt = in_doubt or ${phase === "AcceptanceUnknown"},
      next_attempt_at = case when ${terminal} then next_attempt_at else ${new Date(nextAttemptAt)} end,
      ended_at = case when ${terminal} then ${new Date(now)} else ended_at end, updated_at = ${new Date(now)},
      lease_owner = null, lease_until = null,
      to_address = case when ${terminal} and member_id is null then null else to_address end,
      body = case when ${terminal} and member_id is null then null else body end
      where id = ${row.id} and app_id = ${row.app} and line = ${this.line} and status = 'sending'
        and lease_owner = ${this.instance} and attempts = ${attempts} returning id`;
    if (!wrote.length) return this.currentStatus(row);
    if (alert) this.o.onAlert?.(row.id, alert);
    if (row.personCap && returnsPersonSlot(phase)) await this.o.checks.capRelease?.(row).catch(() => {});
    if (status === "held_awaiting_reply") return this.hold(row, note ?? "conversation limit", seenInbound, true);
    return { id: row.id, app: row.app, memberId: row.memberId, status };
  }

  private async currentStatus(row: QueueRow): Promise<StatusChange> {
    return { id: row.id, app: row.app, memberId: row.memberId, status: await this.statusOf(row.id) ?? "dropped_forgotten" };
  }

  private request(row: QueueRow): SendRequest {
    return {from:this.line,to:row.to,text:row.text,...(row.mediaUrls.length?{mediaUrls:row.mediaUrls}:{}),idempotencyKey:`tn:${row.id}`,
      context:{id:row.id,app:row.app,memberId:row.memberId??null,kind:row.kind,createdAt:row.createdAt}};
  }

  /** Commit only an extant immutable row. The person lock is shared with canonical erasure. */
  private async acceptReceipt(row: QueueRow, receipt: SendReceipt): Promise<StatusChange> {
    const from = { phase: row.status === "unknown_acceptance" ? "AcceptanceUnknown" : "Sending" } as const;
    const providerPhase = receipt.status === "queued" ? "ProviderAccepted" : receiptPhase(receipt.status);
    const accepted = stepReceipt(from, { type: "recordAcceptance", providerPhase });
    const status = accepted.phase in ACCEPTED_STATUS ? ACCEPTED_STATUS[accepted.phase as keyof typeof ACCEPTED_STATUS] : undefined;
    const acceptedAt=receipt.acceptedAt??this.now;
    if (!status || !Number.isFinite(acceptedAt) || !receipt.providerMessageId) throw new ChannelSendError("Invalid acceptance receipt","unknown");
    const at=new Date(acceptedAt),providerIds=receipt.providerMessageIds??[receipt.providerMessageId];
    const delivered = status === "delivered" || status === "read";
    const terminal = acceptanceEndsRow(accepted.phase, !!this.o.provider.receipt, !!row.memberId), wentOut = acceptanceRecordsSend(accepted.phase);
    const committed=await this.sql.begin(async tx=>{
      await tx`select set_config('app.app_id',${this.app},true)`;
      if (row.memberId) await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
        where member.app_id=${row.app} and member.id=${row.memberId} order by person.id for update of person`;
      const wrote=await tx`update platform.outbound set status=${status},provider_message_id=${receipt.providerMessageId},
        provider_message_ids=${{ids:providerIds}}::jsonb->'ids',history_recorded=${receipt.historyRecorded??null},chat_id=${receipt.chatId??null},
        transport=${receipt.transport??null},sent_at=case when ${wentOut} then coalesce(sent_at,${at}) else sent_at end,lease_owner=null,lease_until=null,updated_at=${new Date(this.now)},
        note=${status === "failed" ? "provider reported failure" : !delivered && receipt.replayed ? "idempotent replay" : null},
        delivered_at=${delivered ? at : null}, ended_at=${terminal ? new Date(this.now) : null},
        to_address=case when ${terminal} and member_id is null then null else to_address end,
        body=case when ${terminal} and member_id is null then null else body end
        where id=${row.id} and app_id=${row.app} and line=${this.line} and status in ('sending','unknown_acceptance')
        and to_address=${row.to} and body=${row.text} and fingerprint=${fingerprint(row.to,row.text,row.mediaUrls,row.kind)} returning id`;
      if (!wrote.length) return false;
      if (wentOut) await this.countSend(tx,this.line,row.to,row.kind,row.reengagement,at);
      return true;
    });
    if (!committed) return this.currentStatus(row);
    if (row.personCap && returnsPersonSlot(accepted.phase)) await this.o.checks.capRelease?.(row).catch(() => {});
    return {id:row.id,app:row.app,memberId:row.memberId,status};
  }

  private async countSend(tx: SQL, line: string, to: string, kind: MessageKind, reengagement: boolean, at: Date): Promise<void> {
    const unanswered=kind==="compliance"?0:1;
    await tx`insert into platform.line_conversations(line,address,unanswered,reengagement_used,first_outbound_at,last_outbound_at)
      values(${line},${to},${unanswered},${reengagement},${at},${at})
      on conflict(line,address) do update set
        unanswered=case when line_conversations.last_inbound_at>${at} then line_conversations.unanswered else line_conversations.unanswered+${unanswered} end,
        last_outbound_at=greatest(line_conversations.last_outbound_at,excluded.last_outbound_at),
        first_outbound_at=least(line_conversations.first_outbound_at,excluded.first_outbound_at),
        reengagement_used=case when line_conversations.last_inbound_at>${at} then line_conversations.reengagement_used else line_conversations.reengagement_used or excluded.reengagement_used end`;
  }

  /**
   * Bounded read-only remote recovery; unknown rows never enter the dispatch queue on an ambiguous answer.
   * An authoritative "never admitted" (ChannelSendError code "not_found") puts the row back to the queue
   * with the same "tn:<id>" key (idempotent at the provider). A row still unknown after unknownTtlMs ends
   * as failed_unknown with an alert, so nothing waits forever unseen.
   */
  private async reconcileUnknown(): Promise<StatusChange[]> {
    const changes:StatusChange[]=[];
    const ttl=this.opt("unknownTtlMs",6*HOUR);
    for (const stored of await this.sql`select * from platform.outbound where app_id=${this.app} and line=${this.line}
      and status='unknown_acceptance' and next_attempt_at<${new Date(this.now-ttl)} order by next_attempt_at,id limit 50`) {
      const row=this.rowOf(stored);
      const expiry = stepReceipt({ phase: receiptPhase(row.status) }, { type: "expireUnknown", pastLimit: true });
      if (expiry.phase !== "AcceptanceExpired") continue;
      const at = new Date(this.now);
      const expired = await this.sql`update platform.outbound set status = 'failed_unknown',
        note = 'provider acceptance never resolved', ended_at = ${at}, updated_at = ${at}, lease_owner = null, lease_until = null,
        to_address = case when member_id is null then null else to_address end, body = case when member_id is null then null else body end
        where id = ${row.id} and status = 'unknown_acceptance' returning id`;
      if (!expired.length) continue;
      this.o.onAlert?.(row.id,"unknown_acceptance_expired");
      if (row.personCap && returnsPersonSlot(expiry.phase)) await this.o.checks.capRelease?.(row).catch(() => {});
      changes.push({ id: row.id, app: row.app, memberId: row.memberId, status: "failed_unknown" });
    }
    for (const stored of await this.sql`select * from platform.outbound where app_id=${this.app} and line=${this.line}
      and status = any(${this.sql.array([...GATEWAY_WAITING], "TEXT")}) order by created_at,id limit 50`) {
      const row=this.rowOf(stored);
      if (gatewayReplyPhase(this.now-row.createdAt>ttl) !== "AcceptanceExpired") continue;
      const at = new Date(this.now);
      const expired = await this.sql`update platform.outbound set status = 'failed_unknown',
        note = 'gateway receipt never resolved', ended_at = ${at}, updated_at = ${at}
        where id = ${row.id} and status = ${row.status} returning id`;
      if (!expired.length) continue;
      this.o.onAlert?.(row.id,"gateway_receipt_expired");
      changes.push({ id: row.id, app: row.app, memberId: row.memberId, status: "failed_unknown" });
    }
    if (!this.o.provider.receipt) return changes;
    const rows=await this.sql`select * from platform.outbound where app_id=${this.app} and line=${this.line}
      and status='unknown_acceptance' and body is not null and to_address is not null order by updated_at,id limit 4`;
    for (const stored of rows) {
      const row=this.rowOf(stored);
      await this.sql`update platform.outbound set updated_at=${new Date(this.now)} where id=${row.id} and status='unknown_acceptance'`;
      try {changes.push(await this.acceptReceipt(row,await this.o.provider.receipt(this.request(row))));}
      catch (e) {
        const disposition = stepReceipt({ phase: "AcceptanceUnknown" }, {
          type: "confirmNeverAdmitted", neverAdmitted: e instanceof ChannelSendError && e.code === "not_found",
        });
        if (disposition.phase === "RetryScheduled") {
          // The provider never admitted this id: safe to send again with the same key.
          const moved=await this.sql`update platform.outbound set status='retry_scheduled',next_attempt_at=${new Date(this.now)},updated_at=${new Date(this.now)},
            note='receipt lookup: never admitted' where id=${row.id} and status='unknown_acceptance' returning id`;
          if (moved.length) { changes.push({id:row.id,app:row.app,memberId:row.memberId,status:"retry_scheduled"}); continue; }
        }
        // A missing or ambiguous receipt remains held; mirror it without dispatch or delivery hooks.
        changes.push({id:row.id,app:row.app,memberId:row.memberId,status:"unknown_acceptance"});
      }
    }
    return changes;
  }

  /** A delivery receipt (any app on the line). Undefined when the provider id is not ours. Never goes back. */
  async applyStatus(u: StatusUpdate): Promise<StatusChange | undefined> {
    const [r] = await this.sql`select * from platform.outbound where provider_message_id = ${u.providerMessageId}`;
    if (!r) return undefined;
    const row = this.rowOf(r);
    const at = new Date(this.now);
    // spec/outboundReceipt.md, "A provider receipt advances through acceptance, send, delivery, and read"
    const from = { phase: receiptPhase(row.status) };
    const next = stepReceipt(from, { type: "applyReceipt", providerPhase: receiptPhase(u.status) });
    if (next === from) return undefined;
    if (next.phase === "ProviderFailed") {
      const error = `${u.errorCode ?? ""} ${u.errorMessage ?? ""}`.trim() || "failed";
      const rows = await this.sql`update platform.outbound set status = 'failed',
        transport = coalesce(${u.transport ?? null}, transport), note = 'receipt: failed', last_error = ${error},
        ended_at = ${at}, updated_at = ${at}, lease_owner = null, lease_until = null,
        to_address = case when member_id is null then null else to_address end, body = case when member_id is null then null else body end
        where id = ${row.id} and status = ${row.status} returning id`;
      if (!rows.length) return this.applyStatus(u);
      if (row.personCap && returnsPersonSlot(next.phase)) await this.o.checks.capRelease?.(row).catch(() => {});
      return { id: row.id, app: row.app, memberId: row.memberId, status: "failed" };
    }
    const final = u.status === "delivered" || u.status === "read";
    const rows = await this.sql`update platform.outbound set status = ${u.status}, transport = coalesce(${u.transport ?? null}, transport), updated_at = ${at},
      delivered_at = case when ${final} then coalesce(delivered_at, ${at}) else delivered_at end,
      read_at = case when ${u.status === "read"} then ${at} else read_at end,
      ended_at = case when ${final} then coalesce(ended_at, ${at}) else ended_at end,
      to_address = case when ${final} and member_id is null then null else to_address end, body = case when ${final} and member_id is null then null else body end
      where id = ${row.id} and status = ${row.status} returning id`;
    if (!rows.length) return this.applyStatus(u);
    return { id: row.id, app: row.app, memberId: row.memberId, status: u.status };
  }

  /**
   * The person wrote (a message or a tapback) on this line: the conversation's streak and its
   * re-engagement reset, and messages held for an answer may go (for every app). Returns how many.
   */
  async inbound(address: string): Promise<number> {
    const to = normalizeAddress(address), at = new Date(this.now);
    await this.sql`insert into platform.line_conversations (line, address, last_inbound_at) values (${this.line}, ${to}, ${at})
      on conflict (line, address) do update set unanswered = 0, reengagement_used = false, last_inbound_at = excluded.last_inbound_at`;
    const rows = await this.sql`update platform.outbound set status = 'pending', next_attempt_at = ${at}, updated_at = ${at}, note = 'recipient engaged'
      where line = ${this.line} and to_address = ${to} and status = 'held_awaiting_reply' returning id`;
    return rows.length;
  }

  /** Blooio's safety state for this line (safety.* webhooks). "none" or no action clears it. */
  async setLineSafety(action: string | undefined, eventType?: string): Promise<void> {
    if (!action || action === "none") { await this.sql`delete from platform.line_safety where line = ${this.line}`; return; }
    await this.sql`insert into platform.line_safety (line, action, event_type, at) values (${this.line}, ${action}, ${eventType ?? null}, ${new Date(this.now)})
      on conflict (line) do update set action = excluded.action, event_type = excluded.event_type, at = excluded.at`;
  }

  /**
   * Retention: the conversation counters of an address that is nobody's verified phone (a stranger who
   * wrote once, a removed member) once idle for a day, when no streak is open (nothing unanswered).
   * Such an address counts as a new conversation again. Returns how many were removed.
   */
  async purge(): Promise<number> {
    const before = new Date(this.now - DAY);
    const rows = await this.sql`delete from platform.line_conversations c where c.line = ${this.line}
      and coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.first_outbound_at) < ${before}
      and c.unanswered = 0 and not exists (select 1 from platform.phone_identities p where p.e164 = c.address) returning address`;
    return rows.length;
  }

  async collectedLeaks(db: SQL, i: { id: string; memberId?: string; to: string; kind: MessageKind; text: string; contactAllow?: readonly string[] }): Promise<string[]> {
    const row: QueueRow = {
      id: i.id, app: this.app, ...(i.memberId ? { memberId: i.memberId } : {}), line: this.line, to: normalizeAddress(i.to), kind: i.kind, text: i.text, mediaUrls: [],
      timeZone: "UTC", status: "collected", attempts: 0, createdAt: this.now, inDoubt: false, personCap: false, newConversation: false, reengagement: false,
    };
    return this.leakReasons(row, db, i.contactAllow);
  }

  async recordCollected(tx: SQL, items: { id: string; memberId: string; to: string; kind: MessageKind; text: string }[]): Promise<void> {
    const now = new Date(this.now);
    for (const i of items) {
      const to = normalizeAddress(i.to);
      await tx`insert into platform.outbound ${tx({
        id: i.id, app_id: this.app, member_id: i.memberId, line: this.line, to_address: to, kind: i.kind, body: i.text, media_urls: tx.array([], "TEXT"),
        fingerprint: fingerprint(to, i.text, [], i.kind), opportunity_id: null, time_zone: "UTC", status: "collected", next_attempt_at: now, created_at: now, updated_at: now, ended_at: null,
      })} on conflict (id) do nothing`;
    }
  }

  async collectedReceipt(tx: SQL, ids: string[], outcome: TurnReceiptOutcome, at: number): Promise<void> {
    if (!ids.length) return;
    const status = receiptMessageStatus(outcome);
    const rows = await tx<{ id: string; status: string; line: string; to_address: string; kind: MessageKind; created_at: Date; sent_at: Date | null }[]>`select
      id, status, line, to_address, kind, created_at, sent_at from platform.outbound
      where app_id = ${this.app} and id = any(${tx.array(ids, "TEXT")}) order by id for update`;
    for (const r of rows) {
      if (!gatewayReceiptApplies(r.status, outcome)) continue;
      const sentAt = receiptAccepted(outcome) ? r.sent_at ?? new Date(gatewayReplySendTime(r.status, r.created_at.getTime(), at)) : r.sent_at;
      const moved = await tx`update platform.outbound set status = ${status}, updated_at = ${new Date(this.now)}, sent_at = ${sentAt},
        ended_at = case when ${receiptFinal(outcome)} then coalesce(ended_at, ${new Date(this.now)}) else null end
        where app_id = ${this.app} and id = ${r.id} and status = ${r.status} returning id`;
      if (moved.length && sentAt && receiptAccepted(outcome)) await this.countSend(tx, r.line, r.to_address, r.kind, false, sentAt);
    }
  }

  /** Rows of this app the leak guard parked for a person (GET /queue/leak-review), oldest first. */
  async parkedLeaks(limit = 200): Promise<Array<{ id: string; memberId?: string; to: string | null; kind: MessageKind; text: string | null; reasons: string[]; createdAt: number }>> {
    const rows = await this.sql`select id, member_id, to_address, kind, body, note, created_at from platform.outbound
      where app_id = ${this.app} and line = ${this.line} and status = 'parked_leak_review' order by created_at, id limit ${limit}`;
    return (rows as any[]).map(r => ({
      id: r.id, ...(r.member_id ? { memberId: r.member_id } : {}), to: r.to_address ?? null, kind: r.kind, text: r.body ?? null,
      reasons: typeof r.note === "string" && r.note.startsWith("leak: ") ? r.note.slice(6).split(",").filter(Boolean) : [], createdAt: ms(r.created_at)!,
    }));
  }

  /**
   * Staff decide one parked text. "release": back to the queue (every send-time check runs again, but the
   * leak guard does not park it again); "drop": it ends unsent (dropped_leak_review). Undefined when the
   * row is not parked for leak review in this app.
   */
  async decideLeak(id: string, decision: "release" | "drop", actor: string): Promise<StatusChange | undefined> {
    const [r] = await this.sql`select * from platform.outbound where id = ${id} and app_id = ${this.app} and line = ${this.line} and status = 'parked_leak_review'`;
    if (!r) return undefined;
    const row = this.rowOf(r);
    if (decision === "drop") return this.end(row, "dropped_leak_review", `leak review: dropped by ${actor}`.slice(0, 300));
    // A parked text to a non-member keeps no text or address (end()): there is nothing left to release.
    if (r.body == null || r.to_address == null) return undefined;
    const now = new Date(this.now);
    const moved = await this.sql`update platform.outbound set status = 'pending', next_attempt_at = ${now}, updated_at = ${now}, ended_at = null,
      note = 'leak review: released', leak_released_by = ${actor.slice(0, 300)} where id = ${id} and status = 'parked_leak_review' returning id`;
    return moved.length ? { id: row.id, app: row.app, memberId: row.memberId, status: "pending" } : undefined;
  }

  /** The status of one row (this queue's app). */
  async statusOf(id: string): Promise<string | undefined> {
    const [r] = await this.sql`select status from platform.outbound where id = ${id}`;
    return r?.status;
  }
}
