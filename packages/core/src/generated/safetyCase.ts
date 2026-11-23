// GENERATED from spec/safetyCase.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export type CasePhase = "NoCase" | "CaseOpen" | "CaseHeld" | "CaseLifted" | "CaseClosed";
/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export interface SafetyCase { phase: CasePhase }
/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
export type StaffActionResult = "AllowedAction" | "ActorRequired" | "NotOnHold" | "UnknownCase" | "AlreadyClosed" | "UnknownReport" | "UnknownMember" | "NoMinorSignal" | "AgeUnknown" | "RecordMinor" | "StatedMinor" | "TeenBarred" | "TeenOlderReported";
/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
export type ReportPhase = "ReportOpen" | "ReportHeld" | "ReportBanned" | "ReportDismissed";
/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
export type ReportDecision = "HoldReport" | "BanReport" | "DismissReport";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordCaseEvent"; liftEvent: boolean; decayEvent: boolean }
  | { type: "markCaseHeld" }
  | { type: "markCaseLifted" }
  | { type: "closeCase" };

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
export const initial: SafetyCase = { phase: "NoCase" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SafetyCase): boolean {
  return true;
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function canRecordCaseEvent(c: SafetyCase): boolean {
  return c.phase !== "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function recordCaseEvent(c: SafetyCase, liftEvent: boolean, decayEvent: boolean): SafetyCase {
  //@ ensures (inv(c) && canRecordCaseEvent(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return decayEvent ? c : (c.phase === "NoCase" || (c.phase === "CaseLifted" && !liftEvent) ? ({ phase: "CaseOpen" } as SafetyCase) : c);
}

/** Story: Review a safety case without removing a hold by accident / An event opens a case or adds to its current record (spec/safetyCase.md) */
//@ pure
export function lawDecayNeverOpensCase(liftEvent: boolean): boolean {
  //@ ensures \result === true
  return equal_safetyCase(recordCaseEvent(initial, liftEvent, true), initial);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function liveCase(c: SafetyCase): boolean {
  return c.phase !== "NoCase" && c.phase !== "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function markCaseHeld(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canMarkCaseHeld(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseHeld" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function markCaseLifted(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canMarkCaseLifted(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseLifted" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function closeCase(c: SafetyCase): SafetyCase {
  //@ ensures (inv(c) && canCloseCase(c)) ==> stepClosedCaseStaysClosed(c, \result)
  return { phase: "CaseClosed" };
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function stepClosedCaseStaysClosed(before: SafetyCase, after: SafetyCase): boolean {
  return !(before.phase === "CaseClosed") || after.phase === "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function sometimesCaseCloses(c: SafetyCase): boolean {
  return c.phase === "CaseClosed";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function sometimesCaseWasLifted(c: SafetyCase): boolean {
  return c.phase === "CaseLifted";
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canMarkCaseHeld(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canMarkCaseLifted(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A recorded hold or lift updates the open case (spec/safetyCase.md) */
//@ pure
export function canCloseCase(c: SafetyCase): boolean {
  return liveCase(c);
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdSubjectKnown(knownMember: boolean, reportOnFile: boolean): boolean {
  return knownMember || reportOnFile;
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdLiftResult(actorPresent: boolean, currentlyHeld: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (currentlyHeld ? "AllowedAction" : "NotOnHold");
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function caseCloseResult(actorPresent: boolean, casePhase: CasePhase): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (casePhase === "NoCase" ? "UnknownCase" : (casePhase === "CaseClosed" ? "AlreadyClosed" : "AllowedAction"));
}

/** Story: Review a safety case without removing a hold by accident / A staff action requires an actor and an applicable record (spec/safetyCase.md) */
//@ pure
export function holdAuthority(actorPresent: boolean, reportMatches: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (!reportMatches ? "UnknownReport" : "AllowedAction");
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function immediateDangerReply(directText: boolean, currentDanger: boolean): boolean {
  return directText && currentDanger;
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function emergencyCheckInReport(exactReceipt: boolean, attributedReport: boolean): boolean {
  return exactReceipt && attributedReport;
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyReplyRequiresOwnText(currentDanger: boolean): boolean {
  //@ ensures \result === true
  return !immediateDangerReply(false, currentDanger);
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyReplyRequiresCurrentDanger(directText: boolean): boolean {
  //@ ensures \result === true
  return !immediateDangerReply(directText, false);
}

/** Story: Get immediate safety guidance in a member conversation / Direct current-danger text gets immediate guidance first (spec/safetyCase.md) */
//@ pure
export function lawEmergencyCheckInNeedsReceipt(attributedReport: boolean): boolean {
  //@ ensures \result === true
  return !emergencyCheckInReport(false, attributedReport);
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function reportAfterDecision(reportPhase: ReportPhase, decision: ReportDecision, sameMember: boolean, reportMatches: boolean): ReportPhase {
  return !sameMember ? reportPhase : (decision === "BanReport" && (reportPhase === "ReportOpen" || reportPhase === "ReportHeld") ? "ReportBanned" : (reportMatches && reportPhase === "ReportOpen" ? (decision === "HoldReport" ? "ReportHeld" : (decision === "DismissReport" ? "ReportDismissed" : reportPhase)) : reportPhase));
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function reportRestrictsMatching(reportPhase: ReportPhase, metBefore: boolean, urgent: boolean): boolean {
  return reportPhase === "ReportOpen" && metBefore && urgent;
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function lawDecidedReportDoesNotRestrictMatching(decision: ReportDecision, metBefore: boolean, urgent: boolean): boolean {
  //@ ensures \result === true
  return !reportRestrictsMatching(reportAfterDecision("ReportOpen", decision, true, true), metBefore, urgent);
}

/** Story: Resolve a report with its own disposition / A hold, ban, or dismissal updates the matching report (spec/safetyCase.md) */
//@ pure
export function lawDismissedReportStaysDismissed(decision: ReportDecision, sameMember: boolean, reportMatches: boolean): boolean {
  //@ ensures \result === true
  return reportAfterDecision("ReportDismissed", decision, sameMember, reportMatches) === "ReportDismissed";
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function archivedReportHoldAllowed(exactSubject: boolean, matchingRestriction: boolean): boolean {
  return exactSubject && matchingRestriction;
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawArchivedHoldRequiresExactSubject(matchingRestriction: boolean): boolean {
  //@ ensures \result === true
  return !archivedReportHoldAllowed(false, matchingRestriction);
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function carryReportOnAppLeave(ordinaryLeave: boolean, reportPhase: ReportPhase, metBefore: boolean, urgent: boolean): boolean {
  return ordinaryLeave && reportRestrictsMatching(reportPhase, metBefore, urgent);
}

/** Story: Resolve a report with its own disposition / The exact open report follows its subject through ordinary app leave (spec/safetyCase.md) */
//@ pure
export function lawOnlyOpenReportsCarry(ordinaryLeave: boolean, reportPhase: ReportPhase, metBefore: boolean, urgent: boolean): boolean {
  //@ ensures \result === true
  return !carryReportOnAppLeave(ordinaryLeave, reportPhase, metBefore, urgent) || reportPhase === "ReportOpen";
}

/** Story: Resolve a report with its own disposition / A ban allows only carrier commands and app leave (spec/safetyCase.md) */
//@ pure
export function inboundAllowedAfterBan(banned: boolean, compliance: boolean): boolean {
  return !banned || compliance;
}

/** Story: Resolve a report with its own disposition / A ban allows only carrier commands and app leave (spec/safetyCase.md) */
//@ pure
export function lawBanBlocksOrdinaryInbound(compliance: boolean): boolean {
  //@ ensures \result === true
  return inboundAllowedAfterBan(true, compliance) === compliance;
}

/** Story: Clear a mistaken minor signal after checking ages / A clear requires a known adult record and no stated minor age (spec/safetyCase.md) */
//@ pure
export function minorClearResult(actorPresent: boolean, memberKnown: boolean, hasSignal: boolean, ageKnown: boolean, recordMinor: boolean, statedMinor: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (!memberKnown ? "UnknownMember" : (!hasSignal ? "NoMinorSignal" : (!ageKnown ? "AgeUnknown" : (recordMinor ? "RecordMinor" : (statedMinor ? "StatedMinor" : "AllowedAction")))));
}

/** Story: Clear a mistaken minor signal after checking ages / Staff clear doubt about a teen's age only for a clean teen birth date (spec/safetyCase.md) */
//@ pure
export function teenDoubtClearResult(actorPresent: boolean, memberKnown: boolean, hasDoubt: boolean, birthExact: boolean, birthTeen: boolean, barred: boolean, olderOrLyingReport: boolean): StaffActionResult {
  return !actorPresent ? "ActorRequired" : (!memberKnown ? "UnknownMember" : (!hasDoubt ? "NoMinorSignal" : (!birthExact || !birthTeen ? "AgeUnknown" : (barred ? "TeenBarred" : (olderOrLyingReport ? "TeenOlderReported" : "AllowedAction")))));
}

/** Story: Clear a mistaken minor signal after checking ages / Staff clear doubt about a teen's age only for a clean teen birth date (spec/safetyCase.md) */
//@ pure
export function lawTeenDoubtClearNeverClearsABar(actorPresent: boolean, memberKnown: boolean, hasDoubt: boolean, birthExact: boolean, birthTeen: boolean, olderOrLyingReport: boolean): boolean {
  //@ ensures \result === true
  return teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthTeen, true, olderOrLyingReport) !== "AllowedAction";
}

/** Story: Clear a mistaken minor signal after checking ages / Staff clear doubt about a teen's age only for a clean teen birth date (spec/safetyCase.md) */
//@ pure
export function lawTeenDoubtClearNeverClearsOlderReport(actorPresent: boolean, memberKnown: boolean, hasDoubt: boolean, birthExact: boolean, birthTeen: boolean, barred: boolean): boolean {
  //@ ensures \result === true
  return teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthTeen, barred, true) !== "AllowedAction";
}

/** Story: Clear a mistaken minor signal after checking ages / Staff clear doubt about a teen's age only for a clean teen birth date (spec/safetyCase.md) */
//@ pure
export function lawTeenDoubtClearNeedsExactTeenBirth(actorPresent: boolean, memberKnown: boolean, hasDoubt: boolean, birthExact: boolean, birthTeen: boolean, barred: boolean, olderOrLyingReport: boolean): boolean {
  //@ ensures \result === true
  return !(teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthTeen, barred, olderOrLyingReport) === "AllowedAction") || (actorPresent && memberKnown && hasDoubt && birthExact && birthTeen && !barred && !olderOrLyingReport);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function personMinorSignalOpen(signalKnown: boolean, signalAt: number, clearedKnown: boolean, clearedAt: number): boolean {
  return signalKnown && (!clearedKnown || signalAt > clearedAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawAnUnclearedMinorSignalHoldsThePerson(signalAt: number): boolean {
  //@ ensures \result === true
  return personMinorSignalOpen(true, signalAt, false, 0);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawAClearAtOrAfterTheSignalEndsIt(signalAt: number, clearedAt: number): boolean {
  //@ ensures \result === true
  return !(clearedAt >= signalAt) || !personMinorSignalOpen(true, signalAt, true, clearedAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawANewSignalAfterAClearHoldsAgain(signalAt: number, clearedAt: number): boolean {
  //@ ensures \result === true
  return !(signalAt > clearedAt) || personMinorSignalOpen(true, signalAt, true, clearedAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawNoSignalHoldsNobody(signalAt: number, clearedKnown: boolean, clearedAt: number): boolean {
  //@ ensures \result === true
  return !personMinorSignalOpen(false, signalAt, clearedKnown, clearedAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function personMinorSignalEndsEverywhere(everyMembershipCleared: boolean, signalAt: number, earliestClearAt: number): boolean {
  return everyMembershipCleared && !personMinorSignalOpen(true, signalAt, true, earliestClearAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawAnUnclearedMembershipKeepsThePersonSignal(signalAt: number, earliestClearAt: number): boolean {
  //@ ensures \result === true
  return !personMinorSignalEndsEverywhere(false, signalAt, earliestClearAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawASignalAfterTheEarliestClearStays(signalAt: number, earliestClearAt: number): boolean {
  //@ ensures \result === true
  return !(signalAt > earliestClearAt) || !personMinorSignalEndsEverywhere(true, signalAt, earliestClearAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A minor signal on one app holds the person on every app until a later clear (spec/safetyCase.md) */
//@ pure
export function lawClearsAtOrAfterTheSignalEverywhereEndIt(signalAt: number, earliestClearAt: number): boolean {
  //@ ensures \result === true
  return !(earliestClearAt >= signalAt) || personMinorSignalEndsEverywhere(true, signalAt, earliestClearAt);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function pairOpportunityClosesOnBlock(open: boolean, bothOnIt: boolean): boolean {
  return open && bothOnIt;
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function pairBlockCancellationGoesTo(booked: boolean, actorKnown: boolean, isActor: boolean): boolean {
  return booked && (!actorKnown || !isActor);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawOtherOpportunitiesStay(open: boolean, bothOnIt: boolean): boolean {
  //@ ensures \result === true
  return !(!bothOnIt) || !pairOpportunityClosesOnBlock(open, bothOnIt);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawAClosedOpportunityStaysClosed(bothOnIt: boolean): boolean {
  //@ ensures \result === true
  return !pairOpportunityClosesOnBlock(false, bothOnIt);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawTheKnownActorGetsNoCancellation(booked: boolean): boolean {
  //@ ensures \result === true
  return !pairBlockCancellationGoesTo(booked, true, true);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawTheOthersOfABookingHearItIsOff(actorKnown: boolean): boolean {
  //@ ensures \result === true
  return pairBlockCancellationGoesTo(true, actorKnown, false);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawWithAnUnknownActorEveryParticipantHears(isActor: boolean): boolean {
  //@ ensures \result === true
  return pairBlockCancellationGoesTo(true, false, isActor);
}

/** Story: Clear a mistaken minor signal after checking ages / A block or a report about a person closes every open opportunity of the pair (spec/safetyCase.md) */
//@ pure
export function lawNoCancellationBeforeABooking(actorKnown: boolean, isActor: boolean): boolean {
  //@ ensures \result === true
  return !pairBlockCancellationGoesTo(false, actorKnown, isActor);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SafetyCase, event: Event): boolean {
  if (event.type === "recordCaseEvent") return canRecordCaseEvent(current);
  if (event.type === "markCaseHeld") return canMarkCaseHeld(current);
  if (event.type === "markCaseLifted") return canMarkCaseLifted(current);
  if (event.type === "closeCase") return canCloseCase(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SafetyCase, event: Event): SafetyCase {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordCaseEvent") return canRecordCaseEvent(current) ? recordCaseEvent(current, event.liftEvent, event.decayEvent) : current;
  if (event.type === "markCaseHeld") return canMarkCaseHeld(current) ? markCaseHeld(current) : current;
  if (event.type === "markCaseLifted") return canMarkCaseLifted(current) ? markCaseLifted(current) : current;
  if (event.type === "closeCase") return canCloseCase(current) ? closeCase(current) : current;
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
  if (raw.type === "recordCaseEvent" && typeof raw.liftEvent === "boolean" && typeof raw.decayEvent === "boolean") return { type: "recordCaseEvent", liftEvent: raw.liftEvent, decayEvent: raw.decayEvent };
  if (raw.type === "markCaseHeld") return { type: "markCaseHeld" };
  if (raw.type === "markCaseLifted") return { type: "markCaseLifted" };
  if (raw.type === "closeCase") return { type: "closeCase" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SafetyCase | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NoCase" || raw.phase === "CaseOpen" || raw.phase === "CaseHeld" || raw.phase === "CaseLifted" || raw.phase === "CaseClosed") && Object.keys(raw).length === 1)) return undefined;
  const parsed: SafetyCase = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SafetyCase {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_safetyCase(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_safetyCase((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
