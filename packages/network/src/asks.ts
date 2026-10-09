// What a member asks the agent to do about the agent itself (PRD F5, F8-F10, F20, F21, F24, 41.5):
// how it works, what it knows, pausing, quiet hours, how often to text, the open asks, a question
// it cannot look up, and their data. Deterministic rules on normalized text (classify.ts calls
// memberAskOf). Nothing here needs a clock: a pause says what the member said ("for two weeks",
// "until November"), and intents.ts turns it into a time.
//
// Precedence: classify.ts keeps every older kind first (block, report, cancel, invites, feedback,
// requests). These kinds only replace "other" and "ack", except an info question, which also
// replaces a people request that asks about a place, not a person ("anyone know a good climbing
// gym near Dolores?"). STOP, START and HELP as whole messages are carrier keywords and never get here.

export type MemberAskKind =
  | "help" | "know_me" | "correct" | "pause" | "resume" | "quiet_hours" | "only_when_asked" | "more_often" | "less_often"
  | "list_intents" | "close_intent" | "info_question" | "export_request" | "delete_request";

/** How long a pause lasts, as said. Undefined fields: not said. */
export interface PauseSpan {
  days?: number;
  /** "until November", "until Nov 15", "until 11/15": month 1-12, day of month. */
  month?: number; day?: number;
  /** "until Monday": 0 = Monday .. 6 = Sunday (core localParts). */
  weekday?: number;
}
/** Quiet hours as said: local hours (0-23) when texts stop and start again. */
export interface QuietSpan { from?: number; to?: number }

export interface MemberAsk {
  kind: MemberAskKind;
  pause?: PauseSpan;
  quiet?: QuietSpan;
  /** close_intent: "pause" keeps it to restart later; "close" ends it. */
  closeMode?: "close" | "pause";
  /** The kind the older rules read (classify.ts): members aged 13-17 keep that path. */
  was?: "people_request" | "ack" | "other";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

const HELP = /^\W*(?:help me\W*$|help\?|how (?:does|do) (?:this|it|you|the agent|this thing) work|how does (?:this|it) all work|what(?:'s| is) this(?: thing| app| number)?\W*$|what (?:can|do) you (?:do|help with)|what are you\W*$|who (?:are|is) (?:you|this)\W*$|how do i use (?:this|you)|i'?m (?:confused|lost)\W*$)/;
const KNOW_ME = /\b(?:what (?:do|did) you know about me|what have you (?:learned|figured out|got) (?:about|on) me|what do you have (?:on|about) me|what(?:'s| is) (?:in )?my profile|what did i tell you|what (?:do|did) you (?:remember|know)(?: about me)?\W*$|tell me what you know)\b/;
const CORRECT = /^\W*(?:actually|correction|wait,? actually|no,? (?:i meant|actually))\b|\b(?:actually\W*$|that'?s (?:wrong|not right|not true|outdated)|not quite|i meant|change (?:my|it to|that to)|update (?:my|that)|fix (?:my|that))\b/;
const PAUSE_WORD = /\b(?:pause(?: me| everything| it| things| matching| my account| for| until| till| til)?|take a break|taking a break|on a break|need a break|hold off|put (?:me|things|it) on hold|stop (?:suggesting|sending (?:me )?(?:suggestions|people|matches)|matching me))\b/;
const BUSY = /\b(?:slammed|swamped|traveling|travelling|out of town|away|busy|offline)\b/;
const RESUME = /^\W*(?:resume|unpause|un-pause|i'?m back|im back|back now|back again|you can (?:start|text me|reach out|send me (?:stuff|things)) again|start (?:again|back up|suggesting again)|turn (?:it|matching|suggestions) back on)\b/;
const ONLY_ASKED = /\b(?:only (?:text|message|reach out to|contact) me (?:when|if) i (?:ask|text|reach out)|only when i ask|don'?t (?:text|message|reach out to) me unless i (?:ask|text)|i'?ll (?:reach out|text you) when i (?:want|need) (?:something|you))\b/;
const MORE = /\b(?:surprise me|(?:text|message|suggest|reach out to) me more(?: often)?|more (?:suggestions|often)|send (?:me )?more)\b/;
const LESS = /\b(?:(?:less|fewer) (?:often|texts|messages|suggestions)|text (?:me )?less|too many (?:texts|messages)|tone it down|dial it back|not so often|once a month(?: is enough)?)\b/;
const LIST = /\b(?:what am i (?:looking for|waiting (?:on|for))|what (?:are|r) you (?:looking|searching) (?:for|on)(?: for me)?|what(?:'s| is| are) (?:my )?(?:open )?(?:requests?|asks?|searches)|(?:list|show)(?: me)? my (?:requests|asks|searches|wants)|what(?:'s| is) still open)\b/;
const CLOSE = /\b(?:stop|quit|cancel|close|drop|end|forget about|pause|no longer need|don'?t need)\b(?: (?:looking|searching)(?: for)?| (?:the|my) (?:search|request|ask)(?: for)?| (?:the|my|that))?/;
const CLOSE_TARGET = /\b(?:looking|searching|search|request|ask|partner|buddy|mentor|band|group|club|crew|someone|somebody)\b/;
// A question about a place or a thing, not a person: "anyone know a good climbing gym near Dolores?".
const PLACE = "(?:gym|studio|restaurant|bar|cafe|coffee shop|spot|place|shop|store|park|court|class|classes|school|dentist|doctor|therapist|barber|salon|mechanic|bakery|deli|pizza|bookstore|venue|museum|library|hotel|pool|trail|route|club(?! (?:to join|for))|team(?! to join)|league)";
const INFO = new RegExp(`\\b(?:(?:any(?:one|body)?|do you|you) know (?:of )?(?:a |an |any |some |the )?(?:good |great |decent |cheap |nice |best |solid )|(?:best|good|great|decent|cheap|nice) [a-z ]{0,24}?${PLACE}s?\\b[^.!]*\\?|where (?:can|should|do) i (?:find|get|go)|(?:can you |could you )?recommend (?:a |an |some )?|what(?:'s| is) (?:a |the )?(?:good|best) )`);
const INFO_PLACE = new RegExp(`\\b${PLACE}s?\\b`);
const PERSON = /\b(?:partner|buddy|buddies|someone to|somebody to|people to|person to|friend|friends|date|mentor|cofounder|co-founder|teammate|roommate|players? to|to play with|to climb with|to go with)\b/;
const EXPORT = /\b(?:export|download|get|send me|copy of|see) (?:a copy of )?(?:all )?(?:of )?my (?:data|info|information|stuff)\b|\bexport (?:my )?data\b/;
const DELETE = /\b(?:delete|erase|remove|wipe|forget) (?:all )?(?:of )?(?:my (?:data|account|info|information|profile|number|stuff)|everything(?: about me)?|me)\b|\bdelete me\b/;
const QUIET = /\b(?:not|no (?:texts?|messages?)|don'?t (?:text|message) me|never|nothing) (after|before|past) (\d{1,2})(?::(\d\d))?\s*(am|pm|a\.m\.?|p\.m\.?)?\b|\bonly (?:text me )?between (\d{1,2})\s*(am|pm)? and (\d{1,2})\s*(am|pm)?\b|\b(?:quiet hours|do not disturb)\b/;

/** Hours of the day from "9", "9pm", "9:30 am". `after`: a bare 1-11 after "after" is the evening. */
function hourOf(h: string, ampm: string | undefined, bareIsPm: boolean): number | undefined {
  let n = Number(h);
  if (!Number.isInteger(n) || n < 0 || n > 24) return undefined;
  const ap = ampm?.replace(/\./g, "");
  if (ap === "pm" && n < 12) n += 12;
  else if (ap === "am" && n === 12) n = 0;
  else if (!ap && bareIsPm && n >= 1 && n <= 11) n += 12;
  return n % 24;
}

/** "for two weeks", "until November 3", "till Monday", "through the 15th". */
export function pauseSpanOf(low: string): PauseSpan | undefined {
  const dur = /\b(?:for|another|next) (?:the next )?(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a couple(?: of)?|couple(?: of)?|a few|few) (day|week|month)s?\b/.exec(low);
  if (dur) {
    const w = dur[1]!.replace(/^a (couple|few).*/, "$1").replace(/ of$/, "");
    const n = /^\d+$/.test(w) ? Number(w) : NUM[w] ?? NUM[w.split(" ")[0]!];
    if (n) return { days: n * UNIT_DAYS[dur[2]!]! };
  }
  if (/\b(?:this|the rest of the) week(?:end)?\b/.test(low) && !/\b(?:until|till|til|through)\b/.test(low)) return { days: 7 };
  const until = /\b(?:until|till|til|thru|through) (?:the end of |early |mid |late |next )?([a-z]+|\d{1,2}\/\d{1,2})(?:\.? (\d{1,2})(?:st|nd|rd|th)?)?\b/.exec(low);
  if (until) {
    const word = until[1]!;
    const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(word);
    if (slash) { const mo = Number(slash[1]), d = Number(slash[2]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { month: mo, day: d }; }
    const mi = MONTHS.findIndex(x => word.startsWith(x) && (word.length <= 4 || /^(january|february|march|april|may|june|july|august|september|sept|october|november|december)$/.test(word)));
    if (mi >= 0) { const d = until[2] ? Number(until[2]) : undefined; return { month: mi + 1, ...(d && d <= 31 ? { day: d } : {}) }; }
    const wi = WEEKDAYS.findIndex(x => word.startsWith(x) && /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday|sday)?s?$/.test(word));
    if (wi >= 0) return { weekday: wi };
    if (word === "week" || /\bnext week\b/.test(low)) return { days: 7 };
    if (word === "month" || /\bnext month\b/.test(low)) return { days: 30 };
  }
  if (/\bnext week\b/.test(low)) return { days: 7 };
  if (/\bnext month\b/.test(low)) return { days: 30 };
  return undefined;
}

/** "not after 9pm" -> {from: 21}; "no texts before 10am" -> {to: 10}; "only between 10am and 8pm" -> {from: 20, to: 10}. */
export function quietSpanOf(low: string): QuietSpan | undefined {
  const out: QuietSpan = {};
  const each = /\b(?:not|no (?:texts?|messages?)|don'?t (?:text|message) me|never|nothing) (after|before|past) (\d{1,2})(?::\d\d)?\s*(am|pm|a\.m\.?|p\.m\.?)?/g;
  for (const m of low.matchAll(each)) {
    const after = m[1] !== "before";
    const h = hourOf(m[2]!, m[3], after);
    if (h === undefined) continue;
    if (after) out.from = h; else out.to = h;
  }
  // "...and not before 10": a second bound in the same sentence.
  const second = /\b(?:and|or) (after|before) (\d{1,2})(?::\d\d)?\s*(am|pm|a\.m\.?|p\.m\.?)?/.exec(low);
  if (second) { const h = hourOf(second[2]!, second[3], second[1] === "after"); if (h !== undefined) { if (second[1] === "after") out.from ??= h; else out.to ??= h; } }
  const between = /\bonly (?:text me )?between (\d{1,2})\s*(am|pm)? and (\d{1,2})\s*(am|pm)?\b/.exec(low);
  if (between) {
    const a = hourOf(between[1]!, between[2], false), b = hourOf(between[3]!, between[4], true);
    if (a !== undefined && b !== undefined) { out.to = a; out.from = b; }
  }
  return out.from !== undefined || out.to !== undefined ? out : undefined;
}

/**
 * What the member asks about the agent itself, or undefined. `low`: normText of the message.
 * `isPeopleAsk`: classify read a request for a person (only an info question may replace it).
 */
export function memberAskOf(low: string, o: { isPeopleAsk?: boolean } = {}): MemberAsk | undefined {
  const t = low.trim();
  if (!t) return undefined;
  // An info question about a place is never a request for a person.
  if (INFO.test(t) && INFO_PLACE.test(t) && !PERSON.test(t)) return { kind: "info_question" };
  if (o.isPeopleAsk) return undefined;
  if (DELETE.test(t)) return { kind: "delete_request" };
  if (EXPORT.test(t)) return { kind: "export_request" };
  if (KNOW_ME.test(t)) return { kind: "know_me" };
  if (LIST.test(t)) return { kind: "list_intents" };
  if (ONLY_ASKED.test(t)) return { kind: "only_when_asked" };
  if (QUIET.test(t)) { const q = quietSpanOf(t); if (q) return { kind: "quiet_hours", quiet: q }; }
  if (RESUME.test(t)) return { kind: "resume" };
  // "stop looking for a climbing partner", "pause the tennis search": one open ask, by name.
  const close = CLOSE.exec(t);
  if (close && CLOSE_TARGET.test(t.slice(close.index)) && !/\bpause (?:me|everything|for|until|till|til|matching|my account)\b/.test(t)) {
    return { kind: "close_intent", closeMode: /\bpause\b/.test(close[0]) ? "pause" : "close" };
  }
  const span = pauseSpanOf(t);
  if (PAUSE_WORD.test(t)) return { kind: "pause", ...(span ? { pause: span } : {}) };
  // "slammed until November", "traveling for two weeks": busy words need a stated span (a week or more for "busy").
  if (BUSY.test(t) && span && (!/\bbusy\b/.test(t) || (span.days ?? 0) > 7 || span.month !== undefined)) return { kind: "pause", pause: span };
  if (LESS.test(t)) return { kind: "less_often" };
  if (MORE.test(t)) return { kind: "more_often" };
  if (HELP.test(t)) return { kind: "help" };
  if (CORRECT.test(t)) return { kind: "correct" };
  return undefined;
}

export const MEMBER_ASK_KINDS: ReadonlySet<string> = new Set<MemberAskKind>([
  "help", "know_me", "correct", "pause", "resume", "quiet_hours", "only_when_asked", "more_often", "less_often",
  "list_intents", "close_intent", "info_question", "export_request", "delete_request",
]);
