// Inbound message understanding: the deterministic floor that never depends on a model. Every
// member message is classified before anything else touches it: what the member wants (a person, a
// plan, an answer), abuse signals (spam and sales, scams, contact extraction, prompt injection,
// harassment), signs that the sender is under 18, and the answer to a yes-or-no question (consent).
// The LLM layer (extract.ts) can add what these rules miss, but it can never turn a refusal, a
// conditional or a hedge read here into a yes (PRD 32.14 safety classifier, 17.4 minors).
//
// The rules were rebuilt against hand-written corpora (test/fixtures), not the simulator's own
// sentences (audit 2026-10-08, network-consent-1, -2, -8, -9, -10, matching-e2e-1, -M1).
import { parseReply, type Category } from "@thenetwork/core";
import type { TimeOption } from "@thenetwork/core";
import { DESIRES, INTERESTS, SKILLS } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import { NEIGHBORHOODS } from "./geo.ts";

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
  /** An age the sender states about someone else ("he's only 15"), for reports. */
  otherAge?: number;
  /**
   * The message tells us what someone else did ("he asked me to venmo him $50"). Abuse words in it
   * are about that person, never the sender's own abuse (network-consent-4).
   */
  disclosure?: Abuse[];
  /** For requests: what they want. */
  desireId?: string; category?: Category; tags: string[];
  /** Wants the member said they do NOT want ("I don't want to meet other founders"). */
  notWanted?: string[];
  /** For invites: the friend's first name. */
  friendName?: string;
  /** For block/report: the name they gave. */
  target?: string;
  /** The original text. */
  text?: string;
}

/** Lower case, NFKC, straight quotes. */
export const normText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, "\"");

const RX = {
  link: /(https?:\/\/|www\.|bit\.ly|\b[a-z0-9-]+\.(co|com|io|ly|biz|net)\b)/i,
  // Promotion is an offer or a push to the speaker's own thing, never "I work at my startup".
  sales: /\b(\d+% off|promo code|discount code|use (my )?code|free (consult(ation)?|trial|session|webinar)|coaching business|mastermind|only \$\d+|sign ?up (now|today)|book a call|dm me (for|to)|limited (spots|time offer)|special offer|insurance plan|(check out|join|buy|subscribe to|follow|promote|share|send people to|pass along) my (business|company|agency|brand|course|newsletter|channel|page|link|program|product|app|community|startup)|my (course|newsletter|mastermind|coaching program|agency) (is|has) (free|only|half|on sale|\d+%|launching|open for)\b)/i,
  blast: /\b(blast|send (this|my link) to (all|everyone|your matches)|all members|everyone in (the network|sf|nyc|new york)|share my link)\b/i,
  // Money ASKS toward the sender and returns pitches, never topics ("I'm into crypto") and never the
  // sender paying for a favor ("I'll pay $50").
  scam: /(\b(send|wire|transfer|lend|loan|venmo|zelle|cash ?app|paypal|give)\s+(me|us)\b[^.?!]{0,40}(\$\s?\d+|\bmoney\b|\bdeposit\b|\bfunds?\b|\bcash\b|\bbitcoin\b|\bcrypto\b)|\b(ask|get|have|tell)\s+\w+\s+to\s+(send|wire|venmo|zelle|pay|transfer|lend|loan)\s+(me|us)\b|\$\s?\d+[^.?!]{0,40}\b(deposit|pay (it|you) back|loan)\b|\bguaranteed (returns?|profits?)\b|\b\d+% (monthly|weekly|daily) returns?\b|\binvestment opportunity\b|\bgift cards?\b[^.?!]{0,30}\b(buy|send|code)\b)/i,
  // Asking for OTHER people's contact details. "My phone number" or "the venue's address" are not.
  scamToMe: /\b(send|wire|transfer|lend|loan|venmo|zelle|cash ?app|paypal|give)\s+(me|us)\b[^.?!]{0,40}(\$\s?\d+|\bmoney\b|\bdeposit\b|\bfunds?\b|\bcash\b|\bbitcoin\b|\bcrypto\b)/i,
  extraction: /(\b(what'?s|whats|what is|what are|give me|send me|share|get me|can i (get|have)|i need|i want|pass me)\s+(the\s+)?((?!(?:venue|place|restaurant|bar|cafe|spot|park|gym|museum|library|event|club|studio|gallery|theater|theatre|network|app|meetup|building|shop|store)'s)\w+'s|his|her|their|them|everyone'?s?|members'?)\s+((phone |cell )?numbers?|phone|cell|address(es)?|emails?|instagram|ig|insta|socials|snap(chat)?|handles?|contacts?|last names?)\b|\bphone numbers? of\b|\bnumbers of (everyone|all|members|the)\b|\b(their|members'?) (phone )?numbers\b|\b(?!(?:venue|place|restaurant|bar|cafe|spot|park|gym|museum|library|event|club|studio|gallery|theater|theatre|network|app)'s)\w+'s (number|phone|cell|address|email|instagram|ig|insta)\b|\bhome address(es)?\b|\bcontact (details|info) (for|of)\b|\bthe (number|phone|insta|instagram|email) (of|for) (the |that )?(girl|guy|person|woman|man|one)\b|\bprivate notes\b|\bagent_private\b)/i,
  injection: /(ignore (all )?(the |your |my )?(previous|prior|above) (instructions|prompts?|rules)|system override|you are now (in |a |an )?(developer|admin|god|dan|jailbreak|unrestricted|unfiltered)|admin (debug )?mode|developer mode|<\/?\w+_message>|^\s*(assistant|system)\s*:|print (the|your|all) (system|prompt|instructions|database|members|member list|private)|reveal your (system )?(prompt|instructions)|jailbreak)/im,
  harassment: /\b((they|he|she) owes? me|make (them|her|him) (answer|reply|respond|talk to me)|why won'?t (they|she|he) (answer|reply|respond|text)|i know where (they|she|he|you) lives?|(you|he|she|they)'?ll regret|(you|he|she|they) will regret|or else\b)/i,
  // Unasked sexual demands (scored as harassment): "send nudes", "send me naked pics". A story about
  // someone else who asked is a disclosure (DISCLOSURE), never the sender's own.
  sexual: /\b(send|sending|share|text|dm) (me )?(some |your |a )?(nudes?|nude (pics?|photos?|selfies?)|naked (pics?|photos?|selfies?)|dick pics?|pics of your (body|tits|boobs|ass))\b|\b(wanna|want to|let me) see (you )?naked\b/i,
  invite: /\b[Mm]y (?:friend|buddy|pal|coworker|roommate|cousin) ([A-Z][a-z]+)\b/,
  inviteIntent: /\b(invite|bring|add|sign \w+ up|sign up|refer|include|loop in)\b|\bwould (love|like|enjoy|be into) (this|it|that|joining)\b|\b(wants?|wanted) (to join|in)\b|\bhas been (wanting|looking)\b|\bshould (join|be here|get an invite)\b|\blooking for something like this\b/i,
  cancel: /\b(can'?t make it|have to bail|can'?t come|need to cancel|something came up)\b/i,
  block: /^\s*(?:please\s+)?block\s+(?!(?:back|on|out|off|of|time|my|the|this|that|it|in|for|a)\b)(.+)$/i,
  report: /^\s*(?:please\s+|i (?:want|need|'d like) to\s+)?report\s+(?!(?:back|on|to|that|this|it|in|for|my|the|when)\b)(.+)$/i,
  plans: /\b(anything fun|what'?s (on|happening|good)|something to do|plans? (this|for the) (weekend|week|tonight)|fun (going on|this weekend)|any (events|plans))\b/i,
  peopleAsk: /\b(anyone (around|who|want|up for)|looking for (a |an |someone|people|other|more)|hoping to|find (me )?(a|an|someone|people)|want to meet|wanna meet|know anyone|still hoping|would love to (meet|find)|i'?d (love|like) to (meet|find)|searching for|in search of)\b/i,
  feedback: /\b(it was (great|nice|fine|fun|good|ok|okay)|we (really )?clicked|(not|wasn'?t) great|didn'?t (really )?click|never showed|would (definitely )?(do it|meet|hang out) again|not much in common)\b/i,
  ack: /^(thanks|thank you|got it|ok|okay|👍|see you|sounds good|perfect|works for me|great|cool|nice)\b/i,
};

/**
 * Third-party narrative: the sender tells us what someone else did or said. Abuse words inside such
 * a sentence describe that person (a disclosure), never the sender.
 */
const DISCLOSURE = /\b(he|she|they|someone|somebody|this (guy|girl|person|dude|man|woman)|[a-z]+) (asked|asks|wanted|wants|told|tells|keeps? asking|kept asking|tried|said|says|is asking|was asking|messaged|texted|dm'?d|demanded|threatened)\b/i;
const NOT_A_PERSON = /^(i|we|you|it|that|this|which|what|who|mom|dad|the|a|an)$/i;

/** Teachers, coaches and parents talk about school; that is not a sign the sender is a minor (network-consent-10). */
const ADULT_SCHOOL_CTX = /\b(teach|teacher|teaching|coach|coaching|tutor|tutoring|professor|my (kid|kids|son|daughter|students?|class|child|children)|our (kids|students)|i work (at|in) a (high |middle )?school|went to (high|middle) school|in high school i|back in (high|middle) school|my high school (days|years|friends))\b/;
/** First-person signs of being under 18 that are not an age. One sentence at a time. */
const MINOR_SIGNS = /\b((i (have|got|gotta)|i've got|finishing|studying for|doing) (my |a |so much )?(homework|hw|(math|chem|bio|history|physics|spanish|english|algebra|geometry) (test|quiz|homework)|finals|midterms|a quiz)|math test|my (mom|dad|mum|parents|mother|father) (says?|said|won'?t|wont|doesn'?t|don'?t|grounded|makes?)\b|i'?m grounded|school nights?|(my|going to|go to) (prom|homecoming)\b|i get out of school|(after|before) school (today|tomorrow|tmrw|tmr)\b|(can|could) (we|i)[^.?!]{0,30}after school|i'?m (a minor|underage)|im (a minor|underage)|when i turn (1[4-8]|sixteen|seventeen|eighteen))/;

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\b(date|dating|romance|romantic|partner to date)\b/i, "romance"],
  [/\b(founder|startup|career|mentor|job|pitch|investor|work|collaborator|professional)\b/i, "professional"],
  [/\b(help|move|moving|couch|fix|carry)\b/i, "help"],
  [/\b(learn|class|lesson|try|practice)\b/i, "growth"],
  [/\b(friends?|people|hang|dinner|community)\b/i, "social"],
];

/** Sentences (and clauses after "but"): the scope of a negation or a disclosure. */
export function sentencesOf(t: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  const re = /[^.!?;\n]+[.!?;\n]*/g;
  for (const m of t.matchAll(re)) if (m[0].trim()) out.push({ text: m[0], at: m.index! });
  return out.length ? out : [{ text: t, at: 0 }];
}

export function classify(body: string): Classified {
  const t = body.trim();
  const low = normText(t);
  const abuse: Abuse[] = [];
  const disclosed: Abuse[] = [];
  let risk = 0;
  // Abuse is read per sentence: a sentence that tells what someone else did is a disclosure.
  const sents = sentencesOf(t);
  const hit = (rx: RegExp, kind: Abuse, points: number) => {
    let own = false, told = false;
    for (const s of sents) if (rx.test(s.text)) { if (DISCLOSURE.test(s.text) && !NOT_A_PERSON.test(DISCLOSURE.exec(s.text)![1]!)) told = true; else own = true; }
    if (own) { abuse.push(kind); risk += points; } else if (told) disclosed.push(kind);
  };
  const link = RX.link.test(t);
  if (RX.sales.test(t) || (link && /\b(join|buy|sign ?up|offer|members|matches|link|discount|subscribe)\b/i.test(t))) { abuse.push("sales_spam"); risk += link ? 3 : 2; }
  hit(RX.blast, "mass_recruit", 3);
  // Money asked for the sender ("send me $100") is the sender's own ask even inside a story about someone else.
  if (RX.scamToMe.test(t)) { abuse.push("scam_money"); risk += 6; } else hit(RX.scam, "scam_money", 6);
  hit(RX.extraction, "contact_extraction", 2);
  if (RX.injection.test(t)) { abuse.push("prompt_injection"); risk += 3; }
  hit(RX.harassment, "harassment", 3);
  if (!abuse.includes("harassment")) hit(RX.sexual, "harassment", 3);
  const { age, explicit } = agesStated(t);
  const minorSignal = minorSignOf(low) || (age !== undefined && age < 18);
  const out: Classified = { kind: "other", abuse, risk, minorSignal, statedAge: age, explicitAge: explicit, tags: [], text: t };
  if (disclosed.length) out.disclosure = disclosed;
  const other = otherAgeStated(t);
  if (other !== undefined) out.otherAge = other;

  const blk = RX.block.exec(t), rep = RX.report.exec(t);
  if (blk) return { ...out, kind: "block", target: blk[1]!.trim() };
  if (rep) return { ...out, kind: "report", target: rep[1]!.replace(/[,;:.!?].*$/, "").trim() };
  if (RX.cancel.test(t)) return { ...out, kind: "cancel" };
  const inv = RX.invite.exec(t);
  if (inv && RX.inviteIntent.test(t)) return { ...out, kind: "invite_friend", friendName: inv[1] };
  if (RX.feedback.test(t)) return { ...out, kind: "feedback_like" };

  // What do they want? Wants the member negates are left out ("I don't want to meet founders").
  const x = extractProfile(t);
  const desire = x.desireIds.length ? DESIRES.find(d => d.id === x.desireIds[0]) : undefined;
  const tags = new Set<string>([...x.interests, ...x.skills]);
  if (desire) desire.needsInterests.forEach(i => tags.add(i));
  out.tags = [...tags];
  if (x.notWanted.length) out.notWanted = x.notWanted;
  if (desire) { out.desireId = desire.id; out.category = desire.category; }
  else if (!x.negatedAsk) out.category = CATEGORY_WORDS.find(([rx]) => rx.test(t))?.[1];

  if (abuse.length && !desire) return out;
  if (RX.plans.test(t) && !x.negatedAsk) return { ...out, kind: "plans_request", category: out.category ?? "events" };
  if (desire || (RX.peopleAsk.test(t) && !x.negatedAsk)) return { ...out, kind: "people_request", category: out.category ?? "social" };
  if (RX.ack.test(t) || t.length < 12) return { ...out, kind: "ack" };
  return out;
}

/** A first-person sign of being under 18, sentence by sentence, never in a teacher's or parent's sentence. */
export function minorSignOf(text: string): boolean {
  for (const s of sentencesOf(normText(text))) if (MINOR_SIGNS.test(s.text) && !ADULT_SCHOOL_CTX.test(s.text)) return true;
  return false;
}

const AGE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const ORDINAL: Record<string, number> = { sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const ME = "(?:i'?m|i am|im)";
/** "only 15", "just 15", "literally 15" are the age; "almost 16", "turning 16" are one less. */
const SAME = "(?:(?:only|just|literally|like|barely)\\s+)?";
const LESS = "(?:almost|nearly|turning|about to (?:be|turn))\\s+";
const NUM_WORD = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
/** "years old", "yrs old", "y/o", "yo": the explicit form of an age. A bare "years" is not ("I'm 4 years sober"). */
const YEARS_OLD = "(?:y(?:ears?|rs?)[\\s-]+old|y\\.?\\/?o\\.?|years of age)(?![a-z])";
// A number is read as an age only when the clause ends right after it, or goes on like an age:
// "I'm 15.", "I'm 15, live in...", "I'm 15 lol", "I'm 15 years old". "I'm 15 minutes away",
// "I'm 3 for 3" and "I'm 12 years into my career" are not ages.
const CLAUSE_END = "$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|y(?:ea)?rs?\\s*(?:$|[.,!?;:)])";
const AGE_END = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}))`;
// "and", "now" and "too" also end an age, but only for 13 and up: "I'm 3 and 0 this season" or
// "I'm 2 years in nyc now" must never decline an adult (a decline deletes the member's data).
// Also "actually", "tbh", "honestly", "fyi" and "last week": "I'm 15 actually", "I turned 13 last week".
const AGE_END_LOOSE = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}|and\\b|now\\b|too\\b|turning\\b|actually\\b|tbh\\b|honestly\\b|fyi\\b|last (?:week|month|year)\\b|yesterday\\b|recently\\b|in (?:high|middle) school\\b))`;
/** "15f", "16 m", "15/f": an age and a sex, the way teens introduce themselves. Never "15m away" or "raised 15m". */
const AGE_SEX_END = "(?=\\s*(?:$|[.,!?;:)]|here\\b|lol\\b|btw\\b|from\\b|in\\b|looking\\b|nyc\\b|bk\\b))";
const atLeast13 = (n: number) => (n >= 13 ? n : NaN);
/** Ages the loose forms may read: a teen or an adult. Under 13 needs a strict form. */
const teenOrAdult = (n: number) => (n >= 10 && n < 100 ? n : NaN);
const SCHOOL_YEAR: Record<string, number> = { freshman: 14, sophomore: 15, junior: 16, senior: 17 };
/**
 * Words just before "I'm 12" that make it not a statement of the sender's age today: "I act like
 * I'm 12", "when I was 12", "if I'm 12", "she said I'm 12" (network-service-1).
 */
const NOT_NOW = /(?:\blike|\bas if|\bas though|\bpretend(?:ing)?(?: that)?|\bwhen|\bif|\bimagine|\bsays?|\bsaid|\bfeel(?:s|ing)? like|\bacts?|\bacting|\bthink|\bthinks|\bthought|"|')\s*$/;
type AgeRule = { rx: RegExp; age: (m: RegExpExecArray) => number; explicit?: boolean };
const AGE_RX: AgeRule[] = [
  // Explicit: "I am 12 years old", "im 15 y/o", "my age is 12", "15 y/o here", "age: 15".
  { rx: new RegExp(`\\b(?:${ME}\\s+${SAME}|my age is\\s+)(\\d{1,2})\\s*${YEARS_OLD}`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`\\b${ME}\\s+${SAME}(one|two|three|four|five|six|seven|eight|nine|${NUM_WORD})[\\s-]+${YEARS_OLD}`), age: m => AGE_WORDS[m[1]!]!, explicit: true },
  { rx: new RegExp(`\\bmy age is\\s+(\\d{1,2})${AGE_END}`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(?:my )?age\\s*[:=-]?\\s*(\\d{1,2})${AGE_END}`), age: m => Number(m[1]), explicit: true },
  // Leading "15 y/o here", "12yo." (only when it is about the sender: "12 yo whisky is great" is not).
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(\\d{1,2})\\s*${YEARS_OLD}(?=\\s*(?:$|[.,!?;:)]|here\\b|lol\\b|btw\\b))`), age: m => Number(m[1]), explicit: true },
  // "I'm 15", "I'm only 15", "I just turned 12!", "I'm fifteen".
  { rx: new RegExp(`\\b(?:${ME}\\s+${SAME}|i (?:just )?turned\\s+)(\\d{1,2})${AGE_END}`), age: m => Number(m[1]) },
  { rx: new RegExp(`\\b(?:${ME}\\s+${SAME}|i (?:just )?turned\\s+)(\\d{1,2})${AGE_END_LOOSE}`), age: m => atLeast13(Number(m[1])) },
  { rx: new RegExp(`\\b(?:${ME}\\s+${SAME}|i (?:just )?turned\\s+)(${NUM_WORD})${AGE_END}`), age: m => AGE_WORDS[m[1]!]! },
  { rx: new RegExp(`\\b(?:${ME}\\s+${SAME}|i (?:just )?turned\\s+)(${NUM_WORD})${AGE_END_LOOSE}`), age: m => atLeast13(AGE_WORDS[m[1]!]!) },
  // "I'm almost 16", "I'm turning 16", "I'll be 16 in May", "I turn 16 next month": one less.
  { rx: new RegExp(`\\b${ME}\\s+${LESS}(\\d{1,2}|${NUM_WORD})\\b(?!\\s*(?:minutes|mins?|hours|hrs|blocks|miles|km|percent|%|feet|ft|times|for\\b|of\\b))`), age: m => teenOrAdult((/^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!) - 1) },
  { rx: new RegExp(`\\bi(?:'ll| will) be\\s+(\\d{1,2}|${NUM_WORD})\\s+(?:in|on|next|this|soon)\\b`), age: m => teenOrAdult((/^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!) - 1) },
  { rx: new RegExp(`\\bi turn\\s+(\\d{1,2}|${NUM_WORD})\\s+(?:in|on|next|this|soon)\\b`), age: m => teenOrAdult((/^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!) - 1) },
  { rx: /\bwhen i turn\s+(1[4-8]|sixteen|seventeen|eighteen)\b/, age: m => (/^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!) - 1 },
  // "15f here", "16 m", "15/f", "im 15f", "f15".
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(?:${ME}\\s+)?(1\\d|\\d)\\s*\\/?\\s*[fmx](?![a-z])${AGE_SEX_END}`), age: m => teenOrAdult(Number(m[1])) },
  { rx: new RegExp(`\\b${ME}\\s+(1\\d|\\d)\\s*\\/?\\s*[fm](?![a-z])${AGE_SEX_END}`), age: m => teenOrAdult(Number(m[1])) },
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?[fm]\\s*\\/?\\s*(1\\d)${AGE_SEX_END}`), age: m => Number(m[1]) },
  // "15 here", "16 lol" as the whole opening.
  { rx: /^\W*(1[0-7])\s+(?:here|lol)\b/, age: m => Number(m[1]) },
  // "I'm a minor", "I'm under 18", "I'm underage": a minor (17 fails closed; never a decline).
  { rx: new RegExp(`\\b${ME}\\s+(?:a minor|underage|under ?age|under 18|not 18 yet|not (?:an )?adult yet)\\b`), age: () => 17 },
  // School year: "I'm a sophomore in high school", "I'm a high school junior", "junior at Lincoln High", "I'm in 7th grade", "9th grader".
  { rx: new RegExp(`\\b${ME}\\s+(?:a\\s+)?(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+(?:high school|hs)\\b`), age: m => SCHOOL_YEAR[m[1]!]! },
  { rx: new RegExp(`\\b${ME}\\s+(?:a\\s+)?(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+[\\w' .-]{1,30}?\\bhigh(?: school)?\\b`), age: m => SCHOOL_YEAR[m[1]!]! },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(?:high school|hs)\\s+(freshman|sophomore|junior|senior|student)\\b`), age: m => SCHOOL_YEAR[m[1]!] ?? 15 },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(6|7|8|9|10|11|12)(?:st|nd|rd|th)\\s+grader\\b`), age: m => Number(m[1]) + 5 },
  // "grade" must end the clause: "I'm in 7th grade classrooms all day as a teacher" is not an age.
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(6|7|8|9|10|11|12)(?:st|nd|rd|th)?\\s+grade(?=\\s*(?:${CLAUSE_END}|and\\b|now\\b))`), age: m => Number(m[1]) + 5 },
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\\s+grade(?=\\s*(?:${CLAUSE_END}|and\\b|now\\b))`), age: m => ORDINAL[m[1]!]! + 5 },
  // Middle school (ages 11-14) alone fails closed to "minor", not to "under 13": a decline deletes the
  // member's data, so it needs an explicit age or grade ("I'm 12", "I'm in 6th grade").
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:still\\s+)?(?:in|at)|i go to)\\s+middle school\\b(?!\\s*(?:teacher|counselor|principal|nurse|coach|librarian|aide|staff))|\\bi'?m a\\s+middle schooler\\b`), age: () => 13 },
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:still\\s+)?(?:in|at)|i go to)\\s+high school\\b`), age: () => 15 },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(?:high schooler|hs student|high school student)\\b`), age: () => 15 },
];

/**
 * The youngest age the sender states about themselves, and the youngest they state in the explicit
 * form ("I am 12 years old"). First person and present tense only, so "my son is 12", "I teach
 * middle school" or "I act like I'm 12" never change the member's age.
 */
export function agesStated(body: string): { age?: number; explicit?: number } {
  const t = normText(body);
  const out: { age?: number; explicit?: number } = {};
  for (const { rx, age, explicit } of AGE_RX) {
    const m = rx.exec(t);
    if (!m) continue;
    if (NOT_NOW.test(t.slice(Math.max(0, m.index - 24), m.index))) continue;
    const a = age(m);
    if (!Number.isFinite(a)) continue;
    if (out.age === undefined || a < out.age) out.age = a;
    if (explicit && (out.explicit === undefined || a < out.explicit)) out.explicit = a;
  }
  return out;
}

/** The youngest age the sender states about themselves, or undefined. */
export const statedAge = (body: string): number | undefined => agesStated(body).age;

const KIN = "son|daughter|kid|kids|child|baby|brother|sister|nephew|niece|cousin|dog|cat|puppy|car|lease|apartment|building|startup|company|record|streak|bike|laptop|phone";
const OTHER_AGE_RX: AgeRule[] = [
  { rx: new RegExp(`\\b(?!(?:${KIN}|i|it|that|this|there|which|what|who)\\b)(he|she|they|[a-z][a-z'-]+)(?:'s|'re| is| are)\\s+${SAME}(\\d{1,2})${AGE_END}`), age: m => Number(m[2]) },
  { rx: new RegExp(`\\b(?!(?:${KIN}|i|it|that|this|there|which|what|who)\\b)(he|she|they|[a-z][a-z'-]+)(?:'s|'re| is| are)\\s+${SAME}(${NUM_WORD})${AGE_END}`), age: m => AGE_WORDS[m[2]!]! },
  { rx: /\b(he|she|they)(?:'s|'re| is| are)\s+(?:still\s+)?(?:a minor|underage|under 18|in (?:high|middle) school|a (?:high school|hs|middle school) (?:student|freshman|sophomore|junior|senior)|a (?:freshman|sophomore|junior|senior) in (?:high school|hs)|a kid|a teen(?:ager)?)\b/, age: () => 17 },
  { rx: /\b(?:he|she|they) (?:said|told me|says|mentioned) (?:he|she|they)(?:'s|'re| is| are| was| were) (?:only |just )?(\d{1,2})\b/, age: m => Number(m[1]) },
];

/** An age the sender states about someone else ("he's only 15", "she's in high school"); under 18 only. */
export function otherAgeStated(body: string): number | undefined {
  const t = normText(body);
  let best: number | undefined;
  for (const { rx, age } of OTHER_AGE_RX) {
    const m = rx.exec(t);
    if (!m) continue;
    const a = age(m);
    if (Number.isFinite(a) && a < 18 && a > 0 && (best === undefined || a < best)) best = a;
  }
  return best;
}

/**
 * The answer to "How old are you?": the whole message is an age ("34", "I'm 34.", "15 years old",
 * "fifteen"). Anything more is not read as an answer here (classify() reads ages in sentences).
 */
export function ageAnswer(body: string): number | undefined {
  const t = normText(body).trim();
  const m = new RegExp(`^(?:${ME}\\s+)?(\\d{1,3}|${Object.keys(AGE_WORDS).join("|")})(?:\\s*${YEARS_OLD})?\\s*[.!]*$`).exec(t);
  if (!m) return undefined;
  const n = /^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!;
  return n > 0 && n < 120 ? n : undefined;
}

// ------------------------------------------------------------------ what a member tells us (offline)
// The offline extractor: a concept lexicon per want, interest and skill, read sentence by sentence
// with negation scope. It never guesses: an area it does not know stays unset (never "Midtown"), a
// skill is only the sender's own ("I play bass", not "looking for a bassist"), and a negated want is
// not a want. The LLM layer (extract.ts) adds what this misses; this is what runs with no model.

/** A want, as concepts. Each pattern is one way people say it. `ctx`: the sentence must also say they want something. */
const WANT_LEX: Record<string, RegExp[]> = {
  start_band: [/\b(start(ing)?|form(ing)?|put(ting)? together|join(ing)?|find|looking for|need|want)\b[^.!?]{0,40}\b(a )?(rock |punk |indie |cover |garage )?(band|bandmates?)\b/, /\b(people|musicians|someone|others) to (jam|play music|start a band) with\b/, /\bjam (sessions?|partners?|buddies)\b/, /\b(need|looking for|want|find|searching for)\b[^.!?]{0,20}\b(a )?(drummer|bassist|guitarist|singer|vocalist|keys player) for\b/, /\b(drummer|bassist|guitarist|singer|vocalist|keys player) for (a|my|our) band\b/, /\brock band\b/],
  learn_sailing: [/\b(learn|learning|teach me|lessons?|get into|try|pick up|take up|figure out)\b[^.!?]{0,30}\b(sail|sailing|sailboats?)\b/, /\b(sail|sailing) (lessons?|class|instructor|course)\b/, /\blearn to sail\b/, /\bteach me (to |how to )?(sail|sailing)\b/],
  climbing_partner: [/\b(climb|climbing|boulder|bouldering|belay|rock gym|climbing gym)\w*\b[^.!?]{0,40}\b(partner|buddy|buddies|someone|people|friend|crew|pal)\b/, /\b(partner|buddy|someone|people|friend|pal)\b[^.!?]{0,30}\b(climb|boulder|belay)/],
  tennis_partner: [/\btennis\b[^.!?]{0,40}\b(partner|buddy|someone|people|friend|opponent|hit(ting)?|rally|doubles)\b/, /\b(partner|buddy|someone|people|friend|opponent)\b[^.!?]{0,30}\btennis\b/, /\bhit (some )?(tennis )?balls\b/],
  meet_founders: [/\b(meet|connect with|find|know|network with|talk to|grab coffee with|hang with|swap notes with|learn from|other|fellow|more|looking for)\b[^.!?]{0,30}\b(founders?|co-?founders|entrepreneurs?|startup (people|folks|crowd|founders|ceos?))\b/, /\bfounder (friends?|buddies|peers|community)\b/, /\b(people|folks|others) (building|running|starting) (startups?|companies|a company)\b/],
  climate_people: [/\bclimate\b[^.!?]{0,40}\b(people|folks|crowd|professionals?|community|network|space|world|scene|types)\b/, /\b(people|folks|others|anyone)\b[^.!?]{0,30}\b(climate|sustainability|clean ?energy|decarboni[sz]ation|renewables?)\b/, /\b(work|working|career|job|jobs) in (climate|clean ?energy|sustainability)\b/],
  ai_mentor: [/\b(mentor|mentorship|advice|guidance|someone senior|senior (ml |ai )?(person|engineer|researcher|people|folks)|career advice|pick (someone'?s|their|a) brain|learn from)\b[^.!?]{0,50}\b(ai|ml|machine learning|llms?)\b/, /\b(ai|ml|machine learning)\b[^.!?]{0,40}\b(mentor|mentorship|advice|guidance|someone senior|career)\b/],
  new_friends: [/\b(make|making|find|meet|meeting|need|want|looking for)\s+(?:(?:some|a few|new|more|real|good|actual|close)\s+)*(friends|pals)\b/, /\bpeople to hang( out)? with\b/, /\b(some|a few|new|more) (buddies|pals)\b/, /\bnew friends\b/, /\b(expand|grow|widen)\b[^.!?]{0,10}\b(my )?(social )?circle\b/, /\b(don'?t|do not) know (many|anyone|a lot of|much of anyone) (people )?(here|in (the city|nyc|new york))\b/, /\bfriend group\b/, /\blonely\b/],
  dinner_club: [/\b(dinner (club|group|party|parties|crew)|supper club|potlucks?|regular dinners?|group dinners?|monthly dinners?|people to (cook|eat) with|cook(ing)? together)\b/],
  film_buddies: [/\b(film|films|movie|movies|cinema|screenings?|flicks)\b[^.!?]{0,40}\b(buddy|buddies|people|friends?|someone|crew|club|group|partner)\b/, /\b(someone|people|friends?|buddy)\b[^.!?]{0,30}\b(see|watch|catch|go to)\b[^.!?]{0,20}\b(films?|movies?|screenings?)\b/, /\b(film|movie) (club|nights?)\b/, /\b(catch|see|watch) (a |some )?(film|movie|flick)s?\b/],
  ceramics_class: [/\b(try|learn|take|get into|start|do)\b[^.!?]{0,30}\b(ceramics|pottery|wheel throwing|throwing on the wheel|clay)\b/, /\b(ceramics|pottery|wheel) (class|classes|course|studio|lessons?|workshop)\b/, /\bthrow(ing)? on the wheel\b/],
  moving_help: [/\b(help|hand|assist|someone)\w*\b[^.!?]{0,40}\b(mov(e|ing)|couch|sofa|furniture|haul|carry|lift|boxes|dresser)\b/, /\b(mov(e|ing)|haul|carry|lift)\b[^.!?]{0,30}\b(couch|sofa|furniture|dresser|boxes|bed|mattress)\b/, /\bsomeone with a (truck|van)\b/],
  pitch_feedback: [/\b(pitch|deck|pitch ?deck|investor deck|slides)\b[^.!?]{0,40}\b(feedback|look|review|eyes|notes|critique|thoughts|tear apart|read)\b/, /\b(feedback|review|eyes|critique|notes)\b[^.!?]{0,40}\b(pitch|deck)\b/, /\b(look at|tear apart|read|review|thoughts on|notes on|go over)\b[^.!?]{0,15}\b(my|our|the) (pitch|deck|pitch ?deck|seed deck)\b/],
  dating: [/\b(someone|somebody|people|a (guy|girl|woman|man|person)) to date\b/, /\bgo(ing)? on (a |some |more )?dates?\b/, /\bdating\b/, /\b(find|meet|looking for|want|date)\b[^.!?]{0,20}\b(a |my )?(girlfriend|boyfriend|husband|wife|special someone|romantic partner|life partner|relationship)\b/, /\bromance\b|\bromantic\b/, /\bmeet someone (special|to date)\b/],
  chess_games: [/\bchess\b[^.!?]{0,40}\b(play|games?|opponent|partner|someone|people|otb|over the board|club|blitz|match)\b/, /\b(play|games?|someone|opponent)\b[^.!?]{0,25}\bchess\b/, /\bchess (opponents?|players?|buddy|buddies|partners?|club)\b/],
  parent_friends: [/\b(other |fellow )(parents|moms|dads|mums|families)\b/, /\bplaydates?\b/, /\b(parent|mom|dad|mum) friends\b/, /\b(parents|moms|dads|families) (nearby|in the neighborhood|around here|with (kids|toddlers|little ones|little kids))\b/, /\bparents\b[^.!?]{0,40}\b(meet ?up|hang|connect|get together)\b/],
  run_club: [/\b(run|running|jog|jogging)\b[^.!?]{0,40}\b(club|group|buddy|buddies|partner|people|crew|pals?|with (someone|others|people|a group))\b/, /\b(someone|people|others|anyone|buddy|group)\b[^.!?]{0,20}\b(to )?(run|jog) with\b/, /\b(run|jog) together\b/],
  writing_group: [/\bwrit(ing|ers?)\b[^.!?]{0,40}\b(group|workshop|circle|critique|accountability|club|crew|feedback|partners?)\b/, /\b(critique|workshop) (group|circle)\b[^.!?]{0,30}\b(writing|stories|fiction|poems?|essays?)\b/, /\b(other|fellow) writers\b/],
  hardware_collab: [/\b(hardware|electronics|circuit|circuits|pcb|arduino|raspberry pi|robot|robotics|embedded|maker)\b[^.!?]{0,50}\b(collaborat\w*|partner|someone|teammate|co-?build|help)\b/, /\b(collaborat\w*|partner|someone|teammate)\b[^.!?]{0,40}\b(hardware|electronics|pcb|arduino|robot|embedded)\b/, /\bhelp with\b[^.!?]{0,20}\b(circuits?|pcbs?|arduino|electronics|soldering|wiring)\b/],
  photo_walks: [/\bphoto ?walks?\b/, /\bphotography walks?\b/, /\b(shoot|shooting) (photos|street|together|around the city)\b/, /\bstreet photography\b/, /\bgo (out )?shooting\b/, /\bphoto (meetups?|buddies|crew|group)\b/, /\b(walk|walks|wander)\b[^.!?]{0,30}\b(cameras?|photos|pictures)\b/, /\b(take|taking|shoot|shooting) (photos|pictures) with\b/],
};
/** Sentences that ask for something (a want), as opposed to telling what they like. */
const WANT_CTX = /\b(want|wanted|wanna|looking|hoping|hope|like to|love to|love a|love some|i'?d like|i would like|need|needs|trying|searching|seeking|find|meet|any|anyone|anybody|would|keen|interested in|help me|could use|start|join|learn|try|get|wish|miss|lonely|dreaming|down to|up for|open to|on the hunt|in search|can someone|could someone)\b|\?/;
/** Wants that need no want verb: the phrase is a want by itself ("help moving a couch", "I don't know anyone here"). */
const SELF_WANTS = new Set(["dating", "dinner_club", "photo_walks", "moving_help", "pitch_feedback", "new_friends"]);
/**
 * Activity wants read across the whole message: the activity in one sentence and the ask in another
 * ("anyone into bouldering? looking for a crew"). Both must be there, and the ask not negated.
 */
const ACTIVITY_WANTS: [string, RegExp][] = [
  ["climbing_partner", /\b(climb|climbing|boulder|bouldering|belay|rock gym)\b/], ["tennis_partner", /\btennis\b/], ["run_club", /\b(running|jog|jogging)\b(?! (startups?|a |the |companies|businesses|late|errands|out|around|low))/],
  ["chess_games", /\bchess\b/], ["film_buddies", /\b(films?|movies?|cinema|screenings?)\b/],
];
const ACTIVITY_ASK = /\b(partner|buddy|buddies|someone|somebody|anyone|anybody|people|crew|group|club|opponents?|players?|together|join me|with me)\b/;
/** A negation that scopes over a want or a like in its sentence ("I don't want to meet founders", "not into dating"). */
const NEG_WANT = /\b(don'?t|do not|doesn'?t|does not|never|not|no longer|no more|nothing|stop|avoid|without|rather not|hate|can'?t stand|not into|not a fan of|not interested|not looking|not trying|over it|(?:i'?m|im) over|done with|sick of|tired of)\b|^\s*no\b|\bno\b(?=[^.!?]*\b(?:please|for me|thanks|thank you)\b)/;

const INTEREST_LEX: Record<string, RegExp> = {
  climbing: /\b(climb|climbing|climber|bouldering|boulder|rock gym|belay)\b/, running: /\b(running|runner|jogging|jog|marathons?|half marathon|5k|10k|run club)\b/,
  hiking: /\b(hike|hikes|hiking|hiker|trails|backpacking)\b/, cycling: /\b(cycling|cyclist|biking|bike rides?|road bike|road cycling)\b/, sailing: /\b(sail|sailing|sailor|sailboats?)\b/,
  tennis: /\btennis\b/, pickleball: /\bpickleball\b/, basketball: /\b(basketball|hoops|pickup ball|pickup games?)\b/,
  rock_music: /\b(rock music|punk|indie rock|classic rock|rock and roll|rock'?n'?roll)\b/, jazz: /\bjazz\b/, electronic_music: /\b(electronic music|techno|house music|edm|raves?|dj(ing)?)\b/,
  live_music: /\b(live music|concerts?|gigs|going to shows|live shows|music venues?)\b/, film: /\b(film|films|movies|cinema|screenings|movie buff|cinephile)\b/,
  ceramics: /\b(ceramics|pottery|clay)\b/, painting: /\b(painting|paint|watercolou?rs?|oil paints?|acrylics?)\b/, photography: /\b(photography|photographer|film camera|taking photos|taking pictures)\b/,
  theater: /\b(theater|theatre|broadway|improv|musicals)\b/, books: /\b(reading|books|novels|fiction|book club|bookworm|read a lot)\b/, philosophy: /\bphilosophy\b/,
  ai: /\b(ai|a\.i\.|machine learning|llms?|deep learning|artificial intelligence)\b/, climate_tech: /\b(climate tech|climate|clean ?energy|sustainability|renewables?)\b/, startups: /\b(startups?|start-ups?|entrepreneurship|founders?)\b/,
  crypto: /\b(crypto|bitcoin|ethereum|web3|blockchain)\b/, hardware: /\b(hardware|electronics|arduino|soldering|raspberry pi|pcbs?)\b/,
  cooking: /\b(cooking|cook|baking|bake|home cook|recipes)\b/, wine: /\b(wine|natural wine|sommelier)\b/, coffee: /\b(specialty coffee|coffee nerd|espresso|third wave coffee|pour ?overs?|coffee snob|into coffee|coffee shops)\b/,
  board_games: /\b(board ?games|tabletop|catan|d&d|dungeons and dragons|game nights?)\b/, chess: /\bchess\b/, volunteering: /\b(volunteer|volunteering|mutual aid|food bank)\b/,
  urbanism: /\b(urbanism|housing policy|housing advocacy|zoning|city planning|urban planning|transit advocacy|yimby)\b/, parenting: /\b(parenting|my kids|my toddler|my baby|i'?m a (mom|dad|parent)|(new|first[- ]time) (mom|dad|parent))\b/,
  dogs: /\b(dogs?|puppy|puppies|my pup)\b/, meditation: /\b(meditation|meditate|mindfulness)\b/, yoga: /\byoga\b/, dancing: /\b(dancing|dance|salsa|bachata|swing dancing)\b/,
  writing: /\b(writing|writer|poetry|poems|essays|screenwriting|short stories)\b/, gardening: /\b(gardening|garden|plants|community garden)\b/,
};
const SKILL_LEX: Record<string, RegExp> = {
  guitar: /\b(play(s|ing)? (the )?guitar|guitarist|on guitar)\b/, drums: /\b(play(s|ing)? (the )?drums|drummer|on drums)\b/, bass: /\b(play(s|ing)? (the )?bass|bassist|bass player|on bass)\b/,
  vocals: /\b(i sing|singer|vocalist|on vocals|sing in a)\b/, piano: /\b(play(s|ing)? (the )?(piano|keys)|pianist|keyboardist)\b/,
  sailing_instructor: /\b(teach(es|ing)? sailing|sailing instructor|i can teach (you |people )?to sail)\b/,
  climbing_belay: /\b((experienced|lead|strong|seasoned) climber|belay certified|i can belay|teach (beginners|people|newbies) to climb|love taking beginners)\b/,
  fundraising: /\b(raised (a |our |my )?(seed|series [a-c]|vc|venture|pre-?seed|funding|round|money from investors)|fundrais(ed|ing) for my|closed (a |our )?(seed|round))\b/,
  ml_engineering: /\b(ml engineer|machine learning engineer|ai engineer|ai researcher|ml researcher|i (build|train) (ml|models|llms))\b/, design: /\b(product designer|ux designer|ui designer|i'?m a designer|design lead)\b/,
  pottery_wheel: /\b(throw(s|ing)? pottery|on the wheel|potter)\b/, chef: /\b(chef|cook for (groups|crowds|big groups|lots of people)|line cook|cater)\b/, hosting: /\b(love hosting|host(ing)? dinners|i host|throw dinner parties)\b/,
  moving_help: /\b((have|own|got) a (truck|pickup|van)|strong arms)\b/, pitch_feedback: /\b(pitch-?deck feedback|review (pitch )?decks|i'?m an? (vc|investor|angel)|angel investor|venture capitalist)\b/,
  interview_practice: /\b(mock interviews?|interview prep|i run interviews|i interview (people|candidates))\b/, photography_pro: /\b(portrait photographer|shoot portraits|professional photographer|photographer by trade|wedding photographer)\b/,
  tennis_coach: /\b(tennis coach|strong tennis player|ntrp [4-5](\.\d)?|played (college|d1|varsity) tennis)\b/, hardware_eng: /\b(electrical engineer|hardware engineer|embedded engineer|ee by training)\b/,
  climate_policy: /\b(climate policy|work in climate|energy policy|climate nonprofit)\b/, writing_editor: /\b(i'?m an? editor|i edit|edits writing|professional editor|copy ?editor)\b/,
  chess_strong: /\b((fide|uscf|lichess|chess\.com) (rated|rating)|rated \d{4}|elo (of )?\d{4}|chess coach|\d{4} rated)\b/,
};
/** The sender's own skill is said in the first person; "looking for a bassist" is a want, not a skill. */
const FIRST_PERSON = /\b(i|i'm|im|i've|ive|i am|my|me)\b/;
const SEEKING = /\b(looking for|need|needs|want|wants|find|seeking|searching|someone who|anyone who|somebody who|a person who)\b/;

/** Aliases people use for the neighborhoods the Network knows (geo.ts names are canonical). */
const AREA_ALIASES: [RegExp, string][] = [
  [/\b(les|lower east side)\b/, "Lower East Side"], [/\b(uws|upper west side|upper west)\b/, "Upper West Side"], [/\b(ues|upper east side|upper east)\b/, "Upper East Side"],
  [/\b(fidi|financial district|wall st(reet)?)\b/, "Financial District"], [/\b(bed[- ]?stuy|bedford[- ]stuyvesant)\b/, "Bed-Stuy"], [/\bhell'?s kitchen\b/, "Hell's Kitchen"],
  [/\b(lic|long island city)\b/, "Long Island City"], [/\bdumbo\b/, "DUMBO"], [/\bsoho\b/, "SoHo"], [/\b(wash(ington)? heights)\b/, "Washington Heights"],
  [/\bcrown (heights|hts)\b/, "Crown Heights"], [/\bprospect (heights|hts)\b/, "Prospect Heights"], [/\bjackson (heights|hts)\b/, "Jackson Heights"],
  [/\b(st\.? george)\b/, "St. George"], [/\b(e\.? ?village|east vill(age)?)\b/, "East Village"], [/\b(w\.? ?village|west vill(age)?)\b/, "West Village"],
  [/\bwilliamsburg|\bwburg\b|\bbillyburg\b/, "Williamsburg"], [/\bgreenpoint\b/, "Greenpoint"], [/\bbushwick\b/, "Bushwick"], [/\bfort greene\b/, "Fort Greene"],
  [/\bpark slope\b|\bthe slope\b/, "Park Slope"], [/\bcarroll gardens\b/, "Carroll Gardens"], [/\bred hook\b/, "Red Hook"], [/\bsunset park\b/, "Sunset Park"], [/\bbay ridge\b/, "Bay Ridge"],
  [/\bflatbush\b/, "Flatbush"], [/\bastoria\b/, "Astoria"], [/\bsunnyside\b/, "Sunnyside"], [/\bridgewood\b/, "Ridgewood"], [/\bflushing\b/, "Flushing"],
  [/\bmott haven\b/, "Mott Haven"], [/\briverdale\b/, "Riverdale"], [/\binwood\b/, "Inwood"], [/\beast harlem\b|\bspanish harlem\b|\bel barrio\b/, "East Harlem"],
  [/\b(?<!east |spanish )harlem\b/, "Harlem"], [/\bchelsea\b/, "Chelsea"], [/\bgramercy\b/, "Gramercy"], [/\bflatiron\b/, "Flatiron"], [/\bmurray hill\b/, "Murray Hill"],
  [/\bmidtown\b/, "Midtown"], [/\btribeca\b/, "Tribeca"], [/\bchinatown\b/, "Chinatown"],
];
const AREA_NAMES = new Set(NEIGHBORHOODS.map(n => n.name));
/** Words that say where the sender is based ("I live in", "based in", "I'm around"). */
const HOME_CTX = /\b(i live|i'?m living|living in|live in|based (in|out of)|i'?m (in|around|near|over in|up in|out in|down in|by)|im (in|around|near)|i'?m from|my (place|apartment|apt|neighborhood|hood) is|home is|i stay in|my area is|i'?m mostly (in|around)|around .* most of the week)\b/;
/** Where a neighborhood is not home: "used to live in", "work in", "moved from". */
const NOT_HOME = /\b(used to live(?: in)?(?: the)?|moved (?:away )?from(?: the)?|grew up in(?: the)?|work(ing)? in|office (is )?in|commute to|visiting|not in|never been to|far from)\s*$/;

export interface Profile {
  interests: string[]; skills: string[]; desireIds: string[];
  /** A neighborhood the Network knows, said as where they are. Undefined when unknown. */
  area?: string;
  /** They said where they live, but not as a neighborhood the Network knows: ask, never guess. */
  areaUnknown?: boolean;
  /** Wants they said they do NOT want. */
  notWanted: string[];
  /** The ask itself is negated ("I'm not looking for anyone right now"). */
  negatedAsk: boolean;
  eveningsOpen?: boolean; groups?: boolean; weekends?: boolean;
}

/** The neighborhood a text names as the sender's place, or { unknown } when it names a place the Network does not know. */
export function areaOf(text: string): { area?: string; unknown?: boolean } {
  const t = normText(text).replace(/\bst\.\s*/g, "st ");
  for (const s of sentencesOf(t)) {
    // The first neighborhood named as home in the sentence ("between Greenpoint and Williamsburg": Greenpoint).
    let best: { at: number; name: string } | undefined;
    for (const [rx, name] of AREA_ALIASES) {
      const m = rx.exec(s.text);
      if (!m || NOT_HOME.test(s.text.slice(0, m.index)) || !AREA_NAMES.has(name)) continue;
      // "Chelsea" is also a first name: only as a place ("in Chelsea", "near Chelsea").
      if (name === "Chelsea" && !/\b(in|near|around|by|from|to|of|at)\s*$/.test(s.text.slice(0, m.index)) && !(/^\W*$/.test(s.text.slice(0, m.index)) && /^\s*(?:$|[,.!]|area\b|near\b|by\b|side\b)/.test(s.text.slice(m.index + m[0].length)))) continue;
      if (!best || m.index < best.at) best = { at: m.index, name };
    }
    if (best) return { area: best.name };
  }
  // "I live in Brooklyn" or "based in Jersey City": a place, but not one neighborhood we know.
  if (HOME_CTX.test(t) && /\b(?:live|living|based|i'?m|im|i am|stay|from)\s+(?:mostly\s+)?(?:in|around|near|out of|over in|up in|out in|down in|by)\s+(?:the\s+)?[A-Z][\w'.-]+/.test(text)) return { unknown: true };
  return {};
}

/** Facet tags a member reveals when answering onboarding questions or asking for something. Never guesses. */
export function extractProfile(body: string): Profile {
  const t = normText(body);
  const interests = new Set<string>(), skills = new Set<string>(), desires = new Set<string>(), notWanted = new Set<string>();
  let negatedAsk = false;
  const kept: string[] = [];
  for (const s of sentencesOf(t)) {
    const x = s.text;
    // A negation scopes over what comes after it in its sentence ("I like jazz but don't want a band" splits at "but").
    for (const part of x.split(/\b(?:but|though|although|however|except)\b|,\s*(?=(?:and )?(?:i|i'm|im)\b)/)) {
      const neg = NEG_WANT.exec(part);
      const negAt = neg ? neg.index : Infinity;
      const wantCtx = WANT_CTX.test(part);
      if (neg && /\b(looking for|find|meet|anyone|anybody|someone|somebody|want|need|set me up|introduce|match|suggest)\w*\b/.test(part.slice(negAt))) negatedAsk = true;
      // What is not under a negation: the taxonomy-label pass below reads only this.
      kept.push(part.slice(0, Number.isFinite(negAt) ? negAt : undefined));
      for (const [id, rxs] of Object.entries(WANT_LEX)) for (const rx of rxs) {
        const m = rx.exec(part);
        if (!m) continue;
        // Negated before the want ("I don't want to meet founders"), or right after it ("dating isn't for me").
        const after = part.slice(m.index + m[0].length);
        if (NEG_WANT.test(part.slice(0, m.index)) || /^\s*(?:is|are|'s|'re)?\s*(?:n't|not|isn'?t|aren'?t)\b(?! only)/.test(after)) notWanted.add(id);
        else if (wantCtx || SELF_WANTS.has(id)) desires.add(id);
        break;
      }
      for (const [tag, rx] of Object.entries(INTEREST_LEX)) {
        const m = rx.exec(part);
        if (m && !(m.index > negAt)) interests.add(tag);
      }
      if (FIRST_PERSON.test(part)) for (const [tag, rx] of Object.entries(SKILL_LEX)) {
        const m = rx.exec(part);
        if (!m || m.index > negAt) continue;
        const before = part.slice(0, m.index);
        if (SEEKING.test(before.slice(-40))) continue;
        skills.add(tag);
      }
    }
  }
  // The message-level pass for activity wants (the activity and the ask in different sentences).
  if (WANT_CTX.test(t) && ACTIVITY_ASK.test(t) && !NEG_WANT.test(t)) for (const [id, rx] of ACTIVITY_WANTS) if (rx.test(t) && !notWanted.has(id)) desires.add(id);
  for (const id of notWanted) desires.delete(id);
  // The taxonomy's own phrasing still counts (the simulator's sentences are real sentences too).
  const plain = kept.join(" ");
  for (const d of DESIRES) if (plain.includes(d.text.toLowerCase()) && !notWanted.has(d.id)) desires.add(d.id);
  for (const i of INTERESTS) if (plain.includes(i.label.toLowerCase())) interests.add(i.tag);
  for (const k of SKILLS) if (plain.includes(k.label.toLowerCase())) skills.add(k.tag);
  // A negated like is not an interest ("not into running"): drop interests named only after a negation.
  const where = areaOf(body);
  return {
    interests: [...interests], skills: [...skills], desireIds: DESIRES.map(d => d.id).filter(id => desires.has(id)),
    ...(where.area ? { area: where.area } : {}), ...(where.unknown ? { areaUnknown: true } : {}),
    notWanted: [...notWanted], negatedAsk: negatedAsk && !desires.size,
    eveningsOpen: /evenings are (pretty )?open|free most evenings|evenings (are )?free|evenings work/i.test(body) ? true : /evenings are tight|evenings are busy|no evenings/i.test(body) ? false : undefined,
    groups: /small groups|groups are (good|great|better|my thing)|prefer groups/i.test(body) ? true : undefined,
    weekends: /weekends work best|weekends are best|prefer weekends/i.test(body) ? true : undefined,
  };
}

/**
 * Sentiment of a feedback reply (for edges and reliability). Negations are checked first: "not
 * great", "wasn't great" and "didn't click" contain positive words but are bad meetings.
 */
export function feedbackOf(body: string): { sentiment: "positive" | "neutral" | "negative"; selfNoShow: boolean; otherNoShow: boolean; again: boolean } {
  const t = body.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const selfNoShow = /couldn'?t make it|didn'?t make it|had to bail/.test(t);
  const otherNoShow = /\b(never|didn'?t|did not) (show(ed)?( up)?|turn(ed)? up|come)\b(?! (me|us|you|him|her|them|off|around|any|much))|\bno[- ]show\b|\bstood (me|us) up\b/.test(t);
  const negative = otherNoShow || NEGATIVE_FEEDBACK.test(t);
  const sentiment = negative ? "negative" : /great|clicked|loved|amazing|nice|easy to talk/.test(t) ? "positive" : "neutral";
  const again = !negative && /again|clicked/.test(t) && !/\b(wouldn'?t|won'?t|not|never)\b[^.!?]*\bagain\b/.test(t);
  return { sentiment, selfNoShow, otherNoShow, again };
}
const NEGATIVE_FEEDBACK = /\b((was|is|it's|that's)?\s*(not|n't|wasn't|isn't)\s+(that |very |really |so |too |super )?(great|good|fun|nice|amazing)|not much in common|nothing in common|didn't (really |quite )?(click|connect|enjoy)|didn't have much|not (really )?for me|not my (thing|type)|awkward|terrible|rude|creepy|bummer|uncomfortable)/;


// ------------------------------------------------------------------ consent: yes, no or unclear
// Founder rule: a member is booked or revealed only on a clear yes. The reply is read sentence by
// sentence, refusals first. A conditional ("sure, but only with a woman") or a hedge ("who is it?
// thursday maybe") is not a yes: the answer is "unclear" and the member is asked again
// (network-consent-1, -2). This parser lives here, not in the simulator, so the simulator never
// grades its own parser (sim-worlds-3).

export type YesNo = "yes" | "no" | "counter" | "unclear";
/** Why a reply reads as it does. "mixed": a refusal, then a yes ("no... ok fine yes"): ask again. */
export type ConsentWhy = "affirm" | "refusal" | "mixed" | "conditional" | "hedged" | "counter" | "none";
export interface Consent { answer: YesNo; why: ConsentWhy }

/** A time word right after a refusal makes it a refusal of that time, not of the offer ("can't do Thursday"). */
const TIME_AHEAD = /^\s*(?:(?:do|make|on|at|for|the|that|this|until|till|before|after)\s+)*(?:(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?\b|first\b|second\b|third\b|last one\b|1st\b|2nd\b|3rd\b|option\b|\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b|mornings?\b|afternoons?\b|evenings?\b|nights?\b|weekends?\b|weekdays?\b|[abc]\b(?!\s+\w{3,}))/;
/** "No" as a refusal: alone, before punctuation, or before these words. "No heavy networking" is not a refusal. */
const NO_NEXT = "thanks|thank|thx|ty|sorry|i|i'm|im|i'd|i've|i'll|way|can|cannot|can't|cant|not|nope|lol|lmao|haha|unfortunately|wait|actually|really|man|dude|for|to that|to this|this|that|sunday|monday|tuesday|wednesday|thursday|friday|saturday|we|you|it|just|nah|sir|ma'am|go|chance|interest|deal";
const REFUSAL_RX: RegExp[] = [
  new RegExp(`(?:^|[^\\w'])no+(?=\\s*$|\\s*[^\\w\\s']|\\s+(?:${NO_NEXT})\\b)`),
  /\b(?:that'?s a|it'?s a|gonna be a|answer is a?|hard) no\b/,
  /\bnope\b|\bnah+\b|\bnay\b|\bno can do\b/,
  /\b(?:i'?ll|i will|gonna|going to|i'?m going to|i'?m gonna|i have to|i'?ve got to|i gotta|will have to|i'?d|i would|i think i'?ll)\s+(?:have to\s+)?(?:pass|skip|sit (?:this|that|it) out|decline|sit this one out)\b/,
  /\b(?:hard |gonna |i )?pass\b(?!\s+(?:the|it|along|by|me|on (?:the|my)|through))/,
  /\bno time\b(?! pressure)/,
  /\bnot (?:interested|down|for me|this (?:time|week|weekend|one)|right now|now|today|tonight|really|up for (?:it|that|this)|feeling it|my (?:thing|scene|vibe|cup of tea)|a fan|happening|gonna happen|going to happen|keen|into (?:it|that|this)|a good (?:time|week|fit)|available|possible|able to|the right time|at the moment|anytime soon|in the mood)\b/,
  /\b(?:absolutely|definitely|certainly|probably|def|totally|hell|of course|surely|really|actually|sadly|unfortunately) not\b/,
  /\b(?:i'?d |i would )?rather not\b/,
  /\b(?:don'?t|do not) think (?:i can|i could|i'?ll make it|i'?ll be able)\b/,
  /\b(?:don'?t|do not|doesn'?t) (?:think so|want to|wanna|feel like it|really want|have (?:time|the time|room|the bandwidth)|need)\b/,
  /\b(?:i'?m|im|i am) (?:not|no longer) (?:in|down|up for (?:it|that)|interested|free|available|keen|able|looking)\b/,
  /\b(?:i'?m|im|i am) (?:good|ok|okay|fine|all set)(?:,? (?:thanks?|thank you|tho|though|for now))?\s*$/,
  /\bcount me out\b|\b(?:i'?m|im) out\b|\bskip(?:ping)? (?:this|it|that)\b|\bi'?ll sit (?:this|that) one out\b/,
  /\b(?:not gonna|won'?t|can'?t|cannot|couldn'?t|not going to) make it\b/,
  /(?<!not )\btoo (?:busy|swamped|slammed|far|tired)\b/,
  /\b(?:maybe|perhaps|some|next) (?:other |another )?time\b(?!s)|^\s*(?:another|other) time\s*$/,
  /👎|🙅|❌/,
];
/** "Can't", "won't" and "busy" refuse the offer unless a time follows (then they refuse that time). "Can't wait" is a yes. */
const CANT = /\b(?:can'?t|cannot|can not|won'?t be able to|unable to|not able to|couldn'?t|won'?t)\b|(?:^\s*|\b(?:i'?m|im|i am|pretty|really|so|super|too|very|been|kinda)\s+)(?:busy|slammed|swamped|booked up)\b/g;
/** "Busy now, ask me later": a deferral, not a refusal of the offer. */
const DEFER = /\b(?:ask|text|message|ping|try) me (?:later|again|tomorrow|tmrw|tonight|in a bit)\b|\bget back to you\b|\btalk later\b|\btext later\b/;
const CANT_HARMLESS = /^\s*(?:wait|believe|say no|complain|go wrong|resist|beat|miss (?:it|this))/;
const AFFIRM_RX = /(?:^|[^\w'])(?:yes+|yess+|yeah+|yea|yah|yep|yup|sure|surely|ok+|okay+|okey|kk?|alright|aight|absolutely|definitely|def|of course|for sure|fosho|bet|deal|perfect|great|awesome|amazing|love (?:to|that|it)|i'?d love|would love|i'?d like that|would like that|happy to|glad to|let'?s (?:do (?:it|this|that)|go)|lets (?:do it|go)|(?:i'?m|im|i am) (?:totally |so |definitely |all |fully )?in|count me in|sign me up|i'?m down|im down|i am down|down for (?:it|that|this)|down to\b|so down|totally down|i'?m game|im game|(?:i'?m |i am |i'?d be |i would be |would be )?up for (?:it|that|this)|works for me|that works|works|sounds (?:good|great|fun|lovely|perfect|nice|like a plan|amazing|awesome)|why not|please do|go for it|go ahead|yes please|can do|i can (?:make it|do (?:it|that))|that'?d be (?:great|nice|fun|lovely)|would be (?:great|nice|fun)|count on me|can'?t wait|^\s*down\s*[!.]*\s*$|good with (?:that|it|me|this)|that'?s (?:good|great|fine|perfect)|fine by me|fine with me)(?![\w'])|💯|👍|🙌|✅|👌|🤝/;
/** A word just before a yes that negates it ("not ok", "never down", "don't love it"). "Not sure" is a hedge. */
const AFFIRM_NEG_BEFORE = /\b(?:not|never|don'?t|didn'?t|wouldn'?t|won'?t|isn'?t)\s+(?:\w+\s+)?$/;
const HEDGE_RX = /\b(?:maybe|perhaps|possibly|probably|might|could be|not sure|unsure|idk|i don'?t know|dunno|no idea|let me (?:check|think|see|get back|look)|i'?ll (?:check|think|see|let you know|get back)|who is (?:it|this|that|he|she|they)|who'?s (?:it|this|that)|what'?s (?:it|this) about|depends|kinda|sort of|i guess|we'?ll see|tbd|on the fence|torn|not certain|hard to say|remind me|need to check|have to check)\b|^\s*\?+\s*$/;
const COND_RX = /\b(?:only if|only with|only when|only for|as long as|so long as|provided(?: that)?|unless|depends on|on (?:the )?condition|assuming|but only|if and only|as long|if (?:it'?s|its|it is|they|she|he|there|the|you|i|we|that|this|someone|nobody|no one|everyone|it|a|an|my|their|his|her))\b/;
const COUNTER_RX = /\b(?:different (?:day|time|week)|another (?:day|week)|next week|later (?:in the week|this month|on)|reschedule|instead|rain ?check|some other (?:day|time)|how about|what about|later date|the week after|push it)\b/;
/** "No problem", "no worries", "no rush", "no plans", "no doubt": not refusals. */
const HARMLESS_NO = /\bno (?:problem|prob|probs|worries|worry|rush|pressure|biggie|doubt|plans?|stress|sweat|complaints)\b/g;

/** Read a reply as yes, no, a counter-offer or unclear, refusal first and sentence by sentence. */
export function consentOf(body: string): Consent {
  const t = normText(body).replace(HARMLESS_NO, " ");
  const wordsIn = (t.match(/[a-z]+/g) ?? []).length;
  let refusalAt = Infinity, affirmAt = Infinity, cond = false, hedge = false, counter = false, question = false;
  for (const s of sentencesOf(t)) {
    // A question of the member's own ("Anyone around who'd want to meet someone to date?") is not an
    // answer: a yes elsewhere in the message ("Honestly this is great timing") is not consent to the probe.
    if (/\?/.test(s.text) && !/\b(?:can|could) we\b|\b(?:how|what) about\b/.test(s.text)) question = true;
    // Clauses inside a sentence: "yes, but only with a woman" keeps "only with" in its own clause.
    for (const c of s.text.matchAll(/[^,]+/g)) {
      const x = c[0];
      const at = s.at + c.index!;
      // Refusal words are blanked before the yes words are read ("no deal" is not a "deal").
      let y = x;
      for (const rx of REFUSAL_RX) { const m = rx.exec(x); if (m) { refusalAt = Math.min(refusalAt, at + m.index); y = y.slice(0, m.index) + " ".repeat(m[0].length) + y.slice(m.index + m[0].length); } }
      const deferred = DEFER.test(s.text);
      if (deferred) hedge = true;
      for (const m of x.matchAll(CANT)) {
        if (deferred) continue;
        if (CANT_HARMLESS.test(x.slice(m.index! + m[0].length)) || TIME_AHEAD.test(x.slice(m.index! + m[0].length))) continue;
        refusalAt = Math.min(refusalAt, at + m.index!);
      }
      const am0 = AFFIRM_RX.exec(y);
      // An emoji is a yes only in a short reply with no question: "Still hoping to meet someone. Anything
      // come up? 💯" is an ask with decoration, not consent (the same rule as core parseReply).
      const am = am0 && !/[a-z]/.test(am0[0]) && (wordsIn > 3 || /\?/.test(t)) ? null : am0;
      if (am) {
        const before = x.slice(0, am.index + (am[0].match(/^[^\w']/) ? 1 : 0));
        const word = am[0].replace(/^[^\w']/, "");
        if (/^sure/.test(word) && /\b(?:not|un|i'?m|im|make|be)\s*$/.test(before)) { if (/\bnot\s*$/.test(before)) hedge = true; }
        // "Great" and the like are a yes only at the start of their clause ("great!", "perfect, see you then"):
        // "this is great timing" describes the moment, not an answer.
        else if (/^(?:great|perfect|awesome|amazing)$/.test(word) && !/^[\s\W]*(?:(?:oh|ok|okay|so|just|really|yes|yeah|yep|that'?s|thats|is|it'?s|its)\s+)*$/.test(before)) { /* a description, not an answer */ }
        else if (AFFIRM_NEG_BEFORE.test(before)) refusalAt = Math.min(refusalAt, at + am.index);
        else if (/^down/.test(word) && /\bfeel(?:ing)?\s*$/.test(before)) { /* "feeling down" */ }
        else affirmAt = Math.min(affirmAt, at + am.index);
      }
      if (COND_RX.test(x)) cond = true;
      if (HEDGE_RX.test(x)) hedge = true;
      if (COUNTER_RX.test(x)) counter = true;
    }
  }
  if (refusalAt < Infinity) return affirmAt > refusalAt && affirmAt < Infinity ? { answer: "unclear", why: "mixed" } : { answer: "no", why: "refusal" };
  if (counter) return { answer: "counter", why: "counter" };
  if (cond) return { answer: "unclear", why: "conditional" };
  if (hedge || question) return { answer: "unclear", why: "hedged" };
  // A yes needs the shared reader (core parseReply, AGENTS decision 11) not to read a refusal: when the
  // two disagree the member is asked again, never booked.
  if (affirmAt < Infinity) return parseReply(body).answer === "no" ? { answer: "unclear", why: "mixed" } : { answer: "yes", why: "affirm" };
  return { answer: "unclear", why: "none" };
}

/** A member's free-text yes or no (probes, plan probes, crew offers, the booked plan). */
export const parseYesNo = (body: string): YesNo => consentOf(body).answer;

/** One time option offered in a probe (SimMeta.timeOptions, the network-sim contract): keys "a", "b", "c"; label "Thursday 7pm". */
export type { TimeOption };

// Day names. A full name always counts; a short form ("sun", "sat", "wed", "mon") counts only in a
// day context (before a time, a daypart, "or", "and", a comma or the end), so "if the sun's out",
// "sat down" or "c'mon" never pick a day.
const DAY_ABBR_CONTEXT = "(?=\\.?(?:\\s*(?:\\d|@|at\\b|or\\b|and\\b|too\\b|&|\\/|works?\\b|is (?:good|fine|great|best|better)\\b|morning|afternoon|evening|night|eve\\b)|\\s*[,;!?.]|\\s*$))";
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
const NEG_AFTER = /^\s*(?:(?:one|option|time|slot)\b\s*)?(?:\d{1,2}(?::\d\d)?\s*(?:am|pm)\s*)?(?:(?:is|'s|are|would be|will be)\s+)?(?:out\b|bad\b|busy\b|full\b|packed\b|booked\b|taken\b|no good\b|not (?:good|great|ideal|possible|great)\b|tough\b|rough\b|a no\b|off\b|impossible\b|doesn'?t\b|does not\b|don'?t\b|do not\b|won'?t\b|will not\b|isn'?t\b|is not\b|can'?t\b|cannot\b)/;
/** A clause boundary: punctuation, "but", "though", "however". */
const CLAUSE_START = /[.,;!?]|\b(but|though|however|although|so)\b/g;
/** Words that make a named time a pick ("Saturday works", "free Sunday"), not just a mention ("Saturday I'm at a wedding"). */
const POSITIVE_PICK = /\b(works|work for (?:me|us)|does|good|fine|great|perfect|best|better|free|open|i can|let'?s|is ok|okay|please|for me|yes|yeah|sure)\b/;
/** True when the words at `i` (of length `len`) are refused: a negation cue earlier in their clause, or a refusal right after them. */
function negatedAt(t: string, i: number, len: number): boolean {
  let from = 0;
  for (const m of t.slice(0, i).matchAll(CLAUSE_START)) from = m.index! + m[0].length;
  return NEG_CUE.test(t.slice(from, i)) || NEG_AFTER.test(t.slice(i + len));
}
/** The clause (between punctuation) around position i. */
function clauseAt(t: string, i: number, len: number): string {
  let from = 0;
  for (const m of t.slice(0, i).matchAll(/[.,;!?\n]|\bbut\b/g)) from = m.index! + m[0].length;
  const rest = t.slice(i + len);
  const end = rest.search(/[.,;!?\n]|\bbut\b/);
  return t.slice(from, end < 0 ? t.length : i + len + end);
}

/**
 * A member's answer to a probe (founder decision 4a), in free text: "Thursday", "the first",
 * "either", "a or b", "neither", "none of those work", "yes", "no thanks". Returns the answer and,
 * when the probe offered time options, the keys of the options they picked. A yes with an empty
 * pick set means "yes, but none of those times" (neither). A plain yes picks every option except the
 * ones the member rules out ("yes, not Sunday though").
 *
 * Refusals come first, sentence by sentence (network-consent-1): "No. Saturday I'm at a wedding",
 * "Thursday? lol no" and "absolutely not" are a no. A refusal followed by a pick ("no, Saturday
 * works"), a conditional ("sure, but only with a woman") and a hedge ("who is it? thursday maybe")
 * are "unclear": the member is asked again, never booked.
 */
export function parseProbeReply(body: string, options: readonly TimeOption[] = []): { answer: "yes" | "no" | "unclear"; keys: string[]; why: ConsentWhy } {
  const t = normText(body);
  const c = consentOf(body);
  if (!options.length) return { answer: c.answer === "no" ? "no" : c.answer === "yes" || c.answer === "counter" ? "yes" : "unclear", keys: [], why: c.why };
  const all = options.map(o => o.key);
  // Every mention of an option, as a pick or a refusal. A key both picked and refused counts as picked.
  const pos = new Set<string>(), neg = new Set<string>(), strong = new Set<string>();
  const onlyPick = (i: number, len: number) => /^[\s\W]*(?:the\s+)?$/.test(t.slice(0, i)) && /^[\s\W]*(?:one|option|works?|please|pls|lol)?[\s\W]*$/.test(t.slice(i + len));
  const mark = (keys: string[], i: number, len: number) => {
    for (const k of keys) {
      if (negatedAt(t, i, len)) { neg.add(k); continue; }
      pos.add(k);
      const cl = clauseAt(t, i, len);
      if (onlyPick(i, len) || (POSITIVE_PICK.test(cl) && !/\?/.test(t.slice(i + len, i + len + 2)))) strong.add(k);
    }
  };
  // Option letters only where they cannot be the article "a": "a or b", "(b)", "option c", or alone.
  for (const m of t.matchAll(/\b([abc])\s*(?:or|and|&|,|\/)\s*([abc])\b/g)) mark([m[1]!, m[2]!], m.index!, m[0].length);
  for (const m of t.matchAll(/(?:\boption\s+|\()([abc])\b/g)) mark([m[1]!], m.index!, m[0].length);
  const alone = /^\s*([abc])[\s.!,)]*$/.exec(t);
  if (alone) { pos.add(alone[1]!); strong.add(alone[1]!); }
  // Ordinals only as a pick ("the first", "second one", or alone): "tell me about them first" is not option a.
  const ord = (w: string) => new RegExp(`\\bthe (?:${w})\\b|\\b(?:${w}) (?:one|option|time|slot)\\b|^\\W*(?:${w})\\W*$`, "g");
  const ordinals: [RegExp, number][] = [
    [ord("first|1st|earlier|earliest"), 0], [/(?<![\d:])\b1\b(?!\s*(am|pm|:|\d|of|more|person|hour|min))/g, 0],
    [ord("second|2nd|middle"), 1], [/(?<![\d:])\b2\b(?!\s*(am|pm|:|\d|of|more|people|person|hours?|mins?))/g, 1],
    [ord("third|3rd"), 2], [/(?<![\d:])\b3\b(?!\s*(am|pm|:|\d|of|more|people|hours?|mins?))/g, 2], [/\b(last|later|latest) one\b/g, options.length - 1],
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
  // A reply that is only time words ("sat 11am", "thursday or sunday") picks them all firmly.
  let residue = t;
  for (const [re] of DAY_WORDS) residue = residue.replace(re, " ");
  residue = residue.replace(/\b\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b|\b(?:the|one|option|or|and|either|works?|please|pls|lol|at|on|in the|morning|evening|afternoon|night|[abc])\b|[\W_]+/g, "");
  if (!residue) for (const k of pos) strong.add(k);
  const picked = all.filter(k => pos.has(k));
  const open = all.filter(k => !neg.has(k) || pos.has(k));
  const unclear = { answer: "unclear" as const, keys: [], why: c.why };
  // Refusal first. A pick after a refusal ("no, Saturday works") is mixed: ask again.
  if (c.why === "refusal") return all.some(k => strong.has(k)) ? { ...unclear, why: "mixed" } : { answer: "no", keys: [], why: c.why };
  if (c.why === "mixed" || c.why === "conditional" || c.why === "hedged") return unclear;
  // A time they name and do not refuse is a yes to it ("no plans Thursday, so Thursday works").
  // A named time with a yes or a firm pick ("Saturday works"); a bare mention ("I'm at a wedding saturday") is not a yes.
  if (picked.length && (c.answer === "yes" || picked.some(k => strong.has(k)))) return { answer: "yes", keys: picked.filter(k => strong.has(k) || c.answer === "yes"), why: c.why };
  if (NEITHER.test(t)) return { answer: "yes", keys: [], why: c.why };
  // "Any of them" (not refused, not a request for other days): every option the member did not rule out.
  const allAt = ALL.exec(t) ?? ALL_WEAK.exec(t);
  if (allAt && c.answer !== "counter" && !negatedAt(t, allAt.index, allAt[0].length)) return open.length ? { answer: "yes", keys: open, why: c.why } : unclear;
  if (c.answer === "yes") return { answer: "yes", keys: open, why: c.why };
  if (c.answer === "counter") return { answer: "yes", keys: [], why: c.why };
  // Only refusals ("Thursday doesn't work") are not a yes: the probe stays open for a clear answer.
  return unclear;
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
