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
  if (!usOrCanadaArea(d.slice(0, 3)) || /^[2-9]11$/.test(d.slice(3, 6))) return undefined;
  return `+1${d}`;
}

/**
 * NANP area codes that are not a US or Canadian geographic number: the Caribbean and Atlantic
 * countries (premium SMS-pumping destinations), toll-free and other non-geographic codes, N11
 * service codes and the reserved N9X / 37X / 96X ranges.
 */
const NOT_US_CA = new Set([
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829", "849", "868", "869", "876",
  "500", "521", "522", "523", "524", "525", "526", "527", "528", "529", "532", "533", "535", "538", "542", "543", "544", "545", "546", "547", "549",
  "550", "552", "553", "554", "556", "566", "569", "577", "578", "588", "589", "600", "622", "700", "710", "800", "833", "844", "855", "866", "877", "888", "900",
]);
export const usOrCanadaArea = (area: string) =>
  /^[2-9]\d\d$/.test(area) && !NOT_US_CA.has(area) && !/^[2-9]11$/.test(area) && !/^[2-9]9\d$/.test(area) && !/^(37|96)\d$/.test(area);

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
