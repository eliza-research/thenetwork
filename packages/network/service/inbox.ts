// The inbound inbox for the shared Blooio line (platform.inbound, migration 0015).
//  - Dedupe: the row id is the provider's message id ("msg:<channel>:<id>"). A provider retry, a replay or
//    the same message through a second webhook subscription finds the row and is a duplicate.
//  - Durable: the webhook answers 200 once the row is stored. A handler error leaves the row pending and
//    the next tick handles it again (audit network-service-7: no 500 that makes the provider send a
//    duplicate). After 5 failed attempts the row is failed and an alert line is logged.
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
import type { NetworkAppId, TurnRequest, TurnResponse } from "../../core/src/svc/contract.ts";
import type { SQL } from "bun";
import type { Clock } from "@thenetwork/core";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import type { InboundMessage } from "../../blooio/src/types.ts";
import { detectKeyword, leaveTarget } from "../../platform/src/consent.ts";

const MAX_ATTEMPTS = 5;
/** How many waiting rows of one sender are read to find a compliance keyword among them. */
const KEYWORD_SCAN = 50;

/** STOP, STOP ALL, START, HELP or "leave <app>": consent and its confirmation are never held back. */
export function isComplianceText(text: unknown): boolean {
  return typeof text === "string" && (detectKeyword(text) !== undefined || leaveTarget(text) !== undefined);
}
const isStopText = (text: unknown) => typeof text === "string" && ((k => k === "stop" || k === "stop_all")(detectKeyword(text)));
/** A signed turn still "processing" this long after its last lease renewal lost its worker (a crash): it reads as unresolved. */
const PROCESSING_LEASE_MS = 2 * 60_000;
/** A running signed turn renews its lease this often (well inside PROCESSING_LEASE_MS). */
const LEASE_RENEW_MS = 30_000;
/** An unresolved signed turn holds the sender's later messages back only this long, so a sender is never stuck. */
const UNRESOLVED_BLOCK_MS = 10 * 60_000;
/** Turn tombstones (scrubbed, unresolved) are deleted after this much longer than the purge window. */
const TOMBSTONE_KEEP_MS = 30 * 24 * 60 * 60_000;

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
  /** Undo work committed outside the turn's own transactions (the one-time notice row) when the turn ends without an answer. */
  onFail?: Array<() => Promise<unknown>>;
}
export interface CollectedReply {id: string; body: string; kind: "reply" | "compliance"}

export class Inbox {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly turns = new AsyncLocalStorage<InboundTurn>();
  constructor(private readonly o: InboxOptions) {}
  currentTurn = () => this.turns.getStore();

  /** A committed claim precedes effects; the partial index admits one signed turn per sender. */
  async signed(input: TurnRequest, requestHash: string, run: (turn: InboundTurn) => Promise<TurnResponse>): Promise<{status: number; body: unknown}> {
    const id = `msg:${input.channel}:${input.messageId}`, senderHash = this.o.senderKey(input.from);
    const now = this.o.clock.now();
    // STOP, START and HELP are never held back by an earlier turn that did not finish (consent always gets through).
    const keyword = isComplianceText(input.text);
    const wrote = await this.o.sql.begin(async tx => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext(${`inbox-sender:${normalizeAddress(input.from)}`})) as acquired`;
      if (!lock.acquired) return [];
      // A turn whose worker stopped (no completion within the lease) is unresolved, not processing forever.
      await tx`update platform.inbound set status='unresolved',event=null,sender=null
        where sender_hash=${senderHash} and status='processing' and request_hash is not null and arrived_at<${new Date(now - PROCESSING_LEASE_MS)}`;
      return tx`insert into platform.inbound(id,line,sender,received_at,arrived_at,event,status,request_hash,sender_hash)
      select ${id},null,null,${new Date(input.receivedAt)},${new Date(now)},null,'processing',${requestHash},${senderHash}
      where not exists(select 1 from platform.inbound where sender_hash=${senderHash} and (status='processing'
        or (not ${keyword} and (status='pending' or (status='unresolved' and arrived_at>${new Date(now - UNRESOLVED_BLOCK_MS)})))))
      on conflict do nothing returning id`;
    });
    if (!wrote.length) {
      const [prior] = await this.o.sql`select request_hash,status,response from platform.inbound where id=${id}`;
      if (!prior) return {status:409,body:{error:"turn_busy",retryable:true}};
      if (prior.request_hash !== requestHash) return {status:409,body:{error:"turn_conflict",retryable:false}};
      if (prior.status === "done" && prior.response) return {status:200,body:prior.response};
      // The same turn is still running (a gateway timeout and its retry): the caller may try again; the worker's answer is kept for that replay.
      if (prior.status === "processing") return {status:409,body:{error:"turn_busy",retryable:true}};
      return {status:409,body:{error:"turn_unresolved",retryable:false}};
    }
    const turn: InboundTurn = {id,from:input.from};
    // Renew the lease while the turn runs, so a slow turn (an LLM read, lock waits) is never swept as abandoned after its effects committed.
    const renew = setInterval(() => {
      this.o.sql`update platform.inbound set arrived_at=${new Date(this.o.clock.now())} where id=${id} and status='processing'`.catch(() => {});
    }, this.o.leaseRenewMs ?? LEASE_RENEW_MS);
    (renew as {unref?: () => void}).unref?.();
    try {
      const body = await this.turns.run(turn, () => run(turn));
      const rows = await this.o.sql`update platform.inbound set status='done',response=${body}::jsonb,handled_at=${new Date(this.o.clock.now())},
        handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${id} and status='processing' returning id`;
      if (!rows.length) { this.o.log(`[alert] signed turn ${id} lost its claim before completion (swept or resolved by staff)`); throw new Error("Turn ownership changed before completion"); }
      return {status:200,body};
    } catch (e) {
      if (keyword) {
        const rescued = await this.rescueCompliance(id, turn).catch(() => undefined);
        if (rescued) { this.o.log(`[inbound] compliance turn ${id} failed after its consent change: ${(e as Error).message}`); return rescued; }
      }
      await this.o.sql`update platform.inbound set status='unresolved',event=null,sender=null where id=${id} and status='processing'`;
      await this.undo(turn);
      return {status:409,body:{error:"turn_unresolved",retryable:false}};
    } finally {
      clearInterval(renew);
    }
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
  private async rescueCompliance(id: string, turn: InboundTurn): Promise<{status: number; body: unknown} | undefined> {
    const [row] = await this.o.sql`select status,replies from platform.inbound where id=${id}`;
    if (!row || row.status !== "processing") return undefined;
    const collected = ((typeof row.replies === "string" ? JSON.parse(row.replies) : row.replies) ?? []) as CollectedReply[];
    if (!turn.consent && !collected.length) {
      const released = await this.o.sql`delete from platform.inbound where id=${id} and status='processing' returning id`;
      if (!released.length) return undefined;
      await this.undo(turn);
      return {status:409,body:{error:"turn_failed",retryable:true}};
    }
    const replies = [...collected];
    if (turn.confirmation && !replies.some(r => r.kind === "compliance")) replies.push({...turn.confirmation, kind: "compliance"});
    const body: TurnResponse = {outcome: "handled", replies: replies.map(r => r.body), replyIds: replies.map(r => r.id), delivery: "collected",
      replyKind: replies.length && replies.every(r => r.kind === "compliance") ? "compliance" : "reply", accountEligible: false,
      app: turn.app ?? null, memberId: turn.memberId ?? null, reason: "compliance_partial", ...(turn.consent ? {consent: turn.consent} : {})};
    const rows = await this.o.sql`update platform.inbound set status='done',response=${body}::jsonb,replies=(${{items: replies}}::jsonb->'items'),
      handled_at=${new Date(this.o.clock.now())},handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,
      app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${id} and status='processing' returning id`;
    return rows.length ? {status: 200, body} : undefined;
  }

  /** Persist only causal replies in the same transaction as their Network effects. */
  async collect(tx: SQL, replies: CollectedReply[]): Promise<void> {
    const turn = this.currentTurn();
    if (!turn || !replies.length) return;
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
    if (!wrote.length) return "duplicate";
    await this.handleSender(sender);
    const [r] = await this.o.sql`select status, outcome from platform.inbound where id = ${id}`;
    return r?.status === "done" ? (r.outcome as string) : r?.status === "failed" ? "failed" : "retry_later";
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
    const tombstones = await this.o.sql`delete from platform.inbound where request_hash is not null and status='unresolved' and arrived_at < ${new Date(before - TOMBSTONE_KEEP_MS)} returning id`;
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

  /** After a STOP: the sender's ordinary rows received before it end unhandled (their text is dropped). */
  private async cancelBefore(sender: string, stopAt: unknown, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const rows = await this.o.sql`update platform.inbound set status = 'done', outcome = 'cancelled_by_stop', handled_at = ${new Date(this.o.clock.now())},
      handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null
      where sender = ${sender} and status = 'pending' and received_at <= ${stopAt as Date} and id = any(${this.o.sql.array(ids, "TEXT")}) returning id`;
    if (rows.length) this.o.log(`[inbound] ${rows.length} earlier message(s) cancelled by STOP`);
    return rows.length;
  }

  private async handleWaiting(sender: string): Promise<number> {
    let n = 0;
    for (;;) {
      const waiting = await this.o.sql`select id, event, attempts, received_at from platform.inbound where sender = ${sender} and status = 'pending'
        order by received_at, id limit ${KEYWORD_SCAN}`;
      if (!waiting.length) return n;
      const parsed = (waiting as any[]).map(w => ({ ...w, ...((typeof w.event === "string" ? JSON.parse(w.event) : w.event) as { ev: InboundMessage; app: string | null }) }));
      // A compliance keyword goes ahead of an earlier row (one that keeps failing must not hold back a STOP).
      const compliance = parsed.find(w => isComplianceText(w.ev?.text));
      // A signed turn of this sender that is running (or ended unresolved a short while ago) holds back
      // their ordinary rows only: STOP, STOP ALL, leave, START and HELP are handled at once, as signed() does.
      if (!compliance) {
        const blockedSince = new Date(this.o.clock.now() - UNRESOLVED_BLOCK_MS), stale = new Date(this.o.clock.now() - PROCESSING_LEASE_MS);
        if ((await this.o.sql`select 1 from platform.inbound where sender_hash=${this.o.senderKey(sender)} and request_hash is not null
          and ((status='processing' and arrived_at>${stale}) or (status='unresolved' and arrived_at>${blockedSince})) limit 1`).length) return n;
      }
      const r = compliance ?? parsed[0]!;
      const { ev, app } = r;
      try {
        const outcome = await this.o.handle(ev, app ?? undefined);
        await this.o.sql`update platform.inbound set status = 'done', outcome = ${outcome}, handled_at = ${new Date(this.o.clock.now())},
          handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null where id = ${r.id}`;
        n++;
        if (isStopText(ev.text)) n += await this.cancelBefore(sender, r.received_at, parsed.filter(w => w.id !== r.id && !isComplianceText(w.ev?.text)).map(w => w.id as string));
      } catch (e) {
        const attempts = (r.attempts as number) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await this.o.sql`update platform.inbound set status = 'failed', attempts = ${attempts}, outcome = 'failed', handled_at = ${new Date(this.o.clock.now())},
            handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null where id = ${r.id}`;
          this.o.log(`[alert] inbound ${r.id} failed ${attempts} times and is dropped: ${(e as Error).message}`);
          continue;
        }
        await this.o.sql`update platform.inbound set attempts = ${attempts} where id = ${r.id}`;
        this.o.log(`[inbound] ${r.id} failed (attempt ${attempts}), handled again on the next tick: ${(e as Error).message}`);
        return n;
      }
    }
  }
}
