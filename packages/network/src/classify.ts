// Inbound message understanding (deterministic first pass). Every member message is classified
// before anything else touches it: what the member wants (a person, a plan, an answer), plus abuse
// signals (spam and sales, scams, contact extraction, prompt injection, harassment) and signs that
// the sender is under 18. An LLM classifier can be layered on top later; these rules are the floor
// that never depends on a model (PRD 32.14 safety classifier, 17.4 minors).
import type { Category } from "@thenetwork/core";
import { DESIRES, INTERESTS, SKILLS, type TimeOption } from "@thenetwork/sim";

export type Abuse = "sales_spam" | "scam_money" | "contact_extraction" | "prompt_injection" | "harassment" | "mass_recruit";
export type InboundKind =
  | "people_request" | "plans_request" | "invite_friend" | "cancel" | "block" | "report" | "feedback_like" | "ack" | "other";

export interface Classified {
  kind: InboundKind;
  abuse: Abuse[];
  /** Risk points this message adds to the sender's trust score. */
  risk: number;
  minorSignal: boolean;
  /** An age the sender states about themselves ("I'm 15", "I'm a sophomore in high school"), if any. */
  statedAge?: number;
  /** An age stated in the explicit form ("I am 12 years old", "15 y/o here"), if any. */
  explicitAge?: number;
  /** For requests: what they want. */
  desireId?: string; category?: Category; tags: string[];
  /** For invites: the friend's first name. */
  friendName?: string;
  /** For block/report: the name they gave. */
  target?: string;
  /** The original text. */
  text?: string;
}

const RX = {
  link: /(https?:\/\/|www\.|bit\.ly|\b[a-z0-9-]+\.(co|com|io|ly|biz|net)\b)/i,
  sales: /\b(\d+% off|discount|promo|my (business|company|agency|startup|brand|course|newsletter)|free (consult|trial|session)|coaching business|mastermind|only \$\d+|sign ?up (now|today)|insurance plan|book a call|dm me|limited spots|special offer)\b/i,
  blast: /\b(blast|send (this|my link) to (all|everyone|your matches)|all members|everyone in (the network|sf|nyc|new york)|share my link)\b/i,
  // Money ASKS and returns pitches, never topics: "I'm into crypto" is an interest, not a scam.
  scam: /(\b(send|wire|transfer|lend|loan|pay|venmo|zelle|cash ?app)\b[^.?!]{0,40}(\$\d+|\bmoney\b|\bdeposit\b|\bfunds?\b)|\$\d+[^.?!]{0,40}\b(deposit|pay (it|you) back|loan)\b|\bguaranteed (returns?|profits?)\b|\b\d+% (monthly|weekly|daily) returns?\b|\binvestment opportunity\b|\bgift cards?\b[^.?!]{0,30}\b(buy|send|code)\b)/i,
  extraction: /\b(phone numbers?|numbers? of|their numbers?|(\w+'s) (number|phone|address|email|instagram|ig|insta)|home address(es)?|contact (details|info)|private notes|agent_private)\b/i,
  injection: /(ignore (all )?(previous|prior) instructions|system override|you are now|admin (debug )?mode|developer mode|<\/?\w+_message>|^\s*(assistant|system)\s*:|print the|reveal your (prompt|instructions)|jailbreak)/im,
  harassment: /\b(they('re| are) cute|owe me|still waiting for (a )?(reply|them)|make (them|her|him) (answer|reply)|why won't (they|she|he) (answer|reply)|i know where (they|she|he) live)/i,
  minor: /\b(after school|math test|homework|my (mom|dad|mum|parents) (says?|said|won't)|school night|high school|middle school|\b(9th|10th|11th|12th) grade|when i turn 18|prom)\b/i,
  invite: /\b[Mm]y friend ([A-Z][a-z]+)\b/,
  cancel: /\b(can'?t make it|have to bail|can'?t come|need to cancel|something came up)\b/i,
  block: /^\s*block\s+(.+)$/i,
  report: /^\s*report\s+(.+)$/i,
  plans: /\b(anything fun|what'?s (on|happening|good)|something to do|plans? (this|for the) (weekend|week|tonight)|fun (going on|this weekend)|any (events|plans))\b/i,
  peopleAsk: /\b(anyone (around|who|want|up for)|looking for (a |an |someone|people)|hoping to|find (me )?(a|an|someone|people)|want to meet|know anyone|still hoping)\b/i,
  feedback: /\b(it was (great|nice|fine|fun|good|ok|okay)|we (really )?clicked|(not|wasn'?t) great|didn'?t (really )?click|never showed|would (definitely )?(do it|meet|hang out) again|not much in common)\b/i,
  ack: /^(thanks|thank you|got it|ok|okay|👍|see you|sounds good|perfect|works for me|great|cool|nice)\b/i,
};

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\b(date|dating|romance|romantic|partner to date)\b/i, "romance"],
  [/\b(founder|startup|career|mentor|job|pitch|investor|work|collaborator|professional)\b/i, "professional"],
  [/\b(help|move|moving|couch|fix|carry)\b/i, "help"],
  [/\b(learn|class|lesson|try|practice)\b/i, "growth"],
  [/\b(friends?|people|hang|dinner|community)\b/i, "social"],
];

export function classify(body: string): Classified {
  const t = body.trim();
  const abuse: Abuse[] = [];
  let risk = 0;
  const link = RX.link.test(t);
  if (RX.sales.test(t) || (link && /\b(join|buy|sign|offer|members|matches|link)\b/i.test(t))) { abuse.push("sales_spam"); risk += link ? 3 : 2; }
  if (RX.blast.test(t)) { abuse.push("mass_recruit"); risk += 3; }
  if (RX.scam.test(t)) { abuse.push("scam_money"); risk += 6; }
  if (RX.extraction.test(t)) { abuse.push("contact_extraction"); risk += 2; }
  if (RX.injection.test(t)) { abuse.push("prompt_injection"); risk += 3; }
  if (RX.harassment.test(t)) { abuse.push("harassment"); risk += 3; }
  const { age, explicit } = agesStated(t);
  const minorSignal = RX.minor.test(t) || (age !== undefined && age < 18);
  const out: Classified = { kind: "other", abuse, risk, minorSignal, statedAge: age, explicitAge: explicit, tags: [], text: t };

  const blk = RX.block.exec(t), rep = RX.report.exec(t);
  if (blk) return { ...out, kind: "block", target: blk[1]!.trim() };
  if (rep) return { ...out, kind: "report", target: rep[1]!.replace(/,.*$/, "").trim() };
  if (RX.cancel.test(t)) return { ...out, kind: "cancel" };
  const inv = RX.invite.exec(t);
  if (inv) return { ...out, kind: "invite_friend", friendName: inv[1] };
  if (RX.feedback.test(t)) return { ...out, kind: "feedback_like" };

  // What do they want? Desires named in the text first (the taxonomy's own phrasing), then tags.
  const lower = t.toLowerCase();
  const desire = DESIRES.find(d => lower.includes(d.text.toLowerCase()));
  const tags = new Set<string>();
  for (const i of INTERESTS) if (lower.includes(i.tag.replace(/_/g, " ")) || lower.includes(i.label.toLowerCase())) tags.add(i.tag);
  for (const s of SKILLS) if (lower.includes(s.tag.replace(/_/g, " "))) tags.add(s.tag);
  if (desire) { desire.needsInterests.forEach(x => tags.add(x)); }
  out.tags = [...tags];
  if (desire) { out.desireId = desire.id; out.category = desire.category; }
  else out.category = CATEGORY_WORDS.find(([rx]) => rx.test(t))?.[1];

  if (abuse.length && !desire) return out;
  if (RX.plans.test(t)) return { ...out, kind: "plans_request", category: out.category ?? "events" };
  if (desire || RX.peopleAsk.test(t)) return { ...out, kind: "people_request", category: out.category ?? "social" };
  if (RX.ack.test(t) || t.length < 12) return { ...out, kind: "ack" };
  return out;
}

const AGE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const ORDINAL: Record<string, number> = { sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const ME = "(?:i'?m|i am|im)";
const NUM_WORD = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
/** "years old", "yrs old", "y/o", "yo": the explicit form of an age. A bare "years" is not ("I'm 4 years sober"). */
const YEARS_OLD = "(?:y(?:ears?|rs?)[\\s-]+old|y\\/?o)\\b";
// A number is read as an age only when the clause ends right after it, or goes on like an age:
// "I'm 15.", "I'm 15, live in...", "I'm 15 lol", "I'm 15 years old". "I'm 15 minutes away",
// "I'm 3 for 3" and "I'm 12 years into my career" are not ages.
const CLAUSE_END = "$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b";
const AGE_END = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}))`;
// "and", "now" and "too" also end an age, but only for 13 and up: "I'm 3 and 0 this season" or
// "I'm 2 years in nyc now" must never decline an adult (a decline deletes the member's data).
const AGE_END_LOOSE = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}|and\\b|now\\b|too\\b))`;
const atLeast13 = (n: number) => (n >= 13 ? n : NaN);
const SCHOOL_YEAR: Record<string, number> = { freshman: 14, sophomore: 15, junior: 16, senior: 17 };
type AgeRule = { rx: RegExp; age: (m: RegExpExecArray) => number; explicit?: boolean };
const AGE_RX: AgeRule[] = [
  // Explicit: "I am 12 years old", "im 15 y/o", "my age is 12", "15 y/o here".
  { rx: new RegExp(`\\b(?:${ME}|my age is)\\s+(\\d{1,2})\\s*${YEARS_OLD}`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`\\b${ME}\\s+(one|two|three|four|five|six|seven|eight|nine|${NUM_WORD})[\\s-]+${YEARS_OLD}`), age: m => AGE_WORDS[m[1]!]!, explicit: true },
  { rx: new RegExp(`\\bmy age is\\s+(\\d{1,2})${AGE_END}`), age: m => Number(m[1]), explicit: true },
  // Leading "15 y/o here", "12yo." (only when it is about the sender: "12 yo whisky is great" is not).
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello)\\W+)?(\\d{1,2})\\s*${YEARS_OLD}(?=\\s*(?:$|[.,!?;:)]|here\\b|lol\\b|btw\\b))`), age: m => Number(m[1]), explicit: true },
  // "I'm 15", "I just turned 12!", "I'm fifteen".
  { rx: new RegExp(`\\b(?:${ME}|i (?:just )?turned)\\s+(\\d{1,2})${AGE_END}`), age: m => Number(m[1]) },
  { rx: new RegExp(`\\b(?:${ME}|i (?:just )?turned)\\s+(\\d{1,2})${AGE_END_LOOSE}`), age: m => atLeast13(Number(m[1])) },
  { rx: new RegExp(`\\b(?:${ME}|i (?:just )?turned)\\s+(${NUM_WORD})${AGE_END}`), age: m => AGE_WORDS[m[1]!]! },
  { rx: new RegExp(`\\b(?:${ME}|i (?:just )?turned)\\s+(${NUM_WORD})${AGE_END_LOOSE}`), age: m => atLeast13(AGE_WORDS[m[1]!]!) },
  // School year: "I'm a sophomore in high school", "I'm a high school junior", "I'm in 7th grade".
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+(?:high school|hs)\\b`), age: m => SCHOOL_YEAR[m[1]!]! },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(?:high school|hs)\\s+(freshman|sophomore|junior|senior)\\b`), age: m => SCHOOL_YEAR[m[1]!]! },
  // "grade" must end the clause: "I'm in 7th grade classrooms all day as a teacher" is not an age.
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(6|7|8|9|10|11|12)(?:st|nd|rd|th)?\\s+grade(?=\\s*(?:${CLAUSE_END}|and\\b|now\\b))`), age: m => Number(m[1]) + 5 },
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\\s+grade(?=\\s*(?:${CLAUSE_END}|and\\b|now\\b))`), age: m => ORDINAL[m[1]!]! + 5 },
  // Middle school (ages 11-14) alone fails closed to "minor", not to "under 13": a decline deletes the
  // member's data, so it needs an explicit age or grade ("I'm 12", "I'm in 6th grade").
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:in|at)|i go to)\\s+middle school\\b`), age: () => 13 },
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:in|at)|i go to)\\s+high school\\b`), age: () => 15 },
];

/**
 * The youngest age the sender states about themselves, and the youngest they state in the explicit
 * form ("I am 12 years old"). First person only, so "my son is 12" or "I teach middle school" never
 * change the member's age.
 */
export function agesStated(body: string): { age?: number; explicit?: number } {
  const t = body.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const out: { age?: number; explicit?: number } = {};
  for (const { rx, age, explicit } of AGE_RX) {
    const m = rx.exec(t);
    if (!m) continue;
    const a = age(m);
    if (!Number.isFinite(a)) continue;
    if (out.age === undefined || a < out.age) out.age = a;
    if (explicit && (out.explicit === undefined || a < out.explicit)) out.explicit = a;
  }
  return out;
}

/** The youngest age the sender states about themselves, or undefined. */
export const statedAge = (body: string): number | undefined => agesStated(body).age;

/**
 * The answer to "How old are you?": the whole message is an age ("34", "I'm 34.", "15 years old",
 * "fifteen"). Anything more is not read as an answer here (classify() reads ages in sentences).
 */
export function ageAnswer(body: string): number | undefined {
  const t = body.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").trim();
  const m = new RegExp(`^(?:${ME}\\s+)?(\\d{1,3}|${Object.keys(AGE_WORDS).join("|")})(?:\\s*${YEARS_OLD})?\\s*[.!]*$`).exec(t);
  if (!m) return undefined;
  const n = /^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!;
  return n > 0 && n < 120 ? n : undefined;
}

/** Facet tags a member reveals when answering onboarding/interview questions. */
export function extractProfile(body: string): { interests: string[]; skills: string[]; desireIds: string[]; area?: string; eveningsOpen?: boolean; groups?: boolean; weekends?: boolean } {
  const lower = body.toLowerCase();
  const interests = INTERESTS.filter(i => lower.includes(i.label.toLowerCase()) || lower.includes(i.tag.replace(/_/g, " "))).map(i => i.tag);
  const skills = SKILLS.filter(s => {
    const verb = s.label.replace(/^(plays|teaches|has|loves|gives|does|cooks|throws|shoots|sings|edits|works) /, "");
    return lower.includes(s.label.toLowerCase()) || (verb.length > 3 && lower.includes(verb.toLowerCase()));
  }).map(s => s.tag);
  const desireIds = DESIRES.filter(d => lower.includes(d.text.toLowerCase())).map(d => d.id);
  const area = /\baround ([A-Z][\w'.-]*(?: [A-Z][\w'.-]*)*) most of the week/.exec(body)?.[1];
  return {
    interests, skills, desireIds, area,
    eveningsOpen: /evenings are pretty open/i.test(body) ? true : /evenings are tight/i.test(body) ? false : undefined,
    groups: /small groups/i.test(body) ? true : undefined,
    weekends: /weekends work best/i.test(body) ? true : undefined,
  };
}

/**
 * Sentiment of a feedback reply (for edges and reliability). Negations are checked first: "not
 * great", "wasn't great" and "didn't click" contain positive words but are bad meetings.
 */
export function feedbackOf(body: string): { sentiment: "positive" | "neutral" | "negative"; selfNoShow: boolean; otherNoShow: boolean; again: boolean } {
  const t = body.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const selfNoShow = /couldn'?t make it|didn'?t make it|had to bail/.test(t);
  const otherNoShow = /never showed|didn'?t show|no[- ]show/.test(t);
  const negative = otherNoShow || NEGATIVE_FEEDBACK.test(t);
  const sentiment = negative ? "negative" : /great|clicked|loved|amazing|nice|easy to talk/.test(t) ? "positive" : "neutral";
  const again = !negative && /again|clicked/.test(t) && !/\b(wouldn'?t|won'?t|not|never)\b[^.!?]*\bagain\b/.test(t);
  return { sentiment, selfNoShow, otherNoShow, again };
}
const NEGATIVE_FEEDBACK = /\b((was|is|it's|that's)?\s*(not|n't|wasn't|isn't)\s+(that |very |really |so |too |super )?(great|good|fun|nice|amazing)|not much in common|nothing in common|didn't (really |quite )?(click|connect|enjoy)|didn't have much|not (really )?for me|not my (thing|type)|awkward|terrible|rude|creepy|bummer|uncomfortable)/;

/** One time option offered in a probe (SimMeta.timeOptions, the network-sim contract): keys "a", "b", "c"; label "Thursday 7pm". */
export type { TimeOption };

// Day names. A full name always counts; a short form ("sun", "sat", "wed", "mon") counts only in a
// day context (before a time, a daypart, "or", "and", a comma or the end), so "if the sun's out",
// "sat down" or "c'mon" never pick a day.
const DAY_ABBR_CONTEXT = "(?=\\.?(?:\\s*(?:\\d|@|at\\b|or\\b|and\\b|&|\\/|works?\\b|is (?:good|fine|great|best|better)\\b|morning|afternoon|evening|night|eve\\b)|\\s*[,;!?.]|\\s*$))";
const day = (full: string, abbr: string) => new RegExp(`\\b${full}s?\\b|(?<!')\\b(?:${abbr})\\b${DAY_ABBR_CONTEXT}`, "g");
const DAY_WORDS: [RegExp, string][] = [
  [day("sunday", "sun"), "Sunday"], [day("monday", "mon"), "Monday"], [day("tuesday", "tues?"), "Tuesday"], [day("wednesday", "weds?"), "Wednesday"],
  [day("thursday", "thu|thur|thurs"), "Thursday"], [day("friday", "fri"), "Friday"], [day("saturday", "sat"), "Saturday"],
];
const NEITHER = /\b(neither|none of (those|them|these|the times)|none (of those )?work|no(ne)? of those (times )?work|those (times )?(don'?t|do not|won'?t) work|can'?t do (those|either|any of)|not those times|other times?)\b/;
/** "Any of them", "whichever", "any time": every option. */
const ALL = /\b(any (of them|of those|works|is fine)|all (of them|work|three)|whichever|any ?time|all good)\b/;
/** "Either", "both": every option, unless the member names the ones they mean ("either Thursday or Sunday"). */
const ALL_WEAK = /\b(either|both)\b/;
/**
 * A negation cue earlier in the same clause ("can't do Thursday or Saturday", "not Sunday", "busy
 * Thursday"). "No plans", "no problem", "not sure", "can't wait" and "don't mind" are not refusals.
 */
const NEG_CUE = /\b(not(?! sure)|can'?t(?! wait)|cannot|couldn'?t|won'?t|wouldn'?t|don'?t(?! mind)|doesn'?t|isn'?t|busy|unavailable|except|neither|nor|no(?! (plans?|problem|prob|worries|rush)\b)|nope|nah)\b/;
/** A refusal right after the pick: "Thursday doesn't work", "Sunday is out", "the first one is bad". */
const NEG_AFTER = /^\s*(?:(?:one|option|time|slot)\b\s*)?(?:\d{1,2}(?::\d\d)?\s*(?:am|pm)\s*)?(?:(?:is|'s|are|would be|will be)\s+)?(?:out\b|bad\b|no good\b|not (?:good|great|ideal|possible|great)\b|tough\b|rough\b|a no\b|off\b|impossible\b|doesn'?t\b|does not\b|don'?t\b|do not\b|won'?t\b|will not\b|isn'?t\b|is not\b|can'?t\b|cannot\b)/;
/** A clause boundary: punctuation, "but", "though", "however". */
const CLAUSE_START = /[.,;!?]|\b(but|though|however|although|so)\b/g;
/** True when the words at `i` (of length `len`) are refused: a negation cue earlier in their clause, or a refusal right after them. */
function negatedAt(t: string, i: number, len: number): boolean {
  let from = 0;
  for (const m of t.slice(0, i).matchAll(CLAUSE_START)) from = m.index! + m[0].length;
  return NEG_CUE.test(t.slice(from, i)) || NEG_AFTER.test(t.slice(i + len));
}
/** "No problem", "no worries", "no rush", "no plans": not a refusal. */
const HARMLESS_NO = /\bno (problem|prob|worries|rush|plans?)\b/g;
/** The reply opens with a refusal ("no", "nope", "can't", "not this week", "sorry, I can't"). */
const NEG_LEAD = /^\W*(?:(?:sorry|unfortunately|ah|hmm|oh)\W+)?(?:i\s+)?(no(?! (problem|prob|worries|rush|plans?)\b)|nope|nah|not(?! sure)|can'?t(?! wait)|cannot|couldn'?t|won'?t)\b/;

/**
 * A member's answer to a probe (founder decision 4a), in free text: "Thursday", "the first",
 * "either", "a or b", "neither", "none of those work", "yes", "no thanks". Returns the answer and,
 * when the probe offered time options, the keys of the options they picked. A yes with an empty
 * pick set means "yes, but none of those times" (neither). A plain yes picks every option except the
 * ones the member rules out ("yes, not Sunday though").
 *
 * A refusal always wins over the time words: "no, I can't make any of them", "no, either is bad",
 * "no sorry, none of those" and "not this week, any time next week?" are a no. Only a time the
 * member names and does not refuse turns a reply that opens with "no" into a yes ("no plans
 * Thursday, so Thursday works").
 */
export function parseProbeReply(body: string, options: readonly TimeOption[] = [], yesNo: (b: string) => "yes" | "no" | "counter" | "unclear"): { answer: "yes" | "no" | "unclear"; keys: string[] } {
  const t = body.toLowerCase().replace(/[‘’ʼ]/g, "'");
  const yn = yesNo(body);
  if (!options.length) return { answer: yn === "unclear" ? "unclear" : yn === "no" ? "no" : "yes", keys: [] };
  const all = options.map(o => o.key);
  // Every mention of an option, as a pick or a refusal. A key both picked and refused counts as picked.
  const pos = new Set<string>(), neg = new Set<string>();
  const mark = (keys: string[], i: number, len: number) => { for (const k of keys) (negatedAt(t, i, len) ? neg : pos).add(k); };
  // Option letters only where they cannot be the article "a": "a or b", "(b)", "option c", or alone.
  for (const m of t.matchAll(/\b([abc])\s*(?:or|and|&|,|\/)\s*([abc])\b/g)) mark([m[1]!, m[2]!], m.index!, m[0].length);
  for (const m of t.matchAll(/(?:\boption\s+|\()([abc])\b/g)) mark([m[1]!], m.index!, m[0].length);
  const alone = /^\s*([abc])[\s.!,)]*$/.exec(t);
  if (alone) pos.add(alone[1]!);
  const ordinals: [RegExp, number][] = [
    [/\b(first|1st|earlier|earliest)\b|(?<![\d:])\b1\b(?!\s*(am|pm|:|\d))/g, 0], [/\b(second|2nd|middle)\b|(?<![\d:])\b2\b(?!\s*(am|pm|:|\d))/g, 1],
    [/\b(third|3rd)\b|(?<![\d:])\b3\b(?!\s*(am|pm|:|\d))/g, 2], [/\b(last|later|latest) one\b/g, options.length - 1],
  ];
  for (const [re, i] of ordinals) if (options[i]) for (const m of t.matchAll(re)) mark([options[i]!.key], m.index!, m[0].length);
  for (const [re, dayName] of DAY_WORDS) {
    const keys = options.filter(o => o.label.startsWith(dayName)).map(o => o.key);
    if (keys.length) for (const m of t.matchAll(re)) mark(keys, m.index!, m[0].length);
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?::\d\d)?\s*(am|pm)\b/g)) {
    const label = `${Number(m[1])}${m[2]}`;
    mark(options.filter(o => o.label.endsWith(` ${label}`)).map(o => o.key), m.index!, m[0].length);
  }
  const picked = all.filter(k => pos.has(k));
  const open = all.filter(k => !neg.has(k) || pos.has(k));
  // A time they name and do not refuse is a yes to it ("no plans Thursday, so Thursday works").
  if (picked.length) return { answer: "yes", keys: picked };
  // A refusal with no time picked is a no, whatever else the reply says ("no, I can't make any of them").
  if (NEG_LEAD.test(t) || (yn === "no" && yesNo(t.replace(HARMLESS_NO, "")) === "no")) return { answer: "no", keys: [] };
  if (NEITHER.test(t)) return { answer: "yes", keys: [] };
  // "Any of them" (not refused, not a request for other days): every option the member did not rule out.
  const allAt = ALL.exec(t) ?? ALL_WEAK.exec(t);
  if (allAt && yn !== "counter" && !negatedAt(t, allAt.index, allAt[0].length)) return { answer: open.length ? "yes" : "unclear", keys: open };
  if (yn === "yes") return { answer: "yes", keys: open };
  if (yn === "counter") return { answer: "yes", keys: [] };
  // Only refusals ("Thursday doesn't work") are not a yes: the probe stays open for a clear answer.
  return { answer: "unclear", keys: [] };
}

/**
 * When a member says they are free ("Tue and Thu evenings", "weekends", "Saturday morning"), as
 * availability-pattern tags ("evening:Tue") that the engine's standingFromFacets reads.
 * A part of the day goes with the days just before it ("Tuesday evening and Saturday afternoon" ->
 * evening:Tue, afternoon:Sat; "Tue and Thu evenings" -> both evenings), or with the days after it
 * when it comes first ("evenings on Tue and Thu"). A day with no part of its own gets the usual
 * default (a weekend day: the whole day; a weekday: the evening). Days and parts are never crossed.
 */
export function availabilityTags(body: string): string[] {
  const t = body.toLowerCase();
  const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  type Tok = { at: number; days?: number[]; part?: string };
  const toks: Tok[] = [];
  DAY_WORDS.forEach(([re], i) => { for (const m of t.matchAll(re)) if (!negatedAt(t, m.index!, m[0].length)) toks.push({ at: m.index!, days: [i] }); });
  for (const m of t.matchAll(/\bweekends?\b/g)) toks.push({ at: m.index!, days: [0, 6] });
  for (const m of t.matchAll(/\bweekdays?\b/g)) toks.push({ at: m.index!, days: [1, 2, 3, 4, 5] });
  for (const m of t.matchAll(/\bweeknights?\b/g)) toks.push({ at: m.index!, days: [1, 2, 3, 4, 5] }, { at: m.index!, part: "evening" });
  for (const [re, part] of [[/\bmornings?\b/g, "morning"], [/\bafternoons?\b|\blunch\b/g, "afternoon"], [/\b(?:evenings?|nights?|after work)\b/g, "evening"]] as const) {
    for (const m of t.matchAll(re)) toks.push({ at: m.index!, part });
  }
  toks.sort((a, b) => a.at - b.at || (a.days ? -1 : 1));
  const out = new Map<number, Set<string>>();
  const give = (ds: number[], p: string) => ds.forEach(d => (out.get(d) ?? out.set(d, new Set()).get(d)!).add(p));
  let pending: number[] = [], group: number[] = [], prevPart = false;
  const lead: string[] = [];
  for (const k of toks) {
    if (k.days) {
      if (prevPart) group = [];
      pending.push(...k.days);
      prevPart = false;
    } else if (k.part) {
      if (pending.length) { give(pending, k.part); group = pending; pending = []; }
      else if (prevPart && group.length) give(group, k.part); // "Saturday morning and afternoon"
      else lead.push(k.part);
      prevPart = true;
    }
  }
  // Days at the end with no part after them: a part said first ("evenings, Tue or Thu"), else the default.
  if (pending.length) {
    if (lead.length) lead.forEach(p => give(pending, p));
    else for (const d of pending) (d === 0 || d === 6 ? ["morning", "afternoon", "evening"] : ["evening"]).forEach(p => give([d], p));
  }
  if (!out.size && lead.includes("evening") && /\b(most|any|all|every)\b/.test(t)) give([1, 2, 3, 4, 5], "evening");
  const ORDER = ["morning", "afternoon", "evening"];
  return [...out.keys()].sort().flatMap(d => ORDER.filter(p => out.get(d)!.has(p)).map(p => `${p}:${DAYS3[d]}`));
}

/**
 * The answer to "Would you do it again with this group?" after a plan (plans ask 8): yes, no, or
 * unclear. Facts about attendance come first ("couldn't make it", "nobody else came"): those are
 * not an answer about the group.
 */
export function planAgainOf(body: string): "yes" | "no" | "unclear" {
  const t = body.toLowerCase().replace(/[‘’ʼ]/g, "'");
  if (/\b(couldn'?t make it|didn'?t (go|make it)|nobody else|no one else|never showed|didn'?t show)\b/.test(t)) return "unclear";
  if (/\b(probably not|not really|no\b|nah|nope|wouldn'?t|won'?t|not again|never again)\b/.test(t)) return "no";
  if (/\b(yes|yeah|yep|definitely|absolutely|for sure|again|count me in)\b/.test(t)) return "yes";
  return "unclear";
}

/** "Nobody else came": the member came and found nobody (a report about the others). */
export const NOBODY_CAME = /\b(nobody|no one) else (came|showed)\b/i;

/** Stated windows in a check-in answer ("Free Tuesday evening and Saturday afternoon." -> evening:Tue, afternoon:Sat). */
export const checkinTags = (body: string): string[] => availabilityTags(body);
