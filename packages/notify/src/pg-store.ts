// NotifyStore on Postgres (db/schema.sql), with Bun's SQL client like packages/platform.
// Item ids are bigserial numbers stored as text ids "inb_<n>" in the API.
import { SQL } from "bun";
import type { DeliveryRecord, NotifyStore } from "./store.ts";
import type { SurfaceSignal } from "./surface.ts";
import type { TaskToken } from "./tokens.ts";
import type { InboxItem, InboxItemInput, Surface } from "./types.ts";
import { dedupeKey } from "./store.ts";

type Row = Record<string, any>;
const ms = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : new Date(v as string | Date).getTime());
const ts = (v: number | undefined) => (v === undefined ? null : new Date(v));
const toId = (n: unknown) => `inb_${n}`;
const fromId = (id: string) => {
  const m = /^inb_(\d+)$/.exec(id);
  return m ? m[1]! : null;
};
const numIds = (ids: string[]) => ids.map(fromId).filter((x): x is string => x !== null);
const bigintArray = (v: unknown): string[] => (Array.isArray(v) ? v : String(v).replace(/[{}]/g, "").split(",").filter(Boolean)).map(String);

const item = (r: Row): InboxItem => {
  const i: InboxItem = {
    id: toId(r.id), dedupeKey: r.dedupe_key, personId: r.person_id, app: r.app_id, eventType: r.event_type, subjectId: r.subject_id,
    urgency: r.urgency, summary: r.summary, createdAt: ms(r.created_at)!,
  };
  if (r.expires_at) i.expiresAt = ms(r.expires_at);
  if (r.seen_at) { i.seenAt = ms(r.seen_at); i.seenOn = r.seen_on; }
  if (r.notified_at) { i.notifiedAt = ms(r.notified_at); i.deliveryId = r.delivery_id; }
  return i;
};

const delivery = (r: Row): DeliveryRecord => {
  const d: DeliveryRecord = {
    deliveryId: r.delivery_id, personId: r.person_id, itemIds: bigintArray(r.item_ids).map(toId), target: r.target,
    countsTowardCap: r.counts_toward_cap, sentAt: ms(r.sent_at)!,
  };
  if (r.outcome) { d.outcome = r.outcome; d.outcomeAt = ms(r.outcome_at); }
  return d;
};

export class PgNotifyStore implements NotifyStore {
  readonly sql: SQL;
  private readonly owned: boolean;
  constructor(db: string | SQL) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }
  async close() { if (this.owned) await this.sql.close(); }

  /** Apply db/schema.sql (idempotent). */
  async migrate() {
    await this.sql.unsafe(await Bun.file(new URL("../db/schema.sql", import.meta.url)).text());
  }

  async addItem(input: InboxItemInput, now: number) {
    const key = dedupeKey(input);
    const inserted = await this.sql`
      insert into notify.inbox_items (dedupe_key, person_id, app_id, event_type, subject_id, urgency, summary, created_at, expires_at)
      values (${key}, ${input.personId}, ${input.app}, ${input.eventType}, ${input.subjectId}, ${input.urgency}, ${input.summary}, ${new Date(now)}, ${ts(input.expiresAt)})
      on conflict (dedupe_key) do nothing
      returning *`;
    if (inserted.length) return { item: item(inserted[0]), created: true };
    const [existing] = await this.sql`select * from notify.inbox_items where dedupe_key = ${key}`;
    return { item: item(existing), created: false };
  }

  async getItems(ids: string[]) {
    const n = numIds(ids);
    if (!n.length) return [];
    const rows = await this.sql`select * from notify.inbox_items where id = any(${this.sql.array(n, "int8")})`;
    const byId = new Map(rows.map((r: Row) => [toId(r.id), item(r)]));
    return ids.map(id => byId.get(id)).filter((i): i is InboxItem => !!i);
  }

  async unseen(personId: string, now: number) {
    const rows = await this.sql`
      select * from notify.inbox_items
      where person_id = ${personId} and seen_at is null and (expires_at is null or expires_at > ${new Date(now)})
      order by created_at, id`;
    return rows.map(item);
  }

  async peopleWithPending(now: number) {
    const rows = await this.sql`
      select distinct person_id from notify.inbox_items
      where seen_at is null and notified_at is null and (expires_at is null or expires_at > ${new Date(now)})
      order by person_id`;
    return rows.map((r: Row) => r.person_id as string);
  }

  async markSeen(personId: string, surface: Surface, now: number, ids?: string[]) {
    const rows = ids
      ? await this.sql`
          update notify.inbox_items set seen_at = ${new Date(now)}, seen_on = ${surface}
          where person_id = ${personId} and seen_at is null and id = any(${this.sql.array(numIds(ids), "int8")})
          returning id`
      : await this.sql`
          update notify.inbox_items set seen_at = ${new Date(now)}, seen_on = ${surface}
          where person_id = ${personId} and seen_at is null
          returning id`;
    return rows.map((r: Row) => toId(r.id));
  }

  async recordDelivery(d: DeliveryRecord) {
    return this.sql.begin(async tx => {
      const ins = await tx`
        insert into notify.deliveries (delivery_id, person_id, item_ids, target, counts_toward_cap, sent_at)
        values (${d.deliveryId}, ${d.personId}, ${tx.array(numIds(d.itemIds), "int8")}, ${d.target}, ${d.countsTowardCap}, ${new Date(d.sentAt)})
        on conflict (delivery_id) do nothing
        returning delivery_id`;
      if (!ins.length) return false;
      await tx`
        update notify.inbox_items set notified_at = ${new Date(d.sentAt)}, delivery_id = ${d.deliveryId}
        where id = any(${tx.array(numIds(d.itemIds), "int8")}) and notified_at is null`;
      return true;
    });
  }

  async getDelivery(id: string) {
    const [r] = await this.sql`select * from notify.deliveries where delivery_id = ${id}`;
    return r ? delivery(r) : undefined;
  }

  async capSendsSince(personId: string, since: number) {
    const rows = await this.sql`
      select sent_at from notify.deliveries
      where person_id = ${personId} and counts_toward_cap and sent_at >= ${new Date(since)}
      order by sent_at`;
    return rows.map((r: Row) => ms(r.sent_at)!);
  }

  async actOnDelivery(id: string, _on: Surface, at: number) {
    const rows = await this.sql`
      update notify.deliveries set outcome = 'acted', outcome_at = ${new Date(at)}
      where delivery_id = ${id} and outcome is null returning delivery_id`;
    return rows.length > 0;
  }

  async pendingDeliveries(personId: string) {
    const rows = await this.sql`select * from notify.deliveries where person_id = ${personId} and outcome is null order by sent_at`;
    return rows.map(delivery);
  }

  async expireDeliveries(before: number, at: number) {
    const rows = await this.sql`
      update notify.deliveries set outcome = 'ignored', outcome_at = ${new Date(at)}
      where outcome is null and sent_at < ${new Date(before)} returning *`;
    return rows.map(delivery);
  }

  async insertToken(t: TaskToken) {
    const rows = await this.sql`
      insert into notify.task_tokens (token, person_id, item_ids, issued_at, expires_at)
      values (${t.token}, ${t.personId}, ${this.sql.array(numIds(t.itemIds), "int8")}, ${new Date(t.issuedAt)}, ${new Date(t.expiresAt)})
      on conflict (token) do nothing returning token`;
    return rows.length > 0;
  }

  async getToken(token: string) {
    const [r] = await this.sql`select * from notify.task_tokens where token = ${token}`;
    if (!r) return undefined;
    const t: TaskToken = { token: r.token, personId: r.person_id, itemIds: bigintArray(r.item_ids).map(toId), issuedAt: ms(r.issued_at)!, expiresAt: ms(r.expires_at)! };
    if (r.redeemed_at) { t.redeemedAt = ms(r.redeemed_at); t.redeemedOn = r.redeemed_on; }
    return t;
  }

  async markTokenRedeemed(token: string, surface: Surface, at: number) {
    await this.sql`update notify.task_tokens set redeemed_at = ${new Date(at)}, redeemed_on = ${surface} where token = ${token} and redeemed_at is null`;
  }

  async signals(personId: string): Promise<SurfaceSignal[]> {
    const rows = await this.sql`select * from notify.surface_signals where person_id = ${personId} order by surface`;
    return rows.map((r: Row) => {
      const s: SurfaceSignal = { surface: r.surface, active: r.active, acted: r.acted, ignored: r.ignored, ignoredStreak: r.ignored_streak };
      if (r.last_used_at) s.lastUsedAt = ms(r.last_used_at);
      return s;
    });
  }

  async setActive(personId: string, surface: Surface, active: boolean) {
    await this.sql`
      insert into notify.surface_signals (person_id, surface, active) values (${personId}, ${surface}, ${active})
      on conflict (person_id, surface) do update set active = excluded.active`;
  }

  async touch(personId: string, surface: Surface, at: number) {
    await this.sql`
      insert into notify.surface_signals (person_id, surface, last_used_at) values (${personId}, ${surface}, ${new Date(at)})
      on conflict (person_id, surface) do update set last_used_at = excluded.last_used_at`;
  }

  async recordOutcome(personId: string, surface: Surface, outcome: "acted" | "ignored", at: number) {
    if (outcome === "acted")
      await this.sql`
        insert into notify.surface_signals (person_id, surface, acted, last_used_at) values (${personId}, ${surface}, 1, ${new Date(at)})
        on conflict (person_id, surface) do update
          set acted = notify.surface_signals.acted + 1, ignored_streak = 0, last_used_at = excluded.last_used_at`;
    else
      await this.sql`
        insert into notify.surface_signals (person_id, surface, ignored, ignored_streak) values (${personId}, ${surface}, 1, 1)
        on conflict (person_id, surface) do update
          set ignored = notify.surface_signals.ignored + 1, ignored_streak = notify.surface_signals.ignored_streak + 1`;
  }
}
