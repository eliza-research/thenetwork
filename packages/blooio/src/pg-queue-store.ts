// The outbound queue's state in Postgres (migration 0014): records, per-line send counters, per-contact
// unanswered and re-engagement state, line safety and the last inbound per address. One write batch per
// flush, in one transaction. Text and address are stored only while a record waits or is parked for leak
// review (keepsContent); counters key on the queue's address key (a keyed hash in the service).
// Alerts go to network.events as type 'queue_alert' rows with { kind, line, address_hash, detail }.
import type { SQL } from "bun";
import {
  keepsContent, type OutboundRecord, type PruneBefore, type QueueAlert, type QueueSnapshot, type QueueStore, type QueueWrite, type StoredRecord,
} from "./outbound-queue.ts";

export type QueueMode = "live" | "dry_run";

const ms = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : new Date(v as string).getTime());
const date = (v: number | undefined) => (v === undefined ? null : new Date(v));
const obj = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

export class PgQueueStore implements QueueStore {
  readonly mode: QueueMode;
  /** The app a line-level alert is filed under in network.events (its rows are per app). */
  private readonly alertApp: string;

  private readonly conn: SQL | (() => SQL);

  /** `sql` may be a function, for a connection that exists only after the store is built (the service's pool). */
  constructor(sql: SQL | (() => SQL), o: { mode?: QueueMode; alertApp?: string } = {}) {
    this.conn = sql;
    this.mode = o.mode ?? "live";
    this.alertApp = o.alertApp ?? "ntwrk";
  }

  // A Bun SQL instance is callable too: tell them apart by its begin().
  private get sql(): SQL { return "begin" in this.conn ? (this.conn as SQL) : (this.conn as () => SQL)(); }

  async load(): Promise<QueueSnapshot> {
    const m = this.mode;
    const [records, sends, contacts, lines, inbound] = await Promise.all([
      this.sql`select * from network.outbound_queue where mode = ${m} order by created_at, idempotency_key`,
      this.sql`select line, address_key, at, new_chat from network.outbound_sends where mode = ${m} and at > now() - interval '2 days' order by at, id`,
      this.sql`select * from network.outbound_contacts where mode = ${m}`,
      this.sql`select line, action from network.line_safety where mode = ${m}`,
      this.sql`select address_key, at from network.outbound_inbound where mode = ${m}`,
    ]);
    return {
      records: (records as any[]).map(r => {
        const rest = obj<Partial<OutboundRecord>>(r.record);
        const record: OutboundRecord = {
          ...(rest as OutboundRecord),
          idempotencyKey: r.idempotency_key, id: r.id, to: r.address ?? "", text: r.text ?? "", kind: r.kind, channel: r.channel, status: r.status,
          attempts: r.attempts, nextAttemptAt: ms(r.next_attempt_at)!, createdAt: ms(r.created_at)!, history: rest.history ?? [],
          ...(r.line && r.line !== `${r.channel}:default` ? { from: r.line } : {}),
          ...(r.app_id ? { app: r.app_id } : {}),
          ...(r.provider_message_id ? { providerMessageId: r.provider_message_id } : {}),
          ...(r.last_error ? { lastError: obj(r.last_error) } : {}),
          ...(r.sent_at ? { sentAt: ms(r.sent_at) } : {}),
          ...(r.delivered_at ? { deliveredAt: ms(r.delivered_at) } : {}),
          ...(r.read_at ? { readAt: ms(r.read_at) } : {}),
        };
        return { record, fingerprint: r.fingerprint } satisfies StoredRecord;
      }),
      sends: (sends as any[]).map(s => ({ line: s.line, addressKey: s.address_key, at: ms(s.at)!, newChat: s.new_chat })),
      contacts: (contacts as any[]).map(c => ({
        key: c.contact_key, known: c.known,
        state: { unanswered: c.unanswered, reengagementUsed: c.reengagement_used, ...(c.last_inbound_at ? { lastInboundAt: ms(c.last_inbound_at) } : {}), ...(c.last_outbound_at ? { lastOutboundAt: ms(c.last_outbound_at) } : {}) },
      })),
      lineSafety: (lines as any[]).map(l => ({ line: l.line, action: l.action })),
      inbound: (inbound as any[]).map(i => ({ addressKey: i.address_key, at: ms(i.at)! })),
    };
  }

  async write(b: QueueWrite): Promise<void> {
    const m = this.mode;
    await this.sql.begin(async tx => {
      for (const { record: r, fingerprint, addressKey } of b.records) {
        const keep = keepsContent(r.status);
        // The columns hold what is queried; `record` holds the rest (zone, city, history, leak reasons), never the text or the address.
        const { text: _t, to: _to, mediaUrls, ...rest } = r;
        const record = { ...rest, mediaUrls: keep ? mediaUrls : undefined };
        const row = {
          mode: m, idempotency_key: r.idempotencyKey, id: r.id, line: r.from ?? `${r.channel}:default`, address: keep ? r.to : null,
          address_key: addressKey ?? "", app_id: r.app ?? null, channel: r.channel, kind: r.kind, status: r.status,
          text: keep ? r.text : null, fingerprint, provider_message_id: r.providerMessageId ?? null, attempts: r.attempts,
          next_attempt_at: new Date(r.nextAttemptAt), last_error: r.lastError ?? null, sent_at: date(r.sentAt), delivered_at: date(r.deliveredAt), read_at: date(r.readAt),
          created_at: new Date(r.createdAt), updated_at: new Date(), record,
        };
        await tx`insert into network.outbound_queue ${tx(row)}
          on conflict (mode, idempotency_key) do update set line = excluded.line, address = excluded.address, address_key = case when excluded.address_key = '' then network.outbound_queue.address_key else excluded.address_key end,
            app_id = excluded.app_id, status = excluded.status, text = excluded.text, provider_message_id = excluded.provider_message_id, attempts = excluded.attempts,
            next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error, sent_at = excluded.sent_at, delivered_at = excluded.delivered_at,
            read_at = excluded.read_at, updated_at = excluded.updated_at, record = excluded.record`;
      }
      for (const s of b.sends) await tx`insert into network.outbound_sends (mode, line, address_key, at, new_chat) values (${m}, ${s.line}, ${s.addressKey}, ${new Date(s.at)}, ${s.newChat})`;
      for (const c of b.contacts) {
        await tx`insert into network.outbound_contacts (mode, contact_key, unanswered, last_inbound_at, last_outbound_at, reengagement_used, known, updated_at)
          values (${m}, ${c.key}, ${c.state.unanswered}, ${date(c.state.lastInboundAt)}, ${date(c.state.lastOutboundAt)}, ${c.state.reengagementUsed}, ${c.known}, now())
          on conflict (mode, contact_key) do update set unanswered = excluded.unanswered, last_inbound_at = excluded.last_inbound_at, last_outbound_at = excluded.last_outbound_at,
            reengagement_used = excluded.reengagement_used, known = excluded.known, updated_at = now()`;
      }
      for (const l of b.lineSafety) {
        if (l.action) await tx`insert into network.line_safety (mode, line, action, updated_at) values (${m}, ${l.line}, ${l.action}, now())
          on conflict (mode, line) do update set action = excluded.action, updated_at = now()`;
        else await tx`delete from network.line_safety where mode = ${m} and line = ${l.line}`;
      }
      for (const i of b.inbound) {
        await tx`insert into network.outbound_inbound (mode, address_key, at) values (${m}, ${i.addressKey}, ${new Date(i.at)})
          on conflict (mode, address_key) do update set at = greatest(network.outbound_inbound.at, excluded.at)`;
      }
    });
  }

  async prune(p: PruneBefore): Promise<number> {
    const m = this.mode;
    return this.sql.begin(async tx => {
      const r = await tx`delete from network.outbound_queue where mode = ${m} and created_at < ${new Date(p.records)}
        and status <> all(${"{pending,sending,deferred_quiet_hours,held_awaiting_reply,retry_scheduled,parked_leak_review}"}::text[]) returning 1`;
      const s = await tx`delete from network.outbound_sends where mode = ${m} and at < ${new Date(p.sends)} returning 1`;
      const i = await tx`delete from network.outbound_inbound where mode = ${m} and at < ${new Date(p.inbound)} returning 1`;
      const c = await tx`delete from network.outbound_contacts where mode = ${m}
        and greatest(coalesce(last_inbound_at, 'epoch'), coalesce(last_outbound_at, 'epoch')) < ${new Date(p.contacts)} returning 1`;
      return r.length + s.length + i.length + c.length;
    }) as Promise<number>;
  }

  /** A 'queue_alert' row in network.events (app-scoped table: the record's app, else the line's alert app). */
  async alert(a: QueueAlert): Promise<void> {
    const app = a.app ?? this.alertApp;
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${app}, true)`;
      await tx`insert into network.events (app_id, at, actor_type, type, payload)
        values (${app}, ${new Date(a.at)}, 'agent', 'queue_alert', ${{ kind: a.kind, line: a.line, address_hash: a.addressHash, detail: { ...a.detail, ...(this.mode === "dry_run" ? { dry_run: true } : {}) } }}::jsonb)`;
    });
  }
}
