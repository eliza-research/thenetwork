// PII masking before any third-party model call (PRD 32.14). A member's text goes to the LLM reader
// (packages/network extract.ts) with phone numbers, emails, street addresses, links, handles and any
// run of 6 or more digits replaced by a label. A 5-digit zip stays: slop.date reads distance from it.
// The masks are the leak guard's contact patterns (guard.ts CONTACT_PATTERNS), the same ones the
// observatory's console scrubber starts from (packages/observatory/src/scrub.ts, which adds its own).
import { CONTACT_PATTERNS, contactVariants, findLeaks } from "./guard.ts";

const LABEL: Record<string, string> = { email_spelled: "email", street_address: "address", url: "link" };
const MASKS = CONTACT_PATTERNS.map(({ name, re }) => ({ re: new RegExp(re.source, "gi"), label: `[${LABEL[name] ?? name}]` }));
/** Six or more digits in a row (account, card and order numbers); a 5-digit zip is not touched. */
const LONG_DIGITS = /\d{6,}/g;
/** What the model gets when a contact detail survives every mask: no member text at all. */
export const PII_WITHHELD = "[message withheld: contact details]";

function maskOnce(text: string): string {
  let t = text;
  for (const m of MASKS) t = t.replace(m.re, x => (/^[\s(]/.test(x) ? x[0] + m.label : m.label));
  return t.replace(LONG_DIGITS, "[number]");
}

const hasContact = (text: string) => findLeaks(text).some(r => r.startsWith("contact:"));

/** The text with contact details and long digit runs replaced by "[phone]", "[email]", "[address]", "[link]", "[handle]", "[number]". */
export function maskPii(text: string): string {
  const t = maskOnce(text ?? "");
  if (!hasContact(t)) return t;
  // A contact in disguise that the leak guard still reads ("two one two five five five ...",
  // "２１２５５５０１０２", "sam @ example . com"): mask the guard's own normalized form of the text.
  for (const v of contactVariants(t)) {
    const m = maskOnce(v);
    if (!hasContact(m)) return m;
  }
  return PII_WITHHELD;
}
