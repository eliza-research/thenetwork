// GENERATED from spec/probeReply.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md) */
export type ReplyReading = "KeepOffline" | "HeardYes" | "HeardNo";
/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
export type ClarifiedTimeReading = "KeepProbeAnswer" | "UseExplicitProbeTimes" | "AwaitExplicitProbeTimes";


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

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function probeNeedsExplicitTimeChoice(offeredTimes: boolean, timeChoice: boolean, legacyClarified: boolean, unresolvedTime: boolean): boolean {
  return offeredTimes && (timeChoice || legacyClarified || unresolvedTime);
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function probeClarificationMayAsk(askForTimes: boolean, clarified: boolean, timeChoice: boolean): boolean {
  return askForTimes ? !timeChoice : !clarified;
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function clarifiedBroadTimeChoiceAllowed(explicitChoice: boolean, pairChoice: boolean, offeredCount: number): boolean {
  return explicitChoice && (!pairChoice || offeredCount === 2);
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function clarifiedProbeTimeReading(timeChoice: boolean, answer: string, offeredChoices: number, explicitChoices: number): ClarifiedTimeReading {
  return !timeChoice || answer === "no" || (answer === "yes" && offeredChoices === 0) ? "KeepProbeAnswer" : (answer === "yes" && explicitChoices > 0 ? "UseExplicitProbeTimes" : "AwaitExplicitProbeTimes");
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawAnUntimedProbeDoesNotNeedATimeChoice(legacyClarified: boolean, unresolvedTime: boolean): boolean {
  //@ ensures \result === true
  return !probeNeedsExplicitTimeChoice(false, true, legacyClarified, unresolvedTime);
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawAProbeTimeQuestionIsAskedOnce(clarified: boolean): boolean {
  //@ ensures \result === true
  return !probeClarificationMayAsk(true, clarified, true);
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawASecondQuestionCanClarifyTimes(clarified: boolean): boolean {
  //@ ensures \result === true
  return !clarified || (probeClarificationMayAsk(true, clarified, false) && !probeClarificationMayAsk(false, clarified, false));
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawAClarifiedPairNeedsTwoOfferedTimes(offeredCount: number): boolean {
  //@ ensures \result === true
  return !(offeredCount !== 2) || !clarifiedBroadTimeChoiceAllowed(true, true, offeredCount);
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawAClarifiedProbeCannotUseAnImplicitTime(offeredChoices: number): boolean {
  //@ ensures \result === true
  return !(offeredChoices > 0) || clarifiedProbeTimeReading(true, "yes", offeredChoices, 0) === "AwaitExplicitProbeTimes";
}

/** Story: Make a choice about a proposed opportunity / An unresolved offered time needs a time choice (spec/probeReply.md) */
//@ pure
export function lawAClarifiedProbeCanUseExplicitTimes(offeredChoices: number, explicitChoices: number): boolean {
  //@ ensures \result === true
  return !(offeredChoices > 0 && explicitChoices > 0) || clarifiedProbeTimeReading(true, "yes", offeredChoices, explicitChoices) === "UseExplicitProbeTimes";
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
