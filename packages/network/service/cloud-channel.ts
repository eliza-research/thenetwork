/** Same outbound policy queue, with the canonical Cloud conversation as transport owner. */
import { ChannelSendError, type SendReceipt, type SendRequest } from "../../blooio/src/types.ts";
import { readCappedText } from "../../platform/src/body.ts";
import { normalizePhone } from "../../platform/src/phone.ts";
import { DELIVER_PATH, type DeliverRequest, type NetworkAppId } from "../../plugin-network/src/backend/contract.ts";
import { svcSign } from "../../plugin-network/src/backend/svc-auth.ts";
import { BlooioAdapter, type BlooioAdapterOptions, type Delivery, type Outbound } from "./channel.ts";

export class CloudChannelAdapter extends BlooioAdapter {
  override readonly name = "eliza_cloud" as const;
  private readonly cityForReceipts: string;
  private readonly recover: (message: Outbound) => Promise<SendReceipt>;

  constructor(options: Omit<BlooioAdapterOptions, "provider" | "app"> & {
    app: NetworkAppId;
    origin: string;
    secret: string;
    fetch?: typeof fetch;
  }) {
    const origin = new URL(options.origin);
    const local = options.env?.PLATFORM_ENV === "dev" && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
    if ((!local && origin.protocol !== "https:") || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Cloud delivery requires an exact HTTPS origin or explicit local development origin");
    if (options.secret.length < 32) throw new Error("Cloud delivery requires a dedicated service signing secret");

    const post = async (payload: DeliverRequest, receiptOnly: boolean): Promise<SendReceipt> => {
      const path = receiptOnly ? `${DELIVER_PATH}/receipt` : DELIVER_PATH;
      const body = JSON.stringify(payload);
      let response: Response;
      let value: unknown;
      try {
        response = await (options.fetch ?? fetch)(`${origin.origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...await svcSign(options.secret, { method: "POST", path, id: payload.id, body, nowS: Math.floor(options.clock.now() / 1000) }) },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        const text = await readCappedText(response, 64 * 1024);
        if (text === "too_large") throw new Error("Receipt exceeds the response contract");
        value = JSON.parse(text);
      } catch {
        // error-policy:J1 a lost response cannot establish whether dispatch happened.
        throw new ChannelSendError("Cloud delivery acceptance is unknown", "unknown");
      }
      const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (response.status === 200 && result?.ok === true && result.history === true && typeof result.replayed === "boolean"
        && Array.isArray(result.providerMessageIds) && result.providerMessageIds.length > 0
        && result.providerMessageIds.every(id => typeof id === "string" && id.trim())
        && typeof result.acceptedAt === "string" && Number.isFinite(Date.parse(result.acceptedAt))) {
        return { providerMessageId: result.providerMessageIds[0] as string, status: "queued", replayed: result.replayed, acceptedAt: Date.parse(result.acceptedAt) };
      }
      if (!receiptOnly && result?.ok === false && result.error !== "unknown") {
        if (result.error === "opted_out") throw new ChannelSendError("Recipient opted out", "blocked", response.status, "opted_out");
        if (result.error === "rejected" && result.retryable === true) throw new ChannelSendError("Cloud declined admission before dispatch", "retryable", response.status);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) throw new ChannelSendError("Cloud refused delivery before acceptance", "invalid", response.status);
      }
      throw new ChannelSendError("Cloud delivery acceptance is unknown", "unknown", response.status);
    };
    const send = async (request: SendRequest): Promise<SendReceipt> => {
      if (!request.context || normalizePhone(request.to) !== request.to || request.mediaUrls?.length) throw new ChannelSendError("Cloud delivery requires a canonical direct text and queue-owned context", "invalid");
      return post({ id: request.context.idempotencyKey, to: request.to, text: request.text, app: options.app,
        memberId: options.memberOf(request.to) ?? null, channel: "blooio",
        kind: request.context.kind === "reply" || request.context.kind === "compliance" ? "reply" : "proactive" }, false);
    };
    super({ ...options, provider: { kind: "blooio", send } });
    this.cityForReceipts = options.city ?? "nyc";
    this.recover = message => {
      if (!message.to) throw new ChannelSendError("Original delivery address is unavailable", "unknown");
      return post({ id: message.id, to: message.to, text: message.body, app: options.app, memberId: message.memberId, channel: "blooio",
        kind: message.kind === "reply" || message.kind === "compliance" ? "reply" : "proactive" }, true);
    };
  }

  /** Receipt-only reconciliation; never enters the provider dispatch path. */
  async reconcile(messages: Outbound[]): Promise<Delivery[]> {
    return Promise.all(messages.map(async message => {
      try {
        const receipt = await this.recover(message);
        return { id: message.id, status: "accepted", receipt };
      } catch (error) {
        if (!(error instanceof ChannelSendError) || error.failure !== "unknown") throw error;
        return { id: message.id, status: "unknown_acceptance" };
      }
    }));
  }

  receiptCommitted(message: Outbound, receipt: SendReceipt): void {
    this.queue.acceptReceipt({ idempotencyKey: message.id, channel: "blooio", to: message.to!, text: message.body, kind: message.kind, city: this.cityForReceipts, ...(message.oppId ? { briefId: message.oppId } : {}) }, receipt);
  }
}
