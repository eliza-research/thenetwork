// Shared types for the single inbox and the notification scheduler
// (docs/research/2026-10-08-entry-flows.md, sections 4 and 5).

/** Where a person can see an update. Channels can push; assistants and the web cannot. */
export type Surface = "imessage" | "sms" | "telegram" | "chatgpt" | "claude" | "grok" | "web";
/** The push channels we control. Every notification goes out on exactly one of these. */
export type Channel = "imessage" | "sms" | "telegram";
/** Hosted assistants we can deep-link into with a prefilled prompt. */
export type Assistant = "chatgpt" | "claude" | "grok";

export const ASSISTANTS: readonly Assistant[] = ["chatgpt", "claude", "grok"];
export const isAssistant = (s: Surface): s is Assistant => (ASSISTANTS as readonly Surface[]).includes(s);

/**
 * urgent: time-sensitive (a plan today, a match waiting for an answer); sent after a short delay.
 * normal: held for a digest.
 * requested: a reminder or logistics message the member asked for; exempt from the weekly cap, not from quiet hours.
 */
export type Urgency = "urgent" | "normal" | "requested";

export interface InboxItemInput {
  personId: string;
  /** App id, for example "ntwrk", "slop", "peon", "friends". */
  app: string;
  /** What happened, for example "intro_proposed", "plan_confirmed", "question". */
  eventType: string;
  /** The thing it is about (opportunity id, plan id). With person, app and eventType it forms the dedupe key. */
  subjectId: string;
  urgency: Urgency;
  /**
   * One member-safe line for the iMessage thread, written by the producer and already leak-checked upstream.
   * It must not name other people beyond what this member may see. Never put into links or prompts.
   */
  summary: string;
  /** Drop the item after this time even if unseen (a plan that already happened). */
  expiresAt?: number;
}

export interface InboxItem extends InboxItemInput {
  id: string;
  dedupeKey: string;
  createdAt: number;
  seenAt?: number;
  seenOn?: Surface;
  notifiedAt?: number;
  deliveryId?: string;
}
