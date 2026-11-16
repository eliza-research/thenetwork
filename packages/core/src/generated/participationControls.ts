// GENERATED from spec/participationControls.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



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

/** Story: Change when and about what Eliza can contact me / A category changes only on an explicit request (spec/participationControls.md) */
//@ pure
export function controlRomanceOptIn(priorOptIn: boolean, category: string, enable: boolean): boolean {
  return category === "romance" ? enable : priorOptIn;
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
export function lawNonDatingCategoryLeavesDatingPermission(priorOptIn: boolean, category: string, enable: boolean): boolean {
  //@ ensures \result === true
  return !(category !== "romance") || controlRomanceOptIn(priorOptIn, category, enable) === priorOptIn;
}

/** Story: Change when and about what Eliza can contact me / Pause and resume apply immediately to matching (spec/participationControls.md) */
//@ pure
export function participationControlState(pause: boolean): string {
  return pause ? "paused" : "normal";
}
