// Server-side policy the host can never override (GW-002, GW-004): risk classes, confirmation
// channel selection, rate limits, and an outbound privacy guard on every tool result.
import type { Clock } from "@thenetwork/core";
import type { PendingConf } from "./schemas.ts";

/** Internal capabilities behind network_talk (PRD 11.2 granular table) and their risk. */
export const CAPABILITY_RISK = {
  get_me: "low",
  search_world: "low",
  find_possibilities: "low",
  ask_for_help: "medium",
  offer_capacity: "medium",
  respond_to_opportunity: "medium",
  propose_introduction: "medium",
  ask_my_network: "medium",
  relay_message: "medium",
  set_state: "medium",
  block: "medium",
  invite: "high",
  share_contact: "high",
  report_safety: "high",
} as const;
export type Capability = keyof typeof CAPABILITY_RISK;

/** What the connected client negotiated at initialize (GW-007). */
export interface ClientCaps {
  formElicitation: boolean;
  urlElicitation: boolean;
}
export const NO_CAPS: ClientCaps = { formElicitation: false, urlElicitation: false };

/**
 * Medium risk: the host may confirm (ideally through MCP elicitation, which the host renders to the
 * human directly rather than letting the model answer). High risk: never confirmable by the host
 * model; the member confirms in a Network-owned channel (SMS/app/web page, or URL-mode elicitation
 * that opens a Network page). A boolean like `authorized: true` set by a model proves nothing.
 */
export function confirmVia(risk: "medium" | "high", caps: ClientCaps): PendingConf["confirm_via"] {
  if (risk === "high") return "network_channel";
  return caps.formElicitation ? "host_elicitation" : "host_respond";
}

export const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  network_talk: { max: 30, windowMs: 10 * 60_000 },
  network_share_context: { max: 10, windowMs: 60 * 60_000 },
  network_get_updates: { max: 60, windowMs: 60 * 60_000 },
  network_respond: { max: 30, windowMs: 60 * 60_000 },
  "*": { max: 150, windowMs: 60 * 60_000 },
};

export class RateLimiter {
  private counts = new Map<string, number>();
  constructor(private clock: Clock, private limits = RATE_LIMITS) {}
  /** Returns seconds until retry when limited, otherwise null (and counts the call). */
  hit(memberId: string, tool: string): number | null {
    for (const key of [tool, "*"]) {
      const lim = this.limits[key];
      if (!lim) continue;
      const bucket = Math.floor(this.clock.now() / lim.windowMs);
      const k = `${memberId}:${key}:${bucket}`;
      const n = (this.counts.get(k) ?? 0) + 1;
      if (n > lim.max) return Math.ceil(((bucket + 1) * lim.windowMs - this.clock.now()) / 1000);
      this.counts.set(k, n);
    }
    return null;
  }
}

const PHONE = /(?:\+?\d[\s().-]?){10,15}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const looksLikeContact = (s: string) => PHONE.test(s) || EMAIL.test(s);
export const looksLikeCredential = (s: string) =>
  /\b(password|passcode|api[_ -]?key|secret|otp|one[- ]time code|sk-[A-Za-z0-9]{8,})\b/i.test(s);
/** Sensitive categories the PRD stores agent-private and wants said to the Network directly (17.1, 17.2). */
export const looksSensitive = (s: string) =>
  /\b(diagnos\w*|pregnan\w*|hiv|therapy|therapist|medication|sexual orientation|immigration status|religio\w*|lonely)\b/i.test(s);

/**
 * Outbound privacy guard (defense in depth behind the Network's own policy): any tool output that
 * contains another member's id, contact details or non-shareable facet text, any internal id, or any
 * phone/email pattern is blocked. Returns the list of violations (empty = clean).
 */
export function findLeaks(serialized: string, forbidden: string[]): string[] {
  const v: string[] = [];
  for (const f of forbidden) if (f && serialized.includes(f)) v.push(`forbidden:${f.slice(0, 12)}`);
  if (PHONE.test(serialized)) v.push("phone_pattern");
  if (EMAIL.test(serialized)) v.push("email_pattern");
  return v;
}
