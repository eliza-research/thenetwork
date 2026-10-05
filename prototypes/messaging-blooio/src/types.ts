// Channel-agnostic message types. Blooio and the simulated bus both speak these,
// so the gateway, queue, and tests never depend on a specific provider.

/** Minimal clock contract; structurally compatible with @thenetwork/core Clock/SimClock. */
export interface Clock { now(): number }

export type ChannelKind = "blooio" | "sim" | "twilio";
export type Transport = "imessage" | "sms" | "rcs" | "pending" | "unknown" | "sim";

/** A normalized inbound message from any channel. */
export interface InboundMessage {
  kind: "message";
  channel: ChannelKind;
  /** Stable provider message id (dedupe key for the message itself). */
  messageId: string;
  /** Webhook envelope/event id; identical across provider retries and replays. */
  eventId?: string;
  /** The other party (E.164 or Apple ID email). */
  from: string;
  /** Our own line that received it. */
  to: string | null;
  chatId: string;
  isGroup: boolean;
  groupId?: string;
  text: string;
  mediaUrls: string[];
  transport: Transport;
  replyToMessageId?: string;
  receivedAt: number;
}

export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

/** A normalized lifecycle update for something we sent. */
export interface StatusUpdate {
  kind: "status";
  channel: ChannelKind;
  eventId?: string;
  providerMessageId: string;
  chatId?: string;
  status: DeliveryStatus;
  transport?: Transport;
  errorCode?: string;
  errorMessage?: string;
  at: number;
}

export interface TypingUpdate {
  kind: "typing";
  channel: ChannelKind;
  eventId?: string;
  chatId: string;
  from: string;
  state: "started" | "stopped";
  at: number;
}

/** Number-level messaging-safety changes (Blooio `safety.state_changed` / `safety.number_banned`). */
export interface SafetyUpdate {
  kind: "safety";
  channel: ChannelKind;
  eventId?: string;
  type: string;
  action?: string;
  previousAction?: string;
  reasons?: Record<string, unknown>;
  line?: string;
  at: number;
}

/** A tapback from the other party. Blooio counts it as engagement that resets conversation allowances. */
export interface ReactionUpdate {
  kind: "reaction";
  channel: ChannelKind;
  eventId?: string;
  chatId: string;
  from: string;
  reaction: string;
  targetMessageId?: string;
  at: number;
}

export interface IgnoredEvent { kind: "ignored"; eventId?: string; type: string; reason: string }

export type ChannelEvent = InboundMessage | StatusUpdate | TypingUpdate | SafetyUpdate | ReactionUpdate | IgnoredEvent;

export interface SendRequest {
  /** Our sender line. Omit to let the provider pick (Blooio sticks to the prior line per contact). */
  from?: string;
  /** E.164 number, Apple ID email, or `chat:<chatId>` to post into an existing chat (needed for groups). */
  to: string;
  text: string;
  mediaUrls?: string[];
  /** Same key => provider will not send twice (Blooio honours Idempotency-Key on sends). */
  idempotencyKey: string;
}

export interface SendReceipt {
  providerMessageId: string;
  chatId?: string;
  status: DeliveryStatus;
  transport?: Transport;
  /** True when the provider returned the original result for a replayed idempotency key. */
  replayed?: boolean;
}

/**
 * Why a send failed, in terms the queue can act on.
 * - retryable: transient (network, 5xx, 503 no sender). Back off and retry with the SAME idempotency key.
 * - await_recipient: Blooio conversation limit (429 conversation_*). Retrying on a timer is wrong; wait for an inbound.
 * - blocked: number-level protection or policy (403 safety_*, opted out, emergency number). Do not retry; alert.
 * - invalid: our request is wrong (400/404/409/422). Do not retry.
 * - auth: 401/403 credential problems.
 */
export type FailureClass = "retryable" | "await_recipient" | "blocked" | "invalid" | "auth";

export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly failure: FailureClass,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

/** Everything the gateway needs from a channel. Blooio and the in-memory bus both implement it. */
export interface ChannelAdapter {
  readonly kind: ChannelKind;
  send(req: SendRequest): Promise<SendReceipt>;
  /** Best-effort UX affordances; must never throw into the delivery path. */
  startTyping?(chatId: string): Promise<void>;
  stopTyping?(chatId: string): Promise<void>;
  markRead?(chatId: string): Promise<void>;
}
