import { orElseIsThreat } from "./generated/trustLevel.ts";

const APOS = "['’ʼ]";
const QUOTED_SPAN = /"[^"\n]*"|“[^”\n]*”/g;
const IN_BALANCED_QUOTE = String.raw`(?!(?<=(?:^|\s)"[^"\n]{0,80})[^"\n]{0,80}")(?!(?<=(?:^|\s)“[^”\n]{0,80})[^”\n]{0,80}”)`;
const OR_ELSE = String.raw`${IN_BALANCED_QUOTE}\bor\s+else\b`;
const END_TERMINAL_TAIL = String.raw`[\s.!?…,;:)]*$`;
const COERCIVE_LEAD = String.raw`(?:^|[.!?;:\r\n])[^.!?;:\r\n]{0,80}\b(?:answer|reply|respond|(?:text|call|message|dm|email)(?:\s+(?:me|us|him|her|them))?\s+(?:back|right\s+now|now)|pick\s+up|don${APOS}?t\s+ignore|do\s+not\s+ignore|stop\s+ignoring|listen\s+to\s+me|obey|pay\s+(?:me|up)|return\s+my|delete\s+(?:it|that|the)|unblock\s+me|shut\s+up|back\s+off|stay\s+away|leave\s+\w+\s+alone|do\s+(?:it|this|that|what)|(?:you(?:${APOS}?d|\s+had)?|u)\s+better|tell\s+(?:me|us|him|her|them)\s+(?:the\s+truth|right\s+now|now|to\s+(?:answer|reply|respond|call|text)))\b[^.!?;:\r\n]{0,40}`;
const MID_TERMINAL_TAIL = String.raw`(?:[ \t]*(?:\.(?!\.)|[!?])+[ \t]+|[ \t]*[\r\n]+)`;
const SUBJECT_CONSEQUENCE = String.raw`(?:you|u)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?re|\s+are)?\s+(?:going\s+to|gonna))\s+(?:regret|be\s+sorry(?!\s+(?:you|u|i|we|he|she|they)\b)|pay\s+for)\b`;
const ACTOR_FUTURE = String.raw`(?:i(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?m|\s+am)\s+(?:going\s+to|gonna)|\s+gonna)|(?:we|they)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?re|\s+are)\s+(?:going\s+to|gonna)|\s+gonna)|(?:he|she)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?s|\s+is)\s+(?:going\s+to|gonna)|\s+gonna))`;
const ACTOR_HARM = String.raw`(?:make\s+(?:you|u|him|her|them)\s+(?:sorry|regret|pay)\b|(?:come\s+)?show\s+up\s+(?:at|outside)\s+(?:your|ur|their|her|his)\s+(?:home|house|place|apartment|apt|building|work|office|job|door)\b|(?:hurt|ruin|doxx?)\s+(?:you|u|him|her|them)\b)`;
const HARMFUL_TAIL = String.raw`\s+(?:\b${SUBJECT_CONSEQUENCE}|\b${ACTOR_FUTURE}\s+${ACTOR_HARM})`;

export const OR_ELSE_THREAT = OR_ELSE + "(?:"
  + "(?=" + END_TERMINAL_TAIL + "|" + HARMFUL_TAIL + ")"
  + "|(?<=" + COERCIVE_LEAD + "\\bor\\s+else\\b)(?=" + MID_TERMINAL_TAIL + ")"
  + ")";
const orElsePhrase = /\bor\s+else\b/gi;
const endTerminalTail = new RegExp("^" + END_TERMINAL_TAIL);
const midTerminalTail = new RegExp("^" + MID_TERMINAL_TAIL);
const coerciveLead = new RegExp(COERCIVE_LEAD + "$", "i");
const harmfulTail = new RegExp("^" + HARMFUL_TAIL, "i");

export function hasOrElseThreat(text: string, range?: { start: number; end: number }): boolean {
  const unquoted = text.replace(QUOTED_SPAN, m => " ".repeat(m.length));
  for (const phrase of unquoted.matchAll(orElsePhrase)) {
    if (range && (phrase.index < range.start || phrase.index >= range.end)) continue;
    const lead = unquoted.slice(0, phrase.index);
    const tail = unquoted.slice(phrase.index + phrase[0].length);
    const terminal = endTerminalTail.test(tail) || (midTerminalTail.test(tail) && coerciveLead.test(lead));
    if (orElseIsThreat(terminal, harmfulTail.test(tail))) return true;
  }
  return false;
}
