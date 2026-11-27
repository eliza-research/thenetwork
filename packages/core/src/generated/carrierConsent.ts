// GENERATED from spec/carrierConsent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
export type StopConjunct = "ExplicitStop" | "CompleteNegation" | "IncompleteNegation" | "OtherClause";
/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
export type CoordinatedStop = "FirstStops" | "LastStops" | "NeitherStops";


/** Story: Stop texts across apps and resume an app / Courtesy or urgency can accompany a whole-message STOP command (spec/carrierConsent.md) */
//@ pure
export function stopWordAllowsCourtesy(word: string): boolean {
  return word === "STOP" || word === "QUIT" || word === "END" || word === "PARA" || word === "PARAR" || word === "ALTO" || word === "BASTA" || word === "DETENER" || word === "NO MAS" || word === "NO MAS MENSAJES";
}

/** Story: Stop texts across apps and resume an app / Courtesy or urgency can accompany a whole-message STOP command (spec/carrierConsent.md) */
//@ pure
export function lawCourtesyCannotTurnAmbiguousCommandsIntoStop(word: string): boolean {
  //@ ensures \result === true
  return !(word === "CANCEL" || word === "CANCELAR" || word === "BAJA") || !stopWordAllowsCourtesy(word);
}

/** Story: Stop texts across apps and resume an app / A plain refusal of future texts stops the shared line (spec/carrierConsent.md) */
//@ pure
export function textRefusalStops(hasDeterminer: boolean, permanentEnding: boolean): boolean {
  return hasDeterminer || permanentEnding;
}

/** Story: Stop texts across apps and resume an app / A plain refusal of future texts stops the shared line (spec/carrierConsent.md) */
//@ pure
export function lawBareTextRefusalNeedsPermanence(permanentEnding: boolean): boolean {
  //@ ensures \result === true
  return textRefusalStops(false, permanentEnding) === permanentEnding;
}

/** Story: Stop texts across apps and resume an app / A refusal bounded by a clock time does not stop the shared line (spec/carrierConsent.md) */
//@ pure
export function refusalStopsLine(hasRefusal: boolean, timeBounded: boolean): boolean {
  return hasRefusal && !timeBounded;
}

/** Story: Stop texts across apps and resume an app / A refusal bounded by a clock time does not stop the shared line (spec/carrierConsent.md) */
//@ pure
export function lawTimeBoundedRefusalCannotStop(hasRefusal: boolean): boolean {
  //@ ensures \result === true
  return !refusalStopsLine(hasRefusal, true);
}

/** Story: Stop texts across apps and resume an app / A refusal bounded by a clock time does not stop the shared line (spec/carrierConsent.md) */
//@ pure
export function lawUnboundedRefusalStillStops(hasRefusal: boolean): boolean {
  //@ ensures \result === true
  return refusalStopsLine(hasRefusal, false) === hasRefusal;
}

/** Story: Stop texts across apps and resume an app / Direct repeated and permanent refusals stop the shared line (spec/carrierConsent.md) */
//@ pure
export function sharedLineStopStatementStops(direct: boolean, repeated: boolean, permanent: boolean): boolean {
  return direct && (repeated || permanent);
}

/** Story: Stop texts across apps and resume an app / Direct repeated and permanent refusals stop the shared line (spec/carrierConsent.md) */
//@ pure
export function lawAnIndirectStopStatementCannotStop(repeated: boolean, permanent: boolean): boolean {
  //@ ensures \result === true
  return !sharedLineStopStatementStops(false, repeated, permanent);
}

/** Story: Stop texts across apps and resume an app / Direct repeated and permanent refusals stop the shared line (spec/carrierConsent.md) */
//@ pure
export function lawARecognizedDirectStopStatementStops(repeated: boolean, permanent: boolean): boolean {
  //@ ensures \result === true
  return !(repeated || permanent) || sharedLineStopStatementStops(true, repeated, permanent);
}

/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
//@ pure
export function coordinatedStopClause(leftClause: StopConjunct, rightClause: StopConjunct): CoordinatedStop {
  return leftClause === "CompleteNegation" && rightClause === "ExplicitStop" ? "LastStops" : (leftClause === "ExplicitStop" && (rightClause === "CompleteNegation" || rightClause === "IncompleteNegation") ? "FirstStops" : "NeitherStops");
}

/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
//@ pure
export function lawIncompleteNegationDoesNotMakeASeparateStop(rightClause: StopConjunct): boolean {
  //@ ensures \result === true
  return coordinatedStopClause("IncompleteNegation", rightClause) === "NeitherStops";
}

/** Story: Stop texts across apps and resume an app / A global STOP beats an older or simultaneous app opt-in (spec/carrierConsent.md) */
//@ pure
export function appOptInBeatsStop(appAt: number, stopAt: number): boolean {
  return appAt > stopAt;
}

/** Story: Stop texts across apps and resume an app / A global STOP beats an older or simultaneous app opt-in (spec/carrierConsent.md) */
//@ pure
export function lawStopWinsATie(at: number): boolean {
  //@ ensures \result === true
  return !appOptInBeatsStop(at, at);
}

/** Story: Stop texts across apps and resume an app / An app with no opt-in has no permission to send (spec/carrierConsent.md) */
//@ pure
export function appMayText(appOptedIn: boolean, globalOptedOut: boolean, appAt: number, globalAt: number): boolean {
  return appOptedIn && (!globalOptedOut || appOptInBeatsStop(appAt, globalAt));
}

/** Story: Stop texts across apps and resume an app / An app with no opt-in has no permission to send (spec/carrierConsent.md) */
//@ pure
export function lawNoAppOptInMeansNoPermission(globalOptedOut: boolean, appAt: number, globalAt: number): boolean {
  //@ ensures \result === true
  return !appMayText(false, globalOptedOut, appAt, globalAt);
}

/** Story: Leave the app I name without stopping the other apps / A spoken domain identifies that one app (spec/carrierConsent.md) */
//@ pure
export function matchesSpokenAppDomain(label: string, spaced: string, pronounced: string, ambiguousArticle: boolean): boolean {
  return label === pronounced || (!ambiguousArticle && label === spaced);
}

/** Story: Leave the app I name without stopping the other apps / A spoken domain identifies that one app (spec/carrierConsent.md) */
//@ pure
export function lawArticleDoesNotTurnSpacedLabelIntoDomain(spaced: string, pronounced: string): boolean {
  //@ ensures \result === true
  return !(spaced !== pronounced) || !matchesSpokenAppDomain(spaced, spaced, pronounced, true);
}
