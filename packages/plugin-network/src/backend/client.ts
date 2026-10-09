/** Signed HTTP client for the Network service's /internal/* endpoints (the Eliza side's NetworkBackend). */
import {
  SET_STATE_PATH,
  type SetStateRequest,
  type SetStateResponse,
  SIGNALS_PATH,
  type SignalsRequest,
  type SignalsResponse,
  TURN_PATH,
  TURN_RECEIPT_PATH,
  type TurnReceiptRequest,
  type TurnReceiptResponse,
  type TurnRequest,
  type TurnResponse,
  UPDATES_PATH,
  type UpdatesRequest,
  type UpdatesResponse,
} from "./contract.js";
import { svcSign } from "./svc-auth.js";

export interface NetworkServiceClientOptions {
  /** Service origin, e.g. https://network-service.up.railway.app (no trailing slash needed). */
  baseUrl: string;
  /** SERVICE_TURN_SECRET. */
  secret: string;
  fetch?: typeof fetch;
  /** Per-request timeout (ms). Default 8000: the turn budget is p95 < 8 s end to end. */
  timeoutMs?: number;
}

export class NetworkServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NetworkServiceClient {
  readonly #o: Required<Omit<NetworkServiceClientOptions, "fetch">> & {
    fetch: typeof fetch;
  };
  constructor(o: NetworkServiceClientOptions) {
    this.#o = {
      timeoutMs: 8000,
      ...o,
      baseUrl: o.baseUrl.replace(/\/+$/, ""),
      fetch: o.fetch ?? fetch.bind(globalThis),
    };
  }

  async #post<T>(path: string, id: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const headers = await svcSign(this.#o.secret, {
      method: "POST",
      path,
      id,
      body,
    });
    try {
      const res = await this.#o.fetch(`${this.#o.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.#o.timeoutMs),
      });
      if (!res.ok)
        throw new NetworkServiceError(res.status, `${path} -> ${res.status}`);
      const limit = 4 * 1024 * 1024;
      if (Number(res.headers.get("content-length")) > limit) {
        await res.body?.cancel().catch(() => {});
        throw new NetworkServiceError(502, "Network service response exceeds the transport limit");
      }
      let text = "";
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
              await reader.cancel().catch(() => {});
              throw new NetworkServiceError(502, "Network service response exceeds the transport limit");
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof NetworkServiceError) throw error;
      throw new NetworkServiceError(502, "Network service response could not be read");
    }
  }

  /** One inbound message. Idempotent by messageId. */
  turn(req: TurnRequest): Promise<TurnResponse> {
    return this.#post<TurnResponse>(TURN_PATH, req.messageId, req);
  }

  /** Acknowledge provider acceptance separately from collecting a reply. */
  turnReceipt(req: TurnReceiptRequest): Promise<TurnReceiptResponse> {
    return this.#post<TurnReceiptResponse>(
      TURN_RECEIPT_PATH,
      `${req.messageId}:receipt`,
      req,
    );
  }

  setState(req: SetStateRequest): Promise<SetStateResponse> {
    return this.#post<SetStateResponse>(
      SET_STATE_PATH,
      req.idempotencyKey,
      req,
    );
  }

  recordSignals(req: SignalsRequest): Promise<SignalsResponse> {
    return this.#post<SignalsResponse>(
      SIGNALS_PATH,
      `${req.messageId}:signals`,
      req,
    );
  }

  readUpdates(req: UpdatesRequest): Promise<UpdatesResponse> {
    return this.#post<UpdatesResponse>(
      UPDATES_PATH,
      `${req.messageId}:updates`,
      req,
    );
  }
}
