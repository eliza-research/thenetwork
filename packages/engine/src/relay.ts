import { relayKindAllowed, teenFriendMaxAge } from "../../core/src/generated/friendIntroAge.ts";
import { ageOnDay } from "../../core/src/generated/memberAge.ts";
import { relayBlockNotice, relayClassifierReading, relayClassifierReads, relayConsentStale, relayVerdict, type RelayBlockNotice } from "../../core/src/generated/relayDecision.ts";
import { teenRelayHeld } from "../../core/src/generated/teenIntroSwitch.ts";
import { canBeMatched, labelHash, latestDayKeyOf, LeakGuard, textVariants, type MemberId, type Owned } from "@thenetwork/core";

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
}

const FINAL_FAMILIES = new Set(["state", "party", "minor", "optout", "consent", "photo", "contact_share", "canary", "harass_severe", "format", "llm_severe", "clef_severe"]);
const CONTACT_FAMILIES = new Set(["contact", "fishing", "offplatform"]);
const EXPLAINED_FAMILIES = new Set(["consent", "rating", "rate", "classifier", ...CONTACT_FAMILIES]);
const familyOf = (reason: string) => reason.split(":")[0]!;

const R = (s: string) => new RegExp(s, "i");
const PAY = "(?:send|wire|transfer|lend|loan|venmo|zelle|cash ?app|paypal|give|spot|front)";
const MONEY = "(?:\\$\\s?\\d|\\bmoney\\b|\\bcash\\b|\\bfunds?\\b|\\bbucks\\b|\\bdollars?\\b|\\busd\\b|\\b\\d{2,5}\\b)";
const APPS = "(?:whats ?app|telegram|signal|kik|hangouts|google chat|wechat|viber|snap(?:chat)?|insta(?:gram)?|ig|facebook|messenger|fb|discord|line app|skype|imessage)";

const RELAY_RULES: { code: string; re: RegExp }[] = [
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
  { code: "harass_severe:threat", re: R("\\bi(?:'?ll| will| am going to|'?m gonna| gonna| m gonna)\\s+(?:kill|hurt|find|ruin|destroy|beat|end|stab|shoot|expose|leak|post)\\b|\\bi know where (?:you|u) (?:live|work|sleep)\\b|\\b(?:you|u)(?:'?ll| will) (?:regret|pay for)\\b|\\b(?:make|making) (?:you|u) (?:regret|pay|sorry)\\b|\\bwatch (?:your|ur) back\\b|\\bor else\\b|\\b(?:you|u)(?:'d| had)? better (?:answer|reply|respond|show|text)\\b|\\b(?:i'?ll |i will )?(?:make sure|let) everyone know|\\b(?:wait|show up|be waiting|come by|turn up)\\s+(?:for (?:you|u) )?(?:outside|at) (?:your|ur) (?:work|office|home|place|apartment|building|job|door)\\b") },
  { code: "harass_severe:slur", re: R("\\b(?:fag(?:got)?s?|n[i]gg(?:a|er|ah|uh|az)s?|trann(?:y|ie)s?|kikes?|spics?|chinks?|retard(?:ed|s)?|dykes?|wetbacks?|shemales?|towelheads?|raghead)\\b") },
  { code: "harass:insult", re: R("\\b(?:fuck (?:you|off|u)|f off|stfu|bitch|whore|slut|cunt|skank|hoe|piece of shit|go die|kys|kill yourself|nobody (?:would|will|could) (?:ever )?(?:want|love|date|believe) (?:you|u)|(?:you|u)(?:'?re| are|r) (?:so |such an? |an? )?(?:ugly|fat|disgusting|gross|worthless|pathetic|nothing|a joke|trash|garbage|loser|idiot|moron|chubby|hideous))\\b") },
  { code: "harass:insult", re: R("\\b(?:waste of (?:space|air|oxygen|skin)|shut (?:up|ur mouth|your mouth)|(?:you'?d|you would|you'?ll|u'?d|ud) (?:be|look) (?:prettier|hotter|cuter|sexier|thinner|skinnier|more attractive|better looking|less ugly) if|(?:you|u) (?:should|need to|could|gotta) lose (?:some |a little |a bit of )?weight|if (?:you|u) lost (?:some )?weight|(?:you'?re|you are|ur|u r) (?:a |such a |just a )?(?:tease|prude|cocktease|gold ?digger)|typical (?:stuck[- ]up )?(?:bitch|woman|girl|guy|female))\\b") },
  { code: "harass:pressure", re: R("\\b(?:don'?t|do not|stop) (?:you )?(?:dare )?(?:ignore|ignoring|ghost|ghosting|igoring) me\\b|\\bi can see (?:you'?re|you are|u r|ur|that you'?re) (?:online|active|typing|reading)\\b|\\bwhether (?:you|u) like it or not\\b|\\b(?:no ?one|nobody) (?:will|would|is going to|is gonna) believe (?:you|u)\\b|\\b(?:i'?m|i am|i'?ll be|i will be|i'?m gonna be|gonna be|i'?ll wait|i will wait)\\s+(?:waiting\\s+)?(?:outside|at|by|in front of)\\s+(?:your|ur)\\s+(?:building|place|apartment|apt|door|work|office|house|job)\\b|\\b(?:tell|telling|show|showing)\\s+(?:everyone|everybody|all your friends|your friends|people)\\b[^.?!]{0,30}\\b(?:you'?re|you are|ur|about you|what you)\\b|\\b(?:you|u) owe me\\b") },
  { code: "harass:sexual", re: R("\\b(?:send|show)\\s+(?:me\\s+)?(?:nudes?|noods|naughty pics?|(?:a |some |more )?(?:pics?|photos?|pictures?|selfies?) of (?:your|ur) (?:body|tits|boobs|ass|chest|dick|butt|legs|feet)|(?:a |some |more )?(?:body|bikini|lingerie|bed(?:room)?) (?:pics?|photos?|selfies?)|something sexy|a sexy (?:pic|photo))\\b|\\bnudes\\b|\\bnude (?:pics?|photos?|selfies?)\\b|\\bdtf\\b|\\bdon'?t be (?:a |so |such a )?(?:prude|tease|frigid|uptight)\\b|\\b(?:you|u) know (?:you|u) want (?:it|this|me)\\b|\\bwe both know (?:why|what) (?:we'?re|this is|you)\\b|\\b(?:you|u) owe me\\b|\\bwhat are (?:you|u) wearing\\b|\\b(?:bring|wear)\\b[^.?!]{0,15}\\b(?:lingerie|condoms?)\\b|\\b(?:sex|fuck|smash|bang|hook ?up|sleep together|sleep with (?:me|you))\\b[^.?!]{0,40}\\b(?:tonight|first|after|right after|instead|now|before)\\b|\\b(?:skip|forget)\\b[^.?!]{0,15}\\b(?:the )?(?:coffee|date|drinks|dinner|museum|walk)\\b[^.?!]{0,30}\\b(?:my|your) (?:place|apartment|bed)\\b|\\b(?:back to|come over to|come to) (?:my|your) (?:place|apartment|bed|room|hotel)\\b") },
];

const MINOR_SIGNAL = R("\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?(?:1[3-7])(?!\\s*(?:min|mins|minutes|blocks|miles|mi|km|away|%|stops|floors|hours|hrs|seconds|cm|lbs|k)\\b)(?:\\b|\\s*(?:yo|y/o|years? old)\\b)|\\b(?:i'?m|i am|im)\\s+(?:only\\s+|just\\s+)?a\\s+1[3-7]\\s*-?\\s*(?:yo|y/o|years?[- ]old)\\b|\\b1[3-7]\\s*-?\\s*(?:yo|y/o|years?[- ]old)(?:\\s+(?:girl|guy|boy|kid))?\\s+here\\b|\\b(?:i'?m|i am|im) (?:still )?(?:in|at) (?:high school|middle school|hs)\\b|\\bmy (?:mom|dad|parents) (?:won'?t|wont|don'?t|dont) let me\\b|\\bnot 18 (?:yet|until)\\b|\\b(?:i'?m|i am|im) (?:under ?18|underage|a minor)\\b|\\bhomeroom\\b");

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
  const vs = textVariants(text.replace(/[’‘`´]/g, "'"));
  const codes = new Set<string>();
  for (const { code, re } of RELAY_RULES) if (!codes.has(code) && vs.some(v => re.test(v))) codes.add(code);
  if (spelledPhone(text)) codes.add("contact:spelled_phone");
  return { codes: [...codes], minorSignal: vs.some(v => MINOR_SIGNAL.test(v)) };
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
  if (item.kind === "photo" && mine.filter(h => h.kind === "photo" && h.decision === "pass" && item.at - h.at < 86_400_000).length >= L.photosDaily) reasons.add("rate:photos");
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
export interface RelayClassifierOutput { flags: string[]; block?: string[]; source?: "llm" | "clef"; scores?: Record<string, number>; unavailable?: true }
export type RelayClassifierHook = (input: RelayClassifierInput) => Promise<RelayClassifierOutput>;
export const simulatedRelayClassifier: RelayClassifierHook = async () => ({ flags: [], block: [] });

const flagCode = (f: string) => f.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 24) || "flag";
const CLASSIFIER_MINOR_FLAG = "minor_signal";
const CLASSIFIER_UNAVAILABLE = "classifier:unavailable";

interface ClassifierAnswer { flags: string[]; block: string[]; source: "llm" | "clef" }
function classifierAnswer(x: unknown): ClassifierAnswer | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) && v.every(s => typeof s === "string") ? (v as string[]) : undefined);
  const flags = strings(o.flags), block = o.block === undefined ? [] : strings(o.block);
  if (o.unavailable !== undefined || !flags || !block) return undefined;
  return { flags, block, source: o.source === "clef" ? "clef" : "llm" };
}

export async function relayItemAsync(item: RelayItem, ctx: RelayContext, o: { hook?: RelayClassifierHook } = {}): Promise<RelayResult> {
  const first = relayItem(item, ctx);
  const text = (item.text ?? "").trim();
  const teenPair = ctx.teenFriendPair === true;
  const read = !!o.hook && relayClassifierReads(!!text, first.reasons.some(r => FINAL_FAMILIES.has(familyOf(r))), first.reasons.length > 0, teenPair);
  let extra: string[] = [];
  let classifierAgeSignal = false;
  if (read) {
    let raw: unknown;
    try {
      raw = await o.hook!({ text, kind: item.kind, context: [...(ctx.thread ?? [])], met: !teenPair && ctx.opportunity.metAt !== undefined && ctx.opportunity.metAt <= ctx.now });
    } catch { raw = undefined; }
    const answer = classifierAnswer(raw);
    const flags = (answer?.flags ?? []).map(flagCode), block = (answer?.block ?? []).map(flagCode);
    const reading = relayClassifierReading(answer !== undefined, flags.length + block.length > 0);
    if (reading === "ReadingUnavailable") extra = [CLASSIFIER_UNAVAILABLE];
    else if (reading === "ReadingFlagged") {
      const src = answer!.source;
      classifierAgeSignal = [...flags, ...block].includes(CLASSIFIER_MINOR_FLAG);
      extra = [...new Set([...flags.map(f => `${src}:${f}`), ...block.map(f => `${src}_severe:${f}`)])];
    }
  }
  const cleanPass = read && first.reasons.length === 0 && extra.length === 0;
  const unclean = teenRelayHeld(teenPair, cleanPass) && first.reasons.length === 0 && extra.length === 0 ? ["teen:unclassified"] : [];
  if (!extra.length && !unclean.length) return first;
  return finish(item, ctx, [...new Set([...first.reasons, ...extra, ...unclean])].sort(), { contactValue: null, photos: [], text, ageSignal: first.record.ageSignal || classifierAgeSignal });
}

type RelayRequest = { kind: "contact_share" } | { kind: "photo" } | { kind: "text"; body: string } | { kind: "none" };

const NEG = /\b(?:don'?t|dont|do not|never|not yet|no need to|stop|shouldn'?t|won'?t|wont|rather not|hold off|wait (?:to|before)|not until)\b/;
const SHARE_NEG = /\b(?:not going to|not gonna|can'?t(?! wait)|cant(?! wait)|cannot(?! wait)|can not|couldn'?t|wouldn'?t|wasn'?t|didn'?t|not ready to|no way|refuse to)\b/;
const HEDGE = /^\s*(?:should i|do you think|is it ok(?:ay)? (?:to|if)|would it be|what if|maybe|if)\b|\b(?:later|after the date|after we meet|eventually|at some point|one day|tomorrow)\b|\b(?:should i|or not)\b/;
const OTHER = "(?:them|him|her|my (?:match|date)|(?!(?:me|us|it|everyone|everybody|nobody|anyone|this|that)\\b)\\p{L}[\\p{L}'-]{1,30})";
const CONTACT_REQ = new RegExp(`\\b(?:send|give|share|pass|forward|text)\\s+${OTHER}\\s+my\\s+(?:phone number|number|phone|digits|cell|contact(?: info)?|email)\\b|\\b(?:share|send|give|pass)\\s+my\\s+(?:phone number|number|phone|digits|cell|contact(?: info)?|email)\\s+(?:with|to)\\s+${OTHER}|^\\s*(?:yes|yeah|yep|ok|okay|sure)[,!.]?\\s+(?:send|share|give)\\s+(?:it|my number|them my number)\\b|\\b(?:they|she|he) can have my (?:number|digits|phone number)\\b`, "iu");
const PHOTO_REQ = new RegExp(`\\b(?:send|share|forward|pass|show)\\s+${OTHER}\\s+(?:this|that|the|my|these)\\s+(?:photos?|pics?|pictures?|selfies?|images?)\\b|\\b(?:send|share|forward)\\s+(?:this|that|these|my)\\s+(?:photos?|pics?|pictures?|selfies?)\\s+(?:to|with)\\s+${OTHER}`, "iu");
const TEXT_REQ = new RegExp(`^\\s*(?:please\\s+)?(?:tell|let|ask)\\s+${OTHER}\\s+(?:know\\s+)?(?:that\\s+)?(.{2,})$`, "isu");

export function parseRelayRequest(text: string): RelayRequest {
  const t = text.replace(/[’‘`´]/g, "'").trim();
  const low = t.toLowerCase();
  const negated = NEG.test(low), hedged = HEDGE.test(low) || (/\?\s*$/.test(t) && /^\s*(?:should|would|could i|is it|do you|can i)\b/i.test(t));
  const refused = negated || SHARE_NEG.test(low);
  if (CONTACT_REQ.test(t)) return refused || hedged ? { kind: "none" } : { kind: "contact_share" };
  if (PHOTO_REQ.test(t)) return refused || hedged ? { kind: "none" } : { kind: "photo" };
  const m = TEXT_REQ.exec(t);
  if (m && !negated) return { kind: "text", body: m[1]!.trim() };
  return { kind: "none" };
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
