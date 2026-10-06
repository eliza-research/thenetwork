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

// ---------------------------------------------------------------------------- text folding
// Every deterministic check (input detectors, the profile classifier, the leak guard) runs on folded
// variants of the text so case, Unicode compatibility forms (fullwidth letters), accents, zero-width
// and other format characters, common Cyrillic/Greek homoglyphs, spaced-out letters ("b a r") and
// digit/letter substitutions ("c0cktail") don't slip past a word list. Matching stays fail-closed:
// a false positive costs a polite refusal, a false negative costs a policy breach.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ѕ": "s", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "һ": "h", "ԁ": "d", "ӏ": "l", "ɡ": "g", "ɑ": "a", "ı": "i",
  "α": "a", "β": "b", "ε": "e", "ζ": "z", "η": "n", "ι": "i", "κ": "k", "μ": "m", "ν": "v", "ο": "o", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x", "ϲ": "c", "ϳ": "j",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l" };

function fold(s: string, formatChars: "" | " "): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\p{Cf}/gu, formatChars)
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, (c) => CONFUSABLES[c] ?? c)
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-");
}

/** Folded variants of `s` for contact/identifier checks (no letter substitutions). */
export function plainVariants(s: string): string[] {
  const joined = fold(s, "");
  const out = new Set([joined, fold(s, " ")]);
  // snake_case / kebab-free identifiers: "_" is a word character, so \bcocktail\b misses "cocktail_bar".
  for (const v of [...out]) if (v.includes("_")) out.add(v.replace(/_/g, " "));
  return [...out];
}

/** Folded variants of `s` for vocabulary checks: plain variants + spaced letters collapsed + leetspeak undone. */
export function textVariants(s: string): string[] {
  const out = new Set<string>();
  for (const v of plainVariants(s)) {
    out.add(v);
    const collapsed = v.replace(/\b(?:[a-z][ .\-_*~·]){2,}[a-z]\b/g, (m) => m.replace(/[^a-z]/g, ""));
    out.add(collapsed);
    for (const base of [v, collapsed]) {
      out.add(base.replace(/[a-z0-9@$!|]+/g, (tok) =>
        /[a-z]/.test(tok) && /[0-9@$!|]/.test(tok) ? tok.replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c) : tok));
    }
  }
  return [...out];
}

/** First match of `re` in any variant of `s` (vocabulary checks), or null. */
export function matchFolded(re: RegExp, s: string): string | null {
  for (const v of textVariants(s)) {
    const m = re.exec(v);
    if (m) return m[0];
  }
  return null;
}
const anyFolded = (re: RegExp, s: string) => matchFolded(re, s) !== null;
const anyPlain = (re: RegExp, s: string) => plainVariants(s).some((v) => re.test(v));

// ---------------------------------------------------------------------------- input detectors (§8.3)
// Digits separated by up to three spaces, dots, dashes or brackets: "(415) 555-0102", "+1 415 555 0102".
const PHONE = /(?:\+?\d[\s().\-\/]{0,3}){9,14}\d/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// "maya [at] example [dot] test", "maya at example dot test".
const EMAIL_SPELLED = /\b[a-z0-9._%+-]{1,64}[\s([{]{1,3}at[\s)\]}]{1,3}[a-z0-9-]{1,63}[\s([{]{1,3}dot[\s)\]}]{1,3}[a-z]{2,10}\b/i;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
const HANDLE = /(^|\s)@[a-z0-9_]{2,}/i;
export const looksLikePhoneOrEmail = (s: string) => anyPlain(PHONE, s) || anyPlain(EMAIL, s) || anyPlain(EMAIL_SPELLED, s);
export const looksLikeContact = (s: string) => looksLikePhoneOrEmail(s) || anyPlain(URL_RE, s) || anyPlain(HANDLE, s);
export const looksLikeCredential = (s: string) =>
  anyFolded(/\b(password|passcode|api[_ -]?key|secret|otp|one[- ]time code|sk-[a-z0-9]{8,})\b/, s);
/** Special-category data the member should tell the Network directly (PRD 17.1, 17.2; design §5.5). */
export const looksSensitive = (s: string) =>
  anyFolded(/\b(diagnos\w*|pregnan\w*|hiv|therapy|therapist|medication|disabilit\w*|sexual\w*|gay|lesbian|bisexual|transgender|religio\w*|church|mosque|synagogue|immigration status|lonely|depress\w*|anxiety)\b/, s);
/** Third-party facts: "my friend Jo …", "my sister's …", "Sam is …". */
export const looksAboutSomeoneElse = (s: string) =>
  anyFolded(/\b(my|his|her|their) (friend|sister|brother|mom|mother|dad|father|wife|husband|partner|boss|colleague|coworker|roommate|ex|kid|son|daughter)\b/, s) ||
  /\b[A-Z][a-z]+'s (number|phone|email|address|health|diagnosis|job|salary|divorce|birthday|kids?)\b/.test(s.normalize("NFKC"));
/** Street-level location (design §5.5: city and neighborhood only). */
export const looksLikeStreetAddress = (s: string) =>
  anyPlain(/\b\d{1,6}\s+[a-z0-9.]+(\s+[a-z0-9.]+)*\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place)\b/, s) ||
  anyPlain(/\b\d{5}(-\d{4})?\b/, s);
/** Romance/dating intent: never through any connector, adult-only inside the Network (§7.2). */
export const looksRomantic = (s: string) =>
  anyFolded(/\b(date|dates|dating|romance|romantic|girlfriend|boyfriend|hook ?up|single (men|women|people)|find (me )?(a|someone to) (date|love))\b/, s);
export const looksNightlife = (s: string) =>
  anyFolded(/\b(bars?|pubs?|nightlife|night ?clubs?|clubbing|cocktails?|happy hour|drinks|brewery|breweries|wine bar|beer|booze|alcohol)\b|(?<![\w+])21 ?(\+|plus\b)|\b(over|ages?) ?21\b|\b21 (and|&) (over|up|older)\b/, s);

// ---------------------------------------------------------------------------- outbound guard (§8.2)
const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");

/**
 * Defense in depth behind the Network's own policy: any model-visible output containing another
 * member's id, contact details or non-shareable facet text, an internal id, or a phone/email pattern
 * is blocked. `text` is the raw model-visible strings (never a JSON serialization: JSON escapes
 * quotes and newlines, so a forbidden string containing either would never match). Forbidden strings
 * match case-, Unicode- and punctuation-insensitively. Returns the violations (empty = clean).
 */
export function findLeaks(text: string, forbidden: string[]): string[] {
  const v: string[] = [];
  const variants = plainVariants(text);
  const squashed = variants.map(squash);
  for (const f of forbidden) {
    if (!f) continue;
    const [ff] = plainVariants(f);
    const sf = squash(ff!);
    if (variants.some((t) => t.includes(ff!)) || (sf.length >= 6 && squashed.some((t) => t.includes(sf))))
      v.push(`forbidden:${f.slice(0, 12)}`);
  }
  if (variants.some((t) => PHONE.test(t))) v.push("phone_pattern");
  if (variants.some((t) => EMAIL.test(t) || EMAIL_SPELLED.test(t))) v.push("email_pattern");
  if (variants.some((t) => INTERNAL_ID.test(t))) v.push("internal_id");
  if (variants.some((t) => ISO_TIMESTAMP.test(t))) v.push("iso_timestamp");
  return v;
}

/** Internal identifiers and ISO timestamps that must never be in model-visible content (§5.1). */
export const INTERNAL_ID = /\b(mem|opp|act|rcp|grt|prp|dcr)_[a-z0-9]+/i;
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i;
