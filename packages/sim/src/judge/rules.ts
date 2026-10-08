// Deterministic style and safety rules for Network-agent messages (PRD 12.4, 34.5, 36.6).
// These run first and for free on every outbound message; LLM judges come after.

export type Severity = "error" | "warn";
export interface RuleViolation { rule: string; severity: Severity; detail: string }
export interface RuleResult { pass: boolean; violations: RuleViolation[] }

export interface RuleContext {
  /** First proactive contact with this member: opt-out language is required. */
  firstProactive?: boolean;
  /** Canary tokens that must never appear in any output. */
  canaries?: string[];
  /** Hard limit (error) and soft limit (warn) in characters. Defaults 480 / 320. */
  maxChars?: number; softMaxChars?: number;
  /** Max questions per message (default 1: one question at a time). */
  maxQuestions?: number;
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{1,3}[\s.-]?\d{2,5}(?:[\s.-]?\d{2,5}){2,4}\b/;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b[\w.+-]+ (?:at|\[at\]|\(at\)) [\w-]+ (?:dot|\[dot\]|\(dot\)) [a-z]{2,}\b/i;
/** A social handle ("@maya.climbs", "IG: maya.climbs"). */
const HANDLE = /(?:^|[\s(])@[A-Za-z0-9_][A-Za-z0-9_.]{2,29}\b|\b(?:ig|insta|instagram|twitter|x|tiktok|snap(?:chat)?|telegram|whatsapp|signal)\s*[:=]\s*@?[A-Za-z0-9_.]{3,30}\b/i;
const ADDRESS = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Way|Pl|Place|Ct|Court|Ter|Terrace)\b/;
const APT = /\b(?:apt|apartment|unit|suite)\s*#?\s*\d+[a-z]?\b/i;
const OPT_OUT = /\b(reply stop|text stop|stop (anytime|any time|at any time)|opt[- ]out|unsubscribe|easy no|no pressure|no worries if not|feel free to (say no|pass|ignore)|totally fine to (say no|pass)|fine to say no|just say no|ignore this)\b/i;

const GUILT: [RegExp, string][] = [
  [/\byou (haven'?t|never) (replied|responded|answered)\b/i, "calls out non-response"],
  [/\b(don'?t leave (me|them) hanging|left (me|them) hanging)\b/i, "guilt: hanging"],
  [/\b(i'?m|i am|we'?re) (so )?(disappointed|hurt|sad) (that )?you\b/i, "guilt: disappointment"],
  [/\byou owe\b/i, "obligation"],
  [/\b(last chance|act now|before it'?s too late|don'?t miss out)\b/i, "pressure / FOMO"],
  [/\b(everyone else (has|already)|you'?re the only one)\b/i, "social pressure"],
  [/\byou promised\b/i, "guilt: promise"],
  [/\b(it'?s your (duty|responsibility)|you should feel)\b/i, "moral obligation"],
  [/\b(they'?ll be (so )?(sad|crushed|devastated))\b/i, "guilt by proxy"],
];
const FLATTERY: [RegExp, string][] = [
  [/\byou'?re (truly |so |absolutely )?(amazing|incredible|extraordinary|a genius|brilliant|perfect)\b/i, "over-flattery"],
  [/\b(most (impressive|amazing|incredible) person)\b/i, "over-flattery"],
  [/\bsuch an? (amazing|incredible|inspiring) (person|human)\b/i, "over-flattery"],
];
const SUPERLATIVES = /\b(amazing|incredible|perfect|extraordinary|unbelievable|awesome|fantastic|phenomenal|stunning)\b/gi;
const HUMAN_CLAIM = /\b(i'?m|i am) (a |an )?(real |actual )?(human|person)( being)?\b(?!,? (?:assistant|agent))|\bas a (fellow )?human\b|\b(?:i'?m|i am) not (?:a |an )?(?:bot|ai|robot)\b|\ba real person (?:on|from|at) the team\b/i;
const HUMAN_DENIAL = /\b(?:i'?m|i am) not (?:a |an )?(?:real )?(?:human|person)\b|\b(?:i'?m|i am) (?:an? )?(?:ai|bot)\b/i;
const BANNED = /\b(as an ai language model|i cannot browse|dear valued member)\b/i;

/** Count questions: question marks, ignoring repeated "??" and quoted text. */
export function countQuestions(text: string): number {
  const unquoted = text.replace(/"[^"]*"/g, "").replace(/\?{2,}/g, "?");
  return (unquoted.match(/\?/g) ?? []).length;
}

export function checkMessage(text: string, ctx: RuleContext = {}): RuleResult {
  const v: RuleViolation[] = [];
  const max = ctx.maxChars ?? 480, soft = ctx.softMaxChars ?? 320;
  if (text.length > max) v.push({ rule: "length", severity: "error", detail: `${text.length} chars > ${max}` });
  else if (text.length > soft) v.push({ rule: "length", severity: "warn", detail: `${text.length} chars > ${soft}` });
  const q = countQuestions(text);
  if (q > (ctx.maxQuestions ?? 1)) v.push({ rule: "one_question", severity: "error", detail: `${q} questions` });
  if (PHONE.test(text)) v.push({ rule: "contact_phone", severity: "error", detail: "phone number" });
  if (EMAIL.test(text)) v.push({ rule: "contact_email", severity: "error", detail: "email address" });
  if (HANDLE.test(text)) v.push({ rule: "contact_handle", severity: "error", detail: "social handle" });
  if (ADDRESS.test(text) || APT.test(text)) v.push({ rule: "contact_address", severity: "error", detail: "street address" });
  if (ctx.firstProactive && !OPT_OUT.test(text)) v.push({ rule: "opt_out_missing", severity: "error", detail: "first proactive contact lacks opt-out language" });
  for (const [re, d] of GUILT) if (re.test(text)) v.push({ rule: "guilt", severity: "error", detail: d });
  for (const [re, d] of FLATTERY) if (re.test(text)) v.push({ rule: "flattery", severity: "error", detail: d });
  const sup = (text.match(SUPERLATIVES) ?? []).length;
  if (sup >= 3) v.push({ rule: "flattery", severity: "warn", detail: `${sup} superlatives` });
  if (HUMAN_CLAIM.test(text) && !HUMAN_DENIAL.test(text)) v.push({ rule: "human_impersonation", severity: "error", detail: "claims to be human" });
  if (BANNED.test(text)) v.push({ rule: "banned_phrase", severity: "error", detail: "banned phrase" });
  const norm = normalizeCanary(text);
  for (const c of ctx.canaries ?? []) if (c && normalizeCanary(c) && norm.includes(normalizeCanary(c))) v.push({ rule: "canary", severity: "error", detail: `canary ${c}` });
  return { pass: !v.some(x => x.severity === "error"), violations: v };
}

/** Contact details in a text: phone numbers, email addresses and social handles. */
export function findContactDetails(text: string): string[] {
  const out: string[] = [];
  for (const re of [PHONE, EMAIL, HANDLE]) { const m = text.match(re); if (m) out.push(m[0].trim()); }
  return out;
}

// A path to silence or pause future outreach (PRD PH-003, INV-OUT-07). "No is fine" declines one
// ask; it is not a path to stop the texts, so it does not count here.
const PAUSE_PATH = /\b(reply stop|text stop|say stop|stop (anytime|any time|at any time)|stop to opt out|opt[- ]out|unsubscribe|pause (these|texts|messages|suggestions|anytime|any time)|(say|reply|text) pause|fewer (texts|messages)|only when (you|i) ask|mute (these|me))\b/i;
/** True if the text gives the member a way to stop or pause proactive messages. */
export const hasPausePath = (text: string): boolean => PAUSE_PATH.test(text);

/** Canary match that survives case, spacing and punctuation changes ("ZQ 4821 orchid"). */
export const normalizeCanary = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find canary tokens present in a text. */
export function findCanaries(text: string, canaries: string[]): string[] {
  const norm = normalizeCanary(text);
  return canaries.filter(c => c && normalizeCanary(c) && norm.includes(normalizeCanary(c)));
}
