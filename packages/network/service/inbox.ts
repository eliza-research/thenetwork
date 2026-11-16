// The inbound inbox for the shared Blooio line (platform.inbound, migration 0015).
//  - Dedupe: the row id is the provider's message id ("msg:<channel>:<id>"). A provider retry, a replay or
//    the same message through a second webhook subscription finds the row and is a duplicate.
//  - Durable: the webhook answers 200 once the row is stored. A handler error leaves the row pending and
//    the next tick handles it again (audit network-service-7: no 500 that makes the provider send a
//    duplicate). After 5 failed attempts a non-STOP row fails. STOP stays pending.
//  - Ordering per sender: the rows of one sender are handled one at a time (an advisory lock per sender,
//    across processes), oldest received first. A failed attempt stops that sender's later rows until it
//    is handled, so the Network never reads an answer before the question it answers.
//  - Compliance first: a waiting STOP, STOP ALL, "leave <app>", START or HELP is handled ahead of the
//    sender's other waiting rows, so a row that fails and retries never holds back a consent change or its
//    confirmation. A handled STOP or STOP ALL cancels the sender's ordinary rows received before it
//    (outcome "cancelled_by_stop"): nothing the person wrote before STOP is acted on after it (a join
//    answer handled late would opt them back in). Rows received after the STOP are handled as usual.
//  - Privacy: the row keeps the sender and the event only while it waits. A handled row keeps the id,
//    the times and the outcome.
//  - Signed turns (/internal/turn): one at a time per sender. A running turn renews its lease (arrived_at)
//    every 30 seconds; a turn still "processing" 2 minutes after its last renewal lost its worker and reads
//    as unresolved. An unresolved turn holds the sender back for 10 minutes at most; STOP, START and HELP are
//    never held back (on either path); staff can resolve a stuck turn (POST /inbound/resolve). A retry of
//    a turn that is still running is told to retry (turn_busy). A compliance turn that fails is never
//    sealed: when its consent change committed, it answers with the consent and the confirmation; when
//    nothing committed, the claim is released and the gateway retries the same messageId (turn_failed).
import { AsyncLocalStorage } from "node:async_hooks";
import {
  initial as initialSignedInbox, leaseRenewMs, mayStartClaimWrite, ordinaryTurnMustWait, processingLeaseMs,
  signedAdmissionOpen, step as stepSignedInbox, turnTombstoneKeepMs, unresolvedBlockMs, type SignedInbox,
} from "../../core/src/generated/signedInbox.ts";
import { webhookAnswer, webhookArrival, webhookAttemptLimit, webhookScanLimit } from "../../core/src/generated/webhookInbox.ts";
import { drainWebhookSender } from "../../core/src/vibe/webhookInboxShell.js";
import type { NetworkAppId, TurnRequest, TurnResponse } from "../../core/src/svc/contract.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Clock } from "@thenetwork/core";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import type { InboundMessage } from "../../blooio/src/types.ts";
import { detectKeyword, leaveTarget } from "../../platform/src/consent.ts";

/** STOP, STOP ALL, START, HELP or "leave <app>": consent and its confirmation are never held back. */
export function isComplianceText(text: unknown): boolean {
  return typeof text === "string" && (detectKeyword(text) !== undefined || leaveTarget(text) !== undefined);
}
const isStopText = (text: unknown) => typeof text === "string" && ((k => k === "stop" || k === "stop_all")(detectKeyword(text)));

export interface InboxOptions {
  sql: SQL;
  clock: Clock;
  /** Handle one message (NetworkService.inbound). `app`: the per-app webhook path, if any. */
  handle: (ev: InboundMessage, app?: string) => Promise<string>;
  log: (line: string) => void;
  senderKey: (sender: string) => string;
  /** How often a running signed turn renews its lease (default 30 s; the integration test uses a short one). */
  leaseRenewMs?: number;
}

export interface InboundTurn {
  id: string;
  from: string;
  app?: NetworkAppId;
  memberId?: string;
  consent?: {state: "opted_in" | "opted_out"; scope: "all" | "app"; app: NetworkAppId | null; at: number};
  /** The fixed confirmation of a consent change this turn recorded (STOP, leave): sent even if a later step of the turn fails. */
  confirmation?: {id: string; body: string};
  /** This unit attempted to store its own complete reply. The row determines whether it committed. */
  atomicReplyCompletion?: true;
  /** Undo work committed outside the turn's own transactions (the one-time notice row) when the turn ends without an answer. */
  onFail?: Array<() => Promise<unknown>>;
}
export interface CollectedReply {id: string; body: string; kind: "reply" | "compliance"}
export type AtomicReplyReason = "member_invitation" | "member_invitation_review" | "member_invitation_delivery" | "bounded_home_help" | "profile_fact_edit" | "cofounder_intent" | "participation_controls";

interface WebhookEnvelope {
  ev: InboundMessage;
  app: string | null;
}

interface StoredWebhook {
  id: string;
  received_at: Date;
  attempts: number;
  event: WebhookEnvelope | string | null;
}

export class Inbox {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly turns = new AsyncLocalStorage<InboundTurn>();
  constructor(private readonly o: InboxOptions) {}
  currentTurn = () => this.turns.getStore();

  /** A committed claim precedes effects; the partial index admits one signed turn per sender. */
  async signed(input: TurnRequest, requestHash: string, run: (turn: InboundTurn) => Promise<TurnResponse>, admitUntil?: number): Promise<{status: number; body: unknown}> {
    const id = `msg:${input.channel}:${input.messageId}`, senderHash = this.o.senderKey(input.from);
    const now = this.o.clock.now();
    // STOP, START and HELP are never held back by an earlier turn that did not finish (consent always gets through).
    const keyword = isComplianceText(input.text);
    const wrote = await this.o.sql.begin(async tx => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext(${`inbox-sender:${normalizeAddress(input.from)}`})) as acquired`;
      // spec/signedInbox.md, "A worker runs only a committed claim"
      const admissionOpen = lock.acquired && (admitUntil === undefined || signedAdmissionOpen(true, this.o.clock.now(), admitUntil));
      if (!mayStartClaimWrite(lock.acquired, admissionOpen)) return [];
      // A turn whose worker stopped (no completion within the lease) is unresolved, not processing forever.
      await tx`update platform.inbound set status='unresolved',event=null,sender=null
        where sender_hash=${senderHash} and status='processing' and request_hash is not null and arrived_at<${new Date(now - processingLeaseMs)}`;
      return tx`insert into platform.inbound(id,line,sender,received_at,arrived_at,event,status,request_hash,sender_hash,network_authority)
      select ${id},null,null,${new Date(input.receivedAt)},${new Date(now)},null,'processing',${requestHash},${senderHash},${input.networkAuthority ?? null}::jsonb
      where ${signedAdmissionOpen(admitUntil !== undefined, now, admitUntil ?? 0)} and not exists(select 1 from platform.inbound where sender_hash=${senderHash} and (status='processing'
        or (${ordinaryTurnMustWait(keyword)} and (status='pending' or (status='unresolved' and arrived_at>${new Date(now - unresolvedBlockMs)})))))
      on conflict do nothing returning id`;
    });
    const claimed = stepSignedInbox(initialSignedInbox, { type: "recordClaim", inserted: wrote.length > 0 });
    if (claimed.phase === "CheckingPrior") {
      // spec/signedInbox.md, "A replay must match a stored request"
      const [prior] = await this.o.sql`select request_hash,status,response from platform.inbound where id=${id}`;
      const replay = stepSignedInbox(claimed, {
        type: "readPrior", rowPresent: !!prior, sameRequest: prior?.request_hash === requestHash,
        responseAvailable: prior?.status === "done" && !!prior.response, processing: prior?.status === "processing",
      });
      switch (replay.phase) {
        case "Busy": return {status:409,body:{error:"turn_busy",retryable:true}};
        case "Conflict": return {status:409,body:{error:"turn_conflict",retryable:false}};
        case "Replayed": return {status:200,body:prior!.response};
        default: return {status:409,body:{error:"turn_unresolved",retryable:false}};
      }
    }
    const turn: InboundTurn = {id,from:input.from};
    // Renew the lease while the turn runs, so a slow turn (an LLM read, lock waits) is never swept as abandoned after its effects committed.
    const renew = setInterval(() => {
      this.o.sql`update platform.inbound set arrived_at=${new Date(this.o.clock.now())} where id=${id} and status='processing'`.catch(() => {});
    }, this.o.leaseRenewMs ?? leaseRenewMs);
    (renew as {unref?: () => void}).unref?.();
    try {
      const body = await this.turns.run(turn, () => run(turn));
      const committed = await this.committedReply(turn);
      if (committed) return {status: 200, body: committed};
      const rows = await this.o.sql`update platform.inbound set status='done',response=${body}::jsonb,handled_at=${new Date(this.o.clock.now())},
        handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${id} and status='processing' returning id`;
      // spec/signedInbox.md, "Completion and compliance recovery depend on the stored row"
      const completed = stepSignedInbox(claimed, { type: "recordCompletion", saved: rows.length > 0 });
      if (completed.phase !== "Finished") { this.o.log(`[alert] signed turn ${id} lost its claim before completion (swept or resolved by staff)`); throw new Error("Turn ownership changed before completion"); }
      return {status:200,body};
    } catch (e) {
      const committed = await this.committedReply(turn);
      if (committed) return {status: 200, body: committed};
      const failed = stepSignedInbox(claimed, { type: "handleFailure", compliance: keyword });
      if (failed.phase === "CheckingRescue") {
        const rescued = await this.rescueCompliance(id, turn, failed).catch(() => undefined);
        if (rescued) { this.o.log(`[inbound] compliance turn ${id} failed after its consent change: ${(e as Error).message}`); return rescued; }
      }
      await this.o.sql`update platform.inbound set status='unresolved',event=null,sender=null where id=${id} and status='processing'`;
      await this.undo(turn);
      return {status:409,body:{error:"turn_unresolved",retryable:false}};
    } finally {
      clearInterval(renew);
    }
  }

  private async committedReply(turn: InboundTurn): Promise<TurnResponse | undefined> {
    if (!turn.atomicReplyCompletion) return;
    const [row] = await this.o.sql`select response from platform.inbound where id=${turn.id} and status='done'`;
    return row?.response as TurnResponse | undefined;
  }

  private async undo(turn: InboundTurn) {
    for (const f of turn.onFail ?? []) await f().catch(e => this.o.log(`[inbound] undo after a failed turn: ${(e as Error).message}`));
  }

  /**
   * A STOP, START, HELP or leave whose turn threw. If its consent change (or a reply) committed, the turn
   * ends handled with the consent and the fixed confirmation, so the gateway sends the confirmation and
   * updates its send-time fence. If nothing committed, the claim is released and the gateway retries the
   * same messageId (the consent ledger and the member's unit are idempotent per message).
   */
  private async rescueCompliance(id: string, turn: InboundTurn, failed: SignedInbox): Promise<{status: number; body: unknown} | undefined> {
    const [row] = await this.o.sql`select status,replies from platform.inbound where id=${id}`;
    const processing = row?.status === "processing";
    const stored = processing ? row.replies : undefined;
    const collected = ((typeof stored === "string" ? JSON.parse(stored) : stored) ?? []) as CollectedReply[];
    const recovery = stepSignedInbox(failed, { type: "checkRescue", processing, effectCommitted: !!turn.consent || collected.length > 0 });
    if (recovery.phase === "Unresolved") return undefined;
    if (recovery.phase === "ReleasingClaim") {
      const released = await this.o.sql`delete from platform.inbound where id=${id} and status='processing' returning id`;
      if (stepSignedInbox(recovery, { type: "recordRescue", changed: released.length > 0 }).phase !== "RetryCompliance") return undefined;
      await this.undo(turn);
      return {status:409,body:{error:"turn_failed",retryable:true}};
    }
    if (recovery.phase !== "PreservingCompliance") return undefined;
    const replies = [...collected];
    if (turn.confirmation && !replies.some(r => r.kind === "compliance")) replies.push({...turn.confirmation, kind: "compliance"});
    const body: TurnResponse = {outcome: "handled", replies: replies.map(r => r.body), replyIds: replies.map(r => r.id), delivery: "collected",
      replyKind: replies.length && replies.every(r => r.kind === "compliance") ? "compliance" : "reply", accountEligible: false,
      app: turn.app ?? null, memberId: turn.memberId ?? null, reason: "compliance_partial", ...(turn.consent ? {consent: turn.consent} : {})};
    const rows = await this.o.sql`update platform.inbound set status='done',response=${body}::jsonb,replies=(${{items: replies}}::jsonb->'items'),
      handled_at=${new Date(this.o.clock.now())},handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,
      app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${id} and status='processing' returning id`;
    return stepSignedInbox(recovery, { type: "recordRescue", changed: rows.length > 0 }).phase === "Finished" ? {status: 200, body} : undefined;
  }

  /** Persist only causal replies in the same transaction as their Network effects. */
  async collect(tx: SQL, replies: CollectedReply[], reason?: AtomicReplyReason): Promise<void> {
    const turn = this.currentTurn();
    if (!turn || !replies.length) return;
    if (reason) {
      if (!turn.app || !turn.memberId || replies.length !== 1 || replies[0]!.kind !== "reply") throw new Error("Atomic collection requires one verified member reply");
      turn.atomicReplyCompletion = true;
      const response: TurnResponse = {outcome: "handled", replies: replies.map(reply => reply.body), replyIds: replies.map(reply => reply.id),
        delivery: "collected", replyKind: "reply", accountEligible: true, app: turn.app, memberId: turn.memberId, reason};
      const rows = await tx`update platform.inbound set status='done',response=${response}::jsonb,replies=(${{items: replies}}::jsonb->'items'),
        handled_at=${new Date(this.o.clock.now())},handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,
        app_id=${turn.app},member_id=${turn.memberId} where id=${turn.id} and status='processing' and replies='[]'::jsonb returning id`;
      if (rows.length !== 1) throw new Error("Private turn lost its claim before completion");
      return;
    }
    const rows = await tx`update platform.inbound set replies=replies || (${{items:replies}}::jsonb->'items'),app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${turn.id} and status='processing' returning id`;
    if (!rows.length) throw new Error("Turn was sealed before reply collection");
  }


  /** Store one inbound message and handle what waits for its sender. Returns this message's outcome, "duplicate", or "retry_later". */
  async receive(ev: InboundMessage, app?: string): Promise<string> {
    const id = `msg:${ev.channel}:${ev.messageId}`;
    const sender = normalizeAddress(ev.from);
    const now = new Date(this.o.clock.now());
    const wrote = await this.o.sql`insert into platform.inbound (id, line, sender, received_at, arrived_at, event, status, sender_hash)
      values (${id}, ${ev.to ? normalizeAddress(ev.to) : null}, ${sender}, ${new Date(ev.receivedAt)}, ${now}, ${{ ev, app: app ?? null }}::jsonb, 'pending', ${this.o.senderKey(sender)})
      on conflict (id) do nothing returning id`;
    if (webhookArrival(wrote.length > 0) === "DuplicateWebhook") return "duplicate";
    await this.handleSender(sender);
    const [r] = await this.o.sql`select status, outcome from platform.inbound where id = ${id}`;
    // spec/webhookInbox.md, "Report the received row's stored result after draining"
    switch (webhookAnswer(r?.status === "done", r?.status === "failed")) {
      case "StoredWebhookAnswer": return r!.outcome as string;
      case "StoredWebhookFailure": return "failed";
      case "WaitForRetry": return "retry_later";
    }
  }

  /** Every sender with waiting rows (the tick): rows a crash or an error left behind. Returns how many rows it handled. */
  async drain(): Promise<number> {
    const senders = await this.o.sql`select sender, min(received_at) as first from platform.inbound where status = 'pending' and sender is not null group by sender order by first`;
    let n = 0;
    for (const r of senders as any[]) n += await this.handleSender(r.sender);
    return n;
  }

  /** Retention: handled rows older than `before` (a provider retries for hours, not weeks). */
  async purge(before: number): Promise<number> {
    const sealed = await this.o.sql`update platform.inbound set status='unresolved',response=null,replies='[]'::jsonb,receipt=null,receipt_hash=null,action_receipts='{}'::jsonb,
      sender=null,event=null,sender_hash=null,member_id=null,app_id=null
      where request_hash is not null and status='done' and handled_at<${new Date(before)} returning id`;
    const removed = await this.o.sql`delete from platform.inbound where request_hash is null and status not in ('pending','processing','unresolved') and arrived_at < ${new Date(before)} returning id`;
    // Signed-turn tombstones keep replays refused for a while, then go: platform.inbound does not grow without bound.
    const tombstones = await this.o.sql`delete from platform.inbound where request_hash is not null and status='unresolved' and arrived_at < ${new Date(before - turnTombstoneKeepMs)} returning id`;
    return sealed.length + removed.length + tombstones.length;
  }

  /**
   * Staff resolve a signed turn that did not finish: it stays unresolved (a replay is still refused) but no
   * longer holds back the sender's later messages. Returns false when the row is not a stuck signed turn.
   */
  async resolve(id: string): Promise<boolean> {
    const rows = await this.o.sql`update platform.inbound set status='unresolved',sender_hash=null,event=null,sender=null
      where id=${id} and request_hash is not null and status in ('processing','unresolved') returning id`;
    return rows.length > 0;
  }

  /** One sender at a time, in this process (a promise chain) and across processes (an advisory lock). */
  private handleSender(sender: string): Promise<number> {
    const prev = this.chains.get(sender) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const conn = await this.o.sql.reserve();
      const key = `inbox-sender:${sender}`;
      try {
        await conn`select pg_advisory_lock(hashtext(${key}))`;
        try { return await this.handleWaiting(sender); } finally { await conn`select pg_advisory_unlock(hashtext(${key}))`; }
      } finally { conn.release(); }
    });
    this.chains.set(sender, run);
    run.finally(() => { if (this.chains.get(sender) === run) this.chains.delete(sender); }).catch(() => {});
    return run;
  }

  private handleWaiting(sender: string): Promise<number> {
    return drainWebhookSender({
      readWindow: async () => {
        const waiting = await this.o.sql<StoredWebhook[]>`select id, event, attempts, received_at from platform.inbound
          where sender = ${sender} and status = 'pending' order by received_at, id limit ${webhookScanLimit}`;
        return waiting.map(row => {
          // The database driver normally returns JSONB as an object. Keep reading serialized rows.
          const event: WebhookEnvelope | null = typeof row.event === "string" ? JSON.parse(row.event) : row.event;
          const text = event?.ev?.text;
          return { ...row, event, compliance: isComplianceText(text), stopCommand: isStopText(text) };
        });
      },
      hasBlockingTurn: async () => {
        const now = this.o.clock.now();
        const blockedSince = new Date(now - unresolvedBlockMs), stale = new Date(now - processingLeaseMs);
        const rows = await this.o.sql`select 1 from platform.inbound where sender_hash = ${this.o.senderKey(sender)}
          and request_hash is not null and ((status = 'processing' and arrived_at > ${stale})
            or (status = 'unresolved' and arrived_at > ${blockedSince})) limit 1`;
        return rows.length > 0;
      },
      handle: async ({ event }) => {
        if (!event?.ev) throw new Error("Pending webhook has no message");
        return this.o.handle(event.ev, event.app ?? undefined);
      },
      complete: (row, outcome, cancelIds) => this.completeWebhook(sender, row, outcome, cancelIds),
      fail: (row, attempts, drop, cause) => this.recordWebhookFailure(row, attempts, drop, cause),
    });
  }

  /** Complete the selected row and erase older ordinary messages in the same statement. */
  private async completeWebhook(sender: string, row: StoredWebhook, outcome: string, cancelIds: string[]): Promise<number> {
    const at = new Date(this.o.clock.now());
    const [counts] = await this.o.sql<{ completed: number; cancelled: number }[]>`with completed as (
        update platform.inbound set status = 'done', outcome = ${outcome}, handled_at = ${at},
          handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null
        where id = ${row.id} and status = 'pending' returning id
      ), cancelled as (
        update platform.inbound set status = 'done', outcome = 'cancelled_by_stop', handled_at = ${at},
          handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null
        where sender = ${sender} and status = 'pending' and received_at <= ${row.received_at}
          and id = any(${this.o.sql.array(cancelIds, "TEXT")}) and exists (select 1 from completed)
        returning id
      )
      select (select count(*)::int from completed) as completed, (select count(*)::int from cancelled) as cancelled`;
    if (counts.completed !== 1) throw new Error("Webhook is no longer pending");
    if (counts.cancelled) this.o.log(`[inbound] ${counts.cancelled} earlier message(s) cancelled by STOP`);
    return counts.cancelled;
  }

  private async recordWebhookFailure(row: StoredWebhook, attempts: number, drop: boolean, cause: unknown): Promise<void> {
    const error = cause instanceof Error ? cause.message : String(cause);
    if (drop) {
      await this.o.sql`update platform.inbound set status = 'failed', attempts = ${attempts}, outcome = 'failed',
        handled_at = ${new Date(this.o.clock.now())}, handled_order = nextval('platform.inbound_handled_seq'),
        event = null, sender = null where id = ${row.id} and status = 'pending'`;
      this.o.log(`[alert] inbound ${row.id} failed ${attempts} times and is dropped: ${error}`);
      return;
    }
    await this.o.sql`update platform.inbound set attempts = ${attempts} where id = ${row.id} and status = 'pending'`;
    if (attempts === webhookAttemptLimit) this.o.log(`[alert] inbound STOP ${row.id} is still pending after ${attempts} failures: ${error}`);
    else this.o.log(`[inbound] ${row.id} failed (attempt ${attempts}), handled again on the next tick: ${error}`);
  }
}
