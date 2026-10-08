// PII scrubbing for real-world mode (PRD 35.1: PII-scrubbed views by default, explicit reveal).
// Names become "First L.", contact details in free text (the leak guard's patterns: phones, emails,
// street addresses, links, handles) are masked, and agent-private or
// sensitive facets are withheld. OBSERVATORY_REVEAL_PII=1 turns scrubbing off (local use only).
import { CONTACT_PATTERNS, type Facet } from "@thenetwork/core";

const MASK_LABEL: Record<string, string> = { email_spelled: "email", street_address: "address", url: "link" };

/** The leak guard's contact patterns (core guard.ts), made global and case-blind for masking. */
const MASKS = CONTACT_PATTERNS.map(({ name, re }) => ({ re: new RegExp(re.source, "gi"), label: `[${MASK_LABEL[name] ?? name}]` }));
const CANARY_REF = /\(ref [^)]+\)/g;

export function displayName(name: string, reveal: boolean): string {
  if (reveal) return name;
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first ?? name;
}

export function scrubText(text: string, reveal: boolean): string {
  if (reveal) return text;
  // Canary refs first: their ids can look like handles or phone numbers.
  return MASKS.reduce((t, m) => t.replace(m.re, x => (/^[\s(]/.test(x) ? x[0] + m.label : m.label)), text.replace(CANARY_REF, "(ref [private])"));
}

export function scrubFacet(f: Facet, reveal: boolean): Facet {
  if (reveal) return f;
  if (f.scope === "agent_private" || f.sensitive) return { ...f, value: "[private · agent only]", tags: [] };
  return { ...f, value: scrubText(f.value, false) };
}
