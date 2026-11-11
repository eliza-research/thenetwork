//@ backend dafny
// Request shape decisions of the OAuth server: PKCE verifier and challenge shapes (RFC 7636), the
// form that has a key two times (RFC 6749 3.1 and 3.2), and the cookie that a name selects. Proved
// with LemmaScript (docs/formal-verification.md). No imports: util.ts calls these functions.
// The scanners replace the old regex tests. A string is a list of UTF-16 units here, as in JS.

/** RFC 7636 4.1 unreserved: A-Z a-z 0-9 - . _ ~ */
function unreserved(c: number): boolean {
  //@ verify
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 95 || c === 126;
}

/** RFC 4648 5 base64url without padding: A-Z a-z 0-9 - _ */
function base64url(c: number): boolean {
  //@ verify
  //@ ensures \result ==> unreserved(c)
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95;
}

function allUnreserved(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length === 0 || (unreserved(s.charCodeAt(0)) && allUnreserved(s.slice(1)));
}

function allBase64url(s: string): boolean {
  //@ verify
  //@ decreases s.length
  //@ ensures \result ==> allUnreserved(s)
  return s.length === 0 || (base64url(s.charCodeAt(0)) && allBase64url(s.slice(1)));
}

/** RFC 7636 4.1: a code_verifier is 43 to 128 unreserved characters. Same as /^[A-Za-z0-9\-._~]{43,128}$/. */
export function pkceVerifierShape(s: string): boolean {
  //@ verify
  //@ ensures \result ==> s.length >= 43 && s.length <= 128 && allUnreserved(s)
  return s.length >= 43 && s.length <= 128 && allUnreserved(s);
}

/**
 * RFC 7636 4.2: an S256 code_challenge is BASE64URL(SHA256(verifier)), 32 bytes, so 43 base64url
 * characters. Same as /^[A-Za-z0-9\-_]{43}$/. Every such challenge also has the shape of a verifier.
 */
export function pkceChallengeShape(s: string): boolean {
  //@ verify
  //@ ensures \result ==> s.length === 43 && allBase64url(s)
  //@ ensures \result ==> pkceVerifierShape(s)
  return s.length === 43 && allBase64url(s);
}

/** True when a key is in the list two or more times. A form with such a key is refused. */
export function hasDuplicateKey(keys: string[]): boolean {
  //@ verify
  //@ ensures \result === exists(i: nat, exists(j: nat, i < j && j < keys.length && keys[i] === keys[j]))
  let j = 0;
  while (j < keys.length) {
    //@ invariant 0 <= j && j <= keys.length
    //@ invariant forall(a: nat, forall(b: nat, a < b && b < j ==> keys[a] !== keys[b]))
    //@ decreases keys.length - j
    let i = 0;
    while (i < j) {
      //@ invariant 0 <= i && i <= j
      //@ invariant forall(a: nat, a < i ==> keys[a] !== keys[j])
      //@ decreases j - i
      if (keys[i] === keys[j]) return true;
      i = i + 1;
    }
    j = j + 1;
  }
  return false;
}

/** The characters that String.prototype.trim removes (JS WhiteSpace and LineTerminator). */
function isSpace(c: number): boolean {
  //@ verify
  return (c >= 9 && c <= 13) || c === 32 || c === 160 || c === 5760 || (c >= 8192 && c <= 8202)
    || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

/** The index of the first "=" at or after i, or -1. */
function eqFrom(s: string, i: number): number {
  //@ verify
  //@ requires 0 <= i && i <= s.length
  //@ ensures \result === -1 || (i <= \result && \result < s.length && s.charCodeAt(\result) === 61)
  //@ decreases s.length - i
  return i >= s.length ? -1 : s.charCodeAt(i) === 61 ? i : eqFrom(s, i + 1);
}

/** The first index at or after a that is not a space (s.length when there is none). */
function spaceEnd(s: string, a: number): number {
  //@ verify
  //@ requires 0 <= a && a <= s.length
  //@ ensures a <= \result && \result <= s.length
  //@ decreases s.length - a
  return a < s.length && isSpace(s.charCodeAt(a)) ? spaceEnd(s, a + 1) : a;
}

/** The end of s.slice(a, b) without the space at its end. */
function spaceStart(s: string, a: number, b: number): number {
  //@ verify
  //@ requires 0 <= a && a <= b && b <= s.length
  //@ ensures a <= \result && \result <= b
  //@ decreases b
  return b > a && isSpace(s.charCodeAt(b - 1)) ? spaceStart(s, a, b - 1) : b;
}

/** s without the space at its start and its end. The same as s.trim(). */
function trimSpace(s: string): string {
  //@ verify
  //@ ensures \result.length <= s.length
  const a = spaceEnd(s, 0);
  return s.slice(a, spaceStart(s, a, s.length));
}

/** True when the cookie part has the name: the text before its first "=", not empty, then trimmed. */
function partNamed(part: string, name: string): boolean {
  //@ verify
  const i = eqFrom(part, 0);
  return i > 0 && trimSpace(part.slice(0, i)) === name;
}

/**
 * The index of the first cookie part (the header split on ";") with the name, or -1. The first one
 * wins, so a later part with the same name never replaces it.
 */
export function cookiePartIndex(parts: string[], name: string): number {
  //@ verify
  //@ ensures -1 <= \result && \result < parts.length
  //@ ensures \result >= 0 ==> partNamed(parts[\result], name)
  //@ ensures forall(k: nat, k < parts.length && (\result === -1 || k < \result) ==> !partNamed(parts[k], name))
  let i = 0;
  while (i < parts.length) {
    //@ invariant 0 <= i && i <= parts.length
    //@ invariant forall(k: nat, k < i ==> !partNamed(parts[k], name))
    //@ decreases parts.length - i
    if (partNamed(parts[i], name)) return i;
    i = i + 1;
  }
  return -1;
}

/** The text after the first "=" of a named cookie part, trimmed. The shell decodes it. */
export function cookiePartValue(part: string): string {
  //@ verify
  //@ requires eqFrom(part, 0) > 0
  return trimSpace(part.slice(eqFrom(part, 0) + 1));
}
