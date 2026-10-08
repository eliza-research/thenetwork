// Storage for the single inbox, deliveries, task tokens and surface signals. One interface so the
// Postgres version (pg-store.ts, schema in db/schema.sql) keeps the same rules as this in-memory
// one, and the same tests run against both.

import type { SurfaceSignal } from "./surface.ts";
import type { TaskToken } from "./tokens.ts";
import type { InboxItem, InboxItemInput, Surface } from "./types.ts";

export const dedupeKey = (i: Pick<InboxItemInput, "personId" | "app" | "eventType" | "subjectId">) =>
  [i.personId, i.app, i.eventType, i.subjectId].join("|");

export interface DeliveryRecord {
  deliveryId: string;
  personId: string;
  itemIds: string[];
  /** The surface the message pointed at: the channel for thread messages, else the assistant. */
  target: Surface;
  countsTowardCap: boolean;
  sentAt: number;
  /** Set when the member acts on it (token redeemed, thread reply) or the outcome window passes. */
  outcome?: "acted" | "ignored";
  outcomeAt?: number;
}

export interface NotifyStore {
  /** Insert unless the dedupe key exists; then return the existing item. */
  addItem(input: InboxItemInput, now: number): Promise<{ item: InboxItem; created: boolean }>;
  getItems(ids: string[]): Promise<InboxItem[]>;
  /** Unseen, unexpired items for a person, oldest first. */
  unseen(personId: string, now: number): Promise<InboxItem[]>;
  /** People with an unseen, unexpired, not yet notified item. */
  peopleWithPending(now: number): Promise<string[]>;
  /** Mark unseen items seen. `ids` omitted = all of the person's. Returns the ids changed. */
  markSeen(personId: string, surface: Surface, now: number, ids?: string[]): Promise<string[]>;

  /** Record a delivery and mark its items notified, atomically. False if the delivery id exists. */
  recordDelivery(d: DeliveryRecord): Promise<boolean>;
  getDelivery(deliveryId: string): Promise<DeliveryRecord | undefined>;
  /** Send times of cap-counting deliveries to a person at or after `since`. */
  capSendsSince(personId: string, since: number): Promise<number[]>;
  /** Close a pending delivery as acted (on `on`), if it is still pending. Returns its target. */
  actOnDelivery(deliveryId: string, on: Surface, at: number): Promise<boolean>;
  /** Pending deliveries of a person (no outcome yet). */
  pendingDeliveries(personId: string): Promise<DeliveryRecord[]>;
  /** Close deliveries sent before `before` with no outcome as ignored. Returns how many. */
  expireDeliveries(before: number, at: number): Promise<DeliveryRecord[]>;

  /** False when the token already exists (the caller draws another). */
  insertToken(t: TaskToken): Promise<boolean>;
  getToken(token: string): Promise<TaskToken | undefined>;
  /** Record the first redemption only. */
  markTokenRedeemed(token: string, surface: Surface, at: number): Promise<void>;

  signals(personId: string): Promise<SurfaceSignal[]>;
  setActive(personId: string, surface: Surface, active: boolean): Promise<void>;
  touch(personId: string, surface: Surface, at: number): Promise<void>;
  /** acted: +1 acted, streak reset, lastUsed = at. ignored: +1 ignored, +1 streak. */
  recordOutcome(personId: string, surface: Surface, outcome: "acted" | "ignored", at: number): Promise<void>;
}

const blankSignal = (surface: Surface): SurfaceSignal => ({ surface, active: false, acted: 0, ignored: 0, ignoredStreak: 0 });

export class MemoryNotifyStore implements NotifyStore {
  private readonly items = new Map<string, InboxItem>();
  private readonly byKey = new Map<string, string>();
  private readonly deliveries = new Map<string, DeliveryRecord>();
  private readonly tokens = new Map<string, TaskToken>();
  private readonly sigs = new Map<string, Map<Surface, SurfaceSignal>>();
  private seq = 0;

  async addItem(input: InboxItemInput, now: number) {
    const key = dedupeKey(input);
    const existing = this.byKey.get(key);
    if (existing) return { item: { ...this.items.get(existing)! }, created: false };
    const item: InboxItem = { ...input, id: `inb_${++this.seq}`, dedupeKey: key, createdAt: now };
    this.items.set(item.id, item);
    this.byKey.set(key, item.id);
    return { item: { ...item }, created: true };
  }

  async getItems(ids: string[]) {
    return ids.map(id => this.items.get(id)).filter((i): i is InboxItem => !!i).map(i => ({ ...i }));
  }

  async unseen(personId: string, now: number) {
    return [...this.items.values()]
      .filter(i => i.personId === personId && i.seenAt === undefined && !(i.expiresAt !== undefined && i.expiresAt <= now))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map(i => ({ ...i }));
  }

  async peopleWithPending(now: number) {
    const people = new Set<string>();
    for (const i of this.items.values())
      if (i.seenAt === undefined && i.notifiedAt === undefined && !(i.expiresAt !== undefined && i.expiresAt <= now)) people.add(i.personId);
    return [...people].sort();
  }

  async markSeen(personId: string, surface: Surface, now: number, ids?: string[]) {
    const wanted = ids ? new Set(ids) : undefined;
    const changed: string[] = [];
    for (const i of this.items.values()) {
      if (i.personId !== personId || i.seenAt !== undefined || (wanted && !wanted.has(i.id))) continue;
      i.seenAt = now;
      i.seenOn = surface;
      changed.push(i.id);
    }
    return changed;
  }

  async recordDelivery(d: DeliveryRecord) {
    if (this.deliveries.has(d.deliveryId)) return false;
    this.deliveries.set(d.deliveryId, { ...d, itemIds: [...d.itemIds] });
    for (const id of d.itemIds) {
      const i = this.items.get(id);
      if (i && i.notifiedAt === undefined) { i.notifiedAt = d.sentAt; i.deliveryId = d.deliveryId; }
    }
    return true;
  }

  async getDelivery(id: string) {
    const d = this.deliveries.get(id);
    return d && { ...d, itemIds: [...d.itemIds] };
  }

  async capSendsSince(personId: string, since: number) {
    return [...this.deliveries.values()].filter(d => d.personId === personId && d.countsTowardCap && d.sentAt >= since).map(d => d.sentAt).sort((a, b) => a - b);
  }

  async actOnDelivery(id: string, _on: Surface, at: number) {
    const d = this.deliveries.get(id);
    if (!d || d.outcome) return false;
    d.outcome = "acted";
    d.outcomeAt = at;
    return true;
  }

  async pendingDeliveries(personId: string) {
    return [...this.deliveries.values()].filter(d => d.personId === personId && !d.outcome).map(d => ({ ...d }));
  }

  async expireDeliveries(before: number, at: number) {
    const out: DeliveryRecord[] = [];
    for (const d of this.deliveries.values()) {
      if (d.outcome || d.sentAt >= before) continue;
      d.outcome = "ignored";
      d.outcomeAt = at;
      out.push({ ...d });
    }
    return out;
  }

  async insertToken(t: TaskToken) {
    if (this.tokens.has(t.token)) return false;
    this.tokens.set(t.token, { ...t, itemIds: [...t.itemIds] });
    return true;
  }

  async getToken(token: string) {
    const t = this.tokens.get(token);
    return t && { ...t, itemIds: [...t.itemIds] };
  }

  async markTokenRedeemed(token: string, surface: Surface, at: number) {
    const t = this.tokens.get(token);
    if (t && t.redeemedAt === undefined) { t.redeemedAt = at; t.redeemedOn = surface; }
  }

  private sig(personId: string, surface: Surface) {
    let m = this.sigs.get(personId);
    if (!m) this.sigs.set(personId, (m = new Map()));
    let s = m.get(surface);
    if (!s) m.set(surface, (s = blankSignal(surface)));
    return s;
  }

  async signals(personId: string) {
    return [...(this.sigs.get(personId)?.values() ?? [])].map(s => ({ ...s }));
  }

  async setActive(personId: string, surface: Surface, active: boolean) {
    this.sig(personId, surface).active = active;
  }

  async touch(personId: string, surface: Surface, at: number) {
    this.sig(personId, surface).lastUsedAt = at;
  }

  async recordOutcome(personId: string, surface: Surface, outcome: "acted" | "ignored", at: number) {
    const s = this.sig(personId, surface);
    if (outcome === "acted") { s.acted++; s.ignoredStreak = 0; s.lastUsedAt = at; }
    else { s.ignored++; s.ignoredStreak++; }
  }
}
