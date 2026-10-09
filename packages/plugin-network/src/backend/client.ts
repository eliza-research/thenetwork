/** Signed HTTP client for the Network service's /internal/* endpoints (the Eliza side's NetworkBackend). */
import { TURN_PATH, type TurnRequest, type TurnResponse } from "./contract.js";
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
  constructor(readonly status: number, message: string) { super(message); }
}

export class NetworkServiceClient {
  readonly #o: Required<Omit<NetworkServiceClientOptions, "fetch">> & { fetch: typeof fetch };
  constructor(o: NetworkServiceClientOptions) {
    this.#o = { timeoutMs: 8000, ...o, baseUrl: o.baseUrl.replace(/\/+$/, ""), fetch: o.fetch ?? fetch };
  }

  async #post<T>(path: string, id: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const headers = await svcSign(this.#o.secret, { method: "POST", path, id, body });
    const res = await this.#o.fetch(`${this.#o.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(this.#o.timeoutMs),
    });
    if (!res.ok) throw new NetworkServiceError(res.status, `${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  /** One inbound message. Idempotent by messageId. */
  turn(req: TurnRequest): Promise<TurnResponse> {
    return this.#post<TurnResponse>(TURN_PATH, req.messageId, req);
  }
}
