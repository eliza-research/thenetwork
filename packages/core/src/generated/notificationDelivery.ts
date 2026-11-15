// GENERATED from spec/notificationDelivery.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny


/** Story: Receive updates on a surface I use / Ignore inactive assistants and assistants whose links went unused twice (spec/notificationDelivery.md:36) */
export const maxIgnoredStreak: number = 2;
/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md:47) */
export const surfaceRecentMs: number = 1209600000;

/** Story: Get a requested update when it is due / Requested updates are due at once (spec/notificationDelivery.md:9) */
//@ pure
export function inboxDueAt(createdAt: number, urgency: string, urgentDelay: number, digestDelay: number): number {
  return urgency === "requested" ? createdAt : (urgency === "urgent" ? createdAt + urgentDelay : createdAt + digestDelay);
}

/** Story: Get a requested update when it is due / Requested updates are due at once (spec/notificationDelivery.md:9) */
//@ pure
export function lawRequestedIsDueAtCreation(createdAt: number, urgentDelay: number, digestDelay: number): boolean {
  //@ ensures \result === true
  return inboxDueAt(createdAt, "requested", urgentDelay, digestDelay) === createdAt;
}

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md:23) */
//@ pure
export function removeProactiveItems(recentSends: number, weeklyCap: number, containsProactive: boolean): boolean {
  return recentSends >= weeklyCap && containsProactive;
}

/** Story: Receive updates on a surface I use / Ignore inactive assistants and assistants whose links went unused twice (spec/notificationDelivery.md:36) */
//@ pure
export function surfaceIsUsable(active: boolean, ignoredStreak: number): boolean {
  return active && ignoredStreak < maxIgnoredStreak;
}

/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md:47) */
//@ pure
export function deliverySurfaceScore(acted: number, ignored: number, recentUse: boolean, active: boolean): number {
  return acted * 3 + (recentUse ? 2 : 0) + (active ? 1 : 0) - ignored * 2;
}

/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md:47) */
//@ pure
export function surfaceHasClearLead(bestScore: number, otherScore: number): boolean {
  return bestScore >= 3 && bestScore - otherScore >= 2;
}
