// Adapters that connect the Notifier to the rest of the system without those modules importing
// this package: each target declares a small structural interface and these functions fill it.

import type { Notifier } from "./scheduler.ts";
import type { Channel } from "./types.ts";

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


/** For the iMessage/SMS agent and plugin-network's NetworkStore.readUpdates. */
export function threadHooks(notifier: Pick<Notifier, "threadReply" | "readUpdates">, now: () => number) {
  return {
    inbound: (personId: string, channel: Channel) => notifier.threadReply(personId, channel, now()),
    readUpdates: async (personId: string, channel: Channel = "imessage") =>
      ({ items: (await notifier.readUpdates(personId, channel, now())).map(i => ({ summary: i.summary })) }),
  };
}
