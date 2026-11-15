// GENERATED from spec/carrierConsent.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny



/** Story: Stop texts across apps and resume an app / A global STOP beats an older or simultaneous app opt-in (spec/carrierConsent.md:9) */
//@ pure
export function appOptInBeatsStop(appAt: number, stopAt: number): boolean {
  return appAt > stopAt;
}

/** Story: Stop texts across apps and resume an app / A global STOP beats an older or simultaneous app opt-in (spec/carrierConsent.md:9) */
//@ pure
export function lawStopWinsATie(at: number): boolean {
  //@ ensures \result === true
  return !appOptInBeatsStop(at, at);
}

/** Story: Stop texts across apps and resume an app / An app with no opt-in has no permission to send (spec/carrierConsent.md:21) */
//@ pure
export function appMayText(appOptedIn: boolean, globalOptedOut: boolean, appAt: number, globalAt: number): boolean {
  return appOptedIn && (!globalOptedOut || appOptInBeatsStop(appAt, globalAt));
}

/** Story: Stop texts across apps and resume an app / An app with no opt-in has no permission to send (spec/carrierConsent.md:21) */
//@ pure
export function lawNoAppOptInMeansNoPermission(globalOptedOut: boolean, appAt: number, globalAt: number): boolean {
  //@ ensures \result === true
  return !appMayText(false, globalOptedOut, appAt, globalAt);
}
