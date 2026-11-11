// One place to normalize recipient addresses (audit P1-11). Every key the queue, consent ledger, caps and
// line-safety maps use goes through `normalizeAddress`, so "+1 (555) 123-4567", "15551234567" and
// "+15551234567" are the same person.
//
// Rules:
//  - Phone numbers become E.164. A bare 10-digit number is treated as NANP (+1), as is 11 digits starting with 1.
//  - Apple ID emails are trimmed and lowercased.
//  - `chat:<id>` group/chat targets are kept verbatim (ids are case-sensitive).
//  - Anything else is trimmed and lowercased so it still compares consistently.

import { anyE164 } from "../../core/src/phone-core.ts";

export { isE164 } from "../../core/src/phone-core.ts";

/** E.164 form of a phone number, or null if `raw` is not a plausible phone number. The rule is anyE164 in core/src/phone-core.ts (proved). */
export function toE164(raw: string): string | null {
  return anyE164(raw.normalize("NFKC"));
}

/** Canonical key for any recipient address (phone, email, or chat:<id>). */
export function normalizeAddress(raw: string): string {
  const s = raw.normalize("NFKC").trim();
  if (/^chat:/i.test(s)) return `chat:${s.slice(5).trim()}`;
  if (s.includes("@")) return s.toLowerCase();
  const e164 = toE164(s);
  if (e164) return e164;
  // Not a valid E.164 number (e.g. a short test number): still strip formatting so variants compare equal.
  if (/^[\d\s+().\-]+$/.test(s)) {
    const digits = s.replace(/\D/g, "");
    return digits ? `+${digits}` : s;
  }
  return s.toLowerCase();
}
