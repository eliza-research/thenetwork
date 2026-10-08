import { BlooioClient } from "../blooio/client.ts";
import type { ChannelAdapter, SendReceipt, SendRequest } from "../types.ts";

/** ChannelAdapter over the real Blooio API. */
export class BlooioAdapter implements ChannelAdapter {
  readonly kind = "blooio" as const;
  constructor(private client: BlooioClient, private defaultFrom?: string) {}

  send(req: SendRequest): Promise<SendReceipt> {
    return this.client.send({ ...req, from: req.from ?? this.defaultFrom });
  }
  startTyping(chatId: string) { return this.client.startTyping(chatId); }
  stopTyping(chatId: string) { return this.client.stopTyping(chatId); }
  markRead(chatId: string) { return this.client.markRead(chatId); }
}

/**
 * Wraps an adapter so nothing leaves the machine: logs and returns a fake receipt.
 * The local receiver uses this unless BLOOIO_ALLOW_SEND=1, so STOP/HELP auto-replies cannot text a real person
 * by accident while prototyping.
 */
export class DryRunAdapter implements ChannelAdapter {
  readonly kind;
  readonly sent: SendRequest[] = [];
  #n = 0;
  constructor(inner: ChannelAdapter, private log: (line: string) => void = console.log) { this.kind = inner.kind; }
  async send(req: SendRequest): Promise<SendReceipt> {
    this.sent.push(req);
    this.log(`[dry-run] would send to ${req.to}: ${JSON.stringify(req.text).slice(0, 120)} (key ${req.idempotencyKey})`);
    return { providerMessageId: `dry_${++this.#n}`, status: "queued" };
  }
}
