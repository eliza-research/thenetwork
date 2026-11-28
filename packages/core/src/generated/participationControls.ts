// GENERATED from spec/participationControls.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
export const quietHoursOffHour: number = 0;

/** Story: Change when and about what Eliza can contact me / Only the current member can change settings in the current app (spec/participationControls.md) */
//@ pure
export function participationControlAllowed(signedDirect: boolean, ownActiveMembership: boolean): boolean {
  return signedDirect && ownActiveMembership;
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function controlQuietHoursValid(startHour: number, endHour: number): boolean {
  return startHour >= 0 && startHour < 24 && endHour >= 0 && endHour < 24;
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function quietHoursCommandComplete(startKnown: boolean, endKnown: boolean, startHour: number, endHour: number): boolean {
  return startKnown && endKnown && controlQuietHoursValid(startHour, endHour);
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function quietHoursEmpty(startHour: number, endHour: number): boolean {
  return startHour === endHour;
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function boundedQuietHoursSave(startHour: number, endHour: number): boolean {
  return !quietHoursEmpty(startHour, endHour);
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function lawBoundedEmptyWindowDoesNotSave(hour: number): boolean {
  //@ ensures \result === true
  return !boundedQuietHoursSave(hour, hour);
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function lawMissingEndpointNeedsClarification(known: boolean, startHour: number, endHour: number): boolean {
  //@ ensures \result === true
  return !quietHoursCommandComplete(false, known, startHour, endHour) && !quietHoursCommandComplete(known, false, startHour, endHour);
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function lawQuietHoursOffIsEmpty(startHour: number): boolean {
  //@ ensures \result === true
  return !(startHour === quietHoursOffHour) || (quietHoursEmpty(startHour, quietHoursOffHour) && controlQuietHoursValid(startHour, quietHoursOffHour));
}

/** Story: Change when and about what Eliza can contact me / A category changes only on an explicit request (spec/participationControls.md) */
//@ pure
export function participationCategoryAllowed(category: string, enable: boolean, appOffers: boolean, adult: boolean): boolean {
  return !enable || (appOffers && (category !== "romance" || adult));
}

/** Story: Change when and about what Eliza can contact me / A category changes only on an explicit request (spec/participationControls.md) */
//@ pure
export function changeParticipationCategory(categories: string[], category: string, enable: boolean): string[] {
  return enable ? (categories.includes(category) ? categories : categories.concat([category])) : categories.filter((saved: string) => saved !== category);
}

/** Story: Change when and about what Eliza can contact me / A category changes only on an explicit request (spec/participationControls.md) */
//@ pure
export function controlRomanceOptIn(priorOptIn: boolean, category: string, enable: boolean): boolean {
  return category === "romance" ? enable : priorOptIn;
}

/** Story: Change when and about what Eliza can contact me / A category changes only on an explicit request (spec/participationControls.md) */
//@ pure
export function lawNonDatingCategoryLeavesDatingPermission(priorOptIn: boolean, category: string, enable: boolean): boolean {
  //@ ensures \result === true
  return !(category !== "romance") || controlRomanceOptIn(priorOptIn, category, enable) === priorOptIn;
}

/** Story: Change when and about what Eliza can contact me / Pause and resume apply immediately to matching (spec/participationControls.md) */
//@ pure
export function participationControlState(pause: boolean): string {
  return pause ? "paused" : "normal";
}

/** Story: Change when and about what Eliza can contact me / Pause and resume apply immediately to matching (spec/participationControls.md) */
//@ pure
export function pauseUntilWeekdayDaysAhead(todayWeekday: number, namedWeekday: number): number {
  return remainder_participationControls(exact_participationControls(exact_participationControls(namedWeekday - todayWeekday) + 7), 7) === 0 ? 7 : remainder_participationControls(exact_participationControls(exact_participationControls(namedWeekday - todayWeekday) + 7), 7);
}

/** Story: Change when and about what Eliza can contact me / Pause and resume apply immediately to matching (spec/participationControls.md) */
//@ pure
export function lawPauseUntilWeekdayEndsAhead(todayWeekday: number, namedWeekday: number): boolean {
  //@ ensures \result === true
  return !(0 <= todayWeekday && todayWeekday < 7 && 0 <= namedWeekday && namedWeekday < 7) || (pauseUntilWeekdayDaysAhead(todayWeekday, namedWeekday) >= 1 && pauseUntilWeekdayDaysAhead(todayWeekday, namedWeekday) <= 7);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_participationControls(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_participationControls(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}

/** The remainder of that division; it has the sign of the dividend. */
//@ pure
export function remainder_participationControls(a: number, b: number): number {
  //@ requires b !== 0
  return a - b * quotient_participationControls(a, b);
}
