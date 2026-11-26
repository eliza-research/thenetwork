// The notification scheduler (entry-flows doc, section 5.2): one message per person per send,
// across every app, because the apps share one line and its limits.
//  - requested items (reminders the member asked for) are due at once; urgent items after a short
//    delay; normal items wait for a digest. When anything is due, every unnotified item goes in the
//    same message.
//  - At most `weeklyCap` messages in any 7 days count against the interruption budget (PRD 32.9).
//    Messages made only of requested items do not count.
//  - Nothing is planned during the member's quiet hours. The outbound queue enforces them again.
//  - Just before enqueueing, items are re-read: anything seen on another surface is dropped, and a
//    send with nothing left is cancelled. `stillNeeded` lets the outbound queue's recipient check
//    cancel a message that waited in the queue and was seen elsewhere meanwhile.
//  - Surface signals learn from outcomes: a redeemed token or a thread reply is "acted"; a delivery
//    with neither after OUTCOME_WINDOW_MS is "ignored" (`sweep`).

import { createHash, randomInt } from "node:crypto";
import {
  appAllowsInboxItem, canRecordInboxSeen, inboxTokenMayRecordRedemption, initial as acknowledgementInitial, mayRedeemInboxToken, step as stepAcknowledgement,
} from "../../core/src/generated/notificationAcknowledgement.ts";
import { assistantDigestCanLink, digestUsesProactiveSlot, inboxDueAt, primaryDigestAssistantIndex, weeklyDigest } from "../../core/src/generated/notificationDelivery.ts";
import { inboxItemAllowedForRecipient, inboxItemExpired, queuedDigestClaimAllowed } from "../../core/src/generated/notificationDispatch.ts";
import { controlQuietHoursValid } from "../../core/src/generated/participationControls.ts";
import { dispatchInboxDigest, queuedInboxDigestCurrent } from "../../core/src/vibe/notificationDigestShell.js";
import { isQuietAt, type QuietWindow } from "../../blooio/src/quiet-hours.ts";
import { composeText, composeThreadText } from "./compose.ts";
import { assistantLink, buttonPageLink, updatePrompt } from "./links.ts";
import { TOKEN_PATTERN } from "./reference.ts";
import { WEEK_MS, type DigestAssistantLink, type NotifyStore } from "./store.ts";
import { resolveDelivery, type Delivery, type SurfacePrefs } from "./surface.ts";
import { newToken, TOKEN_TTL_MS, type TaskToken } from "./tokens.ts";
import { isAssistant, type Assistant, type Channel, type InboxItem, type InboxItemInput, type Surface } from "./types.ts";

export interface Recipient {
  personId: string;
  /** E.164 number or channel address. */
  to: string;
  timeZone: string;
  /** The member's saved whole-hour quiet window; absent or invalid uses the queue default. */
  quietHours?: readonly [number, number] | null;
  prefs: SurfacePrefs;
  /** Paused, safety hold, or no proactive outreach (two unanswered): only requested items go out. */
  proactiveAllowed: boolean;
}

export interface RecipientDirectory {
  get(personId: string): Recipient | undefined | Promise<Recipient | undefined>;
}

type AssistantUpdatesLookup = (personId: string, app: string) => Promise<readonly Surface[]>;

/** The Notifier's sink: packages/blooio OutboundQueue through queueSink, or the service's unit of work. */
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
  isQuiet: (ms: number, tz: string, quiet?: QuietWindow) => boolean;
  rand: (max: number) => number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  urgentDelayMs: 5 * 60_000,
  digestDelayMs: 4 * 3600_000,
  weeklyCap: 2,
  outcomeWindowMs: 72 * 3600_000,
  tokenTtlMs: TOKEN_TTL_MS,
  isQuiet: (ms, tz, quiet) => isQuietAt(ms, tz, quiet),
  rand: randomInt,
};

function requireSummary(input: InboxItemInput): void {
  if (!input.summary.trim()) throw new Error("inbox item needs a summary");
}

function quietWindowOf(r: Recipient): QuietWindow | undefined {
  const q = r.quietHours;
  if (!q || q.length !== 2) return undefined;
  const [startHour, endHour] = q;
  return Number.isInteger(startHour) && Number.isInteger(endHour) && controlQuietHoursValid(startHour, endHour) ? { startHour, endHour } : undefined;
}

export interface SendPlan {
  personId: string;
  deliveryId: string;
  channel: Channel;
  to: string;
  timeZone: string;
  itemIds: string[];
  delivery: Delivery;
  token?: string;
  assistantLink?: DigestAssistantLink;
  text: string;
  countsTowardCap: boolean;
}

export type HoldReason = "not_due" | "quiet_hours" | "weekly_cap" | "proactive_off" | "unknown_recipient";
export interface Hold { personId: string; reason: HoldReason; until?: number }

export const deliveryIdFor = (personId: string, itemIds: string[]) =>
  `ntf_${createHash("sha256").update(personId + "\n" + [...itemIds].sort().join(",")).digest("hex").slice(0, 20)}`;
const digestBodyHash = (text: string) => createHash("sha256").update(text).digest("hex");

export class Notifier {
  readonly cfg: SchedulerConfig;
  private assistantUpdatesLookup?: AssistantUpdatesLookup;

  constructor(readonly store: NotifyStore, private readonly directory: RecipientDirectory, cfg: Partial<SchedulerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  /** The connector is the authority for membership-read access in the digest's app. */
  setAssistantUpdatesLookup(lookup: AssistantUpdatesLookup): void {
    this.assistantUpdatesLookup = lookup;
  }

  /** Producers (engine, plans, reminders) add items here. Deduped on (person, app, event, subject). */
  add(input: InboxItemInput, now: number) {
    requireSummary(input);
    return this.store.addItem(input, now);
  }

  /**
   * A message another sender already delivered (the Network's own consent-checked send path): the
   * item goes in the inbox already notified, so assistants can show it and the scheduler never
   * texts it again. `deliveryId` must not start with "ntf_" (those are the scheduler's own).
   */
  async recordSent(input: InboxItemInput, d: { deliveryId: string; channel: Channel; countsTowardCap: boolean; sentAt: number }) {
    if (d.deliveryId.startsWith("ntf_")) throw new Error("ntf_ delivery ids belong to the scheduler");
    requireSummary(input);
    return this.store.addDelivered(input, { deliveryId: d.deliveryId, target: d.channel, countsTowardCap: d.countsTowardCap, sentAt: d.sentAt });
  }

  private dueAt(i: InboxItem): number {
    return inboxDueAt(i.createdAt, i.urgency, this.cfg.urgentDelayMs, this.cfg.digestDelayMs);
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
        items = items.filter(i => inboxItemAllowedForRecipient(i.urgency === "requested", r.proactiveAllowed));
        if (items.length === 0) { holds.push({ personId, reason: "proactive_off" }); continue; }
      }
      const firstDue = Math.min(...items.map(i => this.dueAt(i)));
      if (firstDue > now) { holds.push({ personId, reason: "not_due", until: firstDue }); continue; }
      if (this.cfg.isQuiet(now, r.timeZone, quietWindowOf(r))) { holds.push({ personId, reason: "quiet_hours" }); continue; }

      const recent = await this.store.capSendsSince(personId, now - WEEK_MS + 1);
      const requested = items.filter(i => i.urgency === "requested");
      const budget = weeklyDigest(recent.length, this.cfg.weeklyCap, items.length, requested.length);
      if (budget === "HoldDigest") {
        holds.push({ personId, reason: "weekly_cap", until: Math.min(...recent) + WEEK_MS });
        continue;
      }
      if (budget === "KeepRequested") items = requested;
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

  private async digestAssistants(personId: string, items: InboxItem[]): Promise<Assistant[]> {
    const app = items[0]?.app;
    const singleApp = !!app && items.every(item => item.app === app);
    let assistants: Assistant[] = [];
    if (singleApp && this.assistantUpdatesLookup) {
      try { assistants = (await this.assistantUpdatesLookup(personId, app)).filter(isAssistant); }
      catch { /* The verified member can still get the digest in their text thread. */ }
    }
    return assistantDigestCanLink(singleApp, assistants.length > 0) ? assistants : [];
  }

  private async linkCurrent(plan: SendPlan, items: InboxItem[]): Promise<boolean> {
    const { delivery } = plan;
    if (delivery.mode === "thread") return true;
    const assistants = await this.digestAssistants(plan.personId, items);
    return delivery.mode === "deeplink" ? assistants.includes(delivery.assistant)
      : delivery.assistants.every(assistant => assistants.includes(assistant));
  }

  private async build(r: Recipient, items: InboxItem[], now: number): Promise<SendPlan> {
    const assistants = await this.digestAssistants(r.personId, items);
    const signals = (await this.store.signals(r.personId)).filter(signal => !isAssistant(signal.surface) || assistants.includes(signal.surface));
    const delivery = resolveDelivery(r.prefs, signals, now);
    const itemIds = items.map(i => i.id);
    const token = delivery.mode === "thread" ? undefined : await this.issueToken(r.personId, itemIds, now);
    const text = composeText(items, delivery, token, this.cfg.pageBase);
    const assistantLink = delivery.mode === "thread" ? undefined : {
      app: items[0]!.app,
      assistants: delivery.mode === "deeplink" ? [delivery.assistant] : delivery.assistants,
      expiresAt: now + this.cfg.tokenTtlMs,
      bodyHash: digestBodyHash(text),
    };
    return {
      personId: r.personId,
      deliveryId: deliveryIdFor(r.personId, itemIds),
      channel: r.prefs.channel,
      to: r.to,
      timeZone: r.timeZone,
      itemIds,
      delivery,
      token,
      assistantLink,
      text,
      countsTowardCap: digestUsesProactiveSlot(items.length, items.filter(i => i.urgency === "requested").length),
    };
  }

  /** Plan, re-check, record, and enqueue. */
  async dispatch(now: number, sink: OutboundSink): Promise<{ sent: SendPlan[]; cancelled: string[]; holds: Hold[] }> {
    const { sends, holds } = await this.plan(now);
    const sent: SendPlan[] = [];
    const cancelled: string[] = [];
    for (const planned of sends) {
      const result = await dispatchInboxDigest(planned, now, {
        readItems: ids => this.store.getItems(ids),
        readRecipient: async personId => this.directory.get(personId),
        linkCurrent: (plan, items) => this.linkCurrent(plan, items),
        rebuild: (recipient, items) => this.build(recipient, items, now),
        record: final => this.store.recordDelivery({
          deliveryId: final.deliveryId, personId: final.personId, itemIds: final.itemIds,
          target: final.delivery.mode === "thread" ? final.channel
            : final.delivery.mode === "deeplink" ? final.delivery.assistant : final.delivery.assistants[primaryDigestAssistantIndex],
          countsTowardCap: final.countsTowardCap, sentAt: now, assistantLink: final.assistantLink,
        }, this.cfg.weeklyCap),
        enqueue: async final => sink.enqueue({
          idempotencyKey: final.deliveryId, channel: final.channel, to: final.to, text: final.text,
          kind: final.countsTowardCap ? "proactive" : "transactional",
          timeZone: final.timeZone, briefId: final.deliveryId,
        }),
      });
      if (result.kind === "queued") sent.push(result.plan);
      else cancelled.push(result.deliveryId);
    }
    return { sent, cancelled, holds };
  }

  /**
   * Revalidate the immutable queued digest. Erasure or expiry cancels the whole text: its old body
   * cannot be sent after the underlying item set changes. Seen items alone cancel only when all were seen.
   */
  stillNeeded(deliveryId: string, now: number): Promise<boolean> {
    return queuedInboxDigestCurrent(deliveryId, now, {
      readDelivery: id => this.store.getDelivery(id),
      idFor: deliveryIdFor,
      readItems: ids => this.store.getItems(ids),
    });
  }

  /** Only the exact URL authored for this queued body is eligible for the contact leak exception. */
  async queuedDigestHandoffUrl(id: string, text: string): Promise<string | undefined> {
    const record = await this.store.getDelivery(id);
    const link = record?.assistantLink;
    if (!link || link.bodyHash !== digestBodyHash(text)) return;
    const lines = text.split("\n");
    if (lines.length !== 2) return;
    const url = lines[1]!;
    const parsed = URL.parse(url);
    if (!parsed) return;
    const prompt = parsed.searchParams.get("prompt") ?? parsed.searchParams.get("q");
    const token = prompt?.split(" ").at(-1) ?? parsed.pathname.split("/").at(-1) ?? "";
    if (!TOKEN_PATTERN.test(token)) return;
    if (url === buttonPageLink(token, this.cfg.pageBase)
      || link.assistants.some(assistant => url === assistantLink(assistant, updatePrompt(token)))) return url;
  }

  queuedDigestClaimCurrent(
    row: { id: string; personId: string; text: string },
    now: () => number,
    reads: Pick<NotifyStore, "getDelivery" | "getItems">,
    readAssistants?: AssistantUpdatesLookup,
  ): Promise<boolean> {
    return queuedInboxDigestCurrent(row.id, now(), {
      readDelivery: id => reads.getDelivery(id),
      idFor: deliveryIdFor,
      readItems: ids => reads.getItems(ids),
      canClaim: async (record, items) => {
        const sameRecipient = record.personId === row.personId && items.every(item => item.personId === row.personId);
        const link = record.assistantLink;
        const itemExpired = (at: number) => items.some(item => inboxItemExpired(item.expiresAt !== undefined, item.expiresAt ?? 0, at));
        if (!link) {
          return !itemExpired(now()) && queuedDigestClaimAllowed(sameRecipient, row.text === composeThreadText(items), false, false, false, false);
        }
        const boundLink = link.bodyHash === digestBodyHash(row.text);
        const appScoped = items.every(item => item.app === link.app);
        const assistants = sameRecipient && boundLink && appScoped && link.expiresAt > now() && readAssistants
          ? await readAssistants(row.personId, link.app) : [];
        const checkedAt = now();
        return !itemExpired(checkedAt)
          && queuedDigestClaimAllowed(sameRecipient, false, boundLink, appScoped, link.expiresAt > checkedAt,
            link.assistants.length > 0 && link.assistants.every(assistant => assistants.includes(assistant)));
      },
    });
  }

  /** Resolve a token for its owner. null for unknown, expired or foreign tokens (shown as "no update"). */
  private async redeem(token: string, callerPersonId: string, surface: Surface, now: number, app?: string): Promise<InboxItem[] | null> {
    const t = await this.store.getToken(token.trim().toUpperCase());
    if (!t || !mayRedeemInboxToken(t.personId === callerPersonId, t.expiresAt, now)) return null;
    const items = (await this.store.getItems(t.itemIds)).filter(item => item.personId === callerPersonId
      && appAllowsInboxItem(app !== undefined, item.app === app) && !inboxItemExpired(item.expiresAt !== undefined, item.expiresAt ?? 0, now));
    if (!inboxTokenMayRecordRedemption(items.length)) return null;
    await this.store.markTokenRedeemed(t.token, surface, now);
    const deliveryId = items.find(i => i.deliveryId)?.deliveryId;
    if (deliveryId) await this.store.actOnDelivery(deliveryId, surface, now);
    return items;
  }

  /**
   * An assistant called get_network_updates, or the member typed "updates" in the thread.
   * `callerPersonId` comes from the OAuth grant or the channel binding. With a token, only its
   * items; without, every unseen item; with `app`, only that app's. Everything returned is marked seen.
   */
  async readUpdates(callerPersonId: string, surface: Surface, now: number, token?: string,
    opts: { app?: string; visible?: (items: InboxItem[]) => Promise<InboxItem[]>; withheld?: (items: InboxItem[]) => InboxItem[] } = {}): Promise<InboxItem[]> {
    await this.store.touch(callerPersonId, surface, now);
    // A surface bound to one app (an MCP grant) never sees another app's items: cross-app privacy.
    let items = (await this.store.unseen(callerPersonId, now)).filter(i => appAllowsInboxItem(opts.app !== undefined, i.app === opts.app));
    let read = stepAcknowledgement(acknowledgementInitial, { type: "selectInboxRead", withToken: !!token });
    if (read.phase === "AwaitingReadToken" && token) {
      const own = await this.redeem(token, callerPersonId, surface, now, opts.app);
      read = stepAcknowledgement(read, { type: "resolveInboxReadToken", valid: own !== null });
      if (own) {
        const wanted = new Set(own.map(i => i.id));
        items = items.filter(i => wanted.has(i.id));
      }
    }
    if (!canRecordInboxSeen(read)) return [];
    const visible = opts.visible ? await opts.visible(items) : items;
    const kept = new Set((opts.withheld?.(items) ?? []).map(i => i.id));
    const seen = new Set(await this.store.markSeen(callerPersonId, surface, now, items.filter(i => !kept.has(i.id)).map(i => i.id)));
    return stepAcknowledgement(read, { type: "recordInboxSeen" }).phase === "InboxSeen" ? visible.filter(i => seen.has(i.id)) : [];
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
    const read = stepAcknowledgement(acknowledgementInitial, { type: "selectShownSubjects", hasVisibleItems: ids.length > 0 });
    if (!canRecordInboxSeen(read)) return [];
    const seen = await this.store.markSeen(personId, surface, now, ids);
    return stepAcknowledgement(read, { type: "recordInboxSeen" }).phase === "InboxSeen" ? seen : [];
  }

  /** The member wrote in the thread: every pending delivery counts as acted on the channel. */
  async threadReply(personId: string, channel: Channel, now: number) {
    await this.store.touch(personId, channel, now);
    for (const d of await this.store.pendingDeliveries(personId)) await this.store.actOnDelivery(d.deliveryId, channel, now);
  }

  /** Grant or key issued (true) or revoked (false) for an assistant. */
  setActive(personId: string, surface: Surface, active: boolean) {
    return this.store.setActive(personId, surface, active);
  }

  /** Close deliveries whose outcome window passed with no action; run with dispatch. */
  async sweep(now: number) {
    await this.store.expireDeliveries(now - this.cfg.outcomeWindowMs, now);
  }
}
