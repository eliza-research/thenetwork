// GENERATED from spec/carrierConsent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
export type StopConjunct = "ExplicitStop" | "CompleteNegation" | "IncompleteNegation" | "OtherClause";
/** Story: Stop texts across apps and resume an app / An independent STOP joined to a negation still takes effect (spec/carrierConsent.md) */
export type CoordinatedStop = "FirstStops" | "LastStops" | "NeitherStops";


/** Story: Stop texts across apps and resume an app / Courtesy and urgency can accompany STOP, QUIT or END (spec/carrierConsent.md) */
//@ pure
export function stopWordAllowsCourtesy(word: string): boolean {
  return word === "STOP" || word === "QUIT" || word === "END";
}

/** Story: Stop texts across apps and resume an app / Courtesy and urgency can accompany STOP, QUIT or END (spec/carrierConsent.md) */
//@ pure
export function lawCourtesyCannotTurnCancelIntoStop(word: string): boolean {
  //@ ensures \result === true
  return !(word === "CANCEL") || !stopWordAllowsCourtesy(word);
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
