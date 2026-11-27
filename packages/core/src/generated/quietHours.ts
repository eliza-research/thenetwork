// GENERATED from spec/quietHours.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Avoid unsolicited messages during quiet hours / A quiet window includes its start and excludes its end (spec/quietHours.md) */
//@ pure
export function withinQuietHours(localHour: number, startHour: number, endHour: number): boolean {
  return startHour === endHour ? false : (startHour < endHour ? localHour >= startHour && localHour < endHour : localHour >= startHour || localHour < endHour);
}

/** Story: Avoid unsolicited messages during quiet hours / A texted clock bound updates the saved window (spec/quietHours.md) */
//@ pure
export function quietStartAfterText(currentStart: number, statedStart: number, startStated: boolean): number {
  return startStated ? statedStart : currentStart;
}

/** Story: Avoid unsolicited messages during quiet hours / A texted clock bound updates the saved window (spec/quietHours.md) */
//@ pure
export function quietEndAfterText(currentEnd: number, statedEnd: number, endStated: boolean): number {
  return endStated ? statedEnd : currentEnd;
}

/** Story: Avoid unsolicited messages during quiet hours / A texted clock bound updates the saved window (spec/quietHours.md) */
//@ pure
export function lawUnstatedBoundKeepsSavedValue(currentStart: number, currentEnd: number, statedStart: number, statedEnd: number): boolean {
  //@ ensures \result === true
  return quietStartAfterText(currentStart, statedStart, false) === currentStart && quietEndAfterText(currentEnd, statedEnd, false) === currentEnd;
}

/** Story: Avoid unsolicited messages during quiet hours / The boundary remains the same for windows that span midnight (spec/quietHours.md) */
//@ pure
export function lawWindowBoundaries(startHour: number, endHour: number): boolean {
  //@ ensures \result === true
  return !(startHour !== endHour) || (withinQuietHours(startHour, startHour, endHour) && !withinQuietHours(endHour, startHour, endHour));
}
