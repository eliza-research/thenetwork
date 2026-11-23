import { relayKindAllowed, teenFriendMaxAge } from "../../core/src/generated/friendIntroAge.ts";
import { ageOnDay } from "../../core/src/generated/memberAge.ts";
import { pendingSwapWithdrawn, privateRelayRequestAllowed, relayBlockNotice, relayClassifierReading, relayClassifierReads, relayConsentStale, relayVerdict, type RelayBlockNotice } from "../../core/src/generated/relayDecision.ts";
import { relayIsIndirectQuestion } from "../../core/src/generated/relayRequestAddress.ts";
import { AGE_BIRTHDAY_AFTER_AGE, AGE_DISTANT_BIRTHDAY_AFTER_AGE, canBeMatched, hasOrElseThreat, labelHash, latestDayKeyOf, LeakGuard, normalizeAgeInitialism, OR_ELSE_THREAT, relayMinorAge, relayMinorEstimate, textVariants, type MemberId, type Owned } from "@thenetwork/core";

const RELAY_POLICY_VERSION = "relay-1.0.0";

type RelayKind = "text" | "contact_share" | "photo";
type RelayDecision = "pass" | "block";

export interface RelayParty {
  id: MemberId;
  firstName: string;
  age: number | undefined;
  optedOut?: boolean;
  held?: boolean;
  photoIds?: readonly string[];
  photoConsent?: boolean;
}

export interface RelayOpportunity {
  id: string;
  app: string;
  participants: readonly [MemberId, MemberId];
  acceptedBy: readonly MemberId[];
  status: "probing" | "mutual" | "closed" | "cancelled" | "expired";
  metAt?: number;
}

interface RelayConsent {
  kind: "contact_share" | "photo";
  by: MemberId;
  itemId: string;
  at: number;
  photoIds?: readonly string[];
}

export interface RelayItem {
  id: string;
  kind: RelayKind;
  from: MemberId;
  to: MemberId;
  at: number;
  text?: string;
  contact?: { kind: "phone" | "email"; value: string };
  photoIds?: readonly string[];
  consent?: RelayConsent;
}

interface RelayLimits {
  burst: { n: number; windowMs: number };
  daily: number;
  teenDaily: number;
  photosDaily: number;
  contactShares: number;
  consentTtlMs: number;
  maxChars: number;
  maxPhotos: number;
}
export const RELAY_LIMITS: RelayLimits = {
  burst: { n: 6, windowMs: 10 * 60_000 }, daily: 40, teenDaily: 10, photosDaily: 6, contactShares: 1, consentTtlMs: 15 * 60_000, maxChars: 1000, maxPhotos: 3,
};

export interface RelayRecord {
  itemId: string; opportunityId: string; app: string;
  kind: RelayKind; from: MemberId; to: MemberId; at: number;
  decision: RelayDecision;
  reasons: string[];
  photoCount: number;
  contactShared: boolean;
  ageSignal: boolean;
  policy: string;
}

export interface RelayContext {
  now: number;
  opportunity: RelayOpportunity;
  sender: RelayParty;
  recipient: RelayParty;
  blocked: boolean;
  history?: readonly RelayRecord[];
  recentTexts?: readonly string[];
  thread?: readonly string[];
  guard?: LeakGuard;
  extraRules?: (text: string) => string[];
  limits?: Partial<RelayLimits>;
  teenFriendPair?: boolean;
}

export interface RelayResult {
  decision: RelayDecision;
  reasons: string[];
  rendered: string;
  photos: string[];
  record: RelayRecord;
  senderNotice: string;
  classifierError?: string;
}

const FINAL_FAMILIES = new Set(["state", "party", "minor", "optout", "consent", "photo", "contact_share", "canary", "harass_severe", "format", "clef_severe"]);
const CONTACT_FAMILIES = new Set(["contact", "fishing", "offplatform"]);
const EXPLAINED_FAMILIES = new Set(["consent", "rating", "rate", "classifier", ...CONTACT_FAMILIES]);
const familyOf = (reason: string) => reason.split(":")[0]!;

const R = (s: string) => new RegExp(s, "i");
const PAY = "(?:send|wire|transfer|lend|loan|venmo|zelle|cash ?app|paypal|give|spot|front)";
const MONEY = "(?:\\$\\s?\\d|\\bmoney\\b|\\bcash\\b|\\bfunds?\\b|\\bbucks\\b|\\bdollars?\\b|\\busd\\b|\\b\\d{2,5}\\b)";
const APPS = "(?:whats ?app|telegram|signal|kik|hangouts|google chat|wechat|viber|snap(?:chat)?|insta(?:gram)?|ig|facebook|messenger|fb|discord|line app|skype|imessage)";

const otherThreats = R("\\bi(?:'?ll| will| am going to|'?m gonna| gonna| m gonna)\\s+(?:kill|hurt|find|ruin|destroy|beat|end|stab|shoot|expose|leak|post)\\b|\\bi know where (?:you|u) (?:live|work|sleep)\\b|\\b(?:you|u)(?:'?ll| will) (?:regret|pay for)\\b|\\b(?:make|making) (?:you|u) (?:regret|pay|sorry)\\b|\\bwatch (?:your|ur) back\\b|\\b(?:you|u)(?:'d| had)? better (?:answer|reply|respond|show|text)\\b|\\b(?:i'?ll |i will )?(?:make sure|let) everyone know|\\b(?:wait|show up|be waiting|come by|turn up)\\s+(?:for (?:you|u) )?(?:outside|at) (?:your|ur) (?:work|office|home|place|apartment|building|job|door)\\b");

const RELAY_RULES: { code: string; re: RegExp; matches?: (text: string) => boolean }[] = [
  { code: "scam:money", re: R(`\\b${PAY}\\s+(?:me|us)\\b[^.?!]{0,50}${MONEY}`) },
  { code: "scam:money", re: R("\\b(?:can|could|would)\\s+(?:you|u)\\s+(?:please\\s+)?(?:help(?: me)?(?: out)?(?: with)?|cover|spot|lend|loan|pay(?: for)?)\\b[^.?!]{0,40}\\b(?:rent|bills?|fees?|ticket|flight|hospital|medical|money|cash|\\$|bucks|loan|deposit|customs|visa|tuition|phone bill|gas money)\\b") },
  { code: "scam:money", re: R("\\b(?:i|we)(?:\\s+(?:really\\s+|just\\s+)?(?:need|am short|are short|m short|owe)|'m short|'re short)\\b[^.?!]{0,30}(?:\\$\\s?\\d+|\\d+\\s?(?:dollars|bucks|usd)|\\bmoney\\b|\\bcash\\b)") },
  { code: "scam:money", re: R("\\b(?:western union|moneygram|wire transfer|bank (?:details|account|info|transfer)|routing number|account number)\\b|\\b(?:my|your|ur)\\s+(?:venmo|cash ?app|zelle|paypal)\\b") },
  { code: "scam:money", re: R("\\b(?:venmo|zelle|cash ?app|paypal|wire)\\s+(?:me|us)\\b|\\b(?:cover|help (?:me |us )?(?:with|pay(?:ing)?(?: for)?|cover)|pay(?:ing)? for)\\s+(?:my|our)\\s+(?:rent|bills?|phone bill|electric bill|flights?|tickets?|fees?|hospital bill|medical bills?|tuition|visa|car repair|leave|trip home)\\b|\\bneed (?:some )?help (?:paying|covering|with paying)\\b|\\b(?:receive|accept|cash|deposit)\\s+(?:a |some |the |my )?(?:transfer|check|cheque|payment|package|money|funds)\\s+for (?:me|us)\\b") },
  { code: "scam:gift_card", re: R("\\b(?:gift ?cards?|itunes cards?|apple (?:gift )?cards?|steam cards?|google play cards?|amazon cards?|card codes?|scratch (?:the|off) (?:back|code))\\b") },
  { code: "scam:crypto", re: R("\\b(?:bitcoin|btc|ethereum|usdt|tether|crypto(?:currency)?|binance|coinbase|forex|wallet address)\\b[^.?!]{0,60}\\b(?:invest|profit|returns?|deposit|wallet|send|earn|trading|teach|show you|platform|double|mentor|account|opportunit)") },
  { code: "scam:crypto", re: R("\\b(?:invest|profit|returns?|deposit|earn|trading|teach you|show you|double)\\b[^.?!]{0,60}\\b(?:bitcoin|btc|ethereum|usdt|tether|crypto(?:currency)?|binance|coinbase|forex)\\b") },
  { code: "scam:investment", re: R("\\b(?:guaranteed (?:returns?|profits?)|investment (?:opportunity|platform|plan)|\\d+\\s?% (?:a |per |every )?(?:day|week|month|daily|weekly|monthly)|passive income|financial freedom|(?:uncle|aunt|mentor|cousin) (?:taught|showed) me (?:how )?to (?:trade|invest)|make money (?:fast|online|from home)|trading (?:platform|app|account|signals))\\b") },
  { code: "scam:money", re: R("\\b(?:float|spot|front|lend|loan|advance)\\s+(?:me|us)\\s+(?:a (?:bit|little|few|couple|hundred|grand)|some|\\$|\\d|money|cash|the (?:money|cash|rest)|until|till|for)\\b|\\b(?:can'?t|cannot|unable to|not able to)\\s+(?:access|withdraw|get (?:to|at)|release|unlock)\\s+(?:my |our |the )?(?:funds|money|account|salary|savings|inheritance|paycheck)\\b|\\b(?:salary|paycheck|funds|account|card|money|inheritance|wallet)\\s+(?:is |was |got |has been |are |were )?(?:stuck|frozen|blocked|on hold|locked|seized|stolen)\\b|\\b(?:customs|clearance|release|processing|shipping|transfer|tax|delivery)\\s+fees?\\b|\\bhelp\\s+(?:me|us)\\s+(?:out\\s+)?(?:with|pay(?:ing)?|cover(?:ing)?)\\s+(?:the|my|our|a|this)\\s+(?:\\w+\\s+){0,2}(?:fee|fees|bill|bills|rent|deposit|fine)\\b|\\bneed\\s+(?:\\$\\s?\\d+|\\d+\\s?(?:dollars|bucks))\\b") },
  { code: "scam:check", re: R("\\b(?:deposit|cash)\\s+(?:it|this|the|my|a)\\s*(?:check|cheque)?\\b[^.?!]{0,60}\\b(?:send|wire|transfer|give)\\b[^.?!]{0,25}\\b(?:back|difference|rest|remainder)\\b|\\bsend (?:me )?back the (?:difference|rest|remainder|extra)\\b") },
  { code: "scam:investment", re: R("\\b(?:make|making|made|earn|earning|pull in|clear)\\s+(?:like\\s+|about\\s+)?\\$?\\d+(?:k|,\\d{3})?\\s+(?:a|per|every|each)\\s+(?:day|week|month)\\b|\\btrading\\s+(?:gold|forex|stocks|options|futures|silver|oil|crypto)\\b|\\breturns?\\s+(?:are|is|were|have been)\\s+(?:crazy|insane|huge|amazing|unreal|incredible|guaranteed)\\b|\\b(?:set|sign|get)\\s+(?:you|u)\\s+up\\b[^.?!]{0,40}\\b(?:account|platform|app|wallet|trading|invest)|\\bwith my (?:mentor|broker|financial advisor|account manager)\\b") },
  { code: "offplatform:app", re: R(`\\b(?:add|find|message|text|dm|hit|reach|talk|chat|follow|move|switch|continue|download|join|call)\\b[^.?!]{0,30}\\b(?:on|via|over|to|in)\\s+${APPS}\\b`) },
  { code: "offplatform:app", re: R(`\\b${APPS}\\s+(?:me|instead|is (?:easier|better)|is my)\\b|\\b(?:do|have)\\s+(?:you|u)\\s+(?:have|got|use|on)\\s+${APPS}\\b|\\b(?:my|your|ur)\\s+${APPS}\\b`) },
  { code: "offplatform:app", re: R(`\\b(?:download|install|get|use|open|join)\\s+${APPS}\\b`) },
  { code: "offplatform:direct", re: R("\\b(?:text|call|email|message|dm)\\s+me\\s+(?:directly|instead|privately|on my (?:cell|phone))\\b|\\bmy (?:personal|private|other|real|direct) (?:number|phone|email|cell|line)\\b|\\b(?:talk|chat|message|text|continue|move|take this)\\b[^.?!]{0,25}\\b(?:off|outside(?: of)?)\\s+(?:this|the|here|of here)\\b|\\boff (?:this|the) (?:app|platform|site|agent|thing)\\b|\\b(?:without|skip|cut out|bypass) (?:the|this) (?:agent|middleman|app|bot)\\b|\\bnot (?:through|via|on|in|with) (?:this|the) (?:bot|agent|app|middleman|thing)\\b|\\b(?:talk|chat|text|speak)\\s+(?:somewhere|someplace)\\s+(?:private|else)\\b") },
  { code: "fishing:contact", re: R("\\b(?:what'?s|whats|what is|give me|send me|can i (?:get|have)|could i (?:get|have)|drop|share|tell me)\\s+(?:your|ur|her|his|their)\\s+(?:phone ?number|number|phone|cell|digits|email|e-mail|insta|ig|snap|handle|socials?|@|last name|full name|surname)\\b") },
  { code: "fishing:location", re: R("\\bwhere (?:exactly )?do (?:you|u) (?:live|stay|sleep)\\b|\\b(?:your|ur) (?:home |street |exact )?address\\b|\\bwhich (?:building|apartment|apt|street|floor) (?:are|do) (?:you|u)\\b|\\bwhere do (?:you|u) work(?! out)\\b|\\bwhat (?:company|office) do (?:you|u) work (?:at|for)\\b") },
  { code: "injection", re: R("\\b(?:ignore|disregard|forget|override)\\s+(?:all\\s+|your\\s+|the\\s+|any\\s+)?(?:previous|prior|above|earlier|system)?\\s*(?:instructions|rules|prompts?|directions|guidelines)\\b|\\b(?:system prompt|developer mode|jailbreak|you are now|pretend (?:you are|to be) (?:the|an?) (?:admin|agent|system))\\b|\\b(?:agent|assistant|bot|ai)\\b[,:]?\\s+(?:please\\s+)?(?:tell|give|send|share|reveal|show)\\s+(?:me|us)\\b[^.?!]{0,40}\\b(?:her|his|their|number|phone|email|address|last name|rating|score|photo)") },
  { code: "rating:probe", re: R("\\b(?:how|what)\\b[^.?!]{0,30}\\b(?:hot|attractive|cute|good[- ]looking|pretty|handsome|sexy|ugly)\\b[^.?!]{0,30}\\b(?:rate|rated|rating|score|scored|rank|ranked|grade|graded|think)\\b") },
  { code: "rating:probe", re: R("\\b(?:my|your|ur|her|his|their|our)\\s+(?:rating|score|rank|ranking|percentile|tier|elo|attractiveness|looks? score|hotness|hotness score|desirability)\\b") },
  { code: "rating:probe", re: R("\\b(?:rate|rated|rating|score|scored|rank|ranked|grade|graded)\\s+(?:me|you|u|her|him|them|my (?:looks|face|body|photos?|pics?)|your (?:looks|face|body|photos?|pics?))\\b") },
  { code: "rating:probe", re: R("\\b(?:did|does|do|would|will|can)\\s+(?:the\\s+|your\\s+|this\\s+|ur\\s+)?(?:app|agent|algorithm|algo|matchmaker|ai|system|bot|slop|you|u)\\b[^.?!]{0,40}\\b(?:rate|rated|rates|score|scored|scores|rank|ranked|ranks|grade|grades|graded|think i'?m (?:hot|cute|attractive|ugly)|find me (?:hot|attractive)|consider me (?:hot|attractive))\\b") },
  { code: "rating:probe", re: R("\\b(?:equally|similarly|more|less|as) (?:attractive|hot|good[- ]looking)\\b|\\bsame level of (?:hotness|attractiveness|looks)\\b|\\b(?:my|your|her|his)\\s+(?:number|score|rating)\\s+(?:out of|/)\\s?(?:10|ten)\\b|\\bwhat'?s my number\\b|\\b(?:who|which of us)\\s+(?:scored|ranked|rated|got rated|is rated|was rated)\\b|\\b(?:my|your|our|her|his)\\s+(?:photos?|pics?|pictures?|looks|face|selfies?)\\s+(?:were |was |get |got |are |is |been )?(?:scored|rated|ranked|graded|judged)\\b|\\b(?:rank|ranked|rate|rated|score|scored)\\s+(?:high|higher|low|lower|well|badly|top)\\s+(?:for|on)\\s+(?:looks|appearance|attractiveness)\\b") },
  { code: "rating:probe", re: R("\\bwhat (?:tier|rank|level|score|percentile|rating|number)\\s+(?:am i|are you|are u|is (?:she|he|they|mine|yours))\\b|\\b(?:rate|rates|rated|rank|ranks|ranked|score|scores|scored|grade|grades|graded|judge|judges)\\s+(?:us|people|members|everyone|users)\\s+(?:on|by|for)\\s+(?:looks|appearance|attractiveness|photos?|pics?|faces?|bodies)\\b") },
  { code: "rating:word", re: R("\\bappearance\\s*:|\\bphoto rating\\b|\\b(?:hotness|attractiveness|percentile|clef|body ?type|looks? (?:rating|score|tier|level|match)|(?:out of|in) (?:my|your|ur|her|his|their) league)\\b") },
  { code: "rating:word", re: R("\\b(?:you'?re|ur|you are|she'?s|he'?s|i'?m|im)\\s+(?:a|an|like a)\\s+(?:\\d{1,2}|ten|nine|eight|seven|six|five|solid \\d{1,2})(?:\\s?/\\s?10| out of (?:10|ten))?(?=\\s*(?:$|[.!?,;)]|out of|lol|haha|tbh|honestly|right|though))") },
  { code: "harass_severe:threat", re: R(otherThreats.source + "|" + OR_ELSE_THREAT), matches: text => otherThreats.test(text) || hasOrElseThreat(text) },
  { code: "harass_severe:slur", re: R("\\b(?:fag(?:got)?s?|n[i]gg(?:a|er|ah|uh|az)s?|trann(?:y|ie)s?|kikes?|spics?|chinks?|retard(?:ed|s)?|dykes?|wetbacks?|shemales?|towelheads?|raghead)\\b") },
  { code: "harass:insult", re: R("\\b(?:fuck (?:you|off|u)|f off|stfu|bitch|whore|slut|cunt|skank|hoe|piece of shit|go die|kys|kill yourself|nobody (?:would|will|could) (?:ever )?(?:want|love|date|believe) (?:you|u)|(?:you|u)(?:'?re| are|r) (?:so |such an? |an? )?(?:ugly|fat|disgusting|gross|worthless|pathetic|nothing|a joke|trash|garbage|loser|idiot|moron|chubby|hideous))\\b") },
  { code: "harass:insult", re: R("\\b(?:waste of (?:space|air|oxygen|skin)|shut (?:up|ur mouth|your mouth)|(?:you'?d|you would|you'?ll|u'?d|ud) (?:be|look) (?:prettier|hotter|cuter|sexier|thinner|skinnier|more attractive|better looking|less ugly) if|(?:you|u) (?:should|need to|could|gotta) lose (?:some |a little |a bit of )?weight|if (?:you|u) lost (?:some )?weight|(?:you'?re|you are|ur|u r) (?:a |such a |just a )?(?:tease|prude|cocktease|gold ?digger)|typical (?:stuck[- ]up )?(?:bitch|woman|girl|guy|female))\\b") },
  { code: "harass:pressure", re: R("\\b(?:don'?t|do not|stop) (?:you )?(?:dare )?(?:ignore|ignoring|ghost|ghosting|igoring) me\\b|\\bi can see (?:you'?re|you are|u r|ur|that you'?re) (?:online|active|typing|reading)\\b|\\bwhether (?:you|u) like it or not\\b|\\b(?:no ?one|nobody) (?:will|would|is going to|is gonna) believe (?:you|u)\\b|\\b(?:i'?m|i am|i'?ll be|i will be|i'?m gonna be|gonna be|i'?ll wait|i will wait)\\s+(?:waiting\\s+)?(?:outside|at|by|in front of)\\s+(?:your|ur)\\s+(?:building|place|apartment|apt|door|work|office|house|job)\\b|\\b(?:tell|telling|show|showing)\\s+(?:everyone|everybody|all your friends|your friends|people)\\b[^.?!]{0,30}\\b(?:you'?re|you are|ur|about you|what you)\\b|\\b(?:you|u) owe me\\b") },
  { code: "harass:sexual", re: R("\\b(?:send|show)\\s+(?:me\\s+)?(?:nudes?|noods|naughty pics?|(?:a |some |more )?(?:pics?|photos?|pictures?|selfies?) of (?:your|ur) (?:body|tits|boobs|ass|chest|dick|butt|legs|feet)|(?:a |some |more )?(?:body|bikini|lingerie|bed(?:room)?) (?:pics?|photos?|selfies?)|something sexy|a sexy (?:pic|photo))\\b|\\bnudes\\b|\\bnude (?:pics?|photos?|selfies?)\\b|\\bdtf\\b|\\bdon'?t be (?:a |so |such a )?(?:prude|tease|frigid|uptight)\\b|\\b(?:you|u) know (?:you|u) want (?:it|this|me)\\b|\\bwe both know (?:why|what) (?:we'?re|this is|you)\\b|\\b(?:you|u) owe me\\b|\\bwhat are (?:you|u) wearing\\b|\\b(?:bring|wear)\\b[^.?!]{0,15}\\b(?:lingerie|condoms?)\\b|\\b(?:sex|fuck|smash|bang|hook ?up|sleep together|sleep with (?:me|you))\\b[^.?!]{0,40}\\b(?:tonight|first|after|right after|instead|now|before)\\b|\\b(?:skip|forget)\\b[^.?!]{0,15}\\b(?:the )?(?:coffee|date|drinks|dinner|museum|walk)\\b[^.?!]{0,30}\\b(?:my|your) (?:place|apartment|bed)\\b|\\b(?:back to|come over to|come to) (?:my|your) (?:place|apartment|bed|room|hotel)\\b") },
];

const CURRENT_TEEN_NUMBER = `1[3-7](?![.,]\\d|${AGE_BIRTHDAY_AFTER_AGE}|${AGE_DISTANT_BIRTHDAY_AFTER_AGE})`;

const MINOR_SIGNAL = R(`\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?${CURRENT_TEEN_NUMBER}(?!\\s*(?:min|mins|minutes|blocks|miles|mi|km|away|%|stops|floors|hours|hrs|seconds|cm|lbs|k)\\b)(?:\\b|\\s*(?:yo|y/o|years? old)\\b)|\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?a\\s+${CURRENT_TEEN_NUMBER}\\s*-?\\s*(?:yo|y/o|years?[- ]old)\\b|(?<!\\d[.,])\\b${CURRENT_TEEN_NUMBER}\\s*-?\\s*(?:yo|y/o|years?[- ]old)(?:\\s+(?:girl|guy|boy|kid))?\\s+here\\b|(?<!\\d[.,])(?<!\\b(?!(?:we|age)\\b)[a-z]+(?:'s|'re|\\s+(?:is|was|are|were))\\s+)(?<!\\b(?:my|our|his|her|their|your|ur)\\s+(?!age\\b)[a-z]+(?:\\s+(?!age\\b)[a-z]+)?[\\s,]+)\\b${CURRENT_TEEN_NUMBER}\\s*-?\\s*(?:yo|y/o|years?[- ]old)\\b|\\b(?:i'?m|i am|im) (?:still )?(?:in|at) (?:high school|middle school|hs)\\b|\\bmy (?:mom|dad|parents) (?:won'?t|wont|don'?t|dont) let me\\b|\\bnot 18 (?:yet|until)\\b|\\b(?:i'?m|i am|im) (?:under ?18|underage|a minor)\\b|\\bhomeroom\\b`);

const TEEN_RELAY_RULES: { code: string; re: RegExp }[] = [
  { code: "teen:secrecy", re: R("\\b(?:don'?t|do not|dont|never)\\s+(?:tell|show|mention (?:this|it|me) to)\\s+(?:your|ur|anyone|anybody|nobody)\\b|\\b(?:our|a|little)\\s+(?:little\\s+)?secret\\b|\\bkeep\\s+(?:this|it|us|that)\\s+(?:between us|(?:a )?secret|quiet|private|to yourself|from)\\b|\\bbetween (?:you and me|us)\\b|\\b(?:delete|clear|erase)\\s+(?:this|these|the|our|my)\\s+(?:messages?|texts?|chats?|convo|conversation)\\b|\\b(?:parents?|mom|dad|mum|family|teachers?)\\s+(?:can'?t|cannot|shouldn'?t|don'?t need to|doesn'?t need to|won'?t)\\s+(?:know|find out|see)\\b") },
  { code: "teen:age_probe", re: R("\\bhow old (?:are|r) (?:you|u)\\b|\\b(?:what'?s|whats|what is) (?:your|ur) (?:real |actual |true )?age\\b|\\b(?:are|r) (?:you|u) (?:really|actually) \\d{1,2}\\b|\\bwhat grade (?:are|r) (?:you|u)\\b|\\b(?:are|r) (?:you|u) (?:home )?(?:alone|by yourself)\\b|\\b(?:are|r|is) (?:your|ur) (?:parents?|mom|dad|mum|family) (?:home|around|there|out|away|asleep|awake)\\b|\\bwhen do (?:your|ur) (?:parents?|mom|dad|mum) (?:leave|get home|come home)\\b") },
  { code: "teen:gift", re: R("\\b(?:gift ?cards?|gifts?|presents?|money|cash|venmo|cash ?app|zelle|paypal|robux|v-?bucks|allowance)\\b|\\b(?:buy|get|send|give|pay for|treat)\\s+(?:you|u)\\b|\\bmy treat\\b|\\bon me\\b") },
  { code: "teen:picture", re: R("\\b(?:send|post|share|show|take)\\s+(?:me\\s+)?(?:a\\s+|some\\s+|more\\s+|another\\s+|your\\s+|ur\\s+)?(?:pics?|photos?|pictures?|selfies?|snaps?|videos?|vids?)\\b|\\bwhat do (?:you|u) look like\\b|\\bshow me (?:yourself|you|ur|your)\\b|\\b(?:pic|photo|picture|selfie|video)s? of (?:you|u|yourself)\\b|\\bface ?time\\b|\\bvideo ?(?:call|chat)\\b|\\bcam(?:era)?\\s+on\\b") },
  { code: "teen:alone", re: R("\\b(?:meet|hang(?: out)?|come|be|go)\\s+(?:up\\s+)?(?:alone|by (?:yourself|urself))\\b|\\bjust (?:the two of us|you and me|us two|me and you)\\b|\\b(?:come|go|get|stop)\\s+(?:over\\s+)?(?:to|back to|by)\\s+(?:my|your|ur)\\s+(?:place|house|home|room|apartment|apt|car|hotel|building)\\b|\\b(?:my|your|ur)\\s+(?:place|house|home|room|apartment|apt|car|hotel|bedroom)\\b|\\bpick (?:you|u) up\\b|\\b(?:give (?:you|u) a ride|drive (?:you|u))\\b|\\b(?:don'?t|dont|no need to|without)\\s+(?:bring(?:ing)?|tell(?:ing)?)\\s+(?:anyone|anybody|friends?|your friends?|ur friends?|parents?)\\b|\\bcome over\\b|\\bsleep ?over\\b") },
  { code: "teen:location", re: R("\\b(?:your|ur) (?:home |street |exact )?address\\b|\\bwhere (?:exactly )?do (?:you|u) (?:live|stay|sleep)\\b|\\bwhich (?:school|high school|middle school|neighborhood|building|street|block|apartment|floor)\\b|\\bwhat (?:school|high school|middle school|street|building)\\b|\\bwhere do (?:you|u) go to school\\b|\\bwhere (?:are|r) (?:you|u) (?:right )?now\\b|\\b(?:send|share|drop)\\s+(?:me\\s+)?(?:your|ur)\\s+(?:location|pin|address)\\b|\\bwhat (?:time|days?) (?:do (?:you|u) )?(?:get out of|leave|finish) school\\b") },
  { code: "teen:contact", re: R(`\\b(?:phone|number|digits|cell|email|e-mail|gmail|handle|username|user ?name|tiktok|roblox|minecraft|${APPS})\\b|@[a-z0-9_.]{2,}`) },
];

const ADULT_NUMBER = "(?:19|[2-9]\\d)";
const NOT_AN_AGE = "(?!\\s*(?:%|\\$|\\+|/|:|(?:min|mins|minutes|blocks|miles|mi|km|away|stops|floors|hours|hrs|seconds|secs|cm|lbs|kg|k|dollars|bucks|feet|ft|percent|times|days|weeks|months|people|ppl)\\b))";
const SELF_IS = "(?:i'?m|i am|im)\\s+(?:actually\\s+|really\\s+|literally\\s+|already\\s+|now\\s+|like\\s+|basically\\s+|almost\\s+)?";
const ADULT_AGE_RULES: RegExp[] = [
  R(`\\b${SELF_IS}${ADULT_NUMBER}\\b${NOT_AN_AGE}`),
  R(`\\b${SELF_IS}(?:nineteen|twenty|thirty|forty|fifty|sixty)\\b${NOT_AN_AGE}`),
  R("\\b(?:i'?m|i am|im)\\s+in\\s+my\\s+(?:[2-6]0'?s|twenties|thirties|forties|fifties|sixties)\\b"),
  R(`\\bmy age is\\s+${ADULT_NUMBER}\\b`),
  R(`\\bi (?:just )?turned\\s+${ADULT_NUMBER}\\b`),
];
const G = (s: string) => new RegExp(s, "gi");
const BIRTH_YEAR_RULES: { re: RegExp; year: (digits: string) => number }[] = [
  { re: G("\\b(?:i was|i'?m|i am|im)\\s+born\\b[^.?!]{0,30}?\\b((?:19|20)\\d{2})\\b"), year: Number },
  { re: G("(?:^|[.!?,;]\\s*|\\b(?:lol|actually|btw|tbh|fyi|and|but|so|oh)\\s+)born\\b[^.?!]{0,30}?\\b((?:19|20)\\d{2})\\b"), year: Number },
  { re: G("\\bmy\\s+(?:birthday|bday|b-day|birth ?date|date of birth|dob|birth year)\\b[^.?!]{0,30}?\\b((?:19|20)\\d{2})\\b"), year: Number },
  { re: G("\\b(?:dob|birth year)\\s*[:=-]?[^.?!]{0,20}?\\b((?:19|20)\\d{2})\\b"), year: Number },
  { re: G("\\b(?:i was |i'?m |i am |im )?born in\\s+'?(9\\d)\\b"), year: digits => 1900 + Number(digits) },
];

function adultAgeStated(variants: readonly string[], now: number): boolean {
  if (variants.some(v => ADULT_AGE_RULES.some(re => re.test(v)))) return true;
  const today = latestDayKeyOf(now);
  return variants.some(v => BIRTH_YEAR_RULES.some(({ re, year }) =>
    [...v.matchAll(re)].some(m => ageOnDay(year(m[1]!) * 10000 + 101, today) > teenFriendMaxAge)));
}

function teenRelayCodes(text: string, now: number): string[] {
  const vs = textVariants(text.replace(/[’‘`´]/g, "'"));
  const codes = TEEN_RELAY_RULES.filter(({ re }) => vs.some(v => re.test(v))).map(({ code }) => code);
  return adultAgeStated(vs, now) ? [...codes, "teen:adult_age"] : codes;
}

const DIGIT_WORDS: Record<string, string> = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
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

export function isOpaquePhotoId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id) && !/\d{7,}/.test(id.replace(/[-_]/g, "")) && !/^(?:https?|www|data|file)/i.test(id);
}

export function relayGuard(o: { facts?: Owned[]; forbidden?: Owned[]; canaries?: string[] } = {}): LeakGuard {
  return new LeakGuard({ facts: o.facts ?? [], forbidden: o.forbidden ?? [], canaries: o.canaries ?? [], canaryShapes: true, contacts: true });
}
const DEFAULT_GUARD = relayGuard();

const cleanName = (s: string) => {
  const n = (s ?? "").normalize("NFKC").replace(/[^\p{L}\p{M}' -]/gu, "").trim().split(/\s+/)[0] ?? "";
  return n.length >= 1 && n.length <= 30 ? n : "Your match";
};
export const RELAY_WORDING = {
  text: (name: string, body: string) => `${name} says: "${body}"`,
  photo: (name: string, caption?: string) => (caption ? `${name} sent you a photo: "${caption}"` : `${name} sent you a photo.`),
  contact: (name: string, kind: "phone" | "email", value: string) =>
    `${name} asked me to send you their ${kind === "phone" ? "number" : "email"}: ${value}. Say "send them my number" if you want me to send yours back.`,
};
const PASS_NOTICE = "Sent.";
const BLOCK_NOTICE: Record<RelayBlockNotice, string> = {
  NoticePlain: "I didn't send that, so it didn't reach them.",
  NoticeConsent: "I didn't send that. Tell me again that you want me to send it, and I will.",
  NoticeRating: "I didn't send that. I can't share anything like that, and I don't pass questions about it on.",
  NoticeContact: "I didn't send that. I don't pass on contact details, handles, addresses or other apps inside a message.",
  NoticeRetry: "I couldn't check that message just now, so I didn't send it. Please try again in a few minutes.",
  NoticeRate: "I didn't send that: you've sent a lot in a short time. Please try again a bit later.",
};

export function relaySenderNotice(reasons: readonly string[]): string {
  if (!reasons.length) return PASS_NOTICE;
  const families = new Set(reasons.map(familyOf));
  const has = (...f: string[]) => f.some(x => families.has(x));
  return BLOCK_NOTICE[relayBlockNotice([...families].some(f => !EXPLAINED_FAMILIES.has(f)), has("consent"), has("rating"), [...CONTACT_FAMILIES].some(f => families.has(f)), has("classifier"), has("rate"))];
}

const normPhone = (v: string) => { const d = v.replace(/[^\d+]/g, ""); return /^\+?\d{10,15}$/.test(d) ? d : null; };
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}$/;

export function relayItem(item: RelayItem, ctx: RelayContext): RelayResult {
  const L = { ...RELAY_LIMITS, ...(ctx.limits ?? {}) };
  const reasons = new Set<string>();
  const { opportunity: op, sender: s, recipient: r } = ctx;
  let ageSignal = false;

  if (s.id !== item.from || r.id !== item.to || item.from === item.to || !op.participants.includes(item.from) || !op.participants.includes(item.to)) reasons.add("party:not_participant");
  const teenPair = ctx.teenFriendPair === true;
  if (!relayKindAllowed(item.kind === "text", canBeMatched(s.age) && canBeMatched(r.age), teenPair)) reasons.add("minor:party");
  if (ctx.blocked) reasons.add("party:blocked");
  if (r.optedOut) reasons.add("optout:recipient");
  if (s.optedOut) reasons.add("optout:sender");
  if (s.held) reasons.add("safety:sender_held");
  if (r.held) reasons.add("safety:recipient_held");
  if (op.status !== "mutual") reasons.add(`state:${op.status}`);
  else if (!op.participants.every(p => op.acceptedBy.includes(p))) reasons.add("state:not_mutual");

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
    if (text) reasons.add("contact_share:free_text");
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
        if (code.startsWith("offplatform:") && op.metAt !== undefined && op.metAt <= ctx.now && !teenPair) continue;
        reasons.add(code);
      }
      if (teenPair) for (const code of teenRelayCodes(text, ctx.now)) reasons.add(code);
      if (c.minorSignal) { reasons.add(teenPair && !canBeMatched(s.age) ? "teen:age_talk" : "minor:signal"); ageSignal = true; }
      for (const code of ctx.extraRules?.(text) ?? []) if (/^[a-z_]+:[a-z0-9_]+$/.test(code)) reasons.add(code);
    }
  }

  const mine = (ctx.history ?? []).filter(h => h.opportunityId === op.id && h.from === item.from && h.itemId !== item.id);
  if (mine.filter(h => item.at - h.at >= 0 && item.at - h.at < L.burst.windowMs).length >= L.burst.n) reasons.add("rate:burst");
  if (mine.filter(h => item.at - h.at >= 0 && item.at - h.at < 86_400_000).length >= (teenPair ? L.teenDaily : L.daily)) reasons.add("rate:daily");
  if (item.kind === "photo" && mine.filter(h => h.kind === "photo" && h.decision === "pass" && item.at - h.at >= 0 && item.at - h.at < 86_400_000).length >= L.photosDaily) reasons.add("rate:photos");
  if (item.kind === "contact_share" && mine.filter(h => h.kind === "contact_share" && h.contactShared).length >= L.contactShares) reasons.add("contact_share:already_shared");

  return finish(item, ctx, [...reasons].sort(), { contactValue, photos, text, ageSignal });
}

function finish(item: RelayItem, ctx: RelayContext, reasons: string[], x: { contactValue: string | null; photos: string[]; text: string; ageSignal: boolean }): RelayResult {
  const decision: RelayDecision = relayVerdict(reasons.length > 0) === "Pass" ? "pass" : "block";
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
  return { decision, reasons, rendered, photos: decision === "pass" ? x.photos : [], record, senderNotice: relaySenderNotice(reasons) };
}

export interface RelayClassifierInput {
  text: string;
  kind: RelayKind;
  context?: readonly string[];
  met?: boolean;
}
export interface RelayClassifierOutput { flags: string[]; block?: string[]; scores?: Record<string, number>; unavailable?: true }
export type RelayClassifierHook = (input: RelayClassifierInput) => Promise<RelayClassifierOutput>;
export const simulatedRelayClassifier: RelayClassifierHook = async () => ({ flags: [], block: [] });

const flagCode = (f: string) => f.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 24) || "flag";
const CLASSIFIER_MINOR_FLAG = "minor_signal";
const CLASSIFIER_UNAVAILABLE = "classifier:unavailable";

interface ClassifierAnswer { flags: string[]; block: string[] }
function classifierAnswer(x: unknown): ClassifierAnswer | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) && v.every(s => typeof s === "string") ? (v as string[]) : undefined);
  const flags = strings(o.flags), block = o.block === undefined ? [] : strings(o.block);
  if (o.unavailable !== undefined || !flags || !block) return undefined;
  return { flags, block };
}

const causePart =(v: string) => v.replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) || "unknown";
function thrownCause(e: unknown): string {
  if (!(e instanceof Error)) return "thrown";
  const code = "code" in e && typeof e.code === "string" ? `:${causePart(e.code)}` : "";
  return `${causePart(e.name)}${code}`;
}
const unreadCause = (raw: unknown) =>
  typeof raw === "object" && raw !== null && "unavailable" in raw && raw.unavailable !== undefined ? "unavailable" : "invalid_answer";

async function askClassifier(hook: RelayClassifierHook | undefined, input: RelayClassifierInput): Promise<{ raw: unknown; error?: string }> {
  if (!hook) return { raw: undefined, error: "no_classifier" };
  try {
    return { raw: await hook(input) };
  } catch (e) {
    return { raw: undefined, error: thrownCause(e) };
  }
}

export async function relayItemAsync(item: RelayItem, ctx: RelayContext, o: { hook?: RelayClassifierHook } = {}): Promise<RelayResult> {
  const first = relayItem(item, ctx);
  const text = (item.text ?? "").trim();
  const teenPair = ctx.teenFriendPair === true;
  const read = relayClassifierReads(!!text, first.reasons.some(r => FINAL_FAMILIES.has(familyOf(r))), first.reasons.length > 0, teenPair);
  let extra: string[] = [];
  let classifierAgeSignal = false;
  let classifierError: string | undefined;
  if (read) {
    const asked = await askClassifier(o.hook, { text, kind: item.kind, context: [...(ctx.thread ?? [])], met: !teenPair && ctx.opportunity.metAt !== undefined && ctx.opportunity.metAt <= ctx.now });
    const answer = classifierAnswer(asked.raw);
    classifierError = asked.error ?? (answer === undefined ? unreadCause(asked.raw) : undefined);
    const flags = (answer?.flags ?? []).map(flagCode), block = (answer?.block ?? []).map(flagCode);
    const reading = relayClassifierReading(answer !== undefined, flags.length + block.length > 0);
    if (reading === "ReadingUnavailable") extra = [CLASSIFIER_UNAVAILABLE];
    else if (reading === "ReadingFlagged") {
      classifierAgeSignal = [...flags, ...block].includes(CLASSIFIER_MINOR_FLAG);
      extra = [...new Set([...flags.map(f => `clef:${f}`), ...block.map(f => `clef_severe:${f}`)])];
    }
  }
  if (!extra.length) return first;
  const result = finish(item, ctx, [...new Set([...first.reasons, ...extra])].sort(), { contactValue: null, photos: [], text, ageSignal: first.record.ageSignal || classifierAgeSignal });
  return classifierError ? { ...result, classifierError } : result;
}

type RelayRequest =
  | { kind: "contact_share"; targetName?: string }
  | { kind: "photo"; targetName?: string }
  | { kind: "text"; body: string; targetName?: string }
  | { kind: "none" };

const NEG = /\b(?:don'?t|dont|do not|never|not yet|no need to|stop|shouldn'?t|rather not|hold off|wait (?:to|before)|not until)\b/;
const SHARE_NEG = /\b(?:not going to|not gonna|can'?t|cannot|can not|couldn'?t|wouldn'?t|wasn'?t|didn'?t|mustn'?t|won'?t|not ready to|no way|refuse to|(?:will|would|could|did|should|must|shall|'ll)\s+not)(?!\s+wait\b)\b/;
const HEDGE = /^\s*(?:should i|do you think|is it ok(?:ay)? (?:to|if)|would it be|what if|maybe|if)\b|\b(?:later|after the date|after we meet|eventually|at some point|one day|tomorrow)\b|\b(?:should i|or not)\b/;
const RELAY_NAME = String.raw`(?!(?:me|us|it|everyone|everybody|nobody|anyone|this|that)\b)\p{L}[\p{L}'-]{1,30}`;
const PRIVATE_RELAY_RECIPIENT = String.raw`(?:my (?:match|date)|${RELAY_NAME})`;
const OTHER = String.raw`(?:them|him|her|${PRIVATE_RELAY_RECIPIENT})`;
const CONTACT_SWAP_NAME = "phone number|number|phone|digits|cell|contact(?: info)?";
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
const PRIVATE_RELAY_POST_ATTRIBUTION = /^\s*(?:[,–—]|-+\s)\s*(?:(?!(?:i|we)\b)\p{L}[\p{L}'-]*\s+){1,3}(?:says?|said)\s*$/iu;
const PRIVATE_RELAY_NEXT_ATTRIBUTION = /^\s*(?:(?!(?:i|we)\b)\p{L}[\p{L}'-]*\s+){1,3}(?:says?|said)(?:\s+(?:so|that|this|it))?\s*$/iu;
const PRIVATE_RELAY_CORRECTION = /^[,\s–—]*(?:instead|rather|actually|no)[,\s:]+/i;
// A quotation can contain a refusal or a command, but it does not speak for the member.
const RELAY_QUOTATION = /(?<!\d)"[^"]*(?:"|$)|(?<![a-z0-9])'(?:[^']|(?<=[a-z0-9])'(?=[a-z0-9]))*(?:'|$)/gi;

const quotedRelaySeparator = (quotation: string): string => /[.!?…]\s*["']$/.test(quotation) ? ";" : " ";

// Keep offsets so a request can be compared with the actual words before it.
const ownRelayWords = (text: string): string => text.replace(/[“”]/g, '"')
  .replace(RELAY_QUOTATION, quotation => " ".repeat(quotation.length));

function directRelayLead(prefix: string): boolean {
  // Treat a complete quoted sentence as a boundary without reading its words as consent.
  const clause = prefix.replace(/[“”]/g, '"')
    .replace(RELAY_QUOTATION, quotedRelaySeparator)
    .split(RELAY_SENTENCE).at(-1)!;
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
  const [here = "", next = ""] = text.slice(end).split(RELAY_SENTENCE, 2);
  return PRIVATE_RELAY_POST_ATTRIBUTION.test(here) || PRIVATE_RELAY_NEXT_ATTRIBUTION.test(next);
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

export function withdrawsRelaySwap(text: string): boolean {
  const own = text.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"')
    .replace(RELAY_QUOTATION, quotedRelaySeparator).trim().toLowerCase();
  const authored = own.replace(REPORTED_SWAP_SEGMENT, (_segment, boundary: string, report: string) => {
    const contrast = OWN_SWAP_CONTRAST.exec(report);
    return contrast ? boundary + report.slice(contrast.index) : boundary;
  });
  return refusesNumberSwap(authored);
}

export function parseRelayRequest(text: string): RelayRequest {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const own = ownRelayWords(t);
  const spoken = own.trim();
  const start = own.length - own.trimStart().length;
  const contacts = [...spoken.matchAll(CONTACT_REQ)];
  const photos = [...spoken.matchAll(PHOTO_REQ)];
  const direct = (candidate: RegExpMatchArray) => directRelayLead(t.slice(0, start + candidate.index!))
    && !reportsPrivateRequest(spoken, candidate);
  const contact = contacts.find(direct);
  const privateRequest = contact ?? photos.find(direct);
  const modal = RELAY_MODAL.exec(t);
  const envelope = TEXT_REQ.exec(t.slice(modal?.[0].length ?? 0));
  if (envelope && (envelope[1]!.toLowerCase() !== "let" || envelope[3])) {
    const payload = envelope[4]!;
    const bodyStart = t.length - payload.length;
    const delegates = (candidate: RegExpMatchArray) => TEXT_PRIVATE_DIRECTIVE_LEAD.test(t.slice(bodyStart, start + candidate.index!));
    // An outer delegation does not subsume a later direct request. A declarative text body is separate.
    if (!contacts.some(delegates) && !photos.some(delegates)) {
      const declarative = envelope[1]!.toLowerCase() !== "ask" && /^(?:i\b|we\b|my\b|our\b)/i.test(payload);
      const body = (modal && declarative ? payload.replace(/\?$/, "") : payload).trim();
      const target = envelope[2]!;
      if (body) return { kind: "text", body, ...(IMPLICIT_RELAY_TARGET.test(target) ? {} : { targetName: target }) };
    }
  }

  if (privateRequest) {
    if (!privateRequestPermitted(t, own, start, privateRequest, [...contacts, ...photos], !!contact)) return { kind: "none" };
    if (!relayRecipientIsComplete(t.slice(start), privateRequest, privateRequest.groups?.trailingRecipient ?? privateRequest.groups?.affirmedRecipient)) return { kind: "none" };
    const recipient = privateRequest.groups?.leadingRecipient ?? privateRequest.groups?.trailingRecipient ?? privateRequest.groups?.affirmedRecipient;
    const targetName = recipient && !IMPLICIT_RELAY_TARGET.test(recipient) ? recipient : undefined;
    return { kind: contact ? "contact_share" : "photo", ...(targetName === undefined ? {} : { targetName }) };
  }
  return { kind: "none" };
}

function privateRequestPermitted(t: string, own: string, start: number, privateRequest: RegExpMatchArray, all: readonly RegExpMatchArray[], contact: boolean): boolean {
  const spoken = own.trim();
  const privateModal = RELAY_MODAL.exec(spoken);
  const low = spoken.toLowerCase();
  const clauses = relayClauses(low);
  const question = relayIsIndirectQuestion(spoken.endsWith("?"), /^(?:please\s+)?(?:can|could|would)\s+(?:you|u)\b/i.test(spoken),
    privateModal?.[0].length === privateRequest.index, /^(?:should|would\s+it|could\s+i|is it|do you|can i)\b/i.test(spoken));
  const uncertain = HEDGE.test(low) || uncertainPrivateTransfer(clauses)
    || conditionsPrivateRequest(own.slice(start), t.slice(start), privateRequest.index! + privateRequest[0].length, privateRequest, contact)
    || question || privateShareQualified(spoken, privateRequest)
    || priorSentenceConditionsShare(t.slice(start), privateRequest, contact);
  // spec/relayDecision.md, "A refusal or uncertainty cannot authorize a private item"
  const refused = refusesPrivateItem(low, contact ? PHOTO_ITEM_REFUSAL : CONTACT_ITEM_REFUSAL)
    || retractsPrivateRequest(own.slice(start), t.slice(start), privateRequest, all, contact)
    || (contact && refusesNumberSwap(low, clauses));
  return privateRelayRequestAllowed(refused, uncertain);
}

const PHOTO_RELAY_INLINE_WITH = /^\s+with\s+(?:(?:my|our)\s+(?!(?:match|date)\b)|(?:the|a|an|this|that|these|those|his|their|its|some|no|me|us)\b)/iu;
const PHOTO_RELAY_ADDED_DESTINATION = /^[^.!?;\n]*?[\s,](?:and|plus|&)\s+(?:also\s+)?(?:directly\s+|over\s+)?(?:to|with)\b/iu;
const RELAY_STATED_DESTINATION = /(?:^|[\s,:–—-])(?:directly\s+to|over\s+to|to|with)\b/giu;
const RELAY_SEND_VERB = /\b(?:send|share|give|pass|forward|text|show)\b/iu;
const RELAY_AFFIRMATION_LEAD = /^[\s,:!–—-]*(?:(?:yes|yeah|yep|ok|okay|sure|please|go ahead)[\s,:!–—-]*)+$/iu;
const RELAY_STATED_RECIPIENT = new RegExp(String.raw`^(?<trailingRecipient>${OTHER})`, "iu");

export type RelayStatedDestination = { kind: "unstated" } | { kind: "incomplete" } | { kind: "recipient"; name: string | null };

export function relayStatedDestination(text: string): RelayStatedDestination {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const own = ownRelayWords(t);
  let found: RelayStatedDestination = { kind: "unstated" };
  for (const destination of own.matchAll(RELAY_STATED_DESTINATION)) {
    const lead = own.slice(0, destination.index!).split(RELAY_SENTENCE).at(-1)!;
    if (!RELAY_SEND_VERB.test(lead) && !RELAY_AFFIRMATION_LEAD.test(lead)) continue;
    const rest = own.slice(destination.index! + destination[0].length);
    if (/^with\b/iu.test(destination[0].trim()) && (RELAY_WITH_THANKS.test(" with" + rest) || PHOTO_RELAY_INLINE_WITH.test(" with" + rest))) continue;
    const gap = /^\s+/u.exec(rest)?.[0].length ?? 0;
    const recipient = gap > 0 ? RELAY_STATED_RECIPIENT.exec(rest.slice(gap)) : null;
    if (!recipient) return { kind: "incomplete" };
    recipient.index = destination.index! + destination[0].length + gap;
    const name = recipient.groups!.trailingRecipient!;
    if (!relayRecipientIsComplete(own, recipient, name)) return { kind: "incomplete" };
    const named = IMPLICIT_RELAY_TARGET.test(name) ? null : name;
    if (found.kind === "recipient" && (found.name ?? "").toLowerCase() !== (named ?? "").toLowerCase()) return { kind: "incomplete" };
    found = { kind: "recipient", name: named };
  }
  return found;
}

export function relayPhotoReferenceAllowed(text: string): boolean {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const own = ownRelayWords(t);
  const spoken = own.trim();
  const start = own.length - own.trimStart().length;
  const photos = [...spoken.matchAll(PHOTO_REQ)];
  const request = photos.find(candidate => !reportsPrivateRequest(spoken, candidate));
  if (!request) return false;
  const modal = RELAY_MODAL.exec(t);
  const envelope = TEXT_REQ.exec(t.slice(modal?.[0].length ?? 0));
  if (envelope && TEXT_PRIVATE_DIRECTIVE_LEAD.test(t.slice(t.length - envelope[4]!.length, start + request.index!))) return false;
  const prefix = t.slice(0, start + request.index!);
  const lead = prefix.split(RELAY_SENTENCE).at(-1)!, comma = lead.lastIndexOf(",");
  if (comma >= 0 && INCOMPLETE_RELAY_ASIDE.test(lead.slice(0, comma))) return false;
  if (!directRelayLead(prefix) && RELAY_SPEECH_CUE.test(lead)) return false;
  const after = t.slice(start + request.index! + request[0].length);
  if (!PHOTO_RELAY_INLINE_WITH.test(after) && !relayRecipientIsComplete(t.slice(start), request, request.groups?.trailingRecipient)) return false;
  if (PHOTO_RELAY_ADDED_DESTINATION.test(after)) return false;
  return privateRequestPermitted(t, own, start, request, photos, false);
}

export function relayItemFromRequest(req: RelayRequest, o: { id: string; from: MemberId; to: MemberId; at: number; contact?: RelayItem["contact"]; photoIds?: readonly string[] }): RelayItem | null {
  const base = { id: o.id, from: o.from, to: o.to, at: o.at };
  if (req.kind === "text") return { ...base, kind: "text", text: req.body };
  if (req.kind === "contact_share") return o.contact ? { ...base, kind: "contact_share", contact: o.contact, consent: { kind: "contact_share", by: o.from, itemId: o.id, at: o.at } } : null;
  if (req.kind === "photo") return o.photoIds?.length ? { ...base, kind: "photo", photoIds: [...o.photoIds], consent: { kind: "photo", by: o.from, itemId: o.id, at: o.at, photoIds: [...o.photoIds] } } : null;
  return null;
}

export function pastContacts(records: readonly RelayRecord[], member: MemberId): MemberId[] {
  const out = new Set<MemberId>();
  for (const r of records) if (r.decision === "pass") { if (r.from === member) out.add(r.to); if (r.to === member) out.add(r.from); }
  return [...out].sort();
}

export interface RelayThreadMessage {
  opportunityId: string; itemId: string; from: MemberId; to: MemberId; at: number; kind: RelayKind;
  decision: RelayDecision;
  rendered: string | null;
  photoIds: string[];
  reasons: string[];
}
export function threadMessage(res: RelayResult): RelayThreadMessage {
  const r = res.record;
  return { opportunityId: r.opportunityId, itemId: r.itemId, from: r.from, to: r.to, at: r.at, kind: r.kind, decision: r.decision, rendered: res.decision === "pass" ? res.rendered : null, photoIds: res.photos, reasons: r.reasons };
}
