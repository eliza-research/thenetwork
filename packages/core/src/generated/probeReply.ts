// GENERATED from spec/probeReply.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
export type ReplyReading = "KeepOffline" | "HeardYes" | "HeardNo";
/** Story: Make a choice about a proposed opportunity / A direct request to proceed without the member declines the offer (spec/probeReply.md) */
export type ParticipationWithdrawal = "NoWithdrawalWords" | "DirectWithdrawal" | "QualifiedWithdrawal";


/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
//@ pure
export function probeReplyReading(offlineUnclear: boolean, offlineFoundNothing: boolean, modelConsent: string): ReplyReading {
  return offlineUnclear && offlineFoundNothing ? (modelConsent === "yes" ? "HeardYes" : (modelConsent === "no" ? "HeardNo" : "KeepOffline")) : "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
//@ pure
export function lawAQualifiedAnswerCannotBeOverridden(modelConsent: string): boolean {
  //@ ensures \result === true
  return probeReplyReading(true, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
//@ pure
export function lawADefiniteAnswerCannotBeOverridden(offlineFoundNothing: boolean, modelConsent: string): boolean {
  //@ ensures \result === true
  return probeReplyReading(false, offlineFoundNothing, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A direct request to proceed without the member declines the offer (spec/probeReply.md) */
//@ pure
export function participationWithdrawalReading(hasWithdrawalWords: boolean, direct: boolean): ParticipationWithdrawal {
  return !hasWithdrawalWords ? "NoWithdrawalWords" : (direct ? "DirectWithdrawal" : "QualifiedWithdrawal");
}

/** Story: Make a choice about a proposed opportunity / A direct request to proceed without the member declines the offer (spec/probeReply.md) */
//@ pure
export function lawIndirectWithdrawalNeedsAnAnswer(modelConsent: string): boolean {
  //@ ensures \result === true
  return participationWithdrawalReading(true, false) === "QualifiedWithdrawal" && probeReplyReading(true, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A direct request to proceed without the member declines the offer (spec/probeReply.md) */
//@ pure
export function lawDirectWithdrawalKeepsTheRefusal(modelConsent: string): boolean {
  //@ ensures \result === true
  return participationWithdrawalReading(true, true) === "DirectWithdrawal" && probeReplyReading(false, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A clear yes uses the chosen times when the member names them (spec/probeReply.md) */
//@ pure
export function pickedTimes(chosen: string[], offered: string[]): string[] {
  return chosen.length > 0 ? chosen : offered;
}

/** Story: Make a choice about a proposed opportunity / A direct ordinal selects that position in the offer (spec/probeReply.md) */
//@ pure
export function probeOrdinalIndex(ordinal: number, optionCount: number): number {
  return ordinal === -1 && optionCount > 0 ? exact_probeReply(optionCount - 1) : (ordinal >= 0 && ordinal < optionCount ? ordinal : -1);
}

/** Story: Make a choice about a proposed opportunity / A direct ordinal selects that position in the offer (spec/probeReply.md) */
//@ pure
export function lawSelectedOrdinalIsOffered(ordinal: number, optionCount: number): boolean {
  //@ ensures \result === true
  return !(probeOrdinalIndex(ordinal, optionCount) >= 0) || probeOrdinalIndex(ordinal, optionCount) < optionCount;
}

/** Story: Make a choice about a proposed opportunity / A day group selects only offered slots in that group (spec/probeReply.md) */
//@ pure
export function probeGroupIncludes(groupWeekend: boolean, offeredWeekend: boolean, needsEvening: boolean, offeredEvening: boolean, namesPart: boolean, partMatches: boolean): boolean {
  return groupWeekend === offeredWeekend && (!needsEvening || offeredEvening) && (!namesPart || partMatches);
}

/** Story: Make a choice about a proposed opportunity / A day group selects only offered slots in that group (spec/probeReply.md) */
//@ pure
export function lawProbeGroupDoesNotCrossWeekBoundary(groupWeekend: boolean, offeredWeekend: boolean, needsEvening: boolean, offeredEvening: boolean, namesPart: boolean, partMatches: boolean): boolean {
  //@ ensures \result === true
  return !probeGroupIncludes(groupWeekend, offeredWeekend, needsEvening, offeredEvening, namesPart, partMatches) || groupWeekend === offeredWeekend;
}

/** Story: Make a choice about a proposed opportunity / A past time reference leaves the offered time open (spec/probeReply.md) */
//@ pure
export function historicalProbeTimeClause(describesPast: boolean, timeReference: boolean): boolean {
  return describesPast && timeReference;
}

/** Story: Make a choice about a proposed opportunity / A past time reference leaves the offered time open (spec/probeReply.md) */
//@ pure
export function lawPresentProbeTimeKeepsItsClause(timeReference: boolean): boolean {
  //@ ensures \result === true
  return !historicalProbeTimeClause(false, timeReference);
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md) */
//@ pure
export function mayRetryCounter(offeredTimes: boolean, separateYes: boolean): boolean {
  return offeredTimes && separateYes;
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md) */
//@ pure
export function lawABareCounterDoesNotAccept(offeredTimes: boolean): boolean {
  //@ ensures \result === true
  return !mayRetryCounter(offeredTimes, false);
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md) */
//@ pure
export function lawAnUntimedProbeNeedsASeparateAnswer(separateYes: boolean): boolean {
  //@ ensures \result === true
  return !mayRetryCounter(false, separateYes);
}

/** Story: Make a choice about a proposed opportunity / A relative time or duration alone cannot choose an offered slot (spec/probeReply.md) */
//@ pure
export function unboundProbeTimeNeedsClarification(unboundTime: boolean, independentChoice: boolean): boolean {
  return unboundTime && !independentChoice;
}

/** Story: Make a choice about a proposed opportunity / A relative time or duration alone cannot choose an offered slot (spec/probeReply.md) */
//@ pure
export function lawUnboundTimeAloneKeepsTheProbeOpen(modelConsent: string): boolean {
  //@ ensures \result === true
  return unboundProbeTimeNeedsClarification(true, false) && probeReplyReading(true, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / An untimed probe needs an answer to the opportunity (spec/probeReply.md) */
//@ pure
export function untimedProbeTimeRejectionNeedsClarification(offeredTimes: boolean, rejectedTimes: boolean, otherwiseUnqualified: boolean): boolean {
  return !offeredTimes && rejectedTimes && otherwiseUnqualified;
}

/** Story: Make a choice about a proposed opportunity / An untimed probe needs an answer to the opportunity (spec/probeReply.md) */
//@ pure
export function lawATimedProbeKeepsItsTimeRejectionRules(rejectedTimes: boolean, otherwiseUnqualified: boolean): boolean {
  //@ ensures \result === true
  return !untimedProbeTimeRejectionNeedsClarification(true, rejectedTimes, otherwiseUnqualified);
}

/** Story: Make a choice about a proposed opportunity / An untimed probe needs an answer to the opportunity (spec/probeReply.md) */
//@ pure
export function lawAnUntimedTimeRejectionKeepsTheProbeOpen(modelConsent: string): boolean {
  //@ ensures \result === true
  return untimedProbeTimeRejectionNeedsClarification(false, true, true) && probeReplyReading(true, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A short acknowledgement must immediately follow its own probe (spec/probeReply.md) */
//@ pure
export function weakProbeAcknowledgementAllowed(direct: boolean, latestProbe: boolean, uninterrupted: boolean, precedingMessages: number, receiptAccepted: boolean, acceptedAt: number, receivedAt: number, now: number): boolean {
  return direct && latestProbe && uninterrupted && precedingMessages < 2 && receiptAccepted && acceptedAt <= receivedAt && receivedAt <= now;
}

/** Story: Make a choice about a proposed opportunity / A short acknowledgement must immediately follow its own probe (spec/probeReply.md) */
//@ pure
export function lawWeakAcknowledgementNeedsLatestProbe(precedingMessages: number, acceptedAt: number, receivedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !weakProbeAcknowledgementAllowed(true, false, true, precedingMessages, true, acceptedAt, receivedAt, now);
}

/** Story: Make a choice about a proposed opportunity / A short acknowledgement must immediately follow its own probe (spec/probeReply.md) */
//@ pure
export function lawWeakAcknowledgementNeedsUninterruptedTurn(precedingMessages: number, acceptedAt: number, receivedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !weakProbeAcknowledgementAllowed(true, true, false, precedingMessages, true, acceptedAt, receivedAt, now);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_probeReply(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
