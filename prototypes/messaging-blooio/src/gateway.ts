// Channel gateway: one entry point for normalized events from any adapter (Blooio webhook, sim bus).
// Order for an inbound message: dedupe -> release held outbound -> STOP/HELP/START -> agent handler.

import { dedupeKeysFor } from "./blooio/webhook.ts";
import type { DedupeStore } from "./dedupe.ts";
import { handleKeyword, type ConsentLedger, type KeywordCopy, type KeywordOutcome } from "./keywords.ts";
import type { OutboundQueue } from "./outbound-queue.ts";
import type { ChannelEvent, InboundMessage, SafetyUpdate, TypingUpdate } from "./types.ts";

export interface GatewayDeps {
  dedupe: DedupeStore;
  consent: ConsentLedger;
  copy: KeywordCopy;
  queue: OutboundQueue;
  /** The Network agent. Not called for keywords. `optedOut` lets the agent stay silent for opted-out senders. */
  onMessage?: (msg: InboundMessage, ctx: { optedOut: boolean }) => Promise<void> | void;
  onTyping?: (t: TypingUpdate) => void;
  onSafety?: (s: SafetyUpdate) => void;
}

export type GatewayResult =
  | { outcome: "duplicate" }
  | { outcome: "keyword"; keyword: KeywordOutcome }
  | { outcome: "message"; optedOut: boolean; released: number }
  | { outcome: "status"; matched: boolean }
  | { outcome: "reaction"; released: number }
  | { outcome: "typing" | "safety" }
  | { outcome: "ignored"; reason: string };

export class Gateway {
  constructor(private d: GatewayDeps) {}

  async handle(ev: ChannelEvent): Promise<GatewayResult> {
    if (ev.kind === "ignored") return { outcome: "ignored", reason: `${ev.type}: ${ev.reason}` };
    const keys = dedupeKeysFor(ev);
    if (keys.length && !this.d.dedupe.claim(keys)) return { outcome: "duplicate" };
    try {
      const r = await this.#route(ev);
      this.d.dedupe.commit(keys);
      return r;
    } catch (err) {
      this.d.dedupe.release(keys); // let the provider's retry reprocess it
      throw err;
    }
  }

  async #route(ev: Exclude<ChannelEvent, { kind: "ignored" }>): Promise<GatewayResult> {
    switch (ev.kind) {
      case "message": {
        const released = this.d.queue.onRecipientEngaged(ev.channel, ev.from);
        const kw = handleKeyword(this.d.consent, this.d.copy, ev);
        if (kw) {
          if (kw.reply) {
            this.d.queue.enqueue({
              idempotencyKey: `kw:${ev.channel}:${ev.messageId}`, channel: ev.channel,
              // Keyword replies are 1:1 only (handleKeyword suppresses them in groups); reply from the line they texted.
              to: ev.from, from: ev.to ?? undefined, text: kw.reply, kind: "compliance",
            });
            await this.d.queue.drain();
          }
          return { outcome: "keyword", keyword: kw };
        }
        const optedOut = this.d.consent.isOptedOut(ev.channel, ev.from);
        await this.d.onMessage?.(ev, { optedOut });
        return { outcome: "message", optedOut, released };
      }
      case "status":
        return { outcome: "status", matched: !!this.d.queue.applyStatus(ev) };
      case "reaction":
        return { outcome: "reaction", released: this.d.queue.onRecipientEngaged(ev.channel, ev.from) };
      case "typing":
        this.d.onTyping?.(ev);
        return { outcome: "typing" };
      case "safety":
        if (ev.line) this.d.queue.setLineSafety(ev.line, ev.type === "safety.number_banned" ? "review" : ev.action);
        this.d.onSafety?.(ev);
        return { outcome: "safety" };
    }
  }
}
