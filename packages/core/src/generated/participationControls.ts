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
export function quietHoursEmpty(startHour: number, endHour: number): boolean {
  return startHour === endHour;
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function lawQuietHoursOffIsEmpty(startHour: number): boolean {
  //@ ensures \result === true
  return !(startHour === quietHoursOffHour) || (quietHoursEmpty(startHour, quietHoursOffHour) && controlQuietHoursValid(startHour, quietHoursOffHour));
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function quietHoursCommandComplete(startKnown: boolean, endKnown: boolean, startHour: number, endHour: number): boolean {
  return startKnown && endKnown && controlQuietHoursValid(startHour, endHour);
}

/** Story: Change when and about what Eliza can contact me / Quiet hours use the member's local clock (spec/participationControls.md) */
//@ pure
export function lawMissingEndpointNeedsClarification(known: boolean, startHour: number, endHour: number): boolean {
  //@ ensures \result === true
  return !quietHoursCommandComplete(false, known, startHour, endHour) && !quietHoursCommandComplete(known, false, startHour, endHour);
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
