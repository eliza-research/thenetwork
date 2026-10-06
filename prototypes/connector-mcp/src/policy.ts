// Server-side policy the host can never override (GW-002, GW-004; design §6, §8): risk tiers,
// confirmation channel, rate limits, input detectors and the outbound privacy guard.
import type { Clock } from "@thenetwork/core";

/**
 * Risk tiers (design §6.1). The tier is set here, never by the host or the agent's prose.
 *  0: reads, maybe_later, tell_me_more, drafts, profile proposals, adding availability → immediate
 *  1: interested / not_for_me, submitting a request, changing participation state, cancelling own
 *     request → immediate through respond_to_network_item (destructive → host prompts); from
 *     tell_network_agent it becomes a pending confirmation answered via respond
 *  2: first consequential action from a new grant (first 24 h), any tier-1 action from an
 *     unverified client → out-of-band confirmation in the Network's own channel
 *  3: relay, share contact, invitations, safety reports, romance/home entry/money, scheduling that
 *     commits others → ALWAYS out-of-band; a host "confirm" never executes it
 */
export type Tier = 0 | 1 | 2 | 3;

export type ActionKind =
  | "submit_request" | "set_state" | "cancel_request"
  | "respond_interested" | "respond_not_for_me" | "respond_confirm_item"
  | "relay_message" | "share_contact" | "invite" | "safety_report";

export const ACTION_TIER: Record<ActionKind, Tier> = {
  submit_request: 1,
  set_state: 1,
  cancel_request: 1,
  respond_interested: 1,
  respond_not_for_me: 1,
  respond_confirm_item: 1,
  relay_message: 3,
  share_contact: 3,
  invite: 3,
  safety_report: 3,
};

export const NEW_GRANT_WINDOW_MS = 24 * 3600_000;

/** Escalates tier 1 to tier 2 for new grants and unverified clients (design §6.1). */
export function effectiveTier(base: Tier, p: { trustTier: "verified" | "unverified"; grantCreatedAt: number; hasPriorConsequentialAction: boolean }, now: number): Tier {
  if (base !== 1) return base;
  if (p.trustTier === "unverified") return 2;
  if (now - p.grantCreatedAt < NEW_GRANT_WINDOW_MS && !p.hasPriorConsequentialAction) return 2;
  return 1;
}

export const confirmationTtlMs = (tier: Tier) => (tier >= 3 ? 24 * 3600_000 : 30 * 60_000);

// ---------------------------------------------------------------------------- rate limits (§8.4)
interface Limit { max: number; windowMs: number }
export const RATE_LIMITS = {
  /** per member across all grants: ask + tell (agent turns cost money) */
  agent_turns: { max: 30, windowMs: 3600_000 },
  /** per member across all grants: all writes */
  writes: { max: 60, windowMs: 24 * 3600_000 },
  /** per member: share_profile_with_network */
  share_profile: { max: 5, windowMs: 24 * 3600_000 },
  /** per grant */
  grant_minute: { max: 60, windowMs: 60_000 },
  grant_day: { max: 600, windowMs: 24 * 3600_000 },
} satisfies Record<string, Limit>;
export type LimitName = keyof typeof RATE_LIMITS;

export class RateLimiter {
  private counts = new Map<string, number>();
  constructor(private clock: Clock, private limits: Record<LimitName, Limit> = RATE_LIMITS) {}
  /** Checks all (limit, subject) pairs; counts only if none is exceeded. Returns retry seconds or null. */
  hit(checks: [LimitName, string][]): number | null {
    const now = this.clock.now();
    const keys: string[] = [];
    for (const [name, subject] of checks) {
      const lim = this.limits[name];
      const bucket = Math.floor(now / lim.windowMs);
      const k = `${name}:${subject}:${bucket}`;
      if ((this.counts.get(k) ?? 0) + 1 > lim.max) return Math.max(1, Math.ceil(((bucket + 1) * lim.windowMs - now) / 1000));
      keys.push(k);
    }
    for (const k of keys) this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    return null;
  }
}

// ---------------------------------------------------------------------------- input detectors (§8.3)
const PHONE = /(?:\+?\d[\s().-]?){10,15}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
const HANDLE = /(^|\s)@[A-Za-z0-9_]{2,}/;
export const looksLikeContact = (s: string) => PHONE.test(s) || EMAIL.test(s) || URL_RE.test(s) || HANDLE.test(s);
export const looksLikeCredential = (s: string) =>
  /\b(password|passcode|api[_ -]?key|secret|otp|one[- ]time code|sk-[A-Za-z0-9]{8,})\b/i.test(s);
/** Special-category data the member should tell the Network directly (PRD 17.1, 17.2; design §5.5). */
export const looksSensitive = (s: string) =>
  /\b(diagnos\w*|pregnan\w*|hiv|therapy|therapist|medication|disabilit\w*|sexual\w*|gay|lesbian|bisexual|transgender|religio\w*|church|mosque|synagogue|immigration status|lonely|depress\w*|anxiety)\b/i.test(s);
/** Third-party facts: "my friend Jo …", "my sister's …", "Sam is …". */
export const looksAboutSomeoneElse = (s: string) =>
  /\b(my|his|her|their) (friend|sister|brother|mom|mother|dad|father|wife|husband|partner|boss|colleague|coworker|roommate|ex|kid|son|daughter)\b/i.test(s) ||
  /\b[A-Z][a-z]+'s (number|phone|email|address|health|diagnosis|job|salary|divorce|birthday|kids?)\b/.test(s);
/** Street-level location (design §5.5: city and neighborhood only). */
export const looksLikeStreetAddress = (s: string) =>
  /\b\d{1,6}\s+[A-Za-z0-9.]+(\s+[A-Za-z0-9.]+)*\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place)\b/i.test(s) ||
  /\b\d{5}(-\d{4})?\b/.test(s);
/** Romance/dating intent: never through any connector, adult-only inside the Network (§7.2). */
export const looksRomantic = (s: string) =>
  /\b(date|dates|dating|romance|romantic|girlfriend|boyfriend|hook ?up|single (men|women|people)|find (me )?(a|someone to) (date|love))\b/i.test(s);
export const looksNightlife = (s: string) =>
  /\b(bars?|pubs?|nightlife|night ?clubs?|clubbing|cocktails?|happy hour|drinks|brewery|wine bar|21\+)\b/i.test(s);

// ---------------------------------------------------------------------------- outbound guard (§8.2)
/**
 * Defense in depth behind the Network's own policy: any model-visible output containing another
 * member's id, contact details or non-shareable facet text, an internal id, or a phone/email pattern
 * is blocked. Returns the violations (empty = clean).
 */
export function findLeaks(serialized: string, forbidden: string[]): string[] {
  const v: string[] = [];
  for (const f of forbidden) if (f && serialized.includes(f)) v.push(`forbidden:${f.slice(0, 12)}`);
  if (PHONE.test(serialized)) v.push("phone_pattern");
  if (EMAIL.test(serialized)) v.push("email_pattern");
  return v;
}

/** Internal identifiers and ISO timestamps that must never be in model-visible content (§5.1). */
export const INTERNAL_ID = /\b(mem|opp|act|rcp|grt|prp)_[A-Za-z0-9]+/;
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
