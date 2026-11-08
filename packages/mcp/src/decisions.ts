// The pure decisions of the OAuth server and the tools, free of imports so that they can be proved
// (LemmaScript, docs/formal-verification.md). handler.ts, tools.ts and hooks.ts call them. Facts passed in
// as booleans are trusted here: URL parsing, the PKCE hash and the store calls stay in handler.ts, and the
// atomic takeCode and rotateRefresh are SQL. The proofs pin the order and the conditions, not those facts.

export type MembershipState = "invited" | "onboarding" | "active" | "paused" | "restricted" | "removed";
/** A membership state as the person's own agent may see it. No age, no member id, nothing about others. */
export type PublicStatus = "not_joined" | "invited" | "onboarding" | "active" | "stopped" | "on_hold";
export type CloudStatus = "valid" | "invalid" | "unavailable";

/**
 * Whether a grant still belongs to the number's person. A different person now means a new owner
 * after staff review. A grant made while the number had no person never follows a person created
 * later (who may be someone else): it is dead, and the person connects again (audit: null-person grant).
 */
//@ verify
//@ ensures \result <==> atConsent === now
export function grantStillTheirs(atConsent: string | null, now: string | null): boolean {
  return atConsent === null ? now === null : now === atConsent;
}

/** Platform membership state -> what the person's agent sees. */
//@ verify
//@ ensures \result === "active" ==> state === "active" && !review
//@ ensures state === "restricted" ==> \result === "on_hold"
//@ ensures !!review ==> \result === "on_hold"
export function publicStatus(state: MembershipState | undefined, review: string | null | undefined): PublicStatus {
  if (review) return "on_hold";
  if (state === undefined) return "not_joined";
  switch (state) {
    case "removed": return "not_joined";
    case "invited": return "invited";
    case "onboarding": return "onboarding";
    case "active": return "active";
    case "paused": return "stopped";
    // A safety restriction is not explained to an agent; the person sees the details on the site.
    case "restricted": return "on_hold";
  }
}

/** The redirect URI of an authorize request: a registered one, never anything else (open redirector). */
//@ verify
//@ ensures \result !== null ==> uris.includes(\result)
//@ ensures asked !== null && !uris.includes(asked) ==> \result === null
export function resolveRedirect(asked: string | null, uris: readonly string[]): string | null {
  const redirectUri = asked ?? (uris.length === 1 ? uris[0]! : null);
  return redirectUri !== null && uris.includes(redirectUri) ? redirectUri : null;
}

/** A refresh may narrow scopes, never widen them. */
//@ verify
//@ ensures \result <==> forall(s: string, asked.includes(s) ==> held.includes(s))
export function scopesWithin(asked: readonly string[], held: readonly string[]): boolean {
  return asked.every(s => held.includes(s));
}

/** A tool with a scope runs only with a token that holds it. `scopes` is null with no token. */
//@ verify
//@ ensures need === null ==> \result
//@ ensures need !== null ==> scopes === null ==> !\result
//@ ensures need !== null ==> scopes !== null ==> (\result <==> scopes.includes(need))
export function toolAllowed(need: string | null, scopes: readonly string[] | null): boolean {
  if (need === null) return true;
  if (scopes === null) return false;
  return scopes.includes(need);
}

/** One authorization code as the request presents it. */
export interface CodeFacts { sameClient: boolean; used: boolean; expired: boolean; redirectOk: boolean; verifierOk: boolean; resourceOk: boolean }
export type CodeVerdict = "invalid" | "replay" | "expired" | "bad_redirect" | "bad_verifier" | "bad_target" | "go";

/** The code checks, in order. Nothing after a failed check runs, and a used code is a replay before anything else about it counts. */
//@ verify
//@ ensures \result === "go" <==> f.sameClient && !f.used && !f.expired && f.redirectOk && f.verifierOk && f.resourceOk
//@ ensures \result === "replay" <==> f.sameClient && f.used
export function codeVerdict(f: CodeFacts): CodeVerdict {
  if (!f.sameClient) return "invalid";
  if (f.used) return "replay";
  if (f.expired) return "expired";
  if (!f.redirectOk) return "bad_redirect";
  if (!f.verifierOk) return "bad_verifier";
  if (!f.resourceOk) return "bad_target";
  return "go";
}

/** The grant behind a token request. `tokenLive` and `grantUnexpired` are read again after the slow Cloud check. */
export interface GrantFacts { live: boolean; banned: boolean; eligible: boolean; cloud: CloudStatus; tokenLive: boolean; grantUnexpired: boolean }
export type GrantVerdict = "invalid" | "unavailable" | "go";

/** Tokens come only from a live grant of someone not banned, with Cloud's yes, and with nothing expired during the check. */
//@ verify
//@ ensures \result === "go" <==> f.live && !f.banned && f.eligible && f.cloud === "valid" && f.tokenLive && f.grantUnexpired
//@ ensures \result === "unavailable" ==> f.cloud === "unavailable" && f.live && !f.banned && f.eligible
export function grantVerdict(f: GrantFacts): GrantVerdict {
  if (!f.live || f.banned || !f.eligible || !f.tokenLive) return "invalid";
  if (f.cloud === "unavailable") return "unavailable";
  if (f.cloud !== "valid" || !f.grantUnexpired) return "invalid";
  return "go";
}

export type TakenVerdict = "invalid" | "replay" | "issue";

/** The atomic take of a code: it was there, this request was the first, and nothing expired. */
//@ verify
//@ ensures \result === "issue" <==> taken && !usedBefore && live
//@ ensures \result === "replay" <==> taken && usedBefore
export function takenVerdict(taken: boolean, usedBefore: boolean, live: boolean): TakenVerdict {
  if (!taken) return "invalid";
  if (usedBefore) return "replay";
  return live ? "issue" : "invalid";
}
