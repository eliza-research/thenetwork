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
import { canBeMatched, labelHash, LeakGuard, textVariants, type MemberId, type Owned } from "@thenetwork/core";

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

export const RELAY_RULES: { code: string; re: RegExp }[] = [
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
  { code: "harass_severe:threat", re: R("\\bi(?:'?ll| will| am going to|'?m gonna| gonna| m gonna)\\s+(?:kill|hurt|find|ruin|destroy|beat|end|stab|shoot|expose|leak|post)\\b|\\bi know where (?:you|u) (?:live|work|sleep)\\b|\\b(?:you|u)(?:'?ll| will) (?:regret|pay for)\\b|\\b(?:make|making) (?:you|u) (?:regret|pay|sorry)\\b|\\bwatch (?:your|ur) back\\b|\\bor else\\b|\\b(?:you|u)(?:'d| had)? better (?:answer|reply|respond|show|text)\\b|\\b(?:i'?ll |i will )?(?:make sure|let) everyone know|\\b(?:wait|show up|be waiting|come by|turn up)\\s+(?:for (?:you|u) )?(?:outside|at) (?:your|ur) (?:work|office|home|place|apartment|building|job|door)\\b") },
  { code: "harass_severe:slur", re: R("\\b(?:fag(?:got)?s?|n[i]gg(?:a|er|ah|uh|az)s?|trann(?:y|ie)s?|kikes?|spics?|chinks?|retard(?:ed|s)?|dykes?|wetbacks?|shemales?|towelheads?|raghead)\\b") },
  { code: "harass:insult", re: R("\\b(?:fuck (?:you|off|u)|f off|stfu|bitch|whore|slut|cunt|skank|hoe|piece of shit|go die|kys|kill yourself|nobody (?:would|will|could) (?:ever )?(?:want|love|date|believe) (?:you|u)|(?:you|u)(?:'?re| are|r) (?:so |such an? |an? )?(?:ugly|fat|disgusting|gross|worthless|pathetic|nothing|a joke|trash|garbage|loser|idiot|moron|chubby|hideous))\\b") },
  { code: "harass:insult", re: R("\\b(?:waste of (?:space|air|oxygen|skin)|shut (?:up|ur mouth|your mouth)|(?:you'?d|you would|you'?ll|u'?d|ud) (?:be|look) (?:prettier|hotter|cuter|sexier|thinner|skinnier|more attractive|better looking|less ugly) if|(?:you|u) (?:should|need to|could|gotta) lose (?:some |a little |a bit of )?weight|if (?:you|u) lost (?:some )?weight|(?:you'?re|you are|ur|u r) (?:a |such a |just a )?(?:tease|prude|cocktease|gold ?digger)|typical (?:stuck[- ]up )?(?:bitch|woman|girl|guy|female))\\b") },
  { code: "harass:pressure", re: R("\\b(?:don'?t|do not|stop) (?:you )?(?:dare )?(?:ignore|ignoring|ghost|ghosting|igoring) me\\b|\\bi can see (?:you'?re|you are|u r|ur|that you'?re) (?:online|active|typing|reading)\\b|\\bwhether (?:you|u) like it or not\\b|\\b(?:no ?one|nobody) (?:will|would|is going to|is gonna) believe (?:you|u)\\b|\\b(?:i'?m|i am|i'?ll be|i will be|i'?m gonna be|gonna be|i'?ll wait|i will wait)\\s+(?:waiting\\s+)?(?:outside|at|by|in front of)\\s+(?:your|ur)\\s+(?:building|place|apartment|apt|door|work|office|house|job)\\b|\\b(?:tell|telling|show|showing)\\s+(?:everyone|everybody|all your friends|your friends|people)\\b[^.?!]{0,30}\\b(?:you'?re|you are|ur|about you|what you)\\b|\\b(?:you|u) owe me\\b") },
  { code: "harass:sexual", re: R("\\b(?:send|show)\\s+(?:me\\s+)?(?:nudes?|noods|naughty pics?|(?:a |some |more )?(?:pics?|photos?|pictures?|selfies?) of (?:your|ur) (?:body|tits|boobs|ass|chest|dick|butt|legs|feet)|(?:a |some |more )?(?:body|bikini|lingerie|bed(?:room)?) (?:pics?|photos?|selfies?)|something sexy|a sexy (?:pic|photo))\\b|\\bnudes\\b|\\bnude (?:pics?|photos?|selfies?)\\b|\\bdtf\\b|\\bdon'?t be (?:a |so |such a )?(?:prude|tease|frigid|uptight)\\b|\\b(?:you|u) know (?:you|u) want (?:it|this|me)\\b|\\bwe both know (?:why|what) (?:we'?re|this is|you)\\b|\\b(?:you|u) owe me\\b|\\bwhat are (?:you|u) wearing\\b|\\b(?:bring|wear)\\b[^.?!]{0,15}\\b(?:lingerie|condoms?)\\b|\\b(?:sex|fuck|smash|bang|hook ?up|sleep together|sleep with (?:me|you))\\b[^.?!]{0,40}\\b(?:tonight|first|after|right after|instead|now|before)\\b|\\b(?:skip|forget)\\b[^.?!]{0,15}\\b(?:the )?(?:coffee|date|drinks|dinner|museum|walk)\\b[^.?!]{0,30}\\b(?:my|your) (?:place|apartment|bed)\\b|\\b(?:back to|come over to|come to) (?:my|your) (?:place|apartment|bed|room|hotel)\\b") },
];

/** A self-disclosed minor age or school year (blocks and flags the age for the platform). */
export const MINOR_SIGNAL = R("\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?(?:1[3-7])(?!\\s*(?:min|mins|minutes|blocks|miles|mi|km|away|%|stops|floors|hours|hrs|seconds|cm|lbs|k)\\b)(?:\\b|\\s*(?:yo|y/o|years? old)\\b)|\\b(?:1[3-7])\\s*(?:yo|y/o|years? old)\\b|\\b(?:i'?m|i am|im) (?:still )?(?:in|at) (?:high school|middle school|hs)\\b|\\bmy (?:mom|dad|parents) (?:won'?t|wont|don'?t|dont) let me\\b|\\bnot 18 (?:yet|until)\\b|\\b(?:i'?m|i am|im) (?:under ?18|underage|a minor)\\b|\\bhomeroom\\b");

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
  const vs = textVariants(text.replace(/[’‘`´]/g, "'"));
  const codes = new Set<string>();
  for (const { code, re } of RELAY_RULES) if (!codes.has(code) && vs.some(v => re.test(v))) codes.add(code);
  if (spelledPhone(text)) codes.add("contact:spelled_phone");
  return { codes: [...codes], minorSignal: vs.some(v => MINOR_SIGNAL.test(v)) };
}

// ----------------------------------------------------------------------------------- photo ids
/**
 * A photo reference is an opaque id the platform resolves (its own photo table): 8-64 characters of
 * [A-Za-z0-9_-], never a URL, path, email, phone number or a name with a contact in it.
 */
export function isOpaquePhotoId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id) && !/\d{7,}/.test(id) && !/^(?:https?|www|data|file)/i.test(id);
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
    if (c.at > item.at || item.at - c.at > L.consentTtlMs) return "consent:stale";
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
  const decision: RelayDecision = reasons.some(r => BLOCK_PREFIX.has(fam(r))) ? "block" : reasons.length ? "hold" : "pass";
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
export type RelayRequest = { kind: "contact_share" } | { kind: "photo" } | { kind: "text"; body: string } | { kind: "none" };

const NEG = /\b(?:don'?t|dont|do not|never|not yet|no need to|stop|shouldn'?t|won'?t|wont|rather not|hold off|wait (?:to|before)|not until)\b/;
const HEDGE = /^\s*(?:should i|do you think|is it ok(?:ay)? (?:to|if)|would it be|what if|maybe|if)\b|\b(?:later|after the date|after we meet|eventually|at some point|one day|tomorrow)\b|\b(?:should i|or not)\b/;
const OTHER = "(?:them|him|her|my (?:match|date)|(?!(?:me|us|it|everyone|everybody|nobody|anyone|this|that)\\b)\\p{L}[\\p{L}'-]{1,30})";
const CONTACT_REQ = new RegExp(`\\b(?:send|give|share|pass|forward|text)\\s+${OTHER}\\s+my\\s+(?:phone number|number|phone|digits|cell|contact(?: info)?|email)\\b|\\b(?:share|send|give|pass)\\s+my\\s+(?:phone number|number|phone|digits|cell|contact(?: info)?|email)\\s+(?:with|to)\\s+${OTHER}|^\\s*(?:yes|yeah|yep|ok|okay|sure)[,!.]?\\s+(?:send|share|give)\\s+(?:it|my number|them my number)\\b|\\b(?:they|she|he) can have my (?:number|digits|phone number)\\b`, "iu");
const PHOTO_REQ = new RegExp(`\\b(?:send|share|forward|pass|show)\\s+${OTHER}\\s+(?:this|that|the|my|these)\\s+(?:photos?|pics?|pictures?|selfies?|images?)\\b|\\b(?:send|share|forward)\\s+(?:this|that|these|my)\\s+(?:photos?|pics?|pictures?|selfies?)\\s+(?:to|with)\\s+${OTHER}`, "iu");
const TEXT_REQ = new RegExp(`^\\s*(?:please\\s+)?(?:tell|let|ask)\\s+${OTHER}\\s+(?:know\\s+)?(?:that\\s+)?(.{2,})$`, "isu");

/**
 * What a member asks the agent to do with their match. Only an explicit, unhedged, unnegated request
 * is a contact share or a photo send; "should I send my number?" and "don't send them my number" are
 * not. The platform turns a positive answer into an item with a `RelayConsent` for that item.
 */
export function parseRelayRequest(text: string): RelayRequest {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const low = t.toLowerCase();
  const negated = NEG.test(low), hedged = HEDGE.test(low) || (/\?\s*$/.test(t) && /^\s*(?:should|would|could i|is it|do you|can i)\b/i.test(t));
  if (CONTACT_REQ.test(t)) return negated || hedged ? { kind: "none" } : { kind: "contact_share" };
  if (PHOTO_REQ.test(t)) return negated || hedged ? { kind: "none" } : { kind: "photo" };
  const m = TEXT_REQ.exec(t);
  if (m && !negated) return { kind: "text", body: m[1]!.trim() };
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
