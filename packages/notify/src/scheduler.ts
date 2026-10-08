// The notification scheduler (entry-flows doc, section 5.2): one message per person per send,
// across every app, because the apps share one line and its limits.
//  - requested items (reminders the member asked for) are due at once; urgent items after a short
//    delay; normal items wait for a digest. When anything is due, every unnotified item goes in the
//    same message.
//  - At most `weeklyCap` messages in any 7 days count against the interruption budget (PRD 32.9).
//    Messages made only of requested items do not count.
//  - Nothing is planned during the member's quiet hours. The outbound queue enforces them again.
//  - Just before enqueueing, items are re-read: anything seen on another surface is dropped, and a
//    send with nothing left is cancelled. `stillNeeded` lets the outbound queue's recipientPolicy
//    cancel a message that waited in the queue and was seen elsewhere meanwhile.

import { createHash } from "node:crypto";
import { isQuietAt } from "../../../prototypes/messaging-blooio/src/quiet-hours.ts";
import { composeText } from "./compose.ts";
import type { InboxStore } from "./inbox.ts";
import type { MemorySignals } from "./signals.ts";
import { resolveDelivery, type Delivery, type SurfacePrefs } from "./surface.ts";
import type { TaskTokens } from "./tokens.ts";
import type { Channel, InboxItem, Surface } from "./types.ts";

export interface Recipient {
  personId: string;
  /** E.164 number or channel address. */
  to: string;
  timeZone: string;
  prefs: SurfacePrefs;
  /** Paused, safety hold, or no proactive outreach (two unanswered): only requested items go out. */
  proactiveAllowed: boolean;
}

export interface RecipientDirectory {
  get(personId: string): Recipient | undefined;
}

/** Structurally compatible with prototypes/messaging-blooio OutboundQueue.enqueue. */
export interface OutboundSink {
  enqueue(input: {
    idempotencyKey: string; channel: Channel; to: string; text: string;
    kind: "proactive" | "transactional"; timeZone: string; briefId: string;
  }): unknown;
}

export interface SchedulerConfig {
  urgentDelayMs: number;
  digestDelayMs: number;
  weeklyCap: number;
  pageBase?: string;
  isQuiet: (ms: number, tz: string) => boolean;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  urgentDelayMs: 5 * 60_000,
  digestDelayMs: 4 * 3600_000,
  weeklyCap: 2,
  isQuiet: (ms, tz) => isQuietAt(ms, tz),
};

const WEEK_MS = 7 * 24 * 3600_000;

export interface SendPlan {
  personId: string;
  deliveryId: string;
  channel: Channel;
  to: string;
  timeZone: string;
  itemIds: string[];
  delivery: Delivery;
  token?: string;
  text: string;
  countsTowardCap: boolean;
}

export type HoldReason = "not_due" | "quiet_hours" | "weekly_cap" | "proactive_off" | "unknown_recipient";
export interface Hold { personId: string; reason: HoldReason; until?: number }

export const deliveryIdFor = (personId: string, itemIds: string[]) =>
  `ntf_${createHash("sha256").update(personId + "\n" + [...itemIds].sort().join(",")).digest("hex").slice(0, 20)}`;

export class Notifier {
  private readonly cfg: SchedulerConfig;
  private readonly capSends = new Map<string, number[]>();
  private readonly deliveries = new Map<string, { personId: string; itemIds: string[] }>();

  constructor(
    private readonly inbox: InboxStore,
    private readonly tokens: TaskTokens,
    private readonly signals: MemorySignals,
    private readonly directory: RecipientDirectory,
    cfg: Partial<SchedulerConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  private dueAt(i: InboxItem): number {
    if (i.urgency === "requested") return i.createdAt;
    if (i.urgency === "urgent") return i.createdAt + this.cfg.urgentDelayMs;
    return i.createdAt + this.cfg.digestDelayMs;
  }

  private recentCapSends(personId: string, now: number): number[] {
    const kept = (this.capSends.get(personId) ?? []).filter(t => now - t < WEEK_MS);
    this.capSends.set(personId, kept);
    return kept;
  }

  /** Decide what to send now. Pure apart from issuing task tokens for link deliveries. */
  plan(now: number): { sends: SendPlan[]; holds: Hold[] } {
    const sends: SendPlan[] = [];
    const holds: Hold[] = [];
    for (const personId of this.inbox.peopleWithPending(now)) {
      const r = this.directory.get(personId);
      if (!r) { holds.push({ personId, reason: "unknown_recipient" }); continue; }
      let items = this.inbox.unseen(personId, now).filter(i => i.notifiedAt === undefined);
      if (!r.proactiveAllowed) {
        items = items.filter(i => i.urgency === "requested");
        if (items.length === 0) { holds.push({ personId, reason: "proactive_off" }); continue; }
      }
      const firstDue = Math.min(...items.map(i => this.dueAt(i)));
      if (firstDue > now) { holds.push({ personId, reason: "not_due", until: firstDue }); continue; }
      if (this.cfg.isQuiet(now, r.timeZone)) { holds.push({ personId, reason: "quiet_hours" }); continue; }

      const recent = this.recentCapSends(personId, now);
      if (recent.length >= this.cfg.weeklyCap && items.some(i => i.urgency !== "requested")) {
        const requested = items.filter(i => i.urgency === "requested");
        if (requested.length === 0) {
          holds.push({ personId, reason: "weekly_cap", until: Math.min(...recent) + WEEK_MS });
          continue;
        }
        items = requested;
      }
      sends.push(this.build(r, items, now));
    }
    return { sends, holds };
  }

  private build(r: Recipient, items: InboxItem[], now: number): SendPlan {
    const delivery = resolveDelivery(r.prefs, this.signals.list(r.personId), now);
    const itemIds = items.map(i => i.id);
    const token = delivery.mode === "thread" ? undefined : this.tokens.issue(r.personId, itemIds, now).token;
    return {
      personId: r.personId,
      deliveryId: deliveryIdFor(r.personId, itemIds),
      channel: r.prefs.channel,
      to: r.to,
      timeZone: r.timeZone,
      itemIds,
      delivery,
      token,
      text: composeText(items, delivery, token, this.cfg.pageBase),
      countsTowardCap: items.some(i => i.urgency !== "requested"),
    };
  }

  /** Plan, re-check, and enqueue. Returns what was enqueued and what was cancelled as already seen. */
  dispatch(now: number, sink: OutboundSink): { sent: SendPlan[]; cancelled: string[]; holds: Hold[] } {
    const { sends, holds } = this.plan(now);
    const sent: SendPlan[] = [];
    const cancelled: string[] = [];
    for (const p of sends) {
      const fresh = p.itemIds.map(id => this.inbox.get(id)!).filter(i => i.seenAt === undefined && i.notifiedAt === undefined);
      if (fresh.length === 0) { cancelled.push(p.deliveryId); continue; }
      const final = fresh.length === p.itemIds.length ? p : this.build(this.directory.get(p.personId)!, fresh, now);
      sink.enqueue({
        idempotencyKey: final.deliveryId,
        channel: final.channel,
        to: final.to,
        text: final.text,
        kind: final.countsTowardCap ? "proactive" : "transactional",
        timeZone: final.timeZone,
        briefId: final.deliveryId,
      });
      this.inbox.markNotified(final.itemIds, final.deliveryId, now);
      this.deliveries.set(final.deliveryId, { personId: final.personId, itemIds: final.itemIds });
      if (final.countsTowardCap) this.capSends.set(final.personId, [...this.recentCapSends(final.personId, now), now]);
      const target: Surface = final.delivery.mode === "deeplink" ? final.delivery.assistant : final.channel;
      this.signals.sent(final.personId, final.deliveryId, target, now);
      sent.push(final);
    }
    return { sent, cancelled, holds };
  }

  /**
   * For the outbound queue's recipientPolicy (briefId = deliveryId): false once every item in the
   * delivery was seen on some surface, so a message still waiting (quiet hours, conversation limits)
   * is not sent.
   */
  stillNeeded(deliveryId: string): boolean {
    const d = this.deliveries.get(deliveryId);
    if (!d) return true;
    return d.itemIds.some(id => this.inbox.get(id)?.seenAt === undefined);
  }

  /**
   * An assistant called get_network_updates. `callerPersonId` comes from the OAuth grant. With a
   * token, return those items; without, every unseen item. Everything returned is marked seen.
   */
  readUpdates(callerPersonId: string, surface: Surface, now: number, text?: string, token?: string): InboxItem[] {
    this.signals.used(callerPersonId, surface, now);
    let items = this.inbox.unseen(callerPersonId, now);
    if (token) {
      const r = this.tokens.redeem(token, callerPersonId, surface, now);
      if (!r.ok) return [];
      const wanted = new Set(r.itemIds);
      items = items.filter(i => wanted.has(i.id));
      const deliveryId = items[0]?.deliveryId ?? this.inbox.get(r.itemIds[0]!)?.deliveryId;
      if (deliveryId) this.signals.acted(deliveryId, surface, now);
    }
    this.inbox.markSeen(callerPersonId, surface, now, items.map(i => i.id));
    return items;
  }

  /** The member replied in the thread after a delivery: it counts as acted on the channel. */
  threadReply(personId: string, channel: Channel, now: number) {
    this.signals.used(personId, channel, now);
    for (const [id, d] of this.deliveries) if (d.personId === personId) this.signals.acted(id, channel, now);
  }
}
