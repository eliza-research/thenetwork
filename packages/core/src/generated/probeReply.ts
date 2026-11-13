// GENERATED from spec/probeReply.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
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
