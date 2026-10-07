// Outbound leak and contact guard (PRD 28.5, 32.14: "leak checks on every outbound message").
// Deterministic, no model. Every message the Network sends goes through `LeakGuard.check` (or
// `findLeaks`) right before it leaves; a violation means the message is not sent as written.
// This is the one shared guard (docs/research/2026-10-07-consolidation.md §1.5): the engine's
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
//  - private vocabulary (single words or phrases that must never appear).
// Matching runs on folded text (NFKC, lowercase, no diacritics, common homoglyphs mapped, all
// punctuation and whitespace collapsed to one space), so "Ｄivorce", "dívorce" and "divorce," match.
// Forbidden strings, facts, vocabulary and canaries are also matched on variants with spaced-out
// letters collapsed ("d i v o r c e") and digit/symbol substitutions undone ("d1v0rce").
// Reasons never contain the matched text (logs must not carry the private value): matches are
// reported as a short hash.

const CONFUSABLES: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ѕ": "s", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "һ": "h", "ԁ": "d", "ӏ": "l", "ɡ": "g", "ɑ": "a", "ı": "i",
  "α": "a", "β": "b", "ε": "e", "ζ": "z", "η": "n", "ι": "i", "κ": "k", "μ": "m", "ν": "v", "ο": "o", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x", "ϲ": "c", "ϳ": "j",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l" };

/**
 * NFKC, lowercase, diacritics removed, homoglyphs mapped. Punctuation kept. Format characters
 * (zero-width and similar) are removed, or replaced by `formatChars`.
 */
function plain(s: string, formatChars: "" | " " = ""): string {
  if (!/[^\u0000-\u007f]/.test(s)) return s.toLowerCase(); // ASCII: normalization is the identity
  return s
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\p{Cf}/gu, formatChars)
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, c => CONFUSABLES[c] ?? c)
    .replace(/[‐-―−﹘﹣－]/g, "-");
}

const collapse = (p: string) => p.replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");

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

/** Contact-detail patterns, run on `plain` text (punctuation kept). */
export const CONTACT_PATTERNS: { name: string; re: RegExp }[] = [
  // Digits separated by up to three spaces, dots, dashes or brackets: "(212) 555-0102", "+1 212 555 0102".
  { name: "phone", re: /(?:\+?\d[\s().\-\/]{0,3}){9,14}\d/ },
  { name: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ },
  // "maya at example dot com", "maya [at] example [dot] com".
  { name: "email_spelled", re: /\b[a-z0-9._%+-]{1,64}[\s([{]{1,3}at[\s)\]}]{1,3}[a-z0-9-]{1,63}[\s([{]{1,3}dot[\s)\]}]{1,3}[a-z]{2,10}\b/ },
  // "123 Bedford Ave", "40 W 25th St" (a number, one to three words, a street suffix).
  // Not a time ("7 PM at St. Mary's Park") and no preposition in between.
  { name: "street_address", re: /\b\d{1,5}(?!\s*(?:am|pm|a\.m|p\.m|:\d))(?:\s+(?!(?:at|in|on|near|by|to|from)\b)[a-z0-9.]+){1,3}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|ter|terrace|pkwy|parkway)\b/ },
  { name: "url", re: /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|co|io|ly|net|org|app|xyz|biz|me|link|gg|info|us)\b(?:\/\S*)?/ },
  { name: "handle", re: /(?:^|[\s(])@[a-z0-9_.]{2,}/ },
];

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
   * Strings matched as plain substrings (case-, Unicode- and accent-insensitive, any length), and also
   * with punctuation and spaces squashed out when that leaves 6+ characters: ids, names, contact values.
   */
  exact?: string[];
  /** Words or phrases that must never appear (whole-word match). */
  privateVocab?: string[];
  /**
   * The sender's own public vocabulary (place names, interest and skill labels, its message phrasing).
   * These phrases are cut out of forbidden strings and facts before matching, so a private fact like
   * "lives near Hell's Kitchen" does not block every message that says "near Hell's Kitchen".
   */
  publicPhrases?: string[];
  /** Canary tokens: matched anywhere, ignoring case and punctuation. */
  canaries?: string[];
  /** Text the sender is allowed to include verbatim (the Network's own HELP/STOP text); removed before the contact checks. */
  allow?: string[];
  /** Run the contact-detail patterns (default true). */
  contacts?: boolean;
  /**
   * Also block canary-shaped tokens with no canary list (`CANARY_SHAPES`: seeded "CANARY_<NAME>_…"
   * prefixes and simulator tokens like "QX-4821-ORCHID"), reported as `canary:shape`. Default false.
   */
  canaryShapes?: boolean;
}

/** Canary-shaped tokens (see `LeakOptions.canaryShapes`). The second pattern is case-sensitive on purpose. */
export const CANARY_SHAPES: RegExp[] = [/\bcanary_[a-z0-9]+_/i, /\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/];

/** Short non-reversible label for logs: never log the blocked value itself. */
export function labelHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------- fuzzy fact matching
// A fact leaks if (a) its body appears with spaces/punctuation squashed out (8+ chars), (b) any word
// 3-gram of the fact with at least two content words appears, or (c) a window of the text contains
// enough of the fact's distinct content words (2 of 2-3, else 60%). Tokens are light-stemmed;
// stopwords are kept for n-grams but never count as content. One-word facts: exact matching only.

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

const tokens = (folded: string): string[] => folded.split(/[^a-z0-9]+/).filter(Boolean).map(w => (STOPWORDS.has(w) ? `~${w}` : stem(w)));
const isContent = (t: string) => t.length >= 3 && !t.startsWith("~");

interface FuzzyFact { squashed: string; grams: Set<string>; want: Set<string>; need: number; window: number }

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
  if (sq.length < 8 && content.length < 2) return null;
  return {
    squashed: sq.length >= 8 ? sq : "",
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

const N = 4;
const words = (folded: string) => (folded ? folded.split(" ") : []);
const grams = (ws: string[], n: number) => { const out: string[] = []; for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(" ")); return out; };

type Entry = { label: string; owners: Set<string | undefined> };

const textOf = (f: Owned) => (typeof f === "string" ? f : f.text);
const ownerOf = (f: Owned) => (typeof f === "string" ? undefined : f.owner);

export type LeakGuardOptions =
  Omit<LeakOptions, "forbidden" | "facts" | "exact"> & { forbidden?: Owned[]; facts?: Owned[]; exact?: Owned[] };

/**
 * A compiled guard. Build it once per set of forbidden strings (e.g. once per snapshot) and call
 * `check` for every outbound message. Forbidden strings carry an optional owner, so one guard can
 * serve every recipient: `check(text, { exceptOwner })` ignores the recipient's own facts.
 */
export class LeakGuard {
  private whole = new Map<string, Entry>();
  private ngrams = new Map<string, Entry>();
  private fuzzy: (Entry & { fact: FuzzyFact })[] = [];
  private exact: (Entry & { plain: string; squashed: string })[] = [];
  private vocabWords = new Map<string, string>(); // one-word vocabulary (folded) → the original, hashed on a hit
  private vocab: { phrase: string; label: string }[] = []; // multi-word vocabulary
  private canaries: { folded: string; label: string }[] = [];
  private allow: string[];
  private contacts: boolean;
  private canaryShapes: boolean;

  constructor(o: LeakGuardOptions = {}) {
    const pub = [...new Set((o.publicPhrases ?? []).map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
    // Cut public vocabulary out of a folded string; what is left is matched segment by segment.
    const segments = (folded: string) => {
      let s = ` ${folded} `;
      for (const p of pub) s = s.split(` ${p} `).join(" | ");
      return s.split("|").map(x => x.trim()).filter(Boolean);
    };
    const facts: Owned[] = [...(o.facts ?? []), ...(o.fuzzy ? o.forbidden ?? [] : [])];
    for (const f of [...(o.forbidden ?? []), ...(o.facts ?? [])]) {
      const text = textOf(f), owner = ownerOf(f), label = `forbidden:${labelHash(text)}`;
      for (const seg of segments(fold(text))) {
        const ws = words(seg);
        // One- and two-word strings ("climbing", "rock music") are too generic to identify anyone:
        // matching them would block ordinary messages. Canaries and 4-word runs catch real disclosure.
        if (ws.length >= 3) add(this.whole, ws.join(" "), label, owner);
        if (ws.length >= N) for (const g of grams(ws, N)) add(this.ngrams, g, label, owner);
      }
    }
    const fuzzyByKey = new Map<string, Entry & { fact: FuzzyFact }>();
    for (const f of facts) {
      const text = textOf(f), owner = ownerOf(f), label = `forbidden:${labelHash(text)}`;
      const body = fold(text.replace(REF_MARKER, " ")).replace(CANARY_PREFIX, "");
      for (const seg of segments(body)) {
        const key = `${label}|${seg}`;
        const prev = fuzzyByKey.get(key);
        if (prev) { prev.owners.add(owner); continue; }
        const fact = compileFact(seg);
        if (fact) { const e = { label, owners: new Set([owner]), fact }; fuzzyByKey.set(key, e); this.fuzzy.push(e); }
      }
    }
    for (const f of o.exact ?? []) {
      const text = textOf(f);
      if (!text) continue;
      const p = plain(text);
      this.exact.push({ label: `forbidden:${labelHash(text)}`, owners: new Set([ownerOf(f)]), plain: p, squashed: squash(p) });
    }
    for (const v of o.privateVocab ?? []) {
      const f = /^[a-z0-9]+$/.test(v) ? v : fold(v);
      if (!f) continue;
      if (f.includes(" ")) this.vocab.push({ phrase: ` ${f} `, label: `private_vocab:${labelHash(v)}` });
      else if (!this.vocabWords.has(f)) this.vocabWords.set(f, v);
    }
    for (const c of o.canaries ?? []) { const f = fold(c).replace(/ /g, ""); if (f.length >= 4) this.canaries.push({ folded: f, label: `canary:${labelHash(c)}` }); }
    this.allow = (o.allow ?? []).map(a => plain(a)).filter(Boolean);
    this.contacts = o.contacts ?? true;
    this.canaryShapes = o.canaryShapes ?? false;
  }

  /** Reasons the text must not be sent (empty = clean). */
  check(text: string, o: { exceptOwner?: string } = {}): string[] {
    const reasons = new Set<string>();
    const counts = (e: Entry) => [...e.owners].some(x => x === undefined || x !== o.exceptOwner);
    const hit = (e: Entry | undefined) => { if (e && counts(e)) reasons.add(e.label); };
    const plains = plainVariants(text);
    const folded = foldedVariants(text);
    const squashed = folded.map(squash);
    for (const c of this.canaries) if (squashed.some(s => s.includes(c.folded))) reasons.add(c.label);
    if (this.canaryShapes) {
      const nfkc = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
      if (CANARY_SHAPES.some(re => re.test(nfkc))) reasons.add("canary:shape");
    }
    for (const f of folded) {
      const padded = ` ${f} `;
      for (const [w, e] of this.whole) if (!reasons.has(e.label) && padded.includes(` ${w} `)) hit(e);
      const ws = words(f);
      if (this.ngrams.size) for (const g of grams(ws, N)) hit(this.ngrams.get(g));
      if (this.vocabWords.size) for (const w of ws) { const v = this.vocabWords.get(w); if (v !== undefined) reasons.add(`private_vocab:${labelHash(v)}`); }
      for (const v of this.vocab) if (padded.includes(v.phrase)) reasons.add(v.label);
    }
    if (this.exact.length) {
      const sq = plains.map(squash);
      for (const e of this.exact) {
        if (reasons.has(e.label) || !counts(e)) continue;
        if (plains.some(t => t.includes(e.plain)) || (e.squashed.length >= 6 && sq.some(t => t.includes(e.squashed)))) reasons.add(e.label);
      }
    }
    const pending = this.fuzzy.filter(e => !reasons.has(e.label) && counts(e));
    if (pending.length) {
      const toks = folded.map(tokens);
      for (const e of pending) if (!reasons.has(e.label) && factMatches(e.fact, toks, squashed)) reasons.add(e.label);
    }
    if (this.contacts) {
      for (const p of plains) {
        let c = p;
        for (const a of this.allow) c = c.split(a).join(" ");
        for (const { name, re } of CONTACT_PATTERNS) if (re.test(c)) reasons.add(`contact:${name}`);
      }
    }
    return [...reasons];
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
