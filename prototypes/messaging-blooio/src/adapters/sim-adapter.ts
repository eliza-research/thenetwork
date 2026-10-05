// In-memory simulated channel (PRD M2 "simulated channel adapter"). Implements the same ChannelAdapter as Blooio
// and produces the same normalized ChannelEvents, so the gateway/queue run unchanged against simulated personas.

import { ChannelSendError, type ChannelAdapter, type ChannelEvent, type Clock, type InboundMessage, type SendReceipt, type SendRequest } from "../types.ts";

export interface SimDelivered { id: string; from: string; to: string; text: string; mediaUrls: string[]; at: number; idempotencyKey: string }

export class SimBus {
  /** Messages each simulated phone has received from us. */
  readonly inbox = new Map<string, SimDelivered[]>();
  readonly typing: { chatId: string; state: "started" | "stopped" }[] = [];
  #byKey = new Map<string, SimDelivered>();
  #failures = new Map<string, ChannelSendError[]>();
  #listener: ((ev: ChannelEvent) => Promise<unknown>) | null = null;
  #pending: ChannelEvent[] = [];
  #n = 0;
  sendCalls = 0;

  constructor(private clock: Clock, readonly line = "+15550000001") {}

  /** Where events from the bus go (normally Gateway.handle). */
  subscribe(fn: (ev: ChannelEvent) => Promise<unknown>) { this.#listener = fn; }

  /** Script the next send(s) to `to` to fail with this error. */
  failNext(to: string, err: ChannelSendError, times = 1) {
    const q = this.#failures.get(to) ?? [];
    for (let i = 0; i < times; i++) q.push(err);
    this.#failures.set(to, q);
  }

  adapter(): ChannelAdapter {
    const bus = this;
    return {
      kind: "sim",
      async send(req: SendRequest): Promise<SendReceipt> {
        bus.sendCalls++;
        const prior = bus.#byKey.get(req.idempotencyKey);
        if (prior) return { providerMessageId: prior.id, chatId: prior.to, status: "sent", transport: "sim", replayed: true };
        const fail = bus.#failures.get(req.to)?.shift();
        if (fail) throw fail;
        const d: SimDelivered = {
          id: `sim_${++bus.#n}`, from: req.from ?? bus.line, to: req.to, text: req.text, mediaUrls: req.mediaUrls ?? [],
          at: bus.clock.now(), idempotencyKey: req.idempotencyKey,
        };
        bus.#byKey.set(req.idempotencyKey, d);
        const box = bus.inbox.get(req.to) ?? [];
        box.push(d);
        bus.inbox.set(req.to, box);
        bus.#pending.push({ kind: "status", channel: "sim", eventId: `sim_evt_${++bus.#n}`, providerMessageId: d.id, chatId: req.to, status: "delivered", transport: "sim", at: bus.clock.now() });
        return { providerMessageId: d.id, chatId: req.to, status: "sent", transport: "sim" };
      },
      async startTyping(chatId) { bus.typing.push({ chatId, state: "started" }); },
      async stopTyping(chatId) { bus.typing.push({ chatId, state: "stopped" }); },
      async markRead() {},
    };
  }

  /** A simulated member texts the Network. Delivers immediately; returns the gateway's result. */
  async inbound(from: string, text: string, opts: { messageId?: string; eventId?: string; isGroup?: boolean; chatId?: string } = {}) {
    const msg: InboundMessage = {
      kind: "message", channel: "sim", messageId: opts.messageId ?? `sim_in_${++this.#n}`, eventId: opts.eventId ?? `sim_evt_${++this.#n}`,
      from, to: this.line, chatId: opts.chatId ?? from, isGroup: opts.isGroup ?? false, text, mediaUrls: [], transport: "sim",
      receivedAt: this.clock.now(),
    };
    if (!this.#listener) throw new Error("SimBus has no subscriber");
    return this.#listener(msg);
  }

  /** Deliver queued status events (delivery receipts). Call after Queue.drain(). */
  async flush(): Promise<number> {
    const evs = this.#pending.splice(0);
    for (const ev of evs) await this.#listener?.(ev);
    return evs.length;
  }

  /** Simulate the member reading everything we sent them. */
  async readAll(to: string) {
    for (const d of this.inbox.get(to) ?? []) {
      await this.#listener?.({ kind: "status", channel: "sim", eventId: `sim_evt_${++this.#n}`, providerMessageId: d.id, chatId: to, status: "read", at: this.clock.now() });
    }
  }

  last(to: string): SimDelivered | undefined { const b = this.inbox.get(to); return b?.[b.length - 1]; }
}
