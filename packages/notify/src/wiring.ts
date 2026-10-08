// Adapters that connect the Notifier to the rest of the system without those modules importing
// this package: each target declares a small structural interface and these functions fill it.

import type { Notifier } from "./scheduler.ts";
import type { Assistant, Channel, Surface } from "./types.ts";

type Check = { ok: true } | { ok: false; reason: string };

/**
 * For packages/blooio OutboundQueue `recipientPolicy`. Notifier deliveries use their
 * delivery id as briefId; once every item in one was seen on another surface, a message still
 * waiting in the queue (quiet hours, conversation limits) is not sent. Other briefs pass through
 * to `next`, which keeps the existing member checks.
 */
export function queuePolicy<C extends { briefId?: string }>(
  notifier: Pick<Notifier, "stillNeeded">,
  next?: (to: string, ctx: C) => Check | Promise<Check>,
) {
  return async (to: string, ctx: C): Promise<Check> => {
    if (ctx.briefId?.startsWith("ntf_") && !(await notifier.stillNeeded(ctx.briefId))) return { ok: false, reason: "seen_elsewhere" };
    return next ? next(to, ctx) : { ok: true };
  };
}

/**
 * Turns an OutboundQueue into the Notifier's sink. The queue names providers ("blooio", "twilio",
 * "sim"); the Notifier names channels. iMessage and SMS both go out through Blooio by default, with
 * Twilio SMS as the queue's fallback.
 */
export function queueSink<K extends string>(
  queue: { enqueue(input: { idempotencyKey: string; channel: K; to: string; text: string; kind: "proactive" | "transactional"; timeZone: string; briefId: string; fallbackChannel?: K }): unknown },
  providerFor: (c: Channel) => K,
  fallback?: K,
) {
  return {
    enqueue: (x: { idempotencyKey: string; channel: Channel; to: string; text: string; kind: "proactive" | "transactional"; timeZone: string; briefId: string }) =>
      queue.enqueue({ ...x, channel: providerFor(x.channel), ...(fallback ? { fallbackChannel: fallback } : {}) }),
  };
}

/** Host keys the connector knows, mapped to notify surfaces. Unknown hosts count as web. */
export function surfaceForHost(hostKey: string): Surface {
  const known: Record<string, Assistant> = { chatgpt: "chatgpt", claude: "claude", grok: "grok" };
  return known[hostKey] ?? "web";
}

/** The inbox bridge prototypes/connector-mcp FakeNetwork accepts as `opts.inbox`. */
export function connectorInbox(notifier: Pick<Notifier, "redeemSubjects" | "shownSubjects">, now: () => number) {
  return {
    redeem: (memberId: string, hostKey: string, token: string) => notifier.redeemSubjects(memberId, surfaceForHost(hostKey), token, now()),
    shown: async (memberId: string, hostKey: string, itemIds: string[]) => { await notifier.shownSubjects(memberId, surfaceForHost(hostKey), itemIds, now()); },
  };
}

/** For the iMessage/SMS agent and plugin-network's NetworkStore.readUpdates. */
export function threadHooks(notifier: Pick<Notifier, "threadReply" | "readUpdates">, now: () => number) {
  return {
    inbound: (personId: string, channel: Channel) => notifier.threadReply(personId, channel, now()),
    readUpdates: async (personId: string, channel: Channel = "imessage") =>
      ({ items: (await notifier.readUpdates(personId, channel, now())).map(i => ({ summary: i.summary })) }),
  };
}
