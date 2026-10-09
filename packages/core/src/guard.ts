// Outbound leak and contact guard (PRD 28.5, 32.14: "leak checks on every outbound message").
// Deterministic, no model. Every message the Network sends goes through `LeakGuard.check` (or
// `findLeaks`) right before it leaves; a violation means the message is not sent as written.
// This is the one shared guard (the 2026-10-07 consolidation review, summarized in docs/results/SUMMARY.md): the engine's
// member-facing gates, the MCP connector's output guard and the Blooio outbound queue all call it.
//
// What it catches:
//  - contact details: phone numbers, emails (also spelled out: "sam at mail dot com"), street
//    addresses, URLs and bare domains, @handles;
//  - canary tokens (simulator privacy canaries), anywhere in the text;
//  - forbidden strings (other members' agent-private facts), matched whole or by any run of 4+ of
//    their words, so a paraphrased fragment ("going through a divorce") is caught, not only the
//    exact string;
//  - private facts (`facts`, or every forbidden string with `fuzzy: true`): additionally matched on
//    fragments, inflections, leetspeak and reordering (word 3-grams of light-stemmed tokens and a
//    sliding window of the fact's content words; from prototypes/connector-mcp, audit P1-3);
//  - exact strings (`exact`: ids, names, contact values): any substring, also with punctuation and
//    spaces squashed out when 6+ characters long;
//  - private vocabulary (single words or phrases that must never appear);
//  - photo ratings (`ratings`: slop:rating:* and appearance:* facet tags): the tag, its key=value and
//    its number never appear, and while any rating exists, rating and percentile phrases are refused.
//  - sensitive terms (SENSITIVE_TERMS: health, sexuality, recovery, religion, legal, immigration...)
//    inside any forbidden string or fact, matched as whole words on their own, however short the
//    fact is ("gay", "HIV+", "AA", "IVF", "sober"; audit core-1). One- and two-word facts with no
//    sensitive term stay too generic to match on their own.
// Matching runs on folded text (NFKC, lowercase, no diacritics, homoglyphs mapped to a Latin skeleton
// (Cyrillic, Greek, Armenian, Cherokee, small capitals, IPA, regional indicators), all punctuation and
// whitespace collapsed to one space, letters and digits of every script kept), so "Ｄivorce",
// "dívorce", "ᴅɪᴠᴏʀᴄᴇ" and "divorce," match, and non-Latin facts are protected too (audit core-3).
// Contact checks also run on variants with number words, other-script digits, letter O/l inside
// numbers, spaced "@" and ".", and spelled "at"/"dot" normalized (audit core-2).
// Forbidden strings, facts, vocabulary and canaries are also matched on variants with spaced-out
// letters collapsed ("d i v o r c e") and digit/symbol substitutions undone ("d1v0rce").
// Reasons never contain the matched text (logs must not carry the private value): matches are
// reported as a short hash.

const CONFUSABLES: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ѕ": "s", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "һ": "h", "ԁ": "d", "ӏ": "l", "ɡ": "g", "ɑ": "a", "ı": "i",
  "α": "a", "β": "b", "ε": "e", "ζ": "z", "η": "n", "ι": "i", "κ": "k", "μ": "m", "ν": "v", "ο": "o", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x", "ϲ": "c", "ϳ": "j",
  // Small capitals and IPA letters (no NFKC decomposition).
  "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f", "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m",
  "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ʀ": "r", "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z", "ɩ": "i", "ʋ": "u",
  "ɛ": "e", "ɔ": "c", "ɾ": "r", "ʃ": "s",
  // Latin letters with a stroke or bar (no NFKD decomposition) and ligatures.
  "ø": "o", "ł": "l", "đ": "d", "ħ": "h", "ŧ": "t", "ƀ": "b", "ɨ": "i", "ʉ": "u", "ƶ": "z", "ǥ": "g", "ß": "ss", "æ": "ae", "œ": "oe",
  // Armenian look-alikes.
  "օ": "o", "ս": "u", "հ": "h", "ո": "n", "ց": "g", "զ": "q", "ա": "w", "ք": "p",
  // Other Cyrillic and Greek look-alikes.
  "ԛ": "q", "ԝ": "w", "ѵ": "v", "ү": "y", "ҽ": "e", "ɼ": "r", "ϻ": "m", "ω": "w", "ϱ": "p", "ϑ": "o",
};
// Cherokee capitals look like Latin capitals; toLowerCase maps them to Cherokee small letters.
for (const [c, l] of Object.entries({ "Ꭰ": "d", "Ꭱ": "r", "Ꭲ": "t", "Ꭵ": "i", "Ꭺ": "a", "Ꭻ": "j", "Ꭼ": "e", "Ꮃ": "w", "Ꮇ": "m", "Ꮋ": "h", "Ꮐ": "g", "Ꮓ": "z", "Ꮟ": "b", "Ꮤ": "w", "Ꮩ": "v", "Ꮪ": "s", "Ꮯ": "c", "Ꮮ": "l", "Ꮲ": "p", "Ꮶ": "k", "Ᏼ": "b", "Ꮻ": "o", "Ꭹ": "y", "Ꮍ": "y" })) {
  CONFUSABLES[c.toLowerCase()] = l;
}
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l" };

/**
 * NFKC, lowercase, diacritics removed, homoglyphs mapped. Punctuation kept. Format characters
 * (zero-width and similar) are removed, or replaced by `formatChars`.
 */
function plain(s: string, formatChars: "" | " " = ""): string {
  if (!/[^\u0000-\u007f]/.test(s)) return s.toLowerCase(); // ASCII: normalization is the identity
  return s
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, c => String.fromCharCode(97 + c.codePointAt(0)! - 0x1f1e6)) // regional indicators 🇩🇮 → "di"
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\p{Cf}/gu, formatChars)
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, c => CONFUSABLES[c] ?? c)
    .replace(/[‐-―−﹘﹣－]/g, "-");
}

// Letters and digits of every script are kept (audit core-3: deleting non-table letters let
// "divօrce" with an Armenian o through, and compiled non-Latin facts to nothing).
const collapse = (p: string) => p.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const squash = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** Folded text for phrase matching: `plain` plus every run of punctuation/whitespace collapsed to one space. */
export function fold(text: string): string {
  return collapse(plain(text));
}

/** Folded variants of `s` for contact/identifier checks (no letter substitutions); punctuation kept. */
export function plainVariants(s: string): string[] {
  const out = new Set([plain(s), plain(s, " ")]);
  // snake_case identifiers: "_" is a word character, so \bcocktail\b misses "cocktail_bar".
  for (const v of [...out]) if (v.includes("_")) out.add(v.replace(/_/g, " "));
  return [...out];
}

/** Folded variants of `s` for vocabulary checks: plain variants + spaced letters collapsed + leetspeak undone. */
export function textVariants(s: string): string[] {
  const out = new Set<string>();
  for (const v of plainVariants(s)) {
    out.add(v);
    const collapsed = v.replace(/\b(?:[a-z][ .\-_*~·]){2,}[a-z]\b/g, m => m.replace(/[^a-z]/g, ""));
    out.add(collapsed);
    // Punctuation, symbols or emoji inside a word removed: "di-vorce", "di💔vorce", "d.i.v.o.r.c.e" (core-15).
    out.add(v.replace(/(?<=\p{L})[^\p{L}\p{N}\s]+(?=\p{L})/gu, ""));
    for (const base of new Set([v, collapsed])) {
      if (/[0-9@$!|]/.test(base)) out.add(base.replace(/[a-z0-9@$!|]+/g, tok =>
        /[a-z]/.test(tok) && /[0-9@$!|]/.test(tok) ? tok.replace(/[0-9@$!|]/g, c => LEET[c] ?? c) : tok));
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

/** `textVariants` with punctuation collapsed (what forbidden strings, facts, vocabulary and canaries match against). */
export function foldedVariants(s: string): string[] {
  return [...new Set(textVariants(s).map(collapse))];
}

const TLDS = "com|co|io|ly|net|org|app|xyz|biz|me|link|gg|info|us|dev|ai|so|page|site|online|store|shop|club|live|tv|fm|to|cc|ca|uk|de|fr|es|it|nl|eu|au|in|mx|br|tech|life|world|blog|social|chat|zone|one|fun|art|bio|lol|wtf|vip|pro|nyc|la|sf|email|mail|cash|money|pay|bz|gl|im|is|ms|ws|fyi|space|website|top|icu|vercel|netlify|substack|onion";

/** Contact-detail patterns, run on `plain` text (punctuation kept) and on the contact variants (`contactVariants`). */
export const CONTACT_PATTERNS: { name: string; re: RegExp }[] = [
  // Digits separated by up to three spaces, dots, dashes or brackets: "(212) 555-0102", "+1 212 555 0102".
  // Order numbers, year lists and other non-phones are filtered out in `isPhone`.
  { name: "phone", re: /(?:\+?\d[\s().\-\/_x]{0,3}){9,14}\d/g },
  // A 7-digit local number: "555-0102", "555 0102", "5550102" (core-2).
  { name: "phone", re: /(?<![\d#])(?:\d[\s.\-_]{0,2}){6}\d(?![\s.\-_]{0,2}\d)/g },
  // Bounded quantifiers: linear time on adversarial input (core-7).
  { name: "email", re: /(?<![a-z0-9._%+-])[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,24}(?![a-z])/ },
  // "sam@gmail", "sam at gmail" (well-known providers need no TLD).
  { name: "email", re: /\b[a-z0-9._%+-]{1,64}\s{0,3}@\s{0,3}(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|icloud|protonmail|proton|aol|gmx|yandex|fastmail)\b|\b[a-z0-9._%+-]{2,64}\s{0,3}(?:\(at\)|\[at\]|\bat\b)\s{0,3}(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|icloud|protonmail|proton|aol|gmx|yandex|fastmail)(?=\s*(?:$|[.,;!?)]|dot\b|com\b))/ },
  // "maya at example dot com", "maya [at] example [dot] com".
  { name: "email_spelled", re: /\b[a-z0-9._%+-]{1,64}[\s([{]{1,3}at[\s)\]}]{1,3}[a-z0-9-]{1,63}(?:[\s([{]{1,3}dot[\s)\]}]{1,3}[a-z0-9-]{1,63}){0,4}[\s([{]{1,3}dot[\s)\]}]{1,3}[a-z]{2,10}\b/ },
  // "123 Bedford Ave", "40 W 25th St" (a number, one to three words, a street suffix).
  // Not a time ("7 PM at St. Mary's Park") and no preposition in between.
  { name: "street_address", re: /\b\d{1,5}(?!\s*(?:am|pm|a\.m|p\.m|:\d))(?:\s+(?!(?:at|in|on|near|by|to|from)\b)[a-z0-9.]+){1,3}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|ter|terrace|pkwy|parkway)\b/ },
  { name: "url", re: new RegExp(`\\b(?:https?|hxxps?|h\\*\\*ps?):\\/\\/\\S+|\\bwww\\.\\S+|\\b[a-z0-9][a-z0-9-]*\\.(?:${TLDS})\\b(?:\\/\\S*)?`) },
  // "@samlee", "dm me@samlee" (an @ inside a word but not an email).
  { name: "handle", re: /(?:^|[^a-z0-9._%+-])@[a-z0-9_][a-z0-9_.]{1,29}|[a-z0-9]@[a-z0-9_]{2,30}(?![a-z0-9_]*\.[a-z])/ },
  // "ig: samlee_nyc", "my insta is samlee_nyc", "snap @sam", "discord sam#1234".
  { name: "handle", re: /\b(?:ig|insta|instagram|snap|snapchat|tiktok|twitter|telegram|tg|whatsapp|signal|discord|venmo|cashapp|cash app|kik|threads|bluesky|bsky|linkedin|fb|facebook|wechat|line id)\b\s*(?:[:=]|is|handle|handle is|is at|at)?\s*@?(?:[a-z0-9_.]*[_.\d#][a-z0-9_.#]*[a-z0-9]|(?<=[:=@]\s*)[a-z][a-z0-9]{2,29})/ },
];

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
};

/** Decimal digits of any script ("٢١٢", "२१२") as ASCII digits. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, c => {
    if (c >= "0" && c <= "9") return c;
    let cp = c.codePointAt(0)!;
    let zero = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1)) && cp - zero < 9) zero--;
    return String((cp - zero) % 10);
  });
}

/**
 * Variants of `plain` text for the contact checks (audit core-2): number words as digits ("two one
 * two" → "2 1 2"), other-script digits as ASCII, letter O/l/i inside numbers as 0/1, keycap emoji
 * dropped, spaced "@" and "." closed up, spelled "at"/"dot" as "@"/".", underscores as spaces.
 */
export function contactVariants(s: string): string[] {
  const out = new Set<string>();
  for (const p of plainVariants(s)) {
    let v = asciiDigits(p).replace(/⃣/g, "");
    v = v.replace(/\b[a-z]+\b/g, w => NUMBER_WORDS[w] ?? w);
    v = v.replace(/\boh\b(?=[\s.\-]*\d)|(?<=\d[\s.\-]*)\boh\b/g, "0");
    v = v.replace(/(?<=\d[\s.\-]{0,2})[o](?![a-z])|(?<![a-z])[o](?=[\s.\-]{0,2}\d)/g, "0").replace(/(?<=\d[\s.\-]{0,2})[li](?![a-z])|(?<![a-z])[li](?=[\s.\-]{0,2}\d)/g, "1");
    out.add(v);
    // Spelled "dot" only before a known TLD or another spelled dot; spelled "at" only before a domain.
    const dotted = v.replace(new RegExp(`[\\s([{]+(?:dot|punto)[\\s)\\]}]+(?=(?:${TLDS})\\b|[a-z0-9-]+[\\s([{]+(?:dot|punto)\\b)`, "g"), ".");
    const closed = dotted.replace(/\s*@\s*/g, "@").replace(/(?<=[a-z0-9])\s*\.\s*(?=(?:com|net|org|io|xyz|biz|info)\b)/g, ".")
      .replace(/[\s([{]+at[\s)\]}]+(?=[a-z0-9-]+\.[a-z]{2,})/g, "@");
    out.add(closed);
  }
  return [...out];
}

const YEAR = /^(?:19|20)\d\d$/;
/** A phone-pattern match that is not an order number, a booking reference or a list of years. */
function isPhone(text: string, m: RegExpExecArray): boolean {
  const before = text.slice(Math.max(0, m.index - 24), m.index);
  if (/#\s*$|\b(?:order|conf|confirmation|ref|reference|booking|ticket|tracking|invoice|receipt|account|acct|case|id)\b[\s:#.no]*$/.test(before)) return false;
  const groups = m[0].split(/[^\d]+/).filter(Boolean);
  if (groups.length >= 2 && groups.every(g => YEAR.test(g))) return false;
  return true;
}

/** A forbidden string, optionally tagged with the member it belongs to (see `LeakGuard.check` `exceptOwner`). */
export type Owned = string | { text: string; owner?: string };

export interface LeakOptions {
  /** Strings that must never appear (another member's private facts). Matched whole (3+ words) or by any 4-word run. */
  forbidden?: string[];
  /**
   * Private facts matched fuzzily as well as like `forbidden`: fragments, inflections, leetspeak and
   * reordering (see `factMatches`). Use for facts about people, not for item text or ids: a fact's
   * content words appearing close together in a message is treated as a leak.
   */
  facts?: string[];
  /** Treat every `forbidden` string as a fact too (fuzzy matching). Default false. */
  fuzzy?: boolean;
  /**
   * Ids, names and contact values. Strings of 5+ characters match as substrings (case-, Unicode- and
   * accent-insensitive), also with punctuation and spaces squashed out when that leaves 6+ characters;
   * shorter strings match as whole words only ("Al" does not match "also"); phone numbers match on
   * their digits, however they are formatted (core-20).
   */
  exact?: string[];
  /** Words or phrases that must never appear (whole-word match; sensitive terms also inflected: "divorced" for "divorce"). */
  privateVocab?: string[];
  /**
   * The sender's own public vocabulary (place names, interest and skill labels, its message phrasing).
   * These phrases are cut out of forbidden strings and facts before matching, so a private fact like
   * "lives near Hell's Kitchen" does not block every message that says "near Hell's Kitchen".
   * Sensitive terms (SENSITIVE_TERMS) are never cut out (core-21).
   */
  publicPhrases?: string[];
  /** Canary tokens: matched anywhere, ignoring case and punctuation (whole word when shorter than 4 characters). */
  canaries?: string[];
  /** Text the sender is allowed to include verbatim (the Network's own HELP/STOP text, venue addresses); removed before the contact checks. */
  allow?: string[];
  /** Run the contact-detail patterns (default true). */
  contacts?: boolean;
  /**
   * Also block canary-shaped tokens with no canary list (`CANARY_SHAPES`: seeded "CANARY_<NAME>_…"
   * prefixes and simulator tokens like "QX-4821-ORCHID"), reported as `canary:shape`. Default false.
   */
  canaryShapes?: boolean;
  /**
   * Facet tags that carry a private photo rating (`isRatingTag`: "slop:rating:face=0.73",
   * "appearance:overall=1.20"). The tag, its "key=value" and a decimal value never appear in a
   * message; with any rating given, phrases that state a rating, a score or a percentile
   * (`RATING_PATTERNS`) are refused too. Ratings are never shown to anyone, the rated member included.
   */
  ratings?: string[];
  /** Longest text checked (default 20,000 characters). Longer text is refused as `too_long` (core-7). */
  maxLength?: number;
}

/** A facet tag that carries a private photo rating: "<app>:rating:<key>=<value>" (the platform's rater) or "appearance:<key>=<value>" (the slop pack). */
export function isRatingTag(tag: string): boolean { return /^(?:[a-z][a-z0-9_-]*:rating:|appearance:)/i.test(tag); }
/** Phrases that state a rating, a score or a percentile about someone (refused while any rating exists: `LeakOptions.ratings`). */
export const RATING_PATTERNS: readonly RegExp[] = [
  /\b\d{1,3}(?:st|nd|rd|th)?\s+percentile\b/i, /\bpercentiles?\b/i, /\btop\s+\d{1,2}\s*(?:%|percent)/i,
  /\b(?:rated|rating|scored?|scores)\s+(?:of\s+|a\s+|an\s+)?-?\d+(?:\.\d+)?\b/i, /\b\d+(?:\.\d+)?\s*(?:\/|out of)\s*10\b/i,
  /\b(?:looks|attractiveness|appearance|face|body|photo)\s+(?:score|rating|rank)\b/i,
];
/** The exact strings a rating tag must never show: the tag, its key=value, and its value when it is a decimal number. */
function ratingStrings(tag: string): string[] {
  const kv = tag.replace(/^(?:[a-z][a-z0-9_-]*:rating:|appearance:)/i, "");
  const v = kv.includes("=") ? kv.slice(kv.indexOf("=") + 1) : "";
  return [tag, kv, ...(/^-?\d*\.\d{2,}$/.test(v) ? [v] : [])].filter(x => x.length >= 3);
}

/** Canary-shaped tokens (see `LeakOptions.canaryShapes`). The second pattern is case-sensitive on purpose. */
export const CANARY_SHAPES: RegExp[] = [/\bcanary_[a-z0-9]+_/i, /\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/];

const LABEL_KEY: string | undefined = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.LEAK_LABEL_KEY || undefined;

/** Short non-reversible label for logs: never log the blocked value itself. */
export function labelHash(s: string): string {
  let h = 0x811c9dc5;
  const input = LABEL_KEY === undefined ? s : `${LABEL_KEY}\u0000${s}\u0000${LABEL_KEY}`;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193) >>> 0;
  if (LABEL_KEY !== undefined) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16; }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------- sensitive terms
// Words that identify a protected or sensitive fact on their own, however short the fact is (core-1).
// Matched as whole words (and light-stemmed) when they occur inside another member's forbidden string
// or fact. Append only.

const SENSITIVE_WORDS = (
  // sexuality and gender
  "gay lesbian bi bisexual pansexual queer trans transgender nonbinary asexual lgbt lgbtq lgbtqia closeted " +
  // health
  "hiv aids std sti herpes hpv hepatitis cancer chemo chemotherapy tumor diabetes diabetic epilepsy epileptic " +
  "dementia alzheimers parkinsons lupus crohns pcos endometriosis terminal hospice transplant dialysis " +
  "ivf infertile infertility pregnant pregnancy miscarriage miscarried abortion stillbirth " +
  // recovery and addiction
  "sober sobriety aa na alcoholic alcoholism addict addiction rehab relapse relapsed methadone suboxone overdose " +
  // mental health
  "bipolar depression depressed anxiety adhd autism autistic ocd ptsd schizophrenia schizophrenic suicidal suicide " +
  "anorexia anorexic bulimia bulimic psychiatric psychiatrist therapist antidepressants ssri lithium selfharm " +
  // disability
  "disabled disability wheelchair deaf blind " +
  // relationships and family
  "divorce divorced divorcing separated widow widowed widower affair custody estranged " +
  // money and work
  "bankrupt bankruptcy foreclosure evicted eviction unemployed homeless " +
  // immigration and legal
  "undocumented asylum refugee deported deportation daca arrested felony felon prison incarcerated parole probation convicted " +
  // religion
  "muslim jewish christian mormon atheist catholic hindu buddhist sikh"
).split(" ");
const SENSITIVE_PHRASES = ["eating disorder", "self harm", "trying to conceive", "in recovery", "laid off", "chronic illness",
  "sex work", "sex worker", "domestic violence", "sexual assault", "mental health", "hiv positive", "on probation", "on parole"];

/** Sensitive single words (folded). See SENSITIVE_WORDS. */
export const SENSITIVE_TERMS: ReadonlySet<string> = new Set(SENSITIVE_WORDS);
const SENSITIVE_STEMS = new Map<string, string>();

/** True if a folded word is a sensitive term (exact or light-stemmed: "divorced" → "divorce"). */
export function isSensitiveTerm(word: string): boolean {
  const w = word.toLowerCase();
  return SENSITIVE_TERMS.has(w) || SENSITIVE_STEMS.has(stem(w));
}

// ---------------------------------------------------------------------------- fuzzy fact matching
// A fact leaks if (a) its body appears with spaces/punctuation squashed out (8+ chars; fewer for
// non-Latin scripts), (b) any word 3-gram of the fact with at least two content words appears, or
// (c) a window of the text contains enough of the fact's distinct content words (2 of 2-3, else 60%).
// Tokens are light-stemmed; stopwords are kept for n-grams but never count as content. One-word
// facts: exact matching only (and sensitive terms, above).

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
for (const w of SENSITIVE_WORDS) if (w.length > 4) SENSITIVE_STEMS.set(stem(w), w);

const splitWords = (folded: string): string[] => folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const tokens = (folded: string): string[] => splitWords(folded).map(w => (STOPWORDS.has(w) ? `~${w}` : stem(w)));
const isContent = (t: string) => t.length >= 3 && !t.startsWith("~");
/** Content words of a folded word list: not stopwords, 2+ characters (or any non-Latin word). */
const contentCount = (ws: string[]) => ws.filter(w => !STOPWORDS.has(w) && (w.length >= 2 || /[^\x00-\x7f]/.test(w))).length;

interface FuzzyFact { squashed: string; grams: Set<string>; want: Set<string>; need: number; window: number }

/** Minimum squashed length for substring matching: shorter for scripts with dense letters. */
function minSquash(sq: string): number {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(sq)) return 2;
  if (/[^\x00-\x7f]/.test(sq)) return 4;
  return 8;
}

/** Compile one fact body (already folded). Null if it has nothing fuzzy-matchable. */
function compileFact(body: string): FuzzyFact | null {
  const sq = squash(body);
  const ft = tokens(body);
  const content = [...new Set(ft.filter(isContent))];
  const grams = new Set<string>();
  if (content.length >= 2) {
    for (let i = 0; i + 3 <= ft.length; i++) {
      const g = ft.slice(i, i + 3);
      if (g.filter(isContent).length >= 2) grams.add(g.join(" "));
    }
  }
  const sqOk = sq.length >= minSquash(sq);
  if (!sqOk && content.length < 2) return null;
  return {
    squashed: sqOk ? sq : "",
    grams,
    want: content.length >= 2 ? new Set(content) : new Set(),
    need: content.length <= 3 ? 2 : Math.ceil(0.6 * content.length),
    window: Math.max(12, 3 * content.length),
  };
}

function factMatches(f: FuzzyFact, textTokens: string[][], textSquashed: string[]): boolean {
  if (f.squashed && textSquashed.some(t => t.includes(f.squashed))) return true;
  if (!f.want.size) return false;
  for (const tt of textTokens) {
    if (f.grams.size) for (let i = 0; i + 3 <= tt.length; i++) if (f.grams.has(tt.slice(i, i + 3).join(" "))) return true;
    const counts = new Map<string, number>();
    let distinct = 0;
    for (let i = 0; i < tt.length; i++) {
      const add = tt[i]!;
      if (f.want.has(add)) { const c = counts.get(add) ?? 0; if (c === 0) distinct++; counts.set(add, c + 1); }
      const drop = i - f.window >= 0 ? tt[i - f.window]! : undefined;
      if (drop !== undefined && f.want.has(drop)) { const c = counts.get(drop)! - 1; counts.set(drop, c); if (c === 0) distinct--; }
      if (distinct >= f.need) return true;
    }
  }
  return false;
}

/** "(ref XE-4029-THISTLE)" markers are canaries, not words of the fact. */
const REF_MARKER = /\s*\(ref [^)]*\)/gi;
/** A seeded canary prefix ("CANARY_MAYA_PRIVATE_…") is stripped so the fact's real words are matched. */
const CANARY_PREFIX = /^canary [a-z0-9]+ [a-z]+ /;
/** Bidirectional embedding, override and isolate controls (used to disguise text; core-23). */
const BIDI = /[‪-‮⁦-⁩]/;

const N = 4;
const words = (folded: string) => (folded ? folded.split(" ") : []);
const grams = (ws: string[], n: number) => { const out: string[] = []; for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(" ")); return out; };

type Entry = { label: string; owners: Set<string | undefined> };

const textOf = (f: Owned) => (typeof f === "string" ? f : f.text);
const ownerOf = (f: Owned) => (typeof f === "string" ? undefined : f.owner);

export type LeakGuardOptions =
  Omit<LeakOptions, "forbidden" | "facts" | "exact"> & { forbidden?: Owned[]; facts?: Owned[]; exact?: Owned[] };

type ExactEntry = Entry & { plain: string; squashed: string; mode: "substring" | "word" | "digits"; folded: string; digits: string };

/**
 * A compiled guard. Build it once per set of forbidden strings (e.g. once per snapshot) and call
 * `check` for every outbound message. Forbidden strings carry an optional owner, so one guard can
 * serve every recipient: `check(text, { exceptOwner })` ignores the recipient's own facts.
 */
export class LeakGuard {
  private whole = new Map<string, Entry>();
  private ngrams = new Map<string, Entry>();
  private fuzzy: (Entry & { fact: FuzzyFact })[] = [];
  /** Content token → fuzzy facts that want it (core-m4: only facts sharing a word with the text are scanned). */
  private fuzzyIndex = new Map<string, (Entry & { fact: FuzzyFact })[]>();
  private fuzzySquashed: (Entry & { fact: FuzzyFact })[] = [];
  private sensitive = new Map<string, Entry>(); // stemmed sensitive word → the fact(s) it came from
  private sensitivePhrases = new Map<string, Entry>();
  private exact: ExactEntry[] = [];
  private vocabWords = new Map<string, string>(); // one-word vocabulary (folded) → the original, hashed on a hit
  private vocabStems = new Map<string, string>();
  private vocab: { phrase: string; label: string }[] = []; // multi-word vocabulary
  private canaries: { folded: string; label: string; word: boolean }[] = [];
  private allow: string[];
  private contacts: boolean;
  private canaryShapes: boolean;
  /** Any rating given: rating and percentile phrases are refused (`LeakOptions.ratings`). */
  private ratingPhrases: boolean;
  private maxLength: number;
  /** Labels of inputs that compiled to nothing and can never match (core-m3): an empty canary, an empty exact string, an empty fact. */
  readonly dropped: string[] = [];

  constructor(o: LeakGuardOptions = {}) {
    const pub = [...new Set((o.publicPhrases ?? []).map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
    // Cut public vocabulary out of a folded string; what is left is matched segment by segment.
    const segments = (folded: string) => {
      let s = ` ${folded} `;
      for (const p of pub) s = s.split(` ${p} `).join(" | ");
      return s.split("|").map(x => x.trim()).filter(Boolean);
    };
    const facts: Owned[] = [...(o.facts ?? []), ...(o.fuzzy ? o.forbidden ?? [] : [])];
    const sensitiveFrom = (folded: string, label: string, owner: string | undefined) => {
      let found = false;
      for (const w of words(folded)) if (isSensitiveTerm(w)) { add(this.sensitive, stem(w), label, owner); found = true; }
      const padded = ` ${folded} `;
      for (const ph of SENSITIVE_PHRASES) if (padded.includes(` ${ph} `)) { add(this.sensitivePhrases, ph, label, owner); found = true; }
      return found;
    };
    for (const f of [...(o.forbidden ?? []), ...(o.facts ?? [])]) {
      const text = textOf(f), owner = ownerOf(f), label = `forbidden:${labelHash(text)}`;
      const folded = fold(text.replace(REF_MARKER, " ")).replace(CANARY_PREFIX, "");
      let any = sensitiveFrom(folded, label, owner);
      for (const seg of segments(fold(text))) {
        const ws = words(seg);
        // One- and two-word strings ("climbing", "rock music") are too generic to identify anyone:
        // matching them would block ordinary messages. Canaries, sensitive terms and 4-word runs catch
        // real disclosure. Runs of stopwords ("and it is a") are not evidence of anything (core-13).
        if (ws.length >= 3 && contentCount(ws) >= 2) { add(this.whole, ws.join(" "), label, owner); any = true; }
        if (ws.length >= N) for (const g of grams(ws, N)) if (contentCount(g.split(" ")) >= 2) { add(this.ngrams, g, label, owner); any = true; }
      }
      if (!any && !facts.includes(f) && !folded) this.dropped.push(label);
    }
    const fuzzyByKey = new Map<string, Entry & { fact: FuzzyFact }>();
    for (const f of facts) {
      const text = textOf(f), owner = ownerOf(f), label = `forbidden:${labelHash(text)}`;
      const body = fold(text.replace(REF_MARKER, " ")).replace(CANARY_PREFIX, "");
      if (!body) { this.dropped.push(label); continue; }
      for (const seg of segments(body)) {
        const key = `${label}|${seg}`;
        const prev = fuzzyByKey.get(key);
        if (prev) { prev.owners.add(owner); continue; }
        const fact = compileFact(seg);
        if (!fact) continue;
        const e = { label, owners: new Set([owner]), fact };
        fuzzyByKey.set(key, e);
        this.fuzzy.push(e);
        if (fact.squashed) this.fuzzySquashed.push(e);
        for (const t of fact.want) { const l = this.fuzzyIndex.get(t); if (l) l.push(e); else this.fuzzyIndex.set(t, [e]); }
      }
    }
    const ratings = (o.ratings ?? []).filter(isRatingTag);
    this.ratingPhrases = ratings.length > 0;
    for (const f of [...(o.exact ?? []), ...[...new Set(ratings.flatMap(ratingStrings))]]) {
      const text = textOf(f);
      const label = `forbidden:${labelHash(text ?? "")}`;
      const p = text ? plain(text) : "";
      if (!p.trim()) { if (text !== undefined) this.dropped.push(label); continue; }
      const digits = p.replace(/\D/g, "");
      const mode: ExactEntry["mode"] = digits.length >= 7 && digits.length >= p.replace(/[\s().+\-]/g, "").length - 1 ? "digits"
        : squash(p).length < 5 ? "word" : "substring";
      this.exact.push({ label, owners: new Set([ownerOf(f)]), plain: p, squashed: squash(p), mode, folded: collapse(p), digits: digits.slice(-10) });
    }
    for (const v of o.privateVocab ?? []) {
      const f = /^[a-z0-9]+$/.test(v) ? v : fold(v);
      if (!f) continue;
      if (f.includes(" ")) this.vocab.push({ phrase: ` ${f} `, label: `private_vocab:${labelHash(v)}` });
      else if (!this.vocabWords.has(f)) { this.vocabWords.set(f, v); // Inflections ("divorced" for "divorce") only for sensitive terms: engine vocabularies hold
        // every private word, and stems of generic ones ("socially" → "social") would block ordinary text.
        if (isSensitiveTerm(f) && !this.vocabStems.has(stem(f))) this.vocabStems.set(stem(f), v); }
    }
    for (const c of o.canaries ?? []) {
      const f = fold(c).replace(/ /g, "");
      const label = `canary:${labelHash(c)}`;
      if (!f) { this.dropped.push(label); continue; }
      this.canaries.push({ folded: f, label, word: f.length < 4 });
    }
    this.allow = (o.allow ?? []).map(a => plain(a)).filter(Boolean);
    this.contacts = o.contacts ?? true;
    this.canaryShapes = o.canaryShapes ?? false;
    this.maxLength = o.maxLength ?? 20_000;
  }

  /** Reasons the text must not be sent (empty = clean). */
  check(text: string, o: { exceptOwner?: string } = {}): string[] {
    if (text.length > this.maxLength) return ["too_long"];
    const reasons = new Set<string>();
    if (BIDI.test(text)) reasons.add("format:bidi");
    const counts = (e: Entry) => [...e.owners].some(x => x === undefined || x !== o.exceptOwner);
    const hit = (e: Entry | undefined) => { if (e && counts(e)) reasons.add(e.label); };
    const plains = plainVariants(text);
    const folded = foldedVariants(text);
    const squashed = folded.map(squash);
    for (const c of this.canaries) {
      if (c.word ? folded.some(f => ` ${f} `.includes(` ${c.folded} `)) : squashed.some(s => s.includes(c.folded))) reasons.add(c.label);
    }
    if (this.ratingPhrases) {
      const nfkc = text.normalize("NFKC");
      if (RATING_PATTERNS.some(re => re.test(nfkc))) reasons.add("rating:phrase");
    }
    if (this.canaryShapes) {
      const nfkc = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
      if (CANARY_SHAPES.some(re => re.test(nfkc))) reasons.add("canary:shape");
    }
    for (const f of folded) {
      const padded = ` ${f} `;
      for (const [w, e] of this.whole) if (!reasons.has(e.label) && padded.includes(` ${w} `)) hit(e);
      const ws = words(f);
      if (this.ngrams.size) for (const g of grams(ws, N)) hit(this.ngrams.get(g));
      if (this.sensitive.size) for (const w of ws) hit(this.sensitive.get(stem(w)) ?? this.sensitive.get(w));
      for (const [ph, e] of this.sensitivePhrases) if (padded.includes(` ${ph} `)) hit(e);
      if (this.vocabWords.size) for (const w of ws) {
        const v = this.vocabWords.get(w) ?? (this.vocabStems.size ? this.vocabStems.get(stem(w)) : undefined);
        if (v !== undefined) reasons.add(`private_vocab:${labelHash(v)}`);
      }
      for (const v of this.vocab) if (padded.includes(v.phrase)) reasons.add(v.label);
    }
    if (this.exact.length) {
      const sq = plains.map(squash);
      const digitRuns = contactVariants(text).map(v => v.replace(/\D/g, ""));
      for (const e of this.exact) {
        if (reasons.has(e.label) || !counts(e)) continue;
        const found = e.mode === "digits" ? digitRuns.some(d => d.includes(e.digits))
          : e.mode === "word" ? folded.some(f => ` ${f} `.includes(` ${e.folded} `)) || (e.squashed.length >= 4 && sq.some(t => t === e.squashed))
          : plains.some(t => t.includes(e.plain)) || (e.squashed.length >= 6 && sq.some(t => t.includes(e.squashed)));
        if (found) reasons.add(e.label);
      }
    }
    if (this.fuzzy.length) {
      const toks = folded.map(tokens);
      const present = new Set(toks.flat());
      const overlap = new Map<Entry & { fact: FuzzyFact }, number>();
      for (const t of present) for (const e of this.fuzzyIndex.get(t) ?? []) overlap.set(e, (overlap.get(e) ?? 0) + 1);
      const candidates = new Set<Entry & { fact: FuzzyFact }>(this.fuzzySquashed);
      for (const [e, n] of overlap) if (n >= 2) candidates.add(e);
      for (const e of candidates) if (!reasons.has(e.label) && counts(e) && factMatches(e.fact, toks, squashed)) reasons.add(e.label);
    }
    if (this.contacts) {
      for (const p of contactVariants(text)) {
        let c = p;
        for (const a of this.allow) c = c.split(a).join(" ");
        for (const { name, re } of CONTACT_PATTERNS) {
          if (reasons.has(`contact:${name}`)) continue;
          if (re.global) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(c))) { if (isPhone(c, m)) { reasons.add(`contact:${name}`); break; } }
            re.lastIndex = 0;
          } else if (re.test(c)) reasons.add(`contact:${name}`);
        }
      }
    }
    return [...reasons];
  }

  /**
   * Check the last messages of one thread to the same recipient as one text (core-14): a number or a
   * fact split across messages ("212 555", "0102") is caught. Pass the new message last.
   */
  checkThread(texts: readonly string[], o: { exceptOwner?: string } = {}): string[] {
    const recent = texts.slice(-5);
    return [...new Set([...this.check(recent.at(-1) ?? "", o), ...this.check(recent.join(" "), o), ...this.check(recent.join(""), o)])];
  }
}

function add(m: Map<string, Entry>, key: string, label: string, owner: string | undefined) {
  const e = m.get(key);
  if (e) e.owners.add(owner); else m.set(key, { label, owners: new Set([owner]) });
}

/** One-off check. For many messages against the same lists, build a `LeakGuard` once instead. */
export function findLeaks(text: string, o: LeakOptions = {}): string[] {
  return new LeakGuard(o).check(text);
}
