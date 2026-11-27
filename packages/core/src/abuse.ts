import { orElseIsThreat } from "./generated/trustLevel.ts";

const APOS = "['’ʼ]";
const OR_ELSE = String.raw`(?<!(?:^|\s)["“][^"”\n]{0,80})\bor\s+else\b`;
const TERMINAL_TAIL = String.raw`(?:[\s.!?…,;:)]*$|[ \t]*(?:\.(?!\.)|[!?])+[ \t]+|[ \t]*[\r\n]+)`;
const SUBJECT_CONSEQUENCE = String.raw`(?:you|u)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?re|\s+are)?\s+(?:going\s+to|gonna))\s+(?:regret|be\s+sorry(?!\s+(?:you|u|i|we|he|she|they)\b)|pay\s+for)\b`;
const ACTOR_FUTURE = String.raw`(?:i(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?m|\s+am)\s+(?:going\s+to|gonna)|\s+gonna)|(?:we|they)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?re|\s+are)\s+(?:going\s+to|gonna)|\s+gonna)|(?:he|she)(?:${APOS}?ll|\s+will|\s+would|(?:${APOS}?s|\s+is)\s+(?:going\s+to|gonna)|\s+gonna))`;
const ACTOR_HARM = String.raw`(?:make\s+(?:you|u|him|her|them)\s+(?:sorry|regret|pay)\b|(?:come\s+)?show\s+up\s+(?:at|outside)\s+(?:your|ur|their|her|his)\s+(?:home|house|place|apartment|apt|building|work|office|job|door)\b|(?:hurt|ruin|doxx?)\s+(?:you|u|him|her|them)\b)`;
const HARMFUL_TAIL = String.raw`\s+(?:\b${SUBJECT_CONSEQUENCE}|\b${ACTOR_FUTURE}\s+${ACTOR_HARM})`;

/** Terminal intimidation or a stated harmful consequence after “or else”. */
export const OR_ELSE_THREAT = OR_ELSE + "(?=" + TERMINAL_TAIL + "|" + HARMFUL_TAIL + ")";
const orElsePhrase = new RegExp(OR_ELSE, "gi");
const terminalTail = new RegExp("^" + TERMINAL_TAIL);
const harmfulTail = new RegExp("^" + HARMFUL_TAIL, "i");

// spec/trustLevel.md, "A choice of alternatives does not supply a threat signal"
export function hasOrElseThreat(text: string): boolean {
  for (const phrase of text.matchAll(orElsePhrase)) {
    const tail = text.slice(phrase.index + phrase[0].length);
    if (orElseIsThreat(terminalTail.test(tail), harmfulTail.test(tail))) return true;
  }
  return false;
}
