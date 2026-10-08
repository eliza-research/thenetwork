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
//  - Surface signals learn from outcomes: a redeemed token or a thread reply is "acted"; a delivery
//    with neither after OUTCOME_WINDOW_MS is "ignored" (`sweep`).

import { createHash, randomInt } from "node:crypto";
import { isQuietAt } from "../../../prototypes/messaging-blooio/src/quiet-hours.ts";
import { composeText } from "./compose.ts";
import type { NotifyStore } from "./store.ts";
import { resolveDelivery, type Delivery, type SurfacePrefs } from "./surface.ts";
import { newToken, TOKEN_TTL_MS, type TaskToken } from "./tokens.ts";
import type { Channel, InboxItem, InboxItemInput, Surface } from "./types.ts";

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
  get(personId: string): Recipient | undefined | Promise<Recipient | undefined>;
}

/** Structurally compatible with prototypes/messaging-blooio OutboundQueue.enqueue (through queueSink). */
export interface OutboundSink {
  enqueue(input: {
    idempotencyKey: string; channel: Channel; to: string; text: string;
    kind: "proactive" | "transactional"; timeZone: string; briefId: string;
  }): unknown | Promise<unknown>;
}

export interface SchedulerConfig {
  urgentDelayMs: number;
  digestDelayMs: number;
  weeklyCap: number;
  outcomeWindowMs: number;
  tokenTtlMs: number;
  pageBase?: string;
  isQuiet: (ms: number, tz: string) => boolean;
  rand: (max: number) => number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  urgentDelayMs: 5 * 60_000,
  digestDelayMs: 4 * 3600_000,
  weeklyCap: 2,
  outcomeWindowMs: 72 * 3600_000,
  tokenTtlMs: TOKEN_TTL_MS,
  isQuiet: (ms, tz) => isQuietAt(ms, tz),
  rand: randomInt,
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
  readonly cfg: SchedulerConfig;

  constructor(readonly store: NotifyStore, private readonly directory: RecipientDirectory, cfg: Partial<SchedulerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  /** Producers (engine, plans, reminders) add items here. Deduped on (person, app, event, subject). */
  add(input: InboxItemInput, now: number) {
    if (!input.summary.trim()) throw new Error("inbox item needs a summary");
    return this.store.addItem(input, now);
  }

  /**
   * A message another sender already delivered (the Network's own consent-checked send path): the
   * item goes in the inbox already notified, so assistants can show it and the scheduler never
   * texts it again. `deliveryId` must not start with "ntf_" (those are the scheduler's own).
   */
  async recordSent(input: InboxItemInput, d: { deliveryId: string; channel: Channel; countsTowardCap: boolean; sentAt: number }) {
    if (d.deliveryId.startsWith("ntf_")) throw new Error("ntf_ delivery ids belong to the scheduler");
    const r = await this.add(input, d.sentAt);
    if (r.item.notifiedAt === undefined)
      await this.store.recordDelivery({ deliveryId: d.deliveryId, personId: input.personId, itemIds: [r.item.id], target: d.channel, countsTowardCap: d.countsTowardCap, sentAt: d.sentAt });
    return r;
  }

  private dueAt(i: InboxItem): number {
    if (i.urgency === "requested") return i.createdAt;
    if (i.urgency === "urgent") return i.createdAt + this.cfg.urgentDelayMs;
    return i.createdAt + this.cfg.digestDelayMs;
  }

  /** Decide what to send now. Writes nothing except task tokens for link deliveries. */
  async plan(now: number): Promise<{ sends: SendPlan[]; holds: Hold[] }> {
    const sends: SendPlan[] = [];
    const holds: Hold[] = [];
    for (const personId of await this.store.peopleWithPending(now)) {
      const r = await this.directory.get(personId);
      if (!r) { holds.push({ personId, reason: "unknown_recipient" }); continue; }
      let items = (await this.store.unseen(personId, now)).filter(i => i.notifiedAt === undefined);
      if (!r.proactiveAllowed) {
        items = items.filter(i => i.urgency === "requested");
        if (items.length === 0) { holds.push({ personId, reason: "proactive_off" }); continue; }
      }
      const firstDue = Math.min(...items.map(i => this.dueAt(i)));
      if (firstDue > now) { holds.push({ personId, reason: "not_due", until: firstDue }); continue; }
      if (this.cfg.isQuiet(now, r.timeZone)) { holds.push({ personId, reason: "quiet_hours" }); continue; }

      const recent = await this.store.capSendsSince(personId, now - WEEK_MS + 1);
      if (recent.length >= this.cfg.weeklyCap && items.some(i => i.urgency !== "requested")) {
        const requested = items.filter(i => i.urgency === "requested");
        if (requested.length === 0) {
          holds.push({ personId, reason: "weekly_cap", until: Math.min(...recent) + WEEK_MS });
          continue;
        }
        items = requested;
      }
      sends.push(await this.build(r, items, now));
    }
    return { sends, holds };
  }

  private async issueToken(personId: string, itemIds: string[], now: number): Promise<string> {
    for (let tries = 0; tries < 20; tries++) {
      const t: TaskToken = { token: newToken(this.cfg.rand), personId, itemIds, issuedAt: now, expiresAt: now + this.cfg.tokenTtlMs };
      if (await this.store.insertToken(t)) return t.token;
    }
    throw new Error("could not draw an unused task token");
  }

  private async build(r: Recipient, items: InboxItem[], now: number): Promise<SendPlan> {
    const delivery = resolveDelivery(r.prefs, await this.store.signals(r.personId), now);
    const itemIds = items.map(i => i.id);
    const token = delivery.mode === "thread" ? undefined : await this.issueToken(r.personId, itemIds, now);
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

  /** Plan, re-check, record, and enqueue. */
  async dispatch(now: number, sink: OutboundSink): Promise<{ sent: SendPlan[]; cancelled: string[]; holds: Hold[] }> {
    const { sends, holds } = await this.plan(now);
    const sent: SendPlan[] = [];
    const cancelled: string[] = [];
    for (const p of sends) {
      const fresh = (await this.store.getItems(p.itemIds)).filter(i => i.seenAt === undefined && i.notifiedAt === undefined);
      if (fresh.length === 0) { cancelled.push(p.deliveryId); continue; }
      const final = fresh.length === p.itemIds.length ? p : await this.build((await this.directory.get(p.personId))!, fresh, now);
      const target: Surface = final.delivery.mode === "deeplink" ? final.delivery.assistant : final.channel;
      // Record first: a crash after this and before enqueue loses one text, never sends two.
      const recorded = await this.store.recordDelivery({
        deliveryId: final.deliveryId, personId: final.personId, itemIds: final.itemIds, target,
        countsTowardCap: final.countsTowardCap, sentAt: now,
      });
      if (!recorded) { cancelled.push(final.deliveryId); continue; }
      await sink.enqueue({
        idempotencyKey: final.deliveryId,
        channel: final.channel,
        to: final.to,
        text: final.text,
        kind: final.countsTowardCap ? "proactive" : "transactional",
        timeZone: final.timeZone,
        briefId: final.deliveryId,
      });
      sent.push(final);
    }
    return { sent, cancelled, holds };
  }

  /**
   * For the outbound queue's recipientPolicy (briefId = deliveryId): false once every item in the
   * delivery was seen on some surface, so a message still waiting is not sent.
   */
  async stillNeeded(deliveryId: string): Promise<boolean> {
    const d = await this.store.getDelivery(deliveryId);
    if (!d) return true;
    return (await this.store.getItems(d.itemIds)).some(i => i.seenAt === undefined);
  }

  private async acted(deliveryId: string | undefined, on: Surface, personId: string, now: number) {
    if (deliveryId && (await this.store.actOnDelivery(deliveryId, on, now))) await this.store.recordOutcome(personId, on, "acted", now);
  }

  /** Resolve a token for its owner. null for unknown, expired or foreign tokens (shown as "no update"). */
  private async redeem(token: string, callerPersonId: string, surface: Surface, now: number): Promise<InboxItem[] | null> {
    const t = await this.store.getToken(token.trim().toUpperCase());
    if (!t || t.personId !== callerPersonId || t.expiresAt <= now) return null;
    await this.store.markTokenRedeemed(t.token, surface, now);
    const items = await this.store.getItems(t.itemIds);
    await this.acted(items.find(i => i.deliveryId)?.deliveryId, surface, callerPersonId, now);
    return items;
  }

  /**
   * An assistant called get_network_updates, or the member typed "updates" in the thread.
   * `callerPersonId` comes from the OAuth grant or the channel binding. With a token, only its
   * items; without, every unseen item; with `app`, only that app's. Everything returned is marked seen.
   */
  async readUpdates(callerPersonId: string, surface: Surface, now: number, token?: string, opts: { app?: string } = {}): Promise<InboxItem[]> {
    await this.store.touch(callerPersonId, surface, now);
    // A surface bound to one app (an MCP grant) never sees another app's items: cross-app privacy.
    let items = (await this.store.unseen(callerPersonId, now)).filter(i => opts.app === undefined || i.app === opts.app);
    if (token) {
      const own = await this.redeem(token, callerPersonId, surface, now);
      if (!own) return [];
      const wanted = new Set(own.map(i => i.id));
      items = items.filter(i => wanted.has(i.id));
    }
    await this.store.markSeen(callerPersonId, surface, now, items.map(i => i.id));
    return items;
  }

  /** For a surface that lists its own items (the MCP connector): token to subject ids, or null. */
  async redeemSubjects(callerPersonId: string, surface: Surface, token: string, now: number): Promise<string[] | null> {
    await this.store.touch(callerPersonId, surface, now);
    const items = await this.redeem(token, callerPersonId, surface, now);
    return items && items.map(i => i.subjectId);
  }

  /** A surface showed these subjects to the member: their inbox items are seen everywhere. */
  async shownSubjects(personId: string, surface: Surface, subjectIds: string[], now: number): Promise<string[]> {
    await this.store.touch(personId, surface, now);
    const wanted = new Set(subjectIds);
    const ids = (await this.store.unseen(personId, now)).filter(i => wanted.has(i.subjectId)).map(i => i.id);
    return ids.length ? this.store.markSeen(personId, surface, now, ids) : [];
  }

  /** The member wrote in the thread: every pending delivery counts as acted on the channel. */
  async threadReply(personId: string, channel: Channel, now: number) {
    await this.store.touch(personId, channel, now);
    for (const d of await this.store.pendingDeliveries(personId)) await this.acted(d.deliveryId, channel, personId, now);
  }

  /** Grant or key issued (true) or revoked (false) for an assistant. */
  setActive(personId: string, surface: Surface, active: boolean) {
    return this.store.setActive(personId, surface, active);
  }

  /** Close deliveries whose outcome window passed with no action; run with dispatch. */
  async sweep(now: number) {
    for (const d of await this.store.expireDeliveries(now - this.cfg.outcomeWindowMs, now))
      await this.store.recordOutcome(d.personId, d.target, "ignored", now);
  }
}
