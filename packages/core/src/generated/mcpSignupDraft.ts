// GENERATED from spec/mcpSignupDraft.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export type DraftPreparationPhase = "ReadConnection" | "CheckAge" | "CheckOwner" | "CheckMembership" | "WriteDraft" | "Prepared" | "GrantRefused" | "UseJoinForm" | "AgeRefused" | "ExistingProfile" | "WriteRefused";
/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export interface DraftPreparation { phase: DraftPreparationPhase }
/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
export type DraftClaimRoute = "RefuseClaim" | "ReadDraft" | "EmptyDraft";
/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
export type DraftBrowserAction = "RefuseBrowserAction" | "ClaimBySession" | "CheckDiscardView";

/** One variant per transition in the spec. */
export type Event =
  | { type: "observeConnection"; grantReady: boolean; guardReady: boolean }
  | { type: "observeAge"; allowed: boolean }
  | { type: "observeOwner"; ownerMatches: boolean }
  | { type: "observeMembership"; status: string }
  | { type: "observeWrite"; saved: boolean };

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export const signupDraftLifetimeMs: number = 600000;
/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export const initial: DraftPreparation = { phase: "ReadConnection" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: DraftPreparation): boolean {
  return true;
}

/** Story: Prepare an editable Join form after authorization / The draft belongs to the app on the connection (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftAppEnabled(appId: string): boolean {
  return appId === "ntwrk" || appId === "friends";
}

/** Story: Prepare an editable Join form after authorization / The draft belongs to the app on the connection (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftRequestAllowed(appId: string, appProvided: boolean, matchesHost: boolean): boolean {
  return signupDraftAppEnabled(appId) && (!appProvided || matchesHost);
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftDeadline(draftUntil: number, grantUntil: number): number {
  return grantUntil < draftUntil ? grantUntil : draftUntil;
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function signupMembershipCanDraft(status: string): boolean {
  return status === "not_joined" || status === "invited";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveConnection(s: DraftPreparation): boolean {
  return s.phase === "ReadConnection";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeConnection(s: DraftPreparation, grantReady: boolean, guardReady: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveConnection(s)) ==> stepPreparedRequiresWrite(s, \result)
  return { phase: !grantReady ? "GrantRefused" : (guardReady ? "CheckAge" : "UseJoinForm") };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveAge(s: DraftPreparation): boolean {
  return s.phase === "CheckAge";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeAge(s: DraftPreparation, allowed: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveAge(s)) ==> stepPreparedRequiresWrite(s, \result)
  return { phase: allowed ? "CheckOwner" : "AgeRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveOwner(s: DraftPreparation): boolean {
  return s.phase === "CheckOwner";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeOwner(s: DraftPreparation, ownerMatches: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveOwner(s)) ==> stepPreparedRequiresWrite(s, \result)
  return { phase: ownerMatches ? "CheckMembership" : "GrantRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveMembership(s: DraftPreparation): boolean {
  return s.phase === "CheckMembership";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeMembership(s: DraftPreparation, status: string): DraftPreparation {
  //@ ensures (inv(s) && canObserveMembership(s)) ==> stepPreparedRequiresWrite(s, \result)
  return { phase: signupMembershipCanDraft(status) ? "WriteDraft" : "ExistingProfile" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveWrite(s: DraftPreparation): boolean {
  return s.phase === "WriteDraft";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeWrite(s: DraftPreparation, saved: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveWrite(s)) ==> stepPreparedRequiresWrite(s, \result)
  return { phase: saved ? "Prepared" : "WriteRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function stepPreparedRequiresWrite(before: DraftPreparation, after: DraftPreparation): boolean {
  return !(before.phase !== "Prepared" && after.phase === "Prepared") || before.phase === "WriteDraft";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function sometimesPrepared(s: DraftPreparation): boolean {
  return s.phase === "Prepared";
}

/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftBrowserSource(originAllowed: boolean, browserVerified: boolean, queryPresent: boolean): boolean {
  return originAllowed && browserVerified && !queryPresent;
}

/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftBrowserAction(ownerMatches: boolean, discardRequested: boolean): DraftBrowserAction {
  return !ownerMatches ? "RefuseBrowserAction" : (discardRequested ? "CheckDiscardView" : "ClaimBySession");
}

/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftDiscardAllowed(route: DraftBrowserAction, viewMatches: boolean): boolean {
  return route === "CheckDiscardView" && viewMatches;
}

/** Story: Recover the same draft until Join or expiry / The site checks the session and membership before asking for the draft (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftClaimRoute(status: string, ageAllowed: boolean): DraftClaimRoute {
  return !signupMembershipCanDraft(status) ? "RefuseClaim" : (ageAllowed ? "ReadDraft" : "EmptyDraft");
}

/** Story: Recover the same draft until Join or expiry / A compatible grant and exactly one draft are needed for a read (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftGrantAllowed(bindingMatches: boolean, grantCurrent: boolean, unrevoked: boolean, writeScope: boolean): boolean {
  return bindingMatches && grantCurrent && unrevoked && writeScope;
}

/** Story: Recover the same draft until Join or expiry / A compatible grant and exactly one draft are needed for a read (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftRowReadable(bindingMatches: boolean, unconsumed: boolean, expiresAt: number, asOf: number): boolean {
  return bindingMatches && unconsumed && expiresAt > asOf;
}

/** Story: Recover the same draft until Join or expiry / A compatible grant and exactly one draft are needed for a read (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftUnique(matches: number): boolean {
  return matches === 1;
}

/** Story: Recover the same draft until Join or expiry / A compatible grant and exactly one draft are needed for a read (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftExpired(expiresAt: number, asOf: number): boolean {
  return expiresAt <= asOf;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: DraftPreparation, event: Event): boolean {
  if (event.type === "observeConnection") return canObserveConnection(current);
  if (event.type === "observeAge") return canObserveAge(current);
  if (event.type === "observeOwner") return canObserveOwner(current);
  if (event.type === "observeMembership") return canObserveMembership(current);
  if (event.type === "observeWrite") return canObserveWrite(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: DraftPreparation, event: Event): DraftPreparation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "observeConnection") return canObserveConnection(current) ? observeConnection(current, event.grantReady, event.guardReady) : current;
  if (event.type === "observeAge") return canObserveAge(current) ? observeAge(current, event.allowed) : current;
  if (event.type === "observeOwner") return canObserveOwner(current) ? observeOwner(current, event.ownerMatches) : current;
  if (event.type === "observeMembership") return canObserveMembership(current) ? observeMembership(current, event.status) : current;
  if (event.type === "observeWrite") return canObserveWrite(current) ? observeWrite(current, event.saved) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "observeConnection" && typeof raw.grantReady === "boolean" && typeof raw.guardReady === "boolean") return { type: "observeConnection", grantReady: raw.grantReady, guardReady: raw.guardReady };
  if (raw.type === "observeAge" && typeof raw.allowed === "boolean") return { type: "observeAge", allowed: raw.allowed };
  if (raw.type === "observeOwner" && typeof raw.ownerMatches === "boolean") return { type: "observeOwner", ownerMatches: raw.ownerMatches };
  if (raw.type === "observeMembership" && typeof raw.status === "string") return { type: "observeMembership", status: raw.status };
  if (raw.type === "observeWrite" && typeof raw.saved === "boolean") return { type: "observeWrite", saved: raw.saved };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): DraftPreparation | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ReadConnection" || raw.phase === "CheckAge" || raw.phase === "CheckOwner" || raw.phase === "CheckMembership" || raw.phase === "WriteDraft" || raw.phase === "Prepared" || raw.phase === "GrantRefused" || raw.phase === "UseJoinForm" || raw.phase === "AgeRefused" || raw.phase === "ExistingProfile" || raw.phase === "WriteRefused") && Object.keys(raw).length === 1)) return undefined;
  const parsed: DraftPreparation = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): DraftPreparation {
  //@ ensures inv(\result)
  return initial;
}
