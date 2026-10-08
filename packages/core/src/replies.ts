// Member reply understanding (audit 2026-10-08 network-consent-2, plugin-prototypes-12).
// Deterministic, no model. One shared parser for "did the member say yes?" and "does the member
// want us to stop texting?", so the Network, the simulator's stub Network and the Blooio keyword
// handler read member text the same way.
//
// parseReply reads a free-text answer to a yes/no question ("up for X on Thursday?"):
//  - negation-aware: "absolutely not", "not sure", "i'm not in", "don't think so", "ok no",
//    "yeah no" are not yes;
//  - hedges are "unsure" ("maybe", "probably", "idk", "who is it?"), so the caller asks again;
//  - "yes but not Thursday" is a yes with a time constraint; "sure, but only with a woman" is a
//    conditional yes, which is "unsure" (leaning yes): the member must confirm the condition;
//  - a later sentence that contradicts the first ("Sounds fun. I can't though.") is "unsure",
//    a reversal ("Yes. Actually no.", "sure... no") takes the last word;
//  - "Not this week" / "can't tonight" with nothing else is a no;
//  - emoji (👍 ✅ 👎 🤔) count only when the text has no words that decide;
//  - basic Spanish (sí, claro, dale, no gracias, no puedo, tal vez, pero no el jueves).
// Anything it cannot read confidently is "unsure". Consent code must treat only "yes" as yes.
//
// parseOptOut reads "please stop texting me", "unsubscribe", "para", "no más mensajes" etc.
// Exact carrier keywords are "exact"; free-text opt-outs are "likely" (the caller honors them
// and sends one confirmation, per the TCPA "reasonable means" rule).

export type ReplyAnswer = "yes" | "no" | "unsure";

export interface ReplyConstraint {
  /** "time": a day/time restriction ("not thursday", "after 7"). "condition": anything else ("only with women"). */
  kind: "time" | "condition";
  /** The folded fragment, for logs and for asking the member to confirm. */
  text: string;
}

export interface ParsedReply {
  answer: ReplyAnswer;
  /** Restrictions the member put on the answer. A "yes" can carry time constraints only. */
  constraints: ReplyConstraint[];
  /** The member asked for another day or time ("next week instead?", "otro día"). */
  counter: boolean;
  /** For "unsure": which way the text leans, when it does ("sure, but only if X" leans yes). */
  leaning?: "yes" | "no";
  /** Short code for logs and tests: why this answer. Never contains member text. */
  reason: string;
}

// ------------------------------------------------------------------------------------ normalize

const YES_EMOJI = /[👍👌✅🙌💯🔥🥳🎉🤙✔😍🤩🙋]|❤|♥/u;
const NO_EMOJI = /[👎❌🙅🚫⛔✋]/u;
const UNSURE_EMOJI = /[🤔🤷😬😐🫤]/u;

function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC") // "sí" → "si", "quizás" → "quizas"
    .replace(/\b(can|won|don|didn|doesn|isn|wouldn|couldn|shouldn|aren|wasn|ain)t\b/g, "$1't") // "cant" → "can't"
    .replace(/\bim\b/g, "i'm")
    .replace(/([a-z])\1{2,}/g, "$1") // "yesss" → "yes", "nooo" → "no"
    .replace(/[…]/g, "...");
}

// ------------------------------------------------------------------------------------ lexicon
// Each entry is matched on the normalized text, in this order; a match masks its span so a later
// pattern does not match inside it ("no problem" is not a "no"; "absolutely not" is not a yes).

type Kind = "yes" | "no" | "unsure" | "timeNeg" | "counter" | "cond" | "reversal" | "neutral";
interface Rule { kind: Kind; re: RegExp; strong?: boolean }

const DAY = "(?:mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:nesday)?s?|thu(?:r|rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?|weekends?|weekdays?|mornings?|afternoons?|evenings?|nights?|tonight|today|tomorrow|tmrw|tmr|this week|next week|this weekend|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|fin de semana|fines de semana|manana|hoy|esta noche|esta semana|la semana que viene|la proxima semana)";
const CLOCK = "(?:\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)|noon|midnight|\\d{1,2}(?::\\d{2})?)";
const TIME_WORD = new RegExp(`\\b(?:${DAY})\\b|\\b(?:after|before|by|until|till|from|despues de las|antes de las)\\s+${CLOCK}|\\b\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)\\b|\\b(?:noon|midnight)\\b`);

const r = (kind: Kind, src: string, strong = false): Rule => ({ kind, re: new RegExp(src, "g"), strong });

const RULES: Rule[] = [
  // Positive idioms that contain a negation word.
  r("yes", "\\b(?:no problem|no prob(?:lem)?s?|not a problem|no doubt|no question|why not|why the hell not|por que no|can't wait|cannot wait|can not wait|wouldn't miss it|would not miss it|don't see why not|i don't mind|don't mind|no reason not to|how could i say no|never say no|not gonna say no)\\b", true),
  // Reversals: what follows replaces what came before.
  r("reversal", "\\b(?:actually|on second thought|second thoughts|wait|jk|just kidding|nvm|never ?mind|scratch that|changed my mind|pensandolo bien|espera)\\b"),
  r("neutral", "\\b(?:no worries|no pressure|no rush|no stress|no biggie|no te preocupes|sin problema)\\b"),
  // "I'm good" / "I'm all set" = no thanks (but "I'm good with that" = yes).
  r("yes", "\\bi'm (?:good|ok|okay|fine|cool) with (?:that|it|this|either|both|whatever)\\b", true),
  r("no", "\\bi'm (?:good|ok|okay|fine|all set|set)(?= *(?:$|[.,!?;)]|thanks|thank|tho|though|for now|for this|this time|on this))", true),
  // Negated hedges ("not sure", "really not sure") before refusals.
  r("unsure", "\\b(?:not (?:sure|certain|100%|positive|definitely|decided)|no estoy segur[oa])\\b"),
  // Time refusals: "not thursday", "can't do tonight", "except fridays", "pero no el jueves".
  r("timeNeg", `(?:\\b(?:not|no|except|excepto|menos|never|nunca)|\\b(?:can't|cannot|can not|won't|don't|no puedo)(?: do| make| make it)?)(?: on| the| el| los| la| this)?\\s+${DAY}\\b`),
  // Strong refusals (multi-word first).
  r("no", "\\b(?:absolutely|definitely|certainly|totally|hell|heck|of course|obviously|surely|honestly|really|seriously) (?:not|no)\\b", true),
  r("no", "\\b(?:claro|por supuesto|obvio|desde luego) que no\\b", true),
  r("no", "\\b(?:no thanks?|no thank you|no ty|no gracias|no way|hard pass|i'll pass|i will pass|i'd pass|ill pass|gonna pass|going to pass|pass on (?:this|that|it)|i pass|count me out|i'm out|not interested|no interest|not for me|not my thing|not my scene|not really|rather not|i'd rather not|prefer not|i don't think so|don't think so|i don't want|don't want to|do not want|not feeling it|not up for|not in the mood|no can do|i can't|can't|cannot|can not|won't|will not|i guess not|doesn't work|does not work|not work(?:ing)? for me|bail|i'm not (?:in|down|interested|up for it|available|free|going|coming)|i'm busy|too busy|i'm swamped|booked up|not available|not free|unavailable|unable|i decline|decline|leave me alone|stop texting|unsubscribe|probably not|prob not|likely not|i doubt it|doubt it|para nada|de ninguna manera|ni loco|ni loca|ni hablar|mejor no|no puedo|no me interesa|no quiero|no voy|no creo|imposible|paso)\\b", true),
  // Hedges.
  r("unsure", "\\b(?:not (?:sure|certain|100%|positive|definitely|decided)|unsure|uncertain|maybe|mayb|perhaps|possibly|might|probably|prob|potentially|idk|i don't know|don't know|dunno|let me (?:check|see|think|get back)|lemme (?:check|see|think)|i'll (?:think|check|see|let you know|get back)|think about it|get back to you|depends|it depends|we'll see|tbd|kinda|kind of|sort of|hmm+|hm+|who is it|who's (?:coming|going|it)|who else|tal vez|talvez|quizas|quiza|a lo mejor|no se|puede ser|depende|lo pienso|dejame (?:ver|pensar)|ya veremos|no estoy segur[oa])\\b"),
  // Counter-offers.
  r("counter", "\\b(?:different (?:day|time|date|week)|another (?:day|time|date|week)|some ?other (?:day|time)|other day|next week instead|instead|reschedule|rain ?check|raincheck|later in the week|otro dia|otra fecha|otra hora|mas adelante|la proxima)\\b"),
  // Conditions.
  r("cond", "\\b(?:only if|if|as long as|provided|assuming|unless|only with|only on|only after|only before|only|solo si|solo con|siempre que|siempre y cuando|con tal (?:de )?que)\\b"),
  // Yes.
  r("yes", "\\b(?:yes please|yes|yess+|yesh|yeah|yea|yah|ya|ye|yep|yup|yas+|aye|sure|sure thing|surely|ok+|okay|okie|okey|k+|alright|all right|i'm in|i am in|im in|count me in|sign me up|i'm down|im down|absolutely|definitely|def|deff|for sure|fs|of course|ofc|totally|100%|love to|i'd love|i would love|would love|love that|i'd like that|i would like that|sounds (?:good|great|fun|lovely|perfect|amazing|awesome|nice|like a plan|like fun)|that works|works for me|say less|let's do it|lets do it|let's go|lfg|happy to|glad to|can do|i can|i will|i'll be there|looking forward|go for it|go ahead|please do|do it|agreed|i guess|guess so|i think so|think so|intro me|in!|si claro|claro|dale|vale|orale|por supuesto|de acuerdo|me apunto|cuenta conmigo|me encantaria|con gusto)\\b"),
  // Weak yes words count only at the start of a sentence or comma part, after at most two filler
  // words ("Great!", "oh perfect", "but friday works"), not inside a statement ("it was nice",
  // "honestly this is great timing").
  r("yes", "(?<=(?:^|[.,!?;:]\\s*)(?:(?:not|never|i'm|im|but|and|so|oh|ah|ok|okay|yeah|yes|that|that's|thats|sounds|very|really|super|totally|then|also|pero|y|muy|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|tonight|today|tomorrow|lunes|martes|miercoles|jueves|viernes|sabado|domingo) ){0,2})(?:works|perfect|great|awesome|cool|deal|bet|nice|fine|down|interested|va|perfecto|genial|bueno|listo)\\b"),
  r("yes", "^in[!. ]*$"),
  r("no", "^pass[!. ]*$", true),
  // "si" is "yes" when it stands alone; "si + verb" is "if".
  r("yes", "(?<=^|[\\s,.!])si(?= *(?:$|[.,!;]|claro|gracias|porfa|por favor|me apunto|dale|va|perfecto|pero))"),
  r("cond", "(?<=^|[\\s,.!])si(?= +[a-z])"),
  // A bare "no" is a refusal when it is an interjection: at the start or end of a clause, or before
  // "thanks", "sorry", "I", "not"... "no heavy networking" is a determiner, not an answer.
  r("no", "\\b(?:nope|nop|nah|naw|nay|nel|negative|never|stop)\\b", true),
  r("no", "\\bno(?= *(?:$|[^a-z0-9' ]|thanks|thank|sorry|i |i'm|im |not|can't|lo siento|gracias|me |puedo|quiero|voy|creo|por ahora|for now|this time|esta vez|today|tonight|hoy|mate|man|dude|lol|haha))", true),
];

const NEGATOR = /\b(?:not|never|no|don't|dont|doesn't|didn't|can't|cannot|won't|isn't|ain't|wouldn't|couldn't|shouldn't|nah|hardly|nunca|tampoco|ni)\b/;
/** Yes words that a negation turns into a hedge, not a refusal ("not sure", "not definitely"). */
const HEDGE_WHEN_NEGATED = /^(?:sure|certain|definitely|100%|positive|absolutely)$/;
/** Benign "if" clauses that do not condition the yes ("if that works for them"). */
const BENIGN_COND = /^(?:if (?:(?:that|it|this) works|so|possible|needed|you (?:want|like|need|can|think)|they (?:want|like|can)|(?:that's|it's|thats|its) (?:ok|okay|fine|cool|alright)|you'd like|you would like|everyone)|si (?:quieres|puedes|te parece))/;
const CONTRAST = /\b(?:but|though|tho|although|however|except|pero|aunque|excepto)\b/;

interface Signal { kind: Kind; at: number; end: number; strong: boolean; sentence: number; text: string; bare?: boolean; condTime?: boolean }

function mask(s: string, from: number, to: number) { return s.slice(0, from) + " ".repeat(to - from) + s.slice(to); }

function sentenceBounds(t: string): number[] {
  // Index where each sentence starts. "..." and other punctuation end a sentence.
  const starts = [0];
  const re = /[.!?;\n]+\s*|\s[-–—]\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) if (m.index + m[0].length < t.length) starts.push(m.index + m[0].length);
  return starts;
}

function extract(t: string): Signal[] {
  const starts = sentenceBounds(t);
  const sentenceOf = (i: number) => { let s = 0; for (let k = 0; k < starts.length; k++) if (starts[k]! <= i) s = k; return s; };
  let work = t;
  const out: Signal[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const found: { at: number; end: number; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(work))) {
      if (!m[0].trim()) { rule.re.lastIndex++; continue; }
      const lead = m[0].length - m[0].trimStart().length;
      found.push({ at: m.index + lead, end: m.index + m[0].length, text: m[0].trim() });
      if (m[0].length === 0) rule.re.lastIndex++;
    }
    for (const f of found) {
      work = mask(work, f.at, f.end);
      out.push({ kind: rule.kind, at: f.at, end: f.end, strong: !!rule.strong, sentence: sentenceOf(f.at), text: f.text });
    }
  }
  out.sort((a, b) => a.at - b.at);
  // Negation scope: a yes word with a negator up to three words earlier in the same clause.
  for (const s of out) {
    if (s.kind !== "yes" || s.strong) continue;
    const before = t.slice(starts[s.sentence]!, s.at);
    const clause = before.split(/[,;:]|\b(?:but|though|and|pero|y)\b/).pop() ?? "";
    const prev = clause.trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
    if (NEGATOR.test(prev)) {
      s.kind = HEDGE_WHEN_NEGATED.test(s.text) ? "unsure" : "no";
      s.strong = s.kind === "no";
    }
  }
  // Conditions: the clause after the condition word. Time conditions constrain a yes; others make it unsure.
  for (const s of out) {
    if (s.kind !== "cond") continue;
    const rest = t.slice(s.at).split(/[.!?;,\n]/)[0]!.trim();
    if (BENIGN_COND.test(rest)) { s.kind = "neutral"; continue; }
    s.text = rest;
    s.condTime = TIME_WORD.test(rest);
  }
  // A "no" sentence with nothing else in it (bare refusal) can reverse an earlier yes.
  for (const s of out) {
    if (s.kind !== "no") continue;
    const sentEnd = starts[s.sentence + 1] ?? t.length;
    const sentence = t.slice(starts[s.sentence]!, sentEnd).replace(/[^a-z' ]/g, " ").trim();
    s.bare = /^(?:(?:and|but|ok|okay|yeah|yes|sure|um+|uh+|hmm+|so|then|sorry|thanks|thank you|lol|haha)\s+)*(?:no|nope|nah|naw|no thanks|no thank you|no gracias)(?:\s+(?:thanks|thank you|sorry|lol|haha|gracias|man|dude))*$/.test(sentence);
  }
  return out;
}

/** Parse a free-text answer to a yes/no question. See the file header for the rules. */
export function parseReply(text: string): ParsedReply {
  const raw = text ?? "";
  const t = normalize(raw).trim();
  const constraints: ReplyConstraint[] = [];
  const done = (answer: ReplyAnswer, reason: string, o: { counter?: boolean; leaning?: "yes" | "no" } = {}): ParsedReply =>
    ({ answer, constraints, counter: !!o.counter, ...(o.leaning ? { leaning: o.leaning } : {}), reason });

  let sig = extract(t);
  // A reversal keeps only what follows it ("yes. actually no" → "no").
  const lastRev = sig.map(s => s.kind).lastIndexOf("reversal");
  if (lastRev >= 0 && sig.slice(lastRev + 1).some(s => s.kind === "yes" || s.kind === "no" || s.kind === "unsure")) sig = sig.slice(lastRev + 1);
  sig = sig.filter(s => s.kind !== "reversal" && s.kind !== "neutral");

  const decisive = sig.filter(s => s.kind === "yes" || s.kind === "no" || s.kind === "unsure" || s.kind === "timeNeg");
  const counter = sig.some(s => s.kind === "counter");
  const timeNegs = sig.filter(s => s.kind === "timeNeg");
  const conds = sig.filter(s => s.kind === "cond");

  if (!decisive.length) {
    if (counter) return done("unsure", "counter", { counter: true });
    if (conds.length) return done("unsure", "condition_only");
    // Emoji decide only when no word does, in a short reply (not an emoji at the end of a question).
    if ((t.match(/[a-z]+/g) ?? []).length > 3 || /\?/.test(t)) return done("unsure", /\?/.test(t) ? "question" : "no_signal");
    if (NO_EMOJI.test(raw)) return done("no", "emoji_no");
    if (UNSURE_EMOJI.test(raw)) return done("unsure", "emoji_unsure");
    if (YES_EMOJI.test(raw)) return done("yes", "emoji_yes");
    return done("unsure", /\?/.test(t) ? "question" : "no_signal");
  }

  const first = decisive[0]!;
  const after = (s: Signal) => s.at > first.at;

  if (first.kind === "no") {
    for (const s of timeNegs) constraints.push({ kind: "time", text: s.text });
    // "No. ... actually yes" is handled by the reversal rule; anything else after a refusal stays a refusal.
    return done("no", "refusal", { counter });
  }
  if (first.kind === "timeNeg") {
    for (const s of timeNegs) constraints.push({ kind: "time", text: s.text });
    // "Not Thursday, but Friday works" offers another time; "Not this week, thanks" is a no.
    const laterYes = sig.some(s => after(s) && s.kind === "yes");
    if (laterYes) return done("unsure", "time_refused_other_offered", { counter: true, leaning: "yes" });
    return done("no", "time_refusal", { counter });
  }
  if (first.kind === "unsure") {
    const leanYes = sig.some(s => s.kind === "yes"), leanNo = sig.some(s => s.kind === "no");
    if (counter) return done("unsure", "hedge_counter", { counter: true });
    return done("unsure", "hedge", leanYes && !leanNo ? { leaning: "yes" } : leanNo && !leanYes ? { leaning: "no" } : {});
  }

  // first.kind === "yes"
  const laterNo = sig.filter(s => after(s) && s.kind === "no");
  if (laterNo.length) {
    const sameSentence = laterNo.find(s => s.sentence === first.sentence && !CONTRAST.test(t.slice(first.end, s.at)));
    // "ok no", "yeah no", "sure... no": the last word is the answer.
    if (sameSentence && sig.filter(s => s.sentence === first.sentence && (s.kind === "yes" || s.kind === "no")).at(-1)!.kind === "no") return done("no", "yes_then_no");
    const last = laterNo.at(-1)!;
    if (last.bare && last.sentence !== first.sentence && !sig.some(s => s.kind === "yes" && s.at > last.at)) return done("no", "yes_then_bare_no");
    if (laterNo.some(s => s.strong)) return done("unsure", "yes_no_conflict");
  }
  for (const s of timeNegs) constraints.push({ kind: "time", text: s.text });
  for (const c of conds) constraints.push({ kind: c.condTime ? "time" : "condition", text: c.text });
  if (sig.some(s => after(s) && s.kind === "unsure")) return done("unsure", "yes_then_hedge", { leaning: "yes", counter });
  if (counter) return done("unsure", "yes_other_time", { counter: true, leaning: "yes" });
  if (conds.some(c => !c.condTime)) return done("unsure", "conditional_yes", { leaning: "yes" });
  return done("yes", constraints.length ? "yes_with_time_constraint" : "yes");
}

/** "yes" | "no" | "unsure" for a free-text answer to a yes/no question (see `parseReply`). */
export function classifyYesNo(text: string): ReplyAnswer {
  return parseReply(text).answer;
}

// ------------------------------------------------------------------------------------ opt-out

export interface OptOutReading {
  /** "exact": a carrier keyword alone (STOP, UNSUBSCRIBE, PARAR...). "likely": a free-text opt-out. */
  match: "exact" | "likely" | "none";
  /** Opt out of everything, or of one app only ("leave slop"). */
  scope: "all" | "app";
  lang: "en" | "es";
}

const EXACT_EN = /^(?:stop|stopall|stop all|unsubscribe|cancel|end|quit|optout|opt out|opt-out|revoke)$/;
const EXACT_ES = /^(?:para|parar|alto|baja|cancelar|detener|basta|no mas)$/;
const LIKELY_EN = /\b(?:stop (?:texting|messaging|sending|contacting|writing|bothering)|don't (?:text|message|contact|send me)|do not (?:text|message|contact|send)|no more (?:texts|messages|msgs)|take me off|remove me|unsubscribe me|leave me alone|opt (?:me )?out|i want out|delete my (?:number|account)|lose my number|wrong number|stop (?:it|this|pls|please)|please stop|pls stop|stop already)\b/;
const LIKELY_ES = /\b(?:no me (?:escribas|mandes|envies|contactes|mensajees)|deja de (?:escribirme|mandarme|enviarme|mensajearme)|dejen de (?:escribirme|mandarme|enviarme)|no (?:mas|quiero) mensajes|ya no (?:quiero|me) (?:mensajes|escriban|manden)|darme de baja|dame de baja|me quiero dar de baja|quitame de|borrame de|sacame de|numero equivocado)\b/;

/**
 * Does `text` ask us to stop messaging? Exact keywords as the whole message are "exact"; free-text
 * requests ("please stop texting me", "no me escribas más") are "likely". Quoted or reported speech
 * ("my friend said stop") and questions about stopping ("how do I stop?") are "none".
 */
export function parseOptOut(text: string, o: { apps?: readonly string[] } = {}): OptOutReading {
  const t = normalize(text ?? "").replace(/[^a-z0-9.' -]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim();
  const lang: "en" | "es" = LIKELY_ES.test(t) || EXACT_ES.test(t) ? "es" : "en";
  if (EXACT_EN.test(t) || EXACT_ES.test(t)) return { match: "exact", scope: "all", lang };
  // Reported speech and how-to questions do not opt out.
  if (/\b(?:said|says|told|asked) (?:me )?(?:to )?["']?stop\b/.test(t) || /\bhow (?:do|can) i (?:stop|unsubscribe|opt out)\b/.test(t)) return { match: "none", scope: "all", lang };
  // "don't stop", "can't stop laughing", "stop by later", "stop it, I love this": not opt-outs.
  if (/\b(?:don't|dont|do not|never|won't|wont|can't|cant|cannot|not)\s+stop\b/.test(t) || /\bstop (?:by|at|in|over|for|on by)\b/.test(t)
    || /^stop (?:it|this)\b.*\b(?:love|lol|haha|lmao|omg|amazing|cute|funny|so good|too good)\b/.test(t)) return { match: "none", scope: "all", lang };
  // "leave slop" / "stop slop": one app only (when the caller names its apps).
  const app = t.match(/^(?:leave|stop|quit|salir de|dejar) ([a-z0-9.]+)$/)?.[1];
  if (app && o.apps?.some(a => a.toLowerCase() === app || a.toLowerCase().split(".")[0] === app.split(".")[0])) return { match: "likely", scope: "app", lang };
  if (LIKELY_EN.test(t) || LIKELY_ES.test(t)) return { match: "likely", scope: "all", lang };
  if ((/^(?:stop|unsubscribe|para|basta)\b/.test(t) || /\b(?:stop|unsubscribe)$/.test(t)) && !/\?\s*$/.test(text.trim())) return { match: "likely", scope: "all", lang };
  return { match: "none", scope: "all", lang };
}

// ------------------------------------------------------------------------------------ carrier keywords

/**
 * The one STOP / HELP / START keyword table (CTIA conventions). Every consumer reads it: the platform
 * consent ledger (platform/src/consent.ts detectKeyword, which adds the polite and Spanish stops and
 * the free-text reading below) and the simulated channel (sim/src/channel.ts). "YES" is deliberately
 * not an opt-in keyword: members answer "yes" to opportunities all the time.
 */
export const KEYWORDS = {
  stopAll: ["STOP ALL", "STOPALL"],
  stop: ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT"],
  /** "STOP PLEASE", "PLEASE STOP": a stop with a courtesy word (the platform ledger). */
  stopPolite: ["STOP PLEASE", "PLEASE STOP"],
  /** Spanish whole-message opt-outs, accents folded. */
  stopEs: ["PARA", "PARAR", "ALTO", "BASTA", "BAJA", "CANCELAR", "DETENER", "NO MAS", "NO MAS MENSAJES"],
  start: ["START", "UNSTOP", "SUBSCRIBE", "RESUME"],
  help: ["HELP", "INFO"],
} as const;

/** The carrier compliance copy for STOP and HELP on the Network's line. */
export const STOP_CONFIRMATION = "You're unsubscribed from The Network and won't get more messages here. Reply START to resume.";
export const HELP_TEXT = "The Network: an invite-only AI that connects you with people. Reply STOP to opt out. Msg&data rates may apply.";

/** NFKC, no zero-width characters, no accents, straight apostrophes. */
export const foldKeywordText = (text: string) =>
  text.normalize("NFKC").replace(/[​-‍﻿]/g, "").normalize("NFD").replace(/\p{M}+/gu, "").replace(/[‘’ʼ]/g, "'");

/** A whole message as a keyword key: folded, punctuation and emoji dropped, spaces collapsed, upper case ("Stop." -> "STOP"). */
export const keywordKey = (text: string) => foldKeywordText(text).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().toUpperCase();

// Reasonable means (TCPA): a person may opt out in their own words, in English or Spanish. A short
// message that clearly asks the sender to stop texting is a STOP. A sentence about something else
// ("cancel the date", "can you stop by at 7", "don't stop texting me") is not. This is the strict
// reading the consent ledger acts on; `parseOptOut` above is the conversational reading (it also
// reports "likely" for looser phrasings the agent should confirm).
const ME = "(?:me|us|this number|my number)";
const MSGS = "(?:texts?|texting|messages?|messaging|msgs?|sms|notifications?|spam)";
const OPT_OUT_EN: RegExp[] = [
  new RegExp(`\\b(?:stop|quit|cease) (?:texting|messaging|contacting|sending|bothering|spamming|writing to|emailing|calling) ${ME}\\b`),
  new RegExp(`\\bstop (?:sending (?:me |us |these |the |your |all )?|the |these |your |all |all the |all these |all of these )${MSGS}\\b`),
  new RegExp(`\\b(?:stop|no more|enough) ${MSGS}\\b`),
  /\bunsubscribe\b/,
  /\bopt (?:me )?out\b/,
  new RegExp(`\\b(?:remove|take) ${ME} (?:off|from) (?:your|this|the|all|every|ur) (?:list|lists|texts?|messages|contacts)\\b`),
  /\b(?:remove|delete|lose) my (?:number|phone number|info|contact)\b/,
  new RegExp(`\\b(?:don't|do not|dont|pls don't|please don't|never) (?:text|message|contact|msg|sms|write to|email) ${ME}\\b`),
  new RegExp(`\\bi (?:don't|do not|dont) want (?:these|your|any|any more|anymore|more|the) ${MSGS}\\b`),
  /\bleave me alone\b/,
  /\bwrong number\b/,
  // "remove me", "take me off", "take me off the list" on their own.
  /^(?:please |pls )?(?:remove|take) me(?: off| out)?(?: (?:the|your|this) list)?(?: please| pls)?$/,
];
const OPT_OUT_ES: RegExp[] = [
  /\b(?:deja|dejen|deje) de (?:enviarme|mandarme|escribirme|textearme|contactarme)\b/,
  /\bno (?:me )?(?:envies|envien|mandes|manden|escribas|escriban|contactes) mas\b/,
  /\bno (?:me )?(?:envies|envien|mandes|manden) (?:mas )?mensajes\b/,
  /\bno quiero (?:recibir )?(?:mas )?mensajes\b/,
  /\b(?:darme|dame|dar|denme) de baja\b/,
  /\b(?:eliminame|borrame|sacame|quitame|eliminen mi numero|borren mi numero)\b/,
  /\bya no me (?:escribas|escriban|envies|mandes)\b/,
  /\bno mas mensajes\b/,
  /\bnumero equivocado\b/,
];
const NOT_OPT_OUT = /\b(?:don't|do not|dont|never|please don't) (?:stop|unsubscribe|remove|opt)\b|\bstop by\b|\bcan'?t stop\b|\bstop (?:at|on) \d/;

/**
 * True when a short message asks, in the person's own words, to stop getting texts. `isLeave`: a
 * caller's per-app leave reading ("unsubscribe from peon", "stop slop"), which is a leave of that app
 * only, never a stop of everything.
 */
export function optOutPhrase(text: string, isLeave: (text: string) => boolean = () => false): boolean {
  const t = foldKeywordText(text).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 160 || NOT_OPT_OUT.test(t)) return false;
  if (isLeave(text)) return false;
  return OPT_OUT_EN.some(r => r.test(t)) || OPT_OUT_ES.some(r => r.test(t));
}
