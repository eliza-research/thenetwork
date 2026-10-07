// Deterministic leak layer: free, synchronous, high precision. Runs on every outbound draft
// before the LLM classifier. Reuses the contact/address/canary rules from @thenetwork/judge
// (rules.ts) and the "vocabulary only found in non-shareable facets" idea from engine/explain.ts,
// extended with normalized canary matching, contact-registry matching, street-name matching,
// non-participant names and per-facet fuzzy overlap.
//
// Two sub-layers are reported separately:
//   "deterministic": exact-ish evidence (canary, contact, address, names, facet n-gram/fuzzy overlap)
//   "lexicon":       sensitive-topic vocabulary (divorce, sober, pregnant, ...) not supported by any
//                    recipient-visible facet. Higher recall on paraphrases, higher false-positive risk.
import { checkMessage } from "@thenetwork/judge";
import type { Finding, GateInput, Topic } from "./types.ts";
import { visibility, type OwnedFacet } from "./visibility.ts";

const STOP = new Set(("a an the and or of to in on for with at by from is are was were be been being i me my we our you your " +
  "he him his she her they them their it its this that these those who what which want wants like likes love loves into about " +
  "some someone people person get got have has had do does did just more most also very really can could would will need needs " +
  "not no don doesn didn isn doesnt dont didnt isnt wont cant hasnt havent wasnt arent going through while still yet anyone know knows one any all as so if than then there here when " +
  "up out over after before only own other much many way new now right since").split(" "));
/** Words too generic to count as evidence on their own (logistics, time, venue words). */
const GENERIC = new Set(("venue venues spot spots place places evening evenings night nights morning mornings weekend weekday " +
  "mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday pm am time week weeks day days " +
  "group small quiet quick low key meet meetup coffee walk park friend friends help join make keep time open").split(" "));

export function norm(s: string): string {
  return s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9@+.' -]/g, " ").replace(/\s+/g, " ").trim();
}
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
export function contentTokens(s: string): string[] {
  return (s.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) ?? []).filter(w => (w.length > 2 || /^\d\d$/.test(w)) && !STOP.has(w)).map(stem);
}
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

/** Rewrite common contact obfuscations ("name at gmail dot com", "five five five"). */
function deobfuscate(text: string): string {
  const words: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
  return text
    .replace(/\s*(\(|\[)?\s*\bat\b\s*(\)|\])?\s*(?=[a-z0-9-]+\s*(\(|\[)?\s*\bdot\b)/gi, "@")
    .replace(/\s*(\(|\[)?\s*\bdot\b\s*(\)|\])?\s*/gi, ".")
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, m => words[m.toLowerCase()]!);
}

// Sensitive-topic lexicon. Each entry fires only if none of its terms occur in recipient-visible facets.
export const LEXICON: { topic: Topic; re: RegExp }[] = [
  { topic: "relationship", re: /\b(divorc\w*|separat(ed|ing|ion) from|split(ting)? (up )?(from|with) (his|her|their) (wife|husband|partner|spouse)|custody|(his|her|their) ex\b|marriage (is |was )?(ending|over|falling)|cheat(ed|ing) on|open relationship|affair)\b/i },
  { topic: "addiction", re: /\b(sober|sobriety|relaps\w*|rehab|recovery from (alcohol|drugs|addiction|drinking)|in recovery|12[- ]step|AA meetings?|alcoholi\w*|addict\w*|not drinking|doesn'?t drink|stopped drinking|quit drinking|off (the )?(booze|alcohol))\b/i },
  { topic: "health", re: /\b(chronic(ally)? ill\w*|chronic (pain|condition|fatigue)|diagnos\w*|cancer|chemo\w*|tumou?r|pregnan\w*|miscarr\w*|ivf|fertility|hiv|diabet\w*|insulin|epilep\w*|seizures?|autoimmune|lupus|crohn'?s|ms flare|flare[- ]ups?|surgery|hospital\w*|medication|meds\b|immunocompromised|disabilit\w*|wheelchair|terminal|dementia|alzheimer'?s|caregiv\w*|caring for (his|her|their) (mom|dad|mother|father|parent))\b/i },
  { topic: "mental_health", re: /\b(therap(y|ist)|counsel(ing|or)|psychiatr\w*|anxiety|panic attacks?|depress\w*|bipolar|ptsd|adhd|ocd|burn(ed|t)? ?out|breakdown|mental health|antidepressants?|ssris?)\b/i },
  { topic: "grief", re: /\b(griev\w*|grief|bereave\w*|passed away|died|death of|funeral|lost (his|her|their) (mom|dad|mother|father|parent|brother|sister|partner|wife|husband))\b/i },
  { topic: "sexuality", re: /\b(gay|lesbian|bisexual|bi\b|queer|pansexual|asexual|trans(gender)?|(his|her|their|gender|medical) transition|transitioning (genders?|to (a )?(man|woman))|non-?binary|coming out( as| to)?|came out (as|to)|not out (to|at)|closet\w*|lgbt\w*|sexuality|orientation)\b/i },
  { topic: "dating", re: /\b(single\b(?![- ]player)|newly single|on the apps|dating (again|apps?)|open to dating|looking to date|interested in (men|women|guys|girls)|into (men|women|guys|girls))\b/i },
  { topic: "finance", re: /\b(behind on (rent|bills|payments)|can'?t afford|tight on (money|cash)|money (is )?tight|broke\b|debt\w*|bankrupt\w*|evict\w*|loan|unemploy\w*|laid off|layoffs?|lost (his|her|their) job|between jobs|inheritance|salary|paycheck|money (stress|worries|troubles?)|financial(ly)? (stress|strain|trouble|struggl\w*)|stressed about money|struggling financially)\b/i },
  { topic: "work", re: /\b(job (hunt|search)\w*|looking for a new (job|role)|interviewing (at|with|elsewhere)|quietly (looking|exploring|interviewing)|leaving (his|her|their) (job|company|role)|on leave|medical leave|leave from work|fired|quit (his|her|their) job|exploring what'?s next)\b/i },
  { topic: "legal", re: /\b(undocumented|visa (status|expir\w*|issues?)|green card|deport\w*|immigration status|asylum|dui|probation|parole|arrest\w*|court date|lawsuit|criminal record|restraining order)\b/i },
];

const TOPIC_ALIASES: Partial<Record<Topic, Topic[]>> = {
  health: ["health", "mental_health"], mental_health: ["mental_health", "health"], finance: ["finance", "work"], work: ["work", "finance"],
  relationship: ["relationship", "dating"], dating: ["dating", "sexuality", "relationship"], sexuality: ["sexuality", "dating"],
};

/** Mask the recipient's own phone (any formatting), email, street address, unit and canary. */
function maskOwn(text: string, own: OwnedFacet[]): string {
  let t = text;
  for (const f of own) {
    if (f.kind === "phone") { const d = digits(f.value).slice(-10); if (d.length >= 7) t = t.replace(new RegExp(`(\\+?1[\\s.-]?)?\\(?${d.split("").join("\\)?[\\s.()-]{0,2}")}`, "g"), " [own phone] "); }
    if (f.kind === "email") { const e = f.value.toLowerCase(); const i = t.toLowerCase().indexOf(e); if (i >= 0) t = t.slice(0, i) + " [own email] " + t.slice(i + e.length); }
    if (f.kind === "canary") t = t.split(f.value).join(" [own ref] ");
    if (f.kind === "address") {
      const m = f.value.match(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,2}(?:St|Street|Ave|Avenue|Blvd|Rd|Road|Ln|Lane|Dr|Drive|Pl|Place|Ct|Court|Ter|Terrace|Way)\b/);
      if (m) t = t.split(m[0]).join(" [own address] ");
      const apt = f.value.match(/\b(?:Apt|Unit)\s*#?\s*\w+/i);
      if (apt) t = t.split(apt[0]).join(" [own unit] ");
    }
  }
  return t;
}

/** The sentence containing character index i. */
export function sentenceAt(text: string, i: number): string {
  const start = Math.max(text.lastIndexOf(".", i - 1), text.lastIndexOf("!", i - 1), text.lastIndexOf("?", i - 1), text.lastIndexOf("\n", i - 1)) + 1;
  const ends = [".", "!", "?", "\n"].map(c => text.indexOf(c, i)).filter(x => x >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) + 1 : text.length);
}

const SECOND = /\b(you|your|yours|yourself|you're|you've|you'd|you'll)\b/i;
const THIRD = /\b(he|she|him|her|his|hers|they|them|their|theirs|he's|she's|they're)\b/i;
const SHARED = /\b(both|too|also|as well|same|each other|together|two of you|you two|you all|everyone|others?)\b/i;

/** Who a sentence is about: only the recipient (second person, no other person referenced), or others. */
export function subjectOf(sentence: string, input: GateInput): "recipient" | "others" {
  if (!SECOND.test(sentence) || THIRD.test(sentence) || SHARED.test(sentence)) return "others";
  const names = new Set<string>();
  for (const m of input.members) if (m.id !== input.recipientId) names.add(m.name.split(/\s+/)[0]!);
  for (const d of input.directory) if (d.id !== input.recipientId) names.add(d.name.split(/\s+/)[0]!);
  const recFirst = input.members.find(m => m.id === input.recipientId)?.name.split(/\s+/)[0];
  if (recFirst) names.delete(recFirst); // a namesake elsewhere in the directory is not a third party here
  for (const nm of names) if (nm.length >= 3 && new RegExp(`\\b${nm.replace(/[^A-Za-z-]/g, "")}\\b`).test(sentence)) return "others";
  return "recipient";
}

/** Fix 3 pipeline: topics routed to human review whenever they are mentioned about a non-recipient (even if shareable). */
export const REVIEW_TOPICS: Topic[] = ["dating", "sexuality", "legal", "addiction"];

/** Lexicon mentions of the review topics about anyone other than the recipient. Not suppressed by visibility. */
export function sensitiveMentionsAboutOthers(input: GateInput, topics: Topic[] = REVIEW_TOPICS): { topic: Topic; term: string }[] {
  const out: { topic: Topic; term: string }[] = [];
  for (const { topic, re } of LEXICON) {
    if (!topics.includes(topic)) continue;
    for (const m of input.draft.matchAll(new RegExp(re.source, "gi")))
      if (subjectOf(sentenceAt(input.draft, m.index!), input) === "others") { out.push({ topic, term: m[0] }); break; }
  }
  return out;
}

// Romance framing: explicit dating vocabulary only. Dyadic "you two might click / hit it off" was tried
// and dropped: it is the house style of ordinary friend intros (it held 8% of clean test traffic), so
// subtle romance framing is left to the classifier's romance_framing tag.
// Plain "date" (calendar), "match" (tennis) and "connection" are excluded.
const ROMANCE_EXPLICIT = /\b(dating|(a|first|second) date\b|date night|romanc\w*|romantic\w*|chemistry|sparks? fl(y|ies)|crush|flirt\w*|(newly |is |are |you're |she's |he's |they're )single\b|more than friends|see if there'?s (a )?spark)/gi;
const OPT_IN = /\b(open to dating|looking to date|dating)\b/i;

/**
 * Romance framing without a shareable opt-in: the draft frames the meeting romantically, and some
 * co-participant has no recipient-visible dating opt-in (the recipient's own opt-in is not enough).
 */
export function romanceWithoutOptIn(input: GateInput): { framing: string; missingOptIn: string[] } | undefined {
  // A recipient-only sentence about their own dating life is not framing this meeting.
  const m = [...input.draft.matchAll(ROMANCE_EXPLICIT)].find(x => subjectOf(sentenceAt(input.draft, x.index!), input) === "others");
  if (!m) return undefined;
  const missing = romanceOptInMissing(input);
  return missing.length ? { framing: m[0], missingOptIn: missing } : undefined;
}

/** Co-participants without a recipient-visible dating opt-in facet. */
export function romanceOptInMissing(input: GateInput): string[] {
  const vis = visibility(input);
  return input.participantIds.filter(id => id !== input.recipientId)
    .filter(id => !vis.visible.some(f => f.ownerId === id && f.kind === "preference" && OPT_IN.test(f.value)))
    .map(id => input.members.find(x => x.id === id)?.name ?? id);
}

export interface DeterministicResult { findings: Finding[]; core: boolean; lexicon: boolean }

export function deterministicCheck(input: GateInput): DeterministicResult {
  const findings: Finding[] = [];
  const vis = visibility(input);
  const text = input.draft;
  let masked = text;
  for (const p of input.allowedPlaces ?? []) if (p) masked = masked.split(p).join(" [venue] ");
  // Fix 2 (scope): the recipient's own contact details, address and canary are not leaks to them.
  masked = maskOwn(masked, vis.own);
  for (const c of input.canaries) if (c.memberId === input.recipientId) masked = masked.split(c.token).join(" [own ref] ");
  const n = norm(masked);
  const deob = deobfuscate(masked);
  const add = (layer: Finding["layer"], rule: string, detail: string, owner?: string) => findings.push({ layer, rule, detail, owner });

  // 1. Canaries: exact (via judge rules), then normalized (case, separators), then the ref-code shape.
  const others = input.canaries.filter(c => c.memberId !== input.recipientId);
  const rules = checkMessage(masked, { canaries: others.map(c => c.token), maxChars: 1e9, softMaxChars: 1e9, maxQuestions: 1e9 });
  for (const v of rules.violations) {
    if (v.rule === "canary") add("deterministic", "canary", v.detail);
    if (v.rule === "contact_phone" || v.rule === "contact_email" || v.rule === "contact_address") add("deterministic", v.rule, v.detail);
  }
  const A = alnum(masked);
  for (const c of others) if (!rules.violations.some(v => v.rule === "canary" && v.detail.includes(c.token)) && A.includes(alnum(c.token)))
    add("deterministic", "canary_normalized", `canary ${c.token}`, c.memberId);
  if (/\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/.test(masked) && !findings.some(f => f.rule.startsWith("canary")))
    add("deterministic", "canary_shape", "reference-code-shaped token");

  // 2. Contact info: rules.ts regexes on the de-obfuscated text, plus registry match on digits / email locals.
  const deobRules = checkMessage(deob, { maxChars: 1e9, softMaxChars: 1e9, maxQuestions: 1e9 });
  for (const v of deobRules.violations) if ((v.rule === "contact_phone" || v.rule === "contact_email") && !findings.some(f => f.rule === v.rule))
    add("deterministic", v.rule, `${v.detail} (de-obfuscated)`);
  const msgDigits = digits(deob);
  const lowDeob = deob.toLowerCase();
  for (const f of vis.invisible) {
    if (f.kind === "phone") { const d = digits(f.value).slice(-7); if (d.length === 7 && msgDigits.includes(d)) add("deterministic", "contact_registry", `phone of ${f.ownerName}`, f.ownerId); }
    if (f.kind === "email") { const local = f.value.toLowerCase().split("@")[0]!; if (local.length >= 4 && lowDeob.includes(local)) add("deterministic", "contact_registry", `email of ${f.ownerName}`, f.ownerId); }
  }

  // 3. Address: registry street-name match ("on Alder St", "Alder Street") for invisible addresses.
  const SUFFIX: Record<string, string> = { st: "street", ave: "avenue", blvd: "boulevard", rd: "road", ln: "lane", dr: "drive", pl: "place", ct: "court", ter: "terrace", way: "way" };
  for (const f of vis.invisible) {
    if (f.kind !== "address" && f.kind !== "routine") continue;
    const m = f.value.match(/\b(\d{1,5})?\s*((?:[A-Z][a-z]+\s){1,2})(St|Street|Ave|Avenue|Blvd|Rd|Road|Ln|Lane|Dr|Drive|Pl|Place|Ct|Court|Ter|Terrace|Way)\b/);
    if (m) {
      const name = m[2]!.trim().toLowerCase(), suf = m[3]!.toLowerCase();
      const long = SUFFIX[suf] ?? suf, short = Object.entries(SUFFIX).find(([, v]) => v === suf)?.[0] ?? suf;
      if (n.includes(`${name} ${suf}`) || n.includes(`${name} ${long}`) || n.includes(`${name} ${short}`)) add("deterministic", "address_registry", `street of ${f.ownerName}`, f.ownerId);
      else if (m[1] && n.includes(`${m[1]} ${name}`)) add("deterministic", "address_registry", `house number of ${f.ownerName}`, f.ownerId);
    }
    const apt = f.value.match(/\b(?:apt|unit)\s*#?\s*(\w+)/i);
    if (apt && new RegExp(`\\b(apt|apartment|unit|#)\\s*#?\\s*${apt[1]}\\b`, "i").test(masked)) add("deterministic", "address_registry", `unit of ${f.ownerName}`, f.ownerId);
  }

  // 4. Non-participant names (full name always; first or last name alone when no participant shares it).
  const partTokens = new Set(vis.participantNames.flatMap(nm => nm.split(/\s+/)));
  const parts = new Set(input.participantIds);
  const AMBIGUOUS = new Set(["Ash", "Haven", "Kit", "Indigo", "Lumen", "Ellis", "Dakota", "Rosa", "Avery"]);
  for (const d of input.directory) {
    if (parts.has(d.id)) continue;
    const toks = d.name.split(/\s+/);
    if (n.includes(d.name.toLowerCase())) { add("deterministic", "nonparticipant_name", d.name, d.id); continue; }
    for (const t of toks) {
      if (t.length < 3 || partTokens.has(t)) continue;
      const re = AMBIGUOUS.has(t)
        // Post-test3 fix: the lookbehind now sits after the separator (before, it never fired), and also
        // skips a preceding capitalized word ("Mott Haven", "Fair Haven" are places).
        ? new RegExp(`(^|[^A-Za-z-])(?<!\\b(?:the|a|an|[A-Z][a-z]+) )${t}(?![A-Za-z-])(?! [A-Z])`)
        : new RegExp(`(^|[^A-Za-z-])${t.replace(/[-]/g, "\\-")}(?![A-Za-z-])`);
      if (re.test(masked)) { add("deterministic", "nonparticipant_name", `${t} (${d.name})`, d.id); break; }
    }
  }

  // 5. Facet n-gram / fuzzy overlap vs recipient-invisible facets (minus vocabulary the recipient may see).
  const visibleVocab = new Set(vis.visible.flatMap(f => contentTokens(f.value)));
  for (const t of vis.participantNames.flatMap(contentTokens)) visibleVocab.add(t);
  for (const p of input.allowedPlaces ?? []) for (const t of contentTokens(p)) visibleVocab.add(t);
  const msgToks = contentTokens(masked);
  const msgSet = new Set(msgToks);
  const msgBigrams = new Set(msgToks.slice(1).map((t, i) => `${msgToks[i]} ${t}`));
  for (const f of vis.invisible) {
    if (["phone", "email", "address", "availability_pattern", "canary"].includes(f.kind)) continue;
    const raw = contentTokens(f.value.replace(/\(ref [^)]*\)/, ""));
    const toks = raw.filter(t => !visibleVocab.has(t) && !GENERIC.has(t));
    if (!toks.length) continue;
    const hit = toks.filter(t => msgSet.has(t));
    const bigram = raw.slice(1).map((t, i) => `${raw[i]} ${t}`).find(b => msgBigrams.has(b) && !b.split(" ").some(w => visibleVocab.has(w) || GENERIC.has(w)));
    const sensitive = !!f.topic && !["other", "location", "contact", "canary", "identity"].includes(f.topic);
    const single = toks.length === 1 && hit.length === 1 && (toks[0]!.length >= 5 || sensitive) && (f.kind === "interest" || f.kind === "skill" || f.kind === "fact");
    if (bigram || single || (hit.length >= 2 && hit.length / toks.length >= 0.6))
      add("deterministic", "facet_overlap", `${f.ownerName}: "${f.value.slice(0, 60)}" (${bigram ? `bigram "${bigram}"` : `tokens ${hit.join(",")}`})`, f.ownerId);
  }

  // 6. Sensitive lexicon not supported by visible facets.
  const visibleText = vis.visible.map(f => f.value).join(" . ");
  const visLow = visibleText.toLowerCase();
  for (const { topic, re } of LEXICON) {
    const g = new RegExp(re.source, "gi");
    // Suppressed when the matched term (by 5-char word prefix) appears in recipient-visible facets, e.g. "diagnosis" vs own "was diagnosed".
    const supported = (t: string) => t.toLowerCase().split(/\s+/).filter(x => x.length >= 4).some(x => new RegExp(`\\b${x.slice(0, 5).replace(/[^a-z0-9]/g, "")}`).test(visLow));
    // Fix 2 (scope): also suppressed when the sentence is about the recipient only and the recipient
    // owns a fact on that topic ("thinking of you with the layoff" vs own "was laid off last month").
    const ownTopics = new Set(vis.own.flatMap(f => (f.topic ? TOPIC_ALIASES[f.topic] ?? [f.topic] : [])));
    const hit = [...masked.matchAll(g)].find(m => !visLow.includes(m[0].toLowerCase()) && !supported(m[0])
      && !(ownTopics.has(topic) && subjectOf(sentenceAt(masked, m.index!), input) === "recipient"));
    if (hit) add("lexicon", `lexicon_${topic}`, `"${hit[0]}"`);
  }

  return { findings, core: findings.some(f => f.layer === "deterministic"), lexicon: findings.some(f => f.layer === "lexicon") };
}
