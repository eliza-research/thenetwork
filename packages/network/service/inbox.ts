// The inbound inbox for the shared Blooio line (platform.inbound, migration 0015).
//  - Dedupe: the row id is the provider's message id ("msg:<channel>:<id>"). A provider retry, a replay or
//    the same message through a second webhook subscription finds the row and is a duplicate.
//  - Durable: the webhook answers 200 once the row is stored. A handler error leaves the row pending and
//    the next tick handles it again (audit network-service-7: no 500 that makes the provider send a
//    duplicate). After 5 failed attempts the row is failed and an alert line is logged.
//  - Ordering per sender: the rows of one sender are handled one at a time (an advisory lock per sender,
//    across processes), oldest received first. A failed attempt stops that sender's later rows until it
//    is handled, so the Network never reads an answer before the question it answers.
//  - Privacy: the row keeps the sender and the event only while it waits. A handled row keeps the id,
//    the times and the outcome.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NetworkAppId, TurnRequest, TurnResponse } from "../../core/src/svc/contract.ts";
import type { SQL } from "bun";
import type { Clock } from "@thenetwork/core";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import type { InboundMessage } from "../../blooio/src/types.ts";

const MAX_ATTEMPTS = 5;

export interface InboxOptions {
  sql: SQL;
  clock: Clock;
  /** Handle one message (NetworkService.inbound). `app`: the per-app webhook path, if any. */
  handle: (ev: InboundMessage, app?: string) => Promise<string>;
  log: (line: string) => void;
  senderKey: (sender: string) => string;
}

export interface InboundTurn {
  id: string;
  from: string;
  app?: NetworkAppId;
  memberId?: string;
  consent?: {state: "opted_in" | "opted_out"; scope: "all" | "app"; app: NetworkAppId | null; at: number};
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
    const wrote = await this.o.sql.begin(async tx => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext(${`inbox-sender:${normalizeAddress(input.from)}`})) as acquired`;
      if (!lock.acquired) return [];
      return tx`insert into platform.inbound(id,line,sender,received_at,arrived_at,event,status,request_hash,sender_hash)
      select ${id},null,null,${new Date(input.receivedAt)},${new Date(this.o.clock.now())},null,'processing',${requestHash},${senderHash}
      where not exists(select 1 from platform.inbound where sender_hash=${senderHash} and status in ('pending','processing','unresolved'))
      on conflict do nothing returning id`;
    });
    if (!wrote.length) {
      const [prior] = await this.o.sql`select request_hash,status,response from platform.inbound where id=${id}`;
      if (!prior) return {status:409,body:{error:"turn_busy",retryable:true}};
      if (prior.request_hash !== requestHash) return {status:409,body:{error:"turn_conflict",retryable:false}};
      return prior.status === "done" && prior.response ? {status:200,body:prior.response}
        : {status:409,body:{error:"turn_unresolved",retryable:false}};
    }
    try {
      const turn: InboundTurn = {id,from:input.from};
      const body = await this.turns.run(turn, () => run(turn));
      const rows = await this.o.sql`update platform.inbound set status='done',response=${body}::jsonb,handled_at=${new Date(this.o.clock.now())},
        handled_order=nextval('platform.inbound_handled_seq'),event=null,sender=null,app_id=${turn.app ?? null},member_id=${turn.memberId ?? null} where id=${id} and status='processing' returning id`;
      if (!rows.length) throw new Error("Turn ownership changed before completion");
      return {status:200,body};
    } catch {
      await this.o.sql`update platform.inbound set status='unresolved',event=null,sender=null where id=${id} and status='processing'`;
      return {status:409,body:{error:"turn_unresolved",retryable:false}};
    }
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
    const sealed = await this.o.sql`update platform.inbound set status='unresolved',response=null,replies='[]'::jsonb,receipt=null,receipt_hash=null,
      sender=null,event=null,sender_hash=null,member_id=null,app_id=null
      where request_hash is not null and status='done' and handled_at<${new Date(before)} returning id`;
    const removed = await this.o.sql`delete from platform.inbound where request_hash is null and status not in ('pending','processing','unresolved') and arrived_at < ${new Date(before)} returning id`;
    return sealed.length + removed.length;
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

  private async handleWaiting(sender: string): Promise<number> {
    let n = 0;
    for (;;) {
      if ((await this.o.sql`select 1 from platform.inbound where sender_hash=${this.o.senderKey(sender)} and status in ('processing','unresolved') limit 1`).length) return n;
      const [r] = await this.o.sql`select id, event, attempts from platform.inbound where sender = ${sender} and status = 'pending' order by received_at, id limit 1`;
      if (!r) return n;
      const { ev, app } = (typeof r.event === "string" ? JSON.parse(r.event) : r.event) as { ev: InboundMessage; app: string | null };
      try {
        const outcome = await this.o.handle(ev, app ?? undefined);
        await this.o.sql`update platform.inbound set status = 'done', outcome = ${outcome}, handled_at = ${new Date(this.o.clock.now())},
          handled_order = nextval('platform.inbound_handled_seq'), event = null, sender = null where id = ${r.id}`;
        n++;
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
