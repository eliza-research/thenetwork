// Phone numbers: E.164, +1 (US and Canada) only (platform plan 3.2: fights SMS pumping).
import { createHmac, timingSafeEqual } from "node:crypto";

/** E.164 for a +1 number, or undefined. Accepts "(212) 555-0101", "212-555-0101", "+1 212 555 0101", "12125550101". */
export function normalizePhone(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 40) return undefined;
  if (/[^0-9+().\-\s]/.test(input)) return undefined;
  const plus = input.trim().startsWith("+");
  let d = input.replace(/\D/g, "");
  if (plus && !d.startsWith("1")) return undefined; // another country code
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return undefined;
  // NANP: area code and exchange start with 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return undefined;
  return `+1${d}`;
}

/** The fictional 555-01xx numbers that tests and the simulator use. Refused in production (migration 0003 trigger). */
export const isSyntheticPhone = (e164: string) => /^\+1\d{3}55501\d{2}$/.test(e164);

/** "+1 •••-•••-0101": enough for the person to recognize their own number. */
export const maskPhone = (e164: string) => `+1 •••-•••-${e164.slice(-4)}`;

/**
 * A keyed hash (HMAC-SHA256) of a phone, IP or token. A plain sha256 of a phone is easy to reverse
 * (there are only 10^10 numbers), so the suppression list and rate-limit buckets use a server key.
 */
export function keyedHash(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
