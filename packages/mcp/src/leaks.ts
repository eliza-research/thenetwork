// The output leak gate for model-visible tool content (ported from the retired
// prototypes/connector-mcp output pipeline, design section 5.1). Text that reaches an assistant must
// carry no phone number or email, no internal identifier and no machine timestamp, and none of the
// strings the caller names as private. The folding and fuzzy matching are the shared core guard's.
// Applied to the text an assistant reads that did not come from this package's own copy: the update
// summaries from the single inbox. A summary that fails is withheld, never shown in part.
import { findContactKinds, LeakGuard, plainVariants } from "../../core/src/guard.ts";

const PHONE_OR_EMAIL = new Set(["phone", "email", "email_spelled"]);
/** Internal identifiers (member, opportunity, activity, recipient, grant, proposal, decision ids). */
export const INTERNAL_ID = /\b(mem|opp|act|rcp|grt|prp|dcr)_[a-z0-9]+/i;
/** An ISO timestamp in prose ("2026-10-08T19:30"): machine data, never model-visible text. */
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i;

/**
 * The violations in `text` (empty = clean). `forbidden` are exact strings (ids, names, contact values),
 * `facts` private facts matched fuzzily. `contacts` also runs the full core contact patterns
 * (handles, addresses, links), for text that must carry no contact details at all, such as the
 * member context sent to the assistant. Labels never contain the matched value.
 */
export function outputLeaks(text: string, o: { forbidden?: string[]; facts?: string[]; contacts?: boolean } = {}): string[] {
  const v = new LeakGuard({ exact: (o.forbidden ?? []).filter(Boolean), facts: (o.facts ?? []).filter(Boolean), contacts: o.contacts ?? false }).check(text);
  if (v[0] === "too_long") return v;
  const contacts = findContactKinds(text, { kinds: PHONE_OR_EMAIL, phoneExemptions: false });
  if (contacts.includes("phone")) v.push("phone_pattern");
  if (contacts.includes("email") || contacts.includes("email_spelled")) v.push("email_pattern");
  const variants = plainVariants(text);
  if (variants.some(t => INTERNAL_ID.test(t))) v.push("internal_id");
  if (variants.some(t => ISO_TIMESTAMP.test(t))) v.push("iso_timestamp");
  return v;
}
