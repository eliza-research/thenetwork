//@ backend dafny
// The routing decisions of the platform API and the shared line. Import-free, proved by LemmaScript
// (docs/formal-verification.md). api.ts and apps.ts call these functions. The regex work (NFKC,
// lowercase, the letter classes of keywordApp and lookingFor) and the host map lookup stay in the shell.

/** The start of the one OAuth return path that the Cloud hand-off accepts. A 22-character id follows it. */
export const OAUTH_RETURN_PREFIX = "/oauth/cloud-return?rid=";

/** A character of the id: A-Z, a-z, 0-9, _ and -. */
function isRidChar(c: number): boolean {
  //@ verify
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
}

function allRidChars(s: string): boolean {
  //@ verify
  //@ decreases s.length
  //@ ensures \result <==> forall(k: nat, k < s.length ==> isRidChar(s.charCodeAt(k)))
  return s.length === 0 || (isRidChar(s.charCodeAt(0)) && allRidChars(s.slice(1)));
}

/** A character that cannot start a scheme, an authority or a break in a path: ":", "\", space and control characters. */
function pathCharOk(c: number): boolean {
  //@ verify
  return c > 32 && c !== 127 && c !== 58 && c !== 92;
}

function allPathChars(s: string): boolean {
  //@ verify
  //@ decreases s.length
  //@ ensures \result <==> forall(k: nat, k < s.length ==> pathCharOk(s.charCodeAt(k)))
  return s.length === 0 || (pathCharOk(s.charCodeAt(0)) && allPathChars(s.slice(1)));
}

/**
 * Spec: a path on the same origin. It starts with one "/" (never "//" or "/\", which a browser reads
 * as another host), and it has no ":" (no scheme), no "\" and no space or control character.
 */
function sameOriginPath(s: string): boolean {
  //@ verify
  return s.length > 0 && s.charCodeAt(0) === 47 && (s.length === 1 || (s.charCodeAt(1) !== 47 && s.charCodeAt(1) !== 92))
    && allPathChars(s);
}

/** True for "/oauth/cloud-return?rid=" and 22 id characters. The same as /^\/oauth\/cloud-return\?rid=[A-Za-z0-9_-]{22}$/. */
export function isOauthReturnPath(path: string): boolean {
  //@ verify
  //@ ensures \result <==> (path.length === 46 && path.startsWith(OAUTH_RETURN_PREFIX) && forall(k: nat, 24 <= k && k < 46 ==> isRidChar(path.charCodeAt(k))))
  //@ ensures \result ==> sameOriginPath(path)
  return path.length === OAUTH_RETURN_PREFIX.length + 22 && path.startsWith(OAUTH_RETURN_PREFIX)
    && allRidChars(path.slice(OAUTH_RETURN_PREFIX.length));
}

/** The return paths of the Cloud hand-off: the Join page, or the OAuth return. */
export function isCloudReturnPath(path: string): boolean {
  //@ verify
  //@ ensures \result <==> (path === "/join" || isOauthReturnPath(path))
  //@ ensures \result ==> sameOriginPath(path)
  return path === "/join" || isOauthReturnPath(path);
}

/**
 * Where the name of one cookie pair ends: the index of its first "=", or -1 when the pair has no "="
 * or an empty raw name. The name never holds an "=", so a value cannot add a second cookie name.
 */
export function cookieNameEnd(part: string): number {
  //@ verify
  //@ ensures \result === -1 || (\result > 0 && \result < part.length && part.charCodeAt(\result) === 61)
  //@ ensures \result > 0 ==> forall(k: nat, k < \result ==> part.charCodeAt(k) !== 61)
  //@ ensures \result === -1 ==> (part.length > 0 && part.charCodeAt(0) === 61) || forall(k: nat, k < part.length ==> part.charCodeAt(k) !== 61)
  let i = 0;
  while (i < part.length) {
    //@ invariant 0 <= i && i <= part.length
    //@ invariant forall(k: nat, k < i ==> part.charCodeAt(k) !== 61)
    //@ decreases part.length - i
    if (part.charCodeAt(i) === 61) return i > 0 ? i : -1;
    i = i + 1;
  }
  return -1;
}

/** One app as keyword routing sees it. */
export interface KeywordApp { id: string; domain: string }

/** True when a whole message (after the shell's clean-up) names the app: its id, its domain, or www and its domain. */
function namesApp(bare: string, a: KeywordApp): boolean {
  //@ verify
  return bare === a.id || bare === a.domain || bare === "www." + a.domain;
}

/** The message without one final ".". */
function withoutFinalDot(t: string): string {
  //@ verify
  return t.length > 0 && t.charCodeAt(t.length - 1) === 46 ? t.slice(0, t.length - 1) : t;
}

/** The message without a leading "join ". */
function withoutJoin(t: string): string {
  //@ verify
  return t.startsWith("join ") ? t.slice(5) : t;
}

/** The words that the whole message is compared with. */
export function bareKeyword(t: string): string {
  //@ verify
  return withoutJoin(withoutFinalDot(t));
}

/**
 * The app id that a whole cleaned message names on the shared line (founder decision 2), or "" when
 * it names none. Keyword routing: "slop", "slop.date", "www.slop.date", "join slop" -> slop, and the
 * same for every app in the table. "the network" or "network" -> ntwrk when ntwrk is in the table.
 * The shell gives "" back as undefined, and the service then routes the person to The Network.
 */
export function keywordFor(t: string, apps: KeywordApp[], hasNtwrk: boolean): string {
  //@ verify
  //@ ensures \result === "" || \result === "ntwrk" || exists(k: nat, k < apps.length && \result === apps[k].id)
  //@ ensures forall(k: nat, k < apps.length && namesApp(bareKeyword(t), apps[k]) && forall(j: nat, j < k ==> !namesApp(bareKeyword(t), apps[j])) ==> \result === apps[k].id)
  //@ ensures forall(k: nat, k < apps.length ==> !namesApp(bareKeyword(t), apps[k])) && hasNtwrk && (bareKeyword(t) === "the network" || bareKeyword(t) === "network") ==> \result === "ntwrk"
  //@ ensures forall(k: nat, k < apps.length ==> !namesApp(bareKeyword(t), apps[k])) && !(hasNtwrk && (bareKeyword(t) === "the network" || bareKeyword(t) === "network")) ==> \result === ""
  const bare = bareKeyword(t);
  let i = 0;
  while (i < apps.length) {
    //@ invariant 0 <= i && i <= apps.length
    //@ invariant forall(k: nat, k < i ==> !namesApp(bare, apps[k]))
    //@ decreases apps.length - i
    if (namesApp(bare, apps[i])) return apps[i].id;
    i = i + 1;
  }
  if ((bare === "the network" || bare === "network") && hasNtwrk) return "ntwrk";
  return "";
}

/**
 * The apps a person who joined The Network with no keyword asks for, in the order friends, slop, peon,
 * then any app that "all" adds (founder decision 2). The shell reads the four facts with its regexes.
 */
export function lookingForApps(friends: boolean, dating: boolean, work: boolean, all: boolean): string[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> \result[k] === "friends" || \result[k] === "slop" || \result[k] === "peon")
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.length ==> \result[i] !== \result[j]))
  //@ ensures \result.includes("friends") <==> (friends || all)
  //@ ensures \result.includes("slop") <==> (dating || all)
  //@ ensures \result.includes("peon") <==> (work || all)
  const base: string[] = (friends ? ["friends"] : []).concat(dating ? ["slop"] : []).concat(work ? ["peon"] : []);
  if (!all) return base;
  return base.concat(friends ? [] : ["friends"]).concat(dating ? [] : ["slop"]).concat(work ? [] : ["peon"]);
}
