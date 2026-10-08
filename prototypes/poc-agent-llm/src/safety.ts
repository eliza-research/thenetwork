// Deterministic safety-signal check. Runs on EVERY inbound message, independent of the action the model picks.
// If the member's own words (quoted third-party text excluded) contain safety language AND refer to a person, the turn
// gets a safety follow-up: a safety-review hold for strong signals, a follow-up question for milder ones.
// Recall over precision: a false positive costs one gentle question; a miss can cost a member's safety.
import type { CtxV2, HistoryEntry } from "./contexts.ts";
import { DEFAULT_HISTORY } from "./contexts.ts";

// Strong: physical / threatening / harassment / explicit fear. Opens a safety_review_hold.
const STRONG = [
  /\bunsafe\b/, /\bnot safe\b/, /\bharass\w*/, /\bstalk\w*/, /\bthreat\w*/, /\bscared\b/, /\bafraid\b/, /\bfollow(ed|ing) me\b/,
  /\b(touch|grabb?)(ed|ing|es|s)? (me|my)\b/, /\bput (his|her|their) hands?\b/, /\bassault\w*/, /\bwouldn'?t (stop|leave)\b/, /\bdidn'?t stop\b/, /\bafter i said no\b/, /\bwhen i said (no|stop)\b/,
  /\bsaid no (twice|again|multiple|\d)/, /\bfound my (insta\w*|ig|address|number|linkedin|facebook)\b/, /\boutside (of )?(this|the app|the network)\b/,
  /\bblock\w*\b/, /\breport\w*\b/,
];
// Mild: discomfort / bad vibe. Opens a follow-up question (still recorded for the safety queue's trend view).
const MILD = [
  /\bfelt (really |kinda |kind of |super |a (little|bit) |so )?(off|weird|wrong|sketchy|gross)\b/, /\b(vibe|vibes) (was|were) off\b/, /\boff vibes?\b/,
  /\buncomf\w*/, /\bun ?comfortable\b/, /\bcreep\w*/, /\bpushy\b/, /\bkept push\w*/, /\bpushing\b/, /\binapp?ropr?iate\w*/, /\bsketch\w*/,
  /\bweird(ed)? me out\b/, /\bmade me feel\b/, /\bcrossed a line\b/, /\btoo (personal|much)\b/, /\bkept (texting|messaging|asking|calling)\b/,
  /\bnever (match|pair|connect) me\b/, /\bdon'?t (match|pair|connect) me\b/, /\bnot (match|pair) me\b/, /\bred flag\w*/,
];
const PERSON_WORDS = /\b(he|him|his|she|her|they|them|this (guy|girl|person|dude|man|woman)|that (guy|girl|person|dude|man|woman)|the (guy|girl|person|dude|man|woman)|someone|somebody|my match)\b/;

export interface SafetySignal {
  fired: boolean; strength: "strong" | "mild" | null; phrases: string[];
  person: HistoryEntry | null; personRef: string | null; question?: string;
}

// A signal right after a negation ("it wasn't bad or anything unsafe", "nothing creepy") does not count.
const NEGATED = /\b(not|no|never|nothing|wasn'?t|isn'?t|weren'?t|didn'?t|don'?t|wouldn'?t)\b[^.!?;]{0,25}$/;
function hits(t: string, rs: RegExp[]): string[] {
  const out: string[] = [];
  for (const r of rs) for (const m of t.matchAll(new RegExp(r.source, "g"))) {
    if (NEGATED.test(t.slice(Math.max(0, m.index! - 40), m.index!))) continue;
    out.push(m[0]); break;
  }
  return out;
}
const strip = (t: string) => t.replace(/"([^"]{3,})"|“([^”]{3,})”/g, " ").split("\n").filter(l => !l.trim().startsWith(">")).join("\n");
const toks = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function safetySignal(memberText: string, ctx: Pick<CtxV2, "history">): SafetySignal {
  const t = strip(memberText).toLowerCase().normalize("NFKC").replace(/[‘’]/g, "'");
  const strong = hits(t, STRONG);
  const mild = hits(t, MILD);
  const history = ctx.history ?? DEFAULT_HISTORY;
  const words = new Set(toks(t));
  const named = history.filter(e => words.has(toks(e.name)[0]));
  const pron = t.match(PERSON_WORDS)?.[0] ?? null;
  const personRef = named[0]?.name ?? pron;
  const fired = (strong.length > 0 || mild.length > 0) && personRef !== null;
  if (!fired) return { fired: false, strength: null, phrases: [...strong, ...mild], person: null, personRef };
  const person = new Set(named.map(n => n.member_id)).size === 1 ? named[0] : null;
  const who = person ? person.name : "them";
  const strength = strong.length ? "strong" : "mild";
  const question = strength === "strong"
    ? `I'm really sorry. I've flagged this for our safety team. Do you want me to block ${who} right away? You're safe to tell me more.`
    : `That doesn't sound great. Did ${who} make you uncomfortable? If so I can make sure you're never matched again, or flag it to our safety team.`;
  return { fired, strength, phrases: [...strong, ...mild], person, personRef, question };
}
