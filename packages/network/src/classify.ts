// Inbound message understanding: the deterministic floor that never depends on a model. Every
// member message is classified before anything else touches it: what the member wants (a person, a
// plan, an answer), abuse signals (spam and sales, scams, contact extraction, prompt injection,
// harassment), signs that the sender is under 18, and the answer to a yes-or-no question (consent).
// The LLM layer (extract.ts) can add what these rules miss, but it can never turn a refusal, a
// conditional or a hedge read here into a yes (PRD 32.14 safety classifier, 17.4 minors).
//
// The rules were rebuilt against hand-written corpora (test/fixtures), not the simulator's own
// sentences (audit 2026-10-08, network-consent-1, -2, -8, -9, -10, matching-e2e-1, -M1).
import { AGE_AND_CLAUSE, AGE_BIRTHDAY_AFTER_AGE, AGE_BIRTHDAY_END, AGE_CURRENT_ADVERB, AGE_DISTANT_BIRTHDAY_AFTER_AGE, AGE_LOOSE_TAIL, AGE_PART, AGE_STATED_BIRTHDAY, ARTICLE_AGE_END, CITIES, CITY_IDS, NOT_DISTANT_BIRTHDAY, SHARED_DOUBLE_NEGATIVE_RE, SPANISH_MONTHS, ageBeforeConjunction, agePartEvidenceOf, findNeighborhood, getCity, localParts, normalizeReplyText, quoteStillOpen, canJoin, directAgreementIdiom, isMinor, birthKeyOfParts, normalizeAgeInitialism, ownYouthCue, parseReply, readParticipationWithdrawal, relayMinorAge, seedVenuesForCity, unquotedOwnAgeEvidence, validAge, type Category, type City, type CityId } from "@thenetwork/core";
import { ageOnDay, birthKeyUsable, precedingBirthdayAge } from "../../core/src/generated/memberAge.ts";
import { attendanceAbsences, otherAgeStated } from "./reports.ts";
import { hasOrElseThreat } from "../../core/src/abuse.ts";
import type { TimeOption } from "@thenetwork/core";
import { clarifiedBroadTimeChoiceAllowed, historicalProbeTimeClause, mayRetryCounter, neitherQualifierRefusal, pickedTimes, probeExclusionAlternative, probeGroupIncludes, probeOrdinalIndex, unboundProbeTimeNeedsClarification, untimedProbeTimeRejectionNeedsClarification, yesBooksRefusedRemainder } from "../../core/src/generated/probeReply.ts";
import { safetyRequestMayResolveTarget } from "../../core/src/generated/safetyCase.ts";
import { profileSkillMayLearn } from "../../core/src/generated/profileSkillLearning.ts";
import { numericDateAmbiguous } from "../../core/src/generated/textEnrollment.ts";
import { contactExtractionRisk } from "../../core/src/generated/trustLevel.ts";
import { DESIRES, INTERESTS, SKILLS } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import { allNeighborhoods, NEIGHBORHOODS, SF_NEIGHBORHOODS, VENUES } from "./geo.ts";

export type Abuse = "sales_spam" | "scam_money" | "contact_extraction" | "prompt_injection" | "harassment" | "mass_recruit";
export type InboundKind =
  | "people_request" | "plans_request" | "cofounder_goal" | "invite_friend" | "cancel" | "block" | "report" | "feedback_like" | "ack" | "other";

export { otherAgeStated } from "./reports.ts";

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
  oldestAge?: number;
  /** An age the sender states about someone else ("he's only 15"), for reports. */
  otherAge?: number;
  /**
   * The message tells us what someone else did ("he asked me to venmo him $50"). Abuse words in it
   * are about that person, never the sender's own abuse (network-consent-4).
   */
  disclosure?: Abuse[];
  /** For requests: what they want. */
  desireId?: string; category?: Category; tags: string[];
  /** The member asks the Network to find people now, rather than stating a profile preference. */
  directPeopleAsk?: boolean;
  /** The member describes a past absence, without a separate cancellation. */
  pastAbsence?: true;
  /** The whole message is the speaker's own affirmative cofounder goal. */
  cofounderAffirmed?: boolean;
  /** Wants the member said they do NOT want ("I don't want to meet other founders"). */
  notWanted?: string[];
  /** For invites: the friend's first name. */
  friendName?: string;
  /** For block/report: the name they gave. */
  target?: string;
  /** Deterministic self-promotion / pitch-slap cue detected in the member's own words. */
  pitchSlap?: boolean;
  /** The original text. */
  text?: string;
}

/** Lower case, NFKC, straight quotes. */
export const normText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, "\"");

const COFOUNDER_WORD = /\bco[- ]?founders?\b/;
const COFOUNDER_MOD = "(?:(?:technical|non[- ]?technical|engineering|design|product|business|ops|operations|growth|sales|gtm|ai|ml|hardware|software|biotech|fintech|climate|startup|founding|fullstack|full[- ]?stack|backend|frontend|senior|experienced|strong|great|good)\\s+){0,2}";
const COFOUNDER_TAIL = "(?:\\s+(?:for\\s+(?:my|our|a|an)\\s+[^.?!\"']{1,60}|in\\s+[a-z0-9][a-z0-9 /&-]{1,50}|with\\s+[^.?!\"']{1,60}|who\\s+[^.?!\"']{1,60}))?";
const COFOUNDER_OBJECT = `(?:a|an)\\s+${COFOUNDER_MOD}co[- ]?founder${COFOUNDER_TAIL}`;
const COFOUNDER_STATEMENT = new RegExp(`^(?:i\\s+(?:want|need)(?:\\s+to\\s+find)?|i(?:'d|\\s+would)\\s+(?:like|love)(?:\\s+to\\s+find)?|(?:i(?:'m|\\s+am)\\s+)?(?:looking|searching)\\s+for)\\s+${COFOUNDER_OBJECT}[.!]?$`);
const COFOUNDER_ASK = new RegExp(`^(?:(?:can|could|would)\\s+you\\s+)?(?:please\\s+)?(?:find\\s+me|help\\s+me\\s+find)\\s+${COFOUNDER_OBJECT}[.?!]?$`);
const COFOUNDER_DISQUALIFIER = /\b(?:not|never|don't|do not|no longer|if|unless|whether)\b/;

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
  harassment: /\b((they|he|she) owes? me|make (them|her|him) (answer|reply|respond|talk to me)|why won'?t (they|she|he) (answer|reply|respond|text)|i know where (they|she|he|you) lives?|(you|he|she|they)'?ll regret|(you|he|she|they) will regret)/i,
  // Unasked sexual demands (scored as harassment): "send nudes", "send me naked pics". A story about
  // someone else who asked is a disclosure (DISCLOSURE), never the sender's own.
  sexual: /\b(send|sending|share|text|dm) (me )?(some |your |a )?(nudes?|nude (pics?|photos?|selfies?)|naked (pics?|photos?|selfies?)|dick pics?|pics of your (body|tits|boobs|ass))\b|\b(wanna|want to|let me) see (you )?naked\b/i,
  invite: /\b[Mm]y (?:friend|buddy|pal|coworker|roommate|cousin) ([A-Z][a-z]+)\b/,
  inviteIntent: /\b(invite|bring|add|sign \w+ up|sign up|refer|include|loop in)\b|\bwould (love|like|enjoy|be into) (this|it|that|joining)\b|\b(wants?|wanted) (to join|in)\b|\bhas been (wanting|looking)\b|\bshould (join|be here|get an invite)\b|\blooking for something like this\b/i,
  cancel: /\b(can'?t make it|have to bail|can'?t come|need to cancel)\b/i,
  block: /^\s*(?:please\s+)?block\s+(?!(?:back|on|out|off|of|time|my|the|this|that|it|in|for|a)\b)(.+)$/i,
  report: /^\s*(?:please\s+|i (?:want|need|'d like) to\s+)?report\s+(?!(?:back|on|to|that|this|it|in|for|my|the|when)\b)(.+)$/i,
  plans: /\b(anything fun|what'?s (on|happening|good)|something to do|plans? (this|for the) (weekend|week|tonight)|fun (going on|this weekend)|any (events|plans))\b/i,
  peopleAsk: /\b(anyone (around|who|want|up for)|looking for (a |an |someone|people|other|more)|hoping to|find (me )?(a|an|someone|people)|want to meet|wanna meet|know anyone|still hoping|would love to (meet|find)|i'?d (love|like) to (meet|find)|searching for|in search of)\b/i,
  directPeopleAsk: /^\s*(?:please\s+)?(?:(?:is there |do you know )?anyone (?:around|who|want|up for)|find me|(?:can|could|would) you (?:please )?(?:find me|help me find|connect me (?:with|to)|introduce me to))\b/i,
  feedback: /\b(it was (great|nice|fine|fun|good|ok|okay)|we (really )?clicked|(not|wasn'?t) great|didn'?t (really )?click|never showed|would (definitely )?(do it|meet|hang out) again|not much in common)\b/i,
  ack: /^(thanks|thank you|got it|ok|okay|👍|see you|sounds good|perfect|works for me|great|cool|nice)\b/i,
};

/**
 * Third-party narrative: the sender tells us what someone else did or said. Abuse words inside such
 * a sentence describe that person (a disclosure), never the sender.
 */
const DISCLOSURE = /\b(he|she|they|someone|somebody|this (guy|girl|person|dude|man|woman)|[a-z]+) (asked|asks|wanted|wants|told|tells|keeps? asking|kept asking|tried|said|says|is asking|was asking|messaged|texted|dm'?d|demanded|threatened)\b/i;
const NOT_A_PERSON = /^(i|we|you|it|that|this|which|what|who|mom|dad|the|a|an)$/i;
const PRIVATE_MESSAGING_HANDLE_ASK = /^\s*(?:(?:can|could) you\s+)?(?:please\s+)?(?:send|give) me\s+(?:his|her|their)\s+whatsapp(?:\s+(?:handle|number|username))?(?:\s+please)?[.!?]*\s*$/i;
const CONTACT_EXTRACTION = new RegExp(`${RX.extraction.source}|${PRIVATE_MESSAGING_HANDLE_ASK.source}`, "i");
const ASK_FOR_NUMBER = /^\s*(?:please\s+)?(?:(?:(?:can|could|would) you\s+)?(?:give|send|pass|get) me|can i (?:get|have))\s+[^.!?]{1,100}\b(?:number|phone|cell)\b/i;
const INTENT_TO_CONTACT_DIRECTLY = /(?:^|,|\bso\b)\s*(?:i (?:want to|need to|would like to|can|could)|i'd like to) (?:call|text|message|dm|contact) (?:him|her|them) (?:directly|off[- ]platform)\b/i;

function describesAnotherPerson(text: string): boolean {
  const speaker = DISCLOSURE.exec(text)?.[1];
  return !!speaker && !NOT_A_PERSON.test(speaker);
}

/**
 * Where a third-party report starts inside a segment, or -1 when the words are the member's own.
 * A speaker that follows I/we is the member, not a report: DISCLOSURE takes any word as the
 * speaker, so "always wanted" and "the app says" would otherwise read as a report.
 */
function reportStart(segment: string): number {
  const m = DISCLOSURE.exec(segment);
  if (!m || NOT_A_PERSON.test(m[1]!) || /\b(?:i|we)(?:'?ve)?\s+$|\b(?:i|we)'$/i.test(segment.slice(0, m.index))) return -1;
  return m.index;
}

/** Teachers, coaches and parents talk about school; that is not a sign the sender is a minor (network-consent-10). */
const ADULT_SCHOOL_CTX = /\b(teach|teacher|teaching|coach|coaching|tutor|tutoring|professor|my (kid|kids|son|daughter|students?|class|child|children)|our (kids|students)|i work (at|in) a (high |middle )?school|went to (high|middle) school|in high school i|back in (high|middle) school|my high school (days|years|friends))\b/;
/** First-person signs of being under 18 that are not an age. One sentence at a time. */
const MINOR_SIGNS = /\b((i (have|got|gotta)|i've got|finishing|studying for|doing) (my |a |so much )?(homework|hw|(math|chem|bio|history|physics|spanish|english|algebra|geometry) (test|quiz|homework)|finals|midterms|a quiz)|math test|my (mom|dad|mum|parents|mother|father) (says?|said|won'?t|wont|doesn'?t|don'?t|grounded|makes?)\b|i'?m grounded|school nights?|(my|going to|go to) (prom|homecoming)\b|i get out of school|(after|before) school (today|tomorrow|tmrw|tmr)\b|(can|could) (we|i)[^.?!]{0,30}(?<schoolTime>after school)|i'?m (a minor|underage)|im (a minor|underage)|when i turn (1[4-8]|sixteen|seventeen|eighteen))/;

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\b(date|dating|romance|romantic|partner to date)\b/i, "romance"],
  [/\b(founder|startup|career|mentor|job|pitch|investor|work|collaborator|professional)\b/i, "professional"],
  [/\b(help|move|moving|couch|fix|carry)\b/i, "help"],
  [/\b(learn|class|lesson|try|practice)\b/i, "growth"],
  [/\b(friends?|people|hang|dinner|community)\b/i, "social"],
];

/** Sentences (and clauses after "but"): the scope of a negation or a disclosure. */
export function sentencesOf(t: string, preserveDecimals = false): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  const re = preserveDecimals ? /(?:[^.!?;\n]|(?<=\d)\.(?=\d))+[.!?;\n]*/g : /[^.!?;\n]+[.!?;\n]*/g;
  for (const m of t.matchAll(re)) if (m[0].trim()) out.push({ text: m[0], at: m.index! });
  return out.length ? out : [{ text: t, at: 0 }];
}

const POLITE_SAFETY_REQUEST = /^(?:please\s+)?(?:can|could)\s+you\s+(?:please\s+)?(?=(?:block|report)\s)/i;
const FIRST_PERSON_SAFETY_REQUEST = /^(?:please\s+)?i(?:\s+(?:want|need)|'d like)\s+to\s+(?=(?:block|report)\s)/i;
const FIRST_PERSON_NON_PERSON_HEAD = /^(?:a|an|the|some|any|all|every|this|that|it|one|two|three|four|five|six|seven|eight|nine|ten|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|today|tomorrow|tonight|weekend|weekday|lunch|dinner|breakfast|brunch|coffee|hour|hours|minute|minutes|min|mins|second|seconds|day|days|week|weeks|month|months|year|years|time|afternoon|morning|evening|night|noon|midnight|moment|calendar|schedule|agenda|plan|plans|event|events|meeting|meetings|appointment|appointments|session|sessions|class|classes|date|feedback|bug|bugs|issue|issues|problem|problems|complaint|complaints|review|reviews)$/i;
const FIRST_PERSON_OBJECT_END = /^(?:for|with|on|about|at|in|from|after|before|during|over|to|is|was|are|were|not|but)$/i;

const FIRST_PERSON_PRONOUN = /^(?:him|her|them|he|she|they)$/i;

function firstPersonTarget(raw: string): string | undefined {
  const clause = raw.split(/[,;:!?.(]/)[0]!.split(/\s+[-—–]\s+|[—–]/)[0]!;
  const tokens = clause.trim().replace(/\s+please$/i, "").split(/\s+/).filter(Boolean)
    .map(token => token.replace(/^["']+|["')\]]+$/g, "")).filter(Boolean);
  if (!tokens.length) return undefined;
  const head = tokens[0]!;
  if (FIRST_PERSON_PRONOUN.test(head)) return head;
  if (/'s$/i.test(head) || !/^\p{Lu}/u.test(head)) return undefined;
  if (FIRST_PERSON_NON_PERSON_HEAD.test(head.toLowerCase().replace(/[^a-z0-9'-]/g, ""))) return undefined;
  const name = [head];
  for (const token of tokens.slice(1)) {
    if (/'s$/i.test(token)) return undefined;
    if (FIRST_PERSON_OBJECT_END.test(token) || !/^\p{Lu}/u.test(token)) break;
    if (FIRST_PERSON_NON_PERSON_HEAD.test(token.toLowerCase().replace(/[^a-z0-9'-]/g, ""))) break;
    name.push(token);
  }
  const next = tokens[name.length];
  if (next && FIRST_PERSON_NON_PERSON_HEAD.test(next.toLowerCase().replace(/[^a-z0-9'-]/g, ""))) return undefined;
  return name.join(" ");
}
const COUNTERPART_SAFETY_REQUEST = /^(?:please\s+)?(block|report)\s+(my\s+(?:date|match))\b(?:\s+please)?\s*(?:[.!?]*$|[,;:])/i;
const SAFETY_REQUEST_CONDITION = /\b(?:if|unless|whenever|suppose|assuming|hypothetically|in case|in the event)\b/i;
const SAFETY_REQUEST_DELAY = /(?:^[^,;:]*|[,;:]\s*)\b(?:when|after|later|tomorrow|maybe|possibly|perhaps)\b/i;

const PITCH_SLAP_RX = /\b(?:book\s+(?:a\s+)?(?:\d{1,2}[- ]?min(?:ute)?\s+)?(?:demo|discovery\s+call|sales\s+call|intro\s+call)|hop\s+on\s+a\s+(?:quick\s+)?(?:demo|discovery\s+call|sales\s+call)|here'?s\s+my\s+(?:calendly|cal\.com|pitch\s+deck|sales\s+deck)|(?:looking|hunting)\s+for\s+(?:b2b\s+)?(?:leads|clients|customers|buyers)|sign\s+up\s+for\s+my\s+(?:course|cohort|mastermind|coaching|newsletter|agency)|buy\s+my\s+(?:course|product|program|book|service)|use\s+(?:my\s+)?(?:promo|discount|referral)\s+code|\d+%\s+off\s+for\s+(?:network\s+)?members|pitch(?:ing)?\s+my\s+(?:agency|services|saas|coaching|product)|selling\s+(?:my|our)\s+(?:b2b|saas|agency|coaching|services?))\b/i;

export function isPitchSlapMessage(body: string): boolean {
  const t = body.trim().replace(/[‘’ʼ`´]/g, "'");
  if (!t) return false;
  for (const s of sentencesOf(t)) {
    if (describesAnotherPerson(s.text)) continue;
    if (PITCH_SLAP_RX.test(s.text) || RX.sales.test(s.text)) return true;
  }
  return false;
}

export function classify(body: string): Classified {
  // The RX patterns spell an apostrophe as "'": a phone's curly one ("can’t", "what’s") must match too.
  const t = body.trim().replace(/[‘’ʼ`´]/g, "'");
  const low = normText(t);
  const abuse: Abuse[] = [];
  const disclosed: Abuse[] = [];
  let risk = 0;
  // Abuse is read per sentence: a sentence that tells what someone else did is a disclosure.
  const sents = sentencesOf(t);
  const hit = (rx: RegExp, kind: Abuse, points: number, also?: (text: string) => boolean) => {
    let own = false, told = false;
    for (const s of sents) if (rx.test(s.text) || also?.(s.text)) { if (describesAnotherPerson(s.text)) told = true; else own = true; }
    if (own) { abuse.push(kind); risk += points; } else if (told) disclosed.push(kind);
  };
  const link = RX.link.test(t);
  if (RX.sales.test(t) || (link && /\b(join|buy|sign ?up|offer|members|matches|link|discount|subscribe)\b/i.test(t))) { abuse.push("sales_spam"); risk += link ? 3 : 2; }
  hit(RX.blast, "mass_recruit", 3);
  // Money asked for the sender ("send me $100") is the sender's own ask even inside a story about someone else.
  if (RX.scamToMe.test(t)) { abuse.push("scam_money"); risk += 6; } else hit(RX.scam, "scam_money", 6);
  // spec/trustLevel.md, "An explicit attempt to bypass contact consent triggers watch"
  const explicitContactBypass = sents.some(({ text }) => ASK_FOR_NUMBER.test(text) && RX.extraction.test(text) && !describesAnotherPerson(text))
    && sents.some(({ text }) => INTENT_TO_CONTACT_DIRECTLY.test(text) && !describesAnotherPerson(text));
  hit(CONTACT_EXTRACTION, "contact_extraction", contactExtractionRisk(explicitContactBypass));
  if (RX.injection.test(t)) { abuse.push("prompt_injection"); risk += 3; }
  hit(RX.harassment, "harassment", 3, hasOrElseThreat);
  if (!abuse.includes("harassment")) hit(RX.sexual, "harassment", 3);
  const { age, explicit, oldest } = agesStated(t);
  const minorSignal = minorSignOf(low) || (validAge(age) && isMinor(age));
  const out: Classified = { kind: "other", abuse, risk, minorSignal, statedAge: age, explicitAge: explicit, oldestAge: oldest, tags: [], text: t };
  if (isPitchSlapMessage(t)) {
    out.pitchSlap = true;
    out.tags.push("hv:hype:pitch");
  }
  if (disclosed.length) out.disclosure = disclosed;
  const other = otherAgeStated(t);
  if (other !== undefined) out.otherAge = other;

  // spec/safetyCase.md, "Direct polite safety requests use the existing counterpart chooser"
  const politeRequest = POLITE_SAFETY_REQUEST.exec(t);
  const firstPersonRequest = politeRequest ? null : FIRST_PERSON_SAFETY_REQUEST.exec(t);
  const polite = politeRequest ?? firstPersonRequest;
  const command = polite ? t.slice(polite[0].length) : t;
  const counterpart = COUNTERPART_SAFETY_REQUEST.exec(command);
  const directCommand = !!polite || !!counterpart;
  const qualified = directCommand && (SAFETY_REQUEST_CONDITION.test(t) || SAFETY_REQUEST_DELAY.test(t));
  const useNewForm = safetyRequestMayResolveTarget(directCommand, qualified);
  if (useNewForm && counterpart) {
    return { ...out, kind: /^block$/i.test(counterpart[1]!) ? "block" : "report", target: counterpart[2]!.replace(/\s+/g, " ") };
  }
  const safetyText = useNewForm && polite ? command.replace(/\s+please[.!?]*$/i, "") : t;
  const blk = RX.block.exec(safetyText), rep = RX.report.exec(safetyText);
  if (blk) {
    const target = firstPersonRequest ? firstPersonTarget(blk[1]!) : blk[1]!.trim();
    if (target !== undefined) return { ...out, kind: "block", target };
  }
  if (rep) {
    const raw = rep[1]!.replace(/[,;:.!?].*$/, "").trim();
    const target = firstPersonRequest ? firstPersonTarget(raw) : raw;
    if (target !== undefined) return { ...out, kind: "report", target };
  }
  const absence = attendanceAbsences(t);
  const mentionsAbsence = absence.self || absence.other;
  if (RX.cancel.test(t) || (!mentionsAbsence && /\bsomething came up\b/i.test(t))) return { ...out, kind: "cancel" };
  const inv = RX.invite.exec(t);
  if (inv && RX.inviteIntent.test(t)) return { ...out, kind: "invite_friend", friendName: inv[1] };
  if (mentionsAbsence) return { ...out, kind: "feedback_like", pastAbsence: true };
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
  if (COFOUNDER_WORD.test(low)) {
    // A whole-message grammar excludes quoted, negated, hypothetical and third-person claims.
    // Unclear mentions stay out of the generic people-request path.
    return {
      ...out,
      kind: "cofounder_goal",
      cofounderAffirmed: (COFOUNDER_STATEMENT.test(low) || COFOUNDER_ASK.test(low)) && !COFOUNDER_DISQUALIFIER.test(low),
    };
  }
  const directPeopleAsk = !x.negatedAsk && sents.some(s => RX.directPeopleAsk.test(normText(s.text)));
  if (desire || directPeopleAsk || (RX.peopleAsk.test(t) && !x.negatedAsk)) {
    return { ...out, kind: "people_request", category: out.category ?? "social", directPeopleAsk };
  }
  if (RX.ack.test(t) || t.length < 12) return { ...out, kind: "ack" };
  return out;
}

/** A first-person sign of being under 18, sentence by sentence, never in a teacher's or parent's sentence. */
export function minorSignOf(text: string): boolean {
  const t = normText(text);
  for (const s of sentencesOf(t)) {
    if (ADULT_SCHOOL_CTX.test(s.text)) continue;
    for (const match of allMatches(MINOR_SIGNS, s.text)) {
      const start = s.at + match.index;
      const schoolTime = match.groups?.schoolTime;
      const evidenceStart = schoolTime ? start + match[0].lastIndexOf(schoolTime) : start;
      if (ownYouthCue(t, evidenceStart, start + match[0].length)) return true;
    }
  }
  return false;
}

const AGE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const ES_AGE_WORDS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, "dieciséis": 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
};
const ES_AGE_WORD = Object.keys(ES_AGE_WORDS).sort((a, b) => b.length - a.length).join("|");
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
const CLAUSE_END = "$|\\.(?!\\d)|[,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|y(?:ea)?rs?\\s*(?:$|[.,!?;:)])";
const AGE_END = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}))`;
// "and", "now" and "too" also end an age, but only for 13 and up: "I'm 3 and 0 this season" or
// "I'm 2 years in nyc now" must never decline an adult (a decline deletes the member's data).
// Also "actually", "tbh", "honestly", "fyi" and "last week": "I'm 15 actually", "I turned 13 last week".
const AGE_END_LOOSE = `(?=\\s*(?:${CLAUSE_END}|${YEARS_OLD}|${AGE_LOOSE_TAIL}|turning\\b|actually\\b|tbh\\b|honestly\\b|fyi\\b|last (?:week|month|year)\\b|yesterday\\b|recently\\b|in (?:high|middle) school\\b))`;
const IDENTITY_WORD = "person|guy|girl|boy|man|woman|kid|teen";
/** "15f", "16 m", "15/f": an age and a sex, the way teens introduce themselves. Never "15m away" or "raised 15m". */
const AGE_SEX_END = "(?=\\s*(?:$|[.,!?;:)]|here\\b|lol\\b|btw\\b|from\\b|in\\b|looking\\b|nyc\\b|bk\\b))";
const AGE_SEX_ETA = "(?!\\s+(?:from\\s+(?:the|a|an|our|your|there|here)|in\\s+(?:a|an|the|traffic))\\b)";
const AGE_SEX_MARKER = `(?:\\/\\s*[fmx]|[fx]|m${AGE_SEX_ETA})`;
const joinAgeOnly = (age: number): number => canJoin(age) ? age : NaN;
/** Ages the loose forms may read: a teen or an adult. Under 13 needs a strict form. */
const teenOrAdult = (n: number) => (n >= 10 && n < 100 ? n : NaN);
const SCHOOL_YEAR: Record<string, number> = { freshman: 14, sophomore: 15, junior: 16, senior: 17 };
/**
 * Words just before "I'm 12" that make it not a statement of the sender's age today: "I act like
 * I'm 12", "when I was 12", "if I'm 12", "she said I'm 12" (network-service-1).
 * A quote is not one of these words. An age inside a quote that is still open is dropped in
 * `agesStated`. A quote that has already closed does not drop the next statement
 * (`he said "hi" I'm 15`, `"Hey" I'm 15`).
 */
const NOT_NOW = /(?:\blike|\bas if|\bas though|\bpretend(?:ing)?(?: that)?|\bwhen|\bif|\bimagine|\bsays?|\bsaid|\bfeel(?:s|ing)? like|\bacts?|\bacting|\bthink|\bthinks|\bthought)\s*$/;
/** A clause break. The words before it do not apply to an age after it. */
const CLAUSE_BREAK = /[.,;!?\n]|\b(?:but|though|however|although)\b/g;
type AgeRule = { rx: RegExp; age: (m: RegExpExecArray) => number; explicit?: boolean; estimated?: boolean; reading?: "part" | "conjunction" };
const SELF_CURRENT_AGE = `\\b${ME}\\s+${AGE_CURRENT_ADVERB}${SAME}`;
const STATED_AGE = `(?:${SELF_CURRENT_AGE}|${AGE_STATED_BIRTHDAY})`;
const NOT_UPCOMING_AGE = `(?!${AGE_BIRTHDAY_AFTER_AGE}|${AGE_DISTANT_BIRTHDAY_AFTER_AGE})`;
const PART_CLAUSE_END = new RegExp(`^(?:${AGE_END}|${AGE_AND_CLAUSE})`);
const NO_AGE_PART = `(?!${AGE_PART})`;
// Keep a measurement unit with decimals and grouped numbers before interpreting an approximate age.
const NO_APPROXIMATE_MEASUREMENT = String.raw`(?!(?:[.,]\d+)*\s*(?:degrees?|feet|ft|miles|mi|km)\b)`;
// A complete role complement can follow a comma, but "as a teacher told me" is attribution.
const GRADE_AGE_END = String.raw`(?!\s*,\s*as\s+(?:a|the)\s+teacher(?=\s*(?:$|[.!?,;)])))(?=\s*(?:${CLAUSE_END}|and\b|now\b))`;
const ageNumber = (value: string) => /^\d/.test(value) ? Number(value) : AGE_WORDS[value] ?? NaN;

const AGE_RX: AgeRule[] = [
  // Explicit: "I am 12 years old", "im 15 y/o", "my age is 12", "15 y/o here", "age: 15", "tengo 11 años".
  { rx: new RegExp(`\\b(?:yo\\s+)?tengo\\s+(\\d{1,2}|${ES_AGE_WORD})\\s+a[nñ]os\\b`), age: m => /^\d/.test(m[1]!) ? Number(m[1]) : ES_AGE_WORDS[m[1]!] ?? NaN, explicit: true },
  { rx: new RegExp(`(?:${SELF_CURRENT_AGE}|\\bmy age is\\s+)(\\d{1,2})${NOT_UPCOMING_AGE}\\s*${YEARS_OLD}`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`${SELF_CURRENT_AGE}(one|two|three|four|five|six|seven|eight|nine|${NUM_WORD})${NOT_UPCOMING_AGE}[\\s-]+${YEARS_OLD}`), age: m => AGE_WORDS[m[1]!]!, explicit: true },
  { rx: new RegExp(`${SELF_CURRENT_AGE}an?\\s+(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|${NUM_WORD})${NOT_UPCOMING_AGE}[\\s-]*${YEARS_OLD}${ARTICLE_AGE_END}`), age: m => ageNumber(m[1] ?? ""), explicit: true },
  { rx: new RegExp(`\\bmy age is\\s+(\\d{1,2})${NOT_UPCOMING_AGE}${AGE_END}`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(?:my )?age\\s*[:=-]?\\s*(\\d{1,2})${NOT_UPCOMING_AGE}${AGE_END}`), age: m => Number(m[1]), explicit: true },
  // Leading "15 y/o here", "12yo." (only when it is about the sender: "12 yo whisky is great" is not).
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(\\d{1,2})${NOT_UPCOMING_AGE}\\s*${YEARS_OLD}(?=\\s*(?:$|[.,!?;:)]|here\\b|lol\\b|btw\\b))`), age: m => Number(m[1]), explicit: true },
  { rx: new RegExp(`${STATED_AGE}(\\d{1,2}|${NUM_WORD})(${AGE_PART})`), age: m => ageNumber(m[1] ?? ""), reading: "part" },
  { rx: new RegExp(`${STATED_AGE}(\\d{1,2}|${NUM_WORD})${NO_AGE_PART}${NOT_UPCOMING_AGE}${AGE_AND_CLAUSE}`), age: m => ageNumber(m[1] ?? ""), reading: "conjunction" },
  { rx: new RegExp(`${STATED_AGE}(\\d{1,2}|${NUM_WORD})${NO_AGE_PART}${NOT_UPCOMING_AGE}${AGE_END}`), age: m => ageNumber(m[1] ?? "") },
  { rx: new RegExp(`${STATED_AGE}(\\d{1,2}|${NUM_WORD})${NO_AGE_PART}${NOT_UPCOMING_AGE}${AGE_END_LOOSE}`), age: m => joinAgeOnly(ageNumber(m[1] ?? "")) },
  { rx: new RegExp(`${SELF_CURRENT_AGE}(1[3-7])\\s+(?:from\\b|looking for\\b)`), age: m => Number(m[1]) },
  { rx: new RegExp(`${SELF_CURRENT_AGE}(\\d{1,2}|${NUM_WORD})\\b${AGE_BIRTHDAY_AFTER_AGE}${AGE_BIRTHDAY_END}`), age: m => teenOrAdult(precedingBirthdayAge(ageNumber(m[1] ?? ""))), estimated: true },
  // "I'm almost 16", "I'm turning 16", "I'll be 16 in May", "I turn 16 next month": one less.
  { rx: new RegExp(`\\b${ME}\\s+${LESS}(\\d{1,2}|${NUM_WORD})\\b${NOT_DISTANT_BIRTHDAY}${NO_APPROXIMATE_MEASUREMENT}(?!\\s*(?:minutes|mins?|hours|hrs|blocks|miles|km|percent|%|feet|ft|times|for\\b|of\\b))`), age: m => teenOrAdult(precedingBirthdayAge(ageNumber(m[1] ?? ""))), estimated: true },
  { rx: new RegExp(`\\bi(?:(?:'ll| will) be| turn)\\s+(\\d{1,2}|${NUM_WORD})\\b${NOT_DISTANT_BIRTHDAY}\\s+(?:in|on|next|this|soon)\\b`), age: m => teenOrAdult(precedingBirthdayAge(ageNumber(m[1] ?? ""))), estimated: true },
  { rx: /\bwhen i turn\s+(1[4-8]|sixteen|seventeen|eighteen)\b/, age: m => (/^\d/.test(m[1]!) ? Number(m[1]) : AGE_WORDS[m[1]!]!) - 1, estimated: true },
  // "15f here", "16 m", "15/f", "im 15f", "f15".
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?(?:${ME}\\s+)?(1\\d|\\d)\\s*${AGE_SEX_MARKER}(?![a-z])${AGE_SEX_END}`), age: m => teenOrAdult(Number(m[1])) },
  { rx: new RegExp(`\\b${ME}\\s+(1\\d|\\d)\\s*${AGE_SEX_MARKER}(?![a-z])${AGE_SEX_END}`), age: m => teenOrAdult(Number(m[1])) },
  { rx: new RegExp(`^\\W*(?:(?:hi|hey|hello|yo)\\W+)?[fm]\\s*\\/?\\s*(1\\d)${AGE_SEX_END}`), age: m => Number(m[1]) },
  // "15 here", "16 lol" as the whole opening.
  { rx: /^\W*(1[0-7])\s+(?:here|lol)\b/, age: m => Number(m[1]) },
  // "I'm a minor", "I'm under 18", "I'm underage": a minor (17 fails closed; never a decline).
  { rx: new RegExp(`\\b${ME}\\s+(?:a minor|underage|under ?age|under 18|not 18 yet|not (?:an )?adult yet)\\b`), age: () => 17, estimated: true },
  // School year: "I'm a sophomore in high school", "I'm a high school junior", "junior at Lincoln High", "I'm in 7th grade", "9th grader".
  { rx: new RegExp(`\\b${ME}\\s+(?:a\\s+)?(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+(?:high school|hs)\\b`), age: m => SCHOOL_YEAR[m[1]!]!, estimated: true },
  { rx: new RegExp(`\\b${ME}\\s+(?:a\\s+)?(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+[\\w' .-]{1,30}?\\bhigh(?: school)?\\b`), age: m => SCHOOL_YEAR[m[1]!]!, estimated: true },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(?:high school|hs)\\s+(freshman|sophomore|junior|senior|student)\\b`), age: m => SCHOOL_YEAR[m[1]!] ?? 15, estimated: true },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(6|7|8|9|10|11|12)(?:st|nd|rd|th)\\s+grader\\b`), age: m => Number(m[1]) + 5, estimated: true },
  // "grade" must end the clause: "I'm in 7th grade classrooms all day as a teacher" is not an age.
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(6|7|8|9|10|11|12)(?:st|nd|rd|th)?\\s+grade${GRADE_AGE_END}`), age: m => Number(m[1]) + 5, estimated: true },
  { rx: new RegExp(`\\b${ME}\\s+in\\s+(?:the\\s+)?(sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\\s+grade${GRADE_AGE_END}`), age: m => ORDINAL[m[1]!]! + 5, estimated: true },
  // Middle school (ages 11-14) alone fails closed to "minor", not to "under 13": a decline deletes the
  // member's data, so it needs an explicit age or grade ("I'm 12", "I'm in 6th grade").
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:still\\s+)?(?:in|at)|i go to)\\s+middle school\\b(?!\\s*(?:teacher|counselor|principal|nurse|coach|librarian|aide|staff))|\\bi'?m a\\s+middle schooler\\b`), age: () => 13, estimated: true },
  { rx: new RegExp(`\\b(?:${ME}\\s+(?:still\\s+)?(?:in|at)|i go to)\\s+high school\\b`), age: () => 15, estimated: true },
  { rx: new RegExp(`\\b${ME}\\s+a\\s+(?:high schooler|hs student|high school student)\\b`), age: () => 15, estimated: true },
];

// These messages omit the pronoun. Read the whole message so a quote, question, or an
// account of school years does not lower the sender's age.
const SHORT_AGE_START = "^\\s*(?:(?:hi|hey|hello|yo)[\\s,!]+)?";
const SHORT_AGE_END = "(?:\\s*,?\\s+(?:lol|lmao|haha|here|btw|rn|now|tho|fyi))*(?:\\s*,?\\s+(?:hbu|wbu)\\s*\\??)?\\s*[.!]*\\s*$";
const shortAgeRule = (form: string, age: AgeRule["age"], estimated = false): AgeRule => (
  { rx: new RegExp(`${SHORT_AGE_START}(?:${form})${SHORT_AGE_END}`), age, estimated }
);
const SHORT_AGE_RX = [
  shortAgeRule(`(?:just |only )?turned\\s+(\\d{1,2}|${NUM_WORD})(?:\\s+(?:last (?:week|month)|yesterday|recently|today))?`, m => joinAgeOnly(ageNumber(m[1] ?? ""))),
  shortAgeRule(`(?:just |only )?(?:an?\\s+)?(\\d{1,2}|${NUM_WORD})[\\s-]*${YEARS_OLD}(?:\\s+(?:${IDENTITY_WORD}|dude|female|male|[fm]))?`, m => joinAgeOnly(ageNumber(m[1] ?? ""))),
  shortAgeRule("(1[3-7]|thirteen|fourteen|fifteen|sixteen|seventeen)\\s+(?:here|lol|btw|haha|rn)", m => ageNumber(m[1] ?? "")),
  shortAgeRule("(?:still\\s+)?(?:not 18 yet|under 18|a minor|underage)", () => 17, true),
  shortAgeRule("(?:almost|nearly|turning)\\s+(1[6-8]|sixteen|seventeen|eighteen)(?:\\s+(?:in \\w+|next \\w+|this \\w+|soon))?|(1[6-8]|sixteen|seventeen|eighteen)\\s+(?:next (?:week|month|year)|in (?:a few )?(?:weeks|months))", m => joinAgeOnly(ageNumber(m[1] ?? m[2] ?? "") - 1), true),
  shortAgeRule("(?:still\\s+)?in\\s+(?:the\\s+)?(6|7|8|9|10|11|12)(?:st|nd|rd|th)?\\s+grade|(?:an?\\s+)?(6|7|8|9|10|11|12)(?:st|nd|rd|th)\\s+grader", m => Math.max(13, Number(m[1] ?? m[2]) + 5), true),
  shortAgeRule("(?:an?\\s+)?(freshman|sophomore|junior|senior)\\s+(?:in|at)\\s+(?:high school|hs)|(?:an?\\s+)?(?:high school|hs)\\s+(freshman|sophomore|junior|senior)", m => SCHOOL_YEAR[(m[1] ?? m[2])!]!, true),
  shortAgeRule("(?:still\\s+)?in (middle|high) school", m => m[1] === "middle" ? 13 : 15, true),
];

/** Every match of one rule. A rule can match more than once in one message. */
function allMatches(rx: RegExp, text: string): RegExpExecArray[] {
  const re = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** A not-now word applies within its own clause. Quote scope is checked on the evidence span. */
function notNowBefore(text: string, at: number): boolean {
  const before = text.slice(0, at);
  let from = 0;
  CLAUSE_BREAK.lastIndex = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) from = m.index! + m[0].length;
  return NOT_NOW.test(before.slice(from).slice(-24));
}

/**
 * The youngest age the sender states about themselves, and the youngest they state in the explicit
 * form ("I am 12 years old"). Every occurrence counts, in every sentence: "I'm 30. I'm 15." is 15,
 * "I'm 30. Age: 15." is 15, and "I am 40 years old. I am 12 years old." is 12. A near birthday estimates the preceding age.
 * First person only, so "my son is 12", "I teach middle school" or "I act like I'm 12" never
 * change the member's age. An age inside a quote that is still open is not theirs; a quote that
 * has closed does not hide the next statement (`he said "hi" I'm 15`).
 */
export function agesStated(body: string, { directOnly = false } = {}): { age?: number; explicit?: number; oldest?: number } {
  const t = normalizeAgeInitialism(normText(body));
  const out: { age?: number; explicit?: number; oldest?: number } = {};
  // Rules that start at the beginning of the text ("age: 15", "15 y/o here", "15f", "f15", "15 here")
  // are read on each sentence. On the whole message they would see only the first sentence.
  for (const s of sentencesOf(t, true)) {
    for (const { rx, age, explicit, estimated, reading } of AGE_RX) {
      if (directOnly && estimated) continue;
      for (const m of allMatches(rx, s.text)) {
        const start = s.at + m.index;
        if (!unquotedOwnAgeEvidence(t, start, start + m[0].length) || notNowBefore(t, start)) continue;
        const after = s.text.slice(m.index + m[0].length);
        const rawAge = age(m);
        const part = reading === "part" ? agePartEvidenceOf(rawAge, m[2]!, after, PART_CLAUSE_END.test(after), { reading: m[0] }) : undefined;
        if (part === "FractionalAgeUnknown") continue;
        const exact = explicit === true || part === "FractionalAgeExplicit";
        const a = reading === "conjunction" ? ageBeforeConjunction(rawAge, m) : rawAge;
        if (!Number.isFinite(a) || (directOnly && !exact && !canJoin(a) && reading !== undefined)) continue;
        if (out.age === undefined || a < out.age) out.age = a;
        if (out.oldest === undefined || a > out.oldest) out.oldest = a;
        if (exact && (out.explicit === undefined || a < out.explicit)) out.explicit = a;
      }
    }
  }
  for (const { rx, age, estimated } of SHORT_AGE_RX) {
    if (directOnly && estimated) continue;
    const m = rx.exec(t);
    if (!m) continue;
    const a = age(m);
    if (!Number.isFinite(a)) continue;
    if (out.age === undefined || a < out.age) out.age = a;
    if (out.oldest === undefined || a > out.oldest) out.oldest = a;
  }
  const direct = relayMinorAge(t);
  if (direct !== undefined && (out.age === undefined || direct < out.age)) out.age = direct;
  if (direct !== undefined && (out.oldest === undefined || direct > out.oldest)) out.oldest = direct;
  return out;
}

/** The youngest age the sender states about themselves, or undefined. */
export const statedAge = (body: string): number | undefined => agesStated(body).age;

/** Spelled-out ages from 20 to 99 ("thirty", "twenty-five", "forty one"); the teens are in AGE_WORDS. */
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const TENS_WORD = Object.keys(TENS).join("|");
const UNIT_WORD = "one|two|three|four|five|six|seven|eight|nine";

const AGE_ANSWER_RX = new RegExp(`^(?:${ME}\\s+)?(\\d{1,3}|(?:${TENS_WORD})(?:[\\s-]+(?:${UNIT_WORD}))?|${Object.keys(AGE_WORDS).join("|")})(?:\\s*${YEARS_OLD})?\\s*[.!]*$`);

/**
 * The answer to "How old are you?": the whole message is an age ("34", "I'm 34.", "15 years old",
 * "fifteen", "thirty-two"). Anything more is not read as an answer here (classify() reads ages in
 * sentences).
 */
export function ageAnswer(body: string): number | undefined {
  const t = normText(body).trim();
  const es = new RegExp(`^(?:(?:yo\\s+)?tengo\\s+)?(\\d{1,3}|${ES_AGE_WORD})\\s+a[nñ]os\\s*[.!]*$`).exec(t);
  if (es) {
    const n = /^\d/.test(es[1]!) ? Number(es[1]) : ES_AGE_WORDS[es[1]!] ?? NaN;
    return n > 0 && n < 120 ? n : undefined;
  }
  const m = AGE_ANSWER_RX.exec(t);
  if (!m) return undefined;
  const [w, unit] = m[1]!.split(/[\s-]+/);
  const n = /^\d/.test(w!) ? Number(w) : (TENS[w!] ?? AGE_WORDS[w!]!) + (unit ? AGE_WORDS[unit]! : 0);
  return n > 0 && n < 120 ? n : undefined;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  ...SPANISH_MONTHS,
};
const MONTH_NAME = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
type DateGroups = readonly (string | undefined)[];
type DateForm = { source: string; numeric: boolean; parts: (g: DateGroups) => [number, number, number] };
const monthOf = (name: string | undefined) => MONTHS[(name ?? "").toLowerCase()] ?? 0;
const MONTH_WORDS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DATE_FORMS: DateForm[] = [
  { source: "(\\d{4})-(\\d{2})-(\\d{2})", numeric: false, parts: g => [Number(g[1]), Number(g[2]), Number(g[3])] },
  { source: "(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})", numeric: true, parts: g => [Number(g[3]), Number(g[1]), Number(g[2])] },
  { source: `(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?:de\\s+)?(\\d{4})`, numeric: false, parts: g => [Number(g[3]), monthOf(g[1]), Number(g[2])] },
  { source: `(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:(?:of|de)\\s+)?(${MONTH_NAME})\\.?,?\\s+(?:de\\s+)?(\\d{4})`, numeric: false, parts: g => [Number(g[3]), monthOf(g[2]), Number(g[1])] },
];
const bounded = (source: string) => `(?<![\\w/.-])${source}(?![\\w/-]|\\.\\d)`;
const BIRTH_WORD = "(?:birthday|bday|b-day|birth ?date|date of birth|dob|cumplea[nñ]os|fecha de nacimiento)";
const SELF_BORN = "(?:(?:i\\s+was|i['’]?m|i\\s+am)\\s+born(?:\\s+on)?|nac[ií](?:\\s+el)?)";
const BIRTH_LEAD = `(?:(?:my\\s+|mi\\s+)?${BIRTH_WORD}(?:\\s+(?:is|es))?\\s*[:=-]?|${SELF_BORN}|born(?:\\s+on)?)`;
const SELF_BIRTH_LEAD = `(?:(?:my|mi)\\s+${BIRTH_WORD}(?:\\s+(?:is|es))?\\s*[:=-]?|${BIRTH_WORD}\\s*[:=]|${SELF_BORN})`;
const ANSWER_RX = DATE_FORMS.map(form => ({
  form, rx: new RegExp(`^\\s*(?:(?:hi|hey|hello|yo|ok|okay|sure)[\\s,!.]+)?(?:${BIRTH_LEAD}\\s*)?${bounded(form.source)}\\s*[.!]*\\s*$`, "i"),
}));
const STATED_RX = DATE_FORMS.map(form => ({
  form, rx: new RegExp(`(?:^|[.!?;,]\\s*|\\b(?:and|but|also|btw|actually|fyi|oh|lol|hi|hey|hello|so|well)\\s+)\\s*${SELF_BIRTH_LEAD}\\s*${bounded(form.source)}(?=\\s*(?:$|[.!?;,]|(?:and|but|so|btw|lol|haha|actually|tbh|thanks)\\b))`, "gi"),
}));
const FOUND_RX = DATE_FORMS.map(form => ({ form, rx: new RegExp(`(?:${BIRTH_LEAD}\\s*)?${bounded(form.source)}`, "gi") }));

function calendarKey(form: DateForm, g: DateGroups): number | undefined {
  if (form.numeric && numericDateAmbiguous(Number(g[1]), Number(g[2]))) return undefined;
  const [year, month, day] = form.parts(g);
  return birthKeyOfParts(year, month, day);
}

const usableKey = (key: number | undefined, dayKey: number): number | undefined =>
  key !== undefined && birthKeyUsable(key, dayKey) ? key : undefined;

export type UnclearBirthDate = { monthFirst: string; dayFirst: string };

function unclearOf(form: DateForm, g: DateGroups, dayKey: number): UnclearBirthDate | undefined {
  const first = Number(g[1]), second = Number(g[2]), year = Number(g[3]);
  if (!form.numeric || !numericDateAmbiguous(first, second)) return undefined;
  if (usableKey(birthKeyOfParts(year, first, second), dayKey) === undefined || usableKey(birthKeyOfParts(year, second, first), dayKey) === undefined) return undefined;
  return { monthFirst: `${MONTH_WORDS[first - 1]} ${second}, ${year}`, dayFirst: `${MONTH_WORDS[second - 1]} ${first}, ${year}` };
}

export function unclearBirthDateAnswer(body: string, dayKey: number): UnclearBirthDate | undefined {
  const t = normText(body);
  for (const { form, rx } of ANSWER_RX) {
    const m = rx.exec(t);
    if (m) return unclearOf(form, m, dayKey);
  }
  return undefined;
}

export function birthDateAnswer(body: string, dayKey: number): number | undefined {
  const t = normText(body);
  for (const { form, rx } of ANSWER_RX) {
    const m = rx.exec(t);
    if (m) return usableKey(calendarKey(form, m), dayKey);
  }
  return undefined;
}

export function birthDateStated(body: string, dayKey: number): number | undefined {
  const t = normText(body);
  let latest: number | undefined;
  for (const { form, rx } of STATED_RX) {
    for (const m of t.matchAll(rx)) {
      if (quoteStillOpen(t.slice(0, m.index))) continue;
      const key = usableKey(calendarKey(form, m), dayKey);
      if (key !== undefined && (latest === undefined || key > latest)) latest = key;
    }
  }
  return latest;
}

const DATE_GAP = "\u0000";
const DATE_GAP_RX = /[ \t]*[,;]?[ \t]*\u0000(?:[ \t]*[,;]?[ \t]*\u0000)*[ \t]*[,;]?[ \t]*/g;

function closeDateGaps(text: string): string {
  return text.replace(DATE_GAP_RX, (gap: string, at: number, whole: string) => {
    const before = whole.slice(0, at), after = whole.slice(at + gap.length);
    if (before === "" || /[\r\n]$/.test(before) || after === "" || /^[\r\n]/.test(after)) return "";
    return /[,;]/.test(gap) ? ", " : " ";
  });
}

export function birthDateIn(text: string, dayKey: number): { birthDate?: number; birthAge?: number; unclear?: UnclearBirthDate; rest: string } {
  const seen: { latest?: number; unclear?: UnclearBirthDate; found: boolean } = { found: false };
  let marked = text;
  for (const { form, rx } of FOUND_RX) {
    marked = marked.replace(rx, (whole: string, first: string, second: string, third: string) => {
      const groups: DateGroups = [whole, first, second, third];
      const key = usableKey(calendarKey(form, groups), dayKey);
      if (key !== undefined && (seen.latest === undefined || key > seen.latest)) seen.latest = key;
      seen.unclear ??= unclearOf(form, groups, dayKey);
      seen.found = true;
      return DATE_GAP;
    });
  }
  if (!seen.found) return { rest: text };
  const rest = closeDateGaps(marked);
  if (seen.latest === undefined) return { ...(seen.unclear ? { unclear: seen.unclear } : {}), rest };
  return { birthDate: seen.latest, birthAge: ageOnDay(seen.latest, dayKey), rest };
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
const SKILL_LEX = Object.entries({
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
}).map(([tag, pattern]): [string, RegExp] => [tag, new RegExp(pattern.source, "g")]);
/** The sender's own skill is said in the first person; "looking for a bassist" is a want, not a skill. */
const FIRST_PERSON = /\b(i|i'm|im|i've|ive|i am|my|me)\b/;
const SEEKING = /\b(looking for|need|needs|want|wants|find|seeking|searching|someone who|anyone who|somebody who|a person who)\b/g;
const DIRECT_SKILL_CLAIM = /(?:^|[,:]\s*(?:and\s+)?|\b(?:and|but|though|although|however|except)\s+)\s*(?:i(?:'m|m|\s+am|\s+have\s+been|'ve\s+been)\s+an?\b|i\s+(?:(?:can|also|currently)\s+)*(?:play|sing|teach|work|do|make|build|train|write|code|paint|cook|dance|perform|host|edit|run|belay)\b|my\s+(?:work|job|role|career|profession)\s+as\b)/g;
const SKILL_TITLE_PREFIX = /^(?:\s+(?:as|the|an?|senior|junior|staff|lead|principal|experienced|professional))*\s*$/;
const OTHER_SKILL_SUBJECT = /\b(?:(?:my|our|your|their|his|her)\s+(?:friend|colleague|coworker|partner|roommate|sibling|parent|teacher|mentor|boss)|he|she|they|i\s+(?:know|met|work with)\s+(?:an?|the|someone|somebody))\b/g;

/** Aliases people use for the neighborhoods the Network knows (geo.ts names are canonical). */
const AREA_ALIASES: [RegExp, string][] = [
  [/\b(les|lower east side)\b/, "Lower East Side"], [/\b(uws|upper west side|upper west)\b/, "Upper West Side"], [/\b(ues|upper east side|upper east)\b/, "Upper East Side"],
  [/\b(fidi|financial district|wall st(reet)?)\b/, "Financial District"], [/\b(bed[- ]?stuy|bedford[- ]stuyvesant)\b/, "Bed-Stuy"], [/\bhell'?s kitchen\b/, "Hell's Kitchen"],
  [/\b(lic|long island city)\b/, "Long Island City"], [/\bdumbo\b/, "DUMBO"], [/\bsoho\b/, "SoHo"], [/\b(wash(ington)? heights)\b/, "Washington Heights"],
  [/\bcrown (heights|hts)\b/, "Crown Heights"], [/\bprospect (heights|hts)\b/, "Prospect Heights"], [/\bjackson (heights|hts)\b/, "Jackson Heights"],
  [/\b(st\.? george)\b/, "St. George"], [/\b(e\.? ?village|east vill(age)?)\b/, "East Village"], [/\b(w\.? ?village|west vill(age)?)\b/, "West Village"],
  [/\bwilliamsburg|\bwburg\b|\bbillyburg\b/, "Williamsburg"], [/\bgreenpoint\b/, "Greenpoint"], [/\bbushwick\b/, "Bushwick"], [/\b(?:fort|ft) greene\b/, "Fort Greene"],
  [/\bpark slope\b|\bthe slope\b/, "Park Slope"], [/\bcarroll gardens\b/, "Carroll Gardens"], [/\bred hook\b/, "Red Hook"], [/\bsunset park\b/, "Sunset Park"], [/\bbay ridge\b/, "Bay Ridge"],
  [/\bflatbush\b/, "Flatbush"], [/\bastoria\b/, "Astoria"], [/\bsunnyside\b/, "Sunnyside"], [/\bridgewood\b/, "Ridgewood"], [/\bflushing\b/, "Flushing"],
  [/\bmott haven\b/, "Mott Haven"], [/\briverdale\b/, "Riverdale"], [/\binwood\b/, "Inwood"], [/\beast harlem\b|\bspanish harlem\b|\bel barrio\b/, "East Harlem"],
  [/\b(?<!east |spanish )harlem\b/, "Harlem"], [/\bchelsea\b/, "Chelsea"], [/\bgramercy\b/, "Gramercy"], [/\bflatiron\b/, "Flatiron"], [/\bmurray hill\b/, "Murray Hill"],
  [/\bmidtown\b/, "Midtown"], [/\btribeca\b/, "Tribeca"], [/\bchinatown\b/, "Chinatown"],
];
const MULTI_CITY_ALIASES: [RegExp, string][] = (() => {
  const out: [RegExp, string][] = [];
  const skip = new Set(["midtown", "downtown", "uptown", "westside", "grove"]);
  for (const city of CITY_IDS) {
    if (city === "nyc") continue;
    for (const n of CITIES[city].neighborhoods) {
      const terms = [n.name.toLowerCase(), ...n.aliases.map(a => a.toLowerCase())];
      for (const term of terms) {
        if (term.length < 4 || skip.has(term)) continue;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        if (term === "loop") {
          out.push([/(?<!reservoir\s)\bloop\b/, n.name]);
        } else {
          out.push([new RegExp(`\\b${escaped}\\b`), n.name]);
        }
      }
    }
  }
  return out;
})();
const ALL_AREA_ALIASES: [RegExp, string][] = [...AREA_ALIASES, ...MULTI_CITY_ALIASES];
const AREA_NAMES = new Set(allNeighborhoods().map(n => n.name));
const locationText = (text: string) => normText(text).replace(/[.\p{Pd}]/gu, " ").replace(/\s+/g, " ").trim();
const locationNames = [
  ...VENUES.flatMap(venue => [venue.name, venue.name.split(/,| \(| at /)[0]!].map(name => [locationText(name), venue.neighborhood] as const)),
  ...NEIGHBORHOODS.map(area => [locationText(area.name), area.name] as const),
].sort(([a], [b]) => b.length - a.length);
const cityLocationCache = new Map<string, { names: [string, string][]; aliases: [RegExp, string][] }>();

function cityLocationsFor(city: CityId): { names: [string, string][]; aliases: [RegExp, string][] } {
  const key = city.trim().toLowerCase();
  const cached = cityLocationCache.get(key);
  if (cached) return cached;
  const spec = getCity(key);
  const namePairs: [string, string][] = [];
  const aliasPairs: [RegExp, string][] = [];
  if (spec) {
    for (const v of seedVenuesForCity(spec.id)) {
      for (const label of [v.name, v.name.split(/,| \(| at /)[0]!]) {
        const norm = locationText(label);
        if (norm) namePairs.push([norm, v.neighborhood]);
      }
    }
    for (const n of spec.neighborhoods) {
      const normName = locationText(n.name);
      if (normName) namePairs.push([normName, n.name]);
      for (const alias of [n.name, ...n.aliases]) {
        const clean = locationText(alias);
        if (!clean || clean.length < 2) continue;
        namePairs.push([clean, n.name]);
        const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        aliasPairs.push([new RegExp(`\\b${escaped}\\b`), n.name]);
      }
    }
  }
  if (key === "sf") {
    for (const n of SF_NEIGHBORHOODS) {
      const clean = locationText(n.name);
      if (!clean) continue;
      namePairs.push([clean, n.name]);
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      aliasPairs.push([new RegExp(`\\b${escaped}\\b`), n.name]);
    }
  }
  namePairs.sort(([a], [b]) => b.length - a.length);
  const entry = { names: namePairs, aliases: aliasPairs };
  cityLocationCache.set(key, entry);
  return entry;
}

const unspecifiedPlanPlace = /^(?:(?:a|one|two|three|four|few|couple|several|\d+)\s|(?:person|general|particular|advance|mind|the|my|our|your|their|town|nyc|new york(?: city)?|sf|san francisco|la|los angeles|chicago|miami|this|next|today|tomorrow|tonight|noon|midnight|morning|afternoon|evening|weekend|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/;
const vaguePlanArea = /^(?:the\s+)?(?:brooklyn|queens|manhattan|bronx|staten island|new jersey|jersey city|hoboken|forest hills)\b/;
export const plansPlaceQuestion = "Which NYC neighborhood should I use? Ask again with the neighborhood name.";

/** City-appropriate neighborhood follow-up prompt (defaults to NYC for backwards compatibility). */
export function plansPlaceQuestionForCity(city?: CityId): string {
  const key = city?.trim().toLowerCase();
  if (!key || key === "nyc") return plansPlaceQuestion;
  const spec = getCity(key);
  return spec
    ? `Which ${spec.name} neighborhood should I use? Ask again with the neighborhood name.`
    : "Which neighborhood should I use? Ask again with the neighborhood name.";
}

export const plansPlaceQuestionFor = plansPlaceQuestionForCity;

/** Read one direct public recommendation location without copying a raw place into a reply. */
export function publicPlanLocation(text: string, exactOrCity: boolean | CityId = false, cityArg?: CityId): { area?: string; mentioned: boolean } {
  const exact = typeof exactOrCity === "boolean" ? exactOrCity : false;
  const city = (typeof exactOrCity === "string" ? exactOrCity : cityArg)?.trim().toLowerCase() || "nyc";
  const isNyc = city === "nyc";
  const cityLocs = isNyc ? undefined : cityLocationsFor(city);
  let mentioned = false;
  for (const cue of text.matchAll(/\b(?:in|near|around|at|by)\s+/gi)) {
    const before = normText(text.slice(0, cue.index));
    if (quoteStillOpen(before) || /\b(?:not|never|instead of|except|away from)\s*$/.test(before)) continue;
    const original = text.slice(cue.index + cue[0].length).trim();
    const phrase = locationText(original);
    const withoutArticle = phrase.replace(/^the\s+/, "");
    const candidates = phrase === withoutArticle ? [phrase] : [phrase, withoutArticle];
    const names = isNyc ? locationNames : cityLocs!.names;
    for (const [name, area] of names) {
      if (candidates.some(value => exact ? value === name : value.startsWith(name) && /^(?:$|[\s,?!:;)])/.test(value.slice(name.length)))) {
        return { area, mentioned: true };
      }
    }
    if (!isNyc) {
      const cityMatch = findNeighborhood(city as CityId, original);
      if (cityMatch) return { area: cityMatch.name, mentioned: true };
    }
    const aliases = isNyc ? AREA_ALIASES : cityLocs!.aliases;
    for (const [pattern, area] of aliases) {
      if ((!isNyc || AREA_NAMES.has(area)) && candidates.some(value => {
        const match = pattern.exec(value);
        return match?.index === 0 && (!exact || match[0] === value);
      })) return { area, mentioned: true };
    }
    if (exact && (!/^[\p{L}]+(?:[ '’.-][\p{L}]+){0,5}$/u.test(original)
      || /\b(?:i|you|my|your|we|they|he|she|am|are|and|but|or|with|when|unless|if|stop|years?)\b/i.test(original))) continue;
    if (!withoutArticle || unspecifiedPlanPlace.test(withoutArticle)) continue;
    if (vaguePlanArea.test(phrase) || /^(?:the\s+)?\p{Lu}[\p{L}'’-]+/u.test(original)
      || /\b(?:heights|station|park|garden|museum|library|district|square)\b/.test(withoutArticle)) mentioned = true;
  }
  return { mentioned };
}
/** Words that say where the sender is based ("I live in", "based in", "I'm around"). */
const HOME_CTX = /\b(i live|i'?m living|living in|live in|based (in|out of)|i'?m (in|around|near|over in|up in|out in|down in|by)|im (in|around|near)|i'?m from|my (place|apartment|apt|neighborhood|hood) is|home is|i stay in|my area is|i'?m mostly (in|around)|around .* most of the week)\b/;
/** Where a neighborhood is not home: "used to live in", "work in the", "moved from". Each can take "the". */
const NOT_HOME = /\b(used to live(?: in)?|moved (?:away )?from|grew up in|work(ing)? in|office (is )?in|commute to|visiting|not in|never been to|far from)(?: the)?\s*$/;

const RED_LINE_NEG_BEFORE = /\b(?:not|never|no longer|don't|do not|doesn't|does not|without needing|no need for)\s+(?:really\s+|strictly\s+|keep\s+|eat\s+|need\s+|use\s+|have\s+)?$/i;
const RED_LINE_RULES: readonly [string, RegExp, boolean?][] = [
  ["strict_sober", /\b(?:strictly\s+sober|in\s+recovery|recovering\s+alcoholic|sober(?:\s+(?:only|lifestyle|living|for\s+\d+|since))?|alcohol[- ]?free|no\s+alcohol|zero\s+alcohol|can'?t\s+be\s+around\s+alcohol|avoid(?:ing)?\s+bars?|no\s+bars?(?:\s+please)?|don'?t\s+go\s+to\s+bars?|not\s+around\s+alcohol|12[- ]?step|in\s+aa)\b/i, true],
  ["non_drinker", /\b(?:non[- ]?drinker|teetotal(?:er)?|(?:i\s+)?(?:don'?t|do\s+not|never)\s+drink(?:\s+alcohol)?|doesn'?t\s+drink(?:\s+alcohol)?|no\s+drinking)\b/i, true],
  ["halal", /\b(?:halal(?:\s+(?:only|food|friendly|diet|spots?|places?))?|keep(?:s|ing)?\s+halal|eat(?:s|ing)?\s+halal)\b/i],
  ["kosher", /\b(?:(?:glatt\s+)?kosher(?:\s+(?:only|food|friendly|diet|spots?|places?))?|keep(?:s|ing)?\s+kosher|eat(?:s|ing)?\s+kosher)\b/i],
  ["gluten_free", /\b(?:gluten[- ]?free|celiac|coeliac|no\s+gluten|gluten\s+(?:allergy|intoleran\w*))\b/i],
  ["vegetarian", /\b(?:vegetarian|veggie\s+only|(?:don'?t|do\s+not|doesn'?t|never)\s+eat\s+meat|no\s+meat|meat[- ]?free)\b/i],
  ["vegan", /\b(?:strictly\s+vegan|vegan|plant[- ]?based|no\s+animal\s+products?)\b/i],
  ["severe_allergen", /\b(?:(?:severe|serious|deadly|life[- ]?threatening)\s+(?:food\s+)?allerg(?:y|ies|ic)|anaphylac\w*|epi[- ]?pen|(?:tree\s+)?(?:nut|peanut|shellfish)\s+allerg(?:y|ies)|allergic\s+to\s+(?:peanuts?|tree\s+nuts?|nuts|shellfish|sesame|dairy|eggs?|fish|soy))\b/i, true],
  ["wheelchair", /\b(?:wheelchair(?:[- ]?accessible)?|ada\s+accessible|step[- ]?free|no\s+stairs|roll[- ]?in\s+access|mobility\s+aid|handicap\s+accessible|accessibility\s+required)\b/i],
  ["smoke_free", /\b(?:smoke[- ]?free|non[- ]?smoker|no\s+smoking|no\s+smoke|avoid\s+smoke|allergic\s+to\s+smoke|no\s+smokers?|no\s+cigarettes?)\b/i, true],
  ["low_noise", /\b(?:low[- ]?noise|quiet\s+(?:only|places?|spots?|venues?)|somewhere\s+quiet|nothing\s+loud|no\s+loud(?:\s+(?:places?|bars?|venues?|music))?|hate\s+loud|can'?t\s+do\s+loud|sensory[- ]?friendly|noise[- ]?sensitive|hard\s+of\s+hearing|hearing\s+(?:aid|accessible)|overstimulated\s+by\s+noise)\b/i, true],
  ["daytime_only", /\b(?:daytime[- ]?only|only\s+daytime|no\s+after\s+dark|not\s+after\s+dark|before\s+dark|daylight\s+only|only\s+during\s+the\s+day|only\s+in\s+the\s+daytime|(?:don'?t|do\s+not|doesn'?t)\s+go\s+out\s+at\s+night|no\s+(?:late\s+)?nights?|mornings?\s+and\s+afternoons?\s+only)\b/i, true],
];

/** Extract canonical venue/dietary/accessibility red-line facet tags matching memberVenuePrefsOf(). */
export function extractRedLineTags(body: string): string[] {
  const t = normText(body);
  if (!t.trim()) return [];
  const tags = new Set<string>();
  const noAllergies = /\bno\s+(?:food\s+)?allergies\b|\bno\s+dietary\s+restrictions\b/i.test(t);
  for (const s of sentencesOf(t)) {
    for (const [tag, rx, selfNegative] of RED_LINE_RULES) {
      if (tag === "severe_allergen" && noAllergies && !/\b(?:peanut|nut|shellfish|anaphylac|epi[- ]?pen|allergic\s+to)\b/i.test(s.text)) continue;
      const m = rx.exec(s.text);
      if (!m) continue;
      const before = s.text.slice(0, m.index).split(/[,;:]|\b(?:but|though|however)\b/).pop() ?? "";
      if (!selfNegative && RED_LINE_NEG_BEFORE.test(before)) continue;
      if (tag === "strict_sober" && /\bnot\s+(?:strictly\s+)?sober\b/i.test(s.text.slice(Math.max(0, m.index - 12), m.index + m[0].length))) continue;
      tags.add(tag);
    }
  }
  return [...tags];
}

export interface Profile {
  interests: string[]; skills: string[]; desireIds: string[];
  /** Canonical venue/dietary/accessibility red-line facet tags extracted from the message. */
  redLines: string[];
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
export function areaOf(text: string, city?: CityId): { area?: string; unknown?: boolean } {
  const t = normText(text).replace(/\bst\.\s*/g, "st ").replace(/\bft\.\s*(?=greene\b)/g, "ft ");
  const normalizedCity = city?.trim().toLowerCase();
  if (normalizedCity && normalizedCity !== "nyc") {
    const cityAliases = cityLocationsFor(normalizedCity).aliases;
    for (const s of sentencesOf(t)) {
      let best: { at: number; name: string } | undefined;
      for (const [rx, name] of cityAliases) {
        const m = rx.exec(s.text);
        if (!m || NOT_HOME.test(s.text.slice(0, m.index))) continue;
        if (!best || m.index < best.at) best = { at: m.index, name };
      }
      if (best) return { area: best.name };
      const found = findNeighborhood(normalizedCity as City, s.text);
      if (found) {
        const idx = s.text.indexOf(found.name.toLowerCase());
        if (idx < 0 || !NOT_HOME.test(s.text.slice(0, idx))) return { area: found.name };
      }
    }
  }
  for (const s of sentencesOf(t)) {
    // The first neighborhood named as home in the sentence ("between Greenpoint and Williamsburg": Greenpoint).
    let best: { at: number; name: string } | undefined;
    for (const [rx, name] of ALL_AREA_ALIASES) {
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
export function extractProfile(body: string, city?: CityId): Profile {
  const t = normText(body);
  const interests = new Set<string>(), skills = new Set<string>(), desires = new Set<string>(), notWanted = new Set<string>();
  let negatedAsk = false;
  const kept: string[] = [];
  for (const s of sentencesOf(t)) {
    const x = s.text;
    const quotedAt = (at: number) => quoteStillOpen(t.slice(0, s.at + at));
    const cues = (pattern: RegExp) => [...x.matchAll(pattern)].filter(m => !quotedAt(m.index));
    const seeks = cues(SEEKING).reverse();
    const selfClaims = cues(DIRECT_SKILL_CLAIM).reverse();
    const otherSubjects = cues(OTHER_SKILL_SUBJECT).reverse();
    const learnableSkillAt = (at: number) => {
      const seeking = seeks.find(m => m.index < at)?.index ?? -1;
      const selfClaim = selfClaims.find(m => m.index <= at
        && SKILL_TITLE_PREFIX.test(x.slice(m.index + m[0].length, at)))?.index ?? -1;
      const otherSubject = otherSubjects.find(m => m.index < at)?.index ?? -1;
      return profileSkillMayLearn(quotedAt(at), otherSubject > selfClaim, seeking >= 0, selfClaim > seeking);
    };
    let nextPartOffset = 0;
    // A negation scopes over what comes after it in its sentence ("I like jazz but don't want a band" splits at "but").
    for (const part of x.split(/\b(?:but|though|although|however|except)\b|,\s*(?=(?:and )?(?:i|i'm|im)\b)/)) {
      const partOffset = x.indexOf(part, nextPartOffset);
      nextPartOffset = partOffset + part.length;
      const neg = NEG_WANT.exec(part);
      const negAt = neg ? neg.index : Infinity;
      const excluded = /\b(?:anything|everything|anyone|anybody)\s+(?:but|except)\s*$/i.test(x.slice(0, partOffset))
        && !/(?:\b(?:not|never)\b|n't\b)/i.test(x.slice(0, partOffset))
        && !/^\s*(?:(?:[a-z]+ly\s+)?(?:i|i'm|im|i'd|i'll|i've|we|you|he|she|they|my|it|that|this)\b|(?:[a-z]+ly\s+)?(?:would\s+(?:love|like|prefer)|want(?:ing)?|looking\s+for|hoping\s+to|trying\s+to|love\s+to|like\s+to|down\s+(?:for|to)|open\s+to|interested\s+in)\b)/i.test(part);
      const effNegAt = excluded ? 0 : negAt;
      const wantCtx = WANT_CTX.test(part);
      if (neg && /\b(looking for|find|meet|anyone|anybody|someone|somebody|want|need|set me up|introduce|match|suggest)\w*\b/.test(part.slice(negAt))) negatedAsk = true;
      // What is not under a negation: the taxonomy-label pass below reads only this.
      kept.push(part.slice(0, Number.isFinite(effNegAt) ? effNegAt : undefined));
      for (const [id, rxs] of Object.entries(WANT_LEX)) for (const rx of rxs) {
        const m = rx.exec(part);
        if (!m) continue;
        // Negated before the want ("I don't want to meet founders"), or right after it ("dating isn't for me").
        const after = part.slice(m.index + m[0].length);
        if (excluded || NEG_WANT.test(part.slice(0, m.index)) || /^\s*(?:is|are|'s|'re)?\s*(?:n't|not|isn'?t|aren'?t)\b(?! only)/.test(after)) notWanted.add(id);
        else if (wantCtx || SELF_WANTS.has(id)) desires.add(id);
        break;
      }
      for (const [tag, rx] of Object.entries(INTEREST_LEX)) {
        const m = rx.exec(part);
        if (m && !excluded && !(m.index > negAt)) interests.add(tag);
      }
      if (FIRST_PERSON.test(part)) for (const [tag, rx] of SKILL_LEX) {
        for (const m of part.matchAll(rx)) {
          if (m.index <= effNegAt && learnableSkillAt(partOffset + m.index)) {
            skills.add(tag);
            break;
          }
        }
      }
      // Taxonomy labels also occur in short profile answers such as "Senior product designer."
      for (const k of SKILLS) {
        const label = k.label.toLowerCase();
        for (let at = part.indexOf(label); at >= 0 && at < effNegAt; at = part.indexOf(label, at + label.length)) {
          if (learnableSkillAt(partOffset + at)) {
            skills.add(k.tag);
            break;
          }
        }
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
  // A negated like is not an interest ("not into running"): drop interests named only after a negation.
  const where = areaOf(body, city);
  return {
    interests: [...interests], skills: [...skills], desireIds: DESIRES.map(d => d.id).filter(id => desires.has(id)),
    redLines: extractRedLineTags(body),
    ...(where.area ? { area: where.area } : {}), ...(where.unknown ? { areaUnknown: true } : {}),
    notWanted: [...notWanted], negatedAsk: negatedAsk && !desires.size,
    eveningsOpen: /evenings are (pretty )?open|free most evenings|evenings (are )?free|evenings work/i.test(body) ? true : /evenings are tight|evenings are busy|no evenings/i.test(body) ? false : undefined,
    groups: /small groups|groups are (good|great|better|my thing)|prefer groups/i.test(body) ? true : undefined,
    weekends: /weekends work best|weekends are best|prefer weekends/i.test(body) ? true : undefined,
  };
}

export { explicitRepeatRequest, planAgainOf } from "@thenetwork/core";

export type VenueIssue = "too_loud" | "too_crowded" | "too_expensive" | "bad_seating" | "wrong_vibe";

export interface VenueFeedbackExtracted {
  venueSentiment?: "liked" | "neutral" | "disliked";
  venueClosed: boolean;
  venueIssues: VenueIssue[];
  notInterested: boolean;
  mentionedVenue?: string;
}

const VENUE_CLOSED_RX = /\b(?:(?:it'?s|it is|it was|the place|the spot|the venue|they(?:'re| are| were)|bar|cafe|coffee shop|restaurant|bakery|brewery)\s+(?:is\s+|was\s+|were\s+)?(?:permanently\s+|temporarily\s+)?(?:closed|shut\s*down|boarded\s*up|out\s+of\s+business|locked\s*up|gone|shuttered)|(?:permanently|temporarily)\s+closed|shut\s*down|boarded\s*up|out\s+of\s+business|lights\s+were\s+off|closed\s+for\s+(?:a\s+private\s+event|renovations?))\b/;
const VENUE_ISSUE_RX: [RegExp, VenueIssue][] = [
  [/\b(?:too\s+loud|way\s+too\s+loud|couldn'?t\s+hear|could\s+not\s+hear|deafening|blasting\s+music|super\s+loud|really\s+loud|too\s+noisy)\b/, "too_loud"],
  [/\b(?:too\s+crowded|way\s+too\s+crowded|super\s+crowded|crowded|packed|shoulder\s+to\s+shoulder|no\s+space|crazy\s+wait|hour\s+wait|long\s+line)\b/, "too_crowded"],
  [/\b(?:too\s+expensive|overpriced|way\s+too\s+pricey|super\s+pricey|rip\s*-?\s*off|cost\s+a\s+fortune)\b/, "too_expensive"],
  [/\b(?:bad\s+seating|nowhere\s+to\s+sit|no\s+seating|no\s+tables|standing\s+room\s+only|couldn'?t\s+get\s+a\s+table|uncomfortable\s+chairs)\b/, "bad_seating"],
  [/\b(?:wrong\s+vibe|weird\s+vibe|bad\s+vibe|off\s+vibe|sketchy\s+(?:spot|place|area|bar)|dead\s+in\s+there|awkward\s+(?:spot|place|venue))\b/, "wrong_vibe"],
];
const VENUE_REJECT_RX = /\b(?:not\s+interested(?:\s+in\s+(?:that|this)\s+(?:spot|place|venue|bar|cafe))?|don'?t\s+like\s+(?:that|this)\s+(?:spot|place|venue|bar|cafe)|skip\s+(?:that|this)\s+(?:spot|place|venue)|never\s+going\s+back|wouldn'?t\s+go\s+back|rather\s+go\s+somewhere\s+else|different\s+(?:spot|place|venue)\s+next\s+time)\b/;
const VENUE_LIKED_RX = /\b(?:(?:loved|liked|great|amazing|awesome|cool|nice|good|cozy|solid)\s+(?:the\s+)?(?:place|spot|venue|bar|cafe|patio|coffee\s+shop|brewery|food\s+hall)|(?:the\s+)?(?:place|spot|venue|bar|cafe|patio|brewery)\s+(?:was|is)\s+(?:great|amazing|awesome|nice|cool|good|cozy|solid|lovely))\b/;
const VENUE_DISLIKED_RX = /\b(?:(?:hated|terrible|awful|horrible|worst)\s+(?:the\s+)?(?:place|spot|venue|bar|cafe|restaurant)|(?:the\s+)?(?:place|spot|venue|bar|cafe|restaurant)\s+(?:was|is)\s+(?:terrible|awful|horrible|bad|rough|meh|not\s+great|wasn'?t\s+great))\b/;
const VENUE_MENTION_RX = /\b(?:went\s+to|checked\s+out|tried|met\s+at|loved|recommend)\s+([A-Z][A-Za-z0-9'&-]+(?:\s+[A-Z][A-Za-z0-9'&-]+){0,3})\b/;

export function venueFeedbackOf(body: string): VenueFeedbackExtracted {
  const t = body.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const venueClosed = VENUE_CLOSED_RX.test(t);
  const venueIssues: VenueIssue[] = [];
  for (const [rx, issue] of VENUE_ISSUE_RX) {
    if (rx.test(t)) venueIssues.push(issue);
  }
  const notInterested = VENUE_REJECT_RX.test(t);
  const disliked = venueClosed || venueIssues.length > 0 || notInterested || VENUE_DISLIKED_RX.test(t);
  const liked = !disliked && VENUE_LIKED_RX.test(t);
  const mentionsPlace = /\b(?:place|spot|venue|bar|cafe|coffee\s+shop|brewery|patio|food\s+hall|restaurant|park)\b/.test(t);
  const venueSentiment: VenueFeedbackExtracted["venueSentiment"] =
    disliked ? "disliked" : liked ? "liked" : mentionsPlace ? "neutral" : undefined;
  const mention = VENUE_MENTION_RX.exec(body)?.[1]?.trim();
  return {
    ...(venueSentiment ? { venueSentiment } : {}),
    venueClosed,
    venueIssues,
    notInterested,
    ...(mention ? { mentionedVenue: mention } : {}),
  };
}

/**
 * Sentiment of a feedback reply (for edges and reliability). Negations are checked first: "not
 * great", "wasn't great" and "didn't click" contain positive words but are bad meetings.
 */
export function feedbackOf(body: string): {
  sentiment: "positive" | "neutral" | "negative";
  selfNoShow: boolean;
  otherNoShow: boolean;
  again: boolean;
  venue: VenueFeedbackExtracted;
  venueClosed: boolean;
  venueIssues: VenueIssue[];
  notInterested: boolean;
  venueSentiment?: "liked" | "neutral" | "disliked";
} {
  const t = body.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const { self: selfNoShow, other: otherNoShow } = attendanceAbsences(t);
  const negative = otherNoShow || NEGATIVE_FEEDBACK.test(t);
  const positive = POSITIVE_FEEDBACK.test(t) || /^we hit it off[.!]*$/.test(t.trim());
  const sentiment = negative ? "negative" : positive ? "positive" : "neutral";
  const again = !negative && /again|clicked/.test(t) && !/\b(wouldn'?t|won'?t|not|never)\b[^.!?]*\bagain\b/.test(t);
  const venue = venueFeedbackOf(body);
  return {
    sentiment,
    selfNoShow,
    otherNoShow,
    again,
    venue,
    venueClosed: venue.venueClosed,
    venueIssues: venue.venueIssues,
    notInterested: venue.notInterested,
    ...(venue.venueSentiment ? { venueSentiment: venue.venueSentiment } : {}),
  };
}
const POSITIVE_FEEDBACK = /\b(?:great|clicked|loved|amazing|nice|easy to talk|had a blast|super fun|so fun|super chill|went well|went great|really enjoyed|good vibes|vibes? were (?:great|good|immaculate)|lowkey great|slapped|10\/10)\b|\b(?:it was|that was)\s+fire\b/;
const NEGATIVE_FEEDBACK = /\b((was|is|it's|that's)?\s*(not|n't|wasn't|isn't)\s+(that |very |really |so |too |super )?(great|good|fun|nice|amazing)|not much in common|nothing in common|didn't (really |quite )?(click|connect|enjoy|vibe)|didn't have much|not (really )?for me|not my (thing|type)|awkward|terrible|rude|creepy|bummer|uncomfortable|cringe|no chemistry|zero chemistry|(?:weird|bad|off) vibes?|felt off|super awkward|kind of boring|kinda mid|pretty mid|was mid)/;


// ------------------------------------------------------------------ consent: yes, no or unclear
// Founder rule: a member is booked or revealed only on a clear yes. The reply is read sentence by
// sentence, refusals first. A conditional ("sure, but only with a woman") or a hedge ("who is it?
// thursday maybe") is not a yes: the answer is "unclear" and the member is asked again
// (network-consent-1, -2). This parser lives here, not in the simulator, so the simulator never
// grades its own parser (sim-worlds-3).

export type YesNo = "yes" | "no" | "counter" | "unclear";
/** Why a reply reads as it does. "mixed": a refusal, then a yes ("no... ok fine yes"): ask again. */
export type ConsentWhy = "affirm" | "refusal" | "mixed" | "conditional" | "hedged" | "counter" | "slot" | "none";
export interface Consent { answer: YesNo; why: ConsentWhy }

/** A time word right after a refusal makes it a refusal of that time, not of the offer ("can't do Thursday"). */
const TIME_AHEAD = /^\s*(?:(?:do|make|on|at|for|the|that|this|until|till|before|after)\s+)*(?:(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?\b|first\b|second\b|third\b|last one\b|1st\b|2nd\b|3rd\b|option\b|\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b|mornings?\b|afternoons?\b|evenings?\b|nights?\b|weekends?\b|weekdays?\b|[abc]\b(?!\s+\w{3,}))/;
/** "No" as a refusal: alone, before punctuation, or before these words. "No heavy networking" is not a refusal. */
const NO_NEXT = "thanks|thank|thx|ty|gracias|sorry|lo siento|i|i'm|im|i'd|i've|i'll|way|can|cannot|can't|cant|not|nope|lol|lmao|haha|unfortunately|wait|actually|really|man|dude|for|to that|to this|this|that|sunday|monday|tuesday|wednesday|thursday|friday|saturday|we|you|it|just|nah|sir|ma'am|go|chance|interest|deal|puedo|quiero|voy|creo|me|por ahora|esta vez|hoy";
const REFUSAL_RX: RegExp[] = [
  new RegExp(`(?:^|[^\\w'])no+(?=\\s*$|\\s*[^\\w\\s']|\\s+(?:${NO_NEXT})\\b)`),
  /\b(?:that'?s a|it'?s a|gonna be a|answer is a?|hard) no\b/,
  /\bnope\b|\bnah+\b|\bnay\b|\bnel\b|\bno can do\b/,
  /\b(?:i'?ll|i will|gonna|going to|i'?m going to|i'?m gonna|i have to|i'?ve got to|i gotta|will have to|i'?d|i would|i think i'?ll|i shall|i must)\s+(?:have to\s+)?(?:pass|skip|sit (?:this|that|it) out|decline|sit this one out)\b/,
  /\b(?:hard |gonna |i )?pass\b(?!\s+(?:the|it|along|by|me|on (?:the|my)|through))/,
  /\bno time\b(?! pressure)/,
  /\bnot (?:interested|down|for me|this (?:time|week|weekend|one)|right now|now|today|tonight|really|up for (?:it|that|this)|feeling it|my (?:thing|scene|vibe|cup of tea)|a fan|happening|gonna happen|going to happen|keen|into (?:it|that|this)|a good (?:time|week|fit)|available|possible|able to|the right time|at the moment|anytime soon|in the mood)\b/,
  /\b(?:absolutely|definitely|certainly|probably|def|totally|hell|of course|surely|really|actually|sadly|unfortunately|regrettably) (?:not|no)\b/,
  /\b(?:claro|por supuesto|obvio|desde luego) que no\b/,
  /\b(?:(?:i'?m|i am)\s+)?afraid not\b|\bregrettably\b|\bi cannot attend\b|\bunable to attend\b|\bi (?:will not|won'?t) be able to\b/,
  /\b(?:i'?d |i would )?rather not\b/,
  /\b(?:don'?t|do not) think (?:i can|i could|i'?ll make it|i'?ll be able)\b/,
  /\b(?:don'?t|do not|doesn'?t) (?:think so|want to|wanna|feel like it|really want|have (?:time|the time|room|the bandwidth)|need)\b/,
  /\b(?:i'?m|im|i am) (?:not|no longer) (?:in|down|up for (?:it|that)|interested|free|available|keen|able|looking)\b/,
  /\b(?:i'?m|im|i am) (?:good|ok|okay|fine|all set|set)(?:,? (?:thanks?|thank you|ty|thx|tho|though|for now|for this|this time))?\s*$/,
  /\ball (?:good|set)(?:,? (?:thanks?|thank you|ty|thx|tho|though|for now|for this|this time))\s*$/,
  /\bcount me out\b|\b(?:i'?m|im) out\b|\bskip(?:ping)? (?:this|it|that)\b|\bi'?ll sit (?:this|that) one out\b/,
  /\b(?:not gonna|won'?t|can'?t|cannot|couldn'?t|not going to) make it\b/,
  /(?<!not )\btoo (?:busy|swamped|slammed|far|tired)\b/,
  /\b(?:maybe|perhaps|some|next) (?:other |another )?time\b(?!s)|^\s*(?:another|other) time\s*$/,
  /\b(?:no gracias|para nada|de ninguna manera|ni loc[oa]|ni hablar|mejor no|no puedo|no me interesa|no quiero|no voy|no creo|esta vez no|no podr(?:e|ia)|imposible|paso)\b/,
  /👎|🙅|❌/,
];
/** "Can't", "won't" and "busy" refuse the offer unless a time follows (then they refuse that time). "Can't wait" is a yes. */
const CANT = /\b(?:can'?t|cannot|can not|won'?t be able to|unable to|not able to|couldn'?t|won'?t)\b|(?:^\s*|\b(?:i'?m|im|i am|pretty|really|so|super|too|very|been|kinda)\s+)(?:busy|slammed|swamped|booked up)\b/g;
/** "Busy now, ask me later": a deferral, not a refusal of the offer. */
const DEFER = /\b(?:ask|text|message|ping|try) me (?:later|again|tomorrow|tmrw|tonight|in a bit)\b|\bget back to you\b|\btalk later\b|\btext later\b/;
const CANT_HARMLESS = /^\s*(?:wait|believe|say no|complain|go wrong|resist|beat|miss (?:it|this))/;
const AFFIRM_RX = /(?:^|[^\w'])(?:yes+|yess+|yeah+|yea|yah|yep|yup|yessir|aye|sure|sure thing|surely|ok+|okay+|okie|okey|kk?|alright|all right|aight|absolutely|definitely|def|of course|ofc|for sure|fs|fosho|bet|deal|perfect|great|awesome|amazing|certainly|indeed|by all means|i accept|(?:i(?:'d| would)|would) be delighted|delighted(?: to)?|splendid|gladly|with pleasure|yes sir|yes ma'?am|say less|lfg|lessgo|lesgo|love (?:to|that|it)|i'?d love|would love|i'?d like that|would like that|happy to|i(?:'d| would) be happy to|glad to|i(?:'d| would) be glad to|let'?s (?:do (?:it|this|that)|go)|lets (?:do it|go)|(?:i'?m|im|i am) (?:totally |so |definitely |all |fully )?in|count me in|sign me up|i'?m down|im down|i am down|down for (?:it|that|this)|down to\b|so down|totally down|i'?m game|im game|(?:i'?m |i am |i'?d be |i would be |would be )?up for (?:it|that|this)|works for me|that works|works|sounds (?:good|great|fun|lovely|perfect|wonderful|nice|like a plan|amazing|awesome)|why not|please do|go for it|go ahead|yes please|can do|i can (?:make it|do (?:it|that))|that'?d be (?:great|nice|fun|lovely|wonderful)|would be (?:great|nice|fun|wonderful)|count on me|can'?t wait|^\s*down\s*[!.]*\s*$|good with (?:that|it|me|this)|that'?s (?:good|great|fine|perfect)|fine by me|fine with me|si claro|claro que si|por supuesto que si|claro|dale|vale|orale|por supuesto|de acuerdo|me apunto|cuenta conmigo|me encantaria|con gusto|encantad[oa]|excelente|perfecto|genial|listo|hecho)(?![\w'])|(?<=^|[\s,.!])si(?= *(?:$|[.,!;]|claro|gracias|porfa|por favor|me apunto|dale|va|perfecto|pero))|💯|👍|🙌|✅|👌|🤝/;
/** A word just before a yes that negates it ("not ok", "never down", "don't love it"). "Not sure" is a hedge. */
const AFFIRM_NEG_BEFORE = /\b(?:not|never|don'?t|didn'?t|wouldn'?t|won'?t|isn'?t)\s+(?:\w+\s+)?$/;
const HEDGE_RX = /\b(?:maybe|perhaps|possibly|probably|might|could be|not sure|unsure|idk|i don'?t know|dunno|no idea|let me (?:check|think|see|get back|look)|i'?ll (?:check|think|see|let you know|get back)|who is (?:it|this|that|he|she|they)|who'?s (?:it|this|that)|what'?s (?:it|this) about|depends|kinda|sort of|i guess|we'?ll see|tbd|on the fence|torn|not certain|hard to say|remind me|need to check|have to check|tal vez|talvez|quizas|quiza|a lo mejor|no se|puede ser|depende|lo pienso|dejame (?:ver|pensar)|ya veremos|no estoy segur[oa])\b|^\s*\?+\s*$/;
const COND_RX = /\b(?:only if|only with|only when|only for|as long as|so long as|provided(?: that)?|unless|depends on|on (?:the )?condition|assuming|but only|if and only|as long|solo si|solo con|siempre que|siempre y cuando|con tal (?:de )?que|if (?:it'?s|its|it is|they|she|he|there|the|you|i|we|that|this|someone|nobody|no one|everyone|it|a|an|my|their|his|her))\b|(?:^|[\s,.!])si\s+(?!(?:claro|gracias|porfa|por favor|me apunto|dale|va|perfecto|pero)\b)[a-z]/;
const COUNTER_RX = /\b(?:different (?:day|time|week)|another (?:day|time|week)|next week|later (?:in the week|this month|on)|reschedule|instead|rain ?check|some other (?:day|time)|(?:can|could) we find (?:a different|another) (?:day|time)|how about|what about|later date|the week after|push it|otro dia|otra fecha|otra hora|mas adelante|la proxima|otra vez|la semana que viene|la proxima semana)\b/;
/** "No problem", "no worries", "no rush", "no plans", "no doubt": not refusals. */
const HARMLESS_NO = /\bno (?:problem|prob|probs|worries|worry|rush|pressure|biggie|doubt|plans?|stress|sweat|complaints|te preocupes)\b/g;
const POSITIVE_NO_YEAH = /\b(?:no|nah),?\s+yeah(?!\s*,?\s*(?:no|nah|nope)\b)\b/g;
const DOUBLE_NEG_MASK = new RegExp(SHARED_DOUBLE_NEGATIVE_RE.source, "g");

/** A counter is a separate scheduling request. A yes inside that request does not answer the offer. */
function consentScan(body: string): Consent & { separateYes?: boolean } {
  const withdrawal = readParticipationWithdrawal(body);
  if (withdrawal.reading === "DirectWithdrawal") return { answer: "no", why: "refusal" };
  if (directAgreementIdiom(withdrawal.text)) return { answer: "yes", why: "affirm" };
  const qualifiedWithdrawal = withdrawal.reading === "QualifiedWithdrawal";
  const t = normalizeReplyText(withdrawal.text)
    .replace(HARMLESS_NO, " ")
    .replace(POSITIVE_NO_YEAH, " yes ");
  const wordsIn = (t.match(/[a-z]+/g) ?? []).length;
  let refusalAt = Infinity, affirmAt = Infinity, counterAt = Infinity, cond = false, hedge = false, question = false;
  for (const s of sentencesOf(t)) {
    // A question of the member's own ("Anyone around who'd want to meet someone to date?") is not an
    // answer: a yes elsewhere in the message ("Honestly this is great timing") is not consent to the probe.
    if (/\?/.test(s.text) && !/\b(?:can|could) we\b|\b(?:how|what) about\b/.test(s.text)) question = true;
    const allGoodThanks = /\ball (?:good|set)(?:,? (?:thanks?|thank you|ty|thx|tho|though|for now|for this|this time))\b/.exec(s.text);
    if (allGoodThanks) refusalAt = Math.min(refusalAt, s.at + allGoodThanks.index);
    // Clauses inside a sentence: "yes, but only with a woman" keeps "only with" in its own clause.
    for (const c of s.text.matchAll(/[^,]+/g)) {
      let x = c[0];
      const at = s.at + c.index!;
      // Double negatives ("not not interested", "I wouldn't say no") are hedges, never hard refusals.
      if (SHARED_DOUBLE_NEGATIVE_RE.test(x)) {
        hedge = true;
        x = x.replace(DOUBLE_NEG_MASK, m => " ".repeat(m.length));
      }
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
      const am = am0 && !/[a-z]/.test(am0[0]) && (qualifiedWithdrawal || wordsIn > 3 || /\?/.test(t)) ? null : am0;
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
      const alternative = COUNTER_RX.exec(x);
      if (alternative) counterAt = Math.min(counterAt, at + alternative.index);
    }
  }
  if (refusalAt < Infinity) return affirmAt > refusalAt && affirmAt < Infinity ? { answer: "unclear", why: "mixed" } : { answer: "no", why: "refusal" };
  const shared = parseReply(body);
  if (cond || shared.reason === "conditional_yes" || /\b(?:pending (?:the|a|my|our|your) |contingent on |if [^,.!?]{1,45}\b(?:permits?|allows?)\b)/.test(t)) {
    return { answer: "unclear", why: "conditional" };
  }
  if (hedge || question) return { answer: "unclear", why: "hedged" };
  if (counterAt < Infinity) {
    const lead = t.slice(0, counterAt);
    const boundary = Math.max(lead.lastIndexOf(","), lead.lastIndexOf("."), lead.lastIndexOf("!"), lead.lastIndexOf(";"));
    const interest = /^(?:i'?m |i am )?interested[.!]?\s*$/.test(lead.slice(0, boundary));
    return { answer: "counter", why: "counter", separateYes: (affirmAt < boundary || interest) && shared.answer !== "no" };
  }
  // A yes needs the shared reader (core parseReply, AGENTS decision 11) not to read a refusal or a hedge:
  // when the two disagree the member is asked again, never booked. A reading that is unsure only because
  // it found no word it knows ("aight", "I'm game") or only about the time (this reader reads the time
  // options itself) is no veto.
  if (affirmAt < Infinity) {
    const veto = shared.answer === "no" || (shared.answer === "unsure" && !shared.counter && shared.reason !== "no_signal");
    return veto ? { answer: "unclear", why: "mixed" } : { answer: "yes", why: "affirm" };
  }
  return { answer: "unclear", why: qualifiedWithdrawal ? "hedged" : "none" };
}

/** Read a reply as yes, no, a counter-offer or unclear, refusal first and sentence by sentence. */
export function consentOf(body: string): Consent {
  const { answer, why } = consentScan(body);
  return { answer, why };
}

// Use the same refusal phrases when the complete reply could instead be a person’s name.
const COMPLETE_REFUSAL = new RegExp(`^(?:${REFUSAL_RX.map(rx => rx.source).join("|")}|(?:(?:i|we) )?(?:${CANT.source}))$`);
const REFUSAL_COURTESY_LEAD = /^(?:(?:sorry|please|thanks|thank you|ok(?:ay)?|yeah|yes|sure|actually)[\s,.!;:]+)+/;
const REFUSAL_COURTESY_TAIL = /(?:[\s,.!;:]+(?:please|pls|sorry|thanks|thank you))+$/;

export function isCompleteParticipationRefusal(body: string): boolean {
  if (readParticipationWithdrawal(body).reading === "DirectWithdrawal") return true;
  const whole = normText(body).replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
  const direct = whole.replace(REFUSAL_COURTESY_LEAD, "").replace(REFUSAL_COURTESY_TAIL, "");
  return COMPLETE_REFUSAL.test(whole) || COMPLETE_REFUSAL.test(direct);
}

/** A member's free-text yes or no (probes, plan probes, crew offers, the booked plan). */
export const parseYesNo = (body: string): YesNo => consentOf(body).answer;

/** One time option offered in a probe (SimMeta.timeOptions, the network-sim contract): keys "a", "b", "c"; label "Thursday 7pm". */
export type { TimeOption };

// Day names. A full name always counts; a short form ("sun", "sat", "wed", "mon") counts only in a
// day context (before a time, a daypart, "or", "and", a comma or the end), so "if the sun's out",
// "sat down" or "c'mon" never pick a day.
const DAY_NAMES = [
  ["Sunday", "sun|sundy|sundya"], ["Monday", "mon|mondy|mondya"], ["Tuesday", "tues?|tuesdy|teusday"], ["Wednesday", "weds?|wednesdy|wensday|wendsday"],
  ["Thursday", "thu|thur|thurs|thursdy|thrusday|thursay"], ["Friday", "fri|fridy|firday"], ["Saturday", "sat|satdy|satrday|saturdy"],
] as const;
const DAY_ABBR_CONTEXT = String.raw`(?=\.?(?:\s*(?:\d|@|at\b|after\b|around\b|before\b|from\b|or\b|and\b|too\b|&|\/|works?\b|`
  + String.raw`doesn'?t\b|does not\b|don'?t\b|do not\b|won'?t\b|will not\b|can'?t\b|cannot\b|wouldn'?t\b|would not\b|isn'?t\b|is not\b|aren'?t\b|are not\b|is bad\b|`
  + String.raw`is (?:good|fine|great|best|better)\b|morning|afternoon|evening|night|eve\b)|\s*[,;!?.]|\s*$))`;
const DAY_WORDS: [RegExp, string][] = DAY_NAMES.map(([label, abbreviation]) => [
  new RegExp(String.raw`\b${label.toLowerCase()}s?\b|(?<!')\b(?:${abbreviation})\b${DAY_ABBR_CONTEXT}`, "g"), label,
]);
const EXCEPT_SPAN_TOKEN = new RegExp(
  `(?:${DAY_WORDS.map(([re]) => re.source).join("|")}|\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\b|\\b(?:morning|afternoon|evening|night|weekend|weekday)s?\\b|\\b(?:and|or)\\b|,)`, "g");
const exceptSpanIsOnlyExcludedTimes = (span: string) =>
  span.replace(EXCEPT_SPAN_TOKEN, "").trim() === "";
const DAY_TOKEN = DAY_NAMES.map(([label, abbreviation]) => `${label.toLowerCase()}s?|${abbreviation}`).join("|");
const OFFERED_TIME_REJECTION = /\b(neither|none of (those|them|these|the times)|none (of those )?work|no(ne)? of those (times )?work|those (times )?(don'?t|do not|won'?t) work|can'?t do (those|either|any of)|not those times)\b/;
const BARE_GROUP_REJECTION = /\b(?:both|all) (?:days|times) (?:(?:don'?t|do not|won'?t|will not) work|(?:are|is) (?:out|bad|no good|unavailable))\b/;
const OTHER_TIMES = /\bother times?\b/;
const NO_OTHER_TIMES = /\b(?:no|not) other times?\b/g;
/** "Any of them", "whichever", "any time": every option. */
const ALL = /\b(any (of them|of those|works|is fine)|all (of them|work|three)|whichever|any ?time|all good)\b/;
/** "Either", "both": every option, unless the member names the ones they mean ("either Thursday or Sunday"). */
const ALL_WEAK = /\b(?:either|both)\b(?:\s+of\s+(?:them|(?:those|these)(?:\s+(?:times|options|slots))?)\b)?/g;
const REMAINDER_PHRASE = /\b(?:the\s+rest|everything\s+else|the\s+other(?:s| ones?| days?| options?| times?| slots?))\b/;
const REMAINDER_POSITIVE = /\b(?:works?|will work|fine|good|ok(?:ay)?|great|perfect|do|does)\b/;
const REMAINDER_NEGATED = /\b(?:don'?t|doesn'?t|do not|does not|isn'?t|aren'?t|not|never|can'?t|couldn'?t|won'?t|no)\b/;
const REMAINDER_UNAVAILABLE = /\b(?:busy|unavailable|booked(?:\s+up)?|taken|out|no\s+good|bad|tough|rough|packed|full)\b/;
const GENERAL_AVAILABILITY = /\bi'?m\s+(?:free|available|around|open)\b/;
const BOTH_TIME_LEAD = /^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?|please)\s+)?(?:(?:i|we)\s+can\s+(?:do|make)\s+)?both\b/;
const OFFERED_PAIR_AFFIRMATIVE = String.raw`(?:works?|will work|would work)(?:\s+for\s+(?:me|us))?|(?:are|would be)\s+(?:fine|good|great|okay)|please`;
const BOTH_TIME_TAIL = new RegExp(String.raw`^\s*(?:${OFFERED_PAIR_AFFIRMATIVE})?\s*$`);
const BOTH_TIME_QUALIFIER = /^\s+(?:(?:at|around|by|after|before)\s+\d{1,2}(?::[0-5]\d)?(?:\s*[ap]m)?|\d{1,2}(?::[0-5]\d)?\s*[ap]m|(?:(?:at|in the)\s+)?(?:noon|midnight|mornings?|afternoons?|evenings?|nights?|lunch|after work))\b/;
const NAMED_EXCLUSION_PHRASES = "other than|apart from|aside from|excluding|barring";
const NAMED_TIME_EXCLUSION = `except|${NAMED_EXCLUSION_PHRASES}`;
const BOTH_TIME_BOUNDARY = new RegExp(String.raw`[.,;!?\n]|\b(?:but|${NAMED_TIME_EXCLUSION})\b`);
const PROBE_DAY_LIST_WORD = String.raw`\b(?:${DAY_TOKEN})\b`;
const PROBE_DAY_LIST_LEAD = String.raw`(?:(?:either|both)\s+)?`;
const PROBE_DAY_LIST_DAYS = String.raw`${PROBE_DAY_LIST_WORD}(?:\s+(?:(?:and|or)\s+)?${PROBE_DAY_LIST_WORD})+`;
const PROBE_DAY_LIST_TOKEN = new RegExp(PROBE_DAY_LIST_WORD, "gu");
const ALTERNATIVE_PROBE_DAY_LIST = new RegExp(String.raw`^${PROBE_DAY_LIST_WORD}(?:\s+or\s+${PROBE_DAY_LIST_WORD})+$`);
const TRAILING_BOTH_DAY_PAIR = new RegExp(
  String.raw`(?:^|[.;!?\n])\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?|please)\s*,?\s+)?(?:(?:i|we)\s+can\s+(?:do|make)\s+)?`
    + String.raw`\b(?:${DAY_TOKEN})\b(?:\s*(?:,|&|\/)\s*|\s+(?:(?:and|or)\s+)?)\b(?<last>${DAY_TOKEN})\b\s+both\b`,
  "dgu",
);
const TRAILING_EITHER_DAY_PAIR = new RegExp(
  String.raw`(?:^|[.;!?\n])\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?|please)\s*,?\s+)?(?:(?:i|we)\s+can\s+(?:do|make)\s+)?`
    + String.raw`\b(?:${DAY_TOKEN})\b(?:\s*(?:,|&|\/)\s*|\s+(?:(?:and|or)\s+)?)\b(?<last>${DAY_TOKEN})\b\s+either\b`,
  "dgu",
);
const EXPLICIT_ALL = /^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s]+)?(?:any(?: of (?:them|these|those|the options|the offered times)| (?:option|slot|time))?|anytime|all(?: of (?:them|these|those)| three)?|either(?: one| option| time)?|both|whichever(?: option| time)?)(?: (?:is (?:fine|good)|works?|will work)(?: for me)?)?[.!\s]*$/;
const EXPLICIT_PAIR_ALL = /^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s]+)?(?:either|both) of (?:them|those|these)(?: (?:times|options|slots))?(?: (?:works?|will work)(?: for me)?)?[.!\s]*$/;
const EXPLICIT_KEY = /^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s]+)?([abc])(?: (?:works?(?: for me)?|is (?:fine|good|perfect)|for me|please))?[\s.!,)]*$/;
const EXPLICIT_KEY_LIST = /\b[abc]\b(?:\s*(?:,\s*(?:(?:or|and)\b)?|\b(?:or|and)\b|[&/])\s*(?:option\s+)?[abc]\b)+/g;
const EXPLICIT_KEY_CLAUSE = /(^\s*|[,;.!\n]\s*|\b(?:and|or)\s+)([abc])\s+(?:works?(?: for me)?|is (?:fine|good|perfect)|for me|please)\b/g;
const EXPLICIT_NO_OFFERED_TIMES = /^\s*none of (?:(?:those|these)(?: times| options)?|them|the (?:times|options)) works?(?: for me)?[.!\s]*$/;
// A day and clock label cannot establish consent to a relative or separately named date.
const UNBOUND_OFFER_DATE = /\b(?:today|tonight|tomorrow|tmr|yesterday)\b|\b(?:next|last|following)\s+(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b|\b\d{1,4}[-/]\d{1,2}(?:[-/]\d{1,4})?\b/;
const PROBE_DURATION = String.raw`(?:\d+|a|an|one|two|three|four|a few|a couple(?: of)?|half an?)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b`;
const RELATIVE_PROBE_DURATION = new RegExp(String.raw`\b(?:in|within)\s+${PROBE_DURATION}|\b${PROBE_DURATION}\s+from\b`);
const UNBOUND_PROBE_WINDOW = /\bthis\s+(?:morning|afternoon|evening|night)\b|\b(?:next|following)\s+(?:week|month|year)\b|\bafter next\b/;
const PROBE_DURATION_ONLY = new RegExp(String.raw`^\s*(?:(?:for\s+)?${PROBE_DURATION}\s+(?:works?|(?:will|would) work|is (?:fine|good|ok(?:ay)?|perfect))\b|(?:i )?can do\s+${PROBE_DURATION}\s*$)`);
const UNBOUND_OFFER_CLOCK = /\bat\s+\d{1,2}(?::[0-5]\d)?(?![\d:]|\s*[ap]m)\b/;
const UNBOUND_OFFER_CLOCK_GLOBAL = new RegExp(UNBOUND_OFFER_CLOCK.source, "g");
/**
 * A negation cue earlier in the same clause ("can't do Thursday or Saturday", "not Sunday", "busy
 * Thursday"). "No plans", "no problem", "not sure", "can't wait" and "don't mind" are not refusals.
 */
const NEG_CUE = /\b(not(?! sure)|can'?t(?! wait)|cannot|couldn'?t|won'?t|wouldn'?t|don'?t(?! mind)|doesn'?t|isn'?t|busy|unavailable|except|neither|nor|no(?! (plans?|problem|prob|worries|rush)\b)|nope|nah)\b/;
const NEG_AFTER_BASE = /^\s*(?:(?:one|option|time|slot)\b\s*)?(?:\d{1,2}(?::\d\d)?\s*(?:am|pm)\s*)?(?:(?:is|'s|are|would be|will be)\s+)?(?:out\b|bad\b|busy\b|full\b|packed\b|booked\b|taken\b|no good\b|not (?:good|great|ideal|possible|great)\b|tough\b|rough\b|a no\b|off\b|impossible\b|doesn'?t\b|does not\b|don'?t\b|do not\b|won'?t\b|will not\b|isn'?t\b|is not\b|can'?t\b|cannot\b)/;
/** A refusal right after the pick: "Thursday doesn't work", "Sunday is out", "the first one is bad". */
const NEG_AFTER = /^(?:\s*,?\s*neither\b(?:(?:\s+(?:really|just|simply|still|unfortunately|honestly|definitely|absolutely))?\s+(?:does|do|is|are|was|were|will|would|can|could|works?|either)\b(?:\s+for\s+(?:me|us)\b)?(?:\s+at\s+all\b)?(?:\s+either\b)?|(?:\s+(?:really|just|simply|still|unfortunately|honestly|definitely|absolutely)\b)?(?:\s+(?:for\s+(?:me|us)\b|at\s+all\b))?(?:\s+either\b)?(?:\s+too\b)?(?=\s*(?:$|[.,;!?]|\b(?:and|but|so|though|however|nor)\b)))|\s*(?:(?:one|option|time|slot)\b\s*)?(?:\d{1,2}(?::\d\d)?\s*(?:am|pm)\s*)?(?:(?:is|'s|are|would be|will be)\s+)?(?:out\b|bad\b|busy\b|full\b|packed\b|booked\b|taken\b|no good\b|not (?:good|great|ideal|possible|great)\b|tough\b|rough\b|a no\b|off\b|impossible\b|doesn'?t\b|does not\b|don'?t\b|do not\b|won'?t\b|will not\b|isn'?t\b|is not\b|can'?t\b|cannot\b))/;
/** A clause boundary: punctuation, "but", "though", "however". */
const CLAUSE_START = /[.,;!?]|\b(but|though|however|although|so)\b/g;
/** Words that make a named time a pick ("Saturday works", "free Sunday"), not just a mention ("Saturday I'm at a wedding"). */
const POSITIVE_PICK = /\b(works|work for (?:me|us)|does|good|fine|great|perfect|best|better|free|open|i can|let'?s|is ok|okay|please|for me|yes|yeah|sure)\b/;
/** True when the words at `i` (of length `len`) are refused: a negation cue earlier in their clause, or a refusal right after them. */
function negatedAt(t: string, i: number, len: number): boolean {
  let from = 0;
  for (const m of t.slice(0, i).matchAll(CLAUSE_START)) from = m.index! + m[0].length;
  return NEG_CUE.test(t.slice(from, i)) || refusalAfter(t, i, i + len);
}
/** The clause (between punctuation) around position i. */
function clauseAt(t: string, i: number, len: number): string {
  let from = 0;
  for (const m of t.slice(0, i).matchAll(/[.,;!?\n]|\bbut\b/g)) from = m.index! + m[0].length;
  const rest = t.slice(i + len);
  const end = rest.search(/[.,;!?\n]|\bbut\b/);
  return t.slice(from, end < 0 ? t.length : i + len + end);
}

function neitherFramed(t: string, at: number): boolean {
  if (!probeChoiceAuthored(t.slice(0, at))) return true;
  const clause = clauseAt(t, at, 0);
  return /\bif\b/.test(clause) || COND_RX.test(clause);
}

function refusalAfter(t: string, at: number, end: number): boolean {
  const tail = t.slice(end);
  if (NEG_AFTER_BASE.test(tail) || REFUSES_OFFERED_TIME_BASE.test(tail)) return true;
  return neitherQualifierRefusal(NEG_AFTER.test(tail), REFUSES_OFFERED_TIME.test(tail), !neitherFramed(t, at));
}

const CLOCK_MENTION = /\b(\d{1,2})(?::([0-5]\d))?\s*([ap]m)\b|\b(noon|midnight)\b/g;
const AFTER_CLOCK_MENTION = /\bafter\s+(\d{1,2})(?::([0-5]\d))?(?:\s*([ap]m))?\b/g;
const ISH_CLOCK_MENTION = /\b(?:around\s+)?(\d{1,2})(?::([0-5]\d))?\s*(?:([ap]m)\s*)?-?ish\b/g;
const PROBE_DAY_GROUP = /\b(?:weekdays?|weekends?|weeknights?|during the week)\b/g;
const RELATIVE_DAY_GROUP = /\b(?:next|last|following)\s+weekends?\b/;
const DAYPART_MENTION = /\b(mornings?|afternoons?|lunch|evenings?|nights?|after work)\b/g;
const NAMED_EXCLUSION_RANGE = "(?:any(?: other)? (?:day(?: of the week)?|time)|anytime|(?:any|every)thing(?: else)?|(?:all|every|each) (?:days?|times?)|all|whichever|whatever)";
const DAYPART_EXCLUSION = /\b(?:any|every|each)\s+(morning|afternoon|evening|night)s?\s+but\s+(?:(?:on|this|that)\s+)*/;
const NAMED_EXCLUSION = new RegExp(String.raw`\b(?:${NAMED_EXCLUSION_RANGE} but|${NAMED_TIME_EXCLUSION})\s+(?:(?:on|this|that)\s+)*$`);
const INCIDENTAL_CLOCK = /\b(?:after|before|until|till|by|around)\s*$|\b(?:work|shift)\s+(?:at\s+|(?:starts?|ends?)\s+at\s+)$/;
const CONNECTS_TIME = /^\s*(?:(?:at|on|in the)\s+)?$/;
type ProbeSpan = { at: number; end: number };
type TimeMention = ProbeSpan & {
  day?: string; minute?: number; afterMinute?: number; approxMinute?: number; part?: "morning" | "afternoon" | "evening";
  group?: "weekday" | "weekend"; nightsOnly?: boolean; dateKey?: string;
};

function flexibleClockMinute(hourRaw: number, minuteRaw: number, meridiem?: string): number | undefined {
  if (hourRaw > 23 || minuteRaw > 59) return undefined;
  if (meridiem) {
    if (hourRaw < 1 || hourRaw > 12) return undefined;
    return ((hourRaw % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + minuteRaw;
  }
  if (hourRaw >= 1 && hourRaw <= 11) return (hourRaw + 12) * 60 + minuteRaw;
  return hourRaw * 60 + minuteRaw;
}

function localDateKey(ts: number, tz: string, dayOffset = 0): string {
  const lp = localParts(ts, tz);
  const d = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + dayOffset));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

function spanContains(outer: ProbeSpan, inner: ProbeSpan): boolean {
  return outer.at <= inner.at && inner.end <= outer.end;
}

function directProbeDayLists(text: string): ProbeSpan[] {
  return [...text.matchAll(DIRECT_PROBE_DAY_LIST)].flatMap(match => {
    const [at, end] = match.indices!.groups!.days!;
    // A short form in a complete choice can be a weekday. The verb in “I sat Sunday” cannot.
    return probeChoiceAuthored(text.slice(0, at)) ? [{ at, end }] : [];
  });
}

function clockMinute(m: RegExpMatchArray): number {
  if (m[4]) return m[4] === "noon" ? 12 * 60 : 0;
  return ((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
}

function partOf(minute: number): TimeMention["part"] {
  return minute >= 5 * 60 && minute < 12 * 60 ? "morning" : minute >= 12 * 60 && minute < 17 * 60 ? "afternoon" : "evening";
}

function probeChoiceAuthored(prefix: string): boolean {
  return !quoteStillOpen(prefix) && reportStart(prefix.split(/[.!?\n]|\b(?:but|though|however)\b/).at(-1)!) < 0;
}

function authoredYes(text: string): boolean {
  const unquoted = [...text].map((ch, i) => (quoteStillOpen(text.slice(0, i)) ? (/[.!?\n]/.test(ch) ? ch : " ") : ch)).join("");
  const segments = unquoted.split(/([.!?\n]|\b(?:but|though|however)\b)/g);
  let own = "";
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!;
    const at = reportStart(segment);
    own += at < 0 ? segment : segment.slice(0, at) + " ".repeat(segment.length - at);
    if (i + 1 < segments.length) own += segments[i + 1]!;
  }
  return consentScan(own).answer === "yes";
}

const WHEN_CONDITIONAL = String.raw`(?:only\s+when(?:ever)?\b|when(?:ever)?(?=\s+(?!you(?:'re|\s+(?:want|prefer|can|like|are))\b|it\s+(?:suits|works)\b|works?\b)[a-z][a-z']*\s+[a-z]))`;
const CONDITIONAL_OPEN = new RegExp(`^(?:if|unless|provided(?:\\s+that)?|assuming(?:\\s+that)?|as\\s+long\\s+as|so\\s+long\\s+as|on\\s+(?:the\\s+)?condition(?:\\s+that)?|only\\s+if|${WHEN_CONDITIONAL})\\b`);
const CONDITIONAL_CUE = new RegExp(`\\b(?:if|unless|provided(?:\\s+that)?|assuming(?:\\s+that)?|as\\s+long\\s+as|so\\s+long\\s+as|on\\s+(?:the\\s+)?condition(?:\\s+that)?|only\\s+if|${WHEN_CONDITIONAL}|but\\s+only\\s+(?:if|when))\\b`);

/** A day named only inside a condition is not a confirmed pick yet. */
function inConditionalClause(text: string, at: number): boolean {
  let start = 0;
  for (const mark of [".", "!", "?", "\n"]) start = Math.max(start, text.lastIndexOf(mark, at - 1) + 1);
  let end = text.length;
  for (const mark of [".", "!", "?", "\n"]) { const i = text.indexOf(mark, at); if (i >= 0) end = Math.min(end, i); }
  const clauses = text.slice(start, end).split(/[,;]/);
  const offset = at - start;
  let pos = 0;
  let clauseIndex = -1;
  let clauseStart = 0;
  let leadingConditional = false;
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i]!;
    const trimmed = clause.replace(/^\s+/, "");
    if (i === 0 && CONDITIONAL_OPEN.test(trimmed)) leadingConditional = true;
    if (offset >= pos && offset < pos + clause.length) { clauseIndex = i; clauseStart = pos; }
    pos += clause.length + 1;
  }
  if (clauseIndex < 0) return false;
  const clause = clauses[clauseIndex]!;
  const trimmed = clause.replace(/^\s+/, "");
  if (CONDITIONAL_OPEN.test(trimmed)) return true;
  if (leadingConditional && clauseIndex > 0) return true;
  if (CONDITIONAL_CUE.test(clause.slice(offset - clauseStart))) return true;
  const next = clauses[clauseIndex + 1];
  if (next !== undefined && CONDITIONAL_OPEN.test(next.replace(/^\s+/, ""))) return true;
  return false;
}

const RECURRING_PROBE_TIME = new RegExp(
  String.raw`\b(?:${DAY_NAMES.map(([day]) => `${day.toLowerCase()}s`).join("|")}|weekends|weekdays|weeknights|mornings|afternoons|evenings|nights)\b`,
);

const PROBE_AVAILABILITY_SUBJECT = /\b([a-z][a-z'-]*)\s+(?:can|could|would|(?:is|are)\s+(?:free|available)|prefers?)\b/g;

function probeTimeIsRecurring(text: string, at: number, end: number): boolean {
  return RECURRING_PROBE_TIME.test(text.slice(at, end))
    || /\b(?:usually|normally|generally|typically|weekly|every (?:other )?week)\b/.test(clauseAt(text, at, end - at))
    || /\b(?:every|each|most)\s+$/.test(text.slice(0, at));
}


function timeMentions(text: string, recoverTrailingPair = false): TimeMention[] {
  const days: TimeMention[] = DAY_WORDS.flatMap(([rx, day]) => [...text.matchAll(rx)].map(m => ({ at: m.index!, end: m.index! + m[0].length, day })));
  if (recoverTrailingPair) {
    for (const trailingPair of [TRAILING_BOTH_DAY_PAIR, TRAILING_EITHER_DAY_PAIR]) for (const pair of text.matchAll(trailingPair)) {
      if (!probeChoiceAuthored(text.slice(0, pair.index + 1))) continue;
      const tail = text.slice(pair.index + pair[0].length);
      if (!BOTH_TIME_QUALIFIER.test(tail) && !BOTH_TIME_TAIL.test(tail.split(BOTH_TIME_BOUNDARY, 1)[0]!)) continue;
      const [at, end] = pair.indices!.groups!.last!;
      const day = DAY_WORDS.find(([rx]) => text.slice(at, end).search(rx) === 0)?.[1];
      if (day && !days.some(mention => mention.at === at)) days.push({ at, end, day });
    }
  }
  for (const m of text.matchAll(PROBE_DAY_GROUP)) {
    days.push({ at: m.index, end: m.index + m[0].length, group: m[0].startsWith("weekend") ? "weekend" : "weekday", nightsOnly: m[0].startsWith("weeknight") });
  }
  days.sort((a, b) => a.at - b.at);
  const times: TimeMention[] = [...text.matchAll(CLOCK_MENTION)].map(m => ({ at: m.index!, end: m.index! + m[0].length, minute: clockMinute(m) }));
  for (const m of text.matchAll(AFTER_CLOCK_MENTION)) {
    const at = m.index!, end = at + m[0].length;
    const afterMinute = flexibleClockMinute(Number(m[1]), Number(m[2] ?? 0), m[3]);
    if (afterMinute !== undefined) {
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i]!.at >= at && times[i]!.end <= end) times.splice(i, 1);
      }
      times.push({ at, end, afterMinute });
    }
  }
  for (const m of text.matchAll(ISH_CLOCK_MENTION)) {
    const at = m.index!, end = at + m[0].length;
    const approxMinute = flexibleClockMinute(Number(m[1]), Number(m[2] ?? 0), m[3]);
    if (approxMinute !== undefined) {
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i]!.at >= at && times[i]!.end <= end) times.splice(i, 1);
      }
      times.push({ at, end, approxMinute });
    }
  }
  for (const m of text.matchAll(DAYPART_MENTION)) {
    const part = /^morning/.test(m[0]) ? "morning" : /^(?:afternoon|lunch)/.test(m[0]) ? "afternoon" : "evening";
    if (m[0] === "after work" && /\b(?:free|off)\s*$/.test(text.slice(0, m.index))) continue;
    times.push({ at: m.index!, end: m.index! + m[0].length, part });
  }
  for (const t of times.sort((a, b) => a.at - b.at)) {
    const next = days.find(d => t.end <= d.at && CONNECTS_TIME.test(text.slice(t.end, d.at)));
    const previous = days.find(d => d.end <= t.at && CONNECTS_TIME.test(text.slice(d.end, t.at)));
    const d = previous ?? next;
    if (d) {
      days.splice(days.indexOf(d), 1);
      t.at = Math.min(d.at, t.at);
      t.end = Math.max(d.end, t.end);
      t.day = d.day;
      t.group = d.group;
      t.nightsOnly = d.nightsOnly;
    }
  }
  for (const m of [...days, ...times]) {
    const tail = /^\s+(?:ones|days|times|slots|options)\b/.exec(text.slice(m.end));
    if (tail) m.end += tail[0].length;
  }
  return [...days, ...times.filter(t => t.day || t.group || t.minute === undefined || !INCIDENTAL_CLOCK.test(text.slice(0, t.at)))];
}

/** Recognize a complete time expression without treating it as acceptance. */
export function isNamedProbeTime(text: string): boolean {
  const normalized = normText(text).trim();
  return timeMentions(normalized).some(mention => mention.at === 0 && mention.end === normalized.length);
}

const NAMED_TIME_JOIN = String.raw`\s*(?:(?:,|&|\/)\s*(?:(?:and|or)\b\s*)?|(?:and|or)\b\s+)`;
const BARE_NAMED_TIME_JOIN = new RegExp(`^${NAMED_TIME_JOIN}$`);
const SHORT_DAY_TOKEN = DAY_NAMES.map(([, abbreviation]) => abbreviation).join("|");
const JOINED_SHORT_DAY = new RegExp(String.raw`^(${NAMED_TIME_JOIN})(${SHORT_DAY_TOKEN})\b`);
const SCHEDULING_CONSTRAINT = String.raw`(?:my|our|the) (?:schedule|calendar|availability)`;
const OFFERED_TIME_REFUSAL_DETAIL = String.raw`(?:for (?:me|us)|(?:in|with) ${SCHEDULING_CONSTRAINT}|on (?:my|our) end|either|at all|at the moment|right now|anymore|unfortunately|this (?:weekend|week))`;
const OFFERED_TIME_REFUSAL_END = String.raw`(?=(?:\s+${OFFERED_TIME_REFUSAL_DETAIL}\b)*\s*(?:$|[,;.!?\n]|\b(?:and|but|so|though|however|because|since|due to)\b))`;
const REFUSAL_ADVERB = String.raw`(?:(?:really|just|simply|still|unfortunately|honestly|definitely|absolutely)\s+)?`;
const OFFERED_TIME_REFUSAL_QUALIFIER = String.raw`${REFUSAL_ADVERB}for\s+(?:me|us)\s+${REFUSAL_ADVERB}`;
const OFFERED_TIME_REJECTION_STATE = String.raw`good|great|fine|free|available|possible|ideal|an option|a good fit`;
const OFFERED_TIME_REFUSAL =
  String.raw`\s*(?:(?:both|all)\s+)?(?:${OFFERED_TIME_REFUSAL_QUALIFIER}|${REFUSAL_ADVERB})(?:(?:(?:is|'s|are|would be|will be)\s+)?(?:(?:both|all)\s+)?(?:out(?: of town)?|bad|busy|unavailable|full|packed|booked|taken|no good|not (?:good|great|ideal|possible|free|available)|tough|rough|a no|off|impossible)\b|` +
  String.raw`(?:doesn'?t|does not|don'?t|do not|won'?t|will not|can'?t|cannot|wouldn'?t|would not)\b(?:\s+(?:really\s+)?(?:work(?: out)?|(?:fit|suit)(?: ${SCHEDULING_CONSTRAINT})?|make it|(?:look|seem)\s+(?:${OFFERED_TIME_REJECTION_STATE})))?|` +
  String.raw`(?:isn'?t|aren'?t|is not|are not)\s+(?:really\s+)?(?:${OFFERED_TIME_REJECTION_STATE}|going to work)\b|` +
  String.raw`(?:,?\s*neither\b(?:(?:\s+(?:really|just|simply|still|unfortunately|honestly|definitely|absolutely))?\s+(?:does|do|is|are|was|were|will|would|can|could|works?|either)\b(?:\s+for\s+(?:me|us)\b)?(?:\s+at\s+all\b)?(?:\s+either\b)?|(?:\s+(?:really|just|simply|still|unfortunately|honestly|definitely|absolutely)\b)?(?:\s+(?:for\s+(?:me|us)\b|at\s+all\b))?(?:\s+either\b)?(?:\s+too\b)?(?=\s*(?:$|[.,;!?]|\b(?:and|but|so|though|however|nor)\b)))))` + OFFERED_TIME_REFUSAL_END;
const REFUSES_OFFERED_TIME = new RegExp(`^${OFFERED_TIME_REFUSAL}`);
const DIRECT_PROBE_DAY_LIST = new RegExp(
  String.raw`(?:^|[.,;!?\n])\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?|please)\s*,?\s+)?${PROBE_DAY_LIST_LEAD}(?:(?:i|we)\s+can\s+(?:do|make)\s+)?${PROBE_DAY_LIST_LEAD}`
    + String.raw`(?<days>${PROBE_DAY_LIST_DAYS})`
    + String.raw`(?=(?:(?:\s+(?:both|either)\b)?(?:\s+(?:${OFFERED_PAIR_AFFIRMATIVE}))?\s*(?:$|${BOTH_TIME_BOUNDARY.source})|(?<=(?:either|both)\s+${PROBE_DAY_LIST_DAYS})(?:\s+(?:both|either)\b)?${OFFERED_TIME_REFUSAL}))`,
  "dgu",
);
const OFFERED_TIME_REFUSAL_BASE =
  String.raw`\s*(?:(?:both|all)\s+)?(?:${OFFERED_TIME_REFUSAL_QUALIFIER}|${REFUSAL_ADVERB})(?:(?:(?:is|'s|are|would be|will be)\s+)?(?:(?:both|all)\s+)?(?:out(?: of town)?|bad|busy|unavailable|full|packed|booked|taken|no good|not (?:good|great|ideal|possible|free|available)|tough|rough|a no|off|impossible)\b|` +
  String.raw`(?:doesn'?t|does not|don'?t|do not|won'?t|will not|can'?t|cannot|wouldn'?t|would not)\b(?:\s+(?:really\s+)?(?:work(?: out)?|(?:fit|suit)(?: ${SCHEDULING_CONSTRAINT})?|make it|(?:look|seem)\s+(?:${OFFERED_TIME_REJECTION_STATE})))?|` +
  String.raw`(?:isn'?t|aren'?t|is not|are not)\s+(?:really\s+)?(?:${OFFERED_TIME_REJECTION_STATE}|going to work)\b)` + OFFERED_TIME_REFUSAL_END;
const REFUSES_OFFERED_TIME_BASE = new RegExp(`^${OFFERED_TIME_REFUSAL_BASE}`);
const QUALIFIED_TIME_REFUSAL = new RegExp(String.raw`^\s*(?:(?:both|all)\s+)?${OFFERED_TIME_REFUSAL_QUALIFIER}`);
const DIRECT_SHORT_DAY_REFUSAL = new RegExp(
  String.raw`(?:^|[.,;!?\n])\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)\s+)?(?<day>${SHORT_DAY_TOKEN})\b(?=\s+${OFFERED_TIME_REFUSAL_QUALIFIER})(?=${OFFERED_TIME_REFUSAL})`,
  "dgu",
);
const RESTATED_CLOCK_PART = new RegExp(String.raw`^(?:morning|afternoon|evening|night)(?:\s+(?:on\s+)?(?:${DAY_TOKEN}))?$`);

function probeTimeIsRefused(text: string, at: number, end: number): boolean {
  return negatedAt(text, at, end - at);
}

function completeProbeTimeMentions(text: string, recoverTrailingPair: boolean, memberChoiceAt: (at: number) => boolean, dayLists: readonly ProbeSpan[]): TimeMention[] {
  const mentions = timeMentions(text, recoverTrailingPair);
  for (const list of dayLists) for (const token of text.slice(list.at, list.end).matchAll(PROBE_DAY_LIST_TOKEN)) {
    const at = list.at + token.index, end = at + token[0].length;
    if (mentions.some(mention => mention.at <= at && end <= mention.end)) continue;
    const day = DAY_WORDS.find(([word]) => token[0].search(word) === 0)?.[1];
    if (day) mentions.push({ at, end, day });
  }
  // A matching restatement keeps the exact clock and can supply its trailing day.
  for (const clock of mentions.filter(mention => mention.minute !== undefined)) {
    const alias = mentions.find(part => !part.group && part.minute === undefined && part.part === partOf(clock.minute!)
      && (!part.day || !clock.day || part.day === clock.day)
      && RESTATED_CLOCK_PART.test(text.slice(part.at, part.end))
      && /^\s+in the\s+$/.test(text.slice(clock.end, part.at)));
    if (!alias) continue;
    clock.day ??= alias.day;
    clock.end = alias.end;
    mentions.splice(mentions.indexOf(alias), 1);
  }
  // Recover a short day only at the start of a direct refusal or after a named time and a bare join.
  const byStart = new Set(mentions.map(mention => mention.at));
  const recover = (at: number, end: number) => {
    if (byStart.has(at) || !memberChoiceAt(at) || !probeChoiceAuthored(text.slice(0, at))) return;
    const token = text.slice(at, end);
    const day = DAY_WORDS.find(([word]) => token.search(word) === 0)?.[1];
    if (day) { mentions.push({ at, end, day }); byStart.add(at); }
  };
  for (const match of text.matchAll(DIRECT_SHORT_DAY_REFUSAL)) {
    const [at, end] = match.indices!.groups!.day!;
    recover(at, end);
  }
  for (const mention of [...mentions]) {
    const tail = JOINED_SHORT_DAY.exec(text.slice(mention.end));
    if (!tail) continue;
    const end = mention.end + tail[0].length;
    if (refusalAfter(text, mention.end + tail[1]!.length, end)) recover(mention.end + tail[1]!.length, end);
  }
  return mentions;
}

/** An independent choice word between complete mentions ends the shared refusal. */
function joinedProbeRefusals(text: string, mentions: readonly ProbeSpan[], memberChoiceAt: (at: number) => boolean): Set<ProbeSpan> {
  const ordered = [...mentions].sort((a, b) => a.at - b.at);
  const refused = new Set<ProbeSpan>();
  for (let index = ordered.length - 2; index >= 0; index--) {
    const first = ordered[index]!, next = ordered[index + 1]!;
    if (first.end > next.at || !BARE_NAMED_TIME_JOIN.test(text.slice(first.end, next.at))
      || !memberChoiceAt(first.at) || !memberChoiceAt(next.at)) continue;
    if (refused.has(next) || refusalAfter(text, next.at, next.end)) {
      refused.add(first);
      refused.add(next);
    }
  }
  return refused;
}

const probeOrdinal = (w: string) => new RegExp(`\\bthe (?:${w})\\b|\\b(?:${w}) (?:one|option|time|slot)\\b|^\\W*(?:${w})\\W*$`, "g");
const PROBE_ORDINALS: [RegExp, number][] = [
  [probeOrdinal("first|1st|earlier|earliest"), 0], [/(?<![\d:]|\bat\s)\b1\b(?!\s*(am|pm|:|\d|of|more|person|hour|min))/g, 0],
  [probeOrdinal("second|2nd|middle"), 1], [/(?<![\d:]|\bat\s)\b2\b(?!\s*(am|pm|:|\d|of|more|people|person|hours?|mins?))/g, 1],
  [probeOrdinal("third|3rd"), 2], [/(?<![\d:]|\bat\s)\b3\b(?!\s*(am|pm|:|\d|of|more|people|hours?|mins?))/g, 2], [/\b(?:(?:later|latest)\s+(?:one|option|time|slot)|last\s+(?:one|option|slot))\b/g, -1],
];

const ORDINAL_POSITION: Readonly<Record<string, number>> = {
  first: 0, "1st": 0, earlier: 0, earliest: 0,
  second: 1, "2nd": 1, middle: 1,
  third: 2, "3rd": 2, fourth: 3, "4th": 3, last: -1, latest: -1,
};
const ORDINAL_WORD = String.raw`(?:${Object.keys(ORDINAL_POSITION).join("|")})\b`;
const ORDINAL_SUFFIX = /^\s+(?:one|option|time|slot)\b/;
const ORDINAL_ITEM = String.raw`(?:the\s+)?(?:${ORDINAL_WORD}(?:\s+(?:one|option|time|slot)\b)?|later\s+(?:one|option|time|slot)\b)`;
const ORDINAL_JOIN = String.raw`(?:\s*(?:,\s*(?:and\s+|or\s+)?|\band\b|\bor\b|&|\/)\s*|\s+)`;
const ORDINAL_AFFIRMATIVE = String.raw`\s+(?:either\s+)?(?:works?|will work|(?:is|are) (?:good|fine|great|perfect)|please)(?:\s+for (?:me|us))?(?=\s*(?:$|[.,;!]))`;
const DIRECT_ORDINAL = new RegExp(
  String.raw`(?:^|[.,;!]\s*|\bbut\s+)\s*(?<items>${ORDINAL_ITEM}(?:${ORDINAL_JOIN}${ORDINAL_ITEM})*)(?:(?<affirmative>${ORDINAL_AFFIRMATIVE})|(?=${OFFERED_TIME_REFUSAL}))`,
  "dg",
);
const BARE_LAST = /^\s*(?:the\s+)?(?:last|latest)(?:\s+(?:one|option|slot))?[.!,\s]*$/;
const VAGUE_ORDINAL_TIME = /^\s*(?:the\s+)?(?:later|last time)\s+(?:works?|will work|is (?:good|fine))\s*[.!]*$/;

type OrdinalMention = ProbeSpan & { index: number; choiceEnd?: number };

const ORDINAL_AFFIRM_WORD_RX = new RegExp(`${ORDINAL_WORD}|\\blater(?=\\s+(?:one|option|time|slot)\\b)`, "g");
const ORDINAL_ITEM_GLOBAL_RX = new RegExp(ORDINAL_ITEM, "g");
const ORDINAL_WORD_OR_LATER_RX = new RegExp(`${ORDINAL_WORD}|\\blater\\b`);

function readDirectProbeOrdinals(text: string, memberChoiceAt?: (at: number) => boolean) {
  const choices: number[][] = BARE_LAST.test(text) ? [[-1]] : [];
  const refusals: OrdinalMention[] = [];
  for (const item of text.matchAll(DIRECT_ORDINAL)) {
    if (quoteStillOpen(text.slice(0, item.index)) || memberChoiceAt?.(item.index + 1) === false) continue;
    const items = item.groups!.items!;
    if (item.groups!.affirmative) {
      choices.push([...items.matchAll(ORDINAL_AFFIRM_WORD_RX)].map(word => word[0] === "later" ? -1 : ORDINAL_POSITION[word[0]]!));
    } else {
      const [start] = item.indices!.groups!.items!;
      for (const word of items.matchAll(ORDINAL_ITEM_GLOBAL_RX)) {
        const at = start + word.index;
        const matched = word[0].match(ORDINAL_WORD_OR_LATER_RX)![0];
        const index = matched === "later" ? -1 : ORDINAL_POSITION[matched]!;
        refusals.push({ at, end: at + word[0].length, index });
      }
    }
  }
  return { choices, refusals };
}

function completeProbeOrdinals(text: string, refusals: readonly OrdinalMention[]): OrdinalMention[] {
  const ordinals = [...refusals];
  for (const [rule, index] of PROBE_ORDINALS) for (const m of text.matchAll(rule)) {
    const at = m.index, end = at + m[0].length;
    if (refusals.some(span => span.at <= at && end <= span.end)) continue;
    const suffix = ORDINAL_SUFFIX.exec(text.slice(end));
    ordinals.push({ at, end: end + (suffix?.[0].length ?? 0), index, choiceEnd: end });
  }
  return ordinals;
}

const PAST_PROBE_CUE = /\b(?:was|were|wasn't|weren't|went|came|met|enjoyed|loved|ago)\b/;
const PAST_RELATIVE_TIME = /\b(?:yesterday|last\s+(?:week|month|year|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))\b/;
const PROBE_TIME_LABEL = /\boption\s+[abc]\b|^\s*[abc]\s+(?:was|were)\b|\bweekends?\b|\b(?:mon|tues?|weds?|thu|thur|thurs|fri|sat|sun)\s+(?:was|were)\b/;

const PROBE_CLAUSE_BOUNDARY = /([.,;!?\n]|\b(?:but|though|however)\b)/;
const CURRENT_PROBE_CHOICE = /^\s+(?:works?|(?:will|would) work|(?:is|would be) (?:good|fine|great|best))(?: for me)?(?: (?:please|thanks))?\s*$/;
const CURRENT_PROBE_REFUSAL = /^(?:no(?: (?:thanks|thank you))?|(?:neither|none of (?:those|these|them)(?: times| options)?) works?(?: for me)?)$/;
const DIRECT_MEETING_REFUSAL = new RegExp(
  String.raw`^(?:i|we)\s+(?:(?:don't|do not)\s+(?:want to|wanna)\s+meet(?:\s+(?:them|him|her|this person|that person))?|`
    + String.raw`(?:can't|cannot|won't|will not|couldn't)\s+(?:make it|come|attend))$`,
);
const EXPLICIT_ALTERNATIVE_RANGE = /(?:^|[.,;!]\s*)\s*(?:any day|any ?time|anything|everything|all|whichever)\s+(?:but|except|other than|apart from|aside from|excluding|barring)\b/;
const CLARIFIED_ALTERNATIVE_RANGE = new RegExp(
  String.raw`^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s]+)?(?:${NAMED_EXCLUSION_RANGE}|(?:any|every|each) (?:morning|afternoon|evening|night)s?)\s+(?:but|${NAMED_TIME_EXCLUSION})\s+(?:(?:on|this|that)\s+)*$`,
);

function isIndependentProbeAnswer(clause: string): boolean {
  return CURRENT_PROBE_REFUSAL.test(clause.trim()) || readDirectProbeOrdinals(clause).choices.length > 0 || timeMentions(clause).some(mention =>
    !clause.slice(0, mention.at).trim() && CURRENT_PROBE_CHOICE.test(clause.slice(mention.end)));
}

function hasDetachedProbeRefusal(text: string): boolean {
  return sentencesOf(text).some(({ text: sentence, at }) => {
    const direct = sentence.trim().replace(/[.!;]+$/, "").trim();
    if (/^["']/.test(direct) || /\bif\b|\?/.test(direct) || COND_RX.test(direct)
      || !probeChoiceAuthored(text.slice(0, at)) || describesAnotherPerson(direct)) return false;
    return CURRENT_PROBE_REFUSAL.test(direct) || isCompleteParticipationRefusal(direct) || DIRECT_MEETING_REFUSAL.test(direct);
  });
}

function separatePastProbeTimes(text: string): { current: string; past: boolean } {
  const clauses = text.split(PROBE_CLAUSE_BOUNDARY);
  const current: string[] = [];
  let past = false;
  for (let i = 0; i < clauses.length; i += 2) {
    const clause = clauses[i]!;
    const relativePast = PAST_RELATIVE_TIME.test(clause);
    const describesPast = relativePast || PAST_PROBE_CUE.test(clause);
    const mentionsTime = describesPast && (relativePast || PROBE_TIME_LABEL.test(clause)
      || timeMentions(clause).length > 0 || PROBE_ORDINALS.some(([re]) => clause.search(re) >= 0));
    if (historicalProbeTimeClause(describesPast, mentionsTime)) {
      past = true;
      if (clauses[i + 1] !== "?") {
        const conjoined = clause.split(/\s+and\s+/);
        if (conjoined.length > 1) for (const part of conjoined) {
          if (isIndependentProbeAnswer(part)) current.push(part + ".");
        }
      }
    } else if (clause.trim()) current.push(clause + (clauses[i + 1] ?? ""));
  }
  return { current: past ? current.join(" ").trim() : text, past };
}

function hasUnboundProbeTime(text: string): boolean {
  return UNBOUND_OFFER_DATE.test(text) || RELATIVE_DAY_GROUP.test(text) || UNBOUND_PROBE_WINDOW.test(text) || RELATIVE_PROBE_DURATION.test(text) || PROBE_DURATION_ONLY.test(text);
}

function separateUnboundProbeTimes(text: string): { current: string; unbound: boolean } {
  const clauses = text.split(PROBE_CLAUSE_BOUNDARY);
  const current: string[] = [];
  let unbound = false, carryDate = false;
  for (let i = 0; i < clauses.length; i += 2) {
    const clause = clauses[i]!, punctuation = clauses[i + 1];
    const parts = clause.split(/\s+and\s+/);
    const qualified = parts.findIndex(hasUnboundProbeTime);
    if (qualified !== -1) {
      unbound = true;
      if (punctuation !== "?") for (const part of parts.slice(0, qualified)) {
        if (isIndependentProbeAnswer(part)) current.push(`${part}.`);
      }
      carryDate = punctuation === "," || punctuation === ";";
      continue;
    }
    const mentions = carryDate ? timeMentions(clause) : [];
    // A clock or part of the day after a comma can continue the unbound date.
    if (clause.trim() && !(mentions.length && mentions.every(mention => !mention.day && !mention.group))) {
      current.push(clause + (punctuation ?? ""));
    }
    carryDate = false;
  }
  return { current: unbound ? current.join(" ").trim() : text, unbound };
}

function remainderAffirmed(t: string): boolean {
  if (GENERAL_AVAILABILITY.test(t) && !remainderRefused(t)) return true;
  const phrase = REMAINDER_PHRASE.exec(t);
  if (!phrase) return false;
  const tail = t.slice(phrase.index + phrase[0].length).split(/[.!?;\n]/, 1)[0]!;
  const positive = REMAINDER_POSITIVE.exec(tail);
  if (!positive) return false;
  const negated = REMAINDER_NEGATED.exec(tail);
  return !negated || negated.index > positive.index;
}

function remainderRefused(t: string): boolean {
  const phrase = REMAINDER_PHRASE.exec(t);
  if (!phrase) return false;
  const tail = t.slice(phrase.index + phrase[0].length).split(/[.!?;\n]/, 1)[0]!;
  const positive = REMAINDER_POSITIVE.exec(tail);
  const negated = REMAINDER_NEGATED.exec(tail);
  if (negated && (!positive || negated.index <= positive.index)) return true;
  const unavailable = REMAINDER_UNAVAILABLE.exec(tail);
  return !!unavailable && (!positive || unavailable.index < positive.index);
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
interface ProbeReply {
  answer: "yes" | "no" | "unclear";
  keys: string[];
  why: ConsentWhy;
  explicitTimeSelection?: true;
}

const OFFERED_TIME_REJECTION_GLOBAL = new RegExp(OFFERED_TIME_REJECTION.source, "g");
const FOLLOWED_BY_DAY_TOKEN_RX = new RegExp(`^\\s+(?:(?:and|or)\\s+)?(?:${DAY_TOKEN})\\b`);
const COUNTER_TIME_INTEREST_RX = /\b(?:interested|down|up for|love to|would like|sounds (?:good|great|fun)|yes|yeah|yep|sure|i'?m in|count me in)\b/i;
const COUNTER_TIME_ALT_RX = /\b(?:next week|different (?:day|time|evening|weekend)|another (?:day|time|evening|weekend)|how about|what about|could we do|can we do|instead|better for me|works? better|other times?)\b/i;

/** True when a probe reply expresses interest while proposing an alternative day/time not among the offered slots. */
export function isProbeCounterTime(body: string, options: readonly TimeOption[] = []): boolean {
  const t = normText(body);
  if (!t || !COUNTER_TIME_ALT_RX.test(t)) return false;
  const parsed = parseProbeReply(body, options);
  if (parsed.answer === "yes" && parsed.keys.length > 0) return false;
  return COUNTER_TIME_INTEREST_RX.test(t) || parsed.why === "slot" || parsed.answer === "unclear";
}

export function parseProbeReply(
  body: string,
  options: readonly TimeOption[] = [],
  mode: boolean | "clarified" = false,
  ctx?: { now?: number; tz?: string },
): ProbeReply {
  const explicitTimesOnly = mode !== false;
  const clarifiedTimes = mode === "clarified";
  const normalized = normText(body);
  const tz = ctx?.tz ?? "America/New_York";
  const resolveRelative = ctx?.now !== undefined && options.some(o => typeof o.start === "number");
  const relativeRewritten = (() => {
    if (!resolveRelative) return { text: normalized, dateByDay: undefined as Map<string, string> | undefined };
    const lp = localParts(ctx!.now!, tz);
    const todayIdx = (lp.weekday + 1) % 7;
    const tomorrowIdx = (todayIdx + 1) % 7;
    const todayName = DAY_NAMES[todayIdx]![0].toLowerCase();
    const tomorrowName = DAY_NAMES[tomorrowIdx]![0].toLowerCase();
    const dateByDay = new Map<string, string>();
    let text = normalized;
    if (/\btonight\b/.test(text)) {
      dateByDay.set(DAY_NAMES[todayIdx]![0], localDateKey(ctx!.now!, tz, 0));
      text = text.replace(/\btonight\b/g, `${todayName} evening`);
    }
    if (/\btoday\b/.test(text)) {
      dateByDay.set(DAY_NAMES[todayIdx]![0], localDateKey(ctx!.now!, tz, 0));
      text = text.replace(/\btoday\b/g, todayName);
    }
    if (/\b(?:tomorrow|tmrw|tmr)\b/.test(text)) {
      dateByDay.set(DAY_NAMES[tomorrowIdx]![0], localDateKey(ctx!.now!, tz, 1));
      text = text.replace(/\b(?:tomorrow|tmrw|tmr)\b/g, tomorrowName);
    }
    return { text, dateByDay: dateByDay.size ? dateByDay : undefined };
  })();
  const workingNormalized = relativeRewritten.text;
  const historic = options.length ? separatePastProbeTimes(workingNormalized) : { current: workingNormalized, past: false };
  const { past } = historic;
  const { current: t, unbound } = separateUnboundProbeTimes(historic.current);
  const original = consentScan(body);
  const scoped = (past || unbound && original.answer !== "counter") && original.why !== "conditional" && original.why !== "hedged";
  let c = scoped ? consentScan(t) : original;
  if (past && c.answer !== "no" && normalized.split(PROBE_CLAUSE_BOUNDARY).some(clause => /^\s*if\b/.test(clause))) {
    return { answer: "unclear", keys: [], why: "conditional" };
  }
  const rejectedTimes = [...t.matchAll(OFFERED_TIME_REJECTION_GLOBAL)].some(m => !neitherFramed(t, m.index));
  const bareGroupRejection = BARE_GROUP_REJECTION.test(t);
  // spec/probeReply.md, "An untimed probe needs an answer to the opportunity"
  const untimedOrdinals = options.length ? undefined : readDirectProbeOrdinals(t);
  const namedTimeWithoutOffer = !options.length && (timeMentions(t).length > 0 || !!untimedOrdinals?.choices.length
    || !!untimedOrdinals?.refusals.length || VAGUE_ORDINAL_TIME.test(t));
  if (untimedProbeTimeRejectionNeedsClarification(options.length > 0, rejectedTimes || bareGroupRejection || namedTimeWithoutOffer, c.why === "affirm" || c.why === "none")) {
    return { answer: "unclear", keys: [], why: "slot" };
  }
  if (!options.length && unboundProbeTimeNeedsClarification(unbound, false) && c.answer !== "no" && c.why !== "conditional" && c.why !== "hedged") {
    return { answer: "unclear", keys: [], why: "slot" };
  }
  if (!options.length || c.answer === "counter") {
    // spec/probeReply.md, "A suggested alternative needs a separate yes before asking for new times"
    const yes = c.answer === "yes" || !explicitTimesOnly && c.answer === "counter" && mayRetryCounter(options.length > 0, c.separateYes === true);
    return { answer: c.answer === "no" ? "no" : yes ? "yes" : "unclear", keys: [], why: c.why };
  }
  if (VAGUE_ORDINAL_TIME.test(t)) return { answer: "unclear", keys: [], why: "slot" };
  const all = options.map(o => o.key);
  // Every mention of an option, as a pick or a refusal. A key both picked and refused counts as picked.
  const pos = new Set<string>(), neg = new Set<string>(), strong = new Set<string>();
  const individual = new Set<string>(), grouped = new Set<string>();
  const pickedClauses = new Set<string>(), refusedClauses = new Set<string>();
  const qualifiedTimeRefusals = new Map<number, [number, readonly string[], boolean]>();
  const refusedTails = new Map<number, [number, string[]]>();
  let conditionalTimeRefusal = false;
  const memberChoiceAt = (at: number) => {
    const prefix = t.slice(0, at);
    if (!clarifiedTimes) return probeChoiceAuthored(prefix);
    const subject = [...prefix.split(/[.!?\n]/).at(-1)!.matchAll(PROBE_AVAILABILITY_SUBJECT)].at(-1)?.[1];
    return probeChoiceAuthored(prefix) && (subject === undefined || /^(?:i|we|it|this|that)$/.test(subject));
  };
  const refuse = (keys: readonly string[], clause?: string) => {
    for (const key of keys) neg.add(key);
    if (clause !== undefined) refusedClauses.add(clause);
  };
  const rememberQualifiedTimeRefusal = (at: number, end: number, keys: readonly string[]) => {
    if (!probeChoiceAuthored(t.slice(0, at))) return;
    const tail = t.slice(end);
    const refusal = REFUSES_OFFERED_TIME.exec(tail)?.[0];
    if (!refusal) return;
    const qualified = QUALIFIED_TIME_REFUSAL.test(tail);
    const rest = tail.slice(refusal.length);
    if (!qualified
      && (!/[a-z0-9]/i.test(rest)
        || /\b(?:nothing|none|no\s+other\s+(?:day|option|slot|one)s?)\b/.test(rest))) return;
    const clause = clauseAt(t, at, end - at);
    if (/\bif\b/.test(clause) || COND_RX.test(clause)) conditionalTimeRefusal = true;
    else if (c.why === "refusal" || c.why === "mixed") qualifiedTimeRefusals.set(end, [end + refusal.length, keys, qualified]);
  };
  const onlyPick = (i: number, len: number) => /^[\s\W]*(?:the\s+)?$/.test(t.slice(0, i)) && /^[\s\W]*(?:one|option|works?|please|pls|lol)?[\s\W]*$/.test(t.slice(i + len));
  const mark = (keys: string[], i: number, len: number, calendar = false, group = false) => {
    if (!memberChoiceAt(i)) return;
    const cl = clauseAt(t, i, len);
    if (probeTimeIsRefused(t, i, i + len)) {
      rememberQualifiedTimeRefusal(i, i + len, keys);
      return refuse(keys, cl);
    }
    pickedClauses.add(cl);
    for (const k of keys) {
      pos.add(k);
      (group ? grouped : individual).add(k);
      if ((!unbound || !calendar) && onlyPick(i, len) || (POSITIVE_PICK.test(cl) && !/\?/.test(t.slice(i + len, i + len + 2)))) strong.add(k);
    }
  };
  // Option letters only where they cannot be the article "a": "a or b", "(b)", "option c", or alone.
  if (explicitTimesOnly) {
    for (const m of t.matchAll(EXPLICIT_KEY_LIST)) {
      const keys = [...m[0].matchAll(/\b[abc]\b/g)].map(key => key[0]);
      mark(keys, m.index!, m[0].length);
    }
    for (const m of t.matchAll(EXPLICIT_KEY_CLAUSE)) mark([m[2]!], m.index! + m[1]!.length, 1);
  } else {
    for (const m of t.matchAll(/\b([abc])\s*(?:or|and|&|,|\/)\s*([abc])\b/g)) mark([m[1]!, m[2]!], m.index!, m[0].length);
  }
  for (const m of t.matchAll(/(?:\boption\s+|\()([abc])\b/g)) mark([m[1]!], m.index!, m[0].length);
  const alone = (explicitTimesOnly ? EXPLICIT_KEY : /^\s*([abc])[\s.!,)]*$/).exec(t);
  if (alone && (explicitTimesOnly || all.includes(alone[1]!))) { pos.add(alone[1]!); strong.add(alone[1]!); individual.add(alone[1]!); }
  // Ordinals only as a pick ("the first", "second one", or alone): "tell me about them first" is not option a.
  const dayLists = directProbeDayLists(t);
  const mentions = completeProbeTimeMentions(t, !explicitTimesOnly || clarifiedTimes, memberChoiceAt, dayLists);
  const directOrdinals = readDirectProbeOrdinals(t, memberChoiceAt);
  const ordinals = completeProbeOrdinals(t, directOrdinals.refusals);
  const joinedRefusals = joinedProbeRefusals(t, [...mentions, ...ordinals], memberChoiceAt);
  const joinedRefusalClauses = new Set([...joinedRefusals].map(m => clauseAt(t, m.at, m.end - m.at)));
  // "either" is the negative twin of "too": once the reply refuses an offered time,
  // "Sunday either" means Sunday does not work either, not that Sunday works. A bare
  // "either" ("either works for me") still means any of them, and "either X or Y" is a
  // choice between two days, so only an "either" glued to one named day joins the refusal.
  const refusedElsewhere = mentions.some(m => memberChoiceAt(m.at)
    && (probeTimeIsRefused(t, m.at, m.end) || joinedRefusals.has(m)));
  const eitherRefusalAt = (m: TimeMention) => {
    if (!refusedElsewhere || !m.day && !m.group) return -1;
    // The "either" belongs to the whole list when the clause names another day that
    // was not refused ("sun and sat either but not sunday" keeps Saturday): only a
    // lone named day in its clause joins the refusal.
    const clause = clauseAt(t, m.at, m.end - m.at);
    if (mentions.some(other => other !== m && clauseAt(t, other.at, other.end - other.at) === clause
      && matchingOffered(other).some(key => !neg.has(key)))) return -1;
    const trailing = /^\s*,?\s*(?:(?:too|also|as\s+well)\s*,?\s*)?either\b(?!\s+(?:way|one|option|time|or)\b)/.exec(t.slice(m.end));
    if (trailing) return m.end + trailing.index + trailing[0].lastIndexOf("either");
    const leading = /\beither\s*$/.exec(t.slice(0, m.at));
    if (leading && !FOLLOWED_BY_DAY_TOKEN_RX.test(t.slice(m.end))) return leading.index;
    return -1;
  };
  let weakOrdinalMissing = false;
  for (const ordinal of ordinals) {
    if (!memberChoiceAt(ordinal.at)) continue;
    const option = options.at(ordinal.index);
    if (!option) weakOrdinalMissing = true;
    else if (ordinal.choiceEnd === undefined || joinedRefusals.has(ordinal)) {
      rememberQualifiedTimeRefusal(ordinal.at, ordinal.end, [option.key]);
      refuse([option.key], clauseAt(t, ordinal.at, ordinal.end - ordinal.at));
    }
    else mark([option.key], ordinal.at, ordinal.choiceEnd - ordinal.at);
  }
  const ordinalKeys = directOrdinals.choices.flatMap(choices => choices.map(choice => options[probeOrdinalIndex(choice, options.length)]?.key));
  for (const key of ordinalKeys) {
    if (key === undefined || neg.has(key)) continue;
    pos.add(key);
    strong.add(key);
    individual.add(key);
  }
  const ordinalMissing = ordinalKeys.some(key => key === undefined);
  let namedExclusion = false, refusedGroup = false, explicitAlternative = false;
  const conditionalUnresolved = new Set<TimeMention>();
  let contradictedExclusion = false;
  const namedExcluded = new Set<string>();
  const partExclusion = DAYPART_EXCLUSION.exec(t);
  const partExclusionEnd = partExclusion ? partExclusion.index + partExclusion[0].length : -1;
  const requiredPart = partExclusion?.[1] === "night" ? "evening" : partExclusion?.[1];
  const unresolved: TimeMention[] = [];

  const offered = options.map(o => {
    const clock = [...o.label.toLowerCase().matchAll(CLOCK_MENTION)].at(-1);
    const day = o.label.split(" ")[0];
    const minute = clock ? clockMinute(clock) : undefined;
    const dateKey = resolveRelative && typeof o.start === "number" ? localDateKey(o.start, tz, 0) : undefined;
    return { key: o.key, day, knownDay: day !== undefined && DAY_WORDS.some(([, name]) => name === day),
      weekend: day === "Saturday" || day === "Sunday", minute, part: minute === undefined ? undefined : partOf(minute), dateKey };
  });
  const matchingOffered = (m: TimeMention) => offered.filter(o => (!m.day || o.day === m.day)
    && (!m.day || !relativeRewritten.dateByDay?.has(m.day) || !o.dateKey || o.dateKey === relativeRewritten.dateByDay.get(m.day))
    && (m.minute === undefined || o.minute === m.minute)
    && (m.afterMinute === undefined || (o.minute !== undefined && o.minute >= m.afterMinute))
    && (m.approxMinute === undefined || (o.minute !== undefined && Math.abs(o.minute - m.approxMinute) <= 60))
    && (m.group ? o.knownDay && probeGroupIncludes(m.group === "weekend", o.weekend,
      m.nightsOnly === true, o.part === "evening", !!m.part, m.part === o.part) : !m.part || o.part === m.part)).map(o => o.key);
  const unresolvedLists = dayLists.filter(list => {
    const alternatives = ALTERNATIVE_PROBE_DAY_LIST.test(t.slice(list.at, list.end));
    return mentions.some(m => {
      if (!spanContains(list, m)) return false;
      const matches = matchingOffered(m).length;
      return matches > 1 || (matches === 0 && !alternatives);
    });
  });
  for (const m of mentions) {
    if (!memberChoiceAt(m.at)) continue;
    if (unresolvedLists.some(list => spanContains(list, m))) { unresolved.push(m); continue; }
    if (partExclusion && m.at >= partExclusion.index && m.at < partExclusionEnd) continue;
    const prefix = t.slice(0, m.at);
    const exclusion = m.at === partExclusionEnd || NAMED_EXCLUSION.test(prefix);
    const currentAlternative = clarifiedTimes && exclusion && CLARIFIED_ALTERNATIVE_RANGE.test(prefix)
      && CURRENT_PROBE_CHOICE.test(t.slice(m.end).replace(/[.!]\s*$/, ""));
    if (clarifiedTimes && !currentAlternative && probeTimeIsRecurring(t, m.at, m.end)) continue;
    const matching = matchingOffered(m);
    const eitherAt = eitherRefusalAt(m);
    const refused = exclusion || probeTimeIsRefused(t, m.at, m.end) || joinedRefusals.has(m) || eitherAt >= 0;
    if (m.group && (quoteStillOpen(t.slice(0, m.at)) || describesAnotherPerson(clauseAt(t, m.at, m.end - m.at)))) {
      unresolved.push(m);
    } else if (refused) {
      namedExclusion ||= exclusion;
      explicitAlternative ||= currentAlternative && matching.length > 0;
      contradictedExclusion ||= exclusion && refusalAfter(t, m.at, m.end);
      refusedGroup ||= !!m.group;
      rememberQualifiedTimeRefusal(m.at, m.end, matching);
      const refusalTail = REFUSES_OFFERED_TIME.exec(t.slice(m.end));
      if (refusalTail) refusedTails.set(m.end, [m.end + refusalTail[0].length, matching]);
      // An either-refusal records no clause: its clause is shared with the other
      // days in the list ("sat and sun either"), and recording it would make the
      // weak branch read the unrefused day's pick as refused too.
      refuse(matching, exclusion || eitherAt >= 0 ? undefined : clauseAt(t, m.at, m.end - m.at));
      // A comma can put the "either" in its own clause ("Sunday, either"): mark that
      // clause refused too, so the weak "either" branch sees the refusal instead of
      // falling through to booking the times that were never mentioned. Only when the
      // clause names no other time, so a shared clause ("sat and sun either") keeps
      // picking the day that was not refused.
      if (eitherAt >= 0) {
        const eitherClause = clauseAt(t, eitherAt, "either".length);
        if (!mentions.some(m => clauseAt(t, m.at, m.end - m.at) === eitherClause)) refusedClauses.add(eitherClause);
      }
      if (exclusion) for (const key of matching) namedExcluded.add(key);
    } else if (inConditionalClause(t, m.at)) {
      unresolved.push(m);
      conditionalUnresolved.add(m);
    } else if (unbound && !m.day || !matching.length || !m.group && matching.length > 1 && (explicitTimesOnly || !m.part)
      || m.part && !m.day && !m.group && c.answer !== "yes" && !onlyPick(m.at, m.end - m.at)
        && !/^\s+(?:(?:work|works|will work)\b|(?:is|are) (?:good|fine|ok(?:ay)?|perfect)\b|for me\b)/.test(t.slice(m.end))) {
      // General availability can answer an earlier profile question. A bare daypart needs a direct pick.
      unresolved.push(m);
    } else mark(matching, m.at, m.end - m.at, true, !!m.group);
  }
  if (conditionalTimeRefusal) {
    if (!hasDetachedProbeRefusal(t)) return { answer: "unclear", keys: [], why: "conditional" };
    if (c.why !== "mixed" && c.why !== "refusal") c = { answer: "no", why: "refusal" };
  }
  // Read a general answer without the words already bound to a specific refused time.
  const strippedRefusals = [...qualifiedTimeRefusals].filter(([, [, keys, qualified]]) => qualified || !keys.some(key => strong.has(key)));
  if (strippedRefusals.length) {
    let remaining = t;
    for (const [at, [end]] of strippedRefusals.sort(([first], [second]) => second - first)) {
      remaining = `${remaining.slice(0, at)} ${remaining.slice(end)}`;
    }
    c = consentScan(remaining);
  }
  if ((c.why === "mixed" || c.why === "refusal") && strong.size > 0 && refusedTails.size > 0) {
    const firstStrongAt = Math.min(
      ...mentions.filter(m => matchingOffered(m).some(key => strong.has(key))).map(m => m.at),
      ...ordinals.filter(o => o.choiceEnd !== undefined && strong.has(options.at(o.index)?.key ?? "")).map(o => o.at),
    );
    if (Number.isFinite(firstStrongAt)) {
      const tails = [...refusedTails].filter(([at]) => at >= firstStrongAt).sort(([first], [second]) => second - first);
      const retractsPick = tails.some(([, [, keys]]) => keys.some(key => strong.has(key)));
      let remaining = t;
      for (const [at, [end]] of tails) {
        remaining = `${remaining.slice(0, at)} ${remaining.slice(end)}`;
      }
      const rescanned = consentScan(remaining);
      if (tails.length && !retractsPick && rescanned.answer === "yes") c = rescanned;
    }
  }
  // A reply that is only time words ("sat 11am", "thursday or sunday") picks them all firmly.
  let residue = t;
  for (const list of dayLists) residue = residue.slice(0, list.at) + " ".repeat(list.end - list.at) + residue.slice(list.end);
  for (const m of mentions) residue = residue.slice(0, m.at) + " ".repeat(m.end - m.at) + residue.slice(m.end);
  for (const [re] of DAY_WORDS) residue = residue.replace(re, " ");
  residue = residue.replace(PROBE_DAY_GROUP, " ");
  residue = residue.replace(/\b(?:after|around)\s+\d{1,2}(?::\d\d)?\s*(?:am|pm)?(?:-?ish)?\b|\b\d{1,2}(?::\d\d)?\s*(?:am|pm)?(?:-?ish)?\b|\b(?:the|one|option|or|and|either|works?|please|pls|lol|at|on|in the|morning|evening|afternoon|night|[abc])\b|[\W_]+/g, " ").trim();
  // A ", Day too" joins the named day when the reply also says yes in words ("Saturday is best,
  // Sunday too" books both): the affirmation must not hide the "too" the way "works" already does
  // not. A bare list ("Saturday, Sunday too") and "work" alone ("Saturday work, Sunday too") stay
  // unclear: no affirmation was said, so nothing firms the extra day up. (The residue above has
  // already lost apostrophes, so "i'm" arrives as "i m"; part words need their plurals too.)
  const affirmedResidue = residue.replace(/\b(?:best|better|good|fine|great|perfect|free|open|okay|is|are|i m|i am|i can|we re|we are|we can|im|for me|work best|work for (?:me|us)|does work|mornings?|afternoons?|evenings?|nights?)\b/g, " ").trim();
  const addsChoice = /\b(?:also|too|as\s+well)\b/.test(affirmedResidue)
    && !affirmedResidue.replace(/\b(?:also|too|as\s+well|first|second|third|last)\b/g, "").trim();
  if (((unbound ? addsChoice : !residue) || (addsChoice && affirmedResidue !== residue)) && !/\?/.test(t)) for (const k of pos) strong.add(k);
  const isPicked = (key: string) => !namedExcluded.has(key) && pos.has(key)
    && (!neg.has(key) || !explicitTimesOnly && (!grouped.has(key) || individual.has(key)));
  const picked = all.filter(isPicked);
  const open = offered.filter(slot => probeExclusionAlternative(requiredPart !== undefined, requiredPart === slot.part,
    neg.has(slot.key) && !isPicked(slot.key), contradictedExclusion)).map(slot => slot.key);
  const unclear = { answer: "unclear" as const, keys: [], why: c.why === "none" && qualifiedTimeRefusals.size ? "slot" as const : c.why };
  const explicitYes = (keys: string[]): ProbeReply => ({ answer: "yes", keys, why: c.why,
    ...(explicitTimesOnly ? { explicitTimeSelection: true as const } : {}) });
  // Refusal first. A pick after a refusal ("no, Saturday works") is mixed: ask again.
  if (c.why === "refusal") return all.some(k => strong.has(k)) || conditionalUnresolved.size ? { ...unclear, why: "mixed" } : { answer: "no", keys: [], why: c.why };
  const exceptSpan = /^\s*(?:any\s?(?:thing|day|time)|every\s?(?:thing|day)|all|whichever)\s+except\s+(.+?)\s+works?[.!\s]*$/.exec(t)?.[1];
  if (c.why === "mixed" && !explicitTimesOnly && namedExclusion && !contradictedExclusion
    && open.length && !unresolved.length && exceptSpan !== undefined
    && exceptSpanIsOnlyExcludedTimes(exceptSpan)) return explicitYes(open);
  if (c.why === "mixed" || c.why === "conditional" || c.why === "hedged") return unclear;
  if (explicitTimesOnly) {
    if (EXPLICIT_NO_OFFERED_TIMES.test(t)) return { answer: "no", keys: [], why: "refusal" };
    if (t.includes("?") || unresolved.length || [...pos].some(key => !all.includes(key)) || UNBOUND_OFFER_DATE.test(t) || UNBOUND_OFFER_CLOCK.test(t)) return { ...unclear, why: "slot" };
  }
  const bareClocks = [...t.matchAll(UNBOUND_OFFER_CLOCK_GLOBAL)].map(m => { const [h, mm] = m[0].replace(/^at\s+/, "").split(":"); return (Number(h) % 12) * 60 + Number(mm ?? 0); });
  if (bareClocks.length && (!picked.length || picked.some(k => { const o = offered.find(s => s.key === k); return o?.minute === undefined || !bareClocks.includes(o.minute % 720); }))) return { ...unclear, why: "slot" };
  if (ordinalMissing) return { ...unclear, why: "slot" };
  if (unbound) {
    const current = picked.filter(key => strong.has(key));
    return unboundProbeTimeNeedsClarification(unbound, current.length > 0)
      ? { ...unclear, why: "slot" } : explicitYes(current);
  }
  const strongAll = explicitTimesOnly ? EXPLICIT_ALL.exec(t) ?? (clarifiedTimes ? EXPLICIT_PAIR_ALL.exec(t) : null) : ALL.exec(t);
  const weakCues = (explicitTimesOnly && !clarifiedTimes) || strongAll ? [] : [...t.matchAll(ALL_WEAK)].filter(cue => {
    const clause = clauseAt(t, cue.index!, cue[0].length);
    const refusalOnly = joinedRefusalClauses.has(clause) && !pickedClauses.has(clause);
    // An "either" glued to refused days is spent as the refusal's "also": it is not
    // a broad pick for the other days ("Sunday either, or Thursday" asks again). But
    // when the clause also names a day that was not refused ("sat and sun either but
    // not sunday"), the cue still picks that day, so only a clause whose every named
    // day is refused spends the cue.
    const clauseFrom = Math.max(0, ...[...t.slice(0, cue.index!).matchAll(CLAUSE_START)].map(m => m.index! + m[0].length));
    const clauseEnd = t.slice(cue.index! + cue[0].length).search(/[.,;!?\\n]|\\bbut\\b/);
    const clauseTo = clauseEnd < 0 ? t.length : cue.index! + cue[0].length + clauseEnd;
    const clauseDays = mentions.filter(m => m.at >= clauseFrom && m.at < clauseTo);
    const eitherSpent = cue[0].startsWith("either") && clauseDays.length > 0
      && clauseDays.every(m => matchingOffered(m).every(key => neg.has(key)));
    return memberChoiceAt(cue.index!) && !(refusalOnly && picked.length > 0) && !eitherSpent;
  });
  const weakAt = weakCues[0];
  const weakRefusal = weakCues.some(cue => refusedClauses.has(clauseAt(t, cue.index!, cue[0].length)));
  const oneSlot = /(?:\bbut\s+|,\s*)not\s+both[.!\s]*$/.exec(t);
  const weakLimit = oneSlot && weakAt?.[0].startsWith("either") && !quoteStillOpen(t.slice(0, weakAt.index))
    && !describesAnotherPerson(t.slice(0, oneSlot.index)) ? oneSlot.index : t.length;
  const weakNegated = weakCues.some(cue => cue.index! < weakLimit && probeTimeIsRefused(t, cue.index!, cue.index! + cue[0].length));
  if (weakAt && (pos.size || unresolved.length || weakOrdinalMissing || weakRefusal || weakNegated)) {
    if (contradictedExclusion) return { ...unclear, why: "slot" };
    if (rejectedTimes || !namedExclusion && OTHER_TIMES.test(t.replace(NO_OTHER_TIMES, ""))) return explicitYes([]);
    if (unresolved.length || weakOrdinalMissing || [...pos].some(key => !all.includes(key))
      || [...pickedClauses].some(clause => refusedClauses.has(clause))
      || weakNegated) return { ...unclear, why: "slot" };
    const bothCues = weakCues.filter(cue => {
      if (cue.index! >= weakLimit || !cue[0].startsWith("both")) return false;
      return probeChoiceAuthored(t.slice(0, cue.index!));
    });
    if (bothCues.some(cue => BOTH_TIME_QUALIFIER.test(t.slice(cue.index! + cue[0].length)))) return { ...unclear, why: "slot" };
    const eitherCues = weakCues.filter(cue => {
      if (cue.index! >= weakLimit || !cue[0].startsWith("either")) return false;
      return probeChoiceAuthored(t.slice(0, cue.index!));
    });
    if (eitherCues.some(cue => BOTH_TIME_QUALIFIER.test(t.slice(cue.index! + cue[0].length)))) return { ...unclear, why: "slot" };
    const namesPair = bothCues.some(cue => {
      const clause = clauseAt(t, cue.index!, cue[0].length);
      if (pickedClauses.has(clause) && BOTH_TIME_LEAD.test(clause)) return true;
      const rest = t.slice(cue.index! + cue[0].length).split(BOTH_TIME_BOUNDARY, 1)[0]!;
      return BOTH_TIME_TAIL.test(rest) && !/\b(?:we|you|they)\s+$/.test(t.slice(0, cue.index!));
    });
    if (namesPair && pos.size < 2) return { ...unclear, why: "slot" };
    const chosen = picked.filter(key => !neg.has(key) && open.includes(key));
    return chosen.length ? explicitYes(pickedTimes(chosen, open)) : { ...unclear, why: "slot" };
  }
  // A time they name and do not refuse is a yes to it ("no plans Thursday, so Thursday works").
  // A named time with a yes or a firm pick ("Saturday works"); a bare mention ("I'm at a wedding saturday") is not a yes.
  if (picked.length && (c.answer === "yes" || picked.some(k => strong.has(k)))) return explicitYes(picked.filter(k => strong.has(k) || c.answer === "yes"));
  if (unresolvedLists.length) return { ...unclear, why: "slot" };
  if (contradictedExclusion || namedExclusion && (open.length === 0 || [...namedExcluded].some(key => strong.has(key)))) {
    return { ...unclear, why: "slot" };
  }
  if (rejectedTimes || bareGroupRejection || !namedExclusion && OTHER_TIMES.test(t)) return { answer: "yes", keys: [], why: c.why };
  // "Any of them" (not refused, not a request for other days): every option the member did not rule out.
  const allAt = strongAll ?? weakAt;
  if (allAt && probeChoiceAuthored(t.slice(0, allAt.index)) && !probeTimeIsRefused(t, allAt.index, allAt.index + allAt[0].length)
    && !unresolved.some(m => clauseAt(t, m.at, m.end - m.at) === clauseAt(t, allAt.index, allAt[0].length))) {
    if (clarifiedTimes && !clarifiedBroadTimeChoiceAllowed(strongAll !== null,
      /\b(?:both|either)\b/.test(strongAll?.[0] ?? ""), open.length)) {
      return { ...unclear, why: "slot" };
    }
    const namedMentions = mentions.filter(m => memberChoiceAt(m.at)
      && matchingOffered(m).some(key => picked.includes(key))).sort((x, y) => x.at - y.at);
    const choiceLead = /^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?|well)[,\s]+)?(?:(?:i|we)(?:'?m|'re|\s+am|\s+are)?\s+(?:(?:can|could)\s+(?:do|make)|(?:free|open|available|good)(?:\s+on)?)\s+)?(?:(?:either|whichever(?:\s+of)?|any\s+of)\s+)?(?:on\s+)?$/;
    const orJoined = namedMentions.some((m, i) => {
      const next = namedMentions[i + 1];
      if (next === undefined || !/^[\s,]*(?:\bor\b|and\/or)[\s,]*$/.test(t.slice(m.end, next.at))) return false;
      const clauseFrom = Math.max(0, ...[...t.slice(0, m.at).matchAll(CLAUSE_START)].map(hit => hit.index! + hit[0].length));
      return choiceLead.test(t.slice(clauseFrom, m.at));
    });
    const chosen = picked.length >= 2 && /\bwhichever\b/.test(allAt[0]) && orJoined
      ? picked.filter(key => !neg.has(key) && open.includes(key)) : open;
    return chosen.length ? explicitYes(chosen) : { ...unclear, why: "slot" };
  }
  if (unresolved.length || pos.size && !strong.size && c.answer !== "yes") return { ...unclear, why: "slot" };
  if (namedExclusion && open.length
    && (explicitAlternative || !explicitTimesOnly && (!past || EXPLICIT_ALTERNATIVE_RANGE.test(t)))) {
    return explicitYes(open);
  }
  if (past || refusedGroup && !/^\s*(?:yes|yep|yeah|sure|ok(?:ay)?)\b/.test(t)) return { ...unclear, why: "slot" };
  if (explicitTimesOnly) return unclear;
  const droppedNamedTime = mentions.some(m => !memberChoiceAt(m.at) && matchingOffered(m).length > 0);
  if (c.answer === "yes" && authoredYes(t) && !droppedNamedTime
    && (neg.size === 0 || yesBooksRefusedRemainder(remainderRefused(t), remainderAffirmed(t)))) {
    return { answer: "yes", keys: open, why: c.why };
  }
  // Only refusals ("Thursday doesn't work") are not a yes: the probe stays open for a clear answer.
  return neg.size || pos.size ? { ...unclear, why: "slot" } : unclear;
}

const AVAILABILITY_EXCLUSION = new RegExp(String.raw`\b(?:(${NAMED_EXCLUSION_RANGE} )but|${NAMED_EXCLUSION_PHRASES})\s+`, "g");
const AVAILABILITY_TIME = new RegExp(`^(?:on\\s+)?(?:${DAY_WORDS.map(([re]) => re.source).join("|")}|\\b(?:weekdays?|weekends?|weeknights?|mornings?|afternoons?|lunch|evenings?|nights?|after work)\\b)`);

/**
 * When a member says they are free ("Tue and Thu evenings", "weekends", "Saturday morning"), as
 * availability-pattern tags ("evening:Tue") that the engine's standingFromFacets reads.
 * A part of the day goes with the days just before it ("Tuesday evening and Saturday afternoon" ->
 * evening:Tue, afternoon:Sat; "Tue and Thu evenings" -> both evenings), or with the days after it
 * when it comes first ("evenings on Tue and Thu"). A day with no part of its own gets the usual
 * default (a weekend day: the whole day; a weekday: the evening). Days and parts are never crossed.
 */
export function availabilityTags(body: string, now?: number, tz: string = "America/New_York"): string[] {
  // These exclusions have the same scope as "except". Require a time expression next so
  // "barring emergencies" does not refuse a later day; keep this out of booking consent.
  const t = body.toLowerCase().replace(AVAILABILITY_EXCLUSION,
    (cue: string, range: string | undefined, at: number, text: string) => !/\bnothing(?:\s+at all)?\s+$/.test(text.slice(0, at))
      && AVAILABILITY_TIME.test(text.slice(at + cue.length)) ? `${range ?? ""}except ` : cue);
  const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  type Tok = { at: number; days?: number[]; part?: string; refused?: boolean };
  const toks: Tok[] = [];
  // A named refusal must not be restored when an offered day group is expanded.
  // When a negated day is immediately qualified by a daypart ("except sun morning"),
  // exclude only that daypart on that day instead of dropping the whole day.
  const refusedDays = new Set<number>();
  const refusedDayParts = new Map<number, Set<string>>();
  const consumedPartSpans: [number, number][] = [];
  const refusedDayEnds: number[] = [];
  const IMMEDIATE_DAYPART = /^\s+(mornings?|afternoons?|lunch|evenings?|nights?)\b/;
  const partNameOf = (word: string) => /^morning/.test(word) ? "morning" : /^(?:afternoon|lunch)/.test(word) ? "afternoon" : "evening";
  const recordNegatedDay = (dayIdx: number, end: number) => {
    const dp = IMMEDIATE_DAYPART.exec(t.slice(end));
    if (dp) {
      const part = partNameOf(dp[1]!);
      (refusedDayParts.get(dayIdx) ?? refusedDayParts.set(dayIdx, new Set()).get(dayIdx)!).add(part);
      const start = end + dp[0].indexOf(dp[1]!);
      consumedPartSpans.push([start, start + dp[1]!.length]);
    } else {
      refusedDays.add(dayIdx);
      refusedDayEnds.push(end);
    }
  };
  DAY_WORDS.forEach(([re], i) => { for (const m of t.matchAll(re)) {
    if (negatedAt(t, m.index!, m[0].length)) recordNegatedDay(i, m.index! + m[0].length);
    else toks.push({ at: m.index!, days: [i] });
  } });
  if (now !== undefined) {
    const lp = localParts(now, tz);
    const todayIdx = (lp.weekday + 1) % 7;
    const tomorrowIdx = (todayIdx + 1) % 7;
    for (const m of t.matchAll(/\btonight\b/g)) {
      if (negatedAt(t, m.index!, m[0].length)) {
        (refusedDayParts.get(todayIdx) ?? refusedDayParts.set(todayIdx, new Set()).get(todayIdx)!).add("evening");
      } else {
        toks.push({ at: m.index!, days: [todayIdx] }, { at: m.index! + 1, part: "evening" });
      }
    }
    for (const m of t.matchAll(/\btoday\b/g)) {
      if (negatedAt(t, m.index!, m[0].length)) recordNegatedDay(todayIdx, m.index! + m[0].length);
      else toks.push({ at: m.index!, days: [todayIdx] });
    }
    for (const m of t.matchAll(/\b(?:tomorrow|tmrw|tmr)\b/g)) {
      if (negatedAt(t, m.index!, m[0].length)) recordNegatedDay(tomorrowIdx, m.index! + m[0].length);
      else toks.push({ at: m.index!, days: [tomorrowIdx] });
    }
  }
  for (const m of t.matchAll(/\bweekends?\b/g)) if (!negatedAt(t, m.index!, m[0].length)) toks.push({ at: m.index!, days: [0, 6].filter(d => !refusedDays.has(d)) });
  for (const m of t.matchAll(/\bweekdays?\b/g)) if (!negatedAt(t, m.index!, m[0].length)) toks.push({ at: m.index!, days: [1, 2, 3, 4, 5].filter(d => !refusedDays.has(d)) });
  for (const m of t.matchAll(/\bweeknights?\b/g)) if (!negatedAt(t, m.index!, m[0].length)) toks.push({ at: m.index!, days: [1, 2, 3, 4, 5].filter(d => !refusedDays.has(d)) }, { at: m.index!, part: "evening" });
  for (const [re, part] of [[/\bmornings?\b/g, "morning"], [/\bafternoons?\b|\blunch\b/g, "afternoon"], [/\b(?:evenings?|nights?|after work)\b/g, "evening"]] as const) {
    for (const m of t.matchAll(re)) {
      const mStart = m.index!, mEnd = mStart + m[0].length;
      if (consumedPartSpans.some(([from, to]) => mStart >= from && mEnd <= to)) continue;
      // "Except Sunday mornings" qualifies the named-day exception, not every morning.
      const namedException = refusedDayEnds.some(end => end <= mStart && /^\s*$/.test(t.slice(end, mStart)));
      toks.push({ at: mStart, part, refused: !namedException && negatedAt(t, mStart, m[0].length) });
    }
  }
  // Natural clock cues ("tue after 6", "next thurs 7ish", "fri around 5pm") map to their daypart.
  for (const m of t.matchAll(/\b(?:after|around|at|from)\s+(\d{1,2})(?::([0-5]\d))?\s*([ap]m)?(?:-?ish)?\b|\b(\d{1,2})(?::([0-5]\d))?\s*(?:([ap]m)\s*-?ish|-?ish)\b/g)) {
    const hRaw = Number(m[1] ?? m[4]);
    const minRaw = Number(m[2] ?? m[5] ?? 0);
    const meridiem = m[3] ?? m[6];
    const minute = flexibleClockMinute(hRaw, minRaw, meridiem);
    if (minute === undefined) continue;
    const part = partOf(minute);
    if (!part) continue;
    toks.push({ at: m.index!, part, refused: negatedAt(t, m.index!, m[0].length) });
  }
  toks.sort((a, b) => a.at - b.at || (a.days ? -1 : 1));
  const out = new Map<number, Set<string>>();
  const refused = new Map<number, Set<string>>(), refusedLead = new Set<string>();
  for (const [d, parts] of refusedDayParts) refused.set(d, new Set(parts));
  const defaults = new Set<number>();
  const give = (ds: number[], p: string) => ds.forEach(d => (out.get(d) ?? out.set(d, new Set()).get(d)!).add(p));
  let pending: number[] = [], group: number[] = [], prevPart = false;
  const lead: string[] = [];
  for (const k of toks) {
    if (k.days) {
      if (prevPart) group = [];
      pending.push(...k.days);
      prevPart = false;
    } else if (k.part) {
      const ds = pending.length ? pending : prevPart ? group : [];
      if (ds.length) {
        group = ds; pending = [];
        if (k.refused) for (const d of ds) {
          (refused.get(d) ?? refused.set(d, new Set()).get(d)!).add(k.part);
          defaults.add(d);
        }
        else give(ds, k.part);
      } else if (k.refused) refusedLead.add(k.part);
      else lead.push(k.part);
      prevPart = true;
    }
  }
  // Days at the end with no part after them: a part said first ("evenings, Tue or Thu"), else the default.
  for (const d of pending) defaults.add(d);
  for (const d of defaults) if (pending.includes(d) || !out.has(d)) {
    const parts = lead.length ? lead : d === 0 || d === 6 ? ["morning", "afternoon", "evening"] : ["evening"];
    parts.forEach(p => give([d], p));
  }
  // Do not replace an explicitly offered but fully refused group with default weekdays.
  // The default also must not restore a weekday or group the member just refused.
  const bareDaypartGeneral = lead.length > 0 && (
    /\b(most|any|all|every)\b/.test(t)
    || /\b(?:mornings?|afternoons?|evenings?|nights?)\s+(?:work|works|are\s+(?:good|best|open|free|great|fine))\b/.test(t)
    || /^\s*(?:usually\s+|generally\s+)?(?:mornings|afternoons|evenings|nights)[.!]*\s*$/.test(t)
  );
  if (!out.size && !toks.some(k => k.days) && bareDaypartGeneral) {
    const weekdayWords = [/\b(?:weekdays?|weeknights?)\b/g, ...DAY_WORDS.slice(1, 6).map(([re]) => re)];
    if (!weekdayWords.some(re => [...t.matchAll(re)].some(m => negatedAt(t, m.index!, m[0].length)))) {
      for (const p of lead) give([1, 2, 3, 4, 5], p);
    }
  }
  // Subtract refusals after defaults, so an omitted part cannot restore a refused window.
  for (const [d, parts] of out) for (const p of [...refusedLead, ...(refused.get(d) ?? [])]) parts.delete(p);
  const ORDER = ["morning", "afternoon", "evening"];
  return [...out.keys()].sort().flatMap(d => ORDER.filter(p => out.get(d)!.has(p)).map(p => `${p}:${DAYS3[d]}`));
}

/** "Nobody else came": the member came and found nobody (a report about the others). */
export const NOBODY_CAME = /\b(nobody|no one) else (came|showed)\b/i;

/** A clear answer that the member has no availability for the current week. */
export function explicitlyBusyThisWeek(body: string): boolean {
  const text = body.trim().toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  return /^(?:(?:i'm |i am )?(?:busy|not free|(?:pretty |completely )?packed) this week|busy week,? nothing free|this week is full|(?:no free time|nothing free) this week)(?:[,!.]? (?:sorry|thanks))?[.!]?$/.test(text);
}
