// GENERATED from spec/observatoryMemberConsent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: F35 — Inspect a member's experience as staff / Recorded consent changes the current view once (spec/observatoryMemberConsent.md) */
//@ pure
export function currentConsentViewChanges(joined: boolean, wasStopped: boolean, nowStopped: boolean): boolean {
  return joined && wasStopped !== nowStopped;
}

/** Story: F35 — Inspect a member's experience as staff / Recorded consent changes the current view once (spec/observatoryMemberConsent.md) */
//@ pure
export function lawSameConsentLeavesViewUnchanged(joined: boolean, stopped: boolean): boolean {
  //@ ensures \result === true
  return !currentConsentViewChanges(joined, stopped, stopped);
}

/** Story: F35 — Inspect a member's experience as staff / Recorded consent changes the current view once (spec/observatoryMemberConsent.md) */
//@ pure
export function lawConsentCannotEnroll(wasStopped: boolean, nowStopped: boolean): boolean {
  //@ ensures \result === true
  return !currentConsentViewChanges(false, wasStopped, nowStopped);
}
