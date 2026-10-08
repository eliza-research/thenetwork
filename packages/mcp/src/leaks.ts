// The output leak gate for model-visible tool content (ported from the retired
// prototypes/connector-mcp output pipeline, design section 5.1). Text that reaches an assistant must
// carry no phone number or email, no internal identifier and no machine timestamp, and none of the
// strings the caller names as private. The folding and fuzzy matching are the shared core guard's.
// Applied to the text an assistant reads that did not come from this package's own copy: the update
// summaries from the single inbox. A summary that fails is withheld, never shown in part.
import { LeakGuard, plainVariants } from "../../core/src/guard.ts";

// Digits separated by up to three spaces, dots, dashes or brackets: "(415) 555-0102", "+1 415 555 0102".
const PHONE = /(?:\+?\d[\s().\-\/]{0,3}){9,14}\d/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// "maya [at] example [dot] test", "maya at example dot test".
const EMAIL_SPELLED = /\b[a-z0-9._%+-]{1,64}[\s([{]{1,3}at[\s)\]}]{1,3}[a-z0-9-]{1,63}[\s([{]{1,3}dot[\s)\]}]{1,3}[a-z]{2,10}\b/i;
/** Internal identifiers (member, opportunity, activity, recipient, grant, proposal, decision ids). */
export const INTERNAL_ID = /\b(mem|opp|act|rcp|grt|prp|dcr)_[a-z0-9]+/i;
/** An ISO timestamp in prose ("2026-10-08T19:30"): machine data, never model-visible text. */
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i;

/**
 * The violations in `text` (empty = clean). `forbidden` are exact strings (ids, names, contact values),
 * `facts` private facts matched fuzzily. Labels never contain the matched value.
 */
export function outputLeaks(text: string, o: { forbidden?: string[]; facts?: string[] } = {}): string[] {
  const v = new LeakGuard({ exact: (o.forbidden ?? []).filter(Boolean), facts: (o.facts ?? []).filter(Boolean), contacts: false }).check(text);
  // Narrower than the core contact patterns: our own copy carries links and venue names.
  const variants = plainVariants(text);
  if (variants.some(t => PHONE.test(t))) v.push("phone_pattern");
  if (variants.some(t => EMAIL.test(t) || EMAIL_SPELLED.test(t))) v.push("email_pattern");
  if (variants.some(t => INTERNAL_ID.test(t))) v.push("internal_id");
  if (variants.some(t => ISO_TIMESTAMP.test(t))) v.push("iso_timestamp");
  return v;
}
