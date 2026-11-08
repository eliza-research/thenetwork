// The profile decisions of the service: who may read which saved profile in a text, and which
// suggestion batch a member may see and answer. Import-free, proved by LemmaScript
// (docs/formal-verification.md). profile-read.ts and profile-suggestion-review.ts call these
// functions. They do the text normalization and the regular expressions, and pass the results here.
// The proofs model `number` as an integer: the shell passes safe-integer flags, and the core reads a
// number only when its flag is true.

// ---- saved profile reads

/** What profileReadRequest answers. "notRead" means that the text is not a read request. */
export type ReadDecision = "notRead" | "read" | "readApp" | "ambiguous" | "refused";

/** What the shell found in one normalized text. */
export interface ReadFacts {
  /** The text has one of the read forms: "show ...", "read ...", "what does ... say", "what is ...". */
  readForm: boolean;
  /** The object of the read has the word "profile" or "profiles". */
  namesProfile: boolean;
  /** The text has a word that changes something (edit, join, leave, stop, suggest and the like). */
  asksChange: boolean;
  /** The object is the sender's own profile: ownSubject did not return null. */
  own: boolean;
  /** The own object, without "i saved" and the like, ends with "profile" or "profiles". */
  endsWithProfile: boolean;
  /** Words are left in front of "profile" that can name an app. */
  appText: boolean;
  /** keywordApp found an app for those words. */
  appKnown: boolean;
}

function endsWithText(s: string, suffix: string): boolean {
  //@ verify
  return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
}

/** True when the object of a read names the sender's own profile. */
function ownsObject(subject: string): boolean {
  //@ verify
  return subject.startsWith("my ") || (subject.startsWith("the ") && endsWithText(subject, " i saved"));
}

/**
 * The object without its owner words, or null when the object is not the sender's own:
 * "my slop profile" gives "slop profile", "the profile i saved" gives "profile".
 */
export function ownSubject(subject: string): string | null {
  //@ verify
  //@ ensures (\result !== null) === ownsObject(subject)
  //@ ensures subject.startsWith("my ") ==> \result === subject.slice(3)
  //@ ensures \result !== null && !subject.startsWith("my ") ==> subject.startsWith("the ") && endsWithText(subject, " i saved") && (subject.length < 12 || \result === subject.slice(4, subject.length - 8))
  if (subject.startsWith("my ")) return subject.slice(3);
  if (!subject.startsWith("the ") || !endsWithText(subject, " i saved")) return null;
  // "the i saved" (11 characters) shares its space: JavaScript slice(4, -8) gives "" there.
  return subject.length >= 12 ? subject.slice(4, subject.length - 8) : "";
}

/** A read-only request about a profile: a read form that names a profile and changes nothing. */
function readOnly(f: ReadFacts): boolean {
  //@ verify
  return f.readForm && f.namesProfile && !f.asksChange;
}

/**
 * The outcome of one text. A member may read only their own saved profile. A read of any other
 * profile is refused. A text that also asks for a change is never a read.
 */
export function readDecision(f: ReadFacts): ReadDecision {
  //@ verify
  //@ ensures (\result === "notRead") === !readOnly(f)
  //@ ensures f.asksChange ==> \result === "notRead"
  //@ ensures (\result === "refused") === (readOnly(f) && !f.own)
  //@ ensures (\result === "read" || \result === "readApp") ==> readOnly(f) && f.own && f.endsWithProfile
  //@ ensures \result === "read" ==> !f.appText
  //@ ensures \result === "readApp" ==> f.appText && f.appKnown
  //@ ensures (\result === "ambiguous") === (readOnly(f) && f.own && (!f.endsWithProfile || (f.appText && !f.appKnown)))
  if (!f.readForm || !f.namesProfile) return "notRead";
  // A combined read/edit is still an edit request, never a read-only operation.
  if (f.asksChange) return "notRead";
  if (!f.own) return "refused";
  if (!f.endsWithProfile) return "ambiguous";
  if (!f.appText) return "read";
  return f.appKnown ? "readApp" : "ambiguous";
}

// ---- suggestion review batches

/** The largest number of suggestions in one batch, and the longest suggestion text. */
export const MAX_SUGGESTIONS = 10;
export const MAX_SUGGESTION_TEXT = 400;

/** The owner of the turn: the person, app and chat that the server bound. */
export interface BatchOwner { personId: string; app: string; chatId: string }

/** One suggestion as the shell reads it. */
export interface SuggestionFacts {
  /** The id is 1 to 64 letters, digits, "_" or "-". */
  idOk: boolean;
  /** The text has a character that is not space, is at most 400 long and has no control character. */
  valueOk: boolean;
  /** observedAt is a safe integer. */
  observedSafe: boolean;
  observedAt: number;
  source: string;
  kind: string;
}

/** One batch as the shell reads it. */
export interface BatchFacts {
  status: string;
  personId: string;
  app: string;
  chatId: string;
  /** The batch id is 1 to 64 letters, digits, "_" or "-". */
  idOk: boolean;
  /** now, expiresAt and revision are safe integers. */
  numbersSafe: boolean;
  expiresAt: number;
  revision: number;
  /** The number of different suggestion ids. */
  distinctIds: number;
  suggestions: SuggestionFacts[];
}

function sameOwner(b: BatchFacts, o: BatchOwner): boolean {
  //@ verify
  return b.personId === o.personId && b.app === o.app && b.chatId === o.chatId;
}

/**
 * A known source and kind, a valid id and text, and a Gmail time that is not after now. A Calendar event
 * start can be in the future: the store accepts it (SD-240).
 */
export function suggestionOk(s: SuggestionFacts, now: number): boolean {
  //@ verify
  return s.idOk && s.valueOk && s.observedSafe && (s.source === "google_calendar" || s.observedAt <= now)
    && (s.source === "gmail" || s.source === "google_calendar")
    && (s.kind === "interest" || s.kind === "goal" || s.kind === "availability_pattern");
}

function allSuggestionsOk(xs: SuggestionFacts[], now: number): boolean {
  //@ verify
  //@ ensures \result === forall(i: nat, i < xs.length ==> suggestionOk(xs[i], now))
  for (let i = 0; i < xs.length; i++) {
    //@ invariant 0 <= i && i <= xs.length
    //@ invariant forall(j: nat, j < i ==> suggestionOk(xs[j], now))
    //@ decreases xs.length - i
    if (!suggestionOk(xs[i], now)) return false;
  }
  return true;
}

/**
 * The batch that a member may see and answer now: pending, bound to the same person, app and chat,
 * not expired, with 1 to 10 suggestions that have different ids and are all valid. Any other batch
 * gives no review text and no decision.
 */
export function currentBatch(b: BatchFacts, o: BatchOwner, now: number): boolean {
  //@ verify
  //@ ensures \result ==> b.status === "pending" && sameOwner(b, o)
  //@ ensures \result ==> b.numbersSafe && now < b.expiresAt && b.revision > 0 && b.idOk
  //@ ensures \result ==> 0 < b.suggestions.length && b.suggestions.length <= MAX_SUGGESTIONS && b.distinctIds === b.suggestions.length
  //@ ensures \result ==> forall(i: nat, i < b.suggestions.length ==> b.suggestions[i].idOk && b.suggestions[i].valueOk && b.suggestions[i].observedSafe && (b.suggestions[i].source === "google_calendar" || b.suggestions[i].observedAt <= now))
  //@ ensures \result ==> forall(i: nat, i < b.suggestions.length ==> (b.suggestions[i].source === "gmail" || b.suggestions[i].source === "google_calendar") && (b.suggestions[i].kind === "interest" || b.suggestions[i].kind === "goal" || b.suggestions[i].kind === "availability_pattern"))
  //@ ensures b.status === "pending" && sameOwner(b, o) && b.numbersSafe && now < b.expiresAt && b.idOk && b.revision > 0 && 0 < b.suggestions.length && b.suggestions.length <= MAX_SUGGESTIONS && b.distinctIds === b.suggestions.length && forall(i: nat, i < b.suggestions.length ==> suggestionOk(b.suggestions[i], now)) ==> \result
  return b.status === "pending" && sameOwner(b, o)
    && b.numbersSafe && now < b.expiresAt
    && b.idOk && b.revision > 0
    && b.suggestions.length > 0 && b.suggestions.length <= MAX_SUGGESTIONS
    && b.distinctIds === b.suggestions.length
    && allSuggestionsOk(b.suggestions, now);
}
