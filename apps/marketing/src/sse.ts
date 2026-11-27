import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";

export type MarketingEventType =
  | "overview"
  | "campaign"
  | "agent"
  | "device"
  | "human"
  | "task"
  | "proof"
  | "outreach"
  | "attribution"
  | "bandit"
  | "bd_deal"
  | "qr_batch"
  | "vip_prospect"
  | "video_asset"
  | "antifraud"
  | "daemon";

export interface MarketingEventEnvelope {
  seq: number;
  type: MarketingEventType;
  at: string;
  payload: Record<string, unknown>;
}

export interface MarketingEventHubOptions {
  clock?: Clock;
  maxClients?: number;
  keepaliveMs?: number;
}

interface SseClient {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepaliveTimer: ReturnType<typeof setInterval>;
  cleanup: () => void;
}

const ENCODER = new TextEncoder();
const DEFAULT_MAX_CLIENTS = 64;
const DEFAULT_KEEPALIVE_MS = 25_000;

export class MarketingEventHub {
  private readonly clock: Clock;
  private readonly maxClients: number;
  private readonly keepaliveMs: number;
  private readonly clients = new Map<number, SseClient>();
  private nextClientId = 0;
  private nextSeq = 0;

  constructor(opts?: MarketingEventHubOptions) {
    this.clock = opts?.clock ?? new RealClock();
    this.maxClients = Math.max(1, opts?.maxClients ?? DEFAULT_MAX_CLIENTS);
    this.keepaliveMs = Math.max(100, opts?.keepaliveMs ?? DEFAULT_KEEPALIVE_MS);
  }

  clientCount(): number {
    return this.clients.size;
  }

  createStreamResponse(signal?: AbortSignal): Response {
    if (this.clients.size >= this.maxClients) {
      return new Response(
        JSON.stringify({
          error: "SSE client capacity reached",
          code: "SSE_CAPACITY_EXCEEDED",
          maxClients: this.maxClients,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
        },
      );
    }

    const clientId = ++this.nextClientId;
    let disposed = false;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const removeClient = (): void => {
          if (disposed) return;
          disposed = true;
          const existing = this.clients.get(clientId);
          if (existing) {
            clearInterval(existing.keepaliveTimer);
            this.clients.delete(clientId);
          }
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          try {
            controller.close();
          } catch {
            // Stream may already be closed or errored.
          }
        };

        const onAbort = (): void => {
          removeClient();
        };

        const keepaliveTimer = setInterval(() => {
          if (disposed) return;
          try {
            controller.enqueue(ENCODER.encode(": keepalive\n\n"));
          } catch {
            removeClient();
          }
        }, this.keepaliveMs);

        if (typeof keepaliveTimer.unref === "function") {
          keepaliveTimer.unref();
        }

        const client: SseClient = {
          id: clientId,
          controller,
          keepaliveTimer,
          cleanup: removeClient,
        };
        this.clients.set(clientId, client);

        if (signal) {
          if (signal.aborted) {
            removeClient();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }

        try {
          controller.enqueue(ENCODER.encode(": connected\n\n"));
        } catch {
          removeClient();
        }
      },
      cancel: () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.cleanup();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  publish(type: MarketingEventType, payload: Record<string, unknown> = {}): number {
    const seq = ++this.nextSeq;
    const envelope: MarketingEventEnvelope = {
      seq,
      type,
      at: new Date(this.clock.now()).toISOString(),
      payload,
    };
    const frame = ENCODER.encode(
      `id: ${seq}\nevent: marketing_update\ndata: ${JSON.stringify(envelope)}\n\n`,
    );

    let delivered = 0;
    for (const client of [...this.clients.values()]) {
      try {
        client.controller.enqueue(frame);
        delivered += 1;
      } catch {
        client.cleanup();
      }
    }
    return delivered;
  }

  closeAll(): void {
    for (const client of [...this.clients.values()]) {
      client.cleanup();
    }
    this.clients.clear();
  }
}
