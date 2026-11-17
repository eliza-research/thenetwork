// GENERATED from spec/notificationDelivery.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md) */
export type WeeklyDigest = "KeepDigest" | "KeepRequested" | "HoldDigest";
/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
export type AssistantActivity = "AssistantActive" | "AssistantInactive" | "AssistantUnchanged";

/** Story: Receive updates on a surface I use / Ignore inactive assistants and assistants whose links went unused twice (spec/notificationDelivery.md) */
export const maxIgnoredStreak: number = 2;
/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md) */
export const surfaceRecentMs: number = 1209600000;

/** Story: Get a requested update when it is due / Requested updates are due at once (spec/notificationDelivery.md) */
//@ pure
export function inboxDueAt(createdAt: number, urgency: string, urgentDelay: number, digestDelay: number): number {
  return urgency === "requested" ? createdAt : (urgency === "urgent" ? exact_notificationDelivery(createdAt + urgentDelay) : exact_notificationDelivery(createdAt + digestDelay));
}

/** Story: Get a requested update when it is due / Requested updates are due at once (spec/notificationDelivery.md) */
//@ pure
export function lawRequestedIsDueAtCreation(createdAt: number, urgentDelay: number, digestDelay: number): boolean {
  //@ ensures \result === true
  return inboxDueAt(createdAt, "requested", urgentDelay, digestDelay) === createdAt;
}

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md) */
//@ pure
export function digestUsesProactiveSlot(itemCount: number, requestedCount: number): boolean {
  return requestedCount < itemCount;
}

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md) */
//@ pure
export function lawRequestedOnlyDigestUsesNoSlot(itemCount: number): boolean {
  //@ ensures \result === true
  return !digestUsesProactiveSlot(itemCount, itemCount);
}

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md) */
//@ pure
export function weeklyDigest(recentSends: number, weeklyCap: number, itemCount: number, requestedCount: number): WeeklyDigest {
  return recentSends < weeklyCap || !digestUsesProactiveSlot(itemCount, requestedCount) ? "KeepDigest" : (requestedCount > 0 ? "KeepRequested" : "HoldDigest");
}

/** Story: Get a requested update when it is due / At the weekly cap only requested updates can go out (spec/notificationDelivery.md) */
//@ pure
export function lawWeeklyCapPreservesRequestedItems(recentSends: number, weeklyCap: number, itemCount: number, requestedCount: number): boolean {
  //@ ensures \result === true
  return !(requestedCount > 0 && requestedCount <= itemCount) || weeklyDigest(recentSends, weeklyCap, itemCount, requestedCount) !== "HoldDigest";
}

/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
//@ pure
export function assistantGrantCounts(samePerson: boolean, sameAssistant: boolean, allowsUpdates: boolean, live: boolean): boolean {
  return samePerson && sameAssistant && allowsUpdates && live;
}

/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
//@ pure
export function projectAssistantActivity(hasEligibleGrant: boolean, checksComplete: boolean): AssistantActivity {
  return hasEligibleGrant ? "AssistantActive" : (checksComplete ? "AssistantInactive" : "AssistantUnchanged");
}

/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
//@ pure
export function lawDifferentPersonOrAssistantCannotCount(samePerson: boolean, sameAssistant: boolean, allowsUpdates: boolean, live: boolean): boolean {
  //@ ensures \result === true
  return !(!samePerson || !sameAssistant) || !assistantGrantCounts(samePerson, sameAssistant, allowsUpdates, live);
}

/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
//@ pure
export function lawAnotherEligibleGrantKeepsAssistantActive(checksComplete: boolean): boolean {
  //@ ensures \result === true
  return projectAssistantActivity(true, checksComplete) === "AssistantActive";
}

/** Story: Receive updates on a surface I use / One app's removal keeps an assistant active while another grant remains (spec/notificationDelivery.md) */
//@ pure
export function lawUnverifiedGrantCannotDeactivateAssistant(hasEligibleGrant: boolean): boolean {
  //@ ensures \result === true
  return projectAssistantActivity(hasEligibleGrant, false) !== "AssistantInactive";
}

/** Story: Receive updates on a surface I use / The text thread carries a digest one connector cannot read (spec/notificationDelivery.md) */
//@ pure
export function assistantDigestCanLink(singleApp: boolean, hasReadableAssistant: boolean): boolean {
  return singleApp && hasReadableAssistant;
}

/** Story: Receive updates on a surface I use / The text thread carries a digest one connector cannot read (spec/notificationDelivery.md) */
//@ pure
export function lawMixedDigestOrMissingGrantNeverLinks(singleApp: boolean, hasReadableAssistant: boolean): boolean {
  //@ ensures \result === true
  return !(!singleApp || !hasReadableAssistant) || !assistantDigestCanLink(singleApp, hasReadableAssistant);
}

/** Story: Receive updates on a surface I use / Ignore inactive assistants and assistants whose links went unused twice (spec/notificationDelivery.md) */
//@ pure
export function surfaceIsUsable(active: boolean, ignoredStreak: number): boolean {
  return active && ignoredStreak < maxIgnoredStreak;
}

/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md) */
//@ pure
export function deliverySurfaceScore(acted: number, ignored: number, recentUse: boolean, active: boolean): number {
  return exact_notificationDelivery(exact_notificationDelivery(exact_notificationDelivery(exact_notificationDelivery(acted * 3) + (recentUse ? 2 : 0)) + (active ? 1 : 0)) - exact_notificationDelivery(ignored * 2));
}

/** Story: Receive updates on a surface I use / A useful assistant must lead the other surfaces (spec/notificationDelivery.md) */
//@ pure
export function surfaceHasClearLead(bestScore: number, otherScore: number): boolean {
  return bestScore >= 3 && exact_notificationDelivery(bestScore - otherScore) >= 2;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_notificationDelivery(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
