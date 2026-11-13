// GENERATED from spec/quietHours.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny



/** Story: Avoid unsolicited messages during quiet hours / A quiet window includes its start and excludes its end (spec/quietHours.md:9) */
//@ pure
export function withinQuietHours(localHour: number, startHour: number, endHour: number): boolean {
  return startHour === endHour ? false : (startHour < endHour ? localHour >= startHour && localHour < endHour : localHour >= startHour || localHour < endHour);
}

/** Story: Avoid unsolicited messages during quiet hours / The boundary remains the same for windows that span midnight (spec/quietHours.md:20) */
//@ pure
export function lawWindowBoundaries(startHour: number, endHour: number): boolean {
  //@ ensures \result === true
  return !(startHour !== endHour) || (withinQuietHours(startHour, startHour, endHour) && !withinQuietHours(endHour, startHour, endHour));
}
