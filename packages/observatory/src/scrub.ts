// PII scrubbing for real-world mode (PRD 35.1: PII-scrubbed views by default, explicit reveal).
// Names become "First L.", phone numbers and emails in free text are masked, and agent-private or
// sensitive facets are withheld. OBSERVATORY_REVEAL_PII=1 turns scrubbing off (local use only).
import type { Facet } from "@thenetwork/core";

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const CANARY_REF = /\(ref [^)]+\)/g;

export function displayName(name: string, reveal: boolean): string {
  if (reveal) return name;
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first ?? name;
}

export function scrubText(text: string, reveal: boolean): string {
  if (reveal) return text;
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(CANARY_REF, "(ref [private])");
}

export function scrubFacet(f: Facet, reveal: boolean): Facet {
  if (reveal) return f;
  if (f.scope === "agent_private" || f.sensitive) return { ...f, value: "[private · agent only]", tags: [] };
  return { ...f, value: scrubText(f.value, false) };
}
