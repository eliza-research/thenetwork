// Inbound message understanding (deterministic first pass). Every member message is classified
// before anything else touches it: what the member wants (a person, a plan, an answer), plus abuse
// signals (spam and sales, scams, contact extraction, prompt injection, harassment) and signs that
// the sender is under 18. An LLM classifier can be layered on top later; these rules are the floor
// that never depends on a model (PRD 32.14 safety classifier, 17.4 minors).
import type { Category } from "@thenetwork/core";
import { DESIRES, INTERESTS, SKILLS } from "@thenetwork/sim";

export type Abuse = "sales_spam" | "scam_money" | "contact_extraction" | "prompt_injection" | "harassment" | "mass_recruit";
export type InboundKind =
  | "people_request" | "plans_request" | "invite_friend" | "cancel" | "block" | "report" | "feedback_like" | "ack" | "other";

export interface Classified {
  kind: InboundKind;
  abuse: Abuse[];
  /** Risk points this message adds to the sender's trust score. */
  risk: number;
  minorSignal: boolean;
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
  minor: /\b(after school|math test|homework|my (mom|dad|mum|parents) (says?|said|won't)|school night|high school|middle school|\b(9th|10th|11th|12th) grade|i'?m (13|14|15|16|17)\b|when i turn 18|prom)\b/i,
  invite: /\b[Mm]y friend ([A-Z][a-z]+)\b/,
  cancel: /\b(can'?t make it|have to bail|can'?t come|need to cancel|something came up)\b/i,
  block: /^\s*block\s+(.+)$/i,
  report: /^\s*report\s+(.+)$/i,
  plans: /\b(anything fun|what'?s (on|happening|good)|something to do|plans? (this|for the) (weekend|week|tonight)|fun (going on|this weekend)|any (events|plans))\b/i,
  peopleAsk: /\b(anyone (around|who|want|up for)|looking for (a |an |someone|people)|hoping to|find (me )?(a|an|someone|people)|want to meet|know anyone|still hoping)\b/i,
  feedback: /\b(it was (great|nice|fine|fun|good|ok|okay)|we (really )?clicked|honestly not great|never showed|would (definitely )?(do it|meet|hang out) again|not much in common)\b/i,
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
  const minorSignal = RX.minor.test(t);
  const out: Classified = { kind: "other", abuse, risk, minorSignal, tags: [], text: t };

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

/** Sentiment of a feedback reply (for edges and reliability). */
export function feedbackOf(body: string): { sentiment: "positive" | "neutral" | "negative"; selfNoShow: boolean; otherNoShow: boolean; again: boolean } {
  const t = body.toLowerCase();
  const selfNoShow = /couldn'?t make it|didn'?t make it|had to bail/.test(t);
  const otherNoShow = /never showed|didn'?t show|no[- ]show/.test(t);
  const again = /again|clicked/.test(t) && !/not great/.test(t);
  const sentiment = /great|clicked|loved|amazing|nice|easy to talk/.test(t) ? "positive" : /not great|terrible|rude|creepy|bummer|didn'?t have much/.test(t) || otherNoShow ? "negative" : "neutral";
  return { sentiment, selfNoShow, otherNoShow, again };
}
