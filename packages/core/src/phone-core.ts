// The one rule for US and Canadian phone digits. Import-free, proved by LemmaScript
// (docs/formal-verification.md). The sites' toE164 and the platform's normalizePhone both call
// phoneE164, so the client and the server cannot disagree on a number. The Blooio keys (toE164,
// normalizeAddress) call anyE164, which gives the same result on every number phoneE164 accepts.
// The scanners below replace the old regex tests: isSpace is the JavaScript \s set, and it is also
// the set that String.prototype.trim removes.

/**
 * NANP area codes that are not a US or Canadian geographic number: the Caribbean and Atlantic
 * countries (premium SMS-pumping destinations), toll-free and other non-geographic codes.
 */
const NOT_US_CA: string[] = [
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829", "849", "868", "869", "876",
  "500", "521", "522", "523", "524", "525", "526", "527", "528", "529", "532", "533", "535", "538", "542", "543", "544", "545", "546", "547", "549",
  "550", "552", "553", "554", "556", "566", "569", "577", "578", "588", "589", "600", "622", "700", "710", "800", "833", "844", "855", "866", "877", "888", "900",
];

/** The longest input that is worth a scan. A valid number with punctuation fits. */
const MAX_INPUT = 40;

function isDigit(c: number): boolean {
  //@ verify
  return c >= 48 && c <= 57;
}

function isSpace(c: number): boolean {
  //@ verify
  return (c >= 9 && c <= 13) || c === 32 || c === 160 || c === 5760 || (c >= 8192 && c <= 8202)
    || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

/** Digits, spaces and the punctuation of a written number: + ( ) . - */
function isPhoneChar(c: number): boolean {
  //@ verify
  return isDigit(c) || isSpace(c) || c === 43 || c === 40 || c === 41 || c === 46 || c === 45;
}

function allDigits(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length === 0 || (isDigit(s.charCodeAt(0)) && allDigits(s.slice(1)));
}

function allPhoneChars(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length === 0 || (isPhoneChar(s.charCodeAt(0)) && allPhoneChars(s.slice(1)));
}

/** The digits of s, in order. The same as s.replace(/\D/g, ""). */
function digitsOf(s: string): string {
  //@ verify
  //@ decreases s.length
  //@ ensures allDigits(\result)
  if (s.length === 0) return "";
  const rest = digitsOf(s.slice(1));
  return isDigit(s.charCodeAt(0)) ? s.slice(0, 1) + rest : rest;
}

/** True when the first character after any leading space is a plus. */
function startsWithPlus(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length > 0 && (s.charCodeAt(0) === 43 || (isSpace(s.charCodeAt(0)) && startsWithPlus(s.slice(1))));
}

/** True when the first two characters after any leading space are 0 0 (an international 00 prefix). */
function startsWithZeros(s: string): boolean {
  //@ verify
  //@ decreases s.length
  //@ ensures \result ==> digitsOf(s).length >= 2 && digitsOf(s).charCodeAt(0) === 48 && digitsOf(s).charCodeAt(1) === 48
  return s.length > 1 && ((s.charCodeAt(0) === 48 && s.charCodeAt(1) === 48) || (isSpace(s.charCodeAt(0)) && startsWithZeros(s.slice(1))));
}

/** A geographic US or Canadian area code. The reserved N11, N9X, 37X and 96X ranges are refused. */
function usOrCanadaArea(area: string): boolean {
  //@ verify
  return area.length === 3 && allDigits(area) && area.charCodeAt(0) >= 50 && !NOT_US_CA.includes(area)
    && !(area.charCodeAt(1) === 49 && area.charCodeAt(2) === 49)
    && area.charCodeAt(1) !== 57
    && !(area.charCodeAt(0) === 51 && area.charCodeAt(1) === 55)
    && !(area.charCodeAt(0) === 57 && area.charCodeAt(1) === 54);
}

/** The ten national digits, or "" when the digits name no US or Canadian number. */
function nationalDigits(plus: boolean, digits: string): string {
  //@ verify
  //@ requires allDigits(digits)
  //@ ensures \result === "" || (\result.length === 10 && allDigits(\result) && usOrCanadaArea(\result.slice(0, 3)))
  //@ ensures \result === "" || (\result.charCodeAt(3) >= 50 && !(\result.charCodeAt(4) === 49 && \result.charCodeAt(5) === 49))
  //@ ensures plus && !digits.startsWith("1") ==> \result === ""
  //@ ensures \result === "" || \result === digits || (digits.length === 11 && digits.startsWith("1") && \result === digits.slice(1))
  //@ ensures !plus && digits.length === 10 && usOrCanadaArea(digits.slice(0, 3)) && digits.charCodeAt(3) >= 50 && !(digits.charCodeAt(4) === 49 && digits.charCodeAt(5) === 49) ==> \result === digits
  if (plus && !digits.startsWith("1")) return "";
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length !== 10) return "";
  // NANP: area code and exchange start with 2-9, and the exchange is no N11 service code.
  if (!usOrCanadaArea(d.slice(0, 3)) || d.charCodeAt(3) < 50) return "";
  if (d.charCodeAt(4) === 49 && d.charCodeAt(5) === 49) return "";
  return d;
}

/**
 * E.164 for a +1 number, or null. Accepts "(212) 555-0101", "212-555-0101", "+1 212 555 0101" and
 * "12125550101". A + input with another country code is refused, not read as a US number.
 */
export function phoneE164(input: string): string | null {
  //@ verify
  //@ ensures \result !== null ==> \result.length === 12 && \result.startsWith("+1") && allDigits(\result.slice(1))
  //@ ensures \result !== null ==> \result.charCodeAt(2) >= 50 && \result.charCodeAt(5) >= 50
  //@ ensures \result !== null ==> usOrCanadaArea(\result.slice(2, 5)) && !NOT_US_CA.includes(\result.slice(2, 5))
  //@ ensures \result !== null ==> !(\result.charCodeAt(6) === 49 && \result.charCodeAt(7) === 49)
  //@ ensures \result !== null && startsWithPlus(input) ==> digitsOf(input).startsWith("1")
  //@ ensures \result !== null ==> digitsOf(input) === \result.slice(2) || digitsOf(input) === \result.slice(1)
  //@ ensures !allPhoneChars(input) ==> \result === null
  //@ ensures input.length === 10 && allDigits(input) && usOrCanadaArea(input.slice(0, 3)) && input.charCodeAt(3) >= 50 && !(input.charCodeAt(4) === 49 && input.charCodeAt(5) === 49) ==> \result === "+1" + input
  if (input.length > MAX_INPUT || !allPhoneChars(input)) return null;
  const national = nationalDigits(startsWithPlus(input), digitsOf(input));
  return national === "" ? null : `+1${national}`;
}

/**
 * True for an E.164 text: a plus, a first digit 1-9, then 7 to 14 more digits. The same as
 * /^\+[1-9]\d{7,14}$/.test(s).
 */
export function isE164(s: string): boolean {
  //@ verify
  return s.length >= 9 && s.length <= 16 && s.charCodeAt(0) === 43 && s.charCodeAt(1) >= 49 && allDigits(s.slice(1));
}

/**
 * E.164 for a phone number of any country, or null. The outbound queue and the inbound keys
 * (packages/blooio/src/phone.ts toE164) call it. The caller applies NFKC first. A leading + or 00
 * marks the country code. Without one, 10 digits are a +1 number and other digits are read as
 * written. When phoneE164 accepts the input, the result is the same, so the queue key and the
 * platform identity key cannot disagree on a US or Canadian number.
 * The scans are loops, not recursion, so a long input cannot overflow the stack.
 */
export function anyE164(s: string): string | null {
  //@ verify
  //@ ensures \result !== null ==> isE164(\result)
  //@ ensures !allPhoneChars(s) ==> \result === null
  //@ ensures phoneE164(s) !== null ==> \result === phoneE164(s)
  //@ ensures startsWithZeros(s) && digitsOf(s).length >= 2 ==> \result === (allPhoneChars(s) && isE164("+" + digitsOf(s).slice(2)) ? "+" + digitsOf(s).slice(2) : null)
  //@ ensures !startsWithZeros(s) && (startsWithPlus(s) || digitsOf(s).length !== 10) ==> \result === (allPhoneChars(s) && isE164("+" + digitsOf(s)) ? "+" + digitsOf(s) : null)
  //@ ensures !startsWithZeros(s) && !startsWithPlus(s) && digitsOf(s).length === 10 ==> \result === (allPhoneChars(s) && isE164("+1" + digitsOf(s)) ? "+1" + digitsOf(s) : null)
  let start = 0;
  while (start < s.length && isSpace(s.charCodeAt(start))) {
    //@ invariant 0 <= start && start <= s.length
    //@ invariant startsWithPlus(s) === startsWithPlus(s.slice(start))
    //@ invariant digitsOf(s) === digitsOf(s.slice(start))
    //@ invariant startsWithZeros(s) === startsWithZeros(s.slice(start))
    //@ decreases s.length - start
    start = start + 1;
  }
  const plus = start < s.length && s.charCodeAt(start) === 43;
  const zeros = start + 1 < s.length && s.charCodeAt(start) === 48 && s.charCodeAt(start + 1) === 48;
  let ok = true;
  let digits = "";
  let i = s.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= s.length
    //@ invariant ok === allPhoneChars(s.slice(i))
    //@ invariant digits === digitsOf(s.slice(i))
    //@ decreases i
    i = i - 1;
    const c = s.charCodeAt(i);
    ok = isPhoneChar(c) && ok;
    if (isDigit(c)) digits = s.slice(i, i + 1) + digits;
  }
  if (!ok) return null;
  const d = zeros ? digits.slice(2) : digits;
  if (d.length === 0) return null;
  const out = plus || zeros || d.length !== 10 ? "+" + d : "+1" + d;
  return isE164(out) ? out : null;
}
