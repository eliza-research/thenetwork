// Typed Blooio v4 REST client. Fetch is injectable so tests run offline.
// Docs: https://docs.blooio.com (v4 beta). Auth: `Authorization: Bearer <api key>`.
// The API key is held privately and never included in errors, logs, or toString output.

import { ChannelSendError, type DeliveryStatus, type FailureClass, type SendReceipt, type SendRequest, type Transport } from "../types.ts";

export const BLOOIO_API_BASE = "https://api.blooio.com/v4";
const DEFAULT_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BlooioClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

// ---- Read-only response shapes (observed live 2026-10-05; v4 is beta, so all fields are optional-tolerant) ----

export interface BlooioLine {
  phone_number: string;
  is_active: boolean;
  suspended: boolean;
  status: string;
  last_active?: number;
  plan_kind?: "shared" | "dedicated" | "inbound" | "trial" | "2fa" | string;
}

export interface BlooioMe {
  auth_type: string;
  valid: boolean;
  organization_id: string;
  organization?: { organization_id: string; name: string; country_code?: string; created_at?: number };
  metadata?: Record<string, unknown>;
  devices?: BlooioLine[];
  usage?: { inbound_messages?: number; outbound_messages?: number; last_message_sent?: number };
}

export interface BlooioChannel {
  id: string;
  type: string;
  address: string | null;
  status: string;
  capabilities?: { protocols?: string[]; content?: string[]; actions?: string[]; interactive?: string[]; gates?: string[] };
  settings?: Record<string, unknown>;
  created_at?: number;
}

export interface BlooioWebhook {
  id: string;
  url: string;
  status: "active" | "disabled" | string;
  scope?: string;
  channel_id?: string | null;
  channel_type?: string | null;
  api_version?: string;
  created_at?: number;
}

export interface Page<T> { data: T[]; has_more?: boolean; next_cursor?: string | null }

/** Error thrown by non-send calls. Carries status and Blooio's machine-readable `code`. */
export class BlooioApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "BlooioApiError";
  }
}

/** Blooio conversation-limit codes: wait for the recipient, never retry on a timer (docs: messaging-safety). */
export const CONVERSATION_WAIT_CODES = new Set([
  "conversation_awaiting_reply",
  "conversation_streak_limit",
  "conversation_inactive_paused",
  "conversation_content_restricted",
]);
/** Number-level protections: stop and alert a human. */
export const NUMBER_BLOCK_CODES = new Set([
  "safety_new_conversations_paused",
  "safety_reply_only",
  "safety_account_review",
  "inbound_only_no_prior_inbound",
]);

export function classifyFailure(status: number, code: string | undefined, retryAfterMs?: number): FailureClass {
  if (code && CONVERSATION_WAIT_CODES.has(code)) return "await_recipient";
  if (code && NUMBER_BLOCK_CODES.has(code)) return "blocked";
  if (status >= 500) return "retryable"; // includes 503 "no active number available"
  if (status === 429) return retryAfterMs !== undefined ? "retryable" : "blocked"; // configured outbound limit needs a settings/usage change
  if (status === 401) return "auth";
  if (status === 403) return "blocked";
  return "invalid"; // 400, 404, 409 (idempotency key reused with a different body), 422
}

async function readErrorBody(res: Response): Promise<{ code?: string; message?: string }> {
  let text = "";
  try { text = await res.text(); } catch { return {}; }
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    // v4: { error: { code, message } }   v2: { error: "code", message, code? }
    if (body.error && typeof body.error === "object") {
      const e = body.error as Record<string, unknown>;
      return { code: typeof e.code === "string" ? e.code : undefined, message: typeof e.message === "string" ? e.message : undefined };
    }
    return {
      code: typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
    };
  } catch {
    return {};
  }
}

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

const TRANSPORTS = new Set(["imessage", "sms", "rcs", "pending", "unknown"]);
export function toTransport(p: unknown): Transport | undefined {
  return typeof p === "string" && TRANSPORTS.has(p) ? (p as Transport) : undefined;
}
const STATUSES = new Set(["queued", "sent", "delivered", "read", "failed"]);
export function toStatus(s: unknown, fallback: DeliveryStatus = "queued"): DeliveryStatus {
  return typeof s === "string" && STATUSES.has(s) ? (s as DeliveryStatus) : fallback;
}

export class BlooioClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(opts: BlooioClientOptions) {
    if (!opts.apiKey) throw new Error("BlooioClient requires an apiKey");
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? ((i, init) => fetch(i, init));
    this.baseUrl = (opts.baseUrl ?? BLOOIO_API_BASE).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  toJSON() { return { baseUrl: this.baseUrl, apiKey: "[redacted]" }; }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json", ...extra };
  }

  async #get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}${path}`, {
        method: "GET", headers: this.#headers(), redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new BlooioApiError(`Blooio GET ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`, 0);
    }
    if (!res.ok) {
      const { code, message } = await readErrorBody(res);
      throw new BlooioApiError(`Blooio GET ${path} -> ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`, res.status, code);
    }
    return (await res.json()) as T;
  }

  // ---------------- Read-only endpoints (safe for verification) ----------------
  async getMe(): Promise<BlooioMe> { return (await this.#get<{ data: BlooioMe }>("/me")).data; }
  async listNumbers(): Promise<BlooioLine[]> { return (await this.#get<{ data: BlooioLine[] }>("/me/numbers")).data; }
  async listChannels(): Promise<Page<BlooioChannel>> { return this.#get("/channels?limit=200"); }
  async getChannelCapabilities(line: string): Promise<unknown> { return this.#get(`/channels/${encodeURIComponent(line)}/capabilities`); }
  async getChannelSettings(line: string): Promise<unknown> { return this.#get(`/channels/${encodeURIComponent(line)}/settings`); }
  async listWebhooks(): Promise<Page<BlooioWebhook>> { return this.#get("/webhooks?limit=200"); }
  async listWebhookVersions(): Promise<unknown> { return this.#get("/webhooks/versions"); }
  async getMessageStatus(chatId: string, messageId: string): Promise<unknown> {
    return this.#get(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/status`);
  }

  // ---------------- Side-effecting endpoints (real sends; never called by tests against the live API) ----------------

  /**
   * Send a message. `to: "chat:<chatId>"` posts into an existing chat (groups); anything else goes to POST /messages.
   * Always sends an Idempotency-Key: Blooio returns the original result (HTTP 200) for a replayed key and 409 if the body differs.
   */
  async send(req: SendRequest): Promise<SendReceipt> {
    if (!req.idempotencyKey) throw new ChannelSendError("idempotencyKey is required", "invalid");
    const chatId = req.to.startsWith("chat:") ? req.to.slice(5) : null;
    const body: Record<string, unknown> = {};
    if (req.text) body.text = req.text;
    if (req.mediaUrls?.length) body.attachments = req.mediaUrls;
    if (!body.text && !body.attachments) throw new ChannelSendError("text or mediaUrls required", "invalid");
    let url: string;
    if (chatId) {
      url = `${this.baseUrl}/chats/${encodeURIComponent(chatId)}/messages`;
    } else {
      url = `${this.baseUrl}/messages`;
      body.to = req.to;
      if (req.from) body.from = req.from;
    }
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "POST",
        headers: this.#headers({ "Content-Type": "application/json", "Idempotency-Key": req.idempotencyKey }),
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // Outcome unknown: the queue retries with the same idempotency key, which is safe.
      throw new ChannelSendError(`Blooio send transport error: ${cause instanceof Error ? cause.message : String(cause)}`, "retryable");
    }
    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res);
      const { code, message } = await readErrorBody(res);
      throw new ChannelSendError(
        `Blooio rejected send (${res.status}${code ? ` ${code}` : ""})${message ? `: ${message}` : ""}`,
        classifyFailure(res.status, code, retryAfterMs), res.status, code, retryAfterMs,
      );
    }
    let receipt: Record<string, unknown>;
    try {
      receipt = (await res.json()) as Record<string, unknown>;
    } catch {
      // Accepted without a parseable receipt: treat as retryable; the idempotency key prevents a double send.
      throw new ChannelSendError("Blooio accepted send without a JSON receipt", "retryable", res.status);
    }
    const r = (receipt.data && typeof receipt.data === "object" ? receipt.data : receipt) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : typeof r.message_id === "string" ? r.message_id : undefined;
    if (!id) throw new ChannelSendError("Blooio accepted send without a message id", "retryable", res.status);
    return {
      providerMessageId: id,
      chatId: typeof r.chat_id === "string" ? r.chat_id : chatId ?? undefined,
      status: toStatus(r.status),
      transport: toTransport(r.protocol),
      replayed: res.status === 200,
    };
  }

  async startTyping(chatId: string): Promise<void> {
    await this.#bestEffort(`/chats/${encodeURIComponent(chatId)}/typing`, "POST", { state: "started" });
  }
  async stopTyping(chatId: string): Promise<void> {
    await this.#bestEffort(`/chats/${encodeURIComponent(chatId)}/typing`, "DELETE");
  }
  async markRead(chatId: string): Promise<void> {
    await this.#bestEffort(`/chats/${encodeURIComponent(chatId)}/read`, "POST");
  }

  async #bestEffort(path: string, method: string, body?: unknown): Promise<void> {
    // Typing/read are presentation-only; failures must never break delivery.
    try {
      await this.#fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.#headers(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { /* ignored by design */ }
  }
}
