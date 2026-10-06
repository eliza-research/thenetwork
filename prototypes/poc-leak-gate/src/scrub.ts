// SEC-001 fix: raw contact details and addresses never reach the LLM prompt. The deterministic layer
// matches them against the registry; the classifier only needs to know that such a detail exists
// and is hidden, so values are replaced with typed placeholders.
import type { GateFacet } from "./types.ts";

export const PLACEHOLDERS = ["[PHONE]", "[EMAIL]", "[STREET_ADDRESS]", "[STREET]", "[UNIT]", "[COORDINATES]", "[REF_CODE]"] as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +1-917-555-0133, (917) 555 0133, 917.555.0133, 9175550133
const PHONE = /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// Decimal lat/long pairs: 37.7599, -122.4148 (4+ decimals = precise to ~10 m).
const COORDS = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;
const SUFFIX = "St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Pl|Place|Ct|Court|Ter|Terrace|Way";
const HOUSE = new RegExp(`\\b\\d{1,5}\\s+(?:[A-Z][a-z]+\\s){1,2}(?:${SUFFIX})\\b\\.?`, "g");
const STREET = new RegExp(`\\b(?:[A-Z][a-z]+\\s){1,2}(?:${SUFFIX})\\b\\.?`, "g");
const UNIT = /\b(?:apt|apartment|unit|suite)\.?\s*#?\s*\d+[A-Za-z]?\b/gi;
const REF = /\s*\(ref [^)]*\)|\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/g;

/** Replace contact details, street addresses, units, coordinates and reference codes in free text. */
export function scrubText(s: string): string {
  return s
    .replace(REF, m => (m.trim().startsWith("(") ? "" : "[REF_CODE]"))
    .replace(EMAIL, "[EMAIL]")
    .replace(COORDS, "[COORDINATES]")
    .replace(PHONE, "[PHONE]")
    .replace(HOUSE, "[STREET_ADDRESS]")
    .replace(STREET, "[STREET]")
    .replace(UNIT, "[UNIT]")
    .replace(/\[STREET_ADDRESS\],?\s*\[UNIT\]/g, "[STREET_ADDRESS]");
}

/** A facet value as the LLM may see it. Contact kinds collapse to a single placeholder. */
export function scrubFacet(f: Pick<GateFacet, "kind" | "value">): string {
  if (f.kind === "phone") return "phone number: [PHONE]";
  if (f.kind === "email") return "email: [EMAIL]";
  if (f.kind === "canary") return "internal reference code: [REF_CODE]";
  if (f.kind === "address") return "home address: [STREET_ADDRESS]";
  return scrubText(f.value);
}

/** True when text still contains something that looks like a raw contact detail or address. */
export function hasRawContact(s: string): boolean {
  const t = s.replace(/\[[A-Z_]+\]/g, "");
  return [EMAIL, PHONE, COORDS, HOUSE, STREET, UNIT, /\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/g].some(re => { re.lastIndex = 0; return re.test(t); });
}
