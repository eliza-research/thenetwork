// Adapters that connect the Notifier to the rest of the system without those modules importing
// this package: each target declares a small structural interface and these functions fill it.

import type { Notifier } from "./scheduler.ts";
import type { Channel } from "./types.ts";

type Check = { ok: true } | { ok: false; reason: string };

/**
 * For packages/blooio OutboundQueue `AppChecks.recipient` (the Postgres queue, platform.outbound). A
 * Notifier delivery is queued with its delivery id as the row id; once every item in it was seen on
 * another surface, a message still waiting in the queue (quiet hours, the unanswered cap) is not sent.
 * Other rows pass through to `next`, which keeps the existing member checks.
 */
export function queuePolicy<R extends { id: string }>(
  notifier: Pick<Notifier, "stillNeeded">,
  next?: (row: R, agentInitiated: boolean) => Check | Promise<Check>,
) {
  return async (row: R, agentInitiated: boolean): Promise<Check> => {
    if (row.id.startsWith("ntf_") && !(await notifier.stillNeeded(row.id))) return { ok: false, reason: "seen_elsewhere" };
    return next ? next(row, agentInitiated) : { ok: true };
  };
}

/** The part of packages/blooio OutboundQueue the sink uses (its pool and `enqueue`). */
export interface QueueLike<T> {
  readonly sql: T;
  enqueue(tx: T, items: Array<{ id: string; to: string; kind: "proactive" | "transactional"; text: string; timeZone: string }>): Promise<void>;
}

/**
 * Turns the Postgres OutboundQueue into the Notifier's sink. The delivery id is the row id, so the
 * provider key is "tn:<delivery id>" and a second dispatch of the same delivery is a no-op. The queue
 * sends on its one line (Blooio picks iMessage or SMS), so the Notifier's channel is not passed on.
 * In the service the inbox's sends go through a unit of work instead (NetworkService.notifySink).
 */
export function queueSink<T>(queue: QueueLike<T>) {
  return {
    enqueue: (x: { idempotencyKey: string; channel: Channel; to: string; text: string; kind: "proactive" | "transactional"; timeZone: string; briefId: string }) =>
      queue.enqueue(queue.sql, [{ id: x.idempotencyKey, to: x.to, kind: x.kind, text: x.text, timeZone: x.timeZone }]),
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
