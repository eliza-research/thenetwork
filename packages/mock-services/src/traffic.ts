import { maskPii } from "@thenetwork/core";
import type { MockServiceName } from "./state.ts";

export interface MockTrafficEntry {
  seq: number;
  simTimeMs: number;
  sessionId: string;
  service: MockServiceName;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  rateLimit?: { limit: number; remaining: number; resetAtSec: number };
  chaosApplied?: string;
  webhookTriggered?: string[];
}

const SECRET_HEADER_KEYS = new Set([
  "authorization",
  "x-api-key",
  "xi-api-key",
  "x-luma-api-key",
  "x-postmark-server-token",
  "cookie",
  "set-cookie",
  "x-blooio-signature",
  "svix-signature",
]);

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    const stripped = value
      .replace(/\b(Bearer\s+|Basic\s+)\S+/gi, "$1[redacted]")
      .replace(/(api[_-]?key|secret|token|password)=[^&\s]+/gi, "$1=[redacted]");
    return maskPii(stripped).slice(0, 500);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      const lower = k.toLowerCase();
      if (
        SECRET_HEADER_KEYS.has(lower) ||
        lower.includes("secret") ||
        lower.includes("token") ||
        lower.includes("password") ||
        lower.includes("apikey") ||
        lower.includes("api_key")
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    out[lower] = SECRET_HEADER_KEYS.has(lower) ? "[redacted]" : maskPii(v).slice(0, 200);
  }
  return out;
}

export class TrafficLog {
  private readonly maxEntries: number;
  private readonly ring: Array<MockTrafficEntry | undefined>;
  private head = 0;
  private count = 0;
  private nextSeq = 0;
  private readonly listeners = new Set<(entry: MockTrafficEntry) => void>();

  constructor(maxEntries = 10_000) {
    this.maxEntries = Math.max(100, Math.floor(maxEntries));
    this.ring = new Array<MockTrafficEntry | undefined>(this.maxEntries);
  }

  record(input: Omit<MockTrafficEntry, "seq">): MockTrafficEntry {
    this.nextSeq += 1;
    const entry: MockTrafficEntry = {
      ...input,
      seq: this.nextSeq,
      requestSummary: sanitizeValue(input.requestSummary) as Record<string, unknown>,
      responseSummary: sanitizeValue(input.responseSummary) as Record<string, unknown>,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.maxEntries;
    if (this.count < this.maxEntries) this.count += 1;
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
      }
    }
    return entry;
  }

  query(opts: {
    sessionId?: string;
    service?: string;
    status?: number;
    sinceSeq?: number;
    limit?: number;
  } = {}): MockTrafficEntry[] {
    const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 200)));
    const results: MockTrafficEntry[] = [];
    const startIdx = this.count < this.maxEntries ? 0 : this.head;
    for (let i = 0; i < this.count; i += 1) {
      const idx = (startIdx + i) % this.maxEntries;
      const entry = this.ring[idx];
      if (!entry) continue;
      if (opts.sinceSeq !== undefined && entry.seq <= opts.sinceSeq) continue;
      if (opts.sessionId && entry.sessionId !== opts.sessionId) continue;
      if (opts.service && entry.service !== opts.service) continue;
      if (opts.status !== undefined && entry.status !== opts.status) continue;
      results.push(entry);
    }
    if (results.length > limit) {
      return results.slice(results.length - limit);
    }
    return results;
  }

  subscribe(fn: (entry: MockTrafficEntry) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  clear(): void {
    this.ring.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  stats(): { totalRecorded: number; buffered: number; capacity: number; subscribers: number } {
    return {
      totalRecorded: this.nextSeq,
      buffered: this.count,
      capacity: this.maxEntries,
      subscribers: this.listeners.size,
    };
  }
}

export function createTrafficSseResponse(
  traffic: TrafficLog,
  opts: { sessionId?: string; service?: string; sinceSeq?: number },
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (entry: MockTrafficEntry) => {
        if (opts.sessionId && entry.sessionId !== opts.sessionId) return;
        if (opts.service && entry.service !== opts.service) return;
        const payload = `id: ${entry.seq}\nevent: traffic\ndata: ${JSON.stringify(entry)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };
      if (opts.sinceSeq !== undefined) {
        for (const existing of traffic.query({
          sessionId: opts.sessionId,
          service: opts.service,
          sinceSeq: opts.sinceSeq,
          limit: 100,
        })) {
          send(existing);
        }
      }
      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = traffic.subscribe(send);
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
