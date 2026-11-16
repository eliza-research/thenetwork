// GENERATED from spec/probeReply.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md:7) */
export type ReplyReading = "KeepOffline" | "HeardYes" | "HeardNo";


/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md:7) */
//@ pure
export function probeReplyReading(offlineUnclear: boolean, offlineFoundNothing: boolean, modelConsent: string): ReplyReading {
  return offlineUnclear && offlineFoundNothing ? (modelConsent === "yes" ? "HeardYes" : (modelConsent === "no" ? "HeardNo" : "KeepOffline")) : "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md:7) */
//@ pure
export function lawAQualifiedAnswerCannotBeOverridden(modelConsent: string): boolean {
  //@ ensures \result === true
  return probeReplyReading(true, false, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A model reading cannot replace a definite or qualified answer (spec/probeReply.md:7) */
//@ pure
export function lawADefiniteAnswerCannotBeOverridden(offlineFoundNothing: boolean, modelConsent: string): boolean {
  //@ ensures \result === true
  return probeReplyReading(false, offlineFoundNothing, modelConsent) === "KeepOffline";
}

/** Story: Make a choice about a proposed opportunity / A clear yes uses the chosen times when the member names them (spec/probeReply.md:28) */
//@ pure
export function pickedTimes(chosen: string[], offered: string[]): string[] {
  return chosen.length > 0 ? chosen : offered;
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md:37) */
//@ pure
export function mayRetryCounter(offeredTimes: boolean, separateYes: boolean): boolean {
  return offeredTimes && separateYes;
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md:37) */
//@ pure
export function lawABareCounterDoesNotAccept(offeredTimes: boolean): boolean {
  //@ ensures \result === true
  return !mayRetryCounter(offeredTimes, false);
}

/** Story: Make a choice about a proposed opportunity / A suggested alternative needs a separate yes before asking for new times (spec/probeReply.md:37) */
//@ pure
export function lawAnUntimedProbeNeedsASeparateAnswer(separateYes: boolean): boolean {
  //@ ensures \result === true
  return !mayRetryCounter(false, separateYes);
}
