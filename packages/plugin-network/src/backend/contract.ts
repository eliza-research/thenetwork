/**
 * Wire contract between the Eliza side (gateway + shared agent + plugin-network) and the Network
 * service (docs/design/eliza-conversation-layer.md). Dependency-free so the Cloud copy of this
 * package and the service read the same file. Every request is signed with svc-auth.ts.
 *
 *   POST /internal/turn     Eliza → service   one inbound message on the shared line
 *   POST /internal/deliver  service → Eliza   a message the service wants sent (proactive, relay)
 */

/** Mirrors APP_IDS in packages/platform/src/apps.ts (kept literal: this file has no imports). */
export type NetworkAppId = "ntwrk" | "slop" | "peon" | "friends";
export type NetworkTransport = "imessage" | "sms" | "rcs" | "unknown";

export const TURN_PATH = "/internal/turn";
export const DELIVER_PATH = "/internal/deliver";

export interface TurnRequest {
  /** The provider message id (Blooio msg_… / Twilio SM…). Idempotency key: a replay returns the stored result and runs nothing. */
  messageId: string;
  channel: "blooio" | "twilio";
  /** Sender, E.164. */
  from: string;
  /** The line it arrived on, E.164 (routes per-app lines). */
  to: string | null;
  text: string;
  transport: NetworkTransport;
  /** ms since epoch, from the provider. */
  receivedAt: number;
  /** Forced app (a per-app line or webhook path); normally absent and the service routes. */
  app?: NetworkAppId;
}

/** What the agent may say about the member in an open turn: shareable, already leak-checked by the service. */
export interface TurnContext {
  firstName: string | null;
  city: string | null;
  state: "open" | "busy" | "traveling" | "paused";
  stateFrom: string | null;
  stateUntil: string | null;
  facets: string[];
  /** Open items (an intro waiting on a yes, a plan), member-safe one-liners. */
  activeItems: Array<{ id: string; kind: string; summary: string }>;
  /** True while the member is a minor: single-player help only, never introductions. */
  singlePlayer: boolean;
}

export type TurnResponse =
  /** The service answered deterministically (STOP, HELP, START, leave, join, looking-for, onboarding, read-back, SHARE, yes/no). Send exactly these; call no model. May be empty (nothing to say, e.g. a held number). */
  | { outcome: "handled"; replies: string[]; app: NetworkAppId | null; memberId: string | null; reason: string }
  /** Free conversation: the agent replies, with this context and the plugin's actions. */
  | { outcome: "open"; app: NetworkAppId; memberId: string; context: TurnContext }
  /** The service will not handle this sender (no network for the app, unknown sender). The agent says nothing Network-specific. */
  | { outcome: "ignored"; reason: string };

export interface DeliverRequest {
  /** Idempotency key (also x-ntwrk-svc-id). The gateway sends each key at most once. */
  id: string;
  to: string;
  /** Sending line, E.164; absent = the shared line. */
  from?: string | null;
  text: string;
  app: NetworkAppId;
  memberId: string | null;
  /** reply: answer to an inbound; proactive: an intro, reminder or check-in (quiet hours and caps already applied by the service); relay: another member's message, `rendered` only. */
  kind: "reply" | "proactive" | "relay";
}

export type DeliverResponse =
  | { ok: true; status: "queued" | "sent" | "duplicate"; providerMessageId?: string }
  | { ok: false; error: "opted_out" | "invalid" | "unavailable" };
