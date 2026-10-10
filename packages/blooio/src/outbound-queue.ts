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
//  - Checks at dispatch, in this order (each reads the database, so a STOP that arrives while a message
//    waits wins): too old or about a closed item (expired); the live flags (refused_not_approved); the
//    consent ledger and the member's opt-out (refused_opted_out); the recipient at send time
//    (suppressed_ineligible); a "reply" must answer an inbound message from the last hour; quiet hours in the
//    recipient's zone for agent-initiated kinds (deferred); Apple line safety: at most 3 unanswered messages
//    per conversation, then one re-engagement after 14 days (held until the person writes); Blooio's safety
//    state of the line; the per-recipient hourly cap, the per-line daily cap and the per-line daily cap on new
//    conversations (retry later); the person cap of proactive messages (refused_person_cap); the leak guard
//    on the new text and on the recent thread to the same address (core-14; parked_leak_review). Compliance
//    texts (STOP/HELP/START and leave confirmations) skip the opt-out, the recipient check, quiet hours and
//    the caps, but never the leak guard's canary and fact checks on their own text.
//  - More than one worker: every replica may run drain(). The per-line advisory lock lets one drain run at a
//    time; a row is claimed with a conditional update to "sending" plus a lease (status unchanged, no lease),
//    so a second worker that read the same row finds it claimed and skips it, and a worker that stopped
//    mid-send leaves a lease that recover() reclaims. The provider key stays "tn:<id>" on every attempt.
//  - Provider errors: retryable ones back off (30 s, doubling, at most 30 min) and fail after 6 attempts;
//    Blooio conversation limits hold the row until the person writes; number-level blocks end it (blocked).
//  - Delivery receipts (Blooio webhooks) move a row to delivered, read or failed. Statuses never go back.
//  - A row to someone who is not a member keeps the address and the text only until it ends.
import { createHash } from "node:crypto";
import type { SQL } from "bun";
import { DAY, HOUR, MINUTE } from "../../core/src/clock.ts";
import { LeakGuard } from "../../core/src/guard.ts";
import { normalizeAddress } from "./phone.ts";
import { DEFAULT_QUIET, isQuietAt, isValidTimeZone, nextAllowedAt, resolveTimeZone, type QuietWindow } from "./quiet-hours.ts";
import { ChannelSendError, type ChannelAdapter, type Clock, type StatusUpdate, type SendRequest, type SendReceipt } from "./types.ts";

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

/** What must not appear in a message to this recipient (see LeakOptions in packages/core/src/guard.ts). */
export interface LeakSources {
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

/** What the app (the Network runtime) checks for its own rows. Every hook fails closed when it throws. */
export interface AppChecks {
  /** The live flags for this app (BLOOIO_ALLOW_SEND, NTWRK_LIVE_APPROVED, <APP>_LIVE_APPROVED). */
  live(): boolean;
  /** True when the message is about something that closed (it is stored as expired). */
  stale?(row: QueueRow): boolean | Promise<boolean>;
  /** True when the consent ledger or the member's own flag says the person opted out of this app. */
  optedOut?(row: QueueRow): boolean | Promise<boolean>;
  /** The recipient at send time: paused, blocked, held, a minor for content about others. */
  recipient?(row: QueueRow, agentInitiated: boolean): RecipientCheck | Promise<RecipientCheck>;
  /** The leak lists for this recipient (never their own facts). */
  leaks?(row: QueueRow): LeakSources | Promise<LeakSources>;
  /** Take a slot of the person's daily cap of proactive messages. False: the cap refuses it. */
  capTake?(row: QueueRow): Promise<boolean>;
  /** Give the slot back (the message did not go out). */
  capRelease?(row: QueueRow): Promise<void>;
  /** Acquire app-owned row fences before the shared person/member fences, in this transaction. SQL only; no remote I/O. */
  lockAdmission?(row: QueueRow, tx: SQL): Promise<void>;
  /**
   * The app's last word, inside the admission transaction after every asynchronous gate (app.app_id is
   * set; short row locks only, no remote I/O). Not ok: the row ends suppressed. A throw parks the row.
   * The Network checks a relayed item's match and both members here (runtime.ts relayAdmission).
   */
  admit?(row: QueueRow, tx: SQL): Promise<RecipientCheck>;
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
   * provider timed out) and that no receipt lookup resolves within this long after it was created ends as
   * failed_unknown, with an alert. Default 6 hours.
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

export class IdempotencyConflictError extends Error {
  constructor(id: string) { super(`outbound id reused with other content: ${id}`); this.name = "IdempotencyConflictError"; }
}

/** Statuses that still wait for the worker (the console's backlog). */
export const WAITING = ["pending", "retry_scheduled", "deferred_quiet_hours", "held_awaiting_reply", "sending", "unknown_acceptance"];
/** Statuses the provider accepted; a receipt ends them. */
const IN_FLIGHT = ["accepted", "sent"];
const DUE = ["pending", "retry_scheduled", "deferred_quiet_hours"];
const PROVIDER_RANK: Record<string, number> = { accepted: 1, queued: 1, sent: 2, delivered: 3, read: 4 };
/** Statuses that did not go out: their person-cap slot goes back. */
export const NOT_SENT = /^(refused|suppressed|blocked|parked|failed|expired|dropped)/;

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
        and status = any(${`{${DUE.join(",")}}`}::text[]) and next_attempt_at <= ${new Date(this.now)} order by next_attempt_at, created_at, id`;
      for (const r of rows as any[]) {
        const row = this.rowOf(r);
        let c: StatusChange | undefined;
        try {
          c = await this.dispatch(row);
        } catch (e) {
          // One bad row never stops the drain: it is parked for a person and the drain goes on.
          c = await this.end(row, "parked_error", (e as Error).message);
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
  private async end(row: QueueRow, status: string, note?: string, error?: string): Promise<StatusChange> {
    const now = new Date(this.now);
    // A text parked for leak review keeps its text and address until staff decide (a drop ends it and clears them).
    const keep = status === "parked_leak_review";
    await this.sql`update platform.outbound set status = ${status}, note = ${note ?? null}, last_error = coalesce(${error ?? null}, last_error), ended_at = ${now}, updated_at = ${now},
      lease_owner = null, lease_until = null,
      to_address = case when member_id is null and ${!keep} then null else to_address end, body = case when member_id is null and ${!keep} then null else body end
      where id = ${row.id}`;
    if (row.personCap && NOT_SENT.test(status)) await this.o.checks.capRelease?.(row).catch(() => {});
    return { id: row.id, app: row.app, memberId: row.memberId, status };
  }

  /** The row waits (not an end): a later drain tries again at `at`. */
  private async wait(row: QueueRow, status: string, at: number, note: string): Promise<StatusChange> {
    await this.sql`update platform.outbound set status = ${status}, next_attempt_at = ${new Date(at)}, note = ${note}, updated_at = ${new Date(this.now)}, lease_owner = null, lease_until = null where id = ${row.id}`;
    return { id: row.id, app: row.app, memberId: row.memberId, status };
  }

  private async guarded<T>(fn: () => T | Promise<T>, failed: T): Promise<T> {
    try { return await fn(); } catch { return failed; }
  }

  private async conversation(address: string) {
    const [c] = await this.sql`select * from platform.line_conversations where line = ${this.line} and address = ${address}`;
    return c as { unanswered: number; reengagement_used: boolean; last_outbound_at: unknown; last_inbound_at: unknown } | undefined;
  }

  private async dispatch(row: QueueRow): Promise<StatusChange> {
    const now = this.now;
    const c = this.o.checks;
    const agent = isAgentInitiated(row.kind);
    const compliance = row.kind === "compliance";

    // 0. Too old, or about something that closed.
    if (this.tooOld(row) || (await this.guarded(() => c.stale?.(row) ?? false, false))) return this.end(row, "expired");
    // 1. The live flags (founder approval), checked again at send time.
    if (!(await this.guarded(() => c.live(), false))) return this.end(row, "refused_not_approved");
    if (!compliance) {
      // 2. Consent: the ledger and the member's own flag, read now (a STOP that came while the row waited wins).
      if (await this.guarded(() => c.optedOut?.(row) ?? false, true)) return this.end(row, "refused_opted_out");
      // 3. The recipient at send time.
      const check = await this.guarded<RecipientCheck>(() => c.recipient?.(row, agent) ?? { ok: true }, { ok: false, reason: "recipient_check_error" });
      if (!check.ok) return this.end(row, "suppressed_ineligible", check.reason);
    }
    const conv = await this.conversation(row.to);
    // 4. A reply answers something the person sent in the last hour (the caller's word alone does not skip quiet hours).
    if (row.kind === "reply") {
      const last = ms(conv?.last_inbound_at);
      if (last === undefined || now - last > this.opt("replyWindowMs", HOUR)) {
        this.o.onAlert?.(row.id, "reply_without_recent_inbound");
        return this.end(row, "suppressed_ineligible", "reply without a recent inbound");
      }
    }
    // 5. Quiet hours in the recipient's zone.
    if (agent) {
      if (!isValidTimeZone(row.timeZone)) return this.end(row, "parked_invalid_timezone");
      const quiet = this.o.quiet ?? DEFAULT_QUIET;
      if (isQuietAt(now, row.timeZone, quiet)) return this.wait(row, "deferred_quiet_hours", nextAllowedAt(now, row.timeZone, quiet), "quiet hours");
    }
    // 6. Apple line safety: the unanswered streak and the one re-engagement.
    let reengagement = false;
    if (!compliance && conv && conv.unanswered >= this.opt("maxUnanswered", 3)) {
      const quietFor = now - (ms(conv.last_outbound_at) ?? -Infinity);
      if (agent && !conv.reengagement_used && quietFor >= this.opt("reengageAfterMs", 14 * DAY)) reengagement = true;
      else return this.wait(row, "held_awaiting_reply", now, conv.reengagement_used ? "unanswered cap: re-engagement used" : "unanswered cap");
    }
    // 7. Blooio's safety state of the line.
    const isNew = !conv;
    const [safety] = await this.sql`select action from platform.line_safety where line = ${this.line}`;
    const action = safety?.action as string | undefined;
    if (action === "review" || (action === "reply_only" && (agent || isNew)) || (action === "pause_new" && isNew)) {
      this.o.onAlert?.(row.id, `line_safety_${action}`);
      return this.wait(row, "retry_scheduled", now + HOUR, `line safety ${action}`);
    }
    // 8. The caps of the line and the recipient (compliance texts always go).
    if (!compliance) {
      const [counts] = await this.sql`select
        count(*) filter (where to_address = ${row.to} and sent_at > ${new Date(now - HOUR)})::int as recipient,
        count(*) filter (where kind in ('proactive', 'transactional') and sent_at > ${new Date(now - DAY)})::int as line,
        count(*) filter (where new_conversation and sent_at > ${new Date(now - DAY)})::int as new_chats
        from platform.outbound where line = ${this.line} and sent_at > ${new Date(now - DAY)}`;
      if (counts.recipient >= this.opt("perRecipientPerHour", 10)) return this.wait(row, "retry_scheduled", now + 5 * MINUTE, "per-recipient hourly cap");
      if (agent && counts.line >= this.opt("perLinePerDay", 200)) return this.wait(row, "retry_scheduled", now + HOUR, "per-line daily cap");
      if (agent && isNew && counts.new_chats >= this.opt("newChatsPerLinePerDay", 20)) return this.wait(row, "retry_scheduled", now + HOUR, "per-line new conversation cap");
    }
    // 9. The person cap (proactive only, at send time; a redelivered id is never counted twice).
    if (row.kind === "proactive" && c.capTake) {
      if (!(await this.guarded(() => c.capTake!(row), false))) return this.end(row, "refused_person_cap");
      if (!row.personCap) { row.personCap = true; await this.sql`update platform.outbound set person_cap = true where id = ${row.id}`; }
    }
    // 10. The leak guard, right before the send: only hashed labels are stored, never the text or the match.
    // A row staff released from leak review (releaseLeak) is not parked again for the same text.
    const leaks = row.leakReleased ? [] : await this.leakReasons(row);
    if (leaks.length) {
      this.o.onAlert?.(row.id, "leak_blocked");
      return this.end(row, "parked_leak_review", `leak: ${leaks.join(",")}`);
    }
    return this.send(row, isNew, reengagement);
  }

  private async leakReasons(row: QueueRow, db: SQL = this.sql): Promise<string[]> {
    let src: LeakSources = {};
    if (this.o.checks.leaks) {
      try { src = await this.o.checks.leaks(row); } catch { return ["leak_check_error"]; }
    }
    const own = row.memberId ?? row.to;
    const reasons = new LeakGuard({ ...src, canaryShapes: true, allow: [...(this.o.leakAllow ?? []), ...(src.allow ?? [])], contacts: row.kind !== "compliance" }).check(row.text, { exceptOwner: own });
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

  private async send(row: QueueRow, isNew: boolean, reengagement: boolean): Promise<StatusChange> {
    const start = this.now;
    // Admit only the current canonical member and immutable payload, after the async gates.
    // Erasure and admission share the person/member row fences. No remote I/O holds these locks.
    const admission = await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id',${this.app},true)`;
      await this.o.checks.lockAdmission?.(row, tx);
      if (row.memberId) {
        await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
          where member.app_id=${row.app} and member.id=${row.memberId} order by person.id for update of person`;
        const [member] = await tx`select id,person_id,account_status,opted_out from network.members where app_id=${row.app} and id=${row.memberId} for update`;
        if (!member || member.account_status==='removed' || member.account_status==='invited') return "dropped_forgotten";
        // A paused or restricted account still gets replies to its own messages, compliance texts and
        // safety notices (snapshot.ts); the engine already decides those. The fence stops only proactive sends.
        if (row.kind==="proactive" && member.account_status!=="active") return "suppressed_ineligible";
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
        if (row.kind!=="compliance" && (member.opted_out || await this.guarded(()=>this.o.checks.optedOut?.(row)??false,true))) return "refused_opted_out";
      }
      // Recheck eligibility after person/member fences; app state fences were acquired first, as in canonical erasure.
      if (this.o.checks.admit && !(await this.o.checks.admit(row, tx)).ok) return "suppressed_ineligible";
      const claimed = await tx`update platform.outbound set status='sending',attempts=attempts+1,lease_owner=${this.instance},
        lease_until=${new Date(start+this.opt("leaseMs",5*MINUTE))},updated_at=${new Date(start)},new_conversation=${isNew},reengagement=${reengagement}
        where id=${row.id} and app_id=${row.app} and line=${this.line} and status=${row.status} and lease_until is null
        and to_address=${row.to} and body=${row.text} and fingerprint=${fingerprint(row.to,row.text,row.mediaUrls,row.kind)} returning id`;
      if (claimed.length) return "admitted";
      // Another worker claimed or ended the row since this drain read it: leave it to that worker.
      const [now] = await tx`select status,lease_until from platform.outbound where id=${row.id}`;
      if (now && (now.status!==row.status || now.lease_until!==null)) return {busy:String(now.status)};
      return "dropped_forgotten";
    });
    if (typeof admission==="object") return {id:row.id,app:row.app,memberId:row.memberId,status:admission.busy};
    if (admission!=="admitted") return this.end(row,admission);
    const attempts = row.attempts + 1;
    try {
      const receipt = await this.o.provider.send(this.request(row));
      return this.acceptReceipt({...row,newConversation:isNew,reengagement}, receipt);
    } catch (err) {
      const e = err instanceof ChannelSendError ? err : new ChannelSendError(err instanceof Error ? err.message : String(err), "retryable");
      const error = `${e.failure}${e.status ? ` ${e.status}` : ""}${e.code ? ` ${e.code}` : ""}: ${e.message}`.slice(0, 500);
      await this.sql`update platform.outbound set last_error = ${error} where id = ${row.id}`;
      switch (e.failure) {
        case "unknown":
          return this.wait(row,"unknown_acceptance",this.now,"provider acceptance unresolved; receipt lookup only");
        case "retryable": {
          if (attempts >= this.opt("maxAttempts", 6)) { this.o.onAlert?.(row.id, "send_failed"); return this.end(row, "failed", "retries used up", error); }
          const backoff = e.retryAfterMs ?? Math.min(this.opt("baseBackoffMs", 30_000) * 2 ** (attempts - 1), 30 * MINUTE);
          return this.wait(row, "retry_scheduled", this.now + backoff, e.code ?? "retry");
        }
        case "await_recipient":
          return this.wait(row, "held_awaiting_reply", this.now, e.code ?? "conversation limit");
        case "blocked":
          this.o.onAlert?.(row.id, e.code ?? "blocked");
          return this.end(row, "blocked", e.code, error);
        default:
          this.o.onAlert?.(row.id, `send_${e.failure}`);
          return this.end(row, "failed", e.code, error);
      }
    }
  }

  private request(row: QueueRow): SendRequest {
    return {from:this.line,to:row.to,text:row.text,...(row.mediaUrls.length?{mediaUrls:row.mediaUrls}:{}),idempotencyKey:`tn:${row.id}`,
      context:{id:row.id,app:row.app,memberId:row.memberId??null,kind:row.kind}};
  }

  /** Commit only an extant immutable row. The person lock is shared with canonical erasure. */
  private async acceptReceipt(row: QueueRow, receipt: SendReceipt): Promise<StatusChange> {
    const status=receipt.status==="queued"?"accepted":receipt.status;
    const acceptedAt=receipt.acceptedAt??this.now;
    if (!Number.isFinite(acceptedAt) || !receipt.providerMessageId) throw new ChannelSendError("Invalid acceptance receipt","unknown");
    const at=new Date(acceptedAt),providerIds=receipt.providerMessageIds??[receipt.providerMessageId];
    const committed=await this.sql.begin(async tx=>{
      await tx`select set_config('app.app_id',${this.app},true)`;
      if (row.memberId) await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
        where member.app_id=${row.app} and member.id=${row.memberId} order by person.id for update of person`;
      const wrote=await tx`update platform.outbound set status=${status},provider_message_id=${receipt.providerMessageId},
        provider_message_ids=${{ids:providerIds}}::jsonb->'ids',history_recorded=${receipt.historyRecorded??null},chat_id=${receipt.chatId??null},
        transport=${receipt.transport??null},sent_at=coalesce(sent_at,${at}),lease_owner=null,lease_until=null,updated_at=${new Date(this.now)},
        note=${receipt.replayed?"idempotent replay":null},delivered_at=${status==="delivered"||status==="read"?at:null},
        ended_at=${status==="delivered"||status==="read"||status==="failed"?at:null}
        where id=${row.id} and app_id=${row.app} and line=${this.line} and status in ('sending','unknown_acceptance')
        and to_address=${row.to} and body=${row.text} and fingerprint=${fingerprint(row.to,row.text,row.mediaUrls,row.kind)} returning id`;
      if (!wrote.length) return false;
      if (status!=="failed") {
        const unanswered=row.kind==="compliance"?0:1;
        // A send accepted at the same instant as the person's last message counts toward the streak (a reply
        // follows the message it answers); only a send accepted before their message is already answered.
        await tx`insert into platform.line_conversations(line,address,unanswered,reengagement_used,first_outbound_at,last_outbound_at)
          values(${this.line},${row.to},${unanswered},${row.reengagement},${at},${at})
          on conflict(line,address) do update set
            unanswered=case when line_conversations.last_inbound_at>${at} then line_conversations.unanswered else line_conversations.unanswered+${unanswered} end,
            last_outbound_at=greatest(line_conversations.last_outbound_at,excluded.last_outbound_at),
            first_outbound_at=least(line_conversations.first_outbound_at,excluded.first_outbound_at),
            reengagement_used=case when line_conversations.last_inbound_at>${at} then line_conversations.reengagement_used else line_conversations.reengagement_used or excluded.reengagement_used end`;
      }
      return true;
    });
    if (!committed) return {id:row.id,app:row.app,memberId:row.memberId,status:"dropped_forgotten"};
    if (status==="failed") return this.end(row,"failed","provider reported failure");
    if (status==="delivered"||status==="read") return this.end(row,status);
    return {id:row.id,app:row.app,memberId:row.memberId,status};
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
      and status='unknown_acceptance' and created_at<${new Date(this.now-ttl)} order by created_at,id limit 50`) {
      const row=this.rowOf(stored);
      this.o.onAlert?.(row.id,"unknown_acceptance_expired");
      changes.push(await this.end(row,"failed_unknown","provider acceptance never resolved"));
    }
    if (!this.o.provider.receipt) return changes;
    const rows=await this.sql`select * from platform.outbound where app_id=${this.app} and line=${this.line}
      and status='unknown_acceptance' and body is not null and to_address is not null order by updated_at,id limit 4`;
    for (const stored of rows) {
      const row=this.rowOf(stored);
      await this.sql`update platform.outbound set updated_at=${new Date(this.now)} where id=${row.id} and status='unknown_acceptance'`;
      try {changes.push(await this.acceptReceipt(row,await this.o.provider.receipt(this.request(row))));}
      catch (e) {
        if (e instanceof ChannelSendError && e.code==="not_found") {
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
    if (u.status === "failed") {
      if (!IN_FLIGHT.includes(row.status)) return undefined; // a late failure after delivery
      await this.sql`update platform.outbound set transport = coalesce(${u.transport ?? null}, transport) where id = ${row.id}`;
      return this.end(row, "failed", "receipt: failed", `${u.errorCode ?? ""} ${u.errorMessage ?? ""}`.trim() || "failed");
    }
    const cur = PROVIDER_RANK[row.status];
    if (cur === undefined || (PROVIDER_RANK[u.status] ?? 0) <= cur) return undefined; // a row that did not go out, or a status that would go back
    const final = u.status === "delivered" || u.status === "read";
    await this.sql`update platform.outbound set status = ${u.status}, transport = coalesce(${u.transport ?? null}, transport), updated_at = ${at},
      delivered_at = case when ${final} then coalesce(delivered_at, ${at}) else delivered_at end,
      read_at = case when ${u.status === "read"} then ${at} else read_at end,
      ended_at = case when ${final} then coalesce(ended_at, ${at}) else ended_at end,
      to_address = case when ${final} and member_id is null then null else to_address end, body = case when ${final} and member_id is null then null else body end
      where id = ${row.id}`;
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

  // ---------------------------------------------------------------- replies another transport delivers
  // In a signed turn (the Eliza Cloud seam) the Network's replies are collected and returned to Cloud,
  // which sends them; they never pass dispatch(). They still get this queue's leak guard (canary shapes,
  // contacts, the recipient's leak sources and the core-14 thread check) and they join the thread history
  // the guard reads: a row with status "collected" in the caller's transaction, "sent" with sent_at once
  // Cloud reports acceptance (collectedReceipt).

  /** The leak guard's reasons for one reply that another transport will deliver (empty: it may go). `db`: the caller's transaction. */
  async collectedLeaks(db: SQL, i: { id: string; memberId?: string; to: string; kind: MessageKind; text: string }): Promise<string[]> {
    const row: QueueRow = {
      id: i.id, app: this.app, ...(i.memberId ? { memberId: i.memberId } : {}), line: this.line, to: normalizeAddress(i.to), kind: i.kind, text: i.text, mediaUrls: [],
      timeZone: "UTC", status: "collected", attempts: 0, createdAt: this.now, inDoubt: false, personCap: false, newConversation: false, reengagement: false,
    };
    return this.leakReasons(row, db);
  }

  /** Record collected replies to members (thread history for the leak guard) in the caller's transaction. A replay is a no-op. */
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

  /** Cloud's turn receipt for collected replies: accepted ones enter the thread history (sent_at); the others end. */
  async collectedReceipt(tx: SQL, ids: string[], outcome: "accepted" | "unknown" | "rejected", at: number): Promise<void> {
    if (!ids.length) return;
    const status = outcome === "accepted" ? "sent" : outcome === "unknown" ? "send_unknown" : "refused_gateway";
    await tx`update platform.outbound set status = ${status}, updated_at = ${new Date(this.now)},
      sent_at = case when ${outcome === "accepted"} then coalesce(sent_at, ${new Date(at)}) else sent_at end,
      ended_at = case when ${outcome === "unknown"} then null else coalesce(ended_at, ${new Date(this.now)}) end
      where app_id = ${this.app} and id = any(${tx.array(ids, "TEXT")}) and status in ('collected', 'send_unknown')`;
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
