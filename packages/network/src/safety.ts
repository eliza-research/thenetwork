// Safety on the text line (PRD 17.4, 32.14, 36.3, F23; docs/runbook-safety.md). The deterministic
// floor, like classify.ts: it never depends on a model.
//  - safetyOf: the inbound safety classifier. "urgent" is danger now or just now ("he followed me
//    home", "I don't feel safe"): the member hears "call 911" first and an urgent case opens. "flag"
//    is harm told about someone else (harassment, a money ask): a case and a short supportive reply.
//    Neither reply carries matching content.
//  - safetyCues: the sender's own risk signals as safety:* facet tags. The slop pack sends a member
//    with one of them to safety_review instead of matching them; friends holds them the same way.
//  - Who a block or a report is about: pronouns and first names are resolved among the member's own
//    counterparts (people the Network introduced them to), never by searching every member.
//  - What the Network tells the platform (SafetySignal): a person-level hold, a minor report, and
//    the evidence to keep when someone deletes their data.
import { DAY, type MemberId } from "@thenetwork/core";
import { sentencesOf, type Classified } from "./classify.ts";
import { reportKindOf, type ReportKind } from "./reports.ts";

export type SafetyLevel = "none" | "flag" | "urgent";
export interface SafetyRead { level: SafetyLevel; kind?: ReportKind }

/**
 * How long a case's evidence stays after the people in it delete their data: their messages,
 * feedback and events (PRD F24 "minimal retained records for safety"; 36.3 evidence preservation).
 * 180 days covers a staff review, an appeal and a police request. A proposed default: the founder
 * and counsel set the final number with the privacy policy.
 */
export const EVIDENCE_RETENTION_DAYS = 180;
export const EVIDENCE_RETENTION_MS = EVIDENCE_RETENTION_DAYS * DAY;

/** The member says they are in danger now. "I don't feel safe meeting strangers" is a preference, not danger: the sentence must end there. */
const DANGER_SELF = /\b(?:i'?m|im|i am) (?:in danger|being (?:followed|stalked|threatened))\b|\bscared for my (?:life|safety)\b|\b(?:i'?m not |im not |i am not |i (?:don'?t|do not) feel |i feel (?:un|not ))safe(?: (?:right now|now|here|at home|going home|with (?:him|her|them)|around (?:him|her|them)))?\W*$/;
/** Someone else, right before what they did ("he followed me home", "my date just grabbed me"). */
const WHO = "(?:he|she|they|someone|somebody|(?:this|that|the) (?:guy|girl|person|dude|man|woman)|my (?:date|match))";
const DID = [
  "follow(?:ed|ing|s) me(?! on\\b)", "(?:hit|hurt|choked|attacked|assaulted|raped|grabbed|groped|drugged) me\\b", "touched me (?:without|inappropriately)", "spiked my drink",
  "stalk(?:ed|ing|s) me", "threaten(?:ed|ing|s) (?:me|to (?:hurt|kill|hit|find|come|post|share|leak))", "(?:won'?t|wouldn'?t) let me (?:go|leave)",
  "outside my (?:door|place|apartment|building|house)", "showed up at my (?:door|place|apartment|work|house|job)", "made me feel (?:unsafe|scared|afraid|threatened)",
].join("|");
const DANGER_ACT = new RegExp(`\\b${WHO}(?:'s| is| was| has been| keeps?| kept)?\\s+(?:\\w+\\s+)?(?:${DID})`);
/** Someone else in the sentence. */
const ACTOR = new RegExp(`\\b${WHO}\\b`);
/** Harm told about someone else that is not danger now. */
const HARM = /\b(?:harass(?:ed|ing)? me|kept (?:texting|messaging|calling) me|won'?t stop (?:texting|messaging|calling)|asked (?:me )?for money|asked me to (?:venmo|zelle|send|wire|pay|lend)|sent me (?:nudes|unsolicited|explicit)|(?:was|is|got) (?:rude|aggressive|hostile|abusive|creepy|inappropriate) (?:to|with) me|made (?:sexual|inappropriate) comments|catfish(?:ed)? me|scam(?:med)? me)\b/;

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’ʼ`´]/g, "'");

/**
 * The inbound safety level of a message (PRD 32.14: none, flag, urgent). One sentence at a time, so
 * "he" and what he did must be in the same sentence. A disclosure the classifier read (classify.ts:
 * "he asked me to venmo him $50") is a flag. A plain bad date ("it was awkward") is none.
 */
export function safetyOf(text: string, c?: Pick<Classified, "disclosure">): SafetyRead {
  const t = norm(text);
  let level: SafetyLevel = "none";
  for (const s of sentencesOf(t)) {
    if (DANGER_SELF.test(s.text.trim()) || DANGER_ACT.test(s.text)) { level = "urgent"; break; }
    if (ACTOR.test(s.text) && HARM.test(s.text)) level = "flag";
  }
  if (level === "none" && c?.disclosure?.some(k => k === "harassment" || k === "scam_money" || k === "contact_extraction")) level = "flag";
  if (level === "none") return { level };
  const k = reportKindOf(text);
  return { level, kind: k !== "other" ? k : level === "urgent" ? "unsafe" : "harassment" };
}

/** The safety:* cue tags the slop pack reads (engine packs/slop/options.ts safetyCues) and friends holds on. */
export const SAFETY_CUE = { scam: "safety:scam_pattern", age: "safety:age_signal", hostile: "safety:hostile_language" } as const;

/**
 * The sender's own risk signals in one message, as safety:* tags: a money ask or pressure for other
 * people's contact details (scam_pattern), hostile or sexual pressure (hostile_language), a sign the
 * sender is under 18 (age_signal). What the sender tells about someone else (a disclosure) is never
 * the sender's cue.
 */
export function safetyCues(c: Pick<Classified, "abuse" | "minorSignal">): string[] {
  const out = new Set<string>();
  if (c.abuse.includes("scam_money") || c.abuse.includes("contact_extraction")) out.add(SAFETY_CUE.scam);
  if (c.abuse.includes("harassment")) out.add(SAFETY_CUE.hostile);
  if (c.minorSignal) out.add(SAFETY_CUE.age);
  return [...out];
}

/** "block him", "report her", "them", "my date": the target is whoever the member most likely means. */
export const PRONOUN_TARGET = /^(?:him|her|them|they|he|she|my date|my match|(?:the|this|that) (?:guy|girl|person|dude|man|woman))\b/i;

/** A reply to "Who do you mean?" that drops the question. */
export const NEVER_MIND = /^\W*(?:never ?mind|nvm|nobody|no one|none|forget it|no|nope|cancel that)\W*$/i;

/** What the Network asks the platform to do (NetworkOptions.onSafety; the service applies it after the unit commits). */
export type SafetySignal =
  /** Hold the person on every app until staff clear it (an urgent report by someone they met; a minor report). */
  | { t: "hold"; memberId: MemberId; reason: "urgent_report" | "minor_report"; caseId?: string }
  /** Another member says this member is under 18: the person's age goes under 18 pending review, photos and ratings go. */
  | { t: "minor"; memberId: MemberId; caseId?: string }
  /** Keep these members' messages, feedback and events for EVIDENCE_RETENTION_DAYS, even if they delete their data. */
  | { t: "evidence"; memberIds: MemberId[]; caseId?: string };
