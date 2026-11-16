// GENERATED from spec/accountPrivacy.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
export type PrivacyPhase = "AwaitingOperation" | "AwaitingLeaveConsent" | "AwaitingAppForget" | "AwaitingAccountAge" | "AwaitingAccountCleanup" | "AwaitingAccountErasure" | "AwaitingAppExport" | "AwaitingConsentExport" | "CompletePrivacyRequest";
/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
export type PrivacyOperation = "LeaveApp" | "DeleteAccount" | "ExportApp";
/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
export interface PrivacyRequest { phase: PrivacyPhase; operation: PrivacyOperation; optedOut: boolean; ageChecked: boolean; cleanupDone: boolean; includeMembership: boolean; membershipBound: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordLeaveConsent"; membershipBound: boolean }
  | { type: "recordAppForget" }
  | { type: "beginPrivacyRequest"; operation: PrivacyOperation }
  | { type: "recordAgeCheck" }
  | { type: "recordAccountCleanup" }
  | { type: "recordAccountErasure" }
  | { type: "checkAppExport"; membershipBound: boolean }
  | { type: "recordConsentExport" };

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
export const initial: PrivacyRequest = { phase: "AwaitingOperation", operation: "LeaveApp", optedOut: false, ageChecked: false, cleanupDone: false, includeMembership: false, membershipBound: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PrivacyRequest): boolean {
  return alwaysLeaveRecordsConsent(current) && alwaysErasureRequiresCleanup(current) && alwaysExportNeedsMembership(current);
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function hasScopedMembership(hasPerson: boolean, hasMembership: boolean, removed: boolean): boolean {
  return hasPerson && hasMembership && !removed;
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function canBeginPrivacyRequest(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingOperation";
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function canRecordLeaveConsent(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingLeaveConsent" && privacy.operation === "LeaveApp";
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function recordLeaveConsent(privacy: PrivacyRequest, membershipBound: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordLeaveConsent(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, optedOut: true, membershipBound: membershipBound, phase: membershipBound ? "AwaitingAppForget" : "CompletePrivacyRequest" };
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function canRecordAppForget(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAppForget" && privacy.operation === "LeaveApp" && privacy.optedOut && privacy.membershipBound;
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function recordAppForget(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAppForget(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "CompletePrivacyRequest" };
}

/** Story: Leave one app and keep my other memberships / A leave records app consent before cleanup (spec/accountPrivacy.md:9) */
//@ pure
export function beginPrivacyRequest(privacy: PrivacyRequest, operation: PrivacyOperation): PrivacyRequest {
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canBeginPrivacyRequest(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...initial, operation: operation, phase: operation === "LeaveApp" ? "AwaitingLeaveConsent" : (operation === "DeleteAccount" ? "AwaitingAccountAge" : "AwaitingAppExport") };
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function hasAgeToPreserve(hasPerson: boolean, hasLowestAge: boolean): boolean {
  return hasPerson && hasLowestAge;
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function canRecordAgeCheck(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountAge" && privacy.operation === "DeleteAccount";
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function recordAgeCheck(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAgeCheck(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAgeCheck(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAgeCheck(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "AwaitingAccountCleanup", ageChecked: true };
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function canRecordAccountCleanup(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountCleanup" && privacy.operation === "DeleteAccount" && privacy.ageChecked;
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function recordAccountCleanup(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAccountCleanup(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "AwaitingAccountErasure", cleanupDone: true };
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function canRecordAccountErasure(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAccountErasure" && privacy.operation === "DeleteAccount" && privacy.ageChecked && privacy.cleanupDone;
}

/** Story: Erase my account / Preserve the age floor before full-account cleanup (spec/accountPrivacy.md:49) */
//@ pure
export function recordAccountErasure(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordAccountErasure(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "CompletePrivacyRequest" };
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md:77) */
//@ pure
export function canCheckAppExport(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingAppExport" && privacy.operation === "ExportApp";
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md:77) */
//@ pure
export function checkAppExport(privacy: PrivacyRequest, membershipBound: boolean): PrivacyRequest {
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canCheckAppExport(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "AwaitingConsentExport", membershipBound: membershipBound, includeMembership: membershipBound };
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md:77) */
//@ pure
export function canRecordConsentExport(privacy: PrivacyRequest): boolean {
  return privacy.phase === "AwaitingConsentExport" && privacy.operation === "ExportApp";
}

/** Story: Read my own app data / A removed or absent membership has no exportable profile (spec/accountPrivacy.md:77) */
//@ pure
export function recordConsentExport(privacy: PrivacyRequest): PrivacyRequest {
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysLeaveRecordsConsent(\result)
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysErasureRequiresCleanup(\result)
  //@ ensures (inv(privacy) && canRecordConsentExport(privacy)) ==> alwaysExportNeedsMembership(\result)
  return { ...privacy, phase: "CompletePrivacyRequest" };
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function alwaysLeaveRecordsConsent(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "LeaveApp" && (privacy.phase === "AwaitingAppForget" || privacy.phase === "CompletePrivacyRequest")) || privacy.optedOut;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function alwaysErasureRequiresCleanup(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "DeleteAccount" && (privacy.phase === "AwaitingAccountErasure" || privacy.phase === "CompletePrivacyRequest")) || (privacy.ageChecked && privacy.cleanupDone);
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function alwaysExportNeedsMembership(privacy: PrivacyRequest): boolean {
  return !(privacy.operation === "ExportApp" && privacy.includeMembership) || privacy.membershipBound;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function lawRemovedMembershipIsExcluded(hasPerson: boolean, hasMembership: boolean): boolean {
  //@ ensures \result === true
  return !hasScopedMembership(hasPerson, hasMembership, true);
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function sometimesLeavesApp(privacy: PrivacyRequest): boolean {
  return privacy.operation === "LeaveApp" && privacy.phase === "CompletePrivacyRequest" && privacy.membershipBound;
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
//@ pure
export function sometimesErasesAccount(privacy: PrivacyRequest): boolean {
  return privacy.operation === "DeleteAccount" && privacy.phase === "CompletePrivacyRequest";
}

/** Story: Read my own app data / The service completes each operation in its own scope (spec/accountPrivacy.md:93) */
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
  if (event.type === "recordAgeCheck") return canRecordAgeCheck(current);
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
  if (event.type === "recordLeaveConsent" && canRecordLeaveConsent(current)) return recordLeaveConsent(current, event.membershipBound);
  if (event.type === "recordAppForget" && canRecordAppForget(current)) return recordAppForget(current);
  if (event.type === "beginPrivacyRequest" && canBeginPrivacyRequest(current)) return beginPrivacyRequest(current, event.operation);
  if (event.type === "recordAgeCheck" && canRecordAgeCheck(current)) return recordAgeCheck(current);
  if (event.type === "recordAccountCleanup" && canRecordAccountCleanup(current)) return recordAccountCleanup(current);
  if (event.type === "recordAccountErasure" && canRecordAccountErasure(current)) return recordAccountErasure(current);
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
  if (raw.type === "recordLeaveConsent" && typeof raw.membershipBound === "boolean") return { type: "recordLeaveConsent", membershipBound: raw.membershipBound };
  if (raw.type === "recordAppForget") return { type: "recordAppForget" };
  if (raw.type === "beginPrivacyRequest" && (raw.operation === "LeaveApp" || raw.operation === "DeleteAccount" || raw.operation === "ExportApp")) return { type: "beginPrivacyRequest", operation: raw.operation };
  if (raw.type === "recordAgeCheck") return { type: "recordAgeCheck" };
  if (raw.type === "recordAccountCleanup") return { type: "recordAccountCleanup" };
  if (raw.type === "recordAccountErasure") return { type: "recordAccountErasure" };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingOperation" || raw.phase === "AwaitingLeaveConsent" || raw.phase === "AwaitingAppForget" || raw.phase === "AwaitingAccountAge" || raw.phase === "AwaitingAccountCleanup" || raw.phase === "AwaitingAccountErasure" || raw.phase === "AwaitingAppExport" || raw.phase === "AwaitingConsentExport" || raw.phase === "CompletePrivacyRequest") && (raw.operation === "LeaveApp" || raw.operation === "DeleteAccount" || raw.operation === "ExportApp") && typeof raw.optedOut === "boolean" && typeof raw.ageChecked === "boolean" && typeof raw.cleanupDone === "boolean" && typeof raw.includeMembership === "boolean" && typeof raw.membershipBound === "boolean" && Object.keys(raw).length === 7)) return undefined;
  const parsed: PrivacyRequest = ({ phase: raw.phase, operation: raw.operation, optedOut: raw.optedOut, ageChecked: raw.ageChecked, cleanupDone: raw.cleanupDone, includeMembership: raw.includeMembership, membershipBound: raw.membershipBound });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PrivacyRequest {
  //@ ensures inv(\result)
  return initial;
}
