// Local webhook receiver as a plain fetch handler (testable without a socket; served by Bun.serve in main.ts).
//
// Contract with Blooio (docs: webhooks): any 2xx within 15 s is success; otherwise 6 attempts total with backoff
// 30s, 1m, 2m, 4m, 8m (~15.5 min), then replayable from the dashboard/API. So:
//   401 for bad signatures (no point retrying), 400 for unparseable bodies, 500 only when WE failed and want a retry.
// Production note: persist the verified raw event first and ack, then process asynchronously, to stay far inside 15 s.

import type { Gateway } from "./gateway.ts";
import { parseBlooioWebhook, SIGNATURE_HEADER, verifyBlooioSignature } from "./blooio/webhook.ts";
import type { Clock } from "./types.ts";

export const WEBHOOK_PATH = "/webhooks/blooio";
const MAX_BODY_BYTES = 256 * 1024;

export interface ReceiverOptions {
  secret: string;
  clock: Clock;
  gateway: Gateway;
  log?: (line: string) => void;
}

export function createWebhookHandler(o: ReceiverOptions): (req: Request) => Promise<Response> {
  const log = o.log ?? (() => {});
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") return Response.json({ ok: true });
    if (url.pathname !== WEBHOOK_PATH) return new Response("not found", { status: 404 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

    const sig = verifyBlooioSignature(o.secret, req.headers.get(SIGNATURE_HEADER), raw, Math.floor(o.clock.now() / 1000));
    if (!sig.ok) {
      log(`webhook rejected: signature ${sig.reason}`);
      return Response.json({ ok: false, error: `signature_${sig.reason}` }, { status: 401 });
    }

    let ev;
    try {
      ev = parseBlooioWebhook(raw, o.clock.now());
    } catch {
      return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    try {
      const result = await o.gateway.handle(ev);
      log(`webhook ${ev.kind}${"type" in ev ? ` ${ev.type}` : ""} -> ${result.outcome}`);
      return Response.json({ ok: true, result: result.outcome });
    } catch (err) {
      log(`webhook processing failed: ${err instanceof Error ? err.message : String(err)}`);
      return Response.json({ ok: false, error: "processing_failed" }, { status: 500 });
    }
  };
}
