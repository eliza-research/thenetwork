// GENERATED from spec/mcpSignupDraft.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export type DraftPreparationPhase = "ReadConnection" | "CheckAge" | "CheckOwner" | "CheckMembership" | "WriteDraft" | "RecheckAge" | "Prepared" | "GrantRefused" | "AgeRefused" | "ExistingProfile" | "WriteRefused";
/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
export interface DraftPreparation { phase: DraftPreparationPhase }
/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
export type DraftClaimRoute = "RefuseClaim" | "ReadDraft" | "DiscardDraft";
/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
export type DraftBrowserAction = "RefuseBrowserAction" | "ClaimBySession" | "CheckDiscardView";
/** Story: Drop the draft when I can no longer use it / The signup result settles the draft (spec/mcpSignupDraft.md) */
export type DraftSettlement = "DeleteDraft" | "KeepDraft";

/** One variant per transition in the spec. */
export type Event =
  | { type: "observeConnection"; grantReady: boolean }
  | { type: "observeAge"; allowed: boolean }
  | { type: "observeOwner"; ownerMatches: boolean }
  | { type: "observeMembership"; status: string }
  | { type: "observeWrite"; saved: boolean }
  | { type: "observeAgeAfterWrite"; allowed: boolean };

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
export function observeConnection(s: DraftPreparation, grantReady: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveConnection(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
  return { phase: grantReady ? "CheckAge" : "GrantRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveAge(s: DraftPreparation): boolean {
  return s.phase === "CheckAge";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeAge(s: DraftPreparation, allowed: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveAge(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
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
  //@ ensures (inv(s) && canObserveOwner(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
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
  //@ ensures (inv(s) && canObserveMembership(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
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
  //@ ensures (inv(s) && canObserveWrite(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
  return { phase: saved ? "RecheckAge" : "WriteRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function canObserveAgeAfterWrite(s: DraftPreparation): boolean {
  return s.phase === "RecheckAge";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function observeAgeAfterWrite(s: DraftPreparation, allowed: boolean): DraftPreparation {
  //@ ensures (inv(s) && canObserveAgeAfterWrite(s)) ==> stepPreparedRequiresAgeAfterWrite(s, \result)
  return { phase: allowed ? "Prepared" : "AgeRefused" };
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function stepPreparedRequiresAgeAfterWrite(before: DraftPreparation, after: DraftPreparation): boolean {
  return !(before.phase !== "Prepared" && after.phase === "Prepared") || before.phase === "RecheckAge";
}

/** Story: Prepare an editable Join form after authorization / A live connection prepares one draft under the age guard (spec/mcpSignupDraft.md) */
//@ pure
export function sometimesPrepared(s: DraftPreparation): boolean {
  return s.phase === "Prepared";
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftBrowserSource(originAllowed: boolean, browserVerified: boolean, queryPresent: boolean): boolean {
  return originAllowed && browserVerified && !queryPresent;
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftBrowserAction(ownerMatches: boolean, discardRequested: boolean): DraftBrowserAction {
  return !ownerMatches ? "RefuseBrowserAction" : (discardRequested ? "CheckDiscardView" : "ClaimBySession");
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftDiscardAllowed(route: DraftBrowserAction, viewMatches: boolean): boolean {
  return route === "CheckDiscardView" && viewMatches;
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftClaimRoute(status: string, ageAllowed: boolean, banned: boolean): DraftClaimRoute {
  return banned ? "DiscardDraft" : (!signupMembershipCanDraft(status) ? "RefuseClaim" : (ageAllowed ? "ReadDraft" : "DiscardDraft"));
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftRefusedRoute(banned: boolean): DraftClaimRoute {
  return banned ? "DiscardDraft" : "RefuseClaim";
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function lawBannedNumberNeverReadsDraft(status: string, ageAllowed: boolean): boolean {
  //@ ensures \result === true
  return signupDraftClaimRoute(status, ageAllowed, true) === "DiscardDraft";
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function lawDraftReadNeedsJoinableAge(status: string, ageAllowed: boolean, banned: boolean): boolean {
  //@ ensures \result === true
  return !(signupDraftClaimRoute(status, ageAllowed, banned) === "ReadDraft") || (ageAllowed && !banned && signupMembershipCanDraft(status));
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function lawRefusedSessionReadsNoDraft(banned: boolean): boolean {
  //@ ensures \result === true
  return signupDraftRefusedRoute(banned) !== "ReadDraft";
}

/** Story: Drop the draft when I can no longer use it / The Finish signup step keeps the draft only for a person who can still join (spec/mcpSignupDraft.md) */
//@ pure
export function lawRefusedBannedSessionDeletesDraft(banned: boolean): boolean {
  //@ ensures \result === true
  return !banned || signupDraftRefusedRoute(banned) === "DiscardDraft";
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftGrantAllowed(bindingMatches: boolean, grantCurrent: boolean, unrevoked: boolean, writeScope: boolean): boolean {
  return bindingMatches && grantCurrent && unrevoked && writeScope;
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftRowReadable(bindingMatches: boolean, unconsumed: boolean, expiresAt: number, asOf: number): boolean {
  return bindingMatches && unconsumed && expiresAt > asOf;
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftCanPrepare(alreadyPrepared: boolean): boolean {
  return !alreadyPrepared;
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftUnique(matches: number): boolean {
  return matches === 1;
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftExpired(expiresAt: number, asOf: number): boolean {
  return expiresAt <= asOf;
}

/** Story: Drop the draft when I can no longer use it / A draft is written and read only under its current binding (spec/mcpSignupDraft.md) */
//@ pure
export function lawOneDraftPerGrant(alreadyPrepared: boolean): boolean {
  //@ ensures \result === true
  return !alreadyPrepared || !signupDraftCanPrepare(alreadyPrepared);
}

/** Story: Drop the draft when I can no longer use it / The signup result settles the draft (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftAfterSignup(signupResult: string): DraftSettlement {
  return signupResult === "invite_only" || signupResult === "invalid_invitation" || signupResult === "invalid" || signupResult === "invalid_birthdate" || signupResult === "consent_wording" ? "KeepDraft" : "DeleteDraft";
}

/** Story: Drop the draft when I can no longer use it / The signup result settles the draft (spec/mcpSignupDraft.md) */
//@ pure
export function lawUsedOrRefusedForAgeDraftIsDeleted(signupResult: string): boolean {
  //@ ensures \result === true
  return !(signupResult === "joined" || signupResult === "under_age" || signupResult === "review") || signupDraftAfterSignup(signupResult) === "DeleteDraft";
}

/** Story: Drop the draft when I can no longer use it / A recorded age that the app does not allow deletes the draft at once (spec/mcpSignupDraft.md) */
//@ pure
export function signupDraftAfterAgeRecorded(ageAllowed: boolean): DraftSettlement {
  return ageAllowed ? "KeepDraft" : "DeleteDraft";
}

/** Story: Drop the draft when I can no longer use it / A recorded age that the app does not allow deletes the draft at once (spec/mcpSignupDraft.md) */
//@ pure
export function lawRefusedRecordedAgeDeletesDraft(ageAllowed: boolean): boolean {
  //@ ensures \result === true
  return !(!ageAllowed) || signupDraftAfterAgeRecorded(ageAllowed) === "DeleteDraft";
}

/** Story: Drop the draft when I can no longer use it / A recorded age that the app does not allow deletes the draft at once (spec/mcpSignupDraft.md) */
//@ pure
export function lawAllowedRecordedAgeKeepsDraft(ageAllowed: boolean): boolean {
  //@ ensures \result === true
  return !ageAllowed || signupDraftAfterAgeRecorded(ageAllowed) === "KeepDraft";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: DraftPreparation, event: Event): boolean {
  if (event.type === "observeConnection") return canObserveConnection(current);
  if (event.type === "observeAge") return canObserveAge(current);
  if (event.type === "observeOwner") return canObserveOwner(current);
  if (event.type === "observeMembership") return canObserveMembership(current);
  if (event.type === "observeWrite") return canObserveWrite(current);
  if (event.type === "observeAgeAfterWrite") return canObserveAgeAfterWrite(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: DraftPreparation, event: Event): DraftPreparation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "observeConnection") return canObserveConnection(current) ? observeConnection(current, event.grantReady) : current;
  if (event.type === "observeAge") return canObserveAge(current) ? observeAge(current, event.allowed) : current;
  if (event.type === "observeOwner") return canObserveOwner(current) ? observeOwner(current, event.ownerMatches) : current;
  if (event.type === "observeMembership") return canObserveMembership(current) ? observeMembership(current, event.status) : current;
  if (event.type === "observeWrite") return canObserveWrite(current) ? observeWrite(current, event.saved) : current;
  if (event.type === "observeAgeAfterWrite") return canObserveAgeAfterWrite(current) ? observeAgeAfterWrite(current, event.allowed) : current;
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
  if (raw.type === "observeConnection" && typeof raw.grantReady === "boolean") return { type: "observeConnection", grantReady: raw.grantReady };
  if (raw.type === "observeAge" && typeof raw.allowed === "boolean") return { type: "observeAge", allowed: raw.allowed };
  if (raw.type === "observeOwner" && typeof raw.ownerMatches === "boolean") return { type: "observeOwner", ownerMatches: raw.ownerMatches };
  if (raw.type === "observeMembership" && typeof raw.status === "string") return { type: "observeMembership", status: raw.status };
  if (raw.type === "observeWrite" && typeof raw.saved === "boolean") return { type: "observeWrite", saved: raw.saved };
  if (raw.type === "observeAgeAfterWrite" && typeof raw.allowed === "boolean") return { type: "observeAgeAfterWrite", allowed: raw.allowed };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ReadConnection" || raw.phase === "CheckAge" || raw.phase === "CheckOwner" || raw.phase === "CheckMembership" || raw.phase === "WriteDraft" || raw.phase === "RecheckAge" || raw.phase === "Prepared" || raw.phase === "GrantRefused" || raw.phase === "AgeRefused" || raw.phase === "ExistingProfile" || raw.phase === "WriteRefused") && Object.keys(raw).length === 1)) return undefined;
  const parsed: DraftPreparation = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): DraftPreparation {
  //@ ensures inv(\result)
  return initial;
}
