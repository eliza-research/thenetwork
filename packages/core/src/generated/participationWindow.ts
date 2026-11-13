// GENERATED from spec/participationWindow.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Set availability for a time window / STOP takes precedence over a participation setting (spec/participationWindow.md:22) */
export type ParticipationOverride = "KeepBase" | "UseNormal" | "UseQuiet" | "UsePaused";


/** Story: Set availability for a time window / A window starts inclusively and ends exclusively (spec/participationWindow.md:7) */
//@ pure
export function validWindow(hasStart: boolean, hasEnd: boolean, startAt: number, endAt: number): boolean {
  return !(hasStart && hasEnd) || startAt < endAt;
}

/** Story: Set availability for a time window / A window starts inclusively and ends exclusively (spec/participationWindow.md:7) */
//@ pure
export function windowIsActive(optedOut: boolean, hasWindow: boolean, hasStart: boolean, hasEnd: boolean, startAt: number, endAt: number, asOf: number): boolean {
  return !optedOut && hasWindow && (!hasStart || startAt <= asOf) && (!hasEnd || asOf < endAt);
}

/** Story: Set availability for a time window / A window starts inclusively and ends exclusively (spec/participationWindow.md:7) */
//@ pure
export function lawAWindowCannotContinueAtItsEnd(startAt: number, endAt: number): boolean {
  //@ ensures \result === true
  return !windowIsActive(false, true, true, true, startAt, endAt, endAt);
}

/** Story: Set availability for a time window / STOP takes precedence over a participation setting (spec/participationWindow.md:22) */
//@ pure
export function participationOverride(optedOut: boolean, windowActive: boolean, scheduledMode: string): ParticipationOverride {
  return optedOut ? "UsePaused" : (!windowActive ? "KeepBase" : (scheduledMode === "open" ? "UseNormal" : (scheduledMode === "paused" ? "UsePaused" : "UseQuiet")));
}

/** Story: Set availability for a time window / STOP takes precedence over a participation setting (spec/participationWindow.md:22) */
//@ pure
export function lawStopAlwaysPauses(windowActive: boolean, scheduledMode: string): boolean {
  //@ ensures \result === true
  return participationOverride(true, windowActive, scheduledMode) === "UsePaused";
}
