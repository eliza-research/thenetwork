// GENERATED from spec/probeReply.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
export type ReplyReading = "KeepOffline" | "HeardYes" | "HeardNo";
/** Story: Make a choice about a proposed opportunity / A late answer to an expired probe hears once that the invitation ended (spec/probeReply.md) */
export type LateProbeRoute = "TellProbeEnded" | "NotALateProbeAnswer";


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

/** Story: Make a choice about a proposed opportunity / A clear yes uses the chosen times when the member names them (spec/probeReply.md) */
//@ pure
export function pickedTimes(chosen: string[], offered: string[]): string[] {
  return chosen.length > 0 ? chosen : offered;
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

/** Story: Make a choice about a proposed opportunity / A late answer to an expired probe hears once that the invitation ended (spec/probeReply.md) */
//@ pure
export function lateProbeRoute(direct: boolean, answered: boolean, latestProbe: boolean, receiptAccepted: boolean, acceptedAt: number, endedAt: number, receivedAt: number, alreadyTold: boolean): LateProbeRoute {
  return direct && answered && latestProbe && receiptAccepted && acceptedAt <= receivedAt && endedAt <= receivedAt && !alreadyTold ? "TellProbeEnded" : "NotALateProbeAnswer";
}

/** Story: Make a choice about a proposed opportunity / A late answer to an expired probe hears once that the invitation ended (spec/probeReply.md) */
//@ pure
export function lawALateAnswerIsToldOnce(direct: boolean, answered: boolean, latestProbe: boolean, receiptAccepted: boolean, acceptedAt: number, endedAt: number, receivedAt: number): boolean {
  //@ ensures \result === true
  return lateProbeRoute(direct, answered, latestProbe, receiptAccepted, acceptedAt, endedAt, receivedAt, true) === "NotALateProbeAnswer";
}

/** Story: Make a choice about a proposed opportunity / A late answer to an expired probe hears once that the invitation ended (spec/probeReply.md) */
//@ pure
export function lawALateAnswerNeedsTheDeliveredProbe(direct: boolean, answered: boolean, latestProbe: boolean, acceptedAt: number, endedAt: number, receivedAt: number): boolean {
  //@ ensures \result === true
  return lateProbeRoute(direct, answered, latestProbe, false, acceptedAt, endedAt, receivedAt, false) === "NotALateProbeAnswer";
}

/** Story: Make a choice about a proposed opportunity / A late answer to an expired probe hears once that the invitation ended (spec/probeReply.md) */
//@ pure
export function lawAnAnswerBeforeTheExpiryIsNotLate(direct: boolean, answered: boolean, latestProbe: boolean, acceptedAt: number, endedAt: number, receivedAt: number): boolean {
  //@ ensures \result === true
  return !(receivedAt < endedAt) || lateProbeRoute(direct, answered, latestProbe, true, acceptedAt, endedAt, receivedAt, false) === "NotALateProbeAnswer";
}
