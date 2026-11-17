// GENERATED from spec/staffSafetyService.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
export type ServiceSafetyPhase = "ServiceSafetyStarting" | "HoldRemainingTargets" | "HoldDidNotApply" | "BanNeedsCrossApp" | "BanNoPerson" | "ReadingBanPhones" | "BanNoPhone" | "ReadingExistingBan" | "BanAlreadyExists" | "ApplyingPhoneBan" | "ApplyingPersonBan" | "ResumingBanProjection" | "PerformingAuditedAction" | "RecordingAuditResult";
/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
export interface ServiceSafetyFlow { phase: ServiceSafetyPhase; phoneOnly: boolean }
/** Story: Resolve a minor signal without dismissing a valid concern / Age clearance dismisses only the selected member's open minor reports (spec/staffSafetyService.md) */
export type StaffClearSummary = "ClearRefused" | "ClearSucceeded" | "ClearNoSignal";

/** One variant per transition in the spec. */
export type Event =
  | { type: "readPrimaryHold"; applied: boolean }
  | { type: "recordRequestedSafetyAudit" }
  | { type: "recordCompletedSafetyAction" }
  | { type: "startStaffBan"; everywhere: boolean; hasPerson: boolean; phoneOnly: boolean }
  | { type: "readStaffBanPhones"; hasPhone: boolean }
  | { type: "checkExistingStaffBan"; alreadyBanned: boolean; pendingProjection: boolean };

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
export const initial: ServiceSafetyFlow = { phase: "ServiceSafetyStarting", phoneOnly: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ServiceSafetyFlow): boolean {
  return true;
}

/** Story: Hold a member without exposing their other memberships / Staff act within their resolved scope (spec/staffSafetyService.md) */
//@ pure
export function staffSafetyMembershipLive(membership: string): boolean {
  return membership !== "removed" && membership !== "invited";
}

/** Story: Hold a member without exposing their other memberships / Staff act within their resolved scope (spec/staffSafetyService.md) */
//@ pure
export function staffSafetySelectsTarget(everywhere: boolean, requestedRuntime: boolean): boolean {
  return everywhere || requestedRuntime;
}

/** Story: Hold a member without exposing their other memberships / Staff act within their resolved scope (spec/staffSafetyService.md) */
//@ pure
export function staffSafetyAuditScope(targets: number): string {
  return targets > 1 ? "every_app" : "this_app";
}

/** Story: Hold a member without exposing their other memberships / Staff act within their resolved scope (spec/staffSafetyService.md) */
//@ pure
export function lawLocalStaffTargetStaysInScope(requestedRuntime: boolean): boolean {
  //@ ensures \result === true
  return !staffSafetySelectsTarget(false, requestedRuntime) || requestedRuntime;
}

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
//@ pure
export function staffSafetyReportFor(ownsReport: boolean, reportId: string): string {
  return ownsReport ? reportId : "";
}

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
//@ pure
export function canReadPrimaryHold(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ServiceSafetyStarting";
}

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
//@ pure
export function readPrimaryHold(flow: ServiceSafetyFlow, applied: boolean): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canReadPrimaryHold(flow)) ==> stepSafetyResultFollowsAction(flow, "readPrimaryHold", \result)
  return { ...flow, phase: applied ? "HoldRemainingTargets" : "HoldDidNotApply" };
}

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
//@ pure
export function lawOtherTargetsGetNoReport(reportId: string): boolean {
  //@ ensures \result === true
  return staffSafetyReportFor(false, reportId) === "";
}

/** Story: Hold a member without exposing their other memberships / Apply a hold to the requested member first (spec/staffSafetyService.md) */
//@ pure
export function sometimesCanHoldRelatedTargets(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "HoldRemainingTargets";
}

/** Story: Hold a member without exposing their other memberships / Keep the requested and result audits in order (spec/staffSafetyService.md) */
//@ pure
export function canRecordRequestedSafetyAudit(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ServiceSafetyStarting";
}

/** Story: Hold a member without exposing their other memberships / Keep the requested and result audits in order (spec/staffSafetyService.md) */
//@ pure
export function recordRequestedSafetyAudit(flow: ServiceSafetyFlow): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canRecordRequestedSafetyAudit(flow)) ==> stepSafetyResultFollowsAction(flow, "recordRequestedSafetyAudit", \result)
  return { ...flow, phase: "PerformingAuditedAction" };
}

/** Story: Hold a member without exposing their other memberships / Keep the requested and result audits in order (spec/staffSafetyService.md) */
//@ pure
export function canRecordCompletedSafetyAction(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "PerformingAuditedAction";
}

/** Story: Hold a member without exposing their other memberships / Keep the requested and result audits in order (spec/staffSafetyService.md) */
//@ pure
export function recordCompletedSafetyAction(flow: ServiceSafetyFlow): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canRecordCompletedSafetyAction(flow)) ==> stepSafetyResultFollowsAction(flow, "recordCompletedSafetyAction", \result)
  return { ...flow, phase: "RecordingAuditResult" };
}

/** Story: Hold a member without exposing their other memberships / Keep the requested and result audits in order (spec/staffSafetyService.md) */
//@ pure
export function stepSafetyResultFollowsAction(before: ServiceSafetyFlow, via: string, after: ServiceSafetyFlow): boolean {
  return !(after.phase === "RecordingAuditResult") || (before.phase === "PerformingAuditedAction" && via === "recordCompletedSafetyAction");
}

/** Story: Resolve a minor signal without dismissing a valid concern / Age clearance dismisses only the selected member's open minor reports (spec/staffSafetyService.md) */
//@ pure
export function staffAgeMayReviewReports(cleared: boolean, noSignal: boolean): boolean {
  return cleared || noSignal;
}

/** Story: Resolve a minor signal without dismissing a valid concern / Age clearance dismisses only the selected member's open minor reports (spec/staffSafetyService.md) */
//@ pure
export function staffMinorReportDismissible(sameMember: boolean, minorReport: boolean, open: boolean): boolean {
  return sameMember && minorReport && open;
}

/** Story: Resolve a minor signal without dismissing a valid concern / Age clearance dismisses only the selected member's open minor reports (spec/staffSafetyService.md) */
//@ pure
export function staffAgeAppCleared(cleared: boolean, dismissed: boolean): boolean {
  return cleared || dismissed;
}

/** Story: Resolve a minor signal without dismissing a valid concern / Age clearance dismisses only the selected member's open minor reports (spec/staffSafetyService.md) */
//@ pure
export function staffAgeClearSummary(refused: boolean, anyCleared: boolean): StaffClearSummary {
  return refused ? "ClearRefused" : (anyCleared ? "ClearSucceeded" : "ClearNoSignal");
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function canStartStaffBan(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ServiceSafetyStarting";
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function startStaffBan(flow: ServiceSafetyFlow, everywhere: boolean, hasPerson: boolean, phoneOnly: boolean): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canStartStaffBan(flow)) ==> stepSafetyResultFollowsAction(flow, "startStaffBan", \result)
  return { phoneOnly: phoneOnly, phase: !everywhere ? "BanNeedsCrossApp" : (!hasPerson ? "BanNoPerson" : "ReadingBanPhones") };
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function canReadStaffBanPhones(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ReadingBanPhones";
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function readStaffBanPhones(flow: ServiceSafetyFlow, hasPhone: boolean): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canReadStaffBanPhones(flow)) ==> stepSafetyResultFollowsAction(flow, "readStaffBanPhones", \result)
  return { ...flow, phase: flow.phoneOnly && !hasPhone ? "BanNoPhone" : "ReadingExistingBan" };
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function canCheckExistingStaffBan(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ReadingExistingBan";
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function checkExistingStaffBan(flow: ServiceSafetyFlow, alreadyBanned: boolean, pendingProjection: boolean): ServiceSafetyFlow {
  //@ ensures (inv(flow) && canCheckExistingStaffBan(flow)) ==> stepSafetyResultFollowsAction(flow, "checkExistingStaffBan", \result)
  return { ...flow, phase: alreadyBanned && pendingProjection ? "ResumingBanProjection" : (alreadyBanned ? "BanAlreadyExists" : (flow.phoneOnly ? "ApplyingPhoneBan" : "ApplyingPersonBan")) };
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function sometimesAppliesPhoneBan(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ApplyingPhoneBan";
}

/** Story: Apply a confirmed phone or person ban / Both ban scopes require authority on every app and a linked person (spec/staffSafetyService.md) */
//@ pure
export function sometimesAppliesPersonBan(flow: ServiceSafetyFlow): boolean {
  return flow.phase === "ApplyingPersonBan";
}

/** Story: Apply a confirmed phone or person ban / A ban covers the reported number and the number current at the decision (spec/staffSafetyService.md) */
//@ pure
export function includeLockedBanPhone(observedHash: string, currentHash: string): boolean {
  return observedHash !== "" && currentHash !== "" && currentHash !== observedHash;
}

/** Story: Apply a confirmed phone or person ban / A ban covers the reported number and the number current at the decision (spec/staffSafetyService.md) */
//@ pure
export function lawNoDuplicateLockedBanPhone(hash: string): boolean {
  //@ ensures \result === true
  return !includeLockedBanPhone(hash, hash);
}

/** Story: Apply a confirmed phone or person ban / An interrupted ban resumes from its saved authority (spec/staffSafetyService.md) */
//@ pure
export function lawIncompleteRecordedBanCanResume(flow: ServiceSafetyFlow): boolean {
  //@ ensures \result === true
  return checkExistingStaffBan(flow, true, true).phase === "ResumingBanProjection";
}

/** Story: Apply a confirmed phone or person ban / An interrupted ban resumes from its saved authority (spec/staffSafetyService.md) */
//@ pure
export function lawCompletedBanCannotResume(flow: ServiceSafetyFlow): boolean {
  //@ ensures \result === true
  return checkExistingStaffBan(flow, true, false).phase === "BanAlreadyExists";
}

/** Story: Apply a confirmed phone or person ban / Live enrollment and ban projection use the current person (spec/staffSafetyService.md) */
//@ pure
export function staffBanEnrollmentAllowed(liveOwner: boolean, verifiedBinding: boolean, banned: boolean): boolean {
  return liveOwner && verifiedBinding && !banned;
}

/** Story: Apply a confirmed phone or person ban / Live enrollment and ban projection use the current person (spec/staffSafetyService.md) */
//@ pure
export function staffBanSnapshotStatus(accountStatus: string, banned: boolean): string {
  return banned ? "restricted" : accountStatus;
}

/** Story: Apply a confirmed phone or person ban / Live enrollment and ban projection use the current person (spec/staffSafetyService.md) */
//@ pure
export function lawBannedEnrollmentCannotCommit(liveOwner: boolean, verifiedBinding: boolean): boolean {
  //@ ensures \result === true
  return !staffBanEnrollmentAllowed(liveOwner, verifiedBinding, true);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ServiceSafetyFlow, event: Event): boolean {
  if (event.type === "readPrimaryHold") return canReadPrimaryHold(current);
  if (event.type === "recordRequestedSafetyAudit") return canRecordRequestedSafetyAudit(current);
  if (event.type === "recordCompletedSafetyAction") return canRecordCompletedSafetyAction(current);
  if (event.type === "startStaffBan") return canStartStaffBan(current);
  if (event.type === "readStaffBanPhones") return canReadStaffBanPhones(current);
  if (event.type === "checkExistingStaffBan") return canCheckExistingStaffBan(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ServiceSafetyFlow, event: Event): ServiceSafetyFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readPrimaryHold") return canReadPrimaryHold(current) ? readPrimaryHold(current, event.applied) : current;
  if (event.type === "recordRequestedSafetyAudit") return canRecordRequestedSafetyAudit(current) ? recordRequestedSafetyAudit(current) : current;
  if (event.type === "recordCompletedSafetyAction") return canRecordCompletedSafetyAction(current) ? recordCompletedSafetyAction(current) : current;
  if (event.type === "startStaffBan") return canStartStaffBan(current) ? startStaffBan(current, event.everywhere, event.hasPerson, event.phoneOnly) : current;
  if (event.type === "readStaffBanPhones") return canReadStaffBanPhones(current) ? readStaffBanPhones(current, event.hasPhone) : current;
  if (event.type === "checkExistingStaffBan") return canCheckExistingStaffBan(current) ? checkExistingStaffBan(current, event.alreadyBanned, event.pendingProjection) : current;
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
  if (raw.type === "readPrimaryHold" && typeof raw.applied === "boolean") return { type: "readPrimaryHold", applied: raw.applied };
  if (raw.type === "recordRequestedSafetyAudit") return { type: "recordRequestedSafetyAudit" };
  if (raw.type === "recordCompletedSafetyAction") return { type: "recordCompletedSafetyAction" };
  if (raw.type === "startStaffBan" && typeof raw.everywhere === "boolean" && typeof raw.hasPerson === "boolean" && typeof raw.phoneOnly === "boolean") return { type: "startStaffBan", everywhere: raw.everywhere, hasPerson: raw.hasPerson, phoneOnly: raw.phoneOnly };
  if (raw.type === "readStaffBanPhones" && typeof raw.hasPhone === "boolean") return { type: "readStaffBanPhones", hasPhone: raw.hasPhone };
  if (raw.type === "checkExistingStaffBan" && typeof raw.alreadyBanned === "boolean" && typeof raw.pendingProjection === "boolean") return { type: "checkExistingStaffBan", alreadyBanned: raw.alreadyBanned, pendingProjection: raw.pendingProjection };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ServiceSafetyFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ServiceSafetyStarting" || raw.phase === "HoldRemainingTargets" || raw.phase === "HoldDidNotApply" || raw.phase === "BanNeedsCrossApp" || raw.phase === "BanNoPerson" || raw.phase === "ReadingBanPhones" || raw.phase === "BanNoPhone" || raw.phase === "ReadingExistingBan" || raw.phase === "BanAlreadyExists" || raw.phase === "ApplyingPhoneBan" || raw.phase === "ApplyingPersonBan" || raw.phase === "ResumingBanProjection" || raw.phase === "PerformingAuditedAction" || raw.phase === "RecordingAuditResult") && typeof raw.phoneOnly === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: ServiceSafetyFlow = ({ phase: raw.phase, phoneOnly: raw.phoneOnly });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ServiceSafetyFlow {
  //@ ensures inv(\result)
  return initial;
}
