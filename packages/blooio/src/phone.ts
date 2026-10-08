// One place to normalize recipient addresses (audit P1-11). Every key the queue, consent ledger, caps and
// line-safety maps use goes through `normalizeAddress`, so "+1 (555) 123-4567", "15551234567" and
// "+15551234567" are the same person.
//
// Rules:
//  - Phone numbers become E.164. A bare 10-digit number is treated as NANP (+1), as is 11 digits starting with 1.
//  - Apple ID emails are trimmed and lowercased.
//  - `chat:<id>` group/chat targets are kept verbatim (ids are case-sensitive).
//  - Anything else is trimmed and lowercased so it still compares consistently.

const E164 = /^\+[1-9]\d{7,14}$/;

/** E.164 form of a phone number, or null if `raw` is not a plausible phone number. */
export function toE164(raw: string): string | null {
  const s = raw.normalize("NFKC").trim();
  if (!s || s.includes("@") || /^chat:/i.test(s)) return null;
  if (/[^\d\s+().\-]/.test(s)) return null; // letters or other symbols: not a phone number
  const plus = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);
  if (!digits) return null;
  let out: string;
  if (plus) out = `+${digits}`;
  else if (digits.length === 10) out = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) out = `+${digits}`;
  else out = `+${digits}`;
  return E164.test(out) ? out : null;
}

export function isE164(s: string): boolean {
  return E164.test(s);
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
