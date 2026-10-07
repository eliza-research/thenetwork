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

/**
 * An age the member states about themselves ("I'm 12", "I am 12 years old", "I was born in 2015"),
 * or null. Used to decline under-13s kindly before anything is stored (core MIN_MEMBER_AGE).
 */
const AGE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
export function statedAge(s: string, currentYear: number): number | null {
  const t = s.normalize("NFKC").toLowerCase();
  const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : AGE_WORDS[x] ?? NaN);
  const WORDS = "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)";
  const NOT_AGE = "(?!\\s*(?:%|'|am\\b|pm\\b|min|minutes?|hours?|hrs?|days?|weeks?|months?|miles?|mi\\b|km|blocks?|times?|people|friends?|kids?|dollars?|bucks|\\$|-?ish\\b|:|\\.\\d))";
  // First person only, so "my son is 12" or "climbing for 12 years" never decline the member.
  // Digits: "I'm 12", "I am 12 years old". Number words need "years old": "I'm one of the hosts" is not an age.
  const m = new RegExp(`\\b(?:i'?m|i am|im|my age is)\\s+(\\d{1,2})\\b${NOT_AGE}`).exec(t)
    ?? new RegExp(`\\b(?:i'?m|i am|im|my age is)\\s+${WORDS}(?:\\s+|-)(?:years?|yrs?)(?:\\s+|-)old\\b`).exec(t);
  if (m) { const n = num(m[1]!); if (Number.isFinite(n)) return n; }
  const born = /\b(?:i was|i'?m|i am)\s+born\s+(?:in\s+)?((?:19|20)\d{2})\b/.exec(t);
  if (born) { const age = currentYear - Number(born[1]); if (age >= 0 && age < 120) return age; }
  return null;
}

// ---------------------------------------------------------------------------- outbound guard (§8.2)
const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");

/**
 * Defense in depth behind the Network's own policy: any model-visible output containing another
 * member's id, contact details or non-shareable facet text, an internal id, or a phone/email pattern
 * is blocked. `text` is the raw model-visible strings (never a JSON serialization: JSON escapes
 * quotes and newlines, so a forbidden string containing either would never match). Forbidden strings
 * match case-, Unicode- and punctuation-insensitively. Returns the violations (empty = clean).
 */
export function findLeaks(text: string, forbidden: string[], opts: { facts?: string[] } = {}): string[] {
  const v: string[] = [];
  const variants = plainVariants(text);
  const squashed = variants.map(squash);
  for (const f of forbidden) {
    if (!f) continue;
    const [ff] = plainVariants(f);
    const sf = squash(ff!);
    if (variants.some((t) => t.includes(ff!)) || (sf.length >= 6 && squashed.some((t) => t.includes(sf))))
      v.push(`forbidden:${labelHash(f)}`);
  }
  // Private facts also match on fragments, leetspeak and reordering (audit P1-3).
  const facts = (opts.facts ?? []).filter((f) => f && !v.includes(`forbidden:${labelHash(f)}`));
  if (facts.length) {
    const textTokens = textVariants(text).map(tokens);
    const textSquashed = textVariants(text).map(squash);
    for (const f of facts) if (factLeaks(f, textTokens, textSquashed)) v.push(`forbidden:${labelHash(f)}`);
  }
  if (variants.some((t) => PHONE.test(t))) v.push("phone_pattern");
  if (variants.some((t) => EMAIL.test(t) || EMAIL_SPELLED.test(t))) v.push("email_pattern");
  if (variants.some((t) => INTERNAL_ID.test(t))) v.push("internal_id");
  if (variants.some((t) => ISO_TIMESTAMP.test(t))) v.push("iso_timestamp");
  return v;
}

// ---------------------------------------------------------------------------- fuzzy private-fact matching
// Exact matching misses a fragment ("isolated since the move"), leetspeak ("1s0lated") and reordering
// ("the move left me isolated"). For private facts we compare light-stemmed word tokens of the folded
// text: a fact leaks if (a) its canary-stripped body appears squashed, (b) any word 3-gram of the fact
// with at least two content words appears, or (c) a window of the output contains enough of the fact's
// distinct content words (2 of 2-3, else 60%). Fail-closed: a false positive costs a polite fallback.

const STOPWORDS = new Set((
  "a an and are as at be been but by for from had has have he her hers him his i if in into is it its me my mine " +
  "of on or our ours she so than that the their them they this to too up us was we were what when where which " +
  "who will with you your yours since about after before just very really more most some any all not no out over"
).split(" "));

/** Light suffix stemmer: "isolated"/"isolation"/"isolating" → "isolat", "moved"/"moving"/"move" → "mov". */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  for (const suf of ["ingly", "edly", "ions", "ing", "ion", "ies", "ied", "ed", "es", "ly", "s", "e"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      let r = w.slice(0, -suf.length);
      if (r.length > 3 && r.at(-1) === r.at(-2) && !/[aeiou]/.test(r.at(-1)!)) r = r.slice(0, -1); // "stopp" → "stop"
      return r;
    }
  }
  return w;
}

// Stopwords are kept (for n-grams) but marked with "~" and never stemmed or counted as content.
const tokens = (s: string): string[] => s.split(/[^a-z0-9]+/).filter(Boolean).map((w) => (STOPWORDS.has(w) ? `~${w}` : stem(w)));
const isContent = (t: string) => t.length >= 3 && !t.startsWith("~");
/** Strip a seeded canary prefix ("canary_maya_private_") so the fact's real words are what's matched. */
const factBody = (f: string) => plainVariants(f)[0]!.replace(/^canary_[a-z0-9]+_[a-z]+_/, "");

function factLeaks(fact: string, textTokens: string[][], textSquashed: string[]): boolean {
  const body = factBody(fact);
  const sb = squash(body);
  if (sb.length >= 8 && textSquashed.some((t) => t.includes(sb))) return true;
  const ft = tokens(body);
  const content = [...new Set(ft.filter(isContent))];
  if (content.length < 2) return false; // one-word facts: exact/squashed match only
  // (b) word 3-grams of the fact with at least two content words.
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= ft.length; i++) {
    const g = ft.slice(i, i + 3);
    if (g.filter(isContent).length >= 2) grams.add(g.join(" "));
  }
  const need = content.length <= 3 ? 2 : Math.ceil(0.6 * content.length);
  const window = Math.max(12, 3 * content.length);
  const want = new Set(content);
  for (const tt of textTokens) {
    if (grams.size) for (let i = 0; i + 3 <= tt.length; i++) if (grams.has(tt.slice(i, i + 3).join(" "))) return true;
    // (c) sliding window: count distinct fact content words present.
    const counts = new Map<string, number>();
    let distinct = 0;
    for (let i = 0; i < tt.length; i++) {
      const add = tt[i]!;
      if (want.has(add)) { const c = counts.get(add) ?? 0; if (c === 0) distinct++; counts.set(add, c + 1); }
      const drop = i - window >= 0 ? tt[i - window]! : undefined;
      if (drop !== undefined && want.has(drop)) { const c = counts.get(drop)! - 1; counts.set(drop, c); if (c === 0) distinct--; }
      if (distinct >= need) return true;
    }
  }
  return false;
}

/** Short non-reversible label for audit logs: never log the blocked value itself (audit P2-24). */
function labelHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Internal identifiers and ISO timestamps that must never be in model-visible content (§5.1). */
export const INTERNAL_ID = /\b(mem|opp|act|rcp|grt|prp|dcr)_[a-z0-9]+/i;
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i;
