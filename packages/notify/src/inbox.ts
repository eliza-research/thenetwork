// The single inbox. Every event becomes one item, deduped on (person, app, event type, subject).
// Every surface reads this inbox: the iMessage agent, get_network_updates in ChatGPT, Claude and
// Grok, and the member web page. Seeing an item on any surface marks it seen everywhere, which is
// what lets the scheduler cancel a text the member no longer needs.
// Production: a Postgres table with a unique index on dedupe_key; this in-memory version keeps the
// same rules.

import type { InboxItem, InboxItemInput, Surface } from "./types.ts";

export const dedupeKey = (i: Pick<InboxItemInput, "personId" | "app" | "eventType" | "subjectId">) =>
  [i.personId, i.app, i.eventType, i.subjectId].join("|");

export interface InboxStore {
  add(input: InboxItemInput, now: number): { item: InboxItem; created: boolean };
  get(id: string): InboxItem | undefined;
  /** Unseen, unexpired items for a person, oldest first. */
  unseen(personId: string, now: number): InboxItem[];
  /** People with at least one unseen, unexpired item that has not been notified. */
  peopleWithPending(now: number): string[];
  /** Mark items seen. `ids` omitted means every unseen item of that person. Returns the ids changed. */
  markSeen(personId: string, surface: Surface, now: number, ids?: string[]): string[];
  markNotified(ids: string[], deliveryId: string, now: number): void;
}

export class MemoryInbox implements InboxStore {
  private readonly items = new Map<string, InboxItem>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;

  add(input: InboxItemInput, now: number) {
    if (!input.summary.trim()) throw new Error("inbox item needs a summary");
    const key = dedupeKey(input);
    const existingId = this.byKey.get(key);
    if (existingId) return { item: this.items.get(existingId)!, created: false };
    const item: InboxItem = { ...input, id: `inb_${++this.seq}`, dedupeKey: key, createdAt: now };
    this.items.set(item.id, item);
    this.byKey.set(key, item.id);
    return { item, created: true };
  }

  get(id: string) {
    return this.items.get(id);
  }

  unseen(personId: string, now: number) {
    return [...this.items.values()]
      .filter(i => i.personId === personId && i.seenAt === undefined && !(i.expiresAt !== undefined && i.expiresAt <= now))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  peopleWithPending(now: number) {
    const people = new Set<string>();
    for (const i of this.items.values()) {
      if (i.seenAt === undefined && i.notifiedAt === undefined && !(i.expiresAt !== undefined && i.expiresAt <= now)) people.add(i.personId);
    }
    return [...people].sort();
  }

  markSeen(personId: string, surface: Surface, now: number, ids?: string[]) {
    const wanted = ids ? new Set(ids) : undefined;
    const changed: string[] = [];
    for (const i of this.items.values()) {
      if (i.personId !== personId || i.seenAt !== undefined) continue;
      if (wanted && !wanted.has(i.id)) continue;
      i.seenAt = now;
      i.seenOn = surface;
      changed.push(i.id);
    }
    return changed;
  }

  markNotified(ids: string[], deliveryId: string, now: number) {
    for (const id of ids) {
      const i = this.items.get(id);
      if (i && i.notifiedAt === undefined) {
        i.notifiedAt = now;
        i.deliveryId = deliveryId;
      }
    }
  }
}
