// GENERATED from spec/accountPrivacy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
export type PrivacyPhase = "AwaitingOperation" | "AwaitingLeaveConsent" | "AwaitingAppForget" | "AwaitingAccountOwner" | "AwaitingAccountCleanup" | "AwaitingAccountErasure" | "AwaitingAppExport" | "AwaitingConsentExport" | "CompletePrivacyRequest" | "RefusedPrivacyRequest";
/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
export type PrivacyOperation = "LeaveApp" | "DeleteAccount" | "ExportApp";
/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
export interface PrivacyRequest { phase: PrivacyPhase; operation: PrivacyOperation; optedOut: boolean; ownerChecked: boolean; cleanupDone: boolean; includeMembership: boolean; membershipBound: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordLeaveConsent"; recorded: boolean; membershipBound: boolean }
  | { type: "recordAppForget" }
  | { type: "beginPrivacyRequest"; operation: PrivacyOperation }
  | { type: "checkErasureOwner"; authorityCurrent: boolean }
  | { type: "recordAccountCleanup" }
  | { type: "recordAccountErasure"; committed: boolean }
  | { type: "checkAppExport"; membershipBound: boolean }
  | { type: "recordConsentExport" };

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
export const initial: PrivacyRequest = { phase: "AwaitingOperation", operation: "LeaveApp", optedOut: false, ownerChecked: false, cleanupDone: false, includeMembership: false, membershipBound: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PrivacyRequest): boolean {
  return alwaysLeaveRecordsConsent(current) && alwaysErasureRequiresCleanup(current) && alwaysExportNeedsMembership(current);
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function hasScopedMembership(hasPerson: boolean, hasMembership: boolean, removed: boolean): boolean {
  return hasPerson && hasMembership && !removed;
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function appLeaveMemberCurrent(expectedMember: string, currentMember: string, joinedAt: number, requestedAt: number): boolean {
  return expectedMember === "" || (expectedMember === currentMember && joinedAt <= requestedAt);
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function canBeginPrivacyRequest(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingOperation";
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function appLeaveBindingCurrent(verifiedOwner: string, currentOwner: string, held: boolean, verifiedAt: number, requestedAt: number): boolean {
  return verifiedPrivacyOwnerMatches(verifiedOwner, currentOwner, held) && verifiedAt <= requestedAt;
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function canRecordLeaveConsent(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingLeaveConsent" && privacy.operation === "LeaveApp";
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function recordLeaveConsent(privacy: PrivacyRequest, recorded: boolean, membershipBound: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, optedOut: recorded, membershipBound: recorded && membershipBound, phase: !recorded ? "RefusedPrivacyRequest" : (membershipBound ? "AwaitingAppForget" : "CompletePrivacyRequest") };
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function canRecordAppForget(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAppForget" && privacy.operation === "LeaveApp" && privacy.optedOut && privacy.membershipBound;
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function recordAppForget(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "CompletePrivacyRequest" };
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function beginPrivacyRequest(privacy: PrivacyRequest, operation: PrivacyOperation): PrivacyRequest {
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...initial, operation: operation, phase: operation === "LeaveApp" ? "AwaitingLeaveConsent" : (operation === "DeleteAccount" ? "AwaitingAccountOwner" : "AwaitingAppExport") };
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md) */
//@ pure
export function lawLeaveNeverPredatesPhoneBinding(owner: string, verifiedAt: number, requestedAt: number): boolean {
  //@ ensures \result === true
  return !(requestedAt < verifiedAt) || !appLeaveBindingCurrent(owner, owner, false, verifiedAt, requestedAt);
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function verifiedPrivacyOwnerMatches(verifiedOwner: string, currentOwner: string, held: boolean): boolean {
  return !held && verifiedOwner === currentOwner;
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function hasAgeToPreserve(hasPerson: boolean, hasLowestAge: boolean): boolean {
  return hasPerson && hasLowestAge;
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function phoneErasureAllowed(personBound: boolean, hasCurrentOwner: boolean, staffRelease: boolean, exactHeldBinding: boolean): boolean {
  return staffRelease ? personBound && exactHeldBinding : personBound === hasCurrentOwner;
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function lawUnboundErasureCannotRemoveAnOwner(staffRelease: boolean, exactHeldBinding: boolean): boolean {
  //@ ensures \result === true
  return !phoneErasureAllowed(false, true, staffRelease, exactHeldBinding);
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function canCheckErasureOwner(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountOwner" && privacy.operation === "DeleteAccount";
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function checkErasureOwner(privacy: PrivacyRequest, authorityCurrent: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canCheckErasureOwner(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canCheckErasureOwner(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canCheckErasureOwner(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: authorityCurrent ? "AwaitingAccountCleanup" : "RefusedPrivacyRequest", ownerChecked: authorityCurrent };
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function canRecordAccountCleanup(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountCleanup" && privacy.operation === "DeleteAccount" && privacy.ownerChecked;
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function recordAccountCleanup(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "AwaitingAccountErasure", cleanupDone: true };
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function canRecordAccountErasure(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountErasure" && privacy.operation === "DeleteAccount" && privacy.ownerChecked && privacy.cleanupDone;
}

/** Story: Erase my account / Erasure follows the authorized person across a number change (spec/accountPrivacy.md) */
//@ pure
export function recordAccountErasure(privacy: PrivacyRequest, committed: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: committed ? "CompletePrivacyRequest" : "RefusedPrivacyRequest" };
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function lawHeldPhoneCannotExport(verifiedOwner: string, currentOwner: string): boolean {
  //@ ensures \result === true
  return !verifiedPrivacyOwnerMatches(verifiedOwner, currentOwner, true);
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function lawUnboundExportNeedsUnownedPhone(currentOwner: string, held: boolean): boolean {
  //@ ensures \result === true
  return !verifiedPrivacyOwnerMatches("", currentOwner, held) || (currentOwner === "" && !held);
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function canCheckAppExport(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAppExport" && privacy.operation === "ExportApp";
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function checkAppExport(privacy: PrivacyRequest, membershipBound: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "AwaitingConsentExport", membershipBound: membershipBound, includeMembership: membershipBound };
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function canRecordConsentExport(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingConsentExport" && privacy.operation === "ExportApp";
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md) */
//@ pure
export function recordConsentExport(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "CompletePrivacyRequest" };
}

/** Story: Read my own app data / An export includes the member's own facts and photo metadata (spec/accountPrivacy.md) */
//@ pure
export function memberExportFacetAllowed(visibility: string, status: string, provenance: string, facetSource: string, isAppearance: boolean): boolean {
  return !isAppearance && (visibility !== "agent_private" || (status === "confirmed" && (provenance === "said" || facetSource === "gmail" || facetSource === "google_calendar")));
}

/** Story: Read my own app data / An export includes the member's own facts and photo metadata (spec/accountPrivacy.md) */
//@ pure
export function lawAppearanceNeverAppearsInExport(visibility: string, status: string, provenance: string, facetSource: string): boolean {
  //@ ensures \result === true
  return !memberExportFacetAllowed(visibility, status, provenance, facetSource, true);
}

/** Story: Read my own app data / An export includes the member's own facts and photo metadata (spec/accountPrivacy.md) */
//@ pure
export function lawPrivateExportNeedsConfirmation(provenance: string, facetSource: string, isAppearance: boolean): boolean {
  //@ ensures \result === true
  return !memberExportFacetAllowed("agent_private", "proposed", provenance, facetSource, isAppearance);
}

/** Story: Read my own app data / An export includes the member's own gathering responses (spec/accountPrivacy.md) */
//@ pure
export function memberExportGatheringsAllowed(app: string, membershipBound: boolean): boolean {
  return app === "ntwrk" && membershipBound;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function alwaysLeaveRecordsConsent(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "LeaveApp" && (privacy.phase === "AwaitingAppForget" || privacy.phase === "CompletePrivacyRequest")) || privacy.optedOut;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function alwaysErasureRequiresCleanup(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "DeleteAccount" && (privacy.phase === "AwaitingAccountErasure" || privacy.phase === "CompletePrivacyRequest")) || (privacy.ownerChecked && privacy.cleanupDone);
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function alwaysExportNeedsMembership(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "ExportApp" && privacy.includeMembership) || privacy.membershipBound;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function lawRemovedMembershipIsExcluded(hasPerson: boolean, hasMembership: boolean): boolean {
  //@ ensures \result === true
  return !hasScopedMembership(hasPerson, hasMembership, true);
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function sometimesLeavesApp(privacy: PrivacyRequest): boolean {
  return privacy.operation === "LeaveApp" && privacy.phase === "CompletePrivacyRequest" && privacy.membershipBound;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function sometimesErasesAccount(privacy: PrivacyRequest): boolean {
  return privacy.operation === "DeleteAccount" && privacy.phase === "CompletePrivacyRequest";
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md) */
//@ pure
export function sometimesExportsMembership(privacy: PrivacyRequest): boolean {
  return privacy.operation === "ExportApp" && privacy.phase === "CompletePrivacyRequest" && privacy.includeMembership;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PrivacyRequest, event: Event): boolean {
  if (event.type === "recordLeaveConsent") return canRecordLeaveConsent(current);
  if (event.type === "recordAppForget") return canRecordAppForget(current);
  if (event.type === "beginPrivacyRequest") return canBeginPrivacyRequest(current);
  if (event.type === "checkErasureOwner") return canCheckErasureOwner(current);
  if (event.type === "recordAccountCleanup") return canRecordAccountCleanup(current);
  if (event.type === "recordAccountErasure") return canRecordAccountErasure(current);
  if (event.type === "checkAppExport") return canCheckAppExport(current);
  if (event.type === "recordConsentExport") return canRecordConsentExport(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PrivacyRequest, event: Event): PrivacyRequest {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordLeaveConsent" && canRecordLeaveConsent(current)) return recordLeaveConsent(current, event.recorded, event.membershipBound);
  if (event.type === "recordAppForget" && canRecordAppForget(current)) return recordAppForget(current);
  if (event.type === "beginPrivacyRequest" && canBeginPrivacyRequest(current)) return beginPrivacyRequest(current, event.operation);
  if (event.type === "checkErasureOwner" && canCheckErasureOwner(current)) return checkErasureOwner(current, event.authorityCurrent);
  if (event.type === "recordAccountCleanup" && canRecordAccountCleanup(current)) return recordAccountCleanup(current);
  if (event.type === "recordAccountErasure" && canRecordAccountErasure(current)) return recordAccountErasure(current, event.committed);
  if (event.type === "checkAppExport" && canCheckAppExport(current)) return checkAppExport(current, event.membershipBound);
  if (event.type === "recordConsentExport" && canRecordConsentExport(current)) return recordConsentExport(current);
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
  if (raw.type === "recordLeaveConsent" && typeof raw.recorded === "boolean" && typeof raw.membershipBound === "boolean") return { type: "recordLeaveConsent", recorded: raw.recorded, membershipBound: raw.membershipBound };
  if (raw.type === "recordAppForget") return { type: "recordAppForget" };
  if (raw.type === "beginPrivacyRequest" && (raw.operation === "LeaveApp" || raw.operation === "DeleteAccount" || raw.operation === "ExportApp")) return { type: "beginPrivacyRequest", operation: raw.operation };
  if (raw.type === "checkErasureOwner" && typeof raw.authorityCurrent === "boolean") return { type: "checkErasureOwner", authorityCurrent: raw.authorityCurrent };
  if (raw.type === "recordAccountCleanup") return { type: "recordAccountCleanup" };
  if (raw.type === "recordAccountErasure" && typeof raw.committed === "boolean") return { type: "recordAccountErasure", committed: raw.committed };
  if (raw.type === "checkAppExport" && typeof raw.membershipBound === "boolean") return { type: "checkAppExport", membershipBound: raw.membershipBound };
  if (raw.type === "recordConsentExport") return { type: "recordConsentExport" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PrivacyRequest | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingOperation" || raw.phase === "AwaitingLeaveConsent" || raw.phase === "AwaitingAppForget" || raw.phase === "AwaitingAccountOwner" || raw.phase === "AwaitingAccountCleanup" || raw.phase === "AwaitingAccountErasure" || raw.phase === "AwaitingAppExport" || raw.phase === "AwaitingConsentExport" || raw.phase === "CompletePrivacyRequest" || raw.phase === "RefusedPrivacyRequest") && (raw.operation === "LeaveApp" || raw.operation === "DeleteAccount" || raw.operation === "ExportApp") && typeof raw.optedOut === "boolean" && typeof raw.ownerChecked === "boolean" && typeof raw.cleanupDone === "boolean" && typeof raw.includeMembership === "boolean" && typeof raw.membershipBound === "boolean" && Object.keys(raw).length === 7)) return undefined;
  const parsed: PrivacyRequest = ({ phase: raw.phase, operation: raw.operation, optedOut: raw.optedOut, ownerChecked: raw.ownerChecked, cleanupDone: raw.cleanupDone, includeMembership: raw.includeMembership, membershipBound: raw.membershipBound });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PrivacyRequest {
  //@ ensures inv(\result)
  return initial;
}
