import { createHmac } from "node:crypto";
import { DELIVERY_HEADER, SIGNATURE_HEADER, signBlooioPayload } from "@thenetwork/blooio";
import type { MockClockAdapter, MockSessionState, WebhookSubscription } from "./state.ts";

export interface DispatchedWebhookResult {
  deliveryId: string;
  subscriptionId: string;
  service: WebhookSubscription["service"];
  url: string;
  eventType: string;
  ok: boolean;
  status: number;
  error?: string;
}

export function signSvixPayload(
  secret: string,
  msgId: string,
  timestampSec: number,
  rawBody: string,
): string {
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = /^[A-Za-z0-9+/=]+$/.test(cleanSecret) && secret.startsWith("whsec_")
    ? Buffer.from(cleanSecret, "base64")
    : Buffer.from(cleanSecret, "utf8");
  const sig = createHmac("sha256", key)
    .update(`${msgId}.${timestampSec}.${rawBody}`)
    .digest("base64");
  return `v1,${sig}`;
}

export function signLumaPayload(secret: string, rawBody: string): string {
  const hex = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${hex}`;
}

export class WebhookDispatcher {
  private readonly clock: MockClockAdapter;
  private readonly fetchFn: typeof fetch;
  private deliverySeq = 0;
  readonly history: DispatchedWebhookResult[] = [];

  constructor(clock: MockClockAdapter, fetchFn: typeof fetch = fetch) {
    this.clock = clock;
    this.fetchFn = fetchFn;
  }

  async dispatch(
    state: MockSessionState,
    service: WebhookSubscription["service"],
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<DispatchedWebhookResult[]> {
    const subs = [...state.webhooks.values()].filter(
      (sub) =>
        sub.active &&
        sub.service === service &&
        (sub.events.length === 0 || sub.events.includes("*") || sub.events.includes(eventType)),
    );
    if (subs.length === 0) return [];

    const results: DispatchedWebhookResult[] = [];
    for (const sub of subs) {
      this.deliverySeq += 1;
      const deliveryId = `whd_${state.seed}_${this.deliverySeq.toString(36).padStart(6, "0")}`;
      const rawBody = JSON.stringify(payload);
      const tsSec = this.clock.unixSec();
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-mock-session": state.sessionId,
      };

      if (service === "blooio") {
        headers[SIGNATURE_HEADER] = signBlooioPayload(sub.secret, rawBody, tsSec);
        headers[DELIVERY_HEADER] = deliveryId;
      } else if (service === "resend") {
        headers["svix-id"] = deliveryId;
        headers["svix-timestamp"] = String(tsSec);
        headers["svix-signature"] = signSvixPayload(sub.secret, deliveryId, tsSec, rawBody);
      } else if (service === "luma") {
        headers["x-luma-signature"] = signLumaPayload(sub.secret, rawBody);
        headers["x-luma-timestamp"] = String(tsSec);
      } else if (service === "sendgrid") {
        headers["x-twilio-email-event-webhook-timestamp"] = String(tsSec);
        headers["x-twilio-email-event-webhook-signature"] = createHmac("sha256", sub.secret)
          .update(`${tsSec}${rawBody}`)
          .digest("base64");
      } else if (service === "postmark") {
        headers["x-postmark-signature"] = createHmac("sha256", sub.secret)
          .update(rawBody)
          .digest("hex");
      }

      let ok = false;
      let status = 0;
      let error: string | undefined;
      try {
        const res = await this.fetchFn(sub.url, {
          method: "POST",
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(5_000),
        });
        status = res.status;
        ok = res.ok;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const result: DispatchedWebhookResult = {
        deliveryId,
        subscriptionId: sub.id,
        service,
        url: sub.url,
        eventType,
        ok,
        status,
        ...(error ? { error } : {}),
      };
      this.history.push(result);
      if (this.history.length > 2000) {
        this.history.splice(0, this.history.length - 2000);
      }
      results.push(result);
    }
    return results;
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}
