// GENERATED from spec/capitalLedger.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
export type CapitalEventPhase = "CapitalEventStarting" | "InvalidCapitalEvent" | "InspectingCapitalEvent" | "DuplicateCapitalEvent" | "OutOfOrderCapitalEvent" | "AppendingCapitalEvent" | "ApplyingCapitalEvent";
/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
export interface CapitalEventFlow { phase: CapitalEventPhase }
/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
export type AttendanceEvidence = "AttendanceUnverified" | "AttendanceByCounterpart" | "AttendanceIndependentlyVerified";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordLedgerAppend" }
  | { type: "validateLedgerEvent"; valid: boolean }
  | { type: "checkLedgerSource"; duplicate: boolean; inOrder: boolean };

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
export const initial: CapitalEventFlow = { phase: "CapitalEventStarting" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: CapitalEventFlow): boolean {
  return true;
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function canRecordLedgerAppend(flow: CapitalEventFlow): boolean {
  return flow.phase === "AppendingCapitalEvent";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function recordLedgerAppend(flow: CapitalEventFlow): CapitalEventFlow {
  //@ ensures (inv(flow) && canRecordLedgerAppend(flow)) ==> stepApplyFollowsLedgerAppend(flow, "recordLedgerAppend", \result)
  return { phase: "ApplyingCapitalEvent" };
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function stepApplyFollowsLedgerAppend(before: CapitalEventFlow, via: string, after: CapitalEventFlow): boolean {
  return !(after.phase === "ApplyingCapitalEvent") || (before.phase === "AppendingCapitalEvent" && via === "recordLedgerAppend");
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function sometimesAppliesLedgerEvent(flow: CapitalEventFlow): boolean {
  return flow.phase === "ApplyingCapitalEvent";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function sometimesSkipsDuplicateLedgerEvent(flow: CapitalEventFlow): boolean {
  return flow.phase === "DuplicateCapitalEvent";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function sometimesRejectsTimeOrder(flow: CapitalEventFlow): boolean {
  return flow.phase === "OutOfOrderCapitalEvent";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function canValidateLedgerEvent(flow: CapitalEventFlow): boolean {
  return flow.phase === "CapitalEventStarting";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function validateLedgerEvent(flow: CapitalEventFlow, valid: boolean): CapitalEventFlow {
  //@ ensures (inv(flow) && canValidateLedgerEvent(flow)) ==> stepApplyFollowsLedgerAppend(flow, "validateLedgerEvent", \result)
  return { phase: valid ? "InspectingCapitalEvent" : "InvalidCapitalEvent" };
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function canCheckLedgerSource(flow: CapitalEventFlow): boolean {
  return flow.phase === "InspectingCapitalEvent";
}

/** Story: Count what I contributed once and preserve its history / Validate and deduplicate an event before applying it (spec/capitalLedger.md) */
//@ pure
export function checkLedgerSource(flow: CapitalEventFlow, duplicate: boolean, inOrder: boolean): CapitalEventFlow {
  //@ ensures (inv(flow) && canCheckLedgerSource(flow)) ==> stepApplyFollowsLedgerAppend(flow, "checkLedgerSource", \result)
  return { phase: duplicate ? "DuplicateCapitalEvent" : (inOrder ? "AppendingCapitalEvent" : "OutOfOrderCapitalEvent") };
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function capitalHelpSourceMayStart(sameMember: boolean, sourceExists: boolean): boolean {
  return !sameMember && !sourceExists;
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function capitalHelpMayResolve(resolved: boolean, sameRecipient: boolean): boolean {
  return !resolved && sameRecipient;
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function capitalHelpWasUseful(useful: boolean, recipientEligible: boolean): boolean {
  return useful && recipientEligible;
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function capitalAttendanceMayResolve(accepted: boolean, resolved: boolean): boolean {
  return accepted && !resolved;
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function mayEarnCapital(eligible: boolean, removed: boolean, positiveBase: boolean): boolean {
  return eligible && !removed && positiveBase;
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function capitalAttendanceEvidence(hasVerification: boolean, independentlyVerified: boolean): AttendanceEvidence {
  return !hasVerification ? "AttendanceUnverified" : (independentlyVerified ? "AttendanceIndependentlyVerified" : "AttendanceByCounterpart");
}

/** Story: Count what I contributed once and preserve its history / Participation credit needs eligible members and verified outcomes (spec/capitalLedger.md) */
//@ pure
export function acceptsCapitalAttendanceProof(evidence: AttendanceEvidence, hasEligibleConfirmer: boolean): boolean {
  return evidence === "AttendanceIndependentlyVerified" || (evidence === "AttendanceByCounterpart" && hasEligibleConfirmer);
}

/** Story: Count what I contributed once and preserve its history / Organizing and needs use their original contribution source (spec/capitalLedger.md) */
//@ pure
export function organizingCapitalSourceOpen(publicVenue: boolean, alreadyCredited: boolean): boolean {
  return publicVenue && !alreadyCredited;
}

/** Story: Count what I contributed once and preserve its history / Organizing and needs use their original contribution source (spec/capitalLedger.md) */
//@ pure
export function organizingCapitalQuorum(attendees: number, minimum: number): boolean {
  return attendees >= minimum;
}

/** Story: Count what I contributed once and preserve its history / Organizing and needs use their original contribution source (spec/capitalLedger.md) */
//@ pure
export function needCapitalSourceOpen(alreadyCredited: boolean, selfConfirmed: boolean, allowedConfirmer: boolean): boolean {
  return !alreadyCredited && !selfConfirmed && allowedConfirmer;
}

/** Story: Count what I contributed once and preserve its history / A reversal adds a new entry for the original owner (spec/capitalLedger.md) */
//@ pure
export function mayReverseCapitalEntry(sameOwner: boolean, alreadyReversed: boolean): boolean {
  return sameOwner && !alreadyReversed;
}

/** Story: Count what I contributed once and preserve its history / A reversal adds a new entry for the original owner (spec/capitalLedger.md) */
//@ pure
export function isCapitalFraudCandidate(positiveSign: boolean, positiveAmount: boolean, alreadyReversed: boolean): boolean {
  return positiveSign && positiveAmount && !alreadyReversed;
}

/** Story: Count what I contributed once and preserve its history / A reversal adds a new entry for the original owner (spec/capitalLedger.md) */
//@ pure
export function capitalFraudReverses(involved: boolean, basisReversed: boolean): boolean {
  return involved || basisReversed;
}

/** Story: Count what I contributed once and preserve its history / A reversal adds a new entry for the original owner (spec/capitalLedger.md) */
//@ pure
export function lawCapitalCannotReverseAgain(sameOwner: boolean): boolean {
  //@ ensures \result === true
  return !mayReverseCapitalEntry(sameOwner, true);
}

/** Story: Count what I contributed once and preserve its history / A reversal restores room only for a credit in the same rolling period (spec/capitalLedger.md) */
//@ pure
export function capitalEntryUsesPeriodCap(entryAge: number, period: number, positiveSign: boolean, reversesCurrentCredit: boolean): boolean {
  return entryAge < period && (positiveSign || reversesCurrentCredit);
}

/** Story: Count what I contributed once and preserve its history / A reversal restores room only for a credit in the same rolling period (spec/capitalLedger.md) */
//@ pure
export function capitalPeriodRoom(remaining: number): number {
  return remaining <= 0 ? 0 : remaining;
}

/** Story: Count what I contributed once and preserve its history / A reversal restores room only for a credit in the same rolling period (spec/capitalLedger.md) */
//@ pure
export function lawCapitalPeriodRoomIsNonnegative(remaining: number): boolean {
  //@ ensures \result === true
  return capitalPeriodRoom(remaining) >= 0;
}

/** Story: Count what I contributed once and preserve its history / A vouch credit waits for eligibility inside its value window (spec/capitalLedger.md) */
//@ pure
export function vouchCreditMayEarn(qualified: boolean, credited: boolean, stakeTaken: boolean, withinWindow: boolean, inviteeEligible: boolean, voucherEligible: boolean, voucherRemoved: boolean): boolean {
  return qualified && !credited && !stakeTaken && withinWindow && inviteeEligible && voucherEligible && !voucherRemoved;
}

/** Story: Count what I contributed once and preserve its history / A vouch credit waits for eligibility inside its value window (spec/capitalLedger.md) */
//@ pure
export function lawVouchCreditAtMostOnce(qualified: boolean, stakeTaken: boolean, withinWindow: boolean, inviteeEligible: boolean, voucherEligible: boolean, voucherRemoved: boolean): boolean {
  //@ ensures \result === true
  return !vouchCreditMayEarn(qualified, true, stakeTaken, withinWindow, inviteeEligible, voucherEligible, voucherRemoved);
}

/** Story: Count what I contributed once and preserve its history / A vouch stake waits when the voucher is ineligible at removal (spec/capitalLedger.md) */
//@ pure
export function vouchStakeMayDefer(seriousAbuse: boolean, vouched: boolean, stakeTaken: boolean, withinWindow: boolean, voucherEligible: boolean): boolean {
  return seriousAbuse && vouched && !stakeTaken && withinWindow && !voucherEligible;
}

/** Story: Count what I contributed once and preserve its history / A vouch stake waits when the voucher is ineligible at removal (spec/capitalLedger.md) */
//@ pure
export function vouchStakeMayTake(pending: boolean, stakeTaken: boolean, voucherEligible: boolean): boolean {
  return pending && !stakeTaken && voucherEligible;
}

/** Story: Count what I contributed once and preserve its history / A vouch stake waits when the voucher is ineligible at removal (spec/capitalLedger.md) */
//@ pure
export function lawVouchStakeTakenAtMostOnce(seriousAbuse: boolean, vouched: boolean, withinWindow: boolean, pending: boolean, voucherEligible: boolean): boolean {
  //@ ensures \result === true
  return !vouchStakeMayDefer(seriousAbuse, vouched, true, withinWindow, voucherEligible) && !vouchStakeMayTake(pending, true, voucherEligible);
}

/** Story: Count what I contributed once and preserve its history / A vouch stake waits when the voucher is ineligible at removal (spec/capitalLedger.md) */
//@ pure
export function lawVouchStakeNotDeferredAndTaken(seriousAbuse: boolean, vouched: boolean, stakeTaken: boolean, withinWindow: boolean, pending: boolean, voucherEligible: boolean): boolean {
  //@ ensures \result === true
  return !(vouchStakeMayDefer(seriousAbuse, vouched, stakeTaken, withinWindow, voucherEligible) && vouchStakeMayTake(pending, stakeTaken, voucherEligible));
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: CapitalEventFlow, event: Event): boolean {
  if (event.type === "recordLedgerAppend") return canRecordLedgerAppend(current);
  if (event.type === "validateLedgerEvent") return canValidateLedgerEvent(current);
  if (event.type === "checkLedgerSource") return canCheckLedgerSource(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: CapitalEventFlow, event: Event): CapitalEventFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordLedgerAppend") return canRecordLedgerAppend(current) ? recordLedgerAppend(current) : current;
  if (event.type === "validateLedgerEvent") return canValidateLedgerEvent(current) ? validateLedgerEvent(current, event.valid) : current;
  if (event.type === "checkLedgerSource") return canCheckLedgerSource(current) ? checkLedgerSource(current, event.duplicate, event.inOrder) : current;
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
  if (raw.type === "recordLedgerAppend") return { type: "recordLedgerAppend" };
  if (raw.type === "validateLedgerEvent" && typeof raw.valid === "boolean") return { type: "validateLedgerEvent", valid: raw.valid };
  if (raw.type === "checkLedgerSource" && typeof raw.duplicate === "boolean" && typeof raw.inOrder === "boolean") return { type: "checkLedgerSource", duplicate: raw.duplicate, inOrder: raw.inOrder };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): CapitalEventFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CapitalEventStarting" || raw.phase === "InvalidCapitalEvent" || raw.phase === "InspectingCapitalEvent" || raw.phase === "DuplicateCapitalEvent" || raw.phase === "OutOfOrderCapitalEvent" || raw.phase === "AppendingCapitalEvent" || raw.phase === "ApplyingCapitalEvent") && Object.keys(raw).length === 1)) return undefined;
  const parsed: CapitalEventFlow = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): CapitalEventFlow {
  //@ ensures inv(\result)
  return initial;
}
