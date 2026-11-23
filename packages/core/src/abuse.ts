import { orElseIsThreat } from "./generated/trustLevel.ts";

const OR_ELSE = String.raw`\bor else\b`;
const TERMINAL_TAIL = String.raw`\s*[.!?…,;:)]*\s*$`;
const HARMFUL_TAIL = String.raw`\s+(?:\b(?:you|u)(?:'ll| will| would)\s+(?:regret|be sorry|pay for)\b`
  + String.raw`|\b(?:i|we|he|she|they)(?:'ll| will| would|'m gonna| am going to)\s+`
  + String.raw`(?:make (?:you|them) (?:sorry|regret|pay)|show up (?:at|outside) (?:your|their|her|his) (?:home|place|work|office|door))\b)`;

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
