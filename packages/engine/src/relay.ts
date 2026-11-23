// Relay through the agent after a match (PRD 40.5, critical path item 7; founder decision 9).
//
// After a mutual yes, members never talk directly. Every item one member wants the other to get (a
// text message, "send them my number", a photo) goes through `relayItem`, which returns
//   { decision: "pass" | "hold" | "block", reasons, rendered, photos, record, senderNotice }.
// `rendered` is the agent's wording and the ONLY thing the other person sees; it is "" unless the
// decision is "pass". `record` is the relay log row: no message body, no contact value, reason codes
// from a fixed list (leak-guard matches are keyed hashes, core `labelHash`).
//
// Checks, in order (every check runs; the most severe outcome wins: block > hold > pass):
//   1. parties     both are the opportunity's two participants; neither is a minor (lowest stated
//                  age 18+, unknown fails closed: core `canBeMatched`); no block edge either way; the
//                  recipient has not opted out; a safety hold on either side holds the item;
//   2. state       the opportunity is "mutual" (both said yes) and not closed, cancelled or expired;
//   3. consent     a contact share needs the sender's explicit request for THIS item (fresh, by the
//                  sender, same kind); a photo needs the explicit send naming the photo ids, the
//                  sender's photo consent, and photo ids the sender owns (opaque ids, never URLs);
//   4. text        the core LeakGuard (other people's private facts, canaries, a split number across
//                  the last messages); contact patterns in free text are held (the approved path is
//                  a contact share); rating, score or attractiveness wording is held; a minor's
//                  self-disclosure ("I'm 16") blocks and flags the age for the platform;
//   5. classifier  rules first: money requests, gift cards, crypto and "investments", moving
//                  off-platform before the first date, contact fishing, prompt injection, sexual
//                  pressure, insults (hold); threats and slurs (block). An optional model hook
//                  (`relayItemAsync`; production: the Clef decision model, relayClef.ts) runs on items
//                  the rules pass (and, with `escalateHeld`, on items they hold). It can only ADD
//                  reasons: it raises pass to hold or block, never lowers what the rules decided. A
//                  hook error holds the item by default (the Clef hook never throws: it falls back to
//                  the rules itself, see relayClef.ts);
//   6. rate        per sender per opportunity: a burst limit, a daily limit, photos per day, and one
//                  contact share per opportunity.
// Deterministic and offline: no clock reads (the caller passes `now`), no randomness, no model call
// unless the caller passes a hook. Network code, so it never reads hidden persona truth.
import { pendingSwapWithdrawn, privateRelayRequestAllowed, relayConsentStale, relayVerdict } from "../../core/src/generated/relayDecision.ts";
import { relayEnvelopeTextAllowed, relayIsIndirectQuestion } from "../../core/src/generated/relayRequestAddress.ts";
import { AGE_BIRTHDAY_AFTER_AGE, AGE_DISTANT_BIRTHDAY_AFTER_AGE, canBeMatched, hasOrElseThreat, labelHash, LeakGuard, normalizeAgeInitialism, OR_ELSE_THREAT, relayMinorAge, relayMinorEstimate, textVariants, type MemberId, type Owned } from "@thenetwork/core";

export const RELAY_POLICY_VERSION = "relay-1.0.0";

export type RelayKind = "text" | "contact_share" | "photo";
export type RelayDecision = "pass" | "hold" | "block";

/** One side of the exchange, as the platform knows them. */
export interface RelayParty {
  id: MemberId;
  /** First name only (the reveal gave it); used in the agent's wording. */
  firstName: string;
  /** The person's LOWEST stated or recorded age (core policy); undefined = unknown = never relayed. */
  age: number | undefined;
  /** STOP, "leave slop", a pause or a deleted account: nothing is delivered to them. */
  optedOut?: boolean;
  /** An open safety hold (report, scam flag, staff hold). */
  held?: boolean;
  /** The member's photo ids (opaque, platform-resolved) that carry the current photo consent. */
  photoIds?: readonly string[];
  /** The member agreed that their photos may be shown to a match (probe or relay). */
  photoConsent?: boolean;
}

/** The match the exchange belongs to. Only "mutual" allows relay. */
export interface RelayOpportunity {
  id: string;
  app: string;
  participants: readonly [MemberId, MemberId];
  /** Who said yes (both, for "mutual"). */
  acceptedBy: readonly MemberId[];
  status: "probing" | "mutual" | "closed" | "cancelled" | "expired";
  /** When the first date happened (after it, moving off-platform is not an early move). */
  metAt?: number;
}

/** The sender's explicit consent to one item ("send them my number", "send this photo"). */
export interface RelayConsent {
  kind: "contact_share" | "photo";
  /** The member who gave it (must be the sender). */
  by: MemberId;
  /** The item it covers (the platform creates the item id when it reads the request). */
  itemId: string;
  at: number;
  /** For a photo: exactly the photos the member chose. */
  photoIds?: readonly string[];
}

export interface RelayItem {
  id: string;
  kind: RelayKind;
  from: MemberId;
  to: MemberId;
  at: number;
  /** The member's words (a text item; an optional caption on a photo). */
  text?: string;
  /** A contact share: the sender's own verified contact, from the platform's person record (never parsed from free text). */
  contact?: { kind: "phone" | "email"; value: string };
  /** A photo item: opaque photo ids. */
  photoIds?: readonly string[];
  consent?: RelayConsent;
}

export interface RelayLimits {
  /** At most `n` items per sender per opportunity in `windowMs`. */
  burst: { n: number; windowMs: number };
  /** At most this many items per sender per opportunity per 24 hours. */
  daily: number;
  /** At most this many photo items per sender per opportunity per 24 hours. */
  photosDaily: number;
  /** Contact shares per sender per opportunity. */
  contactShares: number;
  /** Consent older than this does not count. */
  consentTtlMs: number;
  /** Longest text relayed. */
  maxChars: number;
  /** Photos in one item. */
  maxPhotos: number;
}
export const RELAY_LIMITS: RelayLimits = {
  burst: { n: 6, windowMs: 10 * 60_000 }, daily: 40, photosDaily: 6, contactShares: 1, consentTtlMs: 15 * 60_000, maxChars: 1000, maxPhotos: 3,
};

/** The relay log row. No body, no contact value, no photo id: who, when, what kind, the outcome, reason codes. */
export interface RelayRecord {
  itemId: string; opportunityId: string; app: string;
  kind: RelayKind; from: MemberId; to: MemberId; at: number;
  decision: RelayDecision;
  /** Reason codes from RELAY_REASON_FAMILIES; any match-specific part is a keyed hash. */
  reasons: string[];
  photoCount: number;
  /** A contact share was delivered. */
  contactShared: boolean;
  /** The text carried a minor self-disclosure: the platform re-checks the person's lowest age. */
  ageSignal: boolean;
  policy: string;
}

export interface RelayContext {
  now: number;
  opportunity: RelayOpportunity;
  sender: RelayParty;
  recipient: RelayParty;
  /** A block edge exists in either direction (the platform resolves aliases and person-level bans). */
  blocked: boolean;
  /** The relay log for this opportunity (both directions), any order. */
  history?: readonly RelayRecord[];
  /** The sender's last delivered texts in this thread (oldest first): a number split across messages is caught. */
  recentTexts?: readonly string[];
  /**
   * The last few rendered messages in this thread, both directions, oldest first, exactly as delivered
   * ("Sam says: ..."). Context for the classifier hook only (`relayItemAsync`); never logged.
   */
  thread?: readonly string[];
  /** A compiled guard with both members' private facts (owner set) and canaries (`relayGuard`). */
  guard?: LeakGuard;
  /**
   * Extra text rules from the platform (for example the slop pack's `appearanceLeak` on an app that
   * rates photos). Returns reason codes from RELAY_REASON_FAMILIES ("rating:appearance"); they are
   * added to the rules' reasons like any other.
   */
  extraRules?: (text: string) => string[];
  limits?: Partial<RelayLimits>;
}

export interface RelayResult {
  decision: RelayDecision;
  reasons: string[];
  /** The agent's wording, the only thing the recipient sees. "" unless decision is "pass". */
  rendered: string;
  /** Photo ids to attach to `rendered` (pass only). */
  photos: string[];
  record: RelayRecord;
  /** What the agent tells the sender. Never repeats the matched text or names a rule. */
  senderNotice: string;
}

/** Reason families. `block` ones stop the item for good; `hold` ones send it to staff review. */
export const RELAY_REASON_FAMILIES = {
  block: ["state", "party", "minor", "optout", "consent", "photo", "contact_share", "canary", "harass_severe", "format", "llm_severe", "clef_severe"],
  hold: ["safety", "leak", "contact", "rating", "scam", "offplatform", "fishing", "injection", "harass", "rate", "text", "llm", "clef"],
} as const;
const BLOCK_PREFIX = new Set<string>(RELAY_REASON_FAMILIES.block);

// ------------------------------------------------------------------------------------------ rules
// Rules-first classifier. Patterns run on core textVariants (lowercase, NFKC, homoglyphs mapped,
// spaced letters collapsed, leetspeak undone). Each label maps to one reason code.

const R = (s: string) => new RegExp(s, "i");
const PAY = "(?:send|wire|transfer|lend|loan|venmo|zelle|cash ?app|paypal|give|spot|front)";
const MONEY = "(?:\\$\\s?\\d|\\bmoney\\b|\\bcash\\b|\\bfunds?\\b|\\bbucks\\b|\\bdollars?\\b|\\busd\\b|\\b\\d{2,5}\\b)";
const APPS = "(?:whats ?app|telegram|signal|kik|hangouts|google chat|wechat|viber|snap(?:chat)?|insta(?:gram)?|ig|facebook|messenger|fb|discord|line app|skype|imessage)";

const otherThreats = R("\\bi(?:'?ll| will| am going to|'?m gonna| gonna| m gonna)\\s+(?:kill|hurt|find|ruin|destroy|beat|end|stab|shoot|expose|leak|post)\\b|\\bi know where (?:you|u) (?:live|work|sleep)\\b|\\b(?:you|u)(?:'?ll| will) (?:regret|pay for)\\b|\\b(?:make|making) (?:you|u) (?:regret|pay|sorry)\\b|\\bwatch (?:your|ur) back\\b|\\b(?:you|u)(?:'d| had)? better (?:answer|reply|respond|show|text)\\b|\\b(?:i'?ll |i will )?(?:make sure|let) everyone know|\\b(?:wait|show up|be waiting|come by|turn up)\\s+(?:for (?:you|u) )?(?:outside|at) (?:your|ur) (?:work|office|home|place|apartment|building|job|door)\\b");

export const RELAY_RULES: { code: string; re: RegExp; matches?: (text: string) => boolean }[] = [
  // Money and scams.
  { code: "scam:money", re: R(`\\b${PAY}\\s+(?:me|us)\\b[^.?!]{0,50}${MONEY}`) },
  { code: "scam:money", re: R("\\b(?:can|could|would)\\s+(?:you|u)\\s+(?:please\\s+)?(?:help(?: me)?(?: out)?(?: with)?|cover|spot|lend|loan|pay(?: for)?)\\b[^.?!]{0,40}\\b(?:rent|bills?|fees?|ticket|flight|hospital|medical|money|cash|\\$|bucks|loan|deposit|customs|visa|tuition|phone bill|gas money)\\b") },
  { code: "scam:money", re: R("\\b(?:i|we)\\s+(?:really\\s+|just\\s+)?(?:need|am short|'m short|m short|owe)\\b[^.?!]{0,30}(?:\\$\\s?\\d+|\\d+\\s?(?:dollars|bucks|usd)|\\bmoney\\b|\\bcash\\b)") },
  { code: "scam:money", re: R("\\b(?:western union|moneygram|wire transfer|bank (?:details|account|info|transfer)|routing number|account number)\\b|\\b(?:my|your|ur)\\s+(?:venmo|cash ?app|zelle|paypal)\\b") },
  { code: "scam:money", re: R("\\b(?:venmo|zelle|cash ?app|paypal|wire)\\s+(?:me|us)\\b|\\b(?:cover|help (?:me |us )?(?:with|pay(?:ing)?(?: for)?|cover)|pay(?:ing)? for)\\s+(?:my|our)\\s+(?:rent|bills?|phone bill|electric bill|flights?|tickets?|fees?|hospital bill|medical bills?|tuition|visa|car repair|leave|trip home)\\b|\\bneed (?:some )?help (?:paying|covering|with paying)\\b|\\b(?:receive|accept|cash|deposit)\\s+(?:a |some |the |my )?(?:transfer|check|cheque|payment|package|money|funds)\\s+for (?:me|us)\\b") },
  { code: "scam:gift_card", re: R("\\b(?:gift ?cards?|itunes cards?|apple (?:gift )?cards?|steam cards?|google play cards?|amazon cards?|card codes?|scratch (?:the|off) (?:back|code))\\b") },
  { code: "scam:crypto", re: R("\\b(?:bitcoin|btc|ethereum|usdt|tether|crypto(?:currency)?|binance|coinbase|forex|wallet address)\\b[^.?!]{0,60}\\b(?:invest|profit|returns?|deposit|wallet|send|earn|trading|teach|show you|platform|double|mentor|account|opportunit)") },
  { code: "scam:crypto", re: R("\\b(?:invest|profit|returns?|deposit|earn|trading|teach you|show you|double)\\b[^.?!]{0,60}\\b(?:bitcoin|btc|ethereum|usdt|tether|crypto(?:currency)?|binance|coinbase|forex)\\b") },
  { code: "scam:investment", re: R("\\b(?:guaranteed (?:returns?|profits?)|investment (?:opportunity|platform|plan)|\\d+\\s?% (?:a |per |every )?(?:day|week|month|daily|weekly|monthly)|passive income|financial freedom|(?:uncle|aunt|mentor|cousin) (?:taught|showed) me (?:how )?to (?:trade|invest)|make money (?:fast|online|from home)|trading (?:platform|app|account|signals))\\b") },
  // Scam stories and asks in other words (generalised after the first held-out pass, docs/results/2026-10-09-relay.md section 3).
  { code: "scam:money", re: R("\\b(?:float|spot|front|lend|loan|advance)\\s+(?:me|us)\\s+(?:a (?:bit|little|few|couple|hundred|grand)|some|\\$|\\d|money|cash|the (?:money|cash|rest)|until|till|for)\\b|\\b(?:can'?t|cannot|unable to|not able to)\\s+(?:access|withdraw|get (?:to|at)|release|unlock)\\s+(?:my |our |the )?(?:funds|money|account|salary|savings|inheritance|paycheck)\\b|\\b(?:salary|paycheck|funds|account|card|money|inheritance|wallet)\\s+(?:is |was |got |has been |are |were )?(?:stuck|frozen|blocked|on hold|locked|seized|stolen)\\b|\\b(?:customs|clearance|release|processing|shipping|transfer|tax|delivery)\\s+fees?\\b|\\bhelp\\s+(?:me|us)\\s+(?:out\\s+)?(?:with|pay(?:ing)?|cover(?:ing)?)\\s+(?:the|my|our|a|this)\\s+(?:\\w+\\s+){0,2}(?:fee|fees|bill|bills|rent|deposit|fine)\\b|\\bneed\\s+(?:\\$\\s?\\d+|\\d+\\s?(?:dollars|bucks))\\b") },
  { code: "scam:check", re: R("\\b(?:deposit|cash)\\s+(?:it|this|the|my|a)\\s*(?:check|cheque)?\\b[^.?!]{0,60}\\b(?:send|wire|transfer|give)\\b[^.?!]{0,25}\\b(?:back|difference|rest|remainder)\\b|\\bsend (?:me )?back the (?:difference|rest|remainder|extra)\\b") },
  { code: "scam:investment", re: R("\\b(?:make|making|made|earn|earning|pull in|clear)\\s+(?:like\\s+|about\\s+)?\\$?\\d+(?:k|,\\d{3})?\\s+(?:a|per|every|each)\\s+(?:day|week|month)\\b|\\btrading\\s+(?:gold|forex|stocks|options|futures|silver|oil|crypto)\\b|\\breturns?\\s+(?:are|is|were|have been)\\s+(?:crazy|insane|huge|amazing|unreal|incredible|guaranteed)\\b|\\b(?:set|sign|get)\\s+(?:you|u)\\s+up\\b[^.?!]{0,40}\\b(?:account|platform|app|wallet|trading|invest)|\\bwith my (?:mentor|broker|financial advisor|account manager)\\b") },
  // Moving off-platform (early: only before the first date; see `relayItem`).
  { code: "offplatform:app", re: R(`\\b(?:add|find|message|text|dm|hit|reach|talk|chat|follow|move|switch|continue|download|join|call)\\b[^.?!]{0,30}\\b(?:on|via|over|to|in)\\s+${APPS}\\b`) },
  { code: "offplatform:app", re: R(`\\b${APPS}\\s+(?:me|instead|is (?:easier|better)|is my)\\b|\\b(?:do|have)\\s+(?:you|u)\\s+(?:have|got|use|on)\\s+${APPS}\\b|\\b(?:my|your|ur)\\s+${APPS}\\b`) },
  { code: "offplatform:app", re: R(`\\b(?:download|install|get|use|open|join)\\s+${APPS}\\b`) },
  { code: "offplatform:direct", re: R("\\b(?:text|call|email|message|dm)\\s+me\\s+(?:directly|instead|privately|on my (?:cell|phone))\\b|\\bmy (?:personal|private|other|real|direct) (?:number|phone|email|cell|line)\\b|\\b(?:talk|chat|message|text|continue|move|take this)\\b[^.?!]{0,25}\\b(?:off|outside(?: of)?)\\s+(?:this|the|here|of here)\\b|\\boff (?:this|the) (?:app|platform|site|agent|thing)\\b|\\b(?:without|skip|cut out|bypass) (?:the|this) (?:agent|middleman|app|bot)\\b|\\bnot (?:through|via|on|in|with) (?:this|the) (?:bot|agent|app|middleman|thing)\\b|\\b(?:talk|chat|text|speak)\\s+(?:somewhere|someplace)\\s+(?:private|else)\\b") },
  // Fishing for the other person's contact or location (the approved path is a contact share).
  { code: "fishing:contact", re: R("\\b(?:what'?s|whats|what is|give me|send me|can i (?:get|have)|could i (?:get|have)|drop|share|tell me)\\s+(?:your|ur|her|his|their)\\s+(?:phone ?number|number|phone|cell|digits|email|e-mail|insta|ig|snap|handle|socials?|@|last name|full name|surname)\\b") },
  { code: "fishing:location", re: R("\\bwhere (?:exactly )?do (?:you|u) (?:live|stay|sleep)\\b|\\b(?:your|ur) (?:home |street |exact )?address\\b|\\bwhich (?:building|apartment|apt|street|floor) (?:are|do) (?:you|u)\\b|\\bwhere do (?:you|u) work(?! out)\\b|\\bwhat (?:company|office) do (?:you|u) work (?:at|for)\\b") },
  // Prompt injection aimed at the agent.
  { code: "injection", re: R("\\b(?:ignore|disregard|forget|override)\\s+(?:all\\s+|your\\s+|the\\s+|any\\s+)?(?:previous|prior|above|earlier|system)?\\s*(?:instructions|rules|prompts?|directions|guidelines)\\b|\\b(?:system prompt|developer mode|jailbreak|you are now|pretend (?:you are|to be) (?:the|an?) (?:admin|agent|system))\\b|\\b(?:agent|assistant|bot|ai)\\b[,:]?\\s+(?:please\\s+)?(?:tell|give|send|share|reveal|show)\\s+(?:me|us)\\b[^.?!]{0,40}\\b(?:her|his|their|number|phone|email|address|last name|rating|score|photo)") },
  // Ratings, scores and attractiveness talk (never relayed; nothing like it is ever shared).
  { code: "rating:probe", re: R("\\b(?:how|what)\\b[^.?!]{0,30}\\b(?:hot|attractive|cute|good[- ]looking|pretty|handsome|sexy|ugly)\\b[^.?!]{0,30}\\b(?:rate|rated|rating|score|scored|rank|ranked|grade|graded|think)\\b") },
  { code: "rating:probe", re: R("\\b(?:my|your|ur|her|his|their|our)\\s+(?:rating|score|rank|ranking|percentile|tier|elo|attractiveness|looks? score|hotness|hotness score|desirability)\\b") },
  { code: "rating:probe", re: R("\\b(?:rate|rated|rating|score|scored|rank|ranked|grade|graded)\\s+(?:me|you|u|her|him|them|my (?:looks|face|body|photos?|pics?)|your (?:looks|face|body|photos?|pics?))\\b") },
  { code: "rating:probe", re: R("\\b(?:did|does|do|would|will|can)\\s+(?:the\\s+|your\\s+|this\\s+|ur\\s+)?(?:app|agent|algorithm|algo|matchmaker|ai|system|bot|slop|you|u)\\b[^.?!]{0,40}\\b(?:rate|rated|rates|score|scored|scores|rank|ranked|ranks|grade|grades|graded|think i'?m (?:hot|cute|attractive|ugly)|find me (?:hot|attractive)|consider me (?:hot|attractive))\\b") },
  { code: "rating:probe", re: R("\\b(?:equally|similarly|more|less|as) (?:attractive|hot|good[- ]looking)\\b|\\bsame level of (?:hotness|attractiveness|looks)\\b|\\b(?:my|your|her|his)\\s+(?:number|score|rating)\\s+(?:out of|/)\\s?(?:10|ten)\\b|\\bwhat'?s my number\\b|\\b(?:who|which of us)\\s+(?:scored|ranked|rated|got rated|is rated|was rated)\\b|\\b(?:my|your|our|her|his)\\s+(?:photos?|pics?|pictures?|looks|face|selfies?)\\s+(?:were |was |get |got |are |is |been )?(?:scored|rated|ranked|graded|judged)\\b|\\b(?:rank|ranked|rate|rated|score|scored)\\s+(?:high|higher|low|lower|well|badly|top)\\s+(?:for|on)\\s+(?:looks|appearance|attractiveness)\\b") },
  { code: "rating:probe", re: R("\\bwhat (?:tier|rank|level|score|percentile|rating|number)\\s+(?:am i|are you|are u|is (?:she|he|they|mine|yours))\\b|\\b(?:rate|rates|rated|rank|ranks|ranked|score|scores|scored|grade|grades|graded|judge|judges)\\s+(?:us|people|members|everyone|users)\\s+(?:on|by|for)\\s+(?:looks|appearance|attractiveness|photos?|pics?|faces?|bodies)\\b") },
  { code: "rating:word", re: R("\\bappearance\\s*:|\\bphoto rating\\b|\\b(?:hotness|attractiveness|percentile|clef|body ?type|looks? (?:rating|score|tier|level|match)|(?:out of|in) (?:my|your|ur|her|his|their) league)\\b") },
  { code: "rating:word", re: R("\\b(?:you'?re|ur|you are|she'?s|he'?s|i'?m|im)\\s+(?:a|an|like a)\\s+(?:\\d{1,2}|ten|nine|eight|seven|six|five|solid \\d{1,2})(?:\\s?/\\s?10| out of (?:10|ten))?(?=\\s*(?:$|[.!?,;)]|out of|lol|haha|tbh|honestly|right|though))") },
  // Harassment.
  { code: "harass_severe:threat", re: R(otherThreats.source + "|" + OR_ELSE_THREAT), matches: text => otherThreats.test(text) || hasOrElseThreat(text) },
  { code: "harass_severe:slur", re: R("\\b(?:fag(?:got)?s?|n[i]gg(?:a|er|ah|uh|az)s?|trann(?:y|ie)s?|kikes?|spics?|chinks?|retard(?:ed|s)?|dykes?|wetbacks?|shemales?|towelheads?|raghead)\\b") },
  { code: "harass:insult", re: R("\\b(?:fuck (?:you|off|u)|f off|stfu|bitch|whore|slut|cunt|skank|hoe|piece of shit|go die|kys|kill yourself|nobody (?:would|will|could) (?:ever )?(?:want|love|date|believe) (?:you|u)|(?:you|u)(?:'?re| are|r) (?:so |such an? |an? )?(?:ugly|fat|disgusting|gross|worthless|pathetic|nothing|a joke|trash|garbage|loser|idiot|moron|chubby|hideous))\\b") },
  { code: "harass:insult", re: R("\\b(?:waste of (?:space|air|oxygen|skin)|shut (?:up|ur mouth|your mouth)|(?:you'?d|you would|you'?ll|u'?d|ud) (?:be|look) (?:prettier|hotter|cuter|sexier|thinner|skinnier|more attractive|better looking|less ugly) if|(?:you|u) (?:should|need to|could|gotta) lose (?:some |a little |a bit of )?weight|if (?:you|u) lost (?:some )?weight|(?:you'?re|you are|ur|u r) (?:a |such a |just a )?(?:tease|prude|cocktease|gold ?digger)|typical (?:stuck[- ]up )?(?:bitch|woman|girl|guy|female))\\b") },
  { code: "harass:pressure", re: R("\\b(?:don'?t|do not|stop) (?:you )?(?:dare )?(?:ignore|ignoring|ghost|ghosting|igoring) me\\b|\\bi can see (?:you'?re|you are|u r|ur|that you'?re) (?:online|active|typing|reading)\\b|\\bwhether (?:you|u) like it or not\\b|\\b(?:no ?one|nobody) (?:will|would|is going to|is gonna) believe (?:you|u)\\b|\\b(?:i'?m|i am|i'?ll be|i will be|i'?m gonna be|gonna be|i'?ll wait|i will wait)\\s+(?:waiting\\s+)?(?:outside|at|by|in front of)\\s+(?:your|ur)\\s+(?:building|place|apartment|apt|door|work|office|house|job)\\b|\\b(?:tell|telling|show|showing)\\s+(?:everyone|everybody|all your friends|your friends|people)\\b[^.?!]{0,30}\\b(?:you'?re|you are|ur|about you|what you)\\b|\\b(?:you|u) owe me\\b") },
  { code: "harass:sexual", re: R("\\b(?:send|show)\\s+(?:me\\s+)?(?:nudes?|noods|naughty pics?|(?:a |some |more )?(?:pics?|photos?|pictures?|selfies?) of (?:your|ur) (?:body|tits|boobs|ass|chest|dick|butt|legs|feet)|(?:a |some |more )?(?:body|bikini|lingerie|bed(?:room)?) (?:pics?|photos?|selfies?)|something sexy|a sexy (?:pic|photo))\\b|\\bnudes\\b|\\bnude (?:pics?|photos?|selfies?)\\b|\\bdtf\\b|\\bdon'?t be (?:a |so |such a )?(?:prude|tease|frigid|uptight)\\b|\\b(?:you|u) know (?:you|u) want (?:it|this|me)\\b|\\bwe both know (?:why|what) (?:we'?re|this is|you)\\b|\\b(?:you|u) owe me\\b|\\bwhat are (?:you|u) wearing\\b|\\b(?:bring|wear)\\b[^.?!]{0,15}\\b(?:lingerie|condoms?)\\b|\\b(?:sex|fuck|smash|bang|hook ?up|sleep together|sleep with (?:me|you))\\b[^.?!]{0,40}\\b(?:tonight|first|after|right after|instead|now|before)\\b|\\b(?:skip|forget)\\b[^.?!]{0,15}\\b(?:the )?(?:coffee|date|drinks|dinner|museum|walk)\\b[^.?!]{0,30}\\b(?:my|your) (?:place|apartment|bed)\\b|\\b(?:back to|come over to|come to) (?:my|your) (?:place|apartment|bed|room|hotel)\\b") },
];

// spec/memberAge.md, "A half age needs age wording to confirm an under-13 refusal".
const CURRENT_TEEN_NUMBER = `1[3-7](?![.,]\\d|${AGE_BIRTHDAY_AFTER_AGE}|${AGE_DISTANT_BIRTHDAY_AFTER_AGE})`;

/** A self-disclosed minor age or school year (blocks and flags the age for the platform). */
export const MINOR_SIGNAL = R(`\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?${CURRENT_TEEN_NUMBER}(?!\\s*(?:min|mins|minutes|blocks|miles|mi|km|away|%|stops|floors|hours|hrs|seconds|cm|lbs|k)\\b)(?:\\b|\\s*(?:yo|y/o|years? old)\\b)|(?<!\\d[.,])\\b${CURRENT_TEEN_NUMBER}\\s*(?:yo|y/o|years? old)\\b|\\b(?:i'?m|i am|im) (?:still )?(?:in|at) (?:high school|middle school|hs)\\b|\\bmy (?:mom|dad|parents) (?:won'?t|wont|don'?t|dont) let me\\b|\\bnot 18 (?:yet|until)\\b|\\b(?:i'?m|i am|im) (?:under ?18|underage|a minor)\\b|\\bhomeroom\\b`);

const DIGIT_WORDS: Record<string, string> = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
/** A phone number spelled in words or digits with any separators ("three four seven, five five five, ..."): 7+ digits in a row. */
export function spelledPhone(text: string): boolean {
  const toks = text.toLowerCase().replace(/\b\d{1,2}:\d{2}\b/g, " time ").split(/[^a-z0-9]+/).filter(Boolean);
  let run = 0;
  for (const t of toks) {
    const d = /^\d+$/.test(t) ? t : DIGIT_WORDS[t] !== undefined && t !== "o" && t !== "oh" ? DIGIT_WORDS[t]! : (t === "o" || t === "oh") && run > 0 ? "0" : null;
    if (d === null) { if (run >= 7) return true; run = 0; continue; }
    run += d.length;
  }
  return run >= 7;
}

/** Labels (reason codes) the rules find in a text: classifier and rating rules, plus the minor signal. */
export function classifyRelayText(text: string): { codes: string[]; minorSignal: boolean } {
  const normalized = text.replace(/[’‘`´]/g, "'");
  const vs = textVariants(normalized);
  const codes = new Set<string>();
  for (const { code, re, matches } of RELAY_RULES) if (!codes.has(code) && vs.some(matches ?? (v => re.test(v)))) codes.add(code);
  if (spelledPhone(text)) codes.add("contact:spelled_phone");
  const lower = normalized.toLowerCase();
  const ageText = normalizeAgeInitialism(lower);
  const ageVariants = ageText === lower ? vs : textVariants(ageText);
  return { codes: [...codes], minorSignal: relayMinorAge(text, true) !== undefined || relayMinorEstimate(text) || ageVariants.some(v => MINOR_SIGNAL.test(v)) };
}

// ----------------------------------------------------------------------------------- photo ids
/**
 * A photo reference is an opaque id the platform resolves (its own photo table): 8-64 characters of
 * [A-Za-z0-9_-], never a URL, path, email, phone number or a name with a contact in it. A run of 7 or
 * more digits (separators "-" and "_" ignored: "212-555-0147") reads as a phone number and fails; the
 * platform's id generator (platform/src/photos.ts `newPhotoId`) draws again until its id passes.
 */
export function isOpaquePhotoId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id) && !/\d{7,}/.test(id.replace(/[-_]/g, "")) && !/^(?:https?|www|data|file)/i.test(id);
}

// ------------------------------------------------------------------------------------- guard
/** Build the relay's LeakGuard once per thread: both members' private facts (owner set) and canaries. */
export function relayGuard(o: { facts?: Owned[]; forbidden?: Owned[]; canaries?: string[] } = {}): LeakGuard {
  return new LeakGuard({ facts: o.facts ?? [], forbidden: o.forbidden ?? [], canaries: o.canaries ?? [], canaryShapes: true, contacts: true });
}
const DEFAULT_GUARD = relayGuard();

// ------------------------------------------------------------------------------------ wording
const cleanName = (s: string) => {
  const n = (s ?? "").normalize("NFKC").replace(/[^\p{L}\p{M}' -]/gu, "").trim().split(/\s+/)[0] ?? "";
  return n.length >= 1 && n.length <= 30 ? n : "Your match";
};
/** The agent's wording per kind. `body` is the member's text (text) or caption (photo). */
export const RELAY_WORDING = {
  text: (name: string, body: string) => `${name} says: "${body}"`,
  photo: (name: string, caption?: string) => (caption ? `${name} sent you a photo: "${caption}"` : `${name} sent you a photo.`),
  contact: (name: string, kind: "phone" | "email", value: string) =>
    `${name} asked me to send you their ${kind === "phone" ? "number" : "email"}: ${value}. Say "send them my number" if you want me to send yours back.`,
};
const NOTICE: Record<string, string> = {
  pass: "Sent.",
  contact: "I don't pass contact details on inside a message. If you want them to have your number, say \"send them my number\" and I'll share it.",
  rating: "I can't share anything like that, and I don't pass questions about it on.",
  consent: "I didn't send that. Tell me again that you want me to send it, and I will.",
  rate: "I'll hold that one for a bit; you've sent a lot in a short time.",
  block: "I can't pass that on.",
  hold: "I'm holding that one for a quick check before I pass it on.",
};

const normPhone = (v: string) => { const d = v.replace(/[^\d+]/g, ""); return /^\+?\d{10,15}$/.test(d) ? d : null; };
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}$/;

// ------------------------------------------------------------------------------------- relay
/** Run one item through the relay policy (rules only, synchronous). */
export function relayItem(item: RelayItem, ctx: RelayContext): RelayResult {
  const L = { ...RELAY_LIMITS, ...(ctx.limits ?? {}) };
  const reasons = new Set<string>();
  const { opportunity: op, sender: s, recipient: r } = ctx;
  let ageSignal = false;

  // 1. parties
  if (s.id !== item.from || r.id !== item.to || item.from === item.to || !op.participants.includes(item.from) || !op.participants.includes(item.to)) reasons.add("party:not_participant");
  if (!canBeMatched(s.age) || !canBeMatched(r.age)) reasons.add("minor:party");
  if (ctx.blocked) reasons.add("party:blocked");
  if (r.optedOut) reasons.add("optout:recipient");
  if (s.optedOut) reasons.add("optout:sender");
  if (s.held) reasons.add("safety:sender_held");
  if (r.held) reasons.add("safety:recipient_held");
  // 2. state
  if (op.status !== "mutual") reasons.add(`state:${op.status}`);
  else if (!op.participants.every(p => op.acceptedBy.includes(p))) reasons.add("state:not_mutual");

  // 3. consent and the item itself
  const freshConsent = (kind: RelayConsent["kind"]) => {
    const c = item.consent;
    if (!c) return "consent:missing";
    if (c.kind !== kind || c.by !== item.from || c.itemId !== item.id) return "consent:mismatch";
    if (relayConsentStale(c.at, item.at, L.consentTtlMs)) return "consent:stale";
    return null;
  };
  const text = (item.text ?? "").trim();
  let contactValue: string | null = null;
  let photos: string[] = [];
  if (item.kind === "contact_share") {
    const bad = freshConsent("contact_share");
    if (bad) reasons.add(bad);
    const c = item.contact;
    contactValue = !c ? null : c.kind === "phone" ? normPhone(c.value) : EMAIL.test(c.value.trim()) ? c.value.trim() : null;
    if (!contactValue) reasons.add("contact_share:invalid");
    if (text) reasons.add("contact_share:free_text"); // a contact share carries no free text
  } else if (item.kind === "photo") {
    const bad = freshConsent("photo");
    if (bad) reasons.add(bad);
    photos = [...new Set(item.photoIds ?? [])];
    if (!photos.length || photos.length > L.maxPhotos) reasons.add("photo:count");
    if (photos.some(p => !isOpaquePhotoId(p))) reasons.add("photo:invalid_ref");
    if (!s.photoConsent) reasons.add("photo:no_consent");
    if (photos.some(p => !(s.photoIds ?? []).includes(p))) reasons.add("photo:not_owned");
    if (item.consent?.kind === "photo" && photos.some(p => !(item.consent!.photoIds ?? []).includes(p))) reasons.add("consent:photo_mismatch");
  } else if (item.kind === "text") {
    if (!text) reasons.add("format:empty");
  } else reasons.add("format:kind");

  // 4-5. text checks (a text item, or a photo caption)
  if (text) {
    if (text.length > L.maxChars) reasons.add("text:too_long");
    else {
      const guard = ctx.guard ?? DEFAULT_GUARD;
      const leaks = ctx.recentTexts?.length ? guard.checkThread([...ctx.recentTexts, text], { exceptOwner: item.from }) : guard.check(text, { exceptOwner: item.from });
      for (const l of leaks) {
        if (l.startsWith("contact:")) reasons.add(l);
        else if (l.startsWith("canary:")) reasons.add(`canary:${labelHash(l)}`);
        else if (l.startsWith("format:")) reasons.add(l);
        else reasons.add(`leak:${labelHash(l)}`);
      }
      const c = classifyRelayText(text);
      for (const code of c.codes) {
        // Talk about moving off-platform after the first date is not an early move (contacts are still held).
        if (code.startsWith("offplatform:") && op.metAt !== undefined && op.metAt <= ctx.now) continue;
        reasons.add(code);
      }
      if (c.minorSignal) { reasons.add("minor:signal"); ageSignal = true; }
      for (const code of ctx.extraRules?.(text) ?? []) if (/^[a-z_]+:[a-z0-9_]+$/.test(code)) reasons.add(code);
    }
  }

  // 6. rate limits (attempts by this sender in this opportunity)
  const mine = (ctx.history ?? []).filter(h => h.opportunityId === op.id && h.from === item.from && h.itemId !== item.id);
  if (mine.filter(h => item.at - h.at >= 0 && item.at - h.at < L.burst.windowMs).length >= L.burst.n) reasons.add("rate:burst");
  if (mine.filter(h => item.at - h.at >= 0 && item.at - h.at < 86_400_000).length >= L.daily) reasons.add("rate:daily");
  if (item.kind === "photo" && mine.filter(h => h.kind === "photo" && h.decision === "pass" && item.at - h.at < 86_400_000).length >= L.photosDaily) reasons.add("rate:photos");
  if (item.kind === "contact_share" && mine.filter(h => h.kind === "contact_share" && h.contactShared).length >= L.contactShares) reasons.add("contact_share:already_shared");

  return finish(item, ctx, [...reasons].sort(), { contactValue, photos, text, ageSignal });
}

function finish(item: RelayItem, ctx: RelayContext, reasons: string[], x: { contactValue: string | null; photos: string[]; text: string; ageSignal: boolean }): RelayResult {
  const fam = (r: string) => r.split(":")[0]!;
  // spec/relayDecision.md, "A blocking reason takes precedence over a hold"
  const verdict = relayVerdict(reasons.some(r => BLOCK_PREFIX.has(fam(r))), reasons.length > 0);
  const decision: RelayDecision = verdict === "Block" ? "block" : verdict === "Hold" ? "hold" : "pass";
  const name = cleanName(ctx.sender.firstName);
  let rendered = "";
  if (decision === "pass") {
    rendered = item.kind === "text" ? RELAY_WORDING.text(name, x.text)
      : item.kind === "photo" ? RELAY_WORDING.photo(name, x.text || undefined)
      : RELAY_WORDING.contact(name, item.contact!.kind, x.contactValue!);
  }
  const record: RelayRecord = {
    itemId: item.id, opportunityId: ctx.opportunity.id, app: ctx.opportunity.app, kind: item.kind, from: item.from, to: item.to, at: item.at,
    decision, reasons, photoCount: decision === "pass" ? x.photos.length : 0, contactShared: decision === "pass" && item.kind === "contact_share",
    ageSignal: x.ageSignal, policy: RELAY_POLICY_VERSION,
  };
  const has = (f: string) => reasons.some(r => fam(r) === f);
  const senderNotice = decision === "pass" ? NOTICE.pass!
    : decision === "block" ? (has("consent") ? NOTICE.consent! : NOTICE.block!)
    : has("rating") ? NOTICE.rating! : has("contact") || has("fishing") ? NOTICE.contact! : reasons.every(r => fam(r) === "rate") ? NOTICE.rate! : NOTICE.hold!;
  return { decision, reasons, rendered, photos: decision === "pass" ? x.photos : [], record, senderNotice };
}

/** What a classifier hook sees: the item's text, its kind, and the thread so far (rendered, oldest first). */
export interface RelayClassifierInput {
  text: string;
  kind: RelayKind;
  /** The last few rendered messages (`RelayContext.thread`), oldest first; may be empty. */
  context?: readonly string[];
  /** The pair has met (the first date happened): moving off-platform is not an early move. */
  met?: boolean;
}
/**
 * A hook's answer. `flags` hold the item (`<source>:<flag>`), `block` blocks it
 * (`<source>_severe:<flag>`). `source` is "llm" (default) or "clef". `scores` are for the caller's
 * own metrics; the relay ignores them.
 */
export interface RelayClassifierOutput { flags: string[]; block?: string[]; source?: "llm" | "clef"; scores?: Record<string, number> }
/** An optional model check after the rules. */
export type RelayClassifierHook = (input: RelayClassifierInput) => Promise<RelayClassifierOutput>;

const flagCode = (f: unknown) => String(f).toLowerCase().replace(/[^a-z_]/g, "").slice(0, 24) || "flag";

/**
 * `relayItem`, then the optional hook on an item with text that the rules passed (or held, with
 * `escalateHeld`). The hook only adds reasons: a flag holds, a block flag blocks, nothing lowers the
 * rules' decision, and an item the rules block never reaches the hook. A hook error holds the item
 * (`llm:error`) unless `failOpen` is set.
 */
export async function relayItemAsync(item: RelayItem, ctx: RelayContext, o: { hook?: RelayClassifierHook; failOpen?: boolean; escalateHeld?: boolean } = {}): Promise<RelayResult> {
  const first = relayItem(item, ctx);
  const text = (item.text ?? "").trim();
  if (!o.hook || !text || first.decision === "block" || (first.decision === "hold" && !o.escalateHeld)) return first;
  let out: RelayClassifierOutput;
  try {
    out = await o.hook({ text, kind: item.kind, context: [...(ctx.thread ?? [])], met: ctx.opportunity.metAt !== undefined && ctx.opportunity.metAt <= ctx.now });
  } catch { out = { flags: o.failOpen ? [] : ["error"] }; }
  const src = out?.source === "clef" ? "clef" : "llm";
  const extra = [...new Set([
    ...(out?.flags ?? []).map(f => `${src}:${flagCode(f)}`),
    ...(out?.block ?? []).map(f => `${src}_severe:${flagCode(f)}`),
  ])];
  if (!extra.length) return first;
  return finish(item, ctx, [...new Set([...first.reasons, ...extra])].sort(), { contactValue: null, photos: [], text, ageSignal: first.record.ageSignal });
}

// --------------------------------------------------------------------------- member requests
export type RelayRequest =
  | { kind: "contact_share"; targetName?: string }
  | { kind: "photo"; targetName?: string }
  | { kind: "text"; body: string; targetName?: string }
  | { kind: "none" };

const NEG = /\b(?:don'?t|dont|do not|never|not yet|no need to|stop|shouldn'?t|rather not|hold off|wait (?:to|before)|not until)\b/;
const SHARE_NEG = /\b(?:not going to|not gonna|can'?t|cannot|can not|couldn'?t|wouldn'?t|wasn'?t|didn'?t|mustn'?t|won'?t|not ready to|no way|refuse to|(?:will|would|could|did|should|must|shall|'ll)\s+not)(?!\s+wait\b)\b/;
const HEDGE = /^\s*(?:should i|do you think|is it ok(?:ay)? (?:to|if)|would it be|what if|maybe|if)\b|\b(?:should i|or not)\b/;
const ENVELOPE_CONDITION_MARKER = /\b(?:if|when|once|until|till|unless|after|first|wait|later|yet|not|no|ready|only)\b|n't\b/iu;
const PRIVATE_TIMING_HEDGE = /\b(?:later|after the date|after we meet|eventually|at some point|one day|tomorrow)\b/iu;
const RELAY_NAME = String.raw`(?!(?:me|us|it|everyone|everybody|nobody|anyone|this|that)\b)\p{L}[\p{L}'-]{1,30}`;
const PRIVATE_RELAY_RECIPIENT = String.raw`(?:my (?:match|date)|${RELAY_NAME})`;
const OTHER = String.raw`(?:them|him|her|${PRIVATE_RELAY_RECIPIENT})`;
const CONTACT_SWAP_NAME = "phone number|number|phone|digits|cell|contact(?: info)?";
const PHONE_RELAY_ITEM = /\bmy\s+(?:phone number|number|phone|digits|cell)\b/i;
const RELAY_NAME_CONTINUATION = /^[\p{L}\p{M}\p{N}'-]/u;
const RELAY_DESTINATION_WORDS = String.raw`(?:over\s+to|to|with)\b`;
const RELAY_DESTINATION = String.raw`[\s,:–—-]+${RELAY_DESTINATION_WORDS}`;
const UNPARSED_RELAY_DESTINATION = new RegExp(String.raw`^[\s,:;.!?–—()[\]/"'“”-]*(?:directly\s+to\b|${RELAY_DESTINATION_WORDS})`, "iu");
const RELAY_WITH_THANKS = /^\s*,?\s*with\s+thanks\s*[.!]*\s*$/iu;
const CONTACT_REQ = new RegExp(
  String.raw`\b(?:send|give|share|pass|forward|text)\s+(?<leadingRecipient>${PRIVATE_RELAY_RECIPIENT})\s+my\s+(?:${CONTACT_SWAP_NAME}|email)\b`
  + String.raw`|\b(?:share|send|give|pass|forward|text)\s+my\s+(?:${CONTACT_SWAP_NAME}|email)\s+(?:with|to)\s+(?<trailingRecipient>${PRIVATE_RELAY_RECIPIENT})`
  + String.raw`|^\s*(?:yes|yeah|yep|ok|okay|sure)[,!.]?\s+(?:send|share|give)\s+(?:it|my number|them my number)\b(?:${RELAY_DESTINATION}\s+(?<affirmedRecipient>${PRIVATE_RELAY_RECIPIENT})|(?!${RELAY_DESTINATION}))`
  + String.raw`|\b(?:they|she|he) can have my (?:number|digits|phone number)\b`,
  "giu",
);
const PHOTO_REQ = new RegExp(
  String.raw`\b(?:send|share|forward|pass|show)\s+(?<leadingRecipient>${PRIVATE_RELAY_RECIPIENT})\s+(?:this|that|the|my|these)\s+(?:photos?|pics?|pictures?|selfies?|images?)\b`
  + String.raw`|\b(?:send|share|forward|pass|show)\s+(?:this|that|the|these|my)\s+(?:photos?|pics?|pictures?|selfies?|images?)\s+(?:to|with)\s+(?<trailingRecipient>${PRIVATE_RELAY_RECIPIENT})`,
  "giu",
);
const DIRECT_RELAY_LEAD = /^\s*(?:(?:yes|yeah|yep|ok|okay|sure|please|kindly|pls|just)[,\s:]+)*(?:(?:(?:can|could|would|will)\s+(?:you|u)(?:\s+(?:please|kindly|pls))?|go ahead(?: and)?|feel free to|you (?:can|may)|i (?:want|need|would like) you to|i'd like you to)\s+)?$/i;
const RELAY_ASIDE = /^\s*i(?:'ll\s+not|\s+(?:can'?t|cannot|couldn'?t|didn'?t|mustn'?t|won'?t|wouldn'?t|(?:can|could|did|will|would|must)\s+not))\s+\S/i;
const INCOMPLETE_RELAY_ASIDE = /\b(?:to|that|if|and|or|because|for|with)\s*$/i;
const RELAY_SPEECH_CUE = /\b(?:say|says|said|tell|tells|told|ask|asks|asked|asking|hear|heard|quote|quoted|reply|replied|repeat|repeated|report|reported|instruct|instructed|request|requested|let|letting)\b/i;

const RELAY_MODAL = /^(?:please\s+)?(?:can|could|would)\s+(?:you|u)\s+(?:please\s+)?/i;
const TEXT_REQ = new RegExp(`^(?:please\\s+)?(tell|let|ask)\\s+(${OTHER})\\s+(know\\s+)?(?:that\\s+)?(.{2,})$`, "isu");
const COLON_TEXT_REQ = new RegExp(`^(?:please\\s+)?(tell|let|ask)\\s+(${OTHER})(\\s+know)?\\s*:\\s*(.{2,})$`, "isu");
const POSSIBLE_COLON_NAME_TAIL = /^[\p{L}\p{M}'-]+(?:[ \t]+\p{Lu}[\p{L}\p{M}'-]*)*[ \t]*:/u;
const TEXT_PRIVATE_DIRECTIVE_LEAD = /^\s*(?:(?:\p{L}[\p{L}'-]*\s+)?to\s+|you\s+(?:can|may|should|must)\s+)?(?:(?:please|just|kindly|pls)\s+)*$/iu;
const IMPLICIT_RELAY_TARGET = /^(?:them|him|her|my (?:match|date))$/i;
const SHARE_CONDITION = /\b(?:if|when)\s+(?:she|he|they|my (?:match|date))(?:(?:'s|'re)|\s+(?:is|are))?\s+(?:asks?|wants?|requests?|ready|interested|says?\s+(?:so|yes|ok(?:ay)?))\b/;
const SHARE_DEFERRED = /\b(?:(?:when|once)\s+(?:we(?:'re)?|i)\s+(?:meet|see\s+(?:him|her|them|each other)|get together|together)|after\s+(?:our|my|the)\s+(?:first\s+)?date|next\s+(?:week|month)|this\s+(?:week|weekend)|in a (?:few days|week|month)|(?:on|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/;
const SHARE_QUALIFIER = new RegExp(String.raw`^[\s,:]*(?:(?:only|please)\s+)*(?:${SHARE_CONDITION.source}|${SHARE_DEFERRED.source})`);

// The scoped condition reader handles textual qualifiers. Keep the explicit calendar forms here.
const SHARE_TRAILING_CALENDAR = new RegExp(String.raw`^[\s,:]*(?:(?:only|please)\s+)*(?!(?:when|once|after)\b)(?:${SHARE_DEFERRED.source})`);

function privateShareQualified(text: string, request: RegExpMatchArray): boolean {
  const index = request.index!;
  const after = text.slice(index + request[0].length).toLowerCase();
  if (SHARE_TRAILING_CALENDAR.test(after)) return true;

  // A leading qualifier must end at the request. Leave prior sentences outside its scope.
  const before = text.slice(0, index).toLowerCase().split(/[.!?;]+/).at(-1) ?? "";
  const qualifier = SHARE_QUALIFIER.exec(before);
  return qualifier !== null && /^[\s,:]*$/.test(before.slice(qualifier[0].length));
}

const SWAP_GO_AHEAD = /\b(?:don'?t|do\s+not)\s+(?:mind|care|wait|worry|hesitate|delay|hold back)\b|\bstop asking\b|\bnever had\b|\bno (?:problem|worries|prob|rush|hurry)\b|\bnot a problem\b|\bno need to (?:wait|hesitate)\b|\b(?:will|would|could|did|should|must|shall|'ll)\s+not\s+wait\b|\b(?:can'?t|cannot|won'?t|mustn'?t)\s+wait\b/g;
const SWAP_WITHHOLDING = /\b(?:no|not|don'?t|dont|do not|never|stop|cancel|hold off|rather|keep|changed my mind|never ?mind|nvm|take back|scratch)\b/;
const OWN_SWAP_ITEM = new RegExp(String.raw`\b(?:my (?:${CONTACT_SWAP_NAME})|(?:number|numbers) swap|(?:the|that|our) swap|swap(?:ping)? numbers)\b`);
const SWAP_PROPERTY = new RegExp(OWN_SWAP_ITEM.source + "\\s+(?:(?:is|stays?|remains?)\\s+(?:private|off limits)|can wait)\\b");
const SWAP_REFUSAL_VERB = /\b(?:refus(?:e|ed|ing)|declin(?:e|ed|ing))\s+(?:(?:to\s+)?(?:send|share|give|pass|forward|text)\b|(?:the|that|our)\s+(?:numbers?\s+)?swap\b)/;
const TRANSFER = "send|share|give|pass|forward|text|disclose|reveal";
const SWAP_MODAL_REFUSAL = new RegExp(SHARE_NEG.source + "\\s+(?:ever\\s+)?(?:" + TRANSFER + ")\\b");
const REFUSES_MATCH_ACCESS = new RegExp("\\b(?:they|he|she)\\s+" + SHARE_NEG.source + "\\s+(?:have|get)\\b");
const PENDING_SWAP_RECIPIENT = "(?:them|him|her|my (?:match|date))";
const DIRECT_TRANSFER_REFUSAL = String.raw`(?:(?:don'?t|do\s+not)(?:\s+(?:want\s+(?:you\s+)?to|(?:you\s+)?dare))?|never|${SHARE_NEG.source})`;
const DECLINES_PENDING_SEND = new RegExp(
  String.raw`^\s*(?:(?:actually|please|pls|i|no|never mind|nvm)\s+)*(?:i(?='ll\b))?` +
  String.raw`${DIRECT_TRANSFER_REFUSAL}\s+(?:${TRANSFER})(?:\s+out)?\s+` +
  String.raw`(?:(?:it|that)(?:\s+(?:to|with)\s+${PENDING_SWAP_RECIPIENT})?|${PENDING_SWAP_RECIPIENT}\s+(?:it|that|anything))` +
  String.raw`(?:\s+(?:yet|please|pls|any\s?more|now|after all))*\s*$`,
);
const CONTACT_RELAY_NAME = CONTACT_SWAP_NAME + "|email";
const PHOTO_RELAY_NAME = "photos?|pics?|pictures?|selfies?|images?";
const CONTACT_RELAY_ITEM = String.raw`my\s+(?:${CONTACT_RELAY_NAME})`;
const PHOTO_RELAY_ITEM = String.raw`(?:this|that|the|my|these)\s+(?:${PHOTO_RELAY_NAME})`;
const PRIVATE_RELAY_ITEM = new RegExp(String.raw`\b(?:${CONTACT_RELAY_ITEM}|${PHOTO_RELAY_ITEM})\b`, "u");

// Exempt a refusal only when the other item is the transfer verb's complete object.
function explicitPrivateItemRefusal(item: string): RegExp {
  return new RegExp(
    String.raw`^\s*(?:(?:actually|please|pls)\s+)*(?:i(?:\s+|(?='ll\b)))?` +
    String.raw`(?:${DIRECT_TRANSFER_REFUSAL}|${NEG.source})\s+(?:ever\s+)?(?:${TRANSFER}|show)\s+` +
    String.raw`(?:${OTHER}\s+)?${item}(?:\s+(?:to|with)\s+${OTHER})?` +
    String.raw`(?:\s+(?:yet|please|pls|now))*\s*$`,
    "u",
  );
}
const CONTACT_ITEM_REFUSAL = explicitPrivateItemRefusal(CONTACT_RELAY_ITEM);
const PHOTO_ITEM_REFUSAL = explicitPrivateItemRefusal(PHOTO_RELAY_ITEM);
// The possessive also governs the bare contact item in "my photo or number".
const PAIRED_CONTACT_REFUSAL = explicitPrivateItemRefusal(
  String.raw`(?:either\s+)?my\s+(?:${PHOTO_RELAY_NAME})\s+(?:and|or|nor)\s+(?:${CONTACT_SWAP_NAME})`,
);
const PRIVATE_RELAY_ACTION = /\b(?:send(?:ing)?|sent|shar(?:e|ing)|giv(?:e|ing)|pass(?:ing)?|forward(?:ing)?|show(?:ing)?|text(?:ing)?)\b/;
const PRIVATE_RELAY_REFERENCE = new RegExp(
  String.raw`\b(?:send(?:ing)?|shar(?:e|ing)|giv(?:e|ing)|pass(?:ing)?|forward(?:ing)?|show(?:ing)?|text(?:ing)?)\s+` +
  String.raw`(?:${PENDING_SWAP_RECIPIENT}\s+)?(?:it\b|(?:that|this)\b(?=\s*(?:$|(?:to|with|yet|please|pls|now)\b)))`,
);
const PRIVATE_RELAY_DOUBT = "not sure|not certain|not comfortable|unsure|uncertain|undecided";
const PRIVATE_RELAY_UNCERTAIN = new RegExp(String.raw`\b(?:${PRIVATE_RELAY_DOUBT}|second thoughts)\b`);
const INCOMPLETE_PRIVATE_UNCERTAINTY = new RegExp(
  String.raw`^\s*(?:(?:i(?:'m| am| feel)\s+)?(?:${PRIVATE_RELAY_DOUBT})|i(?: have|'m having| am having)\s+second thoughts)\s*$`,
);
const uncertainPrivateTransfer = (clauses: readonly string[]): boolean => clauses.some(clause =>
  INCOMPLETE_PRIVATE_UNCERTAINTY.test(clause)
  || (PRIVATE_RELAY_UNCERTAIN.test(clause) && (PRIVATE_RELAY_ITEM.test(clause) || PRIVATE_RELAY_REFERENCE.test(clause))));

const INCOMPLETE_SHARE_REFUSAL = new RegExp(SHARE_NEG.source + "\\s*$");
const RELAY_CLAUSE = /[,;.!?\n]+|\b(?:but|however)\b/;
const RELAY_SENTENCE_MARKS = String.raw`.!?;…\n`;
const RELAY_SENTENCE = new RegExp(`[${RELAY_SENTENCE_MARKS}]+`);
const RELAY_SENTENCE_TEXT = new RegExp(`[^${RELAY_SENTENCE_MARKS}]+`, "g");
const TEXT_PAYLOAD_END = new RegExp(String.raw`^[\s\S]*[${RELAY_SENTENCE_MARKS}]`, "u");
const TEXT_PAYLOAD_COLON = /(?<!\d):|:(?!\d)/u;
const PRIOR_ASSENT_NAME = String.raw`(?!(?:i|we|you|me|us|it|this|that|she|he|they|them|him|her)\b)[\p{L}][\p{L}'-]{1,30}`;
const PRIOR_ASSENT_ACTOR = String.raw`(?<actor>she|he|they|them|him|her|my\s+(?:match|date)|${PRIOR_ASSENT_NAME})`;
const PRIOR_ASSENT_ACTION = String.raw`(?:(?<action>agree|approve|ask|request|consent)s?|says?\s+(?:yes|ok(?:ay)?|so))`;
const PRIOR_ASSENT_ITEM = String.raw`(?:\s+(?!first\b)(?<item>.+?))?`;
const PRIOR_ASSENT_CONDITIONS = [
  String.raw`${PRIOR_ASSENT_ACTOR}\s+(?:(?:has|have)\s+to|needs?\s+to|must|has\s+got\s+to)\s+${PRIOR_ASSENT_ACTION}${PRIOR_ASSENT_ITEM}(?:\s+first)?`,
  String.raw`${PRIOR_ASSENT_ACTOR}\s+${PRIOR_ASSENT_ACTION}${PRIOR_ASSENT_ITEM}\s+first`,
  String.raw`wait\s+for\s+${PRIOR_ASSENT_ACTOR}\s+to\s+${PRIOR_ASSENT_ACTION}${PRIOR_ASSENT_ITEM}(?:\s+first)?`,
  String.raw`(?:only\s+after|(?<unless>unless))\s+${PRIOR_ASSENT_ACTOR}\s+${PRIOR_ASSENT_ACTION}${PRIOR_ASSENT_ITEM}(?:\s+first)?`,
].map(condition => new RegExp(`^(?:please\\s+)?${condition}$`, "iu"));
const PRIOR_ASSENT_COMPLETED = new RegExp(String.raw`^(?<actor>${PRIOR_ASSENT_NAME})\s+(?:(?:has|have)\s+)?(?:already\s+)?(?:(?<shortAction>agree|approve)d|(?<longAction>ask|request|consent)ed)(?:\s+already)?${PRIOR_ASSENT_ITEM}$`, "iu");
const PRIOR_SENDER_CONFIRM = /^(?:please\s+)?wait\s+until\s+i\s+(?:confirm|approve)\s+(?:(?:that\s+)?you\s+can\s+)?/u;
const PRIOR_CONTACT_SWAP = /^(?:(?:the|this|our)\s+)(?:(?:phone\s+)?number\s+)?swap$/u;
const PRIOR_ASSENT_CONTINUATION = /,\s*(?:and|but|however|yet)\b/iu;

function priorAssentItemKey(value: string, request: RegExpMatchArray, contact: boolean): string | undefined {
  const item = value.replace(/^(?:for|to)\s+/u, "");
  if (/^(?:it|this|that|me|us)$/u.test(item) || (contact && PRIOR_CONTACT_SWAP.test(item))) return item;
  const words = item.replace(/^(?:me\s+)?(?:shar(?:e|ing)|send(?:ing)?|giv(?:e|ing)|forward(?:ing)?|pass(?:ing)?|show(?:ing)?|text(?:ing)?)\s+/u, "");
  const directive = "send " + words;
  const transfer = linkedPrivateTransfer(directive);
  if (!transfer || transfer[0] !== directive || !linkedTransferMatchesRequest(transfer, request, contact)) return;
  // Use the transfer shape to check scope without replacing the member's item or recipient words.
  return item;
}

function assentKey(actor: string, action: string, item: string): string {
  return actor + " " + action + " " + item;
}

// spec/relayDecision.md, "A refusal or uncertainty cannot authorize a private item"
function priorSentenceConditionsShare(source: string, request: RegExpMatchArray, contact: boolean): boolean {
  const prefix = source.slice(0, request.index!).replace(/[“”]/g, '"')
    .replace(RELAY_QUOTATION, quotation => " ".repeat(quotation.length - 1) + quotedRelaySeparator(quotation));
  const waits = new Set<string>();
  for (const part of prefix.matchAll(RELAY_SENTENCE_TEXT)) {
    const end = part.index! + part[0].length;
    if (end === prefix.length) continue;
    const continuation = part[0].search(PRIOR_ASSENT_CONTINUATION);
    const opening = continuation < 0 ? part[0] : part[0].slice(0, continuation);
    if (opening !== source.slice(part.index, part.index! + opening.length)) continue;
    const sentence = opening.trim().toLowerCase().replace(/(?:,\s*|\s+)(?:please|thanks|thank you)$/, "");
    const confirm = PRIOR_SENDER_CONFIRM.exec(sentence);
    if (confirm) {
      const item = sentence.slice(confirm[0].length);
      const transfer = linkedPrivateTransfer(item);
      if ((contact && PRIOR_CONTACT_SWAP.test(item))
        || (transfer && transfer[0] === item && linkedTransferMatchesRequest(transfer, request, contact))) return true;
    }
    const condition = PRIOR_ASSENT_CONDITIONS.map(pattern => pattern.exec(sentence)?.groups).find(Boolean);
    if (condition) {
      const item = condition.item ? priorAssentItemKey(condition.item, request, contact) : "";
      if (item === undefined) {
        // A prerequisite involving another private item still holds this transfer.
        if (priorAssentItemKey(condition.item!, request, !contact) !== undefined) return true;
        continue;
      }
      if (condition.unless || !condition.action) return true;
      waits.add(assentKey(condition.actor!, condition.action, item));
      continue;
    }
    // A later assertion must identify the same actor and action to settle a wait.
    const completed = continuation < 0 && PRIOR_ASSENT_COMPLETED.exec(sentence)?.groups;
    if (completed && !/^[\s.!?;…]*\?/u.test(source.slice(end))) {
      const item = completed.item ? priorAssentItemKey(completed.item, request, contact) : "";
      if (item !== undefined) waits.delete(assentKey(completed.actor!, (completed.shortAction ?? completed.longAction)!, item));
    }
  }
  return waits.size > 0;
}

function envelopeConditionUnsettled(body: string): boolean {
  let open = false;
  for (const part of body.matchAll(RELAY_SENTENCE_TEXT)) {
    const sentence = part[0].trim().toLowerCase();
    if (!sentence) continue;
    if (PRIOR_ASSENT_COMPLETED.test(sentence)) { open = false; continue; }
    if (ENVELOPE_CONDITION_MARKER.test(sentence)) open = true;
  }
  return open;
}

const PRIVATE_RELAY_OBJECT = String.raw`(?:(?:(?:my|the|this|that|these|a|any)\s+)?(?:${CONTACT_RELAY_NAME}|${PHOTO_RELAY_NAME})|it|this|that|them|either|both|anything(?:\s+else)?)`;
const CONTINUES_PRIVATE_REFUSAL = new RegExp(
  String.raw`^\s*(?:(?:or|nor|neither)\b|(?:and|also|not|same(?:\s+goes)?\s+(?:for|with))\s+${PRIVATE_RELAY_OBJECT}\b|` +
  String.raw`(?:nothing else|likewise|${PRIVATE_RELAY_OBJECT}\s+(?:either|neither|too|as well))\s*$)`,
  "u",
);
const RELAY_SHORT_RETRACTION = "no|wait|cancel|(?:hold|hang) on";
const RELAY_EXPLICIT_RETRACTION = "scratch that|cancel that|take that back|never ?mind|nvm|i(?:'ve| have)? changed my mind|forget it|keep it private";
const RELAY_LATE_DOUBT = "maybe|hmm|idk|(?:i(?:'m| am) )?(?:not ready|reconsidering)|on second thought|let me think|ugh actually";
const RELAY_UNPUNCTUATED_DOUBT =
  String.raw`(?:(?:let me|lemme) think(?:\s+(?:(?:about|on|over|through)\s+(?:it|this|that|him|her|them)|it over|for a (?:sec(?:ond)?|bit|minute)))?(?:\s+(?:first|(?:some )?more|again|a bit|tonight|and get back to you))?`
  + String.raw`|on second thought\s+(?:no|i(?:'ll|\s+(?:should|will))\s+wait)|hmm\s+idk)\s*(?:[,;:–—]\s*|$)`;
const COLLOQUIAL_RETRACTION = /^[,\s–—]*(?:lol|haha|ok(?:ay)?|oh|ugh|nah|hmm)[,\s]+(?:never ?mind|nvm|wait\s*[,–—]\s*no)\b(\s*[,;:–—]\s*|\s*)/iu;
const COLLOQUIAL_RETRACTION_REASON = /^(?:i|we|he|she|they)\b/iu;
const COLLOQUIAL_RETRACTION_ITEM = new RegExp(
  String.raw`^(?:about\s+)?(?:(?:my|the|this|that|these)\s+)?(?:(?<contact>${CONTACT_RELAY_NAME})|${PHOTO_RELAY_NAME})\b\s*(?:[,;:–—]|$)`,
  "iu",
);
const RELAY_STOP_SYMBOL = String.raw`[❌❎🚫🛑👎][\p{M}\p{Emoji_Modifier}]*`;
const RELAY_ITEM_SYMBOL = String.raw`[📞📸][\p{M}]*`;
const RELAY_MARKED_STOP = String.raw`(?:${RELAY_STOP_SYMBOL}(?:\s*${RELAY_ITEM_SYMBOL})?|${RELAY_ITEM_SYMBOL}\s*${RELAY_STOP_SYMBOL})`;
const LATE_PRIVATE_RETRACTION = new RegExp(
  String.raw`^[,\s–—]*(?:(?:actually|wait|sorry)[,\s]+)?(?:${RELAY_SHORT_RETRACTION}|${RELAY_EXPLICIT_RETRACTION}|${RELAY_LATE_DOUBT}|` +
  String.raw`(?:${RELAY_MARKED_STOP}\s*)+)` +
  String.raw`(?:[,\s]+(?:please|pls|thanks|sorry))?\s*$`,
  "iu",
);
const LATE_ORPHAN_QUESTION = /[.!;…\n][ \t]*\?{2,}[ \t]*(?=$|[.!;…\n])/u;
// Short cues need punctuation to mark a retraction. "Wait in the lobby" is a different request.
const LATE_PRIVATE_RETRACTION_LEAD = new RegExp(
  String.raw`^[,\s–—]*(?:and\s+)?(?:(?:actually|wait|sorry)[,\s]+)?(?:(?:${RELAY_SHORT_RETRACTION}|${RELAY_LATE_DOUBT})\s*[,;:–—]\s*|` +
  String.raw`(?:${RELAY_EXPLICIT_RETRACTION})[,;:\s–—]+|${RELAY_UNPUNCTUATED_DOUBT})`,
  "iu",
);
const LATE_PRIVATE_STOP_LEAD = new RegExp(String.raw`^[,\s–—]*${RELAY_MARKED_STOP}[,;:\s–—]+`, "u");
const PRIVATE_RENEWAL_ANCHOR = new RegExp(
  String.raw`^\s*(?:(?:actually|sorry)[,\s]+)?(?:${RELAY_SHORT_RETRACTION}|scratch that|take that back)(?:[,\s]+(?:please|pls|thanks|sorry))?\s*$`,
  "iu",
);
const TERMINAL_PRIVATE_RETRACTION = /\b(?:never ?mind|nvm)\b/iu;
const PRIVATE_RENEWAL_CORRECTION = /^\s*(?:(?:actually|sorry)[,\s:]+)?/iu;
const INDEPENDENT_RENEWAL_STATUS = /^(?:(?:i am|we are) (?:running late|at (?:work|home|the office|the station)|on (?:my|our) way)|(?:i|we) have (?:arrived|left)|(?:i|we)(?:'ll| will) be there|the (?:restaurant|caf[eé]|venue|office|station) is (?:open|closed))$/u;
const UNRESOLVED_RENEWAL_PAYLOAD = /\b(?:it|this|that|either|both|instead|ask(?:ing)?|confirm(?:ing)?|wait(?:ing)?|delay(?:ing)?|get back to you|transfer|decid(?:e|ed|ing)|(?:re)?think(?:ing)?|reconsider(?:ing)?|not ready|maybe|perhaps|doubts?|hesitant|torn|conflicted|on the fence|recipient|destination|permission|approval|consent|private)\b/u;
const RENEW_PRIVATE_ITEM = new RegExp(String.raw`\bsend\s+(it|${CONTACT_RELAY_ITEM}|${PHOTO_RELAY_ITEM})\b`, "giu");
const PRIVATE_RELAY_COURTESY = /^(?:[,\s]+(?:now|please|pls|kindly|thanks|thank you|no (?:rush|worries|problem)))*\s*$/i;
const FLEXIBLE_PRIVATE_TIMING = String.raw`whenever|any\s*time`;
const RECURRING_PRIVATE_CONDITION = String.raw`${FLEXIBLE_PRIVATE_TIMING}|(?:(?:each\s+and\s+)?every(?:\s+single)?|each)\s+time`;
const PRIVATE_CONDITION_MARKER = String.raw`if|when|${RECURRING_PRIVATE_CONDITION}|unless|once|after|until|provided|as\s+long\s+as|in\s+case`;
const TRAILING_PRIVATE_CONDITION = new RegExp(
  String.raw`^[\s,:–—-]*(?:(?:and|but|now|please|kindly|pls|just|thanks)[\s,:–—-]+)*(\(\s*)?((?:only\s+)?(?:${PRIVATE_CONDITION_MARKER})\b.*)$`,
  "iu",
);
const POLITE_PRIVATE_CONDITION = new RegExp(
  String.raw`^(?:if\s+(?:you\s+(?:can|could|don't mind)|you(?:'re| are)\s+able to|(?:it|that)(?:'s| is)\s+(?:ok(?:ay)?(?: with you)?|convenient for you)|possible)|(?:when|${RECURRING_PRIVATE_CONDITION})\s+you\s+(?:can|get a chance|have a chance))\b|^(?:${FLEXIBLE_PRIVATE_TIMING})(?:\s+(?:works|is\s+(?:fine|good|ok(?:ay)?)|you(?:'re| are)\s+ready))?\b`,
  "iu",
);
const PRIVATE_CONDITION_MAIN = new RegExp(String.raw`^(?:only\s+)?(?:${PRIVATE_CONDITION_MARKER})\b[^,]+,\s*(\S.*)$`, "iu");
const PRIVATE_CONDITION_STATEMENT = /^(?:(?:i|we|he|she|they|it|the|my)\b.+?\b(?:is|are|can|will|have|has|am)|(?:i|we)'ll)\s+\S/iu;
const PRIVATE_CONDITION_FACT = /^(?!(?:(?:the|my)\s+)?(?:send|share|relay|forward)\b)[^,]+?\s+(?:is|are)\s+(?:(?:in|on|at)\s+(?:the|an?)\s+\S|(?:free|available|closed)\s*$)/iu;
const PRIVATE_CONDITION_FOLLOWUP = /^(?:please\s+)?let me know\s*$/iu;
const PRIVATE_RESPONSE_FOLLOWUP = new RegExp(
  String.raw`^(?:${RECURRING_PRIVATE_CONDITION})\s+${OTHER}\s+(?:repl(?:y|ies)|responds?|reports?\s+(?:an?|the)\s+(?:problem|issue))\s*,\s*(?:please\s+)?tell me(?:\s+how it went)?\s*$`,
  "iu",
);
const INDEPENDENT_WHEN_QUESTION = /^when(?:ever)?\s+(?:is|are|do|does|did|can|could|will|would|should|have|has)\s+\S/iu;
const PRIVATE_CONDITION_ITEM_NAME = new RegExp(String.raw`\b(?:${CONTACT_RELAY_NAME}|${PHOTO_RELAY_NAME})\b`, "u");
const INCOMPLETE_CONDITION_ACTION = new RegExp(
  String.raw`\b(?:(?:do|handle|take care of)(?:\s+(?:it|that|this))?|(?:${TRANSFER}|show|tell)|tell\s+${OTHER}\s+(?:it|that|this))(?:\s+(?:now|then|myself))?\s*$`,
  "u",
);
const LINKED_PRIVATE_REFERENCE = String.raw`(?:it|(?:this|that)(?=$|[.,:;!?]|\s+(?:to|with|now|please|pls|${PRIVATE_CONDITION_MARKER})\b))`;
const LINKED_PRIVATE_OBJECT = String.raw`(?:(?<contact>${CONTACT_RELAY_ITEM}|(?:this|that|the)\s+(?:${CONTACT_RELAY_NAME}))|(?<photo>${PHOTO_RELAY_ITEM})|${LINKED_PRIVATE_REFERENCE})\b`;
const LINKED_PRIVATE_SEND = new RegExp(
  String.raw`\b(?:${TRANSFER}|show)\s+(?:(?<recipient>${OTHER})\s+)?${LINKED_PRIVATE_OBJECT}(?:\s+(?:to|with)\s+(?<destination>${OTHER}))?`, "iu",
);
const LINKED_PRIVATE_ACCESS_LEAD = String.raw`\b(?!(?:you|u|we|i)\b)(?<recipient>${OTHER})\s+(?:can|could|may|will)\s+(?:have|get|receive)\s+`;
const LINKED_PRIVATE_ACCESS = new RegExp(String.raw`${LINKED_PRIVATE_ACCESS_LEAD}${LINKED_PRIVATE_OBJECT}`, "iu");
const NAMED_CONDITION_ACCESS = new RegExp(
  String.raw`^${LINKED_PRIVATE_ACCESS_LEAD}(?:the|this|that)\s+(?<object>(?:(?!(?:and|or|but|then|to|with)\b)[\p{L}'-]+(?:\s+|$))+)\s*$`, "iu",
);
const LINKED_PRIVATE_LEAD = /^[\s,:–—]*(?:(?:and|but|then|only)[,\s:–—]+)*/iu;
const PRIVATE_RECIPIENT_REFERENCE = /^(?:he|she|they|him|her|them|my\s+(?:match|date))$/i;
const PRIVATE_NOTICE_THEN = /^\s*(?:please\s+)?(?:tell\s+(?:me|us)|let\s+(?:me|us)\s+know)\s+[^,]+,\s*(?=then\b)/iu;
const LINKED_PRIVATE_TIME = /^[\s,–—]*(?:on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+week|at\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight|(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*[ap]m)?))\b/iu;
const PRIVATE_RELAY_POST_ATTRIBUTION = /^\s*[,–—]\s*(?:(?!(?:i|we)\b)\p{L}[\p{L}'-]*\s+){1,3}(?:says?|said)\s*$/iu;
const PRIVATE_RELAY_CORRECTION = /^[,\s–—]*(?:instead|rather|actually|no)[,\s:]+/i;
// A quotation can contain a refusal or a command, but it does not speak for the member.
const RELAY_QUOTATION = /(?<!\d)"[^"]*(?:"|$)|(?<![a-z0-9])'(?:[^']|(?<=[a-z0-9])'(?=[a-z0-9]))*(?:'|$)/gi;

const quotedRelaySeparator = (quotation: string): string => /[.!?…]\s*["']$/.test(quotation) ? ";" : " ";

// Keep offsets so a request can be compared with the actual words before it.
const ownRelayWords = (text: string): string => text.replace(/[“”]/g, '"')
  .replace(RELAY_QUOTATION, quotation => " ".repeat(quotation.length));

function relaySentenceBoundaries(text: string): string {
  return text.replace(RELAY_QUOTATION, quotation => quotedRelaySeparator(quotation).padStart(quotation.length, " "));
}

function independentPhoneBoundary(prefix: string, markedPayload: boolean): number | undefined {
  const normalized = prefix.replace(/[“”]/g, '"');
  const end = TEXT_PAYLOAD_END.exec(relaySentenceBoundaries(normalized))?.[0].length;
  if (end === undefined) return undefined;

  const colon = ownRelayWords(normalized.slice(0, end)).search(TEXT_PAYLOAD_COLON);
  if (markedPayload || colon >= 0) {
    const payload = normalized.slice(colon + 1, end).trim();
    const quotation = payload.match(RELAY_QUOTATION)?.[0];
    if (!quotation || quotation.length < 2 || quotation[0] !== quotation.at(-1)
      || !payload.startsWith(quotation) || !/^[\s.!?;…]*$/u.test(payload.slice(quotation.length))) return undefined;
  }
  return end;
}

function independentWithdrawalBoundary(payload: string, markedPayload: boolean): number | undefined {
  const words = relaySentenceBoundaries(payload.replace(/[“”]/g, '"'));
  for (const part of words.matchAll(RELAY_SENTENCE_TEXT)) {
    const refusal = part[0].trim().toLowerCase().split(/\s+because\s+|,\s*(?=(?:please|pls)\s*$)/u, 1)[0]!;
    const namesNumber = CONTACT_ITEM_REFUSAL.test(refusal) && OWN_SWAP_ITEM.test(refusal);
    if (!namesNumber && !DECLINES_PENDING_SEND.test(refusal)) continue;
    if (words.slice(part.index + part[0].length).startsWith("?")) continue;
    const end = independentPhoneBoundary(payload.slice(0, part.index), markedPayload);
    if (end !== undefined) return end;
  }
}

function relayClauseLead(prefix: string): string {
  // Treat a complete quoted sentence as a boundary without reading its words as consent.
  return prefix.replace(/[“”]/g, '"')
    .replace(RELAY_QUOTATION, quotedRelaySeparator)
    .split(RELAY_SENTENCE).at(-1)!;
}

function directRelayLead(prefix: string): boolean {
  const clause = relayClauseLead(prefix);
  if (DIRECT_RELAY_LEAD.test(clause)) return true;
  const comma = clause.lastIndexOf(",");
  const aside = clause.slice(0, comma);
  return comma >= 0 && RELAY_ASIDE.test(aside) && !INCOMPLETE_RELAY_ASIDE.test(aside) && !RELAY_SPEECH_CUE.test(aside)
    && DIRECT_RELAY_LEAD.test(clause.slice(comma + 1).replace(/^\s*(?:but|however)\b/i, ""));
}

// spec/relayDecision.md, "A member can take back a pending number swap"
function refusesNumberSwap(text: string, clauses = relayClauses(text)): boolean {
  const pairedRefusal = text.split(RELAY_SENTENCE).some(sentence => PAIRED_CONTACT_REFUSAL.test(sentence));
  return pendingSwapWithdrawn(pairedRefusal, pairedRefusal, false) || clauses.some(clause => pendingSwapWithdrawn(
    OWN_SWAP_ITEM.test(clause),
    SWAP_WITHHOLDING.test(clause) || SWAP_PROPERTY.test(clause) || SWAP_REFUSAL_VERB.test(clause)
      || SWAP_MODAL_REFUSAL.test(clause) || REFUSES_MATCH_ACCESS.test(clause),
    DECLINES_PENDING_SEND.test(clause),
  ));
}

const relayClauses = (text: string): string[] => text.replace(SWAP_GO_AHEAD, " ").split(RELAY_CLAUSE);

function refusesPrivateItem(text: string, otherItemRefusal: RegExp): boolean {
  const sentences = text.split(RELAY_SENTENCE);
  // Punctuation can separate an object from its refusal without changing what the refusal covers.
  return sentences.some((sentence, index) => otherItemRefusal.test(sentence)
    ? CONTINUES_PRIVATE_REFUSAL.test(sentences[index + 1] ?? "")
    : relayClauses(sentence).some(clause => NEG.test(clause) || INCOMPLETE_SHARE_REFUSAL.test(clause)
      || (SHARE_NEG.test(clause) && (PRIVATE_RELAY_REFERENCE.test(clause)
        || (PRIVATE_RELAY_ACTION.test(clause) && PRIVATE_RELAY_ITEM.test(clause))))));
}

function reportsPrivateRequest(text: string, request: RegExpMatchArray): boolean {
  const end = request.index! + request[0].length;
  return PRIVATE_RELAY_POST_ATTRIBUTION.test(text.slice(end).split(RELAY_SENTENCE, 1)[0]!);
}

function reportsPrivateTransfer(tail: string): boolean {
  return PRIVATE_RELAY_POST_ATTRIBUTION.test(/[,–—][^,–—]*$/u.exec(tail)?.[0] ?? "");
}

function privateClauseIsConditional(clause: string, source: string, detached: boolean, request: RegExpMatchArray, contact: boolean): boolean {
  const qualifier = TRAILING_PRIVATE_CONDITION.exec(clause);
  if (!qualifier) return false;
  if (clause !== source) return true;
  let condition = qualifier[2]!.trimEnd();
  if (qualifier[1]) {
    if (!condition.endsWith(")")) return true;
    condition = condition.slice(0, -1).trimEnd();
  }
  const polite = POLITE_PRIVATE_CONDITION.exec(condition);
  if (polite && PRIVATE_RELAY_COURTESY.test(condition.slice(polite[0].length))) return false;
  if (detached || /^\s*,\s*and\b/i.test(clause)) {
    if (PRIVATE_RESPONSE_FOLLOWUP.test(condition)) return false;
    const main = PRIVATE_CONDITION_MAIN.exec(condition)?.[1];
    if (main) {
      const transfer = linkedPrivateTransfer(main);
      if (transfer) {
        const tail = main.slice(transfer.index + transfer[0].length);
        return !reportsPrivateTransfer(tail)
          && (linkedTransferMatchesRequest(transfer, request, contact) || !PRIVATE_RELAY_COURTESY.test(tail));
      }
      const words = main.toLowerCase();
      const object = NAMED_CONDITION_ACCESS.exec(words)?.groups?.object;
      if (object && !PRIVATE_CONDITION_ITEM_NAME.test(object) && !UNRESOLVED_RENEWAL_PAYLOAD.test(object)) return false;
      const independentStatement = detached ? PRIVATE_CONDITION_STATEMENT.test(main)
        : PRIVATE_CONDITION_FACT.test(main) && !PRIVATE_CONDITION_ITEM_NAME.test(words) && !UNRESOLVED_RENEWAL_PAYLOAD.test(words);
      if (TEXT_REQ.test(main) || (detached && PRIVATE_CONDITION_FOLLOWUP.test(main)) || independentStatement) {
        return PRIVATE_RELAY_ITEM.test(words) || PRIVATE_RELAY_REFERENCE.test(words)
          || INCOMPLETE_CONDITION_ACTION.test(words)
          || (PRIVATE_CONDITION_ITEM_NAME.test(words) && (PRIVATE_RELAY_ACTION.test(words) || /\btell\b/u.test(words)));
      }
    }
  }
  return true;
}

function linkedPrivateTransfer(sentence: string): RegExpExecArray | undefined {
  return [LINKED_PRIVATE_SEND.exec(sentence), LINKED_PRIVATE_ACCESS.exec(sentence)].find(transfer => transfer !== null
    && DIRECT_RELAY_LEAD.test(sentence.slice(0, transfer.index).replace(LINKED_PRIVATE_LEAD, ""))) ?? undefined;
}

function namedPrivateRecipient(transfer: RegExpExecArray | undefined): string | undefined {
  const name = (transfer?.groups?.destination ?? transfer?.groups?.recipient)?.toLowerCase();
  return name && !PRIVATE_RECIPIENT_REFERENCE.test(name) ? name : undefined;
}

function linkedTransferMatchesRequest(transfer: RegExpExecArray, request: RegExpMatchArray, contact: boolean): boolean {
  if (contact ? transfer.groups?.photo : transfer.groups?.contact) return false;
  const recipient = namedPrivateRecipient(transfer);
  const selected = recipient && namedPrivateRecipient(linkedPrivateTransfer(request[0]));
  return !selected || selected === recipient;
}

function linkedTransferIsConditional(sentence: string, source: string, request: RegExpMatchArray, contact: boolean): boolean {
  const lead = PRIVATE_NOTICE_THEN.exec(sentence)?.[0].length ?? 0;
  const transfer = linkedPrivateTransfer(sentence.slice(lead));
  if (!transfer || !linkedTransferMatchesRequest(transfer, request, contact)) return false;
  const end = lead + transfer.index + transfer[0].length;
  const tail = sentence.slice(end);
  if (sentence.slice(0, end) !== source.slice(0, end) || reportsPrivateTransfer(tail)) return false;
  const time = LINKED_PRIVATE_TIME.exec(tail);
  return privateClauseIsConditional(tail, source.slice(end), false, request, contact)
    || (time !== null && tail === source.slice(end) && PRIVATE_RELAY_COURTESY.test(tail.slice(time[0].length)));
}

function conditionsPrivateRequest(text: string, source: string, start: number, request: RegExpMatchArray, contact: boolean): boolean {
  const clause = text.slice(start).split(RELAY_SENTENCE, 1)[0]!;
  const requestTail = source.slice(start, start + clause.length);
  if (privateClauseIsConditional(clause, requestTail, false, request, contact)
    || linkedTransferIsConditional(clause, requestTail, request, contact)) return true;
  const boundary = /^[.!?;…\n]+\s*/u.exec(text.slice(start + clause.length));
  if (!boundary) return false;
  const adjacentStart = start + clause.length + boundary[0].length;
  const remaining = text.slice(adjacentStart);
  let adjacent = true;
  for (const part of remaining.matchAll(RELAY_SENTENCE_TEXT)) {
    const sentence = part[0];
    const offset = adjacentStart + part.index!;
    const authored = source.slice(offset, offset + sentence.length);
    if (adjacent && text[offset + sentence.length] === "?" && INDEPENDENT_WHEN_QUESTION.test(sentence)) return false;
    if (adjacent && privateClauseIsConditional(sentence, authored, true, request, contact)
      || linkedTransferIsConditional(sentence, authored, request, contact)) return true;
    if (authored !== sentence || !independentRenewalFollowup(sentence)) return false;
    adjacent = false;
  }
  return false;
}

function colloquialRetractionLead(sentence: string, contact: boolean): string | undefined {
  const match = COLLOQUIAL_RETRACTION.exec(sentence);
  if (!match) return;
  const rest = sentence.slice(match[0].length);
  const explicitItem = COLLOQUIAL_RETRACTION_ITEM.exec(rest);
  // A named object must be the requested item. An opener alone cannot turn "Oh no" into a refusal.
  if (explicitItem) return Boolean(explicitItem.groups?.contact) === contact ? match[0] : undefined;
  if (!rest || /[,;:–—]/u.test(match[1]!) || COLLOQUIAL_RETRACTION_REASON.test(rest)) return match[0];
}

function privateRenewalEnd(rest: string, request: RegExpMatchArray, referenceAvailable: boolean): number | undefined {
  const requestedItem = PRIVATE_RELAY_ITEM.exec(request[0].toLowerCase())?.[0];
  if (!requestedItem) return;
  const repeated = [...rest.matchAll(CONTACT_REQ), ...rest.matchAll(PHOTO_REQ)]
    .find(candidate => candidate[0].toLowerCase() === request[0].toLowerCase());
  const renewal = repeated ?? (referenceAvailable ? [...rest.matchAll(RENEW_PRIVATE_ITEM)].find(candidate => {
    const item = candidate[1]!.toLowerCase();
    return item === "it" || item === requestedItem;
  }) : undefined);
  if (!renewal || !DIRECT_RELAY_LEAD.test(rest.slice(0, renewal.index!))) return;
  const end = renewal.index! + renewal[0].length;
  if (PRIVATE_RELAY_COURTESY.test(rest.slice(end))) return end;
}

function privateCourtesy(sentence: string): boolean {
  const words = sentence.trim();
  const polite = POLITE_PRIVATE_CONDITION.exec(words);
  return PRIVATE_RELAY_COURTESY.test(" " + words)
    || (polite !== null && PRIVATE_RELAY_COURTESY.test(words.slice(polite[0].length)));
}

function normalizeRelayStatement(statement: string): string {
  return statement.replace(/^i'm\b/u, "i am").replace(/^we're\b/u, "we are")
    .replace(/^(i|we)'ve\b/u, "$1 have");
}

function independentRenewalFollowup(sentence: string): boolean {
  const words = sentence.trim().toLowerCase();
  if (privateCourtesy(words) || PRIVATE_RESPONSE_FOLLOWUP.test(words)) return true;
  const envelope = /^(?:please\s+)?(?:tell|let)\b/u.test(words) ? TEXT_REQ.exec(words) : null;
  const statement = normalizeRelayStatement(envelope?.at(-1) ?? words);
  if (!envelope) return INDEPENDENT_RENEWAL_STATUS.test(statement);
  return PRIVATE_CONDITION_STATEMENT.test(statement) && !PRIVATE_CONDITION_ITEM_NAME.test(statement)
    && !PRIVATE_RELAY_ACTION.test(statement) && !PRIVATE_RELAY_UNCERTAIN.test(statement)
    && !UNRESOLVED_RENEWAL_PAYLOAD.test(statement);
}

function detachedRelayStatement(after: string): boolean {
  const lead = /^\s*\.\s*(?:to be clear|with that settled),\s*/iu.exec(after);
  if (!lead) return false;
  // The exception applies only to a complete standalone status and its optional time.
  const statement = normalizeRelayStatement(after.slice(lead[0].length).trim().replace(/[.!]+$/, "").toLowerCase());
  if (INDEPENDENT_RENEWAL_STATUS.test(statement)) return true;
  const timeAt = statement.lastIndexOf(" at ");
  if (timeAt < 0) return false;
  const timing = statement.slice(timeAt);
  return LINKED_PRIVATE_TIME.exec(timing)?.[0] === timing
    && INDEPENDENT_RENEWAL_STATUS.test(statement.slice(0, timeAt));
}

function privateRelayTimingIsUncertain(text: string, ordinaryBody: { start: number; end: number } | undefined): boolean {
  if (!ordinaryBody) return PRIVATE_TIMING_HEDGE.test(text);
  if (PRIVATE_TIMING_HEDGE.test(text.slice(0, ordinaryBody.start)) || PRIVATE_TIMING_HEDGE.test(text.slice(ordinaryBody.end))) return true;
  // Only an ordinary scheduling statement can speak about a different time from the private transfer.
  return text.slice(ordinaryBody.start, ordinaryBody.end).split(RELAY_SENTENCE).some(sentence => {
    if (!PRIVATE_TIMING_HEDGE.test(sentence)) return false;
    const status = sentence.toLowerCase().replace(PRIVATE_TIMING_HEDGE, "").trim().replace(/\s+/g, " ")
      .replace(/^i'm\b/u, "i am").replace(/^we're\b/u, "we are").replace(/^(i|we)'ve\b/u, "$1 have");
    if (INDEPENDENT_RENEWAL_STATUS.test(status)) return false;
    const timeAt = status.lastIndexOf(" at ");
    const time = status.slice(timeAt);
    return !(timeAt >= 0 && LINKED_PRIVATE_TIME.exec(time)?.[0] === time && INDEPENDENT_RENEWAL_STATUS.test(status.slice(0, timeAt)));
  });
}

function relayRecipientIsComplete(text: string, request: RegExpMatchArray, trailingRecipient: string | undefined): boolean {
  const after = text.slice(request.index! + request[0].length);
  if (UNPARSED_RELAY_DESTINATION.test(after) && !detachedRelayStatement(after)) {
    return trailingRecipient === undefined && RELAY_WITH_THANKS.test(after);
  }
  if (trailingRecipient === undefined) return true;
  // The match still identifies a delegated instruction when its destination is incomplete.
  if (RELAY_NAME_CONTINUATION.test(after)) return false;
  const tail = after.split(RELAY_SENTENCE, 1)[0]!;
  const continuation = tail.replace(/^[\s,:–—]+/u, "");
  return continuation === "" || privateCourtesy(tail) || TRAILING_PRIVATE_CONDITION.test(tail)
    || (/^\s*[,–—]/u.test(tail) && independentRenewalFollowup(continuation));
}

function retractsPrivateRequest(text: string, source: string, request: RegExpMatchArray, privateRequests: readonly RegExpMatchArray[], contact: boolean): boolean {
  const end = request.index! + request[0].length;
  const tail = text.slice(end);
  if (LATE_ORPHAN_QUESTION.test(tail)) return true;
  const otherItemRefusal = contact ? PHOTO_ITEM_REFUSAL : CONTACT_ITEM_REFUSAL;
  let retracted = false;
  let referenceAvailable = true;
  let adjacentPause = false;
  let renewedAfterPause = false;
  for (const part of tail.matchAll(RELAY_SENTENCE_TEXT)) {
    const start = end + part.index!;
    const sentence = part[0];
    const stop = start + sentence.length;
    const ownStatement = sentence === source.slice(start, stop) && !text.slice(stop).match(RELAY_SENTENCE)?.[0].includes("?");
    const lead = LATE_PRIVATE_RETRACTION_LEAD.exec(sentence)?.[0] ?? colloquialRetractionLead(sentence, contact);
    const prefix = lead ?? PRIVATE_RENEWAL_CORRECTION.exec(sentence)![0];
    const renewal = ownStatement && (retracted || lead !== undefined)
      ? privateRenewalEnd(sentence.slice(prefix.length), request, referenceAvailable && (adjacentPause || lead !== undefined))
      : undefined;
    if (renewal !== undefined && !conditionsPrivateRequest(text, source, start + prefix.length + renewal, request, contact)) {
      renewedAfterPause ||= retracted;
      retracted = false;
      referenceAvailable = true;
      adjacentPause = false;
    } else if (lead !== undefined || LATE_PRIVATE_RETRACTION.test(sentence) || LATE_PRIVATE_STOP_LEAD.test(sentence)) {
      if (TERMINAL_PRIVATE_RETRACTION.test(lead ?? sentence)) return true;
      retracted = true;
      renewedAfterPause = false;
      referenceAvailable &&= ownStatement && PRIVATE_RENEWAL_ANCHOR.test(sentence);
      adjacentPause = referenceAvailable;
    } else {
      if (renewedAfterPause) {
        const otherItem = ownStatement
          && (otherItemRefusal.test(sentence.toLowerCase()) || colloquialRetractionLead(sentence, !contact) !== undefined);
        if (otherItem && CONTINUES_PRIVATE_REFUSAL.test(text.slice(stop).split(RELAY_SENTENCE, 2)[1]?.toLowerCase() ?? "")) return true;
        if (!(ownStatement && (otherItem || independentRenewalFollowup(sentence)))) {
          retracted = true;
          renewedAfterPause = false;
        }
      }
      referenceAvailable &&= ownStatement && privateCourtesy(sentence);
      adjacentPause = false;
    }
  }
  return retracted || privateRequests.some(candidate => {
    if (candidate.index! < end || candidate[0].toLowerCase() === request[0].toLowerCase() || reportsPrivateRequest(text, candidate)) return false;
    const lead = text.slice(end, candidate.index!).split(RELAY_SENTENCE).at(-1)!;
    const correction = PRIVATE_RELAY_CORRECTION.exec(lead);
    return correction !== null && DIRECT_RELAY_LEAD.test(lead.slice(correction[0].length));
  });
}

// A simple third-person attribution introduces a report through the next sentence boundary.
// Leave an explicit first-person contrast in the sender's words.
const REPORTED_SWAP_SEGMENT = /(^|[.,!?;\n])\s*(?:(?!(?:i|we)\b)\p{L}[\p{L}'-]*\s+){1,3}(?:said|says?|(?:tells?|told|asks?|asked)\s+(?:me|us))\s*,([^.!?;\n]*)/gu;
const OWN_SWAP_CONTRAST = /\b(?:but|however)\s+(?:i|we)\b/u;

const TEXT_BODY_LABEL = /^(?:(?:this|these|the|my|our)\s+(?:exact\s+)?(?:text|words|message)|what\s+[\p{L}' -]+\s+(?:said|says|wrote))\s*:\s*/iu;

export function withdrawsRelaySwap(text: string): boolean {
  const normalized = text.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').trim();
  const modal = RELAY_MODAL.exec(normalized);
  const afterModal = normalized.slice(modal?.[0].length ?? 0);
  const markedPayload = COLON_TEXT_REQ.exec(afterModal)?.[4];
  const reportedPayload = TEXT_REQ.exec(afterModal)?.[4] ?? "";
  const label = TEXT_BODY_LABEL.exec(reportedPayload);
  const payload = markedPayload ?? (label ? reportedPayload.slice(label[0].length) : undefined);
  if (payload !== undefined) {
    const quotation = payload.match(RELAY_QUOTATION)?.[0];
    // An unquoted literal payload extends to the end of the turn.
    if (!quotation || !payload.startsWith(quotation) || quotation.length < 2 || quotation[0] !== quotation.at(-1)) return false;
  }
  const own = normalized.replace(RELAY_QUOTATION, quotedRelaySeparator).toLowerCase();
  const authored = own.replace(REPORTED_SWAP_SEGMENT, (_segment, boundary: string, report: string) => {
    const contrast = OWN_SWAP_CONTRAST.exec(report);
    return contrast ? boundary + report.slice(contrast.index) : boundary;
  });
  return refusesNumberSwap(authored);
}

/**
 * What a member asks the agent to do with their match. Only an explicit, unhedged, unnegated request
 * is a contact share or a photo send; "should I send my number?" and "don't send them my number" are
 * not. The platform turns a positive answer into an item with a `RelayConsent` for that item.
 */
export function parseRelayRequest(text: string): RelayRequest {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const own = ownRelayWords(t);
  const spoken = own.trim();
  const start = own.length - own.trimStart().length;
  const contacts = [...spoken.matchAll(CONTACT_REQ)];
  const photos = [...spoken.matchAll(PHOTO_REQ)];
  const direct = (candidate: RegExpMatchArray) => directRelayLead(t.slice(0, start + candidate.index!))
    && !reportsPrivateRequest(spoken, candidate);
  let contact = contacts.find(direct);
  const modal = RELAY_MODAL.exec(t);
  const afterModal = t.slice(modal?.[0].length ?? 0);
  const markedEnvelope = COLON_TEXT_REQ.exec(afterModal);
  if (markedEnvelope?.[1]!.toLowerCase() === "let" && !markedEnvelope[3]) return { kind: "none" };
  const envelope = markedEnvelope ?? TEXT_REQ.exec(afterModal);
  let ordinaryText: Extract<RelayRequest, { kind: "text" }> | undefined;
  let ordinaryBody: { start: number; end: number } | undefined;
  let delegatedPrivate = false;
  let independentNumber = false;
  let leadingCondition = false;
  if (envelope && (envelope[1]!.toLowerCase() !== "let" || envelope[3])) {
    const payload = envelope[4]!;
    const bodyStart = t.length - payload.length;
    // A name that reaches the colon can be longer than the supported recipient grammar.
    if (!markedEnvelope && !envelope[3] && POSSIBLE_COLON_NAME_TAIL.test(payload)
      && !/\bthat\s*$/iu.test(t.slice(0, bodyStart))) return { kind: "none" };
    const delegates = (candidate: RegExpMatchArray) => TEXT_PRIVATE_DIRECTIVE_LEAD.test(t.slice(bodyStart, start + candidate.index!));
    delegatedPrivate = markedEnvelope === null && (contacts.some(delegates) || photos.some(delegates));
    const phone = contact ?? contacts.find(candidate => PHONE_RELAY_ITEM.test(candidate[0])
      && !reportsPrivateRequest(spoken, candidate)
      && PRIVATE_CONDITION_MAIN.test(relayClauseLead(t.slice(0, start + candidate.index!)).trim() + " " + candidate[0]));
    const end = phone && PHONE_RELAY_ITEM.test(phone[0])
      ? independentPhoneBoundary(t.slice(bodyStart, start + phone.index!), markedEnvelope !== null)
      : undefined;
    independentNumber = end !== undefined;
    // A leading condition can separate a phone clause from the text. It cannot grant consent.
    if (independentNumber && contact === undefined) {
      contact = phone;
      leadingCondition = true;
    }
    const withdrawalEnd = contact === undefined && !photos.some(direct)
      ? independentWithdrawalBoundary(payload, markedEnvelope !== null) : undefined;
    const message = payload.slice(0, withdrawalEnd !== undefined && withdrawsRelaySwap(t) ? withdrawalEnd : end);
    const declarative = envelope[1]!.toLowerCase() !== "ask" && /^(?:i\b|we\b|my\b|our\b)/i.test(message);
    const body = (modal && declarative ? message.replace(/\?$/, "") : message).trim();
    const target = envelope[2]!;
    if (body) {
      ordinaryText = { kind: "text", body, ...(IMPLICIT_RELAY_TARGET.test(target) ? {} : { targetName: target }) };
      if (end !== undefined) ordinaryBody = { start: bodyStart - start, end: bodyStart - start + end };
    }
    if (ordinaryText && relayEnvelopeTextAllowed(delegatedPrivate, independentNumber, false, false, false, false)) return ordinaryText;
  }

  const privateRequest = contact ?? photos.find(direct);
  if (privateRequest) {
    const trailingRecipient = privateRequest.groups?.trailingRecipient ?? privateRequest.groups?.affirmedRecipient;
    const recipient = privateRequest.groups?.leadingRecipient ?? trailingRecipient;
    const targetName = recipient && !IMPLICIT_RELAY_TARGET.test(recipient) ? recipient : undefined;
    const privateModal = RELAY_MODAL.exec(spoken);
    const low = spoken.toLowerCase();
    const clauses = relayClauses(low);
    const question = relayIsIndirectQuestion(spoken.endsWith("?"), /^(?:please\s+)?(?:can|could|would)\s+(?:you|u)\b/i.test(spoken),
      privateModal?.[0].length === privateRequest.index, /^(?:should|would\s+it|could\s+i|is it|do you|can i)\b/i.test(spoken));
    const priorCondition = priorSentenceConditionsShare(t.slice(start), privateRequest, !!contact);
    const envelopeCondition = independentNumber && ordinaryText !== undefined
      && envelopeConditionUnsettled(ordinaryText.body);
    const uncertain = leadingCondition || HEDGE.test(low) || privateRelayTimingIsUncertain(spoken, ordinaryBody) || uncertainPrivateTransfer(clauses)
      || envelopeCondition
      || conditionsPrivateRequest(own.slice(start), t.slice(start), privateRequest.index! + privateRequest[0].length, privateRequest, !!contact)
      || question || privateShareQualified(spoken, privateRequest)
      || priorCondition;
    // spec/relayDecision.md, "A refusal or uncertainty cannot authorize a private item"
    const refused = refusesPrivateItem(low, contact ? PHOTO_ITEM_REFUSAL : CONTACT_ITEM_REFUSAL)
      || retractsPrivateRequest(own.slice(start), t.slice(start), privateRequest, [...contacts, ...photos], !!contact)
      || (!!contact && refusesNumberSwap(low, clauses));
    if (ordinaryText && independentNumber) {
      const body = ordinaryText.body.toLowerCase();
      const numberWithdrawn = !!contact && refused && withdrawsRelaySwap(t);
      const containsPrivateInstruction = priorCondition || (PRIVATE_CONDITION_ITEM_NAME.test(body) && PRIVATE_RELAY_ACTION.test(body))
        || relayClauses(ownRelayWords(body)).some(clause => PRIVATE_RELAY_REFERENCE.test(clause.trim()))
        || (numberWithdrawn && withdrawsRelaySwap(body));
      if (relayEnvelopeTextAllowed(delegatedPrivate, independentNumber, uncertain, refused, containsPrivateInstruction, numberWithdrawn)) return ordinaryText;
    }
    if (!privateRelayRequestAllowed(refused, uncertain) || !relayRecipientIsComplete(t.slice(start), privateRequest, trailingRecipient)) {
      return { kind: "none" };
    }
    return { kind: contact ? "contact_share" : "photo", ...(targetName === undefined ? {} : { targetName }) };
  }
  return { kind: "none" };
}

/**
 * The item for a member's request, with the consent for THIS item (given at `at`). The plugin action
 * or the platform calls `parseRelayRequest`, then this, then `relayItem`. `contact` is the sender's
 * verified contact from the person record (never parsed from the message); `photoIds` are the photos
 * the member chose. Returns null for "none", a contact share without a contact, or a photo without ids.
 */
export function relayItemFromRequest(req: RelayRequest, o: { id: string; from: MemberId; to: MemberId; at: number; contact?: RelayItem["contact"]; photoIds?: readonly string[] }): RelayItem | null {
  const base = { id: o.id, from: o.from, to: o.to, at: o.at };
  if (req.kind === "text") return { ...base, kind: "text", text: req.body };
  if (req.kind === "contact_share") return o.contact ? { ...base, kind: "contact_share", contact: o.contact, consent: { kind: "contact_share", by: o.from, itemId: o.id, at: o.at } } : null;
  if (req.kind === "photo") return o.photoIds?.length ? { ...base, kind: "photo", photoIds: [...o.photoIds], consent: { kind: "photo", by: o.from, itemId: o.id, at: o.at, photoIds: [...o.photoIds] } } : null;
  return null;
}

// ------------------------------------------------------------------------------- log helpers
/** Members who received a delivered item from, or sent one to, `member` (ban notices, PRD 40.5). */
export function pastContacts(records: readonly RelayRecord[], member: MemberId): MemberId[] {
  const out = new Set<MemberId>();
  for (const r of records) if (r.decision === "pass") { if (r.from === member) out.add(r.to); if (r.to === member) out.add(r.from); }
  return [...out].sort();
}

/** What the platform stores per item in the thread (the rendered text only for delivered items). */
export interface RelayThreadMessage {
  opportunityId: string; itemId: string; from: MemberId; to: MemberId; at: number; kind: RelayKind;
  decision: RelayDecision;
  /** The delivered wording (pass only). Held items keep the original text in the review queue, never here. */
  rendered: string | null;
  photoIds: string[];
  reasons: string[];
}
export function threadMessage(res: RelayResult): RelayThreadMessage {
  const r = res.record;
  return { opportunityId: r.opportunityId, itemId: r.itemId, from: r.from, to: r.to, at: r.at, kind: r.kind, decision: r.decision, rendered: res.decision === "pass" ? res.rendered : null, photoIds: res.photos, reasons: r.reasons };
}
