// Relay between matched members (PRD 32.11, 32.12, F16-F18, 40.5; docs/mvp-gaps.md). After a mutual
// yes the two adults talk through the agent, never directly:
//  - Threads open at the reveal (the booked plan), for adults only, and close 7 days after the
//    meeting, or on STOP, leave, delete, block, ban or a cancelled plan.
//  - A member's text goes to the others with their first name in front ("Sam: running 10 late"),
//    through the Network's own send path: send-time checks, quiet hours (a relay is logistics, not an
//    interruption) and the leak guard all apply.
//  - Every relayed text is checked first: the core leak guard (other members' private facts, contact
//    details, canaries), the appearance-leak check for apps that rate photos, and a scam and
//    off-platform check (money, gift cards, crypto, other apps, links, numbers, handles). A hit holds
//    the text for staff (a safety case event); nothing goes out until staff release it.
//  - Contact swap: a request for the other's number (or "send them my number") asks the other side;
//    only an explicit yes from both sends each the other's number, once. A no or 72 hours of silence
//    gets the same gentle answer, so nobody learns which it was.
//  - Running late (inside 6 hours of the meeting) is relayed. A reschedule offers new times to the
//    others and needs their yes; one per plan, and a second ask calls the plan off with a rain check.
//  - A ban tells everyone who had a thread with the banned member one neutral safety notice.
//  - The relay log keeps ids, statuses and a hash of every text; the text itself only while held.
// The ConsentNetwork owns the members, the opportunities and the send path; it lends them through
// RelayHost. Everything kept here is plain JSON (exportState).
import { createHash } from "node:crypto";
import { findLeaks, HOUR, type MemberId, type TimeOption } from "@thenetwork/core";
import { normText, parseProbeReply, type Classified } from "./classify.ts";
import { whenPhrase, type Copy } from "./copy.ts";

/** A thread closes this long after the meeting. */
export const RELAY_THREAD_DAYS = 7;
/** A contact-swap ask with no answer expires after this long. */
export const CONTACT_TTL = 72 * HOUR;
/** "Running late" is relayed from this long before the meeting until an hour after it. */
export const LATE_WINDOW = 6 * HOUR;
/** A reschedule ask with no answer keeps the original plan after this long. */
export const RESCHEDULE_TTL = 24 * HOUR;

export type RelayStatus = "sent" | "held" | "blocked";
export interface RelayThread {
  id: string; oppId: string; members: MemberId[]; openedAt: number; closesAt: number;
  closedAt?: number; closedReason?: string;
  /** Members who were told once that their texts now go to the others. */
  told: MemberId[];
}
/** One relayed text. `body` only while it is held for staff; `fromName` is the prefix the recipient saw (or would see). */
export interface RelayEntry {
  id: string; threadId: string; from: MemberId; to: MemberId; at: number; status: RelayStatus;
  reason?: string; bodyHash: string; body?: string; fromName?: string;
  decidedBy?: string; decidedAt?: number;
}
export type ContactStatus = "asked" | "accepted" | "declined" | "sent" | "expired";
export interface ContactShare { id: string; oppId: string; requester: MemberId; target: MemberId; status: ContactStatus; at: number; askedAt: number }
/** A reschedule ask waiting for the others' answer. */
export interface Reschedule { by: MemberId; at: number; options: TimeOption[]; to: MemberId[] }
export interface RelayState {
  threads: RelayThread[]; log: RelayEntry[]; shares: ContactShare[];
  resched: Record<string, Reschedule>;
  /** Reschedule asks per opportunity (one is allowed). */
  moves: Record<string, number>;
  /** "<banned>|<member>": the ban notice already went to that member. */
  banNoticed: string[];
  seq: number;
}
export const emptyRelay = (): RelayState => ({ threads: [], log: [], shares: [], resched: {}, moves: {}, banNoticed: [], seq: 0 });

/** What the desk sees of a member. */
export interface RelayPerson { id: MemberId; first: string; adult: boolean; optedOut: boolean }
/** What the desk sees of a booked opportunity. `going`: participants still in. */
export interface RelayBooking { id: string; stage: string; going: MemberId[]; meetingAt?: number; venue?: string }
export interface RelaySend {
  kind: "relay" | "scheduling" | "reply" | "safety" | "info";
  oppId?: string; from?: MemberId; about?: MemberId[];
  /** A number both members agreed to swap: the only contact detail the leak guard lets through. */
  contact?: string;
  timeOptions?: TimeOption[];
  /** The plan's new time: the text is the booked plan again (a moved date). */
  booked?: number;
}
/** What the ConsentNetwork lends the desk. */
export interface RelayHost {
  now(): number;
  log(type: string, detail: Record<string, unknown>): void;
  copy: Copy;
  person(id: MemberId): RelayPerson | undefined;
  booking(oppId: string): RelayBooking | undefined;
  send(to: MemberId, body: string, o: RelaySend): "sent" | "deferred" | "refused";
  /** The core leak guard on a relayed text: facts of anyone but the sender and the recipient, contact details, canaries. */
  leaks(text: string, from: MemberId, to: MemberId): string[];
  /** The appearance-leak check (apps whose pack rates photos), or null. */
  appearance(text: string): string | null;
  caseEvent(id: MemberId, kind: string): void;
  /** Trust points for abuse the classifier read in a relayed text (the text is held either way). */
  abuse(id: MemberId, c: Pick<Classified, "abuse" | "risk">, body: string): void;
  /** The member's own number, for a consented swap. */
  contactOf(id: MemberId): string | undefined;
  yesNo(body: string): "yes" | "no" | "counter" | "unclear";
  /** New time options for a booked opportunity (never its current time). */
  timeOptions(oppId: string, hint: DayHint): TimeOption[];
  /** Move the booked meeting to a new time (the venue may change with it). */
  move(oppId: string, at: number): void;
  /** Call the plan off for `by`, who hears `reply`; the others hear it is off, never why. */
  callOff(oppId: string, by: MemberId, reply: string): void;
}

// ------------------------------------------------------------------------------ reading texts
/** "me: what time was it again?": a text for the agent, never relayed. */
const FOR_AGENT = /^\s*(?:me|agent)\s*:/i;
/** Short acknowledgements are never relayed on their own. */
/** The one-time offers in the booked plan (CALENDAR, WEEKLY, "... OFF"): answers to the agent. */
const OPT_IN = /^\W*(?:yes,?\s+)?(?:calendar|weekly)(?:\s+(?:check-?in\s+)?off)?\W*$/i;
const ACK = /^\W*(?:ok(?:ay)?|k+|thx|thanks?(?: you)?|ty|cool|great|nice|perfect|got it|sounds good|yes|yeah|yep|yup|sure|no|nope|nah|lol|haha)\W*$/i;

const WHOSE = String.raw`(?:his|her|their|them|[a-z][a-z'’-]*'s)`;
const NUMBER = String.raw`(?:numbers?|digits|phone(?: numbers?)?|cell(?: number)?|contact(?: info| details)?)`;
const CONTACT_ASK: RegExp[] = [
  new RegExp(String.raw`\b(?:can|could|may)\s+(?:i|we)\s+(?:get|have|grab)\s+${WHOSE}\s+${NUMBER}\b`, "i"),
  new RegExp(String.raw`\b(?:what'?s|whats|what is)\s+${WHOSE}\s+${NUMBER}\b`, "i"),
  new RegExp(String.raw`\b(?:give|send|pass|share)\s+(?:me\s+)?${WHOSE}\s+${NUMBER}\b`, "i"),
  /\b(?:swap|exchange|trade|share)\s+(?:phone\s+)?numbers\b/i,
];
const CONTACT_GIVE: RegExp[] = [
  new RegExp(String.raw`\b(?:send|give|pass|text)\s+(?:him|her|them|[a-z]+)\s+my\s+${NUMBER}\b`, "i"),
  new RegExp(String.raw`\b(?:share|send|give|pass)\s+my\s+${NUMBER}\s+(?:to|with)\b`, "i"),
  new RegExp(String.raw`\b(?:he|she|they|[a-z]+)\s+can\s+have\s+my\s+${NUMBER}\b`, "i"),
];
/**
 * The person a swap request names ("Sam's number", "send Sam my number"), or undefined for a pronoun
 * ("her number", "send them my number").
 */
export function contactNameOf(body: string): string | undefined {
  const t = normText(body);
  const m = new RegExp(String.raw`\b([a-z][a-z-]*)'s\s+${NUMBER}\b`).exec(t) ?? new RegExp(String.raw`\b(?:send|give|pass|text)\s+([a-z]+)\s+my\s+${NUMBER}\b`).exec(t)
    ?? new RegExp(String.raw`\bmy\s+${NUMBER}\s+(?:to|with)\s+([a-z]+)\b`).exec(t);
  const name = m?.[1];
  return name && !/^(?:him|her|them|his|their|he|she|they|it|me|you|my|your|the|a|that|this)$/.test(name) ? name : undefined;
}
/** A request to swap numbers with the person they matched with ("can I get her number?", "send them my number"). */
export function contactIntentOf(body: string): "ask" | "give" | undefined {
  const t = normText(body);
  if (CONTACT_GIVE.some(rx => rx.test(t))) return "give";
  if (CONTACT_ASK.some(rx => rx.test(t))) return "ask";
  return undefined;
}

const RUNNING_LATE = /\b(?:running|be|a bit|a little|bit|little|few min(?:ute)?s?|\d+\s*min(?:ute)?s?|ten min(?:ute)?s?)\s+late\b|\b(?:i'?m|im|i am)\s+late\b(?!\s+(?:to|for)\b)|\brunning (?:a bit |a little )?behind\b|\b(?:be|i'?ll be|will be|gonna be|getting) there in (?:\d+|a few|five|ten|fifteen|twenty|a sec)\b|\b(?:on my way|omw)\b|\bstuck (?:on|in) (?:the )?(?:train|subway|traffic)\b|\b(?:train|subway) is (?:delayed|stuck|slow)\b/i;
/** "running 10 late", "be there in 10", "omw", "stuck on the train". */
export const isRunningLate = (body: string) => RUNNING_LATE.test(normText(body));

const DAY_NAME = String.raw`(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?`;
/** A new time asked for in so many words: a day, "next week", "instead", "move it", "reschedule". */
const RESCHEDULE = new RegExp(String.raw`\b(?:reschedule|move (?:it|our date|the date|this|things|our plan|the plan)|push (?:it|our date|the date|this|the plan)(?: back)?|change (?:the )?(?:day|time)|(?:next week|tomorrow|tonight|later|${DAY_NAME}|(?:the )?weekend|morning|afternoon|evening|lunch|brunch)\s+instead\b|(?:can|could) we (?:do|try|find|pick) (?:a different|another) (?:day|time|night)|can we do ${DAY_NAME}|how about ${DAY_NAME}|could we do ${DAY_NAME})`, "i");
/** Only a vague "another time" or "rain check": a new time when asked for, a no when said with a can't. */
const LATER_VAGUE = /\b(?:another (?:day|time|night)|(?:a )?different (?:day|time|night)|rain ?check)\b/i;
const DECLINE_CUE = /\b(?:can'?t|cannot|won'?t|not|unable|maybe)\b/i;
/**
 * "can we move it to friday?", "can't make it tonight, next week instead?", "rain check?". "Can't
 * this week, maybe another time" is a no, not a new time (the plan is called off as usual).
 */
export const isReschedule = (body: string) => {
  const t = normText(body);
  return RESCHEDULE.test(t) || (LATER_VAGUE.test(t) && !DECLINE_CUE.test(t));
};

/** A day the member named for the new time. */
export type DayHint = { weekday?: number; nextWeek?: boolean; tomorrow?: boolean };
const WEEKDAYS: [RegExp, number][] = [[/\bsun(?:day)?s?\b/, 0], [/\bmon(?:day)?s?\b/, 1], [/\btues?(?:day)?s?\b/, 2], [/\bwed(?:nes)?(?:day)?s?\b/, 3], [/\bthu(?:rs?)?(?:day)?s?\b/, 4], [/\bfri(?:day)?s?\b/, 5], [/\bsat(?:ur)?(?:day)?s?\b/, 6]];
export function dayHintOf(body: string): DayHint {
  const t = normText(body);
  const d = WEEKDAYS.find(([rx]) => rx.test(t));
  return { ...(d ? { weekday: d[1] } : {}), ...(/\bnext week\b/.test(t) ? { nextWeek: true } : {}), ...(/\btomorrow\b/.test(t) ? { tomorrow: true } : {}) };
}

/**
 * "tell Sam I'm running late", "let Sam know I'm here", "Sam: see you soon", "for Sam: ...". The
 * name must be one of the others in the thread. Returns who it is for and the text to pass on.
 */
export function explicitRelayOf(body: string, others: { id: MemberId; first: string }[]): { to: MemberId; text: string } | undefined {
  for (const o of others) {
    const n = o.first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`^\\s*(?:please\\s+)?(?:tell|text|message)\\s+${n}\\b[,:]?\\s*(?:that\\s+)?(.+)$`, "is").exec(body)
      ?? new RegExp(`^\\s*(?:please\\s+)?let\\s+${n}\\s+know\\s+(?:that\\s+)?(.+)$`, "is").exec(body)
      ?? new RegExp(`^\\s*(?:to|for)?\\s*${n}\\s*:\\s*(.+)$`, "is").exec(body);
    if (m?.[1]?.trim()) return { to: o.id, text: m[1].trim() };
    if (new RegExp(`^\\s*(?:please\\s+)?ask\\s+${n}\\b`, "i").test(body)) return { to: o.id, text: body.trim() };
  }
  return undefined;
}

/**
 * The answer to "would you see them again?" (the slop check-in): an explicit yes or an "again"
 * phrase; any negation of it is a no.
 */
export function againOf(body: string): boolean {
  const t = normText(body);
  if (/\b(?:wouldn'?t|won'?t|not|never|no|nope|nah|don'?t think)\b[^.!?]*\b(?:again|second|another)\b/.test(t)) return false;
  if (/\b(?:see (?:him|her|them) again|meet (?:him|her|them|up)? ?again|second date|another date|go out again)\b/.test(t)) return true;
  return /^\W*(?:yes|yeah|yep|yup|definitely|absolutely|for sure|totally|100%|would love to|i would|i'?d love to)\b/.test(t) && !/\b(?:but no|not again)\b/.test(t);
}

// ------------------------------------------------------------------------------ scam and off-platform
const PLATFORM = String.raw`(?:whats ?app|telegram|signal|kik|wechat|viber|snap(?:chat)?|insta(?:gram)?|ig|tiktok|facebook|fb|messenger|hinge|tinder|bumble|discord|skype|google voice|line app)`;
const SCAM_RULES: [string, RegExp][] = [
  ["money", /\b(?:venmo|zelle|cash ?app|cashapp|paypal|western union|moneygram|wire (?:me|the money|it|transfer)|bank (?:transfer|details)|routing number)\b/i],
  ["money", /\b(?:send|lend|loan|give|spot|front|transfer|wire)\s+(?:me|us)\b[^.?!]{0,40}(?:\$|\bmoney\b|\bcash\b|\bbucks\b|\bdollars?\b|\bfunds?\b|\b\d+\s*(?:k|usd)\b)/i],
  ["money", /\b(?:need|borrow|owe)\b[^.?!]{0,30}(?:\bmoney\b|\bcash\b|\$\s?\d+|\b\d+\s*(?:bucks|dollars))/i],
  ["money", /\b(?:help me (?:out )?(?:with|pay)|cover|pay for|pay)\s+(?:my|me)\b[^.?!]{0,30}\b(?:uber|lyft|cab|taxi|ticket|rent|bill|fare|flight|deposit)\b/i],
  ["money", /\b(?:my )?(?:card|account|wallet|bank(?: account)?)\s+(?:got |was |is )?(?:declined|frozen|locked|blocked|hacked)\b/i],
  ["gift_card", /\b(?:gift ?cards?|itunes cards?|apple cards?|google play cards?|steam cards?|amazon cards?|visa gift)\b/i],
  ["crypto", /\b(?:bitcoin|btc|ethereum|eth|usdt|tether|crypto\w*|binance|coinbase|forex|nft)\b(?=[^.!]*\b(?:invest\w*|trad(?:e|es|ing|er)|profit\w*|returns?|earn\w*|made|make|send|wallet|platform|app|teach|show you|opportunit\w*))|\b(?:invest\w*|trad(?:e|es|ing|er)|profit\w*|earn\w*|made|make|send|wallet|platform|teach|show you)\b[^.!]*\b(?:bitcoin|btc|ethereum|usdt|tether|crypto\w*|forex)\b/i],
  ["investment", /\b(?:investment opportunity|guaranteed (?:returns?|profits?)|\d+% (?:returns?|profit|a (?:day|week|month))|double your (?:money|investment)|financial freedom|passive income|trading (?:app|platform|account)|wallet address)\b/i],
  ["account_code", /\b(?:send|give|text|tell|forward|read)\s+(?:me\s+)?(?:the|that|your)\s+(?:\d[- ]?digit\s+)?(?:code|verification code|pin)\b|\bverify (?:you'?re|you are|yourself)\b[^.?!]{0,40}\b(?:link|site|app|code)\b/i],
  ["off_platform", new RegExp(String.raw`\b(?:add|follow|find|message|msg|text|dm|hit|reach|talk|chat|move|switch|continue|contact|call|ping|write)\b[^.?!]{0,25}\b(?:on|via|over|through|to)\s+${PLATFORM}\b`, "i")],
  ["off_platform", new RegExp(String.raw`\b(?:my|your|ur)\s+${PLATFORM}\s*(?:is|:|handle|username|name|id|\?)`, "i")],
  ["off_platform", new RegExp(String.raw`\b${PLATFORM}\s+(?:me|handle|username)\b|\b(?:download|get)\s+${PLATFORM}\b`, "i")],
  ["off_platform", new RegExp(String.raw`\b(?:what'?s|whats|what is|drop|send|give me)\s+(?:me\s+)?(?:your|ur)\s+(?:${PLATFORM}|number|digits|cell|handle|email|socials?)\b`, "i")],
  ["off_platform", /\b(?:can|could|may) i (?:get|have) (?:your|ur) (?:number|digits|cell|phone|email|socials?|handle)\b|\b(?:text|call|reach|contact|email|hit) me (?:at|on|directly|instead|outside)\b|\boff (?:this|the) (?:app|platform|line|chat)\b|\bmy (?:real|personal|cell|private|other) (?:number|phone|line|email)\b|\bmy (?:number|cell|digits) is\b(?! in the app)|\btext (?:me )?directly\b/i],
  ["link", /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|link|app|xyz|site|online|info|biz|us|gg|to|ee|page|bio)\b)/i],
  ["handle", /(?:^|[\s(])@[a-z0-9_.]{3,}/i],
];
/** The scam and off-platform kinds a relayed text reads as (none for a clean text). */
export function scamCheck(text: string): string[] {
  const t = normText(text);
  return [...new Set(SCAM_RULES.filter(([, rx]) => rx.test(t)).map(([k]) => k))];
}
/** The relay's own check, without other members' facts: scam and off-platform kinds plus the core guard's contact details. */
export function relayCheck(text: string): string[] {
  return [...scamCheck(text).map(k => `scam:${k}`), ...findLeaks(text).filter(r => r.startsWith("contact:"))];
}

/**
 * A member's text as the appearance check reads it: "pretty" as an adverb ("pretty excited", "pretty
 * sure") is not about looks. The check itself (appearance.ts) was written for the agent's own text.
 */
export const forAppearanceCheck = (text: string) =>
  text.replace(/\bpretty(?=\s+(?:much|sure|good|great|bad|excited|nervous|busy|close|late|early|far|soon|well|tired|hungry|cold|fun|chill|easy|quick|happy|new|cool|funny|random|wild|long|big|small|loud|quiet|packed|full|empty)\b)/gi, "quite");

/** A hash of a relayed text: the log keeps it for safety, never the text once it went out. */
export const bodyHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

/** Opportunity kinds of an inbound message that the Network itself answers: never relayed implicitly. */
const NETWORK_KINDS = new Set(["people_request", "plans_request", "invite_friend", "cancel", "block", "report", "feedback_like"]);

// ------------------------------------------------------------------------------ the desk
export class RelayDesk {
  private s: RelayState = emptyRelay();
  constructor(private readonly h: RelayHost) {}

  exportState(): RelayState { return JSON.parse(JSON.stringify(this.s)) as RelayState; }
  importState(s: RelayState | undefined) { this.s = s ? { ...emptyRelay(), ...JSON.parse(JSON.stringify(s)) } : emptyRelay(); }
  threads(): RelayThread[] { return this.s.threads.map(t => ({ ...t, members: [...t.members], told: [...t.told] })); }
  entries(): RelayEntry[] { return this.s.log.map(e => ({ ...e })); }
  shares(): ContactShare[] { return this.s.shares.map(x => ({ ...x })); }
  /** Texts held for staff, oldest first. */
  held(): RelayEntry[] { return this.s.log.filter(e => e.status === "held").map(e => ({ ...e })); }

  private id(p: string) { return `${p}${++this.s.seq}`; }

  /** A booked plan between adults: one thread for everyone in it (none when anyone is not a known adult). */
  open(oppId: string, members: readonly MemberId[], meetingAt: number) {
    if (members.length < 2 || this.s.threads.some(t => t.oppId === oppId && !t.closedAt)) return;
    if (!members.every(id => this.h.person(id)?.adult)) { this.h.log("relay_not_opened", { oppId, reason: "minors policy" }); return; }
    const now = this.h.now();
    const t: RelayThread = { id: this.id("rt"), oppId, members: [...members], openedAt: now, closesAt: meetingAt + RELAY_THREAD_DAYS * 24 * HOUR, told: [] };
    this.s.threads.push(t);
    this.h.log("relay_opened", { threadId: t.id, oppId, members: t.members });
  }

  private close(t: RelayThread, reason: string) {
    if (t.closedAt !== undefined) return;
    t.closedAt = this.h.now(); t.closedReason = reason;
    this.h.log("relay_closed", { threadId: t.id, oppId: t.oppId, reason });
  }
  /** Close every open thread of a member (STOP, leave, delete, ban). */
  closeFor(id: MemberId, reason: string) { for (const t of this.s.threads) if (t.members.includes(id)) this.close(t, reason); }
  /** Close every thread both are in (a block between them). */
  closePair(a: MemberId, b: MemberId, reason: string) { for (const t of this.s.threads) if (t.members.includes(a) && t.members.includes(b)) this.close(t, reason); }

  /** A member's open threads, after closing the ones whose time, plan or people are gone. */
  private openThreads(id: MemberId): RelayThread[] {
    const now = this.h.now();
    const out: RelayThread[] = [];
    for (const t of this.s.threads) {
      if (t.closedAt !== undefined || !t.members.includes(id)) continue;
      const why = this.closeReason(t, now);
      if (why) { this.close(t, why); continue; }
      out.push(t);
    }
    return out;
  }
  private closeReason(t: RelayThread, now: number): string | undefined {
    if (now >= t.closesAt) return "expired";
    const b = this.h.booking(t.oppId);
    if (!b || (b.stage !== "scheduled" && b.stage !== "done")) return "cancelled";
    for (const x of t.members) {
      const p = this.h.person(x);
      if (!p) return "left";
      if (!p.adult) return "minors policy";
      if (p.optedOut) return "stop";
      if (!b.going.includes(x)) return "cancelled";
    }
    return undefined;
  }

  /**
   * A member's message. True when the relay handled it: an answer to a swap or reschedule ask, a swap
   * or reschedule request, or a text for the others. `awaiting`: what the Network's last question
   * to this member was (an open question other than the booked plan keeps texts with the Network).
   */
  inbound(id: MemberId, c: Pick<Classified, "kind" | "abuse" | "risk">, body: string, o: { awaiting?: string } = {}): boolean {
    if (FOR_AGENT.test(body) || OPT_IN.test(body)) return false;
    const mine = this.openThreads(id);
    if (!mine.length) return false;
    const now = this.h.now();
    // Answers first: a swap ask, then a reschedule ask, sent to this member.
    const ask = this.s.shares.find(x => x.target === id && x.status === "asked" && mine.some(t => t.oppId === x.oppId));
    if (ask) {
      const yn = this.h.yesNo(body);
      if (yn === "yes" || yn === "no") { this.answerShare(ask, yn === "yes"); return true; }
    }
    for (const [oppId, r] of Object.entries(this.s.resched)) if (r.to.includes(id) && this.answerReschedule(id, oppId, r, body)) return true;
    // Contact swap inside a mutual opportunity: never abuse. A request that names someone outside
    // the member's threads is not a swap with their match: it stays on the abuse path.
    const abuse = c.abuse.filter(a => a !== "contact_extraction");
    if (!abuse.length && (contactIntentOf(body) || c.abuse.includes("contact_extraction"))) {
      const named = contactNameOf(body);
      const t = named ? mine.find(x => x.members.some(m => m !== id && this.h.person(m)?.first.toLowerCase() === named)) : this.pick(mine, id, body);
      if (!t) return false;
      this.askShare(id, t, body);
      return true;
    }
    if (isReschedule(body)) {
      const b = mine.map(t => this.h.booking(t.oppId)).find(x => x?.stage === "scheduled" && x.meetingAt !== undefined && x.meetingAt > now);
      if (b) { this.reschedule(id, b, body); return true; }
    }
    if (c.kind === "cancel") return false;
    const t = this.pick(mine, id, body);
    const others = t.members.filter(x => x !== id);
    const names = others.map(x => ({ id: x, first: this.h.person(x)?.first ?? "" })).filter(x => x.first);
    const ex = explicitRelayOf(body, names);
    if (ex) { this.relay(id, t, [ex.to], ex.text, c); return true; }
    const b = this.h.booking(t.oppId);
    const late = b?.meetingAt !== undefined && now >= b.meetingAt - LATE_WINDOW && now <= b.meetingAt + HOUR && isRunningLate(body);
    if (late) { this.relay(id, t, others, body.trim(), c); return true; }
    // Anything else is relayed only when it is plainly a message for the others: one open thread,
    // no other question of ours waiting, not a request or an answer the Network handles itself.
    if (mine.length !== 1 || NETWORK_KINDS.has(c.kind) || ACK.test(body)) return false;
    if (o.awaiting && o.awaiting !== "booked") return false;
    // While the booked plan is unanswered, a no answers it ("No thanks, not right now" calls it off;
    // relaying it would tell the other who said no), and so does a short yes; longer text is for the others.
    if (o.awaiting === "booked") {
      const yn = this.h.yesNo(body);
      if (yn === "no" || yn === "counter" || ((yn === "yes" || c.kind === "ack") && body.trim().split(/\s+/).length <= 4)) return false;
    }
    this.relay(id, t, others, body.trim(), c);
    return true;
  }

  /** The thread a message is about: the one whose other member it names, else the newest. */
  private pick(mine: RelayThread[], id: MemberId, body: string): RelayThread {
    const t = normText(body);
    return mine.find(x => x.members.some(m => m !== id && new RegExp(`\\b${(this.h.person(m)?.first ?? "\u0000").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)))
      ?? mine[mine.length - 1]!;
  }

  /** Check a text and pass it on, or hold it for staff. */
  private relay(from: MemberId, t: RelayThread, to: MemberId[], text: string, c: Pick<Classified, "abuse" | "risk">) {
    const now = this.h.now();
    const abuse = c.abuse;
    const name = this.h.person(from)?.first ?? "";
    let held = false, blocked = false;
    for (const r of to) {
      const appearance = this.h.appearance(forAppearanceCheck(text));
      const reasons = [...new Set([
        ...this.h.leaks(text, from, r), ...(appearance ? ["appearance"] : []), ...scamCheck(text).map(k => `scam:${k}`), ...abuse.map(a => `abuse:${a}`),
      ])];
      const e: RelayEntry = { id: this.id("rl"), threadId: t.id, from, to: r, at: now, status: "sent", bodyHash: bodyHash(text), fromName: name };
      this.s.log.push(e);
      if (reasons.length) {
        e.status = "held"; e.reason = reasons.join(","); e.body = text; held = true;
        this.h.caseEvent(from, "relay_held");
        this.h.log("relay_held", { entryId: e.id, threadId: t.id, memberId: from, to: r, reasons });
        continue;
      }
      const res = this.h.send(r, `${name}: ${text}`, { kind: "relay", oppId: t.oppId, from, about: [from, r] });
      if (res === "refused") { e.status = "blocked"; e.reason = "send_refused"; blocked = true; }
      this.h.log("relay_message", { entryId: e.id, threadId: t.id, memberId: from, to: r, status: e.status });
    }
    // Abuse the classifier read (a scam, harassment) still costs trust points, as anywhere else.
    if (abuse.length) this.h.abuse(from, c, text);
    const first = to.length === 1 ? this.h.person(to[0]!)?.first ?? "them" : "them";
    if (held) this.h.send(from, this.h.copy.relayHeld, { kind: "reply" });
    else if (blocked) this.h.send(from, this.h.copy.relayNotSent, { kind: "reply" });
    else if (!t.told.includes(from)) { t.told.push(from); this.h.send(from, this.h.copy.relayFirst(first), { kind: "reply" }); }
  }

  /** Staff release a held text: it goes out now (if the thread is still open), and its text is dropped. */
  release(entryId: string, actor: string, note?: string): { ok: true } | { ok: false; reason: string } {
    if (!actor.trim()) return { ok: false, reason: "actor_required" };
    const e = this.s.log.find(x => x.id === entryId);
    if (!e) return { ok: false, reason: "unknown_entry" };
    if (e.status !== "held" || e.body === undefined) return { ok: false, reason: `not_held` };
    const t = this.s.threads.find(x => x.id === e.threadId);
    const why = !t || t.closedAt !== undefined ? "thread_closed" : this.closeReason(t, this.h.now());
    if (why) { if (t && why !== "thread_closed") this.close(t, why); return { ok: false, reason: "thread_closed" }; }
    const res = this.h.send(e.to, `${e.fromName ?? ""}: ${e.body}`, { kind: "relay", oppId: t!.oppId, from: e.from, about: [e.from, e.to] });
    e.status = res === "refused" ? "blocked" : "sent"; e.reason = res === "refused" ? "released_refused" : "released";
    delete e.body; e.decidedBy = actor; e.decidedAt = this.h.now();
    this.h.log("relay_released", { entryId, actor, note: note ?? null, status: e.status });
    return { ok: true };
  }
  /** Staff keep a held text from going out; its text is dropped. */
  reject(entryId: string, actor: string, note?: string): { ok: true } | { ok: false; reason: string } {
    if (!actor.trim()) return { ok: false, reason: "actor_required" };
    const e = this.s.log.find(x => x.id === entryId);
    if (!e) return { ok: false, reason: "unknown_entry" };
    if (e.status !== "held") return { ok: false, reason: "not_held" };
    e.status = "blocked"; e.reason = `${e.reason ?? ""},rejected`.replace(/^,/, ""); delete e.body; e.decidedBy = actor; e.decidedAt = this.h.now();
    this.h.log("relay_rejected", { entryId, actor, note: note ?? null });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------- contact swap
  private askShare(from: MemberId, t: RelayThread, body: string) {
    const others = t.members.filter(x => x !== from);
    const target = others.find(x => normText(body).includes((this.h.person(x)?.first ?? "\u0000").toLowerCase())) ?? others[0]!;
    const name = this.h.person(target)?.first ?? "them";
    const pair = (x: ContactShare) => x.oppId === t.oppId && [x.requester, x.target].includes(from) && [x.requester, x.target].includes(target);
    const prior = [...this.s.shares].reverse().find(pair);
    if (prior) {
      if (prior.status === "asked" && prior.target === from) return this.answerShare(prior, true); // both asked: that is two yeses
      const text = prior.status === "asked" ? this.h.copy.contactPending(name) : prior.status === "sent" || prior.status === "accepted" ? this.h.copy.contactAlready(name) : this.h.copy.contactNotNow(name);
      this.h.send(from, text, { kind: "reply" });
      return;
    }
    if (!this.h.contactOf(from) || !this.h.contactOf(target)) { this.h.send(from, this.h.copy.contactUnavailable, { kind: "reply" }); this.h.log("contact_share_unavailable", { oppId: t.oppId, memberId: from }); return; }
    const now = this.h.now();
    const sh: ContactShare = { id: this.id("cs"), oppId: t.oppId, requester: from, target, status: "asked", at: now, askedAt: now };
    this.s.shares.push(sh);
    const res = this.h.send(target, this.h.copy.contactAsk(this.h.person(from)?.first ?? "They"), { kind: "scheduling", oppId: t.oppId, about: [from, target] });
    this.h.log("contact_share", { shareId: sh.id, oppId: t.oppId, requester: from, target, status: res === "refused" ? "expired" : "asked" });
    if (res === "refused") { sh.status = "expired"; sh.at = now; this.h.send(from, this.h.copy.contactNotNow(name), { kind: "reply" }); return; }
    this.h.send(from, this.h.copy.contactAsked(name), { kind: "reply" });
  }

  private answerShare(sh: ContactShare, yes: boolean) {
    const now = this.h.now();
    sh.at = now;
    const rName = this.h.person(sh.requester)?.first ?? "they", tName = this.h.person(sh.target)?.first ?? "they";
    if (!yes) {
      sh.status = "declined";
      this.h.log("contact_share", { shareId: sh.id, oppId: sh.oppId, status: "declined" });
      this.h.send(sh.target, this.h.copy.contactDeclinedAck, { kind: "reply" });
      this.h.send(sh.requester, this.h.copy.contactNotNow(tName), { kind: "info", oppId: sh.oppId, about: [sh.requester, sh.target] });
      return;
    }
    sh.status = "accepted";
    const rNum = this.h.contactOf(sh.requester), tNum = this.h.contactOf(sh.target);
    if (!rNum || !tNum) { sh.status = "expired"; this.h.send(sh.target, this.h.copy.contactUnavailable, { kind: "reply" }); return; }
    // Each side gets the other's number once; the status says it went.
    const a = this.h.send(sh.requester, this.h.copy.contactShared(tName, tNum), { kind: "info", oppId: sh.oppId, about: [sh.requester, sh.target], contact: tNum });
    const b = this.h.send(sh.target, this.h.copy.contactShared(rName, rNum), { kind: "reply", oppId: sh.oppId, about: [sh.requester, sh.target], contact: rNum });
    sh.status = "sent";
    this.h.log("contact_share", { shareId: sh.id, oppId: sh.oppId, status: "sent", delivered: [a !== "refused", b !== "refused"] });
  }

  // ---------------------------------------------------------------------------- reschedule
  private reschedule(by: MemberId, b: RelayBooking, body: string) {
    if (this.s.resched[b.id]) { this.h.send(by, this.h.copy.rescheduleWaiting, { kind: "reply" }); return; }
    if ((this.s.moves[b.id] ?? 0) >= 1) {
      // One move per plan: a second ask calls it off, with a rain check and no blame.
      this.h.log("reschedule", { oppId: b.id, memberId: by, result: "called_off" });
      this.h.callOff(b.id, by, this.h.copy.rescheduleRainCheck);
      return;
    }
    const options = this.h.timeOptions(b.id, dayHintOf(body));
    if (!options.length) { this.h.send(by, this.h.copy.rescheduleNone, { kind: "reply" }); this.h.log("reschedule", { oppId: b.id, memberId: by, result: "no_times" }); return; }
    this.s.moves[b.id] = (this.s.moves[b.id] ?? 0) + 1;
    const to = b.going.filter(x => x !== by);
    this.s.resched[b.id] = { by, at: this.h.now(), options, to };
    const times = options.map(o => o.label).join(" or ");
    const name = this.h.person(by)?.first ?? "They";
    for (const x of to) this.h.send(x, this.h.copy.rescheduleAsk(name, whenPhrase(b.meetingAt!), times), { kind: "scheduling", oppId: b.id, about: b.going, timeOptions: options });
    this.h.send(by, this.h.copy.rescheduleAsked(times), { kind: "reply" });
    this.h.log("reschedule", { oppId: b.id, memberId: by, result: "asked", options: options.length });
  }

  /** The others' answer to a reschedule ask. False when the message is not an answer. */
  private answerReschedule(id: MemberId, oppId: string, r: Reschedule, body: string): boolean {
    const b = this.h.booking(oppId);
    if (!b || b.stage !== "scheduled") { delete this.s.resched[oppId]; return false; }
    const p = parseProbeReply(body, r.options);
    if (p.answer === "unclear") return false;
    delete this.s.resched[oppId];
    if (p.answer === "no") {
      this.h.log("reschedule", { oppId, memberId: id, result: "declined" });
      this.h.send(id, this.h.copy.rescheduleKeptAck, { kind: "reply" });
      this.h.send(r.by, this.h.copy.rescheduleKept(whenPhrase(b.meetingAt!)), { kind: "scheduling", oppId, about: b.going });
      return true;
    }
    const pick = r.options.find(o => p.keys.includes(o.key)) ?? r.options[0]!;
    this.h.move(oppId, pick.start);
    for (const t of this.s.threads) if (t.oppId === oppId && t.closedAt === undefined) t.closesAt = pick.start + RELAY_THREAD_DAYS * 24 * HOUR;
    const moved = this.h.booking(oppId)!;
    this.h.log("reschedule", { oppId, memberId: id, result: "moved", at: pick.start });
    for (const x of moved.going) this.h.send(x, this.h.copy.rescheduled(whenPhrase(pick.start), moved.venue ?? "the same place"), { kind: x === id ? "reply" : "scheduling", oppId, about: moved.going, booked: pick.start });
    return true;
  }

  /** Expire swap asks after 72 hours and reschedule asks after 24 (the original plan stands). */
  tick(now: number) {
    for (const sh of this.s.shares) if (sh.status === "asked" && now - sh.askedAt >= CONTACT_TTL) {
      sh.status = "expired"; sh.at = now;
      this.h.log("contact_share", { shareId: sh.id, oppId: sh.oppId, status: "expired" });
      this.h.send(sh.requester, this.h.copy.contactNotNow(this.h.person(sh.target)?.first ?? "them"), { kind: "info", oppId: sh.oppId, about: [sh.requester, sh.target] });
    }
    for (const [oppId, r] of Object.entries(this.s.resched)) {
      const b = this.h.booking(oppId);
      if (b && b.stage === "scheduled" && b.meetingAt !== undefined && now - r.at < RESCHEDULE_TTL && now < b.meetingAt - 2 * HOUR) continue;
      delete this.s.resched[oppId];
      if (!b || b.stage !== "scheduled" || b.meetingAt === undefined) continue;
      this.h.log("reschedule", { oppId, memberId: r.by, result: "expired" });
      this.h.send(r.by, this.h.copy.rescheduleKept(whenPhrase(b.meetingAt)), { kind: "scheduling", oppId, about: b.going });
    }
    for (const t of this.s.threads) if (t.closedAt === undefined) { const why = this.closeReason(t, now); if (why) this.close(t, why); }
  }

  // ---------------------------------------------------------------------------- bans and deletes
  /**
   * The member was banned: everyone who had a thread with them (open or closed) gets one neutral
   * safety notice, never a name or a reason, and their threads close. Returns how many were told.
   */
  banned(id: MemberId): number {
    let n = 0;
    for (const t of this.s.threads) {
      if (!t.members.includes(id)) continue;
      this.close(t, "ban");
      for (const x of t.members) {
        const key = `${id}|${x}`;
        if (x === id || this.s.banNoticed.includes(key)) continue;
        this.s.banNoticed.push(key);
        const res = this.h.send(x, this.h.copy.banNotice, { kind: "safety" });
        this.h.log("ban_notice", { memberId: x, threadId: t.id, sent: res !== "refused" });
        n++;
      }
    }
    return n;
  }

  /**
   * The member left or deleted their data: their threads close; texts to or from them and their
   * name are removed from the log. Ids, statuses and hashes stay (a safety record).
   */
  forget(id: MemberId, scrub: (t: string) => string) {
    this.closeFor(id, "left");
    for (const e of this.s.log) {
      if (e.from === id || e.to === id) {
        if (e.status === "held") { e.status = "blocked"; e.reason = `${e.reason ?? ""},member_left`.replace(/^,/, ""); }
        delete e.body;
        if (e.from === id) delete e.fromName;
      } else if (e.body !== undefined) e.body = scrub(e.body);
    }
    for (const t of this.s.threads) t.told = t.told.filter(x => x !== id);
    for (const [oppId, r] of Object.entries(this.s.resched)) if (r.by === id || r.to.includes(id)) delete this.s.resched[oppId];
  }
}

// ------------------------------------------------------------------------------ database rows
type Row = Record<string, unknown>;
const date = (t: number | undefined) => (typeof t === "number" && Number.isFinite(t) ? new Date(t) : null);
/** A Postgres text[] literal (the driver sends a JS array as text). */
const textArray = (xs: readonly string[]) => `{${xs.map(x => `"${x.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
/** The relay tables' rows (migration 0013) for a stored state. Bodies only while held. */
export function relayRows(s: RelayState | undefined, app: string): { relay_threads: Row[]; relay_log: Row[]; contact_shares: Row[] } {
  if (!s) return { relay_threads: [], relay_log: [], contact_shares: [] };
  return {
    relay_threads: s.threads.map(t => ({ id: t.id, app_id: app, opportunity_id: t.oppId, members: textArray(t.members), opened_at: date(t.openedAt), closes_at: date(t.closesAt), closed_at: date(t.closedAt), closed_reason: t.closedReason ?? null })),
    relay_log: s.log.map(e => ({ id: e.id, app_id: app, thread_id: e.threadId, from_member: e.from, to_member: e.to, at: date(e.at), status: e.status, reason: e.reason ?? null, body_hash: e.bodyHash, body: e.status === "held" ? e.body ?? null : null, from_name: e.fromName ?? null })),
    contact_shares: s.shares.map(x => ({ id: x.id, app_id: app, opportunity_id: x.oppId, requester: x.requester, target: x.target, status: x.status, at: date(x.at) })),
  };
}
