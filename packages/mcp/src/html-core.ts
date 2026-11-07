//@ backend dafny
// HTML and CSP decisions of the OAuth pages. Proved with LemmaScript (docs/formal-verification.md).
// No imports: pages.ts and util.ts call these functions. A string is a list of characters here, and JS
// slices UTF-16 units: only ASCII characters change, so the two views give the same bytes.

/** One character of text in its HTML form. */
export function escChar(c: string): string {
  //@ verify
  return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : c === "'" ? "&#39;" : c;
}

/** Spec of esc, one character at a time. */
export function escAll(s: string): string {
  //@ verify
  //@ decreases s.length
  return s.length === 0 ? "" : escChar(s.slice(0, 1)) + escAll(s.slice(1));
}

/** Spec of esc: gives back the text. It is not an HTML parser. */
export function unesc(s: string): string {
  //@ verify
  //@ decreases s.length
  return s.length === 0 ? "" :
    s.startsWith("&amp;") ? "&" + unesc(s.slice(5)) :
    s.startsWith("&lt;") ? "<" + unesc(s.slice(4)) :
    s.startsWith("&gt;") ? ">" + unesc(s.slice(4)) :
    s.startsWith("&quot;") ? "\"" + unesc(s.slice(6)) :
    s.startsWith("&#39;") ? "'" + unesc(s.slice(5)) :
    s.slice(0, 1) + unesc(s.slice(1));
}

/** The text in a form that is safe in HTML text and in a quoted attribute. */
export function esc(s: string): string {
  //@ verify
  //@ ensures \result === escAll(s)
  //@ ensures unesc(\result) === s
  //@ ensures forall(k: nat, k < \result.length ==> \result.charCodeAt(k) !== 60 && \result.charCodeAt(k) !== 62 && \result.charCodeAt(k) !== 34 && \result.charCodeAt(k) !== 39)
  let out = "";
  let i = 0;
  while (i < s.length) {
    //@ invariant 0 <= i && i <= s.length
    //@ invariant out === escAll(s.slice(0, i))
    //@ decreases s.length - i
    out = out + escChar(s.slice(i, i + 1));
    i = i + 1;
  }
  return out;
}

/** A character that ends a CSP directive or policy, or that ends a source. */
function cspDelimiter(c: number): boolean {
  //@ verify
  return c === 59 || c === 44 || c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

/** True when a form target has no CSP delimiter, so it stays one source of one directive. */
export function cleanTarget(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length === 0 || (!cspDelimiter(s.charCodeAt(0)) && cleanTarget(s.slice(1)));
}

/** The form targets that can go in a CSP header. A target with a delimiter is left out. */
export function formTargets(targets: string[]): string[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> cleanTarget(\result[k]) && targets.includes(\result[k]))
  //@ ensures forall(k: nat, k < targets.length && cleanTarget(targets[k]) ==> \result.includes(targets[k]))
  let out: string[] = [];
  let i = 0;
  while (i < targets.length) {
    //@ invariant 0 <= i && i <= targets.length
    //@ invariant forall(k: nat, k < out.length ==> cleanTarget(out[k]) && targets.includes(out[k]))
    //@ invariant forall(k: nat, k < i && cleanTarget(targets[k]) ==> out.includes(targets[k]))
    //@ decreases targets.length - i
    if (cleanTarget(targets[i])) out = [...out, targets[i]];
    i = i + 1;
  }
  return out;
}

/** The form-action directive. No target can end the directive or add a policy. */
export function formAction(targets: string[]): string {
  //@ verify
  //@ ensures \result.startsWith("form-action 'self'")
  //@ ensures forall(k: nat, k < \result.length ==> \result.charCodeAt(k) !== 59 && \result.charCodeAt(k) !== 44)
  const clean = formTargets(targets);
  let out = "form-action 'self'";
  let i = 0;
  while (i < clean.length) {
    //@ invariant 0 <= i && i <= clean.length
    //@ invariant out.startsWith("form-action 'self'")
    //@ invariant forall(k: nat, k < out.length ==> out.charCodeAt(k) !== 59 && out.charCodeAt(k) !== 44)
    //@ decreases clean.length - i
    out = out + " " + clean[i];
    i = i + 1;
  }
  return out;
}

function hostIs(host: string, name: string): boolean {
  //@ verify
  return host === name || host.startsWith(name + ":");
}

/** True for a loopback host, with or without a port. Same names as isLoopbackHost in util.ts. */
export function loopbackAuthority(host: string): boolean {
  //@ verify
  return hostIs(host, "localhost") || hostIs(host, "127.0.0.1") || hostIs(host, "[::1]");
}

/**
 * The CSP source of a redirect host. Only a loopback redirect can be plain http (redirectUriAllowed),
 * and an http source also matches https on that host.
 */
export function formOrigin(host: string): string {
  //@ verify
  //@ ensures !loopbackAuthority(host) ==> \result === "https://" + host
  //@ ensures loopbackAuthority(host) ==> \result === "http://" + host
  return (loopbackAuthority(host) ? "http://" : "https://") + host;
}

/** Spec of the URL parser: it removes tab, LF and CR before it reads a URL. */
export function urlStripped(s: string): string {
  //@ verify
  //@ decreases s.length
  return s.length === 0 ? "" :
    (s.charCodeAt(0) === 9 || s.charCodeAt(0) === 10 || s.charCodeAt(0) === 13) ? urlStripped(s.slice(1)) :
    s.slice(0, 1) + urlStripped(s.slice(1));
}

/**
 * True when a retry link stays on this site. The parser reads a backslash as a slash and drops tab,
 * LF and CR, so "/\x" and "/<tab>/x" are links to another host.
 */
export function safeRetryPath(p: string): boolean {
  //@ verify
  //@ ensures \result ==> p.startsWith("/")
  //@ ensures \result ==> !urlStripped(p).startsWith("//") && !urlStripped(p).startsWith("/\\")
  //@ ensures \result ==> !p.includes("\\")
  if (!p.startsWith("/") || p.startsWith("//")) return false;
  let i = 0;
  while (i < p.length) {
    //@ invariant 0 <= i && i <= p.length
    //@ invariant forall(k: nat, k < i ==> p.charCodeAt(k) >= 32 && p.charCodeAt(k) !== 92 && p.charCodeAt(k) !== 127)
    //@ decreases p.length - i
    const c = p.charCodeAt(i);
    if (c < 32 || c === 92 || c === 127) return false;
    i = i + 1;
  }
  return true;
}
